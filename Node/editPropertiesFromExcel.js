const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');

// Property ID map (same as unifiedUpload.js)
const propertyIdMap = {
  'Appearance': '57f3fb8efa3416c06701d60c',
  'Name': '57f3fb8efa3416c06701d60d',
  'Description': '57f3fb8efa3416c06701d60e',
  'Category': '57f3fb8efa3416c06701d625',
  'Part number': '57f3fb8efa3416c06701d60f',
  'Revision': '57f3fb8efa3416c06701d610',
  'State': '57f3fb8efa3416c06701d611',
  'Vendor': '57f3fb8efa3416c06701d612',
  'Project': '57f3fb8efa3416c06701d613',
  'Product line': '57f3fb8efa3416c06701d614',
  'Material': '57f3fb8efa3416c06701d615',
  'Title 1': '57f3fb8efa3416c06701d616',
  'Title 2': '57f3fb8efa3416c06701d617',
  'Title 3': '57f3fb8efa3416c06701d618',
  'Drawn by': '57f3fb8efa3416c06701d619',
  'Approver': '57f3fb8efa3416c06701d61a',
  'Date drawn': '57f3fb8efa3416c06701d61b',
  'Date approved': '57f3fb8efa3416c06701d61c',
  'Not revision managed': '57f3fb8efa3416c06701d61d',
  'Exclude from all BOMs': '57f3fb8efa3416c06701d61e',
  'Start date': '57f3fb8efa3416c06701d61f',
  'Due date': '57f3fb8efa3416c06701d621',
  'Completed date': '57f3fb8efa3416c06701d622',
  'Unit of measure': '57f3fb8efa3416c06701d623',
  'Classification': '57f3fb8efa3416c06701d624',
  'Mass': '57f3fb8efa3416c06701d626',
  'Center of mass': '57f3fb8efa3416c06701d627',
  'Inertia': '57f3fb8efa3416c06701d628',
  'Last changed date': '57f3fb8efa3416c06701d629',
  'Last changed by': '57f3fb8efa3416c06701d62a',
  'Revision description': '57f3fb8efa3416c06701d62b',
  'Priority': '57f3fb8efa3416c06701d62c',
  'Need date': '57f3fb8efa3416c06701d62d',
  'Reason for change': '57f3fb8efa3416c06701d62e',
  'Proposed solution': '57f3fb8efa3416c06701d62f',
  'Inspection count': '57f3fb8efa3416c06701d630',
  'Subassembly BOM behavior': '57f3fb8efa3416c06701d633',
  'Sheet': '57f3fb8efa3416c06701d634',
  'Type': '57f3fb8efa3416c06701d635',
  'Units': '57f3fb8efa3416c06701d636',
  'Nominal value': '57f3fb8efa3416c06701d637',
  'Upper limit': '57f3fb8efa3416c06701d638',
  'Lower limit': '57f3fb8efa3416c06701d639',
  'Tolerance': '57f3fb8efa3416c06701d640',
  'Change number': '57f3fb8efa3416c06701d641',
  'Nominal & tolerance': '57f3fb8efa3416c06701d642',
  'Library label': '57f3fb8efa3416c06701d643',
  'Item': '5ace8269c046ad612c65a0ba',
  'Tessellation quality': '5ace8269c046ad612c65a0bb',
  'Quantity': '5ace84d3c046ad611c65a0dd',
  'Faces': '5ace84d3c046ad611c65a0de',
  'Suppression': '5ace84d3c046ad611c65a0df',
  'ECO': '68b76e59c462aacfb466c5a2',
  'ECO Priority': '68b77329d5d6264db394441f',
  'Urgent ECO': '68b78be43536441c2b575acb',
  'SW_Configuration': '68c0f95ea01853b62770d56b',
  'Status': '68c0fa54a1edc754a12826ab',
  'SW_PDM_ID': '68c0fafba01853b6277149eb',
  'D365_ID': '68c0fb29a1edc754a1286937',
  'Checked': '68c0fbf0bdccb1e905e8667f',
  'Date Checked': '68c0fc01bdccb1e905e86a94',
  'DrawingNumber_Import': '68c0fd00bdccb1e905e8ab0f',
  'SWFormatSize_Import': '68c0fe28a1edc754a1295b13',
  'Part Family_Import': '68c0ff72a1edc754a129c663'
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', h: 'help', d: 'delay' },
  default: { delay: 2000 }  // Default 2 seconds between requests
});

if (args.help || args.h || !args.input) {
  console.log('Edit Properties from Excel');
  console.log('');
  console.log('Usage: node editPropertiesFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file with elements to edit (required)');
  console.log('  -o, --output    Output CSV log file (default: <input>_edit_log.csv)');
  console.log('  -d, --delay     Minimum delay between API calls in ms (default: 200, auto-increases when rate limited)');
  console.log('  --dry-run       Show what would be changed without changing');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  onshape:elementId    Element ID');
  console.log('');
  console.log('Property columns (only filled values will be updated):');
  console.log('  property:Part number');
  console.log('  property:Description');
  console.log('  property:Status');
  console.log('  property:SW_PDM_ID');
  console.log('  property:D365_ID');
  console.log('  ... and any other property:* columns');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];

// Adaptive rate limiting settings
const MIN_DELAY_MS = parseInt(args.delay) || 200;  // Minimum delay between requests
const MAX_DELAY_MS = 5000;                          // Maximum delay when rate limit is low
const LOW_REMAINING_THRESHOLD = 10;                 // Start slowing down when remaining drops below this
let currentDelay = MIN_DELAY_MS;

// Generate output log filename
const outputFile = args.output || inputFile.replace(/\.(xlsx|xls)$/i, '') + '_edit_log.csv';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
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

// Build properties array from row
function buildPropertiesArray(row) {
  const propertiesToUpdate = [];
  for (const key in row) {
    if (key.startsWith('property:')) {
      const propertyName = key.split(':')[1];
      const propertyId = propertyIdMap[propertyName];
      let value = row[key];

      // Skip empty values
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Convert to string
      value = String(value);

      // Pad Revision to 2 digits
      if (propertyName === 'Revision' && /^\d+$/.test(value)) {
        value = value.padStart(2, '0');
      }

      if (propertyId) {
        propertiesToUpdate.push({
          propertyId: propertyId,
          value: value
        });
      } else {
        console.log(`  Warning: Unknown property "${propertyName}" - skipping`);
      }
    }
  }
  return propertiesToUpdate;
}

// Read Excel file
console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} rows`);

if (dryRun) {
  console.log('DRY RUN - no properties will be changed\n');
}

// Filter to rows that have all required IDs
const rowsToEdit = data.filter(row => {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  return docId && workId && elemId;
});

console.log(`Found ${rowsToEdit.length} rows with valid document/workspace/element IDs\n`);

if (rowsToEdit.length === 0) {
  console.log('No elements to edit. Make sure your Excel has these columns:');
  console.log('  - onshape:documentId');
  console.log('  - onshape:workspaceId');
  console.log('  - onshape:elementId');
  console.log('  - property:* (at least one property column with values)');
  process.exit(0);
}

// Track results
let updated = 0;
let skipped = 0;
let failed = 0;
let index = 0;

// Write CSV log file
function writeLogFile() {
  // Get all unique property names from log entries
  const allPropNames = new Set();
  logEntries.forEach(entry => {
    Object.keys(entry.properties || {}).forEach(name => allPropNames.add(name));
  });
  const propColumns = Array.from(allPropNames).sort();

  // Build CSV header
  const header = ['Filename', 'DocumentId', 'WorkspaceId', 'ElementId', 'Status', 'Error', ...propColumns];

  // Build CSV rows
  const rows = logEntries.map(entry => {
    const row = [
      entry.filename,
      entry.documentId,
      entry.workspaceId,
      entry.elementId,
      entry.status,
      entry.error || ''
    ];
    // Add property values in order
    propColumns.forEach(propName => {
      row.push(entry.properties[propName] || '');
    });
    return row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [header.join(','), ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);
  console.log(`\nLog saved to: ${outputFile}`);
}

function editNext() {
  if (index >= rowsToEdit.length) {
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total processed: ${rowsToEdit.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (no properties): ${skipped}`);
    console.log(`Failed: ${failed}`);
    if (dryRun) {
      console.log('(DRY RUN - nothing was actually changed)');
    }
    writeLogFile();
    process.exit(0);
  }

  const row = rowsToEdit[index];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const docName = row['document:name'] || 'unknown';
  const filename = row.filename || row.filePath || row['File Name'] || 'unknown';

  index++;

  const properties = buildPropertiesArray(row);

  // Build properties map for logging (name -> value)
  const propsMap = {};
  properties.forEach(p => {
    const propName = Object.keys(propertyIdMap).find(k => propertyIdMap[k] === p.propertyId) || p.propertyId;
    propsMap[propName] = p.value;
  });

  const rateDisplay = currentDelay > MIN_DELAY_MS ? ` [delay: ${currentDelay}ms]` : '';
  console.log(`[${index}/${rowsToEdit.length}]${rateDisplay} ${filename}`);
  console.log(`  Document: ${docName} (${docId})`);
  console.log(`  Element: ${elemId}`);

  if (properties.length === 0) {
    console.log('  No properties to update - skipping');
    logEntries.push({
      filename, documentId: docId, workspaceId: workId, elementId: elemId,
      status: 'skipped', error: 'No properties to update', properties: propsMap
    });
    skipped++;
    setTimeout(editNext, 10);
    return;
  }

  console.log(`  Properties to update: ${properties.length}`);
  properties.forEach(p => {
    const propName = Object.keys(propertyIdMap).find(k => propertyIdMap[k] === p.propertyId) || p.propertyId;
    console.log(`    - ${propName}: "${p.value}"`);
  });

  if (dryRun) {
    console.log('  [DRY RUN] Would update properties');
    logEntries.push({
      filename, documentId: docId, workspaceId: workId, elementId: elemId,
      status: 'dry-run', error: '', properties: propsMap
    });
    updated++;
    setTimeout(editNext, 10);
    return;
  }

  // Check if this is a known BLOB file type (non-Part Studio)
  const blobExtensions = ['.STEP', '.STP', '.IGES', '.IGS', '.DWG', '.DXF', '.PDF', '.SLDDRW', '.DOC', '.DOCX', '.XLS', '.XLSX', '.ZIP', '.RAR', '.PNG', '.JPG', '.JPEG', '.BMP', '.TIF', '.TIFF', '.GIF'];
  const ext = pathModule.extname(filename).toUpperCase();
  const isLikelyBlob = blobExtensions.includes(ext);

  if (isLikelyBlob) {
    // Skip parts API call - go directly to element metadata
    console.log(`  BLOB element (${ext}) - setting element properties`);
    setPropertiesOnElement();
    return;
  }

  // For Part Studios and Assemblies, check if this element has parts
  onshape.get({
    path: `/api/parts/d/${docId}/w/${workId}/e/${elemId}`
  }, (partsData, partsErr, rateInfo) => {
    // Adjust delay based on rate limit remaining
    if (rateInfo && rateInfo.remaining !== undefined) {
      const remaining = parseInt(rateInfo.remaining, 10);
      if (remaining < LOW_REMAINING_THRESHOLD) {
        currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
      } else {
        currentDelay = MIN_DELAY_MS;
      }
    }

    let parts = [];
    if (!partsErr && partsData) {
      try {
        parts = JSON.parse(partsData.toString());
      } catch (e) {
        parts = [];
      }
    }

    if (parts.length > 0) {
      // This is a Part Studio - set properties on each part
      console.log(`  Found ${parts.length} part(s) in Part Studio`);
      setPropertiesOnParts(parts);
    } else {
      // This is a blob or empty Part Studio - set properties on element
      setPropertiesOnElement();
    }
  });

  function setPropertiesOnParts(parts) {
    let partIndex = 0;
    let partErrors = [];

    function updateNextPart() {
      if (partIndex >= parts.length) {
        // All parts processed
        if (partErrors.length > 0) {
          logEntries.push({
            filename, documentId: docId, workspaceId: workId, elementId: elemId,
            status: 'failed', error: partErrors.join('; '), properties: propsMap
          });
          failed++;
        } else {
          logEntries.push({
            filename, documentId: docId, workspaceId: workId, elementId: elemId,
            status: 'success', error: '', properties: propsMap
          });
          updated++;
        }
        setTimeout(editNext, currentDelay);
        return;
      }

      const part = parts[partIndex];
      console.log(`  Setting properties on part: ${part.name}`);

      onshape.post({
        path: `/api/metadata/d/${docId}/w/${workId}/e/${elemId}/p/${part.partId}`,
        body: { properties: properties }
      }, (_, updateErr, rateInfo) => {
        // Adjust delay based on rate limit remaining
        if (rateInfo && rateInfo.remaining !== undefined) {
          const remaining = parseInt(rateInfo.remaining, 10);
          if (remaining < LOW_REMAINING_THRESHOLD) {
            currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
            console.log(`    [Rate limit: ${remaining} remaining, delay: ${currentDelay}ms]`);
          } else {
            currentDelay = MIN_DELAY_MS;
          }
        }

        if (updateErr) {
          const errorMsg = extractErrorMessage(updateErr);

          // Check for rate limit (429) - retry this part
          if (updateErr.statusCode === 429) {
            const retryAfter = parseInt(updateErr.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
            currentDelay = MAX_DELAY_MS;
            console.log(`    Rate limited. Waiting ${retryAfter}s before retry...`);
            setTimeout(updateNextPart, retryAfter * 1000);
            return;
          }

          partErrors.push(`${part.name}: ${errorMsg}`);
          console.log(`    FAILED: ${errorMsg}`);
        } else {
          console.log(`    Part ${part.name} updated`);
        }

        partIndex++;
        setTimeout(updateNextPart, currentDelay);
      });
    }

    updateNextPart();
  }

  function setPropertiesOnElement() {
    // Retry logic for rate limiting
    let retryCount = 0;
    const maxRetries = 3;

    function attemptUpdate() {
      onshape.post({
        path: `/api/metadata/d/${docId}/w/${workId}/e/${elemId}`,
        body: { properties: properties }
      }, (result, err, rateInfo) => {
        // Adjust delay based on rate limit remaining
        if (rateInfo && rateInfo.remaining !== undefined) {
          const remaining = parseInt(rateInfo.remaining, 10);
          if (remaining < LOW_REMAINING_THRESHOLD) {
            currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
            console.log(`  [Rate limit: ${remaining} remaining, delay: ${currentDelay}ms]`);
          } else {
            currentDelay = MIN_DELAY_MS;
          }
        }

        if (err) {
          const errorMsg = extractErrorMessage(err);

          // Check for rate limit (429)
          if (err.statusCode === 429 && retryCount < maxRetries) {
            const retryAfter = parseInt(err.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
            retryCount++;
            currentDelay = MAX_DELAY_MS;
            console.log(`  Rate limited. Waiting ${retryAfter}s before retry (attempt ${retryCount}/${maxRetries})...`);
            setTimeout(attemptUpdate, retryAfter * 1000);
            return;
          }

          console.log(`  FAILED: ${errorMsg}`);
          logEntries.push({
            filename, documentId: docId, workspaceId: workId, elementId: elemId,
            status: 'failed', error: errorMsg, properties: propsMap
          });
          failed++;
        } else {
          console.log('  Updated successfully');
          logEntries.push({
            filename, documentId: docId, workspaceId: workId, elementId: elemId,
            status: 'success', error: '', properties: propsMap
          });
          updated++;
        }
        // Delay between updates using adaptive rate
        setTimeout(editNext, currentDelay);
      });
    }

    attemptUpdate();
  }
}

// Start editing
editNext();
