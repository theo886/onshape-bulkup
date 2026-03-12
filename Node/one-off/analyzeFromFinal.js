/**
 * Analyze Level 1 items from 'Final' sheet that are at risk of double release.
 */

const xlsx = require('xlsx');
const fs = require('fs');

const excelPath = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx';
const workbook = xlsx.readFile(excelPath);
const finalSheet = workbook.Sheets['Final'];
const finalData = xlsx.utils.sheet_to_json(finalSheet);

console.log('=== Final Sheet Analysis ===\n');
console.log('Total rows:', finalData.length);

// Count by uploadLevel
const byLevel = {};
finalData.forEach(row => {
  const level = row.uploadLevel !== undefined ? String(row.uploadLevel) : 'undefined';
  if (!byLevel[level]) byLevel[level] = { total: 0, hasDocId: 0, needsRelease: 0 };
  byLevel[level].total++;
  if (row['onshape:documentId']) byLevel[level].hasDocId++;
  if (row['Needs release']) byLevel[level].needsRelease++;
});

console.log('\n=== By Upload Level ===');
console.log('Level | Total | Has DocId | Needs Release');
console.log('------|-------|-----------|---------------');
Object.keys(byLevel).sort((a,b) => Number(a) - Number(b)).forEach(level => {
  const b = byLevel[level];
  console.log(`  ${level.padEnd(4)} | ${String(b.total).padStart(5)} | ${String(b.hasDocId).padStart(9)} | ${b.needsRelease}`);
});

// Find documents with Level 2+ (these will do Release:Document)
const docsWithLevel2Plus = new Set();
finalData.forEach(row => {
  const level = parseInt(row.uploadLevel);
  if (level >= 2 && row['document:name']) {
    docsWithLevel2Plus.add(row['document:name']);
  }
});

console.log('\n=== Documents with Level 2+ assemblies ===');
console.log('Count:', docsWithLevel2Plus.size);

// Find Level 1 items that:
// 1. Have onshape:documentId (uploaded)
// 2. Are in a document that also has Level 2+
const level1AtRisk = [];
finalData.forEach(row => {
  if (row.uploadLevel !== 1) return;
  if (!row['onshape:documentId']) return; // Not uploaded

  const docName = row['document:name'];
  if (docsWithLevel2Plus.has(docName)) {
    level1AtRisk.push({
      document: docName,
      partNumber: row['property:Part number'] || '',
      fileName: row['File Name'] || '',
      documentId: row['onshape:documentId'],
      elementId: row['onshape:elementId'] || '',
      needsRelease: row['Needs release'] || '',
      uploadStatus: row['uploadStatus'] || ''
    });
  }
});

console.log('\n=== Level 1 Items AT RISK (uploaded, in docs with Level 2+) ===\n');
console.log('Total:', level1AtRisk.length);

if (level1AtRisk.length > 0) {
  // Group by document
  const byDoc = {};
  level1AtRisk.forEach(item => {
    if (!byDoc[item.document]) byDoc[item.document] = [];
    byDoc[item.document].push(item);
  });

  console.log('\nBy Document:');
  Object.keys(byDoc).sort().forEach(doc => {
    console.log('\nDocument: ' + doc);
    byDoc[doc].forEach(item => {
      console.log('  - ' + item.partNumber + ' (docId: ' + item.documentId.substring(0, 8) + '..., needsRelease: ' + item.needsRelease + ')');
    });
  });

  // Export to JSON
  fs.writeFileSync('output/level1_at_risk_final.json', JSON.stringify(level1AtRisk, null, 2));
  console.log('\n\nExported to: output/level1_at_risk_final.json');
} else {
  console.log('\nNo Level 1 items found that are both uploaded AND in docs with Level 2+ assemblies.');
}
