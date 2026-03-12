/**
 * Upload 43006.zip standalone (same as master upload) and compare its
 * internal frame with the local 43006 from 40009.zip.
 *
 * This tells us whether the standalone ZIP import produces a different
 * frame than the sub-assembly copy inside 40009.zip.
 *
 * Usage: cd Node && node one-off/compareFrames43006standalone.js
 */

const fs = require('fs');
const onshape = require('../lib/onshape.js');

const ZIP_43006 = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/43006.zip';
const ZIP_40009 = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40009.zip';

[ZIP_43006, ZIP_40009].forEach(z => {
  if (!fs.existsSync(z)) { console.error('ZIP not found:', z); process.exit(1); }
});

// Upload both ZIPs in parallel (separate documents), then compare
let standaloneResult = null;
let localResult = null;
let done = 0;

function checkBothDone() {
  done++;
  if (done < 2) return;
  compareDefinitions(standaloneResult.instances, standaloneResult.occurrences,
                     localResult.instances, localResult.occurrences);
}

// ─── Upload 43006.zip (standalone, same as master upload) ───
console.log('=== Uploading 43006.zip standalone ===');
uploadAndGetAssembly(ZIP_43006, '43006', 'STANDALONE-43006', (def, docId) => {
  standaloneResult = {
    instances: def.rootAssembly?.instances || [],
    occurrences: def.rootAssembly?.occurrences || [],
    docId
  };
  console.log(`  Standalone: ${standaloneResult.instances.length} instances, ${standaloneResult.occurrences.length} occurrences\n`);
  checkBothDone();
});

// ─── Upload 40009.zip and find local 43006 ───
console.log('=== Uploading 40009.zip for local 43006 ===');
uploadAndGetAssembly(ZIP_40009, '43006', 'LOCAL-43006-FROM-40009', (def, docId) => {
  localResult = {
    instances: def.rootAssembly?.instances || [],
    occurrences: def.rootAssembly?.occurrences || [],
    docId
  };
  console.log(`  Local: ${localResult.instances.length} instances, ${localResult.occurrences.length} occurrences\n`);
  checkBothDone();
});

function uploadAndGetAssembly(zipPath, assemblyNameMatch, docPrefix, callback) {
  onshape.post({
    path: '/api/documents',
    body: { name: docPrefix + '-' + new Date().toISOString().slice(0, 16) }
  }, (docData, docErr) => {
    if (docErr) { console.error('Failed:', docErr.body || docErr); process.exit(1); }

    const doc = JSON.parse(docData.toString());
    const docId = doc.id;
    const workId = doc.defaultWorkspace?.id;
    console.log(`  Doc: ${docId}`);

    onshape.upload({
      path: '/api/v6/translations/d/' + docId + '/w/' + workId,
      file: zipPath,
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
      console.log(`  Translation: ${translation.id}`);

      pollTranslation(translation.id, (ok) => {
        if (!ok) { console.error('Translation failed'); process.exit(1); }

        onshape.get({
          path: `/api/documents/d/${docId}/w/${workId}/elements`
        }, (elemData) => {
          const elements = JSON.parse(elemData.toString());
          const asmElem = elements.find(e =>
            e.type === 'Assembly' && e.name.includes(assemblyNameMatch)
          );

          if (!asmElem) {
            console.log('  Elements:');
            elements.forEach(e => console.log(`    ${e.type}: ${e.name}`));
            console.error(`  ${assemblyNameMatch} not found!`);
            process.exit(1);
          }

          console.log(`  Found: ${asmElem.name}`);

          onshape.get({
            path: `/api/assemblies/d/${docId}/w/${workId}/e/${asmElem.id}`,
            query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
          }, (asmData, asmErr) => {
            if (asmErr) { console.error('Failed:', asmErr.body || asmErr); process.exit(1); }
            callback(JSON.parse(asmData.toString()), docId);
          });
        });
      });
    });
  });
}

function compareDefinitions(standInst, standOcc, localInst, localOcc) {
  console.log('=== COMPARISON: standalone 43006.zip vs local 43006 from 40009.zip ===\n');

  const standOccById = {};
  standOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) standOccById[occ.path[0]] = occ;
  });

  const localOccById = {};
  localOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) localOccById[occ.path[0]] = occ;
  });

  const standByName = {};
  standInst.forEach(inst => {
    const clean = inst.name.replace(/\s*<\d+>$/, '').replace(/\s*\(\d+\)$/, '');
    if (!standByName[clean]) standByName[clean] = [];
    standByName[clean].push(inst);
  });

  const localByName = {};
  localInst.forEach(inst => {
    const clean = inst.name.replace(/\s*<\d+>$/, '').replace(/\s*\(\d+\)$/, '');
    if (!localByName[clean]) localByName[clean] = [];
    localByName[clean].push(inst);
  });

  const allNames = new Set([...Object.keys(standByName), ...Object.keys(localByName)]);
  let rotDiffs = [];
  let matchCount = 0;

  console.log('TRANSFORM COMPARISON:');
  console.log('─'.repeat(80));

  for (const name of [...allNames].sort()) {
    const sList = standByName[name] || [];
    const lList = localByName[name] || [];

    if (sList.length > 0 && lList.length > 0) {
      const sOcc = standOccById[sList[0].id];
      const lOcc = localOccById[lList[0].id];

      if (sOcc?.transform && lOcc?.transform) {
        const sRot = extractRotation(sOcc.transform);
        const lRot = extractRotation(lOcc.transform);
        const rotMatch = matricesMatch(sRot, lRot, 0.01);

        if (rotMatch) {
          console.log(`   ${name}: SAME rotation`);
          matchCount++;
        } else {
          const diff = multiplyRotations(sRot, transposeRotation(lRot));
          const angle = rotationAngle(diff);
          console.log(`** ${name}: ROT DIFFERS by ${(angle * 180 / Math.PI).toFixed(1)}°`);
          console.log(`     Standalone rot: [${sRot.map(v => v.toFixed(4)).join(', ')}]`);
          console.log(`     Local rot:      [${lRot.map(v => v.toFixed(4)).join(', ')}]`);
          console.log(`     Difference:     [${diff.map(v => v.toFixed(4)).join(', ')}]`);
          rotDiffs.push({ name, angle, diff });
        }
      }
    } else {
      const side = sList.length > 0 ? 'STANDALONE only' : 'LOCAL only';
      console.log(`   ${name}: ${side}`);
    }
  }

  console.log('─'.repeat(80));
  console.log(`\nMatching: ${matchCount}, Different: ${rotDiffs.length}`);

  if (rotDiffs.length > 0) {
    console.log('\n=== FRAME MISMATCH CONFIRMED ===');
    console.log('The standalone 43006.zip import has a different internal frame');
    console.log('than the local 43006 inside 40009.zip.');
    console.log(`All differences: ${rotDiffs.map(d => (d.angle * 180 / Math.PI).toFixed(1) + '°').join(', ')}`);
  } else {
    console.log('\n=== FRAMES MATCH ===');
    console.log('Standalone and local 43006 have the SAME internal frame.');
    console.log('The rotation issue must come from somewhere else.');
  }

  console.log(`\nStandalone doc: https://energyrecovery.onshape.com/documents/${standaloneResult.docId}`);
  console.log(`Local doc: https://energyrecovery.onshape.com/documents/${localResult.docId}`);
  console.log('Delete both when done.');
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
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function rotationAngle(r) {
  const trace = r[0] + r[4] + r[8];
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
}

function pollTranslation(translationId, callback, attempt) {
  attempt = attempt || 0;
  if (attempt >= 120) { callback(false); return; }
  setTimeout(() => {
    onshape.get({ path: '/api/translations/' + translationId }, (data, err) => {
      if (err) { callback(false); return; }
      const result = JSON.parse(data.toString());
      if (result.requestState === 'DONE') callback(true, result);
      else if (result.requestState === 'FAILED') callback(false);
      else { process.stdout.write('.'); pollTranslation(translationId, callback, attempt + 1); }
    });
  }, 5000);
}
