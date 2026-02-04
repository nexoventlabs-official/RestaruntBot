require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/Order');
const Customer = require('./models/Customer');
const DashboardStats = require('./models/DashboardStats');
const googleSheets = require('./services/googleSheets');

// Helper to get today's date string (dd/mm/yyyy format)
const getTodayString = () => {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
};

async function syncSheetsWithRealtimeData() {
  try {
    console.log('🔄 Starting sync of Google Sheets with real-time data...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getTodayString();
    
    // ==================== SYNC DASHBOARD STATS ====================
    console.log('📊 Syncing Dashboard Stats...');
    
    const [
      cumulativeStats,
      currentDeliveredOrders,
      currentRevenue,
      todayDeliveredRevenue,
      currentCustomers
    ] = await Promise.all([
      DashboardStats.findOne().lean(),
      Order.countDocuments({ status: 'delivered' }),
      Order.aggregate([{ 
        $match: { 
          paymentStatus: 'paid', 
          status: { $nin: ['cancelled', 'refunded'] }, 
          refundStatus: { $nin: ['completed', 'pending'] } 
        } 
      }, { 
        $group: { _id: null, total: { $sum: '$totalAmount' } } 
      }]),
      Order.aggregate([{ 
        $match: { 
          status: 'delivered',
          paymentStatus: 'paid', 
          deliveredAt: { $gte: today }
        } 
      }, { 
        $group: { _id: null, total: { $sum: '$totalAmount' } } 
      }]),
      Customer.countDocuments({ hasOrdered: true })
    ]);
    
    const stats = cumulativeStats || { totalOrders: 0, totalRevenue: 0, todayRevenue: 0, todayOrders: 0 };
    
    // Calculate totals
    const totalOrders = stats.totalOrders + currentDeliveredOrders;
    const totalRevenue = stats.totalRevenue + (currentRevenue[0]?.total || 0);
    const totalCustomers = currentCustomers;
    const todayOrders = stats.todayDate === todayStr ? stats.todayOrders : 0;
    const todayRevenue = stats.todayDate === todayStr ? stats.todayRevenue : 0;
    
    console.log(`  Total Orders: ${totalOrders}`);
    console.log(`  Total Revenue: ₹${totalRevenue}`);
    console.log(`  Total Customers: ${totalCustomers}`);
    console.log(`  Today Orders: ${todayOrders}`);
    console.log(`  Today Revenue: ₹${todayRevenue}`);
    
    // Update dashboard stats in Google Sheets
    await googleSheets.updateDashboardStat('Total Orders', totalOrders);
    await googleSheets.updateDashboardStat('Total Revenue', totalRevenue);
    await googleSheets.updateDashboardStat('Total Customers', totalCustomers);
    await googleSheets.updateDashboardStat('Today Orders', todayOrders);
    await googleSheets.updateDashboardStat('Today Revenue', todayRevenue);
    await googleSheets.updateDashboardStat('Today Date', todayStr);
    
    console.log('✅ Dashboard stats synced to Google Sheets\n');
    
    // ==================== SYNC DAILY REPORT ====================
    console.log('📊 Syncing Today\'s Daily Report...');
    
    const dateFilter = { createdAt: { $gte: today, $lte: new Date() } };
    
    const [
      orders,
      orderStats,
      itemStats,
      paymentStats
    ] = await Promise.all([
      Order.find(dateFilter).lean(),
      Order.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { 
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentStatus', 'paid'] }, 
                      { $not: { $in: ['$status', ['cancelled', 'refunded']] } }
                    ] 
                  },
                  '$totalAmount',
                  0
                ]
              }
            },
            deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
            cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            refundedOrders: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } }
          }
        }
      ]),
      Order.aggregate([
        { $match: { ...dateFilter, status: { $nin: ['cancelled', 'refunded'] } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            name: { $first: '$items.name' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { quantity: -1 } },
        { $limit: 5 }
      ]),
      Order.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$paymentMethod',
            count: { $sum: 1 }
          }
        }
      ])
    ]);
    
    const currentStats = orderStats[0] || { 
      totalOrders: 0, 
      totalRevenue: 0, 
      deliveredOrders: 0, 
      cancelledOrders: 0, 
      refundedOrders: 0 
    };
    
    const totalItemsSold = itemStats.reduce((sum, item) => sum + item.quantity, 0);
    const codOrders = paymentStats.find(p => p._id === 'cod')?.count || 0;
    const upiOrders = paymentStats.find(p => p._id === 'upi')?.count || 0;
    
    console.log(`  Date: ${todayStr}`);
    console.log(`  Revenue: ₹${currentStats.totalRevenue}`);
    console.log(`  Orders: ${currentStats.totalOrders}`);
    console.log(`  Delivered: ${currentStats.deliveredOrders}`);
    console.log(`  Cancelled: ${currentStats.cancelledOrders}`);
    console.log(`  Items Sold: ${totalItemsSold}`);
    
    // Save daily report to Google Sheets
    const report = {
      date: todayStr,
      revenue: currentStats.totalRevenue,
      orders: currentStats.totalOrders,
      deliveredOrders: currentStats.deliveredOrders,
      cancelledOrders: currentStats.cancelledOrders,
      refundedOrders: currentStats.refundedOrders,
      codOrders,
      upiOrders,
      itemsSold: totalItemsSold,
      items: itemStats
    };
    
    await googleSheets.saveDailyReport(report);
    console.log('✅ Daily report synced to Google Sheets\n');
    
    // ==================== SYNC CUSTOMERS ====================
    console.log('📊 Syncing Customers...');
    
    const customers = await Customer.find({ hasOrdered: true }).lean();
    console.log(`  Found ${customers.length} customers with orders`);
    
    // Get customer order stats
    for (const customer of customers) {
      const customerOrders = await Order.find({ 
        'customer.phone': customer.phone,
        status: 'delivered',
        paymentStatus: 'paid'
      }).lean();
      
      const ordersCount = customerOrders.length;
      const totalSpent = customerOrders.reduce((sum, o) => sum + o.totalAmount, 0);
      
      // Get first and last order dates
      const sortedOrders = customerOrders.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      const firstOrderDate = sortedOrders[0] ? 
        new Date(sortedOrders[0].createdAt).toLocaleDateString('en-IN', { 
          timeZone: 'Asia/Kolkata', 
          day: '2-digit', 
          month: 'short', 
          year: 'numeric' 
        }) : '';
      
      const lastOrderDate = sortedOrders[sortedOrders.length - 1] ? 
        new Date(sortedOrders[sortedOrders.length - 1].createdAt).toLocaleDateString('en-IN', { 
          timeZone: 'Asia/Kolkata', 
          day: '2-digit', 
          month: 'short', 
          year: 'numeric' 
        }) : '';
      
      // Update customer in sheets with full stats
      await googleSheets.addOrUpdateCustomer(customer.phone, customer.name);
      
      // Manually update the stats (since addOrUpdateCustomer doesn't update order stats)
      const { google } = require('googleapis');
      const auth = googleSheets.getAuthClient ? googleSheets.getAuthClient() : null;
      
      if (auth) {
        const sheets = google.sheets({ version: 'v4', auth });
        const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
        
        // Find customer row
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'customers!A:F'
        });
        
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex((row, index) => index > 0 && row[0] === customer.phone);
        
        if (rowIndex !== -1) {
          // Update the row with correct stats
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `customers!C${rowIndex + 1}:F${rowIndex + 1}`,
            valueInputOption: 'RAW',
            resource: { 
              values: [[ordersCount, totalSpent, firstOrderDate, lastOrderDate]] 
            }
          });
        }
      }
    }
    
    console.log('✅ Customers synced to Google Sheets\n');
    
    console.log('🎉 All data synced successfully!');
    console.log('\n💡 Your Google Sheets now show real-time data matching the admin app');
    
  } catch (error) {
    console.error('❌ Error syncing data:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Run the sync
syncSheetsWithRealtimeData();
