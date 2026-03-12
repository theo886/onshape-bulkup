const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  string: ['i', 's'],
  boolean: ['dry-run', 'h', 'help', 'name-only', 'desc-only'],
  alias: { i: 'input', s: 'status', h: 'help', d: 'delay' },
  default: { delay: 200 }
});

if (argv.help || !argv.input) {
  console.log('Rename Documents & Update Descriptions from Excel');
  console.log('');
  console.log('Usage: node renameDocumentsFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file (required)');
  console.log('  -s, --status    Status JSON file (default: rename_status.json)');
  console.log('  -d, --delay     Min delay between API calls in ms (default: 200)');
  console.log('  --name-only     Only rename documents (skip description)');
  console.log('  --desc-only     Only update descriptions (skip rename)');
  console.log('  --dry-run       Show what would be changed without changing');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('');
  console.log('Optional Excel columns (at least one required):');
  console.log('  document:name        New document name');
  console.log('  property:Description New document description');
  console.log('');
  console.log('Examples:');
  console.log('  node renameDocumentsFromExcel.js -i docs.xlsx --dry-run');
  console.log('  node renameDocumentsFromExcel.js -i docs.xlsx');
  console.log('  node renameDocumentsFromExcel.js -i docs.xlsx --name-only');
  process.exit(0);
}

const inputFile = argv.input;
const dryRun = argv['dry-run'];
const nameOnly = argv['name-only'];
const descOnly = argv['desc-only'];
const statusFile = argv.status || 'rename_status.json';

// Adaptive rate limiting
const MIN_DELAY_MS = parseInt(argv.delay) || 200;
const MAX_DELAY_MS = 5000;
const LOW_REMAINING_THRESHOLD = 10;
let currentDelay = MIN_DELAY_MS;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Load or initialize status (for crash-safe resume)
function loadStatus(filePath) {
  const defaultStatus = { lastUpdated: new Date().toISOString(), documentStatus: {} };
  if (fs.existsSync(filePath)) {
    try {
      return { ...defaultStatus, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    } catch (e) {
      console.warn('Warning: Could not parse status file, starting fresh');
      return defaultStatus;
    }
  }
  return defaultStatus;
}

let status = loadStatus(statusFile);

function saveStatus() {
  status.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// Read Excel
console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);
console.log(`Found ${data.length} rows`);

// Filter to rows with a document ID and at least one thing to update
const rows = data.filter(row => {
  const docId = row['onshape:documentId'];
  if (!docId) return false;
  const name = row['document:name'];
  const desc = row['property:Description'];
  return (name !== undefined && name !== null && name !== '') ||
         (desc !== undefined && desc !== null && desc !== '');
});

console.log(`Found ${rows.length} rows with document ID and name/description to update`);
if (dryRun) console.log('DRY RUN - no changes will be made');
if (nameOnly) console.log('NAME ONLY - skipping description updates');
if (descOnly) console.log('DESC ONLY - skipping name updates');
console.log(`Status file: ${statusFile}\n`);

if (rows.length === 0) {
  console.log('Nothing to do. Check that your Excel has columns:');
  console.log('  - onshape:documentId');
  console.log('  - document:name (and/or) property:Description');
  process.exit(0);
}

// Counters
let updated = 0;
let skipped = 0;
let failed = 0;
let index = 0;

function processNext() {
  if (index >= rows.length) {
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total processed: ${rows.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (already done): ${skipped}`);
    console.log(`Failed: ${failed}`);
    if (dryRun) console.log('(DRY RUN - nothing was actually changed)');
    console.log(`Status saved to: ${statusFile}`);
    process.exit(0);
  }

  const row = rows[index];
  const docId = row['onshape:documentId'];
  const newName = row['document:name'];
  const newDesc = row['property:Description'];
  index++;

  const rateDisplay = currentDelay > MIN_DELAY_MS ? ` [delay: ${currentDelay}ms]` : '';
  console.log(`[${index}/${rows.length}]${rateDisplay} Document: ${docId}`);

  // Check if already updated
  if (status.documentStatus[docId]?.status === 'updated') {
    console.log('  Already updated, skipping');
    skipped++;
    setTimeout(processNext, 10);
    return;
  }

  // Build the update body
  const body = {};
  if (newName && !descOnly) {
    body.name = String(newName);
    console.log(`  Name -> "${body.name}"`);
  }
  if (newDesc !== undefined && newDesc !== null && newDesc !== '' && !nameOnly) {
    body.description = String(newDesc);
    console.log(`  Description -> "${body.description}"`);
  }

  if (Object.keys(body).length === 0) {
    console.log('  Nothing to update - skipping');
    skipped++;
    setTimeout(processNext, 10);
    return;
  }

  if (dryRun) {
    console.log('  [DRY RUN] Would update');
    updated++;
    setTimeout(processNext, 10);
    return;
  }

  // Single API call updates both name and description
  let retryCount = 0;
  const maxRetries = 3;

  function attemptUpdate() {
    onshape.post({
      path: `/api/documents/${docId}`,
      body: body
    }, (data, err, rateInfo) => {
      // Adaptive rate limiting
      if (rateInfo && rateInfo.remaining !== undefined) {
        const remaining = parseInt(rateInfo.remaining, 10);
        if (remaining < LOW_REMAINING_THRESHOLD) {
          currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
        } else {
          currentDelay = MIN_DELAY_MS;
        }
      }

      if (err) {
        // Rate limit retry
        if (err.statusCode === 429 && retryCount < maxRetries) {
          const retryAfter = parseInt(err.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
          retryCount++;
          currentDelay = MAX_DELAY_MS;
          console.log(`  Rate limited. Waiting ${retryAfter}s (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(attemptUpdate, retryAfter * 1000);
          return;
        }

        const errMsg = err.body || err.statusCode || String(err);
        console.log(`  FAILED: ${errMsg}`);
        status.documentStatus[docId] = {
          status: 'failed',
          error: String(errMsg),
          requestedName: body.name || null,
          requestedDescription: body.description || null,
          timestamp: new Date().toISOString()
        };
        saveStatus();
        failed++;
        setTimeout(processNext, currentDelay);
        return;
      }

      let result = {};
      try { result = JSON.parse(data.toString()); } catch (e) {}

      console.log(`  Updated: "${result.name || '(unknown)'}"`);
      status.documentStatus[docId] = {
        status: 'updated',
        name: result.name || body.name,
        description: result.description || body.description,
        timestamp: new Date().toISOString()
      };
      saveStatus();
      updated++;
      setTimeout(processNext, currentDelay);
    });
  }

  attemptUpdate();
}

// Start processing
processNext();
