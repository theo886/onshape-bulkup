#!/usr/bin/env node
/**
 * pdmSync4-release.js
 * Stage 4 of PDM Release Sync pipeline.
 *
 * Obsoletes old revisions (same-rev only) and releases all items.
 * Processes rows in sync:level order.
 *
 * Usage:
 *   node pdmSync4-release.js -i pdm_releases_s3.xlsx [-o pdm_releases_s4.xlsx]
 *                             [-s pdm_sync4_status.json] [--dry-run]
 */

'use strict';

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');
const app = require('./lib/app.js');
const { COMPANY_ID } = require('./unifiedUpload.js');

const OBSOLETION_WORKFLOW_ID = '59fb015cbd51842cc4706f59';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 's'],
  boolean: ['dry-run', 'h', 'help'],
  alias: { i: 'input', o: 'output', s: 'status', h: 'help' }
});

if (args.help || !args.input) {
  console.log(`
PDM Release Sync - Stage 4: Release

Obsoletes old revisions (same-rev) and releases all items.

Usage: node pdmSync4-release.js -i pdm_releases_s3.xlsx [options]

Options:
  -i, --input     Stage 3 output Excel file (required)
  -o, --output    Output Excel file (default: pdm_releases_s4.xlsx)
  -s, --status    Status JSON sidecar (default: pdm_sync4_status.json)
  --dry-run       Show what would be done without executing
  -h, --help      Show this help

Output columns added:
  sync:versionId       Onshape version ID after release
  sync:releaseStatus   done / failed
  sync:releaseError    Error message if failed
`);
  process.exit(0);
}

const inputFile = args.input;
const outputFile = args.output || 'pdm_releases_s4.xlsx';
const statusFile = args.status || 'pdm_sync4_status.json';
const dryRun = args['dry-run'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const MIN_DELAY = 200;
const MAX_DELAY = 5000;
let currentDelay = MIN_DELAY;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Promisified API helpers ──────────────────────────────────────────────────

function apiGet(apiPath, query) {
  return new Promise((resolve, reject) => {
    const opts = { path: apiPath };
    if (query) opts.query = query;
    onshape.get(opts, (data, err, rateInfo) => {
      if (err) { reject(err); return; }
      if (rateInfo && rateInfo.remaining !== undefined) {
        if (rateInfo.remaining < 10) currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
        else if (rateInfo.remaining > 50) currentDelay = Math.max(Math.floor(currentDelay * 0.9), MIN_DELAY);
      }
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Parse error: ' + e.message)); }
    });
  });
}

function apiPost(apiPath, body, query) {
  return new Promise((resolve, reject) => {
    onshape.post({ path: apiPath, body, query }, (data, err) => {
      if (err) reject(err);
      else {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      }
    });
  });
}

function extractError(err) {
  if (!err) return '';
  if (err.body) {
    try { const p = JSON.parse(err.body); return p.message || p.error || err.body; }
    catch (e) { return String(err.body); }
  }
  return err.statusCode ? `HTTP ${err.statusCode}` : String(err);
}

// ─── Status sidecar ───────────────────────────────────────────────────────────

let status = { fileStatus: {} };

function loadStatus() {
  if (fs.existsSync(statusFile)) {
    try {
      status = { ...status, ...JSON.parse(fs.readFileSync(statusFile, 'utf8')) };
      console.log(`Loaded sidecar: ${Object.keys(status.fileStatus).length} processed rows`);
    } catch (e) {
      console.warn('Warning: Could not parse sidecar, starting fresh');
    }
  }
}

function saveStatus() {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

// ─── Workflow ID ──────────────────────────────────────────────────────────────

let workflowId = null;

async function getWorkflowId() {
  return new Promise((resolve, reject) => {
    app.getCompanyPolicies(COMPANY_ID, (data, err) => {
      if (err) {
        console.warn(`Warning: Could not get workflow ID: ${extractError(err)}`);
        resolve(null);
        return;
      }
      try {
        const policies = JSON.parse(data.toString());
        resolve(policies.releaseWorkflowId);
      } catch (e) {
        console.warn('Warning: Could not parse company policies');
        resolve(null);
      }
    });
  });
}

// ─── Obsoletion (from replaceFromExcel.js) ─────────────────────────────────

/**
 * Obsolete a revision with re-releasable flag.
 * Returns true if obsoletion succeeded (or already obsolete+rereleasable).
 */
async function obsoleteRevision(partNumber) {
  console.log(`  Obsoleting current revision for ${partNumber}...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would obsolete revision`);
    return true;
  }

  try {
    // Get revision info
    await delay(currentDelay);
    const revision = await apiGet(
      `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`
    );

    if (!revision || !revision.id) {
      console.warn(`  Warning: Could not find revision for ${partNumber}`);
      return false;
    }

    console.log(`  Found revision ${revision.revision} (id: ${revision.id})`);
    console.log(`    isObsolete: ${revision.isObsolete}, isRereleasable: ${revision.isRereleasable}`);

    // Already obsolete and re-releasable — good to go
    if (revision.isObsolete && revision.isRereleasable) {
      console.log(`  Already obsolete and re-releasable — OK`);
      return true;
    }

    // Obsolete but NOT re-releasable — cannot proceed
    if (revision.isObsolete && !revision.isRereleasable) {
      console.error(`  Revision is obsolete but NOT re-releasable — cannot reuse revision`);
      return false;
    }

    // Not obsolete — need to obsolete it
    console.log(`  Creating obsoletion package...`);
    await delay(currentDelay);
    const pkg = await apiPost(
      `/api/v10/releasepackages/obsoletion/${OBSOLETION_WORKFLOW_ID}`,
      null,
      { revisionId: revision.id }
    );

    console.log(`  Obsoletion package: ${pkg.id}`);

    // Submit with re-releasable flag
    await delay(currentDelay);
    await apiPost(
      `/api/v10/releasepackages/${pkg.id}`,
      {
        properties: [
          { propertyId: '594964b7040fc85d2b418138', value: `PDM Sync: ${partNumber}` },
          { propertyId: 'os-mark-rereleasable', value: true }
        ]
      },
      { wfaction: 'CREATE_AND_OBSOLETE' }
    );

    console.log(`  Obsoleted (re-releasable: true)`);
    return true;

  } catch (e) {
    const errMsg = extractError(e);

    // Handle "already obsoleted" messages
    if (errMsg.includes('already been obsoleted') || errMsg.includes('already obsoleted')) {
      console.log(`  Revision already obsoleted — checking re-releasable status...`);
      try {
        const rev = await apiGet(
          `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`
        );
        if (rev && rev.isRereleasable) {
          console.log(`  Confirmed re-releasable — OK`);
          return true;
        }
        console.error(`  Revision is obsolete but NOT re-releasable`);
        return false;
      } catch (e2) {
        console.log(`  Assuming re-releasable (could not verify)`);
        return true;
      }
    }

    // Workflow state error
    if (errMsg.includes('not valid for the current state')) {
      console.error(`  Workflow error: ${errMsg}`);
      console.error(`  Check Onshape UI for pending obsoletion packages`);
      return false;
    }

    console.error(`  Obsoletion error: ${errMsg}`);
    return false;
  }
}

// ─── Release ─────────────────────────────────────────────────────────────────

/**
 * Release an element with the specified revision number.
 * Returns { versionId } on success, null on failure.
 */
async function releaseElement(docId, workId, elementId, partNumber, revision) {
  if (!workflowId) {
    console.error(`  Cannot release: no workflow ID`);
    return null;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would release ${partNumber} at revision ${revision}`);
    return { versionId: 'dry-run' };
  }

  console.log(`  Releasing: ${partNumber} at revision ${revision}`);

  // Create release package
  await delay(currentDelay);
  const releaseItems = [{
    elementId: elementId,
    documentId: docId,
    workspaceId: workId
  }];

  let pkg;
  try {
    pkg = await apiPost(
      '/api/releasepackages/release/' + workflowId,
      { items: releaseItems },
      { cid: COMPANY_ID }
    );
  } catch (e) {
    console.error(`  Failed to create release package: ${extractError(e)}`);
    return null;
  }

  if (!pkg.items || pkg.items.length === 0) {
    console.error(`  Release package has no items`);
    return null;
  }

  const item = pkg.items[0];
  const updatedItem = {
    id: item.id,
    documentId: item.documentId,
    workspaceId: item.workspaceId,
    elementId: item.elementId,
    href: item.href,
    properties: [
      { propertyId: '57f3fb8efa3416c06701d60f', value: partNumber },
      { propertyId: '57f3fb8efa3416c06701d610', value: revision }
    ]
  };

  const updatePayload = {
    id: pkg.id,
    href: pkg.href,
    documentId: docId,
    workspaceId: workId,
    properties: [
      { propertyId: '594964b7040fc85d2b418138', value: `PDM Sync: ${partNumber}` }
    ],
    items: [updatedItem]
  };

  // Submit release
  await delay(currentDelay);
  try {
    const result = await apiPost(
      '/api/releasepackages/' + pkg.id,
      updatePayload,
      { wfaction: 'CREATE_AND_RELEASE' }
    );

    if (result.workflow?.state?.name === 'RELEASED') {
      const versionId = result.items?.[0]?.versionId || '';
      console.log(`  Released: revision ${revision}, version ${versionId}`);
      return { versionId };
    } else {
      console.log(`  Release state: ${result.workflow?.state?.name}`);
      return { versionId: '' };
    }
  } catch (e) {
    console.error(`  Failed to release: ${extractError(e)}`);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadStatus();

  console.log(`Reading: ${inputFile}`);
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  console.log(`Found ${rows.length} rows`);

  // Get workflow ID
  if (!dryRun) {
    workflowId = await getWorkflowId();
    if (workflowId) {
      console.log(`Workflow ID: ${workflowId}`);
    } else {
      console.error('Error: Could not get release workflow ID. Releases will fail.');
    }
  }

  // Filter to releasable rows, sort by level
  const releasable = rows.filter(row => {
    const uploadStatus = String(row['sync:uploadStatus'] || '');
    const action = String(row['sync:action'] || '');
    return uploadStatus === 'done' && action !== 'skip' && action !== 'skip-downgrade';
  });
  releasable.sort((a, b) => (parseInt(a['sync:level']) || 0) - (parseInt(b['sync:level']) || 0));

  console.log(`Releasable rows: ${releasable.length} (sorted by level)`);
  if (dryRun) console.log('DRY RUN — no changes will be made\n');
  else console.log('');

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < releasable.length; i++) {
    const row = releasable[i];
    const name = String(row['Name'] || '');
    const partNumber = pathModule.parse(name).name;
    const action = String(row['sync:action'] || '');
    const level = parseInt(row['sync:level']) || 0;

    // Use IDs from Stage 3 output (newDocumentId etc.), fall back to Stage 1 IDs
    const docId = String(row['sync:newDocumentId'] || row['sync:documentId'] || '');
    const workId = String(row['sync:newWorkspaceId'] || row['sync:workspaceId'] || '');
    const elementId = String(row['sync:newElementId'] || row['sync:elementId'] || '');

    console.log(`\n[${i + 1}/${releasable.length}] ${name} (action=${action}, level=${level})`);

    // Check sidecar
    if (status.fileStatus[partNumber]?.status === 'done') {
      console.log(`  → already done (cached)`);
      const cached = status.fileStatus[partNumber];
      row['sync:versionId'] = cached.versionId || '';
      row['sync:releaseStatus'] = 'done';
      row['sync:releaseError'] = '';
      succeeded++;
      continue;
    }

    if (!docId || !workId || !elementId) {
      console.error(`  → FAILED: Missing Onshape IDs`);
      row['sync:versionId'] = '';
      row['sync:releaseStatus'] = 'failed';
      row['sync:releaseError'] = 'Missing document/workspace/element IDs';
      status.fileStatus[partNumber] = { status: 'failed', error: 'Missing IDs' };
      saveStatus();
      failed++;
      continue;
    }

    try {
      let revision;

      if (action === 'same-rev') {
        // ── Same revision: obsolete existing, then re-release at same rev ──
        const obsoleted = await obsoleteRevision(partNumber);
        if (!obsoleted && !dryRun) {
          throw new Error('Obsoletion failed — cannot re-release');
        }

        // Wait for obsoletion to propagate
        if (!dryRun) {
          console.log(`  Waiting 5s for obsoletion to propagate...`);
          await delay(5000);
        }

        // Release at the SAME Onshape revision (not PDM revision)
        revision = String(row['sync:onshapeRevision'] || row['sync:pdmRevision'] || '00').padStart(2, '0');

      } else {
        // ── New or new-rev: release at PDM revision ──
        revision = String(row['sync:pdmRevision'] || '00').padStart(2, '0');
      }

      const result = await releaseElement(docId, workId, elementId, partNumber, revision);

      if (result) {
        row['sync:versionId'] = result.versionId || '';
        row['sync:releaseStatus'] = 'done';
        row['sync:releaseError'] = '';
        status.fileStatus[partNumber] = { status: 'done', versionId: result.versionId || '' };
        saveStatus();
        succeeded++;
        console.log(`  → done`);
      } else {
        throw new Error('Release returned null');
      }

    } catch (err) {
      const errMsg = extractError(err) || err.message || String(err);
      console.error(`  → FAILED: ${errMsg}`);
      row['sync:versionId'] = '';
      row['sync:releaseStatus'] = 'failed';
      row['sync:releaseError'] = errMsg;
      status.fileStatus[partNumber] = { status: 'failed', error: errMsg };
      saveStatus();
      failed++;
    }

    await delay(1000); // post-operation delay
  }

  // Mark non-releasable rows
  rows.forEach(row => {
    if (row['sync:releaseStatus'] === undefined) {
      row['sync:versionId'] = '';
      row['sync:releaseStatus'] = 'skipped';
      row['sync:releaseError'] = '';
    }
  });

  // Write output Excel
  const outWorkbook = xlsx.utils.book_new();
  const outSheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(outWorkbook, outSheet, 'Sheet1');
  xlsx.writeFile(outWorkbook, outputFile);

  console.log('\n' + '='.repeat(50));
  console.log('STAGE 4 COMPLETE');
  console.log('='.repeat(50));
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  if (dryRun) console.log('(DRY RUN — nothing was changed)');
  console.log(`\nOutput: ${outputFile}`);
  console.log(`Sidecar: ${statusFile}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
