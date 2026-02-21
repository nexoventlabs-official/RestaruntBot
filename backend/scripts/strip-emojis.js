const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'services', 'googleSheets.js');
let content = fs.readFileSync(file, 'utf8');

// Emoji pattern: common emojis used as prefixes in this file
// ✅ ❌ ⚠️ 📋 📦 📊 📱 🔧 🚚 📥 🧹 🗑️ ⏭️ 💳 🔐 ⭐ 🚀 🔍
// These appear at the start of string literals in logger calls
// Pattern: logger.info('emoji text') or logger.error('emoji text')
let count = 0;

// Replace emoji prefixes in single-quoted strings
content = content.replace(/(logger\.(?:info|error|warn)\()(['`])([\u{2705}\u{274C}\u{26A0}\u{FE0F}\u{1F4CB}\u{1F4E6}\u{1F4CA}\u{1F4F1}\u{1F527}\u{1F69A}\u{1F4E5}\u{1F9F9}\u{1F5D1}\u{2B50}\u{1F680}\u{1F50D}\u{23ED}\u{FE0F}\u{1F4B3}\u{1F510}\u{1F4E4}\u{1F4C5}\u{1F4DD}\u{200D}\u{20E3}]+\s*)/gu, (match, prefix, quote, emojis) => {
  count++;
  return prefix + quote;
});

fs.writeFileSync(file, content, 'utf8');
console.log(`Stripped ${count} emoji prefixes from log messages`);

// Also verify no console.log/error remain
const consoleLogCount = (content.match(/console\.log\(/g) || []).length;
const consoleErrorCount = (content.match(/console\.error\(/g) || []).length;
console.log(`Remaining console.log: ${consoleLogCount}, console.error: ${consoleErrorCount}`);
