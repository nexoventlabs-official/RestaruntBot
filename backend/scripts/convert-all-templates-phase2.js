/**
 * Phase 2: Generic conversion of ALL remaining template-literal logger calls.
 * This script uses a universal regex approach for any `logger.X(\`...\`)` pattern.
 */
const fs = require('fs');
const path = require('path');

// Walk the whole backend, skip node_modules, .git, coverage, __tests__, scripts
const allFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'coverage', '__tests__', 'build', 'scripts', '_deprecated'].includes(entry.name)) {
        walk(p);
      }
    } else if (entry.name.endsWith('.js')) {
      allFiles.push(p);
    }
  }
}
walk(path.join(__dirname, '..'));

let totalConverted = 0;
const conversionLog = [];

for (const filePath of allFiles) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let fileConverted = 0;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Match: logger.(info|warn|error|debug)(`...`) on a single line
    const match = line.match(/^(\s*)(logger\.(info|warn|error|debug))\(`([^`]*)`\s*\)/);
    if (match) {
      const indent = match[1];
      const logCall = match[2];
      const templateContent = match[4];

      // Extract interpolated variables
      const varMatches = [...templateContent.matchAll(/\$\{([^}]+)\}/g)];
      
      if (varMatches.length === 0) {
        // No interpolation — just convert backticks to quotes
        const cleaned = cleanMessage(templateContent);
        line = line.replace(/logger\.(info|warn|error|debug)\(`[^`]*`\s*\)/, `${logCall}('${cleaned}')`);
        fileConverted++;
      } else {
        // Has interpolation — extract message and vars
        let message = templateContent;
        const vars = {};
        
        for (const vm of varMatches) {
          const expr = vm[1].trim();
          const varName = extractVarName(expr);
          vars[varName] = expr;
          message = message.replace(vm[0], '');
        }
        
        // Clean message
        message = cleanMessage(message.replace(/\s{2,}/g, ' ').trim());
        
        // Build structured call
        const varEntries = Object.entries(vars).map(([name, expr]) => {
          if (name === expr) return name;
          return `${name}: ${expr}`;
        });
        
        const afterParen = line.substring(line.indexOf(match[0]) + match[0].length);
        if (varEntries.length > 0) {
          line = `${indent}${logCall}('${message}', { ${varEntries.join(', ')} })${afterParen}`;
        } else {
          line = `${indent}${logCall}('${message}')${afterParen}`;
        }
        fileConverted++;
      }
    }

    // Also handle: logger.X(`...`, { ... }) — template literal with existing metadata object
    // Keep the metadata object, just convert the template literal
    else {
      const match2 = line.match(/^(\s*)(logger\.(info|warn|error|debug))\(`([^`]*)`\s*,/);
      if (match2) {
        const indent = match2[1];
        const logCall = match2[2];
        const templateContent = match2[4];
        
        const varMatches = [...templateContent.matchAll(/\$\{([^}]+)\}/g)];
        
        if (varMatches.length === 0) {
          const cleaned = cleanMessage(templateContent);
          line = line.replace(/logger\.(info|warn|error|debug)\(`[^`]*`\s*,/, `${logCall}('${cleaned}',`);
          fileConverted++;
        } else {
          let message = templateContent;
          for (const vm of varMatches) {
            message = message.replace(vm[0], '');
          }
          message = cleanMessage(message.replace(/\s{2,}/g, ' ').trim());
          line = line.replace(/logger\.(info|warn|error|debug)\(`[^`]*`\s*,/, `${logCall}('${message}',`);
          fileConverted++;
        }
      }
    }

    newLines.push(line);
  }

  if (fileConverted > 0) {
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    const relPath = path.relative(path.join(__dirname, '..'), filePath);
    console.log(`✅ ${relPath}: ${fileConverted} conversions`);
    conversionLog.push({ file: relPath, count: fileConverted });
    totalConverted += fileConverted;
  }
}

console.log(`\nTotal: ${totalConverted} conversions applied`);

// Final check
let remaining = 0;
const remainingDetails = [];
for (const f of allFiles) {
  const fLines = fs.readFileSync(f, 'utf-8').split('\n');
  fLines.forEach((line, i) => {
    if (/logger\.(info|error|warn|debug)\(`/.test(line)) {
      remaining++;
      const relPath = path.relative(path.join(__dirname, '..'), f);
      remainingDetails.push(`  ${relPath}:${i + 1}: ${line.trim().substring(0, 120)}`);
    }
  });
}

console.log(`\nRemaining template-literal logger calls: ${remaining}`);
if (remaining > 0 && remaining < 50) {
  remainingDetails.forEach(d => console.log(d));
}

function cleanMessage(msg) {
  // Remove emojis
  msg = msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '');
  // Remove leftover special chars like ✅ ❌ ⚠️ etc (common Unicode symbols)
  msg = msg.replace(/[✅❌⚠️⏭️🔄📊📦📋📱📧🔐🧹👤📉📲🔒💰🍽️📋🗑️⏹️⏰📢🚨ℹ️]/g, '');
  // Clean up: double spaces, leading/trailing
  msg = msg.replace(/\s{2,}/g, ' ').trim();
  // Escape single quotes
  msg = msg.replace(/'/g, "\\'");
  // Remove trailing colons, dashes
  msg = msg.replace(/[:\-,]\s*$/, '').trim();
  // Remove leading brackets if duplicate
  return msg;
}

function extractVarName(expr) {
  // Simple variable: just return it
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(expr)) return expr;
  
  // Property access like error.message
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*\.[a-zA-Z_$][a-zA-Z0-9_]*$/.test(expr)) {
    const parts = expr.split('.');
    return parts[parts.length - 1];
  }
  
  // Method calls like arr.length
  if (expr.endsWith('.length')) {
    const base = expr.replace('.length', '');
    return base.replace(/\./g, '_') + 'Count';
  }
  
  // Optional chaining like error?.message
  if (expr.includes('?.')) {
    const parts = expr.split('?.');
    return parts[parts.length - 1];
  }
  
  // Ternary or complex: use generic name
  if (expr.includes('?') || expr.includes('+') || expr.includes('||')) {
    return 'detail';
  }
  
  // Method call like JSON.stringify(x)
  if (expr.includes('(')) {
    return 'detail';
  }
  
  // Fallback
  return expr.replace(/[^a-zA-Z0-9_]/g, '_');
}
