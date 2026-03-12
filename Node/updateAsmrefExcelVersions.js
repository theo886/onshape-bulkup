#!/usr/bin/env node
/**
 * Update ASMREF Excel with released version IDs from Onshape Revisions API
 *
 * Uses the revisions API to get the correct versionId for each part's release,
 * rather than just getting the latest document version (which may be newer).
 *
 * Uses adaptive rate limiting based on X-Rate-Limit-Remaining header
 *
 * Usage:
 *   node updateAsmrefExcelVersions.js
 *   node updateAsmrefExcelVersions.js --dry-run
 */

const fs = require('fs');
const XLSX = require('xlsx');
const onshape = require('./lib/onshape.js');

const ASMREF_EXCEL = './output/ASMREF.xlsx';
const COMPANY_ID = '6763516217765c31f9561958';

// Adaptive rate limiting settings
const MIN_DELAY_MS = 200;      // Minimum delay between requests
const MAX_DELAY_MS = 5000;     // Maximum delay when rate limit is low
const LOW_REMAINING_THRESHOLD = 10;  // Start slowing down when remaining drops below this

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

let currentDelay = MIN_DELAY_MS;

/**
 * Get the released version for a part number using the Revisions API
 * Returns the versionId where the part was actually released
 */
function getReleasedVersion(partNumber, elementType = 0, retryCount = 0) {
  return new Promise((resolve) => {
    // elementType: 0 = Part Studio, 1 = Assembly
    onshape.get({
      path: `/api/revisions/c/${COMPANY_ID}/p/${encodeURIComponent(partNumber)}/latest`,
      query: { et: elementType }
    }, (data, err, rateInfo) => {
      // Adjust delay based on rate limit remaining
      if (rateInfo && rateInfo.remaining !== undefined) {
        const remaining = parseInt(rateInfo.remaining, 10);
        if (remaining < LOW_REMAINING_THRESHOLD) {
          currentDelay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS + (LOW_REMAINING_THRESHOLD - remaining) * 500);
        } else {
          currentDelay = MIN_DELAY_MS;
        }
      }

      // Check for rate limit (429)
      if (err && err.statusCode === 429) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
        if (retryCount < 3) {
          console.log(`\n  Rate limited. Waiting ${retryAfter}s before retry...`);
          currentDelay = MAX_DELAY_MS;
          setTimeout(() => {
            getReleasedVersion(partNumber, elementType, retryCount + 1).then(resolve);
          }, retryAfter * 1000);
          return;
        } else {
          resolve({ partNumber, error: 'Rate limited after 3 retries', versionId: null });
          return;
        }
      }

      // 204 = No revisions found (not released)
      if (err && err.statusCode === 204) {
        resolve({ partNumber, error: 'Not released', versionId: null });
        return;
      }

      // 404 = Part number not found
      if (err && err.statusCode === 404) {
        resolve({ partNumber, error: 'Part not found', versionId: null });
        return;
      }

      if (err) {
        resolve({ partNumber, error: err.body || 'API error', versionId: null });
        return;
      }

      try {
        const revision = JSON.parse(data.toString());
        resolve({
          partNumber,
          versionId: revision.versionId,
          revision: revision.revision,
          documentId: revision.documentId,
          elementId: revision.elementId,
          rateRemaining: rateInfo?.remaining
        });
      } catch (e) {
        resolve({ partNumber, error: e.message, versionId: null });
      }
    });
  });
}

/**
 * Process part numbers sequentially with adaptive delays
 */
async function processSequentially(partNumbers) {
  const results = new Map();
  const total = partNumbers.length;

  for (let i = 0; i < partNumbers.length; i++) {
    const pn = partNumbers[i];
    const result = await getReleasedVersion(pn, 0);  // 0 = Part Studio
    results.set(pn, result);

    const pct = Math.round((i + 1) / total * 100);
    const rateInfo = result.rateRemaining !== undefined ? ` [rate: ${result.rateRemaining}]` : '';
    const status = result.versionId ? 'ok' : result.error;
    process.stdout.write(`\r  Progress: ${i + 1}/${total} (${pct}%) delay=${currentDelay}ms${rateInfo} [${status}]    `);

    // Wait before next request
    if (i < partNumbers.length - 1) {
      await new Promise(r => setTimeout(r, currentDelay));
    }
  }

  console.log();
  return results;
}

async function main() {
  console.log('=== Update ASMREF Excel Versions (Revisions API) ===\n');

  if (DRY_RUN) console.log('DRY RUN MODE\n');

  // 1. Load Excel
  console.log('1. Loading Excel...');
  if (!fs.existsSync(ASMREF_EXCEL)) {
    console.error(`   ERROR: ${ASMREF_EXCEL} not found`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(ASMREF_EXCEL);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  console.log(`   Loaded ${rows.length} rows from sheet: ${sheetName}`);

  // 2. Collect unique part numbers from Ref_Part_Number column (only SLDPRT with documentId)
  console.log('\n2. Collecting unique part numbers...');
  const partNumbers = new Set();
  const linkFileCol = 'Link File Name_';
  const partNumberCol = 'Ref_Part_Number';
  const docIdCol = 'onshape:documentId';
  const versionIdCol = 'onshape:versionId';
  const elementIdCol = 'onshape:elementId';

  let skippedNoPartNumber = 0;
  rows.forEach(row => {
    const docId = row[docIdCol];
    const linkFile = row[linkFileCol];
    const refPartNumber = row[partNumberCol];
    // Only process parts (.SLDPRT), not assemblies
    if (docId && linkFile && linkFile.toUpperCase().endsWith('.SLDPRT')) {
      if (refPartNumber && String(refPartNumber).trim()) {
        partNumbers.add(String(refPartNumber).trim());
      } else {
        skippedNoPartNumber++;
      }
    }
  });

  console.log(`   Found ${partNumbers.size} unique part numbers (SLDPRT only)`);
  if (skippedNoPartNumber > 0) {
    console.log(`   Skipped ${skippedNoPartNumber} rows with missing Ref_Part_Number`);
  }

  // 3. Fetch released versions from Revisions API
  console.log('\n3. Fetching released versions from Revisions API...');
  const versionResults = await processSequentially([...partNumbers]);

  // Count results and collect errors
  let found = 0, notFound = 0, notReleased = 0;
  const errorLog = [];
  versionResults.forEach((result, pn) => {
    if (result.versionId) {
      found++;
    } else if (result.error === 'Not released') {
      notReleased++;
      errorLog.push({ partNumber: pn, errorType: 'Not released', detail: null });
    } else {
      notFound++;
      errorLog.push({ partNumber: pn, errorType: 'Lookup failed', detail: result.error });
    }
  });
  console.log(`   Found: ${found}, Not released: ${notReleased}, Errors: ${notFound}`);

  // 4. Update rows (both versionId and elementId)
  console.log('\n4. Updating rows...');
  let updatedVersion = 0, updatedElement = 0, unchanged = 0, errors = 0, noLinkFile = 0;

  for (const row of rows) {
    const linkFile = row[linkFileCol];
    const docId = row[docIdCol];

    // Only update parts (.SLDPRT), skip assemblies
    if (!linkFile || !docId || !linkFile.toUpperCase().endsWith('.SLDPRT')) {
      noLinkFile++;
      continue;
    }

    const pn = row[partNumberCol] ? String(row[partNumberCol]).trim() : null;
    if (!pn) {
      noLinkFile++;
      continue;
    }

    const result = versionResults.get(pn);
    if (!result || !result.versionId) {
      errors++;
      continue;
    }

    let rowChanged = false;

    if (row[versionIdCol] !== result.versionId) {
      if (!DRY_RUN) row[versionIdCol] = result.versionId;
      updatedVersion++;
      rowChanged = true;
    }

    if (result.elementId && row[elementIdCol] !== result.elementId) {
      if (!DRY_RUN) row[elementIdCol] = result.elementId;
      updatedElement++;
      rowChanged = true;
    }

    if (!rowChanged) {
      unchanged++;
    }
  }

  console.log(`   Updated versionId: ${updatedVersion}`);
  console.log(`   Updated elementId: ${updatedElement}`);
  console.log(`   Unchanged: ${unchanged}`);
  console.log(`   Errors/Not released: ${errors}`);
  console.log(`   Skipped (no ID or assembly): ${noLinkFile}`);

  // 4b. Error summary
  if (errorLog.length > 0) {
    console.log(`\n   --- Error Summary (${errorLog.length} parts) ---`);
    for (const e of errorLog) {
      const detail = e.detail ? ` - ${e.detail}` : '';
      console.log(`   ${e.partNumber}: ${e.errorType}${detail}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No files written.');
    if (errorLog.length > 0) {
      const errorFile = './output/asmref_version_errors.json';
      fs.writeFileSync(errorFile, JSON.stringify(errorLog, null, 2));
      console.log(`Error log written to: ${errorFile}`);
    }
    return;
  }

  // 5. Write Excel
  console.log('\n5. Writing Excel...');
  const backup = ASMREF_EXCEL.replace('.xlsx', '_backup.xlsx');
  fs.copyFileSync(ASMREF_EXCEL, backup);
  console.log(`   Backup: ${backup}`);

  const newSheet = XLSX.utils.json_to_sheet(rows);
  workbook.Sheets[sheetName] = newSheet;
  XLSX.writeFile(workbook, ASMREF_EXCEL);
  console.log(`   Updated: ${ASMREF_EXCEL}`);

  // 6. Write error log
  if (errorLog.length > 0) {
    const errorFile = './output/asmref_version_errors.json';
    fs.writeFileSync(errorFile, JSON.stringify(errorLog, null, 2));
    console.log(`   Error log: ${errorFile}`);
  }

  console.log('\n=== Done ===');
  console.log('\nNext step: node convertAsmrefToJson.js');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
