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
let imageCache = { services: null, foodTypes: null, statusImages: null, banner: null, lastFetched: 0 };
const IMAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getFlowImages() {
  const now = Date.now();
  if (imageCache.services && (now - imageCache.lastFetched) < IMAGE_CACHE_TTL) {
    return imageCache;
  }

  logger.info('[FlowEndpoint] Refreshing image cache');

  const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);

  // Fetch all image URLs (services + food types + order statuses)
  const [
    orderFoodImg, myOrdersImg, viewOffersImg, accountDetailsImg, deliveryAddressImg, visitWebsiteImg, helpSupportImg,
    vegImg, nonvegImg, eggImg,
    pendingImg, confirmedImg, preparingImg, readyImg, outForDeliveryImg, deliveredImg, cancelledImg
  ] = await Promise.all([
    chatbotImagesService.getImageUrl('flow_order_food'),
    chatbotImagesService.getImageUrl('flow_my_orders'),
    chatbotImagesService.getImageUrl('flow_view_offers'),
    chatbotImagesService.getImageUrl('flow_account_details'),
    chatbotImagesService.getImageUrl('flow_delivery_address'),
    chatbotImagesService.getImageUrl('flow_visit_website'),
    chatbotImagesService.getImageUrl('flow_help_support'),
    chatbotImagesService.getImageUrl('flow_food_veg'),
    chatbotImagesService.getImageUrl('flow_food_nonveg'),
    chatbotImagesService.getImageUrl('flow_food_egg'),
    chatbotImagesService.getImageUrl('flow_status_pending'),
    chatbotImagesService.getImageUrl('flow_status_confirmed'),
    chatbotImagesService.getImageUrl('flow_status_preparing'),
    chatbotImagesService.getImageUrl('flow_status_ready'),
    chatbotImagesService.getImageUrl('flow_status_out_for_delivery'),
    chatbotImagesService.getImageUrl('flow_status_delivered'),
    chatbotImagesService.getImageUrl('flow_status_cancelled')
  ]);

  // Convert to base64
  const [
    orderFoodB64, myOrdersB64, viewOffersB64, accountDetailsB64, deliveryAddressB64, visitWebsiteB64, helpSupportB64,
    vegB64, nonvegB64, eggB64,
    pendingB64, confirmedB64, preparingB64, readyB64, outForDeliveryB64, deliveredB64, cancelledB64
  ] = await Promise.all([
    toBase64(orderFoodImg), toBase64(myOrdersImg), toBase64(viewOffersImg),
    toBase64(accountDetailsImg), toBase64(deliveryAddressImg), toBase64(visitWebsiteImg),
    toBase64(helpSupportImg), toBase64(vegImg), toBase64(nonvegImg), toBase64(eggImg),
    toBase64(pendingImg), toBase64(confirmedImg), toBase64(preparingImg),
    toBase64(readyImg), toBase64(outForDeliveryImg), toBase64(deliveredImg), toBase64(cancelledImg)
  ]);

  const buildItem = (id, title, description, base64Img) => {
    const item = { id, title, description };
    if (base64Img) item.image = base64Img;
    return item;
  };

  imageCache = {
    services: [
      buildItem('order_food', 'Order Food', 'Browse our menu and place an order', orderFoodB64),
      buildItem('my_orders', 'My Orders', 'Check order status & track delivery', myOrdersB64),
      buildItem('view_offers', 'View Offers', 'See current deals and discounts', viewOffersB64),
      buildItem('account_details', 'Account Details', 'View or update your profile info', accountDetailsB64),
      buildItem('delivery_address', 'Delivery Address', 'Manage your delivery addresses', deliveryAddressB64),
      buildItem('open_website', 'Visit Website', 'View our full website', visitWebsiteB64),
      buildItem('help', 'Help & Support', 'Get assistance with your queries', helpSupportB64)
    ],
    foodTypes: [
      buildItem('food_veg', 'Veg', 'Pure vegetarian dishes', vegB64),
      buildItem('food_nonveg', 'Non-Veg', 'Non-vegetarian dishes', nonvegB64),
      buildItem('food_egg', 'Egg', 'Egg-based dishes', eggB64)
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
    banner: null,
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
      const images = await getFlowImages();

      response = {
        screen: 'SERVICE_SELECT',
        data: {
          services: images.services,
          flow_token: flow_token || 'welcome_service'
        }
      };
    }

    // ─── data_exchange — user tapped Confirm on Screen 1 ───
    else if (action === 'data_exchange') {

      // Screen 1: User selected a service and tapped Confirm
      if (screen === 'SERVICE_SELECT') {
        const selectedService = data?.selected_service;
        const token = data?.flow_token || flow_token || 'welcome_service';

        if (selectedService === 'order_food') {
          // Order Food → navigate to food type selection screen
          const images = await getFlowImages();
          response = {
            screen: 'FOOD_TYPE_SELECT',
            data: {
              food_types: images.foodTypes,
              selected_service: selectedService,
              flow_token: token
            }
          };
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
