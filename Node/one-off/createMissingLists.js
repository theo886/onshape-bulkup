const fs = require('fs');
const xlsx = require('xlsx');

const status = JSON.parse(fs.readFileSync('./Upload/upload_status.json', 'utf8'));
const wb = xlsx.readFile('./Upload/Onshape_Upload_Level2_retry.xlsx');
const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

const level1Files = rows.filter(r => r['uploadLevel'] === 1);

// Categorize
const needRelease = [];
const needUpload = [];

for (const row of level1Files) {
  const pn = row['property:Part number'];
  const mapping = status.partMapping ? status.partMapping[pn] : null;

  if (!mapping) {
    // Not in partMapping - need to upload
    needUpload.push(row);
  } else if (!mapping.versionId) {
    // In partMapping but no versionId - need to release
    // Add the Onshape IDs from mapping to the row
    row['onshape:documentId'] = mapping.documentId;
    row['onshape:workspaceId'] = mapping.workspaceId;
    row['onshape:elementId'] = mapping.elementId;
    row['Release'] = 'yes';
    needRelease.push(row);
  }
}

console.log('Parts needing RELEASE: ' + needRelease.length);
console.log('Parts needing UPLOAD: ' + needUpload.length);

// Create Excel for parts needing release
if (needRelease.length > 0) {
  const releaseWb = xlsx.utils.book_new();
  const releaseWs = xlsx.utils.json_to_sheet(needRelease);
  xlsx.utils.book_append_sheet(releaseWb, releaseWs, 'NeedRelease');
  xlsx.writeFile(releaseWb, './Upload/Level1_NeedRelease.xlsx');
  console.log('\nCreated: Upload/Level1_NeedRelease.xlsx');
  console.log('  Columns: onshape:documentId, onshape:workspaceId, onshape:elementId, Release=yes');
  console.log('  Run: node releaseFromExcel.js -i Upload/Level1_NeedRelease.xlsx');
}

// Create Excel for parts needing upload
if (needUpload.length > 0) {
  const uploadWb = xlsx.utils.book_new();
  const uploadWs = xlsx.utils.json_to_sheet(needUpload);
  xlsx.utils.book_append_sheet(uploadWb, uploadWs, 'NeedUpload');
  xlsx.writeFile(uploadWb, './Upload/Level1_NeedUpload.xlsx');
  console.log('\nCreated: Upload/Level1_NeedUpload.xlsx');
  console.log('  These parts need to be uploaded first');
  console.log('  Run: node unifiedUpload.js -i Upload/Level1_NeedUpload.xlsx --level 1');
}

console.log('\nDone!');
