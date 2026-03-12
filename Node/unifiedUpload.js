const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const mimeTypes = require('mime-types');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');
const { createFolder } = require('./createFolder.js');
const relink = require('./lib/relink.js');
const asmref = require('./lib/asmref.js');

// Configuration
const COMPANY_ID = '6763516217765c31f9561958';
let DEFAULT_FOLDER_ID = 'af89b4c072a8fb45084e1757';

// Retry configuration for "pending reference updates" error
const PENDING_REFS_RETRY_DELAY = 15000; // 15 seconds between retries
const PENDING_REFS_MAX_RETRIES = 3;

// Release errors log file
const RELEASE_ERRORS_FILE = 'Upload/release_errors.json';
let releaseErrors = [];

// Load existing release errors if file exists
if (fs.existsSync(RELEASE_ERRORS_FILE)) {
  try {
    releaseErrors = JSON.parse(fs.readFileSync(RELEASE_ERRORS_FILE, 'utf8'));
  } catch (e) {
    releaseErrors = [];
  }
}

// Property ID map (from bulkUploadFromExcel.js)
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

// Global state
let status = {};
let statusFile = '';
let workflowId = null;
let dryRun = false;
let slowRun = false;
let noRelease = false;
let slowRunPaused = false;
let cancelRequested = false;
let cancelConfirmPending = false;
let asmrefData = null;
let asmrefPath = null;
const readline = require('readline');

// Setup graceful cancellation (Ctrl+C and 'q' key)
function setupCancelHandlers() {
  // Handle Ctrl+C (SIGINT)
  process.on('SIGINT', () => {
    if (cancelConfirmPending) return; // Already asking
    promptCancel();
  });

  // Handle 'q' keypress
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
      if (cancelConfirmPending) {
        // Handle Y/N response
        if (key.name === 'y') {
          console.log('\nCancelling... saving progress...');
          saveStatus();
          console.log(`Progress saved to: ${statusFile}`);
          console.log('You can resume by running the same command again.');
          process.exit(0);
        } else if (key.name === 'n') {
          console.log('\nContinuing upload...');
          cancelConfirmPending = false;
        }
        return;
      }

      // Handle slow-run Y/N/F response
      if (slowRunPaused) {
        if (key.name === 'y') {
          console.log(' continuing...');
          slowRunPaused = false;
        } else if (key.name === 'n') {
          console.log('\nStopping... saving progress...');
          saveStatus();
          console.log(`Progress saved to: ${statusFile}`);
          console.log('You can resume by running the same command again.');
          process.exit(0);
        } else if (key.name === 'f') {
          console.log(' switching to fast mode...');
          slowRun = false;
          slowRunPaused = false;
        }
        return;
      }

      // 'q' to request cancel
      if (str === 'q' || str === 'Q') {
        promptCancel();
      }

      // Ctrl+C when not in confirm mode
      if (key && key.ctrl && key.name === 'c') {
        promptCancel();
      }
    });
    process.stdin.resume();
  }

  console.log('Press Q or Ctrl+C to cancel upload gracefully');
  if (slowRun) {
    console.log('SLOW-RUN mode: will prompt after each file (y=continue, n=stop, f=fast)\n');
  } else {
    console.log('');
  }
}

function promptCancel() {
  if (cancelConfirmPending) return;
  cancelConfirmPending = true;
  process.stdout.write('\n\nCancel upload? (y/n): ');
}

// Load or initialize status
function loadStatus(filePath) {
  const defaultStatus = {
    lastUpdated: new Date().toISOString(),
    partMapping: {},
    assemblyMapping: {},
    fileStatus: {},
    folderCache: {},
    documentCache: {}
  };

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      // Merge with defaults to ensure all required properties exist
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

// Ensure folder exists (check cache, then API)
function ensureFolder(folderName, parentId, callback) {
  if (!folderName || folderName.trim() === '') {
    console.log(`  - Using default folder: ${parentId}`);
    callback(parentId);
    return;
  }

  // Check cache
  if (status.folderCache[folderName]) {
    console.log(`  - Using cached folder: ${folderName} -> ${status.folderCache[folderName]}`);
    callback(status.folderCache[folderName]);
    return;
  }

  // Check if folder exists via API
  onshape.get({
    path: '/api/folders',
    query: { q: folderName }
  }, (data, err) => {
    if (err) {
      console.error(`  - Error searching for folder: ${err.body || err}`);
      callback(parentId);
      return;
    }

    const folders = JSON.parse(data.toString());
    const existing = folders.items?.find(f => f.name === folderName);

    if (existing) {
      console.log(`  - Found existing folder: ${folderName} -> ${existing.id}`);
      status.folderCache[folderName] = existing.id;
      saveStatus();
      callback(existing.id);
    } else {
      // Create new folder
      console.log(`  - Creating folder: ${folderName}`);
      createFolder(folderName, parentId, (result, createErr) => {
        if (createErr) {
          console.error(`  - Failed to create folder, using parent: ${createErr.body || createErr}`);
          callback(parentId);
        } else {
          status.folderCache[folderName] = result.id;
          saveStatus();
          callback(result.id);
        }
      });
    }
  });
}

// Ensure document exists: Excel IDs first, then company search, then create
function ensureDocument(docName, folderId, directDocId, directWsId, callback) {

  // Priority 1: Use IDs directly from Excel (no API call needed)
  if (directDocId && directWsId) {
    console.log(`  - Using Excel document IDs: ${docName} -> ${directDocId}`);
    callback({ documentId: directDocId, workspaceId: directWsId });
    return;
  }

  // Priority 2: Search company for document by name
  searchForDocument();

  function searchForDocument() {
    // filter: 7 restricts results to company-owned documents
    onshape.get({
      path: '/api/documents',
      query: { q: docName, filter: 7, owner: COMPANY_ID, ownerType: 1 }
    }, (data, err) => {
      if (err) {
        console.error(`  - Error searching for document: ${err.body || err}`);
        createNewDocument();
        return;
      }

      const docs = JSON.parse(data.toString());
      // Also verify owner matches our company (safety check)
      const existing = docs.items?.find(d => d.name === docName && d.owner?.id === COMPANY_ID);

      if (existing) {
        console.log(`  - Found existing document: ${docName} -> ${existing.id}`);
        callback({
          documentId: existing.id,
          workspaceId: existing.defaultWorkspace.id
        });
      } else {
        createNewDocument();
      }
    });
  }

  // Priority 3: Create new document
  function createNewDocument() {
    console.log(`  - Creating new document: ${docName}`);
    app.createDocument(docName, false, folderId, (createData, createErr) => {
      if (createErr || !createData) {
        console.error(`  - Failed to create document: ${createErr?.body || 'Unknown error'}`);
        // Retry search (handles race condition where doc was created between search and create)
        console.log(`  - Retrying search for existing document: ${docName}`);
        onshape.get({
          path: '/api/documents',
          query: { q: docName, filter: 7, owner: COMPANY_ID, ownerType: 1 }
        }, (searchData, searchErr) => {
          if (searchErr) {
            console.error(`  - Search failed: ${searchErr.body || searchErr}`);
            callback(null);
            return;
          }
          const docs = JSON.parse(searchData.toString());
          const existing = docs.items?.find(d => d.name === docName && d.owner?.id === COMPANY_ID);
          if (existing) {
            console.log(`  - Found existing document: ${docName} -> ${existing.id}`);
            callback({
              documentId: existing.id,
              workspaceId: existing.defaultWorkspace.id
            });
          } else {
            console.error(`  - Could not find or create document: ${docName}`);
            callback(null);
          }
        });
        return;
      }
      const docInfo = JSON.parse(createData.toString());
      const result = {
        documentId: docInfo.id,
        workspaceId: docInfo.defaultWorkspace.id
      };

      // Delete default elements
      app.getElements(result.documentId, result.workspaceId, (elementsData) => {
        const elements = JSON.parse(elementsData.toString());
        const toDelete = elements.filter(e => e.name === 'Part Studio 1' || e.name === 'Assembly 1');

        let deleteCount = 0;
        if (toDelete.length === 0) {
          callback(result);
          return;
        }

        toDelete.forEach(element => {
          console.log(`  - Deleting default element: ${element.name}`);
          app.deleteElement(result.documentId, result.workspaceId, element.id, (_, delErr) => {
            if (delErr) {
              console.error(`  - Error deleting element ${element.name}: ${delErr.body || delErr.statusCode || delErr}`);
            }
            deleteCount++;
            if (deleteCount === toDelete.length) {
              callback(result);
            }
          });
        });
      });
    });
  }
}

// Upload blob (Level 0 - non-CAD files)
function uploadBlob(row, docId, workId, callback) {
  const filePath = normalizeFilePath(row.filePath);
  const fileName = pathModule.basename(filePath);
  const fileExt = pathModule.extname(filePath);  // e.g., ".PDF"

  // Determine element name: use element:name, property:Part number, or document:name
  // Append the file extension to preserve file type
  let elementName = row['element:name'] || row['property:Part number'] || row['document:name'];
  if (elementName) {
    // Add extension if not already present
    if (!elementName.toLowerCase().endsWith(fileExt.toLowerCase())) {
      elementName = elementName + fileExt;
    }
  } else {
    elementName = fileName;  // Fall back to original filename
  }

  if (!fs.existsSync(filePath)) {
    console.error(`  - File not found: ${filePath}`);
    updateFileStatus(row.filePath, 'failed', 'File not found');
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would upload blob: ${fileName} as "${elementName}"`);
    callback();
    return;
  }

  const mimeType = mimeTypes.lookup(filePath) || 'application/octet-stream';
  console.log(`  - Uploading blob: ${fileName} as "${elementName}"`);

  app.uploadBlobElement(docId, workId, filePath, mimeType, elementName, (uploadData, uploadErr) => {
    if (uploadErr || !uploadData) {
      const errMsg = uploadErr ? (uploadErr.body || uploadErr.statusCode || uploadErr) : 'No response data';
      console.error(`  - Failed to upload blob: ${fileName}`);
      console.error(`    Error: ${errMsg}`);
      updateFileStatus(row.filePath, 'failed', `Upload failed: ${errMsg}`);
      callback();
      return;
    }
    const result = JSON.parse(uploadData.toString());
    console.log(`  - Uploaded blob: ${result.id}`);

    updateFileStatus(row.filePath, 'uploaded', null, docId, workId, result.id);
    // Level 0 blobs: set properties but skip release (will be released with Level 1+ files)
    setBlobProperties(row, docId, workId, result.id, callback);
  });
}

// Set properties on blob element without releasing
function setBlobProperties(row, docId, workId, elementId, callback) {
  const propertiesToUpdate = buildPropertiesArray(row);

  if (propertiesToUpdate.length === 0) {
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would set ${propertiesToUpdate.length} properties on blob`);
    callback();
    return;
  }

  console.log(`  - Setting ${propertiesToUpdate.length} properties on blob`);
  app.updateProperties(docId, workId, elementId, propertiesToUpdate, (_, updateErr) => {
    if (updateErr) {
      console.error(`  - Error setting blob properties: ${updateErr.body || updateErr.statusCode || updateErr}`);
    } else {
      console.log(`  - Blob properties updated (release deferred)`);
    }
    callback();
  });
}

// Upload part (Level 1 - SLDPRT with translation)
function uploadPart(row, docId, workId, callback) {
  const filePath = normalizeFilePath(row.filePath);
  const fileName = pathModule.basename(filePath);
  const partNumber = row['property:Part number'] || pathModule.parse(fileName).name;

  // Determine if composite based on BodyCount column (case-insensitive)
  // BodyCount > 1 means multi-body part, needs composite
  const bodycount = parseInt(row.BodyCount || row.bodycount) || 0;
  const useComposite = bodycount > 1;

  if (!fs.existsSync(filePath)) {
    console.error(`  - File not found: ${filePath}`);
    updateFileStatus(row.filePath, 'failed', 'File not found');
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would upload part: ${fileName} (bodycount: ${bodycount}, composite: ${useComposite})`);
    callback();
    return;
  }

  console.log(`  - Uploading part: ${fileName} (bodycount: ${bodycount}, composite: ${useComposite})`);

  onshape.upload({
    path: `/api/v6/translations/d/${docId}/w/${workId}`,
    file: filePath,
    mimeType: 'application/octet-stream',
    body: {
      allowFaultyParts: true,
      createComposite: useComposite,
      yAxisIsUp: true,
      storeInDocument: true
    }
  }, (uploadData, uploadErr) => {
    if (uploadErr || !uploadData) {
      const errMsg = uploadErr ? (uploadErr.body || uploadErr.statusCode || uploadErr) : 'No response data';
      console.error(`  - Failed to upload part: ${fileName}`);
      console.error(`    Error: ${errMsg}`);
      updateFileStatus(row.filePath, 'failed', `Upload failed: ${errMsg}`);
      callback();
      return;
    }

    const translationResult = JSON.parse(uploadData.toString());
    const translationId = translationResult.id;

    console.log(`  - Translation started: ${translationId}`);
    pollTranslation(translationId, (success, translationData, failureReason) => {
      if (!success) {
        console.error(`  - Translation failed for: ${fileName}`);
        if (failureReason) console.error(`    Reason: ${failureReason}`);
        updateFileStatus(row.filePath, 'failed', `Translation failed: ${failureReason || 'Unknown'}`);
        callback();
        return;
      }

      // Get element ID from translation result
      const elementId = translationData.resultElementIds?.[0];
      if (!elementId) {
        console.error(`  - No element ID in translation result`);
        updateFileStatus(row.filePath, 'failed', 'No element ID');
        callback();
        return;
      }

      console.log(`  - Translation complete: ${elementId}`);

      // Store in part mapping with filename for relink matching
      status.partMapping[partNumber] = {
        documentId: docId,
        workspaceId: workId,
        elementId: elementId,
        filename: fileName
      };
      saveStatus();

      updateFileStatus(row.filePath, 'uploaded', null, docId, workId, elementId);
      // Use setPartProperties to apply properties to parts within the Part Studio
      setPartProperties(row, docId, workId, elementId, fileName, callback);
    });
  });
}

// Find the assembly element from a list of element IDs
// Returns: callback(assemblyElementId, partStudioElements, importedAssemblyElements)
function findAssemblyElement(docId, workId, elementIds, callback) {
  onshape.get({
    path: `/api/documents/d/${docId}/w/${workId}/elements`
  }, (data, err) => {
    if (err) {
      console.error(`  - Error getting elements: ${err.body || err}`);
      callback(null, [], []);
      return;
    }

    const elements = JSON.parse(data.toString());
    // Find all Assembly elements that are in our elementIds list
    const assemblyElements = elements
      .filter(e => elementIds.includes(e.id) && e.type === 'Assembly');

    // The main assembly is typically the one whose name matches the ZIP (no suffix)
    // Or the first Assembly element in the list
    const assemblyElement = assemblyElements[0];

    // Find Part Studio elements (the duplicates from Pack & Go)
    const partStudioElements = elements
      .filter(e => elementIds.includes(e.id) && e.type === 'Part Studio')
      .map(e => e.id);

    // Find imported sub-assembly elements (excluding the main assembly)
    const importedAssemblyElements = assemblyElements
      .filter(e => assemblyElement && e.id !== assemblyElement.id)
      .map(e => e.id);

    if (assemblyElement) {
      callback(assemblyElement.id, partStudioElements, importedAssemblyElements);
    } else {
      // Fallback: return the last element (often the assembly is last)
      callback(elementIds[elementIds.length - 1], partStudioElements, []);
    }
  });
}

// Upload assembly (Level 2+ - ZIP with translation and relink)
function uploadAssembly(row, docId, workId, callback) {
  const zipPath = normalizeFilePath(row.zipPath || row.filePath);
  const fileName = pathModule.basename(zipPath);
  const assemblyName = row['property:Part number'] || pathModule.parse(fileName).name;

  if (!fs.existsSync(zipPath)) {
    console.error(`  - ZIP not found: ${zipPath}`);
    updateFileStatus(row.filePath, 'failed', 'ZIP not found');
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would upload assembly: ${fileName}`);
    callback();
    return;
  }

  console.log(`  - Uploading assembly ZIP: ${fileName}`);

  onshape.upload({
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
  }, (uploadData, uploadErr) => {
    if (uploadErr || !uploadData) {
      const errMsg = uploadErr ? (uploadErr.body || uploadErr.statusCode || uploadErr) : 'No response data';
      console.error(`  - Failed to upload assembly: ${fileName}`);
      console.error(`    Error: ${errMsg}`);
      updateFileStatus(row.filePath, 'failed', `Upload failed: ${errMsg}`);
      callback();
      return;
    }

    const translationResult = JSON.parse(uploadData.toString());
    const translationId = translationResult.id;

    console.log(`  - Translation started: ${translationId}`);
    pollTranslation(translationId, (success, translationData, failureReason) => {
      if (!success) {
        console.error(`  - Translation failed for: ${fileName}`);
        if (failureReason) console.error(`    Reason: ${failureReason}`);
        updateFileStatus(row.filePath, 'failed', `Translation failed: ${failureReason || 'Unknown'}`);
        callback();
        return;
      }

      const elementIds = translationData.resultElementIds || [];
      console.log(`  - Translation complete. Elements: ${elementIds.length}`);

      // Find the actual assembly element (not Part Studios)
      findAssemblyElement(docId, workId, elementIds, (assemblyElementId, partStudioElements, importedAssemblyElements) => {
        if (!assemblyElementId) {
          console.error(`  - Could not find assembly element`);
          callback();
          return;
        }

        console.log(`  - Assembly element: ${assemblyElementId}`);
        if (partStudioElements.length > 0) {
          console.log(`  - Part Studio elements: ${partStudioElements.length}`);
        }
        if (importedAssemblyElements.length > 0) {
          console.log(`  - Imported sub-assembly elements: ${importedAssemblyElements.length}`);
        }

        // Store in assembly mapping with explicit elementId, partStudioElements, and importedAssemblyElements
        status.assemblyMapping[assemblyName] = {
          documentId: docId,
          workspaceId: workId,
          elementId: assemblyElementId,
          partStudioElements: partStudioElements,
          importedAssemblyElements: importedAssemblyElements
        };
        saveStatus();

        // Use zipPath for assemblies, fall back to filePath
        const statusKey = row.zipPath || row.filePath || row.filename;
        updateFileStatus(statusKey, 'uploaded', null, docId, workId, assemblyElementId);

        // Relink assembly to use master parts instead of duplicates
        // Use ASMREF if available, otherwise fall back to partMapping
        const shouldRelink = elementIds.length > 0 &&
          (asmrefData || Object.keys(status.partMapping).length > 0);

        if (shouldRelink) {
          console.log(`  - Starting relink process${asmrefData ? ' (ASMREF mode)' : ''}...`);
          relink.relinkAssembly(
            {
              documentId: docId,
              workspaceId: workId,
              elementId: assemblyElementId,
              partStudioElements: partStudioElements,
              importedAssemblyElements: importedAssemblyElements,
              zipPath: zipPath
            },
            status.partMapping,
            asmrefData,  // Pass ASMREF data (may be null for legacy mode)
            (relinkReport, relinkErr) => {
              if (relinkErr) {
                console.log(`    Relink failed: ${relinkErr.message || relinkErr.body || relinkErr}`);
                // Continue to set properties even if relink failed
                setProperties(row, docId, workId, assemblyElementId, fileName, callback);
              } else {
                console.log(`    Relinked ${relinkReport.relinksPerformed} instances`);
                console.log(`    Deleted ${relinkReport.deletedElements} duplicate elements`);
                if (relinkReport.localPartsKept > 0) {
                  console.log(`    Kept ${relinkReport.localPartsKept} local part(s) (virtual/pending)`);
                }
                if (relinkReport.missingFromZip && relinkReport.missingFromZip.length > 0) {
                  console.log(`    Missing from import: ${relinkReport.missingFromZip.length} part(s)`);
                }
                // Skip release if relink did nothing and parts are missing (bad import)
                if (relinkReport.relinksPerformed === 0 && relinkReport.missingFromZip && relinkReport.missingFromZip.length > 0) {
                  console.log(`    Skipping release — assembly did not import correctly (0 relinks, ${relinkReport.missingFromZip.length} missing parts)`);
                  row.Release = '';
                }
                // Wait for Onshape to finish processing reference updates before continuing
                const refsDelay = 10000; // 10 seconds
                console.log(`    Waiting ${refsDelay / 1000}s for reference updates to complete...`);
                setTimeout(() => {
                  setProperties(row, docId, workId, assemblyElementId, fileName, callback);
                }, refsDelay);
              }
            }
          );
        } else {
          // No relink needed (or no part mapping available yet)
          setProperties(row, docId, workId, assemblyElementId, fileName, callback);
        }
      });
    });
  });
}

// Poll translation status
function pollTranslation(translationId, callback, attempt = 0) {
  const maxAttempts = 60; // 5 minutes at 5-second intervals
  const pollInterval = 5000;

  if (attempt >= maxAttempts) {
    console.error(`  - Translation timeout after ${maxAttempts * pollInterval / 1000} seconds`);
    callback(false, null, 'Timeout after 5 minutes');
    return;
  }

  setTimeout(() => {
    onshape.get({
      path: `/api/translations/${translationId}`
    }, (data, err) => {
      if (err) {
        const errMsg = err.body || err.statusCode || err;
        console.error(`  - Error polling translation: ${errMsg}`);
        callback(false, null, `Poll error: ${errMsg}`);
        return;
      }

      const result = JSON.parse(data.toString());
      const state = result.requestState;

      if (state === 'DONE') {
        callback(true, result, null);
      } else if (state === 'FAILED') {
        const failureReason = result.failureReason || 'Unknown reason';
        console.error(`  - Translation failed: ${failureReason}`);
        callback(false, null, failureReason);
      } else {
        // Still processing
        process.stdout.write('.');
        pollTranslation(translationId, callback, attempt + 1);
      }
    });
  }, pollInterval);
}

// Set properties on element (for assemblies) and optionally release
function setProperties(row, docId, workId, elementId, elementName, callback) {
  const propertiesToUpdate = buildPropertiesArray(row);
  const docName = row['document:name'] || elementName;

  if (propertiesToUpdate.length === 0) {
    afterPropertiesSet();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would set ${propertiesToUpdate.length} properties on element`);
    afterPropertiesSet();
    return;
  }

  console.log(`  - Setting ${propertiesToUpdate.length} properties on element`);
  app.updateProperties(docId, workId, elementId, propertiesToUpdate, (_, updateErr) => {
    if (updateErr) {
      console.error(`  - Error setting element properties: ${updateErr.body || updateErr.statusCode || updateErr}`);
    } else {
      console.log(`  - Element properties updated`);
    }
    afterPropertiesSet();
  });

  function afterPropertiesSet() {
    if (noRelease) {
      console.log(`  - Skipping release (--skip-release)`);
      callback();
      return;
    }
    const releaseMode = (row.Release || '').toString().toLowerCase().trim();
    if (releaseMode === 'yes') {
      // Release just this element
      console.log(`  - Release mode: "yes" → releasing element only`);
      releaseElement(docId, workId, elementId, docName, row, callback);
    } else if (releaseMode === 'document') {
      // Release ALL elements in the document
      console.log(`  - Release mode: "document" → releasing all elements in document`);
      releaseDocument(docId, workId, elementId, docName, row, callback);
    } else {
      if (releaseMode) {
        console.log(`  - Release mode: "${releaseMode}" (unrecognized, skipping release)`);
      }
      callback();
    }
  }
}

// Set properties on parts within a Part Studio (for Level 1 parts) and release all elements
function setPartProperties(row, docId, workId, elementId, elementName, callback) {
  const propertiesToUpdate = buildPropertiesArray(row);
  const docName = row['document:name'] || elementName;

  if (propertiesToUpdate.length === 0) {
    afterPropertiesSet();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would set ${propertiesToUpdate.length} properties on parts`);
    console.log(`  - [DRY RUN] Would set Description on Part Studio element`);
    afterPropertiesSet();
    return;
  }

  // First, set Description on the Part Studio element itself
  const descriptionProp = propertiesToUpdate.find(p => p.propertyId === propertyIdMap['Description']);
  if (descriptionProp) {
    console.log(`  - Setting Description on Part Studio element: "${descriptionProp.value}"`);
    app.updateProperties(docId, workId, elementId, [descriptionProp], (_, elemErr) => {
      if (elemErr) {
        console.error(`  - Error setting Description on Part Studio: ${elemErr.body || elemErr}`);
      } else {
        console.log(`  - Part Studio Description updated`);
      }
      setPropertiesOnParts();
    });
  } else {
    setPropertiesOnParts();
  }

  function setPropertiesOnParts() {
    // Get parts in the Part Studio
    onshape.get({
      path: `/api/parts/d/${docId}/w/${workId}/e/${elementId}`
    }, (partsData, partsErr) => {
      if (partsErr) {
        console.error(`  - Error getting parts: ${partsErr.body || partsErr}`);
        afterPropertiesSet();
        return;
      }

      const parts = JSON.parse(partsData.toString());
      console.log(`  - Found ${parts.length} part(s) in Part Studio`);

      // Store partId(s) in the partMapping for future reference
      const partNumber = row['property:Part number'] || pathModule.parse(elementName).name;
      if (status.partMapping[partNumber]) {
        if (parts.length === 1) {
          status.partMapping[partNumber].partId = parts[0].partId;
          console.log(`  - Stored partId: ${parts[0].partId}`);
        } else if (parts.length > 1) {
          status.partMapping[partNumber].partIds = parts.map(p => ({ partId: p.partId, name: p.name }));
          console.log(`  - Stored ${parts.length} partIds`);
        }
        saveStatus();
      }

      if (parts.length === 0) {
        afterPropertiesSet();
        return;
      }

      // Set properties on each part
      let completed = 0;
      parts.forEach((part) => {
        console.log(`  - Setting properties on part: ${part.name} (${part.partId})`);

        onshape.post({
          path: `/api/metadata/d/${docId}/w/${workId}/e/${elementId}/p/${part.partId}`,
          body: {
            properties: propertiesToUpdate
          }
        }, (_, updateErr) => {
          if (updateErr) {
            console.error(`  - Error setting properties on part ${part.name}: ${updateErr.body || updateErr}`);
          } else {
            console.log(`  - Part ${part.name} properties updated`);
          }

          completed++;
          if (completed === parts.length) {
            afterPropertiesSet();
          }
        });
      });
    });
  }

  function afterPropertiesSet() {
    if (noRelease) {
      console.log(`  - Skipping release (--skip-release)`);
      callback();
      return;
    }
    const releaseMode = (row.Release || '').toString().toLowerCase().trim();
    if (releaseMode === 'yes') {
      // Release just this element
      console.log(`  - Release mode: "yes" → releasing element only`);
      releaseElement(docId, workId, elementId, docName, row, callback);
    } else if (releaseMode === 'document') {
      // Release ALL elements in the document
      console.log(`  - Release mode: "document" → releasing all elements in document`);
      releaseDocument(docId, workId, elementId, docName, row, callback);
    } else {
      if (releaseMode) {
        console.log(`  - Release mode: "${releaseMode}" (unrecognized, skipping release)`);
      }
      callback();
    }
  }
}

// Release a single element
function releaseElement(docId, workId, elementId, docName, rowData, callback) {
  if (!workflowId) {
    console.warn('  - Skipping release: no workflow ID configured');
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would release element: ${elementId}`);
    callback();
    return;
  }

  const rowRevision = rowData['property:Revision'];

  console.log(`  - Creating release package for element: ${elementId}`);

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
      console.error(`  - Failed to create release package: ${createErr.body}`);
      callback();
      return;
    }

    const releasePackage = JSON.parse(createData.toString());
    const rpid = releasePackage.id;

    // Build update payload for the item
    const item = releasePackage.items[0];

    // Get revision from item properties or use row data
    const revisionProp = item.properties?.find(p => p.propertyId === '57f3fb8efa3416c06701d610');
    let revision = revisionProp?.value || rowRevision || '00';
    if (/^\d+$/.test(revision)) {
      revision = String(revision).padStart(2, '0');
    }

    // Get part number from item properties or use element name
    const partNumProp = item.properties?.find(p => p.propertyId === '57f3fb8efa3416c06701d60f');
    const partNumber = partNumProp?.value || rowData['property:Part number'] || docName;

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
      id: rpid,
      href: releasePackage.href,
      documentId: docId,
      workspaceId: workId,
      properties: [
        { propertyId: '594964b7040fc85d2b418138', value: `Auto-release: ${docName}` }
      ],
      items: [updatedItem]
    };

    // Submit release with retry for "pending reference updates" error
    function submitRelease(retryCount) {
      onshape.post({
        path: '/api/releasepackages/' + rpid,
        query: { wfaction: 'CREATE_AND_RELEASE' },
        body: updatePayload
      }, (submitData, submitErr) => {
        if (submitErr) {
          const errBody = submitErr.body || '';
          // Check for "pending reference updates" error
          if (errBody.includes('pending reference updates') && retryCount < PENDING_REFS_MAX_RETRIES) {
            console.log(`  - Assembly has pending reference updates, updating refs and retrying... (attempt ${retryCount + 1}/${PENDING_REFS_MAX_RETRIES})`);
            relink.updateExternalReferences(docId, workId, elementId, () => {
              setTimeout(() => submitRelease(retryCount + 1), PENDING_REFS_RETRY_DELAY);
            });
            return;
          }
          console.error(`  - Failed to release: ${errBody}`);
          logReleaseError(partNumber, docId, elementId, errBody);
          callback();
        } else {
          const result = JSON.parse(submitData.toString());
          if (result.workflow?.state?.name === 'RELEASED') {
            console.log(`  - Released element: ${elementId}`);

            // Capture versionId and store in partMapping or assemblyMapping
            const releasedItem = result.items?.[0];
            if (releasedItem?.versionId) {
              const pn = partNumber;
              if (status.partMapping[pn]) {
                status.partMapping[pn].versionId = releasedItem.versionId;
                if (releasedItem.revisionId) status.partMapping[pn].revisionId = releasedItem.revisionId;
                console.log(`  - Stored release versionId for part ${pn}: ${releasedItem.versionId}`);
              } else if (status.assemblyMapping[pn]) {
                status.assemblyMapping[pn].versionId = releasedItem.versionId;
                if (releasedItem.revisionId) status.assemblyMapping[pn].revisionId = releasedItem.revisionId;
                console.log(`  - Stored release versionId for assembly ${pn}: ${releasedItem.versionId}`);
                // Clickable link for assembly
                const url = `https://energyrecovery.onshape.com/documents/${docId}/v/${releasedItem.versionId}/e/${elementId}`;
                console.log(`  - \x1b]8;;${url}\x07Open in Onshape\x1b]8;;\x07`);
              }
              saveStatus();

              // Update ASMREF with released IDs (for Level 2+ assemblies)
              const uploadLevel = parseInt(rowData.uploadLevel) || 0;
              if (asmrefData && asmrefPath && uploadLevel >= 2 && pn) {
                const updateCount = asmref.updateIds(asmrefData, pn, {
                  documentId: docId,
                  workspaceId: workId,
                  elementId: elementId,
                  versionId: releasedItem.versionId
                });
                if (updateCount > 0) {
                  asmref.save(asmrefData, asmrefPath);
                  console.log(`  - Updated asmref.json: ${pn} -> ${updateCount} entries`);
                }
              }
            }
          } else {
            console.log(`  - Release state: ${result.workflow?.state?.name}`);
          }
          callback();
        }
      });
    }

    submitRelease(0);
  });
}

// Build properties array from row
function buildPropertiesArray(row) {
  const propertiesToUpdate = [];
  for (const key in row) {
    if (key.startsWith('property:')) {
      const propertyName = key.split(':')[1];
      const propertyId = propertyIdMap[propertyName];
      let value = row[key];

      // Check for propertyId and non-empty value (including 0)
      if (propertyId && value !== null && value !== undefined && value !== '') {
        // Skip Material if value is 0 or blank (Material requires a valid material reference)
        if (propertyName === 'Material' && (value === 0 || value === '0' || value === '')) {
          continue;
        }
        // Convert numbers to strings (Onshape metadata API expects strings)
        if (typeof value === 'number') {
          value = String(value);
        }
        // Pad Revision to 2 digits (0 -> 00, 1 -> 01, etc.)
        if (propertyName === 'Revision' && /^\d+$/.test(value)) {
          value = value.padStart(2, '0');
        }
        propertiesToUpdate.push({
          propertyId: propertyId,
          value: value
        });
      }
    }
  }
  return propertiesToUpdate;
}

// Release all elements in a document at once
function releaseDocument(docId, workId, _primaryElementId, docName, rowData, callback) {
  if (!workflowId) {
    console.warn('  - Skipping release: no workflow ID configured');
    callback();
    return;
  }

  if (dryRun) {
    console.log(`  - [DRY RUN] Would release all elements in document: ${docName}`);
    callback();
    return;
  }

  const rowRevision = rowData['property:Revision'];

  // First, get all elements in the document
  console.log(`  - Getting all elements in document for release...`);
  app.getElements(docId, workId, (elementsData, elemErr) => {
    if (elemErr) {
      console.error(`  - Failed to get elements: ${elemErr.body || elemErr}`);
      callback();
      return;
    }

    const allElements = JSON.parse(elementsData.toString());

    // Filter out BOM elements - they are auto-generated by Onshape and cannot be released
    const elements = allElements.filter(e => e.elementType !== 'BILLOFMATERIALS');
    const skippedBoms = allElements.length - elements.length;
    if (skippedBoms > 0) {
      console.log(`  - Skipping ${skippedBoms} BOM element(s) (cannot be released)`);
    }

    if (elements.length === 0) {
      console.log(`  - No elements to release`);
      callback();
      return;
    }

    console.log(`  - Creating release package for ${elements.length} element(s): ${docName}`);

    // Build items array for all elements (excluding BOMs)
    const releaseItems = elements.map(elem => ({
      elementId: elem.id,
      documentId: docId,
      workspaceId: workId
    }));

    onshape.post({
      path: '/api/releasepackages/release/' + workflowId,
      query: { cid: COMPANY_ID },
      body: { items: releaseItems }
    }, (createData, createErr) => {
      if (createErr) {
        console.error(`  - Failed to create release package: ${createErr.body}`);
        callback();
        return;
      }

      const releasePackage = JSON.parse(createData.toString());
      const rpid = releasePackage.id;

      // Debug: show what items are in the release package
      console.log(`  - Release package has ${releasePackage.items?.length || 0} items:`);
      releasePackage.items?.forEach(item => {
        const isExternal = item.documentId !== docId;
        console.log(`      ${item.elementId} (doc: ${item.documentId?.substring(0,8)}...) ${isExternal ? '[EXTERNAL]' : ''}`);
      });

      // Build update payload for all items
      const updatedItems = releasePackage.items.map(item => {
        // Find the element info to get the name
        const elemInfo = elements.find(e => e.id === item.elementId);
        const elemName = elemInfo?.name || '';

        // Get revision from item properties or use row data
        const revisionProp = item.properties?.find(p => p.propertyId === '57f3fb8efa3416c06701d610');
        let revision = revisionProp?.value || rowRevision || '00';
        if (/^\d+$/.test(revision)) {
          revision = String(revision).padStart(2, '0');
        }

        // Get part number from item properties or use element name
        const partNumProp = item.properties?.find(p => p.propertyId === '57f3fb8efa3416c06701d60f');
        const partNumber = partNumProp?.value || elemName.replace(/\.[^/.]+$/, '');

        return {
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
      });

      const updatePayload = {
        id: rpid,
        href: releasePackage.href,
        documentId: docId,
        workspaceId: workId,
        properties: [
          { propertyId: '594964b7040fc85d2b418138', value: `Auto-release: ${docName}` }
        ],
        items: updatedItems
      };

      // Helper to update external references for all elements
      function updateAllElementRefs(idx, cb) {
        if (idx >= elements.length) {
          cb();
          return;
        }
        relink.updateExternalReferences(docId, workId, elements[idx].id, () => {
          updateAllElementRefs(idx + 1, cb);
        });
      }

      // Submit release with retry for "pending reference updates" error
      function submitRelease(retryCount) {
        onshape.post({
          path: '/api/releasepackages/' + rpid,
          query: { wfaction: 'CREATE_AND_RELEASE' },
          body: updatePayload
        }, (submitData, submitErr) => {
          if (submitErr) {
            const errBody = submitErr.body || '';
            // Check for "pending reference updates" error
            if (errBody.includes('pending reference updates') && retryCount < PENDING_REFS_MAX_RETRIES) {
              console.log(`  - Assembly has pending reference updates, updating refs and retrying... (attempt ${retryCount + 1}/${PENDING_REFS_MAX_RETRIES})`);
              updateAllElementRefs(0, () => {
                setTimeout(() => submitRelease(retryCount + 1), PENDING_REFS_RETRY_DELAY);
              });
              return;
            }
            console.error(`  - Failed to release: ${errBody}`);
            logReleaseError(docName, docId, null, errBody);
            callback();
          } else {
            const result = JSON.parse(submitData.toString());
            if (result.workflow?.state?.name === 'RELEASED') {
              console.log(`  - Released ${result.items?.length || 0} element(s) in document: ${docName}`);

              // Capture versionId from released items and store in partMapping or assemblyMapping
              const uploadLevel = parseInt(rowData.uploadLevel) || 0;
              result.items?.forEach(releasedItem => {
                const partNumProp = releasedItem.properties?.find(p => p.propertyId === '57f3fb8efa3416c06701d60f');
                const partNumber = partNumProp?.value;
                if (releasedItem.versionId && partNumber) {
                  // Check partMapping first, then assemblyMapping
                  if (status.partMapping[partNumber]) {
                    status.partMapping[partNumber].versionId = releasedItem.versionId;
                    if (releasedItem.revisionId) status.partMapping[partNumber].revisionId = releasedItem.revisionId;
                    console.log(`  - Stored release versionId for part ${partNumber}: ${releasedItem.versionId}`);
                  } else if (status.assemblyMapping[partNumber]) {
                    status.assemblyMapping[partNumber].versionId = releasedItem.versionId;
                    if (releasedItem.revisionId) status.assemblyMapping[partNumber].revisionId = releasedItem.revisionId;
                    console.log(`  - Stored release versionId for assembly ${partNumber}: ${releasedItem.versionId}`);
                    // Clickable link for assembly
                    const relDocId = releasedItem.documentId || docId;
                    const relElemId = releasedItem.elementId;
                    const url = `https://energyrecovery.onshape.com/documents/${relDocId}/v/${releasedItem.versionId}/e/${relElemId}`;
                    console.log(`  - \x1b]8;;${url}\x07Open in Onshape\x1b]8;;\x07`);
                  }

                  // Update ASMREF with released IDs (for Level 2+ assemblies)
                  if (asmrefData && asmrefPath && uploadLevel >= 2) {
                    const updateCount = asmref.updateIds(asmrefData, partNumber, {
                      documentId: releasedItem.documentId || docId,
                      workspaceId: releasedItem.workspaceId || workId,
                      elementId: releasedItem.elementId,
                      versionId: releasedItem.versionId
                    });
                    if (updateCount > 0) {
                      console.log(`  - Updated asmref.json: ${partNumber} -> ${updateCount} entries`);
                    }
                  }
                }
              });
              saveStatus();

              // Save ASMREF after processing all items (batch save)
              if (asmrefData && asmrefPath && uploadLevel >= 2) {
                asmref.save(asmrefData, asmrefPath);
              }
            } else {
              console.log(`  - Release state: ${result.workflow?.state?.name}`);
            }
            callback();
          }
        });
      }

      submitRelease(0);
    });
  });
}

// Log release error to separate file for analysis
function logReleaseError(partNumber, docId, elementId, errorMessage) {
  releaseErrors.push({
    timestamp: new Date().toISOString(),
    partNumber,
    documentId: docId,
    elementId,
    error: errorMessage
  });
  fs.writeFileSync(RELEASE_ERRORS_FILE, JSON.stringify(releaseErrors, null, 2));
}

// Update file status
function updateFileStatus(filePath, uploadStatus, error, docId, workId, elementId) {
  status.fileStatus[filePath] = {
    status: uploadStatus,
    timestamp: new Date().toISOString(),
    error: error,
    documentId: docId,
    workspaceId: workId,
    elementId: elementId
  };
  saveStatus();
}

// Normalize Windows file paths
function normalizeFilePath(filePath) {
  if (!filePath) return '';
  // Convert backslashes to forward slashes on non-Windows platforms
  return filePath.replace(/\\/g, '/');
}

// Process a single row
function processRow(row, callback) {
  const filePath = row.filePath || row.zipPath;  // Use zipPath for assemblies
  const uploadLevel = parseInt(row.uploadLevel) || 0;
  const docName = row['document:name'];
  const folderName = row.folder || '';
  const directFolderId = row['onshape:folderId'] || '';  // Direct folder ID bypasses name lookup

  // Get display name - prefer filename column, then extract from path
  const displayName = row.filename || (filePath ? pathModule.basename(filePath) : 'unknown');

  console.log(`\nProcessing: ${displayName} (Level ${uploadLevel})`);

  // Check if already uploaded (use filename as key for consistency)
  const statusKey = row.filename || filePath;
  const fileStatus = status.fileStatus[statusKey];
  if (fileStatus?.status === 'uploaded') {
    console.log(`  - Already uploaded, skipping`);
    callback();
    return;
  }

  // Use direct folder ID if provided, otherwise lookup by name
  if (directFolderId) {
    console.log(`  - Using direct folder ID: ${directFolderId}`);
    proceedWithFolder(directFolderId);
  } else {
    ensureFolder(folderName, DEFAULT_FOLDER_ID, proceedWithFolder);
  }

  function proceedWithFolder(folderId) {
    // Ensure document exists - prefer Excel IDs over search/create
    const directDocId = row['onshape:documentId'] || '';
    const directWsId = row['onshape:workspaceId'] || '';
    ensureDocument(docName, folderId, directDocId, directWsId, (docInfo) => {
      if (!docInfo) {
        console.error(`  - Skipping: could not ensure document exists`);
        updateFileStatus(filePath, 'failed', 'Could not create or find document');
        callback();
        return;
      }
      const { documentId, workspaceId } = docInfo;

      // Route to appropriate upload method
      if (uploadLevel === 0) {
        uploadBlob(row, documentId, workspaceId, callback);
      } else if (uploadLevel === 1) {
        uploadPart(row, documentId, workspaceId, callback);
      } else {
        uploadAssembly(row, documentId, workspaceId, callback);
      }
    });
  }
}

// Main processing function
function processExcelFile(excelFilePath, filterLevel) {
  console.log(`Reading Excel file: ${excelFilePath}`);

  const workbook = xlsx.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  if (data.length === 0) {
    console.error('Excel file is empty.');
    return;
  }

  // Filter and sort by uploadLevel
  let rows = data;
  if (filterLevel !== null) {
    rows = rows.filter(r => parseInt(r.uploadLevel) === filterLevel);
    console.log(`Filtered to ${rows.length} rows with uploadLevel=${filterLevel}`);
  }

  rows.sort((a, b) => {
    const levelA = parseInt(a.uploadLevel) || 0;
    const levelB = parseInt(b.uploadLevel) || 0;
    return levelA - levelB;
  });

  console.log(`Processing ${rows.length} rows...`);

  // Process sequentially
  let index = 0;
  function processNext() {
    // If cancel confirmation is pending, wait for user response
    if (cancelConfirmPending) {
      setTimeout(processNext, 500);
      return;
    }

    // If slow-run is paused, wait for user response
    if (slowRunPaused) {
      setTimeout(processNext, 100);
      return;
    }

    if (index >= rows.length) {
      console.log('\n=== Upload Complete ===');
      console.log(`Status saved to: ${statusFile}`);

      // Export updated Excel with Onshape IDs
      exportUpdatedExcel(excelFilePath, data);

      // Cleanup stdin handlers
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
      return;
    }

    const row = rows[index];
    index++;

    processRow(row, () => {
      // Delay between uploads based on level
      const uploadLevel = parseInt(row.uploadLevel) || 0;
      const delay = uploadLevel === 0 ? 100 : (uploadLevel === 1 ? 500 : 1000);

      // Slow-run: prompt after each file
      if (slowRun && index < rows.length) {
        setTimeout(() => {
          slowRunPaused = true;
          process.stdout.write(`\nContinue? (y=yes, n=stop, f=fast): `);
          processNext();
        }, delay);
      } else {
        setTimeout(processNext, delay);
      }
    });
  }

  processNext();
}

// Export updated Excel file with Onshape document/element IDs
function exportUpdatedExcel(inputPath, data) {
  // Update each row with status from fileStatus
  data.forEach(row => {
    const filePath = row.filePath;
    const zipPath = row.zipPath;
    const filename = row.filename;

    // Try to find status by various keys (zipPath for assemblies, filePath for parts, filename as fallback)
    const fileStatus = status.fileStatus[zipPath] || status.fileStatus[filePath] || status.fileStatus[filename];

    if (fileStatus) {
      row.uploadStatus = fileStatus.status || 'pending';
      row['onshape:documentId'] = fileStatus.documentId || '';
      row['onshape:workspaceId'] = fileStatus.workspaceId || '';
      row['onshape:elementId'] = fileStatus.elementId || '';
    }

    // Also check partMapping and assemblyMapping for versionId and partId
    const partNumber = row['property:Part number'] || pathModule.parse(filename || '').name;
    if (status.partMapping[partNumber]) {
      if (status.partMapping[partNumber].versionId) {
        row['onshape:versionId'] = status.partMapping[partNumber].versionId;
      }
      if (status.partMapping[partNumber].revisionId) {
        row['onshape:revisionId'] = status.partMapping[partNumber].revisionId;
      }
      if (status.partMapping[partNumber].partId) {
        row['onshape:partId'] = status.partMapping[partNumber].partId;
      } else if (status.partMapping[partNumber].partIds) {
        // Multiple parts - store as comma-separated list
        row['onshape:partId'] = status.partMapping[partNumber].partIds.map(p => p.partId).join(',');
      }
    } else if (status.assemblyMapping[partNumber]?.versionId) {
      row['onshape:versionId'] = status.assemblyMapping[partNumber].versionId;
      if (status.assemblyMapping[partNumber].revisionId) {
        row['onshape:revisionId'] = status.assemblyMapping[partNumber].revisionId;
      }
    }
  });

  // Generate output filename
  const ext = pathModule.extname(inputPath);
  const base = pathModule.basename(inputPath, ext);
  const dir = pathModule.dirname(inputPath);
  const outputPath = pathModule.join(dir, `${base}_completed${ext}`);

  // Write updated Excel
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, outputPath);

  console.log(`Updated Excel exported to: ${outputPath}`);
}

// Show usage
function showUsage() {
  console.log('\nUnified Upload - Excel-driven Onshape migration tool\n');
  console.log('Usage: node unifiedUpload.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>       Input Excel file (default: Upload/Onshape_Upload_List.xlsx)');
  console.log('  -s <path>       Status JSON file (default: Upload/upload_status.json)');
  console.log('  -f <folderId>   Default folder ID (default: from config)');
  console.log('  --asmref <path> ASMREF JSON file for assembly relink (default: output/asmref.json if exists)');
  console.log('  --dry-run       Show what would happen without uploading');
  console.log('  --slow-run      Prompt (y/n/f) after each file');
  console.log('  --resume        Skip files already marked uploaded (default)');
  console.log('  --level N       Only process specific uploadLevel (0, 1, 2, etc.)');
  console.log('  --skip-release  Upload and relink but skip release step');
  console.log('  -h, --help      Show this help\n');
  console.log('Excel columns expected:');
  console.log('  uploadLevel       0=non-CAD, 1=parts, 2+=assemblies');
  console.log('  document:name     Onshape document name');
  console.log('  folder            Target folder name (optional, searches/creates by name)');
  console.log('  onshape:folderId  Target folder ID (optional, bypasses name lookup)');
  console.log('  filePath          Local file path');
  console.log('  zipPath           Pack & Go ZIP path (for assemblies)');
  console.log('  Release           "yes" = release element, "Document" = release all in doc');
  console.log('  property:*        Metadata to set\n');
  console.log('Workflow:');
  console.log('  1. Level 0: Upload non-CAD files (PDFs, Excel, etc.) as blobs');
  console.log('  2. Level 1: Upload parts (SLDPRT) - stored in partMapping for relink');
  console.log('  3. Level 2+: Upload assemblies (ZIP) - automatically relinked to master parts');
  console.log('');
  console.log('ASMREF mode:');
  console.log('  Auto-loads output/asmref.json if it exists. Override with --asmref <path>.');
  console.log('  Generate with: node convertAsmrefToJson.js -i output/ASMREF.xlsx -o output/asmref.json');
  console.log('  ASMREF provides explicit mapping of assembly components to master parts.\n');
}

// Main
function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const excelFile = argv.i || 'Upload/Onshape_Upload_List.xlsx';
  statusFile = argv.s || 'Upload/upload_status.json';
  dryRun = argv['dry-run'] || false;
  slowRun = argv['slow-run'] || false;
  noRelease = argv['skip-release'] || false;
  const filterLevel = argv.level !== undefined ? parseInt(argv.level) : null;

  // Override default folder ID if provided via -f flag
  if (argv.f) {
    DEFAULT_FOLDER_ID = argv.f;
    console.log(`Using folder ID from -f flag: ${DEFAULT_FOLDER_ID}`);
  }

  if (!fs.existsSync(excelFile)) {
    console.error(`Excel file not found: ${excelFile}`);
    process.exit(1);
  }

  // Load ASMREF — default to output/asmref.json
  const defaultAsmref = pathModule.join(__dirname, 'output', 'asmref.json');
  asmrefPath = argv.asmref || (fs.existsSync(defaultAsmref) ? defaultAsmref : null);
  if (asmrefPath) {
    if (!fs.existsSync(asmrefPath)) {
      console.error(`ASMREF file not found: ${asmrefPath}`);
      process.exit(1);
    }
    asmrefData = asmref.load(asmrefPath);
    if (!asmrefData) {
      console.error(`Failed to load ASMREF file: ${asmrefPath}`);
      process.exit(1);
    }
    const stats = asmref.getStats(asmrefData);
    console.log(`ASMREF loaded: ${stats.uniqueEntries} entries from ${Object.keys(asmrefData).length} assemblies`);
    console.log(`ASMREF: ${stats.uniqueEntries} entries, ${stats.withIds} with IDs, ${stats.withoutIds} pending`);
  }

  // Load status
  status = loadStatus(statusFile);
  console.log(`Status file: ${statusFile}`);
  console.log(`Default folder ID: ${DEFAULT_FOLDER_ID}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Release: controlled by "Release" column (yes/Document)`);

  // Setup cancel handlers (Ctrl+C and 'q')
  setupCancelHandlers();

  // Get workflow ID for releasing (needed when Release column has values)
  if (!dryRun) {
    console.log('Fetching workflow ID...');
    app.getCompanyPolicies(COMPANY_ID, (policiesData) => {
      const policies = JSON.parse(policiesData.toString());
      workflowId = policies.releaseWorkflowId;
      if (workflowId) {
        console.log(`Workflow ID: ${workflowId}\n`);
      } else {
        console.warn('Warning: No release workflow found.\n');
      }
      processExcelFile(excelFile, filterLevel);
    });
  } else {
    processExcelFile(excelFile, filterLevel);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  processExcelFile,
  loadStatus,
  saveStatus,
  uploadPart,
  uploadAssembly,
  uploadBlob,
  buildPropertiesArray,
  pollTranslation,
  propertyIdMap,
  COMPANY_ID
};
