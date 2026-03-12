const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const readline = require('readline');
const onshape = require('./lib/onshape.js');

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'status-file'],
  boolean: ['dry-run', 'slow-run', 'h', 'help'],
  alias: { i: 'input', h: 'help' },
  default: { 'status-file': pathModule.join(__dirname, 'Upload', 'upload_status.json') }
});

if (args.help || args.h || !args.input) {
  console.log('Delete Elements from Excel');
  console.log('');
  console.log('Usage: node deleteElementsFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input       Excel file with elements to delete (required)');
  console.log('  --status-file     Path to upload_status.json (default: Upload/upload_status.json)');
  console.log('  --dry-run         Show what would be deleted without deleting');
  console.log('  --slow-run        Prompt after each delete (y=continue, n=stop, f=fast)');
  console.log('  -h, --help        Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  onshape:elementId    Element ID');
  console.log('');
  console.log('Optional columns (for logging):');
  console.log('  document:name        Document name');
  console.log('  filename             File name');
  console.log('');
  console.log('Note: Deleted elements are also removed from upload_status.json');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
let slowRun = args['slow-run'];
let slowRunPaused = false;
const statusFile = args['status-file'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Load upload_status.json if it exists
let uploadStatus = null;
let statusModified = false;
if (fs.existsSync(statusFile)) {
  try {
    uploadStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log(`Loaded status file: ${statusFile}`);
  } catch (e) {
    console.warn(`Warning: Could not parse ${statusFile}: ${e.message}`);
  }
}

// Read Excel file
console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} rows`);

if (dryRun) {
  console.log('DRY RUN - no elements will be deleted\n');
}

// Filter to rows that have all required IDs
const rowsToDelete = data.filter(row => {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  return docId && workId && elemId;
});

console.log(`Found ${rowsToDelete.length} rows with valid document/workspace/element IDs\n`);

if (rowsToDelete.length === 0) {
  console.log('No elements to delete. Make sure your Excel has these columns:');
  console.log('  - onshape:documentId');
  console.log('  - onshape:workspaceId');
  console.log('  - onshape:elementId');
  process.exit(0);
}

// Setup keypress handler for slow-run
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
    // Handle Ctrl+C
    if (key && key.ctrl && key.name === 'c') {
      console.log('\nCancelled.');
      saveStatus();
      process.exit(0);
    }
  });
  process.stdin.resume();
  console.log('SLOW-RUN mode: will prompt after each delete (y=continue, n=stop, f=fast)\n');
}

// Track results
let deleted = 0;
let failed = 0;
let statusRemoved = 0;
let index = 0;

// Check if entry exists in upload_status.json by elementId
function findInStatus(elementId) {
  if (!uploadStatus || !uploadStatus.partMapping) return false;

  for (const entry of Object.values(uploadStatus.partMapping)) {
    if (entry.elementId === elementId) {
      return true;
    }
  }
  return false;
}

// Remove entry from upload_status.json by elementId
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

// Save upload_status.json if modified
function saveStatus() {
  if (!statusModified || !uploadStatus) return;

  uploadStatus.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statusFile, JSON.stringify(uploadStatus, null, 2));
  console.log(`Updated ${statusFile} (removed ${statusRemoved} entries)`);
}

function deleteNext() {
  // If slow-run is paused, wait for user response
  if (slowRunPaused) {
    setTimeout(deleteNext, 100);
    return;
  }

  if (index >= rowsToDelete.length) {
    // Save updated status file
    saveStatus();

    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total processed: ${rowsToDelete.length}`);
    console.log(`Deleted from Onshape: ${deleted}`);
    console.log(`Removed from status file: ${statusRemoved}`);
    console.log(`Failed: ${failed}`);
    if (dryRun) {
      console.log('(DRY RUN - nothing was actually deleted)');
    }
    // Cleanup stdin
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.exit(0);
  }

  const row = rowsToDelete[index];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const docName = row['document:name'] || 'unknown';
  const filename = row.filename || row.filePath || 'unknown';

  index++;

  console.log(`[${index}/${rowsToDelete.length}] Deleting: ${filename}`);
  console.log(`  Document: ${docName} (${docId})`);
  console.log(`  Element: ${elemId}`);

  if (dryRun) {
    console.log('  [DRY RUN] Would delete element');
    deleted++;
    if (findInStatus(elemId)) {
      console.log('  [DRY RUN] Would remove from status file');
      statusRemoved++;
    }
    promptAndContinue(10);
    return;
  }

  onshape.delete({
    d: docId,
    w: workId,
    e: elemId,
    resource: 'elements'
  }, (result, err) => {
    if (err) {
      console.log(`  FAILED: ${err.body || err.statusCode || err}`);
      failed++;
    } else {
      console.log('  Deleted successfully');
      deleted++;
      // Remove from status file
      if (removeFromStatus(elemId)) {
        console.log('  Removed from status file');
      }
    }
    // Small delay between deletes
    promptAndContinue(200);
  });
}

// Helper to prompt in slow-run mode or continue
function promptAndContinue(delay) {
  if (slowRun && index < rowsToDelete.length) {
    setTimeout(() => {
      slowRunPaused = true;
      process.stdout.write(`\nContinue? (y=yes, n=stop, f=fast): `);
      deleteNext();
    }, delay);
  } else {
    setTimeout(deleteNext, delay);
  }
}

// Start deleting
deleteNext();
