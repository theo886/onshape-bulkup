/**
 * Analyze double-release risk: Find Level 0/1 items that are in documents
 * where a Level 2+ assembly will release the entire document.
 *
 * Usage: node analyzeDoubleRelease.js -i <excel-file> [-s <status-file>]
 */

const xlsx = require('xlsx');
const fs = require('fs');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));
const inputPath = argv.i || argv._[0];
const statusPath = argv.s || 'Upload/upload_status.json';

if (!inputPath) {
  console.log('Usage: node analyzeDoubleRelease.js -i <excel-file> [-s <status-file>]');
  process.exit(1);
}

// Load Excel
const workbook = xlsx.readFile(inputPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`\nAnalyzing: ${inputPath}`);
console.log(`Total rows: ${data.length}\n`);

// Load status to check for versionIds (released items)
let status = { partMapping: {}, assemblyMapping: {}, fileStatus: {} };
if (fs.existsSync(statusPath)) {
  status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  console.log(`Loaded status file: ${statusPath}`);
  console.log(`  partMapping entries: ${Object.keys(status.partMapping).length}`);
  console.log(`  assemblyMapping entries: ${Object.keys(status.assemblyMapping).length}\n`);
}

// Group rows by document name
const byDocument = {};
data.forEach(row => {
  const docName = row['document:name'];
  if (!docName) return;

  if (!byDocument[docName]) {
    byDocument[docName] = [];
  }
  byDocument[docName].push(row);
});

console.log(`Documents found: ${Object.keys(byDocument).length}\n`);

// Find documents where Level 2+ has Release:Document
const docsWithLevel2Release = {};
Object.entries(byDocument).forEach(([docName, rows]) => {
  const level2PlusWithDocRelease = rows.filter(row => {
    const level = parseInt(row.uploadLevel);
    const release = (row.Release || '').toString().toLowerCase().trim();
    return level >= 2 && release === 'document';
  });

  if (level2PlusWithDocRelease.length > 0) {
    docsWithLevel2Release[docName] = {
      level2Rows: level2PlusWithDocRelease,
      allRows: rows
    };
  }
});

console.log(`Documents with Level 2+ Release:Document: ${Object.keys(docsWithLevel2Release).length}\n`);

// For each such document, find Level 0/1 items that might be double-released
const atRisk = [];
const alreadyReleased = [];
const notYetReleased = [];

Object.entries(docsWithLevel2Release).forEach(([docName, info]) => {
  // Find Level 0/1 items in this document
  const level01Items = info.allRows.filter(row => {
    const level = parseInt(row.uploadLevel);
    return level === 0 || level === 1;
  });

  level01Items.forEach(row => {
    const partNumber = row['property:Part number'] || '';

    // Check if already released (has versionId in status)
    const inPartMapping = status.partMapping[partNumber];
    const inAsmMapping = status.assemblyMapping[partNumber];
    const hasVersionId = inPartMapping?.versionId || inAsmMapping?.versionId;

    const item = {
      document: docName,
      level: row.uploadLevel,
      partNumber: partNumber,
      release: row.Release || '',
      hasVersionId: !!hasVersionId,
      versionId: hasVersionId ? (inPartMapping?.versionId || inAsmMapping?.versionId) : null
    };

    atRisk.push(item);
    if (hasVersionId) {
      alreadyReleased.push(item);
    } else {
      notYetReleased.push(item);
    }
  });
});

console.log('=== Double Release Risk Analysis ===\n');
console.log(`Total Level 0/1 items in documents with Level 2+ Release:Document: ${atRisk.length}`);
console.log(`  Already released (have versionId): ${alreadyReleased.length}`);
console.log(`  Not yet released (no versionId): ${notYetReleased.length}`);

if (alreadyReleased.length > 0) {
  console.log('\n=== ALREADY RELEASED - WILL BE DOUBLE RELEASED ===\n');
  console.log('These items have versionId (released) and are in a document where');
  console.log('a Level 2+ assembly will try to Release:Document again.\n');

  // Group by document
  const byDoc = {};
  alreadyReleased.forEach(item => {
    if (!byDoc[item.document]) byDoc[item.document] = [];
    byDoc[item.document].push(item);
  });

  let count = 0;
  Object.entries(byDoc).forEach(([doc, items]) => {
    if (count < 30) {
      console.log(`Document: ${doc}`);
      items.forEach(item => {
        console.log(`  Level ${item.level}: ${item.partNumber} (versionId: ${item.versionId?.substring(0, 8)}...)`);
      });
      count += items.length;
    }
  });

  if (alreadyReleased.length > 30) {
    console.log(`\n... and ${alreadyReleased.length - 30} more items`);
  }

  console.log(`\nTOTAL AT RISK FOR DOUBLE RELEASE: ${alreadyReleased.length}`);
}

if (notYetReleased.length > 0) {
  console.log('\n=== NOT YET RELEASED - WILL BE RELEASED BY LEVEL 2+ ===\n');
  console.log('These items don\'t have versionId yet but will be released when');
  console.log('Level 2+ assembly does Release:Document.\n');

  console.log(`Count: ${notYetReleased.length} items will be released as part of Level 2+ upload`);
}

// Summary table
console.log('\n=== Summary Table ===\n');
console.log('Status                  | Count');
console.log('------------------------|-------');
console.log(`Already released, at risk | ${alreadyReleased.length}`);
console.log(`Not released, will be     | ${notYetReleased.length}`);
console.log(`TOTAL in affected docs    | ${atRisk.length}`);

// Export detailed list
const outputPath = 'output/double_release_risk.json';
fs.writeFileSync(outputPath, JSON.stringify({
  summary: {
    totalAtRisk: atRisk.length,
    alreadyReleased: alreadyReleased.length,
    notYetReleased: notYetReleased.length,
    documentsAffected: Object.keys(docsWithLevel2Release).length
  },
  alreadyReleased: alreadyReleased,
  notYetReleased: notYetReleased
}, null, 2));
console.log(`\nDetailed list saved to: ${outputPath}`);
