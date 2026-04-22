const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const auth = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const cloudinary = require('../services/cloudinary');
const googleSheets = require('../services/googleSheets');
const whatsapp = require('../services/whatsapp');
const whatsappBroadcast = require('../services/whatsappBroadcast');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
const catalogService = require('../services/catalogService');
const multer = require('multer');

// Apply admin rate limiting
router.use(adminRateLimiter);

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

// Support multiple image uploads (mobile, tablet, desktop)
const uploadMultiple = upload.fields([
  { name: 'imageMobile', maxCount: 1 },
  { name: 'imageTablet', maxCount: 1 },
  { name: 'imageDesktop', maxCount: 1 },
  { name: 'imageWhatsApp', maxCount: 1 }, // 1:1 ratio for WhatsApp template
  { name: 'image', maxCount: 1 } // Legacy support
]);

// Get all offers (admin)
router.get('/', auth, async (req, res) => {
  try {
    const offers = await Offer.find()
      .populate('appliedItems', 'name image variants')
      .sort({ createdAt: -1 })
      .lean();

    // Also fetch parent items referenced in appliedVariants (may not be in appliedItems)
    const allVariantItemIds = new Set();
    offers.forEach(offer => {
      if (offer.appliedVariants && offer.appliedVariants.length > 0) {
        offer.appliedVariants.forEach(v => {
          const itemId = v.split('_')[0];
          if (itemId) allVariantItemIds.add(itemId);
        });
      }
    });

    if (allVariantItemIds.size > 0) {
      const MenuItem = require('../models/MenuItem');
      const variantItems = await MenuItem.find(
        { _id: { $in: [...allVariantItemIds] } },
        'name image variants'
      ).lean();
      const itemMap = {};
      variantItems.forEach(item => { itemMap[item._id.toString()] = item; });

      // Merge variant-parent items into appliedItems so frontend can resolve variant details
      offers.forEach(offer => {
        if (offer.appliedVariants && offer.appliedVariants.length > 0) {
          const existingIds = new Set((offer.appliedItems || []).map(i => (i._id || i).toString()));
          const additionalItems = [];
          offer.appliedVariants.forEach(v => {
            const itemId = v.split('_')[0];
            if (!existingIds.has(itemId) && itemMap[itemId]) {
              additionalItems.push(itemMap[itemId]);
              existingIds.add(itemId);
            }
          });
          // Store original count before merging
          offer._directItemCount = offer.appliedItems ? offer.appliedItems.length : 0;
          if (additionalItems.length > 0) {
            offer.appliedItems = [...(offer.appliedItems || []), ...additionalItems];
          }
        }
      });
    }

    res.json(offers);
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Get all customers from Google Sheets (cost-saving approach)
router.get('/customers', auth, async (req, res) => {
  try {
    const { customers, error } = await googleSheets.getAllCustomers();
    
    if (error) {
      return res.status(500).json({ error });
    }
    
    res.json({ 
      success: true, 
      customers,
      total: customers.length 
    });
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Get top percentage of customers by spending
router.get('/customers/top/:percentage', auth, async (req, res) => {
  try {
    const percentage = parseInt(req.params.percentage);
    
    if (isNaN(percentage) || percentage < 1 || percentage > 100) {
      return res.status(400).json({ error: 'Percentage must be between 1 and 100' });
    }
    
    const result = await googleSheets.getTopCustomersBySpent(percentage);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      customers: result.customers,
      totalCustomers: result.totalCustomers,
      selectedCount: result.selectedCount,
      percentage
    });
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Get customers by minimum spent amount
router.get('/customers/min-spent/:amount', auth, async (req, res) => {
  try {
    const minAmount = parseFloat(req.params.amount);
    
    if (isNaN(minAmount) || minAmount <= 0) {
      return res.status(400).json({ error: 'Minimum amount must be greater than 0' });
    }
    
    const result = await googleSheets.getCustomersByMinSpent(minAmount);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      customers: result.customers,
      totalCustomers: result.totalCustomers,
      selectedCount: result.selectedCount,
      minAmount
    });
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Get customers by minimum order count
router.get('/customers/min-orders/:count', auth, async (req, res) => {
  try {
    const minOrders = parseInt(req.params.count);
    
    if (isNaN(minOrders) || minOrders <= 0) {
      return res.status(400).json({ error: 'Minimum orders must be greater than 0' });
    }
    
    const result = await googleSheets.getCustomersByMinOrders(minOrders);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      customers: result.customers,
      totalCustomers: result.totalCustomers,
      selectedCount: result.selectedCount,
      minOrders
    });
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Create offer
router.post('/', auth, uploadMultiple, async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink, percentage, appliedItems, appliedCategories, appliedVariants, appliedQuantities,
      targetType, targetPercentage, targetMinSpent, targetMinOrders
    } = req.body;
    
    let imageMobileUrl = '';
    let imageTabletUrl = '';
    let imageDesktopUrl = '';
    let imageWhatsAppUrl = '';
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

    // Upload WhatsApp image (1:1 ratio)
    if (req.files?.imageWhatsApp?.[0]) {
      imageWhatsAppUrl = await cloudinary.uploadPreserveAspect(req.files.imageWhatsApp[0].buffer, 'offers/whatsapp');
    } else if (req.body.imageWhatsApp) {
      imageWhatsAppUrl = req.body.imageWhatsApp;
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

    // Parse appliedItems and appliedCategories if they're JSON strings
    let parsedAppliedItems = [];
    let parsedAppliedCategories = [];
    let parsedAppliedVariants = [];
    let parsedAppliedQuantities = [];
    
    if (appliedItems) {
      parsedAppliedItems = typeof appliedItems === 'string' ? JSON.parse(appliedItems) : appliedItems;
    }
    
    if (appliedCategories) {
      parsedAppliedCategories = typeof appliedCategories === 'string' ? JSON.parse(appliedCategories) : appliedCategories;
    }
    
    if (appliedVariants) {
      parsedAppliedVariants = typeof appliedVariants === 'string' ? JSON.parse(appliedVariants) : appliedVariants;
    }
    
    if (appliedQuantities) {
      parsedAppliedQuantities = typeof appliedQuantities === 'string' ? JSON.parse(appliedQuantities) : appliedQuantities;
    }

    // At least one item, variant, or quantity must be selected
    if (parsedAppliedItems.length === 0 && parsedAppliedVariants.length === 0 && parsedAppliedQuantities.length === 0) {
      return res.status(400).json({ error: 'Please select at least one item to apply the offer to' });
    }

    // Handle targeting - we'll fetch customers in background after saving offer
    const finalTargetType = targetType || 'all';
    const finalTargetPercentage = parseInt(targetPercentage) || 100;
    const finalTargetMinSpent = parseFloat(targetMinSpent) || 0;
    const finalTargetMinOrders = parseInt(targetMinOrders) || 0;
    
    // Determine if this is a targeted offer (customers will be fetched in background)
    const isTargetedOffer = ['top_percentage', 'min_spent', 'min_orders'].includes(finalTargetType);

    const offer = new Offer({
      title,
      description,
      offerType: offerType || '',
      percentage: percentage ? parseFloat(percentage) : null,
      appliedItems: parsedAppliedItems,
      appliedVariants: parsedAppliedVariants,
      appliedQuantities: parsedAppliedQuantities,
      appliedCategories: parsedAppliedCategories,
      image: legacyImageUrl || imageDesktopUrl || imageTabletUrl || imageMobileUrl, // Legacy field
      imageMobile: imageMobileUrl,
      imageTablet: imageTabletUrl,
      imageDesktop: imageDesktopUrl,
      imageWhatsApp: imageWhatsAppUrl,
      code,
      discountType: discountType || 'none',
      discountValue: parseFloat(discountValue) || 0,
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: validFrom ? new Date(validFrom) <= new Date() : false,
      showAsPopup: showAsPopup !== 'false',
      buttonText: buttonText || 'Order Now',
      buttonLink: buttonLink || '/menu',
      targetType: finalTargetType,
      targetPercentage: finalTargetPercentage,
      targetMinSpent: finalTargetMinSpent,
      targetMinOrders: finalTargetMinOrders,
      targetedCustomers: [] // Will be populated in background
    });

    await offer.save();
    
    // Fetch targeted customers in background (don't block response)
    if (isTargetedOffer) {
      logger.info('Fetching targeted customers in background for offer ...', { _id : offer._id });
      (async () => {
        try {
          let targetedCustomerPhones = [];
          
          if (finalTargetType === 'top_percentage' && finalTargetPercentage < 100) {
            const result = await googleSheets.getTopCustomersBySpent(finalTargetPercentage);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found top % customers: customers', { finalTargetPercentage, length : targetedCustomerPhones.length });
            }
          } else if (finalTargetType === 'min_spent' && finalTargetMinSpent > 0) {
            const result = await googleSheets.getCustomersByMinSpent(finalTargetMinSpent);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found customers with min spent ₹: customers', { finalTargetMinSpent, length : targetedCustomerPhones.length });
            }
          } else if (finalTargetType === 'min_orders' && finalTargetMinOrders > 0) {
            const result = await googleSheets.getCustomersByMinOrders(finalTargetMinOrders);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found customers with min orders: customers', { finalTargetMinOrders, length : targetedCustomerPhones.length });
            }
          }
          
          // Update offer with targeted customers
          await Offer.findByIdAndUpdate(offer._id, { targetedCustomers: targetedCustomerPhones });
          logger.info('Updated offer with targeted customers', { _id: offer._id, count: targetedCustomerPhones.length });
        } catch (bgError) {
          logger.error('Background customer fetch failed for offer', { error: bgError.message });
        }
      })();
    }
    
    logger.info('Offer saved', {
      offerType,
      percentage,
      appliedItems: parsedAppliedItems,
      appliedVariants: parsedAppliedVariants,
      appliedQuantities: parsedAppliedQuantities,
      appliedCategories: parsedAppliedCategories
    });
    
    // Apply offer to selected items and categories (if any items/categories are selected)
    // NOTE: For targeted offers, we DON'T apply offerPrice to items (discount is calculated at order time for eligible customers only)
    
    // Collect item IDs from appliedVariants and appliedQuantities
    const variantItemIds = [...new Set(parsedAppliedVariants.map(v => v.split('_')[0]))];
    const quantityItemIds = [...new Set(parsedAppliedQuantities.map(q => q.split('_')[0]))];
    let allItemIds = [];
    if (parsedAppliedItems.length > 0 || parsedAppliedCategories.length > 0 || parsedAppliedVariants.length > 0 || parsedAppliedQuantities.length > 0) {
      const MenuItem = require('../models/MenuItem');
      
      // Collect all item IDs (from both direct selection, categories, and variant selections)
      allItemIds = [...parsedAppliedItems];
      
      // Add items from selected categories
      if (parsedAppliedCategories.length > 0) {
        logger.info('Finding items in categories', { categories: parsedAppliedCategories });
        const categoryItems = await MenuItem.find({
          category: { $in: parsedAppliedCategories }
        });
        logger.info('Found category items', { count: categoryItems.length });
        const categoryItemIds = categoryItems.map(item => item._id.toString());
        allItemIds = [...new Set([...allItemIds, ...categoryItemIds])];
      }
      
      // Add items from variant-level selections (the parent items that have specific variants selected)
      if (variantItemIds.length > 0) {
        allItemIds = [...new Set([...allItemIds, ...variantItemIds])];
      }
      
      // Add items from quantity-level selections
      if (quantityItemIds.length > 0) {
        allItemIds = [...new Set([...allItemIds, ...quantityItemIds])];
      }
      
      logger.info('Total items to apply offer', { count: allItemIds.length, variantSpecific: parsedAppliedVariants.length, quantitySpecific: parsedAppliedQuantities.length });
      logger.info('Is targeted offer', { isTargeted: isTargetedOffer, offerPriceApplied: !isTargetedOffer });
      
      // Apply offer to all collected items
      for (const itemId of allItemIds) {
        const item = await MenuItem.findById(itemId);
        if (item) {
          // Add offer type to item's offerType array
          const offerTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
          if (!offerTypes.includes(offerType)) {
            offerTypes.push(offerType);
          }
          
          const updateFields = { offerType: offerTypes };
          
          // Check if this item is fully selected or only specific variants
          const isFullItemSelected = parsedAppliedItems.includes(itemId) || 
            parsedAppliedCategories.some(cat => {
              const itemCats = Array.isArray(item.category) ? item.category : [item.category];
              return itemCats.includes(cat);
            });
          
          // If percentage is provided AND it's NOT a targeted offer, calculate and apply discount
          // For targeted offers, discount is applied at order time for eligible customers only
          if (percentage && !isTargetedOffer) {
            const discountPercent = parseFloat(percentage);
            
            if (isFullItemSelected) {
              // Full item selected — apply to parent price and ALL variants
              const offerPrice = Math.round(item.price * (1 - discountPercent / 100));
              updateFields.offerPrice = offerPrice;
              logger.info('Applying to : -> (% OFF)', { name: item.name, price: item.price, offerPrice, discountPercent });
              
              if (item.variants && item.variants.length > 0) {
                updateFields.variants = item.variants.map(v => {
                  const vObj = v.toObject ? v.toObject() : { ...v };
                  vObj.offerPrice = Math.round(v.price * (1 - discountPercent / 100));
                  if (vObj.quantities && vObj.quantities.length > 0) {
                    vObj.quantities = vObj.quantities.map(q => ({
                      ...(q.toObject ? q.toObject() : q),
                      offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                    }));
                  }
                  return vObj;
                });
              }
            } else {
              // Specific variants or quantities selected
              const selectedVariantIndices = parsedAppliedVariants
                .filter(v => v.startsWith(itemId + '_'))
                .map(v => parseInt(v.split('_')[1]));
              
              // Get per-quantity selections: { variantIndex: [quantityIndex1, quantityIndex2, ...] }
              const selectedQuantityMap = {};
              parsedAppliedQuantities
                .filter(q => q.startsWith(itemId + '_'))
                .forEach(q => {
                  const parts = q.split('_');
                  const vi = parseInt(parts[1]);
                  const qi = parseInt(parts[2]);
                  if (!selectedQuantityMap[vi]) selectedQuantityMap[vi] = [];
                  selectedQuantityMap[vi].push(qi);
                });
              
              if (item.variants && item.variants.length > 0) {
                updateFields.variants = item.variants.map((v, idx) => {
                  const vObj = v.toObject ? v.toObject() : { ...v };
                  if (selectedVariantIndices.includes(idx)) {
                    // Full variant selected — apply to variant and ALL its quantities
                    const vOfferPrice = Math.round(v.price * (1 - discountPercent / 100));
                    logger.info('Applying to variant : -> (% OFF)', { name: item.name, label: v.label, price: v.price, vOfferPrice, discountPercent });
                    vObj.offerPrice = vOfferPrice;
                    if (vObj.quantities && vObj.quantities.length > 0) {
                      vObj.quantities = vObj.quantities.map(q => ({
                        ...(q.toObject ? q.toObject() : q),
                        offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                      }));
                    }
                  } else if (selectedQuantityMap[idx]) {
                    // Only specific quantities selected for this variant
                    const selectedQIndices = selectedQuantityMap[idx];
                    if (vObj.quantities && vObj.quantities.length > 0) {
                      vObj.quantities = vObj.quantities.map((q, qIdx) => {
                        const qObj = q.toObject ? q.toObject() : { ...q };
                        if (selectedQIndices.includes(qIdx)) {
                          const qOfferPrice = Math.round(q.price * (1 - discountPercent / 100));
                          logger.info('Applying to variant qty : -> (% OFF)', { name: item.name, label: v.label, quantity: q.quantity, unit: q.unit, price: q.price, qOfferPrice, discountPercent });
                          qObj.offerPrice = qOfferPrice;
                        }
                        return qObj;
                      });
                    }
                  }
                  return vObj; // Leave unselected variants unchanged
                });
              }
            }
          } else if (percentage && isTargetedOffer) {
            logger.info('Targeted offer - NOT applying offerPrice to (% discount for eligible customers only)', { name: item.name, percentage });
          } else {
            logger.info('Adding offer type to', { name: item.name, offerType });
          }
          
          // Update item
          await MenuItem.findByIdAndUpdate(itemId, updateFields);
        }
      }
      
      logger.info('Offer application completed');
    } else {
      logger.info('No items or categories selected for this offer');
    }
    
    // Emit SSE event to notify clients to refresh (cache-busting)
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    eventEmitter.emit('dataUpdate', { type: 'menu' });

    // Catalog sync after offer create is DISABLED to prevent catalog disruption.
    // Offer prices are applied from MongoDB in chatbot messages and order flow.
    // Catalog sale_price will update on next manual Catalog Sync or 2 AM scheduled sync.
    // if (allItemIds && allItemIds.length > 0) {
    //   const MenuItem = require('../models/MenuItem');
    //   (async () => {
    //     try {
    //       for (const itemId of allItemIds) {
    //         const freshItem = await MenuItem.findById(itemId);
    //         if (freshItem) await catalogService.syncProductToMeta(freshItem);
    //       }
    //       catalogService.clearCache();
    //       logger.info('Catalog synced after offer create', { itemCount: allItemIds.length });
    //     } catch (syncErr) {
    //       logger.error('Catalog sync after offer create failed', { error: syncErr.message });
    //     }
    //   })();
    // }
    
    // ========== AUTO-SUBMIT TEMPLATE TO META FOR REVIEW ==========
    // Template is required to send offers to customers outside 24-hour window
    // The offer stays on HOLD (templateStatus: 'pending') until Meta approves it
    if (process.env.META_WABA_ID) {
      const tplName = `offer_${offer._id.toString()}`;
      const headerImg = imageWhatsAppUrl || imageDesktopUrl || imageTabletUrl || imageMobileUrl || legacyImageUrl;
      const bodyText = `🎉 *{{1}}*\n\n{{2}}\n\nOrder now and enjoy this amazing deal! 🍽️`;
      const footerTxt = 'Tap below to order';
      const baseUrl = process.env.FRONTEND_URL || 'https://restarunt-bot.vercel.app';
      const ctaUrl = `${baseUrl}/offers`;
      
      try {
        const tplResult = await whatsapp.createMessageTemplate(
          tplName, headerImg, bodyText, footerTxt, ctaUrl, 'Order Now'
        );
        
        await Offer.findByIdAndUpdate(offer._id, {
          templateName: tplName,
          templateStatus: 'pending',
          metaTemplateId: tplResult.id || null,
          templateSubmittedAt: new Date()
        });
        
        offer.templateName = tplName;
        offer.templateStatus = 'pending';
        offer.metaTemplateId = tplResult.id || null;
        offer.templateSubmittedAt = new Date();
        
        logger.info('Template submitted to Meta for review', { tplName, metaId: tplResult.id });
      } catch (tplErr) {
        // Template submission failed — offer still created, admin can retry
        const errMsg = tplErr.response?.data?.error?.message || tplErr.message;
        logger.error('Template submission failed', { tplName, error: errMsg });
        
        await Offer.findByIdAndUpdate(offer._id, {
          templateName: tplName,
          templateStatus: 'rejected',
          templateRejectionReason: errMsg
        });
        offer.templateName = tplName;
        offer.templateStatus = 'rejected';
        offer.templateRejectionReason = errMsg;
      }
    } else {
      logger.warn('META_WABA_ID not set — template not submitted. Set it in .env to enable WhatsApp template auto-submission.');
    }
    
    res.status(201).json(offer);
  } catch (err) {
    return logRouteError(res, 'Error creating offer', err);
  }
});

// ========== TEMPLATE STATUS & SEND ROUTES ==========

// Check / poll template status from Meta
router.get('/:id/template-status', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    if (!offer.templateName) {
      return res.json({ 
        templateStatus: 'none', 
        message: 'No template submitted for this offer. META_WABA_ID may not be configured.' 
      });
    }

    // Poll Meta API for latest status
    try {
      const tplStatus = await whatsapp.getTemplateStatus(offer.templateName);
      
      const newStatus = (tplStatus.status || '').toLowerCase();
      const validStatuses = ['pending', 'approved', 'rejected'];
      const mappedStatus = validStatuses.includes(newStatus) ? newStatus : offer.templateStatus;

      // Update DB if status changed
      if (mappedStatus !== offer.templateStatus) {
        const updateFields = { templateStatus: mappedStatus };
        if (mappedStatus === 'approved') updateFields.templateApprovedAt = new Date();
        if (mappedStatus === 'rejected') updateFields.templateRejectionReason = tplStatus.rejectedReason || 'Rejected by Meta';
        
        await Offer.findByIdAndUpdate(offer._id, updateFields);
        logger.info('Template status updated', { offerId: offer._id, from: offer.templateStatus, to: mappedStatus });
      }

      return res.json({
        templateName: offer.templateName,
        templateStatus: mappedStatus,
        metaTemplateId: tplStatus.id || offer.metaTemplateId,
        rejectedReason: tplStatus.rejectedReason || offer.templateRejectionReason,
        submittedAt: offer.templateSubmittedAt,
        approvedAt: mappedStatus === 'approved' ? (offer.templateApprovedAt || new Date()) : null
      });
    } catch (pollErr) {
      logger.warn('Template status poll failed, returning stored status', { error: pollErr.message });
      return res.json({
        templateName: offer.templateName,
        templateStatus: offer.templateStatus,
        metaTemplateId: offer.metaTemplateId,
        rejectedReason: offer.templateRejectionReason,
        submittedAt: offer.templateSubmittedAt,
        approvedAt: offer.templateApprovedAt,
        pollError: 'Could not reach Meta API'
      });
    }
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
  }
});

// Retry template submission (if previous attempt failed or was rejected)
router.post('/:id/retry-template', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    if (offer.templateStatus === 'approved') {
      return res.status(400).json({ error: 'Template already approved' });
    }

    if (!process.env.META_WABA_ID) {
      return res.status(400).json({ error: 'META_WABA_ID not configured in .env' });
    }

    // Delete old template if exists (best effort; Meta won't allow name reuse for 4 weeks after delete)
    if (offer.templateName) {
      try {
        await whatsapp.deleteMessageTemplate(offer.templateName);
      } catch (e) {
        logger.warn('Failed to delete old WhatsApp template', { templateName: offer.templateName, error: e.message });
      }
    }

    // Use a fresh unique name on retry — Meta blocks reuse of deleted/rejected template names for ~4 weeks
    const tplName = `offer_${offer._id.toString()}_${Date.now()}`;
    const headerImg = offer.imageWhatsApp || offer.imageDesktop || offer.imageTablet || offer.imageMobile || offer.image;
    const bodyText = `🎉 *{{1}}*\n\n{{2}}\n\nOrder now and enjoy this amazing deal! 🍽️`;
    const footerTxt = 'Tap below to order';
    const baseUrl = process.env.FRONTEND_URL || 'https://restarunt-bot.vercel.app';
    const ctaUrl = `${baseUrl}/offers`;

    const tplResult = await whatsapp.createMessageTemplate(
      tplName, headerImg, bodyText, footerTxt, ctaUrl, 'Order Now'
    );

    await Offer.findByIdAndUpdate(offer._id, {
      templateName: tplName,
      templateStatus: 'pending',
      metaTemplateId: tplResult.id || null,
      templateSubmittedAt: new Date(),
      templateRejectionReason: null
    });

    logger.info('Template re-submitted to Meta', { tplName });
    res.json({ 
      success: true, 
      templateName: tplName, 
      templateStatus: 'pending', 
      metaTemplateId: tplResult.id 
    });
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    return logRouteError(res, errMsg || 'Retry template failed', err);
  }
});

// Send offer to customers (only if template approved)
// Customers within 24h: interactive message  |  Customers outside 24h: approved template
router.post('/:id/send', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    if (!offer.isActive) {
      return res.status(400).json({ error: 'Offer is not active' });
    }

    // Template must be approved to reach old customers (24h+ window)
    if (offer.templateStatus !== 'approved') {
      return res.status(400).json({ 
        error: `Template not approved yet. Current status: ${offer.templateStatus || 'none'}. Wait for Meta approval before sending.`,
        templateStatus: offer.templateStatus
      });
    }

    const offerImageUrl = offer.imageWhatsApp || offer.imageDesktop || offer.imageTablet || offer.imageMobile || offer.image;

    // Get targeting info
    let targetedCustomers = null;
    let offerData = null;
    const isTargeted = ['top_percentage', 'min_spent', 'min_orders'].includes(offer.targetType);

    if (isTargeted && offer.targetedCustomers && offer.targetedCustomers.length > 0) {
      targetedCustomers = offer.targetedCustomers;
      offerData = {
        offerId: offer._id,
        offerType: offer.offerType,
        title: offer.title,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        percentage: offer.percentage,
        appliedItems: offer.appliedItems || [],
        appliedCategories: offer.appliedCategories || [],
        validUntil: offer.validUntil
      };
    } else if (isTargeted) {
      return res.status(400).json({ error: 'No eligible customers for this targeting criteria' });
    }

    logger.info('Sending offer broadcast', { offerId: offer._id, templateName: offer.templateName, targeted: !!targetedCustomers });

    const result = await whatsappBroadcast.sendOfferToAll(
      offerImageUrl,
      offer.title,
      offer.description,
      offer.offerType,
      targetedCustomers,
      offer._id.toString(),
      offerData
    );

    // Save broadcast result
    await Offer.findByIdAndUpdate(offer._id, {
      broadcastSentAt: new Date(),
      broadcastResult: {
        total: result.total,
        sent: result.sent,
        sentViaInteractive: result.sentViaInteractive,
        sentViaTemplate: result.sentViaTemplate,
        failed: result.failed
      }
    });

    res.json({
      success: result.success && result.sent > 0,
      total: result.total,
      sent: result.sent,
      sentViaInteractive: result.sentViaInteractive || 0,
      sentViaTemplate: result.sentViaTemplate || 0,
      failed: result.failed,
      failedContacts: result.failedContacts || [],
      templateUsed: offer.templateName
    });
  } catch (err) {
    return logRouteError(res, 'Send offer broadcast failed', err);
  }
});

// Update offer
router.put('/:id', auth, uploadMultiple, async (req, res) => {
  try {
    const { 
      title, description, offerType, code, discountType, discountValue, 
      minOrderAmount, validFrom, validUntil, isActive, showAsPopup,
      buttonText, buttonLink, percentage, appliedItems, appliedCategories, appliedVariants, appliedQuantities,
      targetType, targetPercentage, targetMinSpent, targetMinOrders
    } = req.body;
    
    // Get existing offer to check for old images
    const existingOffer = await Offer.findById(req.params.id);
    if (!existingOffer) return res.status(404).json({ error: 'Offer not found' });
    
    // Parse appliedItems and appliedCategories if they're JSON strings
    let parsedAppliedItems = [];
    let parsedAppliedCategories = [];
    let parsedAppliedVariants = [];
    let parsedAppliedQuantities = [];
    
    if (appliedItems) {
      parsedAppliedItems = typeof appliedItems === 'string' ? JSON.parse(appliedItems) : appliedItems;
    }
    
    if (appliedCategories) {
      parsedAppliedCategories = typeof appliedCategories === 'string' ? JSON.parse(appliedCategories) : appliedCategories;
    }
    
    if (appliedVariants) {
      parsedAppliedVariants = typeof appliedVariants === 'string' ? JSON.parse(appliedVariants) : appliedVariants;
    }
    
    if (appliedQuantities) {
      parsedAppliedQuantities = typeof appliedQuantities === 'string' ? JSON.parse(appliedQuantities) : appliedQuantities;
    }
    
    // Handle targeting - fetch customers in background after saving
    const finalTargetType = targetType || existingOffer.targetType || 'all';
    const finalTargetPercentage = parseInt(targetPercentage) || existingOffer.targetPercentage || 100;
    const finalTargetMinSpent = parseFloat(targetMinSpent) || existingOffer.targetMinSpent || 0;
    const finalTargetMinOrders = parseInt(targetMinOrders) || existingOffer.targetMinOrders || 0;
    
    // Determine if this is a targeted offer
    const isTargetedOffer = ['top_percentage', 'min_spent', 'min_orders'].includes(finalTargetType);
    
    const updateData = {
      title,
      description,
      offerType: offerType || '',
      percentage: percentage ? parseFloat(percentage) : null,
      appliedItems: parsedAppliedItems,
      appliedVariants: parsedAppliedVariants,
      appliedQuantities: parsedAppliedQuantities,
      appliedCategories: parsedAppliedCategories,
      code,
      discountType: discountType || 'none',
      discountValue: parseFloat(discountValue) || 0,
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: isActive !== 'false',
      showAsPopup: showAsPopup !== 'false',
      buttonText,
      buttonLink,
      targetType: finalTargetType,
      targetPercentage: finalTargetPercentage,
      targetMinSpent: finalTargetMinSpent,
      targetMinOrders: finalTargetMinOrders,
      // Keep existing customers for now, will update in background if needed
      targetedCustomers: isTargetedOffer ? (existingOffer.targetedCustomers || []) : []
    };

    // Helper function to delete old image
    const deleteOldImage = async (imageUrl) => {
      if (imageUrl && imageUrl.includes('cloudinary.com')) {
        try {
          const publicId = cloudinary.extractPublicId(imageUrl);
          if (publicId) await cloudinary.deleteImage(publicId);
        } catch (e) {
          logger.warn('Could not delete old offer image', { error: e.message });
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

    // Handle WhatsApp image (1:1 ratio)
    if (req.files?.imageWhatsApp?.[0]) {
      await deleteOldImage(existingOffer.imageWhatsApp);
      updateData.imageWhatsApp = await cloudinary.uploadPreserveAspect(req.files.imageWhatsApp[0].buffer, 'offers/whatsapp');
    } else if (req.body.imageWhatsApp && req.body.imageWhatsApp !== existingOffer.imageWhatsApp) {
      await deleteOldImage(existingOffer.imageWhatsApp);
      updateData.imageWhatsApp = req.body.imageWhatsApp;
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
    
    // Apply offer to selected items and categories (if any items/categories are selected)
    if (parsedAppliedItems.length > 0 || parsedAppliedCategories.length > 0 || parsedAppliedVariants.length > 0 || parsedAppliedQuantities.length > 0) {
      const MenuItem = require('../models/MenuItem');
      
      // Collect all item IDs (from direct selection, categories, variants, and quantities)
      let allItemIds = [...parsedAppliedItems];
      
      // Add items from selected categories
      if (parsedAppliedCategories.length > 0) {
        const categoryItems = await MenuItem.find({
          category: { $in: parsedAppliedCategories }
        });
        const categoryItemIds = categoryItems.map(item => item._id.toString());
        allItemIds = [...new Set([...allItemIds, ...categoryItemIds])];
      }
      
      // Add items from variant-level selections
      const variantItemIds = [...new Set(parsedAppliedVariants.map(v => v.split('_')[0]))];
      if (variantItemIds.length > 0) {
        allItemIds = [...new Set([...allItemIds, ...variantItemIds])];
      }
      
      // Add items from quantity-level selections
      const quantityItemIds = [...new Set(parsedAppliedQuantities.map(q => q.split('_')[0]))];
      if (quantityItemIds.length > 0) {
        allItemIds = [...new Set([...allItemIds, ...quantityItemIds])];
      }
      
      // First, remove this offer from items that are no longer selected
      const previousItems = existingOffer.appliedItems || [];
      const previousCategories = existingOffer.appliedCategories || [];
      
      // Get previous category items
      let previousCategoryItemIds = [];
      if (previousCategories.length > 0) {
        const prevCategoryItems = await MenuItem.find({
          category: { $in: previousCategories }
        });
        previousCategoryItemIds = prevCategoryItems.map(item => item._id.toString());
      }
      
      const allPreviousItemIds = [...new Set([...previousItems.map(id => id.toString()), ...previousCategoryItemIds])];
      const removedItems = allPreviousItemIds.filter(id => !allItemIds.includes(id));
      
      for (const itemId of removedItems) {
        const item = await MenuItem.findById(itemId);
        if (item) {
          const offerTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
          const updatedOfferTypes = offerTypes.filter(ot => ot !== offerType);
          
          if (updatedOfferTypes.length === 0) {
            const clearUpdate = {
              $unset: { offerPrice: 1 },
              $set: { offerType: [] }
            };
            // Clear variant offerPrices too
            if (item.variants && item.variants.length > 0) {
              clearUpdate.$set.variants = item.variants.map(v => {
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
              });
            }
            await MenuItem.findByIdAndUpdate(itemId, clearUpdate);
          } else {
            await MenuItem.findByIdAndUpdate(itemId, {
              offerType: updatedOfferTypes
            });
          }
        }
      }
      
      // Then, apply offer to newly selected items
      // NOTE: For targeted offers, we DON'T apply offerPrice to items
      
      for (const itemId of allItemIds) {
        const item = await MenuItem.findById(itemId);
        if (item) {
          // Add offer type to item's offerType array
          const offerTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
          if (!offerTypes.includes(offerType)) {
            offerTypes.push(offerType);
          }
          
          const updateFields = { offerType: offerTypes };
          
          // Check if this item is fully selected or only specific variants/quantities
          const isFullItemSelected = parsedAppliedItems.includes(itemId) || 
            parsedAppliedCategories.some(cat => {
              const itemCats = Array.isArray(item.category) ? item.category : [item.category];
              return itemCats.includes(cat);
            });
          
          // If percentage is provided AND it's NOT a targeted offer, calculate and apply discount
          if (percentage && !isTargetedOffer) {
            const discountPercent = parseFloat(percentage);
            
            if (isFullItemSelected) {
              // Full item selected — apply to parent price and ALL variants
              const offerPrice = Math.round(item.price * (1 - discountPercent / 100));
              updateFields.offerPrice = offerPrice;
              
              if (item.variants && item.variants.length > 0) {
                updateFields.variants = item.variants.map(v => {
                  const vObj = v.toObject ? v.toObject() : { ...v };
                  vObj.offerPrice = Math.round(v.price * (1 - discountPercent / 100));
                  if (vObj.quantities && vObj.quantities.length > 0) {
                    vObj.quantities = vObj.quantities.map(q => ({
                      ...(q.toObject ? q.toObject() : q),
                      offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                    }));
                  }
                  return vObj;
                });
              }
            } else {
              // Specific variants or quantities selected
              const selectedVariantIndices = parsedAppliedVariants
                .filter(v => v.startsWith(itemId + '_'))
                .map(v => parseInt(v.split('_')[1]));
              
              const selectedQuantityMap = {};
              parsedAppliedQuantities
                .filter(q => q.startsWith(itemId + '_'))
                .forEach(q => {
                  const parts = q.split('_');
                  const vi = parseInt(parts[1]);
                  const qi = parseInt(parts[2]);
                  if (!selectedQuantityMap[vi]) selectedQuantityMap[vi] = [];
                  selectedQuantityMap[vi].push(qi);
                });
              
              if (item.variants && item.variants.length > 0) {
                updateFields.variants = item.variants.map((v, idx) => {
                  const vObj = v.toObject ? v.toObject() : { ...v };
                  if (selectedVariantIndices.includes(idx)) {
                    vObj.offerPrice = Math.round(v.price * (1 - discountPercent / 100));
                    if (vObj.quantities && vObj.quantities.length > 0) {
                      vObj.quantities = vObj.quantities.map(q => ({
                        ...(q.toObject ? q.toObject() : q),
                        offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                      }));
                    }
                  } else if (selectedQuantityMap[idx]) {
                    const selectedQIndices = selectedQuantityMap[idx];
                    if (vObj.quantities && vObj.quantities.length > 0) {
                      vObj.quantities = vObj.quantities.map((q, qIdx) => {
                        const qObj = q.toObject ? q.toObject() : { ...q };
                        if (selectedQIndices.includes(qIdx)) {
                          qObj.offerPrice = Math.round(q.price * (1 - discountPercent / 100));
                        }
                        return qObj;
                      });
                    }
                  }
                  return vObj;
                });
              }
            }
          }
          
          await MenuItem.findByIdAndUpdate(itemId, updateFields);
        }
      }
    } else {
      // If no items/categories selected, remove this offer from all items
      const MenuItem = require('../models/MenuItem');
      const previousItems = existingOffer.appliedItems || [];
      const previousCategories = existingOffer.appliedCategories || [];
      
      // Get previous category items
      let previousCategoryItemIds = [];
      if (previousCategories.length > 0) {
        const prevCategoryItems = await MenuItem.find({
          category: { $in: previousCategories }
        });
        previousCategoryItemIds = prevCategoryItems.map(item => item._id.toString());
      }
      
      const allPreviousItemIds = [...new Set([...previousItems.map(id => id.toString()), ...previousCategoryItemIds])];
      
      for (const itemId of allPreviousItemIds) {
        const item = await MenuItem.findById(itemId);
        if (item) {
          const offerTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
          const updatedOfferTypes = offerTypes.filter(ot => ot !== offerType);
          
          if (updatedOfferTypes.length === 0) {
            const clearUpdate = {
              $unset: { offerPrice: 1 },
              $set: { offerType: [] }
            };
            if (item.variants && item.variants.length > 0) {
              clearUpdate.$set.variants = item.variants.map(v => {
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
              });
            }
            await MenuItem.findByIdAndUpdate(itemId, clearUpdate);
          } else {
            await MenuItem.findByIdAndUpdate(itemId, {
              offerType: updatedOfferTypes
            });
          }
        }
      }
    }
    
    // Emit SSE event to notify clients to refresh (cache-busting)
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    eventEmitter.emit('dataUpdate', { type: 'menu' });

    // Catalog sync after offer update is DISABLED to prevent catalog disruption.
    // Offer prices are applied from MongoDB in chatbot messages and order flow.
    // Catalog sale_price will update on next manual Catalog Sync or 2 AM scheduled sync.
    // {
    //   const MenuItem = require('../models/MenuItem');
    //   const prevItems = (existingOffer.appliedItems || []).map(id => id.toString());
    //   let prevCatItems = [];
    //   if ((existingOffer.appliedCategories || []).length > 0) {
    //     const pcItems = await MenuItem.find({ category: { $in: existingOffer.appliedCategories } });
    //     prevCatItems = pcItems.map(i => i._id.toString());
    //   }
    //   let curCatItems = [];
    //   if (parsedAppliedCategories.length > 0) {
    //     const ccItems = await MenuItem.find({ category: { $in: parsedAppliedCategories } });
    //     curCatItems = ccItems.map(i => i._id.toString());
    //   }
    //   const allAffected = [...new Set([...prevItems, ...prevCatItems, ...parsedAppliedItems, ...curCatItems])];
    //   if (allAffected.length > 0) {
    //     (async () => {
    //       try {
    //         for (const itemId of allAffected) {
    //           const freshItem = await MenuItem.findById(itemId);
    //           if (freshItem) await catalogService.syncProductToMeta(freshItem);
    //         }
    //         catalogService.clearCache();
    //         logger.info('Catalog synced after offer update', { itemCount: allAffected.length });
    //       } catch (syncErr) {
    //         logger.error('Catalog sync after offer update failed', { error: syncErr.message });
    //       }
    //     })();
    //   }
    // }
    
    // Fetch targeted customers in background (don't block response)
    if (isTargetedOffer) {
      logger.info('Fetching targeted customers in background for offer ...', { _id : offer._id });
      (async () => {
        try {
          let targetedCustomerPhones = [];
          
          if (finalTargetType === 'top_percentage' && finalTargetPercentage < 100) {
            const result = await googleSheets.getTopCustomersBySpent(finalTargetPercentage);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found top % customers: customers', { finalTargetPercentage, length : targetedCustomerPhones.length });
            }
          } else if (finalTargetType === 'min_spent' && finalTargetMinSpent > 0) {
            const result = await googleSheets.getCustomersByMinSpent(finalTargetMinSpent);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found customers with min spent ₹: customers', { finalTargetMinSpent, length : targetedCustomerPhones.length });
            }
          } else if (finalTargetType === 'min_orders' && finalTargetMinOrders > 0) {
            const result = await googleSheets.getCustomersByMinOrders(finalTargetMinOrders);
            if (result.customers && result.customers.length > 0) {
              targetedCustomerPhones = result.customers.map(c => c.phone);
              logger.info('Found customers with min orders: customers', { finalTargetMinOrders, length : targetedCustomerPhones.length });
            }
          }
          
          // Update offer with targeted customers
          await Offer.findByIdAndUpdate(offer._id, { targetedCustomers: targetedCustomerPhones });
          logger.info('Updated offer with targeted customers', { _id: offer._id, count: targetedCustomerPhones.length });
        } catch (bgError) {
          logger.error('Background customer fetch failed for offer', { error: bgError.message });
        }
      })();
    }
    
    res.json(offer);
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
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
          logger.warn('Could not delete offer image', { error: e.message });
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
    
    // Remove this offer type from all menu items and recalculate offer prices
    if (offer.offerType) {
      const MenuItem = require('../models/MenuItem');
      
      // Get all items that have this offer type
      const itemsWithOffer = await MenuItem.find({ offerType: offer.offerType });
      
      for (const item of itemsWithOffer) {
        const offerTypes = Array.isArray(item.offerType) ? item.offerType : [item.offerType];
        const updatedOfferTypes = offerTypes.filter(ot => ot !== offer.offerType);
        
        // If no more offers, remove offerPrice (including variant offerPrices)
        if (updatedOfferTypes.length === 0) {
          const clearFields = {
            $unset: { offerPrice: 1 },
            offerType: []
          };
          // Clear variant offerPrices too
          if (item.variants && item.variants.length > 0) {
            clearFields.variants = item.variants.map(v => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              delete vObj.offerPrice;
              return vObj;
            });
          }
          await MenuItem.findByIdAndUpdate(item._id, clearFields);
        } else {
          // Still has other offers, recalculate offerPrice based on remaining offers
          const remainingOffers = await Offer.find({ 
            offerType: { $in: updatedOfferTypes },
            isActive: true 
          });
          
          // Find the best discount from remaining offers
          let bestDiscount = 0;
          for (const remainingOffer of remainingOffers) {
            if (remainingOffer.percentage && remainingOffer.percentage > bestDiscount) {
              bestDiscount = remainingOffer.percentage;
            }
          }
          
          const updateFields = { offerType: updatedOfferTypes };
          if (bestDiscount > 0) {
            updateFields.offerPrice = Math.round(item.price * (1 - bestDiscount / 100));
            // Recalculate variant offerPrices
            if (item.variants && item.variants.length > 0) {
              updateFields.variants = item.variants.map(v => ({
                ...v.toObject ? v.toObject() : v,
                offerPrice: Math.round(v.price * (1 - bestDiscount / 100))
              }));
            }
          } else {
            // No percentage-based offers remain, remove offerPrice
            const clearFields = {
              $unset: { offerPrice: 1 },
              offerType: updatedOfferTypes
            };
            if (item.variants && item.variants.length > 0) {
              clearFields.variants = item.variants.map(v => {
                const vObj = v.toObject ? v.toObject() : { ...v };
                delete vObj.offerPrice;
                return vObj;
              });
            }
            await MenuItem.findByIdAndUpdate(item._id, clearFields);
            continue;
          }
          
          await MenuItem.findByIdAndUpdate(item._id, updateFields);
        }
      }
      
    }
    
    // Delete the Meta WhatsApp template (best-effort, don't block deletion)
    if (offer.templateName) {
      try {
        await whatsapp.deleteMessageTemplate(offer.templateName);
        logger.info('Deleted Meta template', { templateName: offer.templateName });
      } catch (tplErr) {
        logger.warn('Could not delete Meta template (may already be removed)', { templateName: offer.templateName, error: tplErr.message });
      }
    }

    // Catalog sync after offer delete is DISABLED to prevent catalog disruption.
    // Offer prices are applied from MongoDB in chatbot messages and order flow.
    // Catalog sale_price will update on next manual Catalog Sync or 2 AM scheduled sync.
    // if (offer.offerType) {
    //   const MenuItem = require('../models/MenuItem');
    //   const affectedItems = await MenuItem.find({ _id: { $in: (offer.appliedItems || []) } });
    //   let catItems = [];
    //   if ((offer.appliedCategories || []).length > 0) {
    //     catItems = await MenuItem.find({ category: { $in: offer.appliedCategories } });
    //   }
    //   const allItems = [...affectedItems, ...catItems];
    //   (async () => {
    //     try {
    //       for (const item of allItems) {
    //         const freshItem = await MenuItem.findById(item._id);
    //         if (freshItem) await catalogService.syncProductToMeta(freshItem);
    //       }
    //       catalogService.clearCache();
    //       logger.info('Catalog synced after offer delete', { itemCount: allItems.length });
    //     } catch (syncErr) {
    //       logger.error('Catalog sync after offer delete failed', { error: syncErr.message });
    //     }
    //   })();
    // }
    
    await Offer.findByIdAndDelete(req.params.id);
    
    // Emit SSE event to notify clients
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'menu' });
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    // Emit specific offer-deleted event with offerId so frontend can remove items from cart/wishlist
    eventEmitter.emit('dataUpdate', { type: 'offer-deleted', offerId: req.params.id });
    
    res.json({ message: 'Offer deleted and removed from all items' });
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
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
    
    // If offer is being deactivated, recalculate prices for affected items
    if (wasActive && !offer.isActive && offer.offerType) {
      const MenuItem = require('../models/MenuItem');
      const itemsWithOffer = await MenuItem.find({ offerType: offer.offerType });
      
      for (const item of itemsWithOffer) {
        const offerTypes = Array.isArray(item.offerType) ? item.offerType : [item.offerType];
        
        // Get remaining active offers for this item
        const remainingOffers = await Offer.find({ 
          offerType: { $in: offerTypes },
          isActive: true,
          _id: { $ne: offer._id } // Exclude the deactivated offer
        });
        
        // Find the best discount from remaining active offers
        let bestDiscount = 0;
        for (const remainingOffer of remainingOffers) {
          if (remainingOffer.percentage && remainingOffer.percentage > bestDiscount) {
            bestDiscount = remainingOffer.percentage;
          }
        }
        
        if (bestDiscount > 0) {
          const updateFields = {
            offerPrice: Math.round(item.price * (1 - bestDiscount / 100))
          };
          if (item.variants && item.variants.length > 0) {
            updateFields.variants = item.variants.map(v => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              vObj.offerPrice = Math.round(v.price * (1 - bestDiscount / 100));
              if (vObj.quantities && vObj.quantities.length > 0) {
                vObj.quantities = vObj.quantities.map(q => ({
                  ...(q.toObject ? q.toObject() : q),
                  offerPrice: Math.round(q.price * (1 - bestDiscount / 100))
                }));
              }
              return vObj;
            });
          }
          await MenuItem.findByIdAndUpdate(item._id, updateFields);
        } else {
          // No active percentage-based offers remain, remove offerPrice
          const clearUpdate = { $unset: { offerPrice: 1 } };
          if (item.variants && item.variants.length > 0) {
            clearUpdate.$set = { variants: item.variants.map(v => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              delete vObj.offerPrice;
              // Also clear offerPrice from nested quantities
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
        }
      }
      
      // Emit SSE event to notify clients
      const eventEmitter = require('../services/eventEmitter');
      eventEmitter.emit('dataUpdate', { type: 'menu' });
    }
    
    // If offer is being activated, apply it to items
    if (!wasActive && offer.isActive && offer.offerType && offer.percentage) {
      const MenuItem = require('../models/MenuItem');
      
      // Collect all affected item IDs from appliedItems, appliedVariants, appliedQuantities, and appliedCategories
      let allItemIds = [...(offer.appliedItems || []).map(id => id.toString())];
      
      if (offer.appliedCategories && offer.appliedCategories.length > 0) {
        const catItems = await MenuItem.find({ category: { $in: offer.appliedCategories } });
        allItemIds = [...new Set([...allItemIds, ...catItems.map(i => i._id.toString())])];
      }
      
      const variantItemIds = [...new Set((offer.appliedVariants || []).map(v => v.split('_')[0]))];
      const quantityItemIds = [...new Set((offer.appliedQuantities || []).map(q => q.split('_')[0]))];
      allItemIds = [...new Set([...allItemIds, ...variantItemIds, ...quantityItemIds])];
      
      const discountPercent = offer.percentage;
      
      for (const itemId of allItemIds) {
        const item = await MenuItem.findById(itemId);
        if (!item) continue;
        
        const isFullItemSelected = (offer.appliedItems || []).map(id => id.toString()).includes(itemId) ||
          (offer.appliedCategories || []).some(cat => {
            const itemCats = Array.isArray(item.category) ? item.category : [item.category];
            return itemCats.includes(cat);
          });
        
        const updateFields = {};
        
        if (isFullItemSelected) {
          updateFields.offerPrice = Math.round(item.price * (1 - discountPercent / 100));
          if (item.variants && item.variants.length > 0) {
            updateFields.variants = item.variants.map(v => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              vObj.offerPrice = Math.round(v.price * (1 - discountPercent / 100));
              if (vObj.quantities && vObj.quantities.length > 0) {
                vObj.quantities = vObj.quantities.map(q => ({
                  ...(q.toObject ? q.toObject() : q),
                  offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                }));
              }
              return vObj;
            });
          }
        } else {
          const selectedVariantIndices = (offer.appliedVariants || [])
            .filter(v => v.startsWith(itemId + '_'))
            .map(v => parseInt(v.split('_')[1]));
          
          const selectedQuantityMap = {};
          (offer.appliedQuantities || [])
            .filter(q => q.startsWith(itemId + '_'))
            .forEach(q => {
              const parts = q.split('_');
              const vi = parseInt(parts[1]);
              const qi = parseInt(parts[2]);
              if (!selectedQuantityMap[vi]) selectedQuantityMap[vi] = [];
              selectedQuantityMap[vi].push(qi);
            });
          
          if (item.variants && item.variants.length > 0) {
            updateFields.variants = item.variants.map((v, idx) => {
              const vObj = v.toObject ? v.toObject() : { ...v };
              if (selectedVariantIndices.includes(idx)) {
                vObj.offerPrice = Math.round(v.price * (1 - discountPercent / 100));
                if (vObj.quantities && vObj.quantities.length > 0) {
                  vObj.quantities = vObj.quantities.map(q => ({
                    ...(q.toObject ? q.toObject() : q),
                    offerPrice: Math.round(q.price * (1 - discountPercent / 100))
                  }));
                }
              } else if (selectedQuantityMap[idx]) {
                const selectedQIndices = selectedQuantityMap[idx];
                if (vObj.quantities && vObj.quantities.length > 0) {
                  vObj.quantities = vObj.quantities.map((q, qIdx) => {
                    const qObj = q.toObject ? q.toObject() : { ...q };
                    if (selectedQIndices.includes(qIdx)) {
                      qObj.offerPrice = Math.round(q.price * (1 - discountPercent / 100));
                    }
                    return qObj;
                  });
                }
              }
              return vObj;
            });
          }
        }
        
        await MenuItem.findByIdAndUpdate(itemId, updateFields);
      }
      
      // Emit SSE event to notify clients
      const eventEmitter = require('../services/eventEmitter');
      eventEmitter.emit('dataUpdate', { type: 'menu' });
    }
    
    // Emit SSE event to notify clients
    const eventEmitter = require('../services/eventEmitter');
    eventEmitter.emit('dataUpdate', { type: 'offers' });
    
    // If offer was deactivated, emit offer-deleted so frontend removes items from cart/wishlist
    if (wasActive && !offer.isActive) {
      eventEmitter.emit('dataUpdate', { type: 'offer-deleted', offerId: req.params.id });
    }

    // Catalog sync after offer toggle is DISABLED to prevent catalog disruption.
    // Offer prices are applied from MongoDB in chatbot messages and order flow.
    // Catalog sale_price will update on next manual Catalog Sync or 2 AM scheduled sync.
    // if (offer.offerType) {
    //   const MenuItem = require('../models/MenuItem');
    //   const itemsWithOffer = await MenuItem.find({ offerType: offer.offerType });
    //   (async () => {
    //     try {
    //       for (const item of itemsWithOffer) {
    //         const freshItem = await MenuItem.findById(item._id);
    //         if (freshItem) await catalogService.syncProductToMeta(freshItem);
    //       }
    //       catalogService.clearCache();
    //       logger.info('Catalog synced after offer toggle', { itemCount: itemsWithOffer.length, active: offer.isActive });
    //     } catch (syncErr) {
    //       logger.error('Catalog sync after offer toggle failed', { error: syncErr.message });
    //     }
    //   })();
    // }
    
    res.json(offer);
  } catch (err) {

    return logRouteError(res, 'Internal server error', err);
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

    return logRouteError(res, 'Internal server error', err);
  }
});

module.exports = router;
