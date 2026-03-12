#!/usr/bin/env node
/**
 * splitFeatureScriptDocs.js
 *
 * Parses the FeatureScript Standard Library HTML documentation and generates
 * structured JSON reference files + INDEX.md for AI agent consumption.
 *
 * Usage:
 *   node splitFeatureScriptDocs.js [-i "Feature script source.txt"] [-o docs/featurescript/]
 *
 * Input:  HTML file from Onshape's FeatureScript Standard Library docs page
 * Output: 13 JSON category files + _crossReferences.json + INDEX.md
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const minimist = require('minimist');

// ─── CLI args ───────────────────────────────────────────────────────────────

const argv = minimist(process.argv.slice(2), {
    string: ['i', 'o'],
    alias: { i: 'input', o: 'output' },
    default: {
        i: path.join(__dirname, 'Feature script source.txt'),
        o: path.join(__dirname, 'docs', 'featurescript')
    }
});

const INPUT_FILE = argv.i;
const OUTPUT_DIR = argv.o;

// ─── Feature domain subgroups (static mapping) ─────────────────────────────

const FEATURE_DOMAIN_MAP = {
    'Features-SolidCreation': ['extrude', 'revolve', 'loft', 'sweep', 'thicken', 'rib', 'enclose'],
    'Features-Modification': ['boolean', 'chamfer', 'fillet', 'modifyFillet', 'faceBlend', 'draft', 'bodyDraft', 'shell', 'deleteFace', 'moveFace', 'replaceFace', 'splitpart', 'deleteBodies'],
    'Features-Patterns': ['circularPattern', 'linearPattern', 'curvePattern', 'mirror', 'transformCopy'],
    'Features-SheetMetal': ['sheetMetalAttribute', 'sheetMetalBend', 'sheetMetalBendRelief', 'sheetMetalCorner', 'sheetMetalCornerBreak', 'sheetMetalEnd', 'sheetMetalFlange', 'sheetMetalFormed', 'sheetMetalInFlat', 'sheetMetalJoint', 'sheetMetalLoft', 'sheetMetalMakeJoint', 'sheetMetalStart', 'sheetMetalTab', 'sheetMetalUtils'],
    'Features-CurvesAndWires': ['compositeCurve', 'editCurve', 'fitSpline', 'helix', 'isoparametricCurve', 'isocline', 'moveCurveBoundary', 'offsetCurveOnFace', 'projectCurves', 'routingCurve', 'faceIntersection'],
    'Features-Surfaces': ['bsurf', 'constrainedSurface', 'fillSurface', 'ruledSurface', 'offsetSurface', 'bridgingCurve'],
    'Features-Frames': ['frame', 'frameTrim', 'gusset', 'endcap', 'cutlist']
};

// Build reverse lookup: moduleName → domain file key
const MODULE_TO_DOMAIN = {};
for (const [domain, modules] of Object.entries(FEATURE_DOMAIN_MAP)) {
    for (const mod of modules) {
        MODULE_TO_DOMAIN[mod] = domain;
    }
}

// ─── HTML→text helpers ──────────────────────────────────────────────────────

/**
 * Convert an HTML element to clean text, preserving code blocks.
 * Strips tags but keeps <code> and <pre> content marked up.
 */
function htmlToText($, el) {
    if (!el || !el.length) return '';
    const html = $.html(el);
    return cleanHtml(html);
}

function cleanHtml(html) {
    if (!html) return '';
    let text = html;
    // Normalize &nbsp;
    text = text.replace(/&nbsp;/g, ' ');
    // Convert <pre> blocks to fenced code
    text = text.replace(/<pre>\s*([\s\S]*?)\s*<\/pre>/g, (_, code) => {
        const cleaned = stripTags(code).trim();
        return '\n```\n' + cleaned + '\n```\n';
    });
    // Convert <blockquote><code>...</code>...</blockquote> to inline examples
    text = text.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, content) => {
        return '`' + stripTags(content).trim() + '`';
    });
    // Convert <code> to backticks
    text = text.replace(/<code>([\s\S]*?)<\/code>/g, (_, content) => {
        return '`' + stripTags(content).trim() + '`';
    });
    // Remove EXAMPLE labels
    text = text.replace(/<p class="fs-example-label">EXAMPLE<\/p>/g, ' Example: ');
    // Remove see-also headers
    text = text.replace(/<p class="see-also-header">See also<\/p>/g, ' See also: ');
    // Strip remaining tags
    text = stripTags(text);
    // Collapse whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    return text;
}

function stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
}

/**
 * Extract description text from a fs-doc-content div.
 * Stops at the first <table> if present (tables are parsed separately).
 */
function extractDescription($, docContent) {
    if (!docContent || !docContent.length) return '';
    // Get all children before the first table
    const parts = [];
    docContent.contents().each(function () {
        const node = $(this);
        if (this.tagName === 'table') return false; // stop at first table
        parts.push($.html(this));
    });
    return cleanHtml(parts.join(''));
}

// ─── Type reference helpers ─────────────────────────────────────────────────

function extractTypeRef($, el) {
    const anchor = el.find('a').first();
    if (anchor.length) {
        const href = anchor.attr('href') || '';
        const name = anchor.text().trim();
        if (href.startsWith('#')) {
            return { type: name, typeRef: href };
        } else if (href.includes('/FsDoc/')) {
            // External builtin like /FsDoc/variables.html#boolean
            return { type: name, typeRef: 'builtin:' + name };
        }
        return { type: name, typeRef: null };
    }
    const text = el.text().trim();
    return text ? { type: text, typeRef: null } : { type: null, typeRef: null };
}

// ─── Parse parameter/field tables ───────────────────────────────────────────

function parseParamTable($, table) {
    const headers = [];
    table.find('thead th').each(function () {
        headers.push($(this).text().trim().toLowerCase());
    });

    const isEnumTable = headers.includes('value') && headers.includes('description') && !headers.includes('type');
    const isReturnTable = headers.includes('return type');
    const isFieldTable = headers.includes('value') && headers.includes('type');

    if (isEnumTable) {
        return { tableType: 'enum', values: parseEnumTable($, table) };
    }
    if (isReturnTable) {
        return { tableType: 'return', returnInfo: parseReturnTable($, table) };
    }
    // Parameter or field table
    return { tableType: 'params', parameters: parseParamsFromTable($, table) };
}

function parseEnumTable($, table) {
    const values = [];
    table.find('tbody tr').each(function () {
        const cells = $(this).find('td');
        const name = cells.eq(0).find('code').text().trim();
        const desc = cleanHtml($.html(cells.eq(1)));
        if (name) {
            values.push({ name, description: desc || null });
        }
    });
    return values;
}

function parseReturnTable($, table) {
    const row = table.find('tbody tr').first();
    if (!row.length) return null;
    const cells = row.find('td');
    const typeCell = cells.filter('.fs-type-column').first();
    const descCell = cells.filter('.fs-description-column').first();
    const typeInfo = extractTypeRef($, typeCell.find('.fs-type-name'));
    return {
        type: typeInfo.type,
        typeRef: typeInfo.typeRef,
        description: cleanHtml($.html(descCell))
    };
}

function parseParamsFromTable($, table) {
    const params = [];
    let currentTopLevel = null;

    table.find('tbody tr').each(function () {
        const row = $(this);
        const isSubfield = row.hasClass('subfield');
        const cells = row.find('td');

        const nameCell = cells.filter('.fs-name-column').first();
        const typeCell = cells.filter('.fs-type-column').first();
        const descCell = cells.filter('.fs-description-column').first();

        // Extract name
        let name;
        if (isSubfield) {
            name = nameCell.find('.field-doc').text().trim();
        } else {
            name = nameCell.find('.parameter-name').text().trim();
            if (!name) {
                // Type field tables use plain <code> text
                name = nameCell.find('code').text().trim();
            }
        }

        // Extract type
        const typeInfo = extractTypeRef($, typeCell.find('.fs-type-name'));

        // Extract description + required/optional
        const descHtml = $.html(descCell);
        let required = true;
        let requiredIf = null;

        // Check for Optional/Required markers
        const optMatch = descHtml.match(/<i>Optional<\/i>/);
        const reqIfMatch = descHtml.match(/<i>Required if (.*?)<\/i>/);

        if (optMatch) {
            required = false;
        }
        if (reqIfMatch) {
            required = false;
            requiredIf = stripTags(reqIfMatch[1]).replace(/&nbsp;/g, ' ').trim();
        }

        const description = cleanHtml(descHtml);

        const entry = {
            name: name || null,
            type: typeInfo.type,
            typeRef: typeInfo.typeRef,
            required,
            requiredIf,
            description: description || null
        };

        if (isSubfield && currentTopLevel) {
            if (!currentTopLevel.subfields) currentTopLevel.subfields = [];
            currentTopLevel.subfields.push(entry);
        } else {
            currentTopLevel = entry;
            params.push(entry);
        }
    });

    return params;
}

// ─── Parse a single symbol (node-signature + following fs-doc-content) ──────

function parseSymbol($, sigEl) {
    const id = sigEl.attr('id') || '';
    const nameEl = sigEl.find('.fs-symbol-name');
    const name = nameEl.text().trim();
    const descriptorEl = sigEl.find('.fs-symbol-descriptor');
    const descriptor = descriptorEl.text().trim(); // type, enum, predicate, const, or empty
    const kind = descriptor || 'function';

    const symbol = {
        name,
        kind,
        id
    };

    // Function signature
    const argsEl = sigEl.find('.fs-function-arguments');
    if (argsEl.length) {
        const argsHtml = $.html(argsEl);
        const argsText = argsHtml.replace(/&nbsp;/g, ' ');
        symbol.signature = '(' + stripTags(argsText).replace(/^\(/, '').replace(/\)$/, '') + ')';
        // Also parse structured parameters from the args text
        symbol.signatureParams = parseSignatureArgs($, argsEl);
    }

    // Return type
    const returnEl = sigEl.find('.fs-function-return');
    if (returnEl.length) {
        const retInfo = extractTypeRef($, returnEl);
        symbol.returnType = retInfo.type;
        symbol.returnTypeRef = retInfo.typeRef;
    } else {
        symbol.returnType = null;
    }

    // Description from following fs-doc-content div
    const docContent = sigEl.next('.fs-doc-content');
    if (docContent.length) {
        symbol.description = extractDescription($, docContent);

        // Parse tables within doc content
        const tables = docContent.find('> table');
        if (tables.length) {
            tables.each(function () {
                const parsed = parseParamTable($, $(this));
                if (parsed.tableType === 'enum') {
                    symbol.values = parsed.values;
                } else if (parsed.tableType === 'return') {
                    symbol.returnInfo = parsed.returnInfo;
                } else if (parsed.tableType === 'params') {
                    // Merge with existing or set new
                    if (!symbol.parameters) {
                        symbol.parameters = parsed.parameters;
                    } else {
                        symbol.parameters = symbol.parameters.concat(parsed.parameters);
                    }
                }
            });
        }
    } else {
        symbol.description = '';
    }

    // Collect cross-references from the doc content
    const crossRefs = new Set();
    if (docContent.length) {
        docContent.find('a[href^="#"]').each(function () {
            const href = $(this).attr('href').substring(1);
            // Only simple type refs (not function overload IDs)
            if (href && !href.includes('-') && href[0] === href[0].toUpperCase()) {
                crossRefs.add(href);
            }
        });
    }
    if (crossRefs.size > 0) {
        symbol.references = [...crossRefs];
    }

    return symbol;
}

/**
 * Parse signature args like (context is Context, id is Id, definition is map)
 * into structured parameter list.
 */
function parseSignatureArgs($, argsEl) {
    const html = $.html(argsEl).replace(/&nbsp;/g, ' ');
    const text = stripTags(html);
    // Remove surrounding parens
    const inner = text.replace(/^\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
    if (!inner) return [];

    const params = [];
    // Split on commas, but handle nested brackets if any
    const parts = inner.split(/,\s*/);
    for (const part of parts) {
        const isMatch = part.match(/^(\w+)\s+is\s+(.+)$/);
        if (isMatch) {
            params.push({ name: isMatch[1], type: isMatch[2].trim() });
        } else {
            params.push({ name: part.trim(), type: null });
        }
    }
    return params;
}

// ─── Main parsing logic ─────────────────────────────────────────────────────

function main() {
    console.log('Reading', INPUT_FILE, '...');
    const html = fs.readFileSync(INPUT_FILE, 'utf8');
    console.log(`  ${(html.length / 1024 / 1024).toFixed(1)} MB loaded`);

    const $ = cheerio.load(html);

    // ── Parse categories and modules ──
    const categories = {};
    const allModules = {}; // moduleName → { category, symbols }
    const crossReferences = {}; // typeName → { module, category }

    $('.fs-category').each(function () {
        const catEl = $(this);
        const catId = catEl.attr('id') || '';
        const catName = catId.replace('category-', '');
        console.log(`\nCategory: ${catName}`);

        const modules = {};

        catEl.find('.fs-file').each(function () {
            const fileEl = $(this);
            const headerEl = fileEl.find('h2.file-header');
            const moduleId = headerEl.attr('id') || '';
            const moduleName = moduleId.replace('module-', '');
            const displayName = headerEl.text().trim();

            // Get module description (text before first node-signature)
            let moduleDesc = '';
            const firstContent = fileEl.children().not('h2.file-header').first();
            if (firstContent.length && !firstContent.hasClass('node-signature') && firstContent[0].tagName !== 'p' || (firstContent[0] && firstContent[0].tagName === 'p' && !firstContent.hasClass('node-signature'))) {
                // Collect all paragraph/pre elements before first node-signature
                const descParts = [];
                fileEl.children().each(function () {
                    if ($(this).hasClass('file-header')) return;
                    if ($(this).hasClass('node-signature')) return false;
                    if (this.tagName === 'div' && $(this).hasClass('fs-doc-content')) return false;
                    descParts.push($.html(this));
                });
                moduleDesc = cleanHtml(descParts.join(''));
            }

            // Parse symbols
            const symbols = [];
            fileEl.find('p.node-signature').each(function () {
                const sym = parseSymbol($, $(this));
                symbols.push(sym);

                // Build cross-reference index for types and enums
                if (sym.kind === 'type' || sym.kind === 'enum') {
                    crossReferences[sym.name] = {
                        module: moduleName,
                        category: catName
                    };
                }
            });

            modules[moduleName] = {
                name: displayName || moduleName.replace('.fs', '').replace('.gen.fs', ''),
                importPath: 'onshape/std/' + moduleName,
                description: moduleDesc,
                symbols
            };

            allModules[moduleName] = {
                category: catName,
                data: modules[moduleName]
            };

            console.log(`  ${moduleName}: ${symbols.length} symbols`);
        });

        categories[catName] = modules;
    });

    // ── Count totals ──
    let totalSymbols = 0;
    let totalModules = 0;
    for (const cat of Object.values(categories)) {
        for (const mod of Object.values(cat)) {
            totalModules++;
            totalSymbols += mod.symbols.length;
        }
    }
    console.log(`\nTotal: ${totalModules} modules, ${totalSymbols} symbols`);

    // ── Build output files ──
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const fileStats = []; // Track for INDEX.md

    // 1. Modeling.json
    writeJsonFile('Modeling', categories['Modeling'], 'Core modeling types and operations — Context, Id, Query, operations (op*), evaluations (ev*), sketch, primitives', fileStats);

    // 2. Math.json
    writeJsonFile('Math', categories['Math'], 'Mathematical types and utilities — Vector, Matrix, Transform, units, coordinate systems', fileStats);

    // 3. Utilities.json
    writeJsonFile('Utilities', categories['Utilities'], 'Helper modules — feature definitions, error handling, debug, properties, containers, manipulators, tables', fileStats);

    // 4-10. Feature domain files (split "Onshape features" into 8 files)
    const featureModules = categories['Onshape features'] || {};
    const domainBuckets = {};

    for (const [modName, modData] of Object.entries(featureModules)) {
        // Strip .fs suffix for matching
        const baseName = modName.replace('.fs', '');
        const domain = MODULE_TO_DOMAIN[baseName] || 'Features-Other';
        if (!domainBuckets[domain]) domainBuckets[domain] = {};
        domainBuckets[domain][modName] = modData;
    }

    const domainDescriptions = {
        'Features-SolidCreation': 'Solid body creation — extrude, revolve, loft, sweep, thicken, rib, enclose',
        'Features-Modification': 'Body modification — boolean, chamfer, fillet, shell, draft, split, delete/move/replace faces',
        'Features-Patterns': 'Pattern and copy — circular, linear, curve patterns, mirror, transform copy',
        'Features-SheetMetal': 'Sheet metal features — start, flange, bend, corner, tab, joint, loft, formed',
        'Features-CurvesAndWires': 'Curve and wire creation — helix, spline, projection, isocline, composite curves',
        'Features-Surfaces': 'Surface creation — boundary surface, fill, ruled, offset, constrained, bridging curve',
        'Features-Frames': 'Frame features — frame, trim, gusset, endcap, cutlist',
        'Features-Other': 'Other features — hole, construction plane, import, mate connector, tag, variable, wrap, etc.'
    };

    for (const [domain, modules] of Object.entries(domainBuckets)) {
        writeJsonFile(domain, modules, domainDescriptions[domain] || domain, fileStats);
    }

    // 11. Enums.json
    writeJsonFile('Enums', categories['enums'], 'All auto-generated enum types used by features and operations', fileStats);

    // 12. _crossReferences.json
    const crossRefPath = path.join(OUTPUT_DIR, '_crossReferences.json');
    fs.writeFileSync(crossRefPath, JSON.stringify(crossReferences, null, 2));
    const crossRefSize = fs.statSync(crossRefPath).size;
    fileStats.push({
        file: '_crossReferences.json',
        description: 'Global type→module lookup map',
        modules: Object.keys(crossReferences).length + ' types',
        symbols: '-',
        size: formatSize(crossRefSize)
    });
    console.log(`Wrote ${crossRefPath} (${Object.keys(crossReferences).length} types)`);

    // 13. INDEX.md
    writeIndexMd(fileStats);

    console.log('\nDone! Generated files in', OUTPUT_DIR);
}

// ─── File writing helpers ───────────────────────────────────────────────────

function writeJsonFile(name, modules, description, fileStats) {
    const fileName = name + '.json';
    const filePath = path.join(OUTPUT_DIR, fileName);

    let moduleCount = 0;
    let symbolCount = 0;
    for (const mod of Object.values(modules)) {
        moduleCount++;
        symbolCount += mod.symbols.length;
    }

    const output = {
        featureScriptDocs: '1.0',
        info: {
            title: 'FeatureScript Standard Library - ' + name,
            description,
            sourceVersion: '2026.01'
        },
        category: name,
        modules
    };

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
    const fileSize = fs.statSync(filePath).size;

    fileStats.push({
        file: fileName,
        description,
        modules: moduleCount,
        symbols: symbolCount,
        size: formatSize(fileSize)
    });

    console.log(`Wrote ${fileName} (${moduleCount} modules, ${symbolCount} symbols, ${formatSize(fileSize)})`);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function writeIndexMd(fileStats) {
    const guideFiles = [
        { file: 'Guide-Language.md', description: 'Syntax, types, type tags, control flow, exceptions, operators, annotations' },
        { file: 'Guide-FeatureDefinition.md', description: 'defineFeature pattern, precondition, imports, feature lifecycle' },
        { file: 'Guide-FeatureUI.md', description: 'Parameter types, annotations, UIHints, conditional visibility, manipulators' },
        { file: 'Guide-Modeling.md', description: 'Context, bodies, queries, operations (op*), evaluations (ev*), sketches' },
        { file: 'Guide-FeatureOutput.md', description: 'print/debug, error reporting, regenError, profiling' },
        { file: 'Guide-Tables.md', description: 'defineTable, columns, rows, cell types, cross-highlighting' },
        { file: 'Guide-ComputedProperties.md', description: 'defineComputedPartProperty, return types, testing, deployment' }
    ];

    let md = `# FeatureScript Documentation — AI Agent Reference

> **Purpose**: Enable AI agents to write correct FeatureScript by providing comprehensive,
> machine-readable documentation of the language, patterns, and Standard Library.

## How to Use These Docs

When writing FeatureScript, follow this order:

1. **Read Guide-Language.md** — understand syntax basics (types, operators, control flow)
2. **Read Guide-FeatureDefinition.md** — learn the \`defineFeature\` template
3. **Read Guide-FeatureUI.md** — learn how to define parameters in the precondition
4. **Look up specific functions** in the JSON category files (below)
5. **Use \`_crossReferences.json\`** to find which file defines a type or enum

For quick reference on a specific function, search the JSON files for the function name.
For understanding how to structure a feature, read the Guide files first.

## Guide Files (Markdown)

Conceptual documentation organized by task. Read these to understand patterns.

| File | Description | When to Read |
|------|-------------|-------------|
`;

    for (const g of guideFiles) {
        md += `| [${g.file}](${g.file}) | ${g.description} | ${getWhenToRead(g.file)} |\n`;
    }

    md += `
## Standard Library Reference (JSON)

Structured data parsed from the Onshape Standard Library. Use these to look up functions, types, and enums.

| File | Modules | Symbols | Size | Description |
|------|---------|---------|------|-------------|
`;

    for (const s of fileStats) {
        md += `| [${s.file}](${s.file}) | ${s.modules} | ${s.symbols} | ${s.size} | ${s.description} |\n`;
    }

    md += `
## JSON Schema

Each JSON category file follows this structure:

\`\`\`json
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
\`\`\`

### Symbol Kinds

| Kind | Description | Has signature? | Has parameters? | Has values? |
|------|-------------|---------------|-----------------|-------------|
| \`function\` | Regular function | Yes | Yes (if \`definition is map\`) | No |
| \`type\` | Custom type definition | No | May have fields table | No |
| \`enum\` | Enumeration | No | No | Yes |
| \`predicate\` | Type-check predicate | Yes | No | No |
| \`const\` | Constant value | No | No | No |

## Quick-Start Template

Minimal working feature:

\`\`\`javascript
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
\`\`\`

**Key points:**
- \`FeatureScript YYYY;\` header with version year
- Import \`geometry.fs\` for access to the full Standard Library
- \`annotation { "Feature Type Name" : "..." }\` marks it as a feature
- \`export const\` makes it available in the Part Studio
- \`defineFeature\` wraps the function with context, id, definition
- \`precondition { }\` defines UI parameters
- Feature body calls \`op*\` functions for geometry operations
`;

    const indexPath = path.join(OUTPUT_DIR, 'INDEX.md');
    fs.writeFileSync(indexPath, md);
    console.log('Wrote INDEX.md');
}

function getWhenToRead(file) {
    const map = {
        'Guide-Language.md': 'First — learn syntax before writing code',
        'Guide-FeatureDefinition.md': 'Starting a new feature',
        'Guide-FeatureUI.md': 'Adding UI parameters to a feature',
        'Guide-Modeling.md': 'Working with geometry and queries',
        'Guide-FeatureOutput.md': 'Debugging or adding error handling',
        'Guide-Tables.md': 'Creating custom tables',
        'Guide-ComputedProperties.md': 'Creating computed part properties'
    };
    return map[file] || '';
}

// ─── Run ────────────────────────────────────────────────────────────────────
main();
