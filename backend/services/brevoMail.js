const SibApiV3Sdk = require('sib-api-v3-sdk');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const brevoMail = {
  async sendOrderConfirmation(email, orderDetails) {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `Order Confirmed - ${orderDetails.orderId}`;
    sendSmtpEmail.htmlContent = `
      <h2>Order Confirmed!</h2>
      <p>Thank you for your order.</p>
      <p><strong>Order ID:</strong> ${orderDetails.orderId}</p>
      <p><strong>Total:</strong> ₹${orderDetails.totalAmount}</p>
      <p><strong>Service:</strong> ${orderDetails.serviceType}</p>
      <h3>Items:</h3>
      <ul>${orderDetails.items.map(i => `<li>${i.name} x ${i.quantity} - ₹${i.price * i.quantity}</li>`).join('')}</ul>
      <p>We'll notify you when your order is ready!</p>
    `;
    sendSmtpEmail.sender = { name: process.env.BREVO_FROM_NAME, email: process.env.BREVO_FROM_EMAIL };
    sendSmtpEmail.to = [{ email }];

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      return true;
    } catch (error) {
      console.error('Brevo email error:', error.message);
      return false;
    }
  },

  async sendStatusUpdate(email, orderId, status, message) {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `Order ${orderId} - ${status}`;
    sendSmtpEmail.htmlContent = `
      <h2>Order Update</h2>
      <p><strong>Order ID:</strong> ${orderId}</p>
      <p><strong>Status:</strong> ${status}</p>
      <p>${message}</p>
    `;
    sendSmtpEmail.sender = { name: process.env.BREVO_FROM_NAME, email: process.env.BREVO_FROM_EMAIL };
    sendSmtpEmail.to = [{ email }];

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      return true;
    } catch (error) {
      console.error('Brevo email error:', error.message);
      return false;
    }
  }
};

module.exports = brevoMail;
