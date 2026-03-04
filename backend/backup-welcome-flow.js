/**
 * Backup Welcome Flow JSON
 * 
 * This script fetches the current Welcome Flow JSON from Meta and saves it locally.
 * Useful for backing up before making changes or debugging flow issues.
 * 
 * Usage: node backup-welcome-flow.js [flowId]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('./services/logger');

async function backupWelcomeFlow(flowId) {
  try {
    const metaCloud = require('./services/metaCloud');
    
    // Use provided flowId or get from environment
    const targetFlowId = flowId || process.env.WHATSAPP_WELCOME_FLOW_ID;
    
    if (!targetFlowId) {
      console.error('❌ No Flow ID provided. Either:');
      console.error('   1. Pass flow ID as argument: node backup-welcome-flow.js YOUR_FLOW_ID');
      console.error('   2. Set WHATSAPP_WELCOME_FLOW_ID in .env file');
      process.exit(1);
    }

    logger.info('Fetching flow details...', { flowId: targetFlowId });
    
    // Get flow details
    const flowDetails = await metaCloud.getFlowDetails(targetFlowId);
    
    // Get flow JSON
    const flowJson = await metaCloud.getFlowJSON(targetFlowId);
    
    // Create backups directory if it doesn't exist
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `welcome-flow-${flowDetails.name.replace(/\s+/g, '-')}-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);
    
    // Save backup
    const backup = {
      flowId: targetFlowId,
      name: flowDetails.name,
      status: flowDetails.status,
      categories: flowDetails.categories,
      backedUpAt: new Date().toISOString(),
      flowJson: flowJson
    };
    
    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
    
    console.log('\n✅ BACKUP SUCCESSFUL');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Flow Name: ${flowDetails.name}`);
    console.log(`Flow ID: ${targetFlowId}`);
    console.log(`Status: ${flowDetails.status}`);
    console.log(`Saved to: ${filepath}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nFlow Structure:');
    console.log(`  Version: ${flowJson.version}`);
    console.log(`  Screens: ${flowJson.screens?.length || 0}`);
    if (flowJson.screens) {
      flowJson.screens.forEach((screen, idx) => {
        console.log(`    ${idx + 1}. ${screen.id} - ${screen.title}`);
      });
    }
    console.log('═══════════════════════════════════════════════════════\n');
    
    logger.info('Flow backup completed', { filepath, flowId: targetFlowId });
    
    return { filepath, flowDetails, flowJson };
    
  } catch (error) {
    logger.error('Failed to backup flow', {
      error: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    
    console.error('\n❌ BACKUP FAILED');
    console.error('═══════════════════════════════════════════════════════');
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
  const flowId = process.argv[2]; // Get flow ID from command line argument
  
  backupWelcomeFlow(flowId)
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { backupWelcomeFlow };
