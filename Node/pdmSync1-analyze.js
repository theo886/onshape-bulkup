#!/usr/bin/env node
/**
 * pdmSync1-analyze.js
 * Stage 1 of PDM Release Sync pipeline.
 *
 * Reads PDM Releases.xlsx, classifies each file, checks current Onshape status,
 * assigns folder and level, writes pdm_releases_s1.xlsx.
 *
 * Usage:
 *   node pdmSync1-analyze.js -i "PDM Releases.xlsx" [-o pdm_releases_s1.xlsx]
 *                             [-r PDM/references.csv]
 */

'use strict';

const fs = require('fs');
const xlsx = require('xlsx');
const path = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

const COMPANY_ID = '6763516217765c31f9561958';

const SKIP_EXTENSIONS = new Set(['.SLDDRW', '.STEP', '.STP']);

const FOLDER_MAP = {
  10000:  '104a8ac5a8e0216dc4e52728',
  20000:  '24bfae676122265352d93146',
  30000:  '0c63b047974f7016afda739b',
  40000:  'd729562ddcfafdb79985ecca',
  50000:  '60e11c22eff31e63686b5705',
  60000:  'c54f4bcc01ca6b382839cb8c',
  70000:  '5601b6447cca2a15dd71bca9',
  80000:  'bb2b89a992682f64c19b9ecb',
  90000:  '639ab44f71c9d67febb56d0a',
  100000: 'e8bc39dbaadd20266fe6dbed',
  MISC:   '026b282ba795f63af58b368b'
};

function getFolderForPartNumber(partNumber) {
  const num = parseInt(partNumber, 10);
  if (isNaN(num)) return FOLDER_MAP['MISC'];
  const bucket = Math.floor(num / 10000) * 10000;
  return FOLDER_MAP[bucket] || FOLDER_MAP['MISC'];
}

function getDocumentName(filename) {
  const base = path.parse(filename).name;
  return base.substring(0, 5) + ' SRC';
}

// ─── Level calculation (inlined from assignLevels.js) ───────────────────────

function parseCSV(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  let headerIdx = 0;
  if (!lines[0].includes('AssemblyFile') && !lines[0].includes('Filename') && !lines[0].includes('DocumentID')) {
    headerIdx = 1;
  }
  if (lines.length <= headerIdx) return [];
  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));
  const data = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ''; });
    data.push(obj);
  }
  return data;
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { values.push(current.trim().replace(/"/g, '')); current = ''; }
    else { current += char; }
  }
  values.push(current.trim().replace(/"/g, ''));
  return values;
}

function buildReferenceGraph(references) {
  const graph = new Map();
  references.forEach(ref => {
    const assembly = (ref.AssemblyFile || ref.assemblyFile || '').toUpperCase();
    const child = (ref.ChildFile || ref.childFile || '').toUpperCase();
    if (!assembly || !child) return;
    if (!graph.has(assembly)) graph.set(assembly, []);
    if (!graph.get(assembly).includes(child)) graph.get(assembly).push(child);
  });
  return graph;
}

function calculateAssemblyLevel(filename, graph, levelCache, visiting = new Set()) {
  const norm = filename.toUpperCase();
  if (levelCache.has(norm)) return levelCache.get(norm);
  if (visiting.has(norm)) {
    console.warn(`Warning: Circular dependency: ${filename}`);
    return 2;
  }
  visiting.add(norm);
  const children = graph.get(norm) || [];
  let maxChildLevel = 0;
  for (const child of children) {
    if (path.extname(child).toUpperCase() === '.SLDASM') {
      maxChildLevel = Math.max(maxChildLevel, calculateAssemblyLevel(child, graph, levelCache, new Set(visiting)));
    }
  }
  const level = maxChildLevel === 0 ? 2 : maxChildLevel + 1;
  levelCache.set(norm, level);
  visiting.delete(norm);
  return level;
}

// ─── Revision comparison ─────────────────────────────────────────────────────

function compareRevisions(pdmRev, osRev) {
  const p = parseInt(pdmRev, 10);
  const o = parseInt(osRev, 10);
  if (!isNaN(p) && !isNaN(o)) return p - o;
  return String(pdmRev).localeCompare(String(osRev));
}

// ─── Rate-limited API helpers ─────────────────────────────────────────────────

const MIN_DELAY = 200;
const MAX_DELAY = 5000;
let currentDelay = MIN_DELAY;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiGet(apiPath, query) {
  return new Promise((resolve, reject) => {
    const opts = { path: apiPath };
    if (query) opts.query = query;
    onshape.get(opts, (data, err, rateInfo) => {
      if (err) { reject(err); return; }
      if (rateInfo && rateInfo.remaining !== undefined) {
        if (rateInfo.remaining < 10) {
          currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
        } else if (rateInfo.remaining > 50) {
          currentDelay = Math.max(Math.floor(currentDelay * 0.9), MIN_DELAY);
        }
      }
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Failed to parse response: ' + e.message)); }
    });
  });
}

async function apiGetWithRetry(apiPath, query, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiGet(apiPath, query);
    } catch (err) {
      if (err.statusCode === 429) {
        const waitMs = ((err.retryAfter || 60) + 5) * 1000;
        console.log(`  Rate limited (429). Waiting ${waitMs / 1000}s...`);
        await delay(waitMs);
        continue;
      }
      throw err; // propagate 404 and other errors
    }
  }
  throw new Error(`Max retries exceeded for ${apiPath}`);
}

// ─── Onshape lookup helpers ───────────────────────────────────────────────────

/**
 * Look up existing Onshape document/element info for a part number.
 * Returns: { onshapeRevision, revisionId, documentId, workspaceId, elementId }
 * Throws 404-like objects if not found (caller checks err.statusCode === 404).
 */
async function lookupOnshapeInfo(partNumber, documentName) {
  // 1. Check revision API
  const revData = await apiGetWithRetry(
    `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`
  );

  const onshapeRevision = String(revData.revision || '').padStart(2, '0');
  const revisionId = revData.id || '';

  // 2. Find document by name (search company documents)
  await delay(currentDelay);
  let documentId = '';
  let workspaceId = '';
  let elementId = '';

  try {
    const docs = await apiGetWithRetry('/api/documents', {
      q: documentName, filter: 7, owner: COMPANY_ID, ownerType: 1
    });
    const doc = docs.items?.find(d => d.name === documentName && d.owner?.id === COMPANY_ID);
    if (doc) {
      documentId = doc.id;
      workspaceId = doc.defaultWorkspace?.id || '';
    }
  } catch (e) {
    console.warn(`  Warning: Could not find document "${documentName}": ${e.statusCode || e.message || e}`);
  }

  // 3. Find element ID within the document
  if (documentId && workspaceId) {
    try {
      await delay(currentDelay);
      const elements = await apiGetWithRetry(`/api/documents/d/${documentId}/w/${workspaceId}/elements`);
      // Find the first Part Studio or Assembly element (not BOM elements)
      const elem = elements.find(e => e.type === 'Part Studio' || e.type === 'Assembly');
      if (elem) elementId = elem.id;
    } catch (e) {
      console.warn(`  Warning: Could not get elements for "${documentName}": ${e.statusCode || e.message || e}`);
    }
  }

  return { onshapeRevision, revisionId, documentId, workspaceId, elementId };
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 'r'],
  boolean: ['h', 'help'],
  alias: { i: 'input', o: 'output', r: 'references', h: 'help' }
});

if (args.help || !args.input) {
  console.log(`
PDM Release Sync - Stage 1: Analyze

Usage: node pdmSync1-analyze.js -i "PDM Releases.xlsx" [options]

Options:
  -i, --input       Input Excel file (required)
  -o, --output      Output Excel file (default: pdm_releases_s1.xlsx)
  -r, --references  PDM references CSV (default: PDM/references.csv)
  -h, --help        Show this help

Output columns added:
  sync:action          new / same-rev / new-rev / skip / skip-downgrade
  sync:level           0=blob, 1=part, 2+=assembly
  sync:folder          Onshape folder ID
  sync:documentName    e.g. "30093 SRC"
  sync:pdmRevision     Padded PDM revision (e.g. "02")
  sync:onshapeRevision Current Onshape revision if found
  sync:documentId      Existing Onshape document ID (if found)
  sync:workspaceId     Existing Onshape workspace ID (if found)
  sync:elementId       Existing Onshape element ID (if found)
  sync:revisionId      Existing revision ID (for obsoletion)
  sync:filePath        Full Windows path (Found In\\Name)
`);
  process.exit(0);
}

const inputFile = args.input;
const outputFile = args.output || 'pdm_releases_s1.xlsx';
const referencesFile = args.references || 'PDM/references.csv';
const sidecarFile = 'pdm_sync1_status.json';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load crash-safe sidecar
  let sidecar = {};
  if (fs.existsSync(sidecarFile)) {
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
      console.log(`Loaded sidecar: ${Object.keys(sidecar).length} cached rows`);
    } catch (e) {
      console.warn('Warning: Could not parse sidecar, starting fresh');
    }
  }

  function saveSidecar() {
    fs.writeFileSync(sidecarFile, JSON.stringify(sidecar, null, 2));
  }

  // Build reference graph for level calculation
  let graph = new Map();
  const levelCache = new Map();
  if (fs.existsSync(referencesFile)) {
    console.log(`Loading references from: ${referencesFile}`);
    const refs = parseCSV(referencesFile);
    graph = buildReferenceGraph(refs);
    console.log(`  ${graph.size} assemblies in reference graph`);
  } else {
    console.warn(`Warning: References file not found: ${referencesFile}`);
    console.warn('  Assembly levels will default to 2');
  }

  // Read input Excel
  console.log(`\nReading: ${inputFile}`);
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  console.log(`Found ${rows.length} rows\n`);

  const stats = { new: 0, sameRev: 0, newRev: 0, skip: 0, skipDowngrade: 0, error: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row['Name'] || '').trim();
    if (!name) continue;

    const ext = path.extname(name).toUpperCase();
    const partNumber = path.parse(name).name;
    const foundIn = String(row['Found In'] || '').trim();
    const filePath = foundIn ? foundIn + '\\' + name : name;
    const pdmRevision = String(row['Revision'] || '00').padStart(2, '0');

    console.log(`[${i + 1}/${rows.length}] ${name} (rev ${pdmRevision})`);

    // Always set these regardless of skip
    row['sync:pdmRevision'] = pdmRevision;
    row['sync:filePath'] = filePath;

    // Skip certain extensions
    if (SKIP_EXTENSIONS.has(ext)) {
      row['sync:action'] = 'skip';
      row['sync:level'] = 0;
      row['sync:folder'] = '';
      row['sync:documentName'] = '';
      row['sync:onshapeRevision'] = '';
      row['sync:documentId'] = '';
      row['sync:workspaceId'] = '';
      row['sync:elementId'] = '';
      row['sync:revisionId'] = '';
      stats.skip++;
      console.log(`  → skip (extension: ${ext})`);
      continue;
    }

    // Assign level
    let level;
    if (ext === '.SLDPRT') {
      level = 1;
    } else if (ext === '.SLDASM') {
      level = calculateAssemblyLevel(name, graph, levelCache);
    } else {
      level = 0;
    }

    const folderId = getFolderForPartNumber(partNumber);
    const documentName = getDocumentName(name);

    // Set static columns
    row['sync:level'] = level;
    row['sync:folder'] = folderId;
    row['sync:documentName'] = documentName;

    // Check sidecar cache (skip already-queried rows on re-run)
    if (sidecar[partNumber]) {
      const cached = sidecar[partNumber];
      row['sync:action'] = cached.action;
      row['sync:onshapeRevision'] = cached.onshapeRevision || '';
      row['sync:documentId'] = cached.documentId || '';
      row['sync:workspaceId'] = cached.workspaceId || '';
      row['sync:elementId'] = cached.elementId || '';
      row['sync:revisionId'] = cached.revisionId || '';
      console.log(`  → cached: ${cached.action}`);
      continue;
    }

    // Query Onshape
    await delay(currentDelay);

    let action = 'new';
    let onshapeRevision = '';
    let documentId = '';
    let workspaceId = '';
    let elementId = '';
    let revisionId = '';

    try {
      const info = await lookupOnshapeInfo(partNumber, documentName);
      onshapeRevision = info.onshapeRevision;
      revisionId = info.revisionId;
      documentId = info.documentId;
      workspaceId = info.workspaceId;
      elementId = info.elementId;

      const cmp = compareRevisions(pdmRevision, onshapeRevision);
      if (cmp === 0) {
        action = 'same-rev';
        stats.sameRev++;
        console.log(`  → same-rev (Onshape: ${onshapeRevision})`);
      } else if (cmp > 0) {
        action = 'new-rev';
        stats.newRev++;
        console.log(`  → new-rev (PDM: ${pdmRevision} > Onshape: ${onshapeRevision})`);
      } else {
        action = 'skip-downgrade';
        stats.skipDowngrade++;
        console.warn(`  → skip-downgrade (PDM: ${pdmRevision} < Onshape: ${onshapeRevision}) — skipping`);
      }
    } catch (err) {
      if (err.statusCode === 404) {
        action = 'new';
        stats.new++;
        console.log(`  → new (not in Onshape)`);
      } else {
        const msg = err.body || err.message || String(err);
        console.error(`  → error checking revision: ${msg}`);
        action = 'error';
        stats.error++;
      }
    }

    // Write output columns
    row['sync:action'] = action;
    row['sync:onshapeRevision'] = onshapeRevision;
    row['sync:documentId'] = documentId;
    row['sync:workspaceId'] = workspaceId;
    row['sync:elementId'] = elementId;
    row['sync:revisionId'] = revisionId;

    // Persist to sidecar
    sidecar[partNumber] = { action, onshapeRevision, documentId, workspaceId, elementId, revisionId };
    saveSidecar();
  }

  // Write output Excel
  const outWorkbook = xlsx.utils.book_new();
  const outSheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(outWorkbook, outSheet, 'Sheet1');
  xlsx.writeFile(outWorkbook, outputFile);

  console.log('\n' + '='.repeat(50));
  console.log('STAGE 1 COMPLETE');
  console.log('='.repeat(50));
  console.log(`New:              ${stats.new}`);
  console.log(`Same revision:    ${stats.sameRev}`);
  console.log(`New revision:     ${stats.newRev}`);
  console.log(`Skip:             ${stats.skip}`);
  console.log(`Skip (downgrade): ${stats.skipDowngrade}`);
  if (stats.error > 0) console.error(`Errors:           ${stats.error}`);
  console.log(`\nOutput: ${outputFile}`);
  console.log(`Sidecar: ${sidecarFile}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
