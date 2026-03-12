/**
 * Re-upload assembly ZIPs into existing documents where elements were deleted.
 * Uploads one at a time, polls translation, records new element IDs back to Excel.
 *
 * Usage: node reuploadAssemblies.js -i ../Current/level2last_reupload.xlsx
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const minimist = require('minimist');
const onshape = require('./lib/onshape');

const argv = minimist(process.argv.slice(2));
const inputPath = argv.i || '../Current/level2last_reupload.xlsx';

if (!fs.existsSync(inputPath)) {
  console.error('Input file not found:', inputPath);
  process.exit(1);
}

function normalizeFilePath(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/');
}

function pollTranslation(translationId, callback, attempt) {
  attempt = attempt || 0;
  const maxAttempts = 120; // 10 minutes
  const pollInterval = 5000;

  if (attempt >= maxAttempts) {
    callback(false, null, 'Timeout');
    return;
  }

  setTimeout(() => {
    onshape.get({
      path: '/api/translations/' + translationId
    }, (data, err) => {
      if (err) {
        callback(false, null, 'Poll error: ' + (err.statusCode || err));
        return;
      }
      const result = JSON.parse(data.toString());
      if (result.requestState === 'DONE') {
        callback(true, result);
      } else if (result.requestState === 'FAILED') {
        callback(false, null, result.failureReason || 'Unknown');
      } else {
        process.stdout.write('.');
        pollTranslation(translationId, callback, attempt + 1);
      }
    });
  }, pollInterval);
}

// Read Excel
const wb = xlsx.readFile(inputPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws);

console.log('Assemblies to re-upload:', rows.length);
console.log('');

let idx = 0;
let success = 0;
let failed = 0;

function processNext() {
  if (idx >= rows.length) {
    console.log('\n=== Done ===');
    console.log('Success:', success);
    console.log('Failed:', failed);

    // Save updated Excel
    const outPath = inputPath.replace('.xlsx', '_completed.xlsx');
    const newWs = xlsx.utils.json_to_sheet(rows);
    const newWb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newWb, newWs, 'Sheet1');
    xlsx.writeFile(newWb, outPath);
    console.log('Saved:', outPath);
    return;
  }

  const row = rows[idx];
  const fileName = row['File Name'];
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const zipPath = normalizeFilePath(row['zipPath']);

  console.log('[' + (idx + 1) + '/' + rows.length + '] ' + fileName);

  if (!docId || !workId) {
    console.log('  SKIP - no document/workspace ID');
    failed++;
    idx++;
    processNext();
    return;
  }

  if (!zipPath || !fs.existsSync(zipPath)) {
    console.log('  SKIP - ZIP not found: ' + zipPath);
    row['Check'] = 'ZIP not found';
    failed++;
    idx++;
    processNext();
    return;
  }

  console.log('  Uploading: ' + path.basename(zipPath) + ' -> doc ' + docId);

  onshape.upload({
    path: '/api/v6/translations/d/' + docId + '/w/' + workId,
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
      const errMsg = uploadErr ? (uploadErr.body || uploadErr.statusCode || uploadErr) : 'No response';
      console.log('  UPLOAD FAILED: ' + errMsg);
      row['Check'] = 'Upload failed: ' + errMsg;
      failed++;
      idx++;
      setTimeout(processNext, 1000);
      return;
    }

    const translationResult = JSON.parse(uploadData.toString());
    const translationId = translationResult.id;
    console.log('  Translation started: ' + translationId);

    pollTranslation(translationId, (ok, result, reason) => {
      if (!ok) {
        console.log('\n  TRANSLATION FAILED: ' + reason);
        row['Check'] = 'Translation failed: ' + reason;
        failed++;
        idx++;
        setTimeout(processNext, 1000);
        return;
      }

      const elementIds = result.resultElementIds || [];
      console.log('\n  Translation complete. Elements: ' + elementIds.length);

      // Get elements to find the assembly
      onshape.get({
        path: '/api/documents/d/' + docId + '/w/' + workId + '/elements'
      }, (elemData, elemErr) => {
        if (elemErr) {
          console.log('  ERROR getting elements: ' + (elemErr.statusCode || elemErr));
          row['Check'] = 'Error getting elements';
          failed++;
          idx++;
          setTimeout(processNext, 1000);
          return;
        }

        const elements = JSON.parse(elemData.toString());
        // Find assembly elements from the translation result
        const newElements = elements.filter(e => elementIds.includes(e.id));
        const assemblyElem = newElements.find(e => e.type === 'Assembly');
        const partStudios = newElements.filter(e => e.type === 'Part Studio').map(e => e.id);
        const subAssemblies = newElements.filter(e => e.type === 'Assembly' && e.id !== (assemblyElem ? assemblyElem.id : null)).map(e => e.id);

        if (assemblyElem) {
          console.log('  Assembly element: ' + assemblyElem.id + ' (' + assemblyElem.name + ')');
          row['onshape:elementId'] = assemblyElem.id;
          row['Uploaded'] = true;
          row['Check'] = 'OK - ' + elementIds.length + ' elements';
          if (partStudios.length > 0) console.log('  Part Studios: ' + partStudios.length);
          if (subAssemblies.length > 0) console.log('  Sub-assemblies: ' + subAssemblies.length);
          success++;
        } else {
          console.log('  WARNING: No assembly element found in translation results');
          console.log('  Elements:', elements.map(e => e.name + ' (' + e.type + ')').join(', '));
          row['Check'] = 'No assembly element in result';
          failed++;
        }

        // Save progress after each row
        const outPath = inputPath.replace('.xlsx', '_completed.xlsx');
        const newWs = xlsx.utils.json_to_sheet(rows);
        const newWb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWb, newWs, 'Sheet1');
        xlsx.writeFile(newWb, outPath);

        idx++;
        setTimeout(processNext, 1000);
      });
    });
  });
}

processNext();
