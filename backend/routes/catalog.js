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

// POST /api/catalog/auto-sync - Sync all menu items to Meta catalog + create local mappings
// Body: { overwrite: boolean }
router.post('/auto-sync', authMiddleware, async (req, res) => {
  try {
    const { overwrite = false } = req.body;
    const result = await catalogService.autoSync(overwrite);
    res.json({
      success: true,
      message: `Local mappings: ${result.created} created, ${result.skipped} skipped. Meta catalog: ${result.metaPushed || 0} pushed, ${result.metaFailed || 0} failed.`,
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

// POST /api/catalog/sync-collections - Sync categories as catalog collections with images
router.post('/sync-collections', authMiddleware, async (req, res) => {
  try {
    const result = await catalogService.syncCollections();
    res.json({
      success: true,
      message: `Collections: ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
      ...result
    });
  } catch (error) {
    logger.error('Catalog collections sync error', { error: error.message });
    res.status(500).json({ error: 'Failed to sync collections' });
  }
});

// GET /api/catalog/collections - List all collections from Meta catalog
router.get('/collections', authMiddleware, async (req, res) => {
  try {
    const collections = await catalogService.getCollections();
    res.json(collections);
  } catch (error) {
    logger.error('Catalog get collections error', { error: error.message });
    res.status(500).json({ error: 'Failed to get collections' });
  }
});

// ============ WHATSAPP FLOWS ============

// POST /api/catalog/setup-flow - Create & publish the category selection Flow
router.post('/setup-flow', authMiddleware, async (req, res) => {
  try {
    const result = await catalogService.setupCategoryFlow();
    res.json({
      success: true,
      message: result.status === 'already_published'
        ? `Flow already published (ID: ${result.flowId})`
        : `Flow created and published (ID: ${result.flowId})`,
      ...result
    });
  } catch (error) {
    logger.error('Setup Flow error', { error: error.message });
    res.status(500).json({ error: 'Failed to setup category Flow', details: error.message });
  }
});

// GET /api/catalog/flows - List all Flows under the WABA
router.get('/flows', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    const flows = await metaCloud.getFlows();
    res.json(flows);
  } catch (error) {
    logger.error('Get Flows error', { error: error.message });
    res.status(500).json({ error: 'Failed to get Flows' });
  }
});

// GET /api/catalog/flow-status - Quick diagnostics for Flow configuration
router.get('/flow-status', authMiddleware, async (req, res) => {
  const catalogService = require('../services/catalogService');
  res.json({
    flowId: catalogService.getCategoryFlowId(),
    flowMode: catalogService.getCategoryFlowMode(),
    flowStatus: process.env.WHATSAPP_CATEGORY_FLOW_STATUS || 'NOT_SET',
    catalogEnabled: catalogService.isEnabled(),
    catalogId: process.env.META_CATALOG_ID ? 'set' : 'not_set',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID ? 'set' : 'not_set',
    tokenSet: !!process.env.META_ACCESS_TOKEN,
    wabaId: process.env.META_WABA_ID ? 'set' : 'not_set'
  });
});

// GET /api/catalog/flow/:flowId - Get Flow details
router.get('/flow/:flowId', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    const details = await metaCloud.getFlowDetails(req.params.flowId);
    res.json(details);
  } catch (error) {
    logger.error('Get Flow details error', { error: error.message });
    res.status(500).json({ error: 'Failed to get Flow details' });
  }
});

// DELETE /api/catalog/flow/:flowId - Delete a draft Flow
router.delete('/flow/:flowId', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    await metaCloud.deleteFlow(req.params.flowId);
    res.json({ success: true, message: 'Flow deleted' });
  } catch (error) {
    logger.error('Delete Flow error', { error: error.message });
    res.status(500).json({ error: 'Failed to delete Flow (only DRAFT flows can be deleted)' });
  }
});

// POST /api/catalog/test-flow - Send a test Flow message to a phone number
router.post('/test-flow', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    const catalogService = require('../services/catalogService');
    const phone = req.body.phone || '919440203095';
    const flowId = catalogService.getCategoryFlowId();
    const flowMode = catalogService.getCategoryFlowMode();

    if (!flowId) {
      return res.status(400).json({ error: 'No Flow ID configured. Call POST /setup-flow first.' });
    }

    const result = await metaCloud.sendFlowMessage(phone, {
      flowId,
      flowCta: 'Browse by Category',
      headerText: 'Our Menu',
      bodyText: 'Select a category to browse menu items.',
      footerText: 'Powered by JRB Gold',
      screenName: 'CATEGORY_SELECT',
      screenData: {
        categories: [
          { id: 'veg_starters', title: 'Veg Starters (12 items)' },
          { id: 'biryani', title: 'Biryani (6 items)' }
        ]
      },
      flowToken: `category_select_test_${phone}`,
      mode: flowMode
    });

    res.json({ success: true, flowId, mode: flowMode, result });
  } catch (error) {
    const errData = error.response?.data?.error;
    logger.error('Test Flow send error', { error: error.message, apiError: errData });
    res.status(500).json({
      error: 'Flow message send failed',
      details: errData || error.message,
      flowId: require('../services/catalogService').getCategoryFlowId(),
      mode: require('../services/catalogService').getCategoryFlowMode()
    });
  }
});

module.exports = router;
