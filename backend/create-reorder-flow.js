/**
 * Create Reorder Flow
 * 
 * A standalone flow for the "New Order" button shown after payment timeout cancellation.
 * Shows menu categories with images (like the welcome flow's MENU_CATEGORIES screen).
 * Uses data_exchange so the flow endpoint populates categories dynamically.
 * 
 * Usage: node create-reorder-flow.js
 */

require('dotenv').config();
const logger = require('./services/logger');

function buildReorderFlowJSON() {
  return {
    version: '7.3',
    data_api_version: '3.0',
    routing_model: {
      CATEGORY_SELECT: []
    },
    screens: [
      {
        id: 'CATEGORY_SELECT',
        title: 'Menu Items',
        terminal: true,
        success: true,
        data: {
          categories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                image: { type: 'string' }
              }
            },
            __example__: [
              { id: 'cat_0', title: 'Ice Creams', description: '2 variants available', image: 'iVBORw0KGgo' }
            ]
          },
          menu_banner: {
            type: 'string',
            __example__: 'iVBORw0KGgo'
          },
          flow_token: {
            type: 'string',
            __example__: 'reorder_919999999999'
          }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Image',
              src: '${data.menu_banner}',
              width: 1000,
              height: 125,
              'scale-type': 'cover',
              'alt-text': 'Menu Banner'
            },
            {
              type: 'TextSubheading',
              text: 'Select a Category'
            },
            {
              type: 'RadioButtonsGroup',
              name: 'selected_category',
              label: 'Menu Items',
              required: true,
              'data-source': '${data.categories}'
            },
            {
              type: 'Footer',
              label: 'View Item',
              'on-click-action': {
                name: 'complete',
                payload: {
                  selected_category: '${form.selected_category}',
                  flow_token: '${data.flow_token}'
                }
              }
            }
          ]
        }
      }
    ]
  };
}

async function createReorderFlow() {
  try {
    const metaCloud = require('./services/metaCloud');
    const backendUrl = process.env.BACKEND_URL;
    const endpointUri = `${backendUrl}/api/whatsapp-flow`;

    // Step 1: Create the Flow with endpoint URI for data_exchange
    const FLOW_NAME = 'JRB Reorder Menu v1';
    logger.info('Creating Reorder flow...', { name: FLOW_NAME });

    const createResult = await metaCloud.createFlow(FLOW_NAME, ['OTHER'], { endpointUri });
    const flowId = createResult.id;
    logger.info('Flow created', { flowId });

    // Step 2: Build and upload Flow JSON
    const flowJson = buildReorderFlowJSON();
    logger.info('Uploading Flow JSON...');
    await metaCloud.updateFlowJSON(flowId, flowJson);
    logger.info('Flow JSON uploaded');

    // Step 3: Publish
    logger.info('Publishing flow...');
    try {
      await metaCloud.publishFlow(flowId);
      console.log('\n✅ SUCCESS!');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`Flow Name: ${FLOW_NAME}`);
      console.log(`Flow ID:   ${flowId}`);
      console.log(`Status:    PUBLISHED`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('\nAdd to your .env:');
      console.log(`   WHATSAPP_REORDER_FLOW_ID=${flowId}`);
      console.log('═══════════════════════════════════════════════════════\n');
      return { flowId, status: 'PUBLISHED' };
    } catch (pubErr) {
      console.log('\n⚠️  FLOW CREATED AS DRAFT');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`Flow Name: ${FLOW_NAME}`);
      console.log(`Flow ID:   ${flowId}`);
      console.log(`Status:    DRAFT`);
      console.log(`Error:     ${pubErr.response?.data?.error?.message || pubErr.message}`);
      if (pubErr.response?.data?.error?.error_data) {
        console.log(`Details:   ${JSON.stringify(pubErr.response.data.error.error_data)}`);
      }
      console.log('═══════════════════════════════════════════════════════');
      console.log('\nAdd to your .env:');
      console.log(`   WHATSAPP_REORDER_FLOW_ID=${flowId}`);
      console.log('═══════════════════════════════════════════════════════\n');
      return { flowId, status: 'DRAFT', error: pubErr.message };
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.response?.data || error.message);
    throw error;
  }
}

if (require.main === module) {
  createReorderFlow()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { createReorderFlow, buildReorderFlowJSON };
