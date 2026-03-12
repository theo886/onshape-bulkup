# Architecture Overview

This document describes the dependency tree and data flow for the migration toolkit.

## Dependency Tree

```
run.bat
├── test
│   └── apiTest.js
│       └── lib/onshape.js
│       └── lib/app.js
│
├── upload / dry-run / slow-run / level N
│   └── unifiedUpload.js
│       ├── lib/app.js
│       ├── lib/onshape.js
│       ├── lib/relink.js
│       │   ├── lib/onshape.js
│       │   ├── lib/asmref.js
│       │   └── lib/zipUtils.js
│       ├── lib/asmref.js
│       └── lib/util.js (indirect via onshape)
│
├── levels / inspect
│   └── inspectExcel.js
│       └── xlsx (npm package)
│
├── check
│   └── checkAssemblyDependencies.js
│       └── xlsx
│
├── assign
│   └── assignLevels.js
│       └── xlsx
│
├── delete
│   └── deleteElementsFromExcel.js
│       ├── lib/onshape.js
│       └── xlsx
│
├── edit
│   └── editPropertiesFromExcel.js
│       ├── lib/onshape.js
│       ├── lib/app.js
│       └── xlsx
│
├── release
│   └── releaseFromExcel.js
│       ├── lib/onshape.js
│       ├── lib/app.js
│       └── xlsx
│
├── version
│   └── versionFromExcel.js
│       ├── lib/onshape.js
│       └── xlsx
│
└── replace
    └── replaceFromExcel.js
        ├── lib/onshape.js
        ├── lib/app.js
        ├── unifiedUpload.js (imports buildPropertiesArray, pollTranslation)
        └── xlsx
```

## Module Responsibilities

| Module | Purpose |
|--------|---------|
| `lib/onshape.js` | Low-level API client (HMAC auth, HTTP verbs) |
| `lib/app.js` | High-level wrappers (uploadBlobElement, createDocument) |
| `lib/relink.js` | Assembly relink workflow (replace duplicates with masters) |
| `lib/asmref.js` | ASMREF JSON lookups (assembly-to-component mapping) |
| `lib/zipUtils.js` | ZIP file inspection (list SolidWorks files) |
| `lib/util.js` | Error handling and object utilities |

## Data Flow

### Upload Workflow

```
┌─────────────────┐
│  Excel File     │  uploadLevel, document:name, filePath, property:*
└────────┬────────┘
         │
         v
┌─────────────────┐
│ unifiedUpload.js│  Route by uploadLevel
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    │         │            │
    v         v            v
Level 0    Level 1     Level 2+
(Blob)     (Part)      (Assembly)
    │         │            │
    v         v            v
┌───────┐ ┌───────┐  ┌─────────────┐
│Upload │ │Upload │  │Upload ZIP   │
│Blob   │ │SLDPRT │  │Translation  │
│Element│ │Trans. │  └──────┬──────┘
└───┬───┘ └───┬───┘         │
    │         │             v
    │         │      ┌─────────────┐
    │         │      │relink.js    │
    │         │      │Replace dupes│
    │         │      │with masters │
    │         │      └──────┬──────┘
    │         │             │
    └────┬────┴─────────────┘
         │
         v
┌─────────────────┐
│Set Properties   │  metadata API
│(part or element)│
└────────┬────────┘
         │
         v
┌─────────────────┐
│Release          │  releasepackages API
│(if Release col) │
└────────┬────────┘
         │
         v
┌─────────────────┐
│Update Status    │  upload_status.json
│Export Excel     │  *_completed.xlsx
└─────────────────┘
```

### Relink Workflow (Assembly)

```
┌─────────────────┐
│Assembly ZIP     │  Pack & Go from SolidWorks
└────────┬────────┘
         │
         v
┌─────────────────┐
│Translation API  │  Creates Part Studios + Assembly element
└────────┬────────┘
         │
         v
┌─────────────────┐
│ASMREF Lookup    │  Match instance names to master parts
│(lib/asmref.js)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│Delete Local     │  Remove duplicate instances
│Instances        │
└────────┬────────┘
         │
         v
┌─────────────────┐
│Create External  │  Add instances from master documents
│Instances        │  (with original transforms)
└────────┬────────┘
         │
         v
┌─────────────────┐
│Group & Fasten   │  Lock positions with group + fasten-to-origin
└────────┬────────┘
         │
         v
┌─────────────────┐
│Delete Part      │  Remove orphaned Part Studio elements
│Studios          │
└─────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `Upload/upload_status.json` | Persistent state (partMapping, assemblyMapping) |
| `output/asmref.json` | ASMREF data (assembly-component mappings) |
| `PDM/references.csv` | PDM reference export (parent-child relationships) |
| `config/apikey.js` | API credentials (gitignored) |

## Rate Limiting Strategy

All scripts use sequential processing with adaptive delays:

1. **Baseline delay**: 200-500ms between requests
2. **Monitor `X-Rate-Limit-Remaining`**: Increase delay when < 10 remaining
3. **Handle 429**: Read `Retry-After` header, wait specified time
4. **Max delay**: 5000ms when rate limit is low

See `editPropertiesFromExcel.js` for the reference implementation.

## Error Handling

- Non-fatal errors logged to console, processing continues
- Fatal errors (missing files, auth failure) exit with status code
- Release errors logged to `Upload/release_errors.json`
- Each script exports `*_log.csv` with per-row results
