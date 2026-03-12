const fs = require('fs');
const asmref = JSON.parse(fs.readFileSync('output/asmref.json', 'utf8'));
const statusPath = 'Upload/upload_status.json';
const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};
const partMapping = status.partMapping || {};

const search = process.argv[2] || '10059';
const searchUpper = search.toUpperCase();

// Search ASMREF components
console.log('=== ASMREF components containing "' + search + '" ===');
let found = 0;
for (const ak in asmref.byAssembly) {
  for (const lk in asmref.byAssembly[ak]) {
    if (lk.toUpperCase().indexOf(searchUpper) > -1) {
      const e = asmref.byAssembly[ak][lk];
      console.log('  ' + ak + ' -> ' + lk + ' | doc:' + (e.documentId || 'NONE') + ' | elem:' + (e.elementId || 'NONE') + ' | pn:' + (e.partNumber || '-'));
      found++;
    }
  }
}
if (found === 0) console.log('  NONE');

// Search byPartNumber
console.log('\n=== byPartNumber containing "' + search + '" ===');
const pnMatches = Object.keys(asmref.byPartNumber).filter(pn => pn.toUpperCase().indexOf(searchUpper) > -1);
if (pnMatches.length > 0) {
  pnMatches.forEach(pn => console.log('  ' + pn + ' -> ' + asmref.byPartNumber[pn].join(', ')));
} else {
  console.log('  NONE');
}

// Search partMapping (master parts)
console.log('\n=== partMapping (masters) containing "' + search + '" ===');
const pmMatches = Object.keys(partMapping).filter(pn => pn.toUpperCase().indexOf(searchUpper) > -1);
if (pmMatches.length > 0) {
  pmMatches.forEach(pn => {
    const m = partMapping[pn];
    console.log('  ' + pn + ' | doc:' + (m.documentId || 'NONE') + ' | elem:' + (m.elementId || 'NONE') + ' | file:' + (m.filename || '-'));
  });
} else {
  console.log('  NONE');
}
