const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

// Configuration
const COMPANY_ID = '6763516217765c31f9561958';

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 's'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', s: 'status', h: 'help', d: 'delay' },
  default: { delay: 1000 }  // Default 1 second between versions
});

if (args.help || args.h || !args.input) {
  console.log('Create Versions from Excel');
  console.log('');
  console.log('Usage: node versionFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file with documents to version (required)');
  console.log('  -o, --output    Output CSV log file (default: <input>_version_log.csv)');
  console.log('  -s, --status    Status JSON file (default: Upload/upload_status.json)');
  console.log('  -d, --delay     Delay between API calls in ms (default: 1000)');
  console.log('  --dry-run       Show what would be versioned without creating versions');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  Version              "yes" to create a version');
  console.log('');
  console.log('Optional columns:');
  console.log('  property:Part number Part number (used for version name)');
  console.log('  property:Revision    Revision number (included in version name)');
  console.log('  document:name        Document name for logging');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
const delayMs = parseInt(args.delay) || 1000;

// Generate output log filename
const outputFile = args.output || inputFile.replace(/\.(xlsx|xls)$/i, '') + '_version_log.csv';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Load or initialize upload_status.json
const statusFile = args.status || 'Upload/upload_status.json';
let status = { partMapping: {}, assemblyMapping: {}, files: {} };
console.log(`Status file: ${statusFile}`);
if (fs.existsSync(statusFile)) {
  try {
    status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log(`Loaded status (${Object.keys(status.partMapping || {}).length} parts, ${Object.keys(status.assemblyMapping || {}).length} assemblies)`);
  } catch (e) {
    console.warn(`Warning: Could not parse ${statusFile}, starting fresh`);
  }
} else {
  console.log(`Status file not found, will create new one`);
}

function saveStatus() {
  status.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// Update upload_status with versionId
function updateStatusWithVersionId(partNumber, elementId, versionId) {
  if (!partNumber || !versionId) return false;

  // Check partMapping first
  if (status.partMapping && status.partMapping[partNumber]) {
    status.partMapping[partNumber].versionId = versionId;
    console.log(`    Updated partMapping[${partNumber}].versionId = ${versionId}`);
    return true;
  }

  // Check assemblyMapping
  if (status.assemblyMapping && status.assemblyMapping[partNumber]) {
    status.assemblyMapping[partNumber].versionId = versionId;
    console.log(`    Updated assemblyMapping[${partNumber}].versionId = ${versionId}`);
    return true;
  }

  return false;
}

// Log entries for CSV output
const logEntries = [];

// Extract meaningful error message from API error
function extractErrorMessage(err) {
  if (!err) return '';
  if (err.body) {
    try {
      const parsed = JSON.parse(err.body);
      return parsed.message || parsed.error || err.body;
    } catch (e) {
      return String(err.body);
    }
  }
  return err.statusCode ? `HTTP ${err.statusCode}` : String(err);
}

// Read Excel file
console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} rows`);

if (dryRun) {
  console.log('DRY RUN - no versions will be created\n');
}

// Filter to rows that have required IDs and Version column
const rowsToVersion = data.filter(row => {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const version = (row.Version || '').toString().toLowerCase().trim();
  return docId && workId && version === 'yes';
});

console.log(`Found ${rowsToVersion.length} rows with Version=yes\n`);

if (rowsToVersion.length === 0) {
  console.log('No documents to version. Make sure your Excel has:');
  console.log('  - onshape:documentId');
  console.log('  - onshape:workspaceId');
  console.log('  - Version column with "yes"');
  process.exit(0);
}

// Track results
let versioned = 0;
let skipped = 0;
let failed = 0;
let index = 0;

// Write CSV log file
function writeLogFile() {
  const header = ['Filename', 'DocumentId', 'WorkspaceId', 'PartNumber', 'Revision', 'Status', 'Error', 'VersionId', 'VersionName'];

  const rows = logEntries.map(entry => {
    return [
      entry.filename,
      entry.documentId,
      entry.workspaceId,
      entry.partNumber || '',
      entry.revision || '',
      entry.status,
      entry.error || '',
      entry.versionId || '',
      entry.versionName || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [header.join(','), ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);
  console.log(`\nLog saved to: ${outputFile}`);
}

// Update Excel with versionId
function updateExcelWithVersionId(docId, versionId) {
  // Find matching row(s) and update
  data.forEach(row => {
    if (row['onshape:documentId'] === docId) {
      row['onshape:versionId'] = versionId;
    }
  });
}

// Save updated Excel
function saveUpdatedExcel() {
  const ext = pathModule.extname(inputFile);
  const base = pathModule.basename(inputFile, ext);
  const dir = pathModule.dirname(inputFile);
  const outputPath = pathModule.join(dir, `${base}_versioned${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  xlsx.writeFile(newWorkbook, outputPath);

  console.log(`Updated Excel saved to: ${outputPath}`);
}

// Create version for a document
function createVersion(docId, workId, versionName, callback) {
  onshape.post({
    path: `/api/documents/d/${docId}/versions`,
    body: {
      name: versionName,
      documentId: docId,
      workspaceId: workId
    }
  }, (data, err) => {
    if (err) {
      callback(null, err);
      return;
    }
    callback(JSON.parse(data.toString()));
  });
}

function versionNext() {
  if (index >= rowsToVersion.length) {
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total processed: ${rowsToVersion.length}`);
    console.log(`Versioned: ${versioned}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
    if (dryRun) {
      console.log('(DRY RUN - nothing was actually versioned)');
    }
    writeLogFile();
    saveUpdatedExcel();
    process.exit(0);
  }

  const row = rowsToVersion[index];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const docName = row['document:name'] || row.filename || row.filePath || row['File Name'] || 'unknown';
  const partNumber = row['property:Part number'] || '';
  const revision = row['property:Revision'] || '';

  // Format revision for version name
  let formattedRevision = revision;
  if (/^\d+$/.test(formattedRevision)) {
    formattedRevision = String(formattedRevision).padStart(2, '0');
  }

  // Build version name
  let versionName = partNumber || docName;
  if (formattedRevision) {
    versionName += ` Rev ${formattedRevision}`;
  }

  index++;

  console.log(`[${index}/${rowsToVersion.length}] ${docName}`);
  console.log(`  Document: ${docId}`);
  console.log(`  Version name: ${versionName}`);

  // Check if already has a versionId
  if (row['onshape:versionId']) {
    console.log(`  SKIPPED: Already has versionId: ${row['onshape:versionId']}`);
    logEntries.push({
      filename: docName,
      documentId: docId,
      workspaceId: workId,
      partNumber: partNumber,
      revision: formattedRevision,
      status: 'skipped',
      error: 'Already has versionId',
      versionId: row['onshape:versionId'],
      versionName: ''
    });
    skipped++;
    setTimeout(versionNext, 100);
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would create version: ${versionName}`);
    logEntries.push({
      filename: docName,
      documentId: docId,
      workspaceId: workId,
      partNumber: partNumber,
      revision: formattedRevision,
      status: 'dry-run',
      error: '',
      versionId: '',
      versionName: versionName
    });
    versioned++;
    setTimeout(versionNext, 10);
    return;
  }

  createVersion(docId, workId, versionName, (versionInfo, versionErr) => {
    if (versionErr) {
      const errorMsg = extractErrorMessage(versionErr);
      console.log(`  FAILED: ${errorMsg}`);
      logEntries.push({
        filename: docName,
        documentId: docId,
        workspaceId: workId,
        partNumber: partNumber,
        revision: formattedRevision,
        status: 'failed',
        error: errorMsg,
        versionId: '',
        versionName: versionName
      });
      failed++;
      setTimeout(versionNext, delayMs);
      return;
    }

    const versionId = versionInfo.id;
    console.log(`  Created version: ${versionId}`);

    // Update Excel data
    updateExcelWithVersionId(docId, versionId);

    // Update status file
    updateStatusWithVersionId(partNumber, null, versionId);
    saveStatus();

    logEntries.push({
      filename: docName,
      documentId: docId,
      workspaceId: workId,
      partNumber: partNumber,
      revision: formattedRevision,
      status: 'success',
      error: '',
      versionId: versionId,
      versionName: versionName
    });
    versioned++;
    setTimeout(versionNext, delayMs);
  });
}

// Start the version process
console.log('Starting version creation...\n');
versionNext();
