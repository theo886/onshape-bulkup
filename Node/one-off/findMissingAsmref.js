const xlsx = require('xlsx');
const asmref = require('../lib/asmref.js');

// Find ASMREF SLDASM entries missing IDs
const data = asmref.load('output/asmref.json');
const missing = new Set();
for (const asmKey in data.byAssembly) {
  for (const compKey in data.byAssembly[asmKey]) {
    const e = data.byAssembly[asmKey][compKey];
    if (e.type === 'SLDASM' && !e.documentId) {
      missing.add(compKey.toUpperCase().trim());
    }
  }
}
console.log(`Missing IDs: ${missing.size} unique SLDASM components`);

// Look up in Onshape Ledger
const ledgerPath = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape Ledger.xlsx';
const wb = xlsx.readFile(ledgerPath);
const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// Show columns
console.log('\nLedger columns:', Object.keys(rows[0]).join(', '));

// Check for level-like columns
const levelCols = Object.keys(rows[0]).filter(k => /level/i.test(k));
console.log('Level-like columns:', levelCols.length > 0 ? levelCols.join(', ') : 'NONE');

const levelCounts = {};
const found = [];
const notFound = [];

for (const key of [...missing].sort()) {
  const partNum = key.replace(/\.SLDASM$/, '');
  const row = rows.find(r => {
    const fn = (r['File Name'] || '').toUpperCase().trim();
    const pn = (r['Part Number'] || r['PartNumber'] || '').toString().toUpperCase().trim();
    return fn === key || fn.replace(/\.[^.]+$/, '') === partNum || pn === partNum;
  });
  if (row) {
    // Try multiple possible column names
    const level = row['uploadLevel'] || 'N/A';
    levelCounts[level] = (levelCounts[level] || 0) + 1;
    found.push({ key, level, row });
  } else {
    notFound.push(key);
  }
}

console.log(`\nFound in ledger: ${found.length}`);
console.log(`Not in ledger: ${notFound.length}`);
console.log('\n=== Level Distribution ===');
for (const [level, count] of Object.entries(levelCounts).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
  console.log(`  Level ${level}: ${count}`);
}

// Show a sample row to inspect structure
if (found.length > 0) {
  console.log('\nSample matched row keys:', Object.keys(found[0].row).join(', '));
  console.log('Sample row:', JSON.stringify(found[0].row, null, 2).slice(0, 500));
}

// List all missing by level
console.log('\n=== Missing by Level ===');
const byLevel = {};
for (const f of found) {
  const lvl = f.level;
  if (!byLevel[lvl]) byLevel[lvl] = [];
  byLevel[lvl].push(f.key.replace(/\.SLDASM$/, ''));
}
for (const [lvl, items] of Object.entries(byLevel).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
  console.log(`\nLevel ${lvl}:`);
  for (const item of items.sort()) console.log(`  ${item}`);
}

if (notFound.length > 0) {
  console.log('\nNot found in ledger:');
  for (const k of notFound) console.log(`  ${k}`);
}
