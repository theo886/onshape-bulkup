/**
 * Simple test to verify the relink module exports
 */

const relink = require('./lib/relink.js');

console.log('Testing relink module exports...\n');

const expectedFunctions = [
  'getAssemblyDefinition',
  'deleteInstances',
  'createVersion',
  'createInstanceWithTransform',
  'getNewestInstance',
  'groupInstances',
  'fastenToOrigin',
  'deleteElement',
  'updateExternalReferences',
  'relinkAssembly'
];

let allPassed = true;

expectedFunctions.forEach(funcName => {
  if (typeof relink[funcName] === 'function') {
    console.log(`✓ ${funcName} exported correctly`);
  } else {
    console.log(`✗ ${funcName} missing or not a function`);
    allPassed = false;
  }
});

console.log(`\n${allPassed ? '✓ All exports verified!' : '✗ Some exports are missing'}`);
process.exit(allPassed ? 0 : 1);
