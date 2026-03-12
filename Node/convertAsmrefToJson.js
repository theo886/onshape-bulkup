/**
 * Convert ASMREF Excel file to optimized JSON for fast lookups.
 *
 * Usage: node convertAsmrefToJson.js -i output/ASMREF.xlsx -o output/asmref.json
 *
 * Input Excel columns:
 *   - Assem File Name: Assembly filename (e.g., "100002.SLDASM")
 *   - Link File Name: Component filename (e.g., "51298.SLDPRT")
 *   - Virtual Part: "TRUE" if virtual part
 *   - Type: "SLDPRT" or "SLDASM"
 *   - property:* columns: Properties to set
 *   - onshape:* columns: Onshape IDs (may be empty for unuploaded items)
 *
 * Output JSON structure:
 *   byAssembly: { assemblyName: { linkFileName: entry } }
 *   byPartNumber: { partNumber: [assemblyNames...] }
 *   metadata: { generated, sourceFile, rowCount, withIds, withoutIds }
 */

const fs = require('fs');
const xlsx = require('xlsx');
const minimist = require('minimist');
const path = require('path');

function convertAsmrefToJson(inputPath, outputPath) {
  console.log(`Reading ASMREF Excel: ${inputPath}`);

  const workbook = xlsx.readFile(inputPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet);

  console.log(`Processing ${rows.length} rows...`);

  const result = {
    byAssembly: {},
    byPartNumber: {},
    metadata: {
      generated: new Date().toISOString(),
      sourceFile: path.basename(inputPath),
      rowCount: rows.length,
      withIds: 0,
      withoutIds: 0,
      virtualParts: 0,
      subassemblies: 0
    }
  };

  rows.forEach((row, idx) => {
    // Get assembly and link file names (case-insensitive keys)
    const assemblyName = (row['Assem File Name'] || '').toString().trim();
    // Use 'Part File Name' (original name) instead of 'Link File Name' which may have config suffix
    // Example: Link File Name = "30093_[30093-01].SLDPRT", Part File Name = "30093.SLDPRT"
    const linkFileName = (row['Part File Name_'] || row['Part File Name'] || row['Link File Name_'] || row['Link File Name'] || '').toString().trim();

    if (!assemblyName || !linkFileName) {
      console.warn(`  Row ${idx + 2}: Missing assembly or link file name, skipping`);
      return;
    }

    // Normalize to uppercase for consistent lookups
    const asmKey = assemblyName.toUpperCase();
    const linkKey = linkFileName.toUpperCase();

    // Check if we have Onshape IDs
    const documentId = row['onshape:documentId'] || null;
    const workspaceId = row['onshape:workspaceId'] || null;
    const elementId = row['onshape:elementId'] || null;
    const versionId = row['onshape:versionId'] || null;

    const hasIds = !!(documentId && workspaceId && elementId);

    // Determine type and virtual status
    const type = (row['Type'] || '').toString().trim().toUpperCase();
    const isVirtualRaw = row['Virtual Part'];
    const isVirtual = isVirtualRaw === true ||
                      isVirtualRaw === 'TRUE' ||
                      isVirtualRaw === 'true' ||
                      isVirtualRaw === 1 ||
                      isVirtualRaw === '1';

    // Build properties object
    const properties = {};
    for (const key in row) {
      if (key.startsWith('property:')) {
        const propName = key.substring(9); // Remove 'property:' prefix
        const value = row[key];
        if (value !== null && value !== undefined && value !== '') {
          properties[propName] = value.toString();
        }
      }
    }

    // Build entry
    const entry = {
      documentId: documentId,
      workspaceId: workspaceId,
      elementId: elementId,
      versionId: versionId,
      isVirtual: isVirtual,
      type: type || (linkFileName.toUpperCase().endsWith('.SLDASM') ? 'SLDASM' : 'SLDPRT'),
      partNumber: properties['Part number'] || null,
      properties: properties
    };

    // Initialize assembly entry if needed
    if (!result.byAssembly[asmKey]) {
      result.byAssembly[asmKey] = {};
    }

    // Store entry (multiple instances of same part become one entry)
    // If already exists, keep the one with IDs (or first one)
    if (!result.byAssembly[asmKey][linkKey] ||
        (hasIds && !result.byAssembly[asmKey][linkKey].documentId)) {
      result.byAssembly[asmKey][linkKey] = entry;
    }

    // Build byPartNumber reverse lookup
    if (entry.partNumber) {
      if (!result.byPartNumber[entry.partNumber]) {
        result.byPartNumber[entry.partNumber] = [];
      }
      if (!result.byPartNumber[entry.partNumber].includes(asmKey)) {
        result.byPartNumber[entry.partNumber].push(asmKey);
      }
    }

    // Update stats
    if (hasIds) {
      result.metadata.withIds++;
    } else {
      result.metadata.withoutIds++;
    }
    if (isVirtual) {
      result.metadata.virtualParts++;
    }
    if (type === 'SLDASM' || linkFileName.toUpperCase().endsWith('.SLDASM')) {
      result.metadata.subassemblies++;
    }
  });

  // Count unique entries
  let uniqueEntries = 0;
  for (const asmKey in result.byAssembly) {
    uniqueEntries += Object.keys(result.byAssembly[asmKey]).length;
  }
  result.metadata.uniqueEntries = uniqueEntries;
  result.metadata.assemblies = Object.keys(result.byAssembly).length;

  // Write output
  console.log(`\nWriting JSON: ${outputPath}`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  // Summary
  console.log('\n=== Conversion Summary ===');
  console.log(`  Source rows: ${result.metadata.rowCount}`);
  console.log(`  Assemblies: ${result.metadata.assemblies}`);
  console.log(`  Unique entries: ${result.metadata.uniqueEntries}`);
  console.log(`  With Onshape IDs: ${result.metadata.withIds}`);
  console.log(`  Without IDs: ${result.metadata.withoutIds}`);
  console.log(`  Virtual parts: ${result.metadata.virtualParts}`);
  console.log(`  Subassemblies: ${result.metadata.subassemblies}`);
  console.log(`\nOutput: ${outputPath}`);

  return result;
}

// Show usage
function showUsage() {
  console.log('\nConvert ASMREF Excel to JSON for fast lookups\n');
  console.log('Usage: node convertAsmrefToJson.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>   Input ASMREF Excel file (default: output/ASMREF.xlsx)');
  console.log('  -o <path>   Output JSON file (default: output/asmref.json)');
  console.log('  -h, --help  Show this help\n');
}

// Main
function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const inputPath = argv.i || 'output/ASMREF.xlsx';
  const outputPath = argv.o || 'output/asmref.json';

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  convertAsmrefToJson(inputPath, outputPath);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { convertAsmrefToJson };
