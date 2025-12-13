// WhatsApp Service - Meta Cloud API
const metaCloud = require('./metaCloud');

const whatsapp = {
  async sendMessage(phone, message) {
    return metaCloud.sendMessage(phone, message);
  },

  async sendButtons(phone, message, buttons, footer = '') {
    return metaCloud.sendButtons(phone, message, buttons, footer);
  },

  async sendList(phone, title, description, buttonText, sections, footer = '') {
    return metaCloud.sendList(phone, title, description, buttonText, sections, footer);
  },

  async sendTemplateButtons(phone, message, buttons, footer = '') {
    return metaCloud.sendTemplateButtons(phone, message, buttons, footer);
  },

  async sendOrder(phone, order, items, paymentUrl) {
    return metaCloud.sendOrder(phone, order, items, paymentUrl);
  },

  async sendImage(phone, imageUrl, caption = '') {
    return metaCloud.sendImage(phone, imageUrl, caption);
  },

  async sendImageWithButtons(phone, imageUrl, message, buttons, footer = '') {
    return metaCloud.sendImageWithButtons(phone, imageUrl, message, buttons, footer);
  },

  async sendLocationRequest(phone, message) {
    return metaCloud.sendLocationRequest(phone, message);
  }
};

module.exports = whatsapp;
