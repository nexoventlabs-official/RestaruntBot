// Quick DB token check
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const DeliveryBoy = require('./models/DeliveryBoy');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const users = await User.find({}).select('name role pushToken').lean();
  const dbs = await DeliveryBoy.find({}).select('name pushToken').lean();
  
  console.log('\n=== USERS ===');
  users.forEach(u => {
    const t = u.pushToken;
    const type = !t ? 'NULL' : t.startsWith('Exponent') ? 'EXPO' : 'FCM';
    console.log(`  ${u.name || 'unnamed'} (${u.role}) => ${type}${t ? ': ' + t.substring(0, 50) + '...' : ''}`);
  });
  
  console.log('\n=== DELIVERY BOYS ===');
  dbs.forEach(d => {
    const t = d.pushToken;
    const type = !t ? 'NULL' : t.startsWith('Exponent') ? 'EXPO' : 'FCM';
    console.log(`  ${d.name} => ${type}${t ? ': ' + t.substring(0, 50) + '...' : ''}`);
  });
  
  await mongoose.disconnect();
})();
