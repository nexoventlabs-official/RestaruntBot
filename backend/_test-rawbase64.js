/**
 * Test: Raw base64 (NO data URI prefix) — matching Meta's working template format.
 * The key difference: Meta's template uses raw base64 string, NOT "data:image/png;base64,..."
 */
require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');

const TOKEN = process.env.META_ACCESS_TOKEN;
const WABA_ID = '1707609370608337';
const PHONE_ID = '1041405865715920';
const API = 'https://graph.facebook.com/v24.0';

// ---- PNG generation ----
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function createSolidPNG(w, h, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;   // RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);
  const rowSize = 1 + w * 3;
  const raw = Buffer.alloc(h * rowSize);
  for (let y = 0; y < h; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const px = off + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

async function main() {
  console.log('=== RAW BASE64 TEST (no data URI prefix) ===\n');

  // Create test images
  const bannerPNG = createSolidPNG(300, 60, 255, 140, 0);  // orange
  const iconPNG = createSolidPNG(48, 48, 0, 120, 255);     // blue

  // KEY DIFFERENCE: Raw base64 only — NO "data:image/png;base64," prefix!
  const bannerBase64 = bannerPNG.toString('base64');
  const iconBase64 = iconPNG.toString('base64');

  console.log('Banner raw base64 length:', bannerBase64.length);
  console.log('Icon raw base64 length:', iconBase64.length);
  console.log('Banner starts with:', bannerBase64.substring(0, 30) + '...');
  console.log('Icon starts with:', iconBase64.substring(0, 30) + '...');

  // Flow JSON — v7.3 with raw base64 images (no data URI prefix)
  const flowJson = {
    version: '7.3',
    screens: [
      {
        id: 'SERVICE_SELECT',
        title: 'Perivi Hotel',
        terminal: true,
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
              type: 'Form',
              name: 'service_form',
              children: [
                {
                  type: 'Image',
                  src: bannerBase64,
                  height: 108,
                  'scale-type': 'cover'
                },
                {
                  type: 'TextHeading',
                  text: 'How can we help you today?'
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
          ]
        }
      }
    ]
  };

  const jsonStr = JSON.stringify(flowJson);
  console.log('\nFlow JSON size:', jsonStr.length, 'bytes');

  try {
    // Step 1: Create flow
    console.log('\n1. Creating flow...');
    const createRes = await axios.post(`${API}/${WABA_ID}/flows`, {
      name: `Raw Base64 Test v${Date.now() % 1000}`,
      categories: ['OTHER']
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const flowId = createRes.data.id;
    console.log('   Flow ID:', flowId);

    // Step 2: Upload JSON
    console.log('\n2. Uploading flow JSON...');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', Buffer.from(jsonStr), {
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
    console.log('   Upload success:', uploadRes.data.success);

    // Step 3: Check validation
    console.log('\n3. Checking validation...');
    const flowRes = await axios.get(`${API}/${flowId}?fields=validation_errors,json_version`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const errors = flowRes.data.validation_errors || [];
    console.log('   JSON version:', flowRes.data.json_version);
    console.log('   Validation errors:', errors.length);
    if (errors.length > 0) {
      errors.forEach(e => console.log('   -', e.error, e.error_type, JSON.stringify(e.details)));
    }

    // Step 4: Publish
    console.log('\n4. Publishing...');
    await axios.post(`${API}/${flowId}/publish`, {}, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('   ✅ Flow', flowId, 'published!');

    // Step 5: Send to phone
    console.log('\n5. Sending to phone...');
    const msgRes = await axios.post(`${API}/${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: '919390832710',
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: '🧪 Raw Base64 Test — images should now render!' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            flow_cta: 'Open Test Flow',
            mode: 'published',
            flow_action: 'navigate',
            flow_action_payload: {
              screen: 'SERVICE_SELECT',
              data: {
                services: [
                  { id: 'order_food', title: 'Order Food', description: 'Browse menu', image: iconBase64 },
                  { id: 'my_orders', title: 'My Orders', description: 'Track delivery', image: iconBase64 }
                ],
                flow_token: 'test_raw_base64'
              }
            }
          }
        }
      }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('   Message sent! ID:', msgRes.data.messages?.[0]?.id);

    console.log('\n✅ DONE — Check WhatsApp for the flow with raw base64 images!');
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    if (err.response?.data?.error?.error_data?.details) {
      console.error('Details:', err.response.data.error.error_data.details);
    }
  }
}

main();
