const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';

// Sheet names for different order statuses
const SHEET_NAMES = {
  new: 'neworders',
  delivered: 'delivered',
  cancelled: 'cancelled',
  selfpick: 'selfpick',
  customers: 'customers',
  whatsapp_contacts: 'whatsapp_contacts',
  daily_reports: 'daily_reports',
  dashboard_stats: 'dashboard_stats'
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
  selfpick: { red: 0.9, green: 0.95, blue: 1 },
  ready_for_pickup: { red: 0.85, green: 0.9, blue: 1 },
  picked_up: { red: 0.8, green: 1, blue: 0.9 }
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
  selfpick: 'Self Pickup',
  ready_for_pickup: 'Ready for Pickup',
  picked_up: 'Picked Up'
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
        range: `${sheetName}!A:K`
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

      // Add header (11 columns now)
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:K`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [[dateHeaderText, '', '', '', '', '', '', '', '', '', '']] }
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
                  range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 11 },
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
                  range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 11 },
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
              range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 11 },
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

  // Add order to a specific sheet (with duplicate check)
  async addOrderToSheet(sheets, sheetType, rowData, paymentStatus, orderStatus, colorStatus) {
    try {
      const sheet = await this.getSheetByType(sheets, sheetType);
      if (!sheet) return false;

      const orderId = rowData[0];
      
      // Check if order already exists in this sheet
      const existingOrder = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
      if (existingOrder) {
        console.log(`⏭️ Order ${orderId} already exists in ${sheet.sheetName}, skipping add`);
        return true; // Return true since order is already there
      }

      await this.addDateHeader(sheets, sheet.sheetName, sheet.sheetId);

      // Prepare row data (11 columns: OrderID, Time, Phone, Name, Items, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner)
      const newRowData = [...rowData];
      while (newRowData.length < 11) newRowData.push('');
      newRowData[7] = STATUS_LABELS[paymentStatus] || paymentStatus;
      newRowData[8] = STATUS_LABELS[orderStatus] || orderStatus;

      // Add row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:K`,
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

  // Add new order to neworders sheet (both delivery and self-pickup)
  async addOrder(order) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // All orders go to neworders sheet (both delivery and pickup)
      const sheet = await this.getSheetByType(sheets, 'new');
      if (!sheet) return false;

      await this.addDateHeader(sheets, sheet.sheetName, sheet.sheetId);

      const date = new Date(order.createdAt || Date.now());
      const istOptions = { timeZone: 'Asia/Kolkata' };
      const itemsStr = order.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');

      // Determine payment method label based on service type
      let paymentMethodLabel = 'UPI/App';
      if (order.paymentMethod === 'cod') {
        if (order.serviceType === 'pickup') {
          paymentMethodLabel = 'Pay at Hotel';
        } else {
          paymentMethodLabel = 'COD';
        }
      }

      // Determine payment status label
      let paymentStatusLabel = 'Pending';
      if (order.paymentStatus === 'paid') {
        paymentStatusLabel = 'Paid';
      } else if (order.paymentMethod === 'cod') {
        if (order.serviceType === 'pickup') {
          paymentStatusLabel = 'Pay at Hotel';
        } else {
          paymentStatusLabel = 'Pending';
        }
      }

      // New column structure: OrderID, Time, Phone, Name, Items, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner
      const row = [
        order.orderId,
        date.toLocaleTimeString('en-IN', istOptions),
        order.customer?.phone || '',
        order.customer?.name || '',
        itemsStr,
        order.totalAmount,
        paymentMethodLabel,
        paymentStatusLabel,
        STATUS_LABELS[order.status] || order.status || 'Pending',
        order.serviceType === 'pickup' ? 'Self Pickup' : (order.deliveryAddress?.address || ''),
        '' // Delivery Partner (empty for pickup, or delivery partner name for delivery)
      ];

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:K`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });

      const updatedRange = response.data.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/!A(\d+):/);
        if (match) {
          // Use selfpick color for pickup orders, otherwise use order status color
          const colorStatus = order.serviceType === 'pickup' ? 'selfpick' : (order.status || 'pending');
          await this.updateRowColor(sheets, sheet.sheetId, parseInt(match[1]) - 1, colorStatus);
        }
      }

      console.log(`✅ Order added to Google Sheet (${sheet.sheetName}):`, order.orderId);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets add order error:', error.message);
      return false;
    }
  },

  // Main function to update order status
  async updateOrderStatus(orderId, status, paymentStatus = null, actualPaymentMethod = null) {
    try {
      console.log('📊 updateOrderStatus:', { orderId, status, paymentStatus, actualPaymentMethod });
      
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });

      // Handle delivered/completed orders - move from neworders to appropriate sheet
      if (status === 'delivered' || status === 'picked_up') {
        const newSheet = await this.getSheetByType(sheets, 'new');
        if (!newSheet) return false;
        
        const orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
        if (!orderData) {
          console.log('❌ Order not found in neworders sheet');
          return false;
        }

        // Check if this is a pickup order by looking at the address column (column 10, index 9)
        const isPickupOrder = orderData.rowData[9] === 'Self Pickup' || orderId.startsWith('S');
        
        // If actualPaymentMethod is provided for pickup orders, update payment status to show Cash/UPI
        let finalPaymentStatus = paymentStatus || 'paid';
        if (isPickupOrder && actualPaymentMethod) {
          finalPaymentStatus = actualPaymentMethod === 'cash' ? 'Paid (Cash)' : 'Paid (UPI)';
          // Also update column K (delivery partner/payment method column) with Cash or UPI
          orderData.rowData[10] = actualPaymentMethod === 'cash' ? 'Cash' : 'UPI';
        }
        
        if (isPickupOrder) {
          // Pickup orders go to selfpick sheet when completed
          console.log('📦 Moving completed pickup order to selfpick sheet:', orderId, 'Payment:', finalPaymentStatus);
          await this.addOrderToSheet(sheets, 'selfpick', orderData.rowData, finalPaymentStatus, 'picked_up', 'picked_up');
        } else {
          // Delivery orders go to delivered sheet
          console.log('🚚 Moving completed delivery order to delivered sheet:', orderId);
          await this.addOrderToSheet(sheets, 'delivered', orderData.rowData, finalPaymentStatus, 'delivered', 'delivered');
        }
        
        // Delete from neworders
        await this.deleteOrderFromSheet(sheets, newSheet.sheetId, orderData.rowIndex);
        return true;
      }

      // Handle cancelled orders - just move to cancelled sheet (no refund logic)
      if (status === 'cancelled') {
        const newSheet = await this.getSheetByType(sheets, 'new');
        let orderData = null;
        
        if (newSheet) {
          orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
        }
        
        if (!orderData) {
          console.log('⚠️ Order not found in neworders sheet, trying to fetch from database...');
          // Try to get order data from database
          try {
            const Order = require('../models/Order');
            const dbOrder = await Order.findOne({ orderId });
            
            if (dbOrder) {
              const date = new Date(dbOrder.createdAt || Date.now());
              const istOptions = { timeZone: 'Asia/Kolkata' };
              const itemsStr = dbOrder.items.map(item => `${item.name} x${item.quantity} (₹${item.price * item.quantity})`).join(', ');
              
              orderData = {
                rowData: [
                  dbOrder.orderId,
                  date.toLocaleTimeString('en-IN', istOptions),
                  dbOrder.customer?.phone || '',
                  dbOrder.customer?.name || '',
                  itemsStr,
                  dbOrder.totalAmount,
                  (dbOrder.paymentMethod || 'upi').toUpperCase(),
                  STATUS_LABELS[dbOrder.paymentStatus] || 'Pending',
                  'Cancelled',
                  dbOrder.deliveryAddress?.address || dbOrder.serviceType === 'selfpick' ? 'Self Pickup' : '',
                  dbOrder.deliveryPartnerName || ''
                ],
                rowIndex: -1
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

        // Add to cancelled sheet
        await this.addOrderToSheet(sheets, 'cancelled', orderData.rowData, paymentStatus || 'cancelled', 'cancelled', 'cancelled');
        
        // Delete from neworders only if it was found there
        if (newSheet && orderData.rowIndex !== -1) {
          await this.deleteOrderFromSheet(sheets, newSheet.sheetId, orderData.rowIndex);
        }
        return true;
      }

      // Handle refunded orders - REMOVED (no longer needed)
      // Handle refund_failed orders - REMOVED (no longer needed)

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
        updates.push({ range: `${newSheet.sheetName}!I${orderData.rowIndex + 1}`, values: [[STATUS_LABELS[status] || status]] });
      }
      if (paymentStatus) {
        updates.push({ range: `${newSheet.sheetName}!H${orderData.rowIndex + 1}`, values: [[STATUS_LABELS[paymentStatus] || paymentStatus]] });
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
        range: `${SHEET_NAME}!A1:K1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        const headers = ['Order ID', 'Time', 'Customer Phone', 'Customer Name', 'Items', 'Total Amount', 'Payment Method', 'Payment Status', 'Order Status', 'Delivery Address', 'Delivery Partner'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A1:K1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
      }
      return true;
    } catch (error) {
      console.error('❌ Google Sheets init error:', error.message);
      return false;
    }
  },

  // Update delivery partner name in Google Sheet
  async updateDeliveryPartner(orderId, deliveryPartnerName) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const newSheet = await this.getSheetByType(sheets, 'new');
      if (!newSheet) return false;
      
      const orderData = await this.findOrderInSheet(sheets, newSheet.sheetName, orderId);
      if (!orderData) {
        console.log('❌ Order not found in neworders sheet for delivery partner update');
        return false;
      }
      
      // Add delivery partner name to column K (11th column)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${newSheet.sheetName}!K${orderData.rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[deliveryPartnerName]] }
      });
      
      console.log('✅ Delivery partner updated in Google Sheet:', orderId, deliveryPartnerName);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets delivery partner update error:', error.message);
      return false;
    }
  },

  // Update actual payment method for self-pickup orders (Cash or UPI)
  async updateActualPaymentMethod(orderId, actualPaymentMethod) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Try to find in neworders sheet first
      let sheet = await this.getSheetByType(sheets, 'new');
      let orderData = null;
      
      if (sheet) {
        orderData = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
      }
      
      // If not in neworders, try selfpick sheet (for completed pickup orders)
      if (!orderData) {
        sheet = await this.getSheetByType(sheets, 'selfpick');
        if (sheet) {
          orderData = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
        }
      }
      
      if (!orderData) {
        console.log('❌ Order not found in neworders or selfpick sheet for actual payment method update');
        return false;
      }
      
      // Update actual payment method in column K (11th column) - shows "Cash" or "UPI"
      const paymentLabel = actualPaymentMethod === 'cash' ? 'Cash' : 'UPI';
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!K${orderData.rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[paymentLabel]] }
      });
      
      // Update payment status to "Paid (Cash)" or "Paid (UPI)"
      const paymentStatusLabel = actualPaymentMethod === 'cash' ? 'Paid (Cash)' : 'Paid (UPI)';
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!H${orderData.rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[paymentStatusLabel]] }
      });
      
      console.log('✅ Actual payment method updated in Google Sheet:', orderId, paymentLabel);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets actual payment method update error:', error.message);
      return false;
    }
  },

  // Update payment method in Google Sheet (for COD orders showing actual collection method)
  async updatePaymentMethod(orderId, paymentMethodLabel) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      // Try to find in neworders sheet first
      let sheet = await this.getSheetByType(sheets, 'new');
      let orderData = null;
      
      if (sheet) {
        orderData = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
      }
      
      // If not in neworders, try selfpick sheet
      if (!orderData) {
        sheet = await this.getSheetByType(sheets, 'selfpick');
        if (sheet) {
          orderData = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
        }
      }
      
      // If not in selfpick, try delivered sheet
      if (!orderData) {
        sheet = await this.getSheetByType(sheets, 'delivered');
        if (sheet) {
          orderData = await this.findOrderInSheet(sheets, sheet.sheetName, orderId);
        }
      }
      
      if (!orderData) {
        console.log('❌ Order not found for payment method update');
        return false;
      }
      
      // Update payment method in column G (7th column)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!G${orderData.rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[paymentMethodLabel]] }
      });
      
      console.log('✅ Payment method updated in Google Sheet:', orderId, paymentMethodLabel);
      return true;
    } catch (error) {
      console.error('❌ Google Sheets payment method update error:', error.message);
      return false;
    }
  },

  // Fetch order history from Google Sheets (delivered, cancelled, selfpick sheets)
  // This is the cost-saving method - fetches from sheets instead of MongoDB
  async getOrderHistory(options = {}) {
    try {
      const auth = getAuthClient();
      if (!auth) return { orders: [], error: 'Google auth not configured' };
      
      const sheets = google.sheets({ version: 'v4', auth });
      const { deliveryBoyName, startDate, endDate, searchQuery, status } = options;
      
      let allOrders = [];
      
      // Determine which sheets to fetch from based on status filter
      let sheetsToFetch = [];
      if (status === 'delivered') {
        sheetsToFetch = ['delivered', 'selfpick'];
      } else if (status === 'cancelled') {
        sheetsToFetch = ['cancelled'];
      } else {
        // All statuses - fetch from all completed order sheets
        sheetsToFetch = ['delivered', 'cancelled', 'selfpick'];
      }
      
      for (const sheetType of sheetsToFetch) {
        const sheet = await this.getSheetByType(sheets, sheetType);
        if (!sheet) continue;
        
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheet.sheetName}!A:K`
          });
          
          const rows = response.data.values || [];
          
          // Parse rows (skip date headers which start with 📅)
          for (const row of rows) {
            if (!row[0] || row[0].startsWith('📅')) continue;
            
            // Column structure: OrderID, Time, Phone, Name, Items, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner
            const order = {
              orderId: row[0] || '',
              time: row[1] || '',
              phone: row[2] || '',
              customerName: row[3] || '',
              items: row[4] || '',
              totalAmount: parseFloat(row[5]) || 0,
              paymentMethod: row[6] || '',
              paymentStatus: row[7] || '',
              status: sheetType === 'selfpick' ? 'delivered' : sheetType,
              address: row[9] || '',
              deliveryPartnerName: row[10] || '',
              source: 'sheets',
              sheetType: sheetType
            };
            
            // Filter by delivery boy name if specified
            if (deliveryBoyName && order.deliveryPartnerName !== deliveryBoyName) {
              continue;
            }
            
            // Filter by search query (search in orderId, customerName, phone, items)
            if (searchQuery) {
              const query = searchQuery.toLowerCase();
              const matches = 
                order.orderId.toLowerCase().includes(query) ||
                order.customerName.toLowerCase().includes(query) ||
                order.phone.includes(query) ||
                order.items.toLowerCase().includes(query);
              if (!matches) continue;
            }
            
            allOrders.push(order);
          }
        } catch (sheetError) {
          console.error(`Error fetching from ${sheet.sheetName}:`, sheetError.message);
        }
      }
      
      // Sort by orderId (descending - newest first)
      // OrderIds typically have format like D1234 or S1234, sort by numeric part
      allOrders.sort((a, b) => {
        const numA = parseInt(a.orderId.replace(/[^0-9]/g, '')) || 0;
        const numB = parseInt(b.orderId.replace(/[^0-9]/g, '')) || 0;
        return numB - numA;
      });
      
      console.log(`📊 Fetched ${allOrders.length} orders from Google Sheets history`);
      return { orders: allOrders, error: null };
    } catch (error) {
      console.error('❌ Error fetching order history from sheets:', error.message);
      return { orders: [], error: error.message };
    }
  },

  // Get delivery partner history from Google Sheets with date filtering
  // Cost-saving: Fetches complete history from sheets instead of MongoDB
  async getDeliveryPartnerHistory(options = {}) {
    try {
      const auth = getAuthClient();
      if (!auth) return { orders: [], stats: { delivered: 0, cancelled: 0, earnings: 0 }, error: 'Google auth not configured' };
      
      const sheets = google.sheets({ version: 'v4', auth });
      const { deliveryBoyName, filter = 'all' } = options;
      
      if (!deliveryBoyName) {
        return { orders: [], stats: { delivered: 0, cancelled: 0, earnings: 0 }, error: 'Delivery partner name required' };
      }
      
      let allOrders = [];
      
      // Fetch from delivered and cancelled sheets
      const sheetsToFetch = ['delivered', 'cancelled'];
      
      for (const sheetType of sheetsToFetch) {
        const sheet = await this.getSheetByType(sheets, sheetType);
        if (!sheet) continue;
        
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheet.sheetName}!A:L`
          });
          
          const rows = response.data.values || [];
          let currentDate = null;
          
          // Parse rows
          for (const row of rows) {
            if (!row[0]) continue;
            
            // Check if this is a date header row (starts with 📅)
            if (row[0].startsWith('📅')) {
              // Extract date from header like "📅 01-Feb-2026"
              const dateMatch = row[0].match(/📅\s*(.+)/);
              if (dateMatch) {
                currentDate = dateMatch[1].trim();
              }
              continue;
            }
            
            // Column structure: OrderID, Time, Phone, Name, Items, Total, PaymentMethod, PaymentStatus, OrderStatus, Address, DeliveryPartner
            const deliveryPartner = row[10] || '';
            
            // Filter by delivery partner name
            if (deliveryPartner !== deliveryBoyName) {
              continue;
            }
            
            // Parse order date (use current date header or extract from time)
            let orderDate = null;
            if (currentDate) {
              try {
                // Parse date like "01-Feb-2026" or "15-Jan-2026"
                const [day, month, year] = currentDate.split('-');
                const monthMap = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
                orderDate = new Date(parseInt(year), monthMap[month] || 0, parseInt(day));
              } catch (e) {
                orderDate = new Date();
              }
            }
            
            const order = {
              orderId: row[0] || '',
              time: row[1] || '',
              phone: row[2] || '',
              customerName: row[3] || '',
              items: row[4] || '',
              totalAmount: parseFloat(row[5]) || 0,
              paymentMethod: row[6] || '',
              paymentStatus: row[7] || '',
              status: sheetType,
              address: row[9] || '',
              deliveryPartnerName: deliveryPartner,
              source: 'sheets',
              sheetType: sheetType,
              orderDate: orderDate,
              // For compatibility with frontend
              deliveredAt: orderDate,
              statusUpdatedAt: orderDate
            };
            
            allOrders.push(order);
          }
        } catch (sheetError) {
          console.error(`Error fetching from ${sheetType}:`, sheetError.message);
        }
      }
      
      // Apply date filter
      const now = new Date();
      let filteredOrders = allOrders;
      
      if (filter === 'today') {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        filteredOrders = allOrders.filter(o => o.orderDate && o.orderDate >= startOfDay);
      } else if (filter === 'week') {
        // Get Monday of current week
        const dayOfWeek = now.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - diffToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        filteredOrders = allOrders.filter(o => o.orderDate && o.orderDate >= startOfWeek && o.orderDate <= endOfWeek);
      } else if (filter === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        filteredOrders = allOrders.filter(o => o.orderDate && o.orderDate >= startOfMonth && o.orderDate <= endOfMonth);
      }
      // 'all' - no date filter, return complete history
      
      // Sort by order date (newest first)
      filteredOrders.sort((a, b) => {
        if (!a.orderDate && !b.orderDate) return 0;
        if (!a.orderDate) return 1;
        if (!b.orderDate) return -1;
        return b.orderDate - a.orderDate;
      });
      
      // Calculate stats
      const deliveredOrders = filteredOrders.filter(o => o.status === 'delivered');
      const cancelledOrders = filteredOrders.filter(o => o.status === 'cancelled');
      const totalEarnings = deliveredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      
      console.log(`📊 Fetched ${filteredOrders.length} orders for delivery partner "${deliveryBoyName}" (filter: ${filter})`);
      
      return { 
        orders: filteredOrders, 
        stats: {
          delivered: deliveredOrders.length,
          cancelled: cancelledOrders.length,
          earnings: totalEarnings
        },
        error: null 
      };
    } catch (error) {
      console.error('❌ Error fetching delivery partner history from sheets:', error.message);
      return { orders: [], stats: { delivered: 0, cancelled: 0, earnings: 0 }, error: error.message };
    }
  },
  // Cost-saving: Store customers in Google Sheets instead of fetching from MongoDB

  // Initialize customers sheet with headers if not exists
  async initializeCustomersSheet() {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'customers');
      
      if (!sheet) {
        console.log('⚠️ Customers sheet not found. Please create a sheet named "customers" in your Google Spreadsheet');
        return false;
      }
      
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A1:G1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        // Add headers: Phone, Name, Location, Orders Count, Total Spent, Last Order, Order History
        const headers = ['Phone', 'Name', 'Location', 'Orders Count', 'Total Spent', 'Last Order Date', 'Order History'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A1:G1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        
        // Format header row
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              repeatCell: {
                range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
                    textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    horizontalAlignment: 'CENTER'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
              }
            }]
          }
        });
        
        console.log('✅ Customers sheet initialized with headers');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error initializing customers sheet:', error.message);
      return false;
    }
  },

  // Add or update customer in the customers sheet
  async addOrUpdateCustomer(phone, name = null, location = null) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'customers');
      
      if (!sheet) {
        console.log('⚠️ Customers sheet not found');
        return false;
      }
      
      // Initialize sheet if needed
      await this.initializeCustomersSheet();
      
      // Check if customer already exists
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:G`
      });
      
      const rows = response.data.values || [];
      const existingRowIndex = rows.findIndex((row, index) => index > 0 && row[0] === phone);
      
      if (existingRowIndex !== -1) {
        // Update existing customer's name and location if provided
        const updates = [];
        if (name && name.trim()) {
          updates.push({
            range: `${sheet.sheetName}!B${existingRowIndex + 1}`,
            values: [[name]]
          });
        }
        if (location && location.trim()) {
          updates.push({
            range: `${sheet.sheetName}!C${existingRowIndex + 1}`,
            values: [[location]]
          });
        }
        
        if (updates.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { valueInputOption: 'RAW', data: updates }
          });
        }
        
        console.log(`📱 Customer ${phone} already exists, updated info`);
        return true;
      }
      
      // Add new customer
      const newRow = [phone, name || '', location || '', 0, 0, '', ''];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:G`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [newRow] }
      });
      
      console.log(`✅ Customer ${phone} added to Google Sheets`);
      return true;
    } catch (error) {
      console.error('❌ Error adding customer to sheets:', error.message);
      return false;
    }
  },

  // Update customer's order in the sheet (called when order is delivered/cancelled)
  async updateCustomerOrder(phone, order, status) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'customers');
      
      if (!sheet) return false;
      
      // Get customer row
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:G`
      });
      
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex((row, index) => index > 0 && row[0] === phone);
      
      if (rowIndex === -1) {
        // Customer not found, add them first
        await this.addOrUpdateCustomer(phone, order.customer?.name, order.deliveryAddress?.address);
        return this.updateCustomerOrder(phone, order, status);
      }
      
      const currentRow = rows[rowIndex];
      const currentOrdersCount = parseInt(currentRow[3]) || 0;
      const currentTotalSpent = parseFloat(currentRow[4]) || 0;
      const currentOrderHistory = currentRow[6] || '';
      
      // Format order entry: OrderID|Items|Amount|Status|Date
      const date = new Date();
      const dateStr = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
      const itemsStr = order.items?.map(i => `${i.name}x${i.quantity}`).join(', ') || '';
      const orderEntry = `${order.orderId}|${itemsStr}|₹${order.totalAmount}|${status}|${dateStr}`;
      
      // Append to order history
      const newOrderHistory = currentOrderHistory ? `${currentOrderHistory} || ${orderEntry}` : orderEntry;
      
      // Update totals (only add to total if delivered)
      const newOrdersCount = currentOrdersCount + 1;
      const newTotalSpent = status === 'delivered' ? currentTotalSpent + (order.totalAmount || 0) : currentTotalSpent;
      
      // Update the row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!D${rowIndex + 1}:G${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { 
          values: [[newOrdersCount, newTotalSpent, dateStr, newOrderHistory]] 
        }
      });
      
      // Color the row based on status (green for delivered, red for cancelled)
      const color = status === 'delivered' 
        ? { red: 0.9, green: 1, blue: 0.9 }  // Light green
        : { red: 1, green: 0.9, blue: 0.9 }; // Light red
      
      // Only color if this is the most recent order
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            repeatCell: {
              range: { sheetId: sheet.sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 7 },
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
      
      console.log(`✅ Customer ${phone} order history updated in Google Sheets`);
      return true;
    } catch (error) {
      console.error('❌ Error updating customer order in sheets:', error.message);
      return false;
    }
  },

  // Get all customers from Google Sheets (for offers/broadcast)
  async getAllCustomers() {
    try {
      const auth = getAuthClient();
      if (!auth) return { customers: [], error: 'Auth not configured' };
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'customers');
      
      if (!sheet) {
        return { customers: [], error: 'Customers sheet not found' };
      }
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:G`
      });
      
      const rows = response.data.values || [];
      const customers = [];
      
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue; // Skip empty rows
        
        customers.push({
          phone: row[0] || '',
          name: row[1] || '',
          location: row[2] || '',
          ordersCount: parseInt(row[3]) || 0,
          totalSpent: parseFloat(row[4]) || 0,
          lastOrderDate: row[5] || '',
          orderHistory: row[6] || '',
          rowIndex: i
        });
      }
      
      console.log(`📊 Fetched ${customers.length} customers from Google Sheets`);
      return { customers, error: null };
    } catch (error) {
      console.error('❌ Error fetching customers from sheets:', error.message);
      return { customers: [], error: error.message };
    }
  },

  // Get top percentage of customers by total spent (for targeted offers)
  async getTopCustomersBySpent(percentage) {
    try {
      const { customers, error } = await this.getAllCustomers();
      
      if (error || customers.length === 0) {
        return { customers: [], error: error || 'No customers found' };
      }
      
      // Filter customers who have ordered at least once
      const orderedCustomers = customers.filter(c => c.ordersCount > 0 && c.totalSpent > 0);
      
      if (orderedCustomers.length === 0) {
        return { customers: [], error: 'No customers with orders found' };
      }
      
      // Sort by total spent (descending)
      orderedCustomers.sort((a, b) => b.totalSpent - a.totalSpent);
      
      // Calculate how many customers are in the top percentage
      const topCount = Math.max(1, Math.ceil(orderedCustomers.length * (percentage / 100)));
      
      // Get top customers
      const topCustomers = orderedCustomers.slice(0, topCount);
      
      console.log(`📊 Top ${percentage}% customers: ${topCustomers.length} out of ${orderedCustomers.length}`);
      return { 
        customers: topCustomers, 
        totalCustomers: orderedCustomers.length,
        selectedCount: topCustomers.length,
        error: null 
      };
    } catch (error) {
      console.error('❌ Error getting top customers:', error.message);
      return { customers: [], error: error.message };
    }
  },

  // Clean up empty date headers from all sheets
  async cleanupEmptyDateHeaders() {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetTypes = ['new', 'delivered', 'cancelled', 'refunded', 'refundprocessing', 'refundfailed'];
      
      let totalRemoved = 0;
      
      for (const sheetType of sheetTypes) {
        const sheet = await this.getSheetByType(sheets, sheetType);
        if (!sheet) continue;
        
        try {
          // Get all rows from the sheet
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheet.sheetName}!A:A`
          });
          
          const rows = response.data.values || [];
          const rowsToDelete = [];
          
          // Find date header rows (they start with 📅)
          for (let i = 0; i < rows.length; i++) {
            const cellValue = rows[i]?.[0] || '';
            if (cellValue.startsWith('📅')) {
              // Check if next row is another date header or empty (no orders under this date)
              const nextRow = rows[i + 1]?.[0] || '';
              const isNextRowDateHeader = nextRow.startsWith('📅');
              const isNextRowEmpty = !nextRow || nextRow.trim() === '';
              const isLastRow = i === rows.length - 1;
              
              // If next row is another date header, empty, or this is the last row - this date header has no orders
              if (isNextRowDateHeader || isNextRowEmpty || isLastRow) {
                rowsToDelete.push(i);
              }
            }
          }
          
          // Delete rows from bottom to top to maintain correct indices
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort((a, b) => b - a); // Sort descending
            
            for (const rowIndex of rowsToDelete) {
              await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                  requests: [{
                    deleteDimension: {
                      range: {
                        sheetId: sheet.sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1
                      }
                    }
                  }]
                }
              });
              totalRemoved++;
            }
            
            console.log(`🗑️ Removed ${rowsToDelete.length} empty date headers from ${sheet.sheetName}`);
          }
        } catch (sheetError) {
          console.error(`Error cleaning ${sheet.sheetName}:`, sheetError.message);
        }
      }
      
      if (totalRemoved > 0) {
        console.log(`✅ Total empty date headers removed: ${totalRemoved}`);
      } else {
        console.log('📅 No empty date headers to remove');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error cleaning up empty date headers:', error.message);
      return false;
    }
  },

  // ==================== WHATSAPP CONTACTS SHEET FUNCTIONS ====================
  // Cost-saving: Store WhatsApp contacts in Google Sheets instead of MongoDB

  // Initialize whatsapp_contacts sheet with headers
  async initializeWhatsAppContactsSheet() {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'whatsapp_contacts');
      
      if (!sheet) {
        console.log('⚠️ whatsapp_contacts sheet not found. Please create it in your Google Spreadsheet');
        return false;
      }
      
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A1:F1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        const headers = ['Phone', 'Name', 'First Order Date', 'Last Order Date', 'Total Orders', 'Is Active'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A1:F1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        
        // Format header row
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              repeatCell: {
                range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.5, blue: 0.3 },
                    textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    horizontalAlignment: 'CENTER'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
              }
            }]
          }
        });
        console.log('✅ WhatsApp contacts sheet initialized with headers');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error initializing whatsapp_contacts sheet:', error.message);
      return false;
    }
  },

  // Add or update WhatsApp contact in sheet
  async addOrUpdateWhatsAppContact(contact) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'whatsapp_contacts');
      if (!sheet) return false;
      
      const { phone, name, firstOrderDate, lastOrderDate, totalOrders, isActive } = contact;
      
      // Get all rows to find existing contact
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:F`
      });
      
      const rows = response.data.values || [];
      let existingRowIndex = -1;
      
      // Find if contact exists (skip header)
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === phone) {
          existingRowIndex = i;
          break;
        }
      }
      
      const rowData = [
        phone,
        name || '',
        firstOrderDate ? new Date(firstOrderDate).toLocaleDateString('en-IN') : '',
        lastOrderDate ? new Date(lastOrderDate).toLocaleDateString('en-IN') : '',
        totalOrders || 0,
        isActive !== false ? 'Yes' : 'No'
      ];
      
      if (existingRowIndex > -1) {
        // Update existing row
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A${existingRowIndex + 1}:F${existingRowIndex + 1}`,
          valueInputOption: 'RAW',
          resource: { values: [rowData] }
        });
      } else {
        // Add new row
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A:F`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [rowData] }
        });
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error adding/updating WhatsApp contact in sheet:', error.message);
      return false;
    }
  },

  // Get all WhatsApp contacts from sheet
  async getAllWhatsAppContacts() {
    try {
      const auth = getAuthClient();
      if (!auth) return [];
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'whatsapp_contacts');
      if (!sheet) return [];
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:F`
      });
      
      const rows = response.data.values || [];
      const contacts = [];
      
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[0]) {
          contacts.push({
            phone: row[0],
            name: row[1] || '',
            firstOrderDate: row[2] || null,
            lastOrderDate: row[3] || null,
            totalOrders: parseInt(row[4]) || 0,
            isActive: row[5] !== 'No'
          });
        }
      }
      
      console.log(`📱 Fetched ${contacts.length} WhatsApp contacts from sheet`);
      return contacts;
    } catch (error) {
      console.error('❌ Error fetching WhatsApp contacts from sheet:', error.message);
      return [];
    }
  },

  // Get active WhatsApp contacts for broadcast
  async getActiveWhatsAppContacts() {
    const allContacts = await this.getAllWhatsAppContacts();
    return allContacts.filter(c => c.isActive);
  },

  // ==================== DAILY REPORTS SHEET FUNCTIONS ====================
  // Cost-saving: Store daily reports in Google Sheets instead of MongoDB

  // Initialize daily_reports sheet with headers
  async initializeDailyReportsSheet() {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'daily_reports');
      
      if (!sheet) {
        console.log('⚠️ daily_reports sheet not found. Please create it in your Google Spreadsheet');
        return false;
      }
      
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A1:K1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        const headers = ['Date', 'Revenue', 'Total Orders', 'Delivered', 'Cancelled', 'Refunded', 'COD Orders', 'UPI Orders', 'Items Sold', 'Top Items', 'Top Categories'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A1:K1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        
        // Format header row
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              repeatCell: {
                range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
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
        console.log('✅ Daily reports sheet initialized with headers');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error initializing daily_reports sheet:', error.message);
      return false;
    }
  },

  // Add or update daily report in sheet
  async saveDailyReport(report) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'daily_reports');
      if (!sheet) return false;
      
      const { date, revenue, orders, deliveredOrders, cancelledOrders, refundedOrders, codOrders, upiOrders, itemsSold, items, categories } = report;
      
      // Get all rows to find existing date
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:K`
      });
      
      const rows = response.data.values || [];
      let existingRowIndex = -1;
      
      // Find if date exists (skip header)
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === date) {
          existingRowIndex = i;
          break;
        }
      }
      
      // Format top items and categories for display
      const topItems = items && items.length > 0 
        ? items.slice(0, 5).map(i => `${i.name} (${i.quantity})`).join(', ')
        : '';
      const topCategories = categories && categories.length > 0
        ? categories.slice(0, 5).map(c => `${c.category} (₹${c.revenue})`).join(', ')
        : '';
      
      const rowData = [
        date,
        revenue || 0,
        orders || 0,
        deliveredOrders || 0,
        cancelledOrders || 0,
        refundedOrders || 0,
        codOrders || 0,
        upiOrders || 0,
        itemsSold || 0,
        topItems,
        topCategories
      ];
      
      if (existingRowIndex > -1) {
        // Update existing row
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A${existingRowIndex + 1}:K${existingRowIndex + 1}`,
          valueInputOption: 'RAW',
          resource: { values: [rowData] }
        });
      } else {
        // Add new row at the top (after header)
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              insertDimension: {
                range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
                inheritFromBefore: false
              }
            }]
          }
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A2:K2`,
          valueInputOption: 'RAW',
          resource: { values: [rowData] }
        });
      }
      
      console.log(`📊 Daily report saved for ${date}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving daily report to sheet:', error.message);
      return false;
    }
  },

  // Get daily report from sheet
  async getDailyReport(date) {
    try {
      const auth = getAuthClient();
      if (!auth) return null;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'daily_reports');
      if (!sheet) return null;
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:K`
      });
      
      const rows = response.data.values || [];
      
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === date) {
          return {
            date: rows[i][0],
            revenue: parseFloat(rows[i][1]) || 0,
            orders: parseInt(rows[i][2]) || 0,
            deliveredOrders: parseInt(rows[i][3]) || 0,
            cancelledOrders: parseInt(rows[i][4]) || 0,
            refundedOrders: parseInt(rows[i][5]) || 0,
            codOrders: parseInt(rows[i][6]) || 0,
            upiOrders: parseInt(rows[i][7]) || 0,
            itemsSold: parseInt(rows[i][8]) || 0
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error fetching daily report from sheet:', error.message);
      return null;
    }
  },

  // Get reports for date range
  async getReportsInRange(startDate, endDate) {
    try {
      const auth = getAuthClient();
      if (!auth) return [];
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'daily_reports');
      if (!sheet) return [];
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:K`
      });
      
      const rows = response.data.values || [];
      const reports = [];
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let i = 1; i < rows.length; i++) {
        const rowDate = new Date(rows[i][0]);
        if (rowDate >= start && rowDate <= end) {
          reports.push({
            date: rows[i][0],
            revenue: parseFloat(rows[i][1]) || 0,
            orders: parseInt(rows[i][2]) || 0,
            deliveredOrders: parseInt(rows[i][3]) || 0,
            cancelledOrders: parseInt(rows[i][4]) || 0,
            refundedOrders: parseInt(rows[i][5]) || 0,
            codOrders: parseInt(rows[i][6]) || 0,
            upiOrders: parseInt(rows[i][7]) || 0,
            itemsSold: parseInt(rows[i][8]) || 0
          });
        }
      }
      
      return reports;
    } catch (error) {
      console.error('❌ Error fetching reports in range from sheet:', error.message);
      return [];
    }
  },

  // ==================== DASHBOARD STATS SHEET FUNCTIONS ====================
  // Cost-saving: Store dashboard stats in Google Sheets instead of MongoDB

  // Initialize dashboard_stats sheet with headers
  async initializeDashboardStatsSheet() {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'dashboard_stats');
      
      if (!sheet) {
        console.log('⚠️ dashboard_stats sheet not found. Please create it in your Google Spreadsheet');
        return false;
      }
      
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A1:D1`
      });
      
      if (!response.data.values || response.data.values.length === 0) {
        const headers = ['Metric', 'Value', 'Last Updated', 'Notes'];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A1:D1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        
        // Add default metrics
        const defaultMetrics = [
          ['Total Orders', '0', new Date().toLocaleString('en-IN'), 'Lifetime total'],
          ['Total Revenue', '0', new Date().toLocaleString('en-IN'), 'Lifetime total'],
          ['Total Customers', '0', new Date().toLocaleString('en-IN'), 'Lifetime total'],
          ['Today Orders', '0', new Date().toLocaleString('en-IN'), 'Resets daily'],
          ['Today Revenue', '0', new Date().toLocaleString('en-IN'), 'Resets daily'],
          ['Today Date', new Date().toISOString().split('T')[0], new Date().toLocaleString('en-IN'), 'Current date']
        ];
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A2:D7`,
          valueInputOption: 'RAW',
          resource: { values: defaultMetrics }
        });
        
        // Format header row
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              repeatCell: {
                range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
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
        console.log('✅ Dashboard stats sheet initialized with headers');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error initializing dashboard_stats sheet:', error.message);
      return false;
    }
  },

  // Update dashboard stat in sheet
  async updateDashboardStat(metric, value) {
    try {
      const auth = getAuthClient();
      if (!auth) return false;
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'dashboard_stats');
      if (!sheet) return false;
      
      // Get all rows to find metric
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:D`
      });
      
      const rows = response.data.values || [];
      let rowIndex = -1;
      
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === metric) {
          rowIndex = i;
          break;
        }
      }
      
      const timestamp = new Date().toLocaleString('en-IN');
      
      if (rowIndex > -1) {
        // Update existing metric
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!B${rowIndex + 1}:C${rowIndex + 1}`,
          valueInputOption: 'RAW',
          resource: { values: [[value, timestamp]] }
        });
      } else {
        // Add new metric
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheet.sheetName}!A:D`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [[metric, value, timestamp, '']] }
        });
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error updating dashboard stat in sheet:', error.message);
      return false;
    }
  },

  // Get all dashboard stats from sheet
  async getDashboardStats() {
    try {
      const auth = getAuthClient();
      if (!auth) return {};
      
      const sheets = google.sheets({ version: 'v4', auth });
      const sheet = await this.getSheetByType(sheets, 'dashboard_stats');
      if (!sheet) return {};
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheet.sheetName}!A:D`
      });
      
      const rows = response.data.values || [];
      const stats = {};
      
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0]) {
          const metric = rows[i][0];
          const value = rows[i][1];
          // Convert to number if it looks like a number
          stats[metric] = isNaN(value) ? value : parseFloat(value);
        }
      }
      
      return stats;
    } catch (error) {
      console.error('❌ Error fetching dashboard stats from sheet:', error.message);
      return {};
    }
  },

  // Increment dashboard stat
  async incrementDashboardStat(metric, amount = 1) {
    try {
      const stats = await this.getDashboardStats();
      const currentValue = stats[metric] || 0;
      await this.updateDashboardStat(metric, currentValue + amount);
      return true;
    } catch (error) {
      console.error('❌ Error incrementing dashboard stat:', error.message);
      return false;
    }
  }
};

module.exports = googleSheets;
