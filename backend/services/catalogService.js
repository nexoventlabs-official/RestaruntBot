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

    // Filter items in this category
    const categoryItems = menuItems.filter(item => {
      const cats = Array.isArray(item.category) ? item.category : [item.category];
      return cats.includes(category);
    });

    if (categoryItems.length === 0) return null;

    // Auto-ensure every category item has a catalog mapping
    const retailerIds = [];
    for (const item of categoryItems) {
      const ids = await this.ensureAllCatalogMappings(item);
      if (ids && ids.length > 0) {
        retailerIds.push(...ids);
      }
    }

    if (retailerIds.length === 0) return null;

    return {
      sections: [{
        title: category.substring(0, 24),
        productRetailerIds: retailerIds.slice(0, 30)
      }],
      totalMapped: retailerIds.length
    };
  },

  /**
   * Build product sections for cart items.
   * Auto-ensures catalog mappings for any unmapped items (real-time sync).
   * Puts all cart items into a single section for clean native cart display.
   */
  async buildCartSections(cartItems) {
    if (!this.isEnabled()) return null;
    if (!cartItems || cartItems.length === 0) return null;

    // Auto-ensure every cart item has a catalog mapping
    const retailerIds = [];
    for (const item of cartItems) {
      if (!item.menuItem) continue;
      const retailerId = await this.ensureCatalogMapping(item.menuItem);
      if (retailerId) {
        retailerIds.push(retailerId);
      }
    }

    if (retailerIds.length === 0) return null;

    // Put all cart items in a single section (avoids multi-section rendering issues)
    return {
      sections: [{
        title: 'Your Items',
        productRetailerIds: retailerIds.slice(0, 30)
      }],
      totalMapped: retailerIds.length
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

    // Step 0: Clean up stale mappings (menuItem was deleted)
    try {
      const allMappings = await CatalogProduct.find({}).lean();
      const activeItemIds = new Set(items.map(i => i._id.toString()));
      let cleaned = 0;
      for (const mapping of allMappings) {
        if (!mapping.menuItem || !activeItemIds.has(mapping.menuItem.toString())) {
          await CatalogProduct.deleteOne({ _id: mapping._id });
          cleaned++;
        }
      }
      if (cleaned > 0) {
        logger.info('Cleaned stale catalog mappings', { cleaned });
      }
    } catch (err) {
      logger.error('Failed to clean stale mappings', { error: err.message });
    }

    // Step 1: Create all local CatalogProduct mappings first
    for (const item of items) {
      const itemId = item._id.toString();
      try {
        const existing = await CatalogProduct.findOne({ menuItem: item._id });
        
        if (existing && !overwrite) {
          skipped++;
          continue;
        }

        // One product per menu item — always use plain itemId
        const mappingRetailerId = itemId;

        await CatalogProduct.findOneAndUpdate(
          { menuItem: item._id },
          {
            menuItem: item._id,
            retailerId: mappingRetailerId,
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

      // If overwrite, delete all existing products from Meta first (ensures clean attribute assignment)
      if (overwrite) {
        try {
          const existingMappings = await CatalogProduct.find({ isActive: true }).lean();
          for (const mapping of existingMappings) {
            try {
              await metaCloud.deleteCatalogProduct(catalogId, mapping.retailerId);
            } catch (delErr) {
              // Non-critical: product may not exist in Meta
            }
          }
          // Also delete any old variant-suffixed products from previous sync format
          for (const item of items) {
            if (item.variants && item.variants.length > 0) {
              for (let vIdx = 0; vIdx < item.variants.length; vIdx++) {
                const v = item.variants[vIdx];
                if (v.quantities && v.quantities.length > 0) {
                  for (let qIdx = 0; qIdx < v.quantities.length; qIdx++) {
                    await metaCloud.deleteCatalogProduct(catalogId, `${item._id.toString()}_v${vIdx}_q${qIdx}`).catch(() => {});
                  }
                }
                await metaCloud.deleteCatalogProduct(catalogId, `${item._id.toString()}_v${vIdx}`).catch(() => {});
              }
            }
          }
          logger.info('Deleted existing Meta products for clean overwrite');
          await new Promise(resolve => setTimeout(resolve, 3000)); // Let deletions propagate
        } catch (err) {
          logger.error('Pre-delete during overwrite failed', { error: err.message });
        }
      }

      // Build ONE product per menu item (no per-variant expansion)
      const allProducts = [];

      for (const item of items) {
        const { minPrice, maxPrice, minOfferPrice } = this.getVariantPriceRange(item);
        const prod = {
          retailerId: item._id.toString(),
          name: item.name,
          description: this.buildProductDescription(item),
          price: minPrice,
          currency: 'INR',
          imageUrl: item.image || null,
          category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
          availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
        };
        if (minOfferPrice && minOfferPrice < minPrice) {
          prod.salePrice = minOfferPrice;
        }
        allProducts.push(prod);
      }

      // Push all products in batches (single-product batch endpoint)
      for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
        const batch = allProducts.slice(i, i + BATCH_SIZE);
        try {
          await metaCloud.batchCreateOrUpdateProducts(catalogId, batch);
          metaPushed += batch.length;
          logger.info('Catalog batch pushed', { batchStart: i, count: batch.length });
        } catch (err) {
          metaFailed += batch.length;
          logger.error('Catalog batch failed', { batchStart: i, error: err.message });
        }
        if (i + BATCH_SIZE < singleProducts.length) {
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
   * Get min/max price across all variants (including quantity sub-options).
   * For items without variants, returns the item's own price.
   * @param {Object} menuItem
   * @returns {{ minPrice: number, maxPrice: number, minOfferPrice: number|null }}
   */
  getVariantPriceRange(menuItem) {
    const prices = [];
    const offerPrices = [];

    if (menuItem.variants && menuItem.variants.length > 0) {
      for (const v of menuItem.variants) {
        if (v.quantities && v.quantities.length > 0) {
          for (const q of v.quantities) {
            if (q.price) prices.push(q.price);
            if (q.offerPrice) offerPrices.push(q.offerPrice);
          }
        } else {
          if (v.price) prices.push(v.price);
          if (v.offerPrice) offerPrices.push(v.offerPrice);
        }
      }
    }

    // Fallback to item-level price
    if (prices.length === 0) {
      prices.push(menuItem.price || 0);
      if (menuItem.offerPrice) offerPrices.push(menuItem.offerPrice);
    }

    return {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      minOfferPrice: offerPrices.length > 0 ? Math.min(...offerPrices) : null
    };
  },

  /**
   * Build a rich product description including variant names, price range, and rating info.
   * @param {Object} menuItem - The MenuItem document
   * @returns {string} Description with variants and ratings
   */
  buildProductDescription(menuItem) {
    const parts = [];

    // ── Part 1: Variant names & price range ──
    if (menuItem.variants && menuItem.variants.length > 0) {
      const variantLabels = menuItem.variants
        .filter(v => v.available !== false)
        .map(v => v.label)
        .filter(Boolean);
      if (variantLabels.length > 0) {
        parts.push(`Available: ${variantLabels.join(', ')}`);
      }
      const { minPrice, maxPrice } = this.getVariantPriceRange(menuItem);
      if (minPrice !== maxPrice) {
        parts.push(`₹${minPrice} – ₹${maxPrice}`);
      }
    } else if (menuItem.quantity && menuItem.unit) {
      parts.push(`${menuItem.quantity} ${menuItem.unit}`);
    }

    // ── Part 2: Star rating ──
    const rating = menuItem.avgRating || 0;
    const totalRatings = menuItem.totalRatings || 0;
    const filledStars = Math.min(Math.floor(rating), 5);
    const emptyStars = 5 - filledStars;
    const starLine = '⭐'.repeat(filledStars) + '☆'.repeat(emptyStars);
    if (totalRatings > 0) {
      parts.push(`${starLine} ${rating}/5 (${totalRatings} reviews)`);
    } else {
      parts.push(`${starLine} No reviews yet`);
    }

    // ── Part 3: Food type icon + label ──
    const foodType = menuItem.foodType;
    if (foodType === 'veg') {
      parts.push('🟢 Veg');
    } else if (foodType === 'nonveg') {
      parts.push('🔴 Non-Veg');
    } else if (foodType === 'egg') {
      parts.push('🟡 Egg');
    }

    // ── Part 4: Tags ──
    const tags = menuItem.tags;
    if (tags && tags.length > 0) {
      parts.push(tags.map(t => `#${t}`).join(' '));
    }

    // ── Part 5: Description ──
    const descText = menuItem.description || menuItem.name;
    parts.push(descText);

    return parts.join('\n\n').substring(0, 5000); // Meta catalog description limit
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
      const { minPrice, maxPrice, minOfferPrice } = this.getVariantPriceRange(menuItem);

      const product = {
        retailerId,
        name: menuItem.name,
        description: this.buildProductDescription(menuItem),
        price: minPrice,
        currency: 'INR',
        imageUrl: menuItem.image || null,
        category: Array.isArray(menuItem.category) ? menuItem.category[0] : (menuItem.category || 'Food'),
        availability: (menuItem.available && !menuItem.isPaused) ? 'in stock' : 'out of stock'
      };

      if (minOfferPrice && minOfferPrice < minPrice) {
        product.salePrice = minOfferPrice;
      }

      // Push single product to Meta
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
   * Ensure a menu item has a catalog mapping. If one doesn't exist,
   * auto-creates the local CatalogProduct mapping and pushes to Meta catalog.
   * Used to guarantee native catalog product cards for smart search single results.
   *
   * @param {Object} menuItem - The full MenuItem document
   * @returns {string|null} The retailer ID if successful, null if catalog not enabled
   */
  async ensureCatalogMapping(menuItem) {
    if (!this.isEnabled()) return null;

    const itemId = menuItem._id.toString();

    // Check if mapping already exists (fast path via cache)
    const existingRetailerId = await this.getRetailerId(itemId);
    if (existingRetailerId) return existingRetailerId;

    // No mapping found — auto-create one on the fly
    try {
      logger.info('Auto-creating catalog mapping for item', { itemId, name: menuItem.name });
      await this.syncProductToMeta(menuItem);
      return itemId;
    } catch (err) {
      logger.error('Failed to auto-create catalog mapping', {
        itemId,
        name: menuItem.name,
        error: err.message
      });
      return null;
    }
  },

  /**
   * Ensure a menu item has catalog mappings and return ALL retailer IDs.
   * For variant items, returns all variant IDs (_v0, _v1, _v2, etc.).
   * For single items, returns [itemId].
   * Used in buildCategorySections so item count matches what Meta shows.
   *
   * @param {Object} menuItem - The full MenuItem document
   * @returns {string[]|null} Array of retailer IDs, or null if catalog not enabled
   */
  async ensureAllCatalogMappings(menuItem) {
    if (!this.isEnabled()) return null;

    const itemId = menuItem._id.toString();

    // Ensure base mapping exists (one product per item)
    await this.ensureCatalogMapping(menuItem);
    return [itemId];
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
      // Find the menu item to check for variants
      const menuItem = await MenuItem.findById(menuItemId).lean();
      const mapping = await CatalogProduct.findOne({ menuItem: menuItemId }).lean();
      const baseRetailerId = menuItemId.toString();

      // Delete main product + any old variant-suffixed products from Meta
      if (menuItem?.variants?.length > 0) {
        const deletePromises = [];
        // Clean up old per-variant format products
        menuItem.variants.forEach((v, vIdx) => {
          if (v.quantities && v.quantities.length > 0) {
            v.quantities.forEach((_, qIdx) => {
              deletePromises.push(
                metaCloud.deleteCatalogProduct(catalogId, `${baseRetailerId}_v${vIdx}_q${qIdx}`).catch(() => null)
              );
            });
          }
          deletePromises.push(
            metaCloud.deleteCatalogProduct(catalogId, `${baseRetailerId}_v${vIdx}`).catch(() => null)
          );
        });
        await Promise.all(deletePromises);
      }

      // Also delete the base product (in case it was synced before variants were added)
      const metaResult = await metaCloud.deleteCatalogProduct(catalogId, mapping?.retailerId || baseRetailerId).catch(() => null);

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

      // Helper: get ALL retailer IDs for an item (all variant×quantity combos)
      const getAllRetailerIds = (item) => {
        const itemId = item._id.toString();
        if (item.variants && item.variants.length > 0) {
          const ids = [];
          item.variants.forEach((v, vIdx) => {
            if (v.quantities && v.quantities.length > 0) {
              v.quantities.forEach((_, qIdx) => ids.push(`${itemId}_v${vIdx}_q${qIdx}`));
            } else {
              ids.push(`${itemId}_v${vIdx}`);
            }
          });
          return ids;
        }
        return [itemId];
      };

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

          // Get ALL retailer IDs for each item (all variant×quantity combos)
          const retailerIds = categoryItems.flatMap(getAllRetailerIds);

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

      // Separate variant items from single items
      const allProducts = [];

      for (const item of items) {
        const { minPrice } = this.getVariantPriceRange(item);
        allProducts.push({
          retailerId: item._id.toString(),
          name: item.name,
          description: this.buildProductDescription(item),
          price: minPrice,
          currency: 'INR',
          imageUrl: item.image || null,
          category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
          availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
        });
      }

      if (allProducts.length > 0) {
        await metaCloud.batchCreateOrUpdateProducts(catalogId, allProducts);
        synced += allProducts.length;
      }
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

      let menuItem = null;
      let variantIndex = null;
      let quantityIndex = null;
      let variantLabel = null;
      let variantPrice = null;

      // ── Check if this is a variant+quantity retailer ID (format: {menuItemId}_v{idx}_q{qIdx}) ──
      const vqMatch = retailerId.match(/^(.+)_v(\d+)_q(\d+)$/);
      const variantMatch = !vqMatch ? retailerId.match(/^(.+)_v(\d+)$/) : null;

      if (vqMatch) {
        const baseItemId = vqMatch[1];
        variantIndex = parseInt(vqMatch[2], 10);
        quantityIndex = parseInt(vqMatch[3], 10);
        try {
          menuItem = await MenuItem.findById(baseItemId).lean();
          if (menuItem && menuItem.variants && menuItem.variants[variantIndex]) {
            const variant = menuItem.variants[variantIndex];
            variantLabel = variant.label;
            if (variant.quantities && variant.quantities[quantityIndex]) {
              const q = variant.quantities[quantityIndex];
              variantPrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
              variantLabel = `${variant.label} - ${q.quantity} ${q.unit}`;
            } else {
              variantPrice = variant.offerPrice && variant.offerPrice < variant.price
                ? variant.offerPrice : variant.price;
            }
          }
        } catch (e) {
          logger.warn('Variant+qty lookup failed', { retailerId, error: e.message });
        }
      } else if (variantMatch) {
        const baseItemId = variantMatch[1];
        variantIndex = parseInt(variantMatch[2], 10);
        try {
          menuItem = await MenuItem.findById(baseItemId).lean();
          if (menuItem && menuItem.variants && menuItem.variants[variantIndex]) {
            const variant = menuItem.variants[variantIndex];
            variantLabel = variant.label;
            // Use variant's offer price if available, otherwise variant price
            variantPrice = variant.offerPrice && variant.offerPrice < variant.price
              ? variant.offerPrice : variant.price;
          }
        } catch (e) {
          logger.warn('Variant lookup failed', { retailerId, error: e.message });
        }
      }

      // ── Standard lookup if not a variant or variant lookup failed ──
      if (!menuItem) {
        const mapping = await CatalogProduct.findOne({ retailerId, isActive: true }).lean();
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
      }

      const effectivePrice = variantPrice || menuItem?.offerPrice || menuItem?.price || itemPrice;

      parsedItems.push({
        menuItemId: menuItem?._id || null,
        menuItem: menuItem || null,
        retailerId,
        name: menuItem?.name || product.product_retailer_id,
        variantIndex,
        quantityIndex,
        variantLabel,
        quantity,
        price: effectivePrice,
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
