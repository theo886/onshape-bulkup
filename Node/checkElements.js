const xlsx = require('xlsx');
const onshape = require('./lib/onshape');
const wb = xlsx.readFile('../Current/level2last.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws);

let idx = 0;
let found = 0;
let missing = 0;
const missingList = [];

function checkNext() {
  if (idx >= rows.length) {
    console.log('\n=== Summary ===');
    console.log('Total:', rows.length);
    console.log('Found:', found);
    console.log('Missing:', missing);
    if (missingList.length > 0) {
      console.log('\nMissing elements:');
      missingList.forEach(r => console.log('  ' + r));
    }
    return;
  }

  const row = rows[idx];
  const docId = row['onshape:documentId'];
  const wkId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];
  const fileName = row['File Name'];
  const i = idx;

  if (!docId || !elemId) {
    console.log('[' + i + '] ' + fileName + ' — SKIP (no IDs)');
    missingList.push(fileName + ' (no IDs)');
    missing++;
    idx++;
    checkNext();
    return;
  }

  onshape.get({
    path: '/api/documents/d/' + docId + '/w/' + wkId + '/elements'
  }, (data, err) => {
    if (err) {
      const code = err.statusCode || err.message || err;
      console.log('[' + i + '] ' + fileName + ' — ERROR: ' + code);
      missingList.push(fileName + ' (error: ' + code + ')');
      missing++;
    } else {
      const elements = JSON.parse(data.toString());
      const match = elements.find(e => e.id === elemId);
      if (match) {
        console.log('[' + i + '] ' + fileName + ' — OK (' + match.type + ': ' + match.name + ')');
        found++;
      } else {
        const elemList = elements.map(e => e.name + ' (' + e.type + ', ' + e.id.substring(0,8) + ')').join(', ');
        console.log('[' + i + '] ' + fileName + ' — MISSING elem ' + elemId.substring(0,8) + '... | actual: [' + elemList + ']');
        missingList.push(fileName + ' | doc:' + docId + ' | expected:' + elemId.substring(0,8) + ' | actual:[' + elemList + ']');
        missing++;
      }
    }
    idx++;
    setTimeout(checkNext, 200);
  });
}

checkNext();
