/**
 * Catalog Routes
 * 
 * Admin endpoints to manage WhatsApp Commerce Catalog integration.
 * - View catalog stats & mappings
 * - Auto-sync menu items to catalog retailer IDs
 * - Set/remove individual mappings
 * - All routes require admin authentication
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const catalogService = require('../services/catalogService');
const logger = require('../services/logger');

// GET /api/catalog/stats - Get catalog integration status
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await catalogService.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Catalog stats error', { error: error.message });
    res.status(500).json({ error: 'Failed to get catalog stats' });
  }
});

// GET /api/catalog/mappings - List all catalog product mappings
router.get('/mappings', authMiddleware, async (req, res) => {
  try {
    const mappings = await catalogService.getAllMappings();
    res.json(mappings);
  } catch (error) {
    logger.error('Catalog mappings error', { error: error.message });
    res.status(500).json({ error: 'Failed to get catalog mappings' });
  }
});

// POST /api/catalog/auto-sync - Auto-create retailer ID mappings from menu items
// Body: { overwrite: boolean }
router.post('/auto-sync', authMiddleware, async (req, res) => {
  try {
    const { overwrite = false } = req.body;
    const result = await catalogService.autoSync(overwrite);
    res.json({
      success: true,
      message: `Synced ${result.created} products (${result.skipped} skipped)`,
      ...result
    });
  } catch (error) {
    logger.error('Catalog auto-sync error', { error: error.message });
    res.status(500).json({ error: 'Failed to auto-sync catalog' });
  }
});

// PUT /api/catalog/mapping/:menuItemId - Set a custom retailer_id mapping
// Body: { retailerId: string }
router.put('/mapping/:menuItemId', authMiddleware, async (req, res) => {
  try {
    const { menuItemId } = req.params;
    const { retailerId } = req.body;

    if (!retailerId) {
      return res.status(400).json({ error: 'retailerId is required' });
    }

    const mapping = await catalogService.setMapping(menuItemId, retailerId);
    res.json({ success: true, mapping });
  } catch (error) {
    logger.error('Catalog set mapping error', { error: error.message });
    res.status(500).json({ error: 'Failed to set catalog mapping' });
  }
});

// DELETE /api/catalog/mapping/:menuItemId - Remove a catalog mapping
router.delete('/mapping/:menuItemId', authMiddleware, async (req, res) => {
  try {
    const { menuItemId } = req.params;
    await catalogService.removeMapping(menuItemId);
    res.json({ success: true, message: 'Mapping removed' });
  } catch (error) {
    logger.error('Catalog remove mapping error', { error: error.message });
    res.status(500).json({ error: 'Failed to remove catalog mapping' });
  }
});

module.exports = router;
