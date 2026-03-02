/**
 * Test #3: Static dropdown data-source with images hardcoded in Flow JSON.
 * Government flow likely uses static data, not dynamic.
 * Also testing: do images work with STATIC dropdown but not DYNAMIC?
 */
require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');

const TOKEN = process.env.META_ACCESS_TOKEN;
const WABA_ID = '1707609370608337';
const PHONE_ID = '1041405865715920';
const API = 'https://graph.facebook.com/v24.0';

// ---- Proper PNG generation ----
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
  ihdrData[8] = 8; ihdrData[9] = 2;
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);
  const rowSize = 1 + w * 3;
  const raw = Buffer.alloc(h * rowSize);
  for (let y = 0; y < h; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const px = off + 1 + x * 3;
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function toDataUri(buf) {
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function main() {
  // Create colored icons for each service
  const bannerPNG = toDataUri(createSolidPNG(500, 100, 255, 140, 0));  // orange banner
  const icon1 = toDataUri(createSolidPNG(64, 64, 220, 50, 50));       // red - Order Food
  const icon2 = toDataUri(createSolidPNG(64, 64, 50, 50, 220));       // blue - My Orders
  const icon3 = toDataUri(createSolidPNG(64, 64, 50, 180, 50));       // green - Offers

  console.log('Banner data URI length:', bannerPNG.length);
  console.log('Icon data URI length:', icon1.length);

  // KEY DIFFERENCE: Dropdown uses STATIC data-source (hardcoded in JSON)
  // Not dynamic ${data.services} — images are fully embedded in the flow itself
  const flowJson = {
    version: '7.3',
    screens: [
      {
        id: 'SERVICE_SELECT',
        title: 'Perivi Hotel',
        terminal: true,
        success: true,
        data: {
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
              src: bannerPNG,
              width: 500,
              height: 100,
              'scale-type': 'contain',
              'alt-text': 'Welcome Banner'
            },
            {
              type: 'TextHeading',
              text: '🍽️ How can we help you today?'
            },
            {
              type: 'TextBody',
              text: 'Choose a service to get started with your order.'
            },
            {
              type: 'Dropdown',
              name: 'selected_service',
              label: 'Select a Service',
              required: true,
              'data-source': [
                { id: 'order_food', title: 'Order Food', description: 'Browse our menu and place an order', image: icon1 },
                { id: 'my_orders', title: 'My Orders', description: 'Check order status & track delivery', image: icon2 },
                { id: 'view_offers', title: 'View Offers', description: 'See current deals and discounts', image: icon3 }
              ]
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

  const jsonStr = JSON.stringify(flowJson);
  console.log('Flow JSON size:', jsonStr.length, 'bytes');

  try {
    console.log('\n1. Creating flow...');
    const createRes = await axios.post(`${API}/${WABA_ID}/flows`, {
      name: 'Static Image Test v1',
      categories: ['OTHER']
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const flowId = createRes.data.id;
    console.log('Flow ID:', flowId);

    console.log('\n2. Uploading flow JSON...');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', Buffer.from(jsonStr), {
      filename: 'flow.json', contentType: 'application/json'
    });
    form.append('name', 'flow.json');
    form.append('asset_type', 'FLOW_JSON');
    const uploadRes = await axios.post(`${API}/${flowId}/assets`, form, {
      headers: { Authorization: `Bearer ${TOKEN}`, ...form.getHeaders() }
    });
    console.log('Upload:', JSON.stringify(uploadRes.data));

    console.log('\n3. Checking validation...');
    const checkRes = await axios.get(`${API}/${flowId}`, {
      params: { fields: 'name,status,json_version,validation_errors' },
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Version:', checkRes.data.json_version);
    const errors = checkRes.data.validation_errors || [];
    console.log('Errors:', errors.length);
    if (errors.length) { errors.forEach(e => console.log(' ', JSON.stringify(e))); process.exit(1); }

    console.log('\n4. Publishing...');
    await axios.post(`${API}/${flowId}/publish`, {}, { headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('Published!');

    console.log('\n5. Sending test message...');
    await axios.post(`${API}/${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: '919390832710',
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: '🧪 Static Image Test' },
        body: { text: 'Flow with STATIC dropdown items + hardcoded images. Test on PHONE APP (not WhatsApp Web).' },
        footer: { text: 'Perivi Hotel' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            mode: 'published',
            flow_cta: 'Open Flow',
            flow_action: 'navigate',
            flow_action_payload: {
              screen: 'SERVICE_SELECT',
              data: { flow_token: 'test_static_img' }
            }
          }
        }
      }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });

    console.log(`\n✅ Flow ${flowId} published!`);
    console.log('⚠️  IMPORTANT: Test on your PHONE WhatsApp app, NOT WhatsApp Web.');

  } catch (err) {
    console.error('\n❌ Error:', err.response?.data?.error?.message || err.message);
    if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
    process.exit(1);
  }
}

main();
