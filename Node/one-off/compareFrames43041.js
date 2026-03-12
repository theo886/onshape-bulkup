/**
 * Compare internal coordinate frames of master 43041 vs local 43041 (from 40010.zip).
 * Same approach as compareFrames43006.js but for a different assembly pair.
 *
 * Usage: cd Node && node one-off/compareFrames43041.js
 */

const fs = require('fs');
const onshape = require('../lib/onshape.js');

// Master 43041 (from ASMREF)
const MASTER = {
  documentId: '7a2538e03a95f4227e2d7d7e',
  versionId: 'd21903208ad27bf1c5d68fd3',
  elementId: '862fa2fb31624a57a9f166b5'
};

const ZIP_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40010.zip';

if (!fs.existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}

// ─── Step 1: Get master 43041 assembly definition ───
console.log('=== Fetching MASTER 43041 assembly definition ===');
onshape.get({
  path: `/api/assemblies/d/${MASTER.documentId}/v/${MASTER.versionId}/e/${MASTER.elementId}`,
  query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
}, (masterData, masterErr) => {
  if (masterErr) { console.error('Failed:', masterErr.body || masterErr); process.exit(1); }

  const masterDef = JSON.parse(masterData.toString());
  const masterInstances = masterDef.rootAssembly?.instances || [];
  const masterOccurrences = masterDef.rootAssembly?.occurrences || [];
  console.log(`  ${masterInstances.length} instances, ${masterOccurrences.length} occurrences\n`);

  // ─── Step 2: Upload fresh 40010 ZIP ───
  console.log('=== Uploading fresh 40010.zip for local 43041 ===');
  onshape.post({
    path: '/api/documents',
    body: { name: 'TEST-FRAMES-43041-' + new Date().toISOString().slice(0, 16) }
  }, (docData, docErr) => {
    if (docErr) { console.error('Failed:', docErr.body || docErr); process.exit(1); }

    const doc = JSON.parse(docData.toString());
    const localDocId = doc.id;
    const workId = doc.defaultWorkspace?.id;
    console.log(`  Document: ${localDocId}`);

    onshape.upload({
      path: '/api/v6/translations/d/' + localDocId + '/w/' + workId,
      file: ZIP_PATH,
      mimeType: 'application/zip',
      body: {
        allowFaultyParts: true, createComposite: true,
        createDrawingIfPossible: false, flattenAssemblies: false,
        yAxisIsUp: true, storeInDocument: true,
        importWithinDocument: true, splitAssembliesIntoMultipleDocuments: false
      }
    }, (uploadData, uploadErr) => {
      if (uploadErr) { console.error('Upload failed:', uploadErr.body || uploadErr); process.exit(1); }

      const translation = JSON.parse(uploadData.toString());
      console.log('  Translation:', translation.id);

      pollTranslation(translation.id, (ok, _result, reason) => {
        if (!ok) { console.error('Translation failed:', reason); process.exit(1); }
        console.log('  Upload complete.\n');

        onshape.get({
          path: `/api/documents/d/${localDocId}/w/${workId}/elements`
        }, (elemData) => {
          const elements = JSON.parse(elemData.toString());
          const local43041 = elements.find(e =>
            e.type === 'Assembly' && e.name.includes('43041')
          );

          if (!local43041) {
            console.log('Available elements:');
            elements.forEach(e => console.log(`  ${e.type}: ${e.name} (${e.id})`));
            console.error('\n43041 assembly not found!');
            process.exit(1);
          }

          console.log(`  Found: ${local43041.name} (${local43041.id})\n`);

          console.log('=== Fetching LOCAL 43041 assembly definition ===');
          onshape.get({
            path: `/api/assemblies/d/${localDocId}/w/${workId}/e/${local43041.id}`,
            query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
          }, (localData, localErr) => {
            if (localErr) { console.error('Failed:', localErr.body || localErr); process.exit(1); }

            const localDef = JSON.parse(localData.toString());
            const localInstances = localDef.rootAssembly?.instances || [];
            const localOccurrences = localDef.rootAssembly?.occurrences || [];
            console.log(`  ${localInstances.length} instances, ${localOccurrences.length} occurrences\n`);

            compareDefinitions(masterInstances, masterOccurrences, localInstances, localOccurrences);

            console.log(`\nTest document (delete when done):`);
            console.log(`https://energyrecovery.onshape.com/documents/${localDocId}`);
          });
        });
      });
    });
  });
});

function compareDefinitions(masterInst, masterOcc, localInst, localOcc) {
  console.log('=== COMPARISON ===\n');

  const masterOccById = {};
  masterOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) masterOccById[occ.path[0]] = occ;
  });

  const localOccById = {};
  localOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) localOccById[occ.path[0]] = occ;
  });

  // Match by name
  const localByName = {};
  localInst.forEach(inst => {
    const clean = inst.name.replace(/\s*<\d+>$/, '').replace(/\s*\(\d+\)$/, '');
    if (!localByName[clean]) localByName[clean] = [];
    localByName[clean].push(inst);
  });

  const masterByName = {};
  masterInst.forEach(inst => {
    const clean = inst.name.replace(/\s*<\d+>$/, '').replace(/\s*\(\d+\)$/, '');
    if (!masterByName[clean]) masterByName[clean] = [];
    masterByName[clean].push(inst);
  });

  const allNames = new Set([...Object.keys(masterByName), ...Object.keys(localByName)]);
  let rotationDiffs = [];
  let matchCount = 0;

  console.log('TRANSFORM COMPARISON:');
  console.log('─'.repeat(80));

  for (const name of [...allNames].sort()) {
    const mList = masterByName[name] || [];
    const lList = localByName[name] || [];

    if (mList.length > 0 && lList.length > 0) {
      const mOcc = masterOccById[mList[0].id];
      const lOcc = localOccById[lList[0].id];

      if (mOcc?.transform && lOcc?.transform) {
        const mRot = extractRotation(mOcc.transform);
        const lRot = extractRotation(lOcc.transform);
        const rotMatch = matricesMatch(mRot, lRot, 0.01);

        if (rotMatch) {
          console.log(`   ${name}: SAME rotation`);
          matchCount++;
        } else {
          const diff = multiplyRotations(mRot, transposeRotation(lRot));
          const angle = rotationAngle(diff);
          console.log(`** ${name}: ROT DIFFERS by ${(angle * 180 / Math.PI).toFixed(1)}°`);
          console.log(`     Difference: [${diff.map(v => v.toFixed(4)).join(', ')}]`);
          rotationDiffs.push({ name, angle, diff });
        }
      }
    } else {
      const side = mList.length > 0 ? 'MASTER only' : 'LOCAL only';
      console.log(`   ${name}: ${side}`);
    }
  }

  console.log('─'.repeat(80));
  console.log('');
  console.log(`Matching rotations: ${matchCount}`);
  console.log(`Different rotations: ${rotationDiffs.length}`);

  if (rotationDiffs.length > 0) {
    console.log('\nRotation differences:');
    rotationDiffs.forEach(d => {
      console.log(`  ${d.name}: ${(d.angle * 180 / Math.PI).toFixed(1)}°`);
    });
  } else {
    console.log('\nNo rotation differences — master and local 43041 have SAME frame.');
    console.log('This means 43041 relinks correctly (no orientation bug).');
  }
}

function extractRotation(t) {
  return [t[0], t[1], t[2], t[4], t[5], t[6], t[8], t[9], t[10]];
}

function matricesMatch(a, b, tol) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

function transposeRotation(r) {
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
}

function multiplyRotations(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
      }
    }
  }
  return r;
}

function rotationAngle(r) {
  const trace = r[0] + r[4] + r[8];
  const cosAngle = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return Math.acos(cosAngle);
}

function pollTranslation(translationId, callback, attempt) {
  attempt = attempt || 0;
  if (attempt >= 120) { callback(false, null, 'Timeout'); return; }
  setTimeout(() => {
    onshape.get({ path: '/api/translations/' + translationId }, (data, err) => {
      if (err) { callback(false, null, 'Poll error'); return; }
      const result = JSON.parse(data.toString());
      if (result.requestState === 'DONE') callback(true, result);
      else if (result.requestState === 'FAILED') callback(false, null, result.failureReason || 'Unknown');
      else { process.stdout.write('.'); pollTranslation(translationId, callback, attempt + 1); }
    });
  }, 5000);
}
