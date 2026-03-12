const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');

/**
 * Assigns upload levels to files based on their dependencies.
 *
 * Level 0: Non-CAD files (not .SLDPRT, not .SLDASM)
 * Level 1: SLDPRT files (parts)
 * Level 2+: SLDASM files (level = max child assembly level + 1)
 *
 * Usage: node assignLevels.js -i Upload/Onshape_Upload_List.xlsx -r PDM/references.csv
 */

const argv = minimist(process.argv.slice(2));

if (argv['h'] || argv['help']) {
  console.log(`
Assign upload levels to files based on dependencies.

Usage: node assignLevels.js -i <excelFile> -r <referencesCSV> [options]

Options:
  -i    Input Excel file (default: Upload/Onshape_Upload_List.xlsx)
  -r    References CSV from PDM (default: PDM/references.csv)
  -o    Output Excel file (default: overwrites input file)
  --dry-run  Show stats without writing
  -h    Show this help

New columns added:
  - uploadLevel: Integer indicating processing order (0=non-CAD, 1=parts, 2+=assemblies)
  - zipPath: Empty string (user fills in)
  - uploadStatus: "pending" (initial value)
  - onshape:documentId: Empty string (filled during upload)
  - onshape:elementId: Empty string (filled during upload)
  - folder: Empty string (user fills in)
`);
  process.exit(0);
}

const inputFile = argv['i'] || 'Upload/Onshape_Upload_List.xlsx';
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
 * Parse a single CSV line, handling quoted values with commas
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
 * Returns: { assemblyFile: [childFiles] } - all keys/values uppercase
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
    // Only add if not already present (avoid duplicates)
    if (!graph.get(assembly).includes(child)) {
      graph.get(assembly).push(child);
    }
  });

  return graph;
}

/**
 * Calculate assembly level using memoization
 * Level = max(child assembly levels) + 1
 * Parts (.SLDPRT) don't contribute to level calculation
 */
function calculateAssemblyLevel(filename, graph, levelCache, visiting = new Set()) {
  // Normalize to uppercase for case-insensitive lookup
  const normalizedFilename = filename.toUpperCase();

  // Check cache first
  if (levelCache.has(normalizedFilename)) {
    return levelCache.get(normalizedFilename);
  }

  // Detect circular dependencies
  if (visiting.has(normalizedFilename)) {
    console.warn(`Warning: Circular dependency detected for ${filename}`);
    return 2; // Default to level 2 for circular dependencies
  }

  visiting.add(normalizedFilename);

  const children = graph.get(normalizedFilename) || [];

  // If no children, this is a simple assembly with only parts
  if (children.length === 0) {
    levelCache.set(normalizedFilename, 2);
    visiting.delete(normalizedFilename);
    return 2;
  }

  let maxChildLevel = 0;

  for (const child of children) {
    const ext = pathModule.extname(child).toUpperCase();

    // Only assembly children contribute to level calculation
    if (ext === '.SLDASM') {
      const childLevel = calculateAssemblyLevel(child, graph, levelCache, new Set(visiting));
      maxChildLevel = Math.max(maxChildLevel, childLevel);
    }
    // .SLDPRT files don't affect level (they're level 1)
  }

  // This assembly's level is max child assembly level + 1
  // If all children are parts (maxChildLevel = 0), this becomes level 2
  const level = maxChildLevel === 0 ? 2 : maxChildLevel + 1;

  levelCache.set(normalizedFilename, level);
  visiting.delete(normalizedFilename);

  return level;
}

/**
 * Get filename from various possible column names
 * Handles both plain filenames and full paths (Windows or Unix style)
 * Priority: filename column > filePath > zipPath
 */
function getFilename(row) {
  // Try filename column first (preferred for reference lookup)
  let filename = row['filename'] || row['Filename'] || row['File Name'] || row['FileName'];

  // If not found, try extracting from filePath
  if (!filename && row['filePath']) {
    filename = row['filePath'];
  }

  // If still not found, check zipPath (fallback for assemblies)
  if (!filename && row['zipPath']) {
    filename = row['zipPath'];
  }

  // Handle Windows-style paths (backslashes) - extract just filename
  if (filename && filename.includes('\\')) {
    filename = filename.split('\\').pop();
  } else if (filename && filename.includes('/')) {
    filename = filename.split('/').pop();
  }

  return filename || '';
}

/**
 * Determine upload level for a file
 */
function determineLevel(filename, graph, levelCache) {
  const ext = pathModule.extname(filename).toUpperCase();

  if (ext === '.SLDPRT') {
    return 1;
  } else if (ext === '.SLDASM') {
    // Check if assembly exists in references graph
    const normalizedFilename = filename.toUpperCase();
    if (!graph.has(normalizedFilename)) {
      return '-'; // Not found in references.csv
    }
    return calculateAssemblyLevel(filename, graph, levelCache);
  } else {
    return 0; // Non-CAD files
  }
}

// Main execution
console.log('Assign Upload Levels to Files\n');

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

// Load and build reference graph
let graph = new Map();
if (fs.existsSync(referencesFile)) {
  console.log(`Reading references from: ${referencesFile}`);
  const references = parseCSV(referencesFile);
  console.log(`  Found ${references.length} reference relationships.`);
  graph = buildReferenceGraph(references);
  console.log(`  ${graph.size} unique assemblies with children.\n`);
} else {
  console.warn(`Warning: References file not found: ${referencesFile}`);
  console.warn('Assembly levels will all be set to 2 (no dependency data).\n');
}

// Calculate levels for all files
console.log('Calculating upload levels...');
const levelCache = new Map();
const stats = {
  total: 0,
  byLevel: {},
  maxLevel: 0,
  orphans: []
};

data.forEach((row, index) => {
  const filename = getFilename(row);

  if (!filename) {
    console.warn(`Warning: Row ${index + 1} has no filename, skipping.`);
    row.uploadLevel = null;
    return;
  }

  const level = determineLevel(filename, graph, levelCache);

  // Add new columns
  row.uploadLevel = level;
  row.zipPath = row.zipPath || '';
  row.uploadStatus = row.uploadStatus || 'pending';
  row['onshape:documentId'] = row['onshape:documentId'] || '';
  row['onshape:elementId'] = row['onshape:elementId'] || '';
  row.folder = row.folder || '';

  // Update stats
  stats.total++;
  stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;
  if (typeof level === 'number') {
    stats.maxLevel = Math.max(stats.maxLevel, level);
  }

  // Track assemblies not in references (orphans)
  const ext = pathModule.extname(filename).toUpperCase();
  if (ext === '.SLDASM' && !graph.has(filename.toUpperCase())) {
    stats.orphans.push(filename);
  }
});

// Print statistics
console.log('\n' + '='.repeat(60));
console.log('UPLOAD LEVEL STATISTICS');
console.log('='.repeat(60));
console.log(`Total files: ${stats.total}`);
console.log(`\nFiles by level:`);

const levelKeys = Object.keys(stats.byLevel);
const numericLevels = levelKeys.filter(k => k !== '-').map(Number).sort((a, b) => a - b);
const hasUnknown = levelKeys.includes('-');

numericLevels.forEach(level => {
  let description = '';
  if (level === 0) description = '(non-CAD files)';
  else if (level === 1) description = '(parts)';
  else description = '(assemblies)';

  console.log(`  Level ${level}: ${stats.byLevel[level]} files ${description}`);
});

if (hasUnknown) {
  console.log(`  Level -: ${stats.byLevel['-']} files (assemblies not in references.csv)`);
}

console.log(`\nMax level found: ${stats.maxLevel}`);

if (stats.orphans.length > 0) {
  console.log(`\nWarning: ${stats.orphans.length} assemblies not found in references.csv:`);
  stats.orphans.slice(0, 10).forEach(filename => {
    console.log(`  - ${filename}`);
  });
  if (stats.orphans.length > 10) {
    console.log(`  ... and ${stats.orphans.length - 10} more`);
  }
}

// Write output
if (dryRun) {
  console.log('\n--dry-run mode: No files written.');
} else {
  console.log(`\nWriting updated Excel file to: ${outputFile}`);

  // Update the existing worksheet in the original workbook (preserves other sheets)
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  workbook.Sheets[sheetName] = newWorksheet;

  // Write the original workbook back (preserves all sheets, formatting, etc.)
  xlsx.writeFile(workbook, outputFile);

  console.log('✓ Successfully updated Excel file with upload levels.');
  console.log('  (Other sheets in the workbook have been preserved)');
}

console.log('\n' + '='.repeat(60));
console.log('Done!');
console.log('='.repeat(60));
