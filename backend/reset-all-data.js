// Script to reset ALL data - MongoDB, Google Sheets, and Cloudinary
// Usage: node reset-all-data.js
require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const Order = require('./models/Order');
const Customer = require('./models/Customer');
const DashboardStats = require('./models/DashboardStats');
const ReportHistory = require('./models/ReportHistory');
const WhatsAppContact = require('./models/WhatsAppContact');
const googleSheets = require('./services/googleSheets');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase());
    });
  });
}

async function resetAllData() {
  console.log('\n' + '='.repeat(60));
  console.log('🔴 COMPLETE DATA RESET SCRIPT');
  console.log('='.repeat(60));
  console.log('\nThis will reset:');
  console.log('  📦 MongoDB: Orders, Customers, DashboardStats, ReportHistory');
  console.log('  📊 Google Sheets: All order sheets, customers, contacts, reports');
  console.log('\n⚠️  This action CANNOT be undone!\n');

  const confirm = await askQuestion('Are you sure you want to continue? (yes/no): ');
  
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('\n❌ Reset cancelled.\n');
    rl.close();
    process.exit(0);
  }

  try {
    // Connect to MongoDB
    console.log('\n🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('='.repeat(60));
    console.log('🗑️  CLEARING MONGODB DATA');
    console.log('='.repeat(60) + '\n');

    // Clear Orders
    const orderResult = await Order.deleteMany({});
    console.log(`📦 Orders deleted: ${orderResult.deletedCount}`);

    // Clear Customers
    const custResult = await Customer.deleteMany({});
    console.log(`👥 Customers deleted: ${custResult.deletedCount}`);

    // Clear Dashboard Stats
    const dashResult = await DashboardStats.deleteMany({});
    console.log(`📊 Dashboard Stats deleted: ${dashResult.deletedCount}`);

    // Clear Report History
    const reportResult = await ReportHistory.deleteMany({});
    console.log(`📈 Report History deleted: ${reportResult.deletedCount}`);

    // Clear WhatsApp Contacts (if model exists)
    try {
      const whatsappResult = await WhatsAppContact.deleteMany({});
      console.log(`📱 WhatsApp Contacts deleted: ${whatsappResult.deletedCount}`);
    } catch (e) {
      console.log(`📱 WhatsApp Contacts: Model not found or empty`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 CLEARING GOOGLE SHEETS');
    console.log('='.repeat(60) + '\n');

    // Clear all Google Sheets
    const sheetsResult = await googleSheets.clearAllSheets();
    
    console.log('\nSheets clear results:');
    console.log('  📦 Order Sheets:', JSON.stringify(sheetsResult.orders?.results || 'N/A'));
    console.log('  👥 Customers:', sheetsResult.customers?.success ? `Cleared ${sheetsResult.customers.clearedRows || 0} rows` : sheetsResult.customers?.error);
    console.log('  📱 WhatsApp Contacts:', sheetsResult.whatsappContacts?.success ? `Cleared ${sheetsResult.whatsappContacts.clearedRows || 0} rows` : sheetsResult.whatsappContacts?.error);
    console.log('  📊 Daily Reports:', sheetsResult.dailyReports?.success ? sheetsResult.dailyReports.message : sheetsResult.dailyReports?.error);
    console.log('  📈 Dashboard Stats:', sheetsResult.dashboardStats?.success ? sheetsResult.dashboardStats.message : sheetsResult.dashboardStats?.error);

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL DATA RESET COMPLETE!');
    console.log('='.repeat(60));
    console.log('\n📋 Summary:');
    console.log(`   - MongoDB collections cleared`);
    console.log(`   - Google Sheets reset with fresh headers`);
    console.log(`   - Customers: Phone | Name | Orders Count | Total Spent | First Order | Last Order`);
    console.log(`   - Daily reports: Date | Revenue | Total Orders | Delivered | Cancelled | Refunded | COD Orders | UPI Orders | Items Sold | Top Items`);
    console.log('\n💡 You can now start fresh with new data.\n');

  } catch (error) {
    console.error('\n❌ Error during reset:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
    rl.close();
  }
}

resetAllData();
