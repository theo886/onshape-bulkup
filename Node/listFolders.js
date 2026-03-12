const onshape = require('./lib/onshape.js');

const folderId = process.argv[2] || 'f3eb073add8445dc53877a76';

function getFolderContents(folderId) {
  return new Promise((resolve, reject) => {
    onshape.get({
      path: `/api/globaltreenodes/folder/${folderId}`
    }, (data, err) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function main() {
  try {
    console.log(`Fetching contents of folder: ${folderId}\n`);
    const folderData = await getFolderContents(folderId);
    
    // Parse the JSON string if needed
    const parsed = typeof folderData === 'string' ? JSON.parse(folderData) : folderData;
    
    if (parsed.items) {
      const folders = parsed.items.filter(item => item.resourceType === 'folder');
      console.log(`Found ${folders.length} subfolders:\n`);
      console.log('Folder Name\tFolder ID');
      console.log('-----------\t---------');
      folders.forEach(folder => {
        console.log(`${folder.name}\t${folder.id}`);
      });
    } else {
      console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 2000));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
