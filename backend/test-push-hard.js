/**
 * HARD TEST: Push Notification End-to-End
 * 
 * Connects to real DB, finds all tokens, sends a test push,
 * and reports exactly what happened.
 * 
 * Re-run this AFTER rebuilding the APK and re-logging in.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const pushNotification = require('./services/pushNotification');
const User = require('./models/User');
const DeliveryBoy = require('./models/DeliveryBoy');

(async () => {
  console.log('============================================');
  console.log('   HARD PUSH NOTIFICATION TEST');
  console.log('============================================\n');

  // 1. Connect to MongoDB
  console.log('[1] Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('    ✅ Connected to MongoDB\n');
  } catch (err) {
    console.error('    ❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  // 2. Find all users & delivery boys with push tokens
  console.log('[2] Finding devices with push tokens...');
  const users = await User.find({ pushToken: { $ne: null } }).select('name email role pushToken').lean();
  const deliveryBoys = await DeliveryBoy.find({ pushToken: { $ne: null } }).select('name phone pushToken').lean();
  
  const allTokens = [
    ...users.map(u => ({ name: u.name || u.email || 'unnamed', token: u.pushToken, source: `User(${u.role})` })),
    ...deliveryBoys.map(d => ({ name: d.name, token: d.pushToken, source: 'DeliveryBoy' })),
  ];

  // Deduplicate
  const uniqueTokens = [...new Map(allTokens.map(t => [t.token, t])).values()];

  console.log(`    Found ${uniqueTokens.length} unique token(s):\n`);
  
  let hasExpoTokens = false;
  let hasFcmTokens = false;
  
  for (const { name, token, source } of uniqueTokens) {
    const isExpo = token.startsWith('ExponentPushToken');
    if (isExpo) hasExpoTokens = true;
    else hasFcmTokens = true;
    
    const type = isExpo ? '⚠️  EXPO' : '✅ FCM';
    console.log(`    ${type} | ${name} (${source})`);
    console.log(`         Token: ${token.substring(0, 50)}...`);
  }

  if (hasExpoTokens && !hasFcmTokens) {
    console.log('\n    ⚠️  ALL tokens are Expo Push Tokens!');
    console.log('    These require Expo FCM credentials configured on expo.dev.');
    console.log('    After rebuilding the APK with the fixed code and re-logging in,');
    console.log('    you will get native FCM tokens that work with firebase-admin directly.');
    console.log('    ─────────────────────────────────────────────');
  }
  
  if (uniqueTokens.length === 0) {
    console.log('\n    ⚠️ No push tokens in DB. Cannot test.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 3. Send test notifications
  console.log('\n[3] Sending test notifications...');
  console.log('    ──────────────────────────────────────\n');
  
  let successCount = 0;
  let failCount = 0;

  for (const { name, token, source } of uniqueTokens) {
    const isExpo = token.startsWith('ExponentPushToken');
    const type = isExpo ? 'EXPO' : 'FCM';
    console.log(`    → ${name} (${source}, ${type})`);
    
    try {
      const result = await pushNotification.sendTestNotification(token);
      
      if (result.success) {
        console.log(`      ✅ SUCCESS! ${result.messageId ? 'FCM ID: ' + result.messageId : 'Delivered'}`);
        successCount++;
      } else if (result.error) {
        console.log(`      ❌ FAILED: ${result.error}`);
        failCount++;
        
        if (isExpo && result.error.includes('FCM server key')) {
          console.log('      💡 FIX: Rebuild APK → re-login → native FCM token will replace this Expo token');
        }
      }
    } catch (err) {
      console.log(`      ❌ EXCEPTION: ${err.message}`);
      failCount++;
    }
    console.log('');
  }

  // 4. Summary
  console.log('============================================');
  console.log('   RESULTS');
  console.log('============================================');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed:  ${failCount}`);
  
  if (failCount > 0 && hasExpoTokens) {
    console.log('\n   ⚡ ACTION REQUIRED:');
    console.log('   The app code has been fixed to get native FCM tokens.');
    console.log('   Steps to make push notifications work:');
    console.log('   1. Rebuild APK:  cd app && npx eas build --platform android --profile preview');
    console.log('   2. Install the new APK on your phone');
    console.log('   3. Log in again (this registers the native FCM token)');
    console.log('   4. Run this test again:  node test-push-hard.js');
    console.log('   5. You should see ✅ FCM tokens and SUCCESS!\n');
  } else if (successCount > 0) {
    console.log('\n   🎉 Push notifications are working!');
    console.log('   Check your phone — you should see the notification.\n');
  }

  await mongoose.disconnect();
  process.exit(0);
})();
