const fs = require('fs');
const xlsx = require('xlsx');

// Load files
const statusFile = './Upload/upload_status.json';
const excelFile = './Upload/Onshape_Upload_Level2_retry.xlsx';

console.log('Loading files...');
const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
const workbook = xlsx.readFile(excelFile);
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

console.log(`Excel has ${rows.length} rows`);
console.log(`partMapping has ${Object.keys(status.partMapping || {}).length} entries`);
console.log(`assemblyMapping has ${Object.keys(status.assemblyMapping || {}).length} entries`);

// Summary by level
console.log(`\n${'='.repeat(60)}`);
console.log('STATUS BY UPLOAD LEVEL');
console.log('='.repeat(60));
console.log('Level | Total | Uploaded | Released');
console.log('-'.repeat(45));

const byLevel = {};
rows.forEach(r => {
  const level = r['uploadLevel'];
  if (byLevel[level] === undefined) byLevel[level] = { total: 0, hasDoc: 0, hasVersion: 0 };
  byLevel[level].total++;

  const pn = r['property:Part number'];
  const mapping = status.partMapping[pn] || status.assemblyMapping[pn];
  const hasDoc = r['onshape:documentId'] || (mapping ? mapping.documentId : null);
  const hasVersion = mapping ? mapping.versionId : null;

  if (hasDoc) byLevel[level].hasDoc++;
  if (hasVersion) byLevel[level].hasVersion++;
});

Object.keys(byLevel).sort((a, b) => a - b).forEach(level => {
  const l = byLevel[level];
  console.log(`${String(level).padStart(5)} | ${String(l.total).padStart(5)} | ${String(l.hasDoc).padStart(8)} | ${String(l.hasVersion).padStart(8)}`);
});

// Totals
let totalFiles = 0, totalDoc = 0, totalVer = 0;
Object.values(byLevel).forEach(l => { totalFiles += l.total; totalDoc += l.hasDoc; totalVer += l.hasVersion; });
console.log('-'.repeat(45));
console.log(`Total | ${String(totalFiles).padStart(5)} | ${String(totalDoc).padStart(8)} | ${String(totalVer).padStart(8)}`);
console.log(`\nNot uploaded: ${totalFiles - totalDoc}`);
console.log(`Uploaded but not released: ${totalDoc - totalVer}`);

// Get Level 1 files
const level1Files = rows.filter(r => r['uploadLevel'] === 1);
console.log(`\nLevel 1 files in Excel: ${level1Files.length}`);

// Categorize Level 1 files
const ready = [];
const inMappingNoVersion = [];
const notInMapping = [];

for (const row of level1Files) {
  const partNumber = row['property:Part number'];
  const mapping = status.partMapping ? status.partMapping[partNumber] : null;

  if (!mapping) {
    notInMapping.push({
      partNumber,
      hasExcelIds: !!(row['onshape:documentId'] && row['onshape:elementId']),
      docId: row['onshape:documentId']
    });
  } else if (!mapping.versionId) {
    inMappingNoVersion.push({
      partNumber,
      docId: mapping.documentId,
      elemId: mapping.elementId
    });
  } else {
    ready.push({ partNumber, versionId: mapping.versionId });
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('LEVEL 1 RELINK READINESS');
console.log('='.repeat(60));
console.log(`Ready (have versionId): ${ready.length}`);
console.log(`In partMapping but no versionId: ${inMappingNoVersion.length}`);
console.log(`Not in partMapping: ${notInMapping.length}`);
console.log(`  - With Excel IDs: ${notInMapping.filter(n => n.hasExcelIds).length}`);
console.log(`  - Without any IDs: ${notInMapping.filter(n => !n.hasExcelIds).length}`);

// Check for duplicate part numbers in Excel (same PN, different documents)
const excelPNDocs = {};
rows.forEach(r => {
  const pn = r['property:Part number'];
  const docId = r['onshape:documentId'];
  if (pn && docId) {
    if (!excelPNDocs[pn]) excelPNDocs[pn] = new Set();
    excelPNDocs[pn].add(docId);
  }
});

const duplicatePNs = Object.entries(excelPNDocs)
  .filter(([pn, docs]) => docs.size > 1)
  .map(([pn, docs]) => ({ partNumber: pn, docCount: docs.size, docIds: [...docs] }));

console.log(`\n${'='.repeat(60)}`);
console.log('DUPLICATE PART NUMBERS (same PN, different documents)');
console.log('='.repeat(60));
console.log(`Part numbers appearing in multiple documents: ${duplicatePNs.length}`);

if (duplicatePNs.length > 0) {
  console.log(`\nDuplicates (first 30):`);
  duplicatePNs.slice(0, 30).forEach(d => {
    console.log(`  ${d.partNumber} -> ${d.docCount} docs: ${d.docIds.join(', ')}`);
  });
}

// Sample listings
console.log(`\n${'='.repeat(60)}`);
console.log('SAMPLE: Parts not in partMapping (first 30)');
console.log('='.repeat(60));
notInMapping.slice(0, 30).forEach(n => {
  const idInfo = n.hasExcelIds ? `Excel doc: ${n.docId}` : 'NO IDs';
  console.log(`  ${n.partNumber} (${idInfo})`);
});

console.log(`\n${'='.repeat(60)}`);
console.log('SAMPLE: In mapping but no versionId (first 30)');
console.log('='.repeat(60));
inMappingNoVersion.slice(0, 30).forEach(n => {
  console.log(`  ${n.partNumber} doc:${n.docId}`);
});

// Write lists to files for further action
fs.writeFileSync('./Upload/level1_missing_versionId.json', JSON.stringify(inMappingNoVersion, null, 2));
fs.writeFileSync('./Upload/level1_not_in_mapping.json', JSON.stringify(notInMapping, null, 2));
console.log(`\nWrote missing lists to Upload/level1_missing_versionId.json and level1_not_in_mapping.json`);
