// Killed-state push test
require('dotenv').config();
const mongoose = require('mongoose');
const push = require('./services/pushNotification');
const User = require('./models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await User.findOne({ role: 'admin', pushToken: { $ne: null } });
  if (!admin) { console.log('No admin token'); process.exit(0); }
  
  console.log('Sending KILLED-STATE test to admin...');
  console.log('Token:', admin.pushToken.substring(0, 30) + '...');
  
  const result = await push.sendNotification(
    admin.pushToken,
    '🔥 KILLED APP TEST',
    'If you see this, background notifications WORK! App was force-closed.',
    { type: 'test', screen: 'Orders' },
    'default'
  );
  
  console.log('Result:', JSON.stringify(result));
  console.log(result ? '✅ SENT! Check your phone!' : '❌ Failed');
  
  await mongoose.disconnect();
})();
