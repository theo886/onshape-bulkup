const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');

const args = minimist(process.argv.slice(2), {
  string: ['i'],
  alias: { i: 'input' }
});

if (!args.input) {
  console.log('Usage: node inspectExcel.js -i <excel-file>');
  process.exit(1);
}

const inputFile = args.input;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

console.log('='.repeat(60));
console.log('EXCEL FILE INSPECTION');
console.log('='.repeat(60));

const wb = xlsx.readFile(inputFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`\nFile: ${inputFile}`);
console.log(`Sheets: ${wb.SheetNames.join(', ')}`);
console.log(`Rows: ${data.length}`);
console.log(`Columns: ${Object.keys(data[0] || {}).length}`);

// Column names
console.log('\nCOLUMNS:');
const cols = Object.keys(data[0] || {});
cols.forEach(c => console.log('  - ' + c));

// Upload level distribution
console.log('\nUPLOAD LEVELS:');
const levels = {};
data.forEach(row => {
  const lvl = row.uploadLevel !== undefined ? String(row.uploadLevel) : '?';
  levels[lvl] = (levels[lvl] || 0) + 1;
});
Object.keys(levels).sort().forEach(lvl => {
  console.log(`  Level ${lvl}: ${levels[lvl]} files`);
});

// Check for required columns
console.log('\nREQUIRED COLUMNS:');
const required = ['uploadLevel', 'document:name', 'filePath'];
required.forEach(col => {
  const found = cols.some(c => c === col);
  console.log(`  ${found ? 'OK' : 'MISSING'} ${col}`);
});

// Check for Onshape IDs (from previous uploads)
console.log('\nONSHAPE IDs:');
const idCols = ['onshape:documentId', 'onshape:workspaceId', 'onshape:elementId'];
idCols.forEach(col => {
  const count = data.filter(r => r[col]).length;
  console.log(`  ${col}: ${count} rows have values`);
});

// Property columns
const propCols = cols.filter(c => c.startsWith('property:'));
console.log(`\nPROPERTY COLUMNS: ${propCols.length}`);
if (propCols.length > 0) {
  propCols.slice(0, 10).forEach(c => console.log('  - ' + c));
  if (propCols.length > 10) {
    console.log(`  ... and ${propCols.length - 10} more`);
  }
}

console.log('\n' + '='.repeat(60));
