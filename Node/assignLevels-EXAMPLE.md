# assignLevels.js - Usage Examples

## Example 1: Basic Usage with Default Files

If your files are in the default locations:
- `Upload/Onshape_Upload_List.xlsx`
- `PDM/references.csv`

Simply run:
```bash
node assignLevels.js
```

This will:
1. Read both files
2. Calculate upload levels
3. Add new columns to the Excel file
4. Overwrite the original Excel file with updated data

## Example 2: Preview Changes (Dry Run)

To see what changes would be made without modifying files:

```bash
node assignLevels.js --dry-run
```

Output:
```
Assign Upload Levels to Files

Reading Excel file: Upload/Onshape_Upload_List.xlsx
  Found 150 rows.

Reading references from: PDM/references.csv
  Found 1245 reference relationships.
  327 unique assemblies with children.

Calculating upload levels...

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

--dry-run mode: No files written.

============================================================
Done!
============================================================
```

## Example 3: Custom Input/Output Paths

Process a different Excel file and save to a new location:

```bash
node assignLevels.js \
  -i PDM/Upload\ List.xlsx \
  -r PDM/references.csv \
  -o PDM/Upload\ List\ with\ Levels.xlsx
```

## Example 4: Real-World Workflow

### Step 1: Export references from PDM
Run the SQL query from `PDM/pdmExportReferences.sql` and save as `PDM/references.csv`

### Step 2: Preview the level assignments
```bash
cd /Users/theo/Documents/GitHub/OnshapeBulkUp/Node
node assignLevels.js --dry-run
```

### Step 3: Review the statistics
Check the output to ensure levels make sense:
- All parts should be Level 1
- Simple assemblies (only parts) should be Level 2
- Nested assemblies should have higher levels

### Step 4: Apply the changes
```bash
node assignLevels.js
```

### Step 5: Verify the Excel file
Open `Upload/Onshape_Upload_List.xlsx` and verify:
- New `uploadLevel` column exists
- New `zipPath` column exists (empty)
- New `uploadStatus` column exists (all "pending")
- New `onshape:documentId` column exists (empty)
- New `onshape:elementId` column exists (empty)
- New `folder` column exists (empty)

## Example 5: Understanding Level Assignments

Given this assembly structure:

```
Pump Housing Assembly (Top Level)
├── Motor Mount Subassembly
│   ├── Mounting Plate Part
│   ├── Bracket Part
│   └── Bolt Part (x4)
├── Impeller Subassembly
│   ├── Blade Part (x6)
│   └── Hub Part
└── Cover Part
```

The script assigns these levels:
```
Level 1 (Parts):
  - Mounting Plate Part
  - Bracket Part
  - Bolt Part
  - Blade Part
  - Hub Part
  - Cover Part

Level 2 (Simple Assemblies):
  - Motor Mount Subassembly (contains only parts)
  - Impeller Subassembly (contains only parts)

Level 3 (Top Level Assembly):
  - Pump Housing Assembly (contains Level 2 assemblies)
```

Upload order would be: All Level 1 parts first, then Level 2 assemblies, then Level 3 assembly.

## Example 6: Handling Orphan Assemblies

If an assembly is in your Excel file but NOT in references.csv:

```bash
node assignLevels.js --dry-run
```

Output will include:
```
Warning: 3 assemblies not found in references.csv:
  - LegacyAssembly.SLDASM
  - TestFixture.SLDASM
  - Prototype-v1.SLDASM
```

These assemblies will default to Level 2. You may need to:
1. Add them to references.csv if they have children
2. Accept Level 2 if they're standalone
3. Investigate why they're missing from the PDM export

## Example 7: Processing Large Datasets

For large PDM exports (10,000+ files):

```bash
# Use dry-run first to check for issues
node assignLevels.js --dry-run > level-stats.txt

# Review the output file
cat level-stats.txt

# If everything looks good, run for real
node assignLevels.js
```

## Example 8: Integration with Upload Workflow

After assigning levels, you can filter and upload by level:

```bash
# Step 1: Assign levels
node assignLevels.js

# Step 2: Upload Level 0 files (non-CAD)
node uploadByLevel.js --level 0

# Step 3: Upload Level 1 files (parts)
node uploadByLevel.js --level 1

# Step 4: Upload Level 2 assemblies
node uploadByLevel.js --level 2

# ... and so on for higher levels
```

## Troubleshooting

### Issue: "Input file not found"
**Solution:** Check the path to your Excel file. Use absolute paths or ensure you're in the correct directory.

```bash
# Use absolute path
node assignLevels.js -i /full/path/to/file.xlsx

# Or navigate to the Node directory first
cd /Users/theo/Documents/GitHub/OnshapeBulkUp/Node
node assignLevels.js
```

### Issue: "Warning: References file not found"
**Solution:** Export references from PDM using the SQL query:
```sql
-- From PDM/pdmExportReferences.sql
SELECT
    ParentDocument.Filename AS AssemblyFile,
    ParentDocument.Number AS AssemblyPN,
    ChildDocument.Filename AS ChildFile,
    ChildDocument.Number AS ChildPN,
    Reference.Quantity
FROM Documents ParentDocument
INNER JOIN DocumentReferences Reference ON ParentDocument.DocumentID = Reference.DocumentID
INNER JOIN Documents ChildDocument ON Reference.ChildDocumentID = ChildDocument.DocumentID
WHERE ParentDocument.Extension = 'SLDASM'
ORDER BY ParentDocument.Filename, ChildDocument.Filename;
```

### Issue: All assemblies are Level 2
**Cause:** References.csv is missing or doesn't match filenames in Excel.

**Solution:**
1. Verify filenames match exactly (case-sensitive)
2. Check that references.csv has the correct columns
3. Ensure references.csv was exported properly from PDM

### Issue: Circular dependency warning
**Cause:** Assembly A references Assembly B which references Assembly A.

**Solution:** This is usually a data error in PDM. The script will handle it gracefully by assigning Level 2, but you should investigate the actual assembly structure.
