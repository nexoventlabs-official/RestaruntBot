const express = require('express');
const router = express.Router();
const ChatbotImage = require('../models/ChatbotImage');
const cloudinaryService = require('../services/cloudinary');
const auth = require('../middleware/auth');
const multer = require('multer');

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

// Default images configuration
const defaultImages = [
  {
    key: 'cart_cleared',
    name: 'Cart Cleared',
    description: 'Shown when customer clears their cart',
    imageUrl: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/kvm8soy5_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_51%20PM.png'
  },
  {
    key: 'added_to_cart',
    name: 'Added to Cart',
    description: 'Shown when item is added to cart',
    imageUrl: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/qixmcggk_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_37%20PM.png'
  },
  {
    key: 'order_confirmed',
    name: 'Order Confirmed',
    description: 'Shown when order is confirmed (COD)',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/s75p7355_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_13%20PM.png'
  },
  {
    key: 'no_orders_found',
    name: 'No Orders Found',
    description: 'Shown when customer has no order history',
    imageUrl: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/6al1ikel_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_56_02%20PM.png'
  },
  {
    key: 'your_orders',
    name: 'Your Orders',
    description: 'Shown when displaying order history',
    imageUrl: 'https://customer-assets.emergentagent.com/job_aba631ff-39f5-485d-9dc9-4b55cdde1a45/artifacts/so72utoq_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_56_10%20PM.png'
  },
  {
    key: 'no_active_orders',
    name: 'No Active Orders',
    description: 'Shown when no orders to track',
    imageUrl: 'https://customer-assets.emergentagent.com/job_pic-url-maker/artifacts/6xfvk4ug_ChatGPT%20Image%20Jan%205%2C%202026%2C%2011_04_46%20AM.png'
  },
  {
    key: 'order_cancelled',
    name: 'Order Cancelled',
    description: 'Shown when order is cancelled',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/4ysetjer_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_24%20PM.png'
  },
  {
    key: 'payment_success',
    name: 'Payment Success',
    description: 'Shown when online payment is successful',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/s75p7355_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_13%20PM.png'
  },
  {
    key: 'preparing',
    name: 'Preparing Order',
    description: 'Shown when order status changes to preparing',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/nbe1dy2a_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_22%20PM.png'
  },
  {
    key: 'out_for_delivery',
    name: 'Out for Delivery',
    description: 'Shown when order is out for delivery',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/qusd2g8y_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_16%20PM.png'
  },
  {
    key: 'ready',
    name: 'Order Ready',
    description: 'Shown when order is ready for pickup/delivery',
    imageUrl: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/0dpayh1q_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_09%20PM.png'
  },
  {
    key: 'delivered',
    name: 'Order Delivered',
    description: 'Shown when order is delivered',
    imageUrl: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/q5l9q4av_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_30%20PM.png'
  }
];

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
    res.status(500).json({ error: error.message });
  }
});

// Get all chatbot images
router.get('/', auth, async (req, res) => {
  try {
    let images = await ChatbotImage.find().sort('name');
    
    // If no images exist, initialize defaults
    if (images.length === 0) {
      for (const img of defaultImages) {
        await ChatbotImage.create(img);
      }
      images = await ChatbotImage.find().sort('name');
    }
    
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
        console.log('Could not delete old image:', e.message);
      }
    }

    // Upload new image to Cloudinary with 2:1 aspect ratio (1200x600)
    const cloudinary = require('cloudinary').v2;
    
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'restaurant-bot/chatbot-images',
          public_id: `chatbot_${key}_${Date.now()}`,
          transformation: [
            { width: 1200, height: 600, crop: 'fill', gravity: 'center' },
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
        aspectRatio: '2:1'
      },
      { upsert: true, new: true }
    );

    res.json(chatbotImage);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
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
        console.log('Could not delete image:', e.message);
      }
    }

    // Reset to default
    const chatbotImage = await ChatbotImage.findOneAndUpdate(
      { key },
      { ...defaultImg, cloudinaryPublicId: null },
      { upsert: true, new: true }
    );

    res.json(chatbotImage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
