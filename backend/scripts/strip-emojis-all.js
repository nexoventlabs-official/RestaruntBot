const fs = require('fs');
const path = require('path');
const glob = require('path');

// Files that use emojis in logger calls
const files = [
  'routes/webhook.js',
  'routes/payment.js',
  'services/metaCloud.js',
  'services/orderStateMachine.js',
  'services/pushNotification.js',
  'services/orderReconciliation.js',
  'services/outboundRetryWorker.js',
  'services/dashboardStatsSync.js',
  'services/pushTokenCleanup.js',
];

let totalCount = 0;

for (const relPath of files) {
  const file = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(file)) continue;
  
  let content = fs.readFileSync(file, 'utf8');
  let count = 0;

  // Strip emoji prefixes from logger calls
  content = content.replace(/(logger\.(?:info|error|warn)\()(['"`])([\u{2705}\u{274C}\u{26A0}\u{FE0F}\u{1F4CB}\u{1F4E6}\u{1F4CA}\u{1F4F1}\u{1F527}\u{1F69A}\u{1F4E5}\u{1F9F9}\u{1F5D1}\u{2B50}\u{1F680}\u{1F50D}\u{23ED}\u{FE0F}\u{1F4B3}\u{1F510}\u{1F4E4}\u{1F4C5}\u{1F4DD}\u{200D}\u{20E3}\u{1F4E8}\u{1F514}\u{1F534}\u{1F7E2}\u{1F504}\u{2699}\u{1F6E1}\u{1F512}\u{1F6D1}\u{23F0}\u{1F916}\u{2757}\u{1F4AC}]+\s*)/gu, (match, prefix, quote, emojis) => {
    count++;
    return prefix + quote;
  });

  if (count > 0) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`${relPath}: stripped ${count} emoji prefixes`);
    totalCount += count;
  }
}

console.log(`Total: ${totalCount} emoji prefixes stripped`);
