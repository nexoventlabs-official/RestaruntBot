/**
 * One-shot script to republish the Welcome Flow with the new
 * "Track Order" screen (replaces "My Cart").
 *
 * Run from backend folder:    node scripts/republish-welcome-track-order.js
 *
 * Effect:
 *   - Deprecates all currently-PUBLISHED "JRB Welcome Services" flows
 *   - Creates a new published flow version with the updated JSON
 *   - Prints the NEW Flow ID for the operator to put into Render's env vars
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

    console.log('\nCurrent Flow ID (from .env):', process.env.WHATSAPP_WELCOME_FLOW_ID || '(none)');
    console.log('Republishing welcome flow...\n');

    const result = await catalogService.republishWelcomeFlow();

    console.log('═══════════════════════════════════════════════════════');
    console.log('  REPUBLISH RESULT');
    console.log('═══════════════════════════════════════════════════════');
    console.log(JSON.stringify(result, null, 2));
    console.log('═══════════════════════════════════════════════════════\n');

    if (result.flowId) {
      console.log('✅ NEW Flow ID:', result.flowId);
      console.log('\n⚠️  ACTION REQUIRED:');
      console.log('   1. Update Render env var:');
      console.log(`        WHATSAPP_WELCOME_FLOW_ID=${result.flowId}`);
      console.log('   2. Restart the Render service (or it auto-restarts on env var change).');
      console.log('   3. Old flow ID has been deprecated — old "Welcome to ..." messages in user chats will no longer open.');
    }
  } catch (err) {
    console.error('\n❌ REPUBLISH FAILED');
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
