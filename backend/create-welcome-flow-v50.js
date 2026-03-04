/**
 * Create Welcome Service Flow v50
 * 
 * This script creates a new version (v50) of the JRB Welcome Services Flow in Meta.
 * Use this when the Flow JSON was accidentally corrupted in Meta's interface.
 * 
 * Usage: node create-welcome-flow-v50.js
 */

require('dotenv').config();
const logger = require('./services/logger');

async function createWelcomeFlowV50() {
  try {
    logger.info('Starting Welcome Flow v50 creation...');

    const metaCloud = require('./services/metaCloud');
    const catalogService = require('./services/catalogService');
    const chatbotImagesService = require('./services/chatbotImages');

    // Step 1: Create the Flow with version 51
    const FLOW_NAME = 'JRB Welcome Services v51';
    logger.info('Creating flow...', { name: FLOW_NAME });
    
    const createResult = await metaCloud.createFlow(FLOW_NAME, ['OTHER']);
    const flowId = createResult.id;
    logger.info('Flow created successfully', { flowId, name: FLOW_NAME });

    // Step 2: Fetch banner image and convert to raw base64
    logger.info('Fetching banner image...');
    const bannerUrl = await chatbotImagesService.getImageUrl('flow_welcome_banner');
    const bannerBase64 = await catalogService._imageUrlToRawBase64(bannerUrl);
    
    if (bannerBase64) {
      logger.info('Banner image converted to base64', { length: bannerBase64.length });
    } else {
      logger.warn('Banner image not available, creating flow without banner');
    }

    // Step 3: Build the Flow JSON
    logger.info('Building Flow JSON...');
    const flowJson = catalogService.buildWelcomeFlowJSON(bannerBase64);
    
    // Log the structure for verification
    logger.info('Flow JSON structure', {
      version: flowJson.version,
      screenCount: flowJson.screens.length,
      screens: flowJson.screens.map(s => ({ id: s.id, title: s.title }))
    });

    // Step 4: Upload the Flow JSON to Meta
    logger.info('Uploading Flow JSON to Meta...');
    await metaCloud.updateFlowJSON(flowId, flowJson);
    logger.info('Flow JSON uploaded successfully');

    // Step 5: Publish the Flow
    logger.info('Publishing flow...');
    try {
      await metaCloud.publishFlow(flowId);
      logger.info('✅ Flow published successfully!', { flowId, name: FLOW_NAME });
      
      // Update environment variables
      process.env.WHATSAPP_WELCOME_FLOW_ID = flowId;
      process.env.WHATSAPP_WELCOME_FLOW_STATUS = 'PUBLISHED';
      
      console.log('\n✅ SUCCESS!');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`Flow Name: ${FLOW_NAME}`);
      console.log(`Flow ID: ${flowId}`);
      console.log(`Status: PUBLISHED`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('\nNext steps:');
      console.log('1. Update your .env file with:');
      console.log(`   WHATSAPP_WELCOME_FLOW_ID=${flowId}`);
      console.log('2. Restart your backend server');
      console.log('3. Test the welcome flow by sending a message to your WhatsApp bot');
      console.log('═══════════════════════════════════════════════════════\n');
      
      return { flowId, status: 'PUBLISHED' };
      
    } catch (pubErr) {
      logger.warn('Flow created but publish failed, using draft mode', {
        error: pubErr.response?.data?.error?.message || pubErr.message,
        errorDetails: pubErr.response?.data?.error
      });
      
      process.env.WHATSAPP_WELCOME_FLOW_ID = flowId;
      process.env.WHATSAPP_WELCOME_FLOW_STATUS = 'DRAFT';
      
      console.log('\n⚠️  FLOW CREATED AS DRAFT');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`Flow Name: ${FLOW_NAME}`);
      console.log(`Flow ID: ${flowId}`);
      console.log(`Status: DRAFT`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('\nThe flow was created but could not be published automatically.');
      console.log('This usually happens due to validation errors.');
      console.log('\nNext steps:');
      console.log('1. Go to Meta Business Manager > WhatsApp Flows');
      console.log('2. Find "JRB Welcome Services v50"');
      console.log('3. Review any validation errors');
      console.log('4. Fix the errors and publish manually');
      console.log('5. Update your .env file with:');
      console.log(`   WHATSAPP_WELCOME_FLOW_ID=${flowId}`);
      console.log('═══════════════════════════════════════════════════════\n');
      
      return { flowId, status: 'DRAFT', error: pubErr.message };
    }

  } catch (error) {
    logger.error('Failed to create Welcome Flow v50', {
      error: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    
    console.error('\n❌ ERROR');
    console.error('═══════════════════════════════════════════════════════');
    console.error('Failed to create Welcome Flow v50');
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
  createWelcomeFlowV50()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed', { error: error.message });
      process.exit(1);
    });
}

module.exports = { createWelcomeFlowV50 };
