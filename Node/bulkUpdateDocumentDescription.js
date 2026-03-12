const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

// Global state
let status = {};
let statusFile = '';
let dryRun = false;

// Load or initialize status
function loadStatus(filePath) {
  const defaultStatus = {
    lastUpdated: new Date().toISOString(),
    documentStatus: {}
  };

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      return { ...defaultStatus, ...parsed };
    } catch (e) {
      console.warn('Warning: Could not parse status file, starting fresh');
      return defaultStatus;
    }
  }
  return defaultStatus;
}

// Save status
function saveStatus() {
  status.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// Update a single document's description
function updateDocument(documentId, description, callback) {
  if (dryRun) {
    console.log(`  [DRY RUN] Would update description to: "${description}"`);
    callback(null, { name: '(dry run)', description: description });
    return;
  }

  onshape.post({
    path: '/api/documents/' + documentId,
    body: { description: description }
  }, (data, err) => {
    if (err) {
      callback(err, null);
      return;
    }
    const result = JSON.parse(data.toString());
    callback(null, result);
  });
}

// Process a single row
function processRow(row, callback) {
  const documentId = row['onshape:documentId'] || row.documentId || row.DocumentId || row['Document ID'] || row.document_id;
  const description = row['property:Description'] || row.description || row.Description || row.desc || '';

  if (!documentId) {
    console.log(`\nSkipping row: no documentId found`);
    callback();
    return;
  }

  console.log(`\nProcessing: ${documentId}`);

  // Check if already updated
  if (status.documentStatus[documentId]?.status === 'updated') {
    console.log(`  Already updated, skipping`);
    callback();
    return;
  }

  updateDocument(documentId, description, (err, result) => {
    if (err) {
      const errMsg = err.body || err.statusCode || err;
      console.error(`  Failed: ${errMsg}`);
      status.documentStatus[documentId] = {
        status: 'failed',
        error: String(errMsg),
        timestamp: new Date().toISOString()
      };
      saveStatus();
      callback();
      return;
    }

    console.log(`  Updated: ${result.name}`);
    console.log(`  Description: ${result.description}`);
    status.documentStatus[documentId] = {
      status: 'updated',
      name: result.name,
      description: result.description,
      timestamp: new Date().toISOString()
    };
    saveStatus();
    callback();
  });
}

// Process Excel file
function processExcelFile(excelFilePath) {
  console.log(`Reading Excel file: ${excelFilePath}`);

  const workbook = xlsx.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  if (data.length === 0) {
    console.error('Excel file is empty.');
    return;
  }

  console.log(`Processing ${data.length} rows...\n`);

  // Process sequentially
  let index = 0;
  function processNext() {
    if (index >= data.length) {
      console.log('\n=== Update Complete ===');
      console.log(`Status saved to: ${statusFile}`);

      // Summary
      const updated = Object.values(status.documentStatus).filter(s => s.status === 'updated').length;
      const failed = Object.values(status.documentStatus).filter(s => s.status === 'failed').length;
      console.log(`Updated: ${updated}, Failed: ${failed}`);
      return;
    }

    const row = data[index];
    index++;

    processRow(row, () => {
      // Small delay between API calls
      setTimeout(processNext, 200);
    });
  }

  processNext();
}

// Show usage
function showUsage() {
  console.log('\nBulk Update Document Descriptions\n');
  console.log('Usage: node bulkUpdateDocumentDescription.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>       Input Excel file (required)');
  console.log('  -s <path>       Status JSON file (default: description_update_status.json)');
  console.log('  --dry-run       Show what would happen without updating');
  console.log('  -h, --help      Show this help\n');
  console.log('Excel columns expected:');
  console.log('  documentId      Onshape document ID (required)');
  console.log('  description     New description text\n');
  console.log('Example:');
  console.log('  node bulkUpdateDocumentDescription.js -i descriptions.xlsx\n');
}

// Main
function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const excelFile = argv.i;
  statusFile = argv.s || 'description_update_status.json';
  dryRun = argv['dry-run'] || false;

  if (!excelFile) {
    console.error('Error: Input Excel file required (-i)');
    showUsage();
    process.exit(1);
  }

  if (!fs.existsSync(excelFile)) {
    console.error(`Excel file not found: ${excelFile}`);
    process.exit(1);
  }

  // Load status
  status = loadStatus(statusFile);
  console.log(`Status file: ${statusFile}`);
  console.log(`Dry run: ${dryRun}`);

  processExcelFile(excelFile);
}

// Run
main();
