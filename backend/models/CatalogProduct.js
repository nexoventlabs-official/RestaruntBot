const mongoose = require('mongoose');

/**
 * CatalogProduct Model
 * 
 * Maps local MenuItem IDs to WhatsApp Commerce Catalog retailer IDs.
 * Required for sending product/product_list messages via WhatsApp Cloud API.
 * 
 * The retailer_id is the unique identifier you set when adding products
 * to your Meta Commerce Manager catalog. It must match exactly.
 */
const catalogProductSchema = new mongoose.Schema({
  menuItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true,
    unique: true
  },
  // retailer_id in Meta Commerce Manager catalog (you set this when adding products)
  retailerId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  // Whether this product is currently synced/active in the catalog
  isActive: {
    type: Boolean,
    default: true
  },
  // Last time this mapping was verified
  lastSyncedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

catalogProductSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
catalogProductSchema.index({ isActive: 1 });

module.exports = mongoose.model('CatalogProduct', catalogProductSchema);
