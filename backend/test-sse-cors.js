process.env.NODE_ENV = 'production';
process.env.FRONTEND_URL = 'https://restarunt-bot.vercel.app';

try {
  const { normalizeOrigin, getAllowedOrigins } = require('./config/corsConfig');

  const testOrigins = [
    'https://restarunt-bot.vercel.app',
    'https://restarunt-bot.vercel.app/',
    'HTTPS://RESTARUNT-BOT.VERCEL.APP',
    'https://restarunt-bot-git-main-user.vercel.app',
    'https://restaurant-bot.vercel.app'
  ];

  const allowed = getAllowedOrigins();
  console.log('Allowed origins:', JSON.stringify(allowed, null, 2));
  console.log('');

  testOrigins.forEach(origin => {
    const normalized = normalizeOrigin(origin);
    const isAllowed = allowed.includes(normalized);
    console.log(`'${origin}' → '${normalized}' → ${isAllowed ? 'ALLOWED' : 'BLOCKED'}`);
  });
  
  process.exit(0);
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
