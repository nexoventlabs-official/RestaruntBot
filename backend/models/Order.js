const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customer: {
    phone: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    address: { type: String }
  },
  deliveryAddress: {
    address: { type: String },
    latitude: { type: Number },
    longitude: { type: Number }
  },
  items: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    quantity: Number,
    price: Number,
    unit: { type: String, default: 'piece' },
    unitQty: { type: Number, default: 1 }
  }],
  totalAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  serviceType: { type: String, enum: ['delivery', 'pickup', 'dine_in'], required: true },
  paymentMethod: { type: String, enum: ['upi', 'cod'], default: 'upi' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'cancelled'], default: 'pending' },
  paymentId: { type: String },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  refundId: { type: String },
  refundAmount: { type: Number },
  refundStatus: { type: String, enum: ['none', 'pending', 'approved', 'completed', 'rejected', 'failed'], default: 'none' },
  refundRequestedAt: { type: Date },
  refundProcessedAt: { type: Date },
  refundedAt: { type: Date },
  refundInitiatedAt: { type: Date },
  returnReason: { type: String },
  cancellationReason: { type: String },
  trackingUpdates: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    message: String
  }],
  estimatedDeliveryTime: { type: Date },
  deliveredAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

orderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Order', orderSchema);
