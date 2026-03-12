# Guide-Tables.md

How to define custom tables in FeatureScript — defineTable, columns, rows, cell types, parameters, and cross-highlighting.

## Overview

Custom tables display computed data in Part Studios. Table types are defined in Feature Studios and can be used in any Part Studio as read-only displays.

## Defining a Table

```javascript
FeatureScript 2026;
import(path : "onshape/std/geometry.fs", version : "2026.0");

annotation { "Table Type Name" : "Part volumes" }
export const partVolumes = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
        // Optional parameters (see Table Parameters below)
    }
    {
        // Define columns
        var columns = [
            tableColumnDefinition("name", "Part name"),
            tableColumnDefinition("volume", "Volume")
        ];

        // Build rows
        var rows = [];
        var parts = evaluateQuery(context, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID));
        for (var part in parts)
        {
            var partName = getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME });
            var volume = evVolume(context, { "entities" : part });
            rows = append(rows, tableRow({ "name" : partName, "volume" : volume }));
        }

        return table("Part volumes", columns, rows);
    });
```

The annotation `{ "Table Type Name" : "..." }` is required. The function receives `context` and `definition`, and returns a `Table` or `TableArray`.

## Column Definitions

```javascript
var columns = [
    tableColumnDefinition("id", "Column Header"),
    tableColumnDefinition("id2", "Another Column")
];
```
Arguments: internal ID string, user-visible column name.

Column names can also be ValueWithUnits or TemplateString.

## Row Construction

```javascript
var row = tableRow({ "columnId" : cellValue, "columnId2" : cellValue2 });
rows = append(rows, row);
```

The map keys must match column IDs from `tableColumnDefinition`.

## Cell Value Types

| Type | Display | Example |
|------|---------|---------|
| `string` | As-is | `"Steel"` |
| `ValueWithUnits` | With user's document units/precision | `evVolume(context, {...})` |
| `TemplateString` | Formatted text with embedded values | `templateString("diam = #d", { "d" : diameter })` |
| `TableCellError` | Red background error cell | `tableCellError("bad value", "tooltip text")` |

```javascript
// TemplateString example
var cell = templateString("Total: #v", { "v" : totalVolume });

// Error cell example
var cell = tableCellError("N/A", "Could not compute volume");
```

## Table Parameters

Tables can have input parameters like features, limited to booleans, strings, enums, and quantities:

```javascript
annotation { "Table Type Name" : "Fillet analysis" }
export const filletAnalysis = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
        annotation { "Name" : "Minimum fillet radius" }
        isLength(definition.minimumFilletRadius, NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS);

        annotation { "Name" : "Show warnings" }
        definition.showWarnings is boolean;
    }
    {
        // Use definition.minimumFilletRadius and definition.showWarnings
        // to filter/compute table data
        ...
    });
```

Tables automatically recompute when parameters change.

## Cross-Highlighting

Rows and columns can highlight entities when hovered:

```javascript
// Row with entity highlighting
rows = append(rows, tableRow({ "name" : partName, "volume" : volume },
    { "entities" : partQuery }));  // Second arg is options map with entities

// Column with entity highlighting
tableColumnDefinition("col", "Header", { "entities" : someQuery });
```

When a user hovers over a cell, the associated entities highlight in the Part Studio.

## Returning Multiple Tables

Return a `TableArray` for multiple tables:

```javascript
return tableArray([table1, table2, table3]);
```

## Debugging Tables

Print tables to the console:
```javascript
println(table("Debug", columns, rows));
```

## Data Access

Table functions have access to:
- Part Studio geometry via queries and evaluations
- Variables via `getVariable(context, "name")`
- Part properties via `getProperty(context, { "entity" : query, "propertyType" : PropertyType.NAME })`
- Custom attributes set by features
- All Standard Library functions

## Complete Example

```javascript
FeatureScript 2026;
import(path : "onshape/std/geometry.fs", version : "2026.0");

annotation { "Table Type Name" : "Edge lengths" }
export const edgeLengths = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
        annotation { "Name" : "Minimum length" }
        isLength(definition.minLength, NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        var columns = [
            tableColumnDefinition("index", "#"),
            tableColumnDefinition("length", "Length"),
            tableColumnDefinition("status", "Status")
        ];

        var edges = evaluateQuery(context, qEverything(EntityType.EDGE));
        var rows = [];
        var idx = 0;
        for (var edge in edges)
        {
            var len = evLength(context, { "entities" : edge });
            var status = len < definition.minLength ? tableCellError("SHORT", "Below minimum") : "OK";
            rows = append(rows, tableRow({ "index" : idx, "length" : len, "status" : status }));
            idx += 1;
        }

        return table("Edge lengths", columns, rows);
    });
```

Cross-references:
- See `Utilities.json` > `table.fs` for all table functions (tableColumnDefinition, tableRow, table, TableArray, etc.)
- See `Utilities.json` > `templatestring.fs` for TemplateString
- See `Utilities.json` > `properties.fs` for getProperty and PropertyType
