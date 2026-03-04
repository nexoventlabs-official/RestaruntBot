/**
 * WhatsApp Flows Data Exchange Endpoint Service
 * 
 * Handles encrypted data_exchange requests from WhatsApp Flows.
 * When a user interacts with a flow component that has `on-select-action: data_exchange`,
 * WhatsApp sends an encrypted request to this endpoint. We decrypt it, process the action,
 * and return an encrypted response.
 * 
 * Encryption: RSA-OAEP-256 (key exchange) + AES-256-GCM (data encryption)
 * 
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */
const crypto = require('crypto');
const logger = require('./logger');

const FLOW_DATA_API_VERSION = '3.0';

/**
 * Decrypt the incoming WhatsApp Flow request.
 * 
 * @param {string} encryptedFlowData - Base64-encoded encrypted flow data
 * @param {string} encryptedAesKey - Base64-encoded encrypted AES key
 * @param {string} initialVector - Base64-encoded initialization vector
 * @param {string} privateKeyPem - RSA private key in PEM format
 * @returns {{ decryptedBody: object, aesKey: Buffer, iv: Buffer }} Decrypted request data + keys for response
 */
function decryptRequest(encryptedFlowData, encryptedAesKey, initialVector, privateKeyPem) {
  // Step 1: Decrypt the AES key using RSA private key
  const encryptedAesKeyBuffer = Buffer.from(encryptedAesKey, 'base64');
  
  let aesKey;
  try {
    aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      encryptedAesKeyBuffer
    );
  } catch (err) {
    logger.error('Flow endpoint: RSA decryption failed', { error: err.message });
    throw new Error('Failed to decrypt AES key');
  }

  // Step 2: Decrypt the flow data using AES-128-GCM
  const flowDataBuffer = Buffer.from(encryptedFlowData, 'base64');
  const iv = Buffer.from(initialVector, 'base64');

  // The encrypted data contains: ciphertext + auth tag (last 16 bytes)
  const TAG_LENGTH = 16;
  const encryptedData = flowDataBuffer.slice(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.slice(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  let decryptedData;
  try {
    decryptedData = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final()
    ]);
  } catch (err) {
    logger.error('Flow endpoint: AES decryption failed', { error: err.message });
    throw new Error('Failed to decrypt flow data');
  }

  const decryptedBody = JSON.parse(decryptedData.toString('utf-8'));
  return { decryptedBody, aesKey, iv };
}

/**
 * Encrypt the response to send back to WhatsApp.
 * 
 * @param {object} responseData - The response object to encrypt
 * @param {Buffer} aesKey - The AES key (from decryption)
 * @param {Buffer} iv - The initialization vector (from decryption) - flipped for response
 * @returns {string} Base64-encoded encrypted response
 */
function encryptResponse(responseData, aesKey, iv) {
  // Flip the IV for the response (WhatsApp requirement)
  const flippedIv = Buffer.alloc(iv.length);
  for (let i = 0; i < iv.length; i++) {
    flippedIv[i] = ~iv[i] & 0xff;
  }

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const jsonStr = JSON.stringify(responseData);

  const encrypted = Buffer.concat([
    cipher.update(jsonStr, 'utf-8'),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  return encrypted.toString('base64');
}

/**
 * Handle a data_exchange action from the Welcome Flow.
 * Called when user selects a service from the dropdown.
 * Returns updated screen data (show/hide food type section).
 * 
 * @param {object} body - Decrypted request body
 * @returns {object} Response data for the flow
 */
async function handleWelcomeDataExchange(body) {
  const { action, data, screen, flow_token } = body;
  const selectedService = data?.selected_service;

  logger.info('Flow data_exchange: welcome service selected', {
    action,
    screen,
    selectedService,
    flow_token
  });

  if (selectedService === 'order_food') {
    // Show food type selection — fetch images for food types
    const catalogService = require('./catalogService');
    const chatbotImagesService = require('./chatbotImages');

    // Fetch food type images
    const [vegImg, nonvegImg, eggImg] = await Promise.all([
      chatbotImagesService.getImageUrl('flow_food_veg'),
      chatbotImagesService.getImageUrl('flow_food_nonveg'),
      chatbotImagesService.getImageUrl('flow_food_egg')
    ]);

    const toBase64 = (url) => catalogService._imageUrlToRawBase64(url);
    const [vegB64, nonvegB64, eggB64] = await Promise.all([
      toBase64(vegImg),
      toBase64(nonvegImg),
      toBase64(eggImg)
    ]);

    const buildItem = (id, title, description, base64Img) => {
      const item = { id, title, description };
      if (base64Img) item.image = base64Img;
      return item;
    };

    return {
      version: FLOW_DATA_API_VERSION,
      screen: screen || 'SERVICE_SELECT',
      data: {
        show_food_types: true,
        food_types: [
          buildItem('food_veg', '🟢 Veg', 'Pure vegetarian dishes', vegB64),
          buildItem('food_nonveg', '🔴 Non-Veg', 'Non-vegetarian dishes', nonvegB64),
          buildItem('food_egg', '🟡 Egg', 'Egg-based dishes', eggB64)
        ]
      }
    };
  } else {
    // Non-food service — hide food type section
    return {
      version: FLOW_DATA_API_VERSION,
      screen: screen || 'SERVICE_SELECT',
      data: {
        show_food_types: false,
        food_types: []  // Empty array clears the RadioButtonsGroup
      }
    };
  }
}

/**
 * Main handler for the flow endpoint.
 * Decrypts incoming request, routes to appropriate handler, encrypts response.
 * 
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handleFlowEndpoint(req, res) {
  const privateKeyPem = process.env.FLOW_ENDPOINT_PRIVATE_KEY;
  
  if (!privateKeyPem) {
    logger.error('Flow endpoint: FLOW_ENDPOINT_PRIVATE_KEY not configured');
    return res.status(500).json({ error: 'Flow endpoint not configured' });
  }

  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;

  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    logger.warn('Flow endpoint: missing encryption fields', { 
      hasFlowData: !!encrypted_flow_data,
      hasAesKey: !!encrypted_aes_key,
      hasIv: !!initial_vector
    });
    return res.status(400).json({ error: 'Missing required encryption fields' });
  }

  let decryptedBody, aesKey, iv;
  try {
    ({ decryptedBody, aesKey, iv } = decryptRequest(
      encrypted_flow_data,
      encrypted_aes_key,
      initial_vector,
      privateKeyPem
    ));
  } catch (err) {
    logger.error('Flow endpoint: decryption failed', { error: err.message });
    return res.status(421).send(); // 421 = decryption error (Meta convention)
  }

  logger.info('Flow endpoint: decrypted request', {
    action: decryptedBody.action,
    screen: decryptedBody.screen,
    version: decryptedBody.version,
    flow_token: decryptedBody.flow_token
  });

  // Health check — Meta sends a ping action to verify the endpoint
  if (decryptedBody.action === 'ping') {
    const responseData = {
      version: FLOW_DATA_API_VERSION,
      data: { status: 'active' }
    };
    const encrypted = encryptResponse(responseData, aesKey, iv);
    return res.send(encrypted);
  }

  // Handle INIT action — initial screen load
  if (decryptedBody.action === 'INIT') {
    // Return initial data with food types hidden
    const responseData = {
      version: FLOW_DATA_API_VERSION,
      screen: 'SERVICE_SELECT',
      data: {
        show_food_types: false,
        food_types: []
      }
    };
    const encrypted = encryptResponse(responseData, aesKey, iv);
    return res.send(encrypted);
  }

  // Handle data_exchange action
  if (decryptedBody.action === 'data_exchange') {
    try {
      const responseData = await handleWelcomeDataExchange(decryptedBody);
      const encrypted = encryptResponse(responseData, aesKey, iv);
      return res.send(encrypted);
    } catch (err) {
      logger.error('Flow endpoint: data_exchange handler error', { error: err.message });
      // Return a safe fallback (hide food types)
      const fallbackResponse = {
        version: FLOW_DATA_API_VERSION,
        screen: decryptedBody.screen || 'SERVICE_SELECT',
        data: {
          show_food_types: false,
          food_types: []
        }
      };
      const encrypted = encryptResponse(fallbackResponse, aesKey, iv);
      return res.send(encrypted);
    }
  }

  // Unknown action
  logger.warn('Flow endpoint: unknown action', { action: decryptedBody.action });
  const unknownResponse = {
    version: FLOW_DATA_API_VERSION,
    data: { status: 'unknown_action' }
  };
  const encrypted = encryptResponse(unknownResponse, aesKey, iv);
  return res.send(encrypted);
}

module.exports = {
  handleFlowEndpoint,
  decryptRequest,
  encryptResponse,
  handleWelcomeDataExchange,
  FLOW_DATA_API_VERSION
};
