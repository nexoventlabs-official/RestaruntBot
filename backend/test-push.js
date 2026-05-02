/**
 * One-shot push notification diagnostic.
 *
 * What it does:
 *   1. Connects to MongoDB.
 *   2. Lists every admin / superadmin user that has a stored pushToken.
 *   3. Logs the token type (FCM v4 / FCM legacy / Expo) + last-refreshed timestamp.
 *   4. Sends ONE test notification to each token via firebase-admin.
 *   5. Prints the FCM message ID on success or the FCM error code on failure.
 *
 * Use to figure out which layer is failing:
 *   - "No admin with push token found"   → app never registered the token.
 *      Open app, log in, and re-run.
 *   - "messaging/registration-token-not-registered" → token is stale.
 *      Reinstall app and log in again so a fresh FCM token is registered.
 *   - "FCM notification sent ... ok"     → FCM accepted it. If the phone
 *      still doesn't show it, the issue is on the device (battery
 *      optimisation killed the listener, channel disabled in OS settings,
 *      or POST_NOTIFICATIONS not granted). Open phone Settings → Apps →
 *      FoodAdmin → Notifications and Battery → Don't optimise.
 *   - "Firebase not initialised"         → backend is missing one of
 *      FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 *      env vars. Set them and restart the backend.
 *
 * Run:
 *   node backend/test-push.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const pushNotification = require('./services/pushNotification');

function tokenType(t) {
  if (!t) return 'none';
  if (t.startsWith('ExponentPushToken[')) return 'expo';
  // FCM v1 tokens are ~152+ chars. Older legacy tokens are shorter but
  // still alphanumeric with `:`. Both go through firebase-admin fine.
  if (t.includes(':')) return 'fcm';
  return 'unknown';
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  PUSH NOTIFICATION DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════\n');

  if (!process.env.MONGODB_URI) {
    console.log('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('[1] Firebase Admin status...');
  const fbReady = (require('firebase-admin').apps.length > 0);
  console.log(`    ${fbReady ? '✅' : '❌'} firebase-admin ${fbReady ? 'initialised' : 'NOT initialised — push will fail'}`);
  if (!fbReady) {
    console.log('       Required env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY\n');
  }

  console.log('\n[2] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('    ✅ Connected');

  const db = mongoose.connection.db;
  const users = await db.collection('users')
    .find({ pushToken: { $ne: null } })
    .project({ name: 1, username: 1, role: 1, pushToken: 1, pushTokenUpdatedAt: 1, lastLogin: 1 })
    .toArray();

  console.log(`\n[3] Admin / superadmin users with push tokens: ${users.length}`);
  if (users.length === 0) {
    console.log('    ❌ Nobody has a push token registered in the DB.');
    console.log('       The app never sent the token to the backend.');
    console.log('       Steps: open app → log in → check backend logs for');
    console.log('       "Admin/superadmin push token registered".\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  users.forEach((u, i) => {
    const t = u.pushToken;
    console.log(`\n    ${i + 1}. ${u.name || u.username} (${u.role})`);
    console.log(`       type:    ${tokenType(t)}`);
    console.log(`       token:   ${t.substring(0, 40)}...${t.substring(t.length - 8)}`);
    console.log(`       length:  ${t.length} chars`);
    if (u.pushTokenUpdatedAt) {
      console.log(`       updated: ${new Date(u.pushTokenUpdatedAt).toISOString()}`);
    }
    if (u.lastLogin) {
      console.log(`       last login: ${new Date(u.lastLogin).toISOString()}`);
    }
  });

  console.log('\n[4] Sending test notification to each token...\n');
  for (const u of users) {
    const label = `${u.name || u.username} (${u.role})`;
    process.stdout.write(`    → ${label} ... `);
    try {
      const result = await pushNotification.sendTestNotification(u.pushToken);
      if (result?.success) {
        console.log(`✅ FCM accepted (messageId: ${result.messageId})`);
      } else if (result?.error) {
        console.log(`❌ FCM rejected: ${result.error}${result.code ? ' [' + result.code + ']' : ''}`);
      } else {
        console.log(`❓ ${JSON.stringify(result)}`);
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  DONE — check the device(s) for the test push.');
  console.log('═══════════════════════════════════════════════');
  console.log('\nIf FCM said "accepted" but the phone shows nothing:');
  console.log('  • Pull down notifications shade — is it there?');
  console.log('  • Go to Settings → Apps → FoodAdmin → Notifications');
  console.log('    Make sure ALL channels are ON (especially Default,');
  console.log('    New Orders, Order Updates).');
  console.log('  • Settings → Apps → FoodAdmin → Battery → Unrestricted');
  console.log('    On Xiaomi/Realme/Vivo also enable "Autostart".\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
