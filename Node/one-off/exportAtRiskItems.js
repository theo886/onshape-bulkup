/**
 * Export at-risk items to Excel for review.
 */

const fs = require('fs');
const xlsx = require('xlsx');

const data = JSON.parse(fs.readFileSync('output/double_release_risk.json', 'utf8'));

console.log('Exporting at-risk items to Excel...\n');

// Prepare data for Excel
const rows = data.notYetReleased.map(item => ({
  'Document': item.document,
  'Upload Level': item.level,
  'Part Number': item.partNumber,
  'Current Release Setting': item.release || '(none)',
  'Risk': 'Will be released by Level 2+ Release:Document',
  'Has VersionId': item.hasVersionId ? 'Yes' : 'No'
}));

// Create workbook
const workbook = xlsx.utils.book_new();
const worksheet = xlsx.utils.json_to_sheet(rows);

// Set column widths
worksheet['!cols'] = [
  { wch: 15 },  // Document
  { wch: 12 },  // Upload Level
  { wch: 25 },  // Part Number
  { wch: 22 },  // Current Release Setting
  { wch: 45 },  // Risk
  { wch: 12 }   // Has VersionId
];

xlsx.utils.book_append_sheet(workbook, worksheet, 'At Risk Items');

// Add summary sheet
const summary = [
  { 'Metric': 'Total At-Risk Items', 'Value': data.notYetReleased.length },
  { 'Metric': 'Level 0 Items', 'Value': data.notYetReleased.filter(i => i.level === 0).length },
  { 'Metric': 'Level 1 Items', 'Value': data.notYetReleased.filter(i => i.level === 1).length },
  { 'Metric': 'Documents Affected', 'Value': data.summary.documentsAffected },
  { 'Metric': 'Already Released', 'Value': data.summary.alreadyReleased },
  { 'Metric': '', 'Value': '' },
  { 'Metric': 'RISK EXPLANATION', 'Value': 'These Level 0/1 items are in documents where a Level 2+ assembly has Release:Document. When that assembly uploads, ALL elements in the document will be released, including these items.' }
];
const summarySheet = xlsx.utils.json_to_sheet(summary);
summarySheet['!cols'] = [{ wch: 25 }, { wch: 80 }];
xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

// Write file
const outputPath = 'output/at_risk_items.xlsx';
xlsx.writeFile(workbook, outputPath);

console.log(`Exported ${rows.length} items to: ${outputPath}`);
console.log('\nSummary:');
console.log(`  Level 0: ${data.notYetReleased.filter(i => i.level === 0).length}`);
console.log(`  Level 1: ${data.notYetReleased.filter(i => i.level === 1).length}`);
console.log(`  Documents affected: ${data.summary.documentsAffected}`);
