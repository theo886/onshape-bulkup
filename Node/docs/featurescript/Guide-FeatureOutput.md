# Guide-FeatureOutput.md

How to debug, report errors, and profile FeatureScript features — print, debug, error reporting, and performance tools.

## Print and Println

Output information to the FeatureScript notices flyout:
```javascript
print("Value: ");
println(myVariable);        // Uses toString() for type conversion
println("Count: " ~ count); // ~ concatenates strings
```
`println` adds a newline; `print` does not. Any value can be passed to these functions. Output appears in the FeatureScript notices panel.

## Debug Function

Visualize geometry while the feature dialog is open:
```javascript
// Highlight entities matching a query
debug(context, qCreatedBy(id + "extrude1", EntityType.EDGE));

// Display geometric types
debug(context, myLine);    // Shows a Line
debug(context, myVector);  // Shows a Vector
debug(context, myPlane);   // Shows a Plane
```
**Important**: Debug output is only visible while the feature dialog is open. It does not persist.

Debug accepts:
- Query objects — highlights matching entities in the Part Studio
- Geometric types (Line, Vector, Plane, CoordSystem) — displays visual representation

See `Utilities.json` > `debug.fs` for all debug functions including `addDebugEntities`, `debug` overloads for different types, and `DebugColor` enum.

## Error Reporting

Three severity levels:

### Info (blue bubble, feature stays green)
```javascript
reportFeatureInfo(context, id, "Operation completed successfully");
```

### Warning (blue bubble, feature turns yellow)
```javascript
reportFeatureWarning(context, id, "Volume is below recommended threshold");
```

### Error (reverts all context changes, feature turns red)
```javascript
throw regenError("Cannot create feature: no valid faces selected");

// With an ErrorStringEnum for localized messages
throw regenError(ErrorStringEnum.TOO_MANY_ENTITIES_SELECTED);

// With entity highlighting
throw regenError("Edge too short", ["entities" : shortEdge]);
```

### Error Handling Patterns

**Catch and rethrow with better message:**
```javascript
try
{
    opFillet(context, id + "fillet", {
        "entities" : definition.edges,
        "radius" : definition.radius
    });
}
catch (error)
{
    throw regenError("Fillet failed — try a smaller radius", ["entities" : definition.edges]);
}
```

**Partial success with warning:**
```javascript
var failCount = 0;
for (var i = 0; i < size(items); i += 1)
{
    try
    {
        opFillet(context, id + ("fillet" ~ i), {
            "entities" : items[i],
            "radius" : definition.radius
        });
    }
    catch
    {
        failCount += 1;
    }
}
if (failCount > 0)
    reportFeatureWarning(context, id, failCount ~ " items could not be filleted");
```

**Use `try silent` for expected failures:**
```javascript
var plane = try silent (evPlane(context, { "face" : definition.face }));
if (plane == undefined)
{
    // Face is not planar, use alternative approach
}
```

### Error Reporting Functions
(See `Utilities.json` > `error.fs` for full list)

| Function | Effect |
|----------|--------|
| `reportFeatureInfo(context, id, message)` | Blue info bubble |
| `reportFeatureWarning(context, id, message)` | Yellow warning, marks feature |
| `regenError(message)` | Creates error to throw (reverts changes) |
| `regenError(message, entities)` | Error with entity highlighting |
| `reportFeatureStatus(context, id, {...})` | General status reporting |

## Performance Profiling

Measure execution time with timers:
```javascript
startTimer("myOperation");
// ... expensive operations ...
printTimer("myOperation"); // Prints elapsed time in ms

// Multiple named timers can run simultaneously
startTimer("phase1");
// ... phase 1 ...
printTimer("phase1");
startTimer("phase2");
// ... phase 2 ...
printTimer("phase2");
```

## Debugging Workflow

### Analysis vs Execution
- **Analysis** runs automatically as you type in Feature Studios (static checks — parse errors, semantic warnings, undefined variables). Relates to current text, not committed version.
- **Execution** happens in Part Studios when features regenerate (runtime). Only runs on committed code.

### Monitoring Part Studios
To see execution info (print output, debug visualization, runtime errors) while editing code:
1. Select "Monitor [Part Studio name]" from the Feature Studio toolbar
2. The Part Studio re-executes whenever code is committed
3. Type-check warnings appear only when monitoring is active

### Profiling
Access profiling from any Part Studio. Shows:
- Call counts for each code line
- Total execution time per line
- Color coding: red = slow, yellow = fast
- Summary of total regeneration time

### Filtering Notices
Use filter syntax:
- `:text keyword` — filter by notice text
- `:tabname "Part Studio 1"` — filter by tab
- `:currenttab` — show only current tab
- `:minlevel error` — filter by severity (info, warn, error)

## Performance Tips
- Avoid importing more modules than needed (warning at 600+ modules)
- Use `common.fs` instead of `geometry.fs` when you don't need all features
- Profile before optimizing — use startTimer/printTimer
- Minimize evaluateQuery calls in loops (evaluate once, iterate the array)

Cross-references:
- See `Utilities.json` > `debug.fs` for debug functions and DebugColor enum
- See `Utilities.json` > `error.fs` for error reporting functions and ErrorStringEnum
- See `Utilities.json` > `feature.fs` for reportFeatureInfo, reportFeatureWarning
