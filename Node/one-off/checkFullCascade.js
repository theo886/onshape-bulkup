const asmref = require('../lib/asmref.js');
const data = asmref.load('output/asmref.json');

const seeds = ['43131','43459','43629','43763','43770','43777','43784'];

function findParents(partNum) {
  const results = [];
  const search = partNum.toUpperCase();
  for (const asm in data.byAssembly) {
    for (const comp in data.byAssembly[asm]) {
      if (comp.toUpperCase().startsWith(search + '.') || comp.toUpperCase().startsWith(search + '_')) {
        results.push(asm);
        break;
      }
    }
  }
  return results;
}

// BFS up the assembly tree
const allAffected = new Map(); // partNum -> { level, parents }
const queue = seeds.map(s => ({ partNum: s, level: 0 }));
const visited = new Set(seeds);

while (queue.length > 0) {
  const { partNum, level } = queue.shift();
  const parents = findParents(partNum);
  allAffected.set(partNum, { level, parents });

  for (const parent of parents) {
    const parentNum = parent.replace('.SLDASM', '');
    if (!visited.has(parentNum)) {
      visited.add(parentNum);
      queue.push({ partNum: parentNum, level: level + 1 });
    }
  }
}

// Print by level
const maxLevel = Math.max(...[...allAffected.values()].map(v => v.level));
for (let l = 0; l <= maxLevel; l++) {
  const atLevel = [...allAffected.entries()].filter(([, v]) => v.level === l);
  if (atLevel.length === 0) continue;
  console.log(`\n=== Level ${l}${l === 0 ? ' (original - fix these first)' : ' (parents - fix after level ' + (l-1) + ')'} ===`);
  for (const [partNum, info] of atLevel.sort((a, b) => a[0].localeCompare(b[0]))) {
    const parentStr = info.parents.length > 0 ? ' -> used in: ' + info.parents.join(', ') : ' (top-level)';
    console.log(`  ${partNum}.SLDASM${parentStr}`);
  }
}

console.log(`\nTotal assemblies affected: ${allAffected.size}`);
