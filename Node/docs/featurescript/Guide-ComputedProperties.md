# Guide-ComputedProperties.md

How to define computed part properties in FeatureScript — defineComputedPartProperty, return types, data access, testing, and deployment.

## Overview

Computed part properties calculate property values using FeatureScript functions. They appear wherever part properties are available: BOMs, drawings, property panels.

## Defining a Computed Property

```javascript
FeatureScript 2026;
import(path : "onshape/std/common.fs", version : "2026.0");

annotation { "Property Function Name" : "computeVolume" }
export const computeVolume = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns ValueWithUnits
    {
        return evVolume(context, { "entities" : part });
    });
```

Key elements:
- `annotation { "Property Function Name" : "..." }` — required, identifies this as a property function
- `defineComputedPartProperty` — wrapper function (like `defineFeature` for features)
- `context is Context` — the Part Studio's modeling context
- `part is Query` — query for the specific part being evaluated
- `definition is map` — parameter values (if any defined in precondition)

**Performance note**: Import `common.fs` instead of `geometry.fs` for computed properties. Importing the full Standard Library is discouraged for performance reasons.

## Valid Return Types

The function must declare one of these return types:

| Return Type | Property Type in Settings |
|-------------|--------------------------|
| `string` | Text |
| `number` | Double |
| `boolean` | Boolean |
| `ValueWithUnits` | Value with units |

```javascript
// String return
annotation { "Property Function Name" : "getMaterial" }
export const getMaterial = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns string
    {
        return "Steel";
    });

// Number return
annotation { "Property Function Name" : "getFaceCount" }
export const getFaceCount = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns number
    {
        return size(evaluateQuery(context, qOwnedByBody(part, EntityType.FACE)));
    });

// Boolean return
annotation { "Property Function Name" : "isSmall" }
export const isSmall = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns boolean
    {
        return evVolume(context, { "entities" : part }) < 1 * inch^3;
    });
```

## Data Access

Property functions can access:
- **Part geometry** — via queries and evaluation functions (evVolume, evArea, evBox3d, etc.)
- **Part attributes** — custom attributes set by features
- **Non-computed properties** — via `getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME })`
- **Standard Library functions** — math, string manipulation, etc.

**Limitation**: Computed properties CANNOT read other computed properties via `getProperty()`. They can, however, call other regular functions.

```javascript
annotation { "Property Function Name" : "computeDensity" }
export const computeDensity = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns ValueWithUnits
    {
        const volume = evVolume(context, { "entities" : part });
        const name = getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME });

        // Call a helper function
        const density = lookupDensity(name);
        return density;
    });

function lookupDensity(materialName is string) returns ValueWithUnits
{
    if (materialName == "Steel")
        return 7850 * kilogram / meter^3;
    return 1000 * kilogram / meter^3; // default
}
```

## Parameters (Optional)

Computed properties can have input parameters, defined in a precondition:

```javascript
annotation { "Property Function Name" : "computeWeight" }
export const computeWeight = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns ValueWithUnits
    precondition
    {
        annotation { "Name" : "Material density" }
        isReal(definition.density, POSITIVE_REAL_BOUNDS);
    }
    {
        const volume = evVolume(context, { "entities" : part });
        return volume * definition.density * kilogram / meter^3;
    });
```

## Error Handling

Runtime errors in computed property functions are NOT visible to users viewing the properties (only visible during testing). Therefore:

- **Do not throw errors** inside property functions
- Use `try` / `try silent` to handle potential failures gracefully
- Return a sensible default or empty value on error

```javascript
annotation { "Property Function Name" : "safeVolume" }
export const safeVolume = defineComputedPartProperty(
    function(context is Context, part is Query, definition is map) returns string
    {
        const volume = try silent (evVolume(context, { "entities" : part }));
        if (volume == undefined)
            return "N/A";
        return toString(roundToPrecision(volume / inch^3, 3)) ~ " in³";
    });
```

## Testing

Test computed properties in the same workspace where they're defined:

1. Create parts in a Part Studio
2. Select the computed property from the custom tables tab
3. Check the FeatureScript notices panel for errors
4. Use `println()` for debug output during testing

## Deployment

1. **Commit** the Feature Studio containing the property function
2. **Create a document version** — property functions are versioned by document version
3. In **company settings**, configure the custom property:
   - Property type: Text, Double, Boolean, or Value with units (must match return type)
   - Categories: must include "Part"
   - Property must be active
   - Select the property function by: document → version → Feature Studio → function name

## Usage

Once deployed, computed properties appear:
- In the **Properties panel** with an "_f_" indicator
- In **Bills of Materials** (add via "Add column" dropdown)
- In **Drawings** (property references)
- In **Configured properties** tables

Users can override computed values via the "Override" checkbox (if configured to allow overrides).

**Performance note**: Adding computed properties to BOMs increases table display time if previously computed values are not cached.

Cross-references:
- See `Utilities.json` > `computedPartProperty.fs` for defineComputedPartProperty
- See `Utilities.json` > `properties.fs` for getProperty and PropertyType
- See `Modeling.json` > `evaluate.fs` for evaluation functions (evVolume, evArea, etc.)
