require('dotenv').config();
const googleSheets = require('./services/googleSheets');

async function reformatAllSheets() {
  console.log('🔄 Starting sheet reformatting (Bold + Center styling)...\n');
  
  // Reformat Customers sheet
  console.log('📊 Reformatting Customers sheet...');
  const customersResult = await googleSheets.reformatCustomersSheet();
  console.log(customersResult.success ? '   ✅ Done' : `   ❌ Failed: ${customersResult.error}\n`);
  
  // Reformat Daily Reports sheet
  console.log('📊 Reformatting Daily Reports sheet...');
  const reportsResult = await googleSheets.reformatDailyReportsSheet();
  console.log(reportsResult.success ? '   ✅ Done' : `   ❌ Failed: ${reportsResult.error}\n`);
  
  // Reformat Dashboard Stats sheet
  console.log('📊 Reformatting Dashboard Stats sheet...');
  const dashboardResult = await googleSheets.reformatDashboardStatsSheet();
  console.log(dashboardResult.success ? '   ✅ Done' : `   ❌ Failed: ${dashboardResult.error}\n`);
  
  console.log('\n✅ All 3 sheets reformatted with Bold + Center styling!');
  process.exit(0);
}

reformatAllSheets().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
