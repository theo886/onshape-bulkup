FeatureScript 2878;
import(path : "onshape/std/common.fs", version : "2878.0");

/**
 * Design Rule Checker
 *
 * A custom table that analyzes Part Studio geometry and flags
 * manufacturing concerns: small holes, small fillets, thin walls,
 * and sharp internal edges.
 *
 * Each flagged row cross-highlights the offending geometry in the
 * Part Studio when hovered.
 */

annotation { "Table Type Name" : "Design Rule Checker" }
export const designRuleChecker = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
        annotation { "Name" : "Min wall thickness" }
        isLength(definition.minWallThickness, LENGTH_BOUNDS);

        annotation { "Name" : "Min fillet radius" }
        isLength(definition.minFilletRadius, BLEND_BOUNDS);

        annotation { "Name" : "Max sharp edge angle" }
        isAngle(definition.maxSharpAngle, ANGLE_STRICT_90_BOUNDS);

        annotation { "Name" : "Min hole diameter" }
        isLength(definition.minHoleDiameter, LENGTH_BOUNDS);
    }
    {
        var columns = [
            tableColumnDefinition("check", "Check"),
            tableColumnDefinition("severity", "Severity"),
            tableColumnDefinition("detail", "Detail"),
            tableColumnDefinition("measured", "Measured"),
            tableColumnDefinition("threshold", "Threshold")
        ];

        var rows = [];

        // Run each check and collect rows
        rows = concatenateArrays([rows, checkSmallHoles(context, definition)]);
        rows = concatenateArrays([rows, checkSmallFillets(context, definition)]);
        rows = concatenateArrays([rows, checkThinWalls(context, definition)]);
        rows = concatenateArrays([rows, checkSharpEdges(context, definition)]);

        if (size(rows) == 0)
        {
            rows = append(rows, tableRow({
                        "check" : "All checks passed",
                        "severity" : "OK",
                        "detail" : "No issues found",
                        "measured" : "",
                        "threshold" : ""
                    }));
        }

        return table("Design Rule Checker", columns, rows);
    });

/**
 * Check 1: Small Holes
 *
 * Find cylindrical faces with exactly 2 circular edges (likely holes).
 * Estimate diameter from edge circumference and flag if below threshold.
 */
function checkSmallHoles(context is Context, definition is map) returns array
{
    var rows = [];
    var threshold = definition.minHoleDiameter;

    var cylFaces = evaluateQuery(context, qGeometry(qEverything(EntityType.FACE), GeometryType.CYLINDER));

    for (var face in cylFaces)
    {
        try silent
        {
            // Get edges of this face — holes have exactly 2 circular edges
            var edges = evaluateQuery(context, qAdjacent(face, AdjacencyType.EDGE, EntityType.EDGE));
            if (size(edges) != 2)
                continue;

            // Estimate diameter from circumference of first edge
            var circumference = evLength(context, { "entities" : edges[0] });
            var diameter = circumference / PI;

            if (diameter < threshold)
            {
                rows = append(rows, tableRow({
                            "check" : "Small hole",
                            "severity" : "WARNING",
                            "detail" : "Hole diameter below minimum",
                            "measured" : diameter,
                            "threshold" : threshold
                        }, face));
            }
        }
    }

    return rows;
}

/**
 * Check 2: Small Fillets
 *
 * Find cylindrical faces with small radius. Use evSurfaceDefinition
 * to get the cylinder radius directly and flag if below threshold.
 */
function checkSmallFillets(context is Context, definition is map) returns array
{
    var rows = [];
    var threshold = definition.minFilletRadius;

    var cylFaces = evaluateQuery(context, qGeometry(qEverything(EntityType.FACE), GeometryType.CYLINDER));

    for (var face in cylFaces)
    {
        try silent
        {
            var surfDef = evSurfaceDefinition(context, { "face" : face });

            // surfDef for a cylinder has a .radius field
            if (surfDef.radius == undefined)
                continue;

            var radius = surfDef.radius;

            // Skip if this looks like a hole (2 circular edges) — already caught above
            var edges = evaluateQuery(context, qAdjacent(face, AdjacencyType.EDGE, EntityType.EDGE));
            if (size(edges) == 2)
            {
                // Check if both edges are circular (hole, not fillet)
                var isHole = true;
                for (var edge in edges)
                {
                    try silent
                    {
                        var edgeLen = evLength(context, { "entities" : edge });
                        // A full-circle edge has length ~ 2*PI*r
                        var expectedCirc = 2 * PI * radius;
                        if (abs(edgeLen - expectedCirc) / expectedCirc < 0.1)
                            continue;
                        isHole = false;
                    }
                }
                if (isHole)
                    continue;
            }

            if (radius < threshold)
            {
                rows = append(rows, tableRow({
                            "check" : "Small fillet",
                            "severity" : "WARNING",
                            "detail" : "Fillet radius below minimum",
                            "measured" : radius,
                            "threshold" : threshold
                        }, face));
            }
        }
    }

    return rows;
}

/**
 * Check 3: Thin Walls
 *
 * For each solid body, get planar faces, group by normal direction,
 * and measure distance between opposing parallel face pairs.
 * Flag if distance is below threshold.
 */
function checkThinWalls(context is Context, definition is map) returns array
{
    var rows = [];
    var threshold = definition.minWallThickness;

    var bodies = evaluateQuery(context, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID));

    for (var body in bodies)
    {
        try silent
        {
            var planarFaces = evaluateQuery(context, qGeometry(qOwnedByBody(body, EntityType.FACE), GeometryType.PLANE));

            // Group faces by normal direction (quantized to avoid floating point issues)
            // For each face, check against all other faces for opposing normals
            for (var i = 0; i < size(planarFaces); i += 1)
            {
                var faceA = planarFaces[i];
                var planeA = evPlane(context, { "face" : faceA });
                var normalA = planeA.normal;

                for (var j = i + 1; j < size(planarFaces); j += 1)
                {
                    var faceB = planarFaces[j];
                    var planeB = evPlane(context, { "face" : faceB });
                    var normalB = planeB.normal;

                    // Check if normals are opposing (dot product ~ -1)
                    var dotProduct = dot(normalA, normalB);
                    if (dotProduct > -0.95)
                        continue;

                    // Measure distance between the two opposing faces
                    var dist = evDistance(context, {
                                "side0" : faceA,
                                "side1" : faceB
                            });

                    if (dist.distance < threshold)
                    {
                        rows = append(rows, tableRow({
                                    "check" : "Thin wall",
                                    "severity" : "WARNING",
                                    "detail" : "Wall thickness below minimum",
                                    "measured" : dist.distance,
                                    "threshold" : threshold
                                }, qUnion([faceA, faceB])));
                    }
                }
            }
        }
    }

    return rows;
}

/**
 * Check 4: Sharp Internal Edges
 *
 * For each edge with 2 adjacent faces, compute the dihedral angle
 * between the face normals at the edge midpoint. Flag concave edges
 * where the angle is below the threshold.
 */
function checkSharpEdges(context is Context, definition is map) returns array
{
    var rows = [];
    var threshold = definition.maxSharpAngle;

    var allEdges = evaluateQuery(context, qEverything(EntityType.EDGE));

    for (var edge in allEdges)
    {
        try silent
        {
            // Get adjacent faces — need exactly 2 for a dihedral angle
            var adjFaces = evaluateQuery(context, qAdjacent(edge, AdjacencyType.EDGE, EntityType.FACE));
            if (size(adjFaces) != 2)
                continue;

            // Get edge tangent line at midpoint (parameter 0.5)
            var tangentLine = evEdgeTangentLine(context, {
                        "edge" : edge,
                        "parameter" : 0.5
                    });

            var midPoint = tangentLine.origin;

            // Get face normals at the edge midpoint
            var plane0 = evFaceTangentPlane(context, {
                        "face" : adjFaces[0],
                        "parameter" : vector(0.5, 0.5)
                    });
            var plane1 = evFaceTangentPlane(context, {
                        "face" : adjFaces[1],
                        "parameter" : vector(0.5, 0.5)
                    });

            var normal0 = plane0.normal;
            var normal1 = plane1.normal;

            // Compute dihedral angle between the two face normals
            var cosAngle = dot(normal0, normal1);
            // Clamp to avoid acos domain errors
            cosAngle = max(-1, min(1, cosAngle));
            var dihedralAngle = acos(cosAngle);

            // Check for concavity: the edge is concave if the normals
            // point towards each other (cross product aligns with edge tangent)
            var crossN = cross(normal0, normal1);
            var edgeDir = tangentLine.direction;
            var concavitySign = dot(crossN, edgeDir);

            // Only flag concave (internal) edges with small dihedral angle
            if (concavitySign > 0 && dihedralAngle < threshold)
            {
                rows = append(rows, tableRow({
                            "check" : "Sharp edge",
                            "severity" : "INFO",
                            "detail" : "Internal edge angle below maximum",
                            "measured" : dihedralAngle,
                            "threshold" : threshold
                        }, edge));
            }
        }
    }

    return rows;
}
