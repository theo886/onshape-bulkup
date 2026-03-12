# Module Reference

Documentation for the `lib/` modules used by run.bat scripts.

---

## lib/onshape.js

**Purpose**: Low-level Onshape API client with HMAC-SHA256 authentication.

### Exported Functions

| Function | Description |
|----------|-------------|
| `get(opts, callback)` | HTTP GET request |
| `getBinary(opts, callback)` | HTTP GET returning Buffer (for binary downloads) |
| `post(opts, callback)` | HTTP POST request |
| `delete(opts, callback)` | HTTP DELETE request |
| `upload(opts, callback)` | Multipart file upload |
| `createDocument(opts, callback)` | Create new document |
| `createReleasePackage(opts, callback)` | Create release package |
| `submitReleasePackage(opts, callback)` | Submit release package |
| `getCompany(callback)` | Get company info |
| `getCompanyPolicies(opts, callback)` | Get company policies |

### Options Object

```javascript
{
  d: 'documentId',          // Document ID
  w: 'workspaceId',         // Workspace ID (mutually exclusive with v, m)
  v: 'versionId',           // Version ID
  m: 'microversionId',      // Microversion ID
  e: 'elementId',           // Element ID
  resource: 'partstudios',  // API resource
  subresource: 'stl',       // Sub-resource
  path: '/api/...',         // Override full path
  query: { key: 'value' },  // Query parameters
  body: {},                 // POST body
  headers: {},              // Additional headers
  file: '/path/to/file',    // For upload()
  mimeType: 'image/png',    // For upload()
  elementName: 'name'       // For upload() - custom element name
}
```

### Callback Signatures

**`get()` callback**:
```javascript
callback(data, error, rateInfo)
// data: Response body (string)
// error: { statusCode, body, headers } or null
// rateInfo: { remaining, retryAfter } - rate limit info
```

**`getBinary()` callback**:
```javascript
callback(buffer, error, rateInfo)
// buffer: Response body (Buffer) — use for binary downloads (PDFs, images, etc.)
// error: { statusCode, body, headers } or null
// rateInfo: { remaining, retryAfter } - rate limit info
```

### Onshape API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET/POST | Search/create documents |
| `/api/documents/d/{did}/versions` | POST | Create version |
| `/api/documents/d/{did}/w/{wid}/elements` | GET | List elements |
| `/api/documents/d/{did}/workspaces` | GET | Get workspaces |
| `/api/elements/d/{did}/w/{wid}/e/{eid}` | DELETE | Delete element |
| `/api/blobelements/d/{did}/w/{wid}` | POST | Upload blob |
| `/api/blobelements/d/{did}/w/{wid}/e/{eid}` | GET | Download blob (binary) |
| `/api/blobelements/d/{did}/w/{wid}/e/{eid}` | POST | Update blob |
| `/api/v6/translations/d/{did}/w/{wid}` | POST | Upload CAD |
| `/api/translations/{tid}` | GET | Poll translation |
| `/api/metadata/d/{did}/w/{wid}/e/{eid}` | POST | Set element properties |
| `/api/metadata/d/{did}/w/{wid}/e/{eid}/p/{pid}` | POST | Set part properties |
| `/api/parts/d/{did}/w/{wid}/e/{eid}` | GET | List parts |
| `/api/releasepackages/release/{wfid}` | POST | Create release |
| `/api/releasepackages/{rpid}` | POST | Submit release |
| `/api/v10/companies/{cid}/policies` | GET | Get workflow ID |

---

## lib/app.js

**Purpose**: High-level wrappers for common Onshape operations.

### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `getParts` | `(docId, wvm, wvmId, elemId, cb)` | Get parts in element |
| `getMassProperties` | `(docId, wvm, wvmId, elemId, cb)` | Get mass properties |
| `createPartStudio` | `(docId, workId, name, cb)` | Create Part Studio |
| `deleteElement` | `(docId, workId, elemId, cb)` | Delete element |
| `uploadBlobElement` | `(docId, workId, file, mime, name?, cb)` | Upload blob |
| `updateBlobElement` | `(docId, workId, elemId, file, mime, name, cb)` | Update blob |
| `getDocuments` | `(query, cb)` | Search documents |
| `getElements` | `(docId, workId, cb)` | List elements |
| `getWorkspaces` | `(docId, cb)` | Get document workspaces |
| `getProperties` | `(docId, workId, elemId, cb)` | Get element properties |
| `updateProperties` | `(docId, workId, elemId, props, cb)` | Set properties |
| `createDocument` | `(name, isPublic, folderId, cb)` | Create document |
| `getCompany` | `(cb)` | Get company info |
| `getCompanyPolicies` | `(companyId, cb)` | Get policies (workflow ID) |
| `createReleasePackage` | `(pkg, companyId, cb)` | Create release |
| `submitReleasePackage` | `(rpid, cb)` | Submit release |
| `partStudioStl` | `(docId, workId, elemId, query, cb)` | Export STL |

### Example Usage

```javascript
const app = require('./lib/app.js');

// Upload a file
app.uploadBlobElement(docId, workId, '/path/to/file.pdf', 'application/pdf', 'CustomName.pdf', (data, err) => {
  if (err) console.error(err);
  else console.log('Uploaded:', JSON.parse(data).id);
});

// Set properties
app.updateProperties(docId, workId, elemId, [
  { propertyId: '57f3fb8efa3416c06701d60f', value: 'PART-001' },  // Part number
  { propertyId: '57f3fb8efa3416c06701d60e', value: 'My Part' }    // Description
], callback);
```

---

## lib/relink.js

**Purpose**: Assembly relink workflow - replaces duplicate parts with references to master parts.

### Exported Functions

| Function | Description |
|----------|-------------|
| `relinkAssembly(assemblyInfo, partMapping, asmrefData?, callback)` | Main relink workflow |
| `getAssemblyDefinition(docId, workId, elemId, callback)` | Get assembly structure |
| `deleteInstances(docId, workId, elemId, instanceIds, callback)` | Delete assembly instances |
| `createVersion(docId, workId, name, callback)` | Create document version |
| `createInstanceWithTransform(docId, workId, elemId, masterInfo, transform, callback)` | Create single instance |
| `createInstancesBatch(docId, workId, elemId, items, callback)` | Create multiple instances |
| `groupInstances(docId, workId, elemId, instanceIds, callback)` | Group instances |
| `fastenToOrigin(docId, workId, elemId, instanceId, callback)` | Fasten to origin |
| `deleteElement(docId, workId, elemId, callback)` | Delete element |
| `updateExternalReferences(docId, workId, elemId, callback)` | Refresh references |

### assemblyInfo Object

```javascript
{
  documentId: 'string',
  workspaceId: 'string',
  elementId: 'string',                  // Assembly element ID
  partStudioElements: ['id1'],          // Part Studio IDs created during import (safe to delete)
  importedAssemblyElements: ['id2'],    // Sub-assembly IDs created during import (safe to delete)
  zipPath: '/path/to/zip'               // For ZIP contents comparison
}
```

**Deletion Safety**: Only elements in `partStudioElements` and `importedAssemblyElements` are considered for deletion. This protects pre-existing "master" elements from accidental deletion. Part Studios with unmatched instances (virtual parts) are never deleted.

### partMapping Object

```javascript
{
  'PART-001': {
    documentId: 'string',
    workspaceId: 'string',
    elementId: 'string',
    versionId: 'string',         // From release
    filename: 'PART-001.SLDPRT'
  }
}
```

### Onshape API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/assemblies/d/{did}/w/{wid}/e/{eid}` | GET | Get definition |
| `/api/v9/assemblies/d/{did}/w/{wid}/e/{eid}/modify` | POST | Delete instances |
| `/api/assemblies/d/{did}/w/{wid}/e/{eid}/transformedinstances` | POST | Create instances |
| `/api/assemblies/d/{did}/w/{wid}/e/{eid}/features` | POST | Create group/mate |
| `/api/v6/documents/d/{did}/w/{wid}/e/{eid}/latestdocumentreferences` | POST | Refresh refs |

---

## lib/asmref.js

**Purpose**: ASMREF JSON lookups for assembly-to-component mapping.

### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `load` | `(jsonPath)` | Load ASMREF JSON file |
| `lookup` | `(data, assemblyName, linkFileName)` | Find entry |
| `updateIds` | `(data, partNumber, ids)` | Update Onshape IDs |
| `save` | `(data, jsonPath)` | Save to file |
| `getAssemblyComponents` | `(data, assemblyName)` | Get all components |
| `getStats` | `(data)` | Get statistics |

### ASMREF JSON Structure

```javascript
{
  byAssembly: {
    'ASSEMBLY.SLDASM': {
      'COMPONENT.SLDPRT': {
        documentId: 'string',
        workspaceId: 'string',
        elementId: 'string',
        versionId: 'string',
        partNumber: 'string',
        type: 'SLDPRT',        // or 'SLDASM'
        isVirtual: false       // true for virtual parts
      }
    }
  },
  byPartNumber: {
    'PART-001': ['ASSEMBLY1.SLDASM', 'ASSEMBLY2.SLDASM']
  },
  metadata: {
    generated: 'ISO date',
    sourceFile: 'path',
    uniqueEntries: 1234
  }
}
```

### Example Usage

```javascript
const asmref = require('./lib/asmref.js');

const data = asmref.load('output/asmref.json');
const entry = asmref.lookup(data, '100002.SLDASM', '51298.SLDPRT');

if (entry && entry.documentId) {
  // Replace with master
} else if (entry && entry.isVirtual) {
  // Keep local (virtual part)
} else {
  // Not found - error
}
```

---

## lib/zipUtils.js

**Purpose**: ZIP file inspection for Pack & Go archives.

### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `listSolidWorksFiles` | `(zipPath)` | List SW files (names only) |
| `listSolidWorksFilesDetailed` | `(zipPath)` | List SW files with metadata |

### Return Values

```javascript
// listSolidWorksFiles returns:
['part1', 'assembly1']  // lowercase, no extension

// listSolidWorksFilesDetailed returns:
[
  { filename: 'Part1.SLDPRT', baseName: 'part1', path: 'folder/Part1.SLDPRT', type: 'part' },
  { filename: 'Assembly1.SLDASM', baseName: 'assembly1', path: 'Assembly1.SLDASM', type: 'assembly' }
]
```

### Example Usage

```javascript
const { listSolidWorksFiles } = require('./lib/zipUtils.js');

const parts = listSolidWorksFiles('/path/to/packandgo.zip');
console.log(`ZIP contains ${parts.length} SolidWorks files`);
```

---

## lib/util.js

**Purpose**: Error handling and utility functions.

### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `error` | `(err, callback?)` | Handle API errors |
| `copyObject` | `(object)` | Deep copy object |

### Error Handling

```javascript
const util = require('./lib/util.js');

// With callback - passes error to callback
util.error(err, callback);

// Without callback - logs and exits
util.error(err);
```

---

## Property ID Reference

Common property IDs used across scripts (from `propertyIdMap` in `unifiedUpload.js`):

| Property | ID |
|----------|-----|
| Part number | `57f3fb8efa3416c06701d60f` |
| Revision | `57f3fb8efa3416c06701d610` |
| Description | `57f3fb8efa3416c06701d60e` |
| Name | `57f3fb8efa3416c06701d60d` |
| Vendor | `57f3fb8efa3416c06701d612` |
| Material | `57f3fb8efa3416c06701d615` |
| State | `57f3fb8efa3416c06701d611` |
| Category | `57f3fb8efa3416c06701d625` |
| ECO | `68b76e59c462aacfb466c5a2` |
| Status | `68c0fa54a1edc754a12826ab` |

See `unifiedUpload.js:34-98` for the complete property ID map.
