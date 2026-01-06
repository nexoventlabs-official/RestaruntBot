const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  image: { type: String, required: true },
  code: { type: String },
  discountType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'none' },
  discountValue: { type: Number, default: 0 },
  minOrderAmount: { type: Number, default: 0 },
  validFrom: { type: Date, default: Date.now },
  validUntil: { type: Date },
  isActive: { type: Boolean, default: true },
  showAsPopup: { type: Boolean, default: true },
  buttonText: { type: String, default: 'Order Now' },
  buttonLink: { type: String, default: '/menu' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

offerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

offerSchema.index({ isActive: 1, showAsPopup: 1 });
offerSchema.index({ validFrom: 1, validUntil: 1 });

module.exports = mongoose.model('Offer', offerSchema);
