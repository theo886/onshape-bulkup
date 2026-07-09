/**
 * Unit tests for lib/pdmSyncUtils.js
 * Uses Node's built-in test runner (node:test, Node v20+).
 *
 * Run: node --test test/pdmSyncUtils.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  FOLDER_MAP,
  SKIP_EXTENSIONS,
  getFolderForPartNumber,
  getDocumentName,
  compareRevisions,
  parseCSVLine,
  parseCSV,
  buildReferenceGraph,
  calculateAssemblyLevel,
  extractError,
  buildProperties
} = require('../lib/pdmSyncUtils');

// ─── getFolderForPartNumber ──────────────────────────────────────────────────

describe('getFolderForPartNumber', () => {
  it('maps 30093 to the 30000 bucket folder', () => {
    assert.equal(getFolderForPartNumber('30093'), FOLDER_MAP[30000]);
  });

  it('maps 100500 to the 100000 bucket folder', () => {
    assert.equal(getFolderForPartNumber('100500'), FOLDER_MAP[100000]);
  });

  it('maps 9999 to MISC (no 0 bucket)', () => {
    assert.equal(getFolderForPartNumber('9999'), FOLDER_MAP['MISC']);
  });

  it('maps "ABC" to MISC (non-numeric)', () => {
    assert.equal(getFolderForPartNumber('ABC'), FOLDER_MAP['MISC']);
  });

  it('maps 10000 exactly to the 10000 bucket', () => {
    assert.equal(getFolderForPartNumber('10000'), FOLDER_MAP[10000]);
  });
});

// ─── getDocumentName ─────────────────────────────────────────────────────────

describe('getDocumentName', () => {
  it('"30093.SLDPRT" → "30093 SRC"', () => {
    assert.equal(getDocumentName('30093.SLDPRT'), '30093 SRC');
  });

  it('"ABC-12345.PDF" → "ABC-1 SRC" (5 chars)', () => {
    assert.equal(getDocumentName('ABC-12345.PDF'), 'ABC-1 SRC');
  });

  it('short name "AB.X" → "AB SRC"', () => {
    assert.equal(getDocumentName('AB.X'), 'AB SRC');
  });
});

// ─── compareRevisions ────────────────────────────────────────────────────────

describe('compareRevisions', () => {
  it('"01" vs "01" → 0 (equal)', () => {
    assert.equal(compareRevisions('01', '01'), 0);
  });

  it('"02" vs "01" → positive (pdm > onshape)', () => {
    assert.ok(compareRevisions('02', '01') > 0);
  });

  it('"01" vs "02" → negative (pdm < onshape)', () => {
    assert.ok(compareRevisions('01', '02') < 0);
  });

  it('"A" vs "B" → lexicographic', () => {
    assert.ok(compareRevisions('A', 'B') < 0);
  });

  it('"10" vs "9" → numeric (not lexicographic)', () => {
    // Lexicographic would give "10" < "9", but numeric gives 10 > 9
    assert.ok(compareRevisions('10', '9') > 0);
  });
});

// ─── SKIP_EXTENSIONS ─────────────────────────────────────────────────────────

describe('SKIP_EXTENSIONS', () => {
  it('includes .SLDDRW, .STEP, .STP', () => {
    assert.ok(SKIP_EXTENSIONS.has('.SLDDRW'));
    assert.ok(SKIP_EXTENSIONS.has('.STEP'));
    assert.ok(SKIP_EXTENSIONS.has('.STP'));
  });

  it('does not include .SLDPRT, .SLDASM, .PDF', () => {
    assert.ok(!SKIP_EXTENSIONS.has('.SLDPRT'));
    assert.ok(!SKIP_EXTENSIONS.has('.SLDASM'));
    assert.ok(!SKIP_EXTENSIONS.has('.PDF'));
  });
});

// ─── extractError ────────────────────────────────────────────────────────────

describe('extractError', () => {
  it('parses JSON body with message', () => {
    const err = { body: '{"message":"Not Found"}' };
    assert.equal(extractError(err), 'Not Found');
  });

  it('returns raw body string on parse failure', () => {
    const err = { body: 'plain text error' };
    assert.equal(extractError(err), 'plain text error');
  });

  it('returns "HTTP 429" for statusCode-only errors', () => {
    const err = { statusCode: 429 };
    assert.equal(extractError(err), 'HTTP 429');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(extractError(null), '');
    assert.equal(extractError(undefined), '');
  });
});

// ─── parseCSVLine ────────────────────────────────────────────────────────────

describe('parseCSVLine', () => {
  it('simple comma-separated values', () => {
    assert.deepEqual(parseCSVLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('quoted values with embedded commas', () => {
    assert.deepEqual(parseCSVLine('"hello, world",b,c'), ['hello, world', 'b', 'c']);
  });

  it('empty values', () => {
    assert.deepEqual(parseCSVLine('a,,c'), ['a', '', 'c']);
  });
});

// ─── parseCSV (file-based) ───────────────────────────────────────────────────

describe('parseCSV', () => {
  it('parses the references fixture correctly', () => {
    const fixturesPath = path.join(__dirname, 'fixtures', 'references.csv');
    const data = parseCSV(fixturesPath);
    assert.equal(data.length, 3);
    assert.equal(data[0].AssemblyFile, '10500.SLDASM');
    assert.equal(data[0].ChildFile, '30093.SLDPRT');
    assert.equal(data[2].ChildFile, '30094.SLDPRT');
  });
});

// ─── buildReferenceGraph ─────────────────────────────────────────────────────

describe('buildReferenceGraph', () => {
  it('builds Map from reference array', () => {
    const refs = [
      { AssemblyFile: 'A.SLDASM', ChildFile: 'B.SLDPRT' },
      { AssemblyFile: 'A.SLDASM', ChildFile: 'C.SLDPRT' }
    ];
    const graph = buildReferenceGraph(refs);
    assert.ok(graph.has('A.SLDASM'));
    assert.deepEqual(graph.get('A.SLDASM'), ['B.SLDPRT', 'C.SLDPRT']);
  });

  it('case-insensitive keys', () => {
    const refs = [
      { AssemblyFile: 'a.sldasm', ChildFile: 'b.sldprt' }
    ];
    const graph = buildReferenceGraph(refs);
    assert.ok(graph.has('A.SLDASM'));
  });

  it('deduplicates children', () => {
    const refs = [
      { AssemblyFile: 'A.SLDASM', ChildFile: 'B.SLDPRT' },
      { AssemblyFile: 'A.SLDASM', ChildFile: 'B.SLDPRT' }
    ];
    const graph = buildReferenceGraph(refs);
    assert.equal(graph.get('A.SLDASM').length, 1);
  });

  it('skips empty assembly/child entries', () => {
    const refs = [
      { AssemblyFile: '', ChildFile: 'B.SLDPRT' },
      { AssemblyFile: 'A.SLDASM', ChildFile: '' }
    ];
    const graph = buildReferenceGraph(refs);
    assert.equal(graph.size, 0);
  });
});

// ─── calculateAssemblyLevel ──────────────────────────────────────────────────

describe('calculateAssemblyLevel', () => {
  it('assembly with only parts → level 2', () => {
    const graph = new Map([['TOP.SLDASM', ['PART1.SLDPRT', 'PART2.SLDPRT']]]);
    const cache = new Map();
    assert.equal(calculateAssemblyLevel('TOP.SLDASM', graph, cache), 2);
  });

  it('assembly containing sub-assembly → level 3', () => {
    const graph = new Map([
      ['TOP.SLDASM', ['SUB.SLDASM', 'PART.SLDPRT']],
      ['SUB.SLDASM', ['PART2.SLDPRT']]
    ]);
    const cache = new Map();
    assert.equal(calculateAssemblyLevel('TOP.SLDASM', graph, cache), 3);
  });

  it('deep nesting → level 4+', () => {
    const graph = new Map([
      ['TOP.SLDASM', ['MID.SLDASM']],
      ['MID.SLDASM', ['BOT.SLDASM']],
      ['BOT.SLDASM', ['PART.SLDPRT']]
    ]);
    const cache = new Map();
    assert.equal(calculateAssemblyLevel('TOP.SLDASM', graph, cache), 4);
  });

  it('circular dependency → returns 2 with warning', () => {
    const graph = new Map([
      ['A.SLDASM', ['B.SLDASM']],
      ['B.SLDASM', ['A.SLDASM']]
    ]);
    const cache = new Map();
    // Circular → falls back to 2 for the cycle participant
    const level = calculateAssemblyLevel('A.SLDASM', graph, cache);
    assert.ok(level >= 2);
  });

  it('caches results in levelCache', () => {
    const graph = new Map([['X.SLDASM', ['Y.SLDPRT']]]);
    const cache = new Map();
    calculateAssemblyLevel('X.SLDASM', graph, cache);
    assert.ok(cache.has('X.SLDASM'));
    assert.equal(cache.get('X.SLDASM'), 2);
  });
});

// ─── buildProperties ─────────────────────────────────────────────────────────

describe('buildProperties', () => {
  const mockPropertyIdMap = {
    'Part number': 'pid-pn',
    'Revision': 'pid-rev',
    'Description': 'pid-desc'
  };

  it('builds Part number + Revision + Description', () => {
    const row = { Name: '30093.SLDPRT', 'sync:pdmRevision': '02', Description: 'Pump bracket' };
    const props = buildProperties(row, mockPropertyIdMap);
    assert.equal(props.length, 3);
    assert.equal(props[0].propertyId, 'pid-pn');
    assert.equal(props[0].value, '30093');
    assert.equal(props[1].propertyId, 'pid-rev');
    assert.equal(props[1].value, '02');
    assert.equal(props[2].propertyId, 'pid-desc');
    assert.equal(props[2].value, 'Pump bracket');
  });

  it('pads single-digit revision to "0N"', () => {
    const row = { Name: '10001.SLDPRT', Revision: '3' };
    const props = buildProperties(row, mockPropertyIdMap);
    const revProp = props.find(p => p.propertyId === 'pid-rev');
    assert.equal(revProp.value, '03');
  });

  it('omits empty description', () => {
    const row = { Name: '10001.SLDPRT', 'sync:pdmRevision': '01', Description: '' };
    const props = buildProperties(row, mockPropertyIdMap);
    assert.ok(!props.find(p => p.propertyId === 'pid-desc'));
  });

  it('handles missing Name gracefully', () => {
    const row = { 'sync:pdmRevision': '01' };
    const props = buildProperties(row, mockPropertyIdMap);
    // No part number generated from empty name
    assert.ok(!props.find(p => p.propertyId === 'pid-pn'));
  });
});
