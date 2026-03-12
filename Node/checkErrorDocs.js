const XLSX = require('xlsx');
const onshape = require('./lib/onshape');

const errorDocList = ['100000','10470','10473','10474','10508','10520','10521','10522','10523','10524','10525','10526','10527','10528','10529','10530','10531','10532','10533','10534','10535','10536','10537','10538','10539','10540','10541','10542','10543','10544','10545','10546','10547','10548','10551','30205','30206','40009','40077','43597','50050','51098','51099','51102','51116','51131','51238','51261','51280','51281','51291','51292','51293','51298','51299','51300','51301','51302','51303','51304','51305','51306','51307','51309','51311','80616','80726','90014','90254','90283','90309','90312','90405','90428','90429','90431','90451','90726','90757','90782','90873','91391','91629','91635','91736','91938','91940','93242','93504','95142','95145','95240','96504','96523','96524','96657','97061','97084','97402','97455','97551','97555','97565','97566','97572','97732','97740','97753','97754','97755','97756','97757','97758','97759','97760','97761','97762','97763','97764','97765','97766','97767','97768','97769','97770','97774','97780','97781','97782','97783','97821','97909','97910','97911','97912','97913','97914','97915','97923','97966'];

const errorDocSet = new Set(errorDocList);

const wb = XLSX.readFile('/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Final']);

// For each error doc, find a Level 0 row
const docsToCheck = [];
errorDocList.forEach(docName => {
  const row = rows.find(r => {
    const level = parseInt(r['uploadLevel']) || 0;
    const name = String(r['document:name'] || '');
    const docId = r['onshape:documentId'];
    const elemId = r['onshape:elementId'];
    const workId = r['onshape:workspaceId'];
    return name === docName && level === 0 && docId && elemId && workId;
  });

  if (row) {
    docsToCheck.push({
      docName,
      docId: row['onshape:documentId'],
      workId: row['onshape:workspaceId'],
      elemId: row['onshape:elementId'],
      fileName: row['File Name']
    });
  } else {
    console.log('NOT IN EXCEL:', docName);
  }
});

console.log('Documents to check:', docsToCheck.length);
console.log('Not found in Excel:', errorDocList.length - docsToCheck.length);
console.log('');

// Adaptive rate limiting
const MIN_DELAY = 200;
const MAX_DELAY = 5000;
const LOW_THRESHOLD = 10;
let currentDelay = MIN_DELAY;

const results = { success: [], error: [], blank: [] };
let idx = 0;

function checkNext() {
  if (idx >= docsToCheck.length) {
    printResults();
    return;
  }

  const doc = docsToCheck[idx++];
  process.stdout.write(`\rChecking ${idx}/${docsToCheck.length}: ${doc.docName.padEnd(10)} [delay=${currentDelay}ms]    `);

  onshape.get({
    path: `/api/metadata/d/${doc.docId}/w/${doc.workId}/e/${doc.elemId}`
  }, (data, err, rateInfo) => {
    // Adjust delay
    if (rateInfo && rateInfo.remaining !== undefined) {
      const remaining = parseInt(rateInfo.remaining, 10);
      if (remaining < LOW_THRESHOLD) {
        currentDelay = Math.min(MAX_DELAY, MIN_DELAY + (LOW_THRESHOLD - remaining) * 500);
      } else {
        currentDelay = MIN_DELAY;
      }
    }

    if (err) {
      results.error.push({ ...doc, status: err.statusCode });
    } else {
      const meta = JSON.parse(data.toString());
      const pn = meta.properties?.find(p => p.name === 'Part Number' || p.name === 'Part number' || p.propertyId === '57f3fb8efa3416c06701d60f')?.value || '';
      if (pn.trim()) {
        results.success.push({ ...doc, partNumber: pn });
      } else {
        results.blank.push(doc);
      }
    }

    setTimeout(checkNext, currentDelay);
  });
}

function printResults() {
  console.log('\n\n========== RESULTS ==========');
  console.log('Total checked:', docsToCheck.length);
  console.log('Success (has part number):', results.success.length);
  console.log('Blank part number:', results.blank.length);
  console.log('API errors:', results.error.length);

  if (results.error.length > 0) {
    console.log('\nAPI Errors:');
    results.error.forEach(e => console.log(`  ${e.docName}: ${e.status}`));
  }

  // Export to CSV
  const fs = require('fs');
  const csv = ['documentName,documentId,workspaceId,elementId,fileName,status,partNumber'];

  results.blank.forEach(d => {
    csv.push(`${d.docName},${d.docId},${d.workId},${d.elemId},${d.fileName},blank,`);
  });
  results.success.forEach(d => {
    csv.push(`${d.docName},${d.docId},${d.workId},${d.elemId},${d.fileName},success,${d.partNumber}`);
  });
  results.error.forEach(d => {
    csv.push(`${d.docName},${d.docId},${d.workId},${d.elemId},${d.fileName},error_${d.status},`);
  });

  fs.writeFileSync('./output/error_docs_recheck.csv', csv.join('\n'));
  console.log('\nExported to output/error_docs_recheck.csv');
}

checkNext();
