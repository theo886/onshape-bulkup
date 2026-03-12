# FeatureScript UI Specification Guide

How to define feature parameters and UI in FeatureScript — parameter types, annotations, UIHints, conditional visibility, manipulators, and editing logic.

This is the primary reference for AI agents building feature UIs. Every parameter a user interacts with in the feature dialog is declared in the `precondition` block of a feature function, using typed definitions and annotation maps.

---

## Table of Contents

- [Parameter Types](#parameter-types)
  - [Boolean](#boolean)
  - [String](#string)
  - [Enum](#enum)
  - [Quantities (Length, Angle, Integer, Real)](#quantities-length-angle-integer-real)
  - [Query (Geometry Selection)](#query-geometry-selection)
  - [PartStudioData (Reference Parameters)](#partstudiodata-reference-parameters)
  - [LookupTablePath](#lookuptablepath)
  - [Array Parameters](#array-parameters)
- [Parameter Groups](#parameter-groups)
- [Conditional Visibility](#conditional-visibility)
- [UIHints](#uihints)
- [Icons and Description Images](#icons-and-description-images)
- [Manipulator Change Function](#manipulator-change-function)
- [Editing Logic Function](#editing-logic-function)
- [Descriptions (Tooltips)](#descriptions-tooltips)
- [Parameter Expressions](#parameter-expressions)
- [Cross-References](#cross-references)

---

## Parameter Types

### Boolean

Checkbox by default. Can be changed to other display styles via UIHint (e.g., `UIHint.OPPOSITE_DIRECTION` for a flip arrow button).

```javascript
annotation { "Name" : "My Boolean", "Default" : true }
definition.myBoolean is boolean;
```

**Annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label in the dialog (required) |
| `"Default"` | boolean | Default value; `false` if omitted |
| `"UIHint"` | UIHint or array | Display style override (see [UIHints](#uihints)) |
| `"Description"` | string | Tooltip text |

---

### String

Text box input. Users type free-form text.

```javascript
annotation { "Name" : "My String", "Default" : "My default value" }
definition.myString is string;
```

**Annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"Default"` | string | Default value; empty string if omitted |
| `"MaxLength"` | integer | Maximum character count |
| `"MinLength"` | integer | Minimum character count |
| `"UIHint"` | UIHint or array | Display style override |
| `"Description"` | string | Tooltip text |

---

### Enum

Dropdown selector. Define a custom enum type, then reference it in the precondition. Each enum value can have its own `Name` and `Icon` annotation.

**Enum type definition (outside the feature function):**

```javascript
export enum MyOption
{
    annotation { "Name" : "Option One" }
    ONE,
    annotation { "Name" : "Option Two" }
    TWO
}
```

**Usage in precondition:**

```javascript
annotation { "Name" : "My Enum" }
definition.myEnum is MyOption;
```

**Enum parameter annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"Default"` | string | Default enum value name (e.g., `"ONE"`) |
| `"UIHint"` | UIHint or array | e.g., `UIHint.HORIZONTAL_ENUM` for tab-style |
| `"Icon"` | icon blob | Feature icon for the enum parameter itself |
| `"Description"` | string | Tooltip text |

**Enum value annotations (on individual values):**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display name for this value (required) |
| `"Icon"` | icon blob | Icon displayed next to this value |
| `"Hidden"` | boolean | If `true`, value is hidden from the UI (use for deprecated values that must remain for backward compatibility) |

---

### Quantities (Length, Angle, Integer, Real)

Quantity parameters use predicate functions with bounds specifications. The predicate function determines the parameter type and validates user input.

```javascript
annotation { "Name" : "My Length" }
isLength(definition.myLength, LENGTH_BOUNDS);

annotation { "Name" : "My Angle" }
isAngle(definition.myAngle, ANGLE_STRICT_90_BOUNDS);

annotation { "Name" : "Count" }
isInteger(definition.count, POSITIVE_COUNT_BOUNDS);

annotation { "Name" : "Scale Factor" }
isReal(definition.scaleFactor, POSITIVE_REAL_BOUNDS);
```

**Predicate functions:**
| Function | Type | Bounds Spec Type |
|----------|------|------------------|
| `isLength` | Length with units | `LengthBoundSpec` |
| `isAngle` | Angle with units | `AngleBoundSpec` |
| `isInteger` | Whole number (unitless) | `IntegerBoundSpec` |
| `isReal` | Decimal number (unitless) | `RealBoundSpec` |
| `isAnything` | Any expression | No bounds (accepts anything) |

**Custom bounds:**

Bounds format is `{ (unit) : [min, default, max] }`:

```javascript
isLength(definition.myLength, { (inch) : [ 0, 1.75, 10000 ] } as LengthBoundSpec);
```

- `min` — minimum allowed value
- `default` — value shown when the feature is first created
- `max` — maximum allowed value

**Common bounds constants** (defined in `Utilities.json` > `valueBounds.fs`):
| Constant | Type | Description |
|----------|------|-------------|
| `LENGTH_BOUNDS` | LengthBoundSpec | General length (default 1 inch) |
| `NONNEGATIVE_LENGTH_BOUNDS` | LengthBoundSpec | Length >= 0 |
| `POSITIVE_LENGTH_BOUNDS` | LengthBoundSpec | Length > 0 |
| `ANGLE_360_BOUNDS` | AngleBoundSpec | 0 to 360 degrees |
| `ANGLE_STRICT_90_BOUNDS` | AngleBoundSpec | Strictly 0 to 90 degrees |
| `POSITIVE_COUNT_BOUNDS` | IntegerBoundSpec | Integer >= 1 |
| `POSITIVE_REAL_BOUNDS` | RealBoundSpec | Real > 0 |

**Quantity annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"UIHint"` | UIHint or array | e.g., `UIHint.SHOW_EXPRESSION`, `UIHint.DISPLAY_SHORT` |
| `"Description"` | string | Tooltip text |

---

### Query (Geometry Selection)

Selects geometry from the Part Studio: vertices, edges, faces, bodies, or mate connectors. The `"Filter"` annotation restricts what geometry the user can select.

```javascript
annotation { "Name" : "Round things",
             "Filter" : (GeometryType.CIRCLE || GeometryType.ARC) && SketchObject.YES,
             "MaxNumberOfPicks" : 2 }
definition.roundThings is Query;
```

**Query annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"Filter"` | filter expression | Restricts selectable geometry (see filter enums below) |
| `"MaxNumberOfPicks"` | integer | Maximum number of selections allowed |
| `"UIHint"` | UIHint or array | Display style override |
| `"Description"` | string | Tooltip text |

**Filter expression enums** (combine with `&&`, `||`, `!`):

| Enum | Values | Description |
|------|--------|-------------|
| `BodyType` | `SOLID`, `SHEET`, `WIRE`, `POINT`, `MATE_CONNECTOR`, `COMPOSITE` | Type of body |
| `EntityType` | `BODY`, `FACE`, `EDGE`, `VERTEX` | Topological entity type |
| `GeometryType` | `PLANE`, `CYLINDER`, `CONE`, `SPHERE`, `TORUS`, `CIRCLE`, `ARC`, `LINE`, `ELLIPSE`, `SPLINE`, etc. | Geometric shape type |
| `ConstructionObject` | `YES`, `NO` | Whether entity is construction geometry |
| `SketchObject` | `YES`, `NO` | Whether entity belongs to a sketch |
| `EdgeTopology` | `ONE_SIDED`, `TWO_SIDED` | Edge adjacency (one face vs. two faces) |
| `AllowMeshGeometry` | `YES`, `NO` | Allow selection of mesh geometry |
| `AllowFlattenedGeometry` | `YES`, `NO` | Allow selection of flattened sheet metal geometry |
| `ActiveSheetMetal` | `YES`, `NO` | Restrict to active sheet metal model |
| `ModifiableEntityOnly` | `YES`, `NO` | Only allow selection of modifiable entities |
| `AllowEdgePoint` | `YES`, `NO` | Allow selection of points on edges |
| `QueryFilterCompound` | `ALLOWS_VERTEX` | Compound filter shortcuts |

**Filter expression examples:**

```javascript
// Select only planar faces
"Filter" : EntityType.FACE && GeometryType.PLANE

// Select solid or sheet bodies
"Filter" : EntityType.BODY && (BodyType.SOLID || BodyType.SHEET)

// Select non-construction sketch edges
"Filter" : SketchObject.YES && ConstructionObject.NO && EntityType.EDGE

// Select cylindrical faces or circular edges
"Filter" : GeometryType.CYLINDER || GeometryType.CIRCLE
```

---

### PartStudioData (Reference Parameters)

Reference another Part Studio tab (or external document). Allows selecting geometry from a different Part Studio.

```javascript
annotation { "Name" : "Part Studio",
             "Filter" : PartStudioItemType.SOLID || PartStudioItemType.ENTIRE_PART_STUDIO }
definition.myPartStudio is PartStudioData;
```

**PartStudioItemType values:**
`SOLID`, `SHEET`, `WIRE`, `POINT`, `MESH`, `COMPOSITE`, `SURFACE`, `MATE_CONNECTOR`, `SKETCH`, `ENTIRE_PART_STUDIO`

**PartStudioData annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"Filter"` | PartStudioItemType expression | Restricts selectable item types |
| `"ComputedConfigurationInputs"` | array of strings | Config parameter names to override in the referenced Part Studio |
| `"MaxNumberOfPicks"` | integer | Maximum number of selections |
| `"Description"` | string | Tooltip text |

**Other reference parameter types:**

These follow the same pattern as `PartStudioData` but reference different data types:

| Type | Declaration | Description |
|------|-------------|-------------|
| `ImageData` | `definition.image is ImageData;` | Image reference (PNG, JPG, SVG) |
| `TableData` | `definition.table is TableData;` | CSV table reference |
| `JSONData` | `definition.data is JSONData;` | JSON data reference |
| `TextData` | `definition.text is TextData;` | Plain text file reference |
| `CADImportData` | `definition.cad is CADImportData;` | CAD import file reference |

---

### LookupTablePath

Decision tree parameter. Presents a cascading series of dropdowns where each selection narrows the next level. The leaf values are the actual data (typically `ValueWithUnits`).

**Table definition (typically a module-level constant):**

```javascript
const sizeTable = {
    "name" : "region",
    "displayName" : "Region",
    "default" : "EU",
    "entries" : {
        "EU" : {
            "name" : "size",
            "displayName" : "Size",
            "default" : "Medium",
            "entries" : {
                "Small" : 250 * ml,
                "Medium" : 350 * ml,
                "Large" : 500 * ml
            }
        },
        "US" : {
            "name" : "size",
            "displayName" : "Size",
            "default" : "Large",
            "entries" : {
                "Medium" : 16 * oz,
                "Large" : 32 * oz
            }
        }
    }
};
```

**Usage in precondition:**

```javascript
annotation { "Name" : "Size", "Lookup Table" : sizeTable }
definition.size is LookupTablePath;
```

**Retrieving the selected value in the feature body:**

```javascript
var size is ValueWithUnits = getLookupTable(sizeTable, definition.size);
```

**Table node structure:**
| Field | Type | Description |
|-------|------|-------------|
| `"name"` | string | Internal parameter name for this level |
| `"displayName"` | string | Display label for the dropdown |
| `"default"` | string | Default selection key |
| `"entries"` | map | Keys are display names; values are either nested table nodes or leaf values |

Leaf values can be any type: `ValueWithUnits`, number, string, map, etc.

---

### Array Parameters

Repeated parameter groups. The user adds/removes items in a list. Each item has its own set of sub-parameters.

```javascript
annotation { "Name" : "Profiles",
    "Item name" : "Profile",
    "Item label template" : "Profile (#width)" }
definition.profiles is array;

for (var profile in definition.profiles)
{
    annotation { "Name" : "Width" }
    isLength(profile.width, LENGTH_BOUNDS);
    annotation { "Name" : "Make square" }
    profile.isSquare is boolean;
}
```

The resulting `definition.profiles` value is an array of maps:
```javascript
[{ "width" : 0.9 * inch, "isSquare" : false }, { "width" : 1.5 * inch, "isSquare" : true }]
```

**Array annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Name"` | string | Display label (required) |
| `"Item name"` | string | Label for the "Add" button (e.g., "Add Profile") |
| `"Item label template"` | string | Display label per item; use `#paramName` to substitute sub-parameter values |
| `"Driven query"` | string | Single inner query parameter ID for selection-driven mode (items are added by selecting geometry) |
| `"Show labels only"` | boolean | Hide add/expand controls, but allow removal |
| `"UIHint"` | UIHint or array | `UIHint.COLLAPSE_ARRAY_ITEMS`, `UIHint.MATCH_LAST_ARRAY_ITEM` |
| `"Description"` | string | Tooltip text |

**Selection-driven arrays:**

When `"Driven query"` is set, the array is populated by selecting geometry. Each selection adds a new array item. The driven query parameter must be a `Query` inside the `for` loop.

```javascript
annotation { "Name" : "Holes",
    "Item name" : "Hole",
    "Driven query" : "center" }
definition.holes is array;

for (var hole in definition.holes)
{
    annotation { "Name" : "Center", "Filter" : EntityType.VERTEX }
    hole.center is Query;

    annotation { "Name" : "Diameter" }
    isLength(hole.diameter, POSITIVE_LENGTH_BOUNDS);
}
```

---

## Parameter Groups

Group related parameters under a collapsible section header.

```javascript
annotation { "Group Name" : "My Group", "Collapsed By Default" : true }
{
    annotation { "Name" : "My Boolean" }
    definition.myBoolean is boolean;

    annotation { "Name" : "My Length" }
    isLength(definition.myLength, LENGTH_BOUNDS);
}
```

**Group annotations:**
| Annotation | Type | Description |
|------------|------|-------------|
| `"Group Name"` | string | Section header text (required) |
| `"Collapsed By Default"` | boolean | Whether the group starts collapsed; default is `true` |
| `"Driving Parameter"` | string | Parameter ID whose checkbox controls the group's visibility; the chevron appears on the same line as the parameter |

**Nested groups with a driving parameter:**

This pattern places a checkbox and the group's expand/collapse chevron on the same line. When the checkbox is unchecked, the group is hidden entirely.

```javascript
annotation { "Name" : "Additional Options" }
definition.additionalOptions is boolean;

if (definition.additionalOptions)
{
    annotation { "Group Name" : "Options", "Collapsed By Default" : false,
                 "Driving Parameter" : "additionalOptions" }
    {
        annotation { "Name" : "Option" }
        definition.option is string;
    }
}
```

---

## Conditional Visibility

Show or hide parameters based on the current values of other parameters. Implemented with `if` statements inside the `precondition` block.

```javascript
precondition
{
    annotation { "Name" : "Use custom length" }
    definition.useCustomLength is boolean;

    if (definition.useCustomLength)
    {
        annotation { "Name" : "Custom Length" }
        isLength(definition.customLength, LENGTH_BOUNDS);
    }

    annotation { "Name" : "Mode" }
    definition.mode is MyEnum;

    if (definition.mode == MyEnum.ADVANCED)
    {
        annotation { "Name" : "Advanced Param" }
        definition.advancedParam is boolean;
    }
}
```

**Rules for conditional visibility:**

1. **Conditions can only reference boolean or enum parameters** — compare using `==` or `!=` against fixed values.
2. **Logical operators are supported** — `&&`, `||`, `!` can combine conditions.
3. **Nesting is allowed** — `if` statements can be nested inside other `if` statements.
4. **A parameter can only appear ONCE per feature** — you cannot declare the same parameter ID in multiple branches. If you need different behavior in different modes, use a single parameter and handle the logic in the feature body.
5. **The condition parameter must be declared before the conditional block** — forward references are not allowed.

**Examples of valid conditions:**

```javascript
// Boolean condition
if (definition.useAdvanced)

// Enum equality
if (definition.mode == MyEnum.OPTION_A)

// Enum inequality
if (definition.mode != MyEnum.OPTION_A)

// Compound conditions
if (definition.useAdvanced && definition.mode == MyEnum.OPTION_A)

// Negation
if (!definition.useSimple)

// Nested conditions
if (definition.mode == MyEnum.ADVANCED)
{
    if (definition.showExtra)
    {
        // ...
    }
}
```

---

## UIHints

UIHints modify how a parameter is displayed in the feature dialog. Apply them via the `"UIHint"` annotation, either as a single value or an array of values.

```javascript
// Single UIHint
annotation { "Name" : "Flip", "UIHint" : UIHint.OPPOSITE_DIRECTION }
definition.isFlipped is boolean;

// Multiple UIHints
annotation { "Name" : "X", "UIHint" : [UIHint.OPPOSITE_DIRECTION, UIHint.REMEMBER_PREVIOUS_VALUE] }
definition.x is boolean;
```

**Complete UIHint reference:**

| UIHint | Applies To | Description |
|--------|-----------|-------------|
| `UIHint.ALWAYS_HIDDEN` | Any | Parameter never shows in the dialog. Use for internal parameters that are set programmatically (e.g., by editing logic or manipulators). |
| `UIHint.OPPOSITE_DIRECTION` | Boolean | Displays as a flip-direction arrow button instead of a checkbox. Commonly used for direction toggles. |
| `UIHint.OPPOSITE_DIRECTION_CIRCULAR` | Boolean | Displays as a circular flip-direction arrow button. |
| `UIHint.REMEMBER_PREVIOUS_VALUE` | Any | The parameter's value persists between consecutive uses of the feature. When the user creates a new instance, the value from the last use is pre-filled. |
| `UIHint.HORIZONTAL_ENUM` | Enum | Displays enum values as a horizontal tab bar instead of a dropdown. Best for enums with 2-4 short-named values. |
| `UIHint.NO_PREVIEW_PROVIDED` | Feature-level | Tells the system not to compute a preview for this feature. Use for features that are expensive or where preview is meaningless. |
| `UIHint.COLLAPSE_ARRAY_ITEMS` | Array | Array items are collapsed by default. The user expands them individually. |
| `UIHint.MATCH_LAST_ARRAY_ITEM` | Array | When a new array item is added, its values are copied from the last existing item instead of using defaults. |
| `UIHint.SHOW_EXPRESSION` | Quantity | Shows the expression input field alongside the value field. Allows users to enter formulas. |
| `UIHint.DISPLAY_SHORT` | Quantity, String | Makes the parameter field narrower. Useful for placing parameters side-by-side or for small numeric inputs. |
| `UIHint.PRIMARY_AXIS` | Quantity | Marks this parameter as the primary axis for a body. Used by the system for certain geometric operations. |
| `UIHint.UNCONFIGURABLE` | Any | Prevents this parameter from being exposed in the configuration dialog. The parameter cannot be driven by a configuration variable. |
| `UIHint.SHOW_CREATE_SELECTION` | Query | Shows a "Create selection" option. |
| `UIHint.PREVENT_CREATING_NEW_MATE_CONNECTORS` | Query | Prevents the user from creating new mate connectors inline. |
| `UIHint.INITIAL_FOCUS` | Query | This parameter receives focus when the dialog opens. Only one parameter per feature should have this. |
| `UIHint.READ_ONLY` | Any | Parameter is displayed but cannot be edited by the user. |

See `Enums.json` > `uihint.gen.fs` for the full, authoritative list of all UIHint values.

---

## Icons and Description Images

### Feature Icons (SVG)

Feature icons appear in the toolbar and feature list. They must be SVG format, imported as blob data from a tab in the same document.

```javascript
IconNamespace::import(path : "tabId", version : "...");

annotation { "Feature Type Name" : "MyFeature", "Icon" : IconNamespace::BLOB_DATA }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    // ...
```

**Requirements:**
- Must be SVG format
- Recommended size: 24x24 px viewBox
- Import uses the tab ID (found in the URL when viewing the tab)

### Enum Value Icons

Individual enum values can have icons, displayed in the dropdown or horizontal enum tabs.

```javascript
export enum AxisEnum {
    annotation { "Name" : "Along X", "Icon" : Icon.ALONG_X }
    ALONG_X,
    annotation { "Name" : "Along Y", "Icon" : Icon.ALONG_Y }
    ALONG_Y,
    annotation { "Name" : "Along Z", "Icon" : Icon.ALONG_Z }
    ALONG_Z
}
```

**Standard library icons** (from `Icon` enum): `Icon.ALONG_X`, `Icon.ALONG_Y`, `Icon.ALONG_Z`, and many more. See `Enums.json` > `icon.gen.fs` for the full list.

### Description Images

A description image appears at the top of the feature dialog, providing a visual reference for how the feature works. Typically a diagram showing parameter meanings.

```javascript
ImageNamespace::import(path : "tabId", version : "...");

annotation { "Feature Type Name" : "MyFeature",
             "Description Image" : ImageNamespace::BLOB_DATA }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    // ...
```

**Requirements:**
- Optimal size: approximately 300x300 pixels
- Supported formats: JPG, PNG, SVG
- Import uses the tab ID, same as icon imports

---

## Manipulator Change Function

Manipulators allow users to interactively drag geometry in the 3D view to change parameter values. The manipulator change function translates manipulator movements back into definition updates.

### Declaration

Declare the manipulator change function in the feature annotation:

```javascript
annotation { "Feature Type Name" : "My Feature",
             "Manipulator Change Function" : "onManipulatorChange" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);
    }
    {
        // Add manipulator in the feature body
        addManipulators(context, id, {
            "depthManipulator" : linearManipulator({
                "base" : vector(0, 0, 0) * meter,
                "direction" : vector(0, 0, 1),
                "offset" : definition.depth,
                "primaryParameterId" : "depth"
            })
        });

        // ... rest of feature body
    });
```

### Function Signature

```javascript
export function onManipulatorChange(context is Context, definition is map,
                                     newManipulators is map) returns map
{
    if (newManipulators["depthManipulator"] is map)
    {
        definition.depth = newManipulators["depthManipulator"].offset;
    }
    return definition;
}
```

**Arguments:**
| Argument | Type | Description |
|----------|------|-------------|
| `context` | Context | The Part Studio context |
| `definition` | map | Current feature definition |
| `newManipulators` | map | Map with one entry: key is manipulator ID, value is updated Manipulator |

**Return:** Modified `definition` map with updated parameter values.

### Manipulator Types and Properties

| Manipulator Type | Key Property | Value Type | Description |
|------------------|-------------|------------|-------------|
| `LINEAR_1D` | `offset` | `ValueWithUnits` | Linear drag along one axis |
| `LINEAR_3D` (triad) | `offset` | `ValueWithUnits` | Linear drag along any axis |
| `ANGULAR` | `angle` | `ValueWithUnits` | Rotational drag |
| `FLIP` | `flipped` | `boolean` | Click-to-flip toggle |
| `TRIAD_FULL` | `transform` | `Transform` | Full 3D position and orientation |

### What the Return Value Can Set

The returned definition map can set:
- Boolean values
- String values
- Enum values
- Query values
- LookupTablePath values
- Quantity values (`ValueWithUnits` or string like `"3/8 in"`)

See `Utilities.json` > `manipulator.fs` for all manipulator creation functions (`linearManipulator`, `angularManipulator`, `flipManipulator`, `triadManipulator`, etc.).

---

## Editing Logic Function

The editing logic function is called whenever the feature definition changes in the dialog. It allows one parameter change to automatically update other parameters (e.g., toggling a mode resets dependent values).

### Declaration

```javascript
annotation { "Feature Type Name" : "My Feature",
             "Editing Logic Function" : "onFeatureChange" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    // ...
```

### Function Signature

The function has several optional trailing arguments. You must maintain argument order but can omit later ones.

**Minimal signature:**
```javascript
export function onFeatureChange(context is Context, id is Id, oldDefinition is map,
                                definition is map) returns map
```

**Full signature with all optional arguments:**
```javascript
export function onFeatureChange(context is Context, id is Id, oldDefinition is map,
                                definition is map, isCreating is boolean,
                                specifiedParameters is map, hiddenBodies is Query,
                                clickedButton is string) returns map
{
    if (oldDefinition.mode != definition.mode)
    {
        // React to mode change — recompute a dependent default
        definition.someParam = computeDefault(context, definition);
    }
    return definition;
}
```

### Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `context` | Context | Yes | Part Studio context, rolled back to the state immediately prior to this feature. The context is discarded after the function returns. |
| `id` | Id | Yes | Feature ID |
| `oldDefinition` | map | Yes | The definition before the current change |
| `definition` | map | Yes | The definition after the current change |
| `isCreating` | boolean | No | `true` if the feature is being created, `false` if being edited. **Important:** If this argument is omitted, the function is only called during feature creation, not during editing. |
| `specifiedParameters` | map | No | Map of parameter IDs to `true` for every parameter the user has explicitly set since the dialog opened. Useful for distinguishing user-set values from defaults. |
| `hiddenBodies` | Query | No | Query of bodies the user has hidden in the Part Studio. |
| `clickedButton` | string | No | Parameter ID of a button parameter that was clicked to trigger this call. Empty string if no button was clicked. |

### Return Value

Returns a modified `definition` map. Same rules as the manipulator change function — can set boolean, string, enum, Query, LookupTablePath, or quantity values.

### Important Behavior Notes

1. **Context is rolled back** — The `context` argument represents the state just before this feature executes. Any queries you run against it will not include this feature's effects.
2. **Omitting `isCreating`** — If you omit the `isCreating` parameter, the editing logic function is only called when the feature is first being created, not when the user later edits it.
3. **Avoid infinite loops** — Do not unconditionally set parameter values that will trigger another editing logic call. Check `oldDefinition` vs `definition` to only react to actual changes.
4. **specifiedParameters usage** — Check `specifiedParameters["myParam"] == true` to know if the user explicitly set a parameter. This prevents the editing logic from overwriting user choices.

**Example with specifiedParameters:**

```javascript
export function onFeatureChange(context is Context, id is Id, oldDefinition is map,
                                definition is map, isCreating is boolean,
                                specifiedParameters is map) returns map
{
    // Only auto-set depth if the user hasn't manually specified it
    if (!specifiedParameters["depth"] && oldDefinition.mode != definition.mode)
    {
        definition.depth = getDefaultDepthForMode(definition.mode);
    }
    return definition;
}
```

---

## Descriptions (Tooltips)

Add tooltip text to any parameter using the `"Description"` annotation. Tooltips appear when the user hovers over the parameter label.

```javascript
annotation { "Name" : "Slot length",
             "Description" : "Distance from the slot's end to its furthest extent" }
isLength(definition.slotLength, LENGTH_BOUNDS);
```

**Formatting:**
- Supports basic HTML tags: `<br>`, `<b>`, `<i>`
- Use `~` (tilde) to split long strings across multiple lines in the source code without inserting line breaks in the output

```javascript
annotation { "Name" : "Complex Param",
             "Description" : "This is a long description that spans " ~
                             "multiple lines in the source code but " ~
                             "appears as a single paragraph in the tooltip." }
definition.complexParam is boolean;
```

**HTML example:**

```javascript
annotation { "Name" : "Mode",
             "Description" : "<b>Fast mode:</b> Prioritizes speed.<br>" ~
                             "<b>Accurate mode:</b> Prioritizes precision." }
definition.mode is MyEnum;
```

---

## Parameter Expressions

Users can enter mathematical expressions for any quantity parameter. Expressions are evaluated at runtime.

**Literal values:**
```
6
22/7 mm
3.14159
```

**Arithmetic and functions:**
```
sqrt(1 + sin(61deg)) / 8
abs(-5 inch)
ceil(3.2)
floor(3.8)
min(#a, #b)
max(#a, #b)
```

**Variable references (with `#` prefix):**
```
#myWidth + 2 inches
#totalLength / 3
```
Variables reference other parameters or configuration variables by name.

**Array indexing:**
```
[3, 1, 4][#index]
```

**Ternary expressions:**
```
(#myNum % 2 == 0) ? #myNum / 2 : 3 * #myNum + 1
```

**Unit conversions:**
Expressions can mix units as long as the result is compatible with the parameter type:
```
1 inch + 25.4 mm       // Valid: both are lengths
90 deg - atan(3/4)      // Valid: both are angles
```

---

## Cross-References

| Topic | Location |
|-------|----------|
| Feature structure (precondition, body, annotation) | `Guide-FeatureDefinition.md` |
| FeatureScript language syntax | `Guide-Language.md` |
| All bounds constants | `Utilities.json` > `valueBounds.fs` |
| Manipulator creation functions | `Utilities.json` > `manipulator.fs` |
| All UIHint values | `Enums.json` > `uihint.gen.fs` |
| All Icon values | `Enums.json` > `icon.gen.fs` |
| Filter enum definitions | `Enums.json` |
| Standard features (usage examples) | `Features-*.json` files |
