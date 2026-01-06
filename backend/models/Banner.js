const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: { type: String },
  image: { type: String, required: true },
  imagePublicId: { type: String },
  link: { type: String },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Banner', bannerSchema);
