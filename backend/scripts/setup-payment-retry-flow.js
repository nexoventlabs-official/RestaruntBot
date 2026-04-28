/**
 * Create + publish the Payment Retry Flow.
 *
 * Run from backend folder:    node scripts/setup-payment-retry-flow.js
 *
 * Effect:
 *   - Reuses an existing PUBLISHED "JRB Payment Retry" flow if one exists
 *   - Otherwise creates a new flow, uploads the JSON, and publishes it
 *   - Prints the NEW Flow ID — copy this into:
 *        - backend/.env  →  WHATSAPP_PAYMENT_RETRY_FLOW_ID=<id>
 *        - Render env vars (same key)
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  let exitCode = 0;
  try {
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI is not set in .env — cannot fetch chatbot images');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('  ✓ connected');

    const catalogService = require('../services/catalogService');

    console.log('\nCurrent Flow ID (from .env):', process.env.WHATSAPP_PAYMENT_RETRY_FLOW_ID || '(none)');
    console.log('Setting up Payment Retry flow...\n');

    const result = await catalogService.setupPaymentRetryFlow();

    console.log('═══════════════════════════════════════════════════════');
    console.log('  SETUP RESULT');
    console.log('═══════════════════════════════════════════════════════');
    console.log(JSON.stringify(result, null, 2));
    console.log('═══════════════════════════════════════════════════════\n');

    if (result.flowId) {
      console.log('✅ Flow ID:', result.flowId);
      console.log('\n⚠️  ACTION REQUIRED:');
      console.log('   1. Add to backend/.env:');
      console.log(`        WHATSAPP_PAYMENT_RETRY_FLOW_ID=${result.flowId}`);
      console.log('   2. Add the same env var to Render and restart the service.');
      if (result.status === 'created_as_draft') {
        console.log('   3. ⚠️  Flow was created as DRAFT — fix validation in Meta Console and publish manually.');
      }
    }
  } catch (err) {
    console.error('\n❌ SETUP FAILED');
    console.error('Error:', err.response?.data || err.message);
    if (err.response?.data?.error?.error_data?.details) {
      console.error('Details:', err.response.data.error.error_data.details);
    }
    exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
  process.exit(exitCode);
}

main();
