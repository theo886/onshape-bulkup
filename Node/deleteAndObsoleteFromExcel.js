#!/usr/bin/env node
/**
 * deleteAndObsoleteFromExcel.js
 *
 * For each row in an Excel file:
 *   1. Obsolete all active revisions for the part number (mark re-releasable)
 *   2. Delete the element from the Onshape document
 *   3. Remove the entry from upload_status.json
 *
 * Obsoletion MUST happen before deletion — deleting the document first causes
 * 403 errors on the obsoletion API.
 */

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const readline = require('readline');
const onshape = require('./lib/onshape.js');

// Company ID and obsoletion workflow
const COMPANY_ID = '6763516217765c31f9561958';
const OBSOLETION_WORKFLOW_ID = '59fb015cbd51842cc4706f59';

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'status-file'],
  boolean: ['dry-run', 'slow-run', 'skip-obsolete', 'h', 'help'],
  alias: { i: 'input', h: 'help' },
  default: { 'status-file': pathModule.join(__dirname, 'Upload', 'upload_status.json') }
});

if (args.help || args.h || !args.input) {
  console.log('Delete and Obsolete from Excel');
  console.log('');
  console.log('For each row: obsoletes all active revisions, then deletes the element.');
  console.log('');
  console.log('Usage: node deleteAndObsoleteFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input       Excel file with elements to delete (required)');
  console.log('  --status-file     Path to upload_status.json (default: Upload/upload_status.json)');
  console.log('  --dry-run         Show what would be done without making API calls');
  console.log('  --slow-run        Prompt after each row (y=continue, n=stop, f=fast)');
  console.log('  --skip-obsolete   Skip obsoletion, only delete elements');
  console.log('  -h, --help        Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  onshape:elementId    Element ID');
  console.log('  property:Part Number Part number for revision lookup');
  console.log('');
  console.log('Optional columns (for logging):');
  console.log('  document:name        Document name');
  console.log('  filename / filePath  File name');
  console.log('');
  console.log('Note: Deleted elements are also removed from upload_status.json');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
let slowRun = args['slow-run'];
let slowRunPaused = false;
const skipObsolete = args['skip-obsolete'];
const statusFile = args['status-file'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// --- Promisified API helpers ---

function apiGet(path) {
  return new Promise((resolve, reject) => {
    onshape.get({ path }, (data, err) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(data));
      }
    });
  });
}

function apiPost(path, body, query) {
  return new Promise((resolve, reject) => {
    onshape.post({ path, body, query }, (data, err) => {
      if (err) {
        reject(err);
      } else {
        resolve(data ? JSON.parse(data) : {});
      }
    });
  });
}

function apiDelete(opts) {
  return new Promise((resolve, reject) => {
    onshape.delete(opts, (result, err) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// --- Obsoletion logic (from obsoletePartNumbers.js) ---

async function getAllRevisions(partNumber) {
  const revisions = [];

  try {
    const latest = await apiGet(`/api/v10/revisions/c/${COMPANY_ID}/partnumber/${partNumber}`);

    let current = latest;
    while (current) {
      revisions.push({
        id: current.id,
        revision: current.revision,
        isObsolete: current.isObsolete,
        isRereleasable: current.isRereleasable,
        previousRevisionId: current.previousRevisionId
      });

      if (current.previousRevisionId) {
        try {
          current = await apiGet(`/api/v10/revisions/${current.previousRevisionId}`);
        } catch (e) {
          current = null;
        }
      } else {
        current = null;
      }
    }
  } catch (e) {
    if (e.statusCode === 404) {
      return [];
    }
    throw e;
  }

  return revisions;
}

async function obsoleteRevision(revisionId, partNumber, revisionLabel) {
  if (dryRun) {
    console.log(`    [DRY RUN] Would obsolete revision ${revisionLabel} (${revisionId})`);
    return true;
  }

  try {
    const pkg = await apiPost(
      `/api/v10/releasepackages/obsoletion/${OBSOLETION_WORKFLOW_ID}`,
      null,
      { revisionId }
    );

    const rpid = pkg.id;

    await apiPost(
      `/api/v10/releasepackages/${rpid}`,
      {
        properties: [
          {
            propertyId: '594964b7040fc85d2b418138',
            value: `Cleanup: ${partNumber} Rev ${revisionLabel}`
          },
          {
            propertyId: 'os-mark-rereleasable',
            value: true
          }
        ]
      },
      { wfaction: 'CREATE_AND_OBSOLETE' }
    );

    console.log(`    Obsoleted revision ${revisionLabel} (re-releasable: true)`);
    return true;
  } catch (e) {
    if (e.body && e.body.includes('already been obsoleted')) {
      console.log(`    Revision ${revisionLabel} already obsoleted`);
      return true;
    }
    if (e.statusCode === 403) {
      console.log(`    Revision ${revisionLabel}: 403 — cannot obsolete (document may be deleted)`);
      return false;
    }
    console.error(`    Error obsoleting revision ${revisionLabel}:`, e.body || e);
    return false;
  }
}

// --- Status file helpers (from deleteElementsFromExcel.js) ---

let uploadStatus = null;
let statusModified = false;
let statusRemoved = 0;

if (fs.existsSync(statusFile)) {
  try {
    uploadStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log(`Loaded status file: ${statusFile}`);
  } catch (e) {
    console.warn(`Warning: Could not parse ${statusFile}: ${e.message}`);
  }
}

function findInStatus(elementId) {
  if (!uploadStatus || !uploadStatus.partMapping) return false;
  for (const entry of Object.values(uploadStatus.partMapping)) {
    if (entry.elementId === elementId) return true;
  }
  return false;
}

function removeFromStatus(elementId) {
  if (!uploadStatus || !uploadStatus.partMapping) return false;
  for (const [key, entry] of Object.entries(uploadStatus.partMapping)) {
    if (entry.elementId === elementId) {
      delete uploadStatus.partMapping[key];
      statusModified = true;
      statusRemoved++;
      return true;
    }
  }
  return false;
}

function saveStatus() {
  if (!statusModified || !uploadStatus) return;
  uploadStatus.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statusFile, JSON.stringify(uploadStatus, null, 2));
  console.log(`Updated ${statusFile} (removed ${statusRemoved} entries)`);
}

// --- Read Excel ---

console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} rows`);

if (dryRun) console.log('DRY RUN - no API calls will be made\n');
if (skipObsolete) console.log('SKIP-OBSOLETE - obsoletion step will be skipped\n');

// Filter to rows with required delete IDs
const rowsToProcess = data.filter(row => {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  return docId && workId && elemId;
});

console.log(`Found ${rowsToProcess.length} rows with valid document/workspace/element IDs\n`);

if (rowsToProcess.length === 0) {
  console.log('No elements to process. Make sure your Excel has these columns:');
  console.log('  - onshape:documentId');
  console.log('  - onshape:workspaceId');
  console.log('  - onshape:elementId');
  process.exit(0);
}

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
        console.log('\nStopping... saving progress...');
        saveStatus();
        process.exit(0);
      } else if (key.name === 'f') {
        console.log(' switching to fast mode...');
        slowRun = false;
        slowRunPaused = false;
      }
    }
    if (key && key.ctrl && key.name === 'c') {
      console.log('\nCancelled.');
      saveStatus();
      process.exit(0);
    }
  });
  process.stdin.resume();
  console.log('SLOW-RUN mode: will prompt after each row (y=continue, n=stop, f=fast)\n');
}

// --- Counters ---

let revisionsObsoleted = 0;
let elementsDeleted = 0;
let failed = 0;

// --- Main processing ---

async function processRow(row, idx) {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const partNumber = (row['property:Part Number'] || row['property:Part number'] || '').toString().trim();
  const docName = row['document:name'] || 'unknown';
  const filename = row.filename || row.filePath || 'unknown';

  console.log(`[${idx + 1}/${rowsToProcess.length}] ${filename}`);
  console.log(`  Document: ${docName} (${docId})`);
  console.log(`  Element: ${elemId}`);
  console.log(`  Part Number: ${partNumber || '(none)'}`);

  // Step 1: Obsolete revisions
  if (!skipObsolete && partNumber) {
    try {
      const revisions = await getAllRevisions(partNumber);
      if (revisions.length === 0) {
        console.log('  No revisions found — skipping obsoletion');
      } else {
        const activeRevs = revisions.filter(r => !r.isObsolete);
        const obsoleteRevs = revisions.filter(r => r.isObsolete);
        console.log(`  Found ${revisions.length} revision(s): ${activeRevs.length} active, ${obsoleteRevs.length} already obsolete`);

        for (const rev of revisions) {
          if (!rev.isObsolete) {
            console.log(`    Obsoleting revision ${rev.revision}...`);
            const success = await obsoleteRevision(rev.id, partNumber, rev.revision);
            if (success) revisionsObsoleted++;
          } else if (!rev.isRereleasable) {
            console.log(`    Warning: Revision ${rev.revision} is obsolete but NOT re-releasable`);
          }
        }
      }
    } catch (e) {
      console.log(`  Warning: Obsoletion failed for ${partNumber}: ${e.body || e.message || e}`);
      // Continue to deletion — don't block on obsoletion failure
    }
  } else if (!skipObsolete && !partNumber) {
    console.log('  No part number — skipping obsoletion');
  }

  // Step 2: Delete element
  if (dryRun) {
    console.log('  [DRY RUN] Would delete element');
    elementsDeleted++;
    if (findInStatus(elemId)) {
      console.log('  [DRY RUN] Would remove from status file');
      statusRemoved++;
    }
    return;
  }

  try {
    await apiDelete({
      d: docId,
      w: workId,
      e: elemId,
      resource: 'elements'
    });
    console.log('  Deleted successfully');
    elementsDeleted++;

    if (removeFromStatus(elemId)) {
      console.log('  Removed from status file');
    }
  } catch (e) {
    console.log(`  DELETE FAILED: ${e.body || e.statusCode || e}`);
    failed++;
  }
}

async function main() {
  for (let i = 0; i < rowsToProcess.length; i++) {
    // Wait if slow-run is paused
    while (slowRunPaused) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await processRow(rowsToProcess[i], i);

    // Small delay between rows
    if (i < rowsToProcess.length - 1) {
      if (slowRun) {
        slowRunPaused = true;
        process.stdout.write(`\nContinue? (y=yes, n=stop, f=fast): `);
      } else {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  // Save updated status file
  saveStatus();

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total processed: ${rowsToProcess.length}`);
  console.log(`Revisions obsoleted: ${revisionsObsoleted}`);
  console.log(`Elements deleted: ${elementsDeleted}`);
  console.log(`Removed from status file: ${statusRemoved}`);
  console.log(`Failed: ${failed}`);
  if (dryRun) console.log('(DRY RUN - nothing was actually changed)');

  // Cleanup stdin
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  saveStatus();
  process.exit(1);
});
