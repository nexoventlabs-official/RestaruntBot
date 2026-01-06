const express = require('express');
const Offer = require('../models/Offer');
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

// Get active offers (public)
router.get('/', async (req, res) => {
  try {
    const offers = await Offer.find({ 
      isActive: true,
      $or: [{ validTill: { $gte: new Date() } }, { validTill: null }]
    }).sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get popup offer (public)
router.get('/popup', async (req, res) => {
  try {
    const offer = await Offer.findOne({ 
      isActive: true,
      showOnLoad: true,
      $or: [{ validTill: { $gte: new Date() } }, { validTill: null }]
    }).sort({ createdAt: -1 });
    res.json(offer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all offers (admin)
router.get('/admin', auth, async (req, res) => {
  try {
    const offers = await Offer.find().sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add offer
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, code, discount, validTill, showOnLoad } = req.body;
    
    let imageUrl = '';
    let imagePublicId = null;
    
    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'restaurant-bot/offers',
            transformation: [{ width: 600, height: 400, crop: 'fill' }, { quality: 'auto:best' }]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      imageUrl = uploadResult.secure_url;
      imagePublicId = uploadResult.public_id;
    }
    
    const offer = new Offer({
      title,
      description,
      image: imageUrl,
      imagePublicId,
      code,
      discount,
      validTill: validTill || null,
      showOnLoad: showOnLoad === 'true' || showOnLoad === true
    });
    
    await offer.save();
    res.status(201).json(offer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update offer
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, code, discount, validTill, isActive, showOnLoad } = req.body;
    const offer = await Offer.findById(req.params.id);
    
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    if (title !== undefined) offer.title = title;
    if (description !== undefined) offer.description = description;
    if (code !== undefined) offer.code = code;
    if (discount !== undefined) offer.discount = discount;
    if (validTill !== undefined) offer.validTill = validTill || null;
    if (isActive !== undefined) offer.isActive = isActive === 'true' || isActive === true;
    if (showOnLoad !== undefined) offer.showOnLoad = showOnLoad === 'true' || showOnLoad === true;
    
    if (req.file) {
      if (offer.imagePublicId) {
        await cloudinary.uploader.destroy(offer.imagePublicId).catch(() => {});
      }
      
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'restaurant-bot/offers',
            transformation: [{ width: 600, height: 400, crop: 'fill' }, { quality: 'auto:best' }]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      
      offer.image = uploadResult.secure_url;
      offer.imagePublicId = uploadResult.public_id;
    }
    
    await offer.save();
    res.json(offer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete offer
router.delete('/:id', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    if (offer.imagePublicId) {
      await cloudinary.uploader.destroy(offer.imagePublicId).catch(() => {});
    }
    
    await Offer.findByIdAndDelete(req.params.id);
    res.json({ message: 'Offer deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
