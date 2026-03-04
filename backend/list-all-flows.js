/**
 * List All WhatsApp Flows
 * 
 * This script lists all WhatsApp Flows in your Meta Business account.
 * Helps you identify flow IDs and their current status.
 * 
 * Usage: node list-all-flows.js
 */

require('dotenv').config();
const logger = require('./services/logger');

async function listAllFlows() {
  try {
    logger.info('Fetching all flows from Meta...');
    
    const metaCloud = require('./services/metaCloud');
    const flows = await metaCloud.getFlows();
    
    console.log('\n📋 ALL WHATSAPP FLOWS');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Total Flows: ${flows.length}\n`);
    
    if (flows.length === 0) {
      console.log('No flows found in your account.');
      console.log('═══════════════════════════════════════════════════════\n');
      return [];
    }
    
    // Group flows by name prefix
    const welcomeFlows = flows.filter(f => f.name.startsWith('JRB Welcome Services'));
    const orderFlows = flows.filter(f => f.name.startsWith('JRB Order Food'));
    const otherFlows = flows.filter(f => 
      !f.name.startsWith('JRB Welcome Services') && 
      !f.name.startsWith('JRB Order Food')
    );
    
    // Display Welcome Flows
    if (welcomeFlows.length > 0) {
      console.log('🏨 WELCOME SERVICE FLOWS:');
      console.log('───────────────────────────────────────────────────────');
      welcomeFlows.forEach((flow, idx) => {
        const isCurrent = flow.id === process.env.WHATSAPP_WELCOME_FLOW_ID;
        const marker = isCurrent ? '👉' : '  ';
        console.log(`${marker} ${idx + 1}. ${flow.name}`);
        console.log(`     ID: ${flow.id}`);
        console.log(`     Status: ${flow.status}`);
        console.log(`     Categories: ${flow.categories?.join(', ') || 'N/A'}`);
        if (isCurrent) console.log('     ⭐ Currently Active in .env');
        console.log('');
      });
    }
    
    // Display Order Flows
    if (orderFlows.length > 0) {
      console.log('🍽️  ORDER FOOD FLOWS:');
      console.log('───────────────────────────────────────────────────────');
      orderFlows.forEach((flow, idx) => {
        const isCurrent = flow.id === process.env.WHATSAPP_ORDER_FLOW_ID;
        const marker = isCurrent ? '👉' : '  ';
        console.log(`${marker} ${idx + 1}. ${flow.name}`);
        console.log(`     ID: ${flow.id}`);
        console.log(`     Status: ${flow.status}`);
        console.log(`     Categories: ${flow.categories?.join(', ') || 'N/A'}`);
        if (isCurrent) console.log('     ⭐ Currently Active in .env');
        console.log('');
      });
    }
    
    // Display Other Flows
    if (otherFlows.length > 0) {
      console.log('📦 OTHER FLOWS:');
      console.log('───────────────────────────────────────────────────────');
      otherFlows.forEach((flow, idx) => {
        console.log(`   ${idx + 1}. ${flow.name}`);
        console.log(`     ID: ${flow.id}`);
        console.log(`     Status: ${flow.status}`);
        console.log(`     Categories: ${flow.categories?.join(', ') || 'N/A'}`);
        console.log('');
      });
    }
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n💡 TIPS:');
    console.log('  • To backup a flow: node backup-welcome-flow.js FLOW_ID');
    console.log('  • To create new v50: node create-welcome-flow-v50.js');
    console.log('  • To deprecate old flows: Use Meta Business Manager');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Summary
    const publishedCount = flows.filter(f => f.status === 'PUBLISHED').length;
    const draftCount = flows.filter(f => f.status === 'DRAFT').length;
    const deprecatedCount = flows.filter(f => f.status === 'DEPRECATED').length;
    
    console.log('📊 SUMMARY:');
    console.log(`  Published: ${publishedCount}`);
    console.log(`  Draft: ${draftCount}`);
    console.log(`  Deprecated: ${deprecatedCount}`);
    console.log('');
    
    logger.info('Flow listing completed', { 
      total: flows.length, 
      published: publishedCount,
      draft: draftCount,
      deprecated: deprecatedCount
    });
    
    return flows;
    
  } catch (error) {
    logger.error('Failed to list flows', {
      error: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    
    console.error('\n❌ ERROR');
    console.error('═══════════════════════════════════════════════════════');
    console.error('Failed to fetch flows from Meta');
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('Meta API Response:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('═══════════════════════════════════════════════════════\n');
    
    throw error;
  }
}

// Run the script
if (require.main === module) {
  listAllFlows()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { listAllFlows };
