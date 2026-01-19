const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const auth = require('../middleware/auth');
const cloudinary = require('../services/cloudinary');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

// Get all offers (admin)
router.get('/', auth, async (req, res) => {
  try {
    const offers = await Offer.find().sort({ createdAt: -1 });
    res.json(offers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create offer
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink 
    } = req.body;
    
    let imageUrl = '';
    if (req.file) {
      // Use uploadPreserveAspect to maintain original aspect ratio for offer cards
      imageUrl = await cloudinary.uploadPreserveAspect(req.file.buffer, 'offers');
    } else if (req.body.image) {
      imageUrl = req.body.image;
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const offer = new Offer({
      title,
      description,
      offerType: offerType || '',
      image: imageUrl,
      code,
      discountType: discountType || 'none',
      discountValue: parseFloat(discountValue) || 0,
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: isActive !== 'false',
      showAsPopup: showAsPopup !== 'false',
      buttonText: buttonText || 'Order Now',
      buttonLink: buttonLink || '/menu'
    });

    await offer.save();
    res.status(201).json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update offer
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink 
    } = req.body;
    
    // Get existing offer to check for old image
    const existingOffer = await Offer.findById(req.params.id);
    if (!existingOffer) return res.status(404).json({ error: 'Offer not found' });
    
    const updateData = {
      title,
      description,
      offerType: offerType || '',
      code,
      discountType: discountType || 'none',
      discountValue: parseFloat(discountValue) || 0,
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: isActive !== 'false',
      showAsPopup: showAsPopup !== 'false',
      buttonText,
      buttonLink
    };

    if (req.file) {
      // Delete old image from Cloudinary if it exists
      if (existingOffer.image && existingOffer.image.includes('cloudinary.com')) {
        try {
          const publicId = cloudinary.extractPublicId(existingOffer.image);
          if (publicId) await cloudinary.deleteImage(publicId);
        } catch (e) {
          console.log('Could not delete old offer image:', e.message);
        }
      }
      // Use uploadPreserveAspect to maintain original aspect ratio for offer cards
      updateData.image = await cloudinary.uploadPreserveAspect(req.file.buffer, 'offers');
    } else if (req.body.image && req.body.image !== existingOffer.image) {
      // If new URL provided and different from existing, delete old image
      if (existingOffer.image && existingOffer.image.includes('cloudinary.com')) {
        try {
          const publicId = cloudinary.extractPublicId(existingOffer.image);
          if (publicId) await cloudinary.deleteImage(publicId);
        } catch (e) {
          console.log('Could not delete old offer image:', e.message);
        }
      }
      updateData.image = req.body.image;
    }

    const offer = await Offer.findByIdAndUpdate(req.params.id, updateData, { new: true });
    
    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete offer
router.delete('/:id', auth, async (req, res) => {
  try {
    // Get offer first to delete image from Cloudinary and remove from menu items
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    // Delete image from Cloudinary if it exists
    if (offer.image && offer.image.includes('cloudinary.com')) {
      try {
        const publicId = cloudinary.extractPublicId(offer.image);
        if (publicId) await cloudinary.deleteImage(publicId);
      } catch (e) {
        console.log('Could not delete offer image:', e.message);
      }
    }
    
    // Remove this offer type from all menu items
    if (offer.offerType) {
      const MenuItem = require('../models/MenuItem');
      await MenuItem.updateMany(
        { offerType: offer.offerType },
        { $pull: { offerType: offer.offerType } }
      );
      console.log(`Removed offer type "${offer.offerType}" from all menu items`);
    }
    
    await Offer.findByIdAndDelete(req.params.id);
    
    // Emit SSE event to notify clients
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'menu' });
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    
    res.json({ message: 'Offer deleted and removed from all items' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle active status
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    const wasActive = offer.isActive;
    offer.isActive = !offer.isActive;
    await offer.save();
    
    // If offer is being deactivated, remove it from all menu items
    if (wasActive && !offer.isActive && offer.offerType) {
      const MenuItem = require('../models/MenuItem');
      await MenuItem.updateMany(
        { offerType: offer.offerType },
        { $pull: { offerType: offer.offerType } }
      );
      console.log(`Removed inactive offer type "${offer.offerType}" from all menu items`);
      
      // Emit SSE event to notify clients
      const eventEmitter = require('../services/eventEmitter');
      eventEmitter.emit('dataUpdate', { type: 'menu' });
    }
    
    // Emit SSE event to notify clients
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    
    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle popup status
router.patch('/:id/toggle-popup', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    offer.showAsPopup = !offer.showAsPopup;
    await offer.save();
    res.json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
