const express = require('express');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
const router = express.Router();
const ChatbotImage = require('../models/ChatbotImage');
const cloudinaryService = require('../services/cloudinary');
const chatbotImagesService = require('../services/chatbotImages');
const defaultImages = require('../config/defaultChatbotImages');
const auth = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');

// Apply admin rate limiting
router.use(adminRateLimiter);

// Configure multer for memory storage
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

// Rate limiting for chatbot images routes
router.use(adminRateLimiter);

// Initialize default images if not exist
router.post('/init', auth, async (req, res) => {
  try {
    for (const img of defaultImages) {
      await ChatbotImage.findOneAndUpdate(
        { key: img.key },
        img,
        { upsert: true, new: true }
      );
    }
    res.json({ message: 'Default images initialized', count: defaultImages.length });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Get all chatbot images
router.get('/', auth, async (req, res) => {
  try {
    let images = await ChatbotImage.find().sort('name');
    
    // If no images exist, initialize all defaults
    if (images.length === 0) {
      logger.info('[Chatbot Images] No images found, initializing defaults...');
      for (const img of defaultImages) {
        try {
          await ChatbotImage.create(img);
        } catch (createErr) {
          logger.error('[Chatbot Images] Error', createErr.message);
        }
      }
      images = await ChatbotImage.find().sort('name');
    } else {
      const existingKeys = images.map(img => img.key);
      const validKeys = defaultImages.map(img => img.key);
      
      // Remove stale images no longer in defaults
      const staleKeys = existingKeys.filter(k => !validKeys.includes(k));
      if (staleKeys.length > 0) {
        logger.info('[Chatbot Images] Removing stale images...', { keys: staleKeys });
        for (const key of staleKeys) {
          try {
            const stale = await ChatbotImage.findOne({ key });
            if (stale?.cloudinaryPublicId) {
              await cloudinaryService.deleteImage(stale.cloudinaryPublicId).catch(() => {});
            }
            await ChatbotImage.deleteOne({ key });
            logger.info('[Chatbot Images] Removed stale image', { key });
          } catch (delErr) {
            logger.error('[Chatbot Images] Error removing stale image', delErr.message);
          }
        }
      }
      
      // Check for missing images and add them
      const missingImages = defaultImages.filter(img => !existingKeys.includes(img.key));
      
      if (missingImages.length > 0) {
        logger.info('[Chatbot Images] Found missing images, adding them...', { length : missingImages.length });
        for (const img of missingImages) {
          try {
            await ChatbotImage.create(img);
            logger.info('[Chatbot Images] Added missing image', { key : img.key });
          } catch (createErr) {
            logger.error('[Chatbot Images] Error', createErr.message);
            // Continue with other images even if one fails
          }
        }
      }
      
      if (staleKeys.length > 0 || missingImages.length > 0) {
        images = await ChatbotImage.find().sort('name');
      }
    }
    
    res.json(images);
  } catch (error) {
    return logRouteError(res, '[Chatbot Images] GET error', error);
  }
});

// Get single image by key (for chatbot use - no auth)
router.get('/key/:key', async (req, res) => {
  try {
    const image = await ChatbotImage.findOne({ key: req.params.key });
    if (!image) {
      // Return default if not found
      const defaultImg = defaultImages.find(d => d.key === req.params.key);
      if (defaultImg) {
        return res.json({ imageUrl: defaultImg.imageUrl });
      }
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json({ imageUrl: image.imageUrl });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

// Upload and update image
router.put('/:key', auth, upload.single('image'), async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Find existing image
    let chatbotImage = await ChatbotImage.findOne({ key });
    
    // Delete old image from Cloudinary if exists
    if (chatbotImage?.cloudinaryPublicId) {
      try {
        await cloudinaryService.deleteImage(chatbotImage.cloudinaryPublicId);
      } catch (e) {
        logger.info('Could not delete old image:', e.message);
      }
    }

    // Upload new image to Cloudinary with appropriate aspect ratio
    // Welcome image: 1:1 square (600x600); All others: 2:1 landscape (1200x600)
    const isWelcome = key === 'welcome';
    const cropWidth = isWelcome ? 600 : 1200;
    const cropHeight = isWelcome ? 600 : 600;
    const cloudinary = require('cloudinary').v2;
    
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'restaurant-bot/chatbot-images',
          public_id: `chatbot_${key}_${Date.now()}`,
          transformation: [
            { width: cropWidth, height: cropHeight, crop: 'fill', gravity: 'center' },
            { quality: 'auto:best', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    // Update or create image record
    const defaultImg = defaultImages.find(d => d.key === key);
    
    chatbotImage = await ChatbotImage.findOneAndUpdate(
      { key },
      {
        key,
        name: defaultImg?.name || key,
        description: defaultImg?.description || '',
        imageUrl: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        aspectRatio: isWelcome ? '1:1' : '2:1'
      },
      { upsert: true, new: true }
    );

    // Clear cache so new image is used immediately
    chatbotImagesService.clearCache();
    logger.info('[Chatbot Images] Cache cleared after upload', { key });

    res.json(chatbotImage);
  } catch (error) {
    return logRouteError(res, 'Upload error', error);
  }
});

// Reset image to default
router.post('/:key/reset', auth, async (req, res) => {
  try {
    const { key } = req.params;
    const defaultImg = defaultImages.find(d => d.key === key);
    
    if (!defaultImg) {
      return res.status(404).json({ error: 'Invalid image key' });
    }

    // Find and delete from Cloudinary if custom image exists
    const existing = await ChatbotImage.findOne({ key });
    if (existing?.cloudinaryPublicId) {
      try {
        await cloudinaryService.deleteImage(existing.cloudinaryPublicId);
      } catch (e) {
        logger.info('Could not delete image:', e.message);
      }
    }

    // Reset to default
    const chatbotImage = await ChatbotImage.findOneAndUpdate(
      { key },
      { ...defaultImg, cloudinaryPublicId: null },
      { upsert: true, new: true }
    );

    // Clear cache so reset takes effect immediately
    chatbotImagesService.clearCache();
    logger.info('[Chatbot Images] Cache cleared after resetting', { key });

    res.json(chatbotImage);
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

module.exports = router;
