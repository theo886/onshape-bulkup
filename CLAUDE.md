# Project Context for Claude Agents

This file provides essential context for Claude agents working on this codebase.

## Project Overview

**SolidWorks PDM to Onshape Migration Toolkit** - A comprehensive Node.js toolset for migrating ~24,000 files from SolidWorks PDM Pro to Onshape, including parts, assemblies, drawings, and related documents.

Originally started from Onshape's API key sample apps, this repo has evolved into a full enterprise migration solution.

## Migration Stats
- **Total files**: ~23,811
- **SolidWorks Parts**: 4,578 (1,793 standalone + 2,785 assembly parts)
- **SolidWorks Assemblies**: 1,370 (607 top-level + 763 sub-assemblies)
- **SolidWorks Drawings**: 4,134
- **Other files**: 13,729 (PDFs, STEP, Excel, DWG, etc.)

## Repository Structure

```
apikey/
├── Node/
│   ├── config/
│   │   ├── apikey.js             # Your API credentials (create from apikeyexample.js)
│   │   ├── apikeyexample.js      # Template for credentials
│   │   └── errors.js             # Error handling
│   ├── lib/
│   │   ├── app.js                # High-level Onshape operations
│   │   ├── onshape.js            # Low-level API client (HMAC auth)
│   │   ├── relink.js             # Assembly relink module
│   │   ├── asmref.js             # ASMREF lookup module
│   │   └── util.js               # Utilities
│   │
│   │  ## MAIN WORKFLOW SCRIPTS (see SCRIPTS.md for full catalog)
│   ├── unifiedUpload.js          # Main upload — parts + assemblies + relink
│   ├── assignLevels.js           # Assign upload levels from PDM dependencies
│   ├── editPropertiesFromExcel.js # Update properties on existing elements
│   ├── releaseFromExcel.js       # Release documents from Excel
│   ├── replaceFromExcel.js       # Replace files keeping same revision
│   ├── createPublicationsFromExcel.js # Create publications from Excel
│   ├── deleteAndObsoleteFromExcel.js  # Obsolete revisions + delete elements
│   ├── renameDocumentsFromExcel.js    # Rename documents from Excel
│   ├── comparePDFs.js            # Compare PDFs by SHA-256 hash
│   ├── deployFeatureScript.js    # Deploy .fs files to Onshape
│   ├── generateFeatureScript.js  # Generate FeatureScript via Claude AI
│   │   ... (46 scripts total — see SCRIPTS.md)
│   │
│   ├── one-off/                  # One-time analysis scripts (hardcoded paths)
│   ├── PDM/                      # Migration data & scripts
│   │   ├── MigrationPlan.md      # Detailed migration strategy
│   │   ├── references.csv        # PDM reference export (13k+ rows)
│   │   └── inspectAssemblyFeatures.py # Detect assembly geometry features
│   │
│   └── output/                   # Generated output files
│
├── claude-progress.txt           # Agent progress tracking
├── CLAUDE.md                     # This file
└── README.md                     # Original Onshape docs
```

## Migration Workflow

See `Node/PDM/MigrationPlan.md` for full details.

### Phase 1: Extract & Categorize (DONE)
```bash
node categorizeFiles.js -r PDM/references.csv -d "PDM/Upload List.xlsx" -o output/
```

### Phase 2: Upload Parts First
Upload all 4,578 parts as master copies:
```bash
node uploadStandaloneParts.js -i output/standaloneParts.json -f <folderId> --release
```

### Phase 3: Pack & Go Assemblies
Run PowerShell script in SolidWorks to create ZIPs:
```powershell
./PDM/generatePackAndGo.ps1
```

### Phase 4: Upload Assemblies
```bash
node uploadAssemblies.js -i manifest.json -f <folderId>
```

### Phase 5: Relink to Master Parts
Replace duplicates with references to masters:
```bash
node relinkAssemblies.js -a assemblyImportMapping.json -p partMapping.json
```

### Phase 6: Release & Drawings
Release assemblies, then upload drawings.

## Key Technical Details

- **Runtime**: Node.js v20
- **Authentication**: HMAC-SHA256 signed API requests
- **API Base**: `energyrecovery.onshape.com`
- **Company ID**: `6763516217765c31f9561958`
- **Target Folder**: `af89b4c072a8fb45084e1757`
- **Working directory**: All `node` commands MUST run from `Node/` (that's where `node_modules` and `package.json` live). Use `cd Node && node script.js` or absolute paths. Running from the repo root will fail with `Cannot find module` errors.
- **Inline JS**: Avoid `node -e "..."` in zsh — `!`, `$`, and backticks get shell-interpreted. Write a temp `.js` file instead for anything beyond trivial one-liners.

## Onshape API Documentation (IMPORTANT)

**Before implementing ANY new Onshape API call, you MUST:**

1. Read `Node/docs/api/INDEX.md` to find the relevant category
2. Read the specific category file (e.g., `Node/docs/api/Assembly.json`)
3. Verify the exact endpoint path, parameters, and response schema
4. Check for required vs optional parameters
5. Note any special headers or query parameters

This ensures correct implementation and avoids trial-and-error debugging.

### Quick Reference - Common Endpoints

| Category | Key Operations |
|----------|----------------|
| Assembly | `getAssemblyDefinition`, `createInstance`, `modify` |
| BlobElement | `uploadFileCreateElement`, `uploadFileUpdateElement` |
| Document | `createDocument`, `getDocuments`, `deleteDocument` |
| Element | `updateReferences`, `deleteElement`, `copyElementFromSourceDocument` |
| Metadata | `updateWVEMetadata`, `getWMVEsMetadata` |
| ReleasePackage | `createReleasePackage`, `createObsoletionPackage` |
| Revision | `getRevisionByPartNumber`, `enumerateRevisions` |

### API Docs Location
```
Node/docs/api/
├── INDEX.md           # Start here - category overview
├── Assembly.json      # 28 endpoints
├── BlobElement.json   # 5 endpoints
├── Document.json      # 36 endpoints
├── Metadata.json      # 11 endpoints
├── ... (40 total)
└── _schemas.json      # Full schema reference
```

## Property ID Map (in bulkUploadFromExcel.js)
Maps 40+ Onshape property names to IDs including:
- Part number, Revision, Description, Vendor
- Custom: ECO, Status, ECO Priority, etc.

## Onshape API Rate Limiting

**IMPORTANT**: Onshape enforces rate limits that are NOT publicly documented. Violating them results in HTTP 429 errors and can block API access for 7-8 minutes.

### Key Headers
| Header | Description |
|--------|-------------|
| `X-Rate-Limit-Remaining` | Remaining calls allowed in current time window (check after each request) |
| `Retry-After` | Seconds to wait before retrying (returned with 429 errors, can be up to 450s) |

### Best Practices
1. **Process requests sequentially** - avoid parallel API calls for bulk operations
2. **Monitor `X-Rate-Limit-Remaining`** - slow down when it drops below 10
3. **Use adaptive delays** - start at 200ms, increase to 5000ms when rate limit is low
4. **Handle 429 gracefully** - read `Retry-After` header and wait that many seconds
5. **Never batch more than 1-2 requests** - parallel requests quickly trigger rate limits

### Example Implementation
See `updateAsmrefExcelVersions.js` for adaptive rate limiting pattern:
- Sequential processing with dynamic delays
- Monitors remaining calls and adjusts speed
- Auto-retry on 429 with proper backoff

### Annual Limits
Onshape also enforces **annual API call limits** (separate from rate limits):
- Varies by subscription type (2,500 - 20,000+ per year)
- Once exhausted, API access is blocked until renewal
- Monitor usage carefully for large migrations

## Agent Workflow

This project uses the long-running agent harness pattern from:
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

### Session Start Protocol (REQUIRED)

Every new session MUST begin by reading `claude-progress.txt` - specifically the **Session Handoff** section at the top. This tells you:
- What task is currently in progress
- What was done last
- Any blockers or context needed
- Commands to continue work

Optionally run `./init.sh` for full environment verification.

### Key Files

| File | Purpose |
|------|---------|
| `init.sh` | Session initialization script |
| `features.json` | Feature list with pass/fail status (DO NOT modify definitions) |
| `claude-progress.txt` | Detailed progress notes for context handoff |
| `CLAUDE.md` | This file - project context |

### Session Workflow

1. **Run `./init.sh`** - Verify environment, see status
2. **Read `claude-progress.txt`** - Understand current state
3. **Check `features.json`** - Find next incomplete feature
4. **Work on ONE feature** - Focus on single task
5. **Test the feature** - Verify it works
6. **Update `features.json`** - Mark as passed if complete
7. **Update `claude-progress.txt`** - Document what was done
8. **Commit changes** - Small, descriptive commits
9. **Push to remote** - Ensure work is saved

### Rules

- **DO NOT** remove or modify feature definitions in `features.json`
- **DO NOT** mark features as passed without testing
- **DO** commit frequently with descriptive messages
- **DO** update progress file before context runs out

## Coding Guidelines

### No Fallback Behavior

**CRITICAL**: Do NOT implement fallback logic or "legacy compatibility" code paths. If required data is missing, the code should fail explicitly rather than silently doing something unexpected.

**Why**: This is a migration toolkit where data integrity is paramount. Silent fallbacks can cause:
- Accidental deletion of master files (if name-based matching falls back when ID tracking fails)
- Incorrect data mappings that are hard to debug
- False confidence that operations succeeded when they didn't

**Instead of fallbacks**:
- Fail fast with a clear error message
- Log what data was expected vs. what was provided
- Let the user fix the root cause rather than masking it

**Example - BAD** (fallback):
```javascript
if (knownAssemblyElements.length > 0) {
  // Use known IDs (safe)
  deleteByIds(knownAssemblyElements);
} else {
  // Fallback to name matching (risky!) - DON'T DO THIS
  deleteByNameMatching(allElements);
}
```

**Example - GOOD** (fail fast):
```javascript
if (knownAssemblyElements.length > 0) {
  // Use known IDs (safe)
  deleteByIds(knownAssemblyElements);
} else {
  // No known elements - skip operation, don't guess
  console.log('No known imported elements - skipping deletion');
}
```

## API Key Security

- Never commit actual API keys
- Use `config/apikey.js` for credentials (gitignored)

## Documentation Index

The `Node/` folder contains detailed documentation for the migration toolkit:

| Document | Description |
|----------|-------------|
| [TOOLS.md](Node/TOOLS.md) | `run.bat` command reference - quick lookup for all CLI commands |
| [ARCHITECTURE.md](Node/ARCHITECTURE.md) | Dependency tree, data flow diagrams, module responsibilities |
| [SCRIPTS.md](Node/SCRIPTS.md) | Detailed reference for each script (options, required columns, output) |
| [MODULES.md](Node/MODULES.md) | `lib/` module API documentation (functions, endpoints, examples) |
| [docs/api/INDEX.md](Node/docs/api/INDEX.md) | Onshape API reference - 40 category files split from OpenAPI spec |

### Quick Start

1. **What command do I run?** See [TOOLS.md](Node/TOOLS.md)
2. **How does data flow through the system?** See [ARCHITECTURE.md](Node/ARCHITECTURE.md)
3. **What Excel columns does X script need?** See [SCRIPTS.md](Node/SCRIPTS.md)
4. **What API endpoints does X module call?** See [MODULES.md](Node/MODULES.md)
5. **What Onshape API endpoint should I use?** See [docs/api/INDEX.md](Node/docs/api/INDEX.md)

### Keeping Documentation Updated (REQUIRED)

**When you make substantial code changes, you MUST update the relevant documentation:**

| Change Type | Update These Files |
|-------------|-------------------|
| New script created | `SCRIPTS.md` (add entry with options, columns, output) |
| New `run.bat` command | `TOOLS.md` (add command reference) |
| New/modified `lib/` function | `MODULES.md` (update function docs, endpoints) |
| New API endpoint used | `MODULES.md` (add to endpoint list for that module) |
| Changed data flow or dependencies | `ARCHITECTURE.md` (update diagrams/descriptions) |
| New Excel column required | `SCRIPTS.md` (update required columns for script) |

**What counts as "substantial":**
- Adding a new script or command
- Adding/removing/renaming exported functions in `lib/`
- Changing API endpoints a module calls
- Adding new required Excel columns
- Changing how modules depend on each other

**NOT required for:**
- Bug fixes that don't change interfaces
- Internal refactoring with same external behavior
- Adding comments or minor formatting
