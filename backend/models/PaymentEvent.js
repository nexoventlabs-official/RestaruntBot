/**
 * PaymentEvent Model
 * 
 * Stores processed payment webhook event IDs for idempotency.
 * Prevents duplicate processing of Razorpay webhook retries.
 */

const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  orderId: { type: String },
  paymentId: { type: String },
  processedAt: { type: Date, default: Date.now },
  result: { type: String, enum: ['success', 'skipped', 'error'], default: 'success' }
});

// TTL index: auto-delete after 30 days
paymentEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.model('PaymentEvent', paymentEventSchema);
