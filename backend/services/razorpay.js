const Razorpay = require('razorpay');
const logger = require('./logger');
const { startTimer, logApiCall } = require('./logger');

let razorpay = null;
let lastKeyId = null;

const getRazorpay = () => {
  // Reset instance if credentials changed
  if (!razorpay || lastKeyId !== process.env.RAZORPAY_KEY_ID) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    lastKeyId = process.env.RAZORPAY_KEY_ID;
    logger.info('Razorpay instance created/refreshed');
  }
  return razorpay;
};

const razorpayService = {
  async createOrder(amount, orderId) {
    const endTimer = startTimer('razorpay.createOrder');
    try {
      const options = {
        amount: amount * 100,
        currency: 'INR',
        receipt: orderId,
        notes: { orderId }
      };
      const order = await getRazorpay().orders.create(options);
      endTimer({ orderId, success: true });
      return order;
    } catch (error) {
      endTimer({ orderId, success: false });
      logger.error('Razorpay create order error', { error: error.message, orderId });
      throw error;
    }
  },

  async createPaymentLink(amount, orderId, customerPhone, customerName) {
    const endTimer = startTimer('razorpay.createPaymentLink');
    try {
      // Clean phone number - remove all non-digits and ensure proper format
      let cleanPhone = customerPhone.replace(/\D/g, '');
      // Remove leading 91 if present, then add it back properly
      if (cleanPhone.startsWith('91') && cleanPhone.length > 10) {
        cleanPhone = cleanPhone.substring(2);
      }
      // Ensure it's 10 digits
      if (cleanPhone.length !== 10) {
      logger.error('Invalid phone number length', { length: cleanPhone.length, phone: customerPhone });
      }
      const formattedPhone = '+91' + cleanPhone;
      
      logger.info('Creating Razorpay payment link', { 
        amount, 
        orderId, 
        formattedPhone,
        customerName 
      });
      
      const paymentLinkOptions = {
        amount: amount * 100,
        currency: 'INR',
        accept_partial: false,
        description: `Order ${orderId}`,
        customer: {
          name: customerName || 'Customer',
          contact: formattedPhone
        },
        notify: { sms: true, email: false },
        reminder_enable: true,
        notes: { orderId },
        callback_url: `${process.env.BACKEND_URL}/api/payment/callback`,
        callback_method: 'get'
      };
      
      logger.info('Payment link options', { paymentLinkOptions });
      
      const paymentLink = await getRazorpay().paymentLink.create(paymentLinkOptions);
      endTimer({ orderId, success: true });
      logger.info('Payment link created', { shortUrl: paymentLink.short_url, linkId: paymentLink.id, orderId });
      return paymentLink;
    } catch (error) {
      endTimer({ orderId, success: false });
      logger.error('Razorpay payment link error', {
        message: error.message,
        code: error.error?.code,
        description: error.error?.description,
        field: error.error?.field,
        source: error.error?.source,
        step: error.error?.step,
        reason: error.error?.reason,
        metadata: error.error?.metadata
      });
      throw error;
    }
  },

  async getPaymentDetails(paymentId) {
    const endTimer = startTimer('razorpay.getPaymentDetails');
    try {
      const result = await getRazorpay().payments.fetch(paymentId);
      endTimer({ paymentId, success: true });
      return result;
    } catch (error) {
      endTimer({ paymentId, success: false });
      logger.error('Razorpay fetch payment error', { error: error.message, paymentId });
      throw error;
    }
  }
};

module.exports = razorpayService;
