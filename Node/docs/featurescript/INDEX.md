# FeatureScript Documentation — AI Agent Reference

> **Purpose**: Enable AI agents to write correct FeatureScript by providing comprehensive,
> machine-readable documentation of the language, patterns, and Standard Library.

## How to Use These Docs

When writing FeatureScript, follow this order:

1. **Read Guide-Language.md** — understand syntax basics (types, operators, control flow)
2. **Read Guide-FeatureDefinition.md** — learn the `defineFeature` template
3. **Read Guide-FeatureUI.md** — learn how to define parameters in the precondition
4. **Look up specific functions** in the JSON category files (below)
5. **Use `_crossReferences.json`** to find which file defines a type or enum

For quick reference on a specific function, search the JSON files for the function name.
For understanding how to structure a feature, read the Guide files first.

## Guide Files (Markdown)

Conceptual documentation organized by task. Read these to understand patterns.

| File | Description | When to Read |
|------|-------------|-------------|
| [Guide-Language.md](Guide-Language.md) | Syntax, types, type tags, control flow, exceptions, operators, annotations | First — learn syntax before writing code |
| [Guide-FeatureDefinition.md](Guide-FeatureDefinition.md) | defineFeature pattern, precondition, imports, feature lifecycle | Starting a new feature |
| [Guide-FeatureUI.md](Guide-FeatureUI.md) | Parameter types, annotations, UIHints, conditional visibility, manipulators | Adding UI parameters to a feature |
| [Guide-Modeling.md](Guide-Modeling.md) | Context, bodies, queries, operations (op*), evaluations (ev*), sketches | Working with geometry and queries |
| [Guide-FeatureOutput.md](Guide-FeatureOutput.md) | print/debug, error reporting, regenError, profiling | Debugging or adding error handling |
| [Guide-Tables.md](Guide-Tables.md) | defineTable, columns, rows, cell types, cross-highlighting | Creating custom tables |
| [Guide-ComputedProperties.md](Guide-ComputedProperties.md) | defineComputedPartProperty, return types, testing, deployment | Creating computed part properties |

## Standard Library Reference (JSON)

Structured data parsed from the Onshape Standard Library. Use these to look up functions, types, and enums.

| File | Modules | Symbols | Size | Description |
|------|---------|---------|------|-------------|
| [Modeling.json](Modeling.json) | 8 | 293 | 498 KB | Core modeling types and operations — Context, Id, Query, operations (op*), evaluations (ev*), sketch, primitives |
| [Math.json](Math.json) | 16 | 339 | 221 KB | Mathematical types and utilities — Vector, Matrix, Transform, units, coordinate systems |
| [Utilities.json](Utilities.json) | 35 | 417 | 448 KB | Helper modules — feature definitions, error handling, debug, properties, containers, manipulators, tables |
| [Features-Modification.json](Features-Modification.json) | 13 | 30 | 40 KB | Body modification — boolean, chamfer, fillet, shell, draft, split, delete/move/replace faces |
| [Features-Surfaces.json](Features-Surfaces.json) | 6 | 19 | 21 KB | Surface creation — boundary surface, fill, ruled, offset, constrained, bridging curve |
| [Features-Patterns.json](Features-Patterns.json) | 5 | 8 | 38 KB | Pattern and copy — circular, linear, curve patterns, mirror, transform copy |
| [Features-CurvesAndWires.json](Features-CurvesAndWires.json) | 11 | 37 | 27 KB | Curve and wire creation — helix, spline, projection, isocline, composite curves |
| [Features-Other.json](Features-Other.json) | 15 | 57 | 65 KB | Other features — hole, construction plane, import, mate connector, tag, variable, wrap, etc. |
| [Features-Frames.json](Features-Frames.json) | 5 | 8 | 6 KB | Frame features — frame, trim, gusset, endcap, cutlist |
| [Features-SolidCreation.json](Features-SolidCreation.json) | 7 | 11 | 27 KB | Solid body creation — extrude, revolve, loft, sweep, thicken, rib, enclose |
| [Features-SheetMetal.json](Features-SheetMetal.json) | 15 | 87 | 75 KB | Sheet metal features — start, flange, bend, corner, tab, joint, loft, formed |
| [Enums.json](Enums.json) | 73 | 88 | 108 KB | All auto-generated enum types used by features and operations |
| [_crossReferences.json](_crossReferences.json) | 259 types | - | 23 KB | Global type→module lookup map |

## JSON Schema

Each JSON category file follows this structure:

```json
{
  "featureScriptDocs": "1.0",
  "info": { "title": "...", "description": "...", "sourceVersion": "2026.01" },
  "category": "CategoryName",
  "modules": {
    "moduleName.fs": {
      "name": "moduleName",
      "importPath": "onshape/std/moduleName.fs",
      "description": "...",
      "symbols": [
        {
          "name": "functionName",
          "kind": "function",       // function | type | enum | predicate | const
          "id": "functionName-Type1-Type2",
          "signature": "(param1 is Type1, param2 is Type2)",
          "returnType": "ReturnType",
          "description": "...",
          "parameters": [
            {
              "name": "param",
              "type": "map",
              "typeRef": "builtin:map",
              "required": true,
              "requiredIf": null,
              "description": "...",
              "subfields": [
                { "name": "field", "type": "Query", "typeRef": "#Query", ... }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### Symbol Kinds

| Kind | Description | Has signature? | Has parameters? | Has values? |
|------|-------------|---------------|-----------------|-------------|
| `function` | Regular function | Yes | Yes (if `definition is map`) | No |
| `type` | Custom type definition | No | May have fields table | No |
| `enum` | Enumeration | No | No | Yes |
| `predicate` | Type-check predicate | Yes | No | No |
| `const` | Constant value | No | No | No |

## Quick-Start Template

Minimal working feature:

```javascript
FeatureScript 2026; // Use current version
import(path : "onshape/std/geometry.fs", version : "2026.0");

annotation { "Feature Type Name" : "My Feature" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Faces to select" }
        definition.faces is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);
    }
    {
        // Feature body — call operations here
        opExtrude(context, id + "extrude1", {
                "entities" : definition.faces,
                "direction" : evOwnerSketchPlane(context, { "entity" : definition.faces }).normal,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth
        });
    });
```

**Key points:**
- `FeatureScript YYYY;` header with version year
- Import `geometry.fs` for access to the full Standard Library
- `annotation { "Feature Type Name" : "..." }` marks it as a feature
- `export const` makes it available in the Part Studio
- `defineFeature` wraps the function with context, id, definition
- `precondition { }` defines UI parameters
- Feature body calls `op*` functions for geometry operations
