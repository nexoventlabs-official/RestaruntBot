const express = require('express');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
const MenuItem = require('../models/MenuItem');
const authMiddleware = require('../middleware/auth');
const cloudinaryService = require('../services/cloudinary');
const dataEvents = require('../services/eventEmitter');
const catalogService = require('../services/catalogService');
const generateAutoTags = require('../services/generateAutoTags');
const multer = require('multer');
const { publicRateLimiter } = require('../middleware/rateLimiter');
const { validators } = require('../middleware/inputValidation');
const router = express.Router();

// Rate limiting for public menu routes
router.use(publicRateLimiter);

// Configure multer for memory storage — supports main image + variant images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Multer fields: 'image' for main item image, 'variantImages' for variant-specific images
const menuUpload = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'variantImages', maxCount: 20 }
]);

router.get('/', async (req, res) => {
  try {
    const items = await MenuItem.find().sort({ category: 1, name: 1 });
    res.json(items);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category');
    res.json(categories);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.post('/', authMiddleware, menuUpload, async (req, res) => {
  try {
    const { name, description, price, originalPrice, category, unit, quantity, foodType, offerType, available, preparationTime, tags, image, variants } = req.body;
    
    // Trim whitespace from name and description
    const trimmedName = name ? name.trim() : '';
    const trimmedDescription = description ? description.trim() : '';
    
    if (!trimmedName) {
      return res.status(400).json({ error: 'Item name is required' });
    }
    
    const parseTags = (t) => Array.isArray(t) ? t : (typeof t === 'string' ? t.split(',').map(s => s.trim()).filter(Boolean) : []);
    const parseCategory = (c) => {
      if (Array.isArray(c)) return c;
      if (typeof c === 'string') {
        try { return JSON.parse(c); } catch { return [c]; }
      }
      return [];
    };
    const parseOfferType = (o) => {
      if (Array.isArray(o)) return o;
      if (typeof o === 'string') {
        try { return JSON.parse(o); } catch { return o ? [o] : []; }
      }
      return [];
    };
    
    let imageUrl = image || null;
    
    // If file uploaded, upload to Cloudinary
    if (req.files?.image?.[0]) {
      imageUrl = await cloudinaryService.uploadFromBuffer(req.files.image[0].buffer, 'restaurant-bot/menu-items');
    }
    
    const parsedCategory = parseCategory(category);
    const parsedFoodType = foodType || 'none';
    const parsedUnit = unit || 'piece';
    const parsedQuantity = parseFloat(quantity) || 1;
    
    // Combine user-provided tags with auto-generated tags
    const userTags = parseTags(tags);
    const autoTags = generateAutoTags(trimmedName, parsedFoodType, parsedUnit, parsedQuantity, parsedCategory);
    const allTags = [...new Set([...userTags, ...autoTags])]; // Remove duplicates
    
    const itemData = {
      name: trimmedName, description: trimmedDescription, price: parseFloat(price), category: parsedCategory,
      unit: parsedUnit,
      quantity: parsedQuantity,
      foodType: parsedFoodType,
      offerType: parseOfferType(offerType),
      available: available !== false && available !== 'false',
      preparationTime: parseInt(preparationTime) || 15,
      tags: allTags,
      image: imageUrl
    };
    
    // Add originalPrice if provided
    if (originalPrice && originalPrice.trim()) {
      itemData.originalPrice = parseFloat(originalPrice);
    }

    // Parse and add variants if provided
    if (variants) {
      let parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      if (Array.isArray(parsedVariants) && parsedVariants.length > 0) {
        const variantImages = req.files?.variantImages || [];
        // Map uploaded files to their correct variant indices
        const variantImageIndices = req.body.variantImageIndices
          ? JSON.parse(req.body.variantImageIndices)
          : variantImages.map((_, i) => i); // fallback: sequential
        const imageFileMap = {};
        variantImageIndices.forEach((variantIdx, fileIdx) => {
          if (variantImages[fileIdx]) imageFileMap[variantIdx] = variantImages[fileIdx];
        });
        itemData.variants = await Promise.all(parsedVariants.map(async (v, idx) => {
          let variantImage = v.image || null;
          // Check if there's an uploaded file for this variant index
          if (imageFileMap[idx]) {
            variantImage = await cloudinaryService.uploadFromBuffer(imageFileMap[idx].buffer, 'restaurant-bot/menu-variants');
          }
          const parsedPrice = parseFloat(v.price) || 0;
          const variantData = {
            label: v.label ? v.label.trim() : '',
            variantType: 'size',
            price: parsedPrice,
            offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : undefined,
            quantity: v.quantity ? parseFloat(v.quantity) : 1,
            unit: v.unit || 'piece',
            image: variantImage,
            description: v.description ? v.description.trim() : '',
            foodType: v.foodType || 'none',
            tags: Array.isArray(v.tags) ? v.tags : (typeof v.tags === 'string' ? v.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
            available: v.available !== false && v.available !== 'false'
          };
          // Multiple quantity options per variant
          if (v.quantities && Array.isArray(v.quantities) && v.quantities.length > 0) {
            variantData.quantities = v.quantities.map(q => ({
              quantity: parseFloat(q.quantity) || 1,
              unit: q.unit || 'piece',
              price: parseFloat(q.price) || parsedPrice,
              offerPrice: q.offerPrice ? parseFloat(q.offerPrice) : undefined
            }));
            // If no direct price set, derive from first quantity option
            if (!parsedPrice && variantData.quantities.length > 0) {
              variantData.price = variantData.quantities[0].price || 0;
            }
          }
          return variantData;
        }));
      }
    }
    
    const item = new MenuItem(itemData);
    await item.save();
    
    // Sync to Meta Commerce Catalog (non-blocking)
    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for new item', { itemId: item._id, error: err.message });
    });
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.status(201).json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.put('/:id', authMiddleware, menuUpload, async (req, res) => {
  try {
    const { name, description, price, originalPrice, category, unit, quantity, foodType, offerType, available, preparationTime, tags, image, removeImage, variants } = req.body;
    
    // Trim whitespace from name and description
    const trimmedName = name ? name.trim() : '';
    const trimmedDescription = description ? description.trim() : '';
    
    const parseTags = (t) => Array.isArray(t) ? t : (typeof t === 'string' ? t.split(',').map(s => s.trim()).filter(Boolean) : []);
    const parseCategory = (c) => {
      if (Array.isArray(c)) return c;
      if (typeof c === 'string') {
        try { return JSON.parse(c); } catch { return [c]; }
      }
      return [];
    };
    const parseOfferType = (o) => {
      if (Array.isArray(o)) return o;
      if (typeof o === 'string') {
        try { return JSON.parse(o); } catch { return o ? [o] : []; }
      }
      return [];
    };
    
    // Get existing item to check for old image
    const existingItem = await MenuItem.findById(req.params.id);
    let imageUrl = existingItem?.image || null;
    
    // If removeImage flag is set, clear the image
    if (removeImage === 'true' || removeImage === true) {
      // Delete old image from Cloudinary if it exists
      if (existingItem?.image && existingItem.image.includes('cloudinary.com')) {
        try {
          const publicId = cloudinaryService.extractPublicId(existingItem.image);
          if (publicId) await cloudinaryService.deleteImage(publicId);
        } catch (e) {
          logger.info('Could not delete old image:', e.message);
        }
      }
      imageUrl = null;
    }
    // If new file uploaded, upload to Cloudinary
    else if (req.files?.image?.[0]) {
      // Delete old image from Cloudinary if it exists
      if (existingItem?.image && existingItem.image.includes('cloudinary.com')) {
        try {
          const publicId = cloudinaryService.extractPublicId(existingItem.image);
          if (publicId) await cloudinaryService.deleteImage(publicId);
        } catch (e) {
          logger.info('Could not delete old image:', e.message);
        }
      }
      imageUrl = await cloudinaryService.uploadFromBuffer(req.files.image[0].buffer, 'restaurant-bot/menu-items');
    }
    // If image URL provided (for backward compatibility)
    else if (image && image !== existingItem?.image) {
      imageUrl = image;
    }
    
    const parsedCategory = parseCategory(category);
    const finalName = trimmedName || existingItem?.name || '';
    const parsedFoodType = foodType || 'none';
    const parsedUnit = unit || 'piece';
    const parsedQuantity = parseFloat(quantity) || 1;
    
    // Combine user-provided tags with auto-generated tags
    const userTags = parseTags(tags);
    const autoTags = generateAutoTags(finalName, parsedFoodType, parsedUnit, parsedQuantity, parsedCategory);
    const allTags = [...new Set([...userTags, ...autoTags])]; // Remove duplicates
    
    const update = {
      name: finalName, description: trimmedDescription, price: parseFloat(price), category: parsedCategory,
      unit: parsedUnit,
      quantity: parsedQuantity,
      foodType: parsedFoodType,
      offerType: parseOfferType(offerType),
      available: available !== false && available !== 'false',
      preparationTime: parseInt(preparationTime) || 15,
      tags: allTags,
      image: imageUrl
    };
    
    // Add originalPrice if provided, otherwise remove it
    if (originalPrice && originalPrice.trim()) {
      update.originalPrice = parseFloat(originalPrice);
    } else {
      update.originalPrice = null;
    }

    // Parse and update variants if provided
    const existingVariants = existingItem?.variants || [];
    if (variants) {
      let parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      if (Array.isArray(parsedVariants)) {
        const variantImages = req.files?.variantImages || [];

        // Detect removed variants — delete their Cloudinary images
        for (let i = parsedVariants.length; i < existingVariants.length; i++) {
          const oldImg = existingVariants[i]?.image;
          if (oldImg && oldImg.includes('cloudinary.com')) {
            try {
              const pid = cloudinaryService.extractPublicId(oldImg);
              if (pid) await cloudinaryService.deleteImage(pid);
              logger.info('Deleted removed variant image from Cloudinary', { variantIndex: i, publicId: pid });
            } catch (e) {
              logger.warn('Failed to delete variant image from Cloudinary', { variantIndex: i, error: e.message });
            }
          }
        }

        // Delete removed variant products from Meta catalog (non-blocking)
        catalogService.deleteRemovedVariantProducts(req.params.id, existingVariants, parsedVariants).catch(err => {
          logger.info('Meta variant cleanup skipped', { error: err.message });
        });

        // Map uploaded files to their correct variant indices
        const variantImageIndices = req.body.variantImageIndices
          ? JSON.parse(req.body.variantImageIndices)
          : variantImages.map((_, i) => i); // fallback: sequential
        const imageFileMap = {};
        variantImageIndices.forEach((variantIdx, fileIdx) => {
          if (variantImages[fileIdx]) imageFileMap[variantIdx] = variantImages[fileIdx];
        });

        update.variants = await Promise.all(parsedVariants.map(async (v, idx) => {
          let variantImage = v.image || null;
          // Check if there's a newly uploaded file for this variant index
          if (imageFileMap[idx]) {
            // Delete old variant image from Cloudinary
            const oldImage = existingVariants[idx]?.image;
            if (oldImage && oldImage.includes('cloudinary.com')) {
              try {
                const pid = cloudinaryService.extractPublicId(oldImage);
                if (pid) await cloudinaryService.deleteImage(pid);
              } catch (e) {
                logger.warn('Failed to delete old variant image from Cloudinary', { variantIndex: idx, error: e.message });
              }
            }
            variantImage = await cloudinaryService.uploadFromBuffer(imageFileMap[idx].buffer, 'restaurant-bot/menu-variants');
          }
          const parsedPrice = parseFloat(v.price) || 0;
          const variantData = {
            label: v.label ? v.label.trim() : '',
            variantType: 'size',
            price: parsedPrice,
            offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : undefined,
            quantity: v.quantity ? parseFloat(v.quantity) : 1,
            unit: v.unit || 'piece',
            image: variantImage,
            description: v.description ? v.description.trim() : '',
            foodType: v.foodType || 'none',
            tags: Array.isArray(v.tags) ? v.tags : (typeof v.tags === 'string' ? v.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
            available: v.available !== false && v.available !== 'false'
          };
          // Multiple quantity options per variant
          if (v.quantities && Array.isArray(v.quantities) && v.quantities.length > 0) {
            variantData.quantities = v.quantities.map(q => ({
              quantity: parseFloat(q.quantity) || 1,
              unit: q.unit || 'piece',
              price: parseFloat(q.price) || parsedPrice,
              offerPrice: q.offerPrice ? parseFloat(q.offerPrice) : undefined
            }));
            // If no direct price set, derive from first quantity option
            if (!parsedPrice && variantData.quantities.length > 0) {
              variantData.price = variantData.quantities[0].price || 0;
            }
          }
          return variantData;
        }));
      }
    } else if (variants === '[]' || variants === '') {
      // All variants removed — delete all variant images from Cloudinary
      for (const oldV of existingVariants) {
        if (oldV?.image && oldV.image.includes('cloudinary.com')) {
          try {
            const pid = cloudinaryService.extractPublicId(oldV.image);
            if (pid) await cloudinaryService.deleteImage(pid);
          } catch (e) {
            logger.warn('Failed to delete variant image during cleanup', { error: e.message });
          }
        }
      }
      // Delete all variant products from Meta catalog (non-blocking)
      catalogService.deleteRemovedVariantProducts(req.params.id, existingVariants, []).catch(err => {
        logger.info('Meta variant cleanup skipped', { error: err.message });
      });
      update.variants = [];
    }
    
    const item = await MenuItem.findByIdAndUpdate(req.params.id, update, { new: true });
    
    // Sync updated item to Meta Commerce Catalog (non-blocking)
    if (item) {
      catalogService.syncProductToMeta(item).catch(err => {
        logger.info('Catalog sync skipped for updated item', { itemId: item._id, error: err.message });
      });
    }
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Get item to delete its images from Cloudinary
    const item = await MenuItem.findById(req.params.id);
    if (item?.image && item.image.includes('cloudinary.com')) {
      try {
        const publicId = cloudinaryService.extractPublicId(item.image);
        if (publicId) await cloudinaryService.deleteImage(publicId);
      } catch (e) {
        logger.info('Could not delete main image:', e.message);
      }
    }
    // Also delete all variant images from Cloudinary
    if (item?.variants?.length > 0) {
      for (const v of item.variants) {
        if (v.image && v.image.includes('cloudinary.com')) {
          try {
            const pid = cloudinaryService.extractPublicId(v.image);
            if (pid) await cloudinaryService.deleteImage(pid);
          } catch (e) {
            logger.info('Could not delete variant image:', e.message);
          }
        }
      }
    }
    
    // Delete from Meta Commerce Catalog (non-blocking)
    catalogService.deleteProductFromMeta(req.params.id).catch(err => {
      logger.info('Catalog delete skipped', { itemId: req.params.id, error: err.message });
    });
    
    await MenuItem.findByIdAndDelete(req.params.id);
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.json({ success: true });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Toggle pause status for a menu item
router.patch('/:id/toggle-pause', authMiddleware, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    item.isPaused = !item.isPaused;
    await item.save();
    
    // Sync pause status to Meta Catalog (updates availability)
    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for pause toggle', { itemId: item._id, error: err.message });
    });
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Bulk pause items by category
router.patch('/bulk-pause', authMiddleware, async (req, res) => {
  try {
    const { categoryName, isPaused } = req.body;
    if (!categoryName) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    const result = await MenuItem.updateMany(
      { category: categoryName },
      { isPaused: isPaused !== false }
    );
    
    // Sync all affected items to Meta Catalog (updates availability) — non-blocking
    MenuItem.find({ category: categoryName }).lean().then(items => {
      for (const item of items) {
        catalogService.syncProductToMeta(item).catch(() => {});
      }
    }).catch(() => {});
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Delete a single variant from a menu item (Cloudinary + Meta + MongoDB)
router.delete('/:id/variant/:variantIndex', authMiddleware, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const vIdx = parseInt(req.params.variantIndex);
    if (!item.variants || !item.variants[vIdx]) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    const variant = item.variants[vIdx];

    // 1. Delete variant image from Cloudinary
    if (variant.image && variant.image.includes('cloudinary.com')) {
      try {
        const pid = cloudinaryService.extractPublicId(variant.image);
        if (pid) await cloudinaryService.deleteImage(pid);
        logger.info('Deleted variant image from Cloudinary', { itemId: item._id, variantIndex: vIdx, publicId: pid });
      } catch (e) {
        logger.info('Could not delete variant image:', e.message);
      }
    }

    // 2. Delete variant product(s) from Meta Commerce Catalog (non-blocking)
    const oldVariants = [...item.variants];
    const newVariants = item.variants.filter((_, idx) => idx !== vIdx);
    catalogService.deleteRemovedVariantProducts(req.params.id, oldVariants, newVariants).catch(err => {
      logger.info('Meta variant cleanup skipped', { error: err.message });
    });

    // 3. Remove variant from MongoDB
    item.variants.splice(vIdx, 1);

    // If no variants left, optionally keep the item with empty variants
    // (the admin can add new variants via the form)
    await item.save();

    // Re-sync updated item to Meta catalog so remaining variant IDs are correct
    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped after variant delete', { itemId: item._id, error: err.message });
    });

    // Emit event for real-time updates
    dataEvents.emit('menu');

    res.json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Toggle availability for a single variant
router.patch('/:id/variant/:variantIndex/toggle', authMiddleware, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const vIdx = parseInt(req.params.variantIndex);
    if (!item.variants || !item.variants[vIdx]) {
      return res.status(404).json({ error: 'Variant not found' });
    }
    item.variants[vIdx].available = !item.variants[vIdx].available;
    await item.save();

    // Sync to Meta Catalog (updates availability for this variant)
    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for variant toggle', { itemId: item._id, variantIndex: vIdx, error: err.message });
    });

    dataEvents.emit('menu');
    res.json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Toggle availability for a specific quantity option within a variant
router.patch('/:id/variant/:variantIndex/quantity/:qtyIndex/toggle', authMiddleware, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const vIdx = parseInt(req.params.variantIndex);
    const qIdx = parseInt(req.params.qtyIndex);
    if (!item.variants || !item.variants[vIdx]) {
      return res.status(404).json({ error: 'Variant not found' });
    }
    if (!item.variants[vIdx].quantities || !item.variants[vIdx].quantities[qIdx]) {
      return res.status(404).json({ error: 'Quantity option not found' });
    }
    const qty = item.variants[vIdx].quantities[qIdx];
    qty.available = qty.available === false ? true : false;
    await item.save();

    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for quantity toggle', { itemId: item._id, variantIndex: vIdx, qtyIndex: qIdx, error: err.message });
    });

    dataEvents.emit('menu');
    res.json(item);
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

// Bulk mark all variants of a menu item as sold out or available
router.patch('/:id/variants-soldout', authMiddleware, async (req, res) => {
  try {
    const { soldOut } = req.body; // true = sold out, false = available
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (item.variants && item.variants.length > 0) {
      item.variants.forEach(v => { v.available = !soldOut; });
    }
    // Also set parent-level available
    item.available = !soldOut;
    await item.save();

    // Sync to Meta Catalog (updates availability for all variants)
    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for bulk sold out', { itemId: item._id, error: err.message });
    });

    dataEvents.emit('menu');
    res.json(item);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Schedule sold-out for a menu item (all variants) with auto-resume time
router.patch('/:id/schedule-soldout', authMiddleware, async (req, res) => {
  try {
    const { endTime, schedule } = req.body;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (schedule) {
      // Explicit disable payload — admin toggled the schedule OFF in the
      // app (daily master toggle off, or every custom day off). Clear the
      // schedule, restore availability across variants + parent, and let
      // the caller resync Meta below.
      if (schedule.enabled === false) {
        item.soldOutSchedule = {
          enabled: false,
          type: item.soldOutSchedule?.type || 'daily',
          dailyStartTime: null,
          dailyEndTime: null,
          days: [],
        };
        if (item.variants && item.variants.length > 0) {
          item.variants.forEach(v => { v.available = true; });
        }
        item.available = true;
        await item.save();
        catalogService.syncProductToMeta(item).catch(err => {
          logger.info('Catalog sync skipped for schedule disable', { itemId: item._id, error: err.message });
        });
        dataEvents.emit('menu');
        return res.json(item);
      }
      // Reject malformed schedules — a custom schedule with no enabled
      // days, or a daily schedule with missing times, is unsavable. If we
      // accept it the cron loop will treat the item as "outside the
      // availability window" forever and force it permanently sold out
      // (the bug that wiped the entire Biryani category to "Off"). The
      // mobile app already blocks this client-side; this is the
      // server-side guard.
      const sType = schedule.type || 'daily';
      if (sType === 'daily' && (!schedule.dailyStartTime || !schedule.dailyEndTime)) {
        return res.status(400).json({ error: 'Daily schedule requires both start and end time' });
      }
      if (sType === 'custom') {
        const days = Array.isArray(schedule.days) ? schedule.days : [];
        const hasUsableDay = days.some(d => d && d.enabled && d.startTime && d.endTime);
        if (!hasUsableDay) {
          return res.status(400).json({ error: 'Enable at least one weekday with start and end times before saving the custom schedule' });
        }
      }
      // New recurring schedule format
      item.soldOutSchedule = {
        enabled: true,
        type: sType,
        dailyStartTime: schedule.dailyStartTime || null,
        dailyEndTime: schedule.dailyEndTime || null,
        days: schedule.days || [],
      };
      // Check if item should be sold out RIGHT NOW based on schedule
      // Schedule defines the AVAILABILITY window — outside = sold out
      const now = new Date();
      const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      let isWithinSchedule = false;

      if (schedule.type === 'daily' && schedule.dailyStartTime && schedule.dailyEndTime) {
        // Handle overnight (e.g., 22:00 - 06:00)
        if (schedule.dailyEndTime <= schedule.dailyStartTime) {
          isWithinSchedule = currentTime >= schedule.dailyStartTime || currentTime < schedule.dailyEndTime;
        } else {
          isWithinSchedule = currentTime >= schedule.dailyStartTime && currentTime < schedule.dailyEndTime;
        }
      } else if (schedule.type === 'custom' && schedule.days) {
        const daySchedule = schedule.days.find(d => d.day === currentDay && d.enabled);
        if (daySchedule && daySchedule.startTime && daySchedule.endTime) {
          if (daySchedule.endTime <= daySchedule.startTime) {
            isWithinSchedule = currentTime >= daySchedule.startTime || currentTime < daySchedule.endTime;
          } else {
            isWithinSchedule = currentTime >= daySchedule.startTime && currentTime < daySchedule.endTime;
          }
        }
      }

      // Outside schedule = sold out
      if (!isWithinSchedule) {
        if (item.variants && item.variants.length > 0) {
          item.variants.forEach(v => { v.available = false; });
        }
        item.available = false;
      } else {
        // Within schedule = available
        if (item.variants && item.variants.length > 0) {
          item.variants.forEach(v => { v.available = true; });
        }
        item.available = true;
      }
    } else if (endTime) {
      // Legacy: one-time sold out until endTime
      if (item.variants && item.variants.length > 0) {
        item.variants.forEach(v => { v.available = false; });
      }
      item.available = false;
      item.soldOutUntil = endTime;
    }

    await item.save();

    catalogService.syncProductToMeta(item).catch(err => {
      logger.info('Catalog sync skipped for schedule sold out', { itemId: item._id, error: err.message });
    });

    dataEvents.emit('menu');
    res.json(item);
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

// Regenerate auto-tags for all menu items (one-time migration)
router.post('/regenerate-tags', authMiddleware, async (req, res) => {
  try {
    const items = await MenuItem.find();
    let updatedCount = 0;
    
    for (const item of items) {
      const categories = Array.isArray(item.category) ? item.category : [item.category];
      const autoTags = generateAutoTags(item.name, item.foodType, item.unit, item.quantity, categories);
      
      // Combine existing user tags with auto-generated tags
      const existingTags = item.tags || [];
      const allTags = [...new Set([...existingTags, ...autoTags])];
      
      // Update item with new tags
      await MenuItem.findByIdAndUpdate(item._id, { tags: allTags });
      updatedCount++;
    }
    
    // Emit event for real-time updates
    dataEvents.emit('menu');
    
    res.json({ success: true, message: `Regenerated tags for ${updatedCount} items` });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// ===== BULK SYNC ALL ITEMS TO META CATALOG =====
router.post('/sync-catalog', authMiddleware, async (req, res) => {
  try {
    if (!catalogService.isEnabled()) {
      return res.status(400).json({ error: 'Catalog not enabled (META_CATALOG_ID not set)' });
    }

    const items = await MenuItem.find();
    const results = { synced: 0, failed: 0, details: [] };

    for (const item of items) {
      try {
        const metaResponse = await catalogService.syncProductToMeta(item);
        const hasVariants = item.variants && item.variants.length > 0;
        const productCount = hasVariants 
          ? item.variants.reduce((sum, v) => sum + (v.quantities?.length || 1), 0)
          : 1;
        results.synced += productCount;
        results.details.push({ 
          name: item.name, status: 'synced', products: productCount,
          metaResponse: metaResponse,
          variants: hasVariants ? item.variants.map((v, i) => ({
            label: v.label, price: v.price, image: v.image,
            retailerId: v.quantities?.length ? `${item._id}_v${i}_q0` : `${item._id}_v${i}`
          })) : null
        });
      } catch (err) {
        results.failed++;
        results.details.push({ name: item.name, status: 'failed', error: err.message });
      }
    }

    catalogService.clearCache();
    logger.info('Bulk catalog sync completed', results);
    res.json({ success: true, ...results });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// ===== DEBUG: List products in Meta catalog =====
router.get('/catalog-debug', authMiddleware, async (req, res) => {
  try {
    const catalogId = process.env.META_CATALOG_ID;
    if (!catalogId) {
      return res.status(400).json({ error: 'META_CATALOG_ID not set' });
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    
    // Query Meta for all products in catalog
    const axios = require('axios');
    const response = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/products`,
      {
        params: {
          fields: 'id,retailer_id,name,price,availability,image_url,item_group_id,color,size',
          limit: 50,
          access_token: accessToken
        }
      }
    );

    res.json({
      catalogId,
      productCount: response.data?.data?.length || 0,
      products: response.data?.data || [],
      paging: response.data?.paging
    });
  } catch (error) {
    const errorData = error.response?.data?.error || error.response?.data;
    res.status(500).json({ 
      error: errorData?.message || error.message,
      details: errorData 
    });
  }
});

// ===== DEBUG: Check WABA catalog connection =====
router.get('/catalog-connection', authMiddleware, async (req, res) => {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const wabaId = process.env.META_WABA_ID;
    const catalogId = process.env.META_CATALOG_ID;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const axios = require('axios');

    // 1. Check which catalogs are connected to WABA
    let wabaCatalogs = null;
    try {
      const r1 = await axios.get(
        `https://graph.facebook.com/v24.0/${wabaId}/product_catalogs`,
        { params: { access_token: accessToken } }
      );
      wabaCatalogs = r1.data;
    } catch (e) {
      wabaCatalogs = { error: e.response?.data?.error?.message || e.message };
    }

    // 2. Check phone number commerce settings
    let phoneCommerce = null;
    try {
      const r2 = await axios.get(
        `https://graph.facebook.com/v24.0/${phoneNumberId}`,
        { params: { fields: 'id,display_phone_number,verified_name,is_official_business_account', access_token: accessToken } }
      );
      phoneCommerce = r2.data;
    } catch (e) {
      phoneCommerce = { error: e.response?.data?.error?.message || e.message };
    }

    // 3. Check catalog product count from Meta
    let catalogInfo = null;
    try {
      const r3 = await axios.get(
        `https://graph.facebook.com/v24.0/${catalogId}`,
        { params: { fields: 'id,name,product_count,vertical', access_token: accessToken } }
      );
      catalogInfo = r3.data;
    } catch (e) {
      catalogInfo = { error: e.response?.data?.error?.message || e.message };
    }

    res.json({
      wabaId,
      catalogId,
      phoneNumberId,
      wabaCatalogs,
      phoneCommerce,
      catalogInfo
    });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

module.exports = router;
