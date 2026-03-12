const onshape = require('./lib/onshape.js');
const config = require('./config/apikey.js');

const COMPANY_ID = config.companyId;
const BASE_FOLDER_ID = config.baseFolderId;

/**
 * Create a new folder in Onshape
 * @param {string} name - Folder name
 * @param {string} parentId - Parent folder ID (defaults to base folder)
 * @param {function} callback - Callback(result, error)
 */
function createFolder(name, parentId, callback) {
  if (typeof parentId === 'function') {
    callback = parentId;
    parentId = BASE_FOLDER_ID;
  }

  console.log(`Creating folder "${name}" in parent ${parentId}...`);

  onshape.post({
    path: '/api/folders',
    body: {
      name: name,
      ownerId: COMPANY_ID,
      ownerType: 1,
      parentId: parentId
    }
  }, (data, err) => {
    if (err) {
      console.error('Failed to create folder:', err.body || err);
      callback(null, err);
    } else {
      const result = JSON.parse(data.toString());
      console.log('Folder created:', result.id);
      callback(result);
    }
  });
}

// Run if called directly
if (require.main === module) {
  const folderName = process.argv[2] || 'Test Folder';

  createFolder(folderName, (result, err) => {
    if (err) {
      process.exit(1);
    }
    console.log('Done. Folder ID:', result.id);
  });
}

module.exports = { createFolder };
