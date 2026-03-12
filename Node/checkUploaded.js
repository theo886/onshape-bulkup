const xlsx = require('xlsx');
const wb = xlsx.readFile('../Current/level2last_reupload_completed.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws);
const uploaded = rows.filter(r => r['Uploaded'] === true);
console.log('Total:', rows.length);
console.log('Uploaded (new elements):', uploaded.length);
console.log('');
if (uploaded.length > 0) {
  console.log('=== Uploaded (need element deletion) ===');
  uploaded.forEach(r => {
    console.log(r['File Name'] + ' | doc:' + r['onshape:documentId'] + ' | wk:' + r['onshape:workspaceId'] + ' | elem:' + r['onshape:elementId']);
  });
}
