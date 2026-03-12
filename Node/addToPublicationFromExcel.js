#!/usr/bin/env node
/**
 * Add Items to Existing Publication from Excel
 *
 * Reads an Excel file with item:revisionId values and adds them to an
 * existing publication via the bulk endpoint POST /publications/{pid}/items.
 *
 * Usage:
 *   node addToPublicationFromExcel.js -i pubs.xlsx -p <publicationId> --dry-run
 *   node addToPublicationFromExcel.js -i pubs.xlsx -p <publicationId>
 *
 * Required Excel columns:
 *   onshape:documentId    Document containing the item
 *   onshape:elementId     Element ID of the item
 *   onshape:versionId     Version ID of the item
 *   item:revisionId       Revision ID of the released item
 *
 * Optional Excel columns:
 *   uploadLevel           0=blob, 1=part, 2+=assembly (for type flags)
 *   File Extension        File extension for blob MIME type (e.g. PDF)
 */

const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

// File extension → MIME type lookup for blob items
const MIME_TYPES = {
  'PDF': 'application/pdf',
  'STEP': 'application/step',
  'STP': 'application/step',
  'DWG': 'application/acad',
  'DXF': 'application/dxf',
  'XLSX': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'CSV': 'text/csv',
  'TXT': 'text/plain',
  'JPG': 'image/jpeg',
  'JPEG': 'image/jpeg',
  'PNG': 'image/png',
};

const BLOB_EXTENSIONS = Object.keys(MIME_TYPES);

// Promisified onshape.post with 429 retry
function postAsync(opts, retryCount = 0) {
  return new Promise((resolve, reject) => {
    onshape.post(opts, (data, err) => {
      if (err) {
        if (err.statusCode === 429 && retryCount < 3) {
          const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
          console.log(`  Rate limited. Waiting ${retryAfter}s before retry (attempt ${retryCount + 1}/3)...`);
          setTimeout(() => {
            postAsync(opts, retryCount + 1).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function showUsage() {
  console.log('\nAdd Items to Existing Publication from Excel\n');
  console.log('Usage: node addToPublicationFromExcel.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>       Input Excel file (required)');
  console.log('  -p <id>         Publication ID to add items to (required)');
  console.log('  --sheet <name>  Sheet name (default: first sheet)');
  console.log('  --dry-run       Show what would be added without making API calls');
  console.log('  -h, --help      Show this help\n');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId    Document containing the item');
  console.log('  onshape:elementId     Element ID of the item');
  console.log('  onshape:versionId     Version ID of the item');
  console.log('  item:revisionId       Revision ID of the released item\n');
  console.log('Optional Excel columns:');
  console.log('  uploadLevel           0=blob, 1=part, 2+=assembly (for type flags)');
  console.log('  File Extension        File extension for blob MIME type (e.g. PDF)\n');
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const excelFile = argv.i;
  const publicationId = argv.p;
  const sheetName = argv.sheet;
  const dryRun = argv['dry-run'] || false;

  if (!excelFile || !publicationId) {
    console.error('Error: -i <input.xlsx> and -p <publicationId> are required');
    showUsage();
    process.exit(1);
  }

  if (!fs.existsSync(excelFile)) {
    console.error(`Error: Excel file not found: ${excelFile}`);
    process.exit(1);
  }

  console.log('=== Add Items to Publication ===\n');
  if (dryRun) console.log('DRY RUN MODE\n');

  // Step 1: Read Excel
  console.log(`1. Reading Excel: ${excelFile}`);
  const workbook = xlsx.readFile(excelFile);
  const wsName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[wsName];

  if (!worksheet) {
    console.error(`   Sheet "${wsName}" not found. Available: ${workbook.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const data = xlsx.utils.sheet_to_json(worksheet);
  if (data.length === 0) {
    console.error('   Excel sheet is empty.');
    process.exit(1);
  }
  console.log(`   ${data.length} rows from sheet: "${wsName}"`);

  // Step 2: Build items array
  console.log(`\n2. Building items from rows...`);
  const items = [];
  let skipped = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const documentId = String(row['onshape:documentId'] || '').trim();
    const elementId = String(row['onshape:elementId'] || '').trim();
    const versionId = String(row['onshape:versionId'] || '').trim();
    const revisionId = String(row['item:revisionId'] || '').trim();

    if (!revisionId || !documentId || !elementId || !versionId) {
      const missing = [];
      if (!documentId) missing.push('documentId');
      if (!elementId) missing.push('elementId');
      if (!versionId) missing.push('versionId');
      if (!revisionId) missing.push('revisionId');
      console.log(`   Row ${i + 2}: missing ${missing.join(', ')} — skipping`);
      skipped++;
      continue;
    }

    const item = { documentId, elementId, versionId, revisionId };
    const ext = String(row['File Extension'] || '').trim().toUpperCase();
    const level = parseInt(row['uploadLevel'], 10);

    if (level === 0 || (!isNaN(level) ? level === 0 : BLOB_EXTENSIONS.includes(ext))) {
      item.isBlob = true;
      item.dataType = MIME_TYPES[ext] || 'application/octet-stream';
    } else if (level >= 2) {
      item.isAssembly = true;
    }
    // Level 1 parts: base fields + revisionId is sufficient

    items.push(item);
  }

  console.log(`   ${items.length} items to add, ${skipped} rows skipped`);

  if (items.length === 0) {
    console.log('\n   No items to add. Done.');
    return;
  }

  // Step 3: Dry run — show summary
  if (dryRun) {
    console.log('\n--- Dry Run Summary ---');
    console.log(`   Publication: ${publicationId}`);
    console.log(`   Items to add: ${items.length}\n`);
    items.forEach((item, j) => {
      const flags = [];
      if (item.isBlob) flags.push(`blob (${item.dataType})`);
      if (item.isAssembly) flags.push('assembly');
      if (flags.length === 0) flags.push('part');
      console.log(`   ${j + 1}. doc=${item.documentId} elem=${item.elementId} ver=${item.versionId} rev=${item.revisionId}  type=${flags.join(', ')}`);
    });
    console.log(`\n[DRY RUN] No API calls made.`);
    return;
  }

  // Step 4: POST bulk items
  console.log(`\n3. Adding ${items.length} items to publication ${publicationId}...`);

  try {
    const responseData = await postAsync({
      path: `/api/v13/publications/${publicationId}/items`,
      body: { items }
    });

    const result = JSON.parse(responseData.toString());
    const resultItems = result.items || [];

    console.log(`\n   Success! Publication now has ${resultItems.length} items.`);
    console.log(`   Publication: ${result.name || publicationId}`);

  } catch (err) {
    const errMsg = err.body || err.message || String(err);
    console.error(`\n   ERROR: ${errMsg}`);
    process.exit(1);
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
