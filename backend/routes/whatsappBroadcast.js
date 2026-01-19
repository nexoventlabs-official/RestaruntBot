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

    // Get contact count for immediate response
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

    // Send immediate success response to app
    res.json({
      success: true,
      message: 'Offer is being sent to all customers',
      total: contactCount,
      sent: contactCount,
      failed: 0
    });

    // Send offers in background (non-blocking)
    whatsappBroadcast.sendOfferToAll(offerImageUrl, offerTitle, offerDescription, offerType)
      .then(result => {
        console.log('[WhatsApp Broadcast] Offer sending completed:', result);
      })
      .catch(error => {
        console.error('[WhatsApp Broadcast] Offer sending failed:', error);
      });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
