#!/usr/bin/env node

/**
 * splitApiDocs.js - Split monolithic API documentation into category files
 *
 * Reads the large API Docmentation.json file and splits it into:
 * - Individual {Category}.json files for each API tag
 * - INDEX.md for quick reference
 * - _schemas.json for shared schema definitions
 *
 * Usage:
 *   node splitApiDocs.js
 *
 * Output:
 *   Node/docs/api/INDEX.md
 *   Node/docs/api/{Category}.json (40 files)
 *   Node/docs/api/_schemas.json
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'output/API Docmentation.json');
const OUTPUT_DIR = path.join(__dirname, 'docs/api');

// Priority categories for this migration project
const PRIORITY_CATEGORIES = [
    'Assembly', 'BlobElement', 'Document', 'Metadata', 'Part',
    'PartStudio', 'ReleasePackage', 'Revision', 'Translation', 'Element'
];

/**
 * Extract all $ref references from an object recursively
 */
function extractRefs(obj, refs = new Set()) {
    if (!obj || typeof obj !== 'object') return refs;

    if (obj.$ref && typeof obj.$ref === 'string') {
        // Extract schema name from "#/components/schemas/SchemaName"
        const match = obj.$ref.match(/#\/components\/schemas\/(.+)/);
        if (match) {
            refs.add(match[1]);
        }
    }

    for (const value of Object.values(obj)) {
        extractRefs(value, refs);
    }

    return refs;
}

/**
 * Get all schemas referenced by a set of paths, including nested refs
 */
function getReferencedSchemas(paths, allSchemas, maxDepth = 5) {
    const directRefs = new Set();

    // Get direct references from paths
    for (const pathData of Object.values(paths)) {
        extractRefs(pathData, directRefs);
    }

    // Resolve nested references
    const allRefs = new Set(directRefs);
    let newRefs = directRefs;
    let depth = 0;

    while (newRefs.size > 0 && depth < maxDepth) {
        const nextRefs = new Set();
        for (const refName of newRefs) {
            if (allSchemas[refName]) {
                const nested = extractRefs(allSchemas[refName]);
                for (const nestedRef of nested) {
                    if (!allRefs.has(nestedRef)) {
                        nextRefs.add(nestedRef);
                        allRefs.add(nestedRef);
                    }
                }
            }
        }
        newRefs = nextRefs;
        depth++;
    }

    return allRefs;
}

/**
 * Generate a summary of key operations for a category
 */
function getKeyOperations(paths) {
    const ops = [];
    for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, details] of Object.entries(methods)) {
            if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                const opId = details.operationId;
                if (opId) {
                    ops.push(opId);
                }
            }
        }
    }
    // Return first 4 operation IDs as key operations
    return ops.slice(0, 4).join(', ');
}

/**
 * Count endpoints in a paths object
 */
function countEndpoints(paths) {
    let count = 0;
    for (const methods of Object.values(paths)) {
        for (const method of Object.keys(methods)) {
            if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                count++;
            }
        }
    }
    return count;
}

async function main() {
    console.log('Reading API documentation...');
    const apiDoc = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

    const tags = apiDoc.tags || [];
    const paths = apiDoc.paths || {};
    const schemas = apiDoc.components?.schemas || {};

    console.log(`Found ${tags.length} tags, ${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Group paths by primary tag
    const pathsByTag = {};

    for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, details] of Object.entries(methods)) {
            if (!details.tags || details.tags.length === 0) continue;

            const primaryTag = details.tags[0];
            if (!pathsByTag[primaryTag]) {
                pathsByTag[primaryTag] = {};
            }
            if (!pathsByTag[primaryTag][pathStr]) {
                pathsByTag[primaryTag][pathStr] = {};
            }
            pathsByTag[primaryTag][pathStr][method] = details;
        }
    }

    // Track stats for INDEX.md
    const stats = [];

    // Create individual category files
    for (const tag of tags) {
        const tagName = tag.name;
        const tagPaths = pathsByTag[tagName] || {};
        const endpointCount = countEndpoints(tagPaths);

        if (endpointCount === 0) {
            console.log(`  Skipping ${tagName} (no endpoints)`);
            continue;
        }

        // Get referenced schemas for this tag
        const referencedSchemaNames = getReferencedSchemas(tagPaths, schemas);
        const tagSchemas = {};
        for (const schemaName of referencedSchemaNames) {
            if (schemas[schemaName]) {
                tagSchemas[schemaName] = schemas[schemaName];
            }
        }

        // Build the category document
        const categoryDoc = {
            openapi: apiDoc.openapi,
            info: {
                title: `Onshape API - ${tagName}`,
                description: tag.description,
                version: apiDoc.info.version
            },
            servers: apiDoc.servers,
            tags: [tag],
            paths: tagPaths,
            components: {
                schemas: tagSchemas,
                securitySchemes: apiDoc.components?.securitySchemes
            }
        };

        const outputFile = path.join(OUTPUT_DIR, `${tagName}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(categoryDoc, null, 2));

        const fileSizeKB = Math.round(fs.statSync(outputFile).size / 1024);
        const keyOps = getKeyOperations(tagPaths);
        const isPriority = PRIORITY_CATEGORIES.includes(tagName);

        stats.push({
            name: tagName,
            description: tag.description,
            endpoints: endpointCount,
            schemas: referencedSchemaNames.size,
            sizeKB: fileSizeKB,
            keyOps,
            isPriority
        });

        console.log(`  Created ${tagName}.json (${endpointCount} endpoints, ${fileSizeKB}KB)`);
    }

    // Write full schemas file (reference only)
    const schemasFile = path.join(OUTPUT_DIR, '_schemas.json');
    fs.writeFileSync(schemasFile, JSON.stringify({
        description: 'All Onshape API schemas - reference only. Individual category files include relevant schemas.',
        schemas
    }, null, 2));
    console.log(`  Created _schemas.json (${Math.round(fs.statSync(schemasFile).size / 1024)}KB)`);

    // Generate INDEX.md
    stats.sort((a, b) => {
        // Priority categories first, then alphabetical
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return a.name.localeCompare(b.name);
    });

    const indexContent = generateIndexMd(stats);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'INDEX.md'), indexContent);
    console.log('  Created INDEX.md');

    console.log(`\nDone! Created ${stats.length} category files in ${OUTPUT_DIR}`);
}

function generateIndexMd(stats) {
    const priorityStats = stats.filter(s => s.isPriority);
    const otherStats = stats.filter(s => !s.isPriority);

    return `# Onshape API Documentation Index

Quick reference for Onshape API endpoints, organized by category.

## Usage for Claude Agents

1. **Find the right category**: Scan the tables below to find the API category you need
2. **Read the category file**: \`Read Node/docs/api/{Category}.json\`
3. **Find the endpoint**: Search for the operation name (e.g., \`getAssemblyDefinition\`)
4. **Check parameters**: Look at \`parameters\` array for required inputs
5. **Check response**: Look at \`responses.200.content\` for response schema

## Priority Categories (Migration Project)

These are the most commonly used APIs for the SolidWorks migration:

| Category | Endpoints | Size | Description |
|----------|-----------|------|-------------|
${priorityStats.map(s =>
    `| [${s.name}](${s.name}.json) | ${s.endpoints} | ${s.sizeKB}KB | ${s.description} |`
).join('\n')}

### Key Operations by Category

${priorityStats.map(s =>
    `- **${s.name}**: ${s.keyOps || 'See file'}`
).join('\n')}

## All Categories

| Category | Endpoints | Size | Description |
|----------|-----------|------|-------------|
${otherStats.map(s =>
    `| [${s.name}](${s.name}.json) | ${s.endpoints} | ${s.sizeKB}KB | ${s.description} |`
).join('\n')}

## Common Patterns

### Path Parameters
Most endpoints use these path parameters:
- \`did\` - Document ID
- \`wvm\` - Workspace/Version/Microversion type (\`w\`, \`v\`, or \`m\`)
- \`wvmid\` - Workspace/Version/Microversion ID
- \`eid\` - Element ID

### Standard URL Pattern
\`\`\`
/api/v13/{category}/{did}/{wvm}/{wvmid}/e/{eid}
\`\`\`

### Response Codes
- \`200\` - Success
- \`400\` - Bad request (check parameters)
- \`401\` - Unauthorized (check API key)
- \`403\` - Forbidden (check permissions)
- \`404\` - Not found
- \`429\` - Rate limited (wait and retry)

## Files

| File | Description |
|------|-------------|
| \`INDEX.md\` | This file |
| \`{Category}.json\` | OpenAPI spec for each category |
| \`_schemas.json\` | All schemas (reference only, 500KB+) |

## Regenerating

If the API documentation is updated, regenerate these files:
\`\`\`bash
node splitApiDocs.js
\`\`\`
`;
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
