const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');

// Configuration
const COMPANY_ID = '6763516217765c31f9561958';

// Property IDs
const PROPERTY_IDS = {
  'Part number': '57f3fb8efa3416c06701d60f',
  'Revision': '57f3fb8efa3416c06701d610',
  'ReleaseName': '594964b7040fc85d2b418138'
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 's'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', s: 'status', h: 'help', d: 'delay' },
  default: { delay: 3000 }  // Default 3 seconds between releases
});

// Rate limit retry delay: 1.5 hours in milliseconds
const RATE_LIMIT_RETRY_DELAY = 1.5 * 60 * 60 * 1000; // 5,400,000 ms

if (args.help || args.h || !args.input) {
  console.log('Release Documents from Excel');
  console.log('');
  console.log('Usage: node releaseFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file with documents to release (required)');
  console.log('  -o, --output    Output CSV log file (default: <input>_release_log.csv)');
  console.log('  -s, --status    Status JSON file (default: Upload/upload_status.json)');
  console.log('  -d, --delay     Delay between API calls in ms (default: 3000)');
  console.log('  --dry-run       Show what would be released without releasing');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  Release              "yes" (element only) or "document" (all elements)');
  console.log('');
  console.log('Optional columns:');
  console.log('  onshape:elementId    Element ID (required if Release=yes)');
  console.log('  property:Part number Part number for release');
  console.log('  property:Revision    Revision number');
  console.log('  document:name        Document name for logging');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
const delayMs = parseInt(args.delay) || 3000;

// Generate output log filename
const outputFile = args.output || inputFile.replace(/\.(xlsx|xls)$/i, '') + '_release_log.csv';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Load or initialize upload_status.json (default: Upload/upload_status.json to match unifiedUpload.js)
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
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// Update upload_status with versionId
function updateStatusWithVersionId(partNumber, elementId, versionId) {
  if (!partNumber || !versionId) return;

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

// Get workflow ID from company policies
let workflowId = null;

function getWorkflowId(callback) {
  if (workflowId) {
    callback(workflowId);
    return;
  }

  app.getCompanyPolicies(COMPANY_ID, (policiesData, err) => {
    if (err) {
      console.error('Failed to get company policies:', extractErrorMessage(err));
      callback(null);
      return;
    }
    const policies = JSON.parse(policiesData.toString());
    workflowId = policies.releaseWorkflowId;
    if (!workflowId) {
      console.error('Could not find release workflow ID for this company.');
    }
    callback(workflowId);
  });
}

// Read Excel file
console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} rows`);

if (dryRun) {
  console.log('DRY RUN - no documents will be released\n');
}

// Filter to rows that have required IDs and Release column
const rowsToRelease = data.filter(row => {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const release = (row.Release || '').toString().toLowerCase().trim();
  return docId && workId && (release === 'yes' || release === 'document');
});

console.log(`Found ${rowsToRelease.length} rows with Release=yes or Release=document\n`);

if (rowsToRelease.length === 0) {
  console.log('No documents to release. Make sure your Excel has:');
  console.log('  - onshape:documentId');
  console.log('  - onshape:workspaceId');
  console.log('  - Release column with "yes" or "document"');
  process.exit(0);
}

// Track results
let released = 0;
let skipped = 0;
let failed = 0;
let index = 0;

// Write CSV log file
function writeLogFile() {
  const header = ['Filename', 'DocumentId', 'WorkspaceId', 'ElementId', 'ReleaseMode', 'Status', 'Error', 'VersionId', 'ReleasedItems'];

  const rows = logEntries.map(entry => {
    return [
      entry.filename,
      entry.documentId,
      entry.workspaceId,
      entry.elementId || '',
      entry.releaseMode,
      entry.status,
      entry.error || '',
      entry.versionId || '',
      entry.releasedItems || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [header.join(','), ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);
  console.log(`\nLog saved to: ${outputFile}`);
}

// Update Excel with versionId
function updateExcelWithVersionId(docId, elemId, versionId, partNumber) {
  // Find matching row(s) and update
  data.forEach(row => {
    if (row['onshape:documentId'] === docId) {
      // For document release, update all rows with this docId
      // For element release, match elementId too
      if (!elemId || row['onshape:elementId'] === elemId) {
        row['onshape:versionId'] = versionId;
      }
    }
  });
}

// Save updated Excel
function saveUpdatedExcel() {
  const ext = pathModule.extname(inputFile);
  const base = pathModule.basename(inputFile, ext);
  const dir = pathModule.dirname(inputFile);
  const outputPath = pathModule.join(dir, `${base}_released${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  xlsx.writeFile(newWorkbook, outputPath);

  console.log(`Updated Excel saved to: ${outputPath}`);
}

function releaseNext() {
  if (index >= rowsToRelease.length) {
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total processed: ${rowsToRelease.length}`);
    console.log(`Released: ${released}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
    if (dryRun) {
      console.log('(DRY RUN - nothing was actually released)');
    }
    writeLogFile();
    saveUpdatedExcel();
    process.exit(0);
  }

  const row = rowsToRelease[index];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const docName = row['document:name'] || row.filename || row.filePath || row['File Name'] || 'unknown';
  const releaseMode = (row.Release || '').toString().toLowerCase().trim();
  const partNumber = row['property:Part number'] || '';
  const revision = row['property:Revision'] || '00';

  index++;

  console.log(`[${index}/${rowsToRelease.length}] ${docName}`);
  console.log(`  Document: ${docId}`);
  console.log(`  Release mode: ${releaseMode}`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would release ${releaseMode === 'document' ? 'all elements' : 'element ' + elemId}`);
    logEntries.push({
      filename: docName, documentId: docId, workspaceId: workId, elementId: elemId,
      releaseMode: releaseMode, status: 'dry-run', error: '', versionId: '', releasedItems: ''
    });
    released++;
    setTimeout(releaseNext, 10);
    return;
  }

  if (releaseMode === 'yes' && !elemId) {
    console.log(`  SKIPPED: Release=yes requires onshape:elementId`);
    logEntries.push({
      filename: docName, documentId: docId, workspaceId: workId, elementId: '',
      releaseMode: releaseMode, status: 'skipped', error: 'Missing elementId for Release=yes', versionId: '', releasedItems: ''
    });
    skipped++;
    setTimeout(releaseNext, 100);
    return;
  }

  if (releaseMode === 'document') {
    releaseAllElements(row, docId, workId, docName, partNumber, revision);
  } else {
    releaseSingleElement(row, docId, workId, elemId, docName, partNumber, revision);
  }
}

function releaseSingleElement(row, docId, workId, elemId, docName, partNumber, revision) {
  console.log(`  Releasing element: ${elemId}`);

  const releaseItems = [{
    elementId: elemId,
    documentId: docId,
    workspaceId: workId
  }];

  // Retry logic
  let retryCount = 0;
  const maxRetries = 3;

  function attemptRelease() {
    onshape.post({
      path: '/api/releasepackages/release/' + workflowId,
      query: { cid: COMPANY_ID },
      body: { items: releaseItems }
    }, (createData, createErr) => {
      if (createErr) {
        const errorMsg = extractErrorMessage(createErr);

        if (createErr.statusCode === 429 && retryCount < maxRetries) {
          retryCount++;
          const retryMinutes = (RATE_LIMIT_RETRY_DELAY / 1000 / 60).toFixed(0);
          console.log(`  Rate limited (429), waiting ${retryMinutes} minutes before retry (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(attemptRelease, RATE_LIMIT_RETRY_DELAY);
          return;
        }

        console.log(`  FAILED to create release package: ${errorMsg}`);
        logEntries.push({
          filename: docName, documentId: docId, workspaceId: workId, elementId: elemId,
          releaseMode: 'yes', status: 'failed', error: errorMsg, versionId: '', releasedItems: ''
        });
        failed++;
        setTimeout(releaseNext, delayMs);
        return;
      }

      const releasePackage = JSON.parse(createData.toString());
      const rpid = releasePackage.id;
      const item = releasePackage.items[0];

      // Format revision
      let formattedRevision = revision;
      if (/^\d+$/.test(formattedRevision)) {
        formattedRevision = String(formattedRevision).padStart(2, '0');
      }

      // Get part number from item or row
      const partNumProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Part number']);
      const finalPartNumber = partNumProp?.value || partNumber || docName;

      const updatedItem = {
        id: item.id,
        documentId: item.documentId,
        workspaceId: item.workspaceId,
        elementId: item.elementId,
        href: item.href,
        properties: [
          { propertyId: PROPERTY_IDS['Part number'], value: finalPartNumber },
          { propertyId: PROPERTY_IDS['Revision'], value: formattedRevision }
        ]
      };

      const updatePayload = {
        id: rpid,
        href: releasePackage.href,
        documentId: docId,
        workspaceId: workId,
        properties: [
          { propertyId: PROPERTY_IDS['ReleaseName'], value: `Release: ${docName}` }
        ],
        items: [updatedItem]
      };

      onshape.post({
        path: '/api/releasepackages/' + rpid,
        query: { wfaction: 'CREATE_AND_RELEASE' },
        body: updatePayload
      }, (submitData, submitErr) => {
        if (submitErr) {
          const errorMsg = extractErrorMessage(submitErr);
          console.log(`  FAILED to release: ${errorMsg}`);
          logEntries.push({
            filename: docName, documentId: docId, workspaceId: workId, elementId: elemId,
            releaseMode: 'yes', status: 'failed', error: errorMsg, versionId: '', releasedItems: ''
          });
          failed++;
        } else {
          const result = JSON.parse(submitData.toString());
          const state = result.workflow?.state?.name;

          if (state === 'RELEASED') {
            const releasedItem = result.items?.[0];
            const versionId = releasedItem?.versionId || '';
            const partId = releasedItem?.partId || '';

            console.log(`  Released successfully:`);
            console.log(`    - Part: ${finalPartNumber}, ElementId: ${elemId}, VersionId: ${versionId}${partId ? ', PartId: ' + partId : ''}`);

            if (versionId) {
              updateExcelWithVersionId(docId, elemId, versionId, finalPartNumber);
              updateStatusWithVersionId(finalPartNumber, elemId, versionId);
              saveStatus();
            }

            logEntries.push({
              filename: docName, documentId: docId, workspaceId: workId, elementId: elemId,
              releaseMode: 'yes', status: 'success', error: '', versionId: versionId,
              releasedItems: `${finalPartNumber}:${versionId}`
            });
            released++;
          } else {
            console.log(`  Release state: ${state}`);
            logEntries.push({
              filename: docName, documentId: docId, workspaceId: workId, elementId: elemId,
              releaseMode: 'yes', status: 'partial', error: `State: ${state}`, versionId: '', releasedItems: ''
            });
            failed++;
          }
        }
        setTimeout(releaseNext, delayMs);
      });
    });
  }

  attemptRelease();
}

function releaseAllElements(row, docId, workId, docName, partNumber, revision) {
  console.log(`  Getting all elements in document...`);

  app.getElements(docId, workId, (elementsData, elemErr) => {
    if (elemErr) {
      const errorMsg = extractErrorMessage(elemErr);
      console.log(`  FAILED to get elements: ${errorMsg}`);
      logEntries.push({
        filename: docName, documentId: docId, workspaceId: workId, elementId: '',
        releaseMode: 'document', status: 'failed', error: errorMsg, versionId: '', releasedItems: ''
      });
      failed++;
      setTimeout(releaseNext, delayMs);
      return;
    }

    const elements = JSON.parse(elementsData.toString());
    if (elements.length === 0) {
      console.log(`  No elements to release`);
      logEntries.push({
        filename: docName, documentId: docId, workspaceId: workId, elementId: '',
        releaseMode: 'document', status: 'skipped', error: 'No elements in document', versionId: '', releasedItems: ''
      });
      skipped++;
      setTimeout(releaseNext, delayMs);
      return;
    }

    console.log(`  Found ${elements.length} element(s)`);

    const releaseItems = elements.map(elem => ({
      elementId: elem.id,
      documentId: docId,
      workspaceId: workId
    }));

    // Retry logic
    let retryCount = 0;
    const maxRetries = 3;

    function attemptRelease() {
      onshape.post({
        path: '/api/releasepackages/release/' + workflowId,
        query: { cid: COMPANY_ID },
        body: { items: releaseItems }
      }, (createData, createErr) => {
        if (createErr) {
          const errorMsg = extractErrorMessage(createErr);

          if (createErr.statusCode === 429 && retryCount < maxRetries) {
            retryCount++;
            const retryMinutes = (RATE_LIMIT_RETRY_DELAY / 1000 / 60).toFixed(0);
            console.log(`  Rate limited (429), waiting ${retryMinutes} minutes before retry (attempt ${retryCount}/${maxRetries})...`);
            setTimeout(attemptRelease, RATE_LIMIT_RETRY_DELAY);
            return;
          }

          console.log(`  FAILED to create release package: ${errorMsg}`);
          logEntries.push({
            filename: docName, documentId: docId, workspaceId: workId, elementId: '',
            releaseMode: 'document', status: 'failed', error: errorMsg, versionId: '', releasedItems: ''
          });
          failed++;
          setTimeout(releaseNext, delayMs);
          return;
        }

        const releasePackage = JSON.parse(createData.toString());
        const rpid = releasePackage.id;

        // Debug: show what items are in the release package
        console.log(`  Release package has ${releasePackage.items?.length || 0} items:`);
        releasePackage.items?.forEach(item => {
          const isExternal = item.documentId !== docId;
          const revProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Revision']);
          console.log(`      ${item.elementId?.substring(0,8)}... rev="${revProp?.value || 'NONE'}" ${isExternal ? '[EXTERNAL]' : ''}`);
        });

        // Format revision from row
        let formattedRevision = revision;
        if (/^\d+$/.test(formattedRevision)) {
          formattedRevision = String(formattedRevision).padStart(2, '0');
        }

        // Build update payload for all items
        const updatedItems = releasePackage.items.map(item => {
          const elemInfo = elements.find(e => e.id === item.elementId);
          const elemName = elemInfo?.name || '';

          const partNumProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Part number']);
          const finalPartNumber = partNumProp?.value || elemName.replace(/\.[^/.]+$/, '');

          // Get revision from item properties first, then fall back to row revision
          const revisionProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Revision']);
          let itemRevision = revisionProp?.value || formattedRevision || '00';
          if (/^\d+$/.test(itemRevision)) {
            itemRevision = String(itemRevision).padStart(2, '0');
          }

          return {
            id: item.id,
            documentId: item.documentId,
            workspaceId: item.workspaceId,
            elementId: item.elementId,
            href: item.href,
            properties: [
              { propertyId: PROPERTY_IDS['Part number'], value: finalPartNumber },
              { propertyId: PROPERTY_IDS['Revision'], value: itemRevision }
            ]
          };
        });

        const updatePayload = {
          id: rpid,
          href: releasePackage.href,
          documentId: docId,
          workspaceId: workId,
          properties: [
            { propertyId: PROPERTY_IDS['ReleaseName'], value: `Release: ${docName}` }
          ],
          items: updatedItems
        };

        onshape.post({
          path: '/api/releasepackages/' + rpid,
          query: { wfaction: 'CREATE_AND_RELEASE' },
          body: updatePayload
        }, (submitData, submitErr) => {
          if (submitErr) {
            const errorMsg = extractErrorMessage(submitErr);
            console.log(`  FAILED to release: ${errorMsg}`);
            logEntries.push({
              filename: docName, documentId: docId, workspaceId: workId, elementId: '',
              releaseMode: 'document', status: 'failed', error: errorMsg, versionId: '', releasedItems: ''
            });
            failed++;
          } else {
            const result = JSON.parse(submitData.toString());
            const state = result.workflow?.state?.name;

            if (state === 'RELEASED') {
              const releasedCount = result.items?.length || 0;
              const releasedDetails = [];

              // Capture all versionIds and details for each released item
              console.log(`  Released ${releasedCount} element(s) successfully:`);
              result.items?.forEach(releasedItem => {
                const partNumProp = releasedItem.properties?.find(p => p.propertyId === PROPERTY_IDS['Part number']);
                const pn = partNumProp?.value || 'unknown';
                const elemId = releasedItem.elementId;
                const verId = releasedItem.versionId || '';
                const partId = releasedItem.partId || '';

                console.log(`    - Part: ${pn}, ElementId: ${elemId}, VersionId: ${verId}${partId ? ', PartId: ' + partId : ''}`);

                if (verId) {
                  releasedDetails.push({
                    partNumber: pn,
                    elementId: elemId,
                    versionId: verId,
                    partId: partId
                  });
                  updateExcelWithVersionId(docId, elemId, verId, pn);
                  updateStatusWithVersionId(pn, elemId, verId);
                }
              });

              // Save status after updating all items
              saveStatus();

              // Build summary strings for log
              const versionIdList = releasedDetails.map(d => d.versionId).join(';');
              const detailsSummary = releasedDetails.map(d => `${d.partNumber}:${d.versionId}`).join(';');

              logEntries.push({
                filename: docName, documentId: docId, workspaceId: workId, elementId: '',
                releaseMode: 'document', status: 'success', error: '',
                versionId: versionIdList, releasedItems: detailsSummary
              });
              released++;
            } else {
              console.log(`  Release state: ${state}`);
              logEntries.push({
                filename: docName, documentId: docId, workspaceId: workId, elementId: '',
                releaseMode: 'document', status: 'partial', error: `State: ${state}`, versionId: '', releasedItems: ''
              });
              failed++;
            }
          }
          setTimeout(releaseNext, delayMs);
        });
      });
    }

    attemptRelease();
  });
}

// Start the release process
getWorkflowId((wfId) => {
  if (!wfId) {
    console.error('Cannot proceed without workflow ID');
    process.exit(1);
  }
  console.log(`Using workflow ID: ${wfId}\n`);
  releaseNext();
});
