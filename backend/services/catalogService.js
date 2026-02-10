/**
 * Catalog Service
 * 
 * Manages the mapping between local MenuItem IDs and WhatsApp Commerce Catalog
 * retailer IDs. Provides helpers to send catalog-style product messages
 * instead of plain text lists.
 * 
 * Prerequisites:
 * 1. Meta Business verified ✓
 * 2. Commerce catalog created in Meta Commerce Manager
 * 3. Products added to catalog with retailer_id matching our MenuItem IDs (or custom IDs)
 * 4. Catalog linked to WhatsApp Business phone number
 * 5. META_CATALOG_ID set in environment variables
 * 
 * Flow:
 *   User asks for menu → catalogService checks if catalog is enabled & products mapped
 *   → If yes: sends product_list message (native catalog cards)
 *   → If no: falls back to regular list messages (existing behavior)
 */
const CatalogProduct = require('../models/CatalogProduct');
const MenuItem = require('../models/MenuItem');
const logger = require('./logger');

// In-memory cache for catalog mappings (avoids DB hit on every message)
let _catalogCache = { data: null, timestamp: 0 };
const CATALOG_CACHE_TTL = 60000; // 60 seconds

const catalogService = {
  /**
   * Check if WhatsApp Catalog is configured and enabled
   */
  isEnabled() {
    return !!(process.env.META_CATALOG_ID);
  },

  /**
   * Get the catalog ID from environment
   */
  getCatalogId() {
    return process.env.META_CATALOG_ID;
  },

  /**
   * Get all active catalog mappings (cached)
   * Returns a Map of menuItemId → retailerId
   */
  async getCatalogMap() {
    const now = Date.now();
    if (_catalogCache.data && (now - _catalogCache.timestamp) < CATALOG_CACHE_TTL) {
      return _catalogCache.data;
    }

    try {
      const mappings = await CatalogProduct.find({ isActive: true }).lean();
      const map = new Map();
      for (const m of mappings) {
        map.set(m.menuItem.toString(), m.retailerId);
      }
      _catalogCache = { data: map, timestamp: now };
      return map;
    } catch (err) {
      logger.error('Failed to load catalog mappings', { error: err.message });
      return new Map();
    }
  },

  /**
   * Clear the catalog cache (call after sync/update)
   */
  clearCache() {
    _catalogCache = { data: null, timestamp: 0 };
  },

  /**
   * Check if a specific menu item has a catalog mapping
   */
  async hasProduct(menuItemId) {
    const map = await this.getCatalogMap();
    return map.has(menuItemId.toString());
  },

  /**
   * Get retailer ID for a menu item
   */
  async getRetailerId(menuItemId) {
    const map = await this.getCatalogMap();
    return map.get(menuItemId.toString()) || null;
  },

  /**
   * Get retailer IDs for multiple menu items
   * Returns only items that have catalog mappings
   */
  async getRetailerIds(menuItemIds) {
    const map = await this.getCatalogMap();
    const result = [];
    for (const id of menuItemIds) {
      const retailerId = map.get(id.toString());
      if (retailerId) {
        result.push({ menuItemId: id.toString(), retailerId });
      }
    }
    return result;
  },

  /**
   * Build product_list sections from menu items grouped by category
   * Only includes items that have catalog mappings.
   * Returns null if insufficient mapped products (falls back to legacy list).
   * 
   * @param {Array} menuItems - Array of MenuItem documents
   * @param {string} categoryFilter - Optional: filter to single category
   * @returns {Object|null} { sections, totalMapped } or null if catalog not usable
   */
  async buildProductSections(menuItems, categoryFilter = null) {
    if (!this.isEnabled()) return null;

    const map = await this.getCatalogMap();
    if (map.size === 0) return null;

    // Filter items that have catalog mappings
    const mappedItems = menuItems.filter(item => map.has(item._id.toString()));
    
    // If less than 50% of items are mapped, fall back to legacy list
    // (avoids confusing UX where some items show in catalog and others don't)
    if (mappedItems.length === 0 || mappedItems.length < menuItems.length * 0.5) {
      logger.info('Catalog fallback: insufficient mapped products', {
        total: menuItems.length,
        mapped: mappedItems.length
      });
      return null;
    }

    // Group by category
    const categoryMap = new Map();
    for (const item of mappedItems) {
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      const cat = categoryFilter || categories[0] || 'Menu';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }
      categoryMap.get(cat).push(map.get(item._id.toString()));
    }

    // Build sections (max 10 sections, max 30 products per section for WhatsApp API)
    const sections = [];
    for (const [category, retailerIds] of categoryMap) {
      if (sections.length >= 10) break;
      sections.push({
        title: category.substring(0, 24),
        productRetailerIds: retailerIds.slice(0, 30)
      });
    }

    return {
      sections,
      totalMapped: mappedItems.length
    };
  },

  /**
   * Build product sections for a specific category
   */
  async buildCategorySections(menuItems, category) {
    if (!this.isEnabled()) return null;

    const map = await this.getCatalogMap();
    if (map.size === 0) return null;

    // Filter items in this category that have catalog mappings
    const categoryItems = menuItems.filter(item => {
      const cats = Array.isArray(item.category) ? item.category : [item.category];
      return cats.includes(category) && map.has(item._id.toString());
    });

    if (categoryItems.length === 0) return null;

    const retailerIds = categoryItems.map(item => map.get(item._id.toString()));

    return {
      sections: [{
        title: category.substring(0, 24),
        productRetailerIds: retailerIds.slice(0, 30)
      }],
      totalMapped: categoryItems.length
    };
  },

  // ========== ADMIN CRUD OPERATIONS ==========

  /**
   * Auto-sync: Create retailer ID mappings using MenuItem._id as the retailer_id.
   * This is the simplest approach — add products to Meta Commerce Manager
   * with retailer_id set to the MongoDB ObjectId of the menu item.
   * 
   * @param {boolean} overwrite - If true, replaces existing mappings
   * @returns {Object} { created, skipped, total }
   */
  async autoSync(overwrite = false) {
    const items = await MenuItem.find({ available: true, isPaused: false }).lean();
    let created = 0;
    let skipped = 0;

    for (const item of items) {
      const itemId = item._id.toString();
      try {
        const existing = await CatalogProduct.findOne({ menuItem: item._id });
        
        if (existing && !overwrite) {
          skipped++;
          continue;
        }

        if (existing && overwrite) {
          existing.retailerId = itemId;
          existing.isActive = true;
          existing.lastSyncedAt = new Date();
          await existing.save();
        } else {
          await CatalogProduct.create({
            menuItem: item._id,
            retailerId: itemId,
            isActive: true,
            lastSyncedAt: new Date()
          });
        }
        created++;
      } catch (err) {
        logger.error('Catalog auto-sync error for item', { itemId, error: err.message });
        skipped++;
      }
    }

    this.clearCache();
    logger.info('Catalog auto-sync completed', { created, skipped, total: items.length });
    return { created, skipped, total: items.length };
  },

  /**
   * Set a custom retailer_id mapping for a menu item
   */
  async setMapping(menuItemId, retailerId) {
    const result = await CatalogProduct.findOneAndUpdate(
      { menuItem: menuItemId },
      {
        menuItem: menuItemId,
        retailerId,
        isActive: true,
        lastSyncedAt: new Date()
      },
      { upsert: true, new: true }
    );
    this.clearCache();
    return result;
  },

  /**
   * Remove a catalog mapping
   */
  async removeMapping(menuItemId) {
    await CatalogProduct.deleteOne({ menuItem: menuItemId });
    this.clearCache();
  },

  /**
   * Get all mappings with menu item details
   */
  async getAllMappings() {
    return CatalogProduct.find()
      .populate('menuItem', 'name price image category available isPaused')
      .sort({ createdAt: -1 })
      .lean();
  },

  /**
   * Get catalog stats
   */
  async getStats() {
    const totalMapped = await CatalogProduct.countDocuments({ isActive: true });
    const totalMenuItems = await MenuItem.countDocuments({ available: true, isPaused: false });
    return {
      catalogEnabled: this.isEnabled(),
      catalogId: this.getCatalogId() || null,
      totalMapped,
      totalMenuItems,
      coveragePercent: totalMenuItems > 0 ? Math.round((totalMapped / totalMenuItems) * 100) : 0
    };
  },

  // ========== AUTO-SYNC: Menu Item → Meta Catalog ==========

  /**
   * Sync a single menu item to Meta Commerce Catalog.
   * Called automatically when a menu item is created or updated in the admin panel.
   * Creates the catalog mapping + pushes the product to Meta.
   * 
   * @param {Object} menuItem - The saved MenuItem document
   * @returns {Object|null} Sync result or null if catalog not enabled
   */
  async syncProductToMeta(menuItem) {
    if (!this.isEnabled()) return null;

    const catalogId = this.getCatalogId();
    const metaCloud = require('./metaCloud');
    const retailerId = menuItem._id.toString();

    try {
      // Build product data from menu item
      const product = {
        retailerId,
        name: menuItem.name,
        description: menuItem.description || menuItem.name,
        price: menuItem.price,
        currency: 'INR',
        imageUrl: menuItem.image || null,
        category: Array.isArray(menuItem.category) ? menuItem.category[0] : (menuItem.category || 'Food'),
        availability: (menuItem.available && !menuItem.isPaused) ? 'in stock' : 'out of stock'
      };

      // Push to Meta Commerce Catalog
      const metaResult = await metaCloud.createOrUpdateCatalogProduct(catalogId, product);

      // Upsert local mapping
      await CatalogProduct.findOneAndUpdate(
        { menuItem: menuItem._id },
        {
          menuItem: menuItem._id,
          retailerId,
          isActive: menuItem.available && !menuItem.isPaused,
          lastSyncedAt: new Date()
        },
        { upsert: true, new: true }
      );

      this.clearCache();
      logger.info('Product synced to Meta catalog', { itemId: retailerId, name: menuItem.name });
      return metaResult;
    } catch (err) {
      logger.error('Failed to sync product to Meta catalog', {
        itemId: retailerId,
        name: menuItem.name,
        error: err.message
      });
      // Don't throw — menu save should succeed even if catalog sync fails
      return null;
    }
  },

  /**
   * Delete a product from Meta Commerce Catalog.
   * Called automatically when a menu item is deleted from the admin panel.
   * 
   * @param {string} menuItemId - The MenuItem _id being deleted
   * @returns {Object|null} Delete result or null if catalog not enabled
   */
  async deleteProductFromMeta(menuItemId) {
    if (!this.isEnabled()) return null;

    const catalogId = this.getCatalogId();
    const metaCloud = require('./metaCloud');

    try {
      // Find the mapping to get the retailer ID
      const mapping = await CatalogProduct.findOne({ menuItem: menuItemId }).lean();
      const retailerId = mapping?.retailerId || menuItemId.toString();

      // Delete from Meta catalog
      const metaResult = await metaCloud.deleteCatalogProduct(catalogId, retailerId);

      // Remove local mapping
      await CatalogProduct.deleteOne({ menuItem: menuItemId });

      this.clearCache();
      logger.info('Product deleted from Meta catalog', { itemId: menuItemId, retailerId });
      return metaResult;
    } catch (err) {
      logger.error('Failed to delete product from Meta catalog', {
        itemId: menuItemId,
        error: err.message
      });
      // Still remove local mapping even if Meta API fails
      await CatalogProduct.deleteOne({ menuItem: menuItemId }).catch(() => {});
      this.clearCache();
      return null;
    }
  },

  /**
   * Process an order received from WhatsApp catalog cart submission.
   * WhatsApp sends an `order` type message when user submits their cart.
   * 
   * @param {string} phone - Customer phone
   * @param {Object} orderData - The order object from WhatsApp webhook
   * @returns {Object} { items, totalAmount } parsed from the order
   */
  async parseWhatsAppOrder(orderData) {
    const productItems = orderData.product_items || [];
    const parsedItems = [];

    for (const product of productItems) {
      const retailerId = product.product_retailer_id;
      const quantity = product.quantity || 1;
      const itemPrice = product.item_price ? parseFloat(product.item_price) : 0;
      const currency = product.currency || 'INR';

      // Find the menu item by retailer ID mapping
      const mapping = await CatalogProduct.findOne({ retailerId, isActive: true }).lean();
      let menuItem = null;
      
      if (mapping) {
        menuItem = await MenuItem.findById(mapping.menuItem).lean();
      } else {
        // Try direct ObjectId match (if retailer_id = menuItem._id)
        try {
          menuItem = await MenuItem.findById(retailerId).lean();
        } catch (e) {
          // Not a valid ObjectId, skip
        }
      }

      parsedItems.push({
        menuItemId: menuItem?._id || null,
        menuItem: menuItem || null,
        retailerId,
        name: menuItem?.name || product.product_retailer_id,
        quantity,
        price: menuItem?.price || itemPrice,
        currency
      });
    }

    const totalAmount = parsedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return {
      items: parsedItems,
      totalAmount,
      catalogId: orderData.catalog_id || null
    };
  }
};

module.exports = catalogService;
