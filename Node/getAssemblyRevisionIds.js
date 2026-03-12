#!/usr/bin/env node
/**
 * Get Assembly Revision IDs from Excel
 *
 * Reads an Excel file, queries the Onshape Revision API by part number
 * for each row, and fills in missing revisionId / versionId / documentId / elementId.
 *
 * For rows that already have IDs, compares against the API and flags
 * mismatches (overwriting with the API value as source of truth).
 *
 * Usage:
 *   node getAssemblyRevisionIds.js -i input.xlsx --dry-run
 *   node getAssemblyRevisionIds.js -i input.xlsx
 *   node getAssemblyRevisionIds.js -i input.xlsx --level 2    # Only uploadLevel=2 rows
 *
 * Excel columns read:
 *   uploadLevel              Optional filter (use --level to restrict)
 *   property:Part number     Used to query Revision API
 *   onshape:revisionId       Filled / verified
 *   onshape:versionId        Filled / verified
 *   onshape:documentId       Verified (not overwritten — just warned)
 *   onshape:elementId        Verified (not overwritten — just warned)
 *
 * Output:
 *   <input>_completed.xlsx   Updated Excel with IDs filled in
 */

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

const COMPANY_ID = '6763516217765c31f9561958';

// Adaptive rate limiting
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 5000;
const LOW_REMAINING_THRESHOLD = 10;

let currentDelay = MIN_DELAY_MS;

// Promisified onshape.get with 429 retry and adaptive rate limiting
function getAsync(opts, retryCount = 0) {
  return new Promise((resolve, reject) => {
    onshape.get(opts, (data, err, rateInfo) => {
      if (err) {
        // Handle 429 rate limit
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

      // Adaptive delay based on rate limit remaining
      if (rateInfo && rateInfo.remaining !== undefined) {
        if (rateInfo.remaining < LOW_REMAINING_THRESHOLD) {
          currentDelay = MAX_DELAY_MS;
        } else if (currentDelay > MIN_DELAY_MS) {
          currentDelay = Math.max(MIN_DELAY_MS, currentDelay - 200);
        }
      }

      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      resolve(parsed);
    });
  });
}

function showUsage() {
  console.log('\nGet Assembly Revision IDs\n');
  console.log('Usage: node getAssemblyRevisionIds.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>       Input Excel file (required)');
  console.log('  --level <n>     Only process rows with this uploadLevel (default: all rows)');
  console.log('  --element-type <n>  Revision API elementType: 0=Part Studio, 1=Assembly (default: 1)');
  console.log('  --dry-run       Show what would be processed, no API calls or writes');
  console.log('  -h, --help      Show this help\n');
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const excelFile = argv.i;
  const dryRun = argv['dry-run'] || false;
  const levelFilter = argv.level !== undefined ? String(argv.level) : null;
  const elementType = argv['element-type'] !== undefined ? parseInt(argv['element-type'], 10) : 1;
  const elementTypeLabel = elementType === 0 ? 'Part Studio' : elementType === 1 ? 'Assembly' : `type ${elementType}`;

  if (!excelFile) {
    console.error('Error: -i <input.xlsx> is required');
    showUsage();
    process.exit(1);
  }

  if (!fs.existsSync(excelFile)) {
    console.error(`Error: Excel file not found: ${excelFile}`);
    process.exit(1);
  }

  console.log('=== Get Revision IDs ===\n');
  console.log(`   Element type: ${elementTypeLabel} (${elementType})`);
  if (dryRun) console.log('DRY RUN MODE — no API calls, no file writes\n');

  // Step 1: Read Excel
  console.log(`1. Reading Excel: ${excelFile}`);
  const workbook = xlsx.readFile(excelFile);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const allData = xlsx.utils.sheet_to_json(worksheet);

  console.log(`   ${allData.length} total rows, sheet: "${sheetName}"`);

  // Step 2: Filter rows
  const targetIndices = [];
  allData.forEach((row, idx) => {
    if (levelFilter === null || String(row['uploadLevel']) === levelFilter) {
      targetIndices.push(idx);
    }
  });

  const filterLabel = levelFilter !== null ? `uploadLevel === ${levelFilter}` : 'all rows';
  console.log(`   ${targetIndices.length} rows matching ${filterLabel}\n`);

  if (targetIndices.length === 0) {
    console.log('No matching rows found. Nothing to do.');
    return;
  }

  // Categorize
  const missingRevId = targetIndices.filter(i => !allData[i]['onshape:revisionId']);
  const hasRevId = targetIndices.filter(i => allData[i]['onshape:revisionId']);
  console.log(`   ${hasRevId.length} already have revisionId`);
  console.log(`   ${missingRevId.length} missing revisionId\n`);

  if (dryRun) {
    console.log(`[DRY RUN] Would query Revision API for ${targetIndices.length} rows.`);
    console.log(`  API: GET /api/v13/revisions/c/{cid}/partnumber/{pnum}?elementType=${elementType}`);
    console.log('\nSample part numbers:');
    for (let k = 0; k < Math.min(10, targetIndices.length); k++) {
      const row = allData[targetIndices[k]];
      const pn = row['property:Part number'];
      const hasId = row['onshape:revisionId'] ? 'has revisionId' : 'MISSING revisionId';
      console.log(`  ${pn} — ${hasId}`);
    }
    console.log(`\n[DRY RUN] No API calls made. No file written.`);
    return;
  }

  // Step 3: Query Revision API for each L2 row
  console.log('2. Querying Revision API for each assembly...\n');

  let filled = 0;
  let verified = 0;
  let mismatched = 0;
  let notFound = 0;
  let errors = 0;

  for (let k = 0; k < targetIndices.length; k++) {
    const idx = targetIndices[k];
    const row = allData[idx];
    const partNumber = String(row['property:Part number'] || '').trim();

    if (!partNumber) {
      console.log(`  [${k + 1}/${targetIndices.length}] Row ${idx + 2}: no part number, skipping`);
      errors++;
      continue;
    }

    const pct = Math.round((k + 1) / targetIndices.length * 100);
    const prefix = `  [${k + 1}/${targetIndices.length} ${pct}%] ${partNumber}`;

    try {
      const revData = await getAsync({
        path: `/api/v13/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`,
        query: { elementType }
      });

      // API returns a single BTRevisionInfo object for getRevisionByPartNumber
      if (!revData || !revData.id) {
        console.log(`${prefix}: NOT FOUND (no revision)`);
        notFound++;
        continue;
      }

      const apiRevisionId = revData.id;
      const apiVersionId = revData.versionId || null;
      const apiDocumentId = revData.documentId || null;
      const apiElementId = revData.elementId || null;

      const existingRevisionId = row['onshape:revisionId'] || null;
      const existingVersionId = row['onshape:versionId'] || null;

      // Fill elementId from revision API if missing
      if (!row['onshape:elementId'] && apiElementId) {
        row['onshape:elementId'] = apiElementId;
      }

      if (!existingRevisionId) {
        // Fill missing IDs
        row['onshape:revisionId'] = apiRevisionId;
        if (apiVersionId) row['onshape:versionId'] = apiVersionId;
        console.log(`${prefix}: FILLED revisionId=${apiRevisionId} elementId=${apiElementId || '(none)'}`);
        filled++;
      } else {
        // Verify existing IDs
        let hasMismatch = false;

        if (existingRevisionId !== apiRevisionId) {
          console.log(`${prefix}: MISMATCH revisionId excel=${existingRevisionId} api=${apiRevisionId}`);
          row['onshape:revisionId'] = apiRevisionId;
          hasMismatch = true;
        }

        if (existingVersionId && apiVersionId && existingVersionId !== apiVersionId) {
          console.log(`${prefix}: MISMATCH versionId excel=${existingVersionId} api=${apiVersionId}`);
          row['onshape:versionId'] = apiVersionId;
          hasMismatch = true;
        } else if (!existingVersionId && apiVersionId) {
          row['onshape:versionId'] = apiVersionId;
          hasMismatch = true;
        }

        // Check documentId/elementId (warn only, don't overwrite)
        if (apiDocumentId && row['onshape:documentId'] && row['onshape:documentId'] !== apiDocumentId) {
          console.log(`${prefix}: MISMATCH documentId excel=${row['onshape:documentId']} api=${apiDocumentId}`);
        }
        if (apiElementId && row['onshape:elementId'] && row['onshape:elementId'] !== apiElementId) {
          console.log(`${prefix}: MISMATCH elementId excel=${row['onshape:elementId']} api=${apiElementId}`);
        }

        if (hasMismatch) {
          mismatched++;
        } else {
          verified++;
          // Only log every 50th verified row to reduce noise
          if (k % 50 === 0) {
            console.log(`${prefix}: OK (verified)`);
          }
        }
      }

    } catch (err) {
      const statusCode = err.statusCode || '';
      const errMsg = err.body || err.message || String(err);

      // 404 means no revision exists for this part number
      if (statusCode === 404) {
        console.log(`${prefix}: NOT FOUND (404)`);
        notFound++;
      } else {
        console.log(`${prefix}: ERROR ${statusCode} — ${String(errMsg).substring(0, 120)}`);
        errors++;
      }
    }

    // Adaptive delay between requests
    if (k < targetIndices.length - 1) {
      await new Promise(r => setTimeout(r, currentDelay));
    }
  }

  // Step 3b: For rows still missing elementId, query document elements API
  const missingElemIndices = targetIndices.filter(i =>
    !allData[i]['onshape:elementId'] && allData[i]['onshape:documentId'] && allData[i]['onshape:workspaceId']
  );

  if (missingElemIndices.length > 0) {
    console.log(`\n3. Querying Document Elements API for ${missingElemIndices.length} rows missing elementId...\n`);

    let elemFilled = 0;
    let elemNotFound = 0;
    let elemErrors = 0;

    for (let k = 0; k < missingElemIndices.length; k++) {
      const idx = missingElemIndices[k];
      const row = allData[idx];
      const docId = row['onshape:documentId'];
      const wsId = row['onshape:workspaceId'];
      const partNumber = String(row['property:Part number'] || '').trim();
      const fileName = String(row['File Name'] || '').trim();

      const pct = Math.round((k + 1) / missingElemIndices.length * 100);
      const prefix = `  [${k + 1}/${missingElemIndices.length} ${pct}%] ${partNumber}`;

      try {
        const elemTypeFilter = elementType === 0 ? 'PARTSTUDIO' : 'ASSEMBLY';
        const elements = await getAsync({
          path: `/api/v6/documents/d/${docId}/w/${wsId}/elements`,
          query: { elementType: elemTypeFilter }
        });

        if (!elements || !Array.isArray(elements) || elements.length === 0) {
          console.log(`${prefix}: NO ${elemTypeFilter} ELEMENTS in document`);
          elemNotFound++;
          continue;
        }

        // If only one assembly, use it. Otherwise match by name.
        let match = null;
        if (elements.length === 1) {
          match = elements[0];
        } else {
          // Try matching by filename stem
          const stem = fileName.replace(/\.[^.]+$/, '');
          match = elements.find(e => e.name === stem || e.name === fileName);
          if (!match) {
            // Show what's available
            console.log(`${prefix}: ${elements.length} assemblies, no name match for "${stem}"`);
            elements.forEach(e => console.log(`    - ${e.name} (${e.id})`));
            elemNotFound++;
            continue;
          }
        }

        row['onshape:elementId'] = match.id;
        console.log(`${prefix}: FILLED elementId=${match.id} (${match.name})`);
        elemFilled++;

      } catch (err) {
        const statusCode = err.statusCode || '';
        console.log(`${prefix}: ERROR ${statusCode}`);
        elemErrors++;
      }

      if (k < missingElemIndices.length - 1) {
        await new Promise(r => setTimeout(r, currentDelay));
      }
    }

    console.log(`\n   Elements pass: ${elemFilled} filled, ${elemNotFound} not found, ${elemErrors} errors`);
  }

  // Step 4: Write output Excel
  console.log('\n3. Writing output...');
  const ext = pathModule.extname(excelFile);
  const base = pathModule.basename(excelFile, ext);
  const dir = pathModule.dirname(excelFile);
  const outputPath = pathModule.join(dir, `${base}_completed${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(allData);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);

  // Preserve other sheets
  for (let s = 1; s < workbook.SheetNames.length; s++) {
    const otherName = workbook.SheetNames[s];
    xlsx.utils.book_append_sheet(newWorkbook, workbook.Sheets[otherName], otherName);
  }

  xlsx.writeFile(newWorkbook, outputPath);
  console.log(`   Output: ${outputPath}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Total rows:       ${targetIndices.length}`);
  console.log(`  Filled (new):     ${filled}`);
  console.log(`  Verified (match): ${verified}`);
  console.log(`  Mismatched:       ${mismatched}`);
  console.log(`  Not found:        ${notFound}`);
  console.log(`  Errors:           ${errors}`);
  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
