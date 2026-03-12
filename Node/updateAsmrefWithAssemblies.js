const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');
const asmref = require('./lib/asmref.js');

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  string: ['i', 'a', 'sheet'],
  boolean: ['dry-run', 'force', 'h', 'help'],
  alias: { i: 'input', a: 'asmref', h: 'help' },
  default: { asmref: 'output/asmref.json', sheet: 'Sheet1' }
});

if (argv.help || !argv.input) {
  console.log('Update ASMREF with Onshape IDs for Uploaded Assemblies');
  console.log('');
  console.log('Fills in Onshape IDs for SLDASM entries in asmref.json using uploaded');
  console.log('assembly IDs from Excel. Keeps type as SLDASM (real assemblies).');
  console.log('');
  console.log('Usage: node updateAsmrefWithAssemblies.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file with uploaded assembly IDs (required)');
  console.log('  -a, --asmref    ASMREF JSON file (default: output/asmref.json)');
  console.log('  --sheet         Excel sheet name (default: Sheet1)');
  console.log('  --force         Overwrite existing IDs (for re-uploaded assemblies)');
  console.log('  --dry-run       Preview changes without saving');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  File Name              e.g., 43737.SLDASM (matches ASMREF component key)');
  console.log('  onshape:documentId     Onshape document ID');
  console.log('  onshape:elementId      Onshape element ID');
  console.log('  onshape:versionId      Onshape version ID');
  console.log('');
  console.log('Optional Excel columns:');
  console.log('  onshape:workspaceId    Onshape workspace ID');
  console.log('');
  console.log('Examples:');
  console.log('  node updateAsmrefWithAssemblies.js -i ../Current/Level2done.xlsx --dry-run');
  console.log('  node updateAsmrefWithAssemblies.js -i ../Current/Level2done.xlsx');
  process.exit(0);
}

const inputFile = argv.input;
const asmrefPath = argv.asmref;
const sheetName = argv.sheet;
const dryRun = argv['dry-run'];
const force = argv.force;

// --- Step 1: Read Excel ---
if (!fs.existsSync(inputFile)) {
  console.error(`Excel file not found: ${inputFile}`);
  process.exit(1);
}

const workbook = xlsx.readFile(inputFile);
if (!workbook.SheetNames.includes(sheetName)) {
  console.error(`Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`);
  process.exit(1);
}

const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
console.log(`Read ${rows.length} rows from "${sheetName}" in ${inputFile}`);

// --- Step 2: Build lookup from Excel ---
const lookup = {};
let skippedMissingIds = 0;

for (const row of rows) {
  let fileName = row['File Name'];
  const documentId = row['onshape:documentId'];
  const elementId = row['onshape:elementId'];
  const versionId = row['onshape:versionId'];
  const workspaceId = row['onshape:workspaceId'] || null;

  if (!fileName) continue;

  if (!documentId || !elementId || !versionId) {
    skippedMissingIds++;
    continue;
  }

  // Normalize to uppercase and ensure .SLDASM extension for matching
  let key = fileName.toUpperCase().trim();
  if (!key.endsWith('.SLDASM')) {
    key = key.replace(/\.[^.]+$/, '') + '.SLDASM';
  }

  lookup[key] = { documentId, workspaceId, elementId, versionId };
}

console.log(`Built lookup: ${Object.keys(lookup).length} entries with complete IDs`);
if (skippedMissingIds > 0) {
  console.log(`Skipped ${skippedMissingIds} rows missing required IDs`);
}

// --- Step 3: Load ASMREF ---
const data = asmref.load(asmrefPath);
if (!data) {
  console.error('Failed to load ASMREF');
  process.exit(1);
}

const statsBefore = asmref.getStats(data);
console.log(`ASMREF before: ${statsBefore.subassemblies} SLDASM entries, ${statsBefore.withoutIds} without IDs`);

// --- Step 4: Walk ASMREF and update matches ---
let matched = 0;
let alreadyDone = 0;
const notInAsmref = new Set();
const matchedKeys = new Set();

for (const asmKey in data.byAssembly) {
  const components = data.byAssembly[asmKey];

  for (const compKey in components) {
    const entry = components[compKey];
    if (entry.type !== 'SLDASM') continue;

    const compUpper = compKey.toUpperCase().trim();
    const ids = lookup[compUpper];

    if (!ids) continue;

    matchedKeys.add(compUpper);

    // Already updated?
    if (entry.documentId && entry.elementId && entry.versionId && !force) {
      alreadyDone++;
      continue;
    }

    // Update IDs, keep type as SLDASM
    entry.documentId = ids.documentId;
    entry.workspaceId = ids.workspaceId;
    entry.elementId = ids.elementId;
    entry.versionId = ids.versionId;
    matched++;

    if (dryRun && matched <= 5) {
      console.log(`  [preview] ${asmKey} / ${compKey} -> docId=${ids.documentId.slice(0, 8)}...`);
    }
  }
}

// Check which Excel entries didn't match any ASMREF component
for (const key of Object.keys(lookup)) {
  if (!matchedKeys.has(key)) {
    notInAsmref.add(key);
  }
}

// --- Step 5: Report ---
console.log('');
console.log('=== Results ===');
console.log(`  Updated:        ${matched} entries (IDs filled, type kept as SLDASM)`);
console.log(`  Already done:   ${alreadyDone} entries (already had IDs)`);
console.log(`  Not in ASMREF:  ${notInAsmref.size} Excel rows had no matching SLDASM component`);
console.log(`  Excel entries:  ${Object.keys(lookup).length}`);
console.log(`  ASMREF matched: ${matchedKeys.size} unique components`);

if (notInAsmref.size > 0 && notInAsmref.size <= 20) {
  console.log('');
  console.log('Not in ASMREF (likely top-level assemblies):');
  for (const key of [...notInAsmref].sort()) {
    console.log(`  ${key}`);
  }
} else if (notInAsmref.size > 20) {
  console.log(`\n  (${notInAsmref.size} unmatched - too many to list, likely top-level assemblies)`);
}

// --- Step 6: Save ---
if (matched > 0 && !dryRun) {
  asmref.save(data, asmrefPath);
  const statsAfter = asmref.getStats(data);
  console.log(`\nSaved ${asmrefPath}`);
  console.log(`ASMREF after: ${statsAfter.subassemblies} SLDASM entries, ${statsAfter.withoutIds} without IDs`);
} else if (dryRun) {
  console.log('\n--dry-run: no changes saved');
} else {
  console.log('\nNo updates needed');
}
