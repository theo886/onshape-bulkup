/**
 * Test script: Upload 40009.zip to a new PERSONAL document, run relink with ASMREF,
 * verify sub-assembly transforms. No release.
 *
 * Creates a personal document (no parentId) to avoid 403 on Mac API keys that
 * lack permission to create in company folders.
 *
 * Usage: cd Node && node one-off/testRelinkTransforms.js
 */

const fs = require('fs');
const path = require('path');
const onshape = require('../lib/onshape.js');
const relink = require('../lib/relink.js');
const asmref = require('../lib/asmref.js');

const ZIP_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40009.zip';
const ASMREF_PATH = path.join(__dirname, '..', 'output', 'asmref.json');

if (!fs.existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}

// Load ASMREF
const asmrefData = asmref.load(ASMREF_PATH);
if (!asmrefData) {
  console.error('Failed to load ASMREF');
  process.exit(1);
}

// Show what ASMREF knows about 40009
const components = asmref.getAssemblyComponents(asmrefData, '40009.SLDASM');
const componentKeys = Object.keys(components);
console.log(`ASMREF has ${componentKeys.length} components for 40009.SLDASM:`);
componentKeys.forEach(key => {
  const c = components[key];
  const hasIds = c.documentId ? 'HAS IDs' : 'no IDs';
  console.log(`  ${key} (${c.type || 'SLDPRT'}) [${hasIds}] pn=${c.partNumber}`);
});
console.log('');

// ─── Step 1: Create personal test document (no parentId → personal space) ───
console.log('=== Step 1: Create personal test document ===');
onshape.post({
  path: '/api/documents',
  body: {
    name: 'TEST-RELINK-40009-' + new Date().toISOString().slice(0, 16)
  }
}, (docData, docErr) => {
  if (docErr) {
    console.error('Failed to create document:', docErr.body || docErr);
    process.exit(1);
  }

  const doc = JSON.parse(docData.toString());
  const docId = doc.id;
  const workId = doc.defaultWorkspace?.id;
  console.log('Document created:', docId);
  console.log('Workspace:', workId);
  console.log('URL: https://energyrecovery.onshape.com/documents/' + docId);
  console.log('');

  // ─── Step 2: Upload ZIP ───
  console.log('=== Step 2: Upload ZIP ===');
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

    // ─── Step 3: Poll translation ───
    pollTranslation(translation.id, (ok, result, reason) => {
      if (!ok) {
        console.error('Translation failed:', reason);
        process.exit(1);
      }

      const elementIds = result.resultElementIds || [];
      console.log('\nTranslation complete. Elements:', elementIds.length);
      console.log('');

      // ─── Step 4: Find assembly element ───
      console.log('=== Step 3: Find assembly elements ===');
      onshape.get({
        path: '/api/documents/d/' + docId + '/w/' + workId + '/elements'
      }, (elemData, elemErr) => {
        if (elemErr) {
          console.error('Failed to get elements:', elemErr.body || elemErr);
          process.exit(1);
        }

        const elements = JSON.parse(elemData.toString());
        const newElements = elements.filter(e => elementIds.includes(e.id));
        const assemblyElements = newElements.filter(e => e.type === 'Assembly');
        const mainAssembly = assemblyElements[0];
        const partStudios = newElements.filter(e => e.type === 'Part Studio').map(e => e.id);
        const subAssemblies = assemblyElements.filter(e => e.id !== mainAssembly?.id).map(e => e.id);

        if (!mainAssembly) {
          console.error('No assembly element found!');
          process.exit(1);
        }

        console.log('Main assembly:', mainAssembly.name, '(' + mainAssembly.id + ')');
        console.log('Part Studios:', partStudios.length);
        console.log('Sub-assembly elements:', subAssemblies.length);
        console.log('All new elements:');
        newElements.forEach(e => {
          console.log('  ' + e.type + ': ' + e.name + ' (' + e.id + ')');
        });
        console.log('');

        // ─── Step 4: PRE-RELINK DIAGNOSTICS ───
        // This is the key step: check whether assembly instances have
        // direct occurrences BEFORE relink modifies anything.
        console.log('=== Step 4: Pre-relink diagnostics ===');
        relink.getAssemblyDefinition(docId, workId, mainAssembly.id, (preDef) => {
          const preInstances = preDef.rootAssembly?.instances || [];
          const preOccurrences = preDef.rootAssembly?.occurrences || [];

          console.log('Pre-relink: ' + preInstances.length + ' instances, ' + preOccurrences.length + ' occurrences');
          console.log('');

          // Occurrence depth statistics
          const depthCounts = {};
          preOccurrences.forEach(occ => {
            const depth = occ.path ? occ.path.length : 0;
            depthCounts[depth] = (depthCounts[depth] || 0) + 1;
          });
          console.log('Occurrence path depth distribution:');
          Object.entries(depthCounts).sort((a, b) => a[0] - b[0]).forEach(([depth, count]) => {
            console.log('  path.length=' + depth + ': ' + count + ' occurrences');
          });
          console.log('');

          // Build occurrence lookup
          const preOccByInstId = {};
          preOccurrences.forEach(occ => {
            if (occ.path && occ.path.length === 1) {
              preOccByInstId[occ.path[0]] = occ;
            }
          });

          // Instance-by-instance analysis
          console.log('Instance analysis:');
          const partInst = [];
          const asmInst = [];
          preInstances.forEach(inst => {
            const isLocal = inst.documentId === docId;
            const occ = preOccByInstId[inst.id];
            const hasDirectOcc = !!occ;
            const typeTag = inst.type === 'Assembly' ? '[ASM]' : '[Part]';
            const localTag = isLocal ? '[LOCAL]' : '[EXT]';

            let transformStr = 'NO OCCURRENCE';
            if (occ && occ.transform) {
              const t = occ.transform;
              // Show translation component (last column of 4x4 or positions 3,7,11 of row-major)
              if (t.length >= 12) {
                transformStr = 'tx=' + (t[3] * 1000).toFixed(1) + 'mm, ty=' + (t[7] * 1000).toFixed(1) + 'mm, tz=' + (t[11] * 1000).toFixed(1) + 'mm';
              } else {
                transformStr = 'transform[' + t.length + ']';
              }
            }

            console.log('  ' + typeTag + ' ' + localTag + ' ' + inst.name + ' -> ' + (hasDirectOcc ? 'HAS occ' : '*** MISSING occ ***') + ' | ' + transformStr);

            if (inst.type === 'Assembly') asmInst.push(inst);
            else partInst.push(inst);
          });
          console.log('');

          // Key hypothesis check
          const asmWithOcc = asmInst.filter(i => preOccByInstId[i.id]);
          const asmWithoutOcc = asmInst.filter(i => !preOccByInstId[i.id]);
          const partWithOcc = partInst.filter(i => preOccByInstId[i.id]);
          const partWithoutOcc = partInst.filter(i => !preOccByInstId[i.id]);

          console.log('=== HYPOTHESIS CHECK ===');
          console.log('Assembly instances: ' + asmInst.length + ' total');
          console.log('  WITH direct occurrence: ' + asmWithOcc.length);
          console.log('  WITHOUT direct occurrence: ' + asmWithoutOcc.length + (asmWithoutOcc.length > 0 ? ' *** CONFIRMS HYPOTHESIS ***' : ''));
          console.log('Part instances: ' + partInst.length + ' total');
          console.log('  WITH direct occurrence: ' + partWithOcc.length);
          console.log('  WITHOUT direct occurrence: ' + partWithoutOcc.length);
          console.log('');

          if (asmWithoutOcc.length > 0) {
            console.log('CONFIRMED: Assembly instances are missing direct occurrences.');
            console.log('The deriveAssemblyTransforms() fix should compute their placement.');
          } else if (asmInst.length > 0) {
            console.log('HYPOTHESIS WRONG: Assembly instances DO have direct occurrences.');
            console.log('Bug may be in transform format or batch API. Check normalizeTransform().');
          } else {
            console.log('No assembly instances found — cannot test hypothesis.');
          }
          console.log('');

          // Also check depth-2 occurrences (children of assembly instances)
          const depth2Occs = preOccurrences.filter(o => o.path && o.path.length === 2);
          if (depth2Occs.length > 0) {
            console.log('Depth-2 occurrences (children of assembly instances):');
            const parentIds = new Set(depth2Occs.map(o => o.path[0]));
            parentIds.forEach(parentId => {
              const parentInst = preInstances.find(i => i.id === parentId);
              const children = depth2Occs.filter(o => o.path[0] === parentId);
              console.log('  Parent: ' + (parentInst?.name || parentId) + ' -> ' + children.length + ' child occurrences');
            });
            console.log('');
          }

          // ─── Step 5: Run relink with new code ───
          console.log('=== Step 5: Relink (with deriveAssemblyTransforms) ===');
          relink.relinkAssembly(
            {
              documentId: docId,
              workspaceId: workId,
              elementId: mainAssembly.id,
              partStudioElements: partStudios,
              importedAssemblyElements: subAssemblies,
              zipPath: ZIP_PATH
            },
            {},  // empty partMapping — ASMREF has everything
            asmrefData,
            (report, relinkErr) => {
              console.log('');
              console.log('=== RELINK RESULT ===');
              if (relinkErr) {
                console.log('Error:', relinkErr.message || relinkErr.body || relinkErr);
              }
              console.log('Relinks performed:', report?.relinksPerformed || 0);
              console.log('Deleted elements:', report?.deletedElements || 0);
              console.log('Local parts kept:', report?.localPartsKept || 0);
              if (report?.missingFromZip?.length > 0) {
                console.log('Missing from ZIP:', report.missingFromZip.length);
              }
              console.log('');

              // ─── Step 6: Verify post-relink transforms ───
              console.log('=== Step 6: Verify post-relink transforms ===');
              setTimeout(() => {
                relink.getAssemblyDefinition(docId, workId, mainAssembly.id, (verifyDef) => {
                  const verifyInstances = verifyDef.rootAssembly?.instances || [];
                  const verifyOccs = verifyDef.rootAssembly?.occurrences || [];

                  console.log('Post-relink: ' + verifyInstances.length + ' instances, ' + verifyOccs.length + ' occurrences');
                  console.log('');

                  // Build occurrence lookup
                  const verifyOccById = {};
                  verifyOccs.forEach(occ => {
                    if (occ.path && occ.path.length === 1) {
                      verifyOccById[occ.path[0]] = occ;
                    }
                  });

                  // Check each instance's transform
                  let asmAtOrigin = false;
                  console.log('Post-relink instance transforms:');
                  verifyInstances.forEach(inst => {
                    const occ = verifyOccById[inst.id];
                    const isAsm = inst.type === 'Assembly' ? ' [ASM]' : '';
                    const isLocal = inst.documentId === docId ? ' [LOCAL]' : '';

                    let txStr = 'NO OCCURRENCE';
                    if (occ && occ.transform) {
                      const t = occ.transform;
                      if (t.length >= 12) {
                        const tx = (t[3] * 1000).toFixed(1);
                        const ty = (t[7] * 1000).toFixed(1);
                        const tz = (t[11] * 1000).toFixed(1);
                        txStr = '(' + tx + ', ' + ty + ', ' + tz + ') mm';

                        // Check if assembly instance is near origin (within 1mm)
                        if (inst.type === 'Assembly') {
                          const dist = Math.sqrt(t[3]*t[3] + t[7]*t[7] + t[11]*t[11]) * 1000;
                          if (dist < 1.0) {
                            asmAtOrigin = true;
                            txStr += ' *** AT ORIGIN (BUG!) ***';
                          } else {
                            txStr += ' (dist=' + dist.toFixed(1) + 'mm from origin)';
                          }
                        }
                      }
                    }

                    console.log('  ' + inst.name + isAsm + isLocal + ' -> ' + txStr);
                  });

                  console.log('');
                  if (asmAtOrigin) {
                    console.log('FAIL: At least one assembly instance is at origin after relink.');
                    console.log('The transform fix did not work. Check deriveAssemblyTransforms output above.');
                  } else {
                    const postAsmInstances = verifyInstances.filter(i => i.type === 'Assembly');
                    if (postAsmInstances.length > 0) {
                      console.log('SUCCESS: Assembly instance(s) are NOT at origin.');
                      console.log('The deriveAssemblyTransforms fix appears to be working!');
                    } else {
                      console.log('NOTE: No assembly instances in post-relink state (all may have been relinked to external).');
                    }
                  }

                  console.log('');
                  console.log('Visual verification URL:');
                  console.log('https://energyrecovery.onshape.com/documents/' + docId + '/w/' + workId + '/e/' + mainAssembly.id);
                  console.log('');
                  console.log('(No release — delete the document when done testing)');
                  process.exit(0);
                });
              }, 3000); // Wait for Onshape to settle
            }
          );
        });
      });
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
