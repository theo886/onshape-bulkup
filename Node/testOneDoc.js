const XLSX = require('xlsx');
const onshape = require('./lib/onshape');

const notFoundList = ['100000','10470','10473','10474','10508','10520','10521','10522','10523','10524','10525','10526','10527','10528','10529','10530','10531','10532','10533','10534','10535','10536','10537','10538','10539','10540','10541','10542','10543','10544','10545','10546','10547','10548','10551','30205','30206','40009','40077','43597','50050','51098','51099','51102','51116','51131','51238','51261','51280','51281','51291','51292','51293','51298','51299','51300','51301','51302','51303','51304','51305','51306','51307','51309','51311','80616','80726','90014','90254','90283','90309','90312','90405','90428','90429','90431','90451','90726','90757','90782','90873','91391','91629','91635','91736','91938','91940','93242','93504','95142','95145','95240','96504','96523','96524','96657','97061','97084','97402','97455','97551','97555','97565','97566','97572','97732','97740','97753','97754','97755','97756','97757','97758','97759','97760','97761','97762','97763','97764','97765','97766','97767','97768','97769','97770','97774','97780','97781','97782','97783','97821','97909','97910','97911','97912','97913','97914','97915','97923','97966'];

const notFoundSet = new Set(notFoundList);

const wb = XLSX.readFile('/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Final']);

// Find Level 0 docs NOT in the not-found list
const level0Docs = rows.filter(r => {
  const level = parseInt(r['uploadLevel']) || 0;
  const docName = String(r['document:name'] || '');
  const docId = r['onshape:documentId'];
  const elemId = r['onshape:elementId'];
  return level === 0 && docId && elemId && !notFoundSet.has(docName);
});

console.log('Found', level0Docs.length, 'Level 0 docs not in the error list');

// Pick one from the middle
const testDoc = level0Docs[Math.floor(level0Docs.length / 2)];
console.log('');
console.log('Testing document:', testDoc['document:name']);
console.log('  fileName:', testDoc['File Name']);
console.log('  documentId:', testDoc['onshape:documentId']);
console.log('  workspaceId:', testDoc['onshape:workspaceId']);
console.log('  elementId:', testDoc['onshape:elementId']);
console.log('');

onshape.get({
  path: '/api/metadata/d/' + testDoc['onshape:documentId'] + '/w/' + testDoc['onshape:workspaceId'] + '/e/' + testDoc['onshape:elementId']
}, (data, err) => {
  if (err) {
    console.log('API Error:', err.statusCode, err.body ? JSON.parse(err.body).message : '');
  } else {
    const meta = JSON.parse(data.toString());
    const pn = meta.properties?.find(p => p.name === 'Part Number')?.value || '(blank)';
    console.log('API Success! Part Number:', pn);
  }
});
