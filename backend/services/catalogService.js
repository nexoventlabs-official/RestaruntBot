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

    // Build sections (max 10 sections, max 30 products TOTAL for WhatsApp product_list API)
    const sections = [];
    let totalProducts = 0;
    const MAX_TOTAL_PRODUCTS = 30;
    for (const [category, retailerIds] of categoryMap) {
      if (sections.length >= 10) break;
      const remaining = MAX_TOTAL_PRODUCTS - totalProducts;
      if (remaining <= 0) break;
      const slicedIds = retailerIds.slice(0, remaining);
      sections.push({
        title: category.substring(0, 24),
        productRetailerIds: slicedIds
      });
      totalProducts += slicedIds.length;
    }

    return {
      sections,
      totalMapped: mappedItems.length,
      totalInSections: totalProducts
    };
  },

  /**
   * Build paginated product_list pages for >30 items.
   * Each page has max 30 products across max 10 sections.
   * Returns array of { sections, totalInPage, pageNumber, totalPages }.
   */
  async buildPaginatedProductSections(menuItems) {
    if (!this.isEnabled()) return null;

    const map = await this.getCatalogMap();
    if (map.size === 0) return null;

    const mappedItems = menuItems.filter(item => map.has(item._id.toString()));
    if (mappedItems.length === 0 || mappedItems.length < menuItems.length * 0.5) {
      return null;
    }

    // Group by category preserving order
    const categoryMap = new Map();
    for (const item of mappedItems) {
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      const cat = categories[0] || 'Menu';
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat).push(map.get(item._id.toString()));
    }

    // Flatten categories into sequential entries
    const allEntries = [...categoryMap.entries()];
    const pages = [];
    let entryIdx = 0;
    let offsetInCategory = 0; // track partially consumed category

    while (entryIdx < allEntries.length) {
      const sections = [];
      let pageTotal = 0;
      const MAX_PER_PAGE = 30;
      const MAX_SECTIONS = 10;

      while (entryIdx < allEntries.length && sections.length < MAX_SECTIONS && pageTotal < MAX_PER_PAGE) {
        const [catName, retailerIds] = allEntries[entryIdx];
        const remaining = MAX_PER_PAGE - pageTotal;
        const idsLeft = retailerIds.slice(offsetInCategory);
        const sliced = idsLeft.slice(0, remaining);

        if (sliced.length > 0) {
          sections.push({
            title: catName.substring(0, 24),
            productRetailerIds: sliced
          });
          pageTotal += sliced.length;
        }

        if (offsetInCategory + sliced.length >= retailerIds.length) {
          // Category fully consumed, move to next
          entryIdx++;
          offsetInCategory = 0;
        } else {
          // Category partially consumed, continue on next page
          offsetInCategory += sliced.length;
          break;
        }
      }

      if (sections.length > 0) {
        pages.push({ sections, totalInPage: pageTotal });
      }
    }

    // Add page metadata
    const totalPages = pages.length;
    return pages.map((p, i) => ({
      ...p,
      pageNumber: i + 1,
      totalPages,
      totalMapped: mappedItems.length
    }));
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

  /**
   * Build product sections for cart items
   * Puts all cart items into a single section for clean display
   */
  async buildCartSections(cartItems) {
    if (!this.isEnabled()) return null;

    const map = await this.getCatalogMap();
    if (map.size === 0) return null;

    // Filter cart items whose menuItem has a catalog mapping
    const mappedItems = cartItems.filter(item =>
      item.menuItem && map.has(item.menuItem._id.toString())
    );

    if (mappedItems.length === 0) return null;

    // Put all cart items in a single section (avoids multi-section rendering issues)
    const retailerIds = mappedItems.map(item => map.get(item.menuItem._id.toString()));

    return {
      sections: [{
        title: 'Your Items',
        productRetailerIds: retailerIds.slice(0, 30)
      }],
      totalMapped: mappedItems.length
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
    const metaCloud = require('./metaCloud');
    const catalogId = this.getCatalogId();
    let created = 0;
    let skipped = 0;
    let metaPushed = 0;
    let metaFailed = 0;

    // Step 1: Create all local CatalogProduct mappings first
    for (const item of items) {
      const itemId = item._id.toString();
      try {
        const existing = await CatalogProduct.findOne({ menuItem: item._id });
        
        if (existing && !overwrite) {
          skipped++;
          continue;
        }

        await CatalogProduct.findOneAndUpdate(
          { menuItem: item._id },
          {
            menuItem: item._id,
            retailerId: itemId,
            isActive: true,
            lastSyncedAt: new Date()
          },
          { upsert: true, new: true }
        );
        created++;
      } catch (err) {
        logger.error('Catalog mapping error for item', { itemId, name: item.name, error: err.message });
      }
    }

    this.clearCache();

    // Step 2: Batch-push products to Meta Commerce Catalog (20 per request, 3s delay between batches)
    if (this.isEnabled() && catalogId) {
      const BATCH_SIZE = 20;
      const DELAY_MS = 3000;
      const itemsToSync = overwrite ? items : items.filter((_, i) => i >= skipped || overwrite);

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const products = batch.map(item => ({
          retailerId: item._id.toString(),
          name: item.name,
          description: this.buildProductDescription(item),
          price: item.price,
          currency: 'INR',
          imageUrl: item.image || null,
          category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
          availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
        }));

        try {
          await metaCloud.batchCreateOrUpdateProducts(catalogId, products);
          metaPushed += batch.length;
          logger.info('Catalog batch pushed to Meta', { batchStart: i, count: batch.length });
        } catch (err) {
          metaFailed += batch.length;
          logger.error('Catalog batch push failed', { batchStart: i, error: err.message });
        }

        // Delay between batches to respect Meta rate limits
        if (i + BATCH_SIZE < items.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
    }

    // Step 3: Sync category collections (horizontal tiles with images)
    let collectionResult = { created: 0, updated: 0, failed: 0 };
    try {
      collectionResult = await this.syncCollections();
      logger.info('Collections synced during auto-sync', collectionResult);
    } catch (err) {
      logger.error('Collections sync failed during auto-sync', { error: err.message });
    }

    logger.info('Catalog auto-sync completed', { created, skipped, metaPushed, metaFailed, collections: collectionResult, total: items.length });
    return { created, skipped, metaPushed, metaFailed, collections: collectionResult, total: items.length };
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
   * Build a rich product description including rating info for Meta catalog.
   * @param {Object} menuItem - The MenuItem document
   * @returns {string} Description with ratings
   */
  buildProductDescription(menuItem) {
    let desc = menuItem.description || menuItem.name;
    
    // Add rating info to description
    if (menuItem.totalRatings > 0 && menuItem.avgRating > 0) {
      const stars = '⭐'.repeat(Math.min(Math.floor(menuItem.avgRating), 5));
      desc += ` | ${stars} ${menuItem.avgRating}/5 (${menuItem.totalRatings} reviews)`;
    }
    
    // Add food type
    if (menuItem.foodType === 'veg') {
      desc += ' | 🟢 Veg';
    } else if (menuItem.foodType === 'nonveg') {
      desc += ' | 🔴 Non-Veg';
    } else if (menuItem.foodType === 'egg') {
      desc += ' | 🟡 Egg';
    }
    
    // Add unit/quantity info
    if (menuItem.quantity && menuItem.unit) {
      desc += ` | ${menuItem.quantity} ${menuItem.unit}`;
    }
    
    return desc.substring(0, 5000); // Meta catalog description limit
  },

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
      // Build product data from menu item with ratings in description
      const product = {
        retailerId,
        name: menuItem.name,
        description: this.buildProductDescription(menuItem),
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
  // ========== CATALOG COLLECTIONS (Category Tiles) ==========

  /**
   * Sync categories as Collections (product sets) in the Meta catalog.
   * Creates horizontal category tiles with cover images at the top of the WhatsApp catalog.
   * Uses the Category model's `image` field for cover images.
   *
   * @returns {Object} { created, updated, failed, total }
   */
  async syncCollections() {
    if (!this.isEnabled()) return { created: 0, updated: 0, failed: 0, total: 0 };

    const Category = require('../models/Category');
    const metaCloud = require('./metaCloud');
    const catalogId = this.getCatalogId();
    const map = await this.getCatalogMap();

    let created = 0;
    let updated = 0;
    let failed = 0;

    try {
      // Get all active categories with their menu items
      const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
      const items = await MenuItem.find({ available: true, isPaused: false }).lean();

      // Get existing collections from Meta to check for updates
      let existingCollections = [];
      try {
        existingCollections = await metaCloud.getCollections(catalogId);
      } catch (err) {
        logger.info('Could not fetch existing collections, will create new', { error: err.message });
      }

      // Map existing collection names to their IDs
      const existingMap = new Map();
      for (const col of existingCollections) {
        existingMap.set(col.name, col.id);
      }

      for (const category of categories) {
        try {
          // Find items in this category that have catalog mappings
          const categoryItems = items.filter(item => {
            const cats = Array.isArray(item.category) ? item.category : [item.category];
            return cats.includes(category.name) && map.has(item._id.toString());
          });

          if (categoryItems.length === 0) {
            logger.info('Skipping collection - no mapped items', { category: category.name });
            continue;
          }

          const retailerIds = categoryItems.map(item => map.get(item._id.toString()));

          const collectionData = {
            name: category.name,
            retailerIds,
            coverImageUrl: category.image || null,
            description: category.description || `${categoryItems.length} items in ${category.name}`
          };

          // Check if collection already exists
          const existingId = existingMap.get(category.name);
          if (existingId) {
            collectionData.productSetId = existingId;
            await metaCloud.createOrUpdateCollection(catalogId, collectionData);
            updated++;
          } else {
            await metaCloud.createOrUpdateCollection(catalogId, collectionData);
            created++;
          }

          // Delay between API calls to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          failed++;
          logger.error('Failed to sync collection', { category: category.name, error: err.message });
        }
      }

      logger.info('Collections sync completed', { created, updated, failed, total: categories.length });
      return { created, updated, failed, total: categories.length };
    } catch (err) {
      logger.error('Collections sync error', { error: err.message });
      throw err;
    }
  },

  /**
   * Get all collections from Meta catalog
   */
  async getCollections() {
    if (!this.isEnabled()) return [];
    const metaCloud = require('./metaCloud');
    return metaCloud.getCollections(this.getCatalogId());
  },

  /**
   * Build product sections specifically for search results.
   * More lenient than buildProductSections — doesn't require 50% coverage.
   * Groups by category, max 30 products.
   * @param {Array} items - Search result MenuItem documents
   * @param {string} searchLabel - Label for the search
   * @returns {Object|null} { sections, totalMapped } or null
   */
  async buildSearchResultSections(items) {
    if (!this.isEnabled()) return null;

    const map = await this.getCatalogMap();
    if (map.size === 0) return null;

    // Filter items that have catalog mappings (no 50% threshold for search results)
    const mappedItems = items.filter(item => map.has(item._id.toString()));
    if (mappedItems.length === 0) return null;

    // Group by category
    const categoryMap = new Map();
    for (const item of mappedItems) {
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      const cat = categories[0] || 'Results';
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat).push(map.get(item._id.toString()));
    }

    // Build sections (max 10 sections, max 30 products)
    const sections = [];
    let totalProducts = 0;
    const MAX_TOTAL_PRODUCTS = 30;
    for (const [category, retailerIds] of categoryMap) {
      if (sections.length >= 10) break;
      const remaining = MAX_TOTAL_PRODUCTS - totalProducts;
      if (remaining <= 0) break;
      const slicedIds = retailerIds.slice(0, remaining);
      sections.push({
        title: category.substring(0, 24),
        productRetailerIds: slicedIds
      });
      totalProducts += slicedIds.length;
    }

    return {
      sections,
      totalMapped: mappedItems.length,
      totalInSections: totalProducts
    };
  },

  /**
   * Sync ratings for menu items to Meta Commerce Catalog.
   * Called after a customer submits a rating. Updates the product description
   * in Meta catalog to reflect the latest ratings.
   * 
   * @param {Array<string>} menuItemIds - Array of MenuItem IDs whose ratings changed
   * @returns {Object} { synced, failed }
   */
  async syncRatingsToMeta(menuItemIds) {
    if (!this.isEnabled()) return { synced: 0, failed: 0 };

    const catalogId = this.getCatalogId();
    const metaCloud = require('./metaCloud');
    let synced = 0;
    let failed = 0;

    try {
      // Fetch the updated menu items
      const items = await MenuItem.find({ _id: { $in: menuItemIds } }).lean();
      
      if (items.length === 0) return { synced: 0, failed: 0 };

      // Build batch update with new descriptions including ratings
      const products = items.map(item => ({
        retailerId: item._id.toString(),
        name: item.name,
        description: this.buildProductDescription(item),
        price: item.price,
        currency: 'INR',
        imageUrl: item.image || null,
        category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
        availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
      }));

      await metaCloud.batchCreateOrUpdateProducts(catalogId, products);
      synced = products.length;
      logger.info('Ratings synced to Meta catalog', { count: synced, itemIds: menuItemIds });
    } catch (err) {
      failed = menuItemIds.length;
      logger.error('Failed to sync ratings to Meta catalog', { error: err.message, itemIds: menuItemIds });
    }

    return { synced, failed };
  },

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
  },

  // ============ WHATSAPP FLOWS ============

  /**
   * Build the Flow JSON for category selection.
   * Single-screen Flow with RadioButtonsGroup showing all active categories.
   * Categories are passed dynamically via flow_action_payload when sending.
   *
   * @returns {object} Flow JSON definition
   */
  buildCategoryFlowJSON() {
    return {
      version: '6.3',
      screens: [
        {
          id: 'CATEGORY_SELECT',
          title: 'Menu Categories',
          terminal: true,
          success: true,
          data: {
            categories: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' }
                }
              },
              __example__: [
                { id: 'veg_starters', title: 'Veg Starters (12 items)' },
                { id: 'non_veg_starters', title: 'Non-Veg Starters (8 items)' },
                { id: 'biryani', title: 'Biryani (6 items)' }
              ]
            },
            flow_token: {
              type: 'string',
              __example__: 'category_select_919999999999'
            }
          },
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                type: 'TextHeading',
                text: '🍽️ Select a Category'
              },
              {
                type: 'TextBody',
                text: 'Choose a category to browse our menu items'
              },
              {
                type: 'RadioButtonsGroup',
                name: 'selected_category',
                label: 'Categories',
                required: true,
                'data-source': '${data.categories}'
              },
              {
                type: 'Footer',
                label: 'Browse Menu',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    selected_category: '${form.selected_category}',
                    flow_token: '${data.flow_token}'
                  }
                }
              }
            ]
          }
        }
      ]
    };
  },

  /**
   * Build the data payload for the category selection Flow.
   * @param {Array} menuItems - Filtered menu items to derive categories from
   * @param {string} flowToken - Unique token to identify this flow instance
   * @returns {object} { categories: [{id, title}], flow_token }
   */
  buildCategoryFlowData(menuItems, flowToken = 'category_select') {
    const Category = require('../models/Category');
    const categories = [...new Set(menuItems.flatMap(m =>
      Array.isArray(m.category) ? m.category : [m.category]
    ))];

    const categoryData = categories.map(cat => {
      const count = menuItems.filter(m =>
        Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat
      ).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        id: safeId,
        title: `${cat} (${count} items)`
      };
    });

    return {
      categories: categoryData,
      flow_token: flowToken
    };
  },

  /**
   * Build category flow data asynchronously using Category model for sorting.
   * @param {Array} menuItems
   * @param {string} flowToken
   * @returns {Promise<object>}
   */
  async buildCategoryFlowDataSorted(menuItems, flowToken = 'category_select') {
    const Category = require('../models/Category');
    const categories = [...new Set(menuItems.flatMap(m =>
      Array.isArray(m.category) ? m.category : [m.category]
    ))];

    // Get category docs for sort order
    const catDocs = await Category.find({ isActive: true, name: { $in: categories } })
      .sort({ sortOrder: 1 }).lean();

    // Build sorted list, fall back to unsorted for categories not in DB
    const sortedCats = catDocs.map(c => c.name);
    const unsortedCats = categories.filter(c => !sortedCats.includes(c));
    const allCats = [...sortedCats, ...unsortedCats];

    const categoryData = allCats.map(cat => {
      const count = menuItems.filter(m =>
        Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat
      ).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        id: safeId,
        title: `${cat} (${count} items)`
      };
    });

    return {
      categories: categoryData,
      flow_token: flowToken
    };
  },

  /**
   * Create and publish the Category Selection Flow.
   * Stores the Flow ID in process.env.WHATSAPP_CATEGORY_FLOW_ID.
   * @returns {Promise<{flowId: string, status: string}>}
   */
  async setupCategoryFlow() {
    const metaCloud = require('./metaCloud');

    // Check if a flow already exists
    const flows = await metaCloud.getFlows();
    const existing = flows.find(f => f.name === 'JRB Menu Categories');

    if (existing && existing.status === 'PUBLISHED') {
      logger.info('Category Flow already exists and is published', { flowId: existing.id });
      process.env.WHATSAPP_CATEGORY_FLOW_ID = existing.id;
      process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'PUBLISHED';
      return { flowId: existing.id, status: 'already_published' };
    }

    // If exists as draft, reuse it (don't delete - JSON is already uploaded)
    if (existing && existing.status === 'DRAFT') {
      logger.info('Category Flow exists as draft, attempting to publish', { flowId: existing.id });
      try {
        await metaCloud.publishFlow(existing.id);
        process.env.WHATSAPP_CATEGORY_FLOW_ID = existing.id;
        process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'PUBLISHED';
        return { flowId: existing.id, status: 'published' };
      } catch (pubErr) {
        logger.warn('Could not publish existing draft Flow, using draft mode', {
          flowId: existing.id,
          error: pubErr.response?.data?.error?.message || pubErr.message
        });
        process.env.WHATSAPP_CATEGORY_FLOW_ID = existing.id;
        process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'DRAFT';
        return { flowId: existing.id, status: 'draft' };
      }
    }

    // Step 1: Create the Flow
    const flowJson = this.buildCategoryFlowJSON();
    const createResult = await metaCloud.createFlow('JRB Menu Categories', ['OTHER']);
    const flowId = createResult.id;

    // Step 2: Upload the Flow JSON
    await metaCloud.updateFlowJSON(flowId, flowJson);

    // Step 3: Try to publish the Flow
    try {
      await metaCloud.publishFlow(flowId);
      process.env.WHATSAPP_CATEGORY_FLOW_ID = flowId;
      process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'PUBLISHED';
      logger.info('Category Flow created and published', { flowId });
      return { flowId, status: 'created_and_published' };
    } catch (pubErr) {
      logger.warn('Flow created but publish failed, using draft mode', {
        flowId,
        error: pubErr.response?.data?.error?.message || pubErr.message
      });
      process.env.WHATSAPP_CATEGORY_FLOW_ID = flowId;
      process.env.WHATSAPP_CATEGORY_FLOW_STATUS = 'DRAFT';
      return { flowId, status: 'created_as_draft' };
    }
  },

  /**
   * Get the category Flow ID (from env or cached).
   * @returns {string|null}
   */
  getCategoryFlowId() {
    return process.env.WHATSAPP_CATEGORY_FLOW_ID || null;
  },

  /**
   * Get the Flow send mode (published, draft, or null if blocked).
   * @returns {string|null} 'published', 'draft', or null if blocked/unavailable
   */
  getCategoryFlowMode() {
    const status = process.env.WHATSAPP_CATEGORY_FLOW_STATUS || 'DRAFT';
    if (status === 'BLOCKED') return null;
    return status === 'PUBLISHED' ? 'published' : 'draft';
  }
};

module.exports = catalogService;
