const axios = require('axios');
const https = require('https');
const cloudinaryService = require('./cloudinary');
const logger = require('./logger');

// Persistent HTTPS agent — reuses TCP+TLS connections across requests
// Eliminates ~100-300ms handshake overhead per Meta API call
const metaHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,  // Send keep-alive probes every 30s
  maxSockets: 25,         // Allow up to 25 concurrent connections to Meta
  maxFreeSockets: 10,     // Keep 10 idle connections warm
  timeout: 60000,         // Socket-level timeout 60s
  scheduling: 'lifo'      // Reuse most-recently-used connection (best for keep-alive)
});

// Pre-configured axios instance for Meta API calls
const metaApi = axios.create({
  httpsAgent: metaHttpsAgent,
  timeout: 10000,           // 10s request timeout (covers connect + response)
  headers: { 'Content-Type': 'application/json' },
  // Disable response buffering for faster response handling
  maxContentLength: 5 * 1024 * 1024,  // 5MB max
  maxBodyLength: 5 * 1024 * 1024
});

const getConfig = () => ({
  phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
  wabaId: process.env.META_WABA_ID,
  apiVersion: 'v24.0',
  baseUrl: `https://graph.facebook.com/v24.0/${process.env.META_PHONE_NUMBER_ID}`
});

// Transform image URL using Cloudinary for high-quality WhatsApp images
// Menu item images use 1:1 ratio (300x300), chatbot banner images are already optimized
const getSquareImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;
  
  // Skip data URLs
  if (imageUrl.startsWith('data:')) return imageUrl;
  
  // Skip already optimized Cloudinary URLs (chatbot images from admin panel)
  if (imageUrl.includes('cloudinary.com') && imageUrl.includes('restaurant-bot/chatbot-images')) {
    return imageUrl;
  }
  
  // Use Cloudinary for optimized, high-quality images (1:1 for menu items)
  return cloudinaryService.getOptimizedUrl(imageUrl, '1:1');
};

const metaCloud = {
  // Download media file from WhatsApp (for voice messages, images, etc.)
  async downloadMedia(mediaId) {
    try {
      const { accessToken } = getConfig();
      
      // Step 1: Get media URL
      const mediaResponse = await axios.get(`https://graph.facebook.com/v24.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const mediaUrl = mediaResponse.data.url;
      logger.info('Media URL retrieved', { data: mediaUrl });
      
      // Step 2: Download the actual file
      const fileResponse = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer'
      });
      
      logger.info('Media downloaded', { size: fileResponse.data.length });
      return Buffer.from(fileResponse.data);
    } catch (error) {
      logger.error('Media download error', { error: error.response?.data || error.message });
      throw error;
    }
  },

  async sendMessage(phone, message) {
    try {
      const { baseUrl, accessToken, phoneNumberId } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendMessage', { to, messageLength: message.length });
      
      const response = await metaApi.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendMessage success', { messageId: response.data?.messages?.[0]?.id || 'sent' });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta Cloud send error', {
        code: errorData?.code,
        message: errorData?.message,
        type: errorData?.type,
        status: error.response?.status
      });
      throw error;
    }
  },

  async sendButtons(phone, message, buttons, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendButtons', { to });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message },
          footer: footer ? { text: footer } : undefined,
          action: {
            buttons: buttons.slice(0, 3).map((btn, i) => ({
              type: 'reply',
              reply: {
                id: btn.id || String(i + 1),
                title: (btn.text || btn).substring(0, 20)
              }
            }))
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendButtons success');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta buttons error', { error: errorData?.message || error.message });
      return this.sendMessage(phone, message + '\n\n' + buttons.map((b, i) => `${i + 1}. ${b.text || b}`).join('\n'));
    }
  },

  async sendList(phone, title, description, buttonText, sections, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      logger.info('Sending Meta list', { to });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: title.substring(0, 60) },
          body: { text: description.substring(0, 1024) },
          footer: footer ? { text: footer.substring(0, 60) } : undefined,
          action: {
            button: buttonText.substring(0, 20),
            sections: sections.map(section => ({
              title: section.title.substring(0, 24),
              rows: section.rows.slice(0, 10).map(row => ({
                id: row.rowId || row.id,
                title: row.title.substring(0, 24),
                description: row.description?.substring(0, 72) || ''
              }))
            }))
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta list success');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta list error', { error: errorData?.message || error.message });
      let fallback = `*${title}*\n\n${description}\n`;
      sections.forEach(s => {
        fallback += `\n*${s.title}*\n`;
        s.rows.forEach((r, i) => { fallback += `${i + 1}. ${r.title}\n`; });
      });
      return this.sendMessage(phone, fallback);
    }
  },

  async sendTemplateButtons(phone, message, buttons, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      // Check if any button has URL
      const hasUrl = buttons.some(b => b.url);
      
      if (hasUrl) {
        // Send as text with link
        let msg = message + (footer ? `\n\n${footer}` : '') + '\n\n';
        buttons.forEach(btn => {
          if (btn.url) msg += `🔗 *${btn.text}:* ${btn.url}\n`;
          else msg += `• ${btn.text}\n`;
        });
        return this.sendMessage(phone, msg);
      } else {
        return this.sendButtons(phone, message, buttons, footer);
      }
    } catch (error) {
      logger.error('Meta Cloud template error', { error: error.message });
      throw error;
    }
  },

  async sendOrder(phone, order, items, paymentUrl, imageUrl = null) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      // Build order message
      let orderMsg = `Order #${order.orderId}\n⏳ Order pending\n\n`;
      items.forEach(item => {
        orderMsg += `*${item.name}*\nQuantity ${item.quantity}    ₹${item.quantity * item.price}.00\n\n`;
      });
      orderMsg += `━━━━━━━━━━━━━━━\n`;
      
      // Show items total if delivery charge exists
      if (order.deliveryCharge && order.deliveryCharge > 0) {
        orderMsg += `*Items Total*    ₹${order.itemsTotal || (order.totalAmount - order.deliveryCharge)}.00\n`;
        orderMsg += `*Delivery Charge*    ₹${order.deliveryCharge}.00\n`;
        orderMsg += `━━━━━━━━━━━━━━━\n`;
      }
      
      orderMsg += `*Total*    ₹${order.totalAmount}.00\n\n`;
      orderMsg += `💳 Select your UPI app to pay`;

      // Build CTA payload - with optional image header
      const ctaPayload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: imageUrl ? {
            type: 'image',
            image: { link: getSquareImageUrl(imageUrl) }
          } : {
            type: 'text',
            text: 'Order details'
          },
          body: {
            text: orderMsg
          },
          footer: {
            text: 'Tap to select UPI app & pay securely'
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Pay Now',
              url: paymentUrl
            }
          }
        }
      };

      logger.info('Sending order with CTA', { payload: ctaPayload });
      const response = await metaApi.post(`${baseUrl}/messages`, ctaPayload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Order sent', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud order error', { error: error.response?.data || error.message });
      
      // Fallback: simple text message with link
      let orderMsg = `🧾 *ORDER #${order.orderId}*\n⏳ Order pending\n\n`;
      items.forEach(item => {
        orderMsg += `*${item.name}*\nQty: ${item.quantity} × ₹${item.price} = ₹${item.quantity * item.price}\n\n`;
      });
      orderMsg += `━━━━━━━━━━━━━━━\n`;
      
      // Show items total if delivery charge exists (fallback)
      if (order.deliveryCharge && order.deliveryCharge > 0) {
        orderMsg += `*Items Total: ₹${order.itemsTotal || (order.totalAmount - order.deliveryCharge)}*\n`;
        orderMsg += `*Delivery Charge: ₹${order.deliveryCharge}*\n`;
      }
      
      orderMsg += `*Total: ₹${order.totalAmount}*\n\n`;
      orderMsg += `💳 *Pay here (Select UPI App):*\n${paymentUrl}`;

      return this.sendMessage(phone, orderMsg);
    }
  },

  async sendImage(phone, imageUrl, caption = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      // Transform to square image for consistent display
      const squareImageUrl = getSquareImageUrl(imageUrl);
      
      const response = await metaApi.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: squareImageUrl, caption }
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud image error', { error: error.response?.data || error.message });
      // Fallback to text message
      return this.sendMessage(phone, caption);
    }
  },

  async sendImageWithButtons(phone, imageUrl, message, buttons, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendImageWithButtons', { to });
      
      // Transform to square image for consistent display
      const squareImageUrl = getSquareImageUrl(imageUrl);
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: {
            type: 'image',
            image: { link: squareImageUrl }
          },
          body: { text: message },
          footer: footer ? { text: footer } : undefined,
          action: {
            buttons: buttons.slice(0, 3).map((btn, i) => ({
              type: 'reply',
              reply: {
                id: btn.id || String(i + 1),
                title: (btn.text || btn).substring(0, 20)
              }
            }))
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendImageWithButtons response', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud image buttons error', { error: error.response?.data || error.message });
      // Fallback to regular buttons
      return this.sendButtons(phone, message, buttons, footer);
    }
  },

  // Send location request - opens WhatsApp location picker directly
  async sendLocationRequest(phone, message) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendLocationRequest', { to });
      
      // Use location_request_message type - this opens the location picker directly!
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: {
            text: message
          },
          action: {
            name: 'send_location'
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta location request response', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud location request error', { error: error.response?.data || error.message });
      // Fallback to buttons if location_request_message not supported
      return this.sendButtons(phone, message, [
        { id: 'share_location', text: 'Share Location' },
        { id: 'skip_location', text: 'Skip' },
        { id: 'clear_cart', text: 'Cancel' }
      ], 'Tap to share your delivery location');
    }
  },

  // Send image with CTA URL button - for external links with image header
  async sendImageWithCtaUrl(phone, imageUrl, message, buttonText, url, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendImageWithCtaUrl', { to });
      
      // Transform to square image for consistent display
      const squareImageUrl = getSquareImageUrl(imageUrl);
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: {
            type: 'image',
            image: { link: squareImageUrl }
          },
          body: {
            text: message
          },
          footer: footer ? { text: footer } : undefined,
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: url
            }
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendImageWithCtaUrl success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud image CTA URL error', { error: error.response?.data || error.message });
      // Fallback to CTA URL without image
      return this.sendCtaUrl(phone, message, buttonText, url, footer);
    }
  },

  // Send image with CTA URL button in original ratio - for offers/promotions
  async sendImageWithCtaUrlOriginal(phone, imageUrl, message, buttonText, url, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendImageWithCtaUrlOriginal', { to });
      
      // Use original image URL without transformation
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: {
            type: 'image',
            image: { link: imageUrl }
          },
          body: {
            text: message
          },
          footer: footer ? { text: footer } : undefined,
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: url
            }
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendImageWithCtaUrlOriginal success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud image CTA URL original error', { error: error.response?.data || error.message });
      // Fallback to CTA URL without image
      return this.sendCtaUrl(phone, message, buttonText, url, footer);
    }
  },

  // Send CTA URL button - for external links like Google Review
  async sendCtaUrl(phone, message, buttonText, url, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendCtaUrl', { to });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text: message
          },
          footer: footer ? { text: footer } : undefined,
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: url
            }
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendCtaUrl success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud CTA URL error', { error: error.response?.data || error.message });
      // Fallback to text message with link
      return this.sendMessage(phone, `${message}\n\n🔗 ${buttonText}: ${url}`);
    }
  },

  // Send CTA phone call button - for customer support
  async sendCtaPhone(phone, message, buttonText, phoneNumber, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendCtaPhone', { to });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text: message
          },
          footer: footer ? { text: footer } : undefined,
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: `tel:${phoneNumber.replace(/\D/g, '')}`
            }
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendCtaPhone success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud CTA Phone error', { error: error.response?.data || error.message });
      // Fallback to text message with phone number
      return this.sendMessage(phone, `${message}\n\n📞 ${buttonText}: ${phoneNumber}`);
    }
  },

  // Send image with CTA phone call button
  async sendImageWithCtaPhone(phone, imageUrl, message, buttonText, phoneNumber, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendImageWithCtaPhone', { to });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: {
            type: 'image',
            image: {
              link: imageUrl
            }
          },
          body: {
            text: message
          },
          footer: footer ? { text: footer } : undefined,
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: `tel:${phoneNumber.replace(/\D/g, '')}`
            }
          }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendImageWithCtaPhone success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud image CTA Phone error', { error: error.response?.data || error.message });
      // Fallback to CTA Phone without image
      return this.sendCtaPhone(phone, message, buttonText, phoneNumber, footer);
    }
  },

  // Send a marketing template message (works outside 24-hour window)
  // This requires a pre-approved template in your WhatsApp Business Manager
  // Template name: "offer_broadcast" with header image, body text, and CTA button
  async sendMarketingTemplate(phone, templateName, imageUrl, bodyParams = [], buttonUrl = null) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendMarketingTemplate', { to, template: templateName, bodyParamCount: bodyParams?.length || 0, hasImage: !!imageUrl, hasButton: !!buttonUrl });
      
      // Build components array
      const components = [];
      
      // Add header with image if provided
      if (imageUrl) {
        components.push({
          type: 'header',
          parameters: [{
            type: 'image',
            image: { link: imageUrl }
          }]
        });
      }
      
      // Add body parameters if provided
      if (bodyParams && bodyParams.length > 0) {
        components.push({
          type: 'body',
          parameters: bodyParams.map(param => ({
            type: 'text',
            text: param
          }))
        });
      }
      
      // Add button URL if provided (for dynamic URL templates)
      if (buttonUrl) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{
            type: 'text',
            text: buttonUrl
          }]
        });
      }
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: components.length > 0 ? components : undefined
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const messageId = response.data?.messages?.[0]?.id || null;
      const messageStatus = response.data?.messages?.[0]?.message_status || null;
      logger.info('Meta sendMarketingTemplate success', { to, messageId, messageStatus });
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud marketing template error', { error: error.response?.data || error.message });
      throw error;
    }
  },

  // Send a simple text-only template (hello_world style - works outside 24-hour window)
  async sendSimpleTemplate(phone, templateName = 'hello_world', languageCode = 'en_US') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      logger.info('Meta sendSimpleTemplate', { to, template: templateName });
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode }
        }
      };
      
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendSimpleTemplate success');
      return response.data;
    } catch (error) {
      logger.error('Meta Cloud simple template error', { error: error.response?.data || error.message });
      throw error;
    }
  },

  // ========== TEMPLATE MANAGEMENT (Meta Business Management API) ==========

  /**
   * Upload an image to Meta's Resumable Upload API to get a handle
   * for use in template creation (header_handle).
   * Requires META_APP_ID environment variable.
   *
   * @param {string} imageUrl - Public URL of the image to upload
   * @returns {string|null} The file handle (e.g. "4:aW1h..."), or null on failure
   */
  async uploadMediaForTemplate(imageUrl) {
    try {
      const { accessToken } = getConfig();
      const appId = process.env.META_APP_ID;

      if (!appId) {
        logger.warn('META_APP_ID not set — cannot upload image for template header');
        return null;
      }

      if (!imageUrl) return null;

      logger.info('Uploading image for template header', { imageUrl: imageUrl.substring(0, 80) });

      // Step 1: Download the image from our server / CDN
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const imageBuffer = Buffer.from(imageResponse.data);
      const contentType = imageResponse.headers['content-type'] || 'image/jpeg';

      // Step 2: Create an upload session
      const sessionResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${appId}/uploads`,
        null,
        {
          params: {
            file_length: imageBuffer.length,
            file_type: contentType,
            access_token: accessToken
          }
        }
      );

      const uploadSessionId = sessionResponse.data.id;
      if (!uploadSessionId) {
        logger.error('No upload session ID returned from Meta');
        return null;
      }

      logger.info('Upload session created', { sessionId: uploadSessionId });

      // Step 3: Upload the actual file bytes
      const uploadResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${uploadSessionId}`,
        imageBuffer,
        {
          headers: {
            Authorization: `OAuth ${accessToken}`,
            file_offset: '0',
            'Content-Type': 'application/octet-stream'
          }
        }
      );

      const fileHandle = uploadResponse.data.h;
      if (!fileHandle) {
        logger.error('No file handle returned from Meta upload', { data: uploadResponse.data });
        return null;
      }

      logger.info('Image uploaded to Meta successfully', { handle: fileHandle.substring(0, 30) + '...' });
      return fileHandle;
    } catch (error) {
      const errData = error.response?.data?.error || error.response?.data || error.message;
      logger.error('Meta image upload error (will create template without image)', { error: errData });
      return null; // Graceful fallback — template will be created without image
    }
  },

  /**
   * Create a marketing message template for an offer.
   * Requires META_WABA_ID (WhatsApp Business Account ID).
   * Template goes through Meta review (PENDING → APPROVED / REJECTED).
   *
   * If headerImageUrl is provided and META_APP_ID is set, the image is uploaded
   * to Meta's Resumable Upload API first. If upload fails, template is created
   * without an image header (graceful fallback).
   *
   * @param {string} templateName - Unique lowercase name (a-z, 0-9, underscore)
   * @param {string} headerImageUrl - Public image URL for template header
   * @param {string} bodyText - Template body (may contain {{1}}, {{2}}, etc.)
   * @param {string} footerText - Optional footer
   * @param {string} ctaUrl - CTA button URL (may contain {{1}} for dynamic suffix)
   * @param {string} ctaLabel - CTA button text
   * @returns {Object} Meta API response with template id / status
   */
  async createMessageTemplate(templateName, headerImageUrl, bodyText, footerText, ctaUrl, ctaLabel) {
    try {
      const { accessToken } = getConfig();
      const wabaId = process.env.META_WABA_ID;

      if (!wabaId) {
        throw new Error('META_WABA_ID not configured. Set your WhatsApp Business Account ID in .env');
      }

      logger.info('Meta createMessageTemplate', { templateName });

      const components = [];

      // Header with image (requires uploading to Meta first)
      if (headerImageUrl) {
        const fileHandle = await this.uploadMediaForTemplate(headerImageUrl);
        if (fileHandle) {
          components.push({
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: [fileHandle] }
          });
          logger.info('Template will include IMAGE header');
        } else {
          logger.warn('Image upload failed — template will be created without image header');
        }
      }

      // Body with variable placeholders
      const bodyComponent = { type: 'BODY', text: bodyText };
      // Count {{n}} placeholders to build example values
      const placeholders = bodyText.match(/\{\{\d+\}\}/g) || [];
      if (placeholders.length > 0) {
        bodyComponent.example = {
          body_text: [placeholders.map((_, i) => `Sample ${i + 1}`)]
        };
      }
      components.push(bodyComponent);

      // Footer
      if (footerText) {
        components.push({ type: 'FOOTER', text: footerText });
      }

      // CTA button
      if (ctaUrl) {
        const btnComponent = {
          type: 'BUTTONS',
          buttons: [{
            type: 'URL',
            text: ctaLabel || 'Order Now',
            url: ctaUrl
          }]
        };
        // If ctaUrl contains {{1}}, mark it as dynamic
        if (ctaUrl.includes('{{1}}')) {
          btnComponent.buttons[0].example = [ctaUrl.replace('{{1}}', 'sample')];
        }
        components.push(btnComponent);
      }

      const payload = {
        name: templateName,
        language: 'en',
        category: 'MARKETING',
        components
      };

      logger.info('Submitting template to Meta', { templateName, componentTypes: components.map(c => c.type) });

      const response = await metaApi.post(
        `https://graph.facebook.com/v24.0/${wabaId}/message_templates`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('Meta createMessageTemplate success', { id: response.data.id, status: response.data.status });
      return response.data;
    } catch (error) {
      const errData = error.response?.data?.error || error.response?.data || error.message;
      logger.error('Meta createMessageTemplate error', { error: errData });
      throw error;
    }
  },

  /**
   * Get the status of a message template by name.
   */
  async getTemplateStatus(templateName) {
    try {
      const { accessToken } = getConfig();
      const wabaId = process.env.META_WABA_ID;

      if (!wabaId) {
        throw new Error('META_WABA_ID not configured');
      }

      const response = await axios.get(
        `https://graph.facebook.com/v24.0/${wabaId}/message_templates`,
        {
          params: { name: templateName },
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      const templates = response.data?.data || [];
      if (templates.length === 0) {
        return { status: 'NOT_FOUND', templateName };
      }

      const tpl = templates[0];
      return {
        id: tpl.id,
        name: tpl.name,
        status: tpl.status, // APPROVED, PENDING, REJECTED
        category: tpl.category,
        rejectedReason: tpl.rejected_reason || null
      };
    } catch (error) {
      logger.error('Meta getTemplateStatus error', { error: error.response?.data || error.message });
      throw error;
    }
  },

  // ========== WHATSAPP CATALOG / COMMERCE MESSAGES ==========

  /**
   * Send a catalog_message that shows the entire WhatsApp catalog.
   * Users tap "View catalog" to browse all products natively.
   * 
   * @param {string} phone - Recipient phone number
   * @param {string} bodyText - Body text (max 1024 chars)
   * @param {string} footerText - Optional footer text (max 60 chars)
   * @param {string} thumbnailRetailerId - Optional product retailer_id for thumbnail
   */
  async sendCatalogMessage(phone, bodyText, footerText = '', thumbnailRetailerId = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');

      logger.info('Meta sendCatalogMessage', { to });

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'catalog_message',
          body: { text: bodyText.substring(0, 1024) },
          action: {
            name: 'catalog_message',
          }
        }
      };

      if (footerText) {
        payload.interactive.footer = { text: footerText.substring(0, 60) };
      }

      if (thumbnailRetailerId) {
        payload.interactive.action.parameters = {
          thumbnail_product_retailer_id: thumbnailRetailerId
        };
      }

      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendCatalogMessage success');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta sendCatalogMessage error', {
        error: errorData?.message || error.message,
        code: errorData?.code
      });
      throw error;
    }
  },

  /**
   * Send a single product message from the WhatsApp Commerce catalog.
   * Shows product card with image, name, price, description inside WhatsApp.
   * 
   * @param {string} phone - Recipient phone number
   * @param {string} catalogId - Meta Commerce catalog ID (from env META_CATALOG_ID)
   * @param {string} retailerId - Product retailer_id in the catalog
   * @param {string} bodyText - Optional body text above the product card
   * @param {string} footerText - Optional footer text
   */
  async sendProduct(phone, catalogId, retailerId, bodyText = '', footerText = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');

      logger.info('Meta sendProduct', { to, catalogId, retailerId });

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'product',
          body: bodyText ? { text: bodyText.substring(0, 1024) } : undefined,
          footer: footerText ? { text: footerText.substring(0, 60) } : undefined,
          action: {
            catalog_id: catalogId,
            product_retailer_id: retailerId
          }
        }
      };

      // Remove undefined fields
      if (!payload.interactive.body) delete payload.interactive.body;
      if (!payload.interactive.footer) delete payload.interactive.footer;

      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendProduct success', { retailerId });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta sendProduct error', {
        error: errorData?.message || error.message,
        retailerId
      });
      throw error;
    }
  },

  /**
   * Send a multi-product message (product list) from the WhatsApp Commerce catalog.
   * Shows a catalog-style browsable list with product images, names, prices.
   * Users can tap items to view details, add to cart, and submit orders natively.
   * 
   * @param {string} phone - Recipient phone number
   * @param {string} catalogId - Meta Commerce catalog ID
   * @param {string} headerText - Header text (max 60 chars)
   * @param {string} bodyText - Body text (max 1024 chars)
   * @param {Array} sections - Array of { title, productRetailerIds: [string] }
   * @param {string} footerText - Optional footer
   */
  async sendProductList(phone, catalogId, headerText, bodyText, sections, footerText = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');

      logger.info('Meta sendProductList', { to, catalogId, sectionCount: sections.length });

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'product_list',
          header: {
            type: 'text',
            text: headerText.substring(0, 60)
          },
          body: {
            text: bodyText.substring(0, 1024)
          },
          footer: footerText ? { text: footerText.substring(0, 60) } : undefined,
          action: {
            catalog_id: catalogId,
            sections: sections.map(section => ({
              title: section.title.substring(0, 24),
              product_items: section.productRetailerIds.slice(0, 30).map(id => ({
                product_retailer_id: id
              }))
            }))
          }
        }
      };

      if (!payload.interactive.footer) delete payload.interactive.footer;

      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('Meta sendProductList success', { sectionCount: sections.length });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('Meta sendProductList error', {
        error: errorData?.message || error.message,
        code: errorData?.code
      });
      throw error;
    }
  },

  // ========== COMMERCE CATALOG PRODUCT CRUD ==========

  /**
   * Create or update a single product in the Meta Commerce Catalog.
   * Uses the Catalog Batch API to add/update products.
   * 
   * @param {string} catalogId - Meta Commerce catalog ID
   * @param {Object} product - Product data
   * @param {string} product.retailerId - Unique retailer ID for the product
   * @param {string} product.name - Product name
   * @param {string} product.description - Product description
   * @param {number} product.price - Price (in rupees, will convert to paise)
   * @param {string} product.currency - Currency code (default: INR)
   * @param {string} product.imageUrl - Product image URL
   * @param {string} product.category - Product category
   * @param {string} product.availability - 'in stock' or 'out of stock'
   */
  async createOrUpdateCatalogProduct(catalogId, product) {
    return this.batchCreateOrUpdateProducts(catalogId, [product]);
  },

  /**
   * Batch create/update multiple products using the Marketing API /batch endpoint.
   * This is the endpoint WhatsApp indexes products from.
   * Meta allows up to 20 products per request.
   * 
   * @param {string} catalogId - Meta Commerce catalog ID
   * @param {Array} products - Array of product objects (max 20)
   */
  async batchCreateOrUpdateProducts(catalogId, products) {
    try {
      const { accessToken } = getConfig();

      if (!catalogId) {
        throw new Error('META_CATALOG_ID not configured');
      }

      logger.info('Meta batchCreateOrUpdateProducts', { catalogId, count: products.length });

      // --- Marketing API /batch (WhatsApp indexes from this) ---
      const batchRequests = products.map(product => {
        // Price must be integer in smallest currency unit (paise for INR)
        const priceInPaise = Math.round(product.price * 100);
        const link = product.url || process.env.WEBSITE_URL || process.env.BACKEND_URL || 'https://wa.me/' + (process.env.META_PHONE_NUMBER_ID || '');

        const req = {
          method: 'UPDATE',
          retailer_id: product.retailerId,
          data: {
            name: product.name,
            description: product.description || product.name,
            availability: product.availability || 'in stock',
            price: priceInPaise,
            currency: product.currency || 'INR',
            url: link,
            category: 'Food, Beverages & Tobacco > Food Items',
          }
        };

        // If sale price is provided and less than regular price, set it
        if (product.salePrice && product.salePrice < product.price) {
          req.data.sale_price = Math.round(product.salePrice * 100);
          req.data.sale_price_effective_date = product.salePriceEffectiveDate || '';
        }

        if (product.imageUrl) {
          req.data.image_url = product.imageUrl;
        }

        return req;
      });

      const batchResponse = await metaApi.post(
        `https://graph.facebook.com/v24.0/${catalogId}/batch`,
        { requests: batchRequests },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('Meta batchCreateOrUpdateProducts success', {
        count: products.length,
        handles: batchResponse.data?.handles
      });

      return batchResponse.data;
    } catch (error) {
      const errorData = error.response?.data?.error || error.response?.data;
      logger.error('Meta batchCreateOrUpdateProducts error', {
        error: errorData?.message || error.message,
        count: products.length
      });
      throw error;
    }
  },

  /**
   * Delete a product from the Meta Commerce Catalog.
   * 
   * @param {string} catalogId - Meta Commerce catalog ID
   * @param {string} retailerId - The retailer_id of the product to delete
   */
  async deleteCatalogProduct(catalogId, retailerId) {
    try {
      const { accessToken } = getConfig();

      if (!catalogId) {
        throw new Error('META_CATALOG_ID not configured');
      }

      logger.info('Meta deleteCatalogProduct', { catalogId, retailerId });

      // Marketing API /batch DELETE
      const batchPayload = {
        requests: [{
          method: 'DELETE',
          retailer_id: retailerId
        }]
      };

      const response = await metaApi.post(
        `https://graph.facebook.com/v24.0/${catalogId}/batch`,
        batchPayload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('Meta deleteCatalogProduct success', { retailerId });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error || error.response?.data;
      logger.error('Meta deleteCatalogProduct error', {
        error: errorData?.message || error.message,
        retailerId
      });
      throw error;
    }
  },

  /**
   * Send order_details interactive message for WhatsApp native payment (UPI).
   * Triggers the in-chat payment flow: review items → choose UPI app → pay.
   *
   * @param {string} phone - Customer phone
   * @param {string} referenceId - Unique order/reference ID
   * @param {Array} items - Array of { retailerId, name, priceAmount, quantity, saleAmount? }
   *        priceAmount/saleAmount are in rupees (will be converted to paise × 100)
   * @param {number} totalAmount - Grand total in rupees
   * @param {number} [tax=0] - Tax in rupees
   * @param {number} [shipping=0] - Shipping/delivery charge in rupees
   * @param {number} [discount=0] - Discount in rupees
   * @returns {Object} Meta API response
   */
  async sendOrderDetails(phone, referenceId, items, totalAmount, { tax = 0, shipping = 0, discount = 0 } = {}) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      const catalogId = process.env.META_CATALOG_ID;
      const paymentConfig = process.env.WHATSAPP_PAYMENT_CONFIG || process.env.RAZORPAY_CONFIG_ID;

      if (!catalogId) throw new Error('META_CATALOG_ID not configured');
      if (!paymentConfig) throw new Error('WHATSAPP_PAYMENT_CONFIG / RAZORPAY_CONFIG_ID not configured');

      // Convert rupees to paise offset (offset 100 → value in paise)
      const toPaise = (rupees) => Math.round(Number(rupees) * 100);

      const orderItems = items.map(item => {
        const obj = {
          retailer_id: item.retailerId,
          name: item.name,
          amount: {
            value: toPaise(item.priceAmount),
            offset: 100
          },
          quantity: item.quantity
        };
        // If sale/discounted price differs from original, add sale_amount
        if (item.saleAmount != null && item.saleAmount !== item.priceAmount) {
          obj.sale_amount = {
            value: toPaise(item.saleAmount),
            offset: 100
          };
        }
        return obj;
      });

      const subtotal = items.reduce((sum, i) => {
        const price = i.saleAmount != null ? i.saleAmount : i.priceAmount;
        return sum + price * i.quantity;
      }, 0);

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'order_details',
          header: {
            type: 'image',
            image: {
              link: 'https://res.cloudinary.com/dzmmp2dxy/image/upload/v1/rb/order_payment'
            }
          },
          body: {
            text: `🧾 *Order #${referenceId}*\nReview your items and pay securely via UPI.`
          },
          footer: {
            text: 'Powered by WhatsApp Pay'
          },
          action: {
            name: 'review_and_pay',
            parameters: {
              reference_id: referenceId,
              type: 'digital-goods',
              payment_type: 'upi',
              payment_configuration: paymentConfig,
              currency: 'INR',
              total_amount: {
                value: toPaise(totalAmount),
                offset: 100
              },
              order: {
                status: 'pending',
                catalog_id: catalogId,
                expiration: {
                  timestamp: Math.floor(Date.now() / 1000) + 900, // 15 min expiry
                  description: 'Order expires in 15 minutes'
                },
                items: orderItems,
                subtotal: {
                  value: toPaise(subtotal),
                  offset: 100
                },
                tax: {
                  value: toPaise(tax),
                  offset: 100,
                  description: 'Tax'
                },
                shipping: {
                  value: toPaise(shipping),
                  offset: 100,
                  description: 'Delivery charge'
                },
                discount: {
                  value: toPaise(discount),
                  offset: 100,
                  description: 'Discount'
                }
              }
            }
          }
        }
      };

      logger.info('Sending order_details for native payment', { to, referenceId, totalAmount, itemCount: items.length });
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('order_details sent', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Meta sendOrderDetails error', {
        error: error.response?.data || error.message,
        referenceId
      });
      throw error;
    }
  },

  /**
   * Send order_status message to confirm payment outcome.
   * Used after receiving payment webhook to update the customer.
   *
   * @param {string} phone - Customer phone
   * @param {string} referenceId - Same reference_id used in order_details
   * @param {string} status - 'completed' | 'canceled' | 'pending'
   * @param {string} [description] - Status description text
   */
  async sendOrderStatusUpdate(phone, referenceId, status, description = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      const paymentConfig = process.env.WHATSAPP_PAYMENT_CONFIG || process.env.RAZORPAY_CONFIG_ID;

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'order_status',
          body: {
            text: description || (status === 'completed' ? '✅ Payment received! Your order is confirmed.' : `Order status: ${status}`)
          },
          action: {
            name: 'review_order',
            parameters: {
              reference_id: referenceId,
              order: {
                status,
                description: description || `Order ${status}`
              },
              payment_configuration: paymentConfig
            }
          }
        }
      };

      logger.info('Sending order_status update', { to, referenceId, status });
      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      logger.info('order_status sent', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Meta sendOrderStatusUpdate error', {
        error: error.response?.data || error.message,
        referenceId,
        status
      });
      throw error;
    }
  },

  /**
   * Delete a message template by name.
   */
  async deleteMessageTemplate(templateName) {
    try {
      const { accessToken } = getConfig();
      const wabaId = process.env.META_WABA_ID;

      if (!wabaId) {
        throw new Error('META_WABA_ID not configured');
      }

      const response = await axios.delete(
        `https://graph.facebook.com/v24.0/${wabaId}/message_templates`,
        {
          params: { name: templateName },
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      logger.info('Meta deleteMessageTemplate success', { templateName });
      return response.data;
    } catch (error) {
      logger.error('Meta deleteMessageTemplate error', { error: error.response?.data || error.message });
      throw error;
    }
  },

  // ========== CATALOG COLLECTIONS (Product Sets) ==========

  /**
   * Create or update a product set (collection) in the Meta catalog.
   * Collections show as horizontal category tiles with images at the top of the WhatsApp catalog.
   *
   * @param {string} catalogId - Meta catalog ID
   * @param {Object} collection - Collection data
   * @param {string} collection.name - Collection name (category name)
   * @param {Array<string>} collection.retailerIds - Product retailer IDs to include
   * @param {string} [collection.coverImageUrl] - Cover image URL (min 600x600)
   * @param {string} [collection.description] - Description (max 200 chars)
   * @param {string} [collection.productSetId] - Existing product set ID (for updates)
   * @returns {Object} { id } of created/updated product set
   */
  async createOrUpdateCollection(catalogId, collection) {
    try {
      const { accessToken } = getConfig();

      if (!catalogId) throw new Error('META_CATALOG_ID not configured');

      const filter = {
        retailer_id: {
          is_any: collection.retailerIds
        }
      };

      const metadata = {};
      if (collection.coverImageUrl) {
        metadata.cover_image_url = collection.coverImageUrl;
      }
      if (collection.description) {
        metadata.description = collection.description.substring(0, 200);
      }

      const params = {
        name: collection.name,
        filter: JSON.stringify(filter),
        access_token: accessToken
      };

      if (Object.keys(metadata).length > 0) {
        params.metadata = JSON.stringify(metadata);
      }

      let response;
      if (collection.productSetId) {
        // Update existing product set
        response = await metaApi.post(
          `https://graph.facebook.com/v24.0/${collection.productSetId}`,
          params
        );
        logger.info('Meta collection updated', { name: collection.name, id: collection.productSetId });
      } else {
        // Create new product set
        response = await metaApi.post(
          `https://graph.facebook.com/v24.0/${catalogId}/product_sets`,
          params
        );
        logger.info('Meta collection created', { name: collection.name, id: response.data?.id });
      }

      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error || error.response?.data;
      logger.error('Meta createOrUpdateCollection error', {
        name: collection.name,
        error: errorData?.message || error.message
      });
      throw error;
    }
  },

  /**
   * Get all product sets (collections) for a catalog.
   *
   * @param {string} catalogId - Meta catalog ID
   * @returns {Array} List of product sets with id, name, metadata
   */
  async getCollections(catalogId) {
    try {
      const { accessToken } = getConfig();

      if (!catalogId) throw new Error('META_CATALOG_ID not configured');

      const response = await metaApi.get(
        `https://graph.facebook.com/v24.0/${catalogId}/product_sets`,
        {
          params: {
            fields: 'id,name,latest_metadata{cover_image_url,description,integrity_review_status},live_metadata{cover_image_url,description}',
            access_token: accessToken
          }
        }
      );

      return response.data?.data || [];
    } catch (error) {
      logger.error('Meta getCollections error', { error: error.response?.data?.error?.message || error.message });
      throw error;
    }
  },

  /**
   * Delete a product set (collection) from the catalog.
   *
   * @param {string} productSetId - The product set ID to delete
   */
  async deleteCollection(productSetId) {
    try {
      const { accessToken } = getConfig();

      const response = await metaApi.delete(
        `https://graph.facebook.com/v24.0/${productSetId}`,
        { params: { access_token: accessToken } }
      );

      logger.info('Meta collection deleted', { id: productSetId });
      return response.data;
    } catch (error) {
      logger.error('Meta deleteCollection error', { id: productSetId, error: error.response?.data?.error?.message || error.message });
      throw error;
    }
  },

  // ============ WHATSAPP FLOWS API ============

  /**
   * Create a new WhatsApp Flow under the WABA.
   * @param {string} name - Flow name
   * @param {string[]} categories - Flow categories, e.g. ['OTHER']
   * @param {string} [flowJson] - Optional Flow JSON string to create+publish in one request
   * @returns {{ id: string, success: boolean, validation_errors: Array }}
   */
  async createFlow(name, categories = ['OTHER'], flowJson = null) {
    try {
      const { accessToken, wabaId } = getConfig();
      const data = { name, categories };
      if (flowJson) {
        data.flow_json = flowJson;
      }

      const response = await metaApi.post(
        `https://graph.facebook.com/v24.0/${wabaId}/flows`,
        data,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('WhatsApp Flow created', { id: response.data?.id, name });
      return response.data;
    } catch (error) {
      logger.error('createFlow error', {
        error: error.response?.data?.error?.message || error.message,
        details: error.response?.data
      });
      throw error;
    }
  },

  /**
   * Update a Flow's JSON by uploading it as a form-data asset.
   * @param {string} flowId - The Flow ID
   * @param {object} flowJsonObj - The Flow JSON object
   */
  async updateFlowJSON(flowId, flowJsonObj) {
    try {
      const { accessToken } = getConfig();
      const FormData = require('form-data');
      const formData = new FormData();

      const jsonStr = JSON.stringify(flowJsonObj);
      formData.append('file', Buffer.from(jsonStr), {
        filename: 'flow.json',
        contentType: 'application/json'
      });
      formData.append('name', 'flow.json');
      formData.append('asset_type', 'FLOW_JSON');

      const response = await metaApi.post(
        `https://graph.facebook.com/v24.0/${flowId}/assets`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...formData.getHeaders()
          },
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024
        }
      );

      logger.info('WhatsApp Flow JSON updated', { flowId, errors: response.data?.validation_errors?.length || 0 });
      return response.data;
    } catch (error) {
      logger.error('updateFlowJSON error', {
        flowId,
        error: error.response?.data?.error?.message || error.message,
        details: error.response?.data
      });
      throw error;
    }
  },

  /**
   * Publish a Flow (changes status from DRAFT to PUBLISHED).
   * @param {string} flowId - The Flow ID
   */
  async publishFlow(flowId) {
    try {
      const { accessToken } = getConfig();
      const response = await metaApi.post(
        `https://graph.facebook.com/v24.0/${flowId}/publish`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('WhatsApp Flow published', { flowId });
      return response.data;
    } catch (error) {
      logger.error('publishFlow error', {
        flowId,
        error: error.response?.data?.error?.message || error.message
      });
      throw error;
    }
  },

  /**
   * Get list of Flows under the WABA.
   */
  async getFlows() {
    try {
      const { accessToken, wabaId } = getConfig();
      const response = await metaApi.get(
        `https://graph.facebook.com/v24.0/${wabaId}/flows`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return response.data?.data || [];
    } catch (error) {
      logger.error('getFlows error', { error: error.response?.data?.error?.message || error.message });
      throw error;
    }
  },

  /**
   * Get details of a specific Flow.
   * @param {string} flowId
   */
  async getFlowDetails(flowId) {
    try {
      const { accessToken } = getConfig();
      const response = await metaApi.get(
        `https://graph.facebook.com/v24.0/${flowId}`,
        {
          params: {
            fields: 'id,name,status,categories,validation_errors,json_version,data_api_version',
            access_token: accessToken
          }
        }
      );

      return response.data;
    } catch (error) {
      logger.error('getFlowDetails error', { flowId, error: error.response?.data?.error?.message || error.message });
      throw error;
    }
  },

  /**
   * Delete a Flow (only works on DRAFT flows).
   * @param {string} flowId
   */
  async deleteFlow(flowId) {
    try {
      const { accessToken } = getConfig();
      const response = await metaApi.delete(
        `https://graph.facebook.com/v24.0/${flowId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      logger.info('WhatsApp Flow deleted', { flowId });
      return response.data;
    } catch (error) {
      logger.error('deleteFlow error', { flowId, error: error.response?.data?.error?.message || error.message });
      throw error;
    }
  },

  /**
   * Send an interactive Flow message to a user (user-initiated conversation).
   *
   * @param {string} phone - Recipient phone number
   * @param {object} options
   * @param {string} options.flowId - The published Flow ID
   * @param {string} options.flowCta - CTA button text (e.g. "View Categories")
   * @param {string} options.headerText - Header text
   * @param {string} options.bodyText - Body text
   * @param {string} [options.footerText] - Optional footer text
   * @param {string} [options.screenName] - Initial screen to navigate to
   * @param {object} [options.screenData] - Data payload for the screen
   * @param {string} [options.flowToken] - Custom flow token for identification
   * @param {string} [options.mode] - 'published' (default) or 'draft'
   */
  async sendFlowMessage(phone, options) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');

      const {
        flowId,
        flowCta,
        headerText,
        bodyText,
        footerText,
        screenName = 'CATEGORY_SELECT',
        screenData = {},
        flowToken = 'unused',
        mode = 'published'
      } = options;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'flow',
          header: { type: 'text', text: headerText || 'Menu' },
          body: { text: bodyText || 'Select a category' },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token: flowToken,
              flow_id: flowId,
              flow_cta: flowCta,
              mode,
              flow_action: 'navigate',
              flow_action_payload: {
                screen: screenName,
                data: {
                  ...screenData,
                  flow_token: flowToken
                }
              }
            }
          }
        }
      };

      if (footerText) {
        payload.interactive.footer = { text: footerText };
      }

      logger.info('Sending WhatsApp Flow message', { to, flowId, screen: screenName, mode, cta: flowCta });

      const response = await metaApi.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      logger.info('WhatsApp Flow message sent', { messageId: response.data?.messages?.[0]?.id });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      logger.error('sendFlowMessage error', {
        code: errorData?.code,
        message: errorData?.message,
        subcode: errorData?.error_subcode,
        type: errorData?.type,
        details: errorData?.error_data?.details
      });

      // If blocked by integrity, disable Flows for this session to avoid repeated failures
      if (errorData?.code === 139000) {
        logger.warn('WhatsApp Flows blocked by integrity - disabling Flow category selection for this session');
        process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'BLOCKED';
      }
      throw error;
    }
  }
};

module.exports = metaCloud;