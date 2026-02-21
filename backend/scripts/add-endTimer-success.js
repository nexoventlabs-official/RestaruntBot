/**
 * Add endTimer({ success: true }) before return statements in try blocks 
 * that already have const endTimer = startTimer(...)
 */
const fs = require('fs');
const path = require('path');

const files = ['metaCloud.js', 'brevoMail.js', 'cloudinary.js', 'groqAi.js'];
let totalAdded = 0;

for (const file of files) {
  const filePath = path.join(__dirname, '..', 'services', file);
  let content = fs.readFileSync(filePath, 'utf8');
  let added = 0;

  // Find blocks with endTimer init and add success calls before returns in try blocks
  // Strategy: Find each "const endTimer = startTimer(...)" and then find the closest
  // "} catch" after it. Between those, find all "return X;" and add endTimer before them
  // if not already present.
  
  const lines = content.split('\n');
  const timerStarts = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const endTimer = startTimer(')) {
      timerStarts.push(i);
    }
  }
  
  // For each timer start, find the corresponding } catch and add endTimer before returns
  for (let t = timerStarts.length - 1; t >= 0; t--) {
    const startIdx = timerStarts[t];
    
    // Find the } catch block
    let catchIdx = -1;
    let braceDepth = 0;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      if (line.trim().startsWith('} catch')) {
        catchIdx = i;
        break;
      }
    }
    
    if (catchIdx === -1) continue;
    
    // Find return statements in try block (between startIdx and catchIdx)
    for (let i = catchIdx - 1; i > startIdx; i--) {
      const line = lines[i].trim();
      if (line.startsWith('return ') && !line.includes('endTimer')) {
        // Check if previous line already has endTimer
        if (i > 0 && lines[i-1].includes('endTimer(')) continue;
        
        const indent = lines[i].match(/^\s*/)[0];
        lines.splice(i, 0, indent + 'endTimer({ success: true });');
        added++;
      }
    }
  }
  
  if (added > 0) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`${file}: ${added} endTimer success calls added`);
    totalAdded += added;
  } else {
    console.log(`${file}: 0 new (may already have them)`);
  }
}

console.log(`\nTotal: ${totalAdded}`);
