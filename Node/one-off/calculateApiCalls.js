const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Read Excel file
const wb = xlsx.readFile('Upload/Onshape_Upload_Finalx.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

// Filter to assemblies (uploadLevel >= 2)
const assemblies = data.filter(row => parseInt(row.uploadLevel) >= 2);
console.log('Assemblies in Excel:', assemblies.length);

// Get assembly filenames (from zipPath for assemblies, or 'File Name' column)
const assemblyFiles = new Set();
assemblies.forEach(row => {
  let filename = row['File Name'] || '';
  if (!filename && row.zipPath) {
    // Extract filename from zipPath and change .zip to .SLDASM
    filename = path.basename(row.zipPath).replace(/\.zip$/i, '.SLDASM');
  }
  if (filename) assemblyFiles.add(filename.toUpperCase());
});
console.log('Unique assembly filenames:', assemblyFiles.size);

// Read references.csv
const refs = fs.readFileSync('PDM/references.csv', 'utf8');
const lines = refs.split('\n').slice(2); // Skip header rows

// Count parts per assembly
const partsPerAssembly = {};
lines.forEach(line => {
  const parts = line.split(',');
  if (parts.length >= 3) {
    const assemblyFile = parts[0].trim().toUpperCase();
    const childFile = parts[2].trim().toUpperCase();
    if (assemblyFile && childFile) {
      if (!partsPerAssembly[assemblyFile]) {
        partsPerAssembly[assemblyFile] = { parts: 0, subAssemblies: 0 };
      }
      if (childFile.endsWith('.SLDPRT')) {
        partsPerAssembly[assemblyFile].parts++;
      } else if (childFile.endsWith('.SLDASM')) {
        partsPerAssembly[assemblyFile].subAssemblies++;
      }
    }
  }
});

// Calculate API calls for assemblies in Excel
let totalCalls = 0;
let totalParts = 0;
let totalSubAsm = 0;
let assemblyCount = 0;
let releaseCount = 0;
let missingRefCount = 0;

assemblies.forEach(row => {
  let filename = row['File Name'] || '';
  if (!filename && row.zipPath) {
    filename = path.basename(row.zipPath).replace(/\.zip$/i, '.SLDASM');
  }
  filename = filename.toUpperCase();

  const info = partsPerAssembly[filename] || { parts: 0, subAssemblies: 0 };

  if (!partsPerAssembly[filename]) {
    missingRefCount++;
  }

  const partsToRelink = info.parts + info.subAssemblies;
  const releaseMode = (row.Release || '').toString().toLowerCase().trim();

  // Fixed overhead per assembly:
  // Upload ZIP: 1
  // Poll translation: ~5 (average)
  // Find assembly element: 1
  // Relink fixed overhead: 8
  let calls = 1 + 5 + 1 + 8;

  // Per part relink: 2 calls (assuming released parts have versionId)
  calls += partsToRelink * 2;

  // Delete duplicate elements: 1 per part
  calls += partsToRelink * 1;

  // Set properties: 1
  calls += 1;

  // Release
  if (releaseMode === 'yes') {
    calls += 2;
    releaseCount++;
  } else if (releaseMode === 'document') {
    calls += 3;
    releaseCount++;
  }

  totalCalls += calls;
  totalParts += info.parts;
  totalSubAsm += info.subAssemblies;
  assemblyCount++;
});

console.log('\n=== API CALL ESTIMATE ===');
console.log('Assemblies to upload:', assemblyCount);
console.log('Assemblies missing from references.csv:', missingRefCount);
console.log('Total parts to relink:', totalParts);
console.log('Total sub-assemblies to relink:', totalSubAsm);
console.log('Assemblies with release:', releaseCount);
console.log('\nEstimated total API calls:', totalCalls);
console.log('Average calls per assembly:', Math.round(totalCalls / assemblyCount));

// Show breakdown
console.log('\n=== BREAKDOWN ===');
console.log('Fixed per assembly: 16 calls (upload + poll + find + relink overhead + properties)');
console.log('Per part relinked: 3 calls (create instance + get newest + delete element)');
console.log('Per release: 2-3 calls');
