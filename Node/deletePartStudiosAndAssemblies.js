const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');
const readline = require('readline');
const app = require('./lib/app.js');
const onshape = require('./lib/onshape.js');

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'doc', 's'],
  boolean: ['dry-run', 'slow-run', 'h', 'help'],
  alias: { i: 'input', h: 'help', s: 'status' },
  default: {}
});

if (args.help || args.h || (!args.input && !args.doc)) {
  console.log('Delete Part Studios and Assemblies from Onshape Documents');
  console.log('');
  console.log('Usage: node deletePartStudiosAndAssemblies.js -i <excel-file> [options]');
  console.log('       node deletePartStudiosAndAssemblies.js --doc <document-id> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input       Excel file with documents to process (required unless --doc)');
  console.log('  --doc             Single document ID for testing');
  console.log('  -s, --status      Upload status JSON file (default: Upload/upload_status.json)');
  console.log('  --dry-run         Show what would be deleted without deleting');
  console.log('  --slow-run        Prompt after each delete (y=continue, n=stop, f=fast)');
  console.log('  -h, --help        Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('');
  console.log('This script deletes all Part Studios and Assemblies from each document,');
  console.log('keeping Drawings, Blobs, and other element types.');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const singleDoc = args.doc;
const dryRun = args['dry-run'];
let slowRun = args['slow-run'];
let slowRunPaused = false;
const statusFile = args.status || 'Upload/upload_status.json';

// Element types to delete
const TYPES_TO_DELETE = ['PARTSTUDIO', 'ASSEMBLY'];

// Load upload status for cleanup
let uploadStatus = null;
if (fs.existsSync(statusFile)) {
  try {
    uploadStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log(`Upload status loaded: ${statusFile}`);
  } catch (e) {
    console.log(`Warning: Could not parse ${statusFile}: ${e.message}`);
  }
}

/**
 * Remove all records for a document from upload_status.json
 * Cleans fileStatus, partMapping, and assemblyMapping entries matching the docId.
 */
function cleanupStatusForDocument(docId) {
  if (!uploadStatus) return;

  let removed = 0;

  // Remove from fileStatus
  if (uploadStatus.fileStatus) {
    for (const key of Object.keys(uploadStatus.fileStatus)) {
      if (uploadStatus.fileStatus[key].documentId === docId) {
        delete uploadStatus.fileStatus[key];
        removed++;
      }
    }
  }

  // Remove from partMapping
  if (uploadStatus.partMapping) {
    for (const key of Object.keys(uploadStatus.partMapping)) {
      if (uploadStatus.partMapping[key].documentId === docId) {
        delete uploadStatus.partMapping[key];
        removed++;
      }
    }
  }

  // Remove from assemblyMapping
  if (uploadStatus.assemblyMapping) {
    for (const key of Object.keys(uploadStatus.assemblyMapping)) {
      if (uploadStatus.assemblyMapping[key].documentId === docId) {
        delete uploadStatus.assemblyMapping[key];
        removed++;
      }
    }
  }

  if (removed > 0) {
    console.log(`  Removed ${removed} record(s) from upload status for document ${docId}`);
    uploadStatus.lastUpdated = new Date().toISOString();
    fs.writeFileSync(statusFile, JSON.stringify(uploadStatus, null, 2));
  }
}

// Get document IDs from Excel or single --doc flag
let documentIds = [];

if (singleDoc) {
  documentIds = [singleDoc];
  console.log(`Single document mode: ${singleDoc}`);
} else {
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  console.log(`Reading Excel file: ${inputFile}`);
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  // Extract unique document IDs
  const docIdSet = new Set();
  for (const row of data) {
    const docId = row['onshape:documentId'];
    if (docId) {
      docIdSet.add(docId);
    }
  }
  documentIds = Array.from(docIdSet);
  console.log(`Found ${documentIds.length} unique documents`);
}

if (documentIds.length === 0) {
  console.log('No documents to process. Make sure your Excel has the column:');
  console.log('  - onshape:documentId');
  process.exit(0);
}

if (dryRun) {
  console.log('DRY RUN - no elements will be deleted\n');
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
        console.log('\nStopping...');
        printSummary();
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
      printSummary();
      process.exit(0);
    }
  });
  process.stdin.resume();
  console.log('SLOW-RUN mode: will prompt after each delete (y=continue, n=stop, f=fast)\n');
}

// Track results
let docsProcessed = 0;
let elementsDeleted = 0;
let elementsSkipped = 0;
let elementsFailed = 0;
let docIndex = 0;

// Queue of elements to delete for current document
let currentDocId = null;
let currentWorkspaceId = null;
let elementsToDelete = [];
let elementIndex = 0;

function printSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Documents processed: ${docsProcessed}`);
  console.log(`Elements deleted: ${elementsDeleted}`);
  console.log(`Elements skipped (kept): ${elementsSkipped}`);
  console.log(`Elements failed: ${elementsFailed}`);
  if (dryRun) {
    console.log('(DRY RUN - nothing was actually deleted)');
  }
}

function cleanup() {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

function processNextDocument() {
  if (docIndex >= documentIds.length) {
    printSummary();
    cleanup();
    process.exit(0);
  }

  currentDocId = documentIds[docIndex];
  docIndex++;

  console.log(`\n[${docIndex}/${documentIds.length}] Processing document: ${currentDocId}`);

  // First, get the workspace ID for this document
  app.getWorkspaces(currentDocId, (result, err) => {
    if (err) {
      console.log(`  FAILED to get workspaces: ${err.body || err.statusCode || err}`);
      elementsFailed++;
      setTimeout(processNextDocument, 200);
      return;
    }

    let workspaces;
    try {
      workspaces = JSON.parse(result);
    } catch (e) {
      console.log(`  FAILED to parse workspaces response: ${e.message}`);
      elementsFailed++;
      setTimeout(processNextDocument, 200);
      return;
    }

    if (!workspaces || workspaces.length === 0) {
      console.log('  No workspaces found');
      docsProcessed++;
      setTimeout(processNextDocument, 200);
      return;
    }

    // Use the first workspace (main workspace)
    currentWorkspaceId = workspaces[0].id;
    console.log(`  Workspace: ${currentWorkspaceId}`);

    // Get all elements in the document
    app.getElements(currentDocId, currentWorkspaceId, (result, err) => {
      if (err) {
        console.log(`  FAILED to get elements: ${err.body || err.statusCode || err}`);
        elementsFailed++;
        setTimeout(processNextDocument, 200);
        return;
      }

      let elements;
      try {
        elements = JSON.parse(result);
      } catch (e) {
        console.log(`  FAILED to parse elements response: ${e.message}`);
        elementsFailed++;
        setTimeout(processNextDocument, 200);
        return;
      }

      if (!elements || elements.length === 0) {
        console.log('  No elements found');
        docsProcessed++;
        setTimeout(processNextDocument, 200);
        return;
      }

      // Filter to Part Studios and Assemblies
      elementsToDelete = elements.filter(e => TYPES_TO_DELETE.includes(e.elementType));
      const keptElements = elements.filter(e => !TYPES_TO_DELETE.includes(e.elementType));

      console.log(`  Found ${elements.length} elements total:`);
      console.log(`    - ${elementsToDelete.length} to delete (${TYPES_TO_DELETE.join(', ')})`);
      console.log(`    - ${keptElements.length} to keep`);

      // List what will be kept
      for (const e of keptElements) {
        console.log(`      [KEEP] ${e.elementType}: ${e.name}`);
        elementsSkipped++;
      }

      // Check if we'd delete the last element
      if (elementsToDelete.length === elements.length) {
        console.log('  WARNING: Cannot delete all elements (Onshape restriction)');
        console.log('  Keeping one Part Studio to avoid error');
        elementsToDelete = elementsToDelete.slice(0, -1);
        elementsSkipped++;
      }

      if (elementsToDelete.length === 0) {
        console.log('  Nothing to delete');
        docsProcessed++;
        setTimeout(processNextDocument, 200);
        return;
      }

      // Start deleting elements
      elementIndex = 0;
      deleteNextElement();
    });
  });
}

function deleteNextElement() {
  // If slow-run is paused, wait for user response
  if (slowRunPaused) {
    setTimeout(deleteNextElement, 100);
    return;
  }

  if (elementIndex >= elementsToDelete.length) {
    if (!dryRun) {
      cleanupStatusForDocument(currentDocId);
    }
    docsProcessed++;
    setTimeout(processNextDocument, 200);
    return;
  }

  const element = elementsToDelete[elementIndex];
  elementIndex++;

  console.log(`    [${elementIndex}/${elementsToDelete.length}] Deleting ${element.elementType}: ${element.name} (${element.id})`);

  if (dryRun) {
    console.log('      [DRY RUN] Would delete');
    elementsDeleted++;
    promptAndContinue(10);
    return;
  }

  onshape.delete({
    d: currentDocId,
    w: currentWorkspaceId,
    e: element.id,
    resource: 'elements'
  }, (result, err) => {
    if (err) {
      console.log(`      FAILED: ${err.body || err.statusCode || err}`);
      elementsFailed++;
    } else {
      console.log('      Deleted successfully');
      elementsDeleted++;
    }
    promptAndContinue(200);
  });
}

function promptAndContinue(delay) {
  if (slowRun && elementIndex < elementsToDelete.length) {
    setTimeout(() => {
      slowRunPaused = true;
      process.stdout.write(`\nContinue? (y=yes, n=stop, f=fast): `);
      deleteNextElement();
    }, delay);
  } else {
    setTimeout(deleteNextElement, delay);
  }
}

// Start processing
processNextDocument();
