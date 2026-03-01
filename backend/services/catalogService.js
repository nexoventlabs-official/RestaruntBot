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

    // Auto-ensure every category item has a catalog mapping (real-time sync)
    // For variant items, include ALL variant retailer IDs (not just _v0)
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
   * Build product_list sections for a specific menu item filtered by variant food type.
   * Returns only the retailer IDs of variants whose foodType matches.
   *
   * @param {Object} menuItem - The full MenuItem document (with variants)
   * @param {string} foodType - 'veg', 'nonveg', 'egg', or 'both'
   * @returns {Object|null} { sections, totalMapped } or null
   */
  async buildTitleVariantSections(menuItem, foodType) {
    if (!this.isEnabled()) return null;

    const itemId = menuItem._id.toString();
    const hasVariants = menuItem.variants && menuItem.variants.length > 0;
    if (!hasVariants) return null;

    // Ensure mappings exist
    await this.ensureCatalogMapping(menuItem);

    const retailerIds = [];
    menuItem.variants.forEach((v, vIdx) => {
      // Include unavailable variants — Meta catalog shows them as "out of stock" (grayed out)
      // Check food type match
      const vFoodType = v.foodType || menuItem.foodType || 'none';
      const matches = foodType === 'both' ||
        (foodType === 'veg' && vFoodType === 'veg') ||
        (foodType === 'nonveg' && (vFoodType === 'nonveg' || vFoodType === 'egg')) ||
        (foodType === 'egg' && vFoodType === 'egg');

      if (matches) {
        if (v.quantities && v.quantities.length > 0) {
          v.quantities.forEach((_, qIdx) => {
            retailerIds.push(`${itemId}_v${vIdx}_q${qIdx}`);
          });
        } else {
          retailerIds.push(`${itemId}_v${vIdx}`);
        }
      }
    });

    if (retailerIds.length === 0) return null;

    return {
      sections: [{
        title: menuItem.name.substring(0, 24),
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

    // Auto-ensure every cart item has a catalog mapping, using correct variant retailer IDs
    const retailerIdSet = new Set(); // Deduplicate: same base product in cart multiple times
    for (const item of cartItems) {
      if (!item.menuItem) continue;

      const itemId = item.menuItem._id.toString();
      const hasVariants = item.menuItem.variants && item.menuItem.variants.length > 0;

      // Ensure catalog mapping exists (syncs to Meta if needed)
      const baseRetailerId = await this.ensureCatalogMapping(item.menuItem);
      if (!baseRetailerId) continue;

      // Build the correct retailer ID based on cart item's variant/quantity selection
      if (hasVariants && item.variantIndex !== null && item.variantIndex !== undefined) {
        if (item.quantityIndex !== null && item.quantityIndex !== undefined) {
          retailerIdSet.add(`${itemId}_v${item.variantIndex}_q${item.quantityIndex}`);
        } else {
          retailerIdSet.add(`${itemId}_v${item.variantIndex}`);
        }
      } else {
        retailerIdSet.add(baseRetailerId);
      }
    }

    const retailerIds = [...retailerIdSet];
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

    // Step 0a: Clean up stale offerPrices (offer was deactivated but offerPrice wasn't cleared)
    try {
      const Offer = require('../models/Offer');
      const itemsWithOfferPrice = await MenuItem.find({ offerPrice: { $exists: true } });
      let offerPriceCleaned = 0;
      for (const item of itemsWithOfferPrice) {
        const offerTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
        // Check if any active percentage-based offer exists for this item
        const activeOffer = offerTypes.length > 0 ? await Offer.findOne({
          offerType: { $in: offerTypes },
          isActive: true,
          percentage: { $gt: 0 }
        }) : null;

        if (!activeOffer) {
          // No active offer — clear stale offerPrice from item and variants/quantities
          const clearUpdate = { $unset: { offerPrice: 1 } };
          if (item.variants && item.variants.length > 0) {
            clearUpdate.$set = { variants: item.variants.map(v => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              delete vObj.offerPrice;
              if (vObj.quantities && vObj.quantities.length > 0) {
                vObj.quantities = vObj.quantities.map(q => {
                  const qObj = q.toObject ? q.toObject() : { ...q };
                  delete qObj.offerPrice;
                  return qObj;
                });
              }
              return vObj;
            })};
          }
          await MenuItem.findByIdAndUpdate(item._id, clearUpdate);
          offerPriceCleaned++;
        }
      }
      if (offerPriceCleaned > 0) {
        logger.info('Cleaned stale offerPrices from menu items', { offerPriceCleaned });
        // Re-fetch items after cleanup so autoSync uses clean data
        const freshItems = await MenuItem.find({ available: true, isPaused: false }).lean();
        items.length = 0;
        freshItems.forEach(i => items.push(i));
      }
    } catch (err) {
      logger.error('Failed to clean stale offerPrices', { error: err.message });
    }

    // Step 0b: Clean up stale mappings (menuItem was deleted)
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

        // For variant items, store the first variant's retailer_id (must match actual Meta product ID)
        const hasVariants = item.variants && item.variants.length > 0;
        const hasQuantities = hasVariants && item.variants[0].quantities && item.variants[0].quantities.length > 0;
        const mappingRetailerId = hasQuantities ? `${itemId}_v0_q0` : (hasVariants ? `${itemId}_v0` : itemId);

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
          // Also delete variant suffixed products that aren't in mappings
          for (const item of items) {
            if (item.variants && item.variants.length > 0) {
              for (let vIdx = 0; vIdx < item.variants.length; vIdx++) {
                const v = item.variants[vIdx];
                if (v.quantities && v.quantities.length > 0) {
                  for (let qIdx = 0; qIdx < v.quantities.length; qIdx++) {
                    await metaCloud.deleteCatalogProduct(catalogId, `${item._id.toString()}_v${vIdx}_q${qIdx}`).catch(() => {});
                  }
                } else {
                  await metaCloud.deleteCatalogProduct(catalogId, `${item._id.toString()}_v${vIdx}`).catch(() => {});
                }
              }
            }
          }
          logger.info('Deleted existing Meta products for clean overwrite');
          await new Promise(resolve => setTimeout(resolve, 3000)); // Let deletions propagate
        } catch (err) {
          logger.error('Pre-delete during overwrite failed', { error: err.message });
        }
      }

      // Separate items into variant and non-variant products
      const singleProducts = [];
      const variantProducts = [];

      for (const item of items) {
        if (item.variants && item.variants.length > 0) {
          item.variants.forEach((v, vIdx) => {
            // Check if variant has multiple quantity options
            if (v.quantities && v.quantities.length > 0) {
              // Each variant × quantity combo = a separate catalog product
              // color = item name (variant label), size = quantity+unit
              v.quantities.forEach((q, qIdx) => {
                const sizeLabel = `${q.quantity} ${q.unit}`;
                const variantTitle = `${v.label}, ${q.quantity} ${q.unit}`;
                variantProducts.push({
                  retailerId: `${item._id.toString()}_v${vIdx}_q${qIdx}`,
                  name: variantTitle,
                  description: this.buildProductDescription(item, v, q),
                  price: q.price,
                  currency: 'INR',
                  imageUrl: v.image || item.image || null,
                  category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
                  availability: (v.available !== false && item.available && !item.isPaused) ? 'in stock' : 'out of stock',
                  salePrice: (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : null
                });
              });
            } else {
              // Single quantity variant — still uses dual color+size for proper grouping
              const pillLabel = (v.quantity && v.unit) ? `${v.quantity} ${v.unit}` : 'Standard';
              const variantTitle = (v.quantity && v.unit) ? `${v.label}, ${v.quantity} ${v.unit}` : v.label;
              variantProducts.push({
                retailerId: `${item._id.toString()}_v${vIdx}`,
                name: variantTitle,
                description: this.buildProductDescription(item, v),
                price: v.price,
                currency: 'INR',
                imageUrl: v.image || item.image || null,
                category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
                availability: (v.available !== false && item.available && !item.isPaused) ? 'in stock' : 'out of stock',
                salePrice: (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : null
              });
            }
          });
        } else {
          const prod = {
            retailerId: item._id.toString(),
            name: item.name,
            description: this.buildProductDescription(item),
            price: item.price,
            currency: 'INR',
            imageUrl: item.image || null,
            category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
            availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
          };
          if (item.offerPrice && item.offerPrice < item.price) {
            prod.salePrice = item.offerPrice;
          }
          singleProducts.push(prod);
        }
      }

      // Push variant products first (items_batch endpoint)
      for (let i = 0; i < variantProducts.length; i += BATCH_SIZE) {
        const batch = variantProducts.slice(i, i + BATCH_SIZE);
        try {
          await metaCloud.batchCreateOrUpdateProducts(catalogId, batch);
          metaPushed += batch.length;
          logger.info('Catalog variant batch pushed', { batchStart: i, count: batch.length });
        } catch (err) {
          metaFailed += batch.length;
          logger.error('Catalog variant batch failed', { batchStart: i, error: err.message });
        }
        if (i + BATCH_SIZE < variantProducts.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }

      // Push single products (batch endpoint)
      for (let i = 0; i < singleProducts.length; i += BATCH_SIZE) {
        const batch = singleProducts.slice(i, i + BATCH_SIZE);
        try {
          await metaCloud.batchCreateOrUpdateProducts(catalogId, batch);
          metaPushed += batch.length;
          logger.info('Catalog single batch pushed', { batchStart: i, count: batch.length });
        } catch (err) {
          metaFailed += batch.length;
          logger.error('Catalog single batch failed', { batchStart: i, error: err.message });
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
   * Build a rich product description for Meta catalog.
   * Ratings are excluded by default to prevent catalog disruption during sync.
   * Only the scheduled 2 AM rating sync includes ratings.
   * @param {Object} menuItem - The MenuItem document
   * @param {Object} [variant] - Optional variant object for variant-specific description
   * @param {Object} [quantityOption] - Optional quantity option
   * @param {Object} [options] - Options: { includeRatings: false }
   * @returns {string} Description text
   */
  buildProductDescription(menuItem, variant = null, quantityOption = null, options = {}) {
    const { includeRatings = true } = options;
    const parts = [];

    // ── Part 1: Quantity/unit — use specific quantity option if provided ──
    if (quantityOption && quantityOption.quantity && quantityOption.unit) {
      parts.push(`${quantityOption.quantity} ${quantityOption.unit}`);
    } else if (variant) {
      if (variant.quantity && variant.unit) {
        parts.push(`${variant.quantity} ${variant.unit}`);
      }
    } else if (menuItem.variants && menuItem.variants.length > 0) {
      const labels = menuItem.variants
        .filter(v => v.available !== false)
        .map(v => (v.quantity && v.unit) ? `${v.quantity} ${v.unit}` : v.label)
        .join(', ');
      if (labels) {
        parts.push(`Sizes: ${labels}`);
      }
    } else if (menuItem.quantity && menuItem.unit) {
      parts.push(`${menuItem.quantity} ${menuItem.unit}`);
    }

    // ── Part 2: Star rating (included in all syncs) ──
    if (includeRatings) {
      // For variants: only show ratings if the variant itself has reviews
      // Do NOT fall back to parent item ratings — keep each variant's ratings independent
      let rating, totalRatings;
      if (variant) {
        // Variant product — use only its own ratings, skip if none
        rating = variant.avgRating || 0;
        totalRatings = variant.totalRatings || 0;
      } else {
        // Single (non-variant) item — use item-level ratings
        rating = menuItem.avgRating || 0;
        totalRatings = menuItem.totalRatings || 0;
      }

      const filledStars = Math.min(Math.floor(rating), 5);
      const emptyStars = 5 - filledStars;
      const starLine = '⭐'.repeat(filledStars) + '☆'.repeat(emptyStars);
      if (totalRatings > 0) {
        parts.push(`${starLine} ${rating}/5 (${totalRatings} reviews)`);
      } else {
        parts.push(`☆☆☆☆☆ No reviews yet`);
      }
    }

    // ── Part 3: Food type icon + label (prefer variant-level, fallback to item-level) ──
    const foodType = (variant && variant.foodType) ? variant.foodType : menuItem.foodType;
    if (foodType === 'veg') {
      parts.push('🟢 Veg');
    } else if (foodType === 'nonveg') {
      parts.push('🔴 Non-Veg');
    } else if (foodType === 'egg') {
      parts.push('🟡 Egg');
    }

    // ── Part 4: Tags (variant-level tags if available) ──
    const tags = (variant && variant.tags && variant.tags.length > 0) ? variant.tags : menuItem.tags;
    if (tags && tags.length > 0) {
      parts.push(tags.map(t => `#${t}`).join(' '));
    }

    // ── Part 5: Description (prefer variant-level, fallback to item-level) ──
    const descText = (variant && variant.description) ? variant.description : (menuItem.description || menuItem.name);
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
    const hasVariants = menuItem.variants && menuItem.variants.length > 0;

    try {
      if (hasVariants) {
        // ===== VARIANT PRODUCTS: each variant is a separate catalog product =====
        // No item_group_id — all variants show individually on both iOS and Android.
        // WhatsApp auto-shows "Related items" at bottom of product detail page.
        const variantProducts = [];
        menuItem.variants.forEach((v, vIdx) => {
          if (v.quantities && v.quantities.length > 0) {
            // Variant × quantity combos
            v.quantities.forEach((q, qIdx) => {
              const sizeLabel = `${q.quantity} ${q.unit}`;
              const variantTitle = `${v.label}, ${q.quantity} ${q.unit}`;
              const prod = {
                retailerId: `${retailerId}_v${vIdx}_q${qIdx}`,
                name: variantTitle,
                description: this.buildProductDescription(menuItem, v, q),
                price: q.price,
                currency: 'INR',
                imageUrl: v.image || menuItem.image || null,
                category: Array.isArray(menuItem.category) ? menuItem.category[0] : (menuItem.category || 'Food'),
                availability: (v.available !== false && menuItem.available && !menuItem.isPaused) ? 'in stock' : 'out of stock',
                salePrice: (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : null
              };
              variantProducts.push(prod);
            });
          } else {
            // Single quantity variant
            const pillLabel = (v.quantity && v.unit) ? `${v.quantity} ${v.unit}` : 'Standard';
            const variantTitle = (v.quantity && v.unit) ? `${v.label}, ${v.quantity} ${v.unit}` : v.label;
            const prod = {
              retailerId: `${retailerId}_v${vIdx}`,
              name: variantTitle,
              description: this.buildProductDescription(menuItem, v),
              price: v.price,
              currency: 'INR',
              imageUrl: v.image || menuItem.image || null,
              category: Array.isArray(menuItem.category) ? menuItem.category[0] : (menuItem.category || 'Food'),
              availability: (v.available !== false && menuItem.available && !menuItem.isPaused) ? 'in stock' : 'out of stock',
              salePrice: (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : null
            };
            variantProducts.push(prod);
          }
        });

        // Push ONLY variant products to Meta
        const metaResult = await metaCloud.batchCreateOrUpdateProducts(catalogId, variantProducts);

        // Upsert local mapping
        const firstRetId = variantProducts[0]?.retailerId || `${retailerId}_v0`;
        await CatalogProduct.findOneAndUpdate(
          { menuItem: menuItem._id },
          {
            menuItem: menuItem._id,
            retailerId: firstRetId,
            isActive: menuItem.available && !menuItem.isPaused,
            lastSyncedAt: new Date()
          },
          { upsert: true, new: true }
        );

        this.clearCache();
        logger.info('Product with variants synced to Meta catalog', { 
          itemId: retailerId, name: menuItem.name, variantCount: variantProducts.length,
          retailerIds: variantProducts.map(v => v.retailerId)
        });
        return metaResult;
      }

      // ===== SINGLE PRODUCT (no variants) =====
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

      // If item has an active offer price, send it as sale_price
      if (menuItem.offerPrice && menuItem.offerPrice < menuItem.price) {
        product.salePrice = menuItem.offerPrice;
      }

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
      const syncResult = await this.syncProductToMeta(menuItem);
      // syncProductToMeta returns null on failure (catches its own errors)
      // Don't return a retailer ID if sync actually failed
      if (!syncResult) {
        logger.warn('Catalog sync returned null — product may not exist in Meta', { itemId, name: menuItem.name });
        return null;
      }
      // For variant products, retailerId is {itemId}_v0; for single products, it's itemId
      const hasVariants = menuItem.variants && menuItem.variants.length > 0;
      return hasVariants ? `${itemId}_v0` : itemId;
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
    const hasVariants = menuItem.variants && menuItem.variants.length > 0;

    // Ensure base mapping exists first (syncs ALL variants to Meta including unavailable)
    await this.ensureCatalogMapping(menuItem);

    if (hasVariants) {
      // Return ALL variant retailer IDs for product list display
      // Unavailable variants are shown as "out of stock" (grayed out) by Meta catalog
      const ids = [];
      menuItem.variants.forEach((v, vIdx) => {
        if (v.quantities && v.quantities.length > 0) {
          v.quantities.forEach((_, qIdx) => {
            ids.push(`${itemId}_v${vIdx}_q${qIdx}`);
          });
        } else {
          ids.push(`${itemId}_v${vIdx}`);
        }
      });
      return ids;
    }
    return [itemId];
  },

  /**
   * Delete stale variant products from Meta when variants are removed or reduced.
   * Compares old variants to new variants and deletes any retailer IDs that no longer exist.
   *
   * @param {string} menuItemId - The MenuItem _id
   * @param {Array} oldVariants - Previous variants array from the existing document
   * @param {Array} newVariants - New variants array being saved
   */
  async deleteRemovedVariantProducts(menuItemId, oldVariants = [], newVariants = []) {
    if (!this.isEnabled()) return;
    const catalogId = this.getCatalogId();
    const metaCloud = require('./metaCloud');
    const baseId = menuItemId.toString();

    // Build set of OLD retailer IDs
    const oldIds = new Set();
    (oldVariants || []).forEach((v, vIdx) => {
      if (v.quantities && v.quantities.length > 0) {
        v.quantities.forEach((_, qIdx) => oldIds.add(`${baseId}_v${vIdx}_q${qIdx}`));
      } else {
        oldIds.add(`${baseId}_v${vIdx}`);
      }
    });

    // Build set of NEW retailer IDs
    const newIds = new Set();
    (newVariants || []).forEach((v, vIdx) => {
      if (v.quantities && Array.isArray(v.quantities) && v.quantities.length > 0) {
        v.quantities.forEach((_, qIdx) => newIds.add(`${baseId}_v${vIdx}_q${qIdx}`));
      } else {
        newIds.add(`${baseId}_v${vIdx}`);
      }
    });

    // Delete IDs that exist in old but not in new
    const toDelete = [...oldIds].filter(id => !newIds.has(id));
    if (toDelete.length > 0) {
      logger.info('Deleting removed variant products from Meta', { menuItemId: baseId, retailerIds: toDelete });
      await Promise.all(
        toDelete.map(rid => metaCloud.deleteCatalogProduct(catalogId, rid).catch(() => null))
      );
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
      // Find the menu item to check for variants
      const menuItem = await MenuItem.findById(menuItemId).lean();
      const mapping = await CatalogProduct.findOne({ menuItem: menuItemId }).lean();
      const baseRetailerId = menuItemId.toString();

      // Delete all variant products from Meta catalog if they exist
      if (menuItem?.variants?.length > 0) {
        const deletePromises = [];
        menuItem.variants.forEach((v, vIdx) => {
          if (v.quantities && v.quantities.length > 0) {
            v.quantities.forEach((_, qIdx) => {
              deletePromises.push(
                metaCloud.deleteCatalogProduct(catalogId, `${baseRetailerId}_v${vIdx}_q${qIdx}`).catch(() => null)
              );
            });
          } else {
            deletePromises.push(
              metaCloud.deleteCatalogProduct(catalogId, `${baseRetailerId}_v${vIdx}`).catch(() => null)
            );
          }
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
      const singleProducts = [];
      const variantProducts = [];

      for (const item of items) {
        if (item.variants && item.variants.length > 0) {
          // Re-sync all variants with updated description (includes ratings)
          // IMPORTANT: Must match syncProductToMeta format — NO itemGroupId/colorLabel/sizeLabel
          // Adding those fields changes the product type in Meta catalog and invalidates existing product links
          item.variants.forEach((v, vIdx) => {
            if (v.quantities && v.quantities.length > 0) {
              v.quantities.forEach((q, qIdx) => {
                const variantTitle = `${v.label}, ${q.quantity} ${q.unit}`;
                variantProducts.push({
                  retailerId: `${item._id.toString()}_v${vIdx}_q${qIdx}`,
                  name: variantTitle,
                  description: this.buildProductDescription(item, v, q, { includeRatings: true }),
                  price: q.price,
                  currency: 'INR',
                  imageUrl: v.image || item.image || null,
                  category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
                  availability: (v.available !== false && item.available && !item.isPaused) ? 'in stock' : 'out of stock',
                  salePrice: (q.offerPrice && q.offerPrice < q.price) ? q.offerPrice : null
                });
              });
            } else {
              const variantTitle = (v.quantity && v.unit) ? `${v.label}, ${v.quantity} ${v.unit}` : v.label;
              variantProducts.push({
                retailerId: `${item._id.toString()}_v${vIdx}`,
                name: variantTitle,
                description: this.buildProductDescription(item, v, null, { includeRatings: true }),
                price: v.price,
                currency: 'INR',
                imageUrl: v.image || item.image || null,
                category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
                availability: (v.available !== false && item.available && !item.isPaused) ? 'in stock' : 'out of stock',
                salePrice: (v.offerPrice && v.offerPrice < v.price) ? v.offerPrice : null
              });
            }
          });
        } else {
          singleProducts.push({
            retailerId: item._id.toString(),
            name: item.name,
            description: this.buildProductDescription(item, null, null, { includeRatings: true }),
            price: item.price,
            currency: 'INR',
            imageUrl: item.image || null,
            category: Array.isArray(item.category) ? item.category[0] : (item.category || 'Food'),
            availability: (item.available && !item.isPaused) ? 'in stock' : 'out of stock'
          });
        }
      }

      if (variantProducts.length > 0) {
        await metaCloud.batchCreateOrUpdateProducts(catalogId, variantProducts);
        synced += variantProducts.length;
      }
      if (singleProducts.length > 0) {
        await metaCloud.batchCreateOrUpdateProducts(catalogId, singleProducts);
        synced += singleProducts.length;
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
  },

  // ============ WELCOME SERVICE SELECTION FLOW ============

  /**
   * Build the Flow JSON for the welcome service selection screen.
   * Single-screen Flow with Dropdown showing available services.
   * Each service has an id, title, and description.
   *
   * @returns {object} Flow JSON definition
   */
  buildWelcomeFlowJSON(bannerUrl) {
    // Build Image child only if a valid banner URL is provided
    const imageChild = bannerUrl ? {
      type: 'Image',
      src: bannerUrl,
      width: 500,
      height: 100,
      'scale-type': 'cover',
      'alt-text': 'Welcome to Perivi Hotel'
    } : null;

    return {
      version: '6.3',
      screens: [
        {
          id: 'SERVICE_SELECT',
          title: 'Welcome',
          terminal: true,
          success: true,
          data: {
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  image: { type: 'string' }
                }
              },
              __example__: [
                { id: 'order_food', title: 'Order Food', description: 'Browse our menu and place an order', image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' },
                { id: 'my_orders', title: 'My Orders', description: 'Check order status & track delivery', image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' },
                { id: 'view_offers', title: 'View Offers', description: 'See current deals and discounts', image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' },
                { id: 'open_website', title: 'Visit Website', description: 'View our full website', image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' },
                { id: 'help', title: 'Help & Support', description: 'Get assistance with your queries', image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' }
              ]
            },
            flow_token: {
              type: 'string',
              __example__: 'welcome_service_919999999999'
            }
          },
          layout: {
            type: 'SingleColumnLayout',
            children: [
              // Include banner image only if URL is provided
              ...(imageChild ? [imageChild] : []),
              {
                type: 'TextHeading',
                text: 'How can we help you today?'
              },
              {
                type: 'TextBody',
                text: 'Choose a service to get started with your order or check your existing orders.'
              },
              {
                type: 'Dropdown',
                name: 'selected_service',
                label: 'Select a Service',
                required: true,
                'data-source': '${data.services}'
              },
              {
                type: 'Footer',
                label: 'Continue',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    selected_service: '${form.selected_service}',
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
   * Build data payload for the welcome service selection Flow.
   * Fetches chatbot images from admin panel for each service icon.
   * @param {string} flowToken - Unique token to identify this flow instance
   * @returns {Promise<object>} { services: [{id, title, description, image}], flow_token }
   */
  async buildWelcomeFlowData(flowToken = 'welcome_service') {
    const chatbotImagesService = require('./chatbotImages');

    // Fetch all service icons from admin-configured chatbot images
    const [orderFoodImg, myOrdersImg, viewOffersImg, accountDetailsImg, deliveryAddressImg, visitWebsiteImg, helpSupportImg] = await Promise.all([
      chatbotImagesService.getImageUrl('flow_order_food'),
      chatbotImagesService.getImageUrl('flow_my_orders'),
      chatbotImagesService.getImageUrl('flow_view_offers'),
      chatbotImagesService.getImageUrl('flow_account_details'),
      chatbotImagesService.getImageUrl('flow_delivery_address'),
      chatbotImagesService.getImageUrl('flow_visit_website'),
      chatbotImagesService.getImageUrl('flow_help_support')
    ]);

    // Build service items — only include image if a valid URL is uploaded
    const buildService = (id, title, description, imgUrl) => {
      const item = { id, title, description };
      if (imgUrl) item.image = imgUrl;
      return item;
    };

    const services = [
      buildService('order_food', 'Order Food', 'Browse our menu and place an order', orderFoodImg),
      buildService('my_orders', 'My Orders', 'Check order status & track delivery', myOrdersImg),
      buildService('view_offers', 'View Offers', 'See current deals and discounts', viewOffersImg),
      buildService('account_details', 'Account Details', 'View or update your profile info', accountDetailsImg),
      buildService('delivery_address', 'Delivery Address', 'Manage your delivery addresses', deliveryAddressImg),
      buildService('open_website', 'Visit Website', 'View our full website', visitWebsiteImg),
      buildService('help', 'Help & Support', 'Get assistance with your queries', helpSupportImg)
    ];

    return {
      services,
      flow_token: flowToken
    };
  },

  /**
   * Create and publish the Welcome Service Selection Flow.
   * Stores the Flow ID in process.env.WHATSAPP_WELCOME_FLOW_ID.
   * @returns {Promise<{flowId: string, status: string}>}
   */
  async setupWelcomeFlow() {
    const metaCloud = require('./metaCloud');
    const chatbotImagesService = require('./chatbotImages');

    // Find the latest Welcome flow version number
    const flows = await metaCloud.getFlows();
    const welcomeFlows = flows.filter(f => f.name.startsWith('JRB Welcome Services'));
    
    // Check if any existing version is already published — reuse it
    const published = welcomeFlows.find(f => f.status === 'PUBLISHED');
    if (published) {
      logger.info('Welcome Flow already published, reusing', { flowId: published.id, name: published.name });
      process.env.WHATSAPP_WELCOME_FLOW_ID = published.id;
      process.env.WHATSAPP_WELCOME_FLOW_STATUS = 'PUBLISHED';
      return { flowId: published.id, status: 'already_published' };
    }

    // Auto-increment version
    let maxVersion = 0;
    welcomeFlows.forEach(f => {
      const match = f.name.match(/v(\d+)/);
      if (match) maxVersion = Math.max(maxVersion, parseInt(match[1]));
    });
    const nextVersion = maxVersion + 1;
    const FLOW_NAME = `JRB Welcome Services v${nextVersion}`;

    // Get admin-configured banner URL (Cloudinary direct URL used in flow JSON)
    const bannerUrl = await chatbotImagesService.getImageUrl('flow_welcome_banner');

    // Step 1: Create the Flow
    const createResult = await metaCloud.createFlow(FLOW_NAME, ['OTHER']);
    const flowId = createResult.id;

    // Step 2: Upload the Flow JSON with banner URL directly in Image src
    const flowJson = this.buildWelcomeFlowJSON(bannerUrl);
    await metaCloud.updateFlowJSON(flowId, flowJson);

    // Step 3: Try to publish the Flow
    try {
      await metaCloud.publishFlow(flowId);
      process.env.WHATSAPP_WELCOME_FLOW_ID = flowId;
      process.env.WHATSAPP_WELCOME_FLOW_STATUS = 'PUBLISHED';
      logger.info(`Welcome Flow ${FLOW_NAME} created and published`, { flowId });
      return { flowId, status: 'created_and_published' };
    } catch (pubErr) {
      logger.warn(`Welcome Flow ${FLOW_NAME} created but publish failed, using draft mode`, {
        flowId,
        error: pubErr.response?.data?.error?.message || pubErr.message
      });
      process.env.WHATSAPP_WELCOME_FLOW_ID = flowId;
      process.env.WHATSAPP_WELCOME_FLOW_STATUS = 'DRAFT';
      return { flowId, status: 'created_as_draft' };
    }
  },

  /**
   * Republish the Welcome Flow with updated banner image.
   * Creates a new flow version, uploads the banner as an asset, publishes, 
   * then deprecates the old flow.
   * @returns {Promise<{flowId: string, status: string, oldFlowId?: string}>}
   */
  async republishWelcomeFlow() {
    const oldFlowId = process.env.WHATSAPP_WELCOME_FLOW_ID;
    const metaCloud = require('./metaCloud');

    // Force creation of a new version by temporarily clearing the published status
    // so setupWelcomeFlow won't short-circuit on the existing published flow
    const axios = require('axios');
    const { accessToken } = { accessToken: process.env.META_ACCESS_TOKEN };

    // Deprecate old flow first so setupWelcomeFlow creates a new one
    if (oldFlowId) {
      try {
        await axios.post(
          `https://graph.facebook.com/v24.0/${oldFlowId}`,
          { status: 'DEPRECATED' },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        logger.info('Deprecated old welcome flow for republish', { oldFlowId });
      } catch (depErr) {
        logger.warn('Could not deprecate old flow', { oldFlowId, error: depErr.message });
      }
    }

    // Clear env so setupWelcomeFlow creates fresh
    process.env.WHATSAPP_WELCOME_FLOW_ID = '';
    process.env.WHATSAPP_WELCOME_FLOW_STATUS = '';

    // Now setup will create a new version
    const result = await this.setupWelcomeFlow();
    return { ...result, oldFlowId };
  },

  /**
   * Get the Welcome Flow ID (from env or cached).
   * @returns {string|null}
   */
  getWelcomeFlowId() {
    return process.env.WHATSAPP_WELCOME_FLOW_ID || null;
  },

  /**
   * Get the Welcome Flow send mode (published, draft, or null if blocked).
   * @returns {string|null} 'published', 'draft', or null if blocked/unavailable
   */
  getWelcomeFlowMode() {
    const status = process.env.WHATSAPP_WELCOME_FLOW_STATUS || 'DRAFT';
    if (status === 'BLOCKED') return null;
    return status === 'PUBLISHED' ? 'published' : 'draft';
  },

  // ==================== ACCOUNT DETAILS FLOW ====================

  /**
   * Build the Account Details Flow JSON (WhatsApp Flows v6.3).
   * Single screen form: Name + Mobile (pre-filled).
   */
  buildAccountDetailsFlowJSON() {
    return {
      version: '6.3',
      screens: [
        {
          id: 'ACCOUNT_FORM',
          title: 'Account Details',
          terminal: true,
          success: true,
          data: {
            customer_name: {
              type: 'string',
              __example__: 'John'
            },
            customer_phone: {
              type: 'string',
              __example__: '9876543210'
            },
            customer_email: {
              type: 'string',
              __example__: 'john@example.com'
            },
            flow_token: {
              type: 'string',
              __example__: 'account_form_919999999999'
            }
          },
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                type: 'TextHeading',
                text: 'Your Account Details'
              },
              {
                type: 'TextBody',
                text: 'Fill in your details below. Your phone number is auto-filled from WhatsApp.'
              },
              {
                type: 'TextInput',
                name: 'customer_name',
                label: 'Full Name',
                required: true,
                'input-type': 'text',
                'init-value': '${data.customer_name}',
                'helper-text': 'Enter your full name'
              },
              {
                type: 'TextInput',
                name: 'customer_phone',
                label: 'Mobile Number',
                required: true,
                'input-type': 'phone',
                'init-value': '${data.customer_phone}',
                'helper-text': 'Your WhatsApp number (auto-filled)'
              },
              {
                type: 'TextInput',
                name: 'customer_email',
                label: 'Email (Optional)',
                required: false,
                'input-type': 'email',
                'init-value': '${data.customer_email}',
                'helper-text': 'We\'ll send order updates here'
              },
              {
                type: 'Footer',
                label: 'Save Details',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    customer_name: '${form.customer_name}',
                    customer_phone: '${form.customer_phone}',
                    customer_email: '${form.customer_email}',
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
   * Build data payload for the Account Details Flow.
   * Pre-fills name, phone, email from existing customer profile.
   * @param {object} customer - Customer document from DB
   * @param {string} phone - WhatsApp phone number
   * @returns {object}
   */
  buildAccountFormData(customer, phone) {
    // Strip country code for display (91XXXXXXXXXX → XXXXXXXXXX)
    const displayPhone = phone.length > 10 ? phone.slice(-10) : phone;
    return {
      customer_name: customer?.name || '',
      customer_phone: displayPhone,
      customer_email: customer?.email || '',
      flow_token: `account_form_${phone}`
    };
  },

  /**
   * Create and publish the Account Details Flow.
   */
  async setupAccountFlow() {
    const metaCloud = require('./metaCloud');

    const flows = await metaCloud.getFlows();
    const existing = flows.find(f => f.name === 'JRB Account Details v1');

    if (existing && existing.status === 'PUBLISHED') {
      logger.info('Account Flow already published', { flowId: existing.id });
      process.env.WHATSAPP_ACCOUNT_FLOW_ID = existing.id;
      process.env.WHATSAPP_ACCOUNT_FLOW_STATUS = 'PUBLISHED';
      return { flowId: existing.id, status: 'already_published' };
    }

    if (existing && existing.status === 'DRAFT') {
      logger.info('Account Flow exists as draft, updating and publishing', { flowId: existing.id });
      try {
        const flowJson = this.buildAccountDetailsFlowJSON();
        await metaCloud.updateFlowJSON(existing.id, flowJson);
        await metaCloud.publishFlow(existing.id);
        process.env.WHATSAPP_ACCOUNT_FLOW_ID = existing.id;
        process.env.WHATSAPP_ACCOUNT_FLOW_STATUS = 'PUBLISHED';
        return { flowId: existing.id, status: 'published' };
      } catch (pubErr) {
        logger.warn('Could not publish Account Flow draft', {
          flowId: existing.id,
          error: pubErr.response?.data?.error?.message || pubErr.message
        });
        process.env.WHATSAPP_ACCOUNT_FLOW_ID = existing.id;
        process.env.WHATSAPP_ACCOUNT_FLOW_STATUS = 'DRAFT';
        return { flowId: existing.id, status: 'draft' };
      }
    }

    // Create new
    const flowJson = this.buildAccountDetailsFlowJSON();
    const createResult = await metaCloud.createFlow('JRB Account Details v1', ['OTHER']);
    const flowId = createResult.id;
    await metaCloud.updateFlowJSON(flowId, flowJson);

    try {
      await metaCloud.publishFlow(flowId);
      process.env.WHATSAPP_ACCOUNT_FLOW_ID = flowId;
      process.env.WHATSAPP_ACCOUNT_FLOW_STATUS = 'PUBLISHED';
      logger.info('Account Flow created and published', { flowId });
      return { flowId, status: 'created_and_published' };
    } catch (pubErr) {
      logger.warn('Account Flow created but publish failed', {
        flowId,
        error: pubErr.response?.data?.error?.message || pubErr.message
      });
      process.env.WHATSAPP_ACCOUNT_FLOW_ID = flowId;
      process.env.WHATSAPP_ACCOUNT_FLOW_STATUS = 'DRAFT';
      return { flowId, status: 'created_as_draft' };
    }
  },

  getAccountFlowId() {
    return process.env.WHATSAPP_ACCOUNT_FLOW_ID || null;
  },

  getAccountFlowMode() {
    const status = process.env.WHATSAPP_ACCOUNT_FLOW_STATUS || 'DRAFT';
    if (status === 'BLOCKED') return null;
    return status === 'PUBLISHED' ? 'published' : 'draft';
  },

  // ==================== DELIVERY ADDRESS FLOW ====================

  /**
   * Build the Delivery Address Flow JSON (WhatsApp Flows v6.3).
   * Screen 1: Address form with manual entry fields + link to share location.
   * Screen 2: Share Location prompt (completes with method=share_location).
   */
  buildDeliveryAddressFlowJSON() {
    const { indianStates } = require('../config/indianStates');

    const stateOptions = indianStates.map(s => ({
      id: s.id,
      title: s.title
    }));

    return {
      version: '6.3',
      screens: [
        {
          id: 'ADDRESS_FORM',
          title: 'Delivery Address',
          terminal: true,
          success: true,
          data: {
            init_address: {
              type: 'string',
              __example__: '123 Main Street'
            },
            init_landmark: {
              type: 'string',
              __example__: 'Near City Mall'
            },
            init_pincode: {
              type: 'string',
              __example__: '500001'
            },
            init_district: {
              type: 'string',
              __example__: 'Hyderabad'
            },
            state_options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' }
                }
              },
              __example__: stateOptions.slice(0, 3)
            },
            flow_token: {
              type: 'string',
              __example__: 'address_form_919999999999'
            }
          },
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                type: 'TextHeading',
                text: 'Delivery Address'
              },
              {
                type: 'TextBody',
                text: 'Enter your address manually or use your current location.'
              },
              {
                type: 'EmbeddedLink',
                text: '📍 Use Current Location',
                'on-click-action': {
                  name: 'navigate',
                  next: {
                    type: 'screen',
                    name: 'SHARE_LOCATION'
                  },
                  payload: {
                    flow_token: '${data.flow_token}'
                  }
                }
              },
              {
                type: 'TextInput',
                name: 'address_line',
                label: 'Address',
                required: true,
                'input-type': 'text',
                'init-value': '${data.init_address}',
                'helper-text': 'House/Flat No., Street, Area'
              },
              {
                type: 'TextInput',
                name: 'landmark',
                label: 'Landmark',
                required: false,
                'input-type': 'text',
                'init-value': '${data.init_landmark}',
                'helper-text': 'Nearby landmark for easy discovery'
              },
              {
                type: 'TextInput',
                name: 'pincode',
                label: 'Pincode',
                required: true,
                'input-type': 'number',
                'init-value': '${data.init_pincode}',
                'helper-text': '6-digit pincode (auto-detects state & district)'
              },
              {
                type: 'Dropdown',
                name: 'selected_state',
                label: 'State',
                required: true,
                'data-source': '${data.state_options}'
              },
              {
                type: 'TextInput',
                name: 'district',
                label: 'District / City',
                required: true,
                'input-type': 'text',
                'init-value': '${data.init_district}',
                'helper-text': 'Your district or city name'
              },
              {
                type: 'Footer',
                label: 'Save Address',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    address_line: '${form.address_line}',
                    landmark: '${form.landmark}',
                    pincode: '${form.pincode}',
                    selected_state: '${form.selected_state}',
                    district: '${form.district}',
                    flow_token: '${data.flow_token}'
                  }
                }
              }
            ]
          }
        },
        {
          id: 'SHARE_LOCATION',
          title: 'Share Location',
          terminal: true,
          success: true,
          data: {
            flow_token: {
              type: 'string',
              __example__: 'address_form_919999999999'
            }
          },
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                type: 'TextHeading',
                text: '📍 Share Your Location'
              },
              {
                type: 'TextBody',
                text: 'Tap the button below to continue. Then share your current location using WhatsApp\'s location feature:\n\n1️⃣ Tap the 📎 attachment button\n2️⃣ Select \"Location\"\n3️⃣ Choose \"Send Your Current Location\"\n\nYour address will be automatically filled from your location.'
              },
              {
                type: 'Footer',
                label: 'Continue',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    method: 'share_location',
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
   * Build data payload for the Delivery Address Flow.
   * Pre-fills from existing default address if available.
   * @param {object} customer - Customer document
   * @param {string} phone - WhatsApp phone number
   * @returns {object}
   */
  buildAddressFormData(customer, phone) {
    const { indianStates, findStateByName } = require('../config/indianStates');

    // Find existing default address to pre-fill
    const defaultAddr = customer?.addresses?.find(a => a.isDefault) || customer?.addresses?.[0] || {};

    // Try to match existing state to dropdown id
    let initStateId = '';
    if (defaultAddr.state) {
      const matched = findStateByName(defaultAddr.state);
      if (matched) initStateId = matched.id;
    }

    return {
      init_address: defaultAddr.address || '',
      init_landmark: defaultAddr.landmark || '',
      init_pincode: defaultAddr.pincode || '',
      init_district: defaultAddr.district || '',
      state_options: indianStates,
      flow_token: `address_form_${phone}`
    };
  },

  /**
   * Create and publish the Delivery Address Flow.
   */
  async setupAddressFlow() {
    const metaCloud = require('./metaCloud');

    const flows = await metaCloud.getFlows();
    const existing = flows.find(f => f.name === 'JRB Delivery Address v3');

    if (existing && existing.status === 'PUBLISHED') {
      logger.info('Address Flow already published', { flowId: existing.id });
      process.env.WHATSAPP_ADDRESS_FLOW_ID = existing.id;
      process.env.WHATSAPP_ADDRESS_FLOW_STATUS = 'PUBLISHED';
      return { flowId: existing.id, status: 'already_published' };
    }

    if (existing && existing.status === 'DRAFT') {
      logger.info('Address Flow exists as draft, updating and publishing', { flowId: existing.id });
      try {
        const flowJson = this.buildDeliveryAddressFlowJSON();
        await metaCloud.updateFlowJSON(existing.id, flowJson);
        await metaCloud.publishFlow(existing.id);
        process.env.WHATSAPP_ADDRESS_FLOW_ID = existing.id;
        process.env.WHATSAPP_ADDRESS_FLOW_STATUS = 'PUBLISHED';
        return { flowId: existing.id, status: 'published' };
      } catch (pubErr) {
        logger.warn('Could not publish Address Flow draft', {
          flowId: existing.id,
          error: pubErr.response?.data?.error?.message || pubErr.message
        });
        process.env.WHATSAPP_ADDRESS_FLOW_ID = existing.id;
        process.env.WHATSAPP_ADDRESS_FLOW_STATUS = 'DRAFT';
        return { flowId: existing.id, status: 'draft' };
      }
    }

    // Create new
    const flowJson = this.buildDeliveryAddressFlowJSON();
    const createResult = await metaCloud.createFlow('JRB Delivery Address v3', ['OTHER']);
    const flowId = createResult.id;
    await metaCloud.updateFlowJSON(flowId, flowJson);

    try {
      await metaCloud.publishFlow(flowId);
      process.env.WHATSAPP_ADDRESS_FLOW_ID = flowId;
      process.env.WHATSAPP_ADDRESS_FLOW_STATUS = 'PUBLISHED';
      logger.info('Address Flow created and published', { flowId });
      return { flowId, status: 'created_and_published' };
    } catch (pubErr) {
      logger.warn('Address Flow created but publish failed', {
        flowId,
        error: pubErr.response?.data?.error?.message || pubErr.message
      });
      process.env.WHATSAPP_ADDRESS_FLOW_ID = flowId;
      process.env.WHATSAPP_ADDRESS_FLOW_STATUS = 'DRAFT';
      return { flowId, status: 'created_as_draft' };
    }
  },

  getAddressFlowId() {
    return process.env.WHATSAPP_ADDRESS_FLOW_ID || null;
  },

  getAddressFlowMode() {
    const status = process.env.WHATSAPP_ADDRESS_FLOW_STATUS || 'DRAFT';
    if (status === 'BLOCKED') return null;
    return status === 'PUBLISHED' ? 'published' : 'draft';
  }
};

module.exports = catalogService;
