const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  image: { type: String },
  imagePublicId: { type: String },
  code: { type: String },
  discount: { type: String },
  validTill: { type: Date },
  isActive: { type: Boolean, default: true },
  showOnLoad: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Offer', offerSchema);
