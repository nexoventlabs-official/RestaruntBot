/**
 * WhatsApp Flow Endpoint — handles INIT, data_exchange, and BACK actions
 * for the Welcome Service Selection flow (Endpoint / Data API mode).
 *
 * When a user opens the flow, WhatsApp sends a POST request here.
 * Based on the action and data, we return the appropriate screen data.
 *
 * Flow screens:
 *   SERVICE_SELECT   — Banner + service dropdown (always shown first)
 *   FOOD_TYPE_SELECT — Food type radio buttons (shown only for "Order Food")
 *   MY_ORDERS        — Recent orders with status icons (shown for "My Orders")
 *
 * For non-food services (except My Orders), the flow completes directly from SERVICE_SELECT.
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../services/logger');
const catalogService = require('../services/catalogService');
const chatbotImagesService = require('../services/chatbotImages');
const Order = require('../models/Order');
const Offer = require('../models/Offer');
const MenuItem = require('../models/MenuItem');
const Customer = require('../models/Customer');

const router = express.Router();

// Encryption config — WhatsApp Flows Endpoint requires request/response encryption
// For endpoint mode, Meta sends encrypted payloads and expects encrypted responses.
// The private key must match the public key registered with Meta for this flow.
const FLOW_PRIVATE_KEY_RAW = process.env.FLOW_PRIVATE_KEY || '';
// Handle both formats: literal \n characters (from env dashboards) and actual newlines (from dotenv)
const FLOW_PRIVATE_KEY = FLOW_PRIVATE_KEY_RAW.split('\\n').join('\n');
const FLOW_PRIVATE_KEY_PASSPHRASE = process.env.FLOW_PRIVATE_KEY_PASSPHRASE || '';

/**
 * Decrypt incoming WhatsApp Flow request
 */
function decryptRequest(body) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  if (!FLOW_PRIVATE_KEY) {
    // No encryption configured — try to parse as plain JSON (development/testing)
    logger.warn('[FlowEndpoint] No FLOW_PRIVATE_KEY configured, attempting plain JSON parse');
    return { decryptedBody: body, aesKeyBuffer: null, initialVectorBuffer: null };
  }

  try {
    const keyOptions = { key: FLOW_PRIVATE_KEY, format: 'pem' };
    if (FLOW_PRIVATE_KEY_PASSPHRASE) {
      keyOptions.passphrase = FLOW_PRIVATE_KEY_PASSPHRASE;
    }
    const privateKey = crypto.createPrivateKey(keyOptions);

    // Decrypt AES key using RSA private key
    const aesKeyBuffer = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(encrypted_aes_key, 'base64')
    );

    // Decrypt flow data using AES key
    const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
    const encryptedFlowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');

    // Get auth tag (last 16 bytes) and ciphertext
    const TAG_LENGTH = 16;
    const authTag = encryptedFlowDataBuffer.slice(-TAG_LENGTH);
    const ciphertext = encryptedFlowDataBuffer.slice(0, -TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, initialVectorBuffer);
    decipher.setAuthTag(authTag);

    const decryptedData = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const decryptedBody = JSON.parse(decryptedData.toString('utf-8'));

    return { decryptedBody, aesKeyBuffer, initialVectorBuffer };
  } catch (err) {
    logger.error('[FlowEndpoint] Decryption failed', { error: err.message });
    throw new Error('Decryption failed');
  }
}

/**
 * Encrypt outgoing response
 */
function encryptResponse(responseObj, aesKeyBuffer, initialVectorBuffer) {
  if (!aesKeyBuffer || !initialVectorBuffer) {
    // No encryption — return plain JSON (development)
    return responseObj;
  }

  try {
    // Flip the IV for response
    const flippedIv = Buffer.alloc(initialVectorBuffer.length);
    for (let i = 0; i < initialVectorBuffer.length; i++) {
      flippedIv[i] = ~initialVectorBuffer[i] & 0xff;
    }

    const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIv);
    const responseStr = JSON.stringify(responseObj);

    const encrypted = Buffer.concat([
      cipher.update(responseStr, 'utf-8'),
      cipher.final(),
      cipher.getAuthTag()
    ]);

    return encrypted.toString('base64');
  } catch (err) {
    logger.error('[FlowEndpoint] Encryption failed', { error: err.message });
    throw new Error('Encryption failed');
  }
}

// ─── Cache for base64 images (avoid re-downloading on every request) ───
let imageCache = { services: null, foodTypes: null, statusImages: null, deliveryOptionImg: null, pickupOptionImg: null, lastFetched: 0 };
const IMAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getFlowImages() {
  const now = Date.now();
  if (imageCache.services && (now - imageCache.lastFetched) < IMAGE_CACHE_TTL) {
    return imageCache;
  }

  logger.info('[FlowEndpoint] Refreshing image cache');

  const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

  // Fetch all image URLs (services + order statuses + service-icons + payment icons).
  // All `_banner` images except the welcome banner have been removed.
  const [
    orderFoodImg, myOrdersImg, viewOffersImg, accountDetailsImg, visitWebsiteImg, helpSupportImg,
    myCartImg, trackOrderImg, cartPlaceOrderImg, cartAddMoreImg, cartClearImg,
    pendingImg, confirmedImg, preparingImg, readyImg, outForDeliveryImg, deliveredImg, cancelledImg,
    deliveryOptionImgUrl,
    pickupOptionImgUrl,
    payCodImg,
    payHotelImg,
    payGpayImg,
    payPhonepeImg,
    payPaytmImg
  ] = await Promise.all([
    chatbotImagesService.getImageUrl('flow_order_food'),
    chatbotImagesService.getImageUrl('flow_my_orders'),
    chatbotImagesService.getImageUrl('flow_view_offers'),
    chatbotImagesService.getImageUrl('flow_account_details'),
    chatbotImagesService.getImageUrl('flow_visit_website'),
    chatbotImagesService.getImageUrl('flow_help_support'),
    chatbotImagesService.getImageUrl('flow_my_cart'),
    chatbotImagesService.getImageUrl('flow_track_order'),
    chatbotImagesService.getImageUrl('flow_cart_place_order'),
    chatbotImagesService.getImageUrl('flow_cart_add_more'),
    chatbotImagesService.getImageUrl('flow_cart_clear'),
    chatbotImagesService.getImageUrl('flow_status_pending'),
    chatbotImagesService.getImageUrl('flow_status_confirmed'),
    chatbotImagesService.getImageUrl('flow_status_preparing'),
    chatbotImagesService.getImageUrl('flow_status_ready'),
    chatbotImagesService.getImageUrl('flow_status_out_for_delivery'),
    chatbotImagesService.getImageUrl('flow_status_delivered'),
    chatbotImagesService.getImageUrl('flow_status_cancelled'),
    chatbotImagesService.getImageUrl('flow_delivery_option'),
    chatbotImagesService.getImageUrl('flow_pickup_option'),
    chatbotImagesService.getImageUrl('flow_pay_cod'),
    chatbotImagesService.getImageUrl('flow_pay_hotel'),
    chatbotImagesService.getImageUrl('flow_pay_gpay'),
    chatbotImagesService.getImageUrl('flow_pay_phonepe'),
    chatbotImagesService.getImageUrl('flow_pay_paytm')
  ]);

  // Convert to base64
  const [
    orderFoodB64, myOrdersB64, viewOffersB64, accountDetailsB64, visitWebsiteB64, helpSupportB64,
    myCartB64, trackOrderB64, cartPlaceOrderB64, cartAddMoreB64, cartClearB64,
    pendingB64, confirmedB64, preparingB64, readyB64, outForDeliveryB64, deliveredB64, cancelledB64,
    deliveryOptionB64,
    pickupOptionB64,
    payCodB64,
    payHotelB64,
    payGpayB64,
    payPhonepeB64,
    payPaytmB64
  ] = await Promise.all([
    toBase64(orderFoodImg), toBase64(myOrdersImg), toBase64(viewOffersImg),
    toBase64(accountDetailsImg), toBase64(visitWebsiteImg),
    toBase64(helpSupportImg), toBase64(myCartImg), toBase64(trackOrderImg),
    toBase64(cartPlaceOrderImg), toBase64(cartAddMoreImg), toBase64(cartClearImg),
    toBase64(pendingImg), toBase64(confirmedImg), toBase64(preparingImg),
    toBase64(readyImg), toBase64(outForDeliveryImg), toBase64(deliveredImg), toBase64(cancelledImg),
    toBase64(deliveryOptionImgUrl),
    toBase64(pickupOptionImgUrl),
    toBase64(payCodImg),
    toBase64(payHotelImg),
    toBase64(payGpayImg),
    toBase64(payPhonepeImg),
    toBase64(payPaytmImg)
  ]);

  const buildItem = (id, title, description, base64Img) => {
    const item = { id, title, description };
    if (base64Img) item.image = base64Img;
    return item;
  };

  imageCache = {
    services: [
      buildItem('order_food', 'Order Food', 'Browse our menu and place an order', orderFoodB64),
      // "Track Order" replaces the old "My Cart" entry — shows live order status with a tracking link.
      buildItem('track_order', 'Track Order', 'See latest status of your active orders', trackOrderB64 || myOrdersB64),
      buildItem('my_orders', 'My Orders', 'View past orders & details', myOrdersB64),
      buildItem('view_offers', 'View Offers', 'See current deals and discounts', viewOffersB64),
      buildItem('account_details', 'Account Details', 'View or update your profile info', accountDetailsB64),
      buildItem('open_website', 'Visit Website', 'View our full website', visitWebsiteB64),
      buildItem('help', 'Help & Support', 'Get assistance with your queries', helpSupportB64)
    ],
    statusImages: {
      pending: pendingB64,
      confirmed: confirmedB64,
      preparing: preparingB64,
      ready: readyB64,
      out_for_delivery: outForDeliveryB64,
      delivered: deliveredB64,
      cancelled: cancelledB64
    },
    deliveryOptionImg: deliveryOptionImgUrl || null,
    pickupOptionImg: pickupOptionImgUrl || null,
    payCodImg: payCodB64 || null,
    payHotelImg: payHotelB64 || null,
    payGpayImg: payGpayB64 || null,
    payPhonepeImg: payPhonepeB64 || null,
    payPaytmImg: payPaytmB64 || null,
    cartPlaceOrderImg: cartPlaceOrderB64 || null,
    cartAddMoreImg: cartAddMoreB64 || null,
    cartClearImg: cartClearB64 || null,
    lastFetched: now
  };

  return imageCache;
}

// ─── Flow Endpoint Handler ───

router.post('/', async (req, res) => {
  try {
    // Step 1: Decrypt the incoming request
    let decryptedBody, aesKeyBuffer, initialVectorBuffer;

    try {
      ({ decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body));
    } catch (decErr) {
      logger.error('[FlowEndpoint] Could not decrypt request', { error: decErr.message });
      return res.status(421).send();
    }

    const { action, screen, data, version, flow_token } = decryptedBody;
    logger.info('[FlowEndpoint] Request', { action, screen, flow_token, version });

    let response;

    // ─── PING health check ───
    if (action === 'ping') {
      response = { data: { status: 'active' } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      if (typeof encrypted === 'string') {
        res.set('Content-Type', 'text/plain');
        return res.send(encrypted);
      }
      return res.json(response);
    }

    // ─── Error notification — acknowledge and move on ───
    if (data?.error) {
      logger.warn('[FlowEndpoint] Error notification from Meta', { error: data.error, error_message: data.error_message });
      response = { data: { acknowledged: true } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      if (typeof encrypted === 'string') {
        res.set('Content-Type', 'text/plain');
        return res.send(encrypted);
      }
      return res.json(response);
    }

    // ─── INIT — first screen data (called when flow opens) ───
    if (action === 'INIT') {
      // Order Confirmation Flow — build ORDER_REVIEW screen from customer cart
      if (flow_token?.startsWith('order_confirm_')) {
        const phone = flow_token.replace('order_confirm_', '');
        try {
          const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
          if (!freshCustomer?.cart?.length) {
            // Empty cart — close flow
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'empty_cart' } } } };
          } else {
            const images = await getFlowImages();
            const toBase64 = (url, opts) => catalogService._imageUrlToRawBase64(url, opts);
            const validItems = freshCustomer.cart.filter(ci => ci.menuItem);
            let total = 0;

            // Build cart items as data-source array with images (like food type icons)
            const cartItems = await Promise.all(validItems.map(async (ci, idx) => {
              const mi = ci.menuItem;
              let displayName = mi.name;
              let effectivePrice = mi.offerPrice || mi.price;
              let unitInfo = `${mi.quantity || 1} ${mi.unit || 'piece'}`;

              // Resolve variant pricing
              if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
                const variant = mi.variants[ci.variantIndex];
                if (ci.quantityIndex != null && variant.quantities?.[ci.quantityIndex]) {
                  const q = variant.quantities[ci.quantityIndex];
                  effectivePrice = (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : q.price;
                  displayName = variant.label;
                  unitInfo = `${q.quantity} ${q.unit}`;
                } else {
                  effectivePrice = (variant.offerPrice && variant.offerPrice < variant.price) ? variant.offerPrice : variant.price;
                  displayName = variant.label;
                  unitInfo = `${variant.quantity || 1} ${variant.unit || mi.unit || 'piece'}`;
                }
              }

              const subtotal = effectivePrice * ci.quantity;
              total += subtotal;

              // Build item entry with image thumbnail
              const entry = {
                id: `item_${idx}`,
                title: `${displayName} (${unitInfo})`,
                description: `${ci.quantity} × ₹${effectivePrice} = ₹${subtotal}`
              };

              // Convert item image to base64 for thumbnail (variant image if available)
              let imgUrl = null;
              if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]?.image) {
                imgUrl = mi.variants[ci.variantIndex].image;
              } else if (mi.image) {
                imgUrl = mi.image;
              }
              if (imgUrl) {
                try {
                  const b64 = await toBase64(imgUrl, { width: 100, height: 100 });
                  if (b64) entry.image = b64;
                } catch (e) { /* skip image */ }
              }

              return entry;
            }));

            response = {
              screen: 'ORDER_REVIEW',
              data: {
                cart_items: cartItems,
                order_total_text: `━━━━━━━━━━━━━━━\n💰 Total: ₹${total}`,
                flow_token
              }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] Order confirm INIT error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'init_error' } } } };
        }
      }
      // Payment Retry Flow — build RETRY_OPTIONS screen for a failed online payment.
      // Token format: payment_retry_{phone}_{orderId}
      // (must be checked BEFORE the generic `payment_` branch below.)
      else if (flow_token?.startsWith('payment_retry_')) {
        const tokenBody = flow_token.replace('payment_retry_', '');
        const lastUnderscore = tokenBody.lastIndexOf('_');
        const phone = tokenBody.substring(0, lastUnderscore);
        const orderIdFromToken = tokenBody.substring(lastUnderscore + 1);

        try {
          const order = await Order.findOne({ orderId: orderIdFromToken }).lean();
          if (!order) {
            logger.warn('[FlowEndpoint] Payment retry INIT — order not found', {
              phone, orderId: orderIdFromToken
            });
            response = {
              screen: 'SUCCESS',
              data: { extension_message_response: { params: { flow_token, error: 'order_not_found' } } }
            };
          } else {
            const images = await getFlowImages();
            const isPickup = order.serviceType === 'pickup';

            const retryOptions = [];
            // Always offer Retry UPI first
            retryOptions.push({
              id: 'retry_upi',
              title: 'Retry UPI',
              description: 'Try paying again via UPI / GPay / PhonePe',
              ...(images.payGpayImg ? { image: images.payGpayImg } : {})
            });
            // Second option depends on service type
            if (isPickup) {
              retryOptions.push({
                id: 'pay_hotel',
                title: 'Pay at Hotel',
                description: 'Pay cash when you collect the order',
                ...(images.payHotelImg ? { image: images.payHotelImg } : {})
              });
            } else {
              retryOptions.push({
                id: 'pay_cod',
                title: 'Pay COD',
                description: 'Pay cash when the order arrives',
                ...(images.payCodImg ? { image: images.payCodImg } : {})
              });
            }

            response = {
              screen: 'RETRY_OPTIONS',
              data: {
                retry_heading: '❌ Payment Failed',
                retry_options: retryOptions,
                order_id: order.orderId,
                flow_token
              }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] Payment retry INIT error', {
            phone, orderId: orderIdFromToken, error: err.message
          });
          response = {
            screen: 'SUCCESS',
            data: { extension_message_response: { params: { flow_token, error: 'payment_retry_init_error' } } }
          };
        }
      }
      // Payment Method Flow — build PAYMENT_SELECT screen
      else if (flow_token?.startsWith('payment_')) {
        // flow_token format: payment_{phone}_{serviceType}
        const parts = flow_token.replace('payment_', '').split('_');
        const serviceType = parts.pop(); // 'delivery' or 'pickup'
        const phone = parts.join('_'); // phone number (for error logging)
        try {
          const images = await getFlowImages();

          // Build payment methods with images based on service type
          const buildPaymentOption = (id, title, description, imgB64) => {
            const opt = { id, title, description };
            if (imgB64) opt.image = imgB64;
            return opt;
          };

          const paymentMethods = [];
          if (serviceType === 'delivery') {
            paymentMethods.push(buildPaymentOption('cod', 'Cash on Delivery', 'Pay when you receive your order', images.payCodImg));
            paymentMethods.push(buildPaymentOption('online', 'Online Payment', 'Pay securely via UPI', images.payGpayImg));
          } else {
            paymentMethods.push(buildPaymentOption('pay_hotel', 'Pay at Hotel', 'Pay when you pick up your order', images.payHotelImg));
            paymentMethods.push(buildPaymentOption('online', 'Online Payment', 'Pay securely via UPI', images.payGpayImg));
          }

          response = {
            screen: 'PAYMENT_SELECT',
            data: {
              payment_methods: paymentMethods,
              flow_token
            }
          };
        } catch (err) {
          logger.error('[FlowEndpoint] Payment flow INIT error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'payment_init_error' } } } };
        }
      }
      // Cart Review Flow — build CART_REVIEW screen from customer cart
      else if (flow_token?.startsWith('cart_review_')) {
        const phone = flow_token.replace('cart_review_', '');
        try {
          const CART_EXPIRY_MS = 30 * 60 * 1000;
          const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
          const now = Date.now();
          const validItems = (freshCustomer?.cart || []).filter(ci => {
            if (!ci.menuItem) return false;
            if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
            return true;
          });

          if (!validItems.length) {
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, cart_empty: 'true' } } } };
          } else {
            const images = await getFlowImages();
            const toBase64 = (url, opts) => catalogService._imageUrlToRawBase64(url, opts);
            let total = 0;

            const cartItems = await Promise.all(validItems.map(async (ci, idx) => {
              const mi = ci.menuItem;
              let displayName = mi.name;
              let effectivePrice = mi.offerPrice || mi.price;
              let unitInfo = `${mi.quantity || 1} ${mi.unit || 'piece'}`;

              if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
                const variant = mi.variants[ci.variantIndex];
                if (ci.quantityIndex != null && variant.quantities?.[ci.quantityIndex]) {
                  const q = variant.quantities[ci.quantityIndex];
                  effectivePrice = (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : q.price;
                  displayName = variant.label;
                  unitInfo = `${q.quantity} ${q.unit}`;
                } else {
                  effectivePrice = (variant.offerPrice && variant.offerPrice < variant.price) ? variant.offerPrice : variant.price;
                  displayName = variant.label;
                  unitInfo = `${variant.quantity || 1} ${variant.unit || mi.unit || 'piece'}`;
                }
              }

              const subtotal = effectivePrice * ci.quantity;
              total += subtotal;

              const entry = {
                id: `item_${idx}`,
                title: `${displayName} (${unitInfo})`,
                description: `${ci.quantity} × ₹${effectivePrice} = ₹${subtotal}`
              };

              // Variant image or item image
              const imgUrl = (ci.variantIndex != null && mi.variants?.[ci.variantIndex]?.image) || mi.image;
              if (imgUrl) {
                try {
                  const b64 = await toBase64(imgUrl, { width: 100, height: 100 });
                  if (b64) entry.image = b64;
                } catch (e) { /* skip */ }
              }

              return entry;
            }));

            // Calculate earliest expiry
            const earliestAdded = Math.min(...validItems.map(ci => new Date(ci.addedAt).getTime()));
            const expiresIn = Math.max(0, Math.round((earliestAdded + CART_EXPIRY_MS - now) / 60000));

            response = {
              screen: 'CART_REVIEW',
              data: {
                cart_items: cartItems,
                cart_summary: `━━━━━━━━━━━━━━━\n💰 Total: ₹${total}\n⏳ Cart expires in ${expiresIn} min`,
                flow_token
              }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] Cart review INIT error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'cart_init_error' } } } };
        }
      }
      // Order Actions Flow — opens to ORDER_DETAILS (item list + totals).
      // The user can tap the "Help" footer button to navigate to ORDER_ACTIONS
      // where the dynamic actions (Track / Cancel / Order Food / Main Menu)
      // are shown. Track Order completes the flow → webhook sends the
      // status-aware tracking card via sendOrderTrackMessage.
      else if (flow_token?.startsWith('order_actions_')) {
        // flow_token format: order_actions_{phone}_{orderId}
        const tokenParts = flow_token.replace('order_actions_', '');
        const lastUnderscore = tokenParts.lastIndexOf('_');
        const orderId = tokenParts.substring(lastUnderscore + 1);
        try {
          const order = await Order.findOne({ orderId }).lean();
          if (!order) {
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'order_not_found' } } } };
          } else {

            // Build per-item rows with variant/parent images
            const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });
            const orderItems = await Promise.all((order.items || []).map(async (item, idx) => {
              const lineTotal = (item.price || 0) * (item.quantity || 0);
              const titleParts = [item.name];
              if (item.unitQty && item.unit) titleParts.push(`(${item.unitQty} ${item.unit})`);
              const entry = {
                id: `item_${idx}`,
                title: `${titleParts.join(' ')} × ${item.quantity || 0}`.substring(0, 80),
                description: `₹${item.price} each • ₹${lineTotal}`
              };
              if (item.image) {
                try {
                  const b64 = await toBase64Thumb(item.image);
                  if (b64) entry.image = b64;
                } catch { /* ignore image errors — still render text */ }
              }
              return entry;
            }));

            // Build totals breakdown — always show delivery line (₹0 if none)
            const itemsTotal = (order.items || []).reduce((s, it) => s + ((it.price || 0) * (it.quantity || 0)), 0);
            const deliveryCharge = Number(order.deliveryCharge || 0);
            const grandTotal = order.totalAmount || (itemsTotal + deliveryCharge);
            const totalsLines = [
              `Subtotal: ₹${itemsTotal}`,
              `Delivery: ₹${deliveryCharge}`,
              `*Grand Total: ₹${grandTotal}*`
            ];

            // Header lines
            const serviceLabel = order.serviceType === 'pickup' ? 'Self-Pickup' : 'Delivery';
            const paymentLabel = order.paymentMethod === 'cod'
              ? (order.serviceType === 'pickup' ? 'Pay at Hotel' : 'Cash on Delivery')
              : (order.paymentMethod || 'Online');

            response = {
              screen: 'ORDER_DETAILS',
              data: {
                order_heading: `📦 Order #${orderId}`,
                order_meta: `🏪 ${serviceLabel} • 💳 ${paymentLabel}`,
                order_items: orderItems.length > 0
                  ? orderItems
                  : [{ id: 'none', title: 'No items', description: '' }],
                totals_text: totalsLines.join('\n'),
                flow_token
              }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] Order actions INIT error', { orderId, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'order_actions_init_error' } } } };
        }
      }
      // Reorder Flow — show menu categories with images (after payment timeout)
      else if (flow_token?.startsWith('reorder_')) {
        const phone = flow_token.replace('reorder_', '');
        try {
          const images = await getFlowImages();
          const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });
          const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
            .select('name image variants price offerPrice')
            .lean();

          const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
            let desc;
            if (item.variants && item.variants.length > 0) {
              desc = `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''} available`;
            } else {
              desc = `₹${item.offerPrice || item.price}`;
            }
            const catItem = {
              id: item._id.toString(),
              title: item.name.substring(0, 30),
              description: desc
            };
            if (item.image) {
              const b64 = await toBase64Thumb(item.image);
              if (b64) catItem.image = b64;
            }
            return catItem;
          }));

          if (categoryItems.length > 0) {
            response = {
              screen: 'CATEGORY_SELECT',
              data: {
                categories: categoryItems,
                flow_token
              }
            };
          } else {
            response = {
              screen: 'SUCCESS',
              data: { extension_message_response: { params: { flow_token, no_items: 'true' } } }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] Reorder INIT error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, error: 'reorder_init_error' } } } };
        }
      }
      // Welcome Services Flow — default INIT
      else {
        const images = await getFlowImages();

        response = {
          screen: 'SERVICE_SELECT',
          data: {
            services: images.services,
            flow_token: flow_token || 'welcome_service'
          }
        };
      }
    }

    // ─── data_exchange — user tapped Confirm on Screen 1 ───
    else if (action === 'data_exchange') {

      // Screen 1: User selected a service and tapped Confirm
      if (screen === 'SERVICE_SELECT') {
        const selectedService = data?.selected_service;
        const token = data?.flow_token || flow_token || 'welcome_service';

        if (selectedService === 'order_food') {
          // Order Food → directly show menu categories (all items)
          const images = await getFlowImages();
          try {
            const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image foodType variants price offerPrice')
              .lean();

            if (allItems.length > 0) {
              const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });
              const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
                let desc;
                if (item.variants && item.variants.length > 0) {
                  const vCount = item.variants.length;
                  desc = `${vCount} variant${vCount > 1 ? 's' : ''} available`;
                } else {
                  desc = `₹${item.offerPrice || item.price}`;
                }
                const catItem = {
                  id: item._id.toString(),
                  title: item.name.substring(0, 30),
                  description: desc
                };
                if (item.image) {
                  const b64 = await toBase64Thumb(item.image);
                  if (b64) catItem.image = b64;
                }
                return catItem;
              }));

              response = {
                screen: 'MENU_CATEGORIES',
                data: {
                  categories: categoryItems,
                  selected_service: selectedService,
                  flow_token: token
                }
              };
            } else {
              response = {
                screen: 'SUCCESS',
                data: {
                  extension_message_response: {
                    params: {
                      flow_token: token,
                      selected_service: 'order_food',
                      no_items: 'true'
                    }
                  }
                }
              };
            }
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch menu items', { error: dbErr.message });
            response = {
              screen: 'SUCCESS',
              data: { extension_message_response: { params: { flow_token: token, selected_service: 'order_food' } } }
            };
          }
        } else if (selectedService === 'my_orders') {
          // My Orders → fetch recent orders and show MY_ORDERS screen
          const images = await getFlowImages();
          const phone = token.replace('welcome_service_', '');

          // Status display labels
          const STATUS_LABELS = {
            pending: 'Pending',
            confirmed: 'Confirmed',
            preparing: 'Preparing',
            ready: 'Ready',
            out_for_delivery: 'Out for Delivery',
            delivered: 'Delivered',
            cancelled: 'Cancelled'
          };

          try {
            const recentOrders = await Order.find({ 'customer.phone': phone })
              .sort({ createdAt: -1 })
              .limit(10)
              .select('orderId status items totalAmount createdAt serviceType')
              .lean();

            if (recentOrders.length > 0) {
              const orderItems = recentOrders.map(order => {
                const itemCount = order.items ? order.items.length : 0;
                const date = new Date(order.createdAt);
                const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const statusLabel = STATUS_LABELS[order.status] || order.status;

                const item = {
                  id: order.orderId,
                  title: `#${order.orderId} - ₹${order.totalAmount}`,
                  description: `${statusLabel} • ${itemCount} item${itemCount !== 1 ? 's' : ''} • ${dateStr}`
                };

                // Attach status-based image if available
                const statusImg = images.statusImages?.[order.status];
                if (statusImg) item.image = statusImg;

                return item;
              });

              response = {
                screen: 'MY_ORDERS',
                data: {
                  orders: orderItems,
                  flow_token: token
                }
              };
            } else {
              // No orders found → close flow, webhook will send a text message
              response = {
                screen: 'SUCCESS',
                data: {
                  extension_message_response: {
                    params: {
                      flow_token: token,
                      selected_service: 'my_orders',
                      no_orders: 'true'
                    }
                  }
                }
              };
            }
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch orders', { phone, error: dbErr.message });
            // On DB error, close flow gracefully
            response = {
              screen: 'SUCCESS',
              data: {
                extension_message_response: {
                  params: {
                    flow_token: token,
                    selected_service: 'my_orders',
                    no_orders: 'true'
                  }
                }
              }
            };
          }
        } else if (selectedService === 'view_offers') {
          // View Offers → fetch eligible offers for this phone
          const phone = token.replace('welcome_service_', '');
          const normalizedPhone = phone.replace(/[^0-9]/g, '');

          try {
            const now = new Date();
            const activeOffers = await Offer.find({
              isActive: true,
              $or: [{ validUntil: { $gte: now } }, { validUntil: null }]
            }).select('_id title description code discountType discountValue imageWhatsApp image targetType targetedCustomers').lean();

            // Filter offers eligible for this phone
            const eligibleOffers = activeOffers.filter(offer => {
              if (offer.targetType === 'all') return true;
              if (!offer.targetedCustomers?.length) return false;
              return offer.targetedCustomers.some(tp => {
                const nt = tp.replace(/[^0-9]/g, '');
                return nt.includes(normalizedPhone) || normalizedPhone.includes(nt);
              });
            });

            if (eligibleOffers.length > 0) {
              const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

              const offerItems = await Promise.all(eligibleOffers.map(async (offer) => {
                let desc = '';
                if (offer.discountType === 'percentage' && offer.discountValue)
                  desc = `${offer.discountValue}% OFF`;
                else if (offer.discountType === 'fixed' && offer.discountValue)
                  desc = `₹${offer.discountValue} OFF`;
                if (offer.code) desc += desc ? ` • Code: ${offer.code}` : `Code: ${offer.code}`;
                if (offer.description && !desc) desc = offer.description;

                const item = {
                  id: offer._id.toString(),
                  title: offer.title || 'Special Offer',
                  description: desc || offer.description || 'Tap to view details'
                };

                // Convert offer image to base64
                const imgUrl = offer.imageWhatsApp || offer.image;
                if (imgUrl) {
                  const b64 = await toBase64(imgUrl);
                  if (b64) item.image = b64;
                }

                return item;
              }));

              const images = await getFlowImages();
              response = {
                screen: 'VIEW_OFFERS',
                data: {
                  offers: offerItems,
                  flow_token: token
                }
              };
            } else {
              // No eligible offers → close flow with no_offers flag
              response = {
                screen: 'SUCCESS',
                data: {
                  extension_message_response: {
                    params: {
                      flow_token: token,
                      selected_service: 'view_offers',
                      no_offers: 'true'
                    }
                  }
                }
              };
            }
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch offers', { phone, error: dbErr.message });
            response = {
              screen: 'SUCCESS',
              data: {
                extension_message_response: {
                  params: {
                    flow_token: token,
                    selected_service: 'view_offers',
                    no_offers: 'true'
                  }
                }
              }
            };
          }
        } else if (selectedService === 'account_details') {
          // Account Details → fetch customer profile and show ACCOUNT_DETAILS screen
          const images = await getFlowImages();
          const phone = token.replace('welcome_service_', '');

          try {
            const customer = await Customer.findOne({ phone })
              .select('name email createdAt')
              .lean();

            // Aggregate orders & spend live from the Order collection so the
            // numbers always stay in sync with reality. Sum across ALL payment
            // methods (COD + UPI/online + pay-at-hotel) and ALL service types
            // (delivery + self-pickup + dine-in). Cancelled orders are excluded
            // from both the count and the total.
            let orderCount = 0;
            let spentTotal = 0;
            try {
              const agg = await Order.aggregate([
                { $match: { 'customer.phone': phone, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
              ]);
              if (agg.length > 0) {
                orderCount = agg[0].count || 0;
                spentTotal = Math.round(agg[0].total || 0);
              }
            } catch (aggErr) {
              logger.warn('[FlowEndpoint] Order aggregation failed for account info', { phone, error: aggErr.message });
            }

            const displayPhone = phone.length > 10 ? phone.slice(-10) : phone;
            const memberSinceText = customer?.createdAt
              ? `Member since: ${new Date(customer.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Member since: —';

            response = {
              screen: 'ACCOUNT_DETAILS',
              data: {
                // Three separate text fields — rendered as three TextBody nodes
                // in the flow JSON so each one appears on its own line.
                member_since: memberSinceText,
                total_orders: `Total Orders: ${orderCount}`,
                total_spent: `Total Spent: ₹${spentTotal}`,
                init_name: customer?.name || '',
                init_email: customer?.email || '',
                init_phone: displayPhone,
                flow_token: token
              }
            };
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch customer', { phone, error: dbErr.message });
            response = {
              screen: 'ACCOUNT_DETAILS',
              data: {
                member_since: 'Fill in your details below',
                total_orders: 'Total Orders: 0',
                total_spent: 'Total Spent: ₹0',
                init_name: '',
                init_email: '',
                init_phone: phone.length > 10 ? phone.slice(-10) : phone,
                flow_token: token
              }
            };
          }
        } else if (selectedService === 'open_website') {
          // Visit Website → show VISIT_WEBSITE screen with link + banner
          const images = await getFlowImages();
          response = {
            screen: 'VISIT_WEBSITE',
            data: {
              website_url: 'https://restarunt-bot.vercel.app/',
              flow_token: token
            }
          };
        } else if (selectedService === 'help') {
          // Help & Support → show HELP_SUPPORT screen with banner and contact info
          const images = await getFlowImages();
          // Build a `tel:` URL the EmbeddedLink can open to launch the dialer
          // directly. Strip whitespace from the phone — `tel:` URIs require a
          // continuous string of digits/symbols.
          const supportPhone = (process.env.RESTAURANT_PHONE || process.env.SUPPORT_PHONE || '+919440203095')
            .toString()
            .replace(/\s+/g, '');
          response = {
            screen: 'HELP_SUPPORT',
            data: {
              support_phone_url: `tel:${supportPhone}`,
              flow_token: token
            }
          };
        } else if (selectedService === 'track_order') {
          // Track Order → show currently active orders (not delivered/cancelled).
          // The flow then `complete`s with the chosen order; webhook sends the
          // status update message + tracking CTA URL.
          const images = await getFlowImages();
          const phone = token.replace('welcome_service_', '');

          const STATUS_LABELS = {
            pending: 'Pending',
            confirmed: 'Confirmed',
            preparing: 'Preparing',
            ready: 'Ready',
            out_for_delivery: 'Out for Delivery'
          };

          try {
            const activeOrders = await Order.find({
              'customer.phone': phone,
              status: { $nin: ['cancelled', 'delivered'] }
            })
              .sort({ createdAt: -1 })
              .limit(10)
              .select('orderId status items totalAmount createdAt serviceType')
              .lean();

            if (activeOrders.length > 0) {
              const orderItems = activeOrders.map(order => {
                const itemCount = order.items ? order.items.length : 0;
                const date = new Date(order.createdAt);
                const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const statusLabel = STATUS_LABELS[order.status] || order.status;

                const item = {
                  id: order.orderId,
                  title: `#${order.orderId} - ₹${order.totalAmount}`,
                  description: `${statusLabel} • ${itemCount} item${itemCount !== 1 ? 's' : ''} • ${dateStr}`
                };

                // Status-based icon thumbnail (uses the same status images as MY_ORDERS)
                const statusImg = images.statusImages?.[order.status];
                if (statusImg) item.image = statusImg;

                return item;
              });

              response = {
                screen: 'TRACK_ORDER',
                data: {
                  active_orders: orderItems,
                  flow_token: token
                }
              };
            } else {
              // No active orders → close flow with flag; webhook sends a friendly text.
              response = {
                screen: 'SUCCESS',
                data: {
                  extension_message_response: {
                    params: {
                      flow_token: token,
                      selected_service: 'track_order',
                      no_active_orders: 'true'
                    }
                  }
                }
              };
            }
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch active orders', { phone, error: dbErr.message });
            response = {
              screen: 'SUCCESS',
              data: {
                extension_message_response: {
                  params: {
                    flow_token: token,
                    selected_service: 'track_order',
                    no_active_orders: 'true'
                  }
                }
              }
            };
          }
        } else if (selectedService === 'my_cart') {
          // My Cart → fetch cart items dynamically and show MY_CART screen
          const images = await getFlowImages();
          const phone = token.replace('welcome_service_', '');
          const CART_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

          try {
            const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
            // Filter expired items (older than 30 min) and items without menuItem
            const now = Date.now();
            const validItems = (freshCustomer?.cart || []).filter(ci => {
              if (!ci.menuItem) return false;
              if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
              return true;
            });

            if (validItems.length > 0) {
              const toBase64 = (url, opts) => catalogService._imageUrlToRawBase64(url, opts);
              let total = 0;

              const cartItems = await Promise.all(validItems.map(async (ci, idx) => {
                const mi = ci.menuItem;
                let displayName = mi.name;
                let effectivePrice = mi.offerPrice || mi.price;

                // Resolve variant pricing and name
                if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
                  const variant = mi.variants[ci.variantIndex];
                  displayName = `${mi.name} - ${variant.label || ci.variantLabel || 'Variant'}`;
                  if (ci.quantityIndex != null && variant.quantities?.[ci.quantityIndex]) {
                    const q = variant.quantities[ci.quantityIndex];
                    effectivePrice = (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : q.price;
                  } else {
                    effectivePrice = (variant.offerPrice && variant.offerPrice < variant.price) ? variant.offerPrice : variant.price;
                  }
                }

                const subtotal = effectivePrice * ci.quantity;
                total += subtotal;

                const entry = {
                  id: `item_${idx}`,
                  title: displayName.substring(0, 30),
                  description: `${ci.quantity} × ₹${effectivePrice} = ₹${subtotal}`
                };

                // Convert item image to base64 for thumbnail (variant image if available)
                let imgUrl = null;
                if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]?.image) {
                  imgUrl = mi.variants[ci.variantIndex].image;
                } else if (mi.image) {
                  imgUrl = mi.image;
                }
                if (imgUrl) {
                  try {
                    const b64 = await toBase64(imgUrl, { width: 100, height: 100 });
                    if (b64) entry.image = b64;
                  } catch (e) { /* skip image */ }
                }

                return entry;
              }));

              // Calculate earliest expiry for display
              const oldestItem = validItems.reduce((oldest, ci) => {
                const addedAt = ci.addedAt ? new Date(ci.addedAt).getTime() : now;
                return addedAt < oldest ? addedAt : oldest;
              }, now);
              const minutesLeft = Math.max(1, Math.round((CART_EXPIRY_MS - (now - oldestItem)) / 60000));

              response = {
                screen: 'MY_CART',
                data: {
                  cart_items: cartItems,
                  cart_summary: `━━━━━━━━━━━━━━━\n💰 Total: ₹${total}\n⏳ Cart expires in ~${minutesLeft} min`,
                  flow_token: token
                }
              };
            } else {
              // Cart empty → show MY_CART with placeholder so user can browse menu
              response = {
                screen: 'MY_CART',
                data: {
                  cart_items: [{ id: 'browse_menu', title: 'No items in your cart', description: 'Tap Continue to browse the menu' }],
                  cart_summary: '🛒 Your cart is empty.\nBrowse the menu to add delicious items!',
                  flow_token: token
                }
              };
            }
          } catch (dbErr) {
            logger.error('[FlowEndpoint] Failed to fetch cart', { phone, error: dbErr.message });
            response = {
              screen: 'MY_CART',
              data: {
                cart_items: [{ id: 'browse_menu', title: 'No items in your cart', description: 'Tap Continue to browse the menu' }],
                cart_summary: '🛒 Your cart is empty.\nBrowse the menu to add delicious items!',
                flow_token: token
              }
            };
          }
        } else {
          // Any other service → close the flow and send result to webhook
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: {
                  flow_token: token,
                  selected_service: selectedService
                }
              }
            }
          };
        }
      }

      // MY_CART screen: User viewed cart items and tapped Continue → show CART_ACTIONS
      else if (screen === 'MY_CART') {
        const token = data?.flow_token || flow_token || 'welcome_service';
        const phone = token.replace('welcome_service_', '');
        const selectedCartItem = data?.selected_cart_item;
        const images = await getFlowImages();

        // Empty cart placeholder → navigate to MENU_CATEGORIES
        if (selectedCartItem === 'browse_menu') {
          try {
            const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });
            const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image variants price offerPrice')
              .lean();

            const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
              let desc;
              if (item.variants && item.variants.length > 0) {
                desc = `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''} available`;
              } else {
                desc = `₹${item.offerPrice || item.price}`;
              }
              const catItem = {
                id: item._id.toString(),
                title: item.name.substring(0, 30),
                description: desc
              };
              if (item.image) {
                const b64 = await toBase64Thumb(item.image).catch(() => '');
                if (b64) catItem.image = b64;
              }
              return catItem;
            }));

            if (categoryItems.length > 0) {
              response = {
                screen: 'MENU_CATEGORIES',
                data: {
                  categories: categoryItems,
                  selected_service: 'order_food',
                  flow_token: token
                }
              };
            } else {
              response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, selected_service: 'my_cart', no_items: 'true' } } } };
            }
          } catch (err) {
            logger.error('[FlowEndpoint] MY_CART browse_menu error', { phone, error: err.message });
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, selected_service: 'my_cart' } } } };
          }
        } else {
        // Cart has items → show CART_ACTIONS
        const CART_EXPIRY_MS = 30 * 60 * 1000;

        try {
          const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
          const now = Date.now();
          const validItems = (freshCustomer?.cart || []).filter(ci => {
            if (!ci.menuItem) return false;
            if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
            return true;
          });

          let total = 0;
          validItems.forEach(ci => {
            const mi = ci.menuItem;
            let price = mi.offerPrice || mi.price;
            if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
              const v = mi.variants[ci.variantIndex];
              if (ci.quantityIndex != null && v.quantities?.[ci.quantityIndex]) {
                const q = v.quantities[ci.quantityIndex];
                price = (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : q.price;
              } else {
                price = (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : v.price;
              }
            }
            total += price * ci.quantity;
          });

          const cartActions = [
            { id: 'place_order', title: 'Place Order', description: 'Proceed to checkout' },
            { id: 'add_more', title: 'Add More', description: 'Browse menu & add items' },
            { id: 'clear_cart', title: 'Clear Cart', description: 'Remove all items from cart' }
          ];
          if (images.cartPlaceOrderImg) cartActions[0].image = images.cartPlaceOrderImg;
          if (images.cartAddMoreImg) cartActions[1].image = images.cartAddMoreImg;
          if (images.cartClearImg) cartActions[2].image = images.cartClearImg;

          response = {
            screen: 'CART_ACTIONS',
            data: {
              cart_actions: cartActions,
              cart_info: `🛒 ${validItems.length} item${validItems.length !== 1 ? 's' : ''} • Total: ₹${total}`,
              flow_token: token
            }
          };
        } catch (dbErr) {
          logger.error('[FlowEndpoint] Failed to build cart actions', { phone, error: dbErr.message });
          response = {
            screen: 'CART_ACTIONS',
            data: {
              cart_actions: [
                { id: 'place_order', title: 'Place Order', description: 'Proceed to checkout' },
                { id: 'add_more', title: 'Add More', description: 'Browse menu & add items' },
                { id: 'clear_cart', title: 'Clear Cart', description: 'Remove all items from cart' }
              ],
              cart_info: '🛒 Your cart',
              flow_token: token
            }
          };
        }
        } // close else (cart has items)
      }

      // CART_ACTIONS screen: User chose place_order/add_more/clear_cart → navigate dynamically
      else if (screen === 'CART_ACTIONS') {
        const token = data?.flow_token || flow_token || 'welcome_service';
        const phone = token.replace('welcome_service_', '');
        const cartAction = data?.selected_cart_action;

        if (cartAction === 'place_order') {
          // Place Order → show CHOOSE_SERVICE with delivery/pickup options
          try {
            const images = await getFlowImages();
            const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

            const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
            const CART_EXPIRY_MS = 30 * 60 * 1000;
            const now = Date.now();
            const validItems = (freshCustomer?.cart || []).filter(ci => {
              if (!ci.menuItem) return false;
              if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
              return true;
            });

            let total = 0;
            validItems.forEach(ci => {
              const mi = ci.menuItem;
              let price = mi.offerPrice || mi.price;
              if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
                const v = mi.variants[ci.variantIndex];
                if (ci.quantityIndex != null && v.quantities?.[ci.quantityIndex]) {
                  const q = v.quantities[ci.quantityIndex];
                  price = (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : q.price;
                } else {
                  price = (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : v.price;
                }
              }
              total += price * ci.quantity;
            });

            const [deliveryB64, pickupB64] = await Promise.all([
              toBase64(images.deliveryOptionImg).catch(() => ''),
              toBase64(images.pickupOptionImg).catch(() => '')
            ]);

            const serviceOptions = [
              { id: 'delivery', title: 'Delivery', description: 'To your doorstep' },
              { id: 'pickup', title: 'Self-Pickup', description: 'From restaurant' }
            ];
            if (deliveryB64) serviceOptions[0].image = deliveryB64;
            if (pickupB64) serviceOptions[1].image = pickupB64;

            response = {
              screen: 'CHOOSE_SERVICE',
              data: {
                order_summary: `${validItems.length} item${validItems.length > 1 ? 's' : ''} • Total: ₹${total}`,
                service_options: serviceOptions,
                flow_token: token
              }
            };
          } catch (err) {
            logger.error('[FlowEndpoint] Welcome CHOOSE_SERVICE error', { phone, error: err.message });
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, selected_service: 'my_cart', error: 'service_error' } } } };
          }
        } else if (cartAction === 'add_more') {
          // Add More → show MENU_CATEGORIES with all available menu items
          try {
            const images = await getFlowImages();
            const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });

            const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image variants price offerPrice')
              .lean();

            const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
              let desc;
              if (item.variants && item.variants.length > 0) {
                desc = `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''}`;
              } else {
                desc = `₹${item.offerPrice || item.price}`;
              }
              const catItem = {
                id: item._id.toString(),
                title: item.name.substring(0, 30),
                description: desc
              };
              if (item.image) {
                const b64 = await toBase64Thumb(item.image).catch(() => '');
                if (b64) catItem.image = b64;
              }
              return catItem;
            }));

            if (categoryItems.length > 0) {
              response = {
                screen: 'MENU_CATEGORIES',
                data: {
                  categories: categoryItems,
                  selected_service: 'my_cart',
                  flow_token: token
                }
              };
            } else {
              response = {
                screen: 'SUCCESS',
                data: { extension_message_response: { params: { flow_token: token, selected_service: 'my_cart', selected_cart_action: 'add_more', no_items: 'true' } } }
              };
            }
          } catch (err) {
            logger.error('[FlowEndpoint] Welcome MENU_CATEGORIES error', { phone, error: err.message });
            response = {
              screen: 'SUCCESS',
              data: { extension_message_response: { params: { flow_token: token, selected_service: 'my_cart', selected_cart_action: 'add_more' } } }
            };
          }
        } else {
          // clear_cart → close flow, webhook handles
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: {
                  flow_token: token,
                  selected_service: 'my_cart',
                  selected_cart_action: cartAction
                }
              }
            }
          };
        }
      }

      // Screen 3: User selected an order on MY_ORDERS and tapped View Order → show ORDER_DETAILS
      else if (screen === 'MY_ORDERS') {
        const selectedOrderId = data?.selected_order;
        const token = data?.flow_token || flow_token || 'welcome_service';

        try {
          const order = await Order.findOne({ orderId: selectedOrderId })
            .select('orderId status items totalAmount itemsTotal deliveryCharge discountAmount serviceType paymentMethod paymentStatus cancellationReason deliveryPartnerName trackingUpdates assignedTo createdAt deliveredAt')
            .populate('assignedTo', 'name phone')
            .lean();

          if (order) {
            const images = await getFlowImages();

            const STATUS_LABELS = {
              pending: '⏳ Pending',
              confirmed: '✅ Confirmed',
              preparing: '👨‍🍳 Preparing',
              ready: '📦 Ready',
              out_for_delivery: '🚚 Out for Delivery',
              delivered: '✅ Delivered',
              cancelled: '❌ Cancelled'
            };

            const SERVICE_LABELS = {
              delivery: '🚚 Delivery',
              pickup: '🏪 Self-Pickup',
              dine_in: '🍽️ Dine In'
            };

            const PAYMENT_STATUS_LABELS = {
              pending: '⏳ Pending',
              paid: '✅ Paid',
              failed: '❌ Failed',
              cancelled: '❌ Cancelled'
            };

            const statusLabel = STATUS_LABELS[order.status] || order.status;
            const serviceLabel = SERVICE_LABELS[order.serviceType] || order.serviceType;
            const paymentLabel = order.paymentMethod === 'cod'
              ? (order.serviceType === 'pickup' ? 'Pay at Hotel' : 'Cash on Delivery')
              : 'UPI';
            const paymentStatusLabel = PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus;
            const date = new Date(order.createdAt);
            const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

            // Status accent line (subheading) + 3-line meta block
            const statusLine = statusLabel;
            const metaBlockLines = [
              `${serviceLabel}`,
              `💳  ${paymentLabel} (${paymentStatusLabel})`,
              `📅  ${dateStr} · ${timeStr}`
            ];
            const metaBlock = metaBlockLines.join('\n');

            // Cancellation info
            let cancelInfo = '';
            const hasCancelInfo = order.status === 'cancelled';
            if (hasCancelInfo) {
              const reason = order.cancellationReason || 'No reason provided';
              cancelInfo = `📝 Reason: ${reason}`;
            }

            // Delivery partner info
            let deliveryInfo = '';
            const hasDeliveryInfo = order.serviceType === 'delivery' && (order.assignedTo || order.deliveryPartnerName);
            if (hasDeliveryInfo) {
              const partnerName = order.assignedTo?.name || order.deliveryPartnerName || 'Assigned';
              const partnerPhone = order.assignedTo?.phone || '';
              deliveryInfo = `🧑‍💼 Partner: ${partnerName}`;
              if (partnerPhone) deliveryInfo += `\n📞 Phone: ${partnerPhone}`;
            }

            // Tracking timeline
            let trackingInfo = '';
            const hasTrackingInfo = order.trackingUpdates && order.trackingUpdates.length > 0;
            if (hasTrackingInfo) {
              const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
              const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              const timelineLines = order.trackingUpdates.map(tu => {
                const label = STATUS_LABELS[tu.status] || tu.status || tu.message;
                return `${fmtDate(tu.timestamp)} ${fmtTime(tu.timestamp)} — ${label}`;
              });
              trackingInfo = timelineLines.join('\n');
            }
            if (order.deliveredAt) {
              const dDate = new Date(order.deliveredAt);
              const dStr = dDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              const dTime = dDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
              trackingInfo += (trackingInfo ? '\n' : '') + `${dStr} ${dTime} — ✅ Delivered`;
            }

            // Build item list with images
            const toBase64 = (url, opts) => catalogService._imageUrlToRawBase64(url, opts);
            const orderItems = await Promise.all((order.items || []).map(async (item, idx) => {
              const entry = {
                id: `item_${idx}`,
                title: `${item.name} x${item.quantity}`,
                description: `₹${item.price} each${item.variantLabel ? ' • ' + item.variantLabel : ''}`
              };
              if (item.image) {
                const b64 = await toBase64(item.image, { width: 100, height: 100 });
                if (b64) entry.image = b64;
              }
              return entry;
            }));

            // Totals block — column-aligned with padded labels so amounts line up
            const itemsTotal = order.itemsTotal || order.totalAmount;
            const padLabel = (s) => s.padEnd(12, ' ');
            const summaryLines = [`${padLabel('Subtotal')}₹${itemsTotal}`];
            if (order.deliveryCharge > 0) summaryLines.push(`${padLabel('Delivery')}₹${order.deliveryCharge}`);
            if (order.discountAmount > 0) summaryLines.push(`${padLabel('Discount')}−₹${order.discountAmount}`);
            summaryLines.push('─────────────────');
            summaryLines.push(`*Total*${' '.repeat(8)}₹${order.totalAmount}`);

            response = {
              screen: 'ORDER_DETAILS',
              data: {
                order_heading: `Order #${order.orderId}`,
                status_line: statusLine,
                meta_block: metaBlock,
                has_cancel_info: hasCancelInfo,
                cancel_info: cancelInfo || ' ',
                has_delivery_info: !!hasDeliveryInfo,
                delivery_info: deliveryInfo || ' ',
                has_tracking_info: !!(hasTrackingInfo || order.deliveredAt),
                tracking_info: trackingInfo || ' ',
                order_items: orderItems.length > 0 ? orderItems : [{ id: 'no_items', title: 'No items', description: 'Order has no items' }],
                order_summary: summaryLines.join('\n'),
                order_id: order.orderId,
                flow_token: token
              }
            };
          } else {
            // Order not found → close flow
            response = {
              screen: 'SUCCESS',
              data: {
                extension_message_response: {
                  params: {
                    flow_token: token,
                    selected_service: 'my_orders',
                    selected_order: selectedOrderId || '',
                    order_viewed: 'true'
                  }
                }
              }
            };
          }
        } catch (dbErr) {
          logger.error('[FlowEndpoint] Failed to fetch order details', { orderId: selectedOrderId, error: dbErr.message });
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: {
                  flow_token: token,
                  selected_service: 'my_orders',
                  selected_order: selectedOrderId || '',
                  order_viewed: 'true'
                }
              }
            }
          };
        }
      }

      // VIEW_OFFERS screen: User selected an offer → show offer's applied menu items
      else if (screen === 'VIEW_OFFERS') {
        const token = data?.flow_token || flow_token || 'welcome_service';
        const selectedOffer = data?.selected_offer;

        try {
          const offer = await Offer.findById(selectedOffer)
            .select('appliedItems appliedCategories title offerType discountType discountValue percentage validUntil')
            .populate('appliedItems', 'name image variants price offerPrice available isPaused')
            .lean();

          // Persist the chosen offer onto the customer so downstream pricing
          // (cart, item details, catalog precursor message) can apply the
          // discount automatically. Idempotent — won't add duplicates.
          if (offer && token.startsWith('welcome_service_')) {
            const phone = token.replace('welcome_service_', '');
            try {
              const customerDoc = await Customer.findOne({ phone });
              if (customerDoc) {
                const offerIdStr = offer._id.toString();
                const alreadyApplied = (customerDoc.activeOffers || []).some(o => o.offerId?.toString() === offerIdStr);
                if (!alreadyApplied) {
                  customerDoc.activeOffers = customerDoc.activeOffers || [];
                  customerDoc.activeOffers.push({
                    offerId: offer._id,
                    offerType: offer.offerType,
                    title: offer.title,
                    discountType: offer.discountType,
                    discountValue: offer.discountValue,
                    percentage: offer.percentage,
                    appliedItems: (offer.appliedItems || []).map(it => it._id || it),
                    appliedCategories: offer.appliedCategories || [],
                    validUntil: offer.validUntil,
                    appliedAt: new Date()
                  });
                }
                customerDoc.conversationState = customerDoc.conversationState || {};
                customerDoc.conversationState.context = customerDoc.conversationState.context || {};
                customerDoc.conversationState.context.appliedOfferId = offerIdStr;
                customerDoc.markModified('conversationState');
                await customerDoc.save();
              }
            } catch (persistErr) {
              logger.warn('[FlowEndpoint] Failed to persist selected offer to customer', { phone, error: persistErr.message });
            }
          }

          const images = await getFlowImages();
          const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });

          // Compute the effective discounted price for a base price using the
          // selected offer. Handles both fixed/percentage discountType (modern
          // schema) and the legacy `percentage` field. Returns null when no
          // discount applies. Used for targeted offers where the MenuItem
          // doesn't carry offerPrice (discount is applied at order time only),
          // and as a unified path for non-targeted offers too.
          const applyOfferDiscount = (basePrice) => {
            if (!offer || !basePrice || basePrice <= 0) return null;
            let discountedPrice = null;
            if (offer.discountType === 'percentage' && offer.discountValue > 0) {
              discountedPrice = Math.round(basePrice * (1 - offer.discountValue / 100));
            } else if (offer.discountType === 'fixed' && offer.discountValue > 0) {
              discountedPrice = Math.max(0, basePrice - offer.discountValue);
            } else if (offer.percentage && offer.percentage > 0) {
              discountedPrice = Math.round(basePrice * (1 - offer.percentage / 100));
            }
            return discountedPrice && discountedPrice < basePrice ? discountedPrice : null;
          };

          // Get items from the offer's appliedItems, filter to available ones
          let menuItems = (offer?.appliedItems || []).filter(item => item.available && !item.isPaused);

          // If offer has no applied items, show all available items as fallback
          if (menuItems.length === 0) {
            menuItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image variants price offerPrice')
              .lean();
          }

          const categoryItems = await Promise.all(menuItems.slice(0, 10).map(async (item) => {
            let desc;
            if (item.variants && item.variants.length > 0) {
              // Compute discounted starting price using the cheapest variant
              const variantPrices = item.variants.map(v => v.offerPrice || v.price).filter(p => p > 0);
              const minPrice = variantPrices.length ? Math.min(...variantPrices) : null;
              const discounted = applyOfferDiscount(minPrice);
              const variantSuffix = `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''}`;
              if (discounted && minPrice) {
                desc = `From ₹${discounted} (was ₹${minPrice}) • ${variantSuffix}`;
              } else if (minPrice) {
                desc = `From ₹${minPrice} • ${variantSuffix}`;
              } else {
                desc = `${variantSuffix} available`;
              }
            } else {
              // Single-price item: prefer the offer's discount; fall back to
              // the static offerPrice field; finally just price.
              const discounted = applyOfferDiscount(item.price);
              if (discounted) {
                desc = `₹${discounted} (was ₹${item.price})`;
              } else if (item.offerPrice && item.offerPrice < item.price) {
                desc = `₹${item.offerPrice} (was ₹${item.price})`;
              } else {
                desc = `₹${item.price}`;
              }
            }
            const catItem = {
              id: item._id.toString(),
              title: item.name.substring(0, 30),
              description: desc
            };
            if (item.image) {
              const b64 = await toBase64Thumb(item.image).catch(() => '');
              if (b64) catItem.image = b64;
            }
            return catItem;
          }));

          if (categoryItems.length > 0) {
            response = {
              screen: 'MENU_CATEGORIES',
              data: {
                categories: categoryItems,
                selected_service: 'order_food',
                flow_token: token
              }
            };
          } else {
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, selected_service: 'view_offers', no_items: 'true' } } } };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] VIEW_OFFERS item fetch error', { offerId: selectedOffer, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, selected_service: 'view_offers' } } } };
        }
      }

      // Order Confirmation Flow: ORDER_REVIEW → CHOOSE_SERVICE
      else if (data?.confirm_order_review === 'true') {
        const token = data?.flow_token || flow_token || '';
        const phone = token.replace('order_confirm_', '');
        try {
          const images = await getFlowImages();
          const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

          // Fetch cart for order summary
          const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
          const validItems = (freshCustomer?.cart || []).filter(ci => ci.menuItem);
          let total = 0;
          validItems.forEach(ci => {
            const mi = ci.menuItem;
            let price = mi.offerPrice || mi.price;
            if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
              const v = mi.variants[ci.variantIndex];
              if (ci.quantityIndex != null && v.quantities?.[ci.quantityIndex]) {
                price = (v.quantities[ci.quantityIndex].offerPrice && v.quantities[ci.quantityIndex].offerPrice < v.quantities[ci.quantityIndex].price) ? v.quantities[ci.quantityIndex].offerPrice : v.quantities[ci.quantityIndex].price;
              } else {
                price = (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : v.price;
              }
            }
            total += price * ci.quantity;
          });

          // Convert delivery/pickup images for RadioButtonsGroup thumbnails
          const [deliveryB64, pickupB64] = await Promise.all([
            toBase64(images.deliveryOptionImg).catch(() => ''),
            toBase64(images.pickupOptionImg).catch(() => '')
          ]);

          // Build service options with images (like food type icons)
          const serviceOptions = [
            { id: 'delivery', title: 'Delivery', description: 'To your doorstep' },
            { id: 'pickup', title: 'Self-Pickup', description: 'From restaurant' }
          ];
          if (deliveryB64) serviceOptions[0].image = deliveryB64;
          if (pickupB64) serviceOptions[1].image = pickupB64;

          response = {
            screen: 'CHOOSE_SERVICE',
            data: {
              order_summary: `${validItems.length} item${validItems.length > 1 ? 's' : ''} • Total: ₹${total}`,
              service_options: serviceOptions,
              flow_token: token
            }
          };
        } catch (err) {
          logger.error('[FlowEndpoint] Order confirm CHOOSE_SERVICE error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, error: 'service_error' } } } };
        }
      }

      // Cart Review Flow: CART_REVIEW → CART_ACTIONS
      else if (data?.confirm_cart_review === 'true') {
        const token = data?.flow_token || flow_token || '';
        const phone = token.replace('cart_review_', '');
        try {
          const images = await getFlowImages();

          const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
          const CART_EXPIRY_MS = 30 * 60 * 1000;
          const now = Date.now();
          const validItems = (freshCustomer?.cart || []).filter(ci => {
            if (!ci.menuItem) return false;
            if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
            return true;
          });

          let total = 0;
          validItems.forEach(ci => {
            const mi = ci.menuItem;
            let price = mi.offerPrice || mi.price;
            if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
              const v = mi.variants[ci.variantIndex];
              if (ci.quantityIndex != null && v.quantities?.[ci.quantityIndex]) {
                price = (v.quantities[ci.quantityIndex].offerPrice && v.quantities[ci.quantityIndex].offerPrice < v.quantities[ci.quantityIndex].price) ? v.quantities[ci.quantityIndex].offerPrice : v.quantities[ci.quantityIndex].price;
              } else {
                price = (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : v.price;
              }
            }
            total += price * ci.quantity;
          });

          const cartActions = [
            { id: 'place_order', title: 'Place Order', description: 'Proceed to checkout' },
            { id: 'add_more', title: 'Add More', description: 'Browse menu for more items' },
            { id: 'clear_cart', title: 'Clear Cart', description: 'Remove all items' }
          ];
          if (images.cartPlaceOrderImg) cartActions[0].image = images.cartPlaceOrderImg;
          if (images.cartAddMoreImg) cartActions[1].image = images.cartAddMoreImg;
          if (images.cartClearImg) cartActions[2].image = images.cartClearImg;

          response = {
            screen: 'CART_ACTIONS',
            data: {
              cart_actions: cartActions,
              cart_info: `🛒 ${validItems.length} item${validItems.length !== 1 ? 's' : ''} • Total: ₹${total}`,
              flow_token: token
            }
          };
        } catch (err) {
          logger.error('[FlowEndpoint] Cart review CART_ACTIONS error', { phone, error: err.message });
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, error: 'cart_actions_error' } } } };
        }
      }

      // Cart Review Flow: CART_ACTIONS → CHOOSE_SERVICE (place_order) or close flow (add_more/clear_cart)
      else if (data?.selected_cart_action && flow_token?.startsWith('cart_review_')) {
        const token = data?.flow_token || flow_token || '';
        const phone = token.replace('cart_review_', '');
        const cartAction = data.selected_cart_action;

        if (cartAction === 'place_order') {
          // Place Order → show CHOOSE_SERVICE with delivery/pickup options
          try {
            const images = await getFlowImages();
            const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

            const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
            const CART_EXPIRY_MS = 30 * 60 * 1000;
            const now = Date.now();
            const validItems = (freshCustomer?.cart || []).filter(ci => {
              if (!ci.menuItem) return false;
              if (ci.addedAt && (now - new Date(ci.addedAt).getTime()) > CART_EXPIRY_MS) return false;
              return true;
            });

            let total = 0;
            validItems.forEach(ci => {
              const mi = ci.menuItem;
              let price = mi.offerPrice || mi.price;
              if (ci.variantIndex != null && mi.variants?.[ci.variantIndex]) {
                const v = mi.variants[ci.variantIndex];
                if (ci.quantityIndex != null && v.quantities?.[ci.quantityIndex]) {
                  price = (v.quantities[ci.quantityIndex].offerPrice && v.quantities[ci.quantityIndex].offerPrice < v.quantities[ci.quantityIndex].price) ? v.quantities[ci.quantityIndex].offerPrice : v.quantities[ci.quantityIndex].price;
                } else {
                  price = (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : v.price;
                }
              }
              total += price * ci.quantity;
            });

            const [deliveryB64, pickupB64] = await Promise.all([
              toBase64(images.deliveryOptionImg).catch(() => ''),
              toBase64(images.pickupOptionImg).catch(() => '')
            ]);

            const serviceOptions = [
              { id: 'delivery', title: 'Delivery', description: 'To your doorstep' },
              { id: 'pickup', title: 'Self-Pickup', description: 'From restaurant' }
            ];
            if (deliveryB64) serviceOptions[0].image = deliveryB64;
            if (pickupB64) serviceOptions[1].image = pickupB64;

            response = {
              screen: 'CHOOSE_SERVICE',
              data: {
                order_summary: `${validItems.length} item${validItems.length > 1 ? 's' : ''} • Total: ₹${total}`,
                service_options: serviceOptions,
                flow_token: token
              }
            };
          } catch (err) {
            logger.error('[FlowEndpoint] Cart review CHOOSE_SERVICE error', { phone, error: err.message });
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, error: 'service_error' } } } };
          }
        } else if (cartAction === 'add_more') {
          // Add More → show MENU_CATEGORIES with available menu items
          try {
            const images = await getFlowImages();
            const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });

            const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image variants price offerPrice')
              .lean();

            const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
              let desc;
              if (item.variants && item.variants.length > 0) {
                desc = `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''}`;
              } else {
                desc = `₹${item.offerPrice || item.price}`;
              }
              const catItem = {
                id: item._id.toString(),
                title: item.name.substring(0, 30),
                description: desc
              };
              if (item.image) {
                const b64 = await toBase64Thumb(item.image).catch(() => '');
                if (b64) catItem.image = b64;
              }
              return catItem;
            }));

            if (categoryItems.length > 0) {
              response = {
                screen: 'MENU_CATEGORIES',
                data: {
                  categories: categoryItems,
                  flow_token: token
                }
              };
            } else {
              response = {
                screen: 'SUCCESS',
                data: { extension_message_response: { params: { flow_token: token, selected_cart_action: 'add_more', no_items: 'true' } } }
              };
            }
          } catch (err) {
            logger.error('[FlowEndpoint] Cart review MENU_CATEGORIES error', { phone, error: err.message });
            response = {
              screen: 'SUCCESS',
              data: { extension_message_response: { params: { flow_token: token, selected_cart_action: 'add_more' } } }
            };
          }
        } else {
          // clear_cart → close flow, webhook handles the action
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: {
                  flow_token: token,
                  selected_cart_action: cartAction
                }
              }
            }
          };
        }
      }

      // ORDER_DETAILS screen: user tapped "Help" footer.
      //   • Order Actions flow (post-checkout, flow_token starts with
      //     `order_actions_`) → show full action list (Track / Cancel /
      //     Order Food / Contact / Main Menu) on the ORDER_ACTIONS screen.
      //   • Welcome flow → My Orders → Order Details (flow_token starts with
      //     `welcome_service_`) → show only Track / Cancel / Contact on the
      //     ORDER_HELP screen. Order Food / Main Menu are intentionally
      //     omitted here because the customer is reviewing an existing order,
      //     not just placed one.
      else if (screen === 'ORDER_DETAILS') {
        const token = data?.flow_token || flow_token || '';
        const isWelcomeContext = token.startsWith('welcome_service_');
        // For order_actions tokens the orderId is encoded as the suffix.
        // For welcome_service tokens the orderId comes via data.order_id
        // (set by the ORDER_DETAILS Footer payload).
        let orderIdD;
        if (isWelcomeContext) {
          orderIdD = data?.order_id || '';
        } else {
          const tokenParts = token.replace('order_actions_', '');
          const lastUnderscoreD = tokenParts.lastIndexOf('_');
          orderIdD = tokenParts.substring(lastUnderscoreD + 1);
        }
        try {
          const toBase64Icon = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });

          const [trackImg, cancelImg, orderFoodImg, mainMenuImg, contactImg] = await Promise.all([
            chatbotImagesService.getImageUrl('flow_action_track').then(u => u ? toBase64Icon(u) : '').catch(() => ''),
            chatbotImagesService.getImageUrl('flow_action_cancel').then(u => u ? toBase64Icon(u) : '').catch(() => ''),
            chatbotImagesService.getImageUrl('flow_action_order_food').then(u => u ? toBase64Icon(u) : '').catch(() => ''),
            chatbotImagesService.getImageUrl('flow_action_main_menu').then(u => u ? toBase64Icon(u) : '').catch(() => ''),
            chatbotImagesService.getImageUrl('flow_action_contact').then(u => u ? toBase64Icon(u) : '').catch(() => '')
          ]);

          const order = await Order.findOne({ orderId: orderIdD }).lean();

          // Cancel Order is shown only for orders that are still cancel-eligible
          // — COD / Pay-at-Hotel orders still in the initial `pending` state
          // (i.e. the restaurant hasn't accepted them yet). Once confirmed
          // (or anything beyond), the customer must call us instead.
          const isCancellable = !!order
            && order.paymentMethod === 'cod'
            && order.status === 'pending';

          const actions = [
            { id: 'track_order', title: 'Track Order', description: 'View current order status' }
          ];
          if (isCancellable) {
            actions.push({ id: 'cancel_order', title: 'Cancel Order', description: 'Cancel this order' });
          }
          if (!isWelcomeContext) {
            // Order Food / Main Menu only make sense in the post-checkout
            // Order Actions flow — not when the user is reviewing an old
            // order through "My Orders" in the welcome flow.
            actions.push({ id: 'order_food', title: 'Order Food', description: 'Browse menu & order more' });
          }
          actions.push({ id: 'contact_us', title: 'Contact Us', description: 'Talk to the restaurant' });
          if (!isWelcomeContext) {
            actions.push({ id: 'main_menu', title: 'Main Menu', description: 'Go to main menu' });
          }

          const iconMap = {
            track_order: trackImg,
            cancel_order: cancelImg,
            order_food: orderFoodImg,
            contact_us: contactImg,
            main_menu: mainMenuImg
          };
          actions.forEach(a => { if (iconMap[a.id]) a.image = iconMap[a.id]; });

          if (isWelcomeContext) {
            response = {
              screen: 'ORDER_HELP',
              data: {
                actions,
                order_id: orderIdD,
                flow_token: token
              }
            };
          } else {
            response = {
              screen: 'ORDER_ACTIONS',
              data: {
                actions,
                flow_token: token
              }
            };
          }
        } catch (err) {
          logger.error('[FlowEndpoint] ORDER_DETAILS → ORDER_ACTIONS/HELP error', { orderId: orderIdD, error: err.message, isWelcomeContext });
          response = {
            screen: 'SUCCESS',
            data: { extension_message_response: { params: { flow_token: token, action_result: isWelcomeContext ? 'my_orders' : 'main_menu' } } }
          };
        }
      }

      // ORDER_ACTIONS screen: User selected an action (track/cancel/order_food/main_menu)
      else if (screen === 'ORDER_ACTIONS') {
        const selectedAction = data?.selected_action;
        const token = data?.flow_token || flow_token || '';
        // Parse orderId from flow_token: order_actions_{phone}_{orderId}
        const tokenParts = token.replace('order_actions_', '');
        const lastUnderscore = tokenParts.lastIndexOf('_');
        const phone = tokenParts.substring(0, lastUnderscore);
        const orderId = tokenParts.substring(lastUnderscore + 1);

        if (selectedAction === 'track_order') {
          // Close the flow — webhook will look up the order and send the
          // status-aware "Order Update" card (sendOrderTrackMessage).
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: {
                  flow_token: token,
                  action_result: 'track_order',
                  order_id: orderId
                }
              }
            }
          };
        } else if (selectedAction === 'cancel_order') {
          try {
            const order = await Order.findOne({ orderId });
            if (!order) {
              response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '❌ Not Found', cancel_info: `Order #${orderId} was not found.`, flow_token: token } };
            } else if (['delivered', 'cancelled'].includes(order.status)) {
              response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '❌ Cannot Cancel', cancel_info: `Order is already ${order.status}.`, flow_token: token } };
            } else if (['out_for_delivery', 'preparing'].includes(order.status)) {
              response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '❌ Cannot Cancel', cancel_info: `Order is already being ${order.status.replace('_', ' ')}. Please contact support.`, flow_token: token } };
            } else {
              const { transitionStatus } = require('../services/orderStateMachine');
              const result = transitionStatus(order, 'cancelled', 'Cancelled by customer via flow');
              if (result.success) {
                order.cancellationReason = 'Cancelled by customer';
                await order.save();
                const googleSheets = require('../services/googleSheets');
                googleSheets.updateOrderStatus(orderId, 'cancelled', order.status).catch(() => {});
                const dataEvents = require('../services/eventEmitter');
                dataEvents.emit('orders');
                dataEvents.emit('dashboard');
                response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '✅ Order Cancelled', cancel_info: `Order #${orderId} has been cancelled successfully.`, flow_token: token } };
              } else {
                response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '❌ Cannot Cancel', cancel_info: result.reason || 'Order cannot be cancelled at this stage.', flow_token: token } };
              }
            }
          } catch (err) {
            logger.error('[FlowEndpoint] Order actions cancel error', { orderId, error: err.message });
            response = { screen: 'ORDER_CANCELLED', data: { cancel_heading: '❌ Error', cancel_info: 'Could not cancel order. Please try again.', flow_token: token } };
          }
        } else if (selectedAction === 'order_food') {
          try {
            const images = await getFlowImages();
            const toBase64Thumb = (url) => catalogService._imageUrlToRawBase64(url, { width: 200, height: 200 });
            const allItems = await MenuItem.find({ available: true, isPaused: { $ne: true } })
              .select('name image variants price offerPrice').lean();
            const categoryItems = await Promise.all(allItems.slice(0, 10).map(async (item) => {
              let desc = item.variants?.length > 0 ? `${item.variants.length} variant${item.variants.length > 1 ? 's' : ''} available` : `₹${item.offerPrice || item.price}`;
              const catItem = { id: item._id.toString(), title: item.name.substring(0, 30), description: desc };
              if (item.image) { const b64 = await toBase64Thumb(item.image).catch(() => ''); if (b64) catItem.image = b64; }
              return catItem;
            }));
            if (categoryItems.length > 0) {
              response = { screen: 'MENU_CATEGORIES', data: { categories: categoryItems, flow_token: token } };
            } else {
              response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, action_result: 'no_items' } } } };
            }
          } catch (err) {
            logger.error('[FlowEndpoint] Order actions menu error', { error: err.message });
            response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, action_result: 'order_food' } } } };
          }
        } else {
          // main_menu or unknown → complete flow, webhook handles it
          response = { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, action_result: selectedAction || 'main_menu' } } } };
        }
      }

      // Fallback for any other screen data_exchange
      else {
        const token = data?.flow_token || flow_token || 'welcome_service';
        response = {
          screen: 'SUCCESS',
          data: {
            extension_message_response: {
              params: {
                flow_token: token,
                selected_service: data?.selected_service || '',
                selected_food_type: data?.selected_food_type || ''
              }
            }
          }
        };
      }
    }

    // ─── BACK — user pressed back button on Screen 2 ───
    else if (action === 'BACK') {
      const images = await getFlowImages();
      response = {
        screen: 'SERVICE_SELECT',
        data: {
          services: images.services,
          flow_token: data?.flow_token || flow_token || 'welcome_service'
        }
      };
    }

    // Fallback
    if (!response) {
      logger.warn('[FlowEndpoint] Unhandled action/screen', { action, screen });
      response = {
        screen: 'SERVICE_SELECT',
        data: {
          services: (await getFlowImages()).services,
          flow_token: flow_token || 'welcome_service'
        }
      };
    }

    // Step 2: Encrypt and send response
    const encryptedResponse = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);

    if (typeof encryptedResponse === 'string') {
      // Encrypted base64 string
      res.set('Content-Type', 'text/plain');
      return res.send(encryptedResponse);
    }

    // Plain JSON (no encryption — development mode)
    return res.json(response);

  } catch (error) {
    logger.error('[FlowEndpoint] Handler error', { error: error.message, stack: error.stack });
    return res.status(500).send();
  }
});

module.exports = router;
