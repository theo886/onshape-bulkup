# FeatureScript Modeling Guide

How geometry works in FeatureScript -- Context, bodies, queries, operations (op*), evaluations (ev*), sketches, and primitives.

## Context

A Context is a builtin that stores all modeling data: bodies, entities, variables, feature error states. Every Part Studio uses a single Context. All features, operations, and evaluations require a context.

```javascript
// Context is always the first argument to features and operations
function myFeature(context is Context, id is Id, definition is map) { ... }
opExtrude(context, id + "ext", { ... });
evVolume(context, { "entities" : someQuery });
```

Contexts track the Standard Library version. During regeneration of "held back" features, the context reports the older version.

Data can be transferred between contexts:
```javascript
opMergeContexts(context, id + "merge", { "contextFrom" : otherContext });
```

## Bodies

Geometry is organized into independent bodies. Each body contains vertices, faces, and edges.

| Body Type | Description | Example |
|-----------|-------------|---------|
| SOLID | 3D part | Result of solid extrude |
| SHEET | 2D surface | Sketch region, surface extrude |
| WIRE | 1D curve | Sketch line, helix |
| POINT | 0D point | Sketch point, opPoint result |
| MATE_CONNECTOR | Coordinate frame | opMateConnector result |
| COMPOSITE | Container | compositePart result |

Bodies must be connected -- separate volumes cannot form a single body.

A cylinder is a solid body with no vertices, two edges, and three faces.

## Queries

Queries reference topological entities using criteria rather than direct pointers. Think of a Query as an "order form for geometry, specifying criteria that said geometry must satisfy."

```javascript
// Query all edges created by a specific operation
var edges = qCreatedBy(id + "extrude1", EntityType.EDGE);

// Query all solid bodies
var solids = qBodyType(qEverything(EntityType.BODY), BodyType.SOLID);

// Query by geometry type
var planes = qGeometry(qEverything(EntityType.FACE), GeometryType.PLANE);

// Combine queries
var combined = qUnion([query1, query2]);
var filtered = qSubtraction(allEdges, excludedEdges);
```

**Why queries are powerful**: Because queries encode criteria (not direct references), they automatically adapt when upstream features change. If an upstream feature is suppressed or modified, queries re-evaluate against the current geometry.

### Evaluating Queries
```javascript
// Get array of individual entities matching a query
var entities = evaluateQuery(context, someQuery);
println("Found " ~ size(entities) ~ " entities");

// Each entity in the array is itself a Query (a transient query)
for (var entity in entities)
{
    var volume = evVolume(context, { "entities" : entity });
}
```

### Common Query Functions
(See `Modeling.json` > `query.fs` for the full list of ~139 query functions)

| Function | Description |
|----------|-------------|
| `qCreatedBy(id, EntityType)` | Entities created by an operation |
| `qEverything(EntityType)` | All entities of a type |
| `qBodyType(query, BodyType)` | Filter by body type |
| `qGeometry(query, GeometryType)` | Filter by geometry type |
| `qUnion([q1, q2, ...])` | Union of queries |
| `qSubtraction(q1, q2)` | Subtract q2 matches from q1 |
| `qIntersection([q1, q2])` | Intersection of queries |
| `qOwnedByBody(bodyQuery, EntityType)` | Entities owned by specific bodies |
| `qSketchRegion(id)` | Sketch regions from a sketch feature |
| `qContainsPoint(query, point)` | Entities containing a point |
| `qClosestTo(query, point)` | Entity closest to a point |
| `qNthElement(query, n)` | Nth entity in query result |
| `qAdjacentFace(edgeQuery)` | Faces adjacent to edges |
| `qEdgeAdjacent(faceQuery, EdgeAdjacencyType)` | Edges adjacent to faces |
| `qVertexAdjacent(query)` | Vertices adjacent to entities |
| `qParallelPlanes(query, direction)` | Faces with normals parallel to direction |
| `qMateConnectorsOfParts(partQuery)` | Mate connectors on parts |

## Operations (op* functions)

Operations create or modify geometry in the context. They take `context`, `id`, and a definition map.

### Common Operations
(See `Modeling.json` > `geomOperations.fs` for full list of ~62 operations)

| Operation | Description |
|-----------|-------------|
| `opExtrude(context, id, {...})` | Extrude faces/edges |
| `opRevolve(context, id, {...})` | Revolve around axis |
| `opLoft(context, id, {...})` | Loft between profiles |
| `opSweep(context, id, {...})` | Sweep along path |
| `opFillet(context, id, {...})` | Fillet edges |
| `opChamfer(context, id, {...})` | Chamfer edges |
| `opBoolean(context, id, {...})` | Union/subtract/intersect bodies |
| `opShell(context, id, {...})` | Shell (hollow) a body |
| `opDraft(context, id, {...})` | Add draft angle to faces |
| `opPattern(context, id, {...})` | Pattern bodies/faces |
| `opTransform(context, id, {...})` | Transform (move/rotate) bodies |
| `opDeleteBodies(context, id, {...})` | Delete bodies |
| `opMateConnector(context, id, {...})` | Create mate connector |
| `opPoint(context, id, {...})` | Create a point body |
| `opHelix(context, id, {...})` | Create helix wire |
| `opPlane(context, id, {...})` | Create construction plane |
| `opSplitPart(context, id, {...})` | Split bodies with face/plane |

Example:
```javascript
opExtrude(context, id + "extrude1", {
    "entities" : qSketchRegion(id + "sketch1"),
    "direction" : evOwnerSketchPlane(context, { "entity" : qSketchRegion(id + "sketch1") }).normal,
    "endBound" : BoundingType.BLIND,
    "endDepth" : 1 * inch
});

opBoolean(context, id + "boolean1", {
    "tools" : qCreatedBy(id + "extrude1", EntityType.BODY),
    "targets" : qCreatedBy(id + "baseExtrude", EntityType.BODY),
    "operationType" : BooleanOperationType.SUBTRACTION
});
```

## Evaluations (ev* functions)

Evaluations measure geometry without modifying it. They take `context` and a specification map.

### Common Evaluations
(See `Modeling.json` > `evaluate.fs` for full list of ~50 evaluation functions)

| Evaluation | Returns | Description |
|-----------|---------|-------------|
| `evVolume(context, {...})` | ValueWithUnits | Volume of bodies |
| `evArea(context, {...})` | ValueWithUnits | Surface area |
| `evLength(context, {...})` | ValueWithUnits | Edge/wire length |
| `evDistance(context, {...})` | DistanceResult | Distance between entities |
| `evBox3d(context, {...})` | Box3d | Bounding box |
| `evVertexPoint(context, {...})` | Vector | Position of a vertex |
| `evFaceTangentPlane(context, {...})` | Plane | Tangent plane at UV on face |
| `evEdgeTangentLine(context, {...})` | Line | Tangent line at parameter on edge |
| `evPlane(context, {...})` | Plane | Plane of a planar face |
| `evLine(context, {...})` | Line | Line of a linear edge |
| `evAxis(context, {...})` | Line | Axis of cylindrical face |
| `evOwnerSketchPlane(context, {...})` | Plane | Plane of the sketch that owns entity |
| `evMateConnector(context, {...})` | CoordSystem | Coordinate system of mate connector |
| `evSurfaceDefinition(context, {...})` | various | Surface geometry definition |
| `evCurveDefinition(context, {...})` | various | Curve geometry definition |
| `evApproximateCentroid(context, {...})` | Vector | Approximate centroid |

Example:
```javascript
const box = evBox3d(context, { "topology" : qEverything(EntityType.BODY) });
const height = box.maxCorner[2] - box.minCorner[2];

const point = evVertexPoint(context, { "vertex" : qNthElement(vertices, 0) });
const plane = evPlane(context, { "face" : definition.face });
```

## Primitives

Quick ways to create simple geometry:

```javascript
// Create a box
fCuboid(context, id + "cube", {
    "corner1" : vector(0, 0, 0) * inch,
    "corner2" : vector(1, 1, 1) * inch
});

// Create a cylinder
fCylinder(context, id + "cyl", {
    "topCenter" : vector(0, 0, 1) * inch,
    "bottomCenter" : vector(0, 0, 0) * inch,
    "radius" : 0.5 * inch
});
```

See `Modeling.json` > `primitives.fs` for all primitive functions.

## Sketches

Create 2D geometry to use as profiles for operations:

```javascript
// Create sketch on a plane
var sketch1 = newSketchOnPlane(context, id + "sketch1", {
    "sketchPlane" : plane(vector(0, 0, 0) * inch, vector(0, 0, 1))
});

// Or on an existing face
var sketch2 = newSketch(context, id + "sketch2", {
    "sketchPlane" : qCreatedBy(makeId("Top"), EntityType.FACE)
});

// Add sketch entities
skLineSegment(sketch1, "line1", {
    "start" : vector(0, 0) * inch,
    "end" : vector(1, 0) * inch
});
skCircle(sketch1, "circle1", {
    "center" : vector(0.5, 0.5) * inch,
    "radius" : 0.25 * inch
});
skRectangle(sketch1, "rect1", {
    "firstCorner" : vector(0, 0) * inch,
    "secondCorner" : vector(2, 1) * inch
});
skArc(sketch1, "arc1", {
    "start" : vector(0, 0) * inch,
    "mid" : vector(0.5, 0.5) * inch,
    "end" : vector(1, 0) * inch
});

// Solve constraints and create geometry
skSolve(sketch1);

// Use sketch regions in operations
opExtrude(context, id + "ext", {
    "entities" : qSketchRegion(id + "sketch1"),
    "direction" : evOwnerSketchPlane(context, { "entity" : qSketchRegion(id + "sketch1") }).normal,
    "endBound" : BoundingType.BLIND,
    "endDepth" : 0.5 * inch
});
```

FeatureScript sketches often don't need constraints because you can calculate exact coordinates in code.

Common sketch functions (See `Modeling.json` > `sketch.fs`):
- `skLineSegment`, `skCircle`, `skArc`, `skEllipse`
- `skRectangle`, `skRegularPolygon`
- `skFitSpline`, `skText`, `skImage`
- `skConstraint` (for when constraints are needed)
- `skSolve` (required to finalize sketch)

## Geometric Types

For computation (not stored in context):

| Type | Description |
|------|-------------|
| `Vector` | 2D or 3D point/direction with units |
| `Line` | Point + direction |
| `Plane` | Point + normal (+ optional x-axis) |
| `CoordSystem` | Origin + xAxis + zAxis |
| `Transform` | Rigid body transformation |
| `Box3d` | Axis-aligned bounding box |

```javascript
const start = vector(2, 0, 0) * inch;
const zAxis = line(vector(0, 0, 0) * inch, vector(0, 0, 1));
const end = rotationAround(zAxis, 30 * degree) * start;
```

Use `tolerantEquals` instead of `==` for comparing geometric values (floating point).

## Cross-references

- See `Modeling.json` for all operation, evaluation, query, sketch, and primitive functions
- See `Math.json` for Vector, Matrix, Transform, CoordSystem, and unit types
- See `Guide-FeatureDefinition.md` for how to structure a feature
- See `Features-SolidCreation.json` for high-level feature functions (extrude, revolve, loft, etc.)
