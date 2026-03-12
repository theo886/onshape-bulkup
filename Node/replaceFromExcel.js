#!/usr/bin/env node
/**
 * replaceFromExcel.js
 *
 * Replace files in Onshape while keeping the same revision number.
 *
 * Workflow:
 * 1. Obsolete existing release (with os-mark-rereleasable=true)
 * 2. For blobs: Update content in-place
 *    For CAD: Delete old element, upload new file via translation
 * 3. Set properties
 * 4. Re-release with the same revision number
 *
 * Usage:
 *   node replaceFromExcel.js -i <excel-file> [options]
 *
 * Required Excel columns:
 *   onshape:documentId   - Target document ID
 *   onshape:workspaceId  - Target workspace ID
 *   onshape:elementId    - Element to replace
 *   onshape:versionId    - Released version to obsolete
 *   filePath             - Path to new file
 *   uploadLevel          - 0=blob, 1=part, 2+=assembly
 *   property:Part number - Part number
 *   property:Revision    - Revision to keep (e.g., "03")
 *
 * Optional columns:
 *   Release              - "yes" or "document" to release after replace
 *   zipPath              - For assemblies, path to ZIP file
 */

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const mimeTypes = require('mime-types');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');
const { buildPropertiesArray, pollTranslation, propertyIdMap, COMPANY_ID } = require('./unifiedUpload.js');

// Obsoletion workflow ID
const OBSOLETION_WORKFLOW_ID = '59fb015cbd51842cc4706f59';

// Global state
let workflowId = null;
let dryRun = false;
let logEntries = [];

// Parse arguments
const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 's'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', s: 'status', h: 'help', d: 'delay' },
  default: { delay: 3000 }
});

if (args.help || args.h || !args.input) {
  console.log(`
Replace Files in Onshape (keeping same revision)

Usage: node replaceFromExcel.js -i <excel-file> [options]

Options:
  -i, --input     Excel file with files to replace (required)
  -o, --output    Output CSV log file (default: <input>_replace_log.csv)
  -s, --status    Status JSON file (default: Upload/upload_status.json)
  -d, --delay     Delay between API calls in ms (default: 3000)
  --dry-run       Show what would be done without executing
  -h, --help      Show this help

Required Excel columns:
  onshape:documentId   Target document ID
  onshape:workspaceId  Target workspace ID
  onshape:elementId    Element to replace
  onshape:versionId    Released version to obsolete
  filePath             Path to new file
  uploadLevel          0=blob, 1=part, 2+=assembly
  property:Part number Part number
  property:Revision    Revision to keep (e.g., "03")

Optional columns:
  Release              "yes" or "document" to release after replace
  zipPath              For assemblies, path to ZIP file

Workflow:
  1. Obsolete existing release (mark as re-releasable)
  2. Update blob in-place OR delete+re-upload CAD file
  3. Set properties
  4. Release with same revision number
`);
  process.exit(0);
}

const inputFile = args.input;
const delayMs = parseInt(args.delay) || 3000;
dryRun = args['dry-run'];

const outputFile = args.output || inputFile.replace(/\.(xlsx|xls)$/i, '') + '_replace_log.csv';
const statusFile = args.status || 'Upload/upload_status.json';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Load status
let status = { partMapping: {}, assemblyMapping: {}, fileStatus: {} };
if (fs.existsSync(statusFile)) {
  try {
    status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log(`Loaded status file: ${statusFile}`);
  } catch (e) {
    console.warn(`Warning: Could not parse ${statusFile}, starting fresh`);
  }
}

function saveStatus() {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// Helper to promisify onshape.get
function get(path) {
  return new Promise((resolve, reject) => {
    onshape.get({ path }, (data, err) => {
      if (err) reject(err);
      else resolve(JSON.parse(data));
    });
  });
}

// Helper to promisify onshape.post
function post(path, body, query) {
  return new Promise((resolve, reject) => {
    onshape.post({ path, body, query }, (data, err) => {
      if (err) reject(err);
      else resolve(data ? JSON.parse(data) : {});
    });
  });
}

// Extract error message
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

// Add composite feature if Part Studio has multiple parts
function addCompositeIfNeeded(docId, workId, elementId, callback) {
  // Get parts in the Part Studio
  onshape.get({
    path: `/api/parts/d/${docId}/w/${workId}/e/${elementId}`
  }, (partsData, partsErr) => {
    if (partsErr) {
      console.error(`  Error getting parts for composite check: ${extractErrorMessage(partsErr)}`);
      callback(partsErr);
      return;
    }

    let parts = [];
    try {
      parts = JSON.parse(partsData.toString());
    } catch (e) {
      console.error(`  Failed to parse parts response`);
      callback(null); // Continue without composite
      return;
    }

    // Only 1 part or less - nothing to do
    if (parts.length <= 1) {
      callback(null);
      return;
    }

    // Check if composite already exists
    if (parts.some(p => p.bodyType === 'composite')) {
      console.log(`  Composite already exists`);
      callback(null);
      return;
    }

    console.log(`  Found ${parts.length} parts, adding composite feature...`);

    // Build the composite feature
    const compositeFeature = {
      feature: {
        type: 134,
        typeName: "BTMFeature",
        message: {
          featureType: "compositePart",
          name: "Composite 1",
          parameters: [
            {
              btType: "BTMParameterQueryList-148",
              parameterId: "parts",
              queries: [
                {
                  btType: "BTMIndividualQuery-138",
                  queryType: 0,
                  queryStatement: null,
                  deterministicIdList: parts.map(p => p.partId)
                }
              ]
            },
            {
              btType: "BTMParameterBoolean-144",
              parameterId: "closed",
              value: true
            }
          ]
        }
      }
    };

    onshape.post({
      path: `/api/partstudios/d/${docId}/w/${workId}/e/${elementId}/features`,
      body: compositeFeature
    }, (_, featureErr) => {
      if (featureErr) {
        console.error(`  Failed to add composite: ${extractErrorMessage(featureErr)}`);
        // Continue anyway - properties will be set on all parts
        callback(null);
      } else {
        console.log(`  Composite feature added`);
        callback(null);
      }
    });
  });
}

// Obsolete a revision with re-releasable flag
async function obsoleteRevision(versionId, partNumber) {
  console.log(`  Obsoleting version ${versionId}...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would obsolete version ${versionId}`);
    return true;
  }

  try {
    // Get revision ID from version ID (URL-encode part number to handle special chars like [])
    const revision = await get(`/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`);

    if (!revision || !revision.id) {
      console.log(`  Warning: Could not find revision for part ${partNumber}`);
      return false;
    }

    console.log(`  Found revision ${revision.revision} (id: ${revision.id})`);
    console.log(`    isObsolete: ${revision.isObsolete}, isRereleasable: ${revision.isRereleasable}`);

    // Check if already obsolete and re-releasable - we can proceed
    if (revision.isObsolete && revision.isRereleasable) {
      console.log(`  Revision already obsolete and re-releasable - OK to proceed`);
      return true;
    }

    // Check if obsolete but NOT re-releasable - cannot proceed
    if (revision.isObsolete && !revision.isRereleasable) {
      console.error(`  Revision is obsolete but NOT re-releasable - cannot use same revision`);
      console.error(`  You may need to manually mark it as re-releasable in Onshape`);
      return false;
    }

    // Not obsolete - need to obsolete it
    console.log(`  Creating obsoletion package...`);

    // Create obsoletion package
    const pkg = await post(
      `/api/v10/releasepackages/obsoletion/${OBSOLETION_WORKFLOW_ID}`,
      null,
      { revisionId: revision.id }
    );

    console.log(`  Obsoletion package created: ${pkg.id}`);
    console.log(`  Submitting with re-releasable flag...`);

    // Submit with re-releasable flag
    // Use CREATE_AND_OBSOLETE to go directly from SETUP to OBSOLETE state
    // (OBSOLETE action is only valid from PENDING state after approval)
    await post(
      `/api/v10/releasepackages/${pkg.id}`,
      {
        properties: [
          { propertyId: '594964b7040fc85d2b418138', value: `Replace: ${partNumber}` },
          { propertyId: 'os-mark-rereleasable', value: true }
        ]
      },
      { wfaction: 'CREATE_AND_OBSOLETE' }
    );

    console.log(`  Obsoleted revision (re-releasable: true)`);
    return true;
  } catch (e) {
    const errMsg = extractErrorMessage(e);

    // Handle various "already obsolete" messages
    if (errMsg.includes('already been obsoleted') || errMsg.includes('already obsoleted')) {
      console.log(`  Revision already obsoleted - checking if re-releasable...`);
      // Re-fetch to check re-releasable status
      try {
        const revision = await get(`/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`);
        if (revision && revision.isRereleasable) {
          console.log(`  Confirmed re-releasable - OK to proceed`);
          return true;
        } else {
          console.error(`  Revision is obsolete but NOT re-releasable`);
          return false;
        }
      } catch (e2) {
        // If we can't re-fetch, assume it's OK since it said "already obsoleted"
        console.log(`  Assuming re-releasable (could not verify)`);
        return true;
      }
    }

    // Handle workflow state errors - might mean there's a pending obsoletion
    if (errMsg.includes('not valid for the current state')) {
      console.error(`  Workflow error: ${errMsg}`);
      console.error(`  This may indicate a pending obsoletion or workflow issue.`);
      console.error(`  Check the Onshape UI for pending obsoletion packages for this part.`);
      return false;
    }

    console.error(`  Error obsoleting: ${errMsg}`);
    return false;
  }
}

// Update blob element in-place
function updateBlob(row, docId, workId, elementId, callback) {
  const filePath = row.filePath;
  const fileName = pathModule.basename(filePath);
  const fileExt = pathModule.extname(filePath);

  // Determine element name
  let elementName = row['element:name'] || row['property:Part number'] || row['document:name'];
  if (elementName && !elementName.toLowerCase().endsWith(fileExt.toLowerCase())) {
    elementName = elementName + fileExt;
  } else if (!elementName) {
    elementName = fileName;
  }

  if (!fs.existsSync(filePath)) {
    console.error(`  File not found: ${filePath}`);
    callback(new Error('File not found'));
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would update blob: ${fileName}`);
    callback(null, { id: elementId });
    return;
  }

  const mimeType = mimeTypes.lookup(filePath) || 'application/octet-stream';
  console.log(`  Updating blob content: ${fileName}`);

  app.updateBlobElement(docId, workId, elementId, filePath, mimeType, elementName, (data, err) => {
    if (err) {
      console.error(`  Failed to update blob: ${extractErrorMessage(err)}`);
      callback(err);
      return;
    }
    const result = JSON.parse(data.toString());
    console.log(`  Blob updated: ${result.id}`);
    callback(null, result);
  });
}

// Delete element and re-upload CAD file
function replaceCadFile(row, docId, workId, elementId, callback) {
  const filePath = row.filePath || row.zipPath;
  const fileName = pathModule.basename(filePath);
  const uploadLevel = parseInt(row.uploadLevel) || 1;

  if (!fs.existsSync(filePath)) {
    console.error(`  File not found: ${filePath}`);
    callback(new Error('File not found'));
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would delete element ${elementId} and upload ${fileName}`);
    callback(null, { id: 'dry-run-element-id' });
    return;
  }

  console.log(`  Deleting old element: ${elementId}`);

  app.deleteElement(docId, workId, elementId, (delData, delErr) => {
    if (delErr) {
      console.error(`  Failed to delete element: ${extractErrorMessage(delErr)}`);
      callback(delErr);
      return;
    }
    console.log(`  Element deleted`);

    // Upload new file via translation API
    const isAssembly = uploadLevel >= 2;
    const mimeType = isAssembly ? 'application/zip' : 'application/octet-stream';
    const bodycount = parseInt(row.BodyCount || row.bodycount) || 0;
    const useComposite = bodycount > 1 || isAssembly;

    console.log(`  Uploading new file: ${fileName}`);

    onshape.upload({
      path: `/api/v6/translations/d/${docId}/w/${workId}`,
      file: filePath,
      mimeType: mimeType,
      body: {
        allowFaultyParts: true,
        createComposite: useComposite,
        yAxisIsUp: true,
        storeInDocument: true,
        splitAssembliesIntoMultipleDocuments: false
      }
    }, (uploadData, uploadErr) => {
      if (uploadErr) {
        console.error(`  Failed to upload: ${extractErrorMessage(uploadErr)}`);
        callback(uploadErr);
        return;
      }

      const translationResult = JSON.parse(uploadData.toString());
      console.log(`  Translation started: ${translationResult.id}`);

      pollTranslation(translationResult.id, (success, data, failureReason) => {
        if (!success) {
          console.error(`  Translation failed: ${failureReason}`);
          callback(new Error(failureReason));
          return;
        }

        const newElementId = data.resultElementIds?.[0];
        if (!newElementId) {
          console.error(`  No element ID in translation result`);
          callback(new Error('No element ID'));
          return;
        }

        console.log(`  New element created: ${newElementId}`);

        // For parts, check if we need to add composite feature
        // (handles cases where translation didn't create one but multiple bodies exist)
        if (uploadLevel === 1) {
          addCompositeIfNeeded(docId, workId, newElementId, (compositeErr) => {
            // Continue even if composite fails - properties will be set on all parts
            callback(null, { id: newElementId, resultElementIds: data.resultElementIds });
          });
        } else {
          callback(null, { id: newElementId, resultElementIds: data.resultElementIds });
        }
      });
    });
  });
}

// Set properties on element or parts
function setProperties(row, docId, workId, elementId, callback) {
  const properties = buildPropertiesArray(row);
  const uploadLevel = parseInt(row.uploadLevel) || 0;

  if (properties.length === 0) {
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would set ${properties.length} properties`);
    callback();
    return;
  }

  // For parts (uploadLevel=1), set properties on parts within Part Studio
  if (uploadLevel === 1) {
    // First, set Description on the Part Studio element itself
    const descriptionProp = properties.find(p => p.propertyId === propertyIdMap['Description']);

    const setDescriptionThenParts = () => {
      if (descriptionProp) {
        console.log(`  Setting Description on Part Studio: "${descriptionProp.value}"`);
        app.updateProperties(docId, workId, elementId, [descriptionProp], (_, err) => {
          if (err) {
            console.error(`  Error setting Description on Part Studio: ${extractErrorMessage(err)}`);
          }
          setPropertiesOnParts();
        });
      } else {
        setPropertiesOnParts();
      }
    };

    const setPropertiesOnParts = () => {
      console.log(`  Getting parts in Part Studio...`);
      onshape.get({
        path: `/api/parts/d/${docId}/w/${workId}/e/${elementId}`
      }, (partsData, partsErr) => {
        if (partsErr) {
          console.error(`  Error getting parts: ${extractErrorMessage(partsErr)}`);
          callback();
          return;
        }

        const parts = JSON.parse(partsData.toString());
        console.log(`  Found ${parts.length} part(s)`);

        if (parts.length === 0) {
          callback();
          return;
        }

        // Find the composite part if one exists, otherwise use first part only
        // This avoids setting duplicate Part numbers on multiple bodies
        let targetParts = [];
        const compositePart = parts.find(p => p.bodyType === 'composite');
        if (compositePart) {
          targetParts = [compositePart];
          console.log(`  Setting properties on composite part: ${compositePart.name}`);
        } else if (parts.length === 1) {
          targetParts = parts;
          console.log(`  Setting properties on single part: ${parts[0].name}`);
        } else {
          // Multiple parts, no composite - only set on first to avoid duplicate Part numbers
          targetParts = [parts[0]];
          console.log(`  Warning: ${parts.length} parts but no composite, setting properties only on first: ${parts[0].name}`);
        }

        let completed = 0;
        targetParts.forEach((part) => {
          onshape.post({
            path: `/api/metadata/d/${docId}/w/${workId}/e/${elementId}/p/${part.partId}`,
            body: { properties: properties }
          }, (_, err) => {
            if (err) {
              console.error(`  Error setting properties on part ${part.name}: ${extractErrorMessage(err)}`);
            } else {
              console.log(`  Set properties on part: ${part.name}`);
            }
            completed++;
            if (completed === targetParts.length) {
              callback();
            }
          });
        });
      });
    };

    setDescriptionThenParts();
  } else {
    // For blobs and assemblies, set on element directly
    console.log(`  Setting ${properties.length} properties on element`);
    app.updateProperties(docId, workId, elementId, properties, (_, err) => {
      if (err) {
        console.error(`  Error setting properties: ${extractErrorMessage(err)}`);
      }
      callback();
    });
  }
}

// Release element with specified revision
function releaseElement(row, docId, workId, elementId, callback) {
  const releaseMode = (row.Release || '').toString().toLowerCase().trim();
  if (releaseMode !== 'yes' && releaseMode !== 'document') {
    console.log(`  Skipping release (Release column not set)`);
    callback(null);
    return;
  }

  if (!workflowId) {
    console.warn(`  Skipping release: no workflow ID`);
    callback(null);
    return;
  }

  const partNumber = row['property:Part number'] || 'unknown';
  let revision = row['property:Revision'] || '00';
  if (/^\d+$/.test(revision)) {
    revision = String(revision).padStart(2, '0');
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would release with revision ${revision}`);
    callback(null);
    return;
  }

  console.log(`  Releasing with revision ${revision}...`);

  const releaseItems = [{
    elementId: elementId,
    documentId: docId,
    workspaceId: workId
  }];

  onshape.post({
    path: '/api/releasepackages/release/' + workflowId,
    query: { cid: COMPANY_ID },
    body: { items: releaseItems }
  }, (createData, createErr) => {
    if (createErr) {
      console.error(`  Failed to create release package: ${extractErrorMessage(createErr)}`);
      callback(createErr);
      return;
    }

    const pkg = JSON.parse(createData.toString());

    if (!pkg.items || pkg.items.length === 0) {
      console.error(`  Release package has no items`);
      console.error(`  Response: ${JSON.stringify(pkg, null, 2)}`);
      callback(new Error('Release package has no items'));
      return;
    }

    const item = pkg.items[0];

    const updatedItem = {
      id: item.id,
      documentId: item.documentId,
      workspaceId: item.workspaceId,
      elementId: item.elementId,
      href: item.href,
      properties: [
        { propertyId: '57f3fb8efa3416c06701d60f', value: partNumber },
        { propertyId: '57f3fb8efa3416c06701d610', value: revision }
      ]
    };

    const updatePayload = {
      id: pkg.id,
      href: pkg.href,
      documentId: docId,
      workspaceId: workId,
      properties: [
        { propertyId: '594964b7040fc85d2b418138', value: `Replace: ${partNumber}` }
      ],
      items: [updatedItem]
    };

    onshape.post({
      path: '/api/releasepackages/' + pkg.id,
      query: { wfaction: 'CREATE_AND_RELEASE' },
      body: updatePayload
    }, (submitData, submitErr) => {
      if (submitErr) {
        console.error(`  Failed to release: ${extractErrorMessage(submitErr)}`);
        callback(submitErr);
        return;
      }

      const result = JSON.parse(submitData.toString());
      if (result.workflow?.state?.name === 'RELEASED') {
        const versionId = result.items?.[0]?.versionId || '';
        console.log(`  Released: revision ${revision}, versionId ${versionId}`);
        callback(null, { versionId, revision });
      } else {
        console.log(`  Release state: ${result.workflow?.state?.name}`);
        callback(null);
      }
    });
  });
}

// Process a single row
async function processRow(row, index, total) {
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elementId = row['onshape:elementId'];
  const versionId = row['onshape:versionId'];
  const partNumber = row['property:Part number'] || 'unknown';
  const uploadLevel = parseInt(row.uploadLevel) || 0;
  const filePath = row.filePath || row.zipPath || '';
  const fileName = pathModule.basename(filePath);

  console.log(`\n[${index + 1}/${total}] Replacing: ${partNumber} (${fileName})`);
  console.log(`  Document: ${docId}`);
  console.log(`  Element: ${elementId}`);
  console.log(`  Level: ${uploadLevel} (${uploadLevel === 0 ? 'blob' : uploadLevel === 1 ? 'part' : 'assembly'})`);

  // Validate required fields
  if (!docId || !workId || !elementId) {
    console.error(`  Missing required Onshape IDs`);
    logEntries.push({
      filename: fileName, partNumber, documentId: docId, workspaceId: workId,
      elementId, status: 'failed', error: 'Missing required IDs', newVersionId: ''
    });
    return;
  }

  if (!filePath) {
    console.error(`  Missing filePath`);
    logEntries.push({
      filename: fileName, partNumber, documentId: docId, workspaceId: workId,
      elementId, status: 'failed', error: 'Missing filePath', newVersionId: ''
    });
    return;
  }

  // Step 1: Obsolete existing release (if versionId provided)
  if (versionId) {
    const obsoleted = await obsoleteRevision(versionId, partNumber);
    if (!obsoleted && !dryRun) {
      console.error(`  FAILED: Could not obsolete existing release. Stopping.`);
      logEntries.push({
        filename: fileName, partNumber, documentId: docId, workspaceId: workId,
        elementId, status: 'failed', error: 'Obsoletion failed - cannot replace without obsoleting first', newVersionId: ''
      });
      return;
    }
    // After successful obsoletion, wait for Onshape to process
    if (obsoleted && !dryRun) {
      console.log(`  Waiting 5s for obsoletion to propagate...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } else {
    console.log(`  No versionId provided, skipping obsoletion`);
  }

  // Step 2: Update/replace content
  return new Promise((resolve) => {
    const afterReplace = (err, result) => {
      if (err) {
        logEntries.push({
          filename: fileName, partNumber, documentId: docId, workspaceId: workId,
          elementId, status: 'failed', error: extractErrorMessage(err), newVersionId: ''
        });
        resolve();
        return;
      }

      const newElementId = result?.id || elementId;

      // Step 3: Set properties
      setProperties(row, docId, workId, newElementId, () => {
        // Step 4: Release
        releaseElement(row, docId, workId, newElementId, (relErr, relResult) => {
          const newVersionId = relResult?.versionId || '';

          // Update status file
          if (status.partMapping[partNumber]) {
            if (newElementId !== elementId) {
              status.partMapping[partNumber].elementId = newElementId;
            }
            if (newVersionId) {
              status.partMapping[partNumber].versionId = newVersionId;
            }
          } else if (status.assemblyMapping[partNumber]) {
            if (newElementId !== elementId) {
              status.assemblyMapping[partNumber].elementId = newElementId;
            }
            if (newVersionId) {
              status.assemblyMapping[partNumber].versionId = newVersionId;
            }
          }
          saveStatus();

          logEntries.push({
            filename: fileName, partNumber, documentId: docId, workspaceId: workId,
            elementId: newElementId, status: relErr ? 'replaced-no-release' : 'success',
            error: relErr ? extractErrorMessage(relErr) : '', newVersionId
          });

          console.log(`  Complete`);
          resolve();
        });
      });
    };

    if (uploadLevel === 0) {
      // Blob: update in-place
      updateBlob(row, docId, workId, elementId, afterReplace);
    } else {
      // CAD: delete and re-upload
      replaceCadFile(row, docId, workId, elementId, afterReplace);
    }
  });
}

// Write log file
function writeLogFile() {
  const header = ['Filename', 'PartNumber', 'DocumentId', 'WorkspaceId', 'ElementId', 'Status', 'Error', 'NewVersionId'];
  const rows = logEntries.map(entry => {
    return [
      entry.filename,
      entry.partNumber,
      entry.documentId,
      entry.workspaceId,
      entry.elementId,
      entry.status,
      entry.error || '',
      entry.newVersionId || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);
  console.log(`\nLog saved to: ${outputFile}`);
}

// Update Excel with new element/version IDs
function saveUpdatedExcel(data) {
  // Update rows with results
  data.forEach(row => {
    const partNumber = row['property:Part number'];
    const entry = logEntries.find(e => e.partNumber === partNumber);
    if (entry) {
      row['replace:status'] = entry.status;
      if (entry.newVersionId) {
        row['onshape:versionId'] = entry.newVersionId;
      }
      if (entry.elementId && entry.elementId !== row['onshape:elementId']) {
        row['onshape:elementId'] = entry.elementId;
      }
    }
  });

  const ext = pathModule.extname(inputFile);
  const base = pathModule.basename(inputFile, ext);
  const dir = pathModule.dirname(inputFile);
  const outputPath = pathModule.join(dir, `${base}_replaced${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
  xlsx.writeFile(newWorkbook, outputPath);

  console.log(`Updated Excel saved to: ${outputPath}`);
}

// Main
async function main() {
  console.log(`Reading Excel file: ${inputFile}`);

  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  console.log(`Found ${data.length} rows`);

  // Filter to rows that have the required columns
  const rowsToReplace = data.filter(row => {
    const docId = row['onshape:documentId'];
    const elemId = row['onshape:elementId'];
    const filePath = row.filePath || row.zipPath;
    return docId && elemId && filePath;
  });

  console.log(`Found ${rowsToReplace.length} rows with replace data`);

  if (rowsToReplace.length === 0) {
    console.log('\nNo rows to replace. Required columns:');
    console.log('  onshape:documentId, onshape:elementId, filePath');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\nDRY RUN - no changes will be made\n');
  }

  // Get workflow ID
  if (!dryRun) {
    try {
      const policiesData = await new Promise((resolve, reject) => {
        app.getCompanyPolicies(COMPANY_ID, (data, err) => {
          if (err) reject(err);
          else resolve(JSON.parse(data.toString()));
        });
      });
      workflowId = policiesData.releaseWorkflowId;
      console.log(`Using workflow ID: ${workflowId}\n`);
    } catch (e) {
      console.warn(`Warning: Could not get workflow ID: ${extractErrorMessage(e)}`);
    }
  }

  // Process rows sequentially
  for (let i = 0; i < rowsToReplace.length; i++) {
    await processRow(rowsToReplace[i], i, rowsToReplace.length);
    if (i < rowsToReplace.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Summary
  const succeeded = logEntries.filter(e => e.status === 'success').length;
  const partial = logEntries.filter(e => e.status === 'replaced-no-release').length;
  const failed = logEntries.filter(e => e.status === 'failed').length;

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total: ${rowsToReplace.length}`);
  console.log(`Success: ${succeeded}`);
  console.log(`Replaced (no release): ${partial}`);
  console.log(`Failed: ${failed}`);
  if (dryRun) {
    console.log('(DRY RUN - nothing was actually changed)');
  }

  writeLogFile();
  saveUpdatedExcel(data);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
