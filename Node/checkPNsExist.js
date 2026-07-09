#!/usr/bin/env node
/**
 * checkPNsExist.js — Check if part numbers from an Excel file already exist in Onshape
 *
 * Usage: node checkPNsExist.js -i <input.xlsx>
 */

const xlsx = require('xlsx');
const minimist = require('minimist');
const onshape = require('./lib/onshape');
const { companyId: COMPANY_ID } = require('./config/apikey');

const args = minimist(process.argv.slice(2), {
  alias: { i: 'input' }
});

if (!args.input) {
  console.log('Usage: node checkPNsExist.js -i <input.xlsx>');
  process.exit(1);
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    onshape.get({ path }, (data, err) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function main() {
  const wb = xlsx.readFile(args.input);
  const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const pns = [...new Set(data.map(r => r['property:Name']).filter(Boolean))];

  console.log(`Checking ${pns.length} unique part numbers against Onshape...\n`);

  const found = [];
  const notFound = [];

  for (const pn of pns) {
    try {
      const result = await apiGet(
        `/api/v10/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(pn)}`
      );
      if (result && !result.message) {
        const rev = result.revision || result.name || '?';
        const state = result.releasePackage?.workflow?.state || result.status || '';
        console.log(`  FOUND: ${pn} — rev ${rev} ${state}`);
        found.push({ pn, revision: rev, state, data: result });
      } else {
        console.log(`  NOT FOUND: ${pn}`);
        notFound.push(pn);
      }
    } catch (err) {
      const status = err?.statusCode || err?.status || '';
      if (status === 404 || (err?.message && err.message.includes('404'))) {
        console.log(`  NOT FOUND: ${pn}`);
        notFound.push(pn);
      } else {
        console.log(`  ERROR: ${pn} — ${err?.message || JSON.stringify(err)}`);
        notFound.push(pn);
      }
    }
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Found in Onshape: ${found.length}`);
  found.forEach(f => console.log(`  ${f.pn} (rev ${f.revision})`));
  console.log(`Not found: ${notFound.length}`);
  notFound.forEach(pn => console.log(`  ${pn}`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
