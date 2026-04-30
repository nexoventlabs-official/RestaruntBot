/**
 * Update Order Actions Flow JSON in-place
 *
 * Pushes the latest `buildOrderActionsFlowJSON()` output to Meta for the
 * existing WHATSAPP_ORDER_ACTIONS_FLOW_ID — without creating a new flow.
 *
 *   node update-order-actions-flow-json.js
 *
 * Prereqs: WHATSAPP_ORDER_ACTIONS_FLOW_ID + Meta access token must be set in .env.
 */

require('dotenv').config();
const logger = require('./services/logger');
const catalogService = require('./services/catalogService');
const metaCloud = require('./services/metaCloud');

async function updateOrderActionsFlowJSON() {
  const flowId = process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID;
  if (!flowId) {
    console.error('\u274c WHATSAPP_ORDER_ACTIONS_FLOW_ID is not set in .env');
    process.exit(1);
  }

  console.log('\u2192 Updating Order Actions Flow JSON for flowId:', flowId);

  try {
    const flowJson = catalogService.buildOrderActionsFlowJSON();
    console.log('  Screens:', flowJson.screens.map(s => s.id).join(', '));

    await metaCloud.updateFlowJSON(flowId, flowJson);
    console.log('\u2705 Flow JSON updated successfully.');

    try {
      await metaCloud.publishFlow(flowId);
      console.log('\u2705 Flow re-published.');
    } catch (pubErr) {
      console.warn('\u26a0\ufe0f  Re-publish skipped:', pubErr.response?.data?.error?.message || pubErr.message);
    }

    // Show any validation errors Meta returned so we can fix them quickly.
    try {
      const details = await metaCloud.getFlowDetails(flowId);
      console.log('\nFlow status:', details.status);
      if (Array.isArray(details.validation_errors) && details.validation_errors.length > 0) {
        console.log('\u26a0\ufe0f  Validation errors:');
        details.validation_errors.forEach((e, i) => {
          console.log(`  ${i + 1}. ${e.error}: ${e.message}`);
          if (e.pointers) console.log(`     at ${JSON.stringify(e.pointers[0]?.path)}`);
        });
      } else {
        console.log('\u2705 No validation errors.');
      }
    } catch (detailsErr) {
      console.warn('Could not fetch flow details:', detailsErr.message);
    }
  } catch (err) {
    logger.error('updateOrderActionsFlowJSON failed', { error: err.message });
    console.error('\u274c Failed to update flow JSON:', err.response?.data || err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  updateOrderActionsFlowJSON().then(() => process.exit(0));
}

module.exports = { updateOrderActionsFlowJSON };
