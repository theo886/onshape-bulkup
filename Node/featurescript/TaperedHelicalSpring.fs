FeatureScript 2878;
import(path : "onshape/std/common.fs", version : "2878.0");

annotation { "Feature Type Name" : "Tapered Helical Spring" }
export const taperedHelicalSpring = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Base diameter" }
        isLength(definition.baseDiameter, NONNEGATIVE_LENGTH_BOUNDS);

        annotation { "Name" : "Height" }
        isLength(definition.height, NONNEGATIVE_LENGTH_BOUNDS);

        annotation { "Name" : "Number of revolutions" }
        isInteger(definition.revolutions, POSITIVE_COUNT_BOUNDS);

        annotation { "Name" : "Wire diameter" }
        isLength(definition.wireDiameter, NONNEGATIVE_LENGTH_BOUNDS);

        annotation { "Name" : "Taper angle" }
        isAngle(definition.taperAngle, ANGLE_STRICT_90_BOUNDS);
    }
    {
        // Calculate the helix parameters
        const pitch = definition.height / definition.revolutions;

        // Calculate spiral pitch (radius change per revolution) for taper
        // Negative = radius decreases as helix rises
        const spiralPitchVal = -pitch * tan(definition.taperAngle);

        // Create the tapered helical path
        opHelix(context, id + "helix", {
                "direction" : vector(0, 0, 1),
                "axisStart" : vector(0, 0, 0) * meter,
                "startPoint" : vector(definition.baseDiameter / 2, 0 * meter, 0 * meter),
                "helicalPitch" : pitch,
                "clockwise" : false,
                "interval" : [0, definition.revolutions],
                "spiralPitch" : spiralPitchVal
        });

        // Get the helix edge
        const helixEdge = qCreatedBy(id + "helix", EntityType.EDGE);

        // Get tangent at helix start for sweep profile plane
        const tangentLine = evEdgeTangentLine(context, {
                "edge" : helixEdge,
                "parameter" : 0
        });

        // Create sketch plane perpendicular to helix at start point
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", {
                "sketchPlane" : plane(tangentLine.origin, tangentLine.direction)
        });

        // Draw wire cross-section circle
        skCircle(profileSketch, "wireProfile", {
                "center" : vector(0, 0) * meter,
                "radius" : definition.wireDiameter / 2
        });

        skSolve(profileSketch);

        // Sweep the circular profile along the helix path
        opSweep(context, id + "sweep", {
                "profiles" : qSketchRegion(id + "profileSketch"),
                "path" : helixEdge
        });
    });
