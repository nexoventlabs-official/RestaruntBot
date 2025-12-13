// Script to reset all MongoDB data (categories, menu items, orders, dashboard stats, customers)
require('dotenv').config();
const mongoose = require('mongoose');

const Category = require('./models/Category');
const MenuItem = require('./models/MenuItem');
const Order = require('./models/Order');
const DashboardStats = require('./models/DashboardStats');
const Customer = require('./models/Customer');

async function resetAllData() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🗑️ Clearing all data...\n');

    // Clear Categories
    const catResult = await Category.deleteMany({});
    console.log(`📁 Categories deleted: ${catResult.deletedCount}`);

    // Clear Menu Items
    const menuResult = await MenuItem.deleteMany({});
    console.log(`🍽️ Menu Items deleted: ${menuResult.deletedCount}`);

    // Clear Orders
    const orderResult = await Order.deleteMany({});
    console.log(`📦 Orders deleted: ${orderResult.deletedCount}`);

    // Clear Dashboard Stats
    const dashResult = await DashboardStats.deleteMany({});
    console.log(`📊 Dashboard Stats deleted: ${dashResult.deletedCount}`);

    // Clear Customers
    const custResult = await Customer.deleteMany({});
    console.log(`👥 Customers deleted: ${custResult.deletedCount}`);

    console.log('\n✅ All data has been reset successfully!');
    console.log('💡 Your database is now empty. Add new categories and menu items from the admin panel.');

  } catch (error) {
    console.error('❌ Error resetting data:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

resetAllData();
