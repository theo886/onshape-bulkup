/**
 * Analyze Release column in Excel to identify double-release risks.
 * Usage: node analyzeRelease.js -i <excel-file>
 */

const xlsx = require('xlsx');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));
const inputPath = argv.i || argv._[0];

if (!inputPath) {
  console.log('Usage: node analyzeRelease.js -i <excel-file>');
  process.exit(1);
}

const workbook = xlsx.readFile(inputPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`\nAnalyzing: ${inputPath}`);
console.log(`Total rows: ${data.length}\n`);

// Count by level and release
const byLevel = {};
data.forEach(row => {
  const level = row.uploadLevel !== undefined ? String(row.uploadLevel) : 'undefined';
  const release = (row.Release || '').toString().toLowerCase().trim();

  if (!byLevel[level]) {
    byLevel[level] = { total: 0, yes: 0, document: 0, empty: 0, other: 0 };
  }
  byLevel[level].total++;

  if (release === 'yes') byLevel[level].yes++;
  else if (release === 'document') byLevel[level].document++;
  else if (release === '') byLevel[level].empty++;
  else byLevel[level].other++;
});

console.log('=== Summary by Upload Level ===\n');
console.log('Level | Total | Release:yes | Release:Document | No Release | Other');
console.log('------|-------|-------------|------------------|------------|------');
const levels = Object.keys(byLevel).sort((a,b) => {
  if (a === 'undefined') return 1;
  if (b === 'undefined') return -1;
  return Number(a) - Number(b);
});
levels.forEach(level => {
  const b = byLevel[level];
  console.log(`  ${level.padEnd(4)} | ${String(b.total).padStart(5)} | ${String(b.yes).padStart(11)} | ${String(b.document).padStart(16)} | ${String(b.empty).padStart(10)} | ${b.other}`);
});

// Risk analysis
console.log('\n=== Risk Analysis ===\n');

// Level 0 and 1 already uploaded
const level0 = byLevel['0'] || { total: 0, yes: 0, document: 0, empty: 0 };
const level1 = byLevel['1'] || { total: 0, yes: 0, document: 0, empty: 0 };
const level2 = byLevel['2'] || { total: 0, yes: 0, document: 0, empty: 0 };

console.log('LEVEL 0 (Non-CAD files - already uploaded):');
console.log(`  Total: ${level0.total}`);
console.log(`  With Release:yes - these would try to release again: ${level0.yes}`);
console.log(`  With Release:Document - these would try to release again: ${level0.document}`);
console.log(`  No Release column - safe: ${level0.empty}`);

console.log('\nLEVEL 1 (Parts - already uploaded):');
console.log(`  Total: ${level1.total}`);
console.log(`  With Release:yes - these would try to release again: ${level1.yes}`);
console.log(`  With Release:Document - these would try to release again: ${level1.document}`);
console.log(`  No Release column - safe: ${level1.empty}`);

console.log('\nLEVEL 2 (Assemblies - to be uploaded):');
console.log(`  Total: ${level2.total}`);
console.log(`  With Release:yes - will release element only: ${level2.yes}`);
console.log(`  With Release:Document - will release ALL elements in doc: ${level2.document}`);
console.log(`  No Release column - will NOT be released: ${level2.empty}`);

// Find items at risk
console.log('\n=== Double Release Risk ===\n');
const atRisk = data.filter(row => {
  const level = row.uploadLevel;
  const release = (row.Release || '').toString().toLowerCase().trim();
  return (level === 0 || level === 1) && (release === 'yes' || release === 'document');
});

if (atRisk.length > 0) {
  console.log(`WARNING: ${atRisk.length} items at risk for double release!`);
  console.log('These are Level 0/1 items that have Release:yes or Release:Document\n');

  // Show first 20
  console.log('Sample (first 20):');
  atRisk.slice(0, 20).forEach(row => {
    console.log(`  Level ${row.uploadLevel}: ${row['document:name'] || row['property:Part number'] || 'unnamed'} - Release: ${row.Release}`);
  });
  if (atRisk.length > 20) {
    console.log(`  ... and ${atRisk.length - 20} more`);
  }
} else {
  console.log('No double release risk detected for Level 0/1 items.');
}

// Items that won't be released
console.log('\n=== Items That Will NOT Be Released ===\n');
const notReleased = data.filter(row => {
  const release = (row.Release || '').toString().toLowerCase().trim();
  return release === '' || (release !== 'yes' && release !== 'document');
});

const notReleasedByLevel = {};
notReleased.forEach(row => {
  const level = row.uploadLevel !== undefined ? String(row.uploadLevel) : 'undefined';
  if (!notReleasedByLevel[level]) notReleasedByLevel[level] = 0;
  notReleasedByLevel[level]++;
});

console.log('Items without Release column (will not be released):');
Object.keys(notReleasedByLevel).sort().forEach(level => {
  console.log(`  Level ${level}: ${notReleasedByLevel[level]} items`);
});
console.log(`  TOTAL: ${notReleased.length} items will not be released`);
