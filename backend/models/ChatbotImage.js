const mongoose = require('mongoose');

const chatbotImageSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    enum: [
      'cart_cleared',
      'added_to_cart', 
      'order_confirmed',
      'no_orders_found',
      'your_orders',
      'no_active_orders',
      'order_cancelled',
      'payment_success',
      'preparing',
      'out_for_delivery',
      'ready',
      'delivered',
      'item_not_available',
      'order_tracking',
      'order_summary',
      'order_details',
      'browse_menu',
      'payment_timeout_cancelled',
      'cart_empty',
      'help_support'
    ]
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String,
    default: ''
  },
  cloudinaryPublicId: {
    type: String,
    default: null
  },
  aspectRatio: {
    type: String,
    default: '2:1' // 2:1 landscape banner format
  }
}, { timestamps: true });

module.exports = mongoose.model('ChatbotImage', chatbotImageSchema);
