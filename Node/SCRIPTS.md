# Script Reference

Complete catalog of all scripts in the migration toolkit. Before writing a new script, check this list — what you need may already exist.

---

## Quick Catalog

### Migration & Upload

| Script | Purpose | run.bat |
|--------|---------|---------|
| `unifiedUpload.js` | Main upload script — Excel-driven, handles parts + assemblies + relink | `upload` |
| `assignLevels.js` | Assign upload levels based on PDM dependencies | `assign` |
| `bulkUploadFromExcel.js` | Bulk upload with properties & release (older, pre-unified) | — |
| `replaceFromExcel.js` | Replace files in-place keeping same revision | `replace` |

### PDM Release Sync Pipeline

4-stage pipeline for syncing PDM releases to Onshape. Each stage reads the previous stage's output.

| Script | Purpose | run.bat |
|--------|---------|---------|
| `pdmSync1-analyze.js` | Classify files, check Onshape status, assign levels/folders | `pdm-sync-1` |
| `pdmSync2-packgo.js` | Generate Pack & Go ZIPs for assemblies (Windows only) | `pdm-sync-2` |
| `pdmSync3-upload.js` | Upload/replace files, set properties | `pdm-sync-3` |
| `pdmSync4-release.js` | Obsolete old revisions, release all items | `pdm-sync-4` |

### Properties & Metadata

| Script | Purpose | run.bat |
|--------|---------|---------|
| `editPropertiesFromExcel.js` | Update properties on existing elements | `edit` |
| `lookupPartProperties.js` | Fetch & export all properties of parts to CSV | — |
| `getProperties.js` | Fetch properties for all elements (sample) | — |
| `renameDocumentsFromExcel.js` | Rename documents and update descriptions | — |
| `updateDocumentDescription.js` | Update description of a single document | — |
| `bulkUpdateDocumentDescription.js` | Bulk update document descriptions from Excel | — |

### Release & Versioning

| Script | Purpose | run.bat |
|--------|---------|---------|
| `releaseFromExcel.js` | Release documents from Excel | `release` |
| `versionFromExcel.js` | Create versions without releasing | `version` |
| `checkAndReleaseFromExcel.js` | Check doc existence then bulk release | — |
| `getAssemblyRevisionIds.js` | Fill missing assembly revision/version IDs from API | `revision-ids` |

### Publications

| Script | Purpose | run.bat |
|--------|---------|---------|
| `createPublicationsFromExcel.js` | Create publications, grouping rows by name | `publications` |
| `addToPublicationFromExcel.js` | Add items to an existing publication | `add-pub-items` |

### Deletion & Cleanup

| Script | Purpose | run.bat |
|--------|---------|---------|
| `deleteElementsFromExcel.js` | Delete elements listed in Excel | `delete` |
| `deleteAndObsoleteFromExcel.js` | Obsolete revisions then delete elements | `delete-obsolete` |
| `deletePartStudiosAndAssemblies.js` | Delete Part Studios & Assemblies, keep Blobs/Drawings | `delete-ps-asm` |
| `deleteEmptyDocuments.js` | Delete documents with zero elements | `delete-empty` |

### Inspection & Diagnostics

| Script | Purpose | run.bat |
|--------|---------|---------|
| `inspectExcel.js` | Inspect Excel structure and level distribution | `inspect` |
| `checkAssemblyDependencies.js` | Verify assembly dependencies are present | `check` |
| `comparePDFs.js` | Download & compare PDFs by SHA-256 hash | `compare-pdfs` |
| `apiTest.js` | Test API connectivity and HMAC auth | `test` |
| `findBlankPartNumbers.js` | Find elements with blank part numbers | — |
| `rebuildDocumentCache.js` | Rebuild document cache from API folder scan | — |

### Assembly Reference (ASMREF)

| Script | Purpose | run.bat |
|--------|---------|---------|
| `convertAsmrefToJson.js` | Convert ASMREF Excel to JSON for fast lookups | — |
| `updateAsmrefExcelVersions.js` | Update ASMREF Excel with released version IDs | — |
| `updateAsmrefWithParts.js` | Fill SLDASM entries with uploaded SLDPRT IDs | — |

### FeatureScript

| Script | Purpose | run.bat |
|--------|---------|---------|
| `generateFeatureScript.js` | Generate FeatureScript from English using Claude AI | `generate` |
| `deployFeatureScript.js` | Deploy .fs files to Onshape Feature Studios | `deploy` |
| `splitFeatureScriptDocs.js` | Parse FeatureScript HTML docs into JSON reference | `featurescript-docs` |

### Folders & Documents

| Script | Purpose | run.bat |
|--------|---------|---------|
| `createFolder.js` | Create a folder in Onshape (also used by unifiedUpload) | — |
| `listFolders.js` | List folder contents from global tree nodes | — |
| `getFolders.js` | List all folders across account (sample) | — |
| `getDocuments.js` | List documents with query params (sample) | — |

### Original Onshape SDK Samples

| Script | Purpose |
|--------|---------|
| `uploadBlob.js` | Upload a single file to a blob element |
| `exportStl.js` | Export a part studio as STL |
| `massByMaterial.js` | Calculate mass by material in a part studio |

### Debug & Test

| Script | Purpose |
|--------|---------|
| `verifyHmac.js` | Compute HMAC signature for auth debugging |
| `testDocAccess.js` | Test single document accessibility |
| `testOneDoc.js` | Check elements and metadata for one document |
| `checkOneDoc.js` | Check elements and part numbers in one document |
| `checkErrorDocs.js` | Check a hardcoded list of error documents |
| `checkSpecificDocs.js` | Check specific hardcoded documents |
| `test_relink_module.js` | Verify relink module exports |
| `test_relink.js` | Test relink module function signatures |
| `splitApiDocs.js` | Split Onshape OpenAPI spec into category files |

### One-Off Analysis (`one-off/`)

Scripts with hardcoded paths used for specific migration analysis. Kept for reference but not part of the active toolkit.

| Script | Purpose |
|--------|---------|
| `analyzeRelease.js` | Analyze Release column for double-release risks |
| `analyzeDoubleRelease.js` | Find L0/L1 items at risk from L2+ releases |
| `analyzeFromFinal.js` | Analyze L1 items from Final sheet for double-release risk |
| `analyzeLevel1IDs.js` | Analyze document structure from Excel |
| `calculateApiCalls.js` | Calculate expected API call counts from Excel |
| `calculateLevelsFromAsmref.js` | Calculate assembly levels from ASMREF nesting depth |
| `createMissingLists.js` | Identify L1 files needing upload vs release |
| `exportAtRiskItems.js` | Export at-risk items to Excel |
| `findLevel1AtRisk.js` | Find L1 parts at risk in L2+ release documents |
| `findSpecPairs.js` | Find spec and drawing pairs by document name |
| `mergeStatus.js` | Merge revision IDs between status files |
| `parseNotifications.js` | Parse Onshape notification text into structured data |
| `showAtRiskItems.js` | Display at-risk items grouped by document |

### Python Scripts

| Script | Purpose | run.bat |
|--------|---------|---------|
| `PDM/inspectAssemblyFeatures.py` | Detect assembly-level geometry features, export as SLDPRT | `inspect-features` |

---

## Detailed Reference

Full documentation for primary workflow scripts.

---

## unifiedUpload.js

**Purpose**: Main upload script - uploads files to Onshape based on Excel input.

**run.bat commands**: `upload`, `dry-run`, `slow-run`, `level N`

**Usage**:
```bash
node unifiedUpload.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-s <path>` | Status JSON file (default: `Upload/upload_status.json`) |
| `-f <id>` | Default folder ID |
| `--asmref <path>` | ASMREF JSON file for assembly relink |
| `--dry-run` | Preview without uploading |
| `--slow-run` | Prompt after each file |
| `--level N` | Only process specific uploadLevel |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `uploadLevel` | 0=non-CAD, 1=parts, 2+=assemblies |
| `document:name` | Onshape document name |
| `filePath` | Local file path |
| `property:*` | Metadata properties to set |

**Optional columns**:
| Column | Description |
|--------|-------------|
| `zipPath` | Pack & Go ZIP path (for assemblies) |
| `folder` | Target folder name |
| `onshape:folderId` | Direct folder ID |
| `Release` | `"yes"` (element) or `"document"` (all) |
| `BodyCount` | If > 1, creates composite part |

**Dependencies**: `lib/app.js`, `lib/onshape.js`, `lib/relink.js`, `lib/asmref.js`, `createFolder.js`

**Output**:
- `Upload/upload_status.json` (persistent state)
- `<input>_completed.xlsx` (with Onshape IDs)

---

## assignLevels.js

**Purpose**: Assign upload levels to files based on PDM dependencies.

**run.bat command**: `assign`

**Usage**:
```bash
node assignLevels.js -i <excel-file> -r <references-csv> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-r <path>` | References CSV from PDM (default: `PDM/references.csv`) |
| `-o <path>` | Output Excel file (default: overwrites input) |
| `--dry-run` | Show stats without writing |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `filename` | File name (or extracted from `filePath`) |

**References CSV format**:
| Column | Description |
|--------|-------------|
| `AssemblyFile` | Parent assembly filename |
| `ChildFile` | Child part/assembly filename |

**Dependencies**: `xlsx`

**Output**: Updates Excel with:
- `uploadLevel`: 0 (non-CAD), 1 (parts), 2+ (assemblies by depth)
- `zipPath`, `uploadStatus`, `onshape:documentId`, `onshape:elementId`, `folder`

---

## editPropertiesFromExcel.js

**Purpose**: Update properties on existing Onshape elements.

**run.bat command**: `edit`

**Usage**:
```bash
node editPropertiesFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-o <path>` | Output log file |
| `-d <ms>` | Minimum delay between API calls (default: 200) |
| `--dry-run` | Preview without changing |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `onshape:elementId` | Element ID |
| `property:*` | Properties to update |

**Dependencies**: `lib/onshape.js`, `lib/app.js`, `xlsx`

**Output**: `<input>_edit_log.csv` with per-row results

**Rate limiting**: Adaptive - monitors `X-Rate-Limit-Remaining` and auto-adjusts delay

---

## releaseFromExcel.js

**Purpose**: Release documents from Excel list.

**run.bat command**: `release`

**Usage**:
```bash
node releaseFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-s <path>` | Status JSON file |
| `-d <ms>` | Delay between releases (default: 3000) |
| `--dry-run` | Preview without releasing |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `Release` | `"yes"` or `"document"` |

**Optional columns**:
| Column | Description |
|--------|-------------|
| `onshape:elementId` | Required if Release=yes |
| `property:Part number` | Part number for release |
| `property:Revision` | Revision number |

**Dependencies**: `lib/onshape.js`, `lib/app.js`, `xlsx`

**Output**:
- `<input>_release_log.csv`
- `<input>_released.xlsx` (with versionIds)
- Updates `upload_status.json` with versionIds

---

## versionFromExcel.js

**Purpose**: Create document versions without releasing.

**run.bat command**: `version`

**Usage**:
```bash
node versionFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-s <path>` | Status JSON file |
| `-d <ms>` | Delay between versions (default: 1000) |
| `--dry-run` | Preview without creating versions |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `Version` | `"yes"` to create version |

**Dependencies**: `lib/onshape.js`, `xlsx`

**Output**:
- `<input>_version_log.csv`
- `<input>_versioned.xlsx` (with versionIds)

---

## replaceFromExcel.js

**Purpose**: Replace files in Onshape while keeping the same revision number.

**run.bat command**: `replace`

**Usage**:
```bash
node replaceFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-s <path>` | Status JSON file |
| `-d <ms>` | Delay between replacements (default: 3000) |
| `--dry-run` | Preview without replacing |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `onshape:elementId` | Element to replace |
| `onshape:versionId` | Released version to obsolete |
| `filePath` | Path to new file |
| `uploadLevel` | 0=blob, 1=part, 2+=assembly |
| `property:Part number` | Part number |
| `property:Revision` | Revision to keep |

**Dependencies**: `lib/onshape.js`, `lib/app.js`, `unifiedUpload.js` (imports), `xlsx`

**Workflow**:
1. Obsolete existing release (with re-releasable flag)
2. Blob: update in-place / CAD: delete + re-upload
3. Set properties
4. Release with same revision number

**Output**:
- `<input>_replace_log.csv`
- `<input>_replaced.xlsx` (with new elementIds/versionIds)

---

## createPublicationsFromExcel.js

**Purpose**: Create Onshape publications from Excel, grouping rows by publication name.

**run.bat command**: `publications`

**Usage**:
```bash
node createPublicationsFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `--dry-run` | Validate and show what would be created |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:folderId` | Parent folder ID for the publication |
| `property:publication:name` | Publication name (grouping key) |
| `property:publication:description` | Publication description |
| `item:documentId` | Document ID of the item |
| `item:elementId` | Element ID of the item |
| `item:versionId` | Version ID of the item |

**Optional columns**:
| Column | Description |
|--------|-------------|
| `property:publication:notes` | Publication notes |
| `uploadLevel` | 0=blob, 1=part (revision lookup for partId/revisionId), 2+=assembly |
| `File Extension` | File extension for blob items (e.g. `PDF`) — used for MIME type |

**Optional "item master" sheet** (D365 enrichment):

If the Excel workbook contains a second sheet named `"item master"`, the script will match D365 parts to each publication by prefix (the portion of `Part Number` before the first `-`) against the publication name, and append a markdown table to the publication's notes field.

| Column | Description |
|--------|-------------|
| `Part Number` | D365 item number (e.g. `10064-01-A`; prefix `10064` is the match key) |
| `Rev` | Revision |
| `Description` | Item description |
| `Avail. Inventory` | Available inventory quantity |
| `Unit Cost` | Unit cost in dollars |
| `Unit` | Unit of measure (e.g. `EA`) |

**Multi-row grouping**:
- Rows with the same `property:publication:name` are grouped into one publication
- Metadata (description, notes, folderId) taken from the first row of each group
- Each row contributes one item via its `item:*` columns
- The same `onshape:publicationId` is written back to all rows in a group

**Dependencies**: `lib/onshape.js`, `xlsx`, `minimist`

**Output columns** (written to `_completed.xlsx`):
| Column | Description |
|--------|-------------|
| `onshape:publicationId` | Publication ID created by the API |
| `item:revisionId` | Revision ID from Onshape Revision API (parts and blobs) |
| `item:partId` | Part ID from Revision API (part studio items only) |

**Output files**:
- `publication_status.json` (crash-safe progress sidecar, includes `itemRevisions` array)
- `<input>_completed.xlsx` (with publication IDs and revision IDs filled in)

**Rate limiting**: Adaptive delay (200ms-5000ms), 429 retry up to 3 times

---

## addToPublicationFromExcel.js

**Purpose**: Add released items (by revisionId) to an existing Onshape publication via the bulk endpoint.

**run.bat command**: `add-pub-items`

**Usage**:
```bash
node addToPublicationFromExcel.js -i <excel-file> -p <publicationId> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `-p <id>` | Publication ID to add items to (required) |
| `--sheet <name>` | Sheet name (default: first sheet) |
| `--dry-run` | Show what would be added without making API calls |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `item:revisionId` | Revision ID of the released item |

**Optional columns**:
| Column | Description |
|--------|-------------|
| `uploadLevel` | 0=blob, 1=part, 2+=assembly (for type flags) |
| `File Extension` | File extension for blob MIME type (e.g. `PDF`) |

**Dependencies**: `lib/onshape.js`, `xlsx`, `minimist`

**API endpoint**: `POST /api/v13/publications/{pid}/items` (bulk add)

**Output**: Console report of items added. No output Excel (items already have revisionIds).

**Rate limiting**: 429 retry up to 3 times

---

## inspectExcel.js

**Purpose**: Inspect Excel file structure and upload level distribution.

**run.bat commands**: `levels`, `inspect`

**Usage**:
```bash
node inspectExcel.js -i <excel-file>
```

**Required Excel columns**: None (reports what's present)

**Dependencies**: `xlsx`

**Output**: Console report showing:
- Column names
- Upload level distribution
- Required column validation
- Onshape ID presence

---

## checkAssemblyDependencies.js

**Purpose**: Verify all assembly dependencies are present and ready for upload.

**run.bat command**: `check`

**Usage**:
```bash
node checkAssemblyDependencies.js -i <excel-file> -r <references-csv> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-r <path>` | References CSV (default: `PDM/references.csv`) |
| `--dry-run` | Show results without writing |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `File Name` | File name |
| `Uploaded` | Status (TRUE = ready) |

**Dependencies**: `xlsx`

**Output**:
- Updates Excel with `assemcheck`, `assemcheck_files`, `referenced_by` columns
- Creates `<input>_missing_files.xlsx` listing missing dependencies

---

## deleteElementsFromExcel.js

**Purpose**: Delete Onshape elements listed in Excel.

**run.bat command**: `delete`

**Usage**:
```bash
node deleteElementsFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `--status-file <path>` | Status JSON file |
| `--dry-run` | Preview without deleting |
| `--slow-run` | Prompt after each delete |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `onshape:elementId` | Element ID |

**Dependencies**: `lib/onshape.js`, `xlsx`

**Output**: Updates `upload_status.json` to remove deleted entries

---

## deleteAndObsoleteFromExcel.js

**Purpose**: Obsolete all active revisions for a part number, then delete the element from the document.

**run.bat command**: `delete-obsolete`

**Usage**:
```bash
node deleteAndObsoleteFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `--status-file <path>` | Status JSON file (default: `Upload/upload_status.json`) |
| `--dry-run` | Preview without making API calls |
| `--slow-run` | Prompt after each row (y/n/f) |
| `--skip-obsolete` | Skip obsoletion, only delete elements |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |
| `onshape:workspaceId` | Workspace ID |
| `onshape:elementId` | Element ID |
| `property:Part Number` | Part number for revision lookup |

**Per-row workflow**:
1. Look up all revisions for the part number via revision API
2. Walk the `previousRevisionId` chain to collect full revision history
3. Obsolete each active (non-obsolete) revision with re-releasable flag
4. Delete the element from the document
5. Remove entry from `upload_status.json` if present

---

## deletePartStudiosAndAssemblies.js

**Purpose**: Delete all Part Studios and Assemblies from documents, keeping Drawings, Blobs, etc.

**run.bat command**: `delete-ps-asm`

**Usage**:
```bash
node deletePartStudiosAndAssemblies.js -i <excel-file> [options]
node deletePartStudiosAndAssemblies.js --doc <document-id> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `--doc <id>` | Single document ID (for testing) |
| `--dry-run` | Preview without deleting |
| `--slow-run` | Prompt after each delete |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID |

---

## deleteEmptyDocuments.js

**Purpose**: Check documents for zero elements and delete (move to trash) any that are empty.

**run.bat command**: `delete-empty`

**Usage**:
```bash
node deleteEmptyDocuments.js -i <input-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Tab-separated text file: `documentId\tworkspaceId` per line (required) |
| `--dry-run` | Check documents but do not delete |
| `--slow-run` | Prompt after each document (y/n/f) |

---

## comparePDFs.js

**Purpose**: Download PDFs from Onshape and compare SHA-256 hashes within each document to identify duplicates.

**run.bat command**: `compare-pdfs`

**Usage**:
```bash
node comparePDFs.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `-o <path>` | Output directory (default: `output/pdf_compare`) |
| `--dry-run` | Show groups and counts, no API calls |
| `--keep-files` | Keep downloaded PDFs after comparison |
| `--slow-run` | Prompt after each document group (y/n/f) |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `onshape:documentId` | Document ID (grouping key) |
| `onshape:workspaceId` | Workspace ID |
| `onshape:elementId` | Element ID |
| `File Name` | Display name (e.g. `30010.PDF`) |

**Status values**: `REFERENCE`, `MATCH`, `NEAR-MATCH` (size diff <= 100 bytes), `UNIQUE`, `ERROR`

---

## getAssemblyRevisionIds.js

**Purpose**: Query the Revision API to fill in missing `onshape:revisionId` and `onshape:versionId` for L2 assembly rows.

**run.bat command**: `revision-ids`

**Usage**:
```bash
node getAssemblyRevisionIds.js -i input.xlsx --dry-run
node getAssemblyRevisionIds.js -i input.xlsx
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `--dry-run` | Preview: show counts, no API calls |

**Required Excel columns**:
| Column | Description |
|--------|-------------|
| `uploadLevel` | Filtered to value `2` (assemblies) |
| `property:Part number` | Used to query the Revision API |

**Output**: `<input>_completed.xlsx` with `onshape:revisionId` and `onshape:versionId` filled in

---

## renameDocumentsFromExcel.js

**Purpose**: Rename Onshape documents and update descriptions from Excel.

**Usage**:
```bash
node renameDocumentsFromExcel.js -i <excel-file> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file |
| `-s <path>` | Status JSON file |
| `--dry-run` | Preview without changes |
| `--name-only` | Only rename, skip description |
| `--desc-only` | Only update description, skip rename |
| `-d <ms>` | Delay between API calls |

**Dependencies**: `lib/onshape.js`, `xlsx`, `minimist`

**Rate limiting**: Adaptive delay (200ms-5000ms), 429 retry

---

## generateFeatureScript.js

**Purpose**: Generate FeatureScript code from plain-English descriptions using Claude AI.

**run.bat command**: `generate`

**Usage**:
```bash
node generateFeatureScript.js --prompt "Create a feature that extrudes selected faces" [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `--prompt, -p` | Description of the feature to generate (required) |
| `--type, -t` | Output type: `feature` (default), `table`, `property` |
| `--output, -o` | Write output to file instead of stdout |
| `--model, -m` | Claude model (default: `claude-sonnet-4-5-20250929`) |
| `--verbose, -v` | Show which docs were loaded and token estimates |
| `--list-modules` | List all available Standard Library modules and exit |

**Dependencies**: `@anthropic-ai/sdk`, `minimist`, `docs/featurescript/`

---

## deployFeatureScript.js

**Purpose**: Deploy `.fs` FeatureScript files to Onshape Feature Studios via API. Content hashing for idempotency.

**run.bat command**: `deploy`

**Usage**:
```bash
node deployFeatureScript.js -d <docId> [options]
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input directory with .fs files (default: `./featurescript/`) |
| `-d <docId>` | Target Onshape document ID (required) |
| `-w <workspaceId>` | Workspace ID (auto-detected if omitted) |
| `--dry-run` | Preview without making API calls |
| `--force` | Re-deploy even if content hash unchanged |

---

## inspectAssemblyFeatures.py

**Purpose**: Detect assembly-level geometry features in SolidWorks assemblies and export as `.SLDPRT` for clean Onshape import.

**Location**: `Node/PDM/inspectAssemblyFeatures.py`

**Usage**:
```bash
python PDM/inspectAssemblyFeatures.py -i Upload/Onshape_Upload_List.xlsx -o output/assembly_inspect
python PDM/inspectAssemblyFeatures.py -i Upload/Onshape_Upload_List.xlsx --dry-run -v
```

**Options**:
| Flag | Description |
|------|-------------|
| `-i <path>` | Input Excel file (required) |
| `-o <path>` | Output directory (default: `output/assembly_inspect`) |
| `--dry-run` | Inspect only, no SolidWorks operations |
| `--start-index N` | Start at Nth assembly (0-based, for batching) |
| `--count N` | Process at most N assemblies (-1 = all) |
| `-v, --verbose` | Log all feature types encountered |
| `--force` | Re-process assemblies already in sidecar |

**Dependencies**: Python 3.10+, `pywin32`, `openpyxl`, SolidWorks installed (Windows)

---

## apiTest.js

**Purpose**: Test API connectivity and authentication.

**run.bat command**: `test`

**Usage**:
```bash
node apiTest.js
```

---

## lookupPartProperties.js

**Purpose**: Fetch all properties of parts from Excel and export to CSV.

**Usage**:
```bash
node lookupPartProperties.js <excel-file> [output.csv]
```

**Dependencies**: `lib/onshape.js`, `xlsx`

---

## bulkUploadFromExcel.js

**Purpose**: Bulk upload from Excel with properties and release. Older script predating `unifiedUpload.js`, still used for blob-heavy uploads.

**Dependencies**: `lib/app.js`, `lib/onshape.js`, `xlsx`

---

## checkAndReleaseFromExcel.js

**Purpose**: Check document existence and bulk release elements from Excel with rate limit retry.

**Dependencies**: `lib/onshape.js`, `lib/app.js`, `xlsx`

---

## rebuildDocumentCache.js

**Purpose**: Rebuild document cache from Onshape API by scanning folders.

**Usage**:
```bash
node rebuildDocumentCache.js [-s <status-file>] [-f <folder-id>] [--all]
```

**Dependencies**: `lib/onshape.js`

---

## convertAsmrefToJson.js

**Purpose**: Convert ASMREF Excel file to optimized JSON for fast lookups by assembly and part number.

**Usage**:
```bash
node convertAsmrefToJson.js -i <asmref-excel> -o <output.json>
```

---

## updateAsmrefExcelVersions.js

**Purpose**: Update ASMREF Excel with released version IDs from Onshape Revisions API.

**Usage**:
```bash
node updateAsmrefExcelVersions.js [--dry-run]
```

**Rate limiting**: Adaptive delay, monitors `X-Rate-Limit-Remaining`

---

## updateAsmrefWithParts.js

**Purpose**: Fill in Onshape IDs for SLDASM entries in `asmref.json` using uploaded SLDPRT equivalents from Excel. Flips `type` from `SLDASM` to `SLDPRT` so relink will swap assembly instances with part references.

**Usage**:
```bash
node updateAsmrefWithParts.js -i <excel-file> [-a <asmref.json>] [--sheet <name>] [--dry-run]
```

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input` | Excel file with uploaded SLDPRT IDs (required) | — |
| `-a, --asmref` | ASMREF JSON file | `output/asmref.json` |
| `--sheet` | Excel sheet name | `Sheet2` |
| `--dry-run` | Preview without saving | — |

**Required Excel columns**:

| Column | Description |
|--------|-------------|
| `File Name` | e.g., `43737.SLDASM` (matches ASMREF component key) |
| `onshape:documentId` | Onshape document ID |
| `onshape:elementId` | Onshape element ID |
| `onshape:versionId` | Onshape version ID |

**Optional Excel columns**: `onshape:workspaceId`

**No API calls** — purely local JSON transformation.

---

## PDM Release Sync Pipeline

4-stage pipeline for syncing PDM releases to Onshape. Each stage reads the previous stage's output Excel and adds new `sync:*` columns.

```
PDM Releases.xlsx → pdmSync1-analyze.js → pdm_releases_s1.xlsx
                   → pdmSync2-packgo.js → pdm_releases_s2.xlsx
                   → pdmSync3-upload.js → pdm_releases_s3.xlsx
                   → pdmSync4-release.js → pdm_releases_s4.xlsx
```

### pdmSync1-analyze.js

**Purpose**: Classify every row from PDM Releases.xlsx — check Onshape revision status, assign folders and upload levels.

**Usage**:
```bash
node pdmSync1-analyze.js -i "PDM Releases.xlsx" [-o pdm_releases_s1.xlsx] [-r PDM/references.csv]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input` | Input Excel file (required) | — |
| `-o, --output` | Output Excel file | `pdm_releases_s1.xlsx` |
| `-r, --references` | PDM references CSV (for assembly levels) | `PDM/references.csv` |

**Required input columns**: `Name`, `Found In`, `Revision`, `Description`

**Output columns added**: `sync:action`, `sync:level`, `sync:folder`, `sync:documentName`, `sync:pdmRevision`, `sync:onshapeRevision`, `sync:documentId`, `sync:workspaceId`, `sync:elementId`, `sync:revisionId`, `sync:filePath`

**Crash-safe sidecar**: `pdm_sync1_status.json` — saves after each API call, skips cached rows on re-run.

---

### pdmSync2-packgo.js

**Purpose**: Generate Pack & Go ZIPs for assemblies that need uploading/replacing. Windows only.

**Usage**:
```bash
node pdmSync2-packgo.js -i pdm_releases_s1.xlsx [-o pdm_releases_s2.xlsx] [--zip-dir temp-pack-and-go/]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input` | Stage 1 output Excel (required) | — |
| `-o, --output` | Output Excel | `pdm_releases_s2.xlsx` |
| `--zip-dir` | ZIP output directory | `temp-pack-and-go/` |

**Requires**: Windows + SolidWorks + `PDM/packAndGoSingle.ps1`

**Output columns added**: `sync:zipPath`, `sync:packStatus`

---

### pdmSync3-upload.js

**Purpose**: Upload new files and replace existing files in Onshape. Sets properties. Does NOT release.

**Usage**:
```bash
node pdmSync3-upload.js -i pdm_releases_s2.xlsx [-o pdm_releases_s3.xlsx] [-s pdm_sync3_status.json] [--dry-run]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input` | Stage 2 output Excel (required) | — |
| `-o, --output` | Output Excel | `pdm_releases_s3.xlsx` |
| `-s, --status` | Status JSON sidecar | `pdm_sync3_status.json` |
| `--dry-run` | Preview without executing | — |

**Key behaviors**:
- Processes rows sorted by `sync:level` (blobs → parts → assemblies)
- New files: creates document, uploads, sets properties
- Replacement files (same-rev/new-rev): updates in-place preserving element IDs
- Assemblies: relinks to master parts after upload

**Output columns added**: `sync:newDocumentId`, `sync:newWorkspaceId`, `sync:newElementId`, `sync:uploadStatus`, `sync:uploadError`

---

### pdmSync4-release.js

**Purpose**: Obsolete old revisions (same-rev only) and release all items.

**Usage**:
```bash
node pdmSync4-release.js -i pdm_releases_s3.xlsx [-o pdm_releases_s4.xlsx] [-s pdm_sync4_status.json] [--dry-run]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input` | Stage 3 output Excel (required) | — |
| `-o, --output` | Output Excel | `pdm_releases_s4.xlsx` |
| `-s, --status` | Status JSON sidecar | `pdm_sync4_status.json` |
| `--dry-run` | Preview without executing | — |

**Key behaviors**:
- `same-rev`: obsoletes existing revision (with re-releasable flag), then re-releases at same revision
- `new-rev` / `new`: releases at the PDM revision number
- Processes in `sync:level` order

**Output columns added**: `sync:versionId`, `sync:releaseStatus`, `sync:releaseError`
