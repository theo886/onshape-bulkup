#!/usr/bin/env node
/**
 * comparePDFs.js
 *
 * Downloads PDFs from Onshape documents and compares them by SHA-256 hash
 * to identify duplicates within the same document.
 *
 * Input: Excel file with onshape:documentId, onshape:workspaceId, onshape:elementId,
 *        File Name, and document:name columns.
 */

const fs = require('fs');
const crypto = require('crypto');
const pathModule = require('path');
const xlsx = require('xlsx');
const minimist = require('minimist');
const readline = require('readline');
const onshape = require('./lib/onshape.js');

// Rate limiting constants
const MIN_DELAY = 200;
const MAX_DELAY = 5000;
let currentDelay = MIN_DELAY;

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o'],
  boolean: ['dry-run', 'slow-run', 'keep-files', 'h', 'help'],
  alias: { i: 'input', o: 'output', h: 'help' },
  default: { o: 'output/pdf_compare' }
});

if (args.help || args.h || !args.input) {
  console.log('Compare PDFs by Document');
  console.log('');
  console.log('Downloads PDFs from Onshape and compares SHA-256 hashes within each document');
  console.log('to identify duplicates.');
  console.log('');
  console.log('Usage: node comparePDFs.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input       Excel file with PDF elements (required)');
  console.log('  -o, --output      Output directory (default: output/pdf_compare)');
  console.log('  --dry-run         Show groups and counts, no API calls');
  console.log('  --keep-files      Keep downloaded PDFs after comparison');
  console.log('  --slow-run        Prompt after each document group (y/n/f)');
  console.log('  -h, --help        Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId    Document ID (grouping key)');
  console.log('  onshape:workspaceId   Workspace ID');
  console.log('  onshape:elementId     Element ID');
  console.log('  File Name             Display name (e.g. 30010.PDF)');
  console.log('');
  console.log('Optional columns:');
  console.log('  document:name         Document name for display');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const outputDir = args.output;
const dryRun = args['dry-run'];
let slowRun = args['slow-run'];
let slowRunPaused = false;
const keepFiles = args['keep-files'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// --- Sidecar for crash-safe resume ---

const sidecarPath = pathModule.join(outputDir, 'pdf_compare_status.json');
let sidecar = {};

function loadSidecar() {
  if (fs.existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      const count = Object.keys(sidecar).length;
      if (count > 0) console.log(`Loaded sidecar: ${count} elements already processed`);
    } catch (e) {
      console.warn(`Warning: Could not parse sidecar: ${e.message}`);
      sidecar = {};
    }
  }
}

function saveSidecar() {
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
}

// --- Promisified API helper (binary) ---

function apiBinaryGet(path, headers) {
  return new Promise((resolve, reject) => {
    onshape.getBinary({ path, headers }, (buffer, err, rateInfo) => {
      if (err) {
        err.rateInfo = rateInfo;
        reject(err);
      } else {
        resolve({ buffer, rateInfo });
      }
    });
  });
}

// --- Adaptive delay ---

function adjustDelay(rateInfo) {
  if (!rateInfo || !rateInfo.remaining) return;
  const remaining = parseInt(rateInfo.remaining, 10);
  if (remaining < 5) {
    currentDelay = MAX_DELAY;
  } else if (remaining < 10) {
    currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
  } else if (remaining > 50) {
    currentDelay = MIN_DELAY;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Read Excel and group by document ---

console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);
console.log(`Found ${data.length} rows total`);

// Filter rows with required columns
const rows = data.filter(row => {
  return row['onshape:documentId'] && row['onshape:workspaceId'] && row['onshape:elementId'];
});

console.log(`${rows.length} rows with valid document/workspace/element IDs`);

// Group by documentId
const groups = {};
for (const row of rows) {
  const docId = row['onshape:documentId'];
  if (!groups[docId]) groups[docId] = [];
  groups[docId].push(row);
}

// Filter to groups with 2+ elements (single-element docs don't need comparison)
const multiGroups = Object.entries(groups).filter(([, rows]) => rows.length >= 2);
const singleCount = Object.keys(groups).length - multiGroups.length;

console.log(`${Object.keys(groups).length} unique documents`);
console.log(`${multiGroups.length} documents with 2+ PDFs (${multiGroups.reduce((s, [, r]) => s + r.length, 0)} elements)`);
if (singleCount > 0) console.log(`${singleCount} documents with only 1 PDF — skipped`);
console.log('');

if (multiGroups.length === 0) {
  console.log('No multi-PDF documents to compare.');
  process.exit(0);
}

if (dryRun) {
  console.log('DRY RUN — showing groups:\n');
  for (const [docId, docRows] of multiGroups) {
    const docName = docRows[0]['document:name'] || 'unknown';
    console.log(`Document: ${docName} [${docId}] (${docRows.length} PDFs)`);
    for (const row of docRows) {
      console.log(`  ${row['File Name'] || '(no name)'} — element: ${row['onshape:elementId']}`);
    }
    console.log('');
  }
  console.log(`Total: ${multiGroups.length} groups, ${multiGroups.reduce((s, [, r]) => s + r.length, 0)} PDFs to download`);
  process.exit(0);
}

// --- Create output directory ---

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created output directory: ${outputDir}`);
}

loadSidecar();

// --- Slow-run keypress handler ---

if (slowRun && process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (slowRunPaused) {
      if (key.name === 'y') {
        console.log(' continuing...');
        slowRunPaused = false;
      } else if (key.name === 'n') {
        console.log('\nStopping...');
        writeResultsExcel();
        process.exit(0);
      } else if (key.name === 'f') {
        console.log(' switching to fast mode...');
        slowRun = false;
        slowRunPaused = false;
      }
    }
    if (key && key.ctrl && key.name === 'c') {
      console.log('\nCancelled.');
      writeResultsExcel();
      process.exit(0);
    }
  });
  process.stdin.resume();
  console.log('SLOW-RUN mode: will prompt after each document group (y=continue, n=stop, f=fast)\n');
}

// --- Counters ---

let groupsProcessed = 0;
let elementsDownloaded = 0;
let elementsSkipped = 0;
let matchesFound = 0;
let nearMatchesFound = 0;
let uniqueFound = 0;
let downloadErrors = 0;

// --- Results for Excel output ---

const results = [];

function writeResultsExcel() {
  if (results.length === 0) return;
  const outPath = pathModule.join(outputDir, 'pdf_compare_results.xlsx');
  const ws = xlsx.utils.json_to_sheet(results);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Results');
  xlsx.writeFile(wb, outPath);
  console.log(`\nResults written to ${outPath}`);
}

// --- Download a single element ---

async function downloadElement(row) {
  const elemId = row['onshape:elementId'];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const fileName = row['File Name'] || elemId;

  // Check sidecar for already-downloaded
  if (sidecar[elemId]) {
    const cached = sidecar[elemId];
    elementsSkipped++;
    return { hash: cached.hash, size: cached.size };
  }

  // Download via getBinary
  const apiPath = `/api/v13/blobelements/d/${docId}/w/${workId}/e/${elemId}`;
  let buffer, rateInfo;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await apiBinaryGet(apiPath, { Accept: 'application/octet-stream' });
      buffer = result.buffer;
      rateInfo = result.rateInfo;
      adjustDelay(rateInfo);
      break;
    } catch (e) {
      if (e.statusCode === 429) {
        const retryAfter = (e.rateInfo && e.rateInfo.retryAfter) ? parseInt(e.rateInfo.retryAfter, 10) : 60;
        console.log(`  ${fileName}: 429 rate limited — waiting ${retryAfter}s (attempt ${attempt}/3)`);
        await sleep(retryAfter * 1000);
        currentDelay = MAX_DELAY;
        continue;
      }
      console.log(`  ${fileName}: ERROR ${e.statusCode || e.message || e}`);
      downloadErrors++;
      return null;
    }
  }

  if (!buffer) {
    console.log(`  ${fileName}: FAILED after 3 retries`);
    downloadErrors++;
    return null;
  }

  // Compute hash
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const size = buffer.length;

  // Save file if --keep-files
  if (keepFiles) {
    const filePath = pathModule.join(outputDir, `${elemId}.pdf`);
    fs.writeFileSync(filePath, buffer);
  }

  // Update sidecar
  sidecar[elemId] = { hash, size, downloaded: true };
  saveSidecar();

  elementsDownloaded++;
  console.log(`  Downloaded: ${fileName} (${size} bytes)`);

  return { hash, size };
}

// --- Format a single element line with status ---

function formatElementLine(fileName, size, hashShort, status) {
  const padSize = size.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `  ${fileName.padEnd(35)} (${padSize.padStart(10)} bytes) SHA: ${hashShort}...  ${status}`;
}

// --- Process one document group ---

async function processGroup(docId, docRows, groupIdx) {
  const docName = docRows[0]['document:name'] || 'unknown';
  console.log(`\nDocument: ${docName} [${docId}] (${docRows.length} PDFs)`);

  // Download all elements in the group, collecting results
  const elementResults = [];
  for (const row of docRows) {
    const result = await downloadElement(row);
    elementResults.push({ row, result });
    await sleep(currentDelay);
  }

  // Compare hashes — first unique hash is REFERENCE, subsequent unique are UNIQUE, duplicates are MATCH
  const hashToRef = {};  // hash -> { fileName, index }
  const groupResults = [];  // local results for this group (pushed to global results after near-match pass)

  console.log('  ---');
  for (let i = 0; i < elementResults.length; i++) {
    const { row, result } = elementResults[i];
    const fileName = row['File Name'] || row['onshape:elementId'];
    const elemId = row['onshape:elementId'];
    let status = '';
    let matchGroup = '';
    let sizeDiff = '';

    if (!result) {
      status = 'ERROR';
      matchGroup = '';
      console.log(`  ${fileName.padEnd(35)}  ERROR (download failed)`);
    } else if (!hashToRef[result.hash]) {
      // First time seeing this hash
      hashToRef[result.hash] = { fileName, index: i };
      const uniqueCount = Object.keys(hashToRef).length;
      status = uniqueCount === 1 ? 'REFERENCE' : 'UNIQUE';
      matchGroup = result.hash.substring(0, 8);
      uniqueFound++;
      console.log(formatElementLine(fileName, result.size, result.hash.substring(0, 12), status));
    } else {
      // Duplicate of an earlier element
      const ref = hashToRef[result.hash];
      status = `MATCH: ${ref.fileName}`;
      matchGroup = result.hash.substring(0, 8);
      sizeDiff = 0;
      matchesFound++;
      console.log(formatElementLine(fileName, result.size, result.hash.substring(0, 12), status));
    }

    groupResults.push({
      'document:name': docName,
      'onshape:documentId': docId,
      'File Name': fileName,
      'onshape:elementId': elemId,
      'SHA256': result ? result.hash : '',
      'Size (bytes)': result ? result.size : '',
      'Size Diff': sizeDiff,
      'Match Group': matchGroup,
      'Status': status,
      _index: i  // internal: index into elementResults for near-match pass
    });
  }

  // Second pass: detect near-matches among non-matched elements
  const SIZE_THRESHOLD = 100;
  for (let i = 0; i < groupResults.length; i++) {
    const ri = groupResults[i];
    if (ri.Status.startsWith('MATCH') || ri.Status === 'ERROR') continue;
    const sizeI = elementResults[ri._index].result ? elementResults[ri._index].result.size : null;
    if (sizeI === null) continue;

    for (let j = i + 1; j < groupResults.length; j++) {
      const rj = groupResults[j];
      if (rj.Status.startsWith('MATCH') || rj.Status.startsWith('NEAR-MATCH') || rj.Status === 'ERROR') continue;
      const sizeJ = elementResults[rj._index].result ? elementResults[rj._index].result.size : null;
      if (sizeJ === null) continue;

      const diff = Math.abs(sizeI - sizeJ);
      if (diff <= SIZE_THRESHOLD && ri['SHA256'] !== rj['SHA256']) {
        rj.Status = `NEAR-MATCH: ${ri['File Name']}`;
        rj['Size Diff'] = diff;
        nearMatchesFound++;
        console.log(`  ** NEAR-MATCH: ${rj['File Name']} ≈ ${ri['File Name']} (${diff} bytes diff)`);
      }
    }
  }

  // Push to global results (strip internal _index)
  for (const r of groupResults) {
    delete r._index;
    results.push(r);
  }

  groupsProcessed++;
}

// --- Main ---

async function main() {
  for (let i = 0; i < multiGroups.length; i++) {
    // Wait if slow-run is paused
    while (slowRunPaused) {
      await sleep(100);
    }

    const [docId, docRows] = multiGroups[i];
    process.stdout.write(`[${i + 1}/${multiGroups.length}] `);
    await processGroup(docId, docRows, i);

    if (i < multiGroups.length - 1) {
      if (slowRun) {
        slowRunPaused = true;
        process.stdout.write(`\nContinue? (y=yes, n=stop, f=fast): `);
      }
    }
  }

  // Write results Excel
  writeResultsExcel();

  // Cleanup downloaded files if not keeping
  if (!keepFiles) {
    let cleaned = 0;
    for (const elemId of Object.keys(sidecar)) {
      const filePath = pathModule.join(outputDir, `${elemId}.pdf`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`Cleaned up ${cleaned} downloaded PDFs`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Document groups processed: ${groupsProcessed}/${multiGroups.length}`);
  console.log(`Elements downloaded:       ${elementsDownloaded}`);
  console.log(`Elements from cache:       ${elementsSkipped}`);
  console.log(`Unique hashes (REFERENCE): ${uniqueFound}`);
  console.log(`Duplicates (MATCH):        ${matchesFound}`);
  console.log(`Near-matches (metadata):   ${nearMatchesFound}`);
  console.log(`Download errors:           ${downloadErrors}`);

  // Cleanup stdin
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  writeResultsExcel();
  process.exit(1);
});
