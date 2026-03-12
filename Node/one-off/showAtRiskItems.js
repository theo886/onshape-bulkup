const fs = require('fs');
const data = JSON.parse(fs.readFileSync('output/double_release_risk.json', 'utf8'));

console.log('=== Level 0/1 Items At Risk (in docs with Level 2+ Release:Document) ===\n');
console.log('Total: ' + data.notYetReleased.length + ' items\n');

// Group by document
const byDoc = {};
data.notYetReleased.forEach(item => {
  if (!byDoc[item.document]) byDoc[item.document] = [];
  byDoc[item.document].push(item);
});

// Show all
Object.keys(byDoc).sort().forEach(doc => {
  const items = byDoc[doc];
  console.log('Document: ' + doc);
  items.forEach(item => {
    console.log('  Level ' + item.level + ': ' + item.partNumber + ' (Release: ' + (item.release || 'none') + ')');
  });
});

console.log('\n=== Summary by Level ===');
const level0 = data.notYetReleased.filter(i => i.level === 0).length;
const level1 = data.notYetReleased.filter(i => i.level === 1).length;
console.log('Level 0: ' + level0);
console.log('Level 1: ' + level1);
