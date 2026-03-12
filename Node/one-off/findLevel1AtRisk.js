/**
 * Find Level 1 items that have versionIds and are in documents
 * where a Level 2+ assembly will do Release:Document.
 */

const fs = require('fs');
const xlsx = require('xlsx');

// Load status file
const status = JSON.parse(fs.readFileSync('Upload/upload_status.json', 'utf8'));
const partMapping = status.partMapping || {};

console.log('=== Parts with versionId (already released) ===\n');
const releasedParts = Object.entries(partMapping).filter(([pn, info]) => info.versionId);
console.log('Total parts in partMapping:', Object.keys(partMapping).length);
console.log('Parts with versionId:', releasedParts.length);

if (releasedParts.length > 0) {
  console.log('\nReleased parts:');
  releasedParts.forEach(([pn, info]) => {
    console.log('  ' + pn + ' -> versionId: ' + (info.versionId || 'none').substring(0, 12) + '...');
  });
}

// Load Excel to find which docs have Level 2+ Release:Document
const excelPath = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx';
const workbook = xlsx.readFile(excelPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

// Find docs with Level 2+ Release:Document
const docsWithL2Release = new Set();
data.forEach(row => {
  const level = parseInt(row.uploadLevel);
  const release = (row.Release || '').toString().toLowerCase().trim();
  if (level >= 2 && release === 'document') {
    docsWithL2Release.add(row['document:name']);
  }
});

console.log('\n=== Documents with Level 2+ Release:Document ===');
console.log('Count:', docsWithL2Release.size);

// Find Level 1 items with versionId in those docs
console.log('\n=== Level 1 items WITH versionId in at-risk documents ===\n');

const level1AtRisk = [];
data.forEach(row => {
  if (row.uploadLevel !== 1) return;
  const docName = row['document:name'];
  const partNumber = row['property:Part number'] || '';

  // Check if this doc has a Level 2+ Release:Document
  if (!docsWithL2Release.has(docName)) return;

  // Check if this part has a versionId
  const partInfo = partMapping[partNumber];
  if (partInfo && partInfo.versionId) {
    level1AtRisk.push({
      document: docName,
      partNumber: partNumber,
      versionId: partInfo.versionId
    });
  }
});

if (level1AtRisk.length === 0) {
  console.log('None found.');
  console.log('\nNote: partMapping only has ' + Object.keys(partMapping).length + ' entries.');
  console.log('The released Level 1 parts may not be in docs with Level 2+ assemblies,');
  console.log('or their part numbers don\'t match the partMapping keys.');

  // Show what parts ARE in partMapping
  console.log('\n=== Parts in partMapping ===');
  Object.keys(partMapping).forEach(pn => {
    console.log('  ' + pn);
  });
} else {
  level1AtRisk.forEach(item => {
    console.log('Document: ' + item.document);
    console.log('  Part: ' + item.partNumber + ' (versionId: ' + item.versionId.substring(0, 12) + '...)');
  });
  console.log('\nTOTAL: ' + level1AtRisk.length + ' Level 1 parts at risk');
}
