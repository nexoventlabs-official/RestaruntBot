const Razorpay = require('razorpay');

let razorpay = null;

const getRazorpay = () => {
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpay;
};

const razorpayService = {
  async createOrder(amount, orderId) {
    try {
      const options = {
        amount: amount * 100,
        currency: 'INR',
        receipt: orderId,
        notes: { orderId }
      };
      const order = await getRazorpay().orders.create(options);
      return order;
    } catch (error) {
      console.error('Razorpay create order error:', error.message);
      throw error;
    }
  },

  async createPaymentLink(amount, orderId, customerPhone, customerName) {
    try {
      console.log('Creating Razorpay payment link:', { amount, orderId, customerPhone });
      const paymentLink = await getRazorpay().paymentLink.create({
        amount: amount * 100,
        currency: 'INR',
        accept_partial: false,
        description: `Order ${orderId}`,
        customer: {
          name: customerName || 'Customer',
          contact: '+91' + customerPhone.replace(/^\+?91/, '')
        },
        notify: { sms: true, email: false },
        reminder_enable: true,
        notes: { orderId },
        callback_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payment/callback`,
        callback_method: 'get'
      });
      console.log('Payment link created:', paymentLink.short_url);
      return paymentLink;
    } catch (error) {
      console.error('Razorpay payment link error:', error);
      throw error;
    }
  },

  async refund(paymentId, amount) {
    try {
      const refund = await getRazorpay().payments.refund(paymentId, {
        amount: amount * 100,
        speed: 'normal'
      });
      return refund;
    } catch (error) {
      console.error('Razorpay refund error:', error.message);
      throw error;
    }
  },

  async getPaymentDetails(paymentId) {
    try {
      return await getRazorpay().payments.fetch(paymentId);
    } catch (error) {
      console.error('Razorpay fetch payment error:', error.message);
      throw error;
    }
  }
};

module.exports = razorpayService;
