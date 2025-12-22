const axios = require('axios');

const getConfig = () => ({
  phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
  businessId: process.env.META_BUSINESS_ID,
  apiVersion: 'v24.0',
  baseUrl: `https://graph.facebook.com/v24.0/${process.env.META_PHONE_NUMBER_ID}`
});

const metaCloud = {
  async sendMessage(phone, message) {
    try {
      const { baseUrl, accessToken, phoneNumberId } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      console.log('📤 Meta sendMessage to:', to, 'message length:', message.length);
      
      const response = await axios.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      console.log('✅ Meta sendMessage success:', response.data?.messages?.[0]?.id || 'sent');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      console.error('❌ Meta Cloud send error:', {
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
      
      console.log('📤 Meta sendButtons to:', to);
      
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
      console.log('✅ Meta sendButtons success');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      console.error('❌ Meta buttons error:', errorData?.message || error.message);
      return this.sendMessage(phone, message + '\n\n' + buttons.map((b, i) => `${i + 1}. ${b.text || b}`).join('\n'));
    }
  },

  async sendList(phone, title, description, buttonText, sections, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      console.log('📤 Sending Meta list to:', to);
      
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
      console.log('✅ Meta list success');
      return response.data;
    } catch (error) {
      const errorData = error.response?.data?.error;
      console.error('❌ Meta list error:', errorData?.message || error.message);
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
      console.error('Meta Cloud template error:', error.message);
      throw error;
    }
  },

  async sendOrder(phone, order, items, paymentUrl) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      // Build order message
      let orderMsg = `Order #${order.orderId}\n⏳ Order pending\n\n`;
      items.forEach(item => {
        orderMsg += `*${item.name}*\nQuantity ${item.quantity}    ₹${item.quantity * item.price}.00\n\n`;
      });
      orderMsg += `━━━━━━━━━━━━━━━\n`;
      orderMsg += `*Total*    ₹${order.totalAmount}.00`;

      // Send with CTA URL button - this opens Razorpay payment page
      const ctaPayload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: {
            type: 'text',
            text: 'Order details'
          },
          body: {
            text: orderMsg
          },
          footer: {
            text: 'Tap Continue to pay securely'
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Continue',
              url: paymentUrl
            }
          }
        }
      };

      console.log('📤 Sending order with CTA:', JSON.stringify(ctaPayload, null, 2));
      const response = await axios.post(`${baseUrl}/messages`, ctaPayload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      console.log('✅ Order sent:', response.data);
      return response.data;
    } catch (error) {
      console.error('Meta Cloud order error:', error.response?.data || error.message);
      
      // Fallback: simple text message with link
      let orderMsg = `🧾 *ORDER #${order.orderId}*\n⏳ Order pending\n\n`;
      items.forEach(item => {
        orderMsg += `*${item.name}*\nQty: ${item.quantity} × ₹${item.price} = ₹${item.quantity * item.price}\n\n`;
      });
      orderMsg += `━━━━━━━━━━━━━━━\n`;
      orderMsg += `*Total: ₹${order.totalAmount}*\n\n`;
      orderMsg += `💳 *Pay here:*\n${paymentUrl}`;

      return this.sendMessage(phone, orderMsg);
    }
  },

  async sendImage(phone, imageUrl, caption = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      const response = await axios.post(`${baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption }
      }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      return response.data;
    } catch (error) {
      console.error('Meta Cloud image error:', error.response?.data || error.message);
      throw error;
    }
  },

  async sendImageWithButtons(phone, imageUrl, message, buttons, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      console.log('📤 Meta sendImageWithButtons to:', to);
      
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: {
            type: 'image',
            image: { link: imageUrl }
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
      console.log('✅ Meta sendImageWithButtons response:', JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      console.error('❌ Meta Cloud image buttons error:', error.response?.data || error.message);
      // Fallback to regular buttons
      return this.sendButtons(phone, message, buttons, footer);
    }
  },

  // Send location request - opens WhatsApp location picker directly
  async sendLocationRequest(phone, message) {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      console.log('📤 Meta sendLocationRequest to:', to);
      
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
      console.log('✅ Meta location request response:', JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      console.error('❌ Meta Cloud location request error:', error.response?.data || error.message);
      // Fallback to buttons if location_request_message not supported
      return this.sendButtons(phone, message, [
        { id: 'share_location', text: '📍 Share Location' },
        { id: 'skip_location', text: '⏭️ Skip' },
        { id: 'clear_cart', text: '❌ Cancel' }
      ], 'Tap to share your delivery location');
    }
  },

  // Send CTA URL button - for external links like Google Review
  async sendCtaUrl(phone, message, buttonText, url, footer = '') {
    try {
      const { baseUrl, accessToken } = getConfig();
      const to = phone.replace('@c.us', '').replace(/\D/g, '');
      
      console.log('📤 Meta sendCtaUrl to:', to);
      
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
      console.log('✅ Meta sendCtaUrl success');
      return response.data;
    } catch (error) {
      console.error('❌ Meta Cloud CTA URL error:', error.response?.data || error.message);
      // Fallback to text message with link
      return this.sendMessage(phone, `${message}\n\n🔗 ${buttonText}: ${url}`);
    }
  }
};

module.exports = metaCloud;
