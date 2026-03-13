#!/usr/bin/env node
/**
 * pdmSync2-packgo.js
 * Stage 2 of PDM Release Sync pipeline.
 *
 * Generates Pack & Go ZIPs for assemblies that need uploading/replacing.
 * Must run on Windows with SolidWorks installed.
 *
 * Usage:
 *   node pdmSync2-packgo.js -i pdm_releases_s1.xlsx [-o pdm_releases_s2.xlsx]
 *                            [--zip-dir temp-pack-and-go/]
 */

'use strict';

const fs = require('fs');
const xlsx = require('xlsx');
const path = require('path');
const minimist = require('minimist');
const { spawnSync } = require('child_process');

const args = minimist(process.argv.slice(2), {
  string: ['i', 'o', 'zip-dir'],
  boolean: ['h', 'help'],
  alias: { i: 'input', o: 'output', h: 'help' },
  default: { 'zip-dir': 'temp-pack-and-go' }
});

if (args.help || !args.input) {
  console.log(`
PDM Release Sync - Stage 2: Pack & Go

Generates Pack & Go ZIPs for assemblies that need uploading/replacing.
Must run on Windows with SolidWorks installed.

Usage: node pdmSync2-packgo.js -i pdm_releases_s1.xlsx [options]

Options:
  -i, --input     Stage 1 output Excel file (required)
  -o, --output    Output Excel file (default: pdm_releases_s2.xlsx)
  --zip-dir       Directory for ZIP files (default: temp-pack-and-go/)
  -h, --help      Show this help

Output columns added:
  sync:zipPath      Path to generated ZIP (assemblies only)
  sync:packStatus   done / failed / skipped
`);
  process.exit(0);
}

// Non-Windows guard
if (process.platform !== 'win32') {
  console.error('Error: Pack & Go requires Windows with SolidWorks installed.');
  console.error(`Current platform: ${process.platform}`);
  console.error('\nRun this stage on a Windows machine, then copy the output Excel back.');
  process.exit(1);
}

const inputFile = args.input;
const outputFile = args.output || 'pdm_releases_s2.xlsx';
const zipDir = args['zip-dir'];

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Ensure ZIP output directory exists
if (!fs.existsSync(zipDir)) {
  fs.mkdirSync(zipDir, { recursive: true });
}

// Read input
console.log(`Reading: ${inputFile}`);
const workbook = xlsx.readFile(inputFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet);
console.log(`Found ${rows.length} rows\n`);

// Filter to assemblies that need Pack & Go
const assemblyRows = rows.filter(row => {
  const level = parseInt(row['sync:level']) || 0;
  const action = String(row['sync:action'] || '');
  return level >= 2 && action !== 'skip' && action !== 'skip-downgrade';
});

console.log(`Assemblies needing Pack & Go: ${assemblyRows.length}\n`);

const psScript = path.join(__dirname, 'PDM', 'packAndGoSingle.ps1');
if (!fs.existsSync(psScript)) {
  console.error(`Error: PowerShell script not found: ${psScript}`);
  console.error('Create PDM/packAndGoSingle.ps1 first.');
  process.exit(1);
}

let succeeded = 0;
let failed = 0;
let skippedExisting = 0;

for (let i = 0; i < assemblyRows.length; i++) {
  const row = assemblyRows[i];
  const name = String(row['Name'] || '');
  const partNumber = path.parse(name).name;
  const filePath = String(row['sync:filePath'] || '');
  const outputZip = path.resolve(path.join(zipDir, partNumber + '.zip'));

  console.log(`[${i + 1}/${assemblyRows.length}] ${name}`);

  // Skip if ZIP already exists
  if (fs.existsSync(outputZip)) {
    console.log(`  → skip (ZIP already exists: ${outputZip})`);
    row['sync:zipPath'] = outputZip;
    row['sync:packStatus'] = 'done';
    skippedExisting++;
    continue;
  }

  if (!filePath) {
    console.error(`  → failed: no file path`);
    row['sync:zipPath'] = '';
    row['sync:packStatus'] = 'failed';
    failed++;
    continue;
  }

  // Run Pack & Go via PowerShell
  console.log(`  Running Pack & Go: ${filePath}`);
  console.log(`  Output: ${outputZip}`);

  const result = spawnSync('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', psScript,
    '-AssemblyPath', filePath,
    '-OutputZip', outputZip
  ], {
    timeout: 5 * 60 * 1000, // 5 minutes
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });

  if (result.stdout) {
    result.stdout.trim().split('\n').forEach(line => console.log(`    ${line}`));
  }

  if (result.status === 0 && fs.existsSync(outputZip)) {
    console.log(`  → done`);
    row['sync:zipPath'] = outputZip;
    row['sync:packStatus'] = 'done';
    succeeded++;
  } else {
    const errMsg = (result.stderr || '').trim() || `Exit code: ${result.status}`;
    console.error(`  → failed: ${errMsg}`);
    row['sync:zipPath'] = '';
    row['sync:packStatus'] = 'failed';
    failed++;
  }
}

// Mark non-assembly rows
rows.forEach(row => {
  if (row['sync:packStatus'] === undefined) {
    row['sync:zipPath'] = '';
    row['sync:packStatus'] = 'skipped';
  }
});

// Write output Excel
const outWorkbook = xlsx.utils.book_new();
const outSheet = xlsx.utils.json_to_sheet(rows);
xlsx.utils.book_append_sheet(outWorkbook, outSheet, 'Sheet1');
xlsx.writeFile(outWorkbook, outputFile);

console.log('\n' + '='.repeat(50));
console.log('STAGE 2 COMPLETE');
console.log('='.repeat(50));
console.log(`Succeeded:  ${succeeded}`);
console.log(`Skipped:    ${skippedExisting} (ZIP already exists)`);
console.log(`Failed:     ${failed}`);
console.log(`\nOutput: ${outputFile}`);
console.log(`ZIPs: ${zipDir}/`);
