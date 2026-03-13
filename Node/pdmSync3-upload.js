#!/usr/bin/env node
/**
 * pdmSync3-upload.js
 * Stage 3 of PDM Release Sync pipeline.
 *
 * Uploads new files and replaces existing files in Onshape.
 * Sets properties on all uploaded elements.
 * Does NOT release — that happens in Stage 4.
 *
 * CRITICAL: For SLDPRT/SLDASM replacements, the existing element is never
 * deleted. The BTMImport-136 feature is updated in-place so that parent
 * assemblies (which reference by element ID) are not broken.
 *
 * Usage:
 *   node pdmSync3-upload.js -i pdm_releases_s2.xlsx [-o pdm_releases_s3.xlsx]
 *                            [-s pdm_sync3_status.json] [--dry-run]
 */

'use strict';

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const mimeTypes = require('mime-types');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');
const relink = require('./lib/relink.js');
const { pollTranslation, propertyIdMap, COMPANY_ID } = require('./unifiedUpload.js');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 's'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', s: 'status', h: 'help' }
});

if (args.help || !args.input) {
  console.log(`
PDM Release Sync - Stage 3: Upload

Uploads/replaces files in Onshape and sets properties. Does NOT release.

Usage: node pdmSync3-upload.js -i pdm_releases_s2.xlsx [options]

Options:
  -i, --input     Stage 2 output Excel file (required)
  -o, --output    Output Excel file (default: pdm_releases_s3.xlsx)
  -s, --status    Status JSON sidecar (default: pdm_sync3_status.json)
  --dry-run       Show what would be done without executing
  -h, --help      Show this help

Output columns added:
  sync:newDocumentId   Document ID after upload
  sync:newWorkspaceId  Workspace ID after upload
  sync:newElementId    Element ID (same as existing for replacements)
  sync:uploadStatus    done / failed
  sync:uploadError     Error message if failed
`);
  process.exit(0);
}

const inputFile = args.input;
const outputFile = args.output || 'pdm_releases_s3.xlsx';
const statusFile = args.status || 'pdm_sync3_status.json';
const dryRun = args['dry-run'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const MIN_DELAY = 200;
const MAX_DELAY = 5000;
let currentDelay = MIN_DELAY;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Promisified API helpers ──────────────────────────────────────────────────

function apiGet(apiPath, query) {
  return new Promise((resolve, reject) => {
    const opts = { path: apiPath };
    if (query) opts.query = query;
    onshape.get(opts, (data, err, rateInfo) => {
      if (err) { reject(err); return; }
      if (rateInfo && rateInfo.remaining !== undefined) {
        if (rateInfo.remaining < 10) currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
        else if (rateInfo.remaining > 50) currentDelay = Math.max(Math.floor(currentDelay * 0.9), MIN_DELAY);
      }
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Parse error: ' + e.message)); }
    });
  });
}

function apiPost(apiPath, body, query) {
  return new Promise((resolve, reject) => {
    onshape.post({ path: apiPath, body, query }, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      }
    });
  });
}

function apiUpload(opts) {
  return new Promise((resolve, reject) => {
    onshape.upload(opts, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(JSON.parse(data.toString())); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      }
    });
  });
}

function apiDeleteElement(docId, workId, elementId) {
  return new Promise((resolve) => {
    app.deleteElement(docId, workId, elementId, (data, err) => {
      if (err) console.warn(`  Warning: delete element failed: ${extractError(err)}`);
      resolve();
    });
  });
}

function apiGetElements(docId, workId) {
  return new Promise((resolve, reject) => {
    app.getElements(docId, workId, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(JSON.parse(data.toString())); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      }
    });
  });
}

function extractError(err) {
  if (!err) return '';
  if (err.body) {
    try { const p = JSON.parse(err.body); return p.message || p.error || err.body; }
    catch (e) { return String(err.body); }
  }
  return err.statusCode ? `HTTP ${err.statusCode}` : String(err);
}

// ─── Poll translation (Promise wrapper) ───────────────────────────────────────

function pollTranslationAsync(translationId) {
  return new Promise((resolve, reject) => {
    pollTranslation(translationId, (success, data, failureReason) => {
      if (success) resolve(data);
      else reject(new Error(failureReason || 'Translation failed'));
    });
  });
}

// ─── Status sidecar ───────────────────────────────────────────────────────────

let status = {
  partMapping: {},
  externalPartMapping: {},
  fileStatus: {},
  documentCache: {}
};

function loadStatus() {
  if (fs.existsSync(statusFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      status = { ...status, ...data };
      console.log(`Loaded sidecar: ${Object.keys(status.fileStatus).length} processed rows`);
    } catch (e) {
      console.warn('Warning: Could not parse sidecar, starting fresh');
    }
  }
}

function saveStatus() {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// ─── Document management ─────────────────────────────────────────────────────

async function ensureDocument(docName, folderId) {
  // Check cache
  if (status.documentCache[docName]) {
    console.log(`  Using cached document: ${docName}`);
    return status.documentCache[docName];
  }

  // Search for existing document in company
  await delay(currentDelay);
  try {
    const docs = await apiGet('/api/documents', {
      q: docName, filter: 7, owner: COMPANY_ID, ownerType: 1
    });
    const existing = docs.items?.find(d => d.name === docName && d.owner?.id === COMPANY_ID);
    if (existing) {
      console.log(`  Found existing document: ${docName} -> ${existing.id}`);
      const result = { documentId: existing.id, workspaceId: existing.defaultWorkspace.id };
      status.documentCache[docName] = result;
      saveStatus();
      return result;
    }
  } catch (e) {
    console.warn(`  Warning: Document search failed: ${extractError(e)}`);
  }

  // Create new document
  console.log(`  Creating new document: ${docName} in folder ${folderId}`);
  const docInfo = await new Promise((resolve, reject) => {
    app.createDocument(docName, false, folderId, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(JSON.parse(data.toString())); }
        catch (e) { reject(e); }
      }
    });
  });

  const result = { documentId: docInfo.id, workspaceId: docInfo.defaultWorkspace.id };

  // Delete default elements (Part Studio 1, Assembly 1)
  try {
    const elements = await apiGetElements(result.documentId, result.workspaceId);
    const toDelete = elements.filter(e => e.name === 'Part Studio 1' || e.name === 'Assembly 1');
    for (const elem of toDelete) {
      console.log(`  Deleting default element: ${elem.name}`);
      await apiDeleteElement(result.documentId, result.workspaceId, elem.id);
      await delay(500);
    }
  } catch (e) {
    console.warn(`  Warning: Could not clean default elements: ${extractError(e)}`);
  }

  status.documentCache[docName] = result;
  saveStatus();
  return result;
}

// ─── Find assembly element after translation ──────────────────────────────────

async function findAssemblyElement(docId, workId, elementIds) {
  const elements = await apiGetElements(docId, workId);

  const assemblyElements = elements.filter(e => elementIds.includes(e.id) && e.type === 'Assembly');
  const assemblyElement = assemblyElements[0];

  const partStudioElements = elements
    .filter(e => elementIds.includes(e.id) && e.type === 'Part Studio')
    .map(e => e.id);

  const importedAssemblyElements = assemblyElements
    .filter(e => assemblyElement && e.id !== assemblyElement.id)
    .map(e => e.id);

  const assemblyElementId = assemblyElement?.id || elementIds[elementIds.length - 1];
  return { assemblyElementId, partStudioElements, importedAssemblyElements };
}

// ─── Properties ───────────────────────────────────────────────────────────────

function buildProperties(row) {
  const props = [];
  const partNumber = pathModule.parse(String(row['Name'] || '')).name;
  const revision = String(row['sync:pdmRevision'] || row['Revision'] || '00').padStart(2, '0');
  const description = row['Description'] || '';

  if (partNumber) props.push({ propertyId: propertyIdMap['Part number'], value: partNumber });
  if (revision) props.push({ propertyId: propertyIdMap['Revision'], value: revision });
  if (description) props.push({ propertyId: propertyIdMap['Description'], value: String(description) });

  return props;
}

async function setProperties(row, docId, workId, elementId) {
  const properties = buildProperties(row);
  if (properties.length === 0) return;
  if (dryRun) { console.log(`  [DRY RUN] Would set ${properties.length} properties`); return; }

  const level = parseInt(row['sync:level']) || 0;

  if (level === 1) {
    // SLDPRT: set Description on Part Studio element, then set all props on parts
    const descProp = properties.find(p => p.propertyId === propertyIdMap['Description']);
    if (descProp) {
      try {
        await new Promise((resolve, reject) => {
          app.updateProperties(docId, workId, elementId, [descProp], (_, err) => {
            if (err) console.warn(`  Warning: Part Studio Description: ${extractError(err)}`);
            resolve();
          });
        });
      } catch (e) { /* continue */ }
    }

    // Get parts in Part Studio
    try {
      await delay(currentDelay);
      const parts = await apiGet(`/api/parts/d/${docId}/w/${workId}/e/${elementId}`);
      if (parts.length === 0) return;

      // Set on composite if exists, else first part only
      const composite = parts.find(p => p.bodyType === 'composite');
      const targets = composite ? [composite] : [parts[0]];

      for (const part of targets) {
        console.log(`  Setting properties on part: ${part.name}`);
        await delay(currentDelay);
        try {
          await apiPost(`/api/metadata/d/${docId}/w/${workId}/e/${elementId}/p/${part.partId}`, { properties });
        } catch (e) {
          console.warn(`  Warning: Properties on ${part.name}: ${extractError(e)}`);
        }
      }
    } catch (e) {
      console.warn(`  Warning: Could not get parts: ${extractError(e)}`);
    }
  } else {
    // Blob (level 0) or assembly (level 2+): set on element directly
    console.log(`  Setting ${properties.length} properties on element`);
    try {
      await new Promise((resolve, reject) => {
        app.updateProperties(docId, workId, elementId, properties, (_, err) => {
          if (err) console.warn(`  Warning: Properties: ${extractError(err)}`);
          resolve();
        });
      });
    } catch (e) { /* continue */ }
  }
}

// ─── Upload functions ─────────────────────────────────────────────────────────

/**
 * Upload a blob (level 0) to a new element.
 */
async function uploadNewBlob(row, docId, workId) {
  const filePath = String(row['sync:filePath'] || '');
  const name = String(row['Name'] || '');
  const partNumber = pathModule.parse(name).name;
  const ext = pathModule.extname(name);
  const elementName = partNumber + ext;
  const mimeType = mimeTypes.lookup(name) || 'application/octet-stream';

  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  console.log(`  Uploading blob: ${elementName}`);
  const result = await new Promise((resolve, reject) => {
    app.uploadBlobElement(docId, workId, filePath, mimeType, elementName, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(JSON.parse(data.toString())); }
        catch (e) { reject(e); }
      }
    });
  });

  return result.id;
}

/**
 * Upload a part (level 1) via translation.
 */
async function uploadNewPart(row, docId, workId) {
  const filePath = String(row['sync:filePath'] || '');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  console.log(`  Uploading part via translation: ${pathModule.basename(filePath)}`);
  const transResult = await apiUpload({
    path: `/api/v6/translations/d/${docId}/w/${workId}`,
    file: filePath,
    mimeType: 'application/octet-stream',
    body: {
      allowFaultyParts: true,
      createComposite: false,
      yAxisIsUp: true,
      storeInDocument: true
    }
  });

  console.log(`  Translation started: ${transResult.id}`);
  const data = await pollTranslationAsync(transResult.id);
  const elementId = data.resultElementIds?.[0];
  if (!elementId) throw new Error('No element ID in translation result');
  console.log(`  Translation complete: ${elementId}`);
  return elementId;
}

/**
 * Upload an assembly (level 2+) via ZIP translation, then relink.
 */
async function uploadNewAssembly(row, docId, workId) {
  const zipPath = String(row['sync:zipPath'] || row['sync:filePath'] || '');
  if (!fs.existsSync(zipPath)) throw new Error(`ZIP not found: ${zipPath}`);

  console.log(`  Uploading assembly ZIP: ${pathModule.basename(zipPath)}`);
  const transResult = await apiUpload({
    path: `/api/v6/translations/d/${docId}/w/${workId}`,
    file: zipPath,
    mimeType: 'application/zip',
    body: {
      allowFaultyParts: true,
      createComposite: true,
      createDrawingIfPossible: false,
      flattenAssemblies: false,
      yAxisIsUp: true,
      storeInDocument: true,
      importWithinDocument: true,
      splitAssembliesIntoMultipleDocuments: false
    }
  });

  console.log(`  Translation started: ${transResult.id}`);
  const data = await pollTranslationAsync(transResult.id);
  const elementIds = data.resultElementIds || [];
  console.log(`  Translation complete. Elements: ${elementIds.length}`);

  // Find the assembly element
  await delay(currentDelay);
  const { assemblyElementId, partStudioElements, importedAssemblyElements } =
    await findAssemblyElement(docId, workId, elementIds);

  console.log(`  Assembly element: ${assemblyElementId}`);

  // Relink assembly to use master parts
  const combinedPartMapping = { ...status.externalPartMapping, ...status.partMapping };
  if (Object.keys(combinedPartMapping).length > 0) {
    console.log(`  Starting relink (${Object.keys(combinedPartMapping).length} parts in mapping)...`);
    try {
      await new Promise((resolve, reject) => {
        relink.relinkAssembly(
          {
            documentId: docId,
            workspaceId: workId,
            elementId: assemblyElementId,
            partStudioElements,
            importedAssemblyElements,
            zipPath
          },
          combinedPartMapping,
          null, // no ASMREF data
          (report, err) => {
            if (err) {
              console.warn(`  Relink failed: ${err.message || extractError(err)}`);
            } else {
              console.log(`  Relinked ${report.relinksPerformed} instances, deleted ${report.deletedElements} duplicates`);
            }
            resolve();
          }
        );
      });
      // Wait for Onshape to process reference updates
      console.log(`  Waiting 10s for reference updates...`);
      await delay(10000);
    } catch (e) {
      console.warn(`  Relink error: ${e.message}`);
    }
  }

  return assemblyElementId;
}

// ─── In-place update for existing CAD files ──────────────────────────────────

/**
 * Update a blob element in-place (preserves element ID).
 */
async function updateBlobInPlace(row, docId, workId, existingElementId) {
  const filePath = String(row['sync:filePath'] || '');
  const name = String(row['Name'] || '');
  const partNumber = pathModule.parse(name).name;
  const ext = pathModule.extname(name);
  const elementName = partNumber + ext;
  const mimeType = mimeTypes.lookup(name) || 'application/octet-stream';

  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  console.log(`  Updating blob in-place: ${elementName}`);
  await new Promise((resolve, reject) => {
    app.updateBlobElement(docId, workId, existingElementId, filePath, mimeType, elementName, (data, err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return existingElementId; // preserved
}

/**
 * Update a CAD file (SLDPRT/SLDASM) in-place by swapping the BTMImport-136 feature.
 * This preserves the element ID so parent assemblies are not broken.
 *
 * Algorithm:
 *   A) Get existing element's features → find BTMImport-136 → featureId
 *   B) Upload new file via translation → tempElementId
 *   C) Get temp element's features → get BTMImport-136 with new content ref
 *   D) POST updatePartStudioFeature on existing element with temp's import feature body
 *   E) Delete temp element
 *
 * NOTE: The exact body for step D should be verified empirically by observing
 * the Onshape UI network request when using "Update..." on an import feature.
 * See plan's "Open Question" section.
 */
async function updateCadInPlace(row, docId, workId, existingElementId) {
  const level = parseInt(row['sync:level']) || 1;
  const isAssembly = level >= 2;
  const filePath = isAssembly
    ? String(row['sync:zipPath'] || row['sync:filePath'] || '')
    : String(row['sync:filePath'] || '');
  const fileName = pathModule.basename(filePath);

  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  console.log(`  Updating CAD in-place: ${fileName} (element ${existingElementId})`);

  // Step A: Get existing features to find the import feature ID
  await delay(currentDelay);
  let featureId = null;
  try {
    const featureList = await apiGet(`/api/partstudios/d/${docId}/w/${workId}/e/${existingElementId}/features`);
    const importFeature = featureList.features?.find(f =>
      f.btType === 'BTMImport-136' ||
      f.message?.btType === 'BTMImport-136' ||
      f.typeName === 'BTMImport'
    );
    featureId = importFeature?.message?.featureId || importFeature?.featureId || importFeature?.id;
  } catch (e) {
    console.warn(`  Warning: Could not read features from existing element: ${extractError(e)}`);
    // For assemblies, the element might be an Assembly type, not Part Studio — features API differs
    if (isAssembly) {
      console.log(`  Assembly element — falling back to delete-and-reupload`);
      return await fallbackDeleteAndReupload(row, docId, workId, existingElementId, filePath, isAssembly);
    }
  }

  if (!featureId) {
    console.warn(`  No BTMImport-136 feature found — falling back to delete-and-reupload`);
    return await fallbackDeleteAndReupload(row, docId, workId, existingElementId, filePath, isAssembly);
  }

  console.log(`  Found import feature: ${featureId}`);

  // Step B: Upload new file via translation → tempElementId
  const mimeType = isAssembly ? 'application/zip' : 'application/octet-stream';
  const transResult = await apiUpload({
    path: `/api/v6/translations/d/${docId}/w/${workId}`,
    file: filePath,
    mimeType,
    body: {
      allowFaultyParts: true,
      createComposite: false,
      yAxisIsUp: true,
      storeInDocument: true
    }
  });

  console.log(`  Translation started: ${transResult.id}`);
  const transData = await pollTranslationAsync(transResult.id);
  const tempElementId = transData.resultElementIds?.[0];
  if (!tempElementId) throw new Error('No temp element ID from translation');
  console.log(`  Temp element: ${tempElementId}`);

  // Step C: Get features from temp element to get the new import feature body
  await delay(currentDelay);
  let newImportFeature = null;
  try {
    const tempFeatures = await apiGet(`/api/partstudios/d/${docId}/w/${workId}/e/${tempElementId}/features`);
    newImportFeature = tempFeatures.features?.find(f =>
      f.btType === 'BTMImport-136' ||
      f.message?.btType === 'BTMImport-136' ||
      f.typeName === 'BTMImport'
    );
  } catch (e) {
    console.warn(`  Warning: Could not read features from temp element: ${extractError(e)}`);
  }

  if (!newImportFeature) {
    console.warn(`  Could not extract BTMImport-136 from temp element — cleaning up`);
    await apiDeleteElement(docId, workId, tempElementId);
    return await fallbackDeleteAndReupload(row, docId, workId, existingElementId, filePath, isAssembly);
  }

  // Step D: Update the existing element's import feature
  // Preserve the existing featureId in the new feature body
  const featureBody = JSON.parse(JSON.stringify(newImportFeature));
  if (featureBody.message) {
    featureBody.message.featureId = featureId;
  } else {
    featureBody.featureId = featureId;
  }

  console.log(`  Updating import feature ${featureId} on existing element...`);
  await delay(currentDelay);
  try {
    await apiPost(
      `/api/partstudios/d/${docId}/w/${workId}/e/${existingElementId}/features/featureid/${featureId}`,
      { feature: featureBody }
    );
    console.log(`  Import feature updated successfully`);
  } catch (e) {
    console.error(`  Error updating import feature: ${extractError(e)}`);
    console.warn(`  Falling back to delete-and-reupload (element ID will change)`);
    await apiDeleteElement(docId, workId, tempElementId);
    return await fallbackDeleteAndReupload(row, docId, workId, existingElementId, filePath, isAssembly);
  }

  // Step E: Delete temp element
  console.log(`  Deleting temp element: ${tempElementId}`);
  await apiDeleteElement(docId, workId, tempElementId);

  return existingElementId; // preserved
}

/**
 * Fallback: delete old element and re-upload. Element ID will change.
 * Only used when BTMImport-136 update fails (not the preferred path).
 */
async function fallbackDeleteAndReupload(row, docId, workId, oldElementId, filePath, isAssembly) {
  console.warn(`  WARNING: Deleting element ${oldElementId} — parent assembly references may break`);

  await apiDeleteElement(docId, workId, oldElementId);
  await delay(1000);

  const mimeType = isAssembly ? 'application/zip' : 'application/octet-stream';
  const transResult = await apiUpload({
    path: `/api/v6/translations/d/${docId}/w/${workId}`,
    file: filePath,
    mimeType,
    body: {
      allowFaultyParts: true,
      createComposite: false,
      yAxisIsUp: true,
      storeInDocument: true,
      splitAssembliesIntoMultipleDocuments: false
    }
  });

  const transData = await pollTranslationAsync(transResult.id);
  const newElementId = transData.resultElementIds?.[0];
  if (!newElementId) throw new Error('No element ID from fallback translation');
  console.log(`  New element (fallback): ${newElementId}`);
  return newElementId;
}

// ─── Part mapping for assembly relink ─────────────────────────────────────────

/**
 * Look up a part number in Onshape and add to externalPartMapping if found.
 * Used when relink needs a part that wasn't uploaded in this run.
 */
async function lookupExternalPart(partNumber) {
  if (status.externalPartMapping[partNumber]) return;
  try {
    await delay(currentDelay);
    const rev = await apiGet(
      `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`,
      { elementType: 0 }
    );
    if (rev && rev.documentId && rev.elementId) {
      status.externalPartMapping[partNumber] = {
        documentId: rev.documentId,
        elementId: rev.elementId,
        versionId: rev.versionId || ''
      };
    }
  } catch (e) {
    // Part not found — not an error for relink, just missing
  }
}

// ─── Main processing ──────────────────────────────────────────────────────────

async function main() {
  loadStatus();

  console.log(`Reading: ${inputFile}`);
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  console.log(`Found ${rows.length} rows`);

  // Filter and sort by level
  const actionable = rows.filter(row => {
    const action = String(row['sync:action'] || '');
    return action !== 'skip' && action !== 'skip-downgrade' && action !== 'error' && action !== '';
  });
  actionable.sort((a, b) => (parseInt(a['sync:level']) || 0) - (parseInt(b['sync:level']) || 0));

  console.log(`Actionable rows: ${actionable.length} (sorted by level)`);
  if (dryRun) console.log('DRY RUN — no changes will be made\n');
  else console.log('');

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < actionable.length; i++) {
    const row = actionable[i];
    const name = String(row['Name'] || '');
    const partNumber = pathModule.parse(name).name;
    const action = String(row['sync:action'] || '');
    const level = parseInt(row['sync:level']) || 0;

    console.log(`\n[${i + 1}/${actionable.length}] ${name} (action=${action}, level=${level})`);

    // Check sidecar — skip already-processed rows
    if (status.fileStatus[partNumber]?.status === 'done') {
      console.log(`  → already done (cached)`);
      const cached = status.fileStatus[partNumber];
      row['sync:newDocumentId'] = cached.documentId || '';
      row['sync:newWorkspaceId'] = cached.workspaceId || '';
      row['sync:newElementId'] = cached.elementId || '';
      row['sync:uploadStatus'] = 'done';
      row['sync:uploadError'] = '';
      succeeded++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would ${action === 'new' ? 'upload' : 'update'} (level ${level})`);
      row['sync:uploadStatus'] = 'dry-run';
      continue;
    }

    try {
      let docId, workId, elementId;

      if (action === 'new') {
        // ── New file: create document, upload, set properties ──
        const docName = String(row['sync:documentName'] || getDocumentName(name));
        const folderId = String(row['sync:folder'] || '');

        const doc = await ensureDocument(docName, folderId);
        if (!doc) throw new Error('Could not create or find document');
        docId = doc.documentId;
        workId = doc.workspaceId;

        if (level === 0) {
          elementId = await uploadNewBlob(row, docId, workId);
        } else if (level === 1) {
          elementId = await uploadNewPart(row, docId, workId);
        } else {
          elementId = await uploadNewAssembly(row, docId, workId);
        }

      } else if (action === 'same-rev' || action === 'new-rev') {
        // ── Replace existing: update in-place, set properties ──
        docId = String(row['sync:documentId'] || '');
        workId = String(row['sync:workspaceId'] || '');
        const existingElementId = String(row['sync:elementId'] || '');

        if (!docId || !workId || !existingElementId) {
          throw new Error(`Missing existing Onshape IDs (doc=${docId}, ws=${workId}, elem=${existingElementId})`);
        }

        if (level === 0) {
          elementId = await updateBlobInPlace(row, docId, workId, existingElementId);
        } else {
          elementId = await updateCadInPlace(row, docId, workId, existingElementId);
        }

      } else {
        console.log(`  → skipping (action=${action})`);
        continue;
      }

      // Set properties
      await delay(currentDelay);
      await setProperties(row, docId, workId, elementId);

      // Update part mapping for assembly relink
      if (level <= 1) {
        status.partMapping[partNumber] = {
          documentId: docId,
          workspaceId: workId,
          elementId: elementId,
          filename: name
        };
      }

      // Mark done
      row['sync:newDocumentId'] = docId;
      row['sync:newWorkspaceId'] = workId;
      row['sync:newElementId'] = elementId;
      row['sync:uploadStatus'] = 'done';
      row['sync:uploadError'] = '';
      status.fileStatus[partNumber] = { status: 'done', documentId: docId, workspaceId: workId, elementId };
      saveStatus();
      succeeded++;
      console.log(`  → done (element: ${elementId})`);

    } catch (err) {
      const errMsg = extractError(err) || err.message || String(err);
      console.error(`  → FAILED: ${errMsg}`);
      row['sync:newDocumentId'] = '';
      row['sync:newWorkspaceId'] = '';
      row['sync:newElementId'] = '';
      row['sync:uploadStatus'] = 'failed';
      row['sync:uploadError'] = errMsg;
      status.fileStatus[partNumber] = { status: 'failed', error: errMsg };
      saveStatus();
      failed++;
    }

    await delay(1000); // post-operation delay
  }

  // Mark non-actionable rows
  rows.forEach(row => {
    if (row['sync:uploadStatus'] === undefined) {
      row['sync:uploadStatus'] = 'skipped';
      row['sync:uploadError'] = '';
      row['sync:newDocumentId'] = '';
      row['sync:newWorkspaceId'] = '';
      row['sync:newElementId'] = '';
    }
  });

  // Write output Excel
  const outWorkbook = xlsx.utils.book_new();
  const outSheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(outWorkbook, outSheet, 'Sheet1');
  xlsx.writeFile(outWorkbook, outputFile);

  console.log('\n' + '='.repeat(50));
  console.log('STAGE 3 COMPLETE');
  console.log('='.repeat(50));
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  if (dryRun) console.log('(DRY RUN — nothing was changed)');
  console.log(`\nOutput: ${outputFile}`);
  console.log(`Sidecar: ${statusFile}`);
}

// Helper in case getDocumentName is needed before ensureDocument
function getDocumentName(filename) {
  const base = pathModule.parse(filename).name;
  return base.substring(0, 5) + ' SRC';
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
