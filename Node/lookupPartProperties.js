#!/usr/bin/env node
/**
 * Lookup all properties of parts from an Excel file with Onshape IDs
 * Uses existing document/workspace/element IDs for direct metadata lookup
 * Outputs results to CSV
 *
 * Usage: node lookupPartProperties.js [input.xlsx] [output.csv]
 */

const XLSX = require('xlsx');
const fs = require('fs');
const onshape = require('./lib/onshape');

// Default paths
const DEFAULT_INPUT = '/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/findpartnumbers.xlsx';
const DEFAULT_OUTPUT = './output/part_properties.csv';

// Parse arguments
const inputPath = process.argv[2] || DEFAULT_INPUT;
const outputPath = process.argv[3] || DEFAULT_OUTPUT;

// Adaptive rate limiting settings
const MIN_DELAY_MS = 200;       // Minimum delay when rate limit is healthy
const MAX_DELAY_MS = 10000;     // Maximum delay when rate limit is critical
const CRITICAL_THRESHOLD = 5;   // Pause significantly when remaining drops below this
const LOW_REMAINING_THRESHOLD = 15;  // Start slowing down at this level
const HEALTHY_THRESHOLD = 50;   // Speed up when above this level

let currentDelay = MIN_DELAY_MS;
let lastRateRemaining = null;
let rateLimitHits = 0;
let apiCalls = 0;

// Read Excel file
console.log(`Reading Excel file: ${inputPath}`);
const wb = XLSX.readFile(inputPath);
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet);

console.log(`Found ${rows.length} rows in sheet '${sheetName}'`);
console.log('Columns:', Object.keys(rows[0] || {}));

// Check if we have Onshape IDs
const hasIds = rows[0] &&
  'onshape:documentId' in rows[0] &&
  'onshape:workspaceId' in rows[0] &&
  'onshape:elementId' in rows[0];

if (!hasIds) {
  console.error('\nError: Excel file must have columns: onshape:documentId, onshape:workspaceId, onshape:elementId');
  process.exit(1);
}

console.log('\nUsing existing Onshape IDs for direct metadata lookup (1 API call per row)\n');

// Results storage
const results = [];
let processed = 0;
let found = 0;
let errors = 0;

// All property names we encounter (for CSV header)
const allPropertyNames = new Set(['File Name', 'Document ID', 'Workspace ID', 'Element ID', 'Error']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function adjustDelay(rateInfo) {
  if (rateInfo && rateInfo.remaining !== undefined) {
    const remaining = parseInt(rateInfo.remaining, 10);
    lastRateRemaining = remaining;

    if (remaining <= CRITICAL_THRESHOLD) {
      // Critical: pause significantly to let rate limit recover
      currentDelay = MAX_DELAY_MS;
      console.log(`\n  [Rate Limit CRITICAL: ${remaining} remaining, delay=${currentDelay}ms]`);
    } else if (remaining < LOW_REMAINING_THRESHOLD) {
      // Low: scale delay based on how close to critical
      const urgency = (LOW_REMAINING_THRESHOLD - remaining) / (LOW_REMAINING_THRESHOLD - CRITICAL_THRESHOLD);
      currentDelay = Math.round(MIN_DELAY_MS + urgency * (MAX_DELAY_MS - MIN_DELAY_MS));
    } else if (remaining >= HEALTHY_THRESHOLD) {
      // Healthy: use minimum delay
      currentDelay = MIN_DELAY_MS;
    } else {
      // Moderate: gradual increase
      const factor = 1 - (remaining - LOW_REMAINING_THRESHOLD) / (HEALTHY_THRESHOLD - LOW_REMAINING_THRESHOLD);
      currentDelay = Math.round(MIN_DELAY_MS + factor * 500);
    }
  }
}

async function waitForRateLimit(retryAfter) {
  const waitTime = (retryAfter || 60) * 1000;
  console.log(`\n  [Rate Limited! Waiting ${retryAfter || 60}s before retry...]`);
  rateLimitHits++;
  await sleep(waitTime);
  currentDelay = MAX_DELAY_MS; // Stay conservative after rate limit hit
}

async function getElementMetadata(docId, workspaceId, elementId, retryCount = 0) {
  return new Promise((resolve) => {
    apiCalls++;
    onshape.get({
      path: `/api/metadata/d/${docId}/w/${workspaceId}/e/${elementId}`
    }, async (data, err, rateInfo) => {
      adjustDelay(rateInfo);

      if (err && err.statusCode === 429) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || rateInfo?.retryAfter || '60', 10);
        if (retryCount < 3) {
          await waitForRateLimit(retryAfter);
          const result = await getElementMetadata(docId, workspaceId, elementId, retryCount + 1);
          resolve(result);
          return;
        }
        resolve({ error: 'Rate limit exceeded after 3 retries' });
        return;
      }

      if (err) {
        resolve({ error: `HTTP ${err.statusCode}: ${err.body?.substring(0, 100) || 'Unknown error'}` });
        return;
      }

      if (!data) {
        resolve({ error: 'No data returned' });
        return;
      }

      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        resolve({ error: `Parse error: ${e.message}` });
      }
    });
  });
}

async function processRow(row) {
  processed++;
  const fileName = row['File Name'] || '';
  const docId = row['onshape:documentId'];
  const workId = row['onshape:workspaceId'];
  const elemId = row['onshape:elementId'];

  const rateStatus = lastRateRemaining !== null ? `rate=${lastRateRemaining}` : 'rate=--';
  process.stdout.write(`\rProcessing ${processed}/${rows.length}: ${fileName.substring(0, 25).padEnd(25)} [${rateStatus}, delay=${currentDelay}ms]    `);

  // Preemptive pause if rate limit is critically low
  if (lastRateRemaining !== null && lastRateRemaining <= CRITICAL_THRESHOLD) {
    console.log(`\n  [Preemptive pause: only ${lastRateRemaining} requests remaining, waiting 30s...]`);
    await sleep(30000);
  }

  // Skip if missing IDs
  if (!docId || !workId || !elemId) {
    const result = {
      'File Name': fileName,
      'Document ID': docId || '',
      'Workspace ID': workId || '',
      'Element ID': elemId || '',
      'Error': 'Missing Onshape IDs'
    };
    results.push(result);
    errors++;
    return;
  }

  // Get metadata
  const meta = await getElementMetadata(docId, workId, elemId);
  await sleep(currentDelay);

  // Build result object
  const result = {
    'File Name': fileName,
    'Document ID': docId,
    'Workspace ID': workId,
    'Element ID': elemId,
    'Error': ''
  };

  if (meta.error) {
    result['Error'] = meta.error;
    errors++;
  } else if (meta.properties) {
    found++;
    // Add all properties
    for (const prop of meta.properties) {
      let value = prop.value;
      if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value);
      }
      result[prop.name] = value !== undefined && value !== null ? String(value) : '';
      allPropertyNames.add(prop.name);
    }
  }

  results.push(result);
}

function writeCSV() {
  // Build CSV with all encountered property columns
  const headers = Array.from(allPropertyNames);
  const csvRows = [headers.join(',')];

  for (const result of results) {
    const row = headers.map(h => {
      const val = result[h] || '';
      // Escape commas, quotes, and newlines
      if (String(val).includes(',') || String(val).includes('"') || String(val).includes('\n')) {
        return `"${String(val).replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(outputPath, csvRows.join('\n'));
  console.log(`\nResults written to: ${outputPath}`);
}

async function main() {
  console.log('Starting lookups...\n');

  for (const row of rows) {
    await processRow(row);
  }

  console.log('\n\n========== RESULTS ==========');
  console.log(`Rows processed: ${rows.length}`);
  console.log(`Properties found: ${found}`);
  console.log(`Errors: ${errors}`);
  console.log(`API calls: ${apiCalls}`);
  console.log(`Rate limit hits: ${rateLimitHits}`);
  console.log(`Properties discovered: ${allPropertyNames.size}`);

  if (results.length > 0) {
    writeCSV();
  } else {
    console.log('\nNo results to write.');
  }
}

main().catch(console.error);
