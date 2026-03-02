/**
 * Test #2: Properly generated PNGs using Node.js zlib + CRC32.
 * Creates real valid PNG files with visible colors, larger size.
 */
require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');

const TOKEN = process.env.META_ACCESS_TOKEN;
const WABA_ID = '1707609370608337';
const PHONE_ID = '1041405865715920';
const API = 'https://graph.facebook.com/v24.0';

// ---- PNG generation (no external deps) ----
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
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type RGB
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = pngChunk('IHDR', ihdrData);
  
  // Build raw image data (filter byte 0 + RGB pixels per row)
  const rowSize = 1 + w * 3;
  const raw = Buffer.alloc(h * rowSize);
  for (let y = 0; y < h; y++) {
    const off = y * rowSize;
    raw[off] = 0; // no filter
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

function toDataUri(pngBuffer) {
  return 'data:image/png;base64,' + pngBuffer.toString('base64');
}

// ---- Verify PNG validity ----
function verifyPNG(buf, label) {
  const header = buf.slice(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const valid = header.equals(expected);
  console.log(`  ${label}: ${buf.length} bytes, PNG header valid: ${valid}`);
  return valid;
}

async function main() {
  // Create visible test images
  console.log('Creating test PNGs...');
  
  // Banner: 300x60 bright orange
  const bannerPNG = createSolidPNG(300, 60, 255, 140, 0);
  const bannerDataUri = toDataUri(bannerPNG);
  
  // Icon: 48x48 bright blue
  const iconPNG = createSolidPNG(48, 48, 0, 120, 255);
  const iconDataUri = toDataUri(iconPNG);
  
  verifyPNG(bannerPNG, 'Banner 300x60');
  verifyPNG(iconPNG, 'Icon 48x48');
  console.log('  Banner data URI length:', bannerDataUri.length);
  console.log('  Icon data URI length:', iconDataUri.length);
  
  // Also write to disk for manual verification
  const fs = require('fs');
  fs.writeFileSync('test-banner.png', bannerPNG);
  fs.writeFileSync('test-icon.png', iconPNG);
  console.log('  Written to test-banner.png and test-icon.png for verification');

  // Flow JSON v7.3 with properly generated PNGs
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
              { id: 'order_food', title: 'Order Food', description: 'Browse our menu', image: iconDataUri },
              { id: 'my_orders', title: 'My Orders', description: 'Track delivery', image: iconDataUri }
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
              src: bannerDataUri,
              width: 300,
              height: 60,
              'scale-type': 'contain',
              'alt-text': 'Welcome to Perivi Hotel'
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

  // Check JSON size
  const jsonStr = JSON.stringify(flowJson);
  console.log('\nFlow JSON size:', jsonStr.length, 'bytes');

  try {
    // Step 1: Create flow
    console.log('\n1. Creating flow...');
    const createRes = await axios.post(`${API}/${WABA_ID}/flows`, {
      name: 'Real PNG Test v1',
      categories: ['OTHER']
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const flowId = createRes.data.id;
    console.log('Flow ID:', flowId);

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
      headers: { Authorization: `Bearer ${TOKEN}`, ...form.getHeaders() }
    });
    console.log('Upload:', JSON.stringify(uploadRes.data));

    // Step 3: Check validation
    console.log('\n3. Checking validation...');
    const checkRes = await axios.get(`${API}/${flowId}`, {
      params: { fields: 'name,status,json_version,validation_errors' },
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Status:', checkRes.data.status);
    console.log('Version:', checkRes.data.json_version);
    const errors = checkRes.data.validation_errors || [];
    console.log('Validation errors:', errors.length);
    if (errors.length > 0) {
      errors.forEach(e => console.log('  -', JSON.stringify(e)));
      console.log('\n❌ Cannot publish with errors');
      process.exit(1);
    }

    // Step 4: Publish
    console.log('\n4. Publishing...');
    await axios.post(`${API}/${flowId}/publish`, {}, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Published!');

    // Step 5: Send message
    console.log('\n5. Sending test message...');
    await axios.post(`${API}/${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to: '919390832710',
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: '🍽️ Real PNG Test' },
        body: { text: 'Testing with properly generated PNG images.' },
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
              data: {
                services: [
                  { id: 'order_food', title: 'Order Food', description: 'Browse our menu', image: iconDataUri },
                  { id: 'my_orders', title: 'My Orders', description: 'Track delivery', image: iconDataUri }
                ],
                flow_token: 'test_realpng'
              }
            }
          }
        }
      }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });

    console.log(`\n✅ Flow ${flowId} published. Check phone!`);
    console.log('Also check test-banner.png and test-icon.png on disk to verify images are valid.');
    
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data?.error?.message || err.message);
    if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
    process.exit(1);
  }
}

main();
