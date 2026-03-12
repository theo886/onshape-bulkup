# Relink Module Documentation

## Overview

The relink module provides a reusable library for replacing duplicate parts in Onshape assemblies with references to master parts. This is critical for maintaining a clean, de-duplicated CAD system during migration from SolidWorks PDM.

## Files

### `/Node/lib/relink.js`

Reusable module containing all relink functionality. Can be imported and used by any script that needs to perform assembly relinking.

**Exported Functions:**
- `getAssemblyDefinition(docId, workId, elementId, callback)` - Fetch assembly instances and transforms
- `deleteInstances(docId, workId, elementId, instanceIds, callback)` - Remove duplicate instances
- `createVersion(docId, workId, name, callback)` - Create version for cross-document references
- `createInstanceWithTransform(docId, workId, elementId, masterInfo, transform, callback)` - Create new instance with position
- `getNewestInstance(docId, workId, elementId, knownIds, callback)` - Find newly created instance
- `groupInstances(docId, workId, elementId, instanceIds, callback)` - Group instances to lock positions
- `fastenToOrigin(docId, workId, elementId, instanceId, callback)` - Fasten first instance to origin
- `deleteElement(docId, workId, elementId, callback)` - Delete duplicate Part Studio elements
- `updateExternalReferences(docId, workId, elementId, callback)` - Refresh external references
- `relinkAssembly(assemblyInfo, partMapping, callback)` - **Main orchestration function**

### `/Node/unifiedUpload.js` (Updated)

Integrated relink module into the unified upload workflow.

**Changes:**
1. Added `const relink = require('./lib/relink.js');` at top
2. Updated `uploadPart()` to store `filename` in `partMapping` for matching
3. Updated `uploadAssembly()` to automatically call `relinkAssembly()` after translation completes
4. Enhanced help text to document the relink workflow

## Usage

### Direct Usage (Standalone)

```javascript
const relink = require('./lib/relink.js');

const assemblyInfo = {
  documentId: 'abc123',
  workspaceId: 'def456',
  elements: ['elem1', 'elem2']  // or array of {elementId, type, name}
};

const partMapping = {
  '12345': {
    documentId: 'xyz789',
    workspaceId: 'uvw012',
    elementId: 'part1',
    filename: '12345.SLDPRT'
  }
};

relink.relinkAssembly(assemblyInfo, partMapping, (report, error) => {
  if (error) {
    console.error('Relink failed:', error);
  } else {
    console.log(`Relinked ${report.relinksPerformed} instances`);
    console.log(`Deleted ${report.deletedElements} duplicate elements`);
  }
});
```

### Integrated Usage (unifiedUpload.js)

The relink process is automatic when uploading assemblies (level 2+):

```bash
# 1. Upload parts first (level 1) - builds partMapping
node unifiedUpload.js -i upload_list.xlsx --level 1

# 2. Upload assemblies (level 2+) - automatically relinks to parts from step 1
node unifiedUpload.js -i upload_list.xlsx --level 2
```

## Workflow

When `relinkAssembly()` is called, it performs the following steps:

1. **Find Assembly Element** - Locates the Assembly element in the document
2. **Get Assembly Definition** - Fetches all instances with their transforms
3. **Identify Duplicates** - Matches local instances to master parts by filename
4. **Delete Duplicate Instances** - Removes instances that will be replaced
5. **Create Master References** - Creates new instances from master parts with original transforms
6. **Group Instances** - Groups all new instances to preserve relative positions
7. **Fasten to Origin** - Fastens first instance to prevent movement
8. **Delete Duplicate Elements** - Removes orphaned Part Studio elements
9. **Update References** - Refreshes external references to latest versions

## Filename Matching Logic

The module tries multiple variations to match instance names to master parts:

1. Clean name (without `<1>` suffix)
2. Base name (without file extension)
3. Base name with `.SLDPRT` extension
4. Clean name with `.SLDPRT` extension

Example: An instance named "12345 <1>" will match a part with filename "12345.SLDPRT"

## Error Handling

- If relink fails, the assembly is still uploaded and marked complete
- Individual instance creation failures are logged but don't stop the process
- Group/fasten failures are logged as warnings (not critical)
- External reference refresh failures are logged as warnings

## Report Structure

The `relinkAssembly()` callback receives a report object:

```javascript
{
  relinksPerformed: 5,      // Number of instances successfully relinked
  errors: 0,                // Number of errors encountered
  deletedElements: 3        // Number of duplicate elements deleted
}
```

## Integration Points

### With relinkAssemblies.js

The standalone `relinkAssemblies.js` script can be refactored to use this module:

```javascript
const relink = require('./lib/relink.js');

// Instead of implementing all functions inline...
// Just call:
relink.relinkAssembly(assemblyInfo, partMapping, callback);
```

### With Other Scripts

Any script that needs to relink assemblies can import and use this module:

```javascript
const relink = require('./lib/relink.js');
```

## Testing

A test file is provided to verify module exports:

```bash
node test_relink_module.js
```

This validates that all 10 functions are properly exported.

## Benefits

1. **Code Reusability** - Single implementation used across multiple scripts
2. **Maintainability** - Fixes/improvements apply everywhere automatically
3. **Testability** - Can test relink logic independently
4. **Integration** - Easy to add relink to any workflow
5. **Consistency** - Same behavior everywhere

## Future Enhancements

Potential improvements:

- Add dry-run mode parameter
- Support for batch relinking multiple assemblies
- Progress callbacks for long operations
- Enhanced error reporting with detailed failure reasons
- Configurable matching strategies for filename variations
