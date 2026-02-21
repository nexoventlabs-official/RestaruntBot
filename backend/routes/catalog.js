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
    return logRouteError(res, 'Catalog stats error', error);
  }
});

// GET /api/catalog/mappings - List all catalog product mappings
router.get('/mappings', authMiddleware, async (req, res) => {
  try {
    const mappings = await catalogService.getAllMappings();
    res.json(mappings);
  } catch (error) {
    return logRouteError(res, 'Catalog mappings error', error);
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
    return logRouteError(res, 'Catalog auto-sync error', error);
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
    return logRouteError(res, 'Catalog set mapping error', error);
  }
});

// DELETE /api/catalog/mapping/:menuItemId - Remove a catalog mapping
router.delete('/mapping/:menuItemId', authMiddleware, async (req, res) => {
  try {
    const { menuItemId } = req.params;
    await catalogService.removeMapping(menuItemId);
    res.json({ success: true, message: 'Mapping removed' });
  } catch (error) {
    return logRouteError(res, 'Catalog remove mapping error', error);
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
    return logRouteError(res, 'Catalog collections sync error', error);
  }
});

// GET /api/catalog/collections - List all collections from Meta catalog
router.get('/collections', authMiddleware, async (req, res) => {
  try {
    const collections = await catalogService.getCollections();
    res.json(collections);
  } catch (error) {
    return logRouteError(res, 'Catalog get collections error', error);
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
    return logRouteError(res, 'Setup Flow error', error);
  }
});

// GET /api/catalog/flows - List all Flows under the WABA
router.get('/flows', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    const flows = await metaCloud.getFlows();
    res.json(flows);
  } catch (error) {
    return logRouteError(res, 'Get Flows error', error);
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
    return logRouteError(res, 'Get Flow details error', error);
  }
});

// DELETE /api/catalog/flow/:flowId - Delete a draft Flow
router.delete('/flow/:flowId', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    await metaCloud.deleteFlow(req.params.flowId);
    res.json({ success: true, message: 'Flow deleted' });
  } catch (error) {
    return logRouteError(res, 'Delete Flow error', error);
  }
});

// GET /api/catalog/products-review - Check product review status from Meta
router.get('/products-review', authMiddleware, async (req, res) => {
  try {
    const metaCloud = require('../services/metaCloud');
    const catalogId = catalogService.getCatalogId();
    if (!catalogId) return res.json({ error: 'No catalog ID configured' });

    const accessToken = process.env.META_ACCESS_TOKEN;
    const axios = require('axios');
    const response = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/products`,
      {
        params: {
          fields: 'id,retailer_id,name,review_status,visibility,image_url,price,availability,color,size,item_group_id',
          limit: 100,
          access_token: accessToken
        }
      }
    );
    res.json(response.data?.data || []);
  } catch (error) {
    return logRouteError(res, 'Products review check error', error);
  }
});

module.exports = router;
