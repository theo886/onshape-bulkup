/**
 * pdmSyncUtils.js
 * Shared pure functions for the PDM Sync pipeline (Stages 1-4).
 *
 * All functions here are deterministic and side-effect free (except parseCSV
 * which reads a file). They are extracted from pdmSync1-analyze.js,
 * pdmSync3-upload.js, and pdmSync4-release.js for testability and reuse.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────

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

const SKIP_EXTENSIONS = new Set(['.SLDDRW', '.STEP', '.STP']);

// ─── Folder mapping ──────────────────────────────────────────────────────────

function getFolderForPartNumber(partNumber) {
  const num = parseInt(partNumber, 10);
  if (isNaN(num)) return FOLDER_MAP['MISC'];
  const bucket = Math.floor(num / 10000) * 10000;
  return FOLDER_MAP[bucket] || FOLDER_MAP['MISC'];
}

// ─── Document naming ─────────────────────────────────────────────────────────

function getDocumentName(filename) {
  const base = path.parse(filename).name;
  return base.substring(0, 5) + ' SRC';
}

// ─── Revision comparison ─────────────────────────────────────────────────────

function compareRevisions(pdmRev, osRev) {
  const p = parseInt(pdmRev, 10);
  const o = parseInt(osRev, 10);
  if (!isNaN(p) && !isNaN(o)) return p - o;
  return String(pdmRev).localeCompare(String(osRev));
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

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

// ─── Reference graph / level calculation ─────────────────────────────────────

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

// ─── Error extraction ────────────────────────────────────────────────────────

function extractError(err) {
  if (!err) return '';
  if (err.body) {
    try { const p = JSON.parse(err.body); return p.message || p.error || err.body; }
    catch (e) { return String(err.body); }
  }
  return err.statusCode ? `HTTP ${err.statusCode}` : String(err);
}

// ─── Property building ──────────────────────────────────────────────────────

/**
 * Build properties array for an Onshape element.
 * Requires propertyIdMap to be passed in (from unifiedUpload.js).
 */
function buildProperties(row, propertyIdMap) {
  const props = [];
  const partNumber = path.parse(String(row['Name'] || '')).name;
  const revision = String(row['sync:pdmRevision'] || row['Revision'] || '00').padStart(2, '0');
  const description = row['Description'] || '';

  if (partNumber) props.push({ propertyId: propertyIdMap['Part number'], value: partNumber });
  if (revision) props.push({ propertyId: propertyIdMap['Revision'], value: revision });
  if (description) props.push({ propertyId: propertyIdMap['Description'], value: String(description) });

  return props;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  FOLDER_MAP,
  SKIP_EXTENSIONS,
  getFolderForPartNumber,
  getDocumentName,
  compareRevisions,
  parseCSVLine,
  parseCSV,
  buildReferenceGraph,
  calculateAssemblyLevel,
  extractError,
  buildProperties
};
