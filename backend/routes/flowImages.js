const express = require('express');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
const router = express.Router();
const ChatbotImage = require('../models/ChatbotImage');
const cloudinaryService = require('../services/cloudinary');
const chatbotImagesService = require('../services/chatbotImages');
const catalogService = require('../services/catalogService');
const defaultImages = require('../config/defaultChatbotImages');
const auth = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');

router.use(adminRateLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Flow image keys
const FLOW_IMAGE_KEYS = [
  'flow_order_food',
  'flow_my_orders',
  'flow_view_offers',
  'flow_visit_website',
  'flow_help_support',
  'flow_welcome_banner',
  'flow_delivery_option',
  'flow_pickup_option',
  'flow_account_details',
  'flow_delivery_address',
  'flow_status_pending',
  'flow_status_confirmed',
  'flow_status_preparing',
  'flow_status_ready',
  'flow_status_out_for_delivery',
  'flow_status_delivered',
  'flow_status_cancelled',
  'flow_pay_cod',
  'flow_pay_hotel',
  'flow_pay_gpay',
  'flow_pay_phonepe',
  'flow_pay_paytm',
  'flow_my_cart',
  'flow_track_order',
  'flow_cart_place_order',
  'flow_cart_add_more',
  'flow_cart_clear',
  'flow_action_track',
  'flow_action_cancel',
  'flow_action_order_food',
  'flow_action_main_menu',
  'flow_action_contact'
];

// Determine Cloudinary crop dimensions based on image type
function getCropDimensions(key) {
  if (key.endsWith('_banner')) {
    // Banner: 8:1 ratio
    return { width: 1000, height: 125 };
  }
  // All other icons: 1:1 square ratio
  return { width: 600, height: 600 };
}

function getAspectRatio(key) {
  if (key.endsWith('_banner')) return '8:1';
  return '1:1';
}

// Get all flow images
router.get('/', auth, async (req, res) => {
  try {
    let images = await ChatbotImage.find({ key: { $in: FLOW_IMAGE_KEYS } }).sort('name');

    // Initialize missing flow images from defaults
    const existingKeys = images.map(img => img.key);
    const missingDefaults = defaultImages.filter(
      d => FLOW_IMAGE_KEYS.includes(d.key) && !existingKeys.includes(d.key)
    );

    if (missingDefaults.length > 0) {
      logger.info('[Flow Images] Adding missing flow images', { count: missingDefaults.length });
      for (const img of missingDefaults) {
        try {
          await ChatbotImage.create(img);
        } catch (err) {
          logger.error('[Flow Images] Error creating default', err.message);
        }
      }
      images = await ChatbotImage.find({ key: { $in: FLOW_IMAGE_KEYS } }).sort('name');
    }

    res.json(images);
  } catch (error) {
    return logRouteError(res, '[Flow Images] GET error', error);
  }
});

// Upload flow image with correct aspect ratio
router.put('/:key', auth, upload.single('image'), async (req, res) => {
  try {
    const { key } = req.params;

    if (!FLOW_IMAGE_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Invalid flow image key' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Delete old Cloudinary image if exists
    let chatbotImage = await ChatbotImage.findOne({ key });
    if (chatbotImage?.cloudinaryPublicId) {
      try {
        await cloudinaryService.deleteImage(chatbotImage.cloudinaryPublicId);
      } catch (e) {
        logger.info('Could not delete old flow image:', e.message);
      }
    }

    const { width, height } = getCropDimensions(key);
    const aspectRatio = getAspectRatio(key);
    const cloudinary = require('cloudinary').v2;

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'restaurant-bot/flow-images',
          public_id: `flow_${key}_${Date.now()}`,
          transformation: [
            // Banner: pad to 8:1 (no crop, full image preserved); Icons: fill to square
            key.endsWith('_banner')
              ? { width, height, crop: 'pad', background: 'auto', gravity: 'center' }
              : { width, height, crop: 'fill', gravity: 'center' },
            // Rounded corners for banner (matching AP Government flow style)
            ...(key.endsWith('_banner') ? [{ radius: 20 }] : []),
            { quality: 'auto:best', fetch_format: 'png' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    const defaultImg = defaultImages.find(d => d.key === key);

    chatbotImage = await ChatbotImage.findOneAndUpdate(
      { key },
      {
        key,
        name: defaultImg?.name || key,
        description: defaultImg?.description || '',
        imageUrl: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        aspectRatio
      },
      { upsert: true, new: true }
    );

    chatbotImagesService.clearCache();
    logger.info('[Flow Images] Uploaded flow image', { key, aspectRatio });

    // Banner is dynamic — served via endpoint on every flow open. No flow republish needed.
    res.json(chatbotImage.toObject());
  } catch (error) {
    return logRouteError(res, '[Flow Images] Upload error', error);
  }
});

// Reset flow image to default
router.post('/:key/reset', auth, async (req, res) => {
  try {
    const { key } = req.params;

    if (!FLOW_IMAGE_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Invalid flow image key' });
    }

    const defaultImg = defaultImages.find(d => d.key === key);
    if (!defaultImg) {
      return res.status(404).json({ error: 'Default image not found' });
    }

    const existing = await ChatbotImage.findOne({ key });
    if (existing?.cloudinaryPublicId) {
      try {
        await cloudinaryService.deleteImage(existing.cloudinaryPublicId);
      } catch (e) {
        logger.info('Could not delete flow image:', e.message);
      }
    }

    const chatbotImage = await ChatbotImage.findOneAndUpdate(
      { key },
      { ...defaultImg, cloudinaryPublicId: null },
      { upsert: true, new: true }
    );

    chatbotImagesService.clearCache();
    logger.info('[Flow Images] Reset flow image', { key });

    res.json(chatbotImage);
  } catch (error) {
    return logRouteError(res, '[Flow Images] Reset error', error);
  }
});

module.exports = router;
