const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';

// Sheet names for different order statuses
const SHEET_NAMES = {
  new: 'neworders',
  delivered: 'delivered',
  cancelled: 'cancelled',
  refunded: 'refunded',
  refundprocessing: 'refundprocessing',
  refundfailed: 'refundfailed'
};

// Status colors (RGB values 0-1)
const STATUS_COLORS = {
  pending: { red: 1, green: 0.95, blue: 0.8 },
  confirmed: { red: 0.85, green: 0.92, blue: 1 },
  preparing: { red: 1, green: 0.9, blue: 0.8 },
  ready: { red: 0.9, green: 0.85, blue: 1 },
  out_for_delivery: { red: 0.85, green: 0.88, blue: 1 },
  delivered: { red: 0.85, green: 1, blue: 0.85 },
  cancelled: { red: 1, green: 0.85, blue: 0.85 },
  refunded: { red: 1, green: 0.8, blue: 0.8 },
  refund_processing: { red: 1, green: 0.9, blue: 0.92 },
  refund_failed: { red: 1, green: 0.7, blue: 0.7 }
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
  refunded: 'Refunded',
  refund_processing: 'Refund Processing',
  refund_failed: 'Refund Failed'
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
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } catch (error) {
    console.error('❌ Error parsing Google credentials:', error.message);
    return null;
  }
};

const googleSheets = {
  // Get sheet info by type
  async getSheetByType(sheets, sheetType) {
    try {
      const sheetName = SHEET_NAMES[sheetType];
      if (!sheetName) return null;
      
      const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheet = response.data.sheets.find(s => 
        s.properties.title.toLowerCase() === sheetName.toLowerCase()
      );
      
      return sheet ? { sheetId: sheet.properties.sheetId, sheetName: sheet.properties.title } : null;
    } catch (error) {
      console.error('Error getting sheet:', error.message);
      return null;
    }
  },

  // Find order in a sheet
  async findOrderInSheet(sheets, sheetName, orderId) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:N`
      });
      
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex(row => row[0] === orderId);
      
      return rowIndex === -1 ? null : { rowIndex, rowData: rows[rowIndex] };
    } catch (error) {
      console.error(`Error finding order in ${sheetName}:`, error.message);
      return null;
    }
  },

  // Add date header to sheet
  async addDateHeader(sheets, sheetName, sheetId) {
    try {
      const istOptions = { timeZone: 'Asia/Kolkata' };
      const date = new Date();
      const dateStr = date.toLocaleDateString('en-IN', istOptions);
      const dayName = date.toLocaleDateString('en-IN', { ...istOptions, weekday: 'long' });
      const year = date.toLocaleDateString('en-IN', { ...istOptions, year: 'numeric' });
      const dateHeaderText = `📅 ${dayName}, ${dateStr} (${year})`;

      // Check if header exists
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`
      });
      
      const rows = response.data.values || [];
      if (rows.some(row => row[0] && row[0].includes(dateStr))) return;

      // Add header
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [[dateHeaderText, '', '', '', '', '', '', '', '', '', '', '', '', '']] }
      });

      // Style header
      const getResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`
      });
      const headerRowIndex = (getResponse.data.values || []).findIndex(row => row[0] === dateHeaderText);
      
      if (headerRowIndex !== -1) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 14 },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
                      textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } },
                      horizontalAlignment: 'CENTER'
                    }
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
              },
              {
                mergeCells: {
                  range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 14 },
                  mergeType: 'MERGE_ALL'
                }
              }
            ]
          }
        });
      }
    } catch (error) {
      console.error('Error adding date header:', error.message);
    }
  },

  // Update row color
  async updateRowColor(sheets, sheetId, rowIndex, status) {
    try {
      const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            repeatCell: {
              range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 14 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: color,
                  textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)'
            }
          }]
        }
      });
    } catch (error) {
      console.error('Error updating row color:', error.message);
    }
  },

  // Add order to a specific sheet
  async addOrderToSheet(sheets, sheetType, rowData, paymentStatus, orderStatus, colorStatus) {
    try {
      const sheet = await this.getSheetByType(sheets, sheetType);
      if (!sheet) return false;

      await this.addDateHeader(sheets, sheet.sheetName, sheet.sheetId);

      // Prepare row data
      const newRowData = [...rowData];
      while (newRowData.length < 14) newRowData.push('');
      newRowData[9] = STATUS_LABELS[paymentStatus] || paymentStatus;
      newRowData[10] = STATUS_LABELS[orderStatus] || orderStatus;

      // Add row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [newRowData] }
      });

      // Apply color
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:A`
      });
      const rows = response.data.values || [];
      const newRowIndex = rows.findIndex(row => row[0] === newRowData[0]);
      if (newRowIndex !== -1) {
        await this.updateRowColor(sheets, sheet.sheetId, newRowIndex, colorStatus);
      }

      console.log(`✅ Order added to ${sheet.sheetName}:`, newRowData[0]);
      return true;
    } catch (error) {
      console.error(`Error adding order to ${sheetType}:`, error.message);
      return false;
    }
  },

  // Delete order from a sheet
  async deleteOrderFromSheet(sheets, sheetId, rowIndex) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 }
            }
          }]
        }
      });
      return true;
    } catch (error) {
      console.error('Error deleting row:', error.message);
      return false;
    }
  },

  // Add new order to neworders sheet
  async addOrder(order) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'new');
      if (!sheet) return false;

      await this.addDateHeader(sheets, sheet.sheetName, sheet.sheetId);

      const date = new Date(order.createdAt || Date.now());
      const istOptions = { timeZone: 'Asia/Kolkata' };
      const itemsStr = order.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');

      const row = [
        order.orderId,
        date.toLocaleDateString('en-IN', istOptions),
        date.toLocaleTimeString('en-IN', istOptions),
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

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });

      const updatedRange = response.data.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/!A(\d+):/);
        if (match) {
          await this.updateRowColor(sheets, sheet.sheetId, parseInt(match[1]) - 1, order.status || 'pending');
        }
      }

      console.log('✅ Order added to Google Sheet:', order.orderId);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets add order error:', error.message);
      return false;
    }
  },

  // Main function to update order status
  async updateOrderStatus(orderId, status, paymentStatus = null) {
    try {
      console.log('📊 updateOrderStatus:', { orderId, status, paymentStatus });
      
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });

      // Handle delivered orders - move from neworders to delivered
      if (status === 'delivered') {
        const newSheet = await this.getSheetByType(sheets, 'new');
        if (!newSheet) return false;
        
        const orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
        if (!orderData) {
          console.log('❌ Order not found in neworders sheet');
          return false;
        }

        // Add to delivered sheet
        await this.addOrderToSheet(sheets, 'delivered', orderData.rowData, paymentStatus || 'paid', 'delivered', 'delivered');
        // Delete from neworders
        await this.deleteOrderFromSheet(sheets, newSheet.sheetId, orderData.rowIndex);
        return true;
      }

      // Handle cancelled orders
      if (status === 'cancelled') {
        const newSheet = await this.getSheetByType(sheets, 'new');
        let orderData = null;
        
        if (newSheet) {
          orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
        }
        
        if (!orderData) {
          console.log('⚠️ Order not found in neworders sheet, trying to fetch from database...');
          // Try to get order data from database and create row data
          try {
            const Order = require('../models/Order');
            const order = await Order.findOne({ orderId });
            if (order) {
              const date = new Date(order.createdAt || Date.now());
              const istOptions = { timeZone: 'Asia/Kolkata' };
              const itemsStr = order.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');
              
              orderData = {
                rowData: [
                  order.orderId,
                  date.toLocaleDateString('en-IN', istOptions),
                  date.toLocaleTimeString('en-IN', istOptions),
                  order.customer?.phone || '',
                  order.customer?.name || '',
                  itemsStr,
                  order.totalAmount,
                  order.serviceType,
                  (order.paymentMethod || 'upi').toUpperCase(),
                  'Paid',
                  'Cancelled',
                  order.deliveryAddress?.address || '',
                  order.deliveryAddress?.latitude || '',
                  order.deliveryAddress?.longitude || ''
                ],
                rowIndex: -1 // Not in sheet
              };
              console.log('✅ Created order data from database for:', orderId);
            }
          } catch (dbErr) {
            console.error('Error fetching order from database:', dbErr.message);
          }
        }
        
        if (!orderData) {
          console.log('❌ Order not found in neworders sheet or database');
          return false;
        }

        const isUpiRefund = paymentStatus === 'refund_processing';

        // Add to cancelled sheet
        await this.addOrderToSheet(sheets, 'cancelled', orderData.rowData, isUpiRefund ? 'paid' : (paymentStatus || 'cancelled'), 'cancelled', 'cancelled');
        
        // If UPI refund, also add to refundprocessing sheet with light pink color
        if (isUpiRefund) {
          console.log('📊 Adding UPI order to refundprocessing sheet...');
          await this.addOrderToSheet(sheets, 'refundprocessing', orderData.rowData, 'paid', 'refund_processing', 'refund_processing');
        }

        // Delete from neworders only if it was found there
        if (newSheet && orderData.rowIndex !== -1) {
          await this.deleteOrderFromSheet(sheets, newSheet.sheetId, orderData.rowIndex);
        }
        return true;
      }

      // Handle refunded orders - move from refundprocessing to refunded sheet
      if (status === 'refunded') {
        let orderData = null;
        let sourceSheet = null;
        let sourceSheetId = null;
        
        // Try to find in refundprocessing sheet first
        const processingSheet = await this.getSheetByType(sheets, 'refundprocessing');
        if (processingSheet) {
          const processingOrder = await this.findOrderInSheet(sheets, processingSheet.sheetName, orderId);
          if (processingOrder) {
            console.log('📊 Found in refundprocessing sheet, moving to refunded...');
            orderData = processingOrder;
            sourceSheet = processingSheet.sheetName;
            sourceSheetId = processingSheet.sheetId;
          }
        }
        
        // Try to find in cancelled sheet if not found in refundprocessing
        if (!orderData) {
          const cancelledSheet = await this.getSheetByType(sheets, 'cancelled');
          if (cancelledSheet) {
            const cancelledOrder = await this.findOrderInSheet(sheets, cancelledSheet.sheetName, orderId);
            if (cancelledOrder) {
              console.log('📊 Found in cancelled sheet, adding to refunded...');
              orderData = cancelledOrder;
              sourceSheet = cancelledSheet.sheetName;
              // Don't delete from cancelled sheet, just copy to refunded
            }
          }
        }
        
        // If still not found, try to get from database
        if (!orderData) {
          console.log('⚠️ Order not found in sheets, trying to fetch from database...');
          try {
            const Order = require('../models/Order');
            const order = await Order.findOne({ orderId });
            if (order) {
              const date = new Date(order.createdAt || Date.now());
              const istOptions = { timeZone: 'Asia/Kolkata' };
              const itemsStr = order.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');
              
              orderData = {
                rowData: [
                  order.orderId,
                  date.toLocaleDateString('en-IN', istOptions),
                  date.toLocaleTimeString('en-IN', istOptions),
                  order.customer?.phone || '',
                  order.customer?.name || '',
                  itemsStr,
                  order.totalAmount,
                  order.serviceType,
                  (order.paymentMethod || 'upi').toUpperCase(),
                  'Refunded',
                  'Refunded',
                  order.deliveryAddress?.address || '',
                  order.deliveryAddress?.latitude || '',
                  order.deliveryAddress?.longitude || ''
                ],
                rowIndex: -1
              };
              console.log('✅ Created order data from database for refunded:', orderId);
            }
          } catch (dbErr) {
            console.error('Error fetching order from database:', dbErr.message);
          }
        }
        
        if (!orderData) {
          console.log('❌ Order not found anywhere for refunded update:', orderId);
          return false;
        }
        
        // Add to refunded sheet
        await this.addOrderToSheet(sheets, 'refunded', orderData.rowData, 'refunded', 'refunded', 'refunded');
        
        // Delete from refundprocessing if it was found there
        if (sourceSheet === 'refundprocessing' && sourceSheetId) {
          await this.deleteOrderFromSheet(sheets, sourceSheetId, orderData.rowIndex);
        }
        
        return true;
      }

      // Handle refund_failed orders - move from refundprocessing to refundfailed sheet
      if (status === 'refund_failed') {
        let orderData = null;
        let sourceSheet = null;
        let sourceSheetId = null;
        
        // Try to find in refundprocessing sheet first
        const processingSheet = await this.getSheetByType(sheets, 'refundprocessing');
        if (processingSheet) {
          const processingOrder = await this.findOrderInSheet(sheets, processingSheet.sheetName, orderId);
          if (processingOrder) {
            console.log('📊 Found in refundprocessing sheet, moving to refundfailed...');
            orderData = processingOrder;
            sourceSheet = processingSheet.sheetName;
            sourceSheetId = processingSheet.sheetId;
          }
        }
        
        // Try to find in cancelled sheet if not found in refundprocessing
        if (!orderData) {
          const cancelledSheet = await this.getSheetByType(sheets, 'cancelled');
          if (cancelledSheet) {
            const cancelledOrder = await this.findOrderInSheet(sheets, cancelledSheet.sheetName, orderId);
            if (cancelledOrder) {
              console.log('📊 Found in cancelled sheet, adding to refundfailed...');
              orderData = cancelledOrder;
              sourceSheet = cancelledSheet.sheetName;
            }
          }
        }
        
        // If still not found, try to get from database
        if (!orderData) {
          console.log('⚠️ Order not found in sheets for refund_failed, trying database...');
          try {
            const Order = require('../models/Order');
            const order = await Order.findOne({ orderId });
            if (order) {
              const date = new Date(order.createdAt || Date.now());
              const istOptions = { timeZone: 'Asia/Kolkata' };
              const itemsStr = order.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');
              
              orderData = {
                rowData: [
                  order.orderId,
                  date.toLocaleDateString('en-IN', istOptions),
                  date.toLocaleTimeString('en-IN', istOptions),
                  order.customer?.phone || '',
                  order.customer?.name || '',
                  itemsStr,
                  order.totalAmount,
                  order.serviceType,
                  (order.paymentMethod || 'upi').toUpperCase(),
                  'Refund Failed',
                  'Refund Failed',
                  order.deliveryAddress?.address || '',
                  order.deliveryAddress?.latitude || '',
                  order.deliveryAddress?.longitude || ''
                ],
                rowIndex: -1
              };
              console.log('✅ Created order data from database for refund_failed:', orderId);
            }
          } catch (dbErr) {
            console.error('Error fetching order from database:', dbErr.message);
          }
        }
        
        if (!orderData) {
          console.log('❌ Order not found anywhere for refund_failed update:', orderId);
          return false;
        }
        
        // Add to refundfailed sheet
        await this.addOrderToSheet(sheets, 'refundfailed', orderData.rowData, 'refund_failed', 'refund_failed', 'refund_failed');
        
        // Delete from refundprocessing if it was found there
        if (sourceSheet === 'refundprocessing' && sourceSheetId) {
          await this.deleteOrderFromSheet(sheets, sourceSheetId, orderData.rowIndex);
        }
        
        return true;
      }

      // For other statuses, update in neworders sheet
      const newSheet = await this.getSheetByType(sheets, 'new');
      if (!newSheet) return false;
      
      const orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
      if (!orderData) {
        console.log('❌ Order not found in neworders sheet');
        return false;
      }

      const updates = [];
      if (status) {
        updates.push({ range: `${newSheet.sheetName}!K${orderData.rowIndex + 1}`, values: [[STATUS_LABELS[status] || status]] });
      }
      if (paymentStatus) {
        updates.push({ range: `${newSheet.sheetName}!J${orderData.rowIndex + 1}`, values: [[STATUS_LABELS[paymentStatus] || paymentStatus]] });
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: { valueInputOption: 'RAW', data: updates }
        });
      }
      await this.updateRowColor(sheets, newSheet.sheetId, orderData.rowIndex, status);
      
      console.log('✅ Order status updated:', orderId, status);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets update error:', error.message);
      return false;
    }
  },

  // Initialize sheet with headers
  async initializeSheet() {
    try {
      const auth = getAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:N1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        const headers = ['Order ID', 'Date', 'Time', 'Customer Phone', 'Customer Name', 'Items', 'Total Amount', 'Service Type', 'Payment Method', 'Payment Status', 'Order Status', 'Delivery Address', 'Latitude', 'Longitude'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A1:N1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
      }
      return true;
    } catch (error) {
      console.error('❌ Google Sheets init error:', error.message);
      return false;
    }
  }
};

module.exports = googleSheets;
