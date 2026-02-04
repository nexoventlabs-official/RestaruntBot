require('dotenv').config();
const googleSheets = require('./services/googleSheets');

async function reformatAllSheets() {
  console.log('🔄 Starting sheet reformatting...\n');
  
  // Reformat Customers sheet
  console.log('📊 Reformatting Customers sheet...');
  const customersResult = await googleSheets.reformatCustomersSheet();
  console.log(customersResult.success ? '   ✅ Done' : `   ❌ Failed: ${customersResult.error}\n`);
  
  // Reformat WhatsApp Contacts sheet
  console.log('📊 Reformatting WhatsApp Contacts sheet...');
  const contactsResult = await googleSheets.reformatWhatsAppContactsSheet();
  console.log(contactsResult.success ? '   ✅ Done' : `   ❌ Failed: ${contactsResult.error}\n`);
  
  // Reformat Daily Reports sheet
  console.log('📊 Reformatting Daily Reports sheet...');
  const reportsResult = await googleSheets.reformatDailyReportsSheet();
  console.log(reportsResult.success ? '   ✅ Done' : `   ❌ Failed: ${reportsResult.error}\n`);
  
  console.log('\n✅ All sheets reformatted!');
  process.exit(0);
}

reformatAllSheets().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
