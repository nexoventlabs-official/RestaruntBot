/**
 * Create Order Confirmation Flow v2 — with item images via RadioButtonsGroup
 * Usage: node create-order-confirm-flow-v2.js
 */
require('dotenv').config();
const axios = require('axios');

async function main() {
  const metaCloud = require('./services/metaCloud');
  const catalogService = require('./services/catalogService');

  const FLOW_NAME = 'JRB Order Confirm v5';
  const ENDPOINT_URI = 'https://restaruntbot.onrender.com/api/whatsapp-flow';
  const TOKEN = process.env.META_ACCESS_TOKEN;

  // Step 1: Create
  console.log('Creating flow...');
  const { id: flowId } = await metaCloud.createFlow(FLOW_NAME, ['OTHER']);
  console.log(`Flow created: ${flowId}`);

  // Step 2: Set endpoint URI via Graph API
  console.log('Setting endpoint URI...');
  await axios.post(`https://graph.facebook.com/v24.0/${flowId}`, 
    { endpoint_uri: ENDPOINT_URI },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  console.log('Endpoint URI set');

  // Step 3: Upload JSON
  console.log('Uploading JSON...');
  const flowJson = catalogService.buildOrderConfirmFlowJSON();
  console.log('Screens:', flowJson.screens.map(s => s.id));
  await metaCloud.updateFlowJSON(flowId, flowJson);
  console.log('JSON uploaded');

  // Step 4: Publish
  console.log('Publishing...');
  try {
    await metaCloud.publishFlow(flowId);
    console.log(`\n✅ PUBLISHED: ${flowId}`);
    console.log(`Update .env: WHATSAPP_ORDER_CONFIRM_FLOW_ID=${flowId}`);
  } catch (err) {
    console.error('Publish failed:', err.response?.data?.error || err.message);
    console.log(`\n⚠️  DRAFT: ${flowId} — fix validation and publish manually`);
  }
}

main().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
