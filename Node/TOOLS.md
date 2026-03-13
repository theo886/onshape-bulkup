# run.bat Command Reference

Quick reference for all commands available through `run.bat`.

## Usage

```cmd
run [command] [options]
```

Running `run` without arguments opens an interactive menu.

## Commands

| Command | Description | Script |
|---------|-------------|--------|
| `test` | Test API connection | `apiTest.js` |
| `dry-run` | Preview upload without executing | `unifiedUpload.js --dry-run` |
| `slow-run` | Upload with prompts after each file | `unifiedUpload.js --slow-run` |
| `upload` | Run full upload (all levels) | `unifiedUpload.js` |
| `level N` | Upload specific level only | `unifiedUpload.js --level N` |
| `levels` | Show upload level distribution | `inspectExcel.js` |
| `check` | Check assembly dependencies | `checkAssemblyDependencies.js` |
| `assign` | Assign upload levels to Excel | `assignLevels.js` |
| `inspect` | Inspect Excel file for issues | `inspectExcel.js` |
| `clear` | Clear upload status cache | (deletes `upload_status.json`) |
| `delete` | Delete elements from Excel list | `deleteElementsFromExcel.js` |
| `delete-obsolete` | Obsolete revisions then delete elements | `deleteAndObsoleteFromExcel.js` |
| `delete-ps-asm` | Delete Part Studios & Assemblies | `deletePartStudiosAndAssemblies.js` |
| `delete-empty` | Delete documents with zero elements | `deleteEmptyDocuments.js` |
| `edit` | Edit properties from Excel list | `editPropertiesFromExcel.js` |
| `release` | Release documents from Excel list | `releaseFromExcel.js` |
| `version` | Create versions (no release) | `versionFromExcel.js` |
| `replace` | Replace files (keep same revision) | `replaceFromExcel.js` |
| `publications` | Create publications from Excel | `createPublicationsFromExcel.js` |
| `add-pub-items` | Add items to an existing publication | `addToPublicationFromExcel.js` |
| `generate` | Generate FeatureScript code from a plain-English description using Claude AI | `generateFeatureScript.js` |
| `revision-ids` | Fill missing assembly revision IDs from API | `getAssemblyRevisionIds.js` |
| `update-asmref-assemblies` | Backfill ASMREF with uploaded assembly IDs (keeps SLDASM type) | `updateAsmrefWithAssemblies.js` |
| `compare-pdfs` | Compare PDFs within documents by SHA-256 hash | `comparePDFs.js` |
| `deploy` | Deploy .fs FeatureScript files to Onshape Feature Studios | `deployFeatureScript.js` |
| `featurescript-docs` | Parse FeatureScript Standard Library HTML into JSON reference docs | `splitFeatureScriptDocs.js` |
| `inspect-features` | Detect assembly-level geometry features and export as SLDPRT | `PDM/inspectAssemblyFeatures.py` |
| `pdm-sync-1` | PDM Sync Stage 1: Classify files, check Onshape status | `pdmSync1-analyze.js` |
| `pdm-sync-2` | PDM Sync Stage 2: Pack & Go ZIPs for assemblies (Windows) | `pdmSync2-packgo.js` |
| `pdm-sync-3` | PDM Sync Stage 3: Upload/replace files, set properties | `pdmSync3-upload.js` |
| `pdm-sync-4` | PDM Sync Stage 4: Obsolete + release | `pdmSync4-release.js` |

## Common Workflows

### Initial Upload (Parts First, Then Assemblies)

```cmd
run assign           # Assign upload levels
run inspect          # Verify Excel is correct
run level 0          # Upload non-CAD files (PDFs, etc.)
run level 1          # Upload parts
run level 2          # Upload level 2 assemblies
run level 3          # Continue with higher levels...
```

### Testing Before Full Run

```cmd
run dry-run          # See what would happen
run slow-run         # Upload one at a time with prompts
```

### Post-Upload Operations

```cmd
run edit             # Update properties on existing elements
run release          # Release unreleased documents
run version          # Create versions without releasing
run replace          # Replace files while keeping revision
```

### PDM Release Sync (4-stage pipeline)

```cmd
run pdm-sync-1       # Analyze: classify, check Onshape, assign levels
run pdm-sync-2       # Pack & Go: generate ZIPs for assemblies (Windows)
run pdm-sync-3       # Upload: upload/replace files, set properties
run pdm-sync-4       # Release: obsolete old revisions + release
```

### Diagnostics

```cmd
run test             # Test API connectivity
run check            # Verify assembly dependencies
run levels           # Show distribution by upload level
```

## Interactive Prompts

All commands that process Excel files will open a file selector dialog.

For `slow-run`:
- `y` = continue to next file
- `n` = stop and save progress
- `f` = switch to fast mode (no more prompts)

Press `Q` or `Ctrl+C` during any upload to cancel gracefully.

## File Selection

Commands automatically open a file dialog to select the Excel file. The dialog defaults to the `Upload/` folder and filters for `.xlsx` and `.xls` files.

## Status Persistence

Upload progress is saved to `Upload/upload_status.json`. Resume by running the same command again - already-uploaded files are automatically skipped.

To reset progress: `run clear`
