/**
 * WhatsApp Flows Data Exchange Endpoint
 * 
 * Handles encrypted requests from WhatsApp Flows (data_api_version 3.0).
 * Actions: ping (health), INIT (initial data), data_exchange (user interaction).
 * 
 * Encryption: RSA-OAEP-256 (key exchange) + AES-128-GCM (data encryption)
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */
const crypto = require('crypto');
const logger = require('./logger');

const FLOW_DATA_API_VERSION = '3.0';

// ===== ENCRYPTION =====

function decryptRequest(encryptedFlowData, encryptedAesKey, initialVector, privateKeyPem) {
  const aesKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encryptedAesKey, 'base64')
  );

  const flowDataBuffer = Buffer.from(encryptedFlowData, 'base64');
  const iv = Buffer.from(initialVector, 'base64');
  const TAG_LENGTH = 16;
  const encData = flowDataBuffer.slice(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.slice(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]);

  return { decryptedBody: JSON.parse(decrypted.toString('utf-8')), aesKey, iv };
}

function encryptResponse(responseData, aesKey, iv) {
  const flippedIv = Buffer.alloc(iv.length);
  for (let i = 0; i < iv.length; i++) flippedIv[i] = ~iv[i] & 0xff;

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const buf = Buffer.concat([cipher.update(JSON.stringify(responseData), 'utf-8'), cipher.final(), cipher.getAuthTag()]);
  return buf.toString('base64');
}

// ===== STATIC DATA =====

const SERVICES = [
  { id: 'order_food', title: 'Order Food' },
  { id: 'my_orders', title: 'My Orders' },
  { id: 'view_offers', title: 'View Offers' },
  { id: 'account_details', title: 'Account Details' },
  { id: 'delivery_address', title: 'Delivery Address' },
  { id: 'open_website', title: 'Visit Website' },
  { id: 'help', title: 'Help & Support' }
];

const FOOD_TYPES = [
  { id: 'food_veg', title: '🟢 Veg' },
  { id: 'food_nonveg', title: '🔴 Non-Veg' },
  { id: 'food_egg', title: '🟡 Egg' }
];

// Placeholder needed when RadioButtonsGroup is hidden but data-source must be non-empty
const FOOD_TYPES_PLACEHOLDER = [{ id: '_none', title: '-' }];

// ===== MAIN HANDLER =====

async function handleFlowEndpoint(req, res) {
  const privateKeyPem = process.env.FLOW_ENDPOINT_PRIVATE_KEY;
  if (!privateKeyPem) {
    return res.status(500).json({ error: 'Flow endpoint not configured' });
  }

  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    return res.status(400).json({ error: 'Missing required encryption fields' });
  }

  let decryptedBody, aesKey, iv;
  try {
    ({ decryptedBody, aesKey, iv } = decryptRequest(encrypted_flow_data, encrypted_aes_key, initial_vector, privateKeyPem));
  } catch (err) {
    logger.error('Flow endpoint decryption failed', { error: err.message });
    return res.status(421).send();
  }

  const { action, data, flow_token } = decryptedBody;
  logger.info('Flow endpoint', { action, flow_token, data: data ? Object.keys(data) : null });

  const send = (resp) => res.send(encryptResponse(resp, aesKey, iv));

  // PING
  if (action === 'ping') {
    return send({ version: FLOW_DATA_API_VERSION, data: { status: 'active' } });
  }

  // INIT — first load, provide all screen data
  if (action === 'INIT') {
    return send({
      version: FLOW_DATA_API_VERSION,
      screen: 'SERVICE_SELECT',
      data: {
        services: SERVICES,
        show_food_types: false,
        food_types: FOOD_TYPES_PLACEHOLDER,
        flow_token: flow_token || 'init'
      }
    });
  }

  // DATA_EXCHANGE — user selected a service
  if (action === 'data_exchange') {
    const selectedService = data?.selected_service;
    logger.info('Flow data_exchange', { selectedService });

    if (selectedService === 'order_food') {
      return send({
        version: FLOW_DATA_API_VERSION,
        screen: 'SERVICE_SELECT',
        data: { show_food_types: true, food_types: FOOD_TYPES }
      });
    } else {
      return send({
        version: FLOW_DATA_API_VERSION,
        screen: 'SERVICE_SELECT',
        data: { show_food_types: false, food_types: FOOD_TYPES_PLACEHOLDER }
      });
    }
  }

  // Unknown
  logger.warn('Flow endpoint unknown action', { action });
  return send({ version: FLOW_DATA_API_VERSION, data: { status: 'unknown' } });
}

module.exports = { handleFlowEndpoint, decryptRequest, encryptResponse, FLOW_DATA_API_VERSION };
