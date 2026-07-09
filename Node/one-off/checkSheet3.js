#!/usr/bin/env node
/**
 * One-off: populate Sheet3 of ALL PDM Release Check_checked2.xlsx with derived
 * partNumbers from the Name column, then query Onshape for release dates.
 * Preserves all other sheets untouched.
 */
const xlsx = require('xlsx');
const onshape = require('../lib/onshape');
const { companyId: COMPANY_ID } = require('../config/apikey');

const INPUT = '../../Current/ALL PDM Release Check_checked2.xlsx';
const OUTPUT = '../../Current/ALL PDM Release Check_checked2_withSheet3.xlsx';
const TARGET_SHEET = 'Sheet3';

function derivePN(name) {
  if (!name) return '';
  let n = String(name).replace(/\s*\(\d+\)/, '').trim();
  const m = n.match(/^(.+)\.([^.]+)$/);
  if (!m) return n;
  const base = m[1];
  const ext = m[2].toLowerCase();
  if (ext === 'pdf') return base + '.PDF';
  return base.replace(/-\d+$/, '');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function apiGetRaw(p) {
  return new Promise((resolve, reject) => {
    onshape.get({ path: p }, (data, err, rateInfo) => {
      if (err) reject({ status: err.statusCode, body: err.body, retryAfter: rateInfo?.retryAfter, remaining: rateInfo?.remaining });
      else resolve({ data, rateInfo: rateInfo || {} });
    });
  });
}

async function lookup(pn) {
  const p = `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(pn)}`;
  try {
    const { data, rateInfo } = await apiGetRaw(p);
    let obj = data;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (_) {} }
    if (obj && obj.message && !obj.revision) return { status: 'NOT_FOUND', remaining: rateInfo.remaining };
    return {
      status: 'FOUND',
      releaseDate: formatDate(obj.releaseCreatedDate || obj.createdAt),
      revision: obj.revision || obj.name || '',
      documentName: obj.documentName || '',
      remaining: rateInfo.remaining,
    };
  } catch (e) {
    if (e.status === 404) return { status: 'NOT_FOUND', remaining: e.remaining };
    if (e.status === 429) {
      const wait = parseInt(e.retryAfter || '60', 10);
      console.log(`    429 rate limited — waiting ${wait}s`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return lookup(pn);
    }
    return { status: 'ERROR', error: `HTTP ${e.status || '?'}`, remaining: e.remaining };
  }
}

(async () => {
  const wb = xlsx.readFile(INPUT);
  if (!wb.SheetNames.includes(TARGET_SHEET)) {
    console.error(`Sheet "${TARGET_SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const s3Rows = xlsx.utils.sheet_to_json(wb.Sheets[TARGET_SHEET], { defval: '' });
  console.log(`${TARGET_SHEET}: ${s3Rows.length} rows`);

  // Derive partNumbers from Name
  s3Rows.forEach(r => { r.partNumber = derivePN(r.Name); });
  const uniq = [...new Set(s3Rows.map(r => r.partNumber).filter(Boolean))];
  console.log(`Unique derived partNumbers: ${uniq.length}`);

  const cache = new Map();
  let delay = 300;
  for (let i = 0; i < uniq.length; i++) {
    const pn = uniq[i];
    const result = await lookup(pn);
    cache.set(pn, result);
    const rem = parseInt(result.remaining, 10);
    if (!isNaN(rem)) {
      if (rem < 10) delay = 5000;
      else if (rem < 30) delay = 2000;
      else if (rem < 60) delay = 800;
      else delay = 300;
    }
    const tag = result.status === 'FOUND'
      ? `FOUND rev ${result.revision} released ${result.releaseDate}`
      : result.status;
    console.log(`  [${i + 1}/${uniq.length}] ${pn} — ${tag}${result.remaining !== undefined ? `  (rl=${result.remaining})` : ''}`);
    await new Promise(r => setTimeout(r, delay));
  }

  // Apply results to Sheet3 rows
  for (const row of s3Rows) {
    const r = cache.get(row.partNumber);
    if (!r) continue;
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
      row['Onshape Doc'] = r.error || '';
    }
  }

  // Rebuild workbook preserving other sheets
  const newWb = xlsx.utils.book_new();
  for (const name of wb.SheetNames) {
    if (name === TARGET_SHEET) {
      const header = Object.keys(s3Rows[0] || {});
      const ws = xlsx.utils.json_to_sheet(s3Rows, { header });
      xlsx.utils.book_append_sheet(newWb, ws, name);
    } else {
      // copy other sheets as-is
      const origRows = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      const header = Object.keys(origRows[0] || {});
      const ws = xlsx.utils.json_to_sheet(origRows, { header });
      xlsx.utils.book_append_sheet(newWb, ws, name);
    }
  }
  xlsx.writeFile(newWb, OUTPUT);

  const found = [...cache.values()].filter(r => r.status === 'FOUND').length;
  const nf = [...cache.values()].filter(r => r.status === 'NOT_FOUND').length;
  const err = [...cache.values()].filter(r => r.status === 'ERROR').length;
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`  Unique PNs:  ${uniq.length}`);
  console.log(`  Found:       ${found}`);
  console.log(`  Not found:   ${nf}`);
  console.log(`  Errors:      ${err}`);
  console.log(`  Output:      ${OUTPUT}`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
