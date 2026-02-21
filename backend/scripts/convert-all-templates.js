/**
 * Convert ALL remaining template-literal logger calls to structured format
 * across the entire backend codebase.
 */
const fs = require('fs');
const path = require('path');

const targetFiles = [
  // services
  'services/alerting.js',
  'services/brevoMail.js',
  'services/categoryScheduler.js',
  'services/cartCleanup.js',
  'services/cache.js',
  'services/catalogRatingSync.js',
  'services/dataRetention.js',
  'services/orderCleanup.js',
  'services/polling.js',
  'services/pushNotification.js',
  'services/whatsappBroadcast.js',
  // middleware
  'middleware/authenticate.js',
  'middleware/rateLimiter.js',
  'middleware/authorize.js',
  'middleware/webhookValidation.js',
  'middleware/rateLimiterRedis.js',
  // routes
  'routes/chatbotImages.js',
  'routes/category.js',
  'routes/whatsappBroadcast.js',
];

// Map of specific regex replacements per file
const conversions = [
  // ===== services/alerting.js =====
  {
    file: 'services/alerting.js',
    replacements: [
      // sendConsoleAlert template literals
      { from: /logger\.error\(`\n\$\{emoji\} \[ALERT\] \$\{title\}`\)/g, to: "logger.error('[ALERT] Console alert', { severity, title })" },
      { from: /logger\.error\(`Severity: \$\{severity\.toUpperCase\(\)\}`\)/g, to: "logger.error('[ALERT] Details', { message, timestamp: new Date().toISOString() })" },
      { from: /logger\.error\(`Message: \$\{message\}`\)/g, to: '// (merged into structured alert above)' },
      { from: /logger\.error\(`Timestamp: \$\{new Date\(\)\.toISOString\(\)\}`\)/g, to: '// (merged into structured alert above)' },
      { from: /logger\.info\(`⏭️ \[Alerting\] Skipping alert \(cooldown\): \$\{title\}`\)/g, to: "logger.info('[Alerting] Skipping alert (cooldown)', { title })" },
      { from: /logger\.info\(`\[Alerting\] Alert sent successfully: \$\{title\}`\)/g, to: "logger.info('[Alerting] Alert sent successfully', { title })" },
    ]
  },
  // ===== services/brevoMail.js =====
  {
    file: 'services/brevoMail.js',
    replacements: [
      { from: /logger\.info\(`📧 Order confirmation email sent to \$\{email\}`\)/g, to: "logger.info('Order confirmation email sent', { email })" },
      { from: /logger\.info\(`📧 Delivery notification email sent to \$\{email\}`\)/g, to: "logger.info('Delivery notification email sent', { email })" },
      { from: /logger\.info\(`📧 Status update email sent to \$\{email\} for order \$\{orderId\}`\)/g, to: "logger.info('Status update email sent', { email, orderId })" },
      { from: /logger\.info\(`📧 Report email sent to \$\{to\.join\(', '\)\}`\)/g, to: "logger.info('Report email sent', { recipients: to })" },
      { from: /logger\.info\(`📧 Delivery partner credentials email sent to \$\{email\}`\)/g, to: "logger.info('Delivery partner credentials email sent', { email })" },
      { from: /logger\.error\(`Failed to send order confirmation email[^`]*`/g, to: "logger.error('Failed to send order confirmation email'" },
      { from: /logger\.error\(`Failed to send delivery notification email[^`]*`/g, to: "logger.error('Failed to send delivery notification email'" },
      { from: /logger\.error\(`Failed to send status update email[^`]*`/g, to: "logger.error('Failed to send status update email'" },
    ]
  },
  // ===== services/categoryScheduler.js =====
  {
    file: 'services/categoryScheduler.js',
    replacements: [
      { from: /logger\.info\(`\[Category Scheduler\] Checking \$\{category\.name\}[^`]*`\)/g, to: "logger.info('[Category Scheduler] Checking category', { categoryName: category.name, categoryId: category._id })" },
      { from: /logger\.info\(`\[Category Scheduler\] \$\{category\.name\} is now PAUSED[^`]*`\)/g, to: "logger.info('[Category Scheduler] Category paused', { categoryName: category.name })" },
      { from: /logger\.info\(`\[Category Scheduler\] \$\{category\.name\} is now AVAILABLE[^`]*`\)/g, to: "logger.info('[Category Scheduler] Category available', { categoryName: category.name })" },
      { from: /logger\.info\(`\[Category Scheduler\] \$\{category\.name\} sold-out expired[^`]*`\)/g, to: "logger.info('[Category Scheduler] Sold-out expired', { categoryName: category.name })" },
      { from: /logger\.info\(`\[Category Scheduler\] Made \$\{items\.length\} items available[^`]*`\)/g, to: "logger.info('[Category Scheduler] Items made available', { count: items.length, categoryName: category.name })" },
      { from: /logger\.info\(`\[Category Scheduler\] Processed \$\{categories\.length\} scheduled categories`\)/g, to: "logger.info('[Category Scheduler] Processed scheduled categories', { count: categories.length })" },
      { from: /logger\.error\(`\[Category Scheduler\] Error checking [^`]*`/g, to: "logger.error('[Category Scheduler] Error checking schedules'" },
      { from: /logger\.error\(`\[Category Scheduler\] Error updating[^`]*`/g, to: "logger.error('[Category Scheduler] Error updating status'" },
    ]
  },
  // ===== services/cartCleanup.js =====
  {
    file: 'services/cartCleanup.js',
    replacements: [
      { from: /logger\.info\(`\[Cart Cleanup\] Removed \$\{totalItemsRemoved\}[^`]*`\)/g, to: "logger.info('[Cart Cleanup] Expired items removed', { totalItemsRemoved, customersAffected: customersWithExpiredItems.length })" },
      { from: /logger\.info\(`\[Cart Cleanup\] Sending expiry warning[^`]*`\)/g, to: "logger.info('[Cart Cleanup] Sending expiry warning', { phone: customer.phone })" },
      { from: /logger\.info\(`\[Cart Cleanup\] Sent warnings to \$\{warningsSent\}[^`]*`\)/g, to: "logger.info('[Cart Cleanup] Warnings sent', { count: warningsSent })" },
      { from: /logger\.error\(`\[Cart Cleanup\] Error sending[^`]*`/g, to: "logger.error('[Cart Cleanup] Error sending warning'" },
      { from: /logger\.error\(`\[Cart Cleanup\] Error[^`]*`/g, to: "logger.error('[Cart Cleanup] Cleanup error'" },
    ]
  },
  // ===== services/cache.js =====
  {
    file: 'services/cache.js',
    replacements: [
      { from: /logger\.info\(`\[Cache\] Hit: \$\{key\}`\)/g, to: "logger.info('[Cache] Hit', { key })" },
      { from: /logger\.info\(`\[Cache\] Miss: \$\{key\}`\)/g, to: "logger.info('[Cache] Miss', { key })" },
      { from: /logger\.info\(`\[Cache\] Set: \$\{key\}[^`]*`\)/g, to: "logger.info('[Cache] Set', { key, ttl })" },
      { from: /logger\.info\(`\[Cache\] Del: \$\{key\}`\)/g, to: "logger.info('[Cache] Del', { key })" },
      { from: /logger\.info\(`\[Cache\] Namespace cleared: \$\{namespace\}[^`]*`\)/g, to: "logger.info('[Cache] Namespace cleared', { namespace, keysDeleted: keys.length })" },
      { from: /logger\.info\(`\[Cache\] Warmed \$\{warmed\} cache entries`\)/g, to: "logger.info('[Cache] Warmed cache entries', { count: warmed })" },
      { from: /logger\.error\(`\[Cache\][^`]*`/g, to: "logger.error('[Cache] Operation error'" },
      { from: /logger\.warn\(`\[Cache\][^`]*`/g, to: "logger.warn('[Cache] Warning'" },
    ]
  },
  // ===== services/catalogRatingSync.js =====
  {
    file: 'services/catalogRatingSync.js',
    replacements: [
      { from: /logger\.info\(`\[CatalogRatingSync\] Starting daily rating sync for \$\{menuItemIds\.length\} items`\)/g, to: "logger.info('[CatalogRatingSync] Starting daily rating sync', { itemCount: menuItemIds.length })" },
    ]
  },
  // ===== services/dataRetention.js =====
  {
    file: 'services/dataRetention.js',
    replacements: [
      { from: /logger\.info\(`✅ \[Data Retention\] Cleaned \$\{result\.deletedCount\}[^`]*`\)/g, to: "logger.info('[Data Retention] Cleaned old records', { deletedCount: result.deletedCount, collection: collName })" },
      { from: /logger\.info\(`📊 \[Data Retention\][^`]*`\)/g, to: "logger.info('[Data Retention] Status update')" },
      { from: /logger\.error\(`❌ \[Data Retention\][^`]*`/g, to: "logger.error('[Data Retention] Cleanup error'" },
      { from: /logger\.warn\(`⚠️ \[Data Retention\][^`]*`/g, to: "logger.warn('[Data Retention] Warning'" },
    ]
  },
  // ===== services/orderCleanup.js =====
  {
    file: 'services/orderCleanup.js',
    replacements: [
      { from: /logger\.info\(`📊 Report history saved[^`]*`\)/g, to: "logger.info('[OrderCleanup] Report history saved', { date: dateStr })" },
      { from: /logger\.info\(`📉 Dashboard stats updated[^`]*`\)/g, to: "logger.info('[OrderCleanup] Dashboard stats updated')" },
      { from: /logger\.info\(`🧹 Hiding \$\{ordersToHide\.length\}[^`]*`\)/g, to: "logger.info('[OrderCleanup] Hiding completed orders', { count: ordersToHide.length })" },
      { from: /logger\.info\(`👤 Customer \$\{phone\}[^`]*`\)/g, to: "logger.info('[OrderCleanup] Customer cleaned', { phone })" },
      { from: /logger\.info\(`✅ Cleanup complete[^`]*`\)/g, to: "logger.info('[OrderCleanup] Cleanup complete')" },
      { from: /logger\.error\(`[^`]*cleanup[^`]*`/gi, to: "logger.error('[OrderCleanup] Error'" },
    ]
  },
  // ===== services/polling.js =====
  {
    file: 'services/polling.js',
    replacements: [
      { from: /logger\.info\(`✅ Polling active \(every \$\{intervalMs\}ms\)`\)/g, to: "logger.info('Polling active', { intervalMs })" },
    ]
  },
  // ===== services/pushNotification.js =====
  {
    file: 'services/pushNotification.js',
    replacements: [
      { from: /logger\.info\(`FCM notification sent \(attempt \$\{attempt \+ 1\}\): \$\{response\}`\)/g, to: "logger.info('FCM notification sent', { attempt: attempt + 1, response })" },
      { from: /logger\.info\(`FCM multicast sent: \$\{successCount\}[^`]*`\)/g, to: "logger.info('FCM multicast sent', { successCount, failureCount })" },
      { from: /logger\.warn\(`FCM retry \$\{attempt \+ 1\}[^`]*`\)/g, to: "logger.warn('FCM retry scheduled', { attempt: attempt + 1, maxAttempts, error: error.message })" },
      { from: /logger\.error\(`FCM send error[^`]*`/g, to: "logger.error('FCM send error'" },
      { from: /logger\.info\(`Expo push sent:[^`]*`\)/g, to: "logger.info('Expo push sent', { ticketCount: tickets?.length })" },
      { from: /logger\.info\(`Expo batch sent:[^`]*`\)/g, to: "logger.info('Expo batch sent')" },
      { from: /logger\.error\(`Expo push error[^`]*`/g, to: "logger.error('Expo push error'" },
      { from: /logger\.info\(`Push notification sent to \$\{tokens\.length\}[^`]*`\)/g, to: "logger.info('Push notifications sent', { tokenCount: tokens.length })" },
      { from: /logger\.warn\(`Marking stale token[^`]*`\)/g, to: "logger.warn('Marking stale token')" },
      { from: /logger\.info\(`Sent \$\{sent\} admin[^`]*`\)/g, to: "logger.info('Admin notifications sent', { sent })" },
    ]
  },
  // ===== middleware/authenticate.js =====
  {
    file: 'middleware/authenticate.js',
    replacements: [
      { from: /logger\.info\(`🔐 Authenticated: \$\{req\.user\.role\}[^`]*`\)/g, to: "logger.info('Authenticated user', { role: req.user.role, userId: req.user.id })" },
    ]
  },
  // ===== middleware/rateLimiter.js =====
  {
    file: 'middleware/rateLimiter.js',
    replacements: [
      { from: /logger\.warn\(`⚠️ Rate limit exceeded: \$\{key\}[^`]*`\)/g, to: "logger.warn('Rate limit exceeded', { key, consumedPoints: rateLimiterRes?.consumedPoints })" },
      { from: /logger\.error\(`Rate limiter error[^`]*`/g, to: "logger.error('Rate limiter error'" },
    ]
  },
  // ===== middleware/authorize.js =====
  {
    file: 'middleware/authorize.js',
    replacements: [
      { from: /logger\.warn\(`⚠️ Authorization failed: \$\{userRole\}[^`]*`\)/g, to: "logger.warn('Authorization failed', { userRole, requiredRoles: allowedRoles, path: req.path })" },
      { from: /logger\.warn\(`⚠️ Ownership check failed[^`]*`\)/g, to: "logger.warn('Ownership check failed', { userId: req.user.id, resourceOwner: resourceOwnerId })" },
      { from: /logger\.warn\(`⚠️ IP-based[^`]*`\)/g, to: "logger.warn('IP-based authorization failed', { ip: req.ip })" },
    ]
  },
  // ===== middleware/webhookValidation.js =====
  {
    file: 'middleware/webhookValidation.js',
    replacements: [
      { from: /logger\.warn\(`⚠️ Rate limit exceeded for phone \$\{phone\}[^`]*`\)/g, to: "logger.warn('Webhook rate limit exceeded', { phone })" },
    ]
  },
  // ===== middleware/rateLimiterRedis.js =====
  {
    file: 'middleware/rateLimiterRedis.js',
    replacements: [
      { from: /logger\.warn\(`⚠️ \[RateLimit\] Limit exceeded: \$\{key\}[^`]*`\)/g, to: "logger.warn('[RateLimit] Limit exceeded', { key, consumedPoints: rateLimiterRes?.consumedPoints })" },
      { from: /logger\.warn\(`⚠️ \[RateLimit\][^`]*`\)/g, to: "logger.warn('[RateLimit] Warning')" },
      { from: /logger\.error\(`\[RateLimit\][^`]*`/g, to: "logger.error('[RateLimit] Error'" },
    ]
  },
  // ===== routes/chatbotImages.js =====
  {
    file: 'routes/chatbotImages.js',
    replacements: [
      { from: /logger\.info\(`\[Chatbot Images\] Cache cleared after uploading \$\{key\}`\)/g, to: "logger.info('[Chatbot Images] Cache cleared after upload', { key })" },
      { from: /logger\.info\(`\[Chatbot Images\] Uploading[^`]*`\)/g, to: "logger.info('[Chatbot Images] Uploading image', { key })" },
      { from: /logger\.info\(`\[Chatbot Images\] Uploaded[^`]*`\)/g, to: "logger.info('[Chatbot Images] Upload complete', { key })" },
      { from: /logger\.info\(`\[Chatbot Images\] Deleted[^`]*`\)/g, to: "logger.info('[Chatbot Images] Deleted', { key })" },
      { from: /logger\.error\(`\[Chatbot Images\][^`]*`/g, to: "logger.error('[Chatbot Images] Error'" },
    ]
  },
  // ===== routes/category.js =====
  {
    file: 'routes/category.js',
    replacements: [
      { from: /logger\.info\(`\[Schedule API\] Updating schedule for category \$\{req\.params\.id\}`\)/g, to: "logger.info('[Schedule API] Updating schedule', { categoryId: req.params.id })" },
      { from: /logger\.info\(`\[Schedule API\] Schedule updated[^`]*`\)/g, to: "logger.info('[Schedule API] Schedule updated', { categoryId: req.params.id })" },
      { from: /logger\.info\(`\[Schedule API\][^`]*`\)/g, to: "logger.info('[Schedule API] Operation')" },
      { from: /logger\.error\(`\[Schedule API\][^`]*`/g, to: "logger.error('[Schedule API] Error'" },
      { from: /logger\.info\(`\[Sold-Out API\][^`]*`\)/g, to: "logger.info('[Sold-Out API] Status update')" },
      { from: /logger\.error\(`\[Sold-Out API\][^`]*`/g, to: "logger.error('[Sold-Out API] Error'" },
    ]
  },
  // ===== routes/whatsappBroadcast.js =====
  {
    file: 'routes/whatsappBroadcast.js',
    replacements: [
      { from: /logger\.info\(`\[WhatsApp Broadcast\] Starting offer broadcast[^`]*`\)/g, to: "logger.info('[WhatsApp Broadcast] Starting offer broadcast')" },
      { from: /logger\.info\(`\[WhatsApp Broadcast\] Sending[^`]*`\)/g, to: "logger.info('[WhatsApp Broadcast] Sending broadcast message')" },
      { from: /logger\.info\(`\[WhatsApp Broadcast\] Completed[^`]*`\)/g, to: "logger.info('[WhatsApp Broadcast] Broadcast completed')" },
      { from: /logger\.error\(`\[WhatsApp Broadcast\][^`]*`/g, to: "logger.error('[WhatsApp Broadcast] Error'" },
    ]
  },
  // ===== services/whatsappBroadcast.js =====
  {
    file: 'services/whatsappBroadcast.js',
    replacements: [
      { from: /logger\.error\(`\[WhatsApp Broadcast\] Error applying offer to \$\{phone\}`\)/g, to: "logger.error('[WhatsApp Broadcast] Error applying offer', { phone })" },
    ]
  },
];

let totalConverted = 0;

for (const config of conversions) {
  const filePath = path.join(__dirname, '..', config.file);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP: ${config.file} (not found)`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  let fileConverted = 0;

  for (const rule of config.replacements) {
    const before = content;
    content = content.replace(rule.from, rule.to);
    const matches = (before.length - content.replace(rule.from, rule.to).length);
    if (before !== content) {
      fileConverted++;
    }
  }

  if (fileConverted > 0) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ ${config.file}: ${fileConverted} conversions`);
    totalConverted += fileConverted;
  } else {
    console.log(`⚪ ${config.file}: no matches (may already be converted)`);
  }
}

console.log(`\nTotal: ${totalConverted} conversions applied`);

// === Final check: count remaining template literals ===
const allFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'coverage', '__tests__', 'build', 'scripts'].includes(entry.name)) {
        walk(p);
      }
    } else if (entry.name.endsWith('.js')) {
      allFiles.push(p);
    }
  }
}
walk(path.join(__dirname, '..'));

let remaining = 0;
const remainingDetails = [];
for (const f of allFiles) {
  const lines = fs.readFileSync(f, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    if (/logger\.(info|error|warn|debug)\(`/.test(line)) {
      remaining++;
      const relPath = path.relative(path.join(__dirname, '..'), f);
      remainingDetails.push(`  ${relPath}:${i + 1}: ${line.trim().substring(0, 100)}`);
    }
  });
}

console.log(`\nRemaining template-literal logger calls: ${remaining}`);
if (remaining > 0) {
  remainingDetails.forEach(d => console.log(d));
}
