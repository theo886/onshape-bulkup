#!/usr/bin/env node
/**
 * Calculate assembly levels from ASMREF JSON data
 *
 * Level Logic:
 * - Level 2: Assembly contains only parts (no sub-assemblies)
 * - Level 3: Assembly contains Level 2 assemblies
 * - Level N: Assembly contains at least one Level N-1 assembly
 *
 * Output: CSV with assembly filename and calculated level
 *
 * Usage:
 *   node calculateLevelsFromAsmref.js [asmref.json] > assembly_levels.csv
 */

const fs = require('fs');
const path = require('path');

// Load ASMREF data
const asmrefPath = process.argv[2] || 'output/asmref.json';

if (!fs.existsSync(asmrefPath)) {
  console.error(`Error: ASMREF file not found: ${asmrefPath}`);
  console.error('Usage: node calculateLevelsFromAsmref.js [asmref.json]');
  process.exit(1);
}

const asmref = JSON.parse(fs.readFileSync(asmrefPath, 'utf8'));
const byAssembly = asmref.byAssembly;

if (!byAssembly) {
  console.error('Error: No byAssembly data found in ASMREF file');
  process.exit(1);
}

// Build set of all known assemblies (case-insensitive lookup)
const assemblyKeyMap = new Map();
for (const key of Object.keys(byAssembly)) {
  assemblyKeyMap.set(key.toUpperCase(), key);
}

// Memoization cache for calculated levels
const levelCache = new Map();

/**
 * Calculate the level of an assembly based on its components
 * @param {string} asmName - Assembly name (e.g., "20021.SLDASM")
 * @param {Set} visiting - Set of assemblies currently being visited (for cycle detection)
 * @returns {number} - Assembly level (2 = parts only, 3+ = contains sub-assemblies)
 */
function calculateLevel(asmName, visiting = new Set()) {
  const key = asmName.toUpperCase();

  // Return cached result if available
  if (levelCache.has(key)) {
    return levelCache.get(key);
  }

  // Detect circular dependencies - fallback to Level 2
  if (visiting.has(key)) {
    console.error(`Warning: Circular dependency detected at ${asmName}`);
    return 2;
  }

  visiting.add(key);

  // Get components for this assembly
  const components = byAssembly[asmName];
  if (!components) {
    // Assembly not in ASMREF - assume Level 2
    levelCache.set(key, 2);
    return 2;
  }

  let maxChildLevel = 0;

  // Check each component
  for (const [compName, compInfo] of Object.entries(components)) {
    if (compInfo.type === 'SLDASM') {
      // This component is a sub-assembly
      // Find matching assembly in byAssembly (case-insensitive)
      const matchKey = assemblyKeyMap.get(compName.toUpperCase());

      if (matchKey) {
        // Recursively calculate the sub-assembly's level
        const childLevel = calculateLevel(matchKey, new Set(visiting));
        maxChildLevel = Math.max(maxChildLevel, childLevel);
      } else {
        // Sub-assembly not in ASMREF - assume Level 2
        maxChildLevel = Math.max(maxChildLevel, 2);
      }
    }
  }

  // Level is 2 if no sub-assemblies, otherwise max child level + 1
  const level = maxChildLevel === 0 ? 2 : maxChildLevel + 1;
  levelCache.set(key, level);
  return level;
}

// Calculate levels for all assemblies
const results = [];
for (const asmName of Object.keys(byAssembly)) {
  const level = calculateLevel(asmName);
  // Remove .SLDASM extension for cleaner output
  const cleanName = asmName.replace(/\.SLDASM$/i, '');
  results.push({ assembly: cleanName, level });
}

// Sort by level (ascending) then by assembly name
results.sort((a, b) => a.level - b.level || a.assembly.localeCompare(b.assembly));

// Output CSV to stdout
console.log('Assembly,Level');
for (const { assembly, level } of results) {
  console.log(`${assembly},${level}`);
}

// Summary statistics to stderr (so they don't interfere with CSV output)
const byLevel = {};
results.forEach(r => {
  byLevel[r.level] = (byLevel[r.level] || 0) + 1;
});

console.error('\nLevel Summary:');
console.error('='.repeat(30));
Object.keys(byLevel)
  .sort((a, b) => Number(a) - Number(b))
  .forEach(l => {
    console.error(`  Level ${l}: ${byLevel[l]} assemblies`);
  });
console.error(`  Total: ${results.length} assemblies`);
