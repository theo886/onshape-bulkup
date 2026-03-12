const fs = require('fs');

const revertStatus = JSON.parse(fs.readFileSync('./upload_status_revert.json', 'utf8'));
const currentStatus = JSON.parse(fs.readFileSync('./Upload/upload_status.json', 'utf8'));

console.log('Before merge:');
console.log('  Current partMapping entries: ' + Object.keys(currentStatus.partMapping || {}).length);
console.log('  Current assemblyMapping entries: ' + Object.keys(currentStatus.assemblyMapping || {}).length);

let merged = 0;
let alreadyHad = 0;
let addedNew = 0;

// Merge versionIds from revert into current
for (const [pn, revertData] of Object.entries(revertStatus.partMapping || {})) {
  if (!revertData.versionId) continue;

  if (!currentStatus.partMapping[pn]) {
    // Part doesn't exist in current, add it
    currentStatus.partMapping[pn] = revertData;
    addedNew++;
  } else if (!currentStatus.partMapping[pn].versionId) {
    // Part exists but missing versionId, merge it
    currentStatus.partMapping[pn].versionId = revertData.versionId;
    merged++;
  } else {
    alreadyHad++;
  }
}

console.log('\nMerge results:');
console.log('  versionIds merged (existed but missing): ' + merged);
console.log('  Parts added (not in current): ' + addedNew);
console.log('  Already had versionId: ' + alreadyHad);

console.log('\nAfter merge:');
console.log('  partMapping entries: ' + Object.keys(currentStatus.partMapping).length);
console.log('  assemblyMapping entries: ' + Object.keys(currentStatus.assemblyMapping || {}).length);

// Count versionIds now
let withVersion = 0;
for (const data of Object.values(currentStatus.partMapping)) {
  if (data.versionId) withVersion++;
}
console.log('  Parts with versionId: ' + withVersion);

// Backup current and save merged
fs.writeFileSync('./Upload/upload_status_backup.json', fs.readFileSync('./Upload/upload_status.json', 'utf8'));
console.log('\nBackup saved to: Upload/upload_status_backup.json');

currentStatus.lastUpdated = new Date().toISOString();
fs.writeFileSync('./Upload/upload_status.json', JSON.stringify(currentStatus, null, 2));
console.log('Merged status saved to: Upload/upload_status.json');
