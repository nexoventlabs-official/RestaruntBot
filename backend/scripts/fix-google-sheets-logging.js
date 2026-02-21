const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'services', 'googleSheets.js');
let content = fs.readFileSync(file, 'utf8');

// 1. Add logger import after the first require line
if (!content.includes("require('./logger')")) {
  content = content.replace(
    "const { google } = require('googleapis');",
    "const { google } = require('googleapis');\nconst logger = require('./logger');"
  );
}

// 2. Replace console.error → logger.error
content = content.replace(/console\.error\(/g, 'logger.error(');

// 3. Replace console.log → logger.info
content = content.replace(/console\.log\(/g, 'logger.info(');

fs.writeFileSync(file, content, 'utf8');

// Count replacements
const infoCount = (content.match(/logger\.info\(/g) || []).length;
const errorCount = (content.match(/logger\.error\(/g) || []).length;
console.log(`Done. logger.info: ${infoCount}, logger.error: ${errorCount}`);
