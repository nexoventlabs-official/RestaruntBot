const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const auth = require('../middleware/auth');
const cloudinary = require('../services/cloudinary');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

// Support multiple image uploads (mobile, tablet, desktop)
const uploadMultiple = upload.fields([
  { name: 'imageMobile', maxCount: 1 },
  { name: 'imageTablet', maxCount: 1 },
  { name: 'imageDesktop', maxCount: 1 },
  { name: 'image', maxCount: 1 } // Legacy support
]);

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
router.post('/', auth, uploadMultiple, async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink 
    } = req.body;
    
    let imageMobileUrl = '';
    let imageTabletUrl = '';
    let imageDesktopUrl = '';
    let legacyImageUrl = '';

    // Upload mobile image
    if (req.files?.imageMobile?.[0]) {
      imageMobileUrl = await cloudinary.uploadPreserveAspect(req.files.imageMobile[0].buffer, 'offers/mobile');
    } else if (req.body.imageMobile) {
      imageMobileUrl = req.body.imageMobile;
    }

    // Upload tablet image
    if (req.files?.imageTablet?.[0]) {
      imageTabletUrl = await cloudinary.uploadPreserveAspect(req.files.imageTablet[0].buffer, 'offers/tablet');
    } else if (req.body.imageTablet) {
      imageTabletUrl = req.body.imageTablet;
    }

    // Upload desktop image
    if (req.files?.imageDesktop?.[0]) {
      imageDesktopUrl = await cloudinary.uploadPreserveAspect(req.files.imageDesktop[0].buffer, 'offers/desktop');
    } else if (req.body.imageDesktop) {
      imageDesktopUrl = req.body.imageDesktop;
    }

    // Legacy image support (use desktop as fallback)
    if (req.files?.image?.[0]) {
      legacyImageUrl = await cloudinary.uploadPreserveAspect(req.files.image[0].buffer, 'offers');
    } else if (req.body.image) {
      legacyImageUrl = req.body.image;
    } else {
      // Use desktop image as legacy fallback
      legacyImageUrl = imageDesktopUrl || imageTabletUrl || imageMobileUrl;
    }

    // At least one image is required
    if (!imageMobileUrl && !imageTabletUrl && !imageDesktopUrl && !legacyImageUrl) {
      return res.status(400).json({ error: 'At least one image is required' });
    }

    const offer = new Offer({
      title,
      description,
      offerType: offerType || '',
      image: legacyImageUrl || imageDesktopUrl || imageTabletUrl || imageMobileUrl, // Legacy field
      imageMobile: imageMobileUrl,
      imageTablet: imageTabletUrl,
      imageDesktop: imageDesktopUrl,
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
router.put('/:id', auth, uploadMultiple, async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink 
    } = req.body;
    
    // Get existing offer to check for old images
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

    // Helper function to delete old image
    const deleteOldImage = async (imageUrl) => {
      if (imageUrl && imageUrl.includes('cloudinary.com')) {
        try {
          const publicId = cloudinary.extractPublicId(imageUrl);
          if (publicId) await cloudinary.deleteImage(publicId);
        } catch (e) {
          console.log('Could not delete old offer image:', e.message);
        }
      }
    };

    // Handle mobile image
    if (req.files?.imageMobile?.[0]) {
      await deleteOldImage(existingOffer.imageMobile);
      updateData.imageMobile = await cloudinary.uploadPreserveAspect(req.files.imageMobile[0].buffer, 'offers/mobile');
    } else if (req.body.imageMobile && req.body.imageMobile !== existingOffer.imageMobile) {
      await deleteOldImage(existingOffer.imageMobile);
      updateData.imageMobile = req.body.imageMobile;
    }

    // Handle tablet image
    if (req.files?.imageTablet?.[0]) {
      await deleteOldImage(existingOffer.imageTablet);
      updateData.imageTablet = await cloudinary.uploadPreserveAspect(req.files.imageTablet[0].buffer, 'offers/tablet');
    } else if (req.body.imageTablet && req.body.imageTablet !== existingOffer.imageTablet) {
      await deleteOldImage(existingOffer.imageTablet);
      updateData.imageTablet = req.body.imageTablet;
    }

    // Handle desktop image
    if (req.files?.imageDesktop?.[0]) {
      await deleteOldImage(existingOffer.imageDesktop);
      updateData.imageDesktop = await cloudinary.uploadPreserveAspect(req.files.imageDesktop[0].buffer, 'offers/desktop');
    } else if (req.body.imageDesktop && req.body.imageDesktop !== existingOffer.imageDesktop) {
      await deleteOldImage(existingOffer.imageDesktop);
      updateData.imageDesktop = req.body.imageDesktop;
    }

    // Handle legacy image field
    if (req.files?.image?.[0]) {
      await deleteOldImage(existingOffer.image);
      updateData.image = await cloudinary.uploadPreserveAspect(req.files.image[0].buffer, 'offers');
    } else if (req.body.image && req.body.image !== existingOffer.image) {
      await deleteOldImage(existingOffer.image);
      updateData.image = req.body.image;
    } else {
      // Update legacy image to match desktop (or best available)
      updateData.image = updateData.imageDesktop || existingOffer.imageDesktop || 
                        updateData.imageTablet || existingOffer.imageTablet || 
                        updateData.imageMobile || existingOffer.imageMobile ||
                        existingOffer.image;
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
    // Get offer first to delete images from Cloudinary and remove from menu items
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    
    // Helper function to delete image
    const deleteImage = async (imageUrl) => {
      if (imageUrl && imageUrl.includes('cloudinary.com')) {
        try {
          const publicId = cloudinary.extractPublicId(imageUrl);
          if (publicId) await cloudinary.deleteImage(publicId);
        } catch (e) {
          console.log('Could not delete offer image:', e.message);
        }
      }
    };

    // Delete all images from Cloudinary
    await Promise.all([
      deleteImage(offer.image),
      deleteImage(offer.imageMobile),
      deleteImage(offer.imageTablet),
      deleteImage(offer.imageDesktop)
    ]);
    
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
