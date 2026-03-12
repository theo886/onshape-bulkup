/**
 * Rebuild document cache from Onshape API.
 *
 * Queries all documents in specified folders and rebuilds the documentCache
 * in upload_status.json so assemblies can find their existing documents.
 *
 * Usage: node rebuildDocumentCache.js [options]
 *   -s <path>   Status file (default: Upload/upload_status.json)
 *   -f <id>     Folder ID to scan (can specify multiple times)
 *   --all       Scan all company documents (slow but complete)
 */

const fs = require('fs');
const minimist = require('minimist');
const onshape = require('./lib/onshape.js');

const COMPANY_ID = '6763516217765c31f9561958';

function rebuildDocumentCache(statusFile, folderIds, scanAll, callback) {
  // Load existing status
  let status = { documentCache: {}, partMapping: {}, assemblyMapping: {}, fileStatus: {}, folderCache: {} };
  if (fs.existsSync(statusFile)) {
    try {
      status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch (e) {
      console.warn('Warning: Could not parse status file, starting fresh');
    }
  }

  const originalCount = Object.keys(status.documentCache || {}).length;
  status.documentCache = status.documentCache || {};

  console.log(`Starting with ${originalCount} cached documents`);

  if (scanAll) {
    // Scan all company documents
    console.log('Scanning all company documents...');
    scanAllDocuments(status, (err) => {
      if (err) {
        console.error('Error scanning documents:', err);
      }
      finalize();
    });
  } else if (folderIds.length > 0) {
    // Scan specific folders
    console.log(`Scanning ${folderIds.length} folder(s)...`);
    let completed = 0;
    folderIds.forEach(folderId => {
      scanFolder(folderId, status, () => {
        completed++;
        if (completed === folderIds.length) {
          finalize();
        }
      });
    });
  } else {
    console.log('No folders specified. Use -f <folderId> or --all');
    callback(status);
    return;
  }

  function finalize() {
    const newCount = Object.keys(status.documentCache).length;
    console.log(`\nDocument cache: ${originalCount} -> ${newCount} entries (+${newCount - originalCount})`);

    // Save status
    status.lastUpdated = new Date().toISOString();
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.log(`Saved to: ${statusFile}`);
    callback(status);
  }
}

function scanAllDocuments(status, callback) {
  let offset = 0;
  const limit = 20;  // Onshape API max is 20
  let total = 0;

  function fetchBatch() {
    onshape.get({
      path: '/api/documents',
      query: {
        filter: 7,  // Company documents
        owner: COMPANY_ID,
        ownerType: 1,
        offset: offset,
        limit: limit
      }
    }, (data, err) => {
      if (err) {
        console.error('Error fetching documents:', err.body || err);
        callback(err);
        return;
      }

      const result = JSON.parse(data.toString());
      const docs = result.items || [];

      docs.forEach(doc => {
        // Cache by name:folderId
        const folderId = doc.parentId || 'root';
        const cacheKey = `${doc.name}:${folderId}`;
        status.documentCache[cacheKey] = {
          documentId: doc.id,
          workspaceId: doc.defaultWorkspace?.id
        };
        total++;
      });

      process.stdout.write(`\r  Fetched ${total} documents...`);

      if (docs.length === limit) {
        // More documents available
        offset += limit;
        setTimeout(fetchBatch, 100);
      } else {
        console.log(`\n  Total: ${total} documents`);
        callback(null);
      }
    });
  }

  fetchBatch();
}

function scanFolder(folderId, status, callback) {
  console.log(`\nScanning folder: ${folderId}`);

  onshape.get({
    path: `/api/folders/${folderId}`,
    query: { getPathToRoot: false }
  }, (folderData, folderErr) => {
    if (folderErr) {
      console.error(`  Error getting folder info: ${folderErr.body || folderErr}`);
    } else {
      const folder = JSON.parse(folderData.toString());
      console.log(`  Folder name: ${folder.name}`);
    }

    // Get folder contents
    onshape.get({
      path: '/api/globaltreenodes/folder/' + folderId,
      query: { getPathToRoot: false, includeAssemblies: false, offset: 0, limit: 500 }
    }, (data, err) => {
      if (err) {
        console.error(`  Error getting folder contents: ${err.body || err}`);
        callback();
        return;
      }

      const result = JSON.parse(data.toString());
      const items = result.items || [];

      let docCount = 0;
      let subfolders = [];

      items.forEach(item => {
        if (item.jsonType === 'document') {
          const cacheKey = `${item.name}:${folderId}`;
          status.documentCache[cacheKey] = {
            documentId: item.id,
            workspaceId: item.defaultWorkspaceId
          };
          docCount++;
        } else if (item.jsonType === 'folder') {
          subfolders.push(item.id);
        }
      });

      console.log(`  Found ${docCount} documents, ${subfolders.length} subfolders`);

      // Recursively scan subfolders
      if (subfolders.length > 0) {
        let completed = 0;
        subfolders.forEach(subfolderId => {
          scanFolder(subfolderId, status, () => {
            completed++;
            if (completed === subfolders.length) {
              callback();
            }
          });
        });
      } else {
        callback();
      }
    });
  });
}

// Main
function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.h || argv.help) {
    console.log(`
Rebuild document cache from Onshape API

Usage: node rebuildDocumentCache.js [options]

Options:
  -s <path>   Status file (default: Upload/upload_status.json)
  -f <id>     Folder ID to scan (can specify multiple: -f id1 -f id2)
  --all       Scan all company documents
  -h, --help  Show this help

Examples:
  node rebuildDocumentCache.js -f 104a8ac5a8e0216dc4e52728
  node rebuildDocumentCache.js --all
`);
    process.exit(0);
  }

  const statusFile = argv.s || 'Upload/upload_status.json';
  const scanAll = argv.all || false;

  // Handle multiple -f flags
  let folderIds = [];
  if (argv.f) {
    folderIds = Array.isArray(argv.f) ? argv.f : [argv.f];
  }

  rebuildDocumentCache(statusFile, folderIds, scanAll, () => {
    console.log('Done!');
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { rebuildDocumentCache };
