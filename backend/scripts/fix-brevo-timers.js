const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'services', 'brevoMail.js');
let c = fs.readFileSync(p, 'utf8');

const fns = [
  { name: 'sendOrderConfirmation', tryLine: 28 },
  { name: 'sendDeliveryPartnerNotification', tryLine: 101 },
  { name: 'sendStatusUpdate', tryLine: 123 },
  { name: 'sendReportEmail', tryLine: 200 },
  { name: 'sendDeliveryPartnerCredentials', tryLine: 236 }
];

const lines = c.split('\n');
fns.reverse().forEach(fn => {
  const lineIdx = fn.tryLine - 1;
  const indent = lines[lineIdx].match(/^\s*/)[0];
  lines.splice(lineIdx, 0, indent + "const endTimer = startTimer('brevo." + fn.name + "');");
});

c = lines.join('\n');

c = c.replace(
  /(const endTimer = startTimer\('brevo\.\w+'\);[\s\S]*?\n)(\s+)\} catch \((\w+)\) \{(?!\s*\n\s*endTimer)/g,
  (match, before, indent, errVar) => {
    return match + '\n' + indent + '  endTimer({ success: false, error: ' + errVar + '.message });';
  }
);

fs.writeFileSync(p, c, 'utf8');
console.log('brevoMail.js: 5 functions instrumented');
