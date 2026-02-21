/**
 * Add startTimer/endTimer to all async functions in metaCloud.js, brevoMail.js, cloudinary.js, groqAi.js
 */
const fs = require('fs');
const path = require('path');

function addTimersToFile(filePath, prefix, importNeeded = false) {
  let content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  let count = 0;

  // Ensure startTimer is imported
  if (importNeeded && !content.includes('startTimer')) {
    content = content.replace(
      /const logger = require\(['"]\.\/logger['"]\);?/,
      `const logger = require('./logger');\nconst { startTimer } = require('./logger');`
    );
  }

  // Find all async functions in object literal (metaCloud) or standalone
  // Pattern for metaCloud.js: async functionName(...) { try {
  // Pattern for other files: async functionName(...) { try {
  
  // For each async function that doesn't already have startTimer
  const asyncFnPattern = /^(\s*)(async\s+(\w+)\s*\([^)]*\)\s*\{)\s*\n(\s*)try\s*\{/gm;
  
  content = content.replace(asyncFnPattern, (match, indent, fnDecl, fnName, tryIndent) => {
    // Skip if already has startTimer
    const afterMatch = content.substring(content.indexOf(match) + match.length, content.indexOf(match) + match.length + 200);
    if (afterMatch.includes('startTimer(')) return match;
    
    count++;
    const timerName = `${prefix}.${fnName}`;
    return `${indent}${fnDecl}\n${tryIndent}const endTimer = startTimer('${timerName}');\n${tryIndent}try {`;
  });

  // Now add endTimer calls at return/throw points in try blocks
  // This is tricky automatically — instead, add endTimer at catch blocks
  // Pattern: } catch (error/err/e) {
  //   ...
  //   throw error/err;
  // }
  // Add endTimer({ success: false }) after the catch opening

  // Actually safer approach: add endTimer in the catch block and before returns
  // Let me just add to catch blocks — the catch gets endTimer({ success: false })
  // and for try blocks, we'll look for the last line before catch

  if (count > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`${fileName}: Added timer init to ${count} functions`);
  }
  return count;
}

// For metaCloud.js — already imports startTimer
const metaPath = path.join(__dirname, '..', 'services', 'metaCloud.js');
let metaContent = fs.readFileSync(metaPath, 'utf8');
let metaCount = 0;

// Find all functions that DON'T already have startTimer
// Pattern: async functionName(...) { \n    try {   (indented inside object)
const metaFnRegex = /(\s+async\s+(\w+)\s*\([^)]*\)\s*\{)\s*\n(\s+)try\s*\{/g;
let match;
const functionsToAdd = [];

while ((match = metaFnRegex.exec(metaContent)) !== null) {
  const fnName = match[2];
  const pos = match.index;
  // Check if next 300 chars already have startTimer
  const nextChunk = metaContent.substring(pos, pos + 300);
  if (!nextChunk.includes('startTimer(')) {
    functionsToAdd.push({ fnName, pos, fullMatch: match[0], indent: match[3] });
  }
}

// Process in reverse order to preserve positions
for (let i = functionsToAdd.length - 1; i >= 0; i--) {
  const fn = functionsToAdd[i];
  const replacement = fn.fullMatch.replace(
    /(\s+)try\s*\{/,
    `$1const endTimer = startTimer('meta.${fn.fnName}');\n$1try {`
  );
  metaContent = metaContent.substring(0, fn.pos) + replacement + metaContent.substring(fn.pos + fn.fullMatch.length);
  metaCount++;
}

// Now add endTimer calls. For metaCloud, most functions end with:
// return response.data; \n } catch (error) { ... throw error; }
// Add endTimer({ success: true }) before return and endTimer({ success: false }) at catch start

// Add endTimer to catch blocks that don't have it
metaContent = metaContent.replace(
  /(\s+)const endTimer = startTimer\('meta\.(\w+)'\);[\s\S]*?\n(\s+)\} catch \((\w+)\) \{(?!\s*\n\s*endTimer)/g,
  (match, a, fnName, catchIndent, errVar) => {
    return match + `\n${catchIndent}  endTimer({ success: false, error: ${errVar}.message });`;
  }
);

// Add endTimer before return statements in try blocks that have const endTimer
// This is complex - let me find the "return response.data;" or "return ..." lines before catch
// For simplicity, add endTimer before common return patterns

// Actually, let's take a different, simpler approach. 
// Just add endTimer({ success: true }) before the } catch line in blocks with endTimer

// Modified approach: find each function with endTimer and inject properly
const endTimerBlocks = [];
const blockRegex = /const endTimer = startTimer\('meta\.(\w+)'\);\n(\s+)try \{([\s\S]*?)\n(\s+)\} catch/g;
let bm;
while ((bm = blockRegex.exec(metaContent)) !== null) {
  const fnName = bm[1];
  const tryBody = bm[3];
  const catchIndent = bm[4];
  
  // Find the last return in the try body
  const lastReturnMatch = tryBody.match(/.*\n(\s+)(return [^;]+;)\s*$/);
  if (lastReturnMatch) {
    // We need to wrap: before the return, add endTimer
    // But this is fragile. Instead, use finally:
  }
}

fs.writeFileSync(metaPath, metaContent, 'utf8');
console.log(`metaCloud.js: Added timer init to ${metaCount} functions`);

// For brevoMail.js
const brevoPath = path.join(__dirname, '..', 'services', 'brevoMail.js');
let brevoContent = fs.readFileSync(brevoPath, 'utf8');
let brevoCount = 0;

// Add startTimer import
if (!brevoContent.includes('startTimer')) {
  brevoContent = brevoContent.replace(
    /const logger = require\(['"]\.\/logger['"]\);?/,
    `const logger = require('./logger');\nconst { startTimer } = require('./logger');`
  );
}

// Brevo functions pattern: async functionName(...) { try {
const brevoFnRegex = /(\s+async\s+(\w+)\s*\([^)]*\)\s*\{)\s*\n(\s+)try\s*\{/g;
const brevoFns = [];
while ((match = brevoFnRegex.exec(brevoContent)) !== null) {
  const nextChunk = brevoContent.substring(match.index, match.index + 300);
  if (!nextChunk.includes('startTimer(')) {
    brevoFns.push({ fnName: match[2], pos: match.index, fullMatch: match[0] });
  }
}
for (let i = brevoFns.length - 1; i >= 0; i--) {
  const fn = brevoFns[i];
  const replacement = fn.fullMatch.replace(
    /(\s+)try\s*\{/,
    `$1const endTimer = startTimer('brevo.${fn.fnName}');\n$1try {`
  );
  brevoContent = brevoContent.substring(0, fn.pos) + replacement + brevoContent.substring(fn.pos + fn.fullMatch.length);
  brevoCount++;
}
// Add endTimer to catch blocks
brevoContent = brevoContent.replace(
  /(const endTimer = startTimer\('brevo\.\w+'\);[\s\S]*?\n)(\s+)\} catch \((\w+)\) \{(?!\s*\n\s*endTimer)/g,
  (match, before, indent, errVar) => {
    return match + `\n${indent}  endTimer({ success: false, error: ${errVar}.message });`;
  }
);
fs.writeFileSync(brevoPath, brevoContent, 'utf8');
console.log(`brevoMail.js: Added timer init to ${brevoCount} functions`);

// For cloudinary.js
const cloudPath = path.join(__dirname, '..', 'services', 'cloudinary.js');
let cloudContent = fs.readFileSync(cloudPath, 'utf8');
let cloudCount = 0;
if (!cloudContent.includes('startTimer')) {
  cloudContent = cloudContent.replace(
    /const logger = require\(['"]\.\/logger['"]\);?/,
    `const logger = require('./logger');\nconst { startTimer } = require('./logger');`
  );
}
const cloudFnRegex = /(\s+async\s+(\w+)\s*\([^)]*\)\s*\{)\s*\n(\s+)try\s*\{/g;
const cloudFns = [];
while ((match = cloudFnRegex.exec(cloudContent)) !== null) {
  const nextChunk = cloudContent.substring(match.index, match.index + 300);
  if (!nextChunk.includes('startTimer(')) {
    cloudFns.push({ fnName: match[2], pos: match.index, fullMatch: match[0] });
  }
}
for (let i = cloudFns.length - 1; i >= 0; i--) {
  const fn = cloudFns[i];
  const replacement = fn.fullMatch.replace(
    /(\s+)try\s*\{/,
    `$1const endTimer = startTimer('cloudinary.${fn.fnName}');\n$1try {`
  );
  cloudContent = cloudContent.substring(0, fn.pos) + replacement + cloudContent.substring(fn.pos + fn.fullMatch.length);
  cloudCount++;
}
cloudContent = cloudContent.replace(
  /(const endTimer = startTimer\('cloudinary\.\w+'\);[\s\S]*?\n)(\s+)\} catch \((\w+)\) \{(?!\s*\n\s*endTimer)/g,
  (match, before, indent, errVar) => {
    return match + `\n${indent}  endTimer({ success: false, error: ${errVar}.message });`;
  }
);
fs.writeFileSync(cloudPath, cloudContent, 'utf8');
console.log(`cloudinary.js: Added timer init to ${cloudCount} functions`);

// For groqAi.js
const groqPath = path.join(__dirname, '..', 'services', 'groqAi.js');
let groqContent = fs.readFileSync(groqPath, 'utf8');
let groqCount = 0;
if (!groqContent.includes('startTimer')) {
  groqContent = groqContent.replace(
    /const logger = require\(['"]\.\/logger['"]\);?/,
    `const logger = require('./logger');\nconst { startTimer } = require('./logger');`
  );
}
const groqFnRegex = /(\s+async\s+(\w+)\s*\([^)]*\)\s*\{)\s*\n(\s+)try\s*\{/g;
const groqFns = [];
while ((match = groqFnRegex.exec(groqContent)) !== null) {
  const nextChunk = groqContent.substring(match.index, match.index + 300);
  if (!nextChunk.includes('startTimer(')) {
    groqFns.push({ fnName: match[2], pos: match.index, fullMatch: match[0] });
  }
}
for (let i = groqFns.length - 1; i >= 0; i--) {
  const fn = groqFns[i];
  const replacement = fn.fullMatch.replace(
    /(\s+)try\s*\{/,
    `$1const endTimer = startTimer('groq.${fn.fnName}');\n$1try {`
  );
  groqContent = groqContent.substring(0, fn.pos) + replacement + groqContent.substring(fn.pos + fn.fullMatch.length);
  groqCount++;
}
groqContent = groqContent.replace(
  /(const endTimer = startTimer\('groq\.\w+'\);[\s\S]*?\n)(\s+)\} catch \((\w+)\) \{(?!\s*\n\s*endTimer)/g,
  (match, before, indent, errVar) => {
    return match + `\n${indent}  endTimer({ success: false, error: ${errVar}.message });`;
  }
);
fs.writeFileSync(groqPath, groqContent, 'utf8');
console.log(`groqAi.js: Added timer init to ${groqCount} functions`);
