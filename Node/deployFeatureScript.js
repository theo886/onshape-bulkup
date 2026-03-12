#!/usr/bin/env node
/**
 * Deploy FeatureScript to Onshape
 *
 * Pushes .fs files from a local directory to Feature Studios in an
 * Onshape document. Uses content hashing for idempotency — unchanged
 * files are skipped unless --force is set.
 *
 * Usage:
 *   node deployFeatureScript.js --dry-run
 *   node deployFeatureScript.js
 *   node deployFeatureScript.js -d <otherDocId> --force
 *
 * Options:
 *   -i <path>         Input directory with .fs files (default: ./featurescript/)
 *   -d <docId>        Target Onshape document ID (default: enterprise library)
 *   -w <workspaceId>  Workspace ID (auto-detected if omitted)
 *   --dry-run         Preview without making API calls
 *   --force           Re-deploy even if content hash unchanged
 *   -s <path>         Sidecar JSON path (default: deploy_status.json)
 *   -h                Show help
 */

const fs = require('fs');
const crypto = require('crypto');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

// Default enterprise FeatureScript library document
const DEFAULT_DOC_ID = 'bd586d0d7bf2ddf0b3815a76';

// Adaptive rate limiting
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 5000;
const LOW_REMAINING_THRESHOLD = 10;

let currentDelay = MIN_DELAY_MS;

function adjustDelay(rateInfo) {
  if (rateInfo && rateInfo.remaining !== undefined) {
    const remaining = parseInt(rateInfo.remaining, 10);
    if (remaining < LOW_REMAINING_THRESHOLD) {
      currentDelay = MAX_DELAY_MS;
    } else if (remaining > 50) {
      currentDelay = MIN_DELAY_MS;
    } else {
      currentDelay = Math.round(MIN_DELAY_MS + (MAX_DELAY_MS - MIN_DELAY_MS) * (1 - remaining / 50));
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Promisified onshape.get with 429 retry
function getAsync(opts, retryCount = 0) {
  return new Promise((resolve, reject) => {
    onshape.get(opts, (data, err, rateInfo) => {
      adjustDelay(rateInfo);
      if (err) {
        if (err.statusCode === 429 && retryCount < 3) {
          const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
          console.log(`  Rate limited. Waiting ${retryAfter}s before retry (attempt ${retryCount + 1}/3)...`);
          currentDelay = MAX_DELAY_MS;
          setTimeout(() => {
            getAsync(opts, retryCount + 1).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

// Promisified onshape.post with 429 retry (no rateInfo from post)
function postAsync(opts, retryCount = 0) {
  return new Promise((resolve, reject) => {
    onshape.post(opts, (data, err) => {
      if (err) {
        if (err.statusCode === 429 && retryCount < 3) {
          const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
          console.log(`  Rate limited. Waiting ${retryAfter}s before retry (attempt ${retryCount + 1}/3)...`);
          currentDelay = MAX_DELAY_MS;
          setTimeout(() => {
            postAsync(opts, retryCount + 1).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function computeHash(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function loadSidecar(filePath) {
  const defaultStatus = {
    targetDocumentId: null,
    targetWorkspaceId: null,
    deployments: {}
  };

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return { ...defaultStatus, ...JSON.parse(data) };
    } catch (e) {
      console.warn('Warning: Could not parse sidecar file, starting fresh');
      return defaultStatus;
    }
  }
  return defaultStatus;
}

function saveSidecar(filePath, sidecar) {
  fs.writeFileSync(filePath, JSON.stringify(sidecar, null, 2));
}

function showUsage() {
  console.log('\nDeploy FeatureScript to Onshape\n');
  console.log('Usage: node deployFeatureScript.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>         Input directory with .fs files (default: ./featurescript/)');
  console.log('  -d <docId>        Target Onshape document ID (default: enterprise library)');
  console.log('  -w <workspaceId>  Workspace ID (auto-detected if omitted)');
  console.log('  --dry-run         Preview without making API calls');
  console.log('  --force           Re-deploy even if content hash unchanged');
  console.log('  -s <path>         Sidecar JSON path (default: deploy_status.json)');
  console.log('  -h, --help        Show this help\n');
  console.log('Examples:');
  console.log('  node deployFeatureScript.js                    # deploy to enterprise library');
  console.log('  node deployFeatureScript.js --dry-run           # preview');
  console.log('  node deployFeatureScript.js -d <otherDoc>       # deploy to a different document');
  console.log('  node deployFeatureScript.js --force\n');
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const docId = argv.d || DEFAULT_DOC_ID;
  const inputDir = argv.i || './featurescript/';
  const dryRun = argv['dry-run'] || false;
  const force = argv.force || false;
  const sidecarPath = argv.s || 'deploy_status.json';

  if (!argv.d) {
    console.log(`Using default enterprise library: ${DEFAULT_DOC_ID}`);
  }

  if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  // Find all .fs files
  const fsFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.fs'));

  if (fsFiles.length === 0) {
    console.error(`Error: No .fs files found in ${inputDir}`);
    process.exit(1);
  }

  console.log('=== Deploy FeatureScript to Onshape ===\n');
  if (dryRun) console.log('DRY RUN MODE\n');
  if (force) console.log('FORCE MODE — will re-deploy all files\n');

  console.log(`1. Found ${fsFiles.length} .fs file(s) in ${inputDir}`);
  fsFiles.forEach(f => console.log(`   - ${f}`));

  // Load sidecar
  const sidecar = loadSidecar(sidecarPath);
  console.log(`\n2. Sidecar: ${sidecarPath}`);

  // Auto-detect workspace if not provided
  let workspaceId = argv.w || null;

  if (!workspaceId && !dryRun) {
    console.log('\n3. Auto-detecting workspace...');
    try {
      const wsData = await getAsync({
        path: `/api/documents/d/${docId}/workspaces`
      });
      const workspaces = JSON.parse(wsData.toString());
      if (!Array.isArray(workspaces) || workspaces.length === 0) {
        console.error('   Error: No workspaces found for document');
        process.exit(1);
      }
      workspaceId = workspaces[0].id;
      console.log(`   Workspace: ${workspaceId} (${workspaces[0].name})`);
    } catch (err) {
      console.error('   Error fetching workspaces:', err.body || err.message || err);
      process.exit(1);
    }
    await sleep(currentDelay);
  } else if (dryRun) {
    console.log('\n3. Workspace: (skipped in dry-run)');
    workspaceId = workspaceId || '(auto-detect)';
  } else {
    console.log(`\n3. Workspace: ${workspaceId}`);
  }

  // Update sidecar with target info
  sidecar.targetDocumentId = docId;
  if (workspaceId && workspaceId !== '(auto-detect)') {
    sidecar.targetWorkspaceId = workspaceId;
  }

  // List existing elements in document
  let existingElements = [];
  if (!dryRun) {
    console.log('\n4. Listing existing elements...');
    try {
      const elemData = await getAsync({
        path: `/api/documents/d/${docId}/w/${workspaceId}/elements`
      });
      existingElements = JSON.parse(elemData.toString());
      const featureStudios = existingElements.filter(e => e.elementType === 'FEATURESTUDIO');
      console.log(`   ${existingElements.length} total elements, ${featureStudios.length} Feature Studio(s)`);
      if (featureStudios.length > 0) {
        featureStudios.forEach(fs => console.log(`   - "${fs.name}" (${fs.id})`));
      }
    } catch (err) {
      console.error('   Error listing elements:', err.body || err.message || err);
      process.exit(1);
    }
    await sleep(currentDelay);
  } else {
    console.log('\n4. Element listing: (skipped in dry-run)');
  }

  // Deploy each .fs file
  console.log(`\n5. Deploying ${fsFiles.length} file(s)...\n`);
  let deployed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < fsFiles.length; i++) {
    const filename = fsFiles[i];
    const studioName = filename.replace(/\.fs$/, '');
    const filePath = pathModule.join(inputDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const contentHash = computeHash(content);

    // Check if content is unchanged
    const priorDeployment = sidecar.deployments[filename];
    if (priorDeployment && priorDeployment.contentHash === contentHash && !force) {
      skipped++;
      console.log(`  [${i + 1}/${fsFiles.length}] ${filename} — skipped (unchanged)`);
      continue;
    }

    if (dryRun) {
      const action = priorDeployment ? 'would update' : 'would create';
      console.log(`  [${i + 1}/${fsFiles.length}] ${filename} — ${action} Feature Studio "${studioName}"`);
      console.log(`     Hash: ${contentHash}`);
      console.log(`     Size: ${content.length} chars`);
      deployed++;
      continue;
    }

    try {
      // Find existing Feature Studio by name
      let elementId = priorDeployment?.elementId || null;

      if (!elementId) {
        const match = existingElements.find(
          e => e.elementType === 'FEATURESTUDIO' && e.name === studioName
        );
        if (match) {
          elementId = match.id;
        }
      }

      // Create Feature Studio if it doesn't exist
      if (!elementId) {
        console.log(`  [${i + 1}/${fsFiles.length}] ${filename} — creating Feature Studio "${studioName}"...`);
        const createData = await postAsync({
          resource: 'featurestudios',
          d: docId,
          w: workspaceId,
          body: { name: studioName }
        });
        const createResult = JSON.parse(createData.toString());
        elementId = createResult.id;
        if (!elementId) {
          throw new Error('No id in create response: ' + JSON.stringify(createResult).substring(0, 200));
        }
        console.log(`     Created: ${elementId}`);
        await sleep(currentDelay);
      }

      // Update Feature Studio contents
      console.log(`  [${i + 1}/${fsFiles.length}] ${filename} — updating contents...`);
      await postAsync({
        path: `/api/featurestudios/d/${docId}/w/${workspaceId}/e/${elementId}`,
        body: {
          btType: 'BTFeatureStudioContents-2239',
          contents: content
        }
      });

      // Save to sidecar
      sidecar.deployments[filename] = {
        elementId: elementId,
        contentHash: contentHash,
        lastDeployed: new Date().toISOString()
      };
      saveSidecar(sidecarPath, sidecar);

      deployed++;
      console.log(`     Deployed successfully (delay=${currentDelay}ms)`);

    } catch (err) {
      const errMsg = err.body || err.message || String(err);
      console.error(`  [${i + 1}/${fsFiles.length}] ${filename} — ERROR: ${errMsg}`);
      errors++;
    }

    // Delay between files
    if (i < fsFiles.length - 1) {
      await sleep(currentDelay);
    }
  }

  // Save final sidecar
  if (!dryRun) {
    saveSidecar(sidecarPath, sidecar);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Total files: ${fsFiles.length}`);
  console.log(`  Deployed: ${deployed}`);
  console.log(`  Skipped (unchanged): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  if (dryRun) console.log('\n  [DRY RUN] No API calls made.');
  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
