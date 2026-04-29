/**
 * Update Welcome Flow JSON in-place
 *
 * Pushes the latest `buildWelcomeFlowJSON()` output to Meta for the existing
 * WHATSAPP_WELCOME_FLOW_ID — without creating a new flow / changing the env id.
 *
 * Use this whenever the welcome-flow screen layout changes
 * (e.g. adding the new ORDER_HELP screen with Help footer).
 *
 *   node update-welcome-flow-json.js
 *
 * Prereqs: WHATSAPP_WELCOME_FLOW_ID + Meta access token must be set in .env.
 */

require('dotenv').config();
const logger = require('./services/logger');
const catalogService = require('./services/catalogService');
const metaCloud = require('./services/metaCloud');

async function updateWelcomeFlowJSON() {
  const flowId = process.env.WHATSAPP_WELCOME_FLOW_ID;
  if (!flowId) {
    console.error('\u274c WHATSAPP_WELCOME_FLOW_ID is not set in .env');
    process.exit(1);
  }

  console.log('\u2192 Updating Welcome Flow JSON for flowId:', flowId);

  try {
    const flowJson = catalogService.buildWelcomeFlowJSON();
    console.log('  Screens:', flowJson.screens.map(s => s.id).join(', '));

    await metaCloud.updateFlowJSON(flowId, flowJson);
    console.log('\u2705 Flow JSON updated successfully.');

    // The flow may already be PUBLISHED — updating JSON on a published flow
    // creates a new draft version. Re-publish to make the new version live.
    try {
      await metaCloud.publishFlow(flowId);
      console.log('\u2705 Flow re-published.');
    } catch (pubErr) {
      // It's normal for publishFlow to fail if the flow has no pending draft
      // (e.g. updateFlowJSON applied directly). Treat as best-effort.
      console.warn('\u26a0\ufe0f  Re-publish skipped:', pubErr.response?.data?.error?.message || pubErr.message);
    }

    console.log('\nNext step: send "hi" to your bot and tap My Orders \u2192 pick an order.');
    console.log('You should now see a "Help" footer that opens Track / Cancel / Contact options.');
  } catch (err) {
    logger.error('updateWelcomeFlowJSON failed', { error: err.message });
    console.error('\u274c Failed to update flow JSON:', err.response?.data || err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  updateWelcomeFlowJSON().then(() => process.exit(0));
}

module.exports = { updateWelcomeFlowJSON };
