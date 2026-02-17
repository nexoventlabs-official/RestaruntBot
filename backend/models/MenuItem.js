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
  // Product Variants — each variant is a full product under this title/group
  // e.g., Title: "Biryani" → Variants: "Chicken Biryani", "Mutton Biryani"
  // Each variant can have multiple quantity options (e.g., 0.5 kg, 1 kg)
  variants: [{
    label: { type: String, required: true },        // Item name (e.g., "Chicken Biryani")
    variantType: { type: String, enum: ['size', 'color'], default: 'size' },
    price: { type: Number, required: true },         // Base price for this variant
    offerPrice: { type: Number },                    // Offer price for this variant
    quantity: { type: Number, default: 1 },           // Default quantity
    unit: { type: String, default: 'piece', enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
    image: { type: String },                         // Variant-specific image
    description: { type: String },                   // Variant-specific description
    foodType: { type: String, default: 'none', enum: ['veg', 'nonveg', 'egg', 'none'] },
    tags: [String],                                  // Variant-specific tags
    available: { type: Boolean, default: true },
    sku: { type: String },                           // Auto-generated: itemId_variantIndex
    avgRating: { type: Number, default: 0 },         // Per-variant average rating
    totalRatings: { type: Number, default: 0 },      // Per-variant total review count
    // Multiple quantity options per variant (e.g., 0.5 kg ₹249, 1 kg ₹449)
    quantities: [{
      quantity: { type: Number, required: true },
      unit: { type: String, required: true, enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
      price: { type: Number, required: true },
      offerPrice: { type: Number }
    }]
  }],
  ratings: [{
    phone: { type: String, required: true },
    orderId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    createdAt: { type: Date, default: Date.now }
  }],
  avgRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  soldOutUntil: { type: String },  // HH:mm time string — auto-resume after this time
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
menuItemSchema.index({ name: 'text', tags: 'text', 'variants.label': 'text', 'variants.tags': 'text' });
menuItemSchema.index({ foodType: 1 });
menuItemSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
