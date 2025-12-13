const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1'; // Can be configured via env

// Status colors (RGB values 0-1)
const STATUS_COLORS = {
  pending: { red: 1, green: 0.95, blue: 0.8 },        // Light Yellow
  confirmed: { red: 0.85, green: 0.92, blue: 1 },     // Light Blue
  preparing: { red: 1, green: 0.9, blue: 0.8 },       // Light Orange
  ready: { red: 0.9, green: 0.85, blue: 1 },          // Light Purple
  out_for_delivery: { red: 0.85, green: 0.88, blue: 1 }, // Light Indigo
  delivered: { red: 0.85, green: 1, blue: 0.85 },     // Light Green
  cancelled: { red: 1, green: 0.85, blue: 0.85 },     // Light Red
  refunded: { red: 0.9, green: 0.9, blue: 0.9 }       // Light Gray
};

// Status display labels
const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'On the Way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded'
};

// Initialize Google Sheets API with Service Account
const getAuthClient = () => {
  try {
    const keyData = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyData) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY not set');
      return null;
    }
    
    const credentials = JSON.parse(keyData);
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    return auth;
  } catch (error) {
    console.error('❌ Error parsing Google credentials:', error.message);
    return null;
  }
};

const googleSheets = {
  // Initialize sheet with headers if empty
  async initializeSheet() {
    try {
      const auth = getAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:N1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        // Add headers
        const headers = [
          'Order ID', 'Date', 'Time', 'Customer Phone', 'Customer Name',
          'Items', 'Total Amount', 'Service Type', 'Payment Method', 
          'Payment Status', 'Order Status', 'Delivery Address', 
          'Latitude', 'Longitude'
        ];
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A1:N1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        
        console.log('✅ Google Sheet headers initialized');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Google Sheets init error:', error.message);
      return false;
    }
  },

  // Add new order to sheet
  async addOrder(order) {
    try {
      const auth = getAuthClient();
      if (!auth) {
        console.error('❌ Google auth not available');
        return false;
      }
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      console.log('📊 Adding order to Google Sheet:', order.orderId);
      
      const date = new Date(order.createdAt || Date.now());
      const dateStr = date.toLocaleDateString('en-IN');
      const timeStr = date.toLocaleTimeString('en-IN');
      
      // Format items as string
      const itemsStr = order.items.map(item => 
        `${item.name} x${item.quantity} (₹${item.price * item.quantity})`
      ).join(', ');
      
      const row = [
        order.orderId,
        dateStr,
        timeStr,
        order.customer?.phone || '',
        order.customer?.name || '',
        itemsStr,
        order.totalAmount,
        order.serviceType,
        (order.paymentMethod || 'upi').toUpperCase(),
        (order.paymentStatus || 'pending').charAt(0).toUpperCase() + (order.paymentStatus || 'pending').slice(1),
        STATUS_LABELS[order.status] || order.status || 'Pending',
        order.deliveryAddress?.address || '',
        order.deliveryAddress?.latitude || '',
        order.deliveryAddress?.longitude || ''
      ];
      
      console.log('📊 Row data:', row);
      
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });
      
      // Get the row number that was just added and set its color
      const updatedRange = response.data.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/!A(\d+):/);
        if (match) {
          const rowIndex = parseInt(match[1]) - 1;
          const sheetId = await this.getSheetId(sheets);
          await this.updateRowColor(sheets, sheetId, rowIndex, order.status || 'pending');
        }
      }
      
      console.log('✅ Order added to Google Sheet:', order.orderId);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets add order error:', error.message);
      console.error('❌ Full error:', error.response?.data || error);
      return false;
    }
  },

  // Get sheet ID by name
  async getSheetId(sheets) {
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
      });
      
      const sheet = response.data.sheets.find(s => s.properties.title === SHEET_NAME);
      return sheet ? sheet.properties.sheetId : 0;
    } catch (error) {
      console.error('Error getting sheet ID:', error.message);
      return 0;
    }
  },

  // Update row color based on status
  async updateRowColor(sheets, sheetId, rowIndex, status) {
    try {
      const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
      
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 0,
                endColumnIndex: 14
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: color
                }
              },
              fields: 'userEnteredFormat.backgroundColor'
            }
          }]
        }
      });
      
      console.log('✅ Row color updated for status:', status);
      return true;
    } catch (error) {
      console.error('❌ Error updating row color:', error.message);
      return false;
    }
  },

  // Get the first sheet name dynamically
  async getFirstSheetName(sheets) {
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
      });
      
      const firstSheet = response.data.sheets[0];
      return firstSheet ? firstSheet.properties.title : 'Sheet1';
    } catch (error) {
      console.error('Error getting sheet name:', error.message);
      return 'Sheet1';
    }
  },

  // Update order status in sheet
  async updateOrderStatus(orderId, status, paymentStatus = null) {
    try {
      console.log('📊 updateOrderStatus called:', { orderId, status, paymentStatus });
      
      const auth = getAuthClient();
      if (!auth) {
        console.error('❌ Google auth not available for update');
        return false;
      }
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get actual sheet name
      const actualSheetName = await this.getFirstSheetName(sheets);
      console.log('📊 Using sheet name:', actualSheetName, 'SPREADSHEET_ID:', SPREADSHEET_ID ? 'SET' : 'NOT SET');
      
      // Find the row with this order ID
      console.log('📊 Fetching column A from sheet...');
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${actualSheetName}!A:A`
      });
      
      const rows = response.data.values || [];
      console.log('📊 Found', rows.length, 'rows in sheet, searching for:', orderId);
      
      // Log first few order IDs for debugging
      console.log('📊 First 5 order IDs in sheet:', rows.slice(0, 5).map(r => r[0]));
      
      const rowIndex = rows.findIndex(row => row[0] === orderId);
      
      if (rowIndex === -1) {
        console.log('❌ Order not found in sheet:', orderId);
        console.log('📊 All order IDs:', rows.map(r => r[0]));
        return false;
      }
      
      console.log('📊 Found order at row index:', rowIndex, '(Sheet row:', rowIndex + 1, ')');
      
      // Update status (column K = 11) and optionally payment status (column J = 10)
      const updates = [];
      
      if (status) {
        const statusLabel = STATUS_LABELS[status] || status;
        const statusRange = `${actualSheetName}!K${rowIndex + 1}`;
        console.log('📊 Will update Order Status at:', statusRange, 'to:', statusLabel);
        updates.push({
          range: statusRange,
          values: [[statusLabel]]
        });
      }
      
      if (paymentStatus) {
        const paymentLabel = paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1);
        const paymentRange = `${actualSheetName}!J${rowIndex + 1}`;
        console.log('📊 Will update Payment Status at:', paymentRange, 'to:', paymentLabel);
        updates.push({
          range: paymentRange,
          values: [[paymentLabel]]
        });
      }
      
      if (updates.length > 0) {
        console.log('📊 Executing batchUpdate with', updates.length, 'updates...');
        const updateResponse = await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            valueInputOption: 'RAW',
            data: updates
          }
        });
        console.log('✅ Cell values updated. Response:', updateResponse.data.totalUpdatedCells, 'cells updated');
      }
      
      // Update row color based on status
      if (status) {
        const sheetId = await this.getSheetId(sheets);
        console.log('📊 Updating row color for sheetId:', sheetId);
        await this.updateRowColor(sheets, sheetId, rowIndex, status);
      }
      
      console.log('✅ Order status updated in Google Sheet:', orderId, 'to', status);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets update error:', error.message);
      console.error('❌ Full error:', JSON.stringify(error.response?.data || error, null, 2));
      return false;
    }
  }
};

module.exports = googleSheets;
