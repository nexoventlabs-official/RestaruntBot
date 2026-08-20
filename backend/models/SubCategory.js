const mongoose = require('mongoose');

// Lightweight tag-like sub-category (e.g. "Spicy", "Crispy") assigned to variants.
const subCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SubCategory', subCategorySchema);
