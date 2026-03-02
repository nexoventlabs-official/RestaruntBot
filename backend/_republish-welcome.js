/**
 * Quick script to republish the Welcome Flow with raw base64 images.
 * This deprecates the old flow (v15) and creates a new one with banner + icons.
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  try {
    // Connect to MongoDB (needed for chatbotImages service)
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const catalogService = require('./services/catalogService');

    console.log('Current flow ID:', process.env.WHATSAPP_WELCOME_FLOW_ID);
    console.log('Republishing welcome flow with raw base64 images...\n');

    const result = await catalogService.republishWelcomeFlow();
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.flowId) {
      console.log(`\nNew Flow ID: ${result.flowId}`);
      console.log('Update .env: WHATSAPP_WELCOME_FLOW_ID=' + result.flowId);
    }

    // Now send a test message to verify
    if (result.flowId && result.status === 'created_and_published') {
      console.log('\nSending test welcome flow message...');
      const axios = require('axios');
      const TOKEN = process.env.META_ACCESS_TOKEN;
      const PHONE_ID = '1041405865715920';

      // Build flow data with raw base64 icons
      const flowData = await catalogService.buildWelcomeFlowData('welcome_test_919390832710');
      console.log('Flow data services count:', flowData.services.length);
      console.log('Services with images:', flowData.services.filter(s => s.image).length);

      const msgPayload = {
        messaging_product: 'whatsapp',
        to: '919390832710',
        type: 'interactive',
        interactive: {
          type: 'flow',
          header: { type: 'text', text: '🍽️ Welcome to Perivi Hotel!' },
          body: { text: 'Tap below to explore our services.' },
          footer: { text: 'Powered by JRB' },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_id: result.flowId,
              mode: 'published',
              flow_cta: 'View Services',
              flow_action: 'navigate',
              flow_action_payload: {
                screen: 'SERVICE_SELECT',
                data: flowData
              }
            }
          }
        }
      };

      const msgRes = await axios.post(
        `https://graph.facebook.com/v24.0/${PHONE_ID}/messages`,
        msgPayload,
        { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
      );
      console.log('Message sent:', msgRes.data.messages?.[0]?.id || 'OK');
    }
  } catch (err) {
    console.error('ERROR:', err.response?.data || err.message);
    if (err.response?.data?.error?.error_data?.details) {
      console.error('DETAILS:', err.response.data.error.error_data.details);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main();
