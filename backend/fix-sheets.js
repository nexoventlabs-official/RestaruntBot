/**
 * Fix Google Sheets data and headers
 * Run once to correct column alignment and update formats
 */

require('dotenv').config();
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Correct 13-column header structure for order sheets
const ORDER_HEADERS = [
  'Order ID', 'Time', 'Phone', 'Name', 'Items', 
  'Items Total', 'Delivery', 'Total', 
  'Payment Method', 'Payment Status', 'Order Status', 
  'Address', 'Delivery Partner'
];

// Daily reports headers (horizontal date-based format)
const DAILY_REPORTS_HEADERS = [
  'Date', 'Revenue', 'Total Orders', 'Delivered', 'Cancelled', 
  'Refunded', 'COD Orders', 'UPI Orders', 'Items Sold', 'Top Items', 'Top Categories'
];

// Dashboard stats structure
const DASHBOARD_METRICS = [
  { metric: 'Total Orders', notes: 'Lifetime total' },
  { metric: 'Total Revenue', notes: 'Lifetime total' },
  { metric: 'Total Customers', notes: 'Lifetime total' },
  { metric: 'Today Orders', notes: 'Resets daily at midnight' },
  { metric: 'Today Revenue', notes: 'Resets daily at midnight' },
  { metric: 'Today Date', notes: 'Current tracking date' }
];

async function getAuth() {
  const keyData = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const credentials = JSON.parse(keyData);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

async function getSheetId(sheets, sheetName) {
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = response.data.sheets.find(s => 
    s.properties.title.toLowerCase() === sheetName.toLowerCase()
  );
  return sheet ? sheet.properties.sheetId : null;
}

async function fixOrderSheetHeaders(sheets, sheetName) {
  console.log(`\n📝 Fixing headers for ${sheetName}...`);
  
  const sheetId = await getSheetId(sheets, sheetName);
  if (!sheetId && sheetId !== 0) {
    console.log(`  ⚠️ Sheet ${sheetName} not found`);
    return;
  }
  
  // Get current data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:M1`
  });
  
  const currentHeaders = response.data.values?.[0] || [];
  console.log(`  Current headers: ${currentHeaders.join(' | ')}`);
  
  // Update headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:M1`,
    valueInputOption: 'RAW',
    resource: { values: [ORDER_HEADERS] }
  });
  
  // Style header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 13 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.6, green: 0.2, blue: 0.2 },
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      }]
    }
  });
  
  console.log(`  ✅ Headers fixed for ${sheetName}`);
}

async function fixDailyReportsSheet(sheets) {
  console.log('\n📊 Fixing daily_reports sheet...');
  
  const sheetId = await getSheetId(sheets, 'daily_reports');
  if (!sheetId && sheetId !== 0) {
    console.log('  ⚠️ daily_reports sheet not found');
    return;
  }
  
  // Clear existing data and set proper headers
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'daily_reports!A:Z'
  });
  
  // Set headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'daily_reports!A1:K1',
    valueInputOption: 'RAW',
    resource: { values: [DAILY_REPORTS_HEADERS] }
  });
  
  // Style header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.4, green: 0.2, blue: 0.6 },
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      }]
    }
  });
  
  console.log('  ✅ daily_reports headers fixed');
}

async function fixDashboardStatsSheet(sheets) {
  console.log('\n📈 Fixing dashboard_stats sheet...');
  
  const sheetId = await getSheetId(sheets, 'dashboard_stats');
  if (!sheetId && sheetId !== 0) {
    console.log('  ⚠️ dashboard_stats sheet not found');
    return;
  }
  
  // Set proper headers
  const headers = ['Metric', 'Value', 'Last Updated', 'Notes'];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'dashboard_stats!A1:D1',
    valueInputOption: 'RAW',
    resource: { values: [headers] }
  });
  
  // Set up default metrics with current values
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  const metricsData = DASHBOARD_METRICS.map(m => [m.metric, '0', now, m.notes]);
  metricsData[5][1] = today; // Today Date row gets today's date
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'dashboard_stats!A2:D7',
    valueInputOption: 'RAW',
    resource: { values: metricsData }
  });
  
  // Style header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.1, green: 0.3, blue: 0.5 },
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      }]
    }
  });
  
  console.log('  ✅ dashboard_stats headers and metrics fixed');
}

async function fixMisalignedOrderData(sheets, sheetName) {
  console.log(`\n🔧 Checking ${sheetName} for misaligned data...`);
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:M`
  });
  
  const rows = response.data.values || [];
  let fixedCount = 0;
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || row[0].startsWith('📅') || row[0] === 'Order ID') continue;
    
    // Check if columns are misaligned (e.g., PaymentMethod in wrong column)
    // If column 7 (Total) contains text like "Paid" or "Pending", data is misaligned
    const col7 = row[7] || '';
    const col8 = row[8] || '';
    
    // Check for 11-column to 13-column migration issue
    // Old: OrderID, Time, Phone, Name, Items, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner
    // New: OrderID, Time, Phone, Name, Items, ItemsTotal, Delivery, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner
    
    if (col7.toString().includes('Paid') || col7.toString().includes('Pending') || 
        col7.toString().includes('Cancelled') || col8.toString().includes('Picked') ||
        col8.toString().includes('Completed') || col8.toString().includes('Delivered')) {
      console.log(`  Row ${i + 1}: Misaligned - ${row[0]}`);
      
      // This is old 11-column data shifted to 13 columns
      // Need to fix: ItemsTotal should be Total, insert 0 for Delivery
      const fixedRow = [
        row[0],  // OrderID
        row[1],  // Time
        row[2],  // Phone
        row[3],  // Name
        row[4],  // Items
        row[5] || row[7] || 0,  // ItemsTotal (use existing or total)
        0,       // Delivery (insert 0)
        row[5] || row[7] || 0,  // Total
        row[6] || row[8] || '',  // PaymentMethod
        row[7] || row[9] || '',  // PaymentStatus
        row[8] || row[10] || '', // OrderStatus
        row[9] || row[11] || '', // Address
        row[10] || row[12] || '' // DeliveryPartner
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A${i + 1}:M${i + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [fixedRow] }
      });
      fixedCount++;
    }
  }
  
  if (fixedCount > 0) {
    console.log(`  ✅ Fixed ${fixedCount} misaligned rows in ${sheetName}`);
  } else {
    console.log(`  ✅ No misaligned data found in ${sheetName}`);
  }
}

async function main() {
  console.log('🔧 Google Sheets Fix Script');
  console.log('============================');
  
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Fix order sheet headers
  await fixOrderSheetHeaders(sheets, 'neworders');
  await fixOrderSheetHeaders(sheets, 'delivered');
  await fixOrderSheetHeaders(sheets, 'selfpick');
  await fixOrderSheetHeaders(sheets, 'cancelled');
  
  // Fix misaligned order data
  await fixMisalignedOrderData(sheets, 'selfpick');
  await fixMisalignedOrderData(sheets, 'cancelled');
  await fixMisalignedOrderData(sheets, 'delivered');
  
  // Fix daily_reports and dashboard_stats
  await fixDailyReportsSheet(sheets);
  await fixDashboardStatsSheet(sheets);
  
  console.log('\n✅ All sheets fixed successfully!');
  console.log('\n📋 Correct column structure for order sheets:');
  console.log(ORDER_HEADERS.map((h, i) => `   ${String.fromCharCode(65 + i)}: ${h}`).join('\n'));
}

main().catch(console.error);
