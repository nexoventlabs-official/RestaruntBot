const express = require('express');
const logger = require('../services/logger');
const MenuItem = require('../models/MenuItem');
const authMiddleware = require('../middleware/auth');
const cloudinaryService = require('../services/cloudinary');
const dataEvents = require('../services/eventEmitter');
const catalogService = require('../services/catalogService');
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    
    // Auto-generate tags from item properties
    const generateAutoTags = (itemName, itemFoodType, itemUnit, itemQuantity, itemCategories) => {
      const autoTags = [];
      
      // Add food type tag
      if (itemFoodType === 'veg') {
        autoTags.push('veg', 'vegetarian');
      } else if (itemFoodType === 'nonveg') {
        autoTags.push('nonveg', 'non-veg', 'non veg');
      } else if (itemFoodType === 'egg') {
        autoTags.push('egg', 'eggetarian');
      }
      
      // Add quantity and unit tag (e.g., "5 piece", "250 gram")
      if (itemQuantity && itemUnit) {
        autoTags.push(`${itemQuantity} ${itemUnit}`);
        if (itemQuantity > 1) {
          autoTags.push(`${itemQuantity} ${itemUnit}s`);
        }
      }
      
      // Add category tags
      if (itemCategories && itemCategories.length > 0) {
        autoTags.push(...itemCategories.map(c => c.toLowerCase()));
      }
      
      // Extract words from item name as tags (split by space, filter short words)
      const nameWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      autoTags.push(...nameWords);
      
      return autoTags;
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
        itemData.variants = await Promise.all(parsedVariants.map(async (v, idx) => {
          let variantImage = v.image || null;
          // Check if there's an uploaded file for this variant index
          if (variantImages[idx]) {
            variantImage = await cloudinaryService.uploadFromBuffer(variantImages[idx].buffer, 'restaurant-bot/menu-variants');
          }
          return {
            label: v.label,
            variantType: v.variantType || 'size',
            price: parseFloat(v.price),
            offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : undefined,
            image: variantImage,
            available: v.available !== false && v.available !== 'false'
          };
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
    res.status(500).json({ error: error.message });
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
    
    // Auto-generate tags from item properties
    const generateAutoTags = (itemName, itemFoodType, itemUnit, itemQuantity, itemCategories) => {
      const autoTags = [];
      
      // Add food type tag
      if (itemFoodType === 'veg') {
        autoTags.push('veg', 'vegetarian');
      } else if (itemFoodType === 'nonveg') {
        autoTags.push('nonveg', 'non-veg', 'non veg');
      } else if (itemFoodType === 'egg') {
        autoTags.push('egg', 'eggetarian');
      }
      
      // Add quantity and unit tag (e.g., "5 piece", "250 gram")
      if (itemQuantity && itemUnit) {
        autoTags.push(`${itemQuantity} ${itemUnit}`);
        if (itemQuantity > 1) {
          autoTags.push(`${itemQuantity} ${itemUnit}s`);
        }
      }
      
      // Add category tags
      if (itemCategories && itemCategories.length > 0) {
        autoTags.push(...itemCategories.map(c => c.toLowerCase()));
      }
      
      // Extract words from item name as tags (split by space, filter short words)
      const nameWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      autoTags.push(...nameWords);
      
      return autoTags;
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
    if (variants) {
      let parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      if (Array.isArray(parsedVariants)) {
        const variantImages = req.files?.variantImages || [];
        const existingVariants = existingItem?.variants || [];
        update.variants = await Promise.all(parsedVariants.map(async (v, idx) => {
          let variantImage = v.image || null;
          // Check if there's a newly uploaded file for this variant index
          if (variantImages[idx]) {
            // Delete old variant image from Cloudinary
            const oldImage = existingVariants[idx]?.image;
            if (oldImage && oldImage.includes('cloudinary.com')) {
              try {
                const pid = cloudinaryService.extractPublicId(oldImage);
                if (pid) await cloudinaryService.deleteImage(pid);
              } catch (e) { /* ignore */ }
            }
            variantImage = await cloudinaryService.uploadFromBuffer(variantImages[idx].buffer, 'restaurant-bot/menu-variants');
          }
          return {
            label: v.label,
            variantType: v.variantType || 'size',
            price: parseFloat(v.price),
            offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : undefined,
            image: variantImage,
            available: v.available !== false && v.available !== 'false'
          };
        }));
      }
    } else if (variants === '[]' || variants === '') {
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
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Get item to delete its image from Cloudinary
    const item = await MenuItem.findById(req.params.id);
    if (item?.image && item.image.includes('cloudinary.com')) {
      try {
        const publicId = cloudinaryService.extractPublicId(item.image);
        if (publicId) await cloudinaryService.deleteImage(publicId);
      } catch (e) {
        logger.info('Could not delete image:', e.message);
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// Regenerate auto-tags for all menu items (one-time migration)
router.post('/regenerate-tags', authMiddleware, async (req, res) => {
  try {
    const items = await MenuItem.find();
    let updatedCount = 0;
    
    // Auto-generate tags from item properties
    const generateAutoTags = (itemName, itemFoodType, itemUnit, itemQuantity, itemCategories) => {
      const autoTags = [];
      
      // Add food type tag
      if (itemFoodType === 'veg') {
        autoTags.push('veg', 'vegetarian');
      } else if (itemFoodType === 'nonveg') {
        autoTags.push('nonveg', 'non-veg', 'non veg');
      } else if (itemFoodType === 'egg') {
        autoTags.push('egg', 'eggetarian');
      }
      
      // Add quantity and unit tag (e.g., "5 piece", "250 gram")
      if (itemQuantity && itemUnit) {
        autoTags.push(`${itemQuantity} ${itemUnit}`);
        if (itemQuantity > 1) {
          autoTags.push(`${itemQuantity} ${itemUnit}s`);
        }
      }
      
      // Add category tags
      if (itemCategories && itemCategories.length > 0) {
        autoTags.push(...itemCategories.map(c => c.toLowerCase()));
      }
      
      // Extract words from item name as tags (split by space, filter short words)
      const nameWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      autoTags.push(...nameWords);
      
      return autoTags;
    };
    
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
