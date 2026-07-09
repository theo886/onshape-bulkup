#!/usr/bin/env node
/**
 * checkReleasedDates.js — For each partNumber in an Excel file, check Onshape for
 * the latest release and write the release date back to a new column.
 *
 * Usage: node checkReleasedDates.js -i <input.xlsx> [-o <output.xlsx>]
 *
 * Adds columns:
 *   - "In Onshape":         "YES" / "NO" / "ERROR"
 *   - "Last Release Date":  ISO date (YYYY-MM-DD) of latest release, or blank
 *   - "Last Release Rev":   revision label (e.g. "00", "A")
 *   - "Onshape Doc":        document name
 */

const xlsx = require('xlsx');
const minimist = require('minimist');
const path = require('path');
const onshape = require('./lib/onshape');
const { companyId: COMPANY_ID } = require('./config/apikey');

const args = minimist(process.argv.slice(2), {
  alias: { i: 'input', o: 'output' },
});

if (!args.input) {
  console.log('Usage: node checkReleasedDates.js -i <input.xlsx> [-o <output.xlsx>]');
  process.exit(1);
}

const inputPath = args.input;
const outputPath = args.output
  || inputPath.replace(/\.xlsx$/i, '_checked.xlsx');

function apiGetRaw(p) {
  return new Promise((resolve, reject) => {
    onshape.get({ path: p }, (data, err, rateInfo) => {
      if (err) {
        reject({
          status: err.statusCode,
          body: err.body,
          retryAfter: rateInfo?.retryAfter || err.headers?.['retry-after'],
          remaining: rateInfo?.remaining,
        });
      } else {
        resolve({ data, rateInfo: rateInfo || {} });
      }
    });
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

async function lookupPartNumber(pn) {
  const p = `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(pn)}`;
  try {
    const { data, rateInfo } = await apiGetRaw(p);
    let obj = data;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (_) { /* ignore */ }
    }
    const remaining = rateInfo.remaining;
    if (obj && obj.message && !obj.revision) {
      return { status: 'NOT_FOUND', remaining };
    }
    return {
      status: 'FOUND',
      releaseDate: formatDate(obj.releaseCreatedDate || obj.createdAt),
      revision: obj.revision || obj.name || '',
      documentName: obj.documentName || '',
      remaining,
    };
  } catch (e) {
    if (e.status === 404) return { status: 'NOT_FOUND', remaining: e.remaining };
    if (e.status === 429) {
      const wait = parseInt(e.retryAfter || '60', 10);
      console.log(`    429 rate limited — waiting ${wait}s`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return lookupPartNumber(pn);
    }
    return { status: 'ERROR', error: `HTTP ${e.status || '?'}: ${e.body || ''}`.slice(0, 200), remaining: e.remaining };
  }
}

function applyResultToRow(row, r) {
  if (!r) {
    row['In Onshape'] = '';
    row['Last Upload'] = '';
    row['Last Release Rev'] = '';
    row['Onshape Doc'] = '';
    return;
  }
  if (r.status === 'FOUND') {
    row['In Onshape'] = 'YES';
    row['Last Upload'] = r.releaseDate || '';
    row['Last Release Rev'] = r.revision || '';
    row['Onshape Doc'] = r.documentName || '';
  } else if (r.status === 'NOT_FOUND') {
    row['In Onshape'] = 'NO';
    row['Last Upload'] = '';
    row['Last Release Rev'] = '';
    row['Onshape Doc'] = '';
  } else {
    row['In Onshape'] = 'ERROR';
    row['Last Upload'] = '';
    row['Last Release Rev'] = '';
    row['Onshape Doc'] = r.error || '';
  }
}

async function main() {
  const wb = xlsx.readFile(inputPath);
  const sheets = wb.SheetNames.map(n => ({
    name: n,
    rows: xlsx.utils.sheet_to_json(wb.Sheets[n], { defval: '' }),
  }));
  const totalRows = sheets.reduce((s, x) => s + x.rows.length, 0);
  console.log(`Loaded ${sheets.length} sheet(s), ${totalRows} total rows from ${inputPath}`);

  const pnSet = new Set();
  for (const s of sheets) {
    for (const r of s.rows) {
      const pn = r.partNumber;
      if (pn !== '' && pn !== null && pn !== undefined) pnSet.add(String(pn));
    }
  }
  const uniquePns = [...pnSet];
  console.log(`Unique partNumbers to check (across all sheets): ${uniquePns.length}`);

  const cache = new Map();
  let delayMs = 300;

  for (let i = 0; i < uniquePns.length; i++) {
    const pn = uniquePns[i];
    const result = await lookupPartNumber(pn);
    cache.set(pn, result);

    const remaining = result.remaining;
    if (remaining !== undefined) {
      const r = parseInt(remaining, 10);
      if (!isNaN(r)) {
        if (r < 10) delayMs = 5000;
        else if (r < 30) delayMs = 2000;
        else if (r < 60) delayMs = 800;
        else delayMs = 300;
      }
    }

    const tag = result.status === 'FOUND'
      ? `FOUND rev ${result.revision} released ${result.releaseDate}`
      : result.status;
    console.log(`  [${i + 1}/${uniquePns.length}] ${pn} — ${tag}${remaining !== undefined ? `  (rl=${remaining})` : ''}`);

    await new Promise(r => setTimeout(r, delayMs));
  }

  const newWb = xlsx.utils.book_new();
  for (const s of sheets) {
    for (const row of s.rows) {
      const pnRaw = row.partNumber;
      if (pnRaw === '' || pnRaw === null || pnRaw === undefined) {
        applyResultToRow(row, null);
      } else {
        applyResultToRow(row, cache.get(String(pnRaw)));
      }
    }
    const firstRowHeaders = Object.keys(s.rows[0] || {});
    const newSheet = xlsx.utils.json_to_sheet(s.rows, { header: firstRowHeaders });
    xlsx.utils.book_append_sheet(newWb, newSheet, s.name);
  }
  xlsx.writeFile(newWb, outputPath);

  const found = [...cache.values()].filter(r => r.status === 'FOUND').length;
  const notFound = [...cache.values()].filter(r => r.status === 'NOT_FOUND').length;
  const errored = [...cache.values()].filter(r => r.status === 'ERROR').length;
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`  Sheets:             ${sheets.length}`);
  console.log(`  Unique PNs checked: ${uniquePns.length}`);
  console.log(`  Found in Onshape:   ${found}`);
  console.log(`  Not found:          ${notFound}`);
  console.log(`  Errors:             ${errored}`);
  console.log(`  Output:             ${outputPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
