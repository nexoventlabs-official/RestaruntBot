// config/restaurant.config.js
// SYNHA — Restaurant Configuration (Loop 2)
// This is the ONLY file that changes per client.
//
// RULES:
//   - Business identity / content lives here.
//   - SECRETS DO NOT LIVE HERE. Credential fields below read from .env via
//     process.env so secrets stay in .env (per SYNHA Loop 2 constraint).
//   - Changing the values in this file changes the entire bot identity
//     without touching any flow logic.

module.exports = {

  // ── BUSINESS IDENTITY ────────────────────────────────────────────────
  businessName:        'Perivi Hotel',
  tagline:             'Powered by JRB Gold',
  logoUrl:             '',

  // ── CONTACT ──────────────────────────────────────────────────────────
  ownerPhone:          process.env.RESTAURANT_PHONE || '',   // owner notifications (Loop 3) go here
  supportPhone:        process.env.SUPPORT_PHONE || process.env.RESTAURANT_PHONE || '',
  address:             process.env.RESTAURANT_ADDRESS || '',

  // ── WEB / LINKS ──────────────────────────────────────────────────────
  websiteUrl:          'https://restarunt-bot.vercel.app/',
  frontendUrl:         process.env.FRONTEND_URL || 'https://restarunt-bot.vercel.app',

  // ── WORKING HOURS ────────────────────────────────────────────────────
  // NOTE: live delivery/hours parameters are stored in the Settings DB
  // collection and read dynamically; these are deployment defaults only.
  workingHours: {
    open:              '09:00',
    close:             '22:00',
    days:              ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    timezone:          'Asia/Kolkata',
  },
  offlineMessage:      '',

  // ── WHATSAPP (secrets — sourced from .env, not stored here) ───────────
  whatsappNumberId:    process.env.META_PHONE_NUMBER_ID || '',
  metaToken:           process.env.META_ACCESS_TOKEN || '',
  verifyToken:         process.env.META_VERIFY_TOKEN || '',

  // ── PAYMENT (secrets — sourced from .env, not stored here) ────────────
  paymentEnabled:      true,
  razorpayKeyId:       process.env.RAZORPAY_KEY_ID || '',
  razorpaySecret:      process.env.RAZORPAY_KEY_SECRET || '',
  upiId:               process.env.MERCHANT_UPI_VPA || '',
  currency:            'INR',
  referencePrefix:     'ORD-',

  // ── DELIVERY (deployment defaults; live values in Settings DB) ────────
  deliveryAvailable:   true,
  deliveryRadius:      5,     // km
  minimumOrder:        150,   // INR
  deliveryCharge:      30,    // INR

  // ── DATABASE (secrets — sourced from .env, not stored here) ───────────
  mongoUri:            process.env.MONGODB_URI || process.env.MONGO_URI || '',
  redisUrl:            process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : '',

  // ── CONTENT ──────────────────────────────────────────────────────────
  greetingMessage:     '',   // reserved (Loop 2 keeps existing greeting construction)
  confirmationMessage: '',   // reserved

  // Owner notification (Loop 3). Placeholders: {reference} {customerName}
  // {customerPhone} {items} {total} {type} {time}
  ownerNotifyTemplate:
    '🔔 New Order — {reference}\n\n' +
    'Customer: {customerName} ({customerPhone})\n' +
    'Items: {items}\n' +
    'Total: ₹{total}\n' +
    'Type: {type}\n' +
    'Time: {time}',

  // ── AI (Rule #2: deterministic flows only until v3 — keep OFF for v0/v1) ──
  aiSearchMatching:     false,   // groqAi tag-matching for non-English menu search
  aiVoiceTranscription: false,   // groqAi transcription of voice notes

  // ── CRM BRIDGE (Loop 5) — leave URL empty until SIGNAL CRM is located ──
  crmWebhookUrl:       process.env.CRM_WEBHOOK_URL || '',
  crmApiKey:           process.env.CRM_API_KEY || '',
  systemSource:        'synha-restarunt',
};
