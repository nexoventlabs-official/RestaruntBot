/**
 * Verify what JSON is actually published on Meta for the welcome flow.
 * Lists all "JRB Welcome Services" flows and their status, then prints
 * the JSON of the published one.
 */
require('dotenv').config();
const axios = require('axios');

const WABA_ID = process.env.META_WABA_ID;
const TOKEN = process.env.META_ACCESS_TOKEN;

async function main() {
  if (!WABA_ID || !TOKEN) {
    console.error('META_WABA_ID or META_ACCESS_TOKEN missing in .env');
    process.exit(1);
  }

  console.log('Fetching flows for WABA', WABA_ID, '...\n');

  const listRes = await axios.get(
    `https://graph.facebook.com/v24.0/${WABA_ID}/flows`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );

  const flows = listRes.data.data || [];
  const welcomeFlows = flows.filter(f => f.name.startsWith('JRB Welcome Services'));

  console.log('Found', welcomeFlows.length, 'welcome flows:\n');
  for (const f of welcomeFlows) {
    const marker = f.id === process.env.WHATSAPP_WELCOME_FLOW_ID ? '👉' : '  ';
    console.log(`${marker} ${f.id}  status=${f.status}  name="${f.name}"`);
  }

  // Print JSON of the new flow ID
  const targetId = process.env.WHATSAPP_WELCOME_FLOW_ID;
  console.log(`\n─── JSON for current env Flow ID ${targetId} ───\n`);

  try {
    const assetsRes = await axios.get(
      `https://graph.facebook.com/v24.0/${targetId}/assets`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const assets = assetsRes.data.data || [];
    const jsonAsset = assets.find(a => a.name === 'flow.json');
    if (!jsonAsset) {
      console.log('No flow.json asset found for', targetId);
      return;
    }
    const jsonRes = await axios.get(jsonAsset.download_url);
    const flowJson = typeof jsonRes.data === 'string' ? JSON.parse(jsonRes.data) : jsonRes.data;

    console.log('Routing model:');
    console.log(JSON.stringify(flowJson.routing_model, null, 2));
    console.log('\nScreen ids:');
    flowJson.screens.forEach(s => console.log(' -', s.id, '(terminal:', !!s.terminal, ')'));
    console.log('\nTRACK_ORDER screen present:', flowJson.screens.some(s => s.id === 'TRACK_ORDER'));
    console.log('MY_CART screen present:', flowJson.screens.some(s => s.id === 'MY_CART'));
  } catch (err) {
    console.error('Error fetching JSON:', err.response?.data || err.message);
  }
}

main().catch(err => {
  console.error('FAILED:', err.response?.data || err.message);
  process.exit(1);
});
