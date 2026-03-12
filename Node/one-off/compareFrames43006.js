/**
 * Compare internal coordinate frames of master 43006 vs local 43006.
 *
 * Fetches the assembly definition of both copies and compares child
 * instance transforms to reveal the rotation difference that causes
 * the 90° misalignment after relink.
 *
 * Usage: cd Node && node one-off/compareFrames43006.js
 *
 * Requires the pre-relink test document (testImportOrientation) to
 * still exist for the local copy.
 */

const fs = require('fs');
const onshape = require('../lib/onshape.js');

// Master 43006 (from ASMREF)
const MASTER = {
  documentId: '9b9dbb01296d384da4665619',
  versionId: 'a655ec3f4938745a9ad47fdf',
  elementId: 'a703b82a7245f3cd382a7328'
};

const ZIP_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40009.zip';

if (!fs.existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}

// ─── Step 1: Get master 43006 assembly definition ───
console.log('=== Fetching MASTER 43006 assembly definition ===');
console.log(`  d/${MASTER.documentId}/v/${MASTER.versionId}/e/${MASTER.elementId}`);

onshape.get({
  path: `/api/assemblies/d/${MASTER.documentId}/v/${MASTER.versionId}/e/${MASTER.elementId}`,
  query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
}, (masterData, masterErr) => {
  if (masterErr) {
    console.error('Failed to get master:', masterErr.body || masterErr);
    process.exit(1);
  }

  const masterDef = JSON.parse(masterData.toString());
  const masterInstances = masterDef.rootAssembly?.instances || [];
  const masterOccurrences = masterDef.rootAssembly?.occurrences || [];

  console.log(`  ${masterInstances.length} instances, ${masterOccurrences.length} occurrences\n`);

  // ─── Step 2: Upload fresh ZIP to get local 43006 ───
  console.log('=== Uploading fresh 40009.zip for local 43006 ===');
  onshape.post({
    path: '/api/documents',
    body: { name: 'TEST-FRAMES-43006-' + new Date().toISOString().slice(0, 16) }
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

        // Find 43006 assembly element
        onshape.get({
          path: `/api/documents/d/${localDocId}/w/${workId}/elements`
        }, (elemData, elemErr) => {
          if (elemErr) { console.error('Failed:', elemErr.body || elemErr); process.exit(1); }

          const elements = JSON.parse(elemData.toString());
          const local43006 = elements.find(e =>
            e.type === 'Assembly' && e.name.includes('43006')
          );

          if (!local43006) {
            console.log('Available elements:');
            elements.forEach(e => console.log(`  ${e.type}: ${e.name} (${e.id})`));
            console.error('\n43006 assembly not found!');
            process.exit(1);
          }

          console.log(`  Found: ${local43006.name} (${local43006.id})\n`);

          // Get local 43006 assembly definition
          console.log('=== Fetching LOCAL 43006 assembly definition ===');
          onshape.get({
            path: `/api/assemblies/d/${localDocId}/w/${workId}/e/${local43006.id}`,
            query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
          }, (localData, localErr) => {
            if (localErr) { console.error('Failed:', localErr.body || localErr); process.exit(1); }

            const localDef = JSON.parse(localData.toString());
            const localInstances = localDef.rootAssembly?.instances || [];
            const localOccurrences = localDef.rootAssembly?.occurrences || [];

            console.log(`  ${localInstances.length} instances, ${localOccurrences.length} occurrences\n`);

            // ─── Step 3: Compare ───
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

  // Build occurrence lookup by instance ID (depth-1 only)
  const masterOccById = {};
  masterOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) {
      masterOccById[occ.path[0]] = occ;
    }
  });

  const localOccById = {};
  localOcc.forEach(occ => {
    if (occ.path && occ.path.length === 1) {
      localOccById[occ.path[0]] = occ;
    }
  });

  // Print master instances with transforms
  console.log('MASTER instances:');
  masterInst.forEach(inst => {
    const occ = masterOccById[inst.id];
    const t = occ?.transform;
    const rot = t ? formatRotation(t) : 'no occurrence';
    const pos = t ? formatTranslation(t) : '';
    console.log(`  ${inst.name} [${inst.type}] ${rot} ${pos}`);
  });
  console.log('');

  // Print local instances with transforms
  console.log('LOCAL instances:');
  localInst.forEach(inst => {
    const occ = localOccById[inst.id];
    const t = occ?.transform;
    const rot = t ? formatRotation(t) : 'no occurrence';
    const pos = t ? formatTranslation(t) : '';
    console.log(`  ${inst.name} [${inst.type}] ${rot} ${pos}`);
  });
  console.log('');

  // Match instances by name and compare transforms
  console.log('TRANSFORM COMPARISON (matching by name):');
  console.log('─'.repeat(80));

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

  // Compare each unique name
  const allNames = new Set([...Object.keys(masterByName), ...Object.keys(localByName)]);
  let rotationDiffs = [];

  for (const name of [...allNames].sort()) {
    const mList = masterByName[name] || [];
    const lList = localByName[name] || [];

    // Compare first instance of each (simplest case)
    if (mList.length > 0 && lList.length > 0) {
      const mOcc = masterOccById[mList[0].id];
      const lOcc = localOccById[lList[0].id];

      if (mOcc?.transform && lOcc?.transform) {
        const mRot = extractRotation(mOcc.transform);
        const lRot = extractRotation(lOcc.transform);
        const mPos = extractTranslation(mOcc.transform);
        const lPos = extractTranslation(lOcc.transform);

        const rotMatch = matricesMatch(mRot, lRot, 0.01);
        const posMatch = vectorsMatch(mPos, lPos, 0.001); // 1mm tolerance

        const status = rotMatch && posMatch ? 'SAME' : (rotMatch ? 'pos differs' : 'ROT DIFFERS');
        const marker = rotMatch ? '  ' : '**';

        console.log(`${marker} ${name}: ${status}`);
        if (!rotMatch) {
          console.log(`     Master rot: [${mRot.map(v => v.toFixed(4)).join(', ')}]`);
          console.log(`     Local  rot: [${lRot.map(v => v.toFixed(4)).join(', ')}]`);

          // Compute rotation difference: R_diff = R_master * R_local^T
          const diff = multiplyRotations(mRot, transposeRotation(lRot));
          console.log(`     Difference: [${diff.map(v => v.toFixed(4)).join(', ')}]`);
          const angle = rotationAngle(diff);
          console.log(`     Angle: ${(angle * 180 / Math.PI).toFixed(1)}°`);
          rotationDiffs.push({ name, angle, diff });
        }
        if (!posMatch) {
          const dx = (mPos[0] - lPos[0]) * 1000;
          const dy = (mPos[1] - lPos[1]) * 1000;
          const dz = (mPos[2] - lPos[2]) * 1000;
          console.log(`     Position delta: (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)}) mm`);
        }
      } else {
        const mHas = mOcc?.transform ? 'yes' : 'no';
        const lHas = lOcc?.transform ? 'yes' : 'no';
        console.log(`   ${name}: master_occ=${mHas}, local_occ=${lHas}`);
      }
    } else {
      const side = mList.length > 0 ? 'MASTER only' : 'LOCAL only';
      console.log(`   ${name}: ${side}`);
    }
  }

  console.log('─'.repeat(80));
  console.log('');

  if (rotationDiffs.length > 0) {
    console.log(`=== ROTATION DIFFERENCES FOUND: ${rotationDiffs.length} ===`);
    rotationDiffs.forEach(d => {
      console.log(`  ${d.name}: ${(d.angle * 180 / Math.PI).toFixed(1)}° rotation`);
    });
    console.log('');
    console.log('These rotation differences between master and local frames');
    console.log('explain the 43006 orientation bug after relink.');
  } else {
    console.log('No rotation differences found between master and local frames.');
    console.log('The coordinate frames are identical — bug may be elsewhere.');
  }
}

// ─── Math helpers ───

function extractRotation(t) {
  // 3x3 rotation from row-major 4x4 (or 12-element)
  return [t[0], t[1], t[2], t[4], t[5], t[6], t[8], t[9], t[10]];
}

function extractTranslation(t) {
  return [t[3], t[7], t[11]];
}

function formatRotation(t) {
  const r = extractRotation(t);
  // Check if identity
  const isIdentity = Math.abs(r[0] - 1) < 0.001 && Math.abs(r[4] - 1) < 0.001 && Math.abs(r[8] - 1) < 0.001;
  if (isIdentity) return 'rot=I';
  return `rot=[${r[0].toFixed(3)},${r[4].toFixed(3)},${r[8].toFixed(3)}]diag`;
}

function formatTranslation(t) {
  const p = extractTranslation(t);
  return `pos=(${(p[0]*1000).toFixed(1)}, ${(p[1]*1000).toFixed(1)}, ${(p[2]*1000).toFixed(1)})mm`;
}

function matricesMatch(a, b, tol) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

function vectorsMatch(a, b, tol) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

function transposeRotation(r) {
  // Transpose 3x3 (row-major)
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
}

function multiplyRotations(a, b) {
  // 3x3 multiply
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
  // Angle from rotation matrix: cos(θ) = (trace - 1) / 2
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
