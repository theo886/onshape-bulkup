/**
 * Test script: Upload 40009.zip to a personal document WITHOUT relink.
 * Prints the Onshape URL for visual inspection of pre-relink orientation.
 *
 * Purpose: Verify that 43006's orientation in 40009 looks correct before
 * relink. If it does, relink is the culprit for the 90° rotation bug.
 *
 * Usage: cd Node && node one-off/testImportOrientation.js
 */

const fs = require('fs');
const onshape = require('../lib/onshape.js');

const ZIP_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40009.zip';

if (!fs.existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}

// ─── Step 1: Create personal document ───
console.log('Creating personal test document...');
onshape.post({
  path: '/api/documents',
  body: {
    name: 'TEST-ORIENTATION-40009-' + new Date().toISOString().slice(0, 16)
  }
}, (docData, docErr) => {
  if (docErr) {
    console.error('Failed to create document:', docErr.body || docErr);
    process.exit(1);
  }

  const doc = JSON.parse(docData.toString());
  const docId = doc.id;
  const workId = doc.defaultWorkspace?.id;
  console.log('Document:', docId);
  console.log('Workspace:', workId);

  // ─── Step 2: Upload ZIP (same params as production) ───
  console.log('Uploading 40009.zip...');
  onshape.upload({
    path: '/api/v6/translations/d/' + docId + '/w/' + workId,
    file: ZIP_PATH,
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
    if (uploadErr) {
      console.error('Upload failed:', uploadErr.body || uploadErr);
      process.exit(1);
    }

    const translation = JSON.parse(uploadData.toString());
    console.log('Translation started:', translation.id);
    console.log('Polling...');

    // ─── Step 3: Poll until done ───
    pollTranslation(translation.id, (ok, result, reason) => {
      if (!ok) {
        console.error('Translation failed:', reason);
        process.exit(1);
      }

      console.log('\nTranslation complete.');
      console.log('');
      console.log('=== VISUAL INSPECTION URL ===');
      console.log('https://energyrecovery.onshape.com/documents/' + docId);
      console.log('');
      console.log('Open this URL and compare 43006 orientation with SolidWorks.');
      console.log('If 43006 aligns correctly → relink causes the 90° rotation.');
      console.log('If 43006 is already wrong → ZIP import is the culprit.');
      console.log('');
      console.log('Delete the document when done testing.');
      process.exit(0);
    });
  });
});

function pollTranslation(translationId, callback, attempt) {
  attempt = attempt || 0;
  const maxAttempts = 120;
  const pollInterval = 5000;

  if (attempt >= maxAttempts) {
    callback(false, null, 'Timeout after ' + (maxAttempts * pollInterval / 1000) + 's');
    return;
  }

  setTimeout(() => {
    onshape.get({
      path: '/api/translations/' + translationId
    }, (data, err) => {
      if (err) {
        callback(false, null, 'Poll error: ' + (err.body || err));
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
