// Script to reset all MongoDB data (categories, menu items, orders, dashboard stats, customers, report history)
// Also clears Cloudinary images
require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const Category = require('./models/Category');
const MenuItem = require('./models/MenuItem');
const Order = require('./models/Order');
const DashboardStats = require('./models/DashboardStats');
const Customer = require('./models/Customer');
const ReportHistory = require('./models/ReportHistory');
const DeliveryBoy = require('./models/DeliveryBoy');
const ChatbotImage = require('./models/ChatbotImage');
const Banner = require('./models/Banner');
const Offer = require('./models/Offer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function deleteCloudinaryFolder(folderPath) {
  try {
    // Get all resources in the folder
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: folderPath,
      max_results: 500
    });
    
    if (result.resources.length === 0) {
      console.log(`   📁 No images in ${folderPath}`);
      return 0;
    }
    
    // Delete all resources
    const publicIds = result.resources.map(r => r.public_id);
    await cloudinary.api.delete_resources(publicIds);
    
    console.log(`   🗑️ Deleted ${publicIds.length} images from ${folderPath}`);
    return publicIds.length;
  } catch (error) {
    if (error.error?.http_code === 404) {
      console.log(`   📁 Folder ${folderPath} not found (already empty)`);
      return 0;
    }
    console.error(`   ⚠️ Error deleting ${folderPath}:`, error.message);
    return 0;
  }
}

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

    // Clear Report History
    const reportResult = await ReportHistory.deleteMany({});
    console.log(`📈 Report History deleted: ${reportResult.deletedCount}`);

    // Clear Delivery Boys
    const deliveryResult = await DeliveryBoy.deleteMany({});
    console.log(`🚴 Delivery Boys deleted: ${deliveryResult.deletedCount}`);

    // Clear Chatbot Images
    const chatbotResult = await ChatbotImage.deleteMany({});
    console.log(`🤖 Chatbot Images deleted: ${chatbotResult.deletedCount}`);

    // Clear Banners
    const bannerResult = await Banner.deleteMany({});
    console.log(`🖼️ Banners deleted: ${bannerResult.deletedCount}`);

    // Clear Offers
    const offerResult = await Offer.deleteMany({});
    console.log(`🏷️ Offers deleted: ${offerResult.deletedCount}`);

    // Clear Cloudinary images
    console.log('\n☁️ Clearing Cloudinary images...\n');
    
    let totalCloudinaryDeleted = 0;
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/menu');
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/categories');
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/banners');
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/offers');
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/delivery-boys');
    totalCloudinaryDeleted += await deleteCloudinaryFolder('restaurant-bot/chatbot');
    
    console.log(`\n☁️ Total Cloudinary images deleted: ${totalCloudinaryDeleted}`);

    console.log('\n✅ All data has been reset successfully!');
    console.log('💡 Your database and Cloudinary storage are now empty.');
    console.log('💡 Add new categories and menu items from the admin panel.');

  } catch (error) {
    console.error('❌ Error resetting data:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

resetAllData();
