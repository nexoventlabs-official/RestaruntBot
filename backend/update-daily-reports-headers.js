// Script to remove Refunded column from daily_reports sheet
// Usage: node update-daily-reports-headers.js
require('dotenv').config();
const { google } = require('googleapis');

// Build auth client (same as googleSheets service)
function getAuthClient() {
  try {
    const keyData = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyData) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY not set');
      return null;
    }
    const credentials = JSON.parse(keyData);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } catch (error) {
    console.error('Auth error:', error.message);
    return null;
  }
}

async function updateDailyReportsHeaders() {
  try {
    const auth = getAuthClient();
    if (!auth) {
      console.log('❌ Could not get auth client');
      return;
    }
    
    const sheets = google.sheets({ version: 'v4', auth });
    const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
    
    if (!SPREADSHEET_ID) {
      console.log('❌ GOOGLE_SHEET_ID not set');
      return;
    }
    
    console.log('🔄 Connecting to Google Sheets...');
    
    // Get all sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const dailyReportsSheet = spreadsheet.data.sheets.find(s => 
      s.properties.title.toLowerCase().includes('daily_reports') || 
      s.properties.title.toLowerCase().includes('daily reports')
    );
    
    if (!dailyReportsSheet) {
      console.log('❌ daily_reports sheet not found');
      return;
    }
    
    const sheetName = dailyReportsSheet.properties.title;
    const sheetId = dailyReportsSheet.properties.sheetId;
    
    console.log(`📊 Found sheet: ${sheetName} (ID: ${sheetId})`);
    
    // Get current headers
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:J1`
    });
    
    const headers = response.data.values?.[0] || [];
    console.log('📋 Current headers:', headers.join(' | '));
    
    // Find Refunded column index
    const refundedIndex = headers.findIndex(h => h && h.toLowerCase() === 'refunded');
    
    if (refundedIndex === -1) {
      console.log('✅ Refunded column not found - headers already updated!');
      return;
    }
    
    console.log(`🎯 Found "Refunded" at column index: ${refundedIndex} (Column ${String.fromCharCode(65 + refundedIndex)})`);
    
    // Delete the Refunded column
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'COLUMNS',
              startIndex: refundedIndex,
              endIndex: refundedIndex + 1
            }
          }
        }]
      }
    });
    
    console.log('✅ Refunded column deleted successfully!');
    
    // Verify new headers
    const newResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:I1`
    });
    console.log('📋 New headers:', (newResponse.data.values?.[0] || []).join(' | '));
    
    console.log('\n✅ Done! The daily_reports sheet now has the correct headers.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateDailyReportsHeaders();
