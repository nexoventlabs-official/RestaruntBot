/**
 * Welcome Flow Fix - Interactive Guide
 * 
 * This script provides an interactive menu to help you fix your Welcome Flow.
 * 
 * Usage: node fix-welcome-flow.js
 */

require('dotenv').config();
const readline = require('readline');
const logger = require('./services/logger');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function displayMenu() {
  console.clear();
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║       🔧 WELCOME FLOW RECOVERY TOOL 🔧               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('What would you like to do?');
  console.log('');
  console.log('  1. 📋 List all existing flows');
  console.log('  2. 💾 Backup current welcome flow');
  console.log('  3. 🚀 Create new Welcome Flow v50');
  console.log('  4. 🔄 Full recovery (backup + create new)');
  console.log('  5. ℹ️  Show current configuration');
  console.log('  6. 📖 View recovery guide');
  console.log('  0. ❌ Exit');
  console.log('');
}

async function showCurrentConfig() {
  console.log('\n📊 CURRENT CONFIGURATION');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Welcome Flow ID: ${process.env.WHATSAPP_WELCOME_FLOW_ID || 'Not set'}`);
  console.log(`Welcome Flow Status: ${process.env.WHATSAPP_WELCOME_FLOW_STATUS || 'Unknown'}`);
  console.log(`Order Flow ID: ${process.env.WHATSAPP_ORDER_FLOW_ID || 'Not set'}`);
  console.log(`Business Account ID: ${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || 'Not set'}`);
  console.log(`Access Token: ${process.env.WHATSAPP_ACCESS_TOKEN ? '✓ Set' : '✗ Not set'}`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  await question('Press Enter to continue...');
}

async function listFlows() {
  console.log('\n📋 Fetching flows from Meta...\n');
  try {
    const { listAllFlows } = require('./list-all-flows.js');
    await listAllFlows();
    await question('\nPress Enter to continue...');
  } catch (error) {
    console.error('Failed to list flows:', error.message);
    await question('\nPress Enter to continue...');
  }
}

async function backupFlow() {
  console.log('\n💾 Backing up current welcome flow...\n');
  try {
    const { backupWelcomeFlow } = require('./backup-welcome-flow.js');
    await backupWelcomeFlow();
    await question('\nPress Enter to continue...');
  } catch (error) {
    console.error('Failed to backup flow:', error.message);
    await question('\nPress Enter to continue...');
  }
}

async function createNewFlow() {
  console.log('\n🚀 Creating new Welcome Flow v50...\n');
  
  const confirm = await question('This will create a new flow in Meta. Continue? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    await question('\nPress Enter to continue...');
    return;
  }
  
  try {
    const { createWelcomeFlowV50 } = require('./create-welcome-flow-v50.js');
    const result = await createWelcomeFlowV50();
    
    console.log('\n📝 NEXT STEPS:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('1. Update your .env file:');
    console.log(`   WHATSAPP_WELCOME_FLOW_ID=${result.flowId}`);
    console.log('');
    console.log('2. Restart your backend server');
    console.log('');
    console.log('3. Test by sending a message to your WhatsApp bot');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const updateEnv = await question('Would you like to update .env automatically? (y/n): ');
    if (updateEnv.toLowerCase() === 'y') {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      
      // Update or add WHATSAPP_WELCOME_FLOW_ID
      if (envContent.includes('WHATSAPP_WELCOME_FLOW_ID=')) {
        envContent = envContent.replace(
          /WHATSAPP_WELCOME_FLOW_ID=.*/,
          `WHATSAPP_WELCOME_FLOW_ID=${result.flowId}`
        );
      } else {
        envContent += `\nWHATSAPP_WELCOME_FLOW_ID=${result.flowId}\n`;
      }
      
      fs.writeFileSync(envPath, envContent);
      console.log('✅ .env file updated successfully!');
      console.log('⚠️  Remember to restart your backend server!');
    }
    
    await question('\nPress Enter to continue...');
  } catch (error) {
    console.error('Failed to create flow:', error.message);
    await question('\nPress Enter to continue...');
  }
}

async function fullRecovery() {
  console.log('\n🔄 FULL RECOVERY PROCESS');
  console.log('═══════════════════════════════════════════════════════');
  console.log('This will:');
  console.log('  1. Backup your current welcome flow');
  console.log('  2. Create a new Welcome Flow v50');
  console.log('  3. Update your .env file');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const confirm = await question('Continue with full recovery? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    await question('\nPress Enter to continue...');
    return;
  }
  
  // Step 1: Backup
  console.log('\n📍 Step 1/2: Backing up current flow...');
  try {
    const { backupWelcomeFlow } = require('./backup-welcome-flow.js');
    await backupWelcomeFlow();
    console.log('✅ Backup completed');
  } catch (error) {
    console.log('⚠️  Backup failed (this is okay if no flow exists yet)');
    console.log('   Error:', error.message);
  }
  
  // Step 2: Create new flow
  console.log('\n📍 Step 2/2: Creating new Welcome Flow v50...');
  try {
    const { createWelcomeFlowV50 } = require('./create-welcome-flow-v50.js');
    const result = await createWelcomeFlowV50();
    
    // Update .env
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    if (envContent.includes('WHATSAPP_WELCOME_FLOW_ID=')) {
      envContent = envContent.replace(
        /WHATSAPP_WELCOME_FLOW_ID=.*/,
        `WHATSAPP_WELCOME_FLOW_ID=${result.flowId}`
      );
    } else {
      envContent += `\nWHATSAPP_WELCOME_FLOW_ID=${result.flowId}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    
    console.log('\n✅ RECOVERY COMPLETE!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✓ Backup saved to backups/ directory');
    console.log('✓ New flow created and published');
    console.log('✓ .env file updated');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n⚠️  IMPORTANT: Restart your backend server now!');
    console.log('═══════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ Recovery failed:', error.message);
  }
  
  await question('\nPress Enter to continue...');
}

async function showGuide() {
  console.log('\n📖 RECOVERY GUIDE');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('PROBLEM:');
  console.log('  The Welcome Flow JSON was accidentally modified in');
  console.log('  Meta\'s interface, causing flow issues.');
  console.log('');
  console.log('SOLUTION:');
  console.log('  Create a fresh Welcome Flow v50 from your codebase.');
  console.log('');
  console.log('STEPS:');
  console.log('  1. Use option 4 (Full recovery) for automatic process');
  console.log('  2. Or manually: backup → create new → update .env');
  console.log('  3. Restart your backend server');
  console.log('  4. Test the welcome flow');
  console.log('');
  console.log('VERIFICATION:');
  console.log('  • Send a message to your WhatsApp bot');
  console.log('  • Verify the welcome flow appears');
  console.log('  • Check banner and service icons display');
  console.log('  • Test service selection');
  console.log('  • Confirm food type screen works');
  console.log('');
  console.log('For detailed guide, see: WELCOME_FLOW_RECOVERY.md');
  console.log('═══════════════════════════════════════════════════════\n');
  
  await question('Press Enter to continue...');
}

async function main() {
  let running = true;
  
  while (running) {
    displayMenu();
    const choice = await question('Enter your choice (0-6): ');
    
    switch (choice.trim()) {
      case '1':
        await listFlows();
        break;
      case '2':
        await backupFlow();
        break;
      case '3':
        await createNewFlow();
        break;
      case '4':
        await fullRecovery();
        break;
      case '5':
        await showCurrentConfig();
        break;
      case '6':
        await showGuide();
        break;
      case '0':
        console.log('\n👋 Goodbye!\n');
        running = false;
        break;
      default:
        console.log('\n❌ Invalid choice. Please try again.\n');
        await question('Press Enter to continue...');
    }
  }
  
  rl.close();
  process.exit(0);
}

// Run the interactive menu
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    rl.close();
    process.exit(1);
  });
}

module.exports = { main };
