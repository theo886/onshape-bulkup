const XLSX = require('xlsx');
const onshape = require('./lib/onshape');

const docsToCheck = ['98135','98137','98149','98150','98155','98156','98157','98160','98161','98164','98166','98167','98169','98171','98172','98177','98182','98184','98186','98187','98188'];

const wb = XLSX.readFile('/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Final']);

// Find Level 0 row for each doc
const docs = [];
docsToCheck.forEach(docName => {
  const row = rows.find(r => {
    const level = parseInt(r['uploadLevel']) || 0;
    const name = String(r['document:name'] || '');
    return name === docName && level === 0 && r['onshape:documentId'] && r['onshape:elementId'];
  });
  if (row) {
    docs.push({
      docName,
      docId: row['onshape:documentId'],
      workId: row['onshape:workspaceId'],
      elemId: row['onshape:elementId'],
      fileName: row['File Name']
    });
  } else {
    console.log('NOT FOUND:', docName);
  }
});

console.log('Checking', docs.length, 'documents...\n');

let idx = 0;
const results = [];

function checkNext() {
  if (idx >= docs.length) {
    console.log('\n========== RESULTS ==========');
    results.forEach(r => {
      console.log(`${r.docName}: ${r.partNumber || '** BLANK **'}`);
    });
    return;
  }

  const doc = docs[idx++];
  process.stdout.write(`\rChecking ${idx}/${docs.length}: ${doc.docName}    `);

  onshape.get({
    path: `/api/metadata/d/${doc.docId}/w/${doc.workId}/e/${doc.elemId}`
  }, (data, err) => {
    if (err) {
      results.push({ ...doc, partNumber: 'ERROR: ' + err.statusCode });
    } else {
      const meta = JSON.parse(data.toString());
      const pn = meta.properties?.find(p => p.name === 'Part Number' || p.name === 'Part number' || p.propertyId === '57f3fb8efa3416c06701d60f')?.value || '';
      results.push({ ...doc, partNumber: pn.trim() });
    }
    setTimeout(checkNext, 200);
  });
}

checkNext();
