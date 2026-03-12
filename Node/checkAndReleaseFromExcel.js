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

// Rate limit retry delay: 1.5 hours in milliseconds
const RATE_LIMIT_RETRY_DELAY = 1.5 * 60 * 60 * 1000;

// Adaptive rate limiting settings
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 5000;
const LOW_REMAINING_THRESHOLD = 10;

let currentDelay = MIN_DELAY_MS;

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', h: 'help', d: 'delay' },
  default: { delay: 3000 }
});

if (args.help || args.h || !args.input) {
  console.log('Check and Release Documents from Excel');
  console.log('');
  console.log('Groups rows by document, checks release status via Revisions API,');
  console.log('releases unreleased elements, and fills in versionId columns.');
  console.log('');
  console.log('Usage: node checkAndReleaseFromExcel.js -i <excel-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Excel file with documents to check/release (required)');
  console.log('  -o, --output    Output Excel filename (default: <input>_released.xlsx)');
  console.log('  -d, --delay     Base delay between API calls in ms (default: 3000)');
  console.log('  --dry-run       Check status only, do not release anything');
  console.log('  -h, --help      Show this help');
  console.log('');
  console.log('Required Excel columns:');
  console.log('  onshape:documentId   Document ID');
  console.log('  onshape:workspaceId  Workspace ID');
  console.log('  onshape:elementId    Element ID');
  console.log('  property:Part number Part number (with file extension)');
  console.log('  document:name        Document name (used for grouping)');
  console.log('  uploadLevel          0=blob, 1=part, 2+=assembly');
  console.log('');
  console.log('Output columns (filled in):');
  console.log('  onshape:versionId5   Version ID from release');
  console.log('');
  console.log('Resume: uses XLSX/pubrel_check_status.json as sidecar for crash recovery');
  console.log('');
  process.exit(0);
}

const inputFile = args.input;
const dryRun = args['dry-run'];
const delayMs = parseInt(args.delay) || 3000;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Sidecar status file path (same directory as input Excel)
const sidecarFile = pathModule.join(pathModule.dirname(inputFile), 'pubrel_check_status.json');

// Load or initialize sidecar
let sidecar = { lastUpdated: null, documents: {} };
if (fs.existsSync(sidecarFile)) {
  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
    const docCount = Object.keys(sidecar.documents || {}).length;
    console.log(`Loaded sidecar: ${docCount} documents already processed`);
  } catch (e) {
    console.warn(`Warning: Could not parse ${sidecarFile}, starting fresh`);
    sidecar = { lastUpdated: null, documents: {} };
  }
}

function saveSidecar() {
  sidecar.lastUpdated = new Date().toISOString();
  fs.writeFileSync(sidecarFile, JSON.stringify(sidecar, null, 2));
}

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

// Map uploadLevel to element type for Revisions API
function getElementType(uploadLevel) {
  const level = parseInt(uploadLevel, 10);
  if (level === 0) return 4;  // Blob
  if (level === 1) return 0;  // Part Studio
  return 1;                    // Assembly (2, 4, 5, etc.)
}

// Check release status via Revisions API
function getReleasedVersion(partNumber, elementType, retryCount = 0) {
  return new Promise((resolve) => {
    onshape.get({
      path: `/api/revisions/c/${COMPANY_ID}/p/${encodeURIComponent(partNumber)}/latest`,
      query: { et: elementType }
    }, (data, err, rateInfo) => {
      // Adjust delay based on rate limit remaining
      if (rateInfo && rateInfo.remaining !== undefined) {
        const remaining = parseInt(rateInfo.remaining, 10);
        if (remaining < LOW_REMAINING_THRESHOLD) {
          currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
        } else {
          currentDelay = MIN_DELAY_MS;
        }
      }

      // Rate limited
      if (err && err.statusCode === 429) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
        if (retryCount < 3) {
          console.log(`    Rate limited. Waiting ${retryAfter}s before retry...`);
          currentDelay = MAX_DELAY_MS;
          setTimeout(() => {
            getReleasedVersion(partNumber, elementType, retryCount + 1).then(resolve);
          }, retryAfter * 1000);
          return;
        }
        resolve({ partNumber, error: 'Rate limited after 3 retries', versionId: null });
        return;
      }

      // 204 = No revisions found (not released)
      if (err && err.statusCode === 204) {
        resolve({ partNumber, status: 'unreleased', versionId: null });
        return;
      }

      // 404 = Part number not found
      if (err && err.statusCode === 404) {
        resolve({ partNumber, status: 'unreleased', versionId: null });
        return;
      }

      if (err) {
        resolve({ partNumber, error: extractErrorMessage(err), versionId: null });
        return;
      }

      try {
        const revision = JSON.parse(data.toString());
        resolve({
          partNumber,
          status: 'already-released',
          versionId: revision.versionId,
          revision: revision.revision,
          documentId: revision.documentId,
          elementId: revision.elementId,
          rateRemaining: rateInfo?.remaining
        });
      } catch (e) {
        resolve({ partNumber, error: e.message, versionId: null });
      }
    });
  });
}

// Get workflow ID from company policies (promisified)
function getWorkflowId() {
  return new Promise((resolve, reject) => {
    app.getCompanyPolicies(COMPANY_ID, (policiesData, err) => {
      if (err) {
        reject(new Error('Failed to get company policies: ' + extractErrorMessage(err)));
        return;
      }
      const policies = JSON.parse(policiesData.toString());
      const wfId = policies.releaseWorkflowId;
      if (!wfId) {
        reject(new Error('Could not find release workflow ID'));
        return;
      }
      resolve(wfId);
    });
  });
}

// Release unreleased elements in a document
function releaseElements(workflowId, docId, workId, docName, unreleasedRows) {
  return new Promise((resolve) => {
    const releaseItems = unreleasedRows.map(row => ({
      elementId: row['onshape:elementId'],
      documentId: docId,
      workspaceId: workId
    }));

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
            console.log(`    Rate limited (429), waiting ${retryMinutes} min (attempt ${retryCount}/${maxRetries})...`);
            setTimeout(attemptRelease, RATE_LIMIT_RETRY_DELAY);
            return;
          }

          console.log(`    FAILED to create release package: ${errorMsg}`);
          resolve({ success: false, error: errorMsg, items: [] });
          return;
        }

        const releasePackage = JSON.parse(createData.toString());
        const rpid = releasePackage.id;

        // Build update payload for all items
        const updatedItems = releasePackage.items.map(item => {
          const partNumProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Part number']);
          const finalPartNumber = partNumProp?.value || '';

          const revisionProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Revision']);
          let itemRevision = revisionProp?.value || '00';
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
            console.log(`    FAILED to release: ${errorMsg}`);
            resolve({ success: false, error: errorMsg, items: [] });
            return;
          }

          const result = JSON.parse(submitData.toString());
          const state = result.workflow?.state?.name;

          if (state === 'RELEASED') {
            const releasedItems = (result.items || []).map(item => {
              const partNumProp = item.properties?.find(p => p.propertyId === PROPERTY_IDS['Part number']);
              return {
                partNumber: partNumProp?.value || '',
                elementId: item.elementId,
                versionId: item.versionId || '',
                partId: item.partId || ''
              };
            });
            resolve({ success: true, items: releasedItems });
          } else {
            console.log(`    Release state: ${state} (expected RELEASED)`);
            resolve({ success: false, error: `State: ${state}`, items: [] });
          }
        });
      });
    }

    attemptRelease();
  });
}

// Delay helper
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== Check and Release from Excel ===\n');

  if (dryRun) {
    console.log('DRY RUN - will check status but not release anything\n');
  }

  // 1. Read Excel
  console.log(`Reading Excel: ${inputFile}`);
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);
  console.log(`Found ${data.length} rows\n`);

  // 2. Filter to rows with required columns
  const validRows = data.filter(row => {
    return row['onshape:documentId'] &&
           row['onshape:workspaceId'] &&
           row['onshape:elementId'] &&
           row['property:Part number'];
  });
  console.log(`${validRows.length} rows have required columns (documentId, workspaceId, elementId, Part number)`);

  // 3. Group by document:name
  const docGroups = {};
  validRows.forEach(row => {
    const docName = row['document:name'] || 'unknown';
    if (!docGroups[docName]) {
      docGroups[docName] = [];
    }
    docGroups[docName].push(row);
  });

  const docNames = Object.keys(docGroups);
  console.log(`${docNames.length} unique documents\n`);

  // Check how many are already in sidecar
  const alreadyDone = docNames.filter(name => sidecar.documents[name]);
  if (alreadyDone.length > 0) {
    console.log(`Resuming: ${alreadyDone.length} documents already processed, ${docNames.length - alreadyDone.length} remaining\n`);
  }

  // 4. Get workflow ID (needed for releases)
  let workflowId = null;
  if (!dryRun) {
    try {
      workflowId = await getWorkflowId();
      console.log(`Workflow ID: ${workflowId}\n`);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  // 5. Process each document group
  let alreadyReleased = 0;
  let newlyReleased = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let checkedElements = 0;

  for (let i = 0; i < docNames.length; i++) {
    const docName = docNames[i];
    const rows = docGroups[docName];
    const docId = rows[0]['onshape:documentId'];
    const workId = rows[0]['onshape:workspaceId'];

    // Skip if already in sidecar
    if (sidecar.documents[docName]) {
      // Apply cached versionIds and elementIds to data rows
      const cachedDoc = sidecar.documents[docName];
      cachedDoc.elements.forEach(elem => {
        if (elem.versionId) {
          // Match by either the current elementId or the original Excel elementId
          const matchIds = [elem.elementId];
          if (elem.excelElementId) matchIds.push(elem.excelElementId);
          data.forEach(row => {
            if (matchIds.includes(row['onshape:elementId']) &&
                row['onshape:documentId'] === cachedDoc.documentId) {
              row['onshape:versionId5'] = elem.versionId;
              row['onshape:elementId'] = elem.elementId;
            }
          });
          if (elem.status === 'already-released') alreadyReleased++;
          else if (elem.status === 'released') newlyReleased++;
          else if (elem.status === 'failed') failedCount++;
        }
      });
      skippedCount++;
      continue;
    }

    console.log(`[${i + 1}/${docNames.length}] ${docName} (${rows.length} element${rows.length > 1 ? 's' : ''})`);
    console.log(`  Document: ${docId}`);

    // 5a. Check each element's release status
    const sidecarElements = [];
    const unreleasedRows = [];

    for (const row of rows) {
      const partNumber = row['property:Part number'] != null ? String(row['property:Part number']).trim() : '';
      const elementId = row['onshape:elementId'];
      const uploadLevel = row['uploadLevel'];
      const elementType = getElementType(uploadLevel);

      if (!partNumber) {
        console.log(`  ${elementId.substring(0, 8)}... no part number, skipping`);
        sidecarElements.push({
          partNumber: '',
          elementId,
          versionId: null,
          status: 'no-part-number'
        });
        continue;
      }

      checkedElements++;
      const result = await getReleasedVersion(partNumber, elementType);

      if (result.versionId) {
        // Already released — use API-returned elementId (may differ from Excel if element was re-created)
        const currentElementId = result.elementId || elementId;
        if (currentElementId !== elementId) {
          console.log(`  ${partNumber}: already released (v=${result.versionId.substring(0, 12)}...) elementId updated: ${elementId.substring(0, 8)}... -> ${currentElementId.substring(0, 8)}...`);
        } else {
          console.log(`  ${partNumber}: already released (v=${result.versionId.substring(0, 12)}...) elementId=${currentElementId.substring(0, 8)}...`);
        }
        sidecarElements.push({
          partNumber,
          elementId: currentElementId,
          versionId: result.versionId,
          status: 'already-released',
          excelElementId: elementId !== currentElementId ? elementId : undefined
        });
        // Update the data row — match by Excel elementId to find it, then update to current
        data.forEach(r => {
          if (r['onshape:elementId'] === elementId && r['onshape:documentId'] === docId) {
            r['onshape:versionId5'] = result.versionId;
            r['onshape:elementId'] = currentElementId;
          }
        });
        alreadyReleased++;
      } else if (result.error) {
        // API error
        console.log(`  ${partNumber}: ERROR - ${result.error}`);
        sidecarElements.push({
          partNumber,
          elementId,
          versionId: null,
          status: 'failed',
          error: result.error
        });
        failedCount++;
      } else {
        // Not released
        console.log(`  ${partNumber}: not released`);
        unreleasedRows.push(row);
        // Placeholder - will be updated after release
        sidecarElements.push({
          partNumber,
          elementId,
          versionId: null,
          status: 'unreleased'
        });
      }

      await delay(currentDelay);
    }

    // 5b. Release unreleased elements if any
    if (unreleasedRows.length > 0) {
      if (dryRun) {
        console.log(`  [DRY RUN] Would release ${unreleasedRows.length} element(s):`);
        unreleasedRows.forEach(r => {
          console.log(`    - ${r['property:Part number']}`);
        });
      } else {
        console.log(`  Releasing ${unreleasedRows.length} unreleased element(s)...`);
        const releaseResult = await releaseElements(workflowId, docId, workId, docName, unreleasedRows);

        if (releaseResult.success) {
          console.log(`  Released ${releaseResult.items.length} element(s):`);
          releaseResult.items.forEach(item => {
            console.log(`    - ${item.partNumber}: v=${item.versionId.substring(0, 12)}...`);

            // Update sidecar element
            const sidecarElem = sidecarElements.find(e => e.elementId === item.elementId);
            if (sidecarElem) {
              sidecarElem.versionId = item.versionId;
              sidecarElem.status = 'released';
            }

            // Update data row
            data.forEach(r => {
              if (r['onshape:elementId'] === item.elementId && r['onshape:documentId'] === docId) {
                r['onshape:versionId5'] = item.versionId;
              }
            });
            newlyReleased++;
          });

          // Mark any remaining unreleased as failed (not in release response)
          sidecarElements.forEach(elem => {
            if (elem.status === 'unreleased') {
              const wasReleased = releaseResult.items.find(i => i.elementId === elem.elementId);
              if (!wasReleased) {
                elem.status = 'failed';
                elem.error = 'Not included in release response';
                failedCount++;
              }
            }
          });
        } else {
          console.log(`  Release FAILED: ${releaseResult.error}`);
          sidecarElements.forEach(elem => {
            if (elem.status === 'unreleased') {
              elem.status = 'failed';
              elem.error = releaseResult.error;
              failedCount++;
            }
          });
        }
      }
    }

    // 5c. Save sidecar for this document (skip in dry-run)
    if (!dryRun) {
      sidecar.documents[docName] = {
        documentId: docId,
        elements: sidecarElements
      };
      saveSidecar();
    }

    // Adaptive delay before next document
    await delay(Math.max(delayMs, currentDelay));
  }

  // 6. Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total documents: ${docNames.length}`);
  console.log(`Skipped (cached): ${skippedCount}`);
  console.log(`Elements checked: ${checkedElements}`);
  console.log(`Already released: ${alreadyReleased}`);
  console.log(`Newly released: ${newlyReleased}`);
  console.log(`Failed: ${failedCount}`);
  if (dryRun) {
    console.log('(DRY RUN - nothing was released)');
  }

  // 7. Write updated Excel
  const ext = pathModule.extname(inputFile);
  const base = pathModule.basename(inputFile, ext);
  const dir = pathModule.dirname(inputFile);
  const outputPath = args.output || pathModule.join(dir, `${base}_released${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  xlsx.writeFile(newWorkbook, outputPath);

  console.log(`\nUpdated Excel: ${outputPath}`);
  console.log(`Sidecar: ${sidecarFile}`);
  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
