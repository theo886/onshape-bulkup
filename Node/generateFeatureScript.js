/**
 * generateFeatureScript.js — Generate FeatureScript code using Claude AI
 *
 * Uses the FeatureScript documentation toolkit (docs/featurescript/) as context
 * to produce correct, idiomatic FeatureScript from plain-English descriptions.
 *
 * Usage:
 *   node generateFeatureScript.js --prompt "Create a feature that extrudes selected faces by a given depth"
 *   node generateFeatureScript.js -p "Custom table showing part volumes" -t table -o myTable.fs
 *   node generateFeatureScript.js --list-modules
 *   node generateFeatureScript.js --verbose -p "Fillet edges with variable radius"
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const Anthropic = require('@anthropic-ai/sdk').default;

const DOCS_DIR = path.join(__dirname, 'docs', 'featurescript');

// --- CLI ---

const args = minimist(process.argv.slice(2), {
    alias: { p: 'prompt', t: 'type', o: 'output', m: 'model', v: 'verbose', h: 'help' },
    boolean: ['verbose', 'help', 'list-modules'],
    default: { type: 'feature', model: 'claude-sonnet-4-5-20250929' }
});

if (args.help) {
    console.log(`
Usage: node generateFeatureScript.js [options]

Options:
  --prompt, -p      Description of the feature to generate (required)
  --type, -t        Output type: feature (default), table, property
  --output, -o      Write output to file instead of stdout
  --model, -m       Claude model (default: claude-sonnet-4-5-20250929)
  --verbose, -v     Show which docs were loaded and token estimates
  --list-modules    List all available Standard Library modules and exit
  --help, -h        Show usage
`);
    process.exit(0);
}

// --- Common-term to module mapping ---
// Maps plain-English terms that don't exactly match symbol names to their modules

const COMMON_TERM_MAP = {
    'extrude':    ['extrude.fs', 'Features-SolidCreation'],
    'revolve':    ['revolve.fs', 'Features-SolidCreation'],
    'loft':       ['loft.fs', 'Features-SolidCreation'],
    'sweep':      ['sweep.fs', 'Features-SolidCreation'],
    'thicken':    ['thicken.fs', 'Features-SolidCreation'],
    'rib':        ['rib.fs', 'Features-SolidCreation'],
    'enclose':    ['enclose.fs', 'Features-SolidCreation'],
    'fillet':     ['fillet.fs', 'Features-Modification'],
    'chamfer':    ['chamfer.fs', 'Features-Modification'],
    'shell':      ['shell.fs', 'Features-Modification'],
    'draft':      ['draft.fs', 'Features-Modification'],
    'boolean':    ['boolean.fs', 'Features-Modification'],
    'split':      ['splitpart.fs', 'Features-Modification'],
    'mirror':     ['mirror.fs', 'Features-Patterns'],
    'pattern':    ['circularPattern.fs', 'Features-Patterns'],
    'circular pattern': ['circularPattern.fs', 'Features-Patterns'],
    'linear pattern':   ['linearPattern.fs', 'Features-Patterns'],
    'curve pattern':    ['curvePattern.fs', 'Features-Patterns'],
    'sketch':     ['sketch.fs', 'Modeling'],
    'query':      ['query.fs', 'Modeling'],
    'evaluate':   ['evaluate.fs', 'Modeling'],
    'context':    ['context.fs', 'Modeling'],
    'vector':     ['vector.fs', 'Math'],
    'matrix':     ['matrix.fs', 'Math'],
    'transform':  ['transform.fs', 'Math'],
    'units':      ['units.fs', 'Math'],
    'plane':      ['surfaceGeometry.fs', 'Math'],
    'helix':      ['helix.fs', 'Features-CurvesAndWires'],
    'spline':     ['fitSpline.fs', 'Features-CurvesAndWires'],
    'hole':       ['hole.fs', 'Features-Other'],
    'mate connector': ['mateConnector.fs', 'Features-Other'],
    'construction plane': ['cplane.fs', 'Features-Other'],
    'variable':   ['variable.fs', 'Features-Other'],
    'import':     ['importDerived.fs', 'Features-Other'],
    'surface':    ['bsurf.fs', 'Features-Surfaces'],
    'offset surface': ['offsetSurface.fs', 'Features-Surfaces'],
    'fill surface':   ['fill.fs', 'Features-Surfaces'],
    'ruled surface':  ['ruledSurface.fs', 'Features-Surfaces'],
    'sheet metal':    ['sheetMetalStart.fs', 'Features-SheetMetal'],
    'flange':     ['sheetMetalFlange.fs', 'Features-SheetMetal'],
    'bend':       ['sheetMetalBend.fs', 'Features-SheetMetal'],
    'frame':      ['frame.fs', 'Features-Frames'],
    'gusset':     ['gusset.fs', 'Features-Frames'],
    'table':      ['table.fs', 'Utilities'],
    'manipulator': ['manipulator.fs', 'Utilities'],
    'properties': ['properties.fs', 'Utilities'],
    'error':      ['error.fs', 'Utilities'],
    'debug':      ['debug.fs', 'Utilities'],
    'delete face': ['deleteFace.fs', 'Features-Modification'],
    'move face':   ['moveFace.fs', 'Features-Modification'],
    'replace face': ['replaceFace.fs', 'Features-Modification'],
    'wrap':       ['wrap.fs', 'Features-Other'],
    'tag':        ['tag.fs', 'Features-Other'],
    'extend':     ['extend.fs', 'Features-Modification'],
    'offset curve': ['offsetCurveOnFace.fs', 'Features-CurvesAndWires'],
    'bridging curve': ['bridgingCurve.fs', 'Features-CurvesAndWires'],
    'project curve': ['projectCurves.fs', 'Features-CurvesAndWires'],
    'composite curve': ['compositeCurve.fs', 'Features-CurvesAndWires'],
};

// --- Module listing ---

function listModules() {
    const crossRefs = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, '_crossReferences.json'), 'utf8'));

    // Build category → modules map
    const categories = {};
    const moduleSymbolCount = {};
    for (const [typeName, info] of Object.entries(crossRefs)) {
        const cat = info.category;
        if (!categories[cat]) categories[cat] = new Set();
        categories[cat].add(info.module);
        const key = `${cat}/${info.module}`;
        moduleSymbolCount[key] = (moduleSymbolCount[key] || 0) + 1;
    }

    // Also scan JSON files for modules not in crossRefs (functions don't appear there)
    const jsonFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.json') && f !== '_crossReferences.json');
    for (const file of jsonFiles) {
        const data = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, file), 'utf8'));
        if (!data.modules) continue;
        const cat = data.category;
        if (!categories[cat]) categories[cat] = new Set();
        for (const [modName, mod] of Object.entries(data.modules)) {
            categories[cat].add(modName);
            const key = `${cat}/${modName}`;
            moduleSymbolCount[key] = Math.max(moduleSymbolCount[key] || 0, mod.symbols ? mod.symbols.length : 0);
        }
    }

    console.log('Available Standard Library modules:\n');
    for (const [cat, mods] of Object.entries(categories).sort()) {
        console.log(`  ${cat}:`);
        for (const mod of [...mods].sort()) {
            const count = moduleSymbolCount[`${cat}/${mod}`] || '?';
            console.log(`    ${mod.padEnd(35)} (${count} symbols)`);
        }
        console.log();
    }
}

if (args['list-modules']) {
    listModules();
    process.exit(0);
}

if (!args.prompt) {
    console.error('Error: --prompt is required. Use --help for usage.');
    process.exit(1);
}

// --- Context Loading ---

function loadGuides(type) {
    const always = [
        'Guide-Language.md',
        'Guide-FeatureDefinition.md',
        'Guide-FeatureUI.md',
        'Guide-Modeling.md',
        'Guide-FeatureOutput.md',
    ];

    const guides = [...always];

    if (type === 'table') {
        guides.push('Guide-Tables.md');
    }
    if (type === 'property') {
        guides.push('Guide-ComputedProperties.md');
    }

    const contents = {};
    for (const name of guides) {
        const filePath = path.join(DOCS_DIR, name);
        if (fs.existsSync(filePath)) {
            contents[name] = fs.readFileSync(filePath, 'utf8');
        }
    }
    return contents;
}

function buildSymbolIndex() {
    // Build: symbolName → { module, category } from all JSON files
    const index = {};
    const jsonFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.json') && f !== '_crossReferences.json');

    for (const file of jsonFiles) {
        const data = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, file), 'utf8'));
        if (!data.modules) continue;
        for (const [modName, mod] of Object.entries(data.modules)) {
            if (!mod.symbols) continue;
            for (const sym of mod.symbols) {
                index[sym.name] = { module: modName, category: data.category };
            }
        }
    }
    return index;
}

function findRelevantModules(prompt, type) {
    const promptLower = prompt.toLowerCase();
    const modulesToLoad = new Map(); // module.fs → category

    // Always include context.fs (essential, small)
    modulesToLoad.set('context.fs', 'Modeling');

    // 1. Check common terms (longer phrases first for priority)
    const sortedTerms = Object.keys(COMMON_TERM_MAP).sort((a, b) => b.length - a.length);
    for (const term of sortedTerms) {
        if (promptLower.includes(term)) {
            const [mod, cat] = COMMON_TERM_MAP[term];
            modulesToLoad.set(mod, cat);
        }
    }

    // 2. Check against all symbol names from the JSON files
    const symbolIndex = buildSymbolIndex();
    for (const [symName, info] of Object.entries(symbolIndex)) {
        // Match exact symbol names (case-insensitive) that appear as words in the prompt
        const regex = new RegExp('\\b' + escapeRegex(symName) + '\\b', 'i');
        if (regex.test(prompt)) {
            modulesToLoad.set(info.module, info.category);
        }
    }

    // 3. If type is table, ensure table module is included
    if (type === 'table') {
        modulesToLoad.set('table.fs', 'Utilities');
    }
    if (type === 'property') {
        modulesToLoad.set('properties.fs', 'Utilities');
    }

    return modulesToLoad;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadModules(modulesToLoad) {
    // Group by category file
    const categoryModules = {};
    for (const [mod, cat] of modulesToLoad) {
        if (!categoryModules[cat]) categoryModules[cat] = [];
        categoryModules[cat].push(mod);
    }

    const loaded = {};
    let totalBytes = 0;
    const MAX_JSON_BYTES = 200 * 1024; // 200KB cap

    for (const [cat, mods] of Object.entries(categoryModules)) {
        const filePath = path.join(DOCS_DIR, `${cat}.json`);
        if (!fs.existsSync(filePath)) continue;

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.modules) continue;

        for (const modName of mods) {
            if (!data.modules[modName]) continue;
            if (totalBytes >= MAX_JSON_BYTES) break;

            const moduleData = data.modules[modName];
            const formatted = formatModuleForContext(moduleData, modName);
            const bytes = Buffer.byteLength(formatted);

            if (totalBytes + bytes > MAX_JSON_BYTES) continue;

            loaded[modName] = formatted;
            totalBytes += bytes;
        }
    }

    return { loaded, totalBytes };
}

function formatModuleForContext(module, modName) {
    const lines = [];
    lines.push(`### Module: ${modName} (${module.importPath || 'onshape/std/' + modName})`);
    if (module.description) {
        lines.push(module.description);
    }
    lines.push('');

    if (!module.symbols) return lines.join('\n');

    for (const sym of module.symbols) {
        if (sym.kind === 'function') {
            const ret = sym.returnType ? ` returns ${sym.returnType}` : '';
            lines.push(`**${sym.name}**${sym.signature}${ret}`);
            if (sym.description) {
                // Keep description concise — first 2 sentences max
                const desc = sym.description.split('\n')[0].substring(0, 300);
                lines.push(`  ${desc}`);
            }
            if (sym.parameters) {
                for (const param of sym.parameters) {
                    if (param.subfields) {
                        for (const sf of param.subfields) {
                            const req = sf.required ? ' (required)' : '';
                            lines.push(`  - ${sf.name}: ${sf.type}${req}${sf.description ? ' — ' + sf.description.substring(0, 150) : ''}`);
                        }
                    }
                }
            }
        } else if (sym.kind === 'enum') {
            lines.push(`**enum ${sym.name}**`);
            if (sym.values) {
                const vals = sym.values.map(v => typeof v === 'string' ? v : v.name).join(', ');
                lines.push(`  Values: ${vals}`);
            }
        } else if (sym.kind === 'type') {
            lines.push(`**type ${sym.name}**`);
            if (sym.description) {
                lines.push(`  ${sym.description.split('\n')[0].substring(0, 200)}`);
            }
        } else if (sym.kind === 'predicate') {
            lines.push(`**predicate ${sym.name}**${sym.signature || ''}`);
        } else if (sym.kind === 'const') {
            lines.push(`**const ${sym.name}**`);
            if (sym.description) {
                lines.push(`  ${sym.description.split('\n')[0].substring(0, 200)}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

// --- System Prompt ---

function buildSystemPrompt(guides, modules, type) {
    const parts = [];

    parts.push(`You are a FeatureScript expert. Generate complete, correct FeatureScript code.

RULES:
- Always start with \`FeatureScript 2026;\` and \`import(path : "onshape/std/geometry.fs", version : "2026.0");\`
- Use ONLY functions, types, and enums documented in the reference material below
- Do NOT hallucinate function names or parameters — if unsure, use only what is documented
- Include proper annotations for all features and parameters
- Follow the defineFeature pattern exactly as shown in the guides
- Use proper precondition blocks for UI parameters
- Output ONLY the FeatureScript code — no explanations, no markdown code fences`);

    if (type === 'table') {
        parts.push('- Generate a defineTable function following the Table guide');
    } else if (type === 'property') {
        parts.push('- Generate a defineComputedPartProperty function following the ComputedProperties guide');
    }

    parts.push('\n=== LANGUAGE REFERENCE ===\n');
    for (const [name, content] of Object.entries(guides)) {
        parts.push(`--- ${name} ---`);
        parts.push(content);
        parts.push('');
    }

    if (Object.keys(modules).length > 0) {
        parts.push('\n=== STANDARD LIBRARY MODULES ===\n');
        for (const [name, content] of Object.entries(modules)) {
            parts.push(content);
        }
    }

    return parts.join('\n');
}

// --- API Call ---

function getApiKey() {
    // Env var takes priority
    if (process.env.ANTHROPIC_API_KEY) {
        return process.env.ANTHROPIC_API_KEY;
    }
    // Fall back to config file
    const keyPath = path.join(__dirname, 'config', 'aikey.js');
    if (fs.existsSync(keyPath)) {
        const config = require(keyPath);
        return config.apiKey;
    }
    console.error('Error: No API key found. Set ANTHROPIC_API_KEY env var or create config/aikey.js (see config/aikeyexample.js).');
    process.exit(1);
}

async function callClaude(systemPrompt, userPrompt, model) {
    const apiKey = getApiKey();
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
        model: model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
    });

    // Extract text from response
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) {
        throw new Error('No text in API response');
    }

    let code = textBlock.text;

    // Strip markdown code fences if the model included them despite instructions
    code = code.replace(/^```(?:featurescript|javascript|typescript|fs)?\s*\n/i, '');
    code = code.replace(/\n```\s*$/i, '');

    return { code, usage: response.usage };
}

// --- Main ---

async function main() {
    const prompt = args.prompt;
    const type = args.type;
    const verbose = args.verbose;

    if (verbose) console.error('Loading guide files...');
    const guides = loadGuides(type);
    if (verbose) {
        const guideBytes = Object.values(guides).reduce((sum, c) => sum + Buffer.byteLength(c), 0);
        console.error(`  Loaded ${Object.keys(guides).length} guides (${(guideBytes / 1024).toFixed(1)} KB)`);
        for (const name of Object.keys(guides)) console.error(`    - ${name}`);
    }

    if (verbose) console.error('\nDetecting relevant modules...');
    const modulesToLoad = findRelevantModules(prompt, type);
    if (verbose) {
        console.error(`  Matched ${modulesToLoad.size} modules:`);
        for (const [mod, cat] of modulesToLoad) console.error(`    - ${mod} (${cat})`);
    }

    const { loaded: modules, totalBytes: jsonBytes } = loadModules(modulesToLoad);
    if (verbose) {
        console.error(`  Loaded ${Object.keys(modules).length} module specs (${(jsonBytes / 1024).toFixed(1)} KB)`);
    }

    const systemPrompt = buildSystemPrompt(guides, modules, type);
    if (verbose) {
        const totalBytes = Buffer.byteLength(systemPrompt);
        // Rough token estimate: ~4 chars per token
        const estTokens = Math.round(totalBytes / 4);
        console.error(`\nSystem prompt: ${(totalBytes / 1024).toFixed(1)} KB (~${estTokens.toLocaleString()} tokens)`);
    }

    if (verbose) console.error(`\nCalling ${args.model}...`);
    const { code, usage } = await callClaude(systemPrompt, prompt, args.model);

    if (verbose && usage) {
        console.error(`  Input tokens: ${usage.input_tokens.toLocaleString()}`);
        console.error(`  Output tokens: ${usage.output_tokens.toLocaleString()}`);
    }

    if (args.output) {
        fs.writeFileSync(args.output, code, 'utf8');
        console.error(`Output written to ${args.output}`);
    } else {
        console.log(code);
    }
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
