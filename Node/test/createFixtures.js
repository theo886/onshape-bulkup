/**
 * createFixtures.js
 * Generates Excel test fixtures for pdmSync tests.
 * Run once: node test/createFixtures.js
 */

'use strict';

const xlsx = require('xlsx');
const path = require('path');

const fixturesDir = path.join(__dirname, 'fixtures');

// ─── pdm_releases_input.xlsx — Stage 1 input ─────────────────────────────────

const inputRows = [
  { Name: '30093.SLDPRT', 'Found In': 'C:\\Vault\\Parts', Revision: '01', Description: 'Test part' },
  { Name: '10500.SLDASM', 'Found In': 'C:\\Vault\\Assemblies', Revision: '02', Description: 'Test assembly' },
  { Name: '30093.PDF',    'Found In': 'C:\\Vault\\Drawings', Revision: '01', Description: 'Test PDF' },
  { Name: '50200.STEP',   'Found In': 'C:\\Vault\\Exports', Revision: '01', Description: 'Should be skipped' },
  { Name: '90100.SLDDRW', 'Found In': 'C:\\Vault\\Drawings', Revision: '03', Description: 'Should be skipped' },
  { Name: 'ABC-MISC.DWG', 'Found In': 'C:\\Vault\\Other', Revision: '01', Description: 'Non-numeric PN' }
];

const wb1 = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb1, xlsx.utils.json_to_sheet(inputRows), 'Sheet1');
xlsx.writeFile(wb1, path.join(fixturesDir, 'pdm_releases_input.xlsx'));
console.log('Created: pdm_releases_input.xlsx');

// ─── pdm_releases_s2.xlsx — Stage 2 output (pre-filled for Stage 3/4) ────────

const s2Rows = [
  {
    Name: '30093.SLDPRT', 'Found In': 'C:\\Vault\\Parts', Revision: '01', Description: 'Test part',
    'sync:action': 'new', 'sync:level': 1, 'sync:folder': '0c63b047974f7016afda739b',
    'sync:documentName': '30093 SRC', 'sync:pdmRevision': '01', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Parts\\30093.SLDPRT', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  },
  {
    Name: '10500.SLDASM', 'Found In': 'C:\\Vault\\Assemblies', Revision: '02', Description: 'Test assembly',
    'sync:action': 'new', 'sync:level': 2, 'sync:folder': '104a8ac5a8e0216dc4e52728',
    'sync:documentName': '10500 SRC', 'sync:pdmRevision': '02', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Assemblies\\10500.SLDASM', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  },
  {
    Name: '30093.PDF', 'Found In': 'C:\\Vault\\Drawings', Revision: '01', Description: 'Test PDF',
    'sync:action': 'new', 'sync:level': 0, 'sync:folder': '0c63b047974f7016afda739b',
    'sync:documentName': '30093 SRC', 'sync:pdmRevision': '01', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Drawings\\30093.PDF', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  },
  {
    Name: '50200.STEP', 'Found In': 'C:\\Vault\\Exports', Revision: '01', Description: 'Should be skipped',
    'sync:action': 'skip', 'sync:level': 0, 'sync:folder': '',
    'sync:documentName': '', 'sync:pdmRevision': '01', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Exports\\50200.STEP', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  },
  {
    Name: '90100.SLDDRW', 'Found In': 'C:\\Vault\\Drawings', Revision: '03', Description: 'Should be skipped',
    'sync:action': 'skip', 'sync:level': 0, 'sync:folder': '',
    'sync:documentName': '', 'sync:pdmRevision': '03', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Drawings\\90100.SLDDRW', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  },
  {
    Name: 'ABC-MISC.DWG', 'Found In': 'C:\\Vault\\Other', Revision: '01', Description: 'Non-numeric PN',
    'sync:action': 'new', 'sync:level': 0, 'sync:folder': '026b282ba795f63af58b368b',
    'sync:documentName': 'ABC-M SRC', 'sync:pdmRevision': '01', 'sync:onshapeRevision': '',
    'sync:documentId': '', 'sync:workspaceId': '', 'sync:elementId': '', 'sync:revisionId': '',
    'sync:filePath': 'C:\\Vault\\Other\\ABC-MISC.DWG', 'sync:zipPath': '', 'sync:packStatus': 'skipped'
  }
];

const wb2 = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb2, xlsx.utils.json_to_sheet(s2Rows), 'Sheet1');
xlsx.writeFile(wb2, path.join(fixturesDir, 'pdm_releases_s2.xlsx'));
console.log('Created: pdm_releases_s2.xlsx');

console.log('Done.');
