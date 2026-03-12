/**
 * Test script: Upload 40009.zip, then relink instances ONE AT A TIME.
 * After each relink, prints which part was just swapped so you can
 * watch the Onshape URL in browser and see exactly which relink
 * causes the 43006 orientation issue.
 *
 * Usage: cd Node && node one-off/testRelinkOneByOne.js
 *
 * Optional: --delay <seconds>  Pause between relinks (default: 10)
 *           --only <partNum>   Only relink this one part number
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const onshape = require('../lib/onshape.js');
const relink = require('../lib/relink.js');
const asmref = require('../lib/asmref.js');

const args = minimist(process.argv.slice(2));
const DELAY = (args.delay || 10) * 1000;
const ONLY_PART = args.only ? String(args.only) : null;

const ZIP_PATH = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/PackAndGo/40009.zip';
const ASMREF_PATH = path.join(__dirname, '..', 'output', 'asmref.json');

if (!fs.existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}

const asmrefData = asmref.load(ASMREF_PATH);
if (!asmrefData) {
  console.error('Failed to load ASMREF');
  process.exit(1);
}

// ─── Step 1: Create document + upload ZIP ───
console.log('Creating personal test document...');
onshape.post({
  path: '/api/documents',
  body: { name: 'TEST-RELINK-1BY1-' + new Date().toISOString().slice(0, 16) }
}, (docData, docErr) => {
  if (docErr) { console.error('Failed:', docErr.body || docErr); process.exit(1); }

  const doc = JSON.parse(docData.toString());
  const docId = doc.id;
  const workId = doc.defaultWorkspace?.id;

  const url = `https://energyrecovery.onshape.com/documents/${docId}`;
  console.log(`Document: ${url}`);

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
    if (uploadErr) { console.error('Upload failed:', uploadErr.body || uploadErr); process.exit(1); }

    const translation = JSON.parse(uploadData.toString());
    console.log('Translation started:', translation.id);

    pollTranslation(translation.id, (ok, _result, reason) => {
      if (!ok) { console.error('Translation failed:', reason); process.exit(1); }
      console.log('\nTranslation complete. Getting assembly definition...\n');

      // ─── Step 2: Find assembly element ───
      onshape.get({
        path: '/api/documents/d/' + docId + '/w/' + workId + '/elements'
      }, (elemData, elemErr) => {
        if (elemErr) { console.error('Failed:', elemErr.body || elemErr); process.exit(1); }

        const elements = JSON.parse(elemData.toString());
        const assemblies = elements.filter(e => e.type === 'Assembly');
        const mainAssembly = assemblies[0];
        if (!mainAssembly) { console.error('No assembly element found!'); process.exit(1); }

        console.log(`Main assembly: ${mainAssembly.name} (${mainAssembly.id})`);
        const asmUrl = `${url}/w/${workId}/e/${mainAssembly.id}`;
        console.log(`Assembly URL: ${asmUrl}\n`);

        // ─── Step 3: Get assembly definition + match instances to ASMREF ───
        relink.getAssemblyDefinition(docId, workId, mainAssembly.id, (definition) => {
          const instances = definition.rootAssembly?.instances || [];
          const occurrences = definition.rootAssembly?.occurrences || [];

          // Build occurrence lookup
          const occByInstanceId = {};
          occurrences.forEach(occ => {
            if (occ.path && occ.path.length === 1) {
              occByInstanceId[occ.path[0]] = occ;
            }
          });

          // Match instances to ASMREF masters
          const relinkable = [];
          instances.forEach(inst => {
            if (inst.documentId !== docId) return; // Skip external refs

            const cleanName = inst.name.replace(/\s*<\d+>$/, '').replace(/\s*\(\d+\)$/, '').replace(/\.[^/.]+$/, '');
            const isSubAsm = inst.type === 'Assembly';
            const linkFileName = cleanName + (isSubAsm ? '.SLDASM' : '.SLDPRT');

            const entry = asmref.lookup(asmrefData, '40009.SLDASM', linkFileName);
            if (!entry || !entry.documentId) return; // No master to relink to

            const occ = occByInstanceId[inst.id];

            // For assembly instances without direct occurrence, try to derive transform
            let transform = occ ? occ.transform : null;
            if (!transform) {
              // Find a depth-2 occurrence belonging to this assembly instance
              const childOcc = occurrences.find(o => o.path && o.path.length === 2 && o.path[0] === inst.id);
              if (childOcc) {
                // Use the child's composed transform as approximation
                transform = childOcc.transform;
                console.log(`  NOTE: Using child occurrence transform for assembly "${cleanName}"`);
              }
            }

            if (transform && transform.length === 12) {
              transform = [...transform, 0, 0, 0, 1];
            }

            relinkable.push({
              instanceId: inst.id,
              instanceName: inst.name,
              cleanName,
              partNumber: entry.partNumber || cleanName,
              isAssembly: isSubAsm,
              master: {
                documentId: entry.documentId,
                versionId: entry.versionId,
                elementId: entry.elementId,
                isAssembly: entry.type === 'SLDASM'
              },
              transform
            });
          });

          // Filter if --only specified
          let toProcess = relinkable;
          if (ONLY_PART) {
            toProcess = relinkable.filter(r => r.partNumber === ONLY_PART || r.cleanName === ONLY_PART);
            if (toProcess.length === 0) {
              console.log(`No instance found matching --only ${ONLY_PART}`);
              console.log('Available:');
              relinkable.forEach(r => console.log(`  ${r.partNumber} (${r.cleanName}) ${r.isAssembly ? '[ASM]' : '[Part]'}`));
              process.exit(1);
            }
          }

          console.log(`Found ${relinkable.length} relinkable instances, will process ${toProcess.length}:`);
          toProcess.forEach((r, i) => {
            const type = r.isAssembly ? '[ASM]' : '[Part]';
            const tx = r.transform ? 'has transform' : 'NO TRANSFORM';
            console.log(`  ${i + 1}. ${r.partNumber} ${type} (${tx})`);
          });
          console.log('');
          console.log(`Open this URL and watch: ${asmUrl}`);
          console.log(`Delay between relinks: ${DELAY / 1000}s\n`);
          console.log('Starting in 5 seconds...\n');

          // ─── Step 4: Relink one at a time ───
          setTimeout(() => {
            let idx = 0;
            function relinkNext() {
              if (idx >= toProcess.length) {
                console.log('\n=== ALL DONE ===');
                console.log(`Relinked ${toProcess.length} instances one by one.`);
                console.log(`Final URL: ${asmUrl}`);
                process.exit(0);
              }

              const item = toProcess[idx];
              idx++;
              const type = item.isAssembly ? 'ASM' : 'Part';
              console.log(`─── Relink ${idx}/${toProcess.length}: ${item.partNumber} [${type}] ───`);

              // Delete old instance
              relink.deleteInstances(docId, workId, mainAssembly.id, [item.instanceId], (_delResult, delErr) => {
                if (delErr) {
                  console.error(`  Delete failed: ${delErr.body || delErr}`);
                  relinkNext(); // skip this one
                  return;
                }

                // Wait for workspace to settle
                setTimeout(() => {
                  // Create new instance pointing to master with same transform
                  const transformGroup = {
                    instances: [item.master.isAssembly ? {
                      documentId: item.master.documentId,
                      versionId: item.master.versionId,
                      elementId: item.master.elementId,
                      isAssembly: true
                    } : {
                      documentId: item.master.documentId,
                      versionId: item.master.versionId,
                      elementId: item.master.elementId,
                      isWholePartStudio: true,
                      includePartTypes: ['PARTS', 'COMPOSITE_PARTS']
                    }],
                    transform: item.transform || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                  };

                  onshape.post({
                    path: `/api/assemblies/d/${docId}/w/${workId}/e/${mainAssembly.id}/transformedinstances`,
                    body: { transformGroups: [transformGroup] }
                  }, (data, postErr) => {
                    if (postErr) {
                      console.error(`  Create failed: ${postErr.body || postErr}`);
                    } else {
                      console.log(`  ✓ Relinked ${item.partNumber} to master`);
                    }

                    if (idx < toProcess.length) {
                      console.log(`  Waiting ${DELAY / 1000}s before next relink... (check browser now)\n`);
                      setTimeout(relinkNext, DELAY);
                    } else {
                      relinkNext();
                    }
                  });
                }, 2000); // 2s settle time after delete
              });
            }

            relinkNext();
          }, 5000); // Initial 5s delay
        });
      });
    });
  });
});

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
