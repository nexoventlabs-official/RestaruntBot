require('dotenv').config();
const googleSheets = require('./services/googleSheets');

async function reformatAllSheets() {
  console.log('🔄 Starting sheet reformatting...\n');
  
  // Reformat Customers sheet
  console.log('📊 Reformatting Customers sheet...');
  const customersResult = await googleSheets.reformatCustomersSheet();
  console.log(customersResult.success ? '   ✅ Done' : `   ❌ Failed: ${customersResult.error}\n`);
  
  // Skip WhatsApp Contacts sheet - no longer needed, data is in customers sheet
  console.log('📊 Skipping WhatsApp Contacts sheet (no longer needed)');
  
  // Reformat Daily Reports sheet
  console.log('📊 Reformatting Daily Reports sheet...');
  const reportsResult = await googleSheets.reformatDailyReportsSheet();
  console.log(reportsResult.success ? '   ✅ Done' : `   ❌ Failed: ${reportsResult.error}\n`);
  
  console.log('\n✅ All sheets reformatted!');
  console.log('\n💡 You can now delete the whatsapp_contacts sheet from Google Sheets - all data is in customers sheet.');
  process.exit(0);
}

reformatAllSheets().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
