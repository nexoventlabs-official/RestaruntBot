const express = require('express');
const crypto = require('crypto');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
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
const Customer = require('../models/Customer');
const Offer = require('../models/Offer');
const Order = require('../models/Order');
const User = require('../models/User');
const OutboundMessage = require('../models/OutboundMessage');
const InboundMessage = require('../models/InboundMessage');
const dataEvents = require('../services/eventEmitter');
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
    return logRouteError(res, 'Google Sheets test error', error);
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
    return logRouteError(res, 'Test error', error);
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
    return logRouteError(res, 'Test menu error', error);
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
    return logRouteError(res, 'Simulate error', error);
  }
});

// Debug endpoint to check customer state (admin only, dev only)
router.get('/debug/:phone', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints disabled in production' });
  }
  try {
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

    return logRouteError(res, 'Internal server error', error);
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
    logger.error('META_VERIFY_TOKEN not configured');
    return res.sendStatus(500);
  }

  logger.info('Webhook verification attempt:', { mode, token, expectedToken: verifyToken, challenge: challenge ? 'present' : 'missing' });

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Meta webhook verified');
    res.status(200).send(challenge);
  } else if (!mode && !token) {
    // Simple health check (no verification params)
    res.json({ status: 'Webhook endpoint active', timestamp: new Date().toISOString() });
  } else {
    logger.info('Meta webhook verification failed - token mismatch');
    res.sendStatus(403);
  }
});

// Meta WhatsApp Cloud API webhook endpoint (signature verified, validated, rate limited)
router.post('/meta', webhookRateLimiter, verifyWebhookSignature, validateMetaWebhook, sanitizeWebhookPayload, async (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Webhook POST received');
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
                  dataEvents.emit('dataUpdate', { type: 'offers', templateUpdate: { offerId: updated._id, status: mappedStatus } });

                  // Send push notification to all admin users
                  try {
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

                    logger.info('WhatsApp payment status received', {
                      referenceId,
                      paymentStatus,
                      paymentMethod,
                      amount,
                      recipientPhone
                    });

                    try {
                      const order = await Order.findOne({ orderId: referenceId });

                      if (order) {
                        if (paymentStatus === 'success' || paymentStatus === 'completed') {
                          const previousPaymentStatus = order.paymentStatus;
                          order.paymentStatus = 'paid';
                          logger.info('Payment status changed', { orderId: referenceId, from: previousPaymentStatus, to: 'paid', via: 'whatsapp-upi' });
                          order.paymentMethod = 'whatsapp_upi';
                          const txResult = transitionStatus(order, 'confirmed', `Payment received via WhatsApp UPI${paymentMethod ? ' (' + paymentMethod + ')' : ''}`);
                          if (!txResult.success) {
                            logger.warn('Status transition blocked for WhatsApp payment', { orderId: referenceId, reason: txResult.reason });
                            continue;
                          }
                          await order.save();

                          // Send order_status confirmation to customer
                          await metaCloud.sendOrderStatusUpdate(
                            recipientPhone,
                            referenceId,
                            'completed',
                            `✅ Payment of ₹${order.totalAmount} received!\nOrder #${referenceId} is confirmed.\nWe're preparing your order! 🍳`
                          );

                          // Send push notification to admin
                          try {
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
                          logger.error('Admin push error on payment', { error: pushErr.message, orderId: referenceId });
                          }

                          // Sync to Google Sheets
                          googleSheets.addOrder(order).catch(err => logger.error('GSheets sync error', { error: err.message }));
                          googleSheets.syncTodayDailyReport().catch(err => logger.error('Daily report sync error', { error: err.message }));

                          // Emit real-time events
                          dataEvents.emit('orders');
                          dataEvents.emit('dashboard');

                          logger.info('WhatsApp payment confirmed, order updated', { orderId: referenceId });
                        } else if (paymentStatus === 'failed' || paymentStatus === 'canceled') {
                          const newPayStatus = paymentStatus === 'canceled' ? 'cancelled' : 'failed';
                          logger.info('Payment status changed', { orderId: referenceId, from: order.paymentStatus, to: newPayStatus, via: 'whatsapp-upi' });
                          order.paymentStatus = newPayStatus;
                          order.trackingUpdates.push({
                            status: 'payment_failed',
                            message: `Payment ${paymentStatus} via WhatsApp UPI`,
                            timestamp: new Date()
                          });
                          await order.save();

                          // Notify customer
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

                          logger.warn('WhatsApp payment failed/canceled', { orderId: referenceId, paymentStatus });
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
                    logger.info('state_transition', { entity: 'outbound_message', from: 'sent', to: statusValue, metaMessageId, trigger: 'webhook' });
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
              let isVoiceMessage = false;

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

                    logger.info('Flow response received', {
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
                      logger.info('Flow category selected', { category: responseData.selected_category, selectedId, isOrderFlow });
                    }
                    // Order Confirmation flow — user chose delivery/pickup
                    else if (responseData.flow_token?.startsWith('order_confirm_') && responseData.selected_service_type) {
                      const serviceType = responseData.selected_service_type; // 'delivery' or 'pickup'
                      // Route as button press matching existing service_delivery / service_pickup handlers
                      selectedId = serviceType === 'pickup' ? 'service_pickup' : 'service_delivery';
                      text = selectedId;
                      messageType = 'button';
                      logger.info('Order confirm flow: service type selected', { phone, serviceType, selectedId });
                    }
                    // Payment Method flow — user chose a payment method
                    else if (responseData.flow_token?.startsWith('payment_') && responseData.selected_payment) {
                      const parts = responseData.flow_token.replace('payment_', '').split('_');
                      const serviceType = parts.pop(); // 'delivery' or 'pickup'
                      const payment = responseData.selected_payment; // 'cod', 'pay_hotel', 'online'

                      // Map payment selection to existing button IDs
                      if (payment === 'cod') {
                        selectedId = 'pay_cod';
                      } else if (payment === 'pay_hotel') {
                        selectedId = 'pickup_pay_hotel';
                      } else if (payment === 'online') {
                        // Online payment → route to UPI handler (tries WhatsApp native pay first, then Razorpay)
                        selectedId = serviceType === 'pickup' ? 'pickup_pay_upi' : 'pay_upi';
                      }
                      text = selectedId;
                      messageType = 'button';
                      logger.info('Payment flow: method selected', { phone, payment, serviceType, selectedId });
                    }
                    // Welcome service selection flow
                    else if (responseData.flow_token?.startsWith('welcome_service_') && responseData.selected_service) {
                      const service = responseData.selected_service;
                      
                      // For Order Food - check if category was selected (3-screen flow) or just food type (2-screen)
                      if (service === 'order_food') {
                        const phone = responseData.flow_token.replace('welcome_service_', '');
                        if (responseData.selected_category) {
                          // 3-screen flow: food type + category selected → route to catalog for this item
                          const foodPref = responseData.selected_food_type ? responseData.selected_food_type.replace('food_', '') : 'all';
                          selectedId = `flow_order_${foodPref}_${responseData.selected_category}`;
                          text = `flow_order_${foodPref}_${responseData.selected_category}`;
                          messageType = 'button';
                          logger.info('Flow: Order Food with category selected', { phone, service, foodType: foodPref, category: responseData.selected_category });
                        } else if (responseData.selected_food_type) {
                          // 2-screen flow: food type already chosen (e.g., food_veg, food_nonveg, food_egg)
                          selectedId = responseData.selected_food_type;
                          text = responseData.selected_food_type;
                          messageType = 'button';
                          logger.info('Flow: Order Food with food type selected', { phone, service, foodType: responseData.selected_food_type });
                        } else if (responseData.no_items === 'true') {
                          // No menu items for this food type
                          messageType = 'flow_trigger';
                          text = JSON.stringify({ type: 'no_menu_items', phone, service });
                          logger.info('Flow: Order Food - no items found', { phone, foodType: responseData.selected_food_type });
                        } else {
                          messageType = 'flow_trigger';
                          text = JSON.stringify({ type: 'food_type_selection', phone, service });
                          logger.info('Flow: Order Food selected, triggering food type selection', { phone, service });
                        }
                      }
                      // For My Orders — endpoint flow handles screen navigation;
                      // webhook receives completed flow with selected_order or no_orders flag
                      else if (service === 'my_orders') {
                        const phone = responseData.flow_token.replace('welcome_service_', '');
                        if (responseData.order_viewed === 'true' && responseData.selected_order) {
                          // User viewed order details on ORDER_DETAILS screen then closed
                          selectedId = `view_order_${responseData.selected_order}`;
                          text = `view_order_${responseData.selected_order}`;
                          messageType = 'button';
                          logger.info('Flow: My Orders - order details viewed', { phone, orderId: responseData.selected_order });
                        } else if (responseData.selected_order) {
                          // User selected an order from MY_ORDERS screen
                          selectedId = `view_order_${responseData.selected_order}`;
                          text = `view_order_${responseData.selected_order}`;
                          messageType = 'button';
                          logger.info('Flow: My Orders - order selected', { phone, orderId: responseData.selected_order });
                        } else if (responseData.no_orders === 'true') {
                          // No orders found — endpoint closed flow, trigger no-orders message
                          messageType = 'flow_trigger';
                          text = JSON.stringify({ type: 'my_orders_empty', phone, service });
                          logger.info('Flow: My Orders - no orders found', { phone });
                        } else {
                          // Fallback
                          messageType = 'flow_trigger';
                          text = JSON.stringify({ type: 'my_orders_list', phone, service });
                          logger.info('Flow: My Orders selected, triggering orders list', { phone, service });
                        }
                      }
                      // For View Offers — endpoint flow shows eligible offers;
                      // webhook receives completed flow with selected_offer or no_offers flag
                      else if (service === 'view_offers') {
                        const phone = responseData.flow_token.replace('welcome_service_', '');
                        if (responseData.selected_offer) {
                          // User selected an offer from VIEW_OFFERS screen
                          selectedId = `view_offer_${responseData.selected_offer}`;
                          text = `view_offer_${responseData.selected_offer}`;
                          messageType = 'button';
                          logger.info('Flow: View Offers - offer selected', { phone, offerId: responseData.selected_offer });
                        } else if (responseData.no_offers === 'true') {
                          // No eligible offers — endpoint closed flow
                          messageType = 'flow_trigger';
                          text = JSON.stringify({ type: 'no_offers', phone, service });
                          logger.info('Flow: View Offers - no offers found', { phone });
                        } else {
                          // Fallback — treat as regular view_offers button
                          selectedId = 'view_offers';
                          text = 'view_offers';
                          messageType = 'button';
                          logger.info('Flow: View Offers selected', { phone });
                        }
                      }
                      // For Account Details — flow shows editable form, completes with customer data
                      else if (service === 'account_details') {
                        const phone = responseData.flow_token.replace('welcome_service_', '');
                        if (responseData.customer_name) {
                          // User filled/edited account details and tapped Save
                          messageType = 'flow_reply';
                          text = JSON.stringify({ type: 'account_form', ...responseData, flow_token: `account_form_${phone}` });
                          logger.info('Flow: Account Details saved from welcome flow', { phone, name: responseData.customer_name });
                        } else {
                          // Fallback
                          selectedId = 'account_details';
                          text = 'account_details';
                          messageType = 'button';
                          logger.info('Flow: Account Details selected', { phone });
                        }
                      }
                      // For Help & Support — "Call Us" button tapped, send CTA phone message
                      else if (service === 'help_call') {
                        const userPhone = responseData.flow_token.replace('welcome_service_', '');
                        try {
                          await whatsapp.sendCtaPhone(
                            userPhone,
                            '📞 *Help & Support*\n\nTap the button below to call our support team directly. We\'re happy to help!',
                            'Call +91 94402 03095',
                            '+919440203095',
                            'Available during business hours'
                          );
                          logger.info('Flow: Help Call - sent CTA phone message', { phone: userPhone });
                        } catch (ctaErr) {
                          logger.error('Flow: Help Call - failed to send CTA phone', { error: ctaErr.message, phone: userPhone });
                          // Fallback: send plain text with phone number
                          await whatsapp.sendMessage(userPhone, '📞 *Help & Support*\n\nCall us at: +91 94402 03095\n\nOur support team is happy to help!');
                        }
                        // Skip further processing — we already sent the response
                        return res.sendStatus(200);
                      }
                      // For My Cart — handle cart actions or empty cart
                      else if (service === 'my_cart') {
                        const userPhone = responseData.flow_token.replace('welcome_service_', '');
                        
                        if (responseData.cart_empty === 'true') {
                          // Cart is empty — send message
                          await whatsapp.sendMessage(userPhone, '🛒 *Your cart is empty!*\n\nBrowse our menu to add items.\nType "menu" or tap Order Food to get started.');
                          return res.sendStatus(200);
                        }
                        
                        if (responseData.selected_cart_action === 'place_order') {
                          // Place Order → trigger service type selection (same as order_food checkout)
                          selectedId = 'cart_place_order';
                          text = 'cart_place_order';
                          messageType = 'button';
                          logger.info('Flow: My Cart - place order', { phone: userPhone });
                        } else if (responseData.selected_cart_action === 'add_more') {
                          // Add More → trigger order food flow
                          selectedId = 'order_food';
                          text = 'order_food';
                          messageType = 'button';
                          logger.info('Flow: My Cart - add more items', { phone: userPhone });
                        } else if (responseData.selected_cart_action === 'clear_cart') {
                          // Clear Cart → clear customer cart and confirm
                          try {
                            const Customer = require('../models/Customer');
                            await Customer.findOneAndUpdate({ phone: userPhone }, { $set: { cart: [] } });
                            await whatsapp.sendMessage(userPhone, '🗑️ *Cart Cleared!*\n\nAll items have been removed from your cart.\nType "menu" to start a new order.');
                          } catch (clearErr) {
                            logger.error('Flow: My Cart - clear cart failed', { error: clearErr.message, phone: userPhone });
                            await whatsapp.sendMessage(userPhone, '❌ Failed to clear cart. Please try again.');
                          }
                          return res.sendStatus(200);
                        } else {
                          // Fallback
                          selectedId = 'my_cart';
                          text = 'my_cart';
                          messageType = 'button';
                        }
                      }
                      // For other services - handle directly
                      else {
                        selectedId = service;
                        text = service;
                        messageType = 'button';
                        logger.info('Flow welcome service selected', { service, selectedId });
                      }
                    }
                    // Account Details form flow response
                    else if (responseData.flow_token?.startsWith('account_form_') && responseData.customer_name) {
                      messageType = 'flow_reply';
                      text = JSON.stringify({ type: 'account_form', ...responseData });
                      logger.info('Account form submitted', { phone, name: responseData.customer_name });
                    }
                    // Delivery Address form flow response
                    else if (responseData.flow_token?.startsWith('address_form_') && responseData.address_line) {
                      messageType = 'flow_reply';
                      text = JSON.stringify({ type: 'address_form', ...responseData });
                      logger.info('Address form submitted', { phone, address: responseData.address_line, pincode: responseData.pincode });
                    }
                    // Delivery Address flow — user chose "Share Location"
                    else if (responseData.flow_token?.startsWith('address_form_') && responseData.method === 'share_location') {
                      messageType = 'flow_reply';
                      text = JSON.stringify({ type: 'address_share_location', ...responseData });
                      logger.info('Address flow: user chose share location', { phone });
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
                logger.info('Catalog order received', {
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
                logger.info('Voice message received', { phone, audioId });
                
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
                      isVoiceMessage = true; // Flag for chatbot to use voice_error image on failures
                      logger.info('Voice transcribed', { rawTranscription, phone });
                      logger.info('Voice normalized', { text, phone });
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
                    logger.error('Voice processing error', { error: err.message, phone });
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
                } else {
                  // No audio ID - send voice error image
                  logger.warn('Voice message received without audio ID', { phone });
                  const voiceErrMsg3 = "🎤 Sorry, I couldn't process your voice message. Please try again or type your message.";
                  const voiceErrBtns3 = [
                      { id: 'home', text: 'Main Menu' },
                      { id: 'help', text: 'Help' }
                  ];
                  const voiceErrImg3 = await chatbotImagesService.getImageUrl('voice_error');
                  if (voiceErrImg3) {
                    await whatsapp.sendImageWithButtons(phone, voiceErrImg3, voiceErrMsg3, voiceErrBtns3);
                  } else {
                    await whatsapp.sendButtons(phone, voiceErrMsg3, voiceErrBtns3);
                  }
                  continue;
                }
              }

              const hasContent = text || selectedId || messageType === 'location' || messageType === 'order';
              if (phone && hasContent) {
                // Generate synthetic messageId if Meta didn't provide one
                let messageId = message.id || null;
                if (!messageId) {
                  const contentStr = typeof text === 'string' ? text : JSON.stringify(text || '');
                  messageId = 'synthetic_' + crypto.createHash('sha256')
                    .update(phone + messageType + contentStr + Math.floor(Date.now() / 1000))
                    .digest('hex').substring(0, 24);
                  logger.warn('Message missing id, generated synthetic messageId', { messageId, phone });
                }
                // Deduplicate using InboundMessage unique index
                let inboundRecord = null;
                try {
                  inboundRecord = new InboundMessage({
                    messageId,
                    phone,
                    messageType,
                    content: typeof text === 'string' ? text.substring(0, 500) : JSON.stringify(text).substring(0, 500),
                    status: 'processing',
                    receivedAt: new Date()
                  });
                  await inboundRecord.save();
                } catch (dedupErr) {
                  if (dedupErr.code === 11000) {
                    logger.info('Duplicate message skipped', { messageId, phone });
                    continue; // Skip duplicate
                  }
                  // Non-dedup error, log and continue processing
                  logger.warn('InboundMessage save warning', { error: dedupErr.message });
                  inboundRecord = null;
                }
                // Process message and update status
                const handleOpts = isVoiceMessage ? { isVoiceMessage: true } : {};
                chatbot.handleMessage(phone, text, messageType, selectedId, senderName, handleOpts)
                  .then(async () => {
                    if (inboundRecord) {
                      try {
                        await InboundMessage.updateOne(
                          { _id: inboundRecord._id },
                          { $set: { status: 'processed', processedAt: new Date() } }
                        );
                      } catch (updateErr) {
                        logger.warn('Failed to mark message as processed', { messageId, error: updateErr.message });
                      }
                    }
                  })
                  .catch(async (err) => {
                    logger.error('Async Chatbot Error', { error: err.message, stack: err.stack, phone });
                    if (inboundRecord) {
                      try {
                        await InboundMessage.updateOne(
                          { _id: inboundRecord._id },
                          { $set: {
                            status: 'failed',
                            error: {
                              message: err.message,
                              code: err.code || 'CHATBOT_ERROR',
                              isRetryable: true
                            }
                          }}
                        );
                      } catch (updateErr) {
                        logger.warn('Failed to mark message as failed', { messageId, error: updateErr.message });
                      }
                    }
                  });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error('Meta webhook async processing error', { error: error.message, stack: error.stack });
  }
});

module.exports = router;
