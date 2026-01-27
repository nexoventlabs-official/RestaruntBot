const express = require('express');
const router = express.Router();
const whatsappBroadcast = require('../services/whatsappBroadcast');
const authMiddleware = require('../middleware/auth');

// Get all WhatsApp contacts
router.get('/contacts', authMiddleware, async (req, res) => {
  try {
    const contacts = await whatsappBroadcast.getAllContacts();
    res.json({ success: true, contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get WhatsApp contacts statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await whatsappBroadcast.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sync existing customers to WhatsApp contacts
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const result = await whatsappBroadcast.syncExistingCustomers();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send offer to all WhatsApp contacts
router.post('/send-offer', authMiddleware, async (req, res) => {
  try {
    const { offerImageUrl, offerTitle, offerDescription, offerType } = req.body;
    
    if (!offerImageUrl && !offerTitle && !offerDescription) {
      return res.status(400).json({ 
        success: false, 
        error: 'At least one of offerImageUrl, offerTitle, or offerDescription is required' 
      });
    }

    // Get contact count
    const contacts = await whatsappBroadcast.getAllContacts();
    const contactCount = contacts.length;

    if (contactCount === 0) {
      return res.json({ 
        success: false, 
        message: 'No contacts found', 
        sent: 0, 
        failed: 0 
      });
    }

    console.log(`[WhatsApp Broadcast] Starting offer broadcast to ${contactCount} contacts...`);

    // Send offers and wait for actual results
    const result = await whatsappBroadcast.sendOfferToAll(offerImageUrl, offerTitle, offerDescription, offerType);
    
    console.log('[WhatsApp Broadcast] Offer sending completed:', result);
    
    res.json({
      success: result.success,
      message: result.sent > 0 ? `Offer sent to ${result.sent} customers` : 'Failed to send offers',
      total: result.total,
      sent: result.sent,
      sentViaTemplate: result.sentViaTemplate || 0,
      failed: result.failed,
      failedContacts: result.failedContacts || [],
      templateConfigured: result.templateConfigured
    });

  } catch (error) {
    console.error('[WhatsApp Broadcast] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test send offer to a single phone number
router.post('/test-send', authMiddleware, async (req, res) => {
  try {
    const { phone, offerImageUrl, offerTitle, offerDescription, offerType } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone number is required for test' 
      });
    }

    console.log(`[WhatsApp Broadcast] Testing offer send to ${phone}...`);

    const result = await whatsappBroadcast.sendOfferToSingle(phone, offerImageUrl, offerTitle, offerDescription, offerType);
    
    res.json(result);

  } catch (error) {
    console.error('[WhatsApp Broadcast] Test send error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
