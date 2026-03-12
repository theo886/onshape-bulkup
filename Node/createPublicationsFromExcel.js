#!/usr/bin/env node
/**
 * Create Publications from Excel
 *
 * Reads an Excel file, groups rows by publication name, creates each
 * publication with its items via a single API call, logs progress to
 * a JSON sidecar, and outputs a completed Excel with publication IDs.
 *
 * Optionally enriches publication notes with D365 ERP item data from
 * a second "item master" sheet. Parts are matched by prefix (the portion
 * of Part Number before the first dash) against the publication name.
 *
 * Usage:
 *   node createPublicationsFromExcel.js -i input.xlsx --dry-run
 *   node createPublicationsFromExcel.js -i input.xlsx
 *
 * Excel sheets:
 *   Sheet 1 ("publications" or first sheet):
 *     onshape:folderId                  Parent folder for the publication (required)
 *     property:publication:name         Publication name, used for grouping (required)
 *     property:publication:description  Publication description (required)
 *     property:publication:notes        Notes field (optional)
 *     item:documentId                   Document containing the item (required)
 *     item:elementId                    Element ID of the item (required)
 *     item:versionId                    Version ID to publish (required)
 *     uploadLevel                       0=blob, 1=part, 2+=assembly (optional, for type flags)
 *     onshape:publicationId             Output — filled with new publication ID
 *     item:revisionId                   Output — revision ID from Onshape Revision API
 *     item:partId                       Output — part ID (part studio items only)
 *
 *   Sheet 2 ("item master", optional):
 *     Part Number      D365 item number (e.g. "10064-01-A")
 *     Rev              Revision
 *     Description      Item description
 *     Avail. Inventory Available inventory quantity
 *     Unit Cost        Unit cost in dollars
 *     Unit             Unit of measure (e.g. "EA")
 */

const fs = require('fs');
const xlsx = require('xlsx');
const pathModule = require('path');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

const COMPANY_ID = '6763516217765c31f9561958';

// File extension → MIME type lookup for blob items
const MIME_TYPES = {
  'PDF': 'application/pdf',
  'STEP': 'application/step',
  'STP': 'application/step',
  'DWG': 'application/acad',
  'DXF': 'application/dxf',
  'XLSX': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'CSV': 'text/csv',
  'TXT': 'text/plain',
  'JPG': 'image/jpeg',
  'JPEG': 'image/jpeg',
  'PNG': 'image/png',
};

// Adaptive rate limiting settings
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 5000;
const LOW_REMAINING_THRESHOLD = 10;

let currentDelay = MIN_DELAY_MS;

// Promisified onshape.post with 429 retry and rate-info tracking
function postAsync(opts, retryCount = 0) {
  return new Promise((resolve, reject) => {
    onshape.post(opts, (data, err) => {
      if (err) {
        // Handle 429 rate limit
        if (err.statusCode === 429 && retryCount < 3) {
          const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
          console.log(`  Rate limited. Waiting ${retryAfter}s before retry (attempt ${retryCount + 1}/3)...`);
          currentDelay = MAX_DELAY_MS;
          setTimeout(() => {
            postAsync(opts, retryCount + 1).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

// Promisified onshape.get
function getAsync(opts) {
  return new Promise((resolve, reject) => {
    onshape.get(opts, (data, err) => {
      if (err) return reject(err);
      resolve(typeof data === 'string' ? JSON.parse(data) : data);
    });
  });
}

// Look up partId, revisionId, partName for a released part via the Revision API
async function getRevisionInfo(partNumber) {
  const data = await getAsync({
    path: `/api/v13/revisions/c/${COMPANY_ID}/partnumber/${encodeURIComponent(partNumber)}`,
    query: { elementType: 0 }
  });
  return { partId: data.partId, revisionId: data.id, partName: data.name || partNumber };
}

// Look up revisionId for a released blob element via the Revision API
async function getBlobRevisionInfo(documentId, versionId, elementId) {
  const data = await getAsync({
    path: `/api/v13/revisions/companies/${COMPANY_ID}/d/${documentId}/v/${versionId}/e/${elementId}`,
    query: { elementType: 4 }
  });
  const items = data.items || data;
  if (Array.isArray(items) && items.length > 0) {
    return { revisionId: items[0].id };
  }
  return null;
}

// Load or initialize sidecar status
function loadSidecar(filePath) {
  const defaultStatus = {
    lastUpdated: new Date().toISOString(),
    publications: {}
  };

  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return { ...defaultStatus, ...JSON.parse(data) };
    } catch (e) {
      console.warn('Warning: Could not parse sidecar file, starting fresh');
      return defaultStatus;
    }
  }
  return defaultStatus;
}

// Save sidecar status
function saveSidecar(filePath, sidecar) {
  sidecar.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(sidecar, null, 2));
}

function showUsage() {
  console.log('\nCreate Publications from Excel\n');
  console.log('Usage: node createPublicationsFromExcel.js [options]\n');
  console.log('Options:');
  console.log('  -i <path>       Input Excel file (required)');
  console.log('  --dry-run       Validate Excel and show what would be created');
  console.log('  -h, --help      Show this help\n');
  console.log('Required Excel columns (sheet "publications" or first sheet):');
  console.log('  onshape:folderId                  Parent folder ID');
  console.log('  property:publication:name         Publication name (grouping key)');
  console.log('  property:publication:description  Publication description');
  console.log('  item:documentId                   Document ID for the item');
  console.log('  item:elementId                    Element ID for the item');
  console.log('  item:versionId                    Version ID for the item\n');
  console.log('Optional Excel columns:');
  console.log('  property:publication:notes        Publication notes\n');
  console.log('Optional "item master" sheet (D365 enrichment):');
  console.log('  Part Number        D365 item number (prefix before first "-" matches pub name)');
  console.log('  Rev                Revision');
  console.log('  Description        Item description');
  console.log('  Avail. Inventory   Available inventory quantity');
  console.log('  Unit Cost          Unit cost in dollars');
  console.log('  Unit               Unit of measure\n');
  console.log('Output:');
  console.log('  onshape:publicationId             Filled with created publication ID');
  console.log('  item:revisionId                   Revision ID from Onshape Revision API');
  console.log('  item:partId                       Part ID (part studio items only)');
  console.log('  <input>_completed.xlsx            Updated Excel with IDs + enriched notes');
  console.log('  publication_status.json            Crash-safe progress sidecar\n');
}

// Build a Map<prefix, items[]> from "item master" sheet rows.
// Key = portion of Part Number before first '-'
function buildItemMasterIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const partNumber = String(row['Part Number'] || '').trim();
    if (!partNumber) continue;

    const dashIdx = partNumber.indexOf('-');
    const prefix = dashIdx > 0 ? partNumber.substring(0, dashIdx) : partNumber;

    if (!index.has(prefix)) {
      index.set(prefix, []);
    }
    index.get(prefix).push({
      partNumber,
      rev: String(row['Revision'] || '').trim(),
      description: String(row['Description'] || '').trim(),
      availInventory: parseFloat(row['Inventory']) || 0,
      unitCost: parseFloat(row['Unit Cost']) || 0,
      unit: String(row['Unit'] || '').trim()
    });
  }
  return index;
}

// Generate a markdown section with D365 item data
function buildD365NotesSection(matchedItems) {
  const dateStr = '02/06/2026';

  let md = '## D365 Item Information\n#\n\n';

  if (!matchedItems || matchedItems.length === 0) {
    md += 'No matching items found in D365.\n';
    return md;
  }

  md += '| Part Number | Rev | Description | Inventory | Unit Cost | Unit |\n';
  md += '|-------------|-----|-------------|---:|---:|------|\n';

  for (const item of matchedItems) {
    const inv = Number(item.availInventory).toLocaleString('en-US');
    const cost = '$' + Number(item.unitCost).toFixed(2);
    md += `| ${item.partNumber} | ${item.rev} | ${item.description} | ${inv} | ${cost} | ${item.unit} |\n`;
  }

  md += `\n#\n*Source: D365 item master as of ${dateStr}*`;
  return md;
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    showUsage();
    process.exit(0);
  }

  const excelFile = argv.i;
  const dryRun = argv['dry-run'] || false;

  if (!excelFile) {
    console.error('Error: -i <input.xlsx> is required');
    showUsage();
    process.exit(1);
  }

  if (!fs.existsSync(excelFile)) {
    console.error(`Error: Excel file not found: ${excelFile}`);
    process.exit(1);
  }

  console.log('=== Create Publications from Excel ===\n');
  if (dryRun) console.log('DRY RUN MODE\n');

  // Step 1: Read Excel (supports optional "item master" sheet for D365 enrichment)
  console.log(`1. Reading Excel: ${excelFile}`);
  const workbook = xlsx.readFile(excelFile);

  // Publications sheet: use named "publications" sheet if present, else first sheet
  const pubSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'publications')
    || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[pubSheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  if (data.length === 0) {
    console.error('   Excel file is empty.');
    process.exit(1);
  }
  console.log(`   ${data.length} rows from sheet: "${pubSheetName}"`);

  // Optional "item master" sheet for D365 enrichment
  const itemMasterSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'item master');
  let itemMasterRows = null;
  if (itemMasterSheetName) {
    const imSheet = workbook.Sheets[itemMasterSheetName];
    itemMasterRows = xlsx.utils.sheet_to_json(imSheet);
    console.log(`   ${itemMasterRows.length} rows from sheet: "${itemMasterSheetName}"`);
  } else {
    console.log('   No "item master" sheet found — D365 enrichment skipped');
  }

  // Build D365 index if item master data is available
  let itemMasterIndex = null;
  if (itemMasterRows) {
    itemMasterIndex = buildItemMasterIndex(itemMasterRows);
    console.log(`   Indexed ${itemMasterIndex.size} unique part prefixes`);
  }

  // Step 2: Validate required columns
  const requiredCols = [
    'onshape:folderId',
    'property:publication:Name',
    'property:publication:Description',
    'item:documentId',
    'item:elementId',
    'item:versionId'
  ];

  const headers = Object.keys(data[0]);
  const missingCols = requiredCols.filter(col => !headers.includes(col));
  if (missingCols.length > 0) {
    console.error(`   Missing required columns: ${missingCols.join(', ')}`);
    process.exit(1);
  }

  // Step 3: Group rows by publication name
  console.log('\n2. Grouping rows by publication name...');
  const groups = new Map();

  data.forEach((row, idx) => {
    const name = String(row['property:publication:Name'] || '').trim();
    if (!name) {
      console.warn(`   Row ${idx + 2}: missing property:publication:Name, skipping`);
      return;
    }

    const documentId = String(row['item:documentId'] || '').trim();
    const elementId = String(row['item:elementId'] || '').trim();
    const versionId = String(row['item:versionId'] || '').trim();

    if (!documentId || !elementId || !versionId) {
      console.warn(`   Row ${idx + 2}: missing item:documentId/elementId/versionId, skipping`);
      return;
    }

    if (!groups.has(name)) {
      groups.set(name, {
        name: name,
        description: String(row['property:publication:Description'] || '').trim(),
        notes: String(row['property:publication:Notes'] || '').trim(),
        folderId: String(row['onshape:folderId'] || '').trim(),
        items: [],
        rowIndices: []
      });
    }

    const group = groups.get(name);
    const uploadLevel = parseInt(row['uploadLevel'], 10) || 0;
    const fileExtension = String(row['File Extension'] || '').trim().toUpperCase();
    group.items.push({ documentId, elementId, versionId, uploadLevel, fileExtension });
    group.rowIndices.push(idx);
  });

  console.log(`   ${groups.size} publication(s) from ${data.length} rows`);

  // Step 3b: Enrich notes with D365 item master data
  if (itemMasterIndex) {
    console.log('\n   Enriching publications with D365 item data...');
    let enriched = 0;
    for (const [name, group] of groups) {
      const matchedItems = itemMasterIndex.get(name) || [];
      const d365Section = buildD365NotesSection(matchedItems);
      if (group.notes) {
        group.notes = group.notes + '\n\n' + d365Section;
      } else {
        group.notes = d365Section;
      }
      if (matchedItems.length > 0) enriched++;
    }
    console.log(`   ${enriched}/${groups.size} publications matched D365 items`);
  }

  // Step 4: Dry run — show summary
  if (dryRun) {
    console.log('\n--- Dry Run Summary ---');
    let i = 0;
    for (const [name, group] of groups) {
      i++;
      console.log(`\n  ${i}. "${name}"`);
      console.log(`     Description: ${group.description || '(none)'}`);
      const notesPreview = group.notes
        ? (group.notes.length > 100 ? group.notes.substring(0, 100) + '...' : group.notes)
        : '(none)';
      console.log(`     Notes: ${notesPreview}`);
      if (itemMasterIndex) {
        const d365Count = (itemMasterIndex.get(name) || []).length;
        console.log(`     D365 items: ${d365Count}`);
      }
      console.log(`     Folder: ${group.folderId}`);
      console.log(`     Items: ${group.items.length}`);
      group.items.forEach((item, j) => {
        let typeFlag;
        if (item.uploadLevel === 0) {
          const mime = MIME_TYPES[item.fileExtension] || 'application/octet-stream';
          typeFlag = `blob (${mime}, revisionId lookup at runtime)`;
        } else if (item.uploadLevel === 1) {
          typeFlag = 'part (revisionId lookup at runtime)';
        } else {
          typeFlag = 'assembly';
        }
        console.log(`       ${j + 1}. doc=${item.documentId} elem=${item.elementId} ver=${item.versionId} type=${typeFlag}`);
      });
    }
    console.log(`\n[DRY RUN] No API calls made.`);
    return;
  }

  // Step 5: Load sidecar for crash recovery
  const sidecarFile = pathModule.join(pathModule.dirname(excelFile), 'publication_status.json');
  const sidecar = loadSidecar(sidecarFile);
  console.log(`\n3. Sidecar: ${sidecarFile}`);

  const alreadyCreated = Object.keys(sidecar.publications).filter(
    name => sidecar.publications[name].publicationId
  );
  if (alreadyCreated.length > 0) {
    console.log(`   Resuming: ${alreadyCreated.length} publication(s) already created`);
  }

  // Step 6: Create publications sequentially
  console.log('\n4. Creating publications...\n');
  const groupEntries = [...groups.entries()];
  const total = groupEntries.length;
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < groupEntries.length; i++) {
    const [name, group] = groupEntries[i];

    // Skip if already created (resume support)
    if (sidecar.publications[name]?.publicationId) {
      const existingId = sidecar.publications[name].publicationId;
      skipped++;
      // Write ID, enriched notes, and saved revision IDs back to all rows in group
      const savedRevs = sidecar.publications[name].itemRevisions || [];
      group.items.forEach((item, j) => {
        const idx = group.rowIndices[j];
        data[idx]['onshape:publicationId'] = existingId;
        if (group.notes) data[idx]['property:publication:notes'] = group.notes;
        if (savedRevs[j]) {
          if (savedRevs[j].revisionId) data[idx]['item:revisionId'] = savedRevs[j].revisionId;
          if (savedRevs[j].partId) data[idx]['item:partId'] = savedRevs[j].partId;
        }
      });
      const pct = Math.round((i + 1) / total * 100);
      console.log(`  Progress: ${i + 1}/${total} (${pct}%) delay=${currentDelay}ms [${name} → already exists]`);
      continue;
    }

    // Validate folderId
    if (!group.folderId) {
      console.error(`  ERROR: "${name}" has no folderId, skipping`);
      sidecar.publications[name] = {
        error: 'Missing folderId',
        timestamp: new Date().toISOString()
      };
      saveSidecar(sidecarFile, sidecar);
      errors++;
      continue;
    }

    // Look up revision info for part studio items
    let revInfo = null;
    if (group.items.some(item => item.uploadLevel === 1)) {
      try {
        revInfo = await getRevisionInfo(name);
        console.log(`  Revision lookup for "${name}": partId=${revInfo.partId}, revisionId=${revInfo.revisionId}`);
      } catch (e) {
        console.log(`  WARNING: Could not look up revision for "${name}": ${e.message || e}`);
      }
    }

    // Look up revision info for blob items
    for (const item of group.items) {
      if (item.uploadLevel === 0) {
        try {
          item.blobRevInfo = await getBlobRevisionInfo(item.documentId, item.versionId, item.elementId);
          if (item.blobRevInfo) {
            console.log(`  Blob revision lookup: revisionId=${item.blobRevInfo.revisionId}`);
          }
        } catch (e) {
          console.log(`  WARNING: Could not look up blob revision: ${e.message || e}`);
        }
      }
    }

    // Build request body
    const body = {
      name: group.name,
      description: group.description,
      parentId: group.folderId,
      ownerId: COMPANY_ID,
      ownerType: 1,
      items: group.items.map(item => {
        const entry = {
          documentId: item.documentId,
          elementId: item.elementId,
          versionId: item.versionId
        };
        if (item.uploadLevel === 0) {
          entry.isBlob = true;
          entry.dataType = MIME_TYPES[item.fileExtension] || 'application/octet-stream';
          if (item.blobRevInfo) {
            entry.revisionId = item.blobRevInfo.revisionId;
          }
        } else if (item.uploadLevel === 1) {
          if (revInfo) {
            entry.partId = revInfo.partId;
            entry.revisionId = revInfo.revisionId;
            entry.partName = revInfo.partName;
          } else {
            entry.isWholePartStudio = true;  // fallback if revision lookup failed
          }
        } else if (item.uploadLevel >= 2) {
          entry.isAssembly = true;
        }
        return entry;
      })
    };

    if (group.notes) {
      body.notes = group.notes;
    }

    try {
      const responseData = await postAsync({
        path: '/api/v13/publications',
        body: body
      });

      const result = JSON.parse(responseData.toString());
      const publicationId = result.id;

      if (!publicationId) {
        throw new Error('No id in response: ' + JSON.stringify(result).substring(0, 200));
      }

      // Save to sidecar (including per-item revision IDs for Excel output)
      sidecar.publications[name] = {
        publicationId: publicationId,
        itemCount: group.items.length,
        itemRevisions: group.items.map(item => ({
          revisionId: (item.blobRevInfo?.revisionId || (item.uploadLevel === 1 && revInfo ? revInfo.revisionId : null)),
          partId: (item.uploadLevel === 1 && revInfo ? revInfo.partId : null)
        })),
        timestamp: new Date().toISOString()
      };
      saveSidecar(sidecarFile, sidecar);

      // Write ID, enriched notes, and revision IDs back to all rows in group
      group.items.forEach((item, j) => {
        const idx = group.rowIndices[j];
        data[idx]['onshape:publicationId'] = publicationId;
        if (group.notes) data[idx]['property:publication:notes'] = group.notes;
        if (item.uploadLevel === 1 && revInfo) {
          data[idx]['item:revisionId'] = revInfo.revisionId;
          data[idx]['item:partId'] = revInfo.partId;
        }
        if (item.uploadLevel === 0 && item.blobRevInfo) {
          data[idx]['item:revisionId'] = item.blobRevInfo.revisionId;
        }
      });

      created++;
      const pct = Math.round((i + 1) / total * 100);
      console.log(`  Progress: ${i + 1}/${total} (${pct}%) delay=${currentDelay}ms [${name} → created ${publicationId}]`);

    } catch (err) {
      const errMsg = err.body || err.message || String(err);
      console.error(`  ERROR creating "${name}": ${errMsg}`);

      sidecar.publications[name] = {
        error: errMsg,
        timestamp: new Date().toISOString()
      };
      saveSidecar(sidecarFile, sidecar);
      errors++;
    }

    // Adaptive delay between requests
    if (i < groupEntries.length - 1) {
      await new Promise(r => setTimeout(r, currentDelay));
    }
  }

  // Step 7: Write completed Excel
  console.log('\n5. Writing output...');
  const ext = pathModule.extname(excelFile);
  const base = pathModule.basename(excelFile, ext);
  const dir = pathModule.dirname(excelFile);
  const outputPath = pathModule.join(dir, `${base}_completed${ext}`);

  const newWorkbook = xlsx.utils.book_new();
  const newWorksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, pubSheetName);

  // Preserve "item master" sheet in output if it existed
  if (itemMasterSheetName) {
    const imSheetCopy = workbook.Sheets[itemMasterSheetName];
    xlsx.utils.book_append_sheet(newWorkbook, imSheetCopy, itemMasterSheetName);
  }

  xlsx.writeFile(newWorkbook, outputPath);

  console.log(`   Output Excel: ${outputPath}`);
  console.log(`   Sidecar: ${sidecarFile}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Total publications: ${total}`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
