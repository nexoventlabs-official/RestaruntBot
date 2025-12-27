const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1'; // Can be configured via env

// Sheet names for different order statuses
const SHEET_NAMES = {
  new: 'neworders',       // New/active orders (gid=0)
  delivered: 'delivered', // Delivered orders (gid=444615781)
  cancelled: 'cancelled', // Cancelled orders (gid=1204708234)
  refunded: 'refunded'    // Refunded orders (gid=1126647795)
};

// Status colors (RGB values 0-1)
const STATUS_COLORS = {
  pending: { red: 1, green: 0.95, blue: 0.8 },        // Light Yellow
  confirmed: { red: 0.85, green: 0.92, blue: 1 },     // Light Blue
  preparing: { red: 1, green: 0.9, blue: 0.8 },       // Light Orange
  ready: { red: 0.9, green: 0.85, blue: 1 },          // Light Purple
  out_for_delivery: { red: 0.85, green: 0.88, blue: 1 }, // Light Indigo
  delivered: { red: 0.85, green: 1, blue: 0.85 },     // Light Green
  cancelled: { red: 1, green: 0.85, blue: 0.85 },     // Light Red
  refunded: { red: 1, green: 0.8, blue: 0.8 },        // Red for refunded
  refund_processing: { red: 1, green: 0.9, blue: 0.92 } // Light Pink for refund processing
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
  refund_processing: 'Refund Processing'
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

  // Check if date header exists for today
  async checkAndAddDateHeader(sheets, date) {
    try {
      const actualSheetName = await this.getFirstSheetName(sheets);
      
      // Convert to IST (Indian Standard Time - UTC+5:30)
      const istOptions = { timeZone: 'Asia/Kolkata' };
      
      // Format date for comparison (DD/MM/YYYY format used in India)
      const dateStr = date.toLocaleDateString('en-IN', istOptions);
      
      // Get day name in IST
      const dayName = date.toLocaleDateString('en-IN', { ...istOptions, weekday: 'long' });
      
      // Get full year in IST
      const year = date.toLocaleDateString('en-IN', { ...istOptions, year: 'numeric' });
      
      // Create date header text
      const dateHeaderText = `📅 ${dayName}, ${dateStr} (${year})`;
      
      // Get all values from column A to check for existing date header
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${actualSheetName}!A:A`
      });
      
      const rows = response.data.values || [];
      
      // Check if date header already exists for today
      const dateHeaderExists = rows.some(row => row[0] && row[0].includes(dateStr));
      
      if (!dateHeaderExists) {
        console.log('📅 Adding date header for:', dateHeaderText);
        
        // Add date header row (merged across all columns visually by putting text in first cell)
        const headerRow = [dateHeaderText, '', '', '', '', '', '', '', '', '', '', '', '', ''];
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${actualSheetName}!A:N`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [headerRow] }
        });
        
        // Get the row number that was just added and style it
        const getResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${actualSheetName}!A:A`
        });
        
        const updatedRows = getResponse.data.values || [];
        const headerRowIndex = updatedRows.findIndex(row => row[0] === dateHeaderText);
        
        if (headerRowIndex !== -1) {
          const sheetId = await this.getSheetId(sheets);
          
          // Style the date header row with a distinct color and bold text
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: headerRowIndex,
                      endRowIndex: headerRowIndex + 1,
                      startColumnIndex: 0,
                      endColumnIndex: 14
                    },
                    cell: {
                      userEnteredFormat: {
                        backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 }, // Dark blue background
                        textFormat: {
                          bold: true,
                          fontSize: 12,
                          foregroundColor: { red: 1, green: 1, blue: 1 } // White text
                        },
                        horizontalAlignment: 'CENTER'
                      }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                  }
                },
                {
                  mergeCells: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: headerRowIndex,
                      endRowIndex: headerRowIndex + 1,
                      startColumnIndex: 0,
                      endColumnIndex: 14
                    },
                    mergeType: 'MERGE_ALL'
                  }
                }
              ]
            }
          });
          
          console.log('✅ Date header styled and merged');
        }
        
        return true;
      }
      
      console.log('📅 Date header already exists for:', dateStr);
      return false;
    } catch (error) {
      console.error('❌ Error adding date header:', error.message);
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
      
      // Get the 'new' sheet for new orders
      const newSheet = await this.getSheetIdByType(sheets, 'new');
      const targetSheetName = newSheet ? newSheet.sheetName : SHEET_NAME;
      
      const date = new Date(order.createdAt || Date.now());
      
      // Check and add date header if this is the first order of the day
      await this.checkAndAddDateHeaderForSheet(sheets, date, targetSheetName);
      
      // Convert to IST (Indian Standard Time - UTC+5:30)
      const istOptions = { timeZone: 'Asia/Kolkata' };
      const dateStr = date.toLocaleDateString('en-IN', istOptions);
      const timeStr = date.toLocaleTimeString('en-IN', istOptions);
      
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
        range: `${targetSheetName}!A:N`,
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
          const sheetId = newSheet ? newSheet.sheetId : await this.getSheetId(sheets);
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

  // Check and add date header for a specific sheet
  async checkAndAddDateHeaderForSheet(sheets, date, sheetName) {
    try {
      // Convert to IST (Indian Standard Time - UTC+5:30)
      const istOptions = { timeZone: 'Asia/Kolkata' };
      
      // Format date for comparison (DD/MM/YYYY format used in India)
      const dateStr = date.toLocaleDateString('en-IN', istOptions);
      
      // Get day name in IST
      const dayName = date.toLocaleDateString('en-IN', { ...istOptions, weekday: 'long' });
      
      // Get full year in IST
      const year = date.toLocaleDateString('en-IN', { ...istOptions, year: 'numeric' });
      
      // Create date header text
      const dateHeaderText = `📅 ${dayName}, ${dateStr} (${year})`;
      
      // Get all values from column A to check for existing date header
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`
      });
      
      const rows = response.data.values || [];
      
      // Check if date header already exists for today
      const dateHeaderExists = rows.some(row => row[0] && row[0].includes(dateStr));
      
      if (!dateHeaderExists) {
        console.log('📅 Adding date header for:', dateHeaderText, 'in sheet:', sheetName);
        
        // Add date header row
        const headerRow = [dateHeaderText, '', '', '', '', '', '', '', '', '', '', '', '', ''];
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A:N`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [headerRow] }
        });
        
        // Get the row number that was just added and style it
        const getResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A:A`
        });
        
        const updatedRows = getResponse.data.values || [];
        const headerRowIndex = updatedRows.findIndex(row => row[0] === dateHeaderText);
        
        if (headerRowIndex !== -1) {
          const sheetId = await this.getSheetId(sheets, sheetName);
          
          // Style the date header row with a distinct color and bold text
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: headerRowIndex,
                      endRowIndex: headerRowIndex + 1,
                      startColumnIndex: 0,
                      endColumnIndex: 14
                    },
                    cell: {
                      userEnteredFormat: {
                        backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 }, // Dark blue background
                        textFormat: {
                          bold: true,
                          fontSize: 12,
                          foregroundColor: { red: 1, green: 1, blue: 1 } // White text
                        },
                        horizontalAlignment: 'CENTER'
                      }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                  }
                },
                {
                  mergeCells: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: headerRowIndex,
                      endRowIndex: headerRowIndex + 1,
                      startColumnIndex: 0,
                      endColumnIndex: 14
                    },
                    mergeType: 'MERGE_ALL'
                  }
                }
              ]
            }
          });
          
          console.log('✅ Date header styled and merged');
        }
        
        return true;
      }
      
      console.log('📅 Date header already exists for:', dateStr);
      return false;
    } catch (error) {
      console.error('❌ Error adding date header:', error.message);
      return false;
    }
  },

  // Get sheet ID by name
  async getSheetId(sheets, sheetName = null) {
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
      });
      
      const targetName = sheetName || SHEET_NAME;
      const sheet = response.data.sheets.find(s => s.properties.title === targetName);
      return sheet ? sheet.properties.sheetId : 0;
    } catch (error) {
      console.error('Error getting sheet ID:', error.message);
      return 0;
    }
  },

  // Get sheet ID by sheet name from SHEET_NAMES config
  async getSheetIdByType(sheets, sheetType) {
    try {
      const sheetName = SHEET_NAMES[sheetType];
      if (!sheetName) {
        console.error('❌ Unknown sheet type:', sheetType);
        return null;
      }
      
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
      });
      
      const sheet = response.data.sheets.find(s => 
        s.properties.title.toLowerCase() === sheetName.toLowerCase()
      );
      
      if (!sheet) {
        console.error('❌ Sheet not found:', sheetName);
        return null;
      }
      
      return {
        sheetId: sheet.properties.sheetId,
        sheetName: sheet.properties.title
      };
    } catch (error) {
      console.error('Error getting sheet ID by type:', error.message);
      return null;
    }
  },

  // Find order row in a specific sheet
  async findOrderInSheet(sheets, sheetName, orderId) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:N`
      });
      
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex(row => row[0] === orderId);
      
      if (rowIndex === -1) {
        return null;
      }
      
      return {
        rowIndex,
        rowData: rows[rowIndex]
      };
    } catch (error) {
      console.error(`Error finding order in sheet ${sheetName}:`, error.message);
      return null;
    }
  },

  // Move order from one sheet to another based on status
  async moveOrderToSheet(orderId, targetStatus, paymentStatus = null, colorStatus = null) {
    try {
      console.log('📊 moveOrderToSheet called:', { orderId, targetStatus, paymentStatus, colorStatus });
      
      const auth = getAuthClient();
      if (!auth) {
        console.error('❌ Google auth not available');
        return false;
      }
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Determine target sheet based on status
      let targetSheetType = 'new';
      if (targetStatus === 'delivered') {
        targetSheetType = 'delivered';
      } else if (targetStatus === 'cancelled') {
        targetSheetType = 'cancelled';
      } else if (targetStatus === 'refunded') {
        targetSheetType = 'refunded';
      }
      
      // Get source sheet (new orders sheet)
      const sourceSheet = await this.getSheetIdByType(sheets, 'new');
      if (!sourceSheet) {
        console.error('❌ Source sheet (new) not found');
        return false;
      }
      
      // Find order in source sheet
      const orderData = await this.findOrderInSheet(sheets, sourceSheet.sheetName, orderId);
      
      if (!orderData) {
        // Order might already be in another sheet, try to find it
        console.log('📊 Order not in new sheet, checking other sheets...');
        
        // Check if already in target sheet
        const targetSheet = await this.getSheetIdByType(sheets, targetSheetType);
        if (targetSheet) {
          const existingOrder = await this.findOrderInSheet(sheets, targetSheet.sheetName, orderId);
          if (existingOrder) {
            console.log('📊 Order already in target sheet, updating status...');
            // Just update the status in the target sheet
            return await this.updateOrderInSheet(sheets, targetSheet.sheetName, existingOrder.rowIndex, targetStatus, paymentStatus, colorStatus || targetStatus);
          }
        }
        
        // Check cancelled sheet if moving to refunded
        if (targetSheetType === 'refunded') {
          const cancelledSheet = await this.getSheetIdByType(sheets, 'cancelled');
          if (cancelledSheet) {
            const cancelledOrder = await this.findOrderInSheet(sheets, cancelledSheet.sheetName, orderId);
            if (cancelledOrder) {
              console.log('📊 Found order in cancelled sheet, moving to refunded...');
              // Move from cancelled to refunded
              return await this.moveOrderBetweenSheets(sheets, cancelledSheet, cancelledOrder, targetSheetType, targetStatus, paymentStatus, colorStatus || targetStatus);
            }
          }
        }
        
        console.log('❌ Order not found in any sheet:', orderId);
        return false;
      }
      
      // If target is same as source (new), just update status
      if (targetSheetType === 'new') {
        return await this.updateOrderInSheet(sheets, sourceSheet.sheetName, orderData.rowIndex, targetStatus, paymentStatus, colorStatus || targetStatus);
      }
      
      // Move order to target sheet
      const targetSheet = await this.getSheetIdByType(sheets, targetSheetType);
      if (!targetSheet) {
        console.error('❌ Target sheet not found:', targetSheetType);
        return false;
      }
      
      return await this.moveOrderBetweenSheets(sheets, sourceSheet, orderData, targetSheetType, targetStatus, paymentStatus, colorStatus || targetStatus);
      
    } catch (error) {
      console.error('❌ moveOrderToSheet error:', error.message);
      return false;
    }
  },

  // Helper to move order between sheets
  async moveOrderBetweenSheets(sheets, sourceSheet, orderData, targetSheetType, targetStatus, paymentStatus, colorStatus) {
    try {
      const targetSheet = await this.getSheetIdByType(sheets, targetSheetType);
      if (!targetSheet) {
        console.error('❌ Target sheet not found:', targetSheetType);
        return false;
      }
      
      // Add date header to target sheet if needed
      const date = new Date();
      await this.checkAndAddDateHeaderForSheet(sheets, date, targetSheet.sheetName);
      
      // Prepare row data with updated status
      const rowData = [...orderData.rowData];
      
      // Ensure we have all 14 columns
      while (rowData.length < 14) {
        rowData.push('');
      }
      
      // Update status (column K = index 10) and payment status (column J = index 9)
      rowData[10] = STATUS_LABELS[targetStatus] || targetStatus;
      if (paymentStatus) {
        rowData[9] = STATUS_LABELS[paymentStatus] || paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1);
      }
      
      // Add row to target sheet
      console.log('📊 Adding order to', targetSheet.sheetName, 'sheet...');
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${targetSheet.sheetName}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [rowData] }
      });
      
      // Delete row from source sheet
      console.log('📊 Deleting order from', sourceSheet.sheetName, 'sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sourceSheet.sheetId,
                dimension: 'ROWS',
                startIndex: orderData.rowIndex,
                endIndex: orderData.rowIndex + 1
              }
            }
          }]
        }
      });
      
      // Apply color to the new row in target sheet
      const targetSheetResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${targetSheet.sheetName}!A:A`
      });
      const targetRows = targetSheetResponse.data.values || [];
      const newRowIndex = targetRows.findIndex(row => row[0] === rowData[0]);
      
      if (newRowIndex !== -1) {
        // Use colorStatus for row color (e.g., refund_processing for pink)
        await this.updateRowColor(sheets, targetSheet.sheetId, newRowIndex, colorStatus || targetStatus);
      }
      
      console.log('✅ Order moved to', targetSheet.sheetName, 'sheet:', rowData[0]);
      return true;
      
    } catch (error) {
      console.error('❌ moveOrderBetweenSheets error:', error.message);
      return false;
    }
  },

  // Update order status within a specific sheet
  async updateOrderInSheet(sheets, sheetName, rowIndex, status, paymentStatus, colorStatus) {
    try {
      const updates = [];
      
      if (status) {
        const statusLabel = STATUS_LABELS[status] || status;
        updates.push({
          range: `${sheetName}!K${rowIndex + 1}`,
          values: [[statusLabel]]
        });
      }
      
      if (paymentStatus) {
        const paymentLabel = STATUS_LABELS[paymentStatus] || paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1);
        updates.push({
          range: `${sheetName}!J${rowIndex + 1}`,
          values: [[paymentLabel]]
        });
      }
      
      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            valueInputOption: 'RAW',
            data: updates
          }
        });
      }
      
      // Update row color using colorStatus
      const sheetId = await this.getSheetId(sheets, sheetName);
      await this.updateRowColor(sheets, sheetId, rowIndex, colorStatus || status);
      
      console.log('✅ Order updated in', sheetName, 'sheet');
      return true;
    } catch (error) {
      console.error('❌ updateOrderInSheet error:', error.message);
      return false;
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
                  backgroundColor: color,
                  textFormat: {
                    foregroundColor: { red: 0, green: 0, blue: 0 } // Black text
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)'
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
      
      // For delivered status
      if (status === 'delivered') {
        return await this.moveOrderToSheet(orderId, status, paymentStatus, status);
      }
      
      // For cancelled orders - handle UPI paid orders specially
      if (status === 'cancelled') {
        // Check if this is a UPI paid order needing refund (paymentStatus will be 'refund_processing')
        const isUpiRefund = paymentStatus === 'refund_processing';
        
        if (isUpiRefund) {
          console.log('📊 UPI paid order cancelled, adding to both cancelled and refunded sheets...');
          // For UPI refund: cancelled sheet shows "Paid", refunded sheet shows "Refund Processing"
          const cancelledResult = await this.moveOrderToSheet(orderId, 'cancelled', 'paid', 'cancelled');
          // Now add to refunded sheet
          await this.addOrderToRefundedSheet(orderId);
          return cancelledResult;
        } else {
          // Regular cancellation (COD or unpaid)
          return await this.moveOrderToSheet(orderId, 'cancelled', paymentStatus || 'cancelled', 'cancelled');
        }
      }
      
      // For refunded status - update the refunded sheet entry
      if (status === 'refunded') {
        return await this.updateRefundedSheetOrder(orderId, paymentStatus);
      }
      
      const auth = getAuthClient();
      if (!auth) {
        console.error('❌ Google auth not available for update');
        return false;
      }
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get the 'new' sheet for active orders
      const newSheet = await this.getSheetIdByType(sheets, 'new');
      const actualSheetName = newSheet ? newSheet.sheetName : await this.getFirstSheetName(sheets);
      
      // Find the row with this order ID
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${actualSheetName}!A:A`
      });
      
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex(row => row[0] === orderId);
      
      if (rowIndex === -1) {
        console.log('❌ Order not found in sheet:', orderId);
        return false;
      }
      
      // Update status and payment status
      const updates = [];
      
      if (status) {
        updates.push({
          range: `${actualSheetName}!K${rowIndex + 1}`,
          values: [[STATUS_LABELS[status] || status]]
        });
      }
      
      if (paymentStatus) {
        updates.push({
          range: `${actualSheetName}!J${rowIndex + 1}`,
          values: [[STATUS_LABELS[paymentStatus] || paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1)]]
        });
      }
      
      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: { valueInputOption: 'RAW', data: updates }
        });
      }
      
      // Update row color
      if (status) {
        const sheetId = newSheet ? newSheet.sheetId : await this.getSheetId(sheets);
        await this.updateRowColor(sheets, sheetId, rowIndex, status);
      }
      
      console.log('✅ Order status updated in Google Sheet:', orderId, 'to', status);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets update error:', error.message);
      return false;
    }
  },

  // Add cancelled UPI order to refunded sheet with "Refund Processing" status
  async addOrderToRefundedSheet(orderId) {
    try {
      console.log('📊 Adding order to refunded sheet with Refund Processing:', orderId);
      
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get order data from cancelled sheet
      const cancelledSheet = await this.getSheetIdByType(sheets, 'cancelled');
      if (!cancelledSheet) return false;
      
      const orderData = await this.findOrderInSheet(sheets, cancelledSheet.sheetName, orderId);
      if (!orderData) return false;
      
      // Get refunded sheet
      const refundedSheet = await this.getSheetIdByType(sheets, 'refunded');
      if (!refundedSheet) return false;
      
      // Add date header if needed
      await this.checkAndAddDateHeaderForSheet(sheets, new Date(), refundedSheet.sheetName);
      
      // Prepare row data
      const rowData = [...orderData.rowData];
      while (rowData.length < 14) rowData.push('');
      
      // Set payment status to "Refund Processing"
      rowData[9] = 'Refund Processing';
      rowData[10] = 'Cancelled'; // Order status stays cancelled until refund completes
      
      // Add to refunded sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${refundedSheet.sheetName}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [rowData] }
      });
      
      // Apply pink color for refund processing
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${refundedSheet.sheetName}!A:A`
      });
      const rows = response.data.values || [];
      const newRowIndex = rows.findIndex(row => row[0] === orderId);
      
      if (newRowIndex !== -1) {
        await this.updateRowColor(sheets, refundedSheet.sheetId, newRowIndex, 'refund_processing');
      }
      
      console.log('✅ Order added to refunded sheet with Refund Processing:', orderId);
      return true;
    } catch (error) {
      console.error('❌ addOrderToRefundedSheet error:', error.message);
      return false;
    }
  },

  // Update order in refunded sheet when refund is completed
  async updateRefundedSheetOrder(orderId, paymentStatus) {
    try {
      console.log('📊 Updating refunded sheet order:', orderId, paymentStatus);
      
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get refunded sheet
      const refundedSheet = await this.getSheetIdByType(sheets, 'refunded');
      if (!refundedSheet) return false;
      
      // Find order in refunded sheet
      const orderData = await this.findOrderInSheet(sheets, refundedSheet.sheetName, orderId);
      if (!orderData) {
        console.log('❌ Order not found in refunded sheet:', orderId);
        return false;
      }
      
      // Update payment status and order status
      const updates = [
        {
          range: `${refundedSheet.sheetName}!J${orderData.rowIndex + 1}`,
          values: [['Refunded']]
        },
        {
          range: `${refundedSheet.sheetName}!K${orderData.rowIndex + 1}`,
          values: [['Refunded']]
        }
      ];
      
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
      
      // Update row color to red for refunded
      await this.updateRowColor(sheets, refundedSheet.sheetId, orderData.rowIndex, 'refunded');
      
      console.log('✅ Refunded sheet order updated to Refunded:', orderId);
      return true;
    } catch (error) {
      console.error('❌ updateRefundedSheetOrder error:', error.message);
      return false;
    }
  }
};

module.exports = googleSheets;
