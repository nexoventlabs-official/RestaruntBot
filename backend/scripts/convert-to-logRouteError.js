/**
 * Convert raw res.status(500).json catch blocks to logRouteError
 */
const fs = require('fs');
const path = require('path');

const routeDir = path.join(__dirname, '..', 'routes');
const files = fs.readdirSync(routeDir).filter(f => f.endsWith('.js'));
let totalConverted = 0;

for (const file of files) {
  const filePath = path.join(routeDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  let fileConverted = 0;

  // Pattern 1: logger.error('msg', { ... }); \n res.status(500).json({ error: err.message })
  // → logRouteError(res, 'msg', err)
  content = content.replace(
    /(\s*)logger\.error\((['"`])([^'"`]+)\2,\s*\{[^}]*\}\);\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{\s*error:\s*(\w+)\.message\s*\}\);?/g,
    (match, indent, q, msg, errVar) => {
      fileConverted++;
      return `${indent}return logRouteError(res, '${msg}', ${errVar});`;
    }
  );

  // Pattern 2: logger.error('msg', { ... }); \n res.status(500).json({ error: 'Server error' }) or similar string
  content = content.replace(
    /(\s*)logger\.error\((['"`])([^'"`]+)\2,\s*\{[^}]*\}\);\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{\s*error:\s*(['"`])[^'"`]+\4\s*\}\);?/g,
    (match, indent, q1, msg, q2) => {
      // Find error variable from catch block — look backwards
      fileConverted++;
      return `${indent}return logRouteError(res, '${msg}', error);`;
    }
  );

  // Pattern 3: logger.error('msg:', error); \n res.status(500).json(...)
  content = content.replace(
    /(\s*)logger\.error\((['"`])([^'"`]+)\2,\s*(\w+)\);\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{[^}]*\}\);?/g,
    (match, indent, q, msg, errVar) => {
      fileConverted++;
      return `${indent}return logRouteError(res, '${msg.replace(/:$/, '')}', ${errVar});`;
    }
  );

  // Pattern 4: } catch (err) { \n res.status(500).json({ error: err.message })
  // No preceding logger.error — just a bare catch with res.status(500)
  content = content.replace(
    /(\s*)\} catch \((\w+)\) \{\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{\s*error:\s*\2\.message\s*\}\);?/g,
    (match, indent, errVar) => {
      fileConverted++;
      return `${indent}} catch (${errVar}) {\n${indent}  return logRouteError(res, 'Internal server error', ${errVar});`;
    }
  );

  // Pattern 5: } catch (err) { \n res.status(500).json({ error: 'string' })
  content = content.replace(
    /(\s*)\} catch \((\w+)\) \{\s*\n\s*(?:return\s+)?res\.status\(500\)\.json\(\{\s*error:\s*(['"`])[^'"`]+\3\s*\}\);?/g,
    (match, indent, errVar) => {
      fileConverted++;
      return `${indent}} catch (${errVar}) {\n${indent}  return logRouteError(res, 'Internal server error', ${errVar});`;
    }
  );

  if (fileConverted > 0) {
    // Ensure logRouteError is imported
    if (!content.includes('logRouteError')) {
      // Add to existing logger import
      content = content.replace(
        /const\s*\{([^}]*)\}\s*=\s*require\(['"]\.\.\/services\/logger['"]\)/,
        (match, imports) => {
          if (imports.includes('logRouteError')) return match;
          return `const {${imports}, logRouteError } = require('../services/logger')`;
        }
      );
      // If still no logRouteError (different import style), add it
      if (!content.includes('logRouteError')) {
        content = content.replace(
          /const\s+logger\s*=\s*require\(['"]\.\.\/services\/logger['"]\);?/,
          `const logger = require('../services/logger');\nconst { logRouteError } = require('../services/logger');`
        );
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`${file}: ${fileConverted} conversions`);
    totalConverted += fileConverted;
  }
}

console.log(`\nTotal converted: ${totalConverted}`);
