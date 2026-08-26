const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String },
  email: { type: String },
  hasOrdered: { type: Boolean, default: false }, // Track if customer has placed at least one order
  addresses: [{
    label: String,
    address: String,
    landmark: String,
    state: String,
    district: String,
    pincode: String,
    latitude: Number,
    longitude: Number,
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
    quantity: { type: Number, min: [1, 'Cart quantity must be at least 1'] },
    variantIndex: { type: Number, default: null },
    quantityIndex: { type: Number, default: null },
    variantLabel: { type: String, default: null },
    addedAt: { type: Date, default: Date.now }
  }],
  // Active offers applied to this customer (from targeted broadcasts)
  activeOffers: [{
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
    offerType: String,
    title: String,
    discountType: String,
    discountValue: Number,
    percentage: Number,
    appliedItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
    appliedCategories: [String],
    // Specific variants this offer applies to, e.g. ["itemId_0"] (means: only
    // variant index 0 of itemId — applies to all quantities of that variant)
    appliedVariants: [String],
    // Specific variant+quantity combos this offer applies to, e.g.
    // ["itemId_0_1"] (means: only variant 0, quantity option 1 of itemId)
    appliedQuantities: [String],
    validUntil: Date,
    appliedAt: { type: Date, default: Date.now }
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
  totalOrders: { type: Number, default: 0, min: 0 },
  totalSpent: { type: Number, default: 0, min: 0 },
  // Change 5: loyalty points
  loyaltyPoints: {
    balance:          { type: Number, default: 0, min: 0 },
    lifetimeEarned:   { type: Number, default: 0, min: 0 },
    lifetimeRedeemed: { type: Number, default: 0, min: 0 },
    history: [{
      type:        { type: String, enum: ['earned', 'redeemed'] },
      points:      Number,
      orderId:     String,
      description: String,
      timestamp:   { type: Date, default: Date.now }
    }]
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  optimisticConcurrency: true
});

customerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
customerSchema.index({ createdAt: -1 });
customerSchema.index({ totalOrders: -1 });
customerSchema.index({ totalSpent: -1 });
customerSchema.index({ 'conversationState.lastInteraction': -1 });
customerSchema.index({ name: 'text', phone: 'text' });

module.exports = mongoose.model('Customer', customerSchema);
