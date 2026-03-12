const onshape = require('./onshape.js');
const { listSolidWorksFiles } = require('./zipUtils.js');
const asmref = require('./asmref.js');
const path = require('path');

// ─── Matrix math helpers for transform manipulation ───

/**
 * Normalize a transform array to 16 elements (4x4 row-major).
 * Onshape occurrence transforms may be 12 elements (BTBSMatrix-386)
 * which omits the implicit last row [0, 0, 0, 1].
 * Returns null if input is null/undefined.
 */
function normalizeTransform(t) {
  if (!t) return null;
  if (t.length === 16) return t;
  if (t.length === 12) return [...t, 0, 0, 0, 1];
  console.log(`  WARNING: Unexpected transform length ${t.length}, returning as-is`);
  return t;
}

/**
 * Multiply two 4x4 matrices (16-element row-major arrays).
 * Result = A × B
 */
function multiplyTransformMatrices(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
      }
    }
  }
  return r;
}

/**
 * Invert a rigid-body transform matrix (rotation + translation).
 * Uses efficient method: R^T for rotation, -R^T * t for translation.
 * Assumes the matrix is a valid rigid transform (orthonormal rotation).
 */
function invertTransformMatrix(m) {
  m = normalizeTransform(m);
  if (!m) return null;
  // Extract rotation and translation
  const r00 = m[0], r01 = m[1], r02 = m[2], tx = m[3];
  const r10 = m[4], r11 = m[5], r12 = m[6], ty = m[7];
  const r20 = m[8], r21 = m[9], r22 = m[10], tz = m[11];
  // Inverse translation = -R^T * t
  const itx = -(r00 * tx + r10 * ty + r20 * tz);
  const ity = -(r01 * tx + r11 * ty + r21 * tz);
  const itz = -(r02 * tx + r12 * ty + r22 * tz);
  return [
    r00, r10, r20, itx,
    r01, r11, r21, ity,
    r02, r12, r22, itz,
    0, 0, 0, 1
  ];
}

/**
 * Reusable relink module for assemblies.
 *
 * This module handles the complex workflow of replacing duplicate parts
 * in assemblies with references to master parts.
 *
 * Workflow:
 * 1. Get assembly definition (instances + transforms)
 * 2. Identify local instances that match master parts
 * 3. Delete duplicate instances
 * 4. Create new instances from masters (with transforms preserved)
 * 5. Group new instances to lock positions
 * 6. Fasten first instance to origin
 * 7. Delete duplicate Part Studio elements
 * 8. Update external references
 */

/**
 * Get assembly definition
 */
function getAssemblyDefinition(docId, workId, elementId, callback) {
  onshape.get({
    path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}`,
    query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
  }, (data) => {
    callback(JSON.parse(data.toString()));
  });
}

/**
 * Delete instances from an assembly using the modify endpoint
 */
function deleteInstances(docId, workId, elementId, instanceIds, callback) {
  console.log(`    Deleting ${instanceIds.length} instances...`);

  onshape.post({
    path: `/api/v9/assemblies/d/${docId}/w/${workId}/e/${elementId}/modify`,
    body: {
      deleteInstances: instanceIds
    }
  }, (data, postErr) => {
    if (postErr) {
      callback(null, postErr);
      return;
    }
    callback(data ? JSON.parse(data.toString()) : {});
  });
}

/**
 * Derive transforms for assembly-type instances that have no direct occurrence.
 * Onshape only returns occurrences for leaf parts, not intermediate assemblies.
 *
 * Strategy: For each missing assembly instance, find a child occurrence in the
 * root assembly (path.length === 2 with path[0] === assemblyInstanceId), get the
 * sub-assembly's internal definition for the child's local transform, then compute:
 *   T_assembly = T_composed × inverse(T_child_local)
 *
 * @param {string} docId - Document ID
 * @param {string} workId - Workspace ID
 * @param {Array} instances - All instances from root assembly
 * @param {Array} occurrences - All occurrences from root assembly
 * @param {Object} occurrenceByInstanceId - Map to populate with derived transforms
 * @param {Function} callback - () => {} called when done
 */
function deriveAssemblyTransforms(docId, workId, instances, occurrences, occurrenceByInstanceId, callback) {
  // Find assembly instances that are missing from occurrenceByInstanceId
  const missingAssemblyInstances = instances.filter(inst =>
    inst.type === 'Assembly' && !occurrenceByInstanceId[inst.id]
  );

  if (missingAssemblyInstances.length === 0) {
    callback();
    return;
  }

  console.log(`  Deriving transforms for ${missingAssemblyInstances.length} assembly instance(s)...`);

  // Build index of child occurrences by parent instance ID
  // path[0] is the parent assembly instance, path[1] is the child within it
  const childOccurrencesByParent = {};
  occurrences.forEach(occ => {
    if (occ.path && occ.path.length === 2) {
      const parentId = occ.path[0];
      if (!childOccurrencesByParent[parentId]) {
        childOccurrencesByParent[parentId] = [];
      }
      childOccurrencesByParent[parentId].push(occ);
    }
  });

  // Process each missing assembly instance sequentially (200ms delay between API calls)
  let idx = 0;
  function processNext() {
    if (idx >= missingAssemblyInstances.length) {
      callback();
      return;
    }

    const asmInst = missingAssemblyInstances[idx];
    idx++;

    const childOccs = childOccurrencesByParent[asmInst.id];
    if (!childOccs || childOccs.length === 0) {
      console.log(`    WARNING: No child occurrences found for assembly "${asmInst.name}" (${asmInst.id}) — cannot derive transform`);
      setTimeout(processNext, 0);
      return;
    }

    // Use first child occurrence for derivation
    const childOcc = childOccs[0];
    const childInstanceId = childOcc.path[1];
    const T_composed = normalizeTransform(childOcc.transform);

    if (!T_composed) {
      console.log(`    WARNING: Child occurrence has no transform for assembly "${asmInst.name}" — using identity`);
      setTimeout(processNext, 0);
      return;
    }

    // Get the sub-assembly's internal definition to find child's local transform
    const subAsmElementId = asmInst.elementId;
    const subAsmDocId = asmInst.documentId;

    // Build the API path based on whether it's local or external
    let apiPath;
    if (subAsmDocId === docId) {
      apiPath = `/api/assemblies/d/${subAsmDocId}/w/${workId}/e/${subAsmElementId}`;
    } else if (asmInst.documentVersion) {
      apiPath = `/api/assemblies/d/${subAsmDocId}/v/${asmInst.documentVersion}/e/${subAsmElementId}`;
    } else if (asmInst.documentMicroversion) {
      apiPath = `/api/assemblies/d/${subAsmDocId}/m/${asmInst.documentMicroversion}/e/${subAsmElementId}`;
    } else {
      console.log(`    WARNING: External assembly "${asmInst.name}" has no version info — cannot derive transform`);
      setTimeout(processNext, 0);
      return;
    }

    onshape.get({
      path: apiPath,
      query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
    }, (data, err) => {
      if (err) {
        console.log(`    WARNING: Could not get sub-assembly definition for "${asmInst.name}": ${err.body || err}`);
        setTimeout(processNext, 200);
        return;
      }

      const subDef = JSON.parse(data.toString());
      const subOccurrences = subDef.rootAssembly?.occurrences || [];

      // Find the child's local transform within the sub-assembly
      const childLocalOcc = subOccurrences.find(occ =>
        occ.path && occ.path.length === 1 && occ.path[0] === childInstanceId
      );

      if (!childLocalOcc || !childLocalOcc.transform) {
        // If child has identity local transform, T_assembly ≈ T_composed
        console.log(`    WARNING: Child "${childInstanceId}" not found in sub-assembly "${asmInst.name}" occurrences — using composed transform as fallback`);
        occurrenceByInstanceId[asmInst.id] = { path: [asmInst.id], transform: T_composed, derived: true };
        console.log(`    Derived transform (fallback) for "${asmInst.name}": [${T_composed.slice(0, 4).map(v => v.toFixed(4)).join(', ')}, ...]`);
        setTimeout(processNext, 200);
        return;
      }

      const T_child_local = normalizeTransform(childLocalOcc.transform);
      const T_child_local_inv = invertTransformMatrix(T_child_local);

      if (!T_child_local_inv) {
        console.log(`    WARNING: Could not invert child local transform for "${asmInst.name}"`);
        setTimeout(processNext, 200);
        return;
      }

      // T_assembly = T_composed × inverse(T_child_local)
      const T_assembly = multiplyTransformMatrices(T_composed, T_child_local_inv);

      occurrenceByInstanceId[asmInst.id] = { path: [asmInst.id], transform: T_assembly, derived: true };
      console.log(`    Derived transform for "${asmInst.name}": [${T_assembly.slice(0, 4).map(v => v.toFixed(4)).join(', ')}, ...]`);
      setTimeout(processNext, 200);
    });
  }

  processNext();
}

/**
 * Create a version of a document (required for cross-document references)
 */
function createVersion(docId, workId, name, callback) {
  onshape.post({
    path: `/api/documents/d/${docId}/versions`,
    body: {
      name: name || `For assembly reference ${new Date().toISOString()}`,
      documentId: docId,
      workspaceId: workId
    }
  }, (data, err) => {
    if (err) {
      callback(null, err);
      return;
    }
    callback(JSON.parse(data.toString()));
  });
}

/**
 * Create a new instance WITH transform in a single API call
 * Uses the /transformedinstances endpoint for atomic creation+positioning
 */
function createInstanceWithTransform(docId, workId, elementId, masterInfo, transform, callback) {
  console.log(`      Creating instance from master ${masterInfo.partNumber || masterInfo.filename}...`);

  // For cross-document references, we need a version ID
  // Prefer using existing versionId (from release) to avoid creating unnecessary versions
  if (masterInfo.versionId) {
    console.log(`      Using existing release version: ${masterInfo.versionId}`);
    doCreateWithTransform(masterInfo.versionId);
  } else {
    createVersion(masterInfo.documentId, masterInfo.workspaceId, `Ref: ${masterInfo.partNumber || masterInfo.filename}`, (versionInfo, versionErr) => {
      if (versionErr) {
        console.error(`      Failed to create version: ${versionErr.body || versionErr}`);
        callback(null, versionErr);
        return;
      }
      masterInfo.versionId = versionInfo.id;
      console.log(`      Created new version: ${versionInfo.id}`);
      doCreateWithTransform(versionInfo.id);
    });
  }

  function doCreateWithTransform(versionId) {
    let instanceDef;

    if (masterInfo.isAssembly) {
      instanceDef = {
        documentId: masterInfo.documentId,
        versionId: versionId,
        elementId: masterInfo.elementId,
        isAssembly: true
      };
    } else {
      instanceDef = {
        documentId: masterInfo.documentId,
        versionId: versionId,
        elementId: masterInfo.elementId,
        isWholePartStudio: true,
        includePartTypes: ['PARTS', 'COMPOSITE_PARTS']
      };
    }

    if (!transform) {
      console.log(`      WARNING: No transform for ${masterInfo.partNumber || masterInfo.filename} — using identity (will appear at origin)`);
    }

    const body = {
      transformGroups: [{
        instances: [instanceDef],
        transform: transform || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      }]
    };

    onshape.post({
      path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}/transformedinstances`,
      body: body
    }, (data, postErr) => {
      if (postErr) {
        callback(null, postErr);
        return;
      }
      callback(data ? JSON.parse(data.toString()) : {});
    });
  }
}

/**
 * Create multiple instances with transforms in a SINGLE API call (batched)
 * This significantly reduces API calls for assemblies with many instances
 *
 * @param {string} docId - Document ID
 * @param {string} workId - Workspace ID
 * @param {string} elementId - Assembly element ID
 * @param {Array} items - Array of { master, transform } objects
 * @param {Function} callback - (result, error) => {}
 */
function createInstancesBatch(docId, workId, elementId, items, callback) {
  if (items.length === 0) {
    callback({ created: 0 });
    return;
  }

  console.log(`      Creating ${items.length} instances in single API call...`);

  // Build transform groups for all items
  const transformGroups = [];
  const missingVersions = [];

  items.forEach((item, idx) => {
    const master = item.master;

    if (!master.versionId) {
      missingVersions.push({ idx, master });
      return;
    }

    let instanceDef;
    if (master.isAssembly) {
      instanceDef = {
        documentId: master.documentId,
        versionId: master.versionId,
        elementId: master.elementId,
        isAssembly: true
      };
    } else {
      instanceDef = {
        documentId: master.documentId,
        versionId: master.versionId,
        elementId: master.elementId,
        isWholePartStudio: true,
        includePartTypes: ['PARTS', 'COMPOSITE_PARTS']
      };
    }

    if (!item.transform) {
      console.log(`      WARNING: No transform for ${master.partNumber || master.filename} — using identity (will appear at origin)`);
    }

    transformGroups.push({
      instances: [instanceDef],
      transform: item.transform || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    });
  });

  // If any items are missing versionId, log warning (shouldn't happen with updated ASMREF)
  if (missingVersions.length > 0) {
    console.log(`      WARNING: ${missingVersions.length} items missing versionId, skipping them`);
    missingVersions.forEach(({ master }) => {
      console.log(`        - ${master.partNumber || master.filename}`);
    });
  }

  if (transformGroups.length === 0) {
    callback({ created: 0 });
    return;
  }

  // Log unique masters being used
  const uniqueMasters = new Set(items.filter(i => i.master.versionId).map(i => i.master.partNumber));
  console.log(`      Using ${uniqueMasters.size} unique master parts for ${transformGroups.length} instances`);

  // DEBUG: Log full request details
  console.log(`      DEBUG: ${transformGroups.length} transformGroups, target: d/${docId}/w/${workId}/e/${elementId}`);
  const fullBody = { transformGroups };
  const bodyJson = JSON.stringify(fullBody);
  console.log(`      DEBUG: Body size: ${bodyJson.length} bytes`);
  console.log(`      DEBUG: Full body:\n${JSON.stringify(fullBody, null, 2)}`);

  onshape.post({
    path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}/transformedinstances`,
    body: fullBody
  }, (data, postErr) => {
    if (postErr) {
      console.error(`      Batch create failed: ${postErr.body || postErr}`);
      callback(null, postErr);
      return;
    }
    console.log(`      Batch create successful`);
    callback({ created: transformGroups.length });
  });
}

/**
 * Get the most recently added instance in an assembly
 * After creating an instance, call this to find it (since createInstance returns {})
 */
function getNewestInstance(docId, workId, elementId, knownIds, callback) {
  onshape.get({
    path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}`,
    query: { includeMateFeatures: false, includeMateConnectors: false, includeNonSolids: true }
  }, (data) => {
    const def = JSON.parse(data.toString());
    const instances = def.rootAssembly?.instances || [];
    // Find an instance that's not in the known list
    const newInstance = instances.find(inst => !knownIds.has(inst.id));
    callback(newInstance);
  });
}

/**
 * Group all instances in an assembly to lock their relative positions
 */
function groupInstances(docId, workId, elementId, instanceIds, callback) {
  if (instanceIds.length < 2) {
    // Need at least 2 instances to group
    callback({});
    return;
  }

  console.log(`    Grouping ${instanceIds.length} instances...`);

  const groupFeature = {
    type: 65,
    typeName: "BTMMateGroup",
    message: {
      featureType: "mateGroup",
      featureId: "group_" + Date.now(),
      name: "Imported Group",
      parameters: [
        {
          type: 67,
          typeName: "BTMParameterQueryWithOccurrenceList",
          message: {
            queries: instanceIds.map(id => ({
              type: 626,
              typeName: "BTMIndividualOccurrenceQuery",
              message: {
                path: [id],
                hasUserCode: false
              }
            })),
            parameterId: "occurrencesQuery",
            hasUserCode: false
          }
        }
      ],
      suppressed: false,
      subFeatures: [],
      hasUserCode: false
    }
  };

  onshape.post({
    path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}/features`,
    body: { feature: groupFeature }
  }, (data, postErr) => {
    if (postErr) {
      console.log(`      Group creation failed: ${JSON.parse(postErr.body).message}`);
      callback(null, postErr);
      return;
    }
    console.log(`      Group created successfully`);
    callback(data ? JSON.parse(data.toString()) : {});
  });
}

/**
 * Create a fastened mate from an instance to the assembly origin
 * This locks the part in place so it can't be moved
 */
function fastenToOrigin(docId, workId, elementId, instanceId, callback) {
  console.log(`    Fastening first instance to origin...`);

  const mateConnectorId1 = "mc_origin_" + Date.now();
  const mateConnectorId2 = "mc_part_" + Date.now();

  const fastenedMate = {
    type: 64,
    typeName: "BTMMate",
    message: {
      mateConnectors: [
        {
          type: 66,
          typeName: "BTMMateConnector",
          message: {
            isHidden: true,
            implicit: true,
            featureType: "mateConnector",
            featureId: mateConnectorId1,
            name: "Origin connector",
            parameters: [
              {
                type: 145,
                typeName: "BTMParameterEnum",
                message: {
                  enumName: "Origin type",
                  value: "ON_ENTITY",
                  parameterId: "originType"
                }
              },
              {
                type: 67,
                typeName: "BTMParameterQueryWithOccurrenceList",
                message: {
                  queries: [
                    {
                      type: 157,
                      typeName: "BTMFeatureQueryWithOccurrence",
                      message: {
                        featureId: "Origin",
                        queryData: "ORIGIN_Z",
                        path: []
                      }
                    }
                  ],
                  parameterId: "originQuery"
                }
              }
            ],
            suppressed: false,
            subFeatures: []
          }
        },
        {
          type: 66,
          typeName: "BTMMateConnector",
          message: {
            isHidden: true,
            implicit: true,
            featureType: "mateConnector",
            featureId: mateConnectorId2,
            name: "Part connector",
            parameters: [
              {
                type: 145,
                typeName: "BTMParameterEnum",
                message: {
                  enumName: "Origin type",
                  value: "ON_ENTITY",
                  parameterId: "originType"
                }
              },
              {
                type: 67,
                typeName: "BTMParameterQueryWithOccurrenceList",
                message: {
                  queries: [
                    {
                      type: 1083,
                      typeName: "BTMInferenceQueryWithOccurrence",
                      message: {
                        inferenceType: "PART_ORIGIN",
                        geometryIds: [""],
                        path: [instanceId]
                      }
                    }
                  ],
                  parameterId: "originQuery"
                }
              }
            ],
            suppressed: false,
            subFeatures: []
          }
        }
      ],
      featureType: "mate",
      featureId: "fasten_to_origin_" + Date.now(),
      name: "Fasten to Origin",
      parameters: [
        {
          type: 145,
          typeName: "BTMParameterEnum",
          message: {
            enumName: "Mate type",
            value: "FASTENED",
            parameterId: "mateType"
          }
        },
        {
          type: 67,
          typeName: "BTMParameterQueryWithOccurrenceList",
          message: {
            queries: [
              {
                type: 157,
                typeName: "BTMFeatureQueryWithOccurrence",
                message: {
                  featureId: mateConnectorId1,
                  queryData: "",
                  path: []
                }
              },
              {
                type: 157,
                typeName: "BTMFeatureQueryWithOccurrence",
                message: {
                  featureId: mateConnectorId2,
                  queryData: "",
                  path: []
                }
              }
            ],
            parameterId: "mateConnectorsQuery"
          }
        }
      ],
      suppressed: false,
      subFeatures: []
    }
  };

  onshape.post({
    path: `/api/assemblies/d/${docId}/w/${workId}/e/${elementId}/features`,
    body: { feature: fastenedMate }
  }, (data, postErr) => {
    if (postErr) {
      console.log(`      Fasten to origin failed: ${JSON.parse(postErr.body).message}`);
      callback(null, postErr);
      return;
    }
    console.log(`      Fastened to origin successfully`);
    callback(data ? JSON.parse(data.toString()) : {});
  });
}

/**
 * Delete an element from a document
 */
function deleteElement(docId, workId, elementId, callback) {
  onshape.delete({
    path: `/api/elements/d/${docId}/w/${workId}/e/${elementId}`
  }, (_data, err) => {
    if (err) {
      console.log(`      (Element ${elementId} could not be deleted - may already be removed or in use)`);
    } else {
      console.log(`      Deleted element: ${elementId}`);
    }
    callback();
  });
}

/**
 * Update external references to latest versions
 *
 * This calls the latestdocumentreferences endpoint to update instances
 * that were created with old version IDs to point to the latest versions.
 * The `elements` parameter specifies which element(s) to update.
 */
function updateExternalReferences(docId, workId, elementId, callback) {
  console.log(`    Refreshing external references...`);
  onshape.post({
    path: `/api/v6/documents/d/${docId}/w/${workId}/e/${elementId}/latestdocumentreferences`,
    body: {
      elements: [elementId]
    }
  }, (data, err) => {
    if (err) {
      console.log(`      Warning: Could not refresh references: ${err.body || err}`);
      // Try fallback without elements parameter
      console.log(`      Trying fallback without elements parameter...`);
      onshape.post({
        path: `/api/v6/documents/d/${docId}/w/${workId}/e/${elementId}/latestdocumentreferences`,
        body: {}
      }, (data2, err2) => {
        if (err2) {
          console.log(`      Fallback also failed: ${err2.body || err2}`);
        } else {
          const response = data2 ? JSON.parse(data2.toString()) : {};
          console.log(`      Fallback response: ${JSON.stringify(response)}`);
        }
        callback();
      });
    } else {
      const response = data ? JSON.parse(data.toString()) : {};
      console.log(`      References refreshed: ${JSON.stringify(response)}`);
      callback();
    }
  });
}

/**
 * Main relink function - orchestrates the entire relink workflow
 *
 * @param {Object} assemblyInfo - Assembly document info
 *   {
 *     documentId: string,
 *     workspaceId: string,
 *     elementId: string,              // The assembly element ID (preferred)
 *     partStudioElements: string[],   // Part Studio element IDs created during import
 *     importedAssemblyElements?: string[], // Sub-assembly element IDs created during import
 *     zipPath?: string,               // Path to source ZIP for missing part detection
 *     elements?: Array<string>        // Legacy: array of all element IDs (deprecated)
 *   }
 * @param {Object} partMapping - Master part lookup (legacy fallback)
 *   {
 *     partNumber: {
 *       documentId: string,
 *       workspaceId: string,
 *       elementId: string,
 *       versionId?: string,
 *       filename: string
 *     }
 *   }
 * @param {Object} asmrefData - ASMREF lookup data (from lib/asmref.js)
 *   If provided, uses ASMREF for deterministic matching instead of partMapping.
 *   {
 *     byAssembly: { assemblyName: { linkFileName: entry } },
 *     byPartNumber: { partNumber: [assemblyNames] }
 *   }
 * @param {Function} callback - (report, error) => {}
 */
function relinkAssembly(assemblyInfo, partMapping, asmrefData, callback) {
  // Support legacy 3-argument signature (no asmrefData)
  if (typeof asmrefData === 'function') {
    callback = asmrefData;
    asmrefData = null;
  }
  const zipPath = assemblyInfo.zipPath;
  const docId = assemblyInfo.documentId;
  const workId = assemblyInfo.workspaceId;

  // Build filename lookup for master parts (case-insensitive)
  // Only index by filename - no part number fallback
  const filenameToMaster = {};
  Object.entries(partMapping).forEach(([partNumber, info]) => {
    const masterInfo = { partNumber, ...info };

    // Index by filename only (lowercase for case-insensitive matching)
    if (info.filename) {
      filenameToMaster[info.filename.toLowerCase()] = masterInfo;
      // Also without extension
      const baseFilename = info.filename.replace(/\.[^/.]+$/, '');
      filenameToMaster[baseFilename.toLowerCase()] = masterInfo;
    }
    // No part number indexing - filename match only
  });

  // DEBUG: Log available masters
  console.log(`  DEBUG: Available masters (${Object.keys(partMapping).length} total):`);
  Object.entries(partMapping).slice(0, 10).forEach(([pn, info]) => {
    console.log(`    ${pn}: filename=${info.filename} elementId=${info.elementId} versionId=${info.versionId || 'none'}`);
  });
  if (Object.keys(partMapping).length > 10) {
    console.log(`    ... and ${Object.keys(partMapping).length - 10} more`);
  }

  // Use elementId directly if provided (new format)
  if (assemblyInfo.elementId) {
    console.log(`  Relink: Using assembly element: ${assemblyInfo.elementId}`);
    // Get all elements for potential deletion
    onshape.get({
      path: `/api/documents/d/${docId}/w/${workId}/elements`
    }, (elemData, elemErr) => {
      if (elemErr) {
        callback(null, elemErr);
        return;
      }
      const allElements = JSON.parse(elemData.toString());
      // Use partStudioElements and importedAssemblyElements if provided
      const partStudioElements = assemblyInfo.partStudioElements || [];
      const assemblyElements = assemblyInfo.importedAssemblyElements || [];
      proceedWithRelink(assemblyInfo.elementId, allElements, partStudioElements, assemblyElements);
    });
    return;
  }

  // Legacy support: handle elements array
  if (Array.isArray(assemblyInfo.elements)) {
    if (typeof assemblyInfo.elements[0] === 'object') {
      const assemblyElement = assemblyInfo.elements.find(e => e.type === 'ASSEMBLY' || e.type === 'Assembly');
      if (!assemblyElement) {
        console.log(`  No assembly element found, skipping relink`);
        callback({ relinksPerformed: 0 });
        return;
      }
      const elementId = assemblyElement.elementId;
      onshape.get({
        path: `/api/documents/d/${docId}/w/${workId}/elements`
      }, (elemData, elemErr) => {
        if (elemErr) {
          callback(null, elemErr);
          return;
        }
        const allElements = JSON.parse(elemData.toString());
        // Legacy path - no known assembly elements
        proceedWithRelink(elementId, allElements, [], []);
      });
    } else {
      // Just element IDs - get them from API
      const elementIds = assemblyInfo.elements;
      onshape.get({
        path: `/api/documents/d/${docId}/w/${workId}/elements`
      }, (elemData, elemErr) => {
        if (elemErr) {
          callback(null, elemErr);
          return;
        }
        const allElements = JSON.parse(elemData.toString());
        const assemblyElem = allElements.find(e =>
          elementIds.includes(e.id) && e.type === 'Assembly'
        );
        if (!assemblyElem) {
          console.log(`  No assembly element found in elements: ${elementIds.join(', ')}`);
          callback({ relinksPerformed: 0, errors: 1 });
          return;
        }
        const partStudioElements = allElements
          .filter(e => elementIds.includes(e.id) && e.type === 'Part Studio')
          .map(e => e.id);
        // Derive assembly elements from elementIds (excluding main assembly)
        const assemblyElements = allElements
          .filter(e => elementIds.includes(e.id) && e.type === 'Assembly' && e.id !== assemblyElem.id)
          .map(e => e.id);
        proceedWithRelink(assemblyElem.id, allElements, partStudioElements, assemblyElements);
      });
    }
    return;
  }

  // No valid assembly info
  console.log(`  No assembly element info provided, skipping relink`);
  callback({ relinksPerformed: 0 });
  return;

  function proceedWithRelink(elementId, allElements, knownPartStudioElements, knownAssemblyElements = []) {
    console.log(`  Relink: Assembly element: ${elementId}`);

    // Get assembly definition
    getAssemblyDefinition(docId, workId, elementId, (definition) => {
      const instances = definition.rootAssembly?.instances || [];
      const occurrences = definition.rootAssembly?.occurrences || [];
      console.log(`  Relink: Found ${instances.length} instances`);

      // DEBUG: Log detailed instance info
      console.log(`  DEBUG: Instance details:`);
      instances.forEach((inst, idx) => {
        const isLocal = inst.documentId === docId;
        console.log(`    [${idx}] name="${inst.name}" type=${inst.type} isLocal=${isLocal}`);
        console.log(`        documentId=${inst.documentId} elementId=${inst.elementId}`);
        if (inst.partId) console.log(`        partId=${inst.partId}`);
        if (inst.isStandardContent) console.log(`        isStandardContent=${inst.isStandardContent}`);
      });

      // Derive assembly name from ZIP path for ASMREF lookups
      const assemblyBasename = zipPath ? path.basename(zipPath, '.zip') : null;
      const assemblyName = assemblyBasename ? assemblyBasename + '.SLDASM' : null;

      // Check if using ASMREF mode
      const useAsmref = !!(asmrefData && assemblyName);
      if (useAsmref) {
        console.log(`  Relink: Using ASMREF mode for assembly: ${assemblyName}`);
      }

      // Compare ZIP contents with imported instances to detect missing parts
      let missingFromZip = [];
      if (zipPath) {
        const zipParts = listSolidWorksFiles(zipPath);
        const mainAssemblyName = path.basename(zipPath, '.zip').toLowerCase();

        if (zipParts.length > 0) {
          // Filter out the main assembly file - it won't appear as an instance
          const componentParts = zipParts.filter(name => name !== mainAssemblyName);
          console.log(`  Relink: ZIP contains ${componentParts.length} component files (excluding main assembly)`);

          // Get instance names (cleaned, lowercase, without extension)
          const instanceNames = new Set();
          instances.forEach(inst => {
            const cleanName = inst.name.replace(/\s*<\d+>$/, '').replace(/\.[^/.]+$/, '').toLowerCase();
            instanceNames.add(cleanName);
          });

          // Find parts in ZIP that don't appear as instances
          missingFromZip = componentParts.filter(zipPart => {
            // The ZIP part name is already lowercase without extension
            return !instanceNames.has(zipPart);
          });

          if (missingFromZip.length > 0) {
            console.log(`  WARNING: ${missingFromZip.length} part(s) from ZIP not found in assembly:`);
            missingFromZip.forEach(part => {
              console.log(`    - ${part} (may have configuration mismatch in Pack & Go)`);
            });
          }
        }
      }

      // Build occurrence lookup by instance ID (path[0])
      const occurrenceByInstanceId = {};
      occurrences.forEach(occ => {
        if (occ.path && occ.path.length === 1) {
          occurrenceByInstanceId[occ.path[0]] = occ;
        }
      });

      // Phase A diagnostics: occurrence statistics
      const pathDepths = {};
      occurrences.forEach(occ => {
        const depth = occ.path ? occ.path.length : 0;
        pathDepths[depth] = (pathDepths[depth] || 0) + 1;
      });
      console.log(`  Occurrence statistics: ${occurrences.length} total`);
      Object.entries(pathDepths).sort((a, b) => a[0] - b[0]).forEach(([depth, count]) => {
        console.log(`    path.length=${depth}: ${count} occurrences`);
      });

      const partInstances = instances.filter(i => i.type !== 'Assembly');
      const asmInstances = instances.filter(i => i.type === 'Assembly');
      console.log(`  Instance types: ${partInstances.length} Part, ${asmInstances.length} Assembly`);

      // Log instances missing from occurrence lookup
      const missingOccInstances = instances.filter(i => !occurrenceByInstanceId[i.id]);
      if (missingOccInstances.length > 0) {
        console.log(`  WARNING: ${missingOccInstances.length} instance(s) have no direct occurrence (path.length=1):`);
        missingOccInstances.forEach(inst => {
          console.log(`    - "${inst.name}" (type=${inst.type}, id=${inst.id})`);
        });
      }

      // Derive transforms for assembly instances missing from occurrences
      deriveAssemblyTransforms(docId, workId, instances, occurrences, occurrenceByInstanceId, () => {

      // Track what we find
      const relinkReport = {
        relinksPerformed: 0,
        errors: 0,
        deletedElements: 0,
        missingFromZip: missingFromZip,
        localPartsKept: 0
      };

      // Instances to replace: { instanceId, master, transform }
      const instancesToReplace = [];
      // Local parts to keep (virtual parts or pending subassemblies): { instanceId, elementId, asmrefEntry }
      const localPartsToKeep = [];
      // Track Part Studios: elementId -> { matched: count, unmatched: count }
      const partStudioUsage = {};

      // Analyze each instance
      let asmrefError = null;
      instances.forEach(instance => {
        if (asmrefError) return; // Stop processing on error

        const instanceId = instance.id;
        const instanceDocId = instance.documentId;
        const instanceElementId = instance.elementId;
        const instanceName = instance.name;

        // Strip Onshape's instance suffix like " <1>" or " <2>" from the name
        const cleanName = instanceName.replace(/\s*<\d+>$/, '');
        // Also remove Onshape's duplicate suffix like " (1)" or " (2)"
        const cleanNameNoDupe = cleanName.replace(/\s*\(\d+\)$/, '');
        // Also remove file extension if present
        const baseName = cleanNameNoDupe.replace(/\.[^/.]+$/, '');

        // Determine type from instance (assembly API tells us)
        const isSubAssembly = instance.type === 'Assembly';
        const extension = isSubAssembly ? '.SLDASM' : '.SLDPRT';
        const linkFileName = baseName + extension;

        // Get transform from occurrences
        const occurrence = occurrenceByInstanceId[instanceId];
        const transform = normalizeTransform(occurrence?.transform);

        // If this instance is local (in the same document), it's a duplicate
        if (instanceDocId === docId && instanceElementId !== elementId) {
          // Initialize tracking for this Part Studio
          if (!partStudioUsage[instanceElementId]) {
            partStudioUsage[instanceElementId] = { matched: 0, unmatched: 0 };
          }

          // ASMREF mode: use ASMREF lookup for deterministic matching
          if (useAsmref) {
            const asmrefEntry = asmref.lookup(asmrefData, assemblyName, linkFileName);

            if (asmrefEntry && asmrefEntry.documentId) {
              // Has master IDs -> replace instance
              console.log(`    ASMREF match: ${instanceName} -> ${asmrefEntry.partNumber || linkFileName}`);

              instancesToReplace.push({
                instanceId: instanceId,
                instanceName: instanceName,
                master: {
                  documentId: asmrefEntry.documentId,
                  workspaceId: asmrefEntry.workspaceId,
                  elementId: asmrefEntry.elementId,
                  versionId: asmrefEntry.versionId,
                  partNumber: asmrefEntry.partNumber,
                  isAssembly: asmrefEntry.type === 'SLDASM'
                },
                transform: transform
              });
              partStudioUsage[instanceElementId].matched++;

            } else if (asmrefEntry && !asmrefEntry.documentId) {
              // No IDs (virtual part or pending subassembly) -> keep local
              const reason = asmrefEntry.isVirtual ? 'virtual' : 'pending';
              console.log(`    ASMREF keep (${reason}): ${instanceName}`);

              localPartsToKeep.push({
                instanceId: instanceId,
                instanceName: instanceName,
                elementId: instanceElementId,
                asmrefEntry: asmrefEntry
              });
              partStudioUsage[instanceElementId].unmatched++;

            } else {
              // No ASMREF entry found - let it get deleted with its Part Studio
              console.log(`    ASMREF missing (will be deleted): ${instanceName} (${linkFileName})`);
              partStudioUsage[instanceElementId].matched++;
            }

          } else {
            // Legacy mode: use filename-to-master lookup
            const master = filenameToMaster[cleanName.toLowerCase()] ||
              filenameToMaster[baseName.toLowerCase()];

            if (master) {
              console.log(`    Found duplicate: ${instanceName} -> master ${master.partNumber}`);

              instancesToReplace.push({
                instanceId: instanceId,
                instanceName: instanceName,
                master: master,
                transform: transform
              });
              partStudioUsage[instanceElementId].matched++;
            } else {
              // Log instances that are local but DON'T match any master (will be kept)
              console.log(`    NOT MATCHED (keeping): ${instanceName}`);
              partStudioUsage[instanceElementId].unmatched++;
            }
          }
        } else if (instanceDocId !== docId) {
          // External reference - already linked to another document (expected)
          console.log(`    External ref (already linked): ${instanceName}`);
        }
      });

      // Check for ASMREF errors
      if (asmrefError) {
        if (typeof callback === 'function') {
          callback(relinkReport, asmrefError);
        } else {
          console.error(`  Relink error (no callback): ${asmrefError.message}`);
        }
        return;
      }

      relinkReport.localPartsKept = localPartsToKeep.length;

      // Determine which Part Studios can be safely deleted
      // Must meet BOTH conditions:
      // 1. In knownPartStudioElements (imported during this session) - protects masters
      // 2. Have NO unmatched instances (no virtual parts or pending subassemblies)
      const elementsToDelete = new Set();
      const knownPartStudioSet = new Set(knownPartStudioElements);

      Object.entries(partStudioUsage).forEach(([elemId, usage]) => {
        const isKnownImport = knownPartStudioSet.has(elemId);

        if (usage.unmatched > 0) {
          // Has unmatched instances (virtual parts, etc.) - NEVER delete
          console.log(`    Part Studio ${elemId} has ${usage.unmatched} unmatched instance(s) - keeping`);
        } else if (usage.matched > 0) {
          // All instances matched - safe to delete IF it's a known import
          if (isKnownImport) {
            console.log(`    Marking imported Part Studio ${elemId} for deletion (${usage.matched} instances relinked)`);
            elementsToDelete.add(elemId);
          } else {
            // Not a known import - this is a MASTER, don't delete!
            console.log(`    Part Studio ${elemId} is a master (not in knownPartStudioElements) - keeping`);
          }
        }
      });

      // Warn about any known imports that weren't tracked in usage (shouldn't happen)
      knownPartStudioElements.forEach(elemId => {
        if (!partStudioUsage[elemId] && !elementsToDelete.has(elemId)) {
          console.log(`    WARNING: Known import ${elemId} not found in usage tracking`);
        }
      });

      // If nothing to relink, we're done
      if (instancesToReplace.length === 0) {
        console.log(`  Relink: No duplicates to relink`);
        callback(relinkReport);
        return;
      }

      console.log(`  Relink: Will replace ${instancesToReplace.length} instances`);

      // Step 1: Delete the old instances from the assembly
      const instanceIdsToDelete = instancesToReplace.map(i => i.instanceId);
      deleteInstances(docId, workId, elementId, instanceIdsToDelete, (_delResult, delErr) => {
        if (delErr) {
          console.error(`  Relink: Failed to delete instances: ${delErr.body || delErr}`);
          relinkReport.errors++;
          callback(relinkReport, delErr);
          return;
        }

        console.log(`    Deleted ${instanceIdsToDelete.length} instances`);

        // Wait for Onshape to finalize workspace changes after bulk deletion
        console.log(`    Waiting 2s for workspace to settle...`);
        setTimeout(() => {

        // Get initial list of instance IDs to track new ones
        getAssemblyDefinition(docId, workId, elementId, (initialDef) => {
          const knownInstanceIds = new Set((initialDef.rootAssembly?.instances || []).map(i => i.id));
          console.log(`    Starting with ${knownInstanceIds.size} existing instances`);

          // Step 2: Create ALL new instances in a SINGLE batched API call
          createInstancesBatch(docId, workId, elementId, instancesToReplace, (batchResult, batchErr) => {
            if (batchErr) {
              console.error(`    Failed to create instances: ${batchErr.body || batchErr}`);
              relinkReport.errors++;
              callback(relinkReport, batchErr);
              return;
            }

            relinkReport.relinksPerformed = batchResult.created;
            console.log(`    Created ${batchResult.created} new instances with transforms`);

            // Get updated assembly definition to find all new instance IDs
            getAssemblyDefinition(docId, workId, elementId, (updatedDef) => {
              const allInstances = updatedDef.rootAssembly?.instances || [];
              const newInstances = allInstances
                .filter(inst => !knownInstanceIds.has(inst.id));
              const newInstanceIds = newInstances.map(inst => inst.id);

              console.log(`    Found ${newInstanceIds.length} new instances for grouping`);
              proceedToGroupInstances(newInstanceIds, newInstances);
            });
          });

          // Step 3: Group all new instances and fasten first one to origin
          function proceedToGroupInstances(newInstanceIds, newInstances) {
            groupInstances(docId, workId, elementId, newInstanceIds, (_groupResult, groupErr) => {
              if (groupErr) {
                console.log(`      Warning: Could not create group`);
              }
              // Fasten first part instance to origin so the group can't move
              // PART_ORIGIN inference doesn't work on Assembly instances
              const firstPartInstance = newInstances.find(inst => inst.type !== 'Assembly');
              if (firstPartInstance) {
                fastenToOrigin(docId, workId, elementId, firstPartInstance.id, (_fastenResult, fastenErr) => {
                  if (fastenErr) {
                    console.log(`      Warning: Could not fasten to origin`);
                  }
                  proceedToDeleteElements();
                });
              } else if (newInstanceIds.length > 0) {
                console.log(`      Skipping fasten to origin (all instances are assemblies)`);
                proceedToDeleteElements();
              } else {
                proceedToDeleteElements();
              }
            });
          }

          // Step 4: Delete the duplicate elements (Part Studios and orphan Assemblies)
          function proceedToDeleteElements() {
            // Build element ID to name lookup for better logging
            const elementIdToName = {};
            allElements.forEach(elem => {
              elementIdToName[elem.id] = `${elem.name} (${elem.type})`;
            });

            // Find orphaned assembly elements to delete
            // Only delete assemblies that are in knownAssemblyElements (imported during this session)
            if (knownAssemblyElements.length > 0) {
              console.log(`    Using ${knownAssemblyElements.length} known imported assembly element(s) for deletion`);
              knownAssemblyElements.forEach(elemId => {
                if (elemId !== elementId) {  // Don't delete the main assembly we're relinking
                  const elemName = elementIdToName[elemId] || elemId;
                  console.log(`    Marking imported Assembly ${elemName} for deletion`);
                  elementsToDelete.add(elemId);
                }
              });
            } else {
              // No known assembly elements - skip assembly deletion entirely (safe default)
              console.log(`    No known imported assembly elements - skipping assembly deletion`);
            }

            const elementsArray = Array.from(elementsToDelete);

            // Log summary of what will be deleted
            if (elementsArray.length > 0) {
              console.log(`    Will delete ${elementsArray.length} duplicate elements:`);
              elementsArray.forEach(elemId => {
                const elemName = elementIdToName[elemId] || elemId;
                console.log(`      - ${elemName}`);
              });
            }

            let deleteIdx = 0;

            const deleteElementNext = () => {
              if (deleteIdx >= elementsArray.length) {
                // After deleting elements, refresh external references
                updateExternalReferences(docId, workId, elementId, () => {
                  // Include local parts info for property setting by caller
                  relinkReport.localPartsToKeep = localPartsToKeep;
                  callback(relinkReport);
                });
                return;
              }

              const elemToDelete = elementsArray[deleteIdx];
              const elemName = elementIdToName[elemToDelete] || elemToDelete;
              console.log(`    Deleting: ${elemName}`);

              deleteElement(docId, workId, elemToDelete, () => {
                relinkReport.deletedElements++;
                deleteIdx++;
                deleteElementNext();
              });
            };

            deleteElementNext();
          }
        });
        }, 2000); // end setTimeout after deletion
      });
      }); // end deriveAssemblyTransforms
    });
  }
}

// Export all functions
module.exports = {
  getAssemblyDefinition,
  deleteInstances,
  createVersion,
  createInstanceWithTransform,
  createInstancesBatch,
  getNewestInstance,
  groupInstances,
  fastenToOrigin,
  deleteElement,
  updateExternalReferences,
  relinkAssembly
};
