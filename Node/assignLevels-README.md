# assignLevels.js

A tool to assign upload levels to CAD files based on their dependency relationships.

## Purpose

This script reads an Excel upload list and references.csv file to calculate and assign upload levels to each file. Upload levels determine the order in which files should be processed:

- **Level 0**: Non-CAD files (PDFs, Excel, DWG, etc.)
- **Level 1**: SLDPRT files (standalone parts)
- **Level 2+**: SLDASM files (assemblies), where level = max(child assembly levels) + 1

## Usage

### Basic Usage
```bash
node assignLevels.js -i Upload/Onshape_Upload_List.xlsx -r PDM/references.csv
```

### Dry Run (preview without writing)
```bash
node assignLevels.js -i Upload/Onshape_Upload_List.xlsx -r PDM/references.csv --dry-run
```

### Custom Output File
```bash
node assignLevels.js -i input.xlsx -r references.csv -o output.xlsx
```

### Help
```bash
node assignLevels.js -h
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i` | Input Excel file | `Upload/Onshape_Upload_List.xlsx` |
| `-r` | References CSV from PDM | `PDM/references.csv` |
| `-o` | Output Excel file | Same as input (overwrites) |
| `--dry-run` | Show stats without writing | false |
| `-h` | Show help | - |

## Input Files

### Excel Upload List
Should contain file information with columns like:
- `File Name` or `Filename` or `document:name`
- `Part Number` or `PartNumber`
- Other metadata columns (preserved in output)

### References CSV
PDM export with assembly-to-part relationships:
```csv
AssemblyFile,AssemblyPN,ChildFile,ChildPN,Quantity
Assembly1.SLDASM,ASM-001,Part1.SLDPRT,PRT-001,1
Assembly2.SLDASM,ASM-002,Assembly1.SLDASM,ASM-001,1
```

## Output

The script adds these new columns to the Excel file:

| Column | Description | Initial Value |
|--------|-------------|---------------|
| `uploadLevel` | Integer indicating processing order | Calculated (0, 1, 2, 3, ...) |
| `zipPath` | Path to Pack & Go ZIP file | Empty string |
| `uploadStatus` | Upload status tracking | `"pending"` |
| `onshape:documentId` | Onshape document ID | Empty string |
| `onshape:elementId` | Onshape element ID | Empty string |
| `folder` | Target folder ID | Empty string |

## Algorithm

The script uses a recursive algorithm with memoization to calculate assembly levels:

1. **Parse references.csv** into a dependency graph: `{ assemblyFile: [childFiles] }`
2. **For each .SLDASM file:**
   - Find all children from the graph
   - If all children are `.SLDPRT` → Level 2
   - If has `.SLDASM` children → Level = max(child SLDASM levels) + 1
   - Use memoization to avoid recalculating
3. **Handle cycles gracefully** - warns but doesn't crash

### Example Level Calculation

Given these dependencies:
```
Part1.SLDPRT          → Level 1 (all parts are level 1)
Part2.SLDPRT          → Level 1
Asm1.SLDASM           → Level 2 (contains only parts)
  ├─ Part1.SLDPRT
  └─ Part2.SLDPRT
Asm2.SLDASM           → Level 3 (contains level 2 assembly)
  ├─ Asm1.SLDASM
  └─ Part3.SLDPRT
Asm3.SLDASM           → Level 4 (contains level 3 assembly)
  └─ Asm2.SLDASM
```

## Output Statistics

The script prints a summary showing:
- Total files processed
- Count by level (Level 0: X, Level 1: Y, Level 2: Z, ...)
- Max level found
- Any assemblies not found in references.csv (orphans)

Example output:
```
============================================================
UPLOAD LEVEL STATISTICS
============================================================
Total files: 150

Files by level:
  Level 0: 50 files (non-CAD files)
  Level 1: 75 files (parts)
  Level 2: 15 files (assemblies)
  Level 3: 8 files (assemblies)
  Level 4: 2 files (assemblies)

Max level found: 4

Warning: 3 assemblies not found in references.csv:
  - OrphanAssembly1.SLDASM
  - OrphanAssembly2.SLDASM
  - OrphanAssembly3.SLDASM
```

## Error Handling

- **Missing input file**: Script exits with error message
- **Missing references file**: Warning displayed, all assemblies default to level 2
- **Circular dependencies**: Warning displayed, affected assembly defaults to level 2
- **Missing filename in row**: Warning displayed, row skipped
- **Orphan assemblies**: Listed in output (assemblies not in references.csv)

## Dependencies

- `fs` - File system operations (Node.js built-in)
- `xlsx` - Excel file reading/writing
- `path` - Path manipulation (Node.js built-in)
- `minimist` - Command line argument parsing

## Notes

- The script preserves all existing columns in the Excel file
- If columns already exist (like `uploadLevel`), they will be overwritten
- Use `--dry-run` to preview results before modifying files
- Default behavior overwrites the input file - use `-o` for different output
