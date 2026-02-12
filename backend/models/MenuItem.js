const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  price: { type: Number, required: true },
  originalPrice: { type: Number }, // Original price before discount
  offerPrice: { type: Number }, // Price after offer discount is applied
  category: { type: [String], required: true },
  unit: { type: String, default: 'piece', enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
  quantity: { type: Number, default: 1 },
  foodType: { type: String, default: 'none', enum: ['veg', 'nonveg', 'egg', 'none'] },
  offerType: { type: [String], default: [] }, // Links to offer types from Offers (can have multiple)
  image: { type: String },
  available: { type: Boolean, default: true },
  isPaused: { type: Boolean, default: false },
  preparationTime: { type: Number, default: 15 },
  tags: [String],
  // Product Variants — each variant has its own label, price, image
  // Variant types: 'size' (e.g., 100ml, 500ml) or 'color' (e.g., Red, Blue)
  variants: [{
    label: { type: String, required: true },        // e.g., "500 grams", "Red"
    variantType: { type: String, enum: ['size', 'color'], default: 'size' },
    price: { type: Number, required: true },         // Price for this variant
    offerPrice: { type: Number },                    // Offer price for this variant
    image: { type: String },                         // Optional variant-specific image
    available: { type: Boolean, default: true },
    sku: { type: String }                            // Auto-generated: itemId_variantIndex
  }],
  ratings: [{
    phone: { type: String, required: true },
    orderId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    createdAt: { type: Date, default: Date.now }
  }],
  avgRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

menuItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
menuItemSchema.index({ category: 1, available: 1 });
menuItemSchema.index({ available: 1, isPaused: 1 });
menuItemSchema.index({ name: 'text', tags: 'text' });
menuItemSchema.index({ foodType: 1 });
menuItemSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
