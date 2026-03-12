# Guide: Defining FeatureScript Features

How to define custom features in FeatureScript -- the defineFeature pattern, preconditions, imports, and feature lifecycle.

## The defineFeature Pattern

Every custom feature follows this structure:

```javascript
annotation { "Feature Type Name" : "My Feature Name" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        // Parameter definitions (UI specification)
    }
    {
        // Feature body (geometry operations)
    });
```

Three required arguments:
- `context is Context` -- stores all modeling data (bodies, entities, variables, errors)
- `id is Id` -- unique identifier for this feature instance, used in queries and error reporting
- `definition is map` -- contains all parameter values from the precondition

The annotation `{ "Feature Type Name" : "..." }` is **required** -- it registers the function as a user-visible feature.

`export const` makes the feature available in the Part Studio feature list.

## Feature Annotation Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `"Feature Type Name"` | Yes | string | Display name in feature list |
| `"Feature Type Description"` | No | string | Tooltip description (supports basic HTML: `<br>`, `<b>`, `<i>`) |
| `"Manipulator Change Function"` | No | string | Function name called when manipulator moves |
| `"Editing Logic Function"` | No | string | Function name called on definition changes |
| `"Filter Selector"` | No | array of strings | Categories for feature list filtering |
| `"UIHint"` | No | UIHint | e.g. `UIHint.NO_PREVIEW_PROVIDED` |
| `"Icon"` | No | blob data | SVG icon for the feature |
| `"Description Image"` | No | blob data | JPG/PNG/SVG preview image (~300x300px) |
| `"Feature Name Template"` | No | string | Custom naming template |
| `"Tooltip Template"` | No | string | Custom tooltip |

Example with description:

```javascript
annotation { "Feature Type Name" : "Slot",
             "Feature Type Description" : "Creates a rectangular slot in a selected part.<br>" ~
                                          "This feature is an <b>example</b>" }
```

## Precondition Block

The precondition defines the feature's UI parameters. Each parameter is a statement inside the precondition block. Parameters appear in the feature dialog in the order they are written.

```javascript
precondition
{
    annotation { "Name" : "Faces to select" }
    definition.faces is Query;

    annotation { "Name" : "Depth" }
    isLength(definition.depth, LENGTH_BOUNDS);

    annotation { "Name" : "Use draft", "Default" : false }
    definition.useDraft is boolean;

    if (definition.useDraft)
    {
        annotation { "Name" : "Draft angle" }
        isAngle(definition.draftAngle, ANGLE_STRICT_90_BOUNDS);
    }
}
```

Key rules:
- Each parameter appears **exactly once** (cannot appear in multiple if branches with different annotations)
- `if` blocks control conditional visibility (parameter shown/hidden based on other parameter values)
- Annotations provide metadata (Name, Default, Filter, etc.)
- See `Guide-FeatureUI.md` for all parameter types and annotation fields

## Feature Body

The body executes geometry operations. Common patterns:

```javascript
{
    // Call operations (op* functions modify geometry)
    opExtrude(context, id + "extrude1", {
        "entities" : definition.faces,
        "direction" : evOwnerSketchPlane(context, { "entity" : definition.faces }).normal,
        "endBound" : BoundingType.BLIND,
        "endDepth" : definition.depth
    });

    // Call evaluation functions (ev* measure geometry)
    const volume = evVolume(context, { "entities" : qCreatedBy(id + "extrude1") });

    // Report errors
    if (volume < threshold)
        reportFeatureWarning(context, id, "Volume is below threshold");
}
```

### Id Management

Every operation needs a unique Id. Ids are hierarchical -- use `id + "name"` to create child ids:

```javascript
opExtrude(context, id + "extrude1", { ... });
opChamfer(context, id + "chamfer1", { ... });

// In loops, include the index to ensure uniqueness:
for (var i = 0; i < count; i += 1)
{
    opExtrude(context, id + ("extrude" ~ i), { ... });
}
```

**Important**: Each Id (including parents) must refer to a contiguous region of operations. This fails:

```javascript
for (var i in [1, 2])
{
    opExtrude(context, id + "extrude" + i, { ... }); // Fails on second iteration
    opChamfer(context, id + "chamfer" + i, { ... });
}
```

Fix: use `id + i + "extrude"` or `id + ("extrude" ~ i)`.

## Feature Lifecycle

Custom features execute during Part Studio regeneration:
- When the feature is initially added
- When definition parameters are updated
- When upstream features change, get deleted, or are suppressed
- When the rollback bar moves relative to the feature

Features use **Queries** to select geometry dynamically rather than storing explicit references. This means if upstream geometry changes, the feature adapts automatically.

## Import System

Every Feature Studio starts with an import:

```javascript
FeatureScript 2026;
import(path : "onshape/std/geometry.fs", version : "2026.0");
```

### Standard Library Import

`geometry.fs` imports the entire Standard Library. For computed properties, prefer `common.fs` (smaller, better performance).

### Workspace Import (same document)

```javascript
import(path : "990d0d558752560035c1bc8e", version : "e83d3c3d23dea63825b44d09");
```

The path is the 24-character tab ID from the URL `/e/` segment. Auto-updates when source changes.

### Versioned Import (external document)

```javascript
import(path : "docId/versionId/tabId", version : "versionHash");
```

Fixed to a specific version. Must be manually updated.

### Namespaced Import

```javascript
MyLib::import(path : "onshape/std/math.fs", version : "2026.0");
const result = MyLib::someFunction();
```

### Exporting

Use `export` keyword on any top-level construct to make it visible to importers:

```javascript
export function myHelper(...) { ... }
export enum MyEnum { A, B, C }
export type MyType typecheck isMyType;
export const MY_CONST = 42;
```

Imported symbols are NOT re-exported by default. To re-export:

```javascript
export import(path : "onshape/std/tool.fs", version : "");
```

### Importing Data (Blob Import)

External data (CSV, JSON, images, BREP) uploaded to Onshape tabs:

```javascript
MyData::import(path : "tabId", version : "...");
// MyData::BLOB_DATA contains: { mediaType, blobType, csvData/jsonData/textData, ... }
const firstEntry = MyData::BLOB_DATA.csvData[0][0];
```

## Subfeatures

Break complex features into subroutines. Pass `context`, a child `id`, and any needed parameters:

```javascript
annotation { "Feature Type Name" : "My Feature" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { ... }
    {
        fCuboid(context, id + "startingCube", {
            "corner1" : vector(0, 0, 0) * inch,
            "corner2" : vector(1, 1, 1) * inch
        });
        mySubfeature(context, id + "subFeature", qCreatedBy(id + "startingCube", EntityType.EDGE));
    }, {});

function mySubfeature(context is Context, id is Id, entities is Query)
{
    opChamfer(context, id + "chamfer", {
        "entities" : entities,
        "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : 0.1 * inch
    });
}
```

## Feature Pattern Support

For custom features to work with Onshape's pattern features (linear, circular, etc.), apply the remainder transform:

```javascript
// Inside feature body:
const remainingTransform = getRemainderPatternTransform(context, { "references" : definition.faces });
// Apply transform to your geometry...
```

## Minimal Complete Example

```javascript
FeatureScript 2026;
import(path : "onshape/std/geometry.fs", version : "2026.0");

annotation { "Feature Type Name" : "Simple Extrude" }
export const simpleExtrude = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Sketch faces", "Filter" : GeometryType.PLANE }
        definition.faces is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);
    }
    {
        opExtrude(context, id + "extrude1", {
            "entities" : definition.faces,
            "direction" : evOwnerSketchPlane(context, { "entity" : definition.faces }).normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.depth
        });
    });
```

## Cross-References

- See `Guide-FeatureUI.md` for all parameter types and annotations
- See `Guide-Modeling.md` for operations (op*) and evaluations (ev*)
- See `Guide-FeatureOutput.md` for error reporting and debugging
- See `Modeling.json` > `context.fs` for Context and Id types
- See `Utilities.json` > `feature.fs` for defineFeature and related functions
