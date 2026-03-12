#!/usr/bin/env node
/**
 * Find elements with blank part numbers in Onshape documents
 * Reads document list from Excel and checks element metadata directly (1 API call per doc)
 */

const XLSX = require('xlsx');
const onshape = require('./lib/onshape');

// Configuration
const EXCEL_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx';
const SHEET_NAME = 'Final';
const TEST_MODE = process.argv.includes('--test'); // Only check first document
const TEST_COUNT = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1]) || 1; // Number of docs in test mode

// Adaptive rate limiting settings
const MIN_DELAY_MS = 200;      // Minimum delay between requests
const MAX_DELAY_MS = 5000;     // Maximum delay when rate limit is low
const LOW_REMAINING_THRESHOLD = 10;  // Start slowing down when remaining drops below this
let currentDelay = MIN_DELAY_MS;

// Read Excel file
console.log('Reading Excel file...');
const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets[SHEET_NAME];

if (!sheet) {
  console.error(`Sheet '${SHEET_NAME}' not found. Available sheets:`, wb.SheetNames);
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet);
console.log(`Found ${rows.length} rows in '${SHEET_NAME}' sheet`);
console.log('');

// Filter rows - only level 0, must have all IDs
const docsToCheck = rows.filter(row => {
  const level = parseInt(row['uploadLevel']) || 0;
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  return level === 0 && docId && workId && elemId;
});

// Deduplicate by document ID (take first element per document)
const uniqueDocs = new Map();
docsToCheck.forEach(row => {
  const docId = row['onshape:documentId'];
  if (!uniqueDocs.has(docId)) {
    uniqueDocs.set(docId, row);
  }
});

console.log(`Found ${uniqueDocs.size} unique Level 0 documents to check`);

if (TEST_MODE) {
  console.log(`TEST MODE: Only checking first ${TEST_COUNT} document(s)\n`);
}

// Results
const blankPartNumbers = [];
let docsChecked = 0;
let apiCalls = 0;

// Process documents
const docList = Array.from(uniqueDocs.entries());
const maxDocs = TEST_MODE ? Math.min(TEST_COUNT, docList.length) : docList.length;

function checkNextDocument(idx, retryCount = 0) {
  if (idx >= maxDocs) {
    printResults();
    return;
  }

  const [docId, row] = docList[idx];
  const docName = String(row['document:name'] || docId);
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const fileName = row['File Name'] || docName;

  docsChecked++;
  const rateDisplay = ` [delay=${currentDelay}ms]`;
  process.stdout.write(`\rChecking ${docsChecked}/${maxDocs}: ${docName.substring(0, 20).padEnd(20)}${rateDisplay}    `);

  // Direct element metadata call - 1 API call per document
  onshape.get({
    path: `/api/metadata/d/${docId}/w/${workId}/e/${elemId}`
  }, (metaData, metaErr, rateInfo) => {
    apiCalls++;

    // Adjust delay based on rate limit remaining
    if (rateInfo && rateInfo.remaining !== undefined) {
      const remaining = parseInt(rateInfo.remaining, 10);
      if (remaining < LOW_REMAINING_THRESHOLD) {
        currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
      } else {
        currentDelay = MIN_DELAY_MS;
      }
    }

    // Check for rate limit (429)
    if (metaErr && metaErr.statusCode === 429) {
      const retryAfter = parseInt(metaErr.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
      if (retryCount < 3) {
        console.log(`\n  Rate limited. Waiting ${retryAfter}s before retry...`);
        currentDelay = MAX_DELAY_MS;
        docsChecked--; // Don't count this attempt
        setTimeout(() => checkNextDocument(idx, retryCount + 1), retryAfter * 1000);
        return;
      } else {
        console.log(`\n  Skipping ${docName} after 3 rate limit retries`);
        setTimeout(() => checkNextDocument(idx + 1), currentDelay);
        return;
      }
    }

    if (metaErr) {
      // Could be deleted or moved - skip
      setTimeout(() => checkNextDocument(idx + 1), currentDelay);
      return;
    }

    const meta = JSON.parse(metaData.toString());
    const partNumProp = meta.properties?.find(p =>
      p.name === 'Part Number' || p.name === 'Part number' || p.propertyId === '57f3fb8efa3416c06701d60f'
    );
    const partNum = partNumProp?.value || '';

    if (!partNum || partNum.trim() === '') {
      blankPartNumbers.push({
        documentId: docId,
        documentName: docName,
        workspaceId: workId,
        elementId: elemId,
        fileName: fileName
      });
    }

    setTimeout(() => checkNextDocument(idx + 1), currentDelay);
  });
}

function printResults() {
  console.log('\n\n========== RESULTS ==========');
  console.log(`Documents checked: ${docsChecked}`);
  console.log(`API calls made: ${apiCalls}`);
  console.log(`Elements with blank part numbers: ${blankPartNumbers.length}`);
  console.log('');

  if (blankPartNumbers.length > 0) {
    console.log('Blank Part Number Elements:');
    blankPartNumbers.forEach(item => {
      console.log(`  ${item.documentName} / ${item.elementName} (${item.elementType})`);
      console.log(`    Doc: ${item.documentId} | Elem: ${item.elementId}`);
    });
  }
}

// Start processing
console.log('');
checkNextDocument(0);
