#!/usr/bin/env node
/**
 * One-off: retry the NOT_FOUND rows in Sheet3 with alternate PN derivations.
 * Reads from the _withSheet3.xlsx output and updates only rows currently marked NO.
 */
const xlsx = require('xlsx');
const onshape = require('../lib/onshape');
const { companyId: COMPANY_ID } = require('../config/apikey');

const INPUT = '../../Current/ALL PDM Release Check_checked2_withSheet3.xlsx';
const OUTPUT = '../../Current/ALL PDM Release Check_checked2_withSheet3_retried.xlsx';
const TARGET_SHEET = 'Sheet3';

function cleanName(name) {
  return String(name || '').replace(/\s*\(\d+\)/, '').trim();
}

/** Return ordered list of PN candidates to try for a given file Name. */
function candidates(name) {
  const cleaned = cleanName(name);
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };

  const m = cleaned.match(/^(.+)\.([^.]+)$/);
  if (!m) { push(cleaned); return out; }
  const base = m[1];
  const ext = m[2];
  const lowerExt = ext.toLowerCase();

  const stripConfig = base.replace(/-\d+$/, '');
  const hasConfig = base !== stripConfig;

  if (lowerExt === 'pdf') {
    // Initial rule tried: base + ".PDF" (with config suffix preserved).
    // Alternates in priority order:
    push(base);                      // e.g. "30239-01" (no extension)
    if (hasConfig) {
      push(stripConfig + '.PDF');    // e.g. "30239.PDF" (PDF without config)
      push(stripConfig);             // e.g. "30239" (bare base)
    }
    // Already-tried form is base + ".PDF" — no need to add again.
  } else if (['sldprt', 'sldasm', 'slddrw'].includes(lowerExt)) {
    // Initial rule tried: stripConfig (no extension, no suffix).
    // Alternates:
    if (hasConfig) push(base);       // "10078-24" (keep config)
    push(cleaned);                   // "10078-24.SLDPRT" (full name)
    push(base + '.' + ext.toUpperCase()); // normalized casing
  } else {
    // STEP, DOCX, DWG, etc. — initial rule tried stripConfig.
    push(cleaned);                          // full name with extension
    push(base);                             // base with config retained
    push(cleaned.toUpperCase());
    push(cleaned.toLowerCase());
  }
  return out;
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
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[TARGET_SHEET], { defval: '' });

  const toRetry = rows.filter(r => r['In Onshape'] === 'NO');
  console.log(`${TARGET_SHEET}: ${rows.length} rows, ${toRetry.length} currently NO`);

  const cache = new Map(); // PN-tried -> result
  let delay = 300;
  let updated = 0;

  for (let i = 0; i < toRetry.length; i++) {
    const row = toRetry[i];
    const candList = candidates(row.Name).filter(c => c !== row.partNumber); // skip already-tried
    let matched = null;
    let triedPn = null;

    console.log(`\n[${i + 1}/${toRetry.length}] ${row.Name} (prev PN: ${row.partNumber})`);
    if (candList.length === 0) {
      console.log('    no alternates to try');
      continue;
    }
    console.log(`    candidates: ${candList.join(', ')}`);

    for (const pn of candList) {
      let result = cache.get(pn);
      if (!result) {
        result = await lookup(pn);
        cache.set(pn, result);
        const rem = parseInt(result.remaining, 10);
        if (!isNaN(rem)) {
          if (rem < 10) delay = 5000;
          else if (rem < 30) delay = 2000;
          else if (rem < 60) delay = 800;
          else delay = 300;
        }
        await new Promise(r => setTimeout(r, delay));
      }
      const tag = result.status === 'FOUND'
        ? `FOUND rev ${result.revision} released ${result.releaseDate}`
        : result.status;
      console.log(`      ${pn} — ${tag}`);
      if (result.status === 'FOUND') {
        matched = result;
        triedPn = pn;
        break;
      }
    }

    if (matched) {
      row.partNumber = triedPn;
      row['In Onshape'] = 'YES';
      row['Last Upload'] = matched.releaseDate || '';
      row['Last Release Rev'] = matched.revision || '';
      row['Onshape Doc'] = matched.documentName || '';
      updated++;
    }
  }

  // Rebuild workbook, preserving all other sheets
  const newWb = xlsx.utils.book_new();
  for (const name of wb.SheetNames) {
    const srcRows = (name === TARGET_SHEET)
      ? rows
      : xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    const header = Object.keys(srcRows[0] || {});
    const ws = xlsx.utils.json_to_sheet(srcRows, { header });
    xlsx.utils.book_append_sheet(newWb, ws, name);
  }
  xlsx.writeFile(newWb, OUTPUT);

  console.log('');
  console.log('=== RETRY SUMMARY ===');
  console.log(`  Rows retried:         ${toRetry.length}`);
  console.log(`  Newly found:          ${updated}`);
  console.log(`  Still not found:      ${toRetry.length - updated}`);
  console.log(`  Unique PNs queried:   ${cache.size}`);
  console.log(`  Output:               ${OUTPUT}`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
