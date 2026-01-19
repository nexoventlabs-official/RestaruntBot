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
    const { offerImageUrl, offerTitle, offerDescription } = req.body;
    
    if (!offerImageUrl && !offerTitle && !offerDescription) {
      return res.status(400).json({ 
        success: false, 
        error: 'At least one of offerImageUrl, offerTitle, or offerDescription is required' 
      });
    }

    const result = await whatsappBroadcast.sendOfferToAll(offerImageUrl, offerTitle, offerDescription);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
