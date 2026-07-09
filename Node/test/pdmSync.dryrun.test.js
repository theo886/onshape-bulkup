/**
 * Dry-run integration tests for pdmSync pipeline scripts.
 * Runs each script as a child process with --dry-run or -h.
 *
 * Run: node --test test/pdmSync.dryrun.test.js
 */

'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const NODE = process.execPath;
const ROOT = path.join(__dirname, '..');

function run(script, args, opts = {}) {
  const scriptPath = path.join(ROOT, script);
  return execFileSync(NODE, [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...opts.env },
    ...opts
  });
}

function runWithStatus(script, args) {
  try {
    const stdout = run(script, args);
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status };
  }
}

// ─── Stage 1: pdmSync1-analyze.js ───────────────────────────────────────────

describe('Stage 1: pdmSync1-analyze.js', () => {
  it('-h flag prints help and exits 0', () => {
    const result = runWithStatus('pdmSync1-analyze.js', ['-h']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Stage 1'));
    assert.ok(result.stdout.includes('--input'));
  });

  it('missing -i flag prints help and exits 0', () => {
    const result = runWithStatus('pdmSync1-analyze.js', []);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Usage'));
  });

  it('non-existent input file exits 1', () => {
    const result = runWithStatus('pdmSync1-analyze.js', ['-i', 'nonexistent.xlsx']);
    assert.equal(result.exitCode, 1);
  });
});

// ─── Stage 2: pdmSync2-packgo.js ────────────────────────────────────────────

describe('Stage 2: pdmSync2-packgo.js', () => {
  it('-h flag prints help and exits 0', () => {
    const result = runWithStatus('pdmSync2-packgo.js', ['-h']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Stage 2'));
    assert.ok(result.stdout.includes('Pack & Go'));
  });

  if (process.platform !== 'win32') {
    it('exits with error on non-Windows platforms', () => {
      const result = runWithStatus('pdmSync2-packgo.js', ['-i', 'test/fixtures/pdm_releases_input.xlsx']);
      assert.equal(result.exitCode, 1);
    });
  }
});

// ─── Stage 3: pdmSync3-upload.js ────────────────────────────────────────────

describe('Stage 3: pdmSync3-upload.js', () => {
  const dryRunOutput = path.join(ROOT, 'test', 'fixtures', 'dryrun_s3_output.xlsx');

  after(() => {
    // Clean up output file
    if (fs.existsSync(dryRunOutput)) fs.unlinkSync(dryRunOutput);
  });

  it('-h flag prints help and exits 0', () => {
    const result = runWithStatus('pdmSync3-upload.js', ['-h']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Stage 3'));
    assert.ok(result.stdout.includes('--dry-run'));
  });

  it('--dry-run with fixture Excel exits 0 and produces output', () => {
    const result = runWithStatus('pdmSync3-upload.js', [
      '-i', 'test/fixtures/pdm_releases_s2.xlsx',
      '-o', dryRunOutput,
      '--dry-run'
    ]);
    assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(dryRunOutput), 'Output Excel should exist');
  });

  it('--dry-run output has sync:uploadStatus = "dry-run" for actionable rows', () => {
    // Ensure the dry-run was executed (depends on previous test)
    if (!fs.existsSync(dryRunOutput)) {
      run('pdmSync3-upload.js', [
        '-i', 'test/fixtures/pdm_releases_s2.xlsx',
        '-o', dryRunOutput,
        '--dry-run'
      ]);
    }

    const wb = xlsx.readFile(dryRunOutput);
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    const actionable = rows.filter(r => {
      const action = String(r['sync:action'] || '');
      return action !== 'skip' && action !== 'skip-downgrade' && action !== 'error' && action !== '';
    });
    const skipped = rows.filter(r => {
      const action = String(r['sync:action'] || '');
      return action === 'skip' || action === 'skip-downgrade';
    });

    assert.ok(actionable.length > 0, 'Should have at least one actionable row');
    for (const row of actionable) {
      assert.equal(String(row['sync:uploadStatus']), 'dry-run',
        `Row ${row.Name} should have uploadStatus=dry-run`);
    }
    for (const row of skipped) {
      assert.equal(String(row['sync:uploadStatus']), 'skipped',
        `Skipped row ${row.Name} should have uploadStatus=skipped`);
    }
  });

  it('--dry-run output preserves all input columns', () => {
    if (!fs.existsSync(dryRunOutput)) {
      run('pdmSync3-upload.js', [
        '-i', 'test/fixtures/pdm_releases_s2.xlsx',
        '-o', dryRunOutput,
        '--dry-run'
      ]);
    }

    const wb = xlsx.readFile(dryRunOutput);
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    assert.ok(rows.length >= 6, 'Should have at least 6 rows');
    // Check that original columns survive
    const first = rows[0];
    assert.ok('Name' in first, 'Name column preserved');
    assert.ok('sync:action' in first, 'sync:action column preserved');
    assert.ok('sync:level' in first, 'sync:level column preserved');
  });
});

// ─── Stage 4: pdmSync4-release.js ───────────────────────────────────────────

describe('Stage 4: pdmSync4-release.js', () => {
  const dryRunOutput = path.join(ROOT, 'test', 'fixtures', 'dryrun_s4_output.xlsx');

  after(() => {
    if (fs.existsSync(dryRunOutput)) fs.unlinkSync(dryRunOutput);
  });

  it('-h flag prints help and exits 0', () => {
    const result = runWithStatus('pdmSync4-release.js', ['-h']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Stage 4'));
    assert.ok(result.stdout.includes('--dry-run'));
  });

  it('--dry-run with fixture Excel exits 0 and produces output', () => {
    const result = runWithStatus('pdmSync4-release.js', [
      '-i', 'test/fixtures/pdm_releases_s2.xlsx',
      '-o', dryRunOutput,
      '--dry-run'
    ]);
    assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(dryRunOutput), 'Output Excel should exist');
  });

  it('--dry-run output has sync:releaseStatus columns', () => {
    if (!fs.existsSync(dryRunOutput)) {
      run('pdmSync4-release.js', [
        '-i', 'test/fixtures/pdm_releases_s2.xlsx',
        '-o', dryRunOutput,
        '--dry-run'
      ]);
    }

    const wb = xlsx.readFile(dryRunOutput);
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    assert.ok(rows.length > 0, 'Should have rows');
    for (const row of rows) {
      assert.ok('sync:releaseStatus' in row || row['sync:releaseStatus'] !== undefined,
        `Row ${row.Name} should have sync:releaseStatus column`);
    }
  });
});
