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
      // Clean phone number - remove all non-digits and ensure proper format
      let cleanPhone = customerPhone.replace(/\D/g, '');
      // Remove leading 91 if present, then add it back properly
      if (cleanPhone.startsWith('91') && cleanPhone.length > 10) {
        cleanPhone = cleanPhone.substring(2);
      }
      // Ensure it's 10 digits
      if (cleanPhone.length !== 10) {
        console.error('Invalid phone number length:', cleanPhone.length, 'Phone:', customerPhone);
      }
      const formattedPhone = '+91' + cleanPhone;
      
      console.log('Creating Razorpay payment link:', { 
        amount, 
        orderId, 
        originalPhone: customerPhone,
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
        callback_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payment/callback`,
        callback_method: 'get'
      };
      
      console.log('Payment link options:', JSON.stringify(paymentLinkOptions, null, 2));
      
      const paymentLink = await getRazorpay().paymentLink.create(paymentLinkOptions);
      console.log('✅ Payment link created:', paymentLink.short_url, 'ID:', paymentLink.id);
      return paymentLink;
    } catch (error) {
      console.error('❌ Razorpay payment link error:', {
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

  async refund(paymentId, amount) {
    try {
      console.log('💰 Attempting refund:', { paymentId, amount });
      
      // First fetch payment details to verify it's refundable
      const payment = await getRazorpay().payments.fetch(paymentId);
      console.log('💰 Payment details:', { 
        status: payment.status, 
        amount: payment.amount / 100,
        captured: payment.captured,
        refund_status: payment.refund_status
      });
      
      // Check if payment is captured and not already refunded
      if (payment.status !== 'captured') {
        throw new Error(`Payment not captured. Status: ${payment.status}`);
      }
      
      if (payment.refund_status === 'full') {
        throw new Error('Payment already fully refunded');
      }
      
      // Process refund
      const refund = await getRazorpay().payments.refund(paymentId, {
        amount: amount * 100,
        speed: 'normal',
        notes: {
          reason: 'Customer requested cancellation'
        }
      });
      
      console.log('✅ Refund successful:', refund.id);
      return refund;
    } catch (error) {
      console.error('❌ Razorpay refund error:', {
        message: error.message,
        code: error.error?.code,
        description: error.error?.description,
        paymentId,
        amount
      });
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
