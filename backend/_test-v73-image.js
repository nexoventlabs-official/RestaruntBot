/**
 * Test: Create a WhatsApp Flow with v7.3 and embedded base64 PNG image.
 * Previous attempts used v6.3 — docs examples all use v7.3.
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.META_ACCESS_TOKEN;
const WABA_ID = '1707609370608337';
const PHONE_ID = '1041405865715920';
const API = 'https://graph.facebook.com/v24.0';

// Create a simple 200x40 red/orange gradient banner PNG as base64
function createTestBannerBase64() {
  // Use a hardcoded known-good tiny PNG instead of canvas
  // This is a 30x6 solid orange PNG
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAGCAIAAABJgmMcAAAAG0lEQVR4nGP8z8DAwMDAxEAEYBo1' +
    'atSoUaPIBgAVjgCBpjFCpgAAAABJRU5ErkJggg==',
    'base64'
  );
  return 'data:image/png;base64,' + pngBuffer.toString('base64');
}

// Tiny 16x16 orange square icon
function createTestIconBase64() {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP8z8DAwMDAxEAUYBo1' +
    'atQosgEAD2QAgTBHMbIAAAAASUVORK5CYII=',
    'base64'
  );
  return 'data:image/png;base64,' + pngBuffer.toString('base64');
}

async function main() {
  const bannerBase64 = createTestBannerBase64();
  const iconBase64 = createTestIconBase64();
  
  console.log('Banner base64 length:', bannerBase64.length);
  console.log('Icon base64 length:', iconBase64.length);

  // Flow JSON v7.3 with Image component
  const flowJson = {
    version: '7.3',
    screens: [
      {
        id: 'SERVICE_SELECT',
        title: 'Perivi Hotel',
        terminal: true,
        success: true,
        data: {
          services: {
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
              { id: 'order_food', title: 'Order Food', description: 'Browse our menu', image: iconBase64 },
              { id: 'my_orders', title: 'My Orders', description: 'Track delivery', image: iconBase64 }
            ]
          },
          flow_token: {
            type: 'string',
            __example__: 'welcome_service'
          }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Image',
              src: bannerBase64,
              width: 200,
              height: 40,
              'scale-type': 'contain',
              'alt-text': 'Welcome Banner'
            },
            {
              type: 'TextHeading',
              text: '🍽️ How can we help you today?'
            },
            {
              type: 'TextBody',
              text: 'Choose a service to get started.'
            },
            {
              type: 'Dropdown',
              name: 'selected_service',
              label: 'Select a Service',
              required: true,
              'data-source': '${data.services}'
            },
            {
              type: 'Footer',
              label: 'Continue',
              'on-click-action': {
                name: 'complete',
                payload: {
                  selected_service: '${form.selected_service}',
                  flow_token: '${data.flow_token}'
                }
              }
            }
          ]
        }
      }
    ]
  };

  try {
    // Step 1: Create flow
    console.log('\n1. Creating flow...');
    const createRes = await axios.post(`${API}/${WABA_ID}/flows`, {
      name: 'v7.3 Image Test v1',
      categories: ['OTHER']
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const flowId = createRes.data.id;
    console.log('Flow ID:', flowId);

    // Step 2: Upload JSON
    console.log('\n2. Uploading flow JSON (v7.3)...');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', Buffer.from(JSON.stringify(flowJson)), {
      filename: 'flow.json',
      contentType: 'application/json'
    });
    form.append('name', 'flow.json');
    form.append('asset_type', 'FLOW_JSON');
    
    const uploadRes = await axios.post(`${API}/${flowId}/assets`, form, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...form.getHeaders()
      }
    });
    console.log('Upload result:', JSON.stringify(uploadRes.data));

    // Step 3: Check validation
    console.log('\n3. Checking validation...');
    const checkRes = await axios.get(`${API}/${flowId}`, {
      params: { fields: 'name,status,json_version,validation_errors' },
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Status:', checkRes.data.status);
    console.log('Version:', checkRes.data.json_version);
    console.log('Validation errors:', JSON.stringify(checkRes.data.validation_errors));

    if (checkRes.data.validation_errors && checkRes.data.validation_errors.length > 0) {
      console.log('\n❌ Validation errors found, cannot publish.');
      process.exit(1);
    }

    // Step 4: Publish
    console.log('\n4. Publishing...');
    const pubRes = await axios.post(`${API}/${flowId}/publish`, {}, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Published:', JSON.stringify(pubRes.data));

    // Step 5: Send test message
    console.log('\n5. Sending test message to 919390832710...');
    const msgRes = await axios.post(`${API}/${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: '919390832710',
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: '🍽️ Perivi Hotel' },
        body: { text: 'Welcome! Tap below to explore our services.' },
        footer: { text: 'Powered by Perivi' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            mode: 'published',
            flow_cta: 'View Services',
            flow_action: 'navigate',
            flow_action_payload: {
              screen: 'SERVICE_SELECT',
              data: {
                services: [
                  { id: 'order_food', title: 'Order Food', description: 'Browse our menu and place an order', image: iconBase64 },
                  { id: 'my_orders', title: 'My Orders', description: 'Check order status & track delivery', image: iconBase64 }
                ],
                flow_token: 'test_v73'
              }
            }
          }
        }
      }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('Message sent:', JSON.stringify(msgRes.data));

    console.log(`\n✅ Done! Flow ${flowId} published with v7.3 + Image component`);
    console.log('Check your phone for the test message.');

  } catch (err) {
    console.error('\n❌ Error:', err.response?.data?.error?.message || err.message);
    if (err.response?.data) {
      console.error('Full error:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
