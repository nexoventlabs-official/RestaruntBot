/**
 * Phase 2: Convert remaining res.status(500) edge cases
 */
const fs = require('fs');
const path = require('path');

const routeDir = path.join(__dirname, '..', 'routes');
let totalConverted = 0;

function convert(file) {
  const filePath = path.join(routeDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;
  let converted = 0;

  // Pattern: logger.error('msg', { error: error.message, stack: ... }); \n res.status(500)
  // (the {error, stack} prevented match due to multi-field object)
  content = content.replace(
    /(\s*)logger\.error\((['"`])([^'"`]+)\2,\s*\{[^}]+\}\);\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{[^}]*\}\);?/g,
    (match, indent, q, msg) => {
      // extract error var from the catch block above
      const errVarMatch = match.match(/(\w+)\.message/);
      const errVar = errVarMatch ? errVarMatch[1] : 'error';
      converted++;
      return `${indent}return logRouteError(res, '${msg.replace(/:$/, '')}', ${errVar});`;
    }
  );

  // Pattern: } catch (error) { \n ... \n res.status(500).json({ error: ... })
  // multi-line catch blocks with something before res.status(500) that's not logger.error
  // e.g., if (error) { ... res.status(500)  or  const x = ...; res.status(500)
  // We'll specifically handle: if (error/result.error) { res.status(500) }  — validation patterns
  // These are not server errors, they're validation — leave as-is for offers.js if/result patterns

  if (content !== orig) {
    // Ensure logRouteError is imported
    if (!content.includes('logRouteError')) {
      content = content.replace(
        /const\s+logger\s*=\s*require\(['"]\.\.\/services\/logger['"]\);?/,
        `const logger = require('../services/logger');\nconst { logRouteError } = require('../services/logger');`
      );
    }
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`${file}: ${converted} conversions`);
    totalConverted += converted;
  }
}

// Process remaining files
['catalog.js', 'menu.js', 'offers.js', 'order.js', 'payment.js', 'public.js', 'webhook.js', 'whatsappBroadcast.js'].forEach(convert);

console.log(`\nTotal converted: ${totalConverted}`);
