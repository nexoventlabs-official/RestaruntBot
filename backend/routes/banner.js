const express = require('express');
const Banner = require('../models/Banner');
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'), false);
  }
});

// Get all banners (public)
router.get('/', async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all banners (admin)
router.get('/admin', auth, async (req, res) => {
  try {
    const banners = await Banner.find().sort({ sortOrder: 1 });
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add banner
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, link } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Image is required' });
    }
    
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'restaurant-bot/banners',
          transformation: [{ width: 1200, height: 400, crop: 'fill' }, { quality: 'auto:best' }]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });
    
    const count = await Banner.countDocuments();
    const banner = new Banner({
      title,
      image: uploadResult.secure_url,
      imagePublicId: uploadResult.public_id,
      link,
      sortOrder: count
    });
    
    await banner.save();
    res.status(201).json(banner);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update banner
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, link, isActive } = req.body;
    const banner = await Banner.findById(req.params.id);
    
    if (!banner) return res.status(404).json({ error: 'Banner not found' });
    
    if (title !== undefined) banner.title = title;
    if (link !== undefined) banner.link = link;
    if (isActive !== undefined) banner.isActive = isActive === 'true' || isActive === true;
    
    if (req.file) {
      if (banner.imagePublicId) {
        await cloudinary.uploader.destroy(banner.imagePublicId).catch(() => {});
      }
      
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'restaurant-bot/banners',
            transformation: [{ width: 1200, height: 400, crop: 'fill' }, { quality: 'auto:best' }]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      
      banner.image = uploadResult.secure_url;
      banner.imagePublicId = uploadResult.public_id;
    }
    
    await banner.save();
    res.json(banner);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete banner
router.delete('/:id', auth, async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ error: 'Banner not found' });
    
    if (banner.imagePublicId) {
      await cloudinary.uploader.destroy(banner.imagePublicId).catch(() => {});
    }
    
    await Banner.findByIdAndDelete(req.params.id);
    res.json({ message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder banners
router.put('/reorder', auth, async (req, res) => {
  try {
    const { bannerIds } = req.body;
    
    for (let i = 0; i < bannerIds.length; i++) {
      await Banner.findByIdAndUpdate(bannerIds[i], { sortOrder: i });
    }
    
    res.json({ message: 'Banners reordered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
