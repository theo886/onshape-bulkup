const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/last2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws);
const asmref = JSON.parse(fs.readFileSync('output/asmref.json', 'utf8'));

console.log('Rows:', rows.length);
console.log('ASMREF assemblies:', Object.keys(asmref.byAssembly).length);
console.log('');

let mapped = 0;
let missing = 0;

rows.forEach((r, i) => {
  const fileName = r['File Name'] || '';
  let asmKey = fileName.toUpperCase().trim();
  if (asmKey.indexOf('.SLDASM') === -1) {
    asmKey = asmKey.replace(/\.[^.]+$/, '') + '.SLDASM';
  }

  if (asmref.byAssembly[asmKey]) {
    const components = Object.keys(asmref.byAssembly[asmKey]);
    const withIds = components.filter(k => asmref.byAssembly[asmKey][k].documentId).length;
    const withoutIds = components.length - withIds;
    if (withoutIds > 0) {
      console.log('[PARTIAL] ' + fileName + ' — ' + components.length + ' components (' + withIds + ' with IDs, ' + withoutIds + ' missing IDs)');
    }
    mapped++;
  } else {
    console.log('[MISSING] ' + fileName + ' — no ASMREF entry');
    missing++;
  }
});

console.log('\n=== Summary ===');
console.log('Mapped:', mapped);
console.log('Missing from ASMREF:', missing);
