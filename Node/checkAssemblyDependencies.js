/**
 * Check Assembly Dependencies
 *
 * For each SLDASM file with status TRUE, checks if all its child parts and
 * sub-assemblies are present in the upload list and also have status TRUE.
 *
 * Usage: node checkAssemblyDependencies.js [-i <excelFile>] [-r <referencesCSV>] [--dry-run]
 */

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));

if (argv['h'] || argv['help']) {
  console.log(`
Check Assembly Dependencies

Checks if all child files of assemblies with status=TRUE are present and also TRUE.

Usage: node checkAssemblyDependencies.js [options]

Options:
  -i    Input Excel file (default: Upload/Onshape_Up.xlsx)
  -r    References CSV from PDM (default: PDM/references.csv)
  -o    Output Excel file (default: overwrites input file)
  --dry-run  Show stats without writing
  -h    Show this help

New columns added:
  - assemcheck: 1 = all dependencies present & TRUE, 2 = missing dependencies
  - assemcheck_files: comma-separated list of missing/not-TRUE files
  - referenced_by: assemblies that reference this file (if it's missing or not TRUE)

Also exports: <inputfile>_missing_files.xlsx with missing files and referencing assemblies
`);
  process.exit(0);
}

const inputFile = argv['i'] || 'Upload/Onshape_Up.xlsx';
const referencesFile = argv['r'] || 'PDM/references.csv';
const outputFile = argv['o'] || inputFile;
const dryRun = argv['dry-run'] || false;

/**
 * Parse CSV file into array of objects
 * Handles PDM Report Generator format (title row, then headers, then data)
 */
function parseCSV(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Check if first line is a title (PDM Report Generator adds a title row)
  let headerLineIndex = 0;
  if (!lines[0].includes('AssemblyFile') && !lines[0].includes('Filename') && !lines[0].includes('DocumentID')) {
    headerLineIndex = 1; // Skip title row
  }

  if (lines.length <= headerLineIndex) return [];

  const headers = lines[headerLineIndex].split(',').map(h => h.trim().replace(/"/g, ''));
  const data = [];

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] || '';
    });
    data.push(obj);
  }
  return data;
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/"/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/"/g, ''));
  return values;
}

/**
 * Build reference graph from PDM data (case-insensitive)
 * Returns: Map { assemblyFile -> [childFiles] } - all keys/values uppercase
 */
function buildReferenceGraph(references) {
  const graph = new Map();

  references.forEach(ref => {
    const assembly = (ref.AssemblyFile || ref.assemblyFile || '').toUpperCase();
    const child = (ref.ChildFile || ref.childFile || '').toUpperCase();

    if (!assembly || !child) return;

    if (!graph.has(assembly)) {
      graph.set(assembly, []);
    }
    if (!graph.get(assembly).includes(child)) {
      graph.get(assembly).push(child);
    }
  });

  return graph;
}

/**
 * Recursively get all dependencies (parts and sub-assemblies) for an assembly
 */
function getAllDependencies(assemblyName, graph, visited = new Set()) {
  const normalized = assemblyName.toUpperCase();

  if (visited.has(normalized)) {
    return []; // Avoid circular dependencies
  }
  visited.add(normalized);

  const children = graph.get(normalized) || [];
  let allDeps = [...children];

  // Recursively get dependencies of sub-assemblies
  children.forEach(child => {
    if (child.toUpperCase().endsWith('.SLDASM')) {
      const subDeps = getAllDependencies(child, graph, visited);
      allDeps = allDeps.concat(subDeps);
    }
  });

  // Return unique dependencies
  return [...new Set(allDeps)];
}

// Main execution
console.log('Check Assembly Dependencies\n');

// Check if input file exists
if (!fs.existsSync(inputFile)) {
  console.error(`Error: Input file not found: ${inputFile}`);
  process.exit(1);
}

console.log(`Reading Excel file: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

console.log(`  Found ${data.length} rows.\n`);

// Build a map of all files in the upload list (case-insensitive)
// Map: filename (uppercase) -> { present: true, status: boolean }
const uploadFiles = new Map();
data.forEach(row => {
  const filename = String(row['File Name'] || '').toUpperCase();
  if (filename) {
    // Check for TRUE status - handle various representations
    const status = row['Uploaded'];
    const isTrue = status === true || status === 'TRUE' || status === 'true' || status === 1;
    uploadFiles.set(filename, { present: true, status: isTrue });
  }
});

console.log(`  ${uploadFiles.size} unique files in upload list.\n`);

// Load and build reference graph
let graph = new Map();
if (fs.existsSync(referencesFile)) {
  console.log(`Reading references from: ${referencesFile}`);
  const references = parseCSV(referencesFile);
  console.log(`  Found ${references.length} reference relationships.`);
  graph = buildReferenceGraph(references);
  console.log(`  ${graph.size} unique assemblies with children.\n`);
} else {
  console.error(`Error: References file not found: ${referencesFile}`);
  process.exit(1);
}

// Check each assembly with status TRUE
console.log('Checking assembly dependencies...');

const stats = {
  totalAssemblies: 0,
  assembliesWithTrueStatus: 0,
  allDepsPresent: 0,
  missingDeps: 0
};

// Track which assemblies reference each missing/not-TRUE file
// Map: filename (uppercase) -> Set of assembly names that reference it
const missingFileReferences = new Map();

data.forEach(row => {
  const filename = String(row['File Name'] || '');
  const ext = pathModule.extname(filename).toUpperCase();

  // Only process SLDASM files
  if (ext !== '.SLDASM') {
    row.assemcheck = '';
    row.assemcheck_files = '';
    return;
  }

  stats.totalAssemblies++;

  // Check if this assembly has status TRUE
  const status = row['Uploaded'];
  const isTrue = status === true || status === 'TRUE' || status === 'true' || status === 1;

  if (!isTrue) {
    row.assemcheck = '';
    row.assemcheck_files = '';
    return;
  }

  stats.assembliesWithTrueStatus++;

  // Get all dependencies for this assembly
  const deps = getAllDependencies(filename, graph);

  // Check which dependencies are missing or don't have TRUE status
  const missingFiles = [];

  deps.forEach(dep => {
    const depUpper = dep.toUpperCase();
    const fileInfo = uploadFiles.get(depUpper);

    if (!fileInfo) {
      missingFiles.push(`${dep} (not in list)`);
      // Track this missing file and the assembly that references it
      if (!missingFileReferences.has(depUpper)) {
        missingFileReferences.set(depUpper, new Set());
      }
      missingFileReferences.get(depUpper).add(filename);
    } else if (!fileInfo.status) {
      missingFiles.push(`${dep} (status not TRUE)`);
      // Track this not-TRUE file and the assembly that references it
      if (!missingFileReferences.has(depUpper)) {
        missingFileReferences.set(depUpper, new Set());
      }
      missingFileReferences.get(depUpper).add(filename);
    }
  });

  if (missingFiles.length === 0) {
    row.assemcheck = 1;
    row.assemcheck_files = '';
    stats.allDepsPresent++;
  } else {
    row.assemcheck = 2;
    row.assemcheck_files = missingFiles.join(', ');
    stats.missingDeps++;
  }
});

// Add column to each row showing which assemblies reference this file (if it's missing/not TRUE)
data.forEach(row => {
  const filename = String(row['File Name'] || '').toUpperCase();
  const referencingAssemblies = missingFileReferences.get(filename);
  if (referencingAssemblies && referencingAssemblies.size > 0) {
    row.referenced_by = [...referencingAssemblies].join(', ');
  } else {
    row.referenced_by = '';
  }
});

// Print statistics
console.log('\n' + '='.repeat(60));
console.log('ASSEMBLY DEPENDENCY CHECK RESULTS');
console.log('='.repeat(60));
console.log(`Total SLDASM files: ${stats.totalAssemblies}`);
console.log(`Assemblies with status TRUE: ${stats.assembliesWithTrueStatus}`);
console.log(`  - All dependencies present & TRUE: ${stats.allDepsPresent}`);
console.log(`  - Missing dependencies: ${stats.missingDeps}`);

// Write output
if (dryRun) {
  console.log('\n--dry-run mode: No files written.');
} else {
  console.log(`\nWriting updated Excel file to: ${outputFile}`);

  const newWorksheet = xlsx.utils.json_to_sheet(data);
  workbook.Sheets[sheetName] = newWorksheet;
  xlsx.writeFile(workbook, outputFile);

  console.log('✓ Successfully updated Excel file with assemcheck columns.');

  // Export separate xlsx with missing files and their referencing assemblies
  const missingFilesData = [];
  missingFileReferences.forEach((assemblies, filename) => {
    missingFilesData.push({
      'Missing File': filename,
      'Referenced By Assemblies': [...assemblies].join(', ')
    });
  });

  if (missingFilesData.length > 0) {
    const missingFilesWorkbook = xlsx.utils.book_new();
    const missingFilesSheet = xlsx.utils.json_to_sheet(missingFilesData);
    xlsx.utils.book_append_sheet(missingFilesWorkbook, missingFilesSheet, 'Missing Files');

    const missingFilesPath = outputFile.replace(/\.xlsx$/i, '_missing_files.xlsx');
    xlsx.writeFile(missingFilesWorkbook, missingFilesPath);

    console.log(`✓ Exported ${missingFilesData.length} missing files to: ${missingFilesPath}`);
  } else {
    console.log('  No missing files to export.');
  }
}

console.log('\n' + '='.repeat(60));
console.log('Done!');
console.log('='.repeat(60));
