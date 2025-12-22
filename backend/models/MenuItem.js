const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  price: { type: Number, required: true },
  category: { type: [String], required: true },
  unit: { type: String, default: 'piece', enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
  quantity: { type: Number, default: 1 },
  foodType: { type: String, default: 'none', enum: ['veg', 'nonveg', 'egg', 'none'] },
  image: { type: String },
  available: { type: Boolean, default: true },
  preparationTime: { type: Number, default: 15 },
  tags: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

menuItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
