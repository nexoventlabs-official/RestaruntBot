const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String },
  email: { type: String },
  hasOrdered: { type: Boolean, default: false }, // Track if customer has placed at least one order
  addresses: [{
    label: String,
    address: String,
    isDefault: Boolean
  }],
  deliveryAddress: {
    latitude: Number,
    longitude: Number,
    address: String,
    updatedAt: Date
  },
  cart: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    quantity: Number
  }],
  conversationState: {
    currentStep: { type: String, default: 'welcome' },
    selectedService: String,
    selectedCategory: String,
    selectedItem: String,
    pendingOrderId: String,
    foodTypePreference: String,
    paymentMethod: String,
    lastInteraction: Date,
    context: mongoose.Schema.Types.Mixed
  },
  orderHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

customerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Customer', customerSchema);
