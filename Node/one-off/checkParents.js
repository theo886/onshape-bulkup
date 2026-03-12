const asmref = require('../lib/asmref.js');
const data = asmref.load('output/asmref.json');
const targets = ['43131','43459','43629','43763','43770','43777','43784'];

for (const t of targets) {
  const key = t + '.SLDASM';
  const parents = data.byPartNumber?.[t] || [];
  // Also check byAssembly for any assembly that has this as a component
  const foundIn = [];
  for (const asm in data.byAssembly) {
    for (const comp in data.byAssembly[asm]) {
      if (comp.toUpperCase().startsWith(t)) {
        foundIn.push(asm);
        break;
      }
    }
  }
  console.log(key + ':');
  if (parents.length) console.log('  byPartNumber:', parents.join(', '));
  if (foundIn.length) console.log('  found as component in:', foundIn.join(', '));
  if (parents.length === 0 && foundIn.length === 0) console.log('  NOT referenced as sub-assembly anywhere');
}
