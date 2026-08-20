const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true },
  originalPrice: { type: Number }, // Original price before discount
  offerPrice: { type: Number }, // Price after offer discount is applied
  category: { type: [String], required: true },
  unit: { type: String, default: 'piece', enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
  quantity: { type: Number, default: 1 },
  foodType: { type: String, default: 'none', enum: ['veg', 'nonveg', 'egg', 'none'] },
  offerType: { type: [String], default: [] }, // Links to offer types from Offers (can have multiple)
  image: { type: String },
  coverImage: { type: String }, // Detail-page hero/banner image (landscape)
  video: { type: String },      // Product video (Cloudinary video URL)
  available: { type: Boolean, default: true },
  isPaused: { type: Boolean, default: false },
  preparationTime: { type: Number, default: 15 },
  tags: [String],
  // Product Variants — each variant is a full product under this title/group
  // e.g., Title: "Biryani" → Variants: "Chicken Biryani", "Mutton Biryani"
  // Each variant can have multiple quantity options (e.g., 0.5 kg, 1 kg)
  variants: [{
    label: { type: String, required: true, trim: true },        // Item name (e.g., "Chicken Biryani")
    variantType: { type: String, enum: ['size', 'color'], default: 'size' },
    price: { type: Number, required: true },         // Base price for this variant
    offerPrice: { type: Number },                    // Offer price for this variant
    quantity: { type: Number, default: 1 },           // Default quantity
    unit: { type: String, default: 'piece', enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
    image: { type: String },                         // Variant-specific main image
    images: { type: [String], default: [] },         // Additional images for this variant (gallery)
    description: { type: String, trim: true },                   // Variant-specific description
    foodType: { type: String, default: 'none', enum: ['veg', 'nonveg', 'egg', 'none'] },
    tags: [String],                                  // Variant-specific tags
    subCategories: { type: [String], default: [] },  // e.g. Spicy, Crispy (managed on Sub Categories page)
    available: { type: Boolean, default: true },
    sku: { type: String },                           // Auto-generated: itemId_variantIndex
    avgRating: { type: Number, default: 0 },         // Per-variant average rating
    totalRatings: { type: Number, default: 0 },      // Per-variant total review count
    // Multiple quantity options per variant (e.g., 0.5 kg ₹249, 1 kg ₹449)
    quantities: [{
      quantity: { type: Number, required: true },
      unit: { type: String, required: true, enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice', 'inch', 'full', 'half', 'small'] },
      price: { type: Number, required: true },
      offerPrice: { type: Number },
      available: { type: Boolean, default: true }
    }]
  }],
  ratings: [{
    phone: { type: String, required: true },
    orderId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    variantIndex: { type: Number, default: null },  // Which variant this rating is for (null = parent item)
    createdAt: { type: Date, default: Date.now }
  }],
  avgRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  soldOutUntil: { type: String },  // HH:mm time string — auto-resume after this time
  // Recurring sold-out schedule (daily or per-day custom)
  soldOutSchedule: {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ['daily', 'custom'], default: 'daily' },
    // For 'daily': single startTime/endTime applies to all days
    dailyStartTime: { type: String },  // HH:mm
    dailyEndTime: { type: String },    // HH:mm
    // For 'custom': per-day schedule
    days: [{
      day: { type: String, enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
      enabled: { type: Boolean, default: false },
      startTime: { type: String },  // HH:mm
      endTime: { type: String },    // HH:mm
    }]
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

menuItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  // Auto-trim variant labels and descriptions
  if (this.variants && this.variants.length > 0) {
    this.variants.forEach(v => {
      if (v.label) v.label = v.label.trim();
      if (v.description) v.description = v.description.trim();
    });
  }
  if (this.name) this.name = this.name.trim();
  if (this.description) this.description = this.description.trim();
  next();
});

// Indexes for performance
menuItemSchema.index({ category: 1, available: 1 });
menuItemSchema.index({ available: 1, isPaused: 1 });
menuItemSchema.index({ name: 'text', tags: 'text', 'variants.label': 'text', 'variants.tags': 'text' });
menuItemSchema.index({ foodType: 1 });
menuItemSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
