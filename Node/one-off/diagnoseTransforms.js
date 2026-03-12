/**
 * Diagnostic script: Analyze assembly occurrences to confirm that
 * assembly-type instances are missing from path.length=1 occurrences.
 * Read-only — no modifications.
 *
 * Usage: node one-off/diagnoseTransforms.js <docId> <versionId> <elementId>
 */

const onshape = require('../lib/onshape.js');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node one-off/diagnoseTransforms.js <docId> <versionId> <elementId>');
  process.exit(1);
}

const [docId, versionId, elementId] = args;

console.log(`Fetching assembly definition...`);
console.log(`  doc: ${docId}`);
console.log(`  ver: ${versionId}`);
console.log(`  elem: ${elementId}\n`);

onshape.get({
  path: `/api/assemblies/d/${docId}/v/${versionId}/e/${elementId}`,
  query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
}, (data, err) => {
  if (err) {
    console.error('API error:', err.body || err);
    process.exit(1);
  }

  const def = JSON.parse(data.toString());
  const instances = def.rootAssembly?.instances || [];
  const occurrences = def.rootAssembly?.occurrences || [];

  console.log(`=== INSTANCES (${instances.length}) ===`);
  instances.forEach((inst, idx) => {
    const isLocal = inst.documentId === docId;
    console.log(`  [${idx}] "${inst.name}" type=${inst.type} id=${inst.id}`);
    console.log(`       doc=${inst.documentId} elem=${inst.elementId} local=${isLocal}`);
  });

  console.log(`\n=== OCCURRENCE STATISTICS (${occurrences.length} total) ===`);
  const pathDepths = {};
  occurrences.forEach(occ => {
    const depth = occ.path ? occ.path.length : 0;
    pathDepths[depth] = (pathDepths[depth] || 0) + 1;
  });
  Object.entries(pathDepths).sort((a, b) => a[0] - b[0]).forEach(([depth, count]) => {
    console.log(`  path.length=${depth}: ${count} occurrences`);
  });

  // Build occurrence lookup
  const occurrenceByInstanceId = {};
  occurrences.forEach(occ => {
    if (occ.path && occ.path.length === 1) {
      occurrenceByInstanceId[occ.path[0]] = occ;
    }
  });

  const partInstances = instances.filter(i => i.type !== 'Assembly');
  const asmInstances = instances.filter(i => i.type === 'Assembly');
  console.log(`\n=== INSTANCE TYPES ===`);
  console.log(`  Part instances: ${partInstances.length}`);
  console.log(`  Assembly instances: ${asmInstances.length}`);

  // Check which instances have occurrences
  console.log(`\n=== OCCURRENCE COVERAGE ===`);
  instances.forEach(inst => {
    const hasOcc = !!occurrenceByInstanceId[inst.id];
    const marker = hasOcc ? 'OK' : 'MISSING';
    if (!hasOcc) {
      console.log(`  [${marker}] "${inst.name}" (type=${inst.type})`);
    }
  });

  const missingCount = instances.filter(i => !occurrenceByInstanceId[i.id]).length;
  const coveredCount = instances.length - missingCount;
  console.log(`  ${coveredCount}/${instances.length} instances have direct occurrences`);

  // For assembly instances, check if they have child occurrences (path.length=2)
  if (asmInstances.length > 0) {
    console.log(`\n=== ASSEMBLY CHILD OCCURRENCES ===`);
    asmInstances.forEach(asmInst => {
      const childOccs = occurrences.filter(occ =>
        occ.path && occ.path.length === 2 && occ.path[0] === asmInst.id
      );
      console.log(`  "${asmInst.name}" (${asmInst.id}): ${childOccs.length} child occurrences`);
      if (childOccs.length > 0) {
        // Show first child's transform
        const first = childOccs[0];
        const t = first.transform;
        if (t) {
          console.log(`    First child transform (${t.length} elements): [${t.slice(0, 4).map(v => v.toFixed(4)).join(', ')}, ...]`);
          console.log(`    Translation: (${t[3]?.toFixed(4)}, ${t[7]?.toFixed(4)}, ${t[11]?.toFixed(4)})`);
        }
      }
    });
  }

  // Try to derive assembly transforms
  if (asmInstances.some(i => !occurrenceByInstanceId[i.id])) {
    console.log(`\n=== DERIVING ASSEMBLY TRANSFORMS ===`);
    const missingAsm = asmInstances.filter(i => !occurrenceByInstanceId[i.id]);

    let idx = 0;
    function deriveNext() {
      if (idx >= missingAsm.length) {
        console.log('\nDone.');
        process.exit(0);
        return;
      }

      const asmInst = missingAsm[idx++];
      const childOccs = occurrences.filter(occ =>
        occ.path && occ.path.length === 2 && occ.path[0] === asmInst.id
      );

      if (childOccs.length === 0) {
        console.log(`  "${asmInst.name}": No children — cannot derive`);
        deriveNext();
        return;
      }

      const childOcc = childOccs[0];
      const childInstanceId = childOcc.path[1];
      const T_composed = childOcc.transform;
      console.log(`  "${asmInst.name}": Using child ${childInstanceId}`);
      console.log(`    T_composed (${T_composed.length} elems): [${T_composed.map(v => v.toFixed(6)).join(', ')}]`);

      // Get sub-assembly definition to find child's local transform
      const subDocId = asmInst.documentId;
      let apiPath;
      if (subDocId === docId) {
        apiPath = `/api/assemblies/d/${subDocId}/v/${versionId}/e/${asmInst.elementId}`;
      } else if (asmInst.documentVersion) {
        apiPath = `/api/assemblies/d/${subDocId}/v/${asmInst.documentVersion}/e/${asmInst.elementId}`;
      } else if (asmInst.documentMicroversion) {
        apiPath = `/api/assemblies/d/${subDocId}/m/${asmInst.documentMicroversion}/e/${asmInst.elementId}`;
      } else {
        console.log(`    No version info for external sub-assembly — skipping`);
        deriveNext();
        return;
      }

      onshape.get({
        path: apiPath,
        query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
      }, (subData, subErr) => {
        if (subErr) {
          console.log(`    API error: ${subErr.body || subErr}`);
          setTimeout(deriveNext, 200);
          return;
        }

        const subDef = JSON.parse(subData.toString());
        const subOccs = subDef.rootAssembly?.occurrences || [];

        const childLocalOcc = subOccs.find(occ =>
          occ.path && occ.path.length === 1 && occ.path[0] === childInstanceId
        );

        if (!childLocalOcc || !childLocalOcc.transform) {
          console.log(`    Child not found in sub-assembly — T_assembly ≈ T_composed`);
          console.log(`    Derived translation: (${T_composed[3]?.toFixed(4)}, ${T_composed[7]?.toFixed(4)}, ${T_composed[11]?.toFixed(4)})`);
          setTimeout(deriveNext, 200);
          return;
        }

        const T_local = childLocalOcc.transform;
        console.log(`    T_child_local (${T_local.length} elems): [${T_local.map(v => v.toFixed(6)).join(', ')}]`);

        // Normalize to 16 elements
        function norm(t) {
          if (!t) return null;
          if (t.length === 16) return t;
          if (t.length === 12) return [...t, 0, 0, 0, 1];
          return t;
        }

        function invert(m) {
          m = norm(m);
          const r00=m[0],r01=m[1],r02=m[2],tx=m[3];
          const r10=m[4],r11=m[5],r12=m[6],ty=m[7];
          const r20=m[8],r21=m[9],r22=m[10],tz=m[11];
          const itx = -(r00*tx + r10*ty + r20*tz);
          const ity = -(r01*tx + r11*ty + r21*tz);
          const itz = -(r02*tx + r12*ty + r22*tz);
          return [r00,r10,r20,itx, r01,r11,r21,ity, r02,r12,r22,itz, 0,0,0,1];
        }

        function multiply(a, b) {
          const r = new Array(16).fill(0);
          for (let i=0;i<4;i++) for (let j=0;j<4;j++) for (let k=0;k<4;k++)
            r[i*4+j] += a[i*4+k] * b[k*4+j];
          return r;
        }

        const Tc = norm(T_composed);
        const Ti = invert(T_local);
        const T_assembly = multiply(Tc, Ti);

        console.log(`    T_assembly: [${T_assembly.map(v => v.toFixed(6)).join(', ')}]`);
        console.log(`    Derived translation: (${T_assembly[3].toFixed(4)}, ${T_assembly[7].toFixed(4)}, ${T_assembly[11].toFixed(4)})`);

        setTimeout(deriveNext, 200);
      });
    }

    deriveNext();
  } else {
    console.log('\nAll assembly instances have direct occurrences. No derivation needed.');
    process.exit(0);
  }
});
