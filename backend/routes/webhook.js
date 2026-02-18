const express = require('express');
const logger = require('../services/logger');
const chatbot = require('../services/chatbot');
const whatsapp = require('../services/whatsapp');
const chatbotImagesService = require('../services/chatbotImages');
const googleSheets = require('../services/googleSheets');
const metaCloud = require('../services/metaCloud');
const groqAi = require('../services/groqAi');
const pushNotification = require('../services/pushNotification');
const authMiddleware = require('../middleware/auth');
const { webhookRateLimiter } = require('../middleware/rateLimiter');
const { verifyWebhookSignature } = require('../middleware/webhookVerification');
const { validateMetaWebhook, sanitizeWebhookPayload } = require('../middleware/webhookValidation');
const { transitionStatus } = require('../services/orderStateMachine');
const router = express.Router();

// ============================================================
// TEST/DEBUG ROUTES - Protected with auth, disabled in production
// ============================================================

// Test Google Sheets connection (admin only)
router.get('/test-sheets', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoints disabled in production' });
  }
  try {
    const testOrder = {
      orderId: 'TEST' + Date.now(),
      customer: { phone: '1234567890', name: 'Test Customer' },
      items: [{ name: 'Test Item', quantity: 1, price: 100 }],
      totalAmount: 100,
      serviceType: 'delivery',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      status: 'pending',
      deliveryAddress: { address: 'Test Address', latitude: 0, longitude: 0 }
    };

    const result = await googleSheets.addOrder(testOrder);
    res.json({ success: result, message: result ? 'Test order added to Google Sheet!' : 'Failed to add order' });
  } catch (error) {
    logger.error('Google Sheets test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint - send a test message (admin only)
router.get('/test/:phone', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoints disabled in production' });
  }
  try {
    const { phone } = req.params;
    await whatsapp.sendMessage(phone, '✅ Test message from your Restaurant Bot!');
    res.json({ success: true, message: 'Test message sent to ' + phone });
  } catch (error) {
    logger.error('Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint - send welcome menu with buttons (admin only)
router.get('/test-menu/:phone', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoints disabled in production' });
  }
  try {
    const { phone } = req.params;
    await chatbot.handleMessage(phone, 'hi', 'text', null);
    res.json({ success: true, message: 'Welcome menu sent to ' + phone });
  } catch (error) {
    logger.error('Test menu error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Simulate incoming message (admin only, dev only)
router.post('/simulate', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoints disabled in production' });
  }
  try {
    const { phone, message, selectedId } = req.body;
    const messageType = selectedId ? 'list' : 'text';
    await chatbot.handleMessage(phone, message || '', messageType, selectedId || null);
    res.json({ success: true, message: 'Simulated message processed' });
  } catch (error) {
    logger.error('Simulate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint to check customer state (admin only, dev only)
router.get('/debug/:phone', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints disabled in production' });
  }
  try {
    const Customer = require('../models/Customer');
    const customer = await Customer.findOne({ phone: req.params.phone }).populate('cart.menuItem');
    if (!customer) {
      return res.json({ error: 'Customer not found' });
    }
    res.json({
      phone: customer.phone,
      cart: customer.cart,
      conversationState: customer.conversationState
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check for webhook
router.get('/whatsapp', (req, res) => {
  res.json({ status: 'Webhook is active', timestamp: new Date().toISOString() });
});

// Meta WhatsApp Cloud API webhook verification
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verify token MUST come from env - no insecure fallback
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    logger.error('❌ META_VERIFY_TOKEN not configured');
    return res.sendStatus(500);
  }

  logger.info('🔐 Webhook verification attempt:', { mode, token, expectedToken: verifyToken, challenge: challenge ? 'present' : 'missing' });

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('✅ Meta webhook verified');
    res.status(200).send(challenge);
  } else if (!mode && !token) {
    // Simple health check (no verification params)
    res.json({ status: 'Webhook endpoint active', timestamp: new Date().toISOString() });
  } else {
    logger.info('❌ Meta webhook verification failed - token mismatch');
    res.sendStatus(403);
  }
});

// Meta WhatsApp Cloud API webhook endpoint (signature verified, validated, rate limited)
router.post('/meta', webhookRateLimiter, verifyWebhookSignature, validateMetaWebhook, sanitizeWebhookPayload, async (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('📥 Webhook POST received');
  }
  
  // 1. Respond to Meta IMMEDIATELY to avoid timeouts (prevents 'single tick' issue)
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          // ========== TEMPLATE STATUS UPDATES ==========
          if (change.field === 'message_template_status_update') {
            const value = change.value || {};
            const event = (value.event || '').toUpperCase(); // APPROVED, REJECTED, PENDING, etc.
            const tplName = value.message_template_name;
            const tplId = value.message_template_id;
            const reason = value.reason || value.rejected_reason || null;

            logger.info('Template status webhook received', { event, tplName, tplId, reason });

            if (tplName) {
              try {
                const Offer = require('../models/Offer');
                const statusMap = { 'APPROVED': 'approved', 'REJECTED': 'rejected', 'PENDING': 'pending' };
                const mappedStatus = statusMap[event] || 'pending';

                const updateFields = { templateStatus: mappedStatus };
                if (mappedStatus === 'approved') updateFields.templateApprovedAt = new Date();
                if (mappedStatus === 'rejected') updateFields.templateRejectionReason = reason || 'Rejected by Meta';

                const updated = await Offer.findOneAndUpdate(
                  { templateName: tplName },
                  updateFields,
                  { new: true }
                );

                if (updated) {
                  logger.info('Offer template status updated via webhook', { offerId: updated._id, tplName, status: mappedStatus });
                  // Emit SSE event so frontend can refresh
                  const eventEmitter = require('../services/eventEmitter');
                  eventEmitter.emit('dataUpdate', { type: 'offers', templateUpdate: { offerId: updated._id, status: mappedStatus } });

                  // Send push notification to all admin users
                  try {
                    const User = require('../models/User');
                    const admins = await User.find({ role: 'admin', pushToken: { $ne: null } }).select('pushToken');
                    for (const admin of admins) {
                      await pushNotification.sendOfferTemplateNotification(admin.pushToken, {
                        offerId: updated._id.toString(),
                        offerTitle: updated.title,
                        status: mappedStatus,
                        reason: reason || updated.templateRejectionReason
                      });
                    }
                    logger.info('Push notifications sent to admins for template status', { adminCount: admins.length, status: mappedStatus });
                  } catch (pushErr) {
                    logger.error('Failed to send push notification for template status', { error: pushErr.message });
                  }
                } else {
                  logger.warn('No offer found for template name', { tplName });
                }
              } catch (tplErr) {
                logger.error('Error handling template status webhook', { error: tplErr.message });
              }
            }
            continue;
          }

          if (change.field === 'messages') {
            const value = change.value;

            // Process status updates (delivery receipts, read receipts, PAYMENT statuses)
            // Updates OutboundMessage records with deliveredAt/readAt/failedAt timestamps
            if (value.statuses) {
              for (const status of value.statuses) {
                try {
                  // ===== HANDLE WHATSAPP NATIVE PAYMENT STATUS =====
                  if (status.type === 'payment' || status.payment) {
                    const paymentInfo = status.payment || {};
                    const txn = paymentInfo.transaction || {};
                    const referenceId = paymentInfo.reference_id || txn.id;
                    const paymentStatus = txn.status; // success, pending, failed, canceled
                    const paymentMethod = txn.method || paymentInfo.payment_method;
                    const amount = txn.amount;
                    const recipientPhone = status.recipient_id;

                    logger.info('💳 WhatsApp payment status received', {
                      referenceId,
                      paymentStatus,
                      paymentMethod,
                      amount,
                      recipientPhone
                    });

                    try {
                      const Order = require('../models/Order');
                      const order = await Order.findOne({ orderId: referenceId });

                      if (order) {
                        if (paymentStatus === 'success' || paymentStatus === 'completed') {
                          order.paymentStatus = 'paid';
                          order.paymentMethod = 'whatsapp_upi';
                          const txResult = transitionStatus(order, 'confirmed', `Payment received via WhatsApp UPI${paymentMethod ? ' (' + paymentMethod + ')' : ''}`);
                          if (!txResult.success) {
                            logger.warn('Status transition blocked for WhatsApp payment', { orderId: referenceId, reason: txResult.reason });
                            continue;
                          }
                          await order.save();

                          // Send order_status confirmation to customer
                          const metaCloud = require('../services/metaCloud');
                          await metaCloud.sendOrderStatusUpdate(
                            recipientPhone,
                            referenceId,
                            'completed',
                            `✅ Payment of ₹${order.totalAmount} received!\nOrder #${referenceId} is confirmed.\nWe're preparing your order! 🍳`
                          );

                          // Send push notification to admin
                          try {
                            const User = require('../models/User');
                            const pushNotification = require('../services/pushNotification');
                            const admins = await User.find({ pushToken: { $ne: null } });
                            for (const admin of admins) {
                              if (admin.pushToken) {
                                await pushNotification.sendAdminNewOrderNotification(admin.pushToken, {
                                  orderId: referenceId,
                                  totalAmount: order.totalAmount,
                                  customerName: order.customer?.name || 'Customer',
                                  items: order.items
                                });
                              }
                            }
                          } catch (pushErr) {
                            logger.error('Admin push error on payment', { error: pushErr.message });
                          }

                          // Sync to Google Sheets
                          const googleSheets = require('../services/googleSheets');
                          googleSheets.addOrder(order).catch(err => logger.error('GSheets sync error', { error: err.message }));
                          googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));

                          // Emit real-time events
                          const dataEvents = require('../services/eventEmitter');
                          dataEvents.emit('orders');
                          dataEvents.emit('dashboard');

                          logger.info('✅ WhatsApp payment confirmed, order updated', { orderId: referenceId });
                        } else if (paymentStatus === 'failed' || paymentStatus === 'canceled') {
                          order.paymentStatus = paymentStatus === 'canceled' ? 'cancelled' : 'failed';
                          order.trackingUpdates.push({
                            status: 'payment_failed',
                            message: `Payment ${paymentStatus} via WhatsApp UPI`,
                            timestamp: new Date()
                          });
                          await order.save();

                          // Notify customer
                          const chatbot = require('../services/chatbot');
                          const whatsapp = require('../services/whatsapp');
                          const payFailMsg = `❌ *Payment ${paymentStatus === 'canceled' ? 'Cancelled' : 'Failed'}*\n\nOrder #${referenceId}\n\nPlease try again or choose a different payment method.`;
                          const payFailBtns = [
                              { id: 'pay_upi', text: 'Retry UPI' },
                              { id: 'pay_cod', text: 'Pay COD' },
                              { id: 'home', text: 'Main Menu' }
                          ];
                          const payFailImg = await chatbotImagesService.getImageUrl('payment_failed');
                          if (payFailImg) {
                            await whatsapp.sendImageWithButtons(recipientPhone, payFailImg, payFailMsg, payFailBtns);
                          } else {
                            await whatsapp.sendButtons(recipientPhone, payFailMsg, payFailBtns);
                          }

                          logger.warn('❌ WhatsApp payment failed/canceled', { orderId: referenceId, paymentStatus });
                        }
                        // 'pending' — no action needed, wait for final status
                      } else {
                        logger.warn('Payment status for unknown order', { referenceId, paymentStatus });
                      }
                    } catch (paymentErr) {
                      logger.error('Error processing payment status', {
                        referenceId,
                        error: paymentErr.message
                      });
                    }
                    continue; // Skip normal status processing for payment statuses
                  }

                  const OutboundMessage = require('../models/OutboundMessage');
                  const metaMessageId = status.id;
                  const statusValue = status.status; // sent, delivered, read, failed
                  const statusTimestamp = status.timestamp 
                    ? new Date(parseInt(status.timestamp) * 1000)
                    : new Date();

                  const updateFields = {};
                  
                  if (statusValue === 'delivered') {
                    updateFields.status = 'delivered';
                    updateFields.deliveredAt = statusTimestamp;
                  } else if (statusValue === 'read') {
                    updateFields.status = 'read';
                    updateFields.readAt = statusTimestamp;
                  } else if (statusValue === 'failed') {
                    const errorInfo = status.errors?.[0];
                    updateFields.status = 'failed';
                    updateFields.failedAt = statusTimestamp;
                    if (errorInfo) {
                      updateFields['error.message'] = errorInfo.message || errorInfo.title;
                      updateFields['error.code'] = String(errorInfo.code || '');
                    }
                  }
                  // 'sent' status = Meta accepted, we already track that

                  if (Object.keys(updateFields).length > 0) {
                    // Fire-and-forget — don't block webhook response processing
                    OutboundMessage.findOneAndUpdate(
                      { metaMessageId },
                      { $set: updateFields },
                      { new: true }
                    ).catch(err => {
                      logger.error('Failed to update outbound status', {
                        metaMessageId,
                        status: statusValue,
                        error: err.message
                      });
                    });
                  }
                } catch (statusErr) {
                  logger.error('Error processing status update', { error: statusErr.message });
                }
              }
              // Also check if this payload has messages — some webhooks contain both
              if (!value.messages || value.messages.length === 0) {
                continue;
              }
            }

            // Extract contact name from Meta API contacts array
            const contacts = value.contacts || [];
            const contactsMap = {};
            for (const contact of contacts) {
              if (contact.wa_id && contact.profile?.name) {
                contactsMap[contact.wa_id] = contact.profile.name;
              }
            }

            for (const message of value.messages || []) {
              const phone = message.from;
              const senderName = contactsMap[phone] || null;
              let text = '';
              let messageType = 'text';
              let selectedId = null;

              if (message.type === 'text') {
                text = message.text?.body || '';
              } else if (message.type === 'interactive') {
                if (message.interactive?.type === 'button_reply') {
                  selectedId = message.interactive.button_reply?.id || '';
                  text = message.interactive.button_reply?.title || '';
                  messageType = 'button';
                } else if (message.interactive?.type === 'list_reply') {
                  selectedId = message.interactive.list_reply?.id || '';
                  text = message.interactive.list_reply?.title || '';
                  messageType = 'list';
                } else if (message.interactive?.type === 'nfm_reply') {
                  // WhatsApp Flows response — user completed a Flow
                  const nfmReply = message.interactive.nfm_reply || {};
                  try {
                    const responseData = typeof nfmReply.response_json === 'string'
                      ? JSON.parse(nfmReply.response_json)
                      : nfmReply.response_json || {};

                    logger.info('📋 Flow response received', {
                      phone,
                      flowName: nfmReply.name,
                      flowToken: responseData.flow_token,
                      data: responseData
                    });

                    // Category selection flow
                    if (responseData.flow_token?.startsWith('category_select') && responseData.selected_category) {
                      const isOrderFlow = responseData.flow_token.includes('order_');
                      const prefix = isOrderFlow ? 'order_cat_' : 'cat_';
                      selectedId = `${prefix}${responseData.selected_category}`;
                      text = responseData.selected_category;
                      messageType = 'button'; // Treat as button press for chatbot routing
                      logger.info('📋 Flow category selected', { category: responseData.selected_category, selectedId, isOrderFlow });
                    } else {
                      // Generic flow response — pass as text
                      messageType = 'flow_reply';
                      text = JSON.stringify(responseData);
                    }
                  } catch (parseErr) {
                    logger.error('Flow response parse error', { error: parseErr.message, raw: nfmReply.response_json });
                    messageType = 'text';
                    text = nfmReply.body || 'Flow response';
                  }
                }
              } else if (message.type === 'order') {
                // WhatsApp Catalog cart submission — user tapped "Send" on their cart
                messageType = 'order';
                text = message.order || {};
                logger.info('📦 Catalog order received', {
                  phone,
                  catalogId: message.order?.catalog_id,
                  itemCount: message.order?.product_items?.length || 0
                });
              } else if (message.type === 'location') {
                messageType = 'location';
                text = {
                  latitude: message.location?.latitude,
                  longitude: message.location?.longitude,
                  name: message.location?.name || '',
                  address: message.location?.address || ''
                };
              } else if (message.type === 'audio') {
                // Handle voice message
                messageType = 'voice';
                const audioId = message.audio?.id;
                logger.info('🎤 Voice message received, audio ID:', audioId);
                
                if (audioId) {
                  try {
                    // Download and transcribe the audio
                    const audioBuffer = await metaCloud.downloadMedia(audioId);
                    let transcription = await groqAi.transcribeAudio(audioBuffer, message.audio?.mime_type || 'audio/ogg');
                    
                    if (transcription && transcription.trim()) {
                      // Normalize transcription to fix common voice recognition mistakes
                      const rawTranscription = transcription.trim();
                      transcription = groqAi.normalizeTranscription(rawTranscription);
                      
                      text = transcription;
                      messageType = 'text'; // Treat as text after transcription
                      logger.info('🎤 Voice transcribed:', rawTranscription);
                      logger.info('🎤 Normalized to:', text);
                    } else {
                      // Transcription failed, send error message
                      const voiceErrMsg1 = "🎤 Sorry, I couldn't understand your voice message. Please try again or type your message.";
                      const voiceErrBtns1 = [
                          { id: 'home', text: 'Main Menu' },
                          { id: 'help', text: 'Help' }
                      ];
                      const voiceErrImg1 = await chatbotImagesService.getImageUrl('voice_error');
                      if (voiceErrImg1) {
                        await whatsapp.sendImageWithButtons(phone, voiceErrImg1, voiceErrMsg1, voiceErrBtns1);
                      } else {
                        await whatsapp.sendButtons(phone, voiceErrMsg1, voiceErrBtns1);
                      }
                      continue;
                    }
                  } catch (err) {
                    logger.error('❌ Voice processing error:', err.message);
                    const voiceErrMsg2 = "🎤 Sorry, I couldn't process your voice message. Please type your message instead.";
                    const voiceErrBtns2 = [
                        { id: 'home', text: 'Main Menu' },
                        { id: 'help', text: 'Help' }
                    ];
                    const voiceErrImg2 = await chatbotImagesService.getImageUrl('voice_error');
                    if (voiceErrImg2) {
                      await whatsapp.sendImageWithButtons(phone, voiceErrImg2, voiceErrMsg2, voiceErrBtns2);
                    } else {
                      await whatsapp.sendButtons(phone, voiceErrMsg2, voiceErrBtns2);
                    }
                    continue;
                  }
                }
              }

              const hasContent = text || selectedId || messageType === 'location' || messageType === 'order';
              if (phone && hasContent) {
                const messageId = message.id || null;
                // Deduplicate using InboundMessage unique index
                if (messageId) {
                  try {
                    const InboundMessage = require('../models/InboundMessage');
                    const inbound = new InboundMessage({
                      messageId,
                      phone,
                      messageType,
                      content: typeof text === 'string' ? text.substring(0, 500) : JSON.stringify(text).substring(0, 500),
                      status: 'processing',
                      receivedAt: new Date()
                    });
                    await inbound.save();
                  } catch (dedupErr) {
                    if (dedupErr.code === 11000) {
                      logger.info('Duplicate message skipped', { messageId, phone });
                      continue; // Skip duplicate
                    }
                    // Non-dedup error, log and continue processing
                    logger.warn('InboundMessage save warning', { error: dedupErr.message });
                  }
                }
                // Process message in the background
                chatbot.handleMessage(phone, text, messageType, selectedId, senderName)
                  .catch(err => logger.error('❌ Async Chatbot Error:', err));
              }
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error('❌ Meta webhook async processing error:', error);
  }
});

module.exports = router;
