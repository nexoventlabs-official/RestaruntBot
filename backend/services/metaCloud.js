const axios = require('axios');
const cloudinaryService = require('./cloudinary');
const logger = require('./logger');

const getConfig = () => ({
  phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
  businessId: process.env.META_BUSINESS_ID,
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
      
      const response = await axios.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      const response = await axios.post(`${baseUrl}/messages`, ctaPayload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: squareImageUrl, caption }
      }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
      
      logger.info('Meta sendMarketingTemplate', { to, template: templateName });
      
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      logger.info('Meta sendMarketingTemplate success');
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
      
      const response = await axios.post(`${baseUrl}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
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
   * Create a marketing message template for an offer.
   * Requires META_WABA_ID (WhatsApp Business Account ID).
   * Template goes through Meta review (PENDING → APPROVED / REJECTED).
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

      // Header with image
      if (headerImageUrl) {
        components.push({
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: [headerImageUrl] }
        });
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

      const response = await axios.post(
        `https://graph.facebook.com/v24.0/${wabaId}/message_templates`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
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
  }
};

module.exports = metaCloud;
