/**
 * Create Order Actions Flow
 * 
 * Shown after order confirmation (pickup/COD). Provides quick actions:
 * Track Order, Cancel Order, Order Food, Main Menu.
 * Uses data_exchange for dynamic screen navigation.
 * 
 * Usage: node create-order-actions-flow.js
 */

require('dotenv').config();
const logger = require('./services/logger');

function buildOrderActionsFlowJSON() {
  return {
    version: '7.3',
    data_api_version: '3.0',
    routing_model: {
      ORDER_ACTIONS: ['ORDER_STATUS', 'MENU_CATEGORIES'],
      ORDER_STATUS: [],
      MENU_CATEGORIES: []
    },
    screens: [
      // Screen 1: Order Actions (initial)
      {
        id: 'ORDER_ACTIONS',
        title: 'Order Details',
        data: {
          actions: {
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
              { id: 'track_order', title: 'Track Order', description: 'View order status', image: 'iVBORw0KGgo' },
              { id: 'cancel_order', title: 'Cancel Order', description: 'Cancel this order', image: 'iVBORw0KGgo' },
              { id: 'order_food', title: 'Order Food', description: 'Browse menu', image: 'iVBORw0KGgo' },
              { id: 'main_menu', title: 'Main Menu', description: 'Go to main menu', image: 'iVBORw0KGgo' }
            ]
          },
          order_info: {
            type: 'string',
            __example__: '📦 Order #JRB001\n💰 Total: ₹350\n🍽️ Service: pickup'
          },
          flow_token: {
            type: 'string',
            __example__: 'order_actions_919999999999_ORD001'
          }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextBody',
              text: '${data.order_info}'
            },
            {
              type: 'TextSubheading',
              text: 'What would you like to do?'
            },
            {
              type: 'RadioButtonsGroup',
              name: 'selected_action',
              label: 'Choose an option',
              required: true,
              'data-source': '${data.actions}'
            },
            {
              type: 'Footer',
              label: 'Continue',
              'on-click-action': {
                name: 'data_exchange',
                payload: {
                  selected_action: '${form.selected_action}',
                  flow_token: '${data.flow_token}'
                }
              }
            }
          ]
        }
      },
      // Screen 2: Order Status (track order)
      {
        id: 'ORDER_STATUS',
        title: 'Order Status',
        terminal: true,
        success: true,
        data: {
          status_image: { type: 'string', __example__: 'iVBORw0KGgo' },
          has_status_image: { type: 'boolean', __example__: true },
          order_heading: { type: 'string', __example__: 'Order #JRB001' },
          order_info: { type: 'string', __example__: '📋 Status: ⏳ Pending\n🍽️ Service: pickup' },
          has_tracking_info: { type: 'boolean', __example__: false },
          tracking_info: { type: 'string', __example__: '10:30 am — ✅ Confirmed' },
          order_items: {
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
              { id: 'item1', title: 'Chicken Biryani x2', description: '₹250 each', image: 'iVBORw0KGgo' }
            ]
          },
          order_total: { type: 'string', __example__: '💰 Total: ₹500' },
          flow_token: { type: 'string', __example__: 'order_actions_919999999999_ORD001' }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Image',
              src: '${data.status_image}',
              width: 200,
              height: 200,
              'scale-type': 'contain',
              'alt-text': 'Order Status',
              visible: '${data.has_status_image}'
            },
            { type: 'TextHeading', text: '${data.order_heading}' },
            { type: 'TextBody', text: '${data.order_info}' },
            {
              type: 'TextSubheading',
              text: '📍 Order Timeline',
              visible: '${data.has_tracking_info}'
            },
            {
              type: 'TextCaption',
              text: '${data.tracking_info}',
              visible: '${data.has_tracking_info}'
            },
            {
              type: 'TextSubheading',
              text: '🛒 Items'
            },
            {
              type: 'RadioButtonsGroup',
              name: 'selected_item',
              label: 'Order Items',
              required: false,
              'data-source': '${data.order_items}'
            },
            { type: 'TextBody', text: '${data.order_total}' },
            {
              type: 'Footer',
              label: 'Close',
              'on-click-action': {
                name: 'complete',
                payload: {
                  action_result: 'track_order',
                  flow_token: '${data.flow_token}'
                }
              }
            }
          ]
        }
      },
      // Screen 3: Menu Categories (order food)
      // (Cancel Order does NOT have a screen — the data_exchange endpoint
      // returns screen: 'SUCCESS' and the chat carries the rich
      // confirmation card with a Browse Menu reorder Flow CTA.)
      {
        id: 'MENU_CATEGORIES',
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
              { id: 'cat_0', title: 'Ice Creams', description: '2 variants', image: 'iVBORw0KGgo' }
            ]
          },
          flow_token: { type: 'string', __example__: 'order_actions_919999999999_ORD001' }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
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
                  action_result: 'order_food',
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

async function createOrderActionsFlow() {
  try {
    const metaCloud = require('./services/metaCloud');
    const backendUrl = process.env.BACKEND_URL;
    const endpointUri = `${backendUrl}/api/whatsapp-flow`;

    const FLOW_NAME = 'JRB Order Actions v3';
    logger.info('Creating Order Actions flow...', { name: FLOW_NAME });

    const createResult = await metaCloud.createFlow(FLOW_NAME, ['OTHER'], { endpointUri });
    const flowId = createResult.id;
    logger.info('Flow created', { flowId });

    const flowJson = buildOrderActionsFlowJSON();
    logger.info('Uploading Flow JSON...');
    await metaCloud.updateFlowJSON(flowId, flowJson);
    logger.info('Flow JSON uploaded');

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
      console.log(`   WHATSAPP_ORDER_ACTIONS_FLOW_ID=${flowId}`);
      console.log('═══════════════════════════════════════════════════════\n');
      return { flowId, status: 'PUBLISHED' };
    } catch (pubErr) {
      console.log('\n⚠️  FLOW CREATED AS DRAFT');
      console.log(`Flow ID:   ${flowId}`);
      console.log(`Error:     ${pubErr.response?.data?.error?.message || pubErr.message}`);
      if (pubErr.response?.data?.error?.error_data) {
        console.log(`Details:   ${JSON.stringify(pubErr.response.data.error.error_data)}`);
      }
      console.log(`\n   WHATSAPP_ORDER_ACTIONS_FLOW_ID=${flowId}\n`);
      return { flowId, status: 'DRAFT' };
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.response?.data || error.message);
    throw error;
  }
}

if (require.main === module) {
  createOrderActionsFlow().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { createOrderActionsFlow, buildOrderActionsFlowJSON };
