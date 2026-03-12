#!/usr/bin/env node
/**
 * deleteEmptyDocuments.js
 *
 * Reads a tab-separated text file with documentId\tworkspaceId per line.
 * For each document, lists elements — if zero elements, deletes (moves to trash).
 */

const fs = require('fs');
const minimist = require('minimist');
const readline = require('readline');
const onshape = require('./lib/onshape.js');

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i'],
  boolean: ['dry-run', 'slow-run', 'h', 'help'],
  alias: { i: 'input', h: 'help' }
});

if (args.help || args.h || !args.input) {
  console.log('Delete Empty Documents');
  console.log('');
  console.log('Checks each document for elements — deletes (moves to trash) if empty.');
  console.log('');
  console.log('Usage: node deleteEmptyDocuments.js -i <input-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input       Tab-separated text file: documentId\\tworkspaceId (required)');
  console.log('  --dry-run         Check documents but do not delete');
  console.log('  --slow-run        Prompt after each document (y/n/f)');
  console.log('  -h, --help        Show this help');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
let slowRun = args['slow-run'];
let slowRunPaused = false;

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

// --- Parse input file ---

const lines = fs.readFileSync(inputFile, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0);

const docs = lines.map((line, idx) => {
  const parts = line.split('\t');
  if (parts.length < 2) {
    console.warn(`Line ${idx + 1}: expected tab-separated documentId\\tworkspaceId, got: ${line}`);
    return null;
  }
  return { docId: parts[0].trim(), workId: parts[1].trim() };
}).filter(Boolean);

console.log(`Loaded ${docs.length} documents from ${inputFile}`);
if (dryRun) console.log('DRY RUN - no documents will be deleted\n');

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
        printSummary();
        process.exit(0);
      } else if (key.name === 'f') {
        console.log(' switching to fast mode...');
        slowRun = false;
        slowRunPaused = false;
      }
    }
    if (key && key.ctrl && key.name === 'c') {
      console.log('\nCancelled.');
      printSummary();
      process.exit(0);
    }
  });
  process.stdin.resume();
  console.log('SLOW-RUN mode: will prompt after each document (y=continue, n=stop, f=fast)\n');
}

// --- Counters ---

let checked = 0;
let empty = 0;
let deleted = 0;
let notEmpty = 0;
let errors = 0;

function printSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total checked: ${checked}`);
  console.log(`Empty (0 elements): ${empty}`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Not empty (skipped): ${notEmpty}`);
  console.log(`Errors: ${errors}`);
  if (dryRun) console.log('(DRY RUN - nothing was actually deleted)');
}

// --- Main processing ---

async function processDoc(doc, idx) {
  const { docId, workId } = doc;

  process.stdout.write(`[${idx + 1}/${docs.length}] ${docId} ... `);

  // Step 1: List elements
  let elements;
  try {
    elements = await apiGet(`/api/v13/documents/d/${docId}/w/${workId}/elements`);
  } catch (e) {
    if (e.statusCode === 404) {
      console.log('NOT FOUND (already deleted?)');
      errors++;
      return;
    }
    console.log(`ERROR listing elements: ${e.statusCode || e.message || e}`);
    errors++;
    return;
  }

  checked++;
  const count = Array.isArray(elements) ? elements.length : 0;

  if (count > 0) {
    console.log(`${count} element(s) — skipped`);
    notEmpty++;
    return;
  }

  // Step 2: Empty document — delete it
  empty++;

  if (dryRun) {
    console.log('EMPTY — would delete');
    deleted++;
    return;
  }

  try {
    await apiDelete({ path: '/api/v13/documents/' + docId });
    console.log('EMPTY — deleted');
    deleted++;
  } catch (e) {
    console.log(`EMPTY — DELETE FAILED: ${e.statusCode || e.body || e}`);
    errors++;
  }
}

async function main() {
  for (let i = 0; i < docs.length; i++) {
    // Wait if slow-run is paused
    while (slowRunPaused) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await processDoc(docs[i], i);

    // Delay between documents
    if (i < docs.length - 1) {
      if (slowRun) {
        slowRunPaused = true;
        process.stdout.write(`Continue? (y=yes, n=stop, f=fast): `);
      } else {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  printSummary();

  // Cleanup stdin
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
