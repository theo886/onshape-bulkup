const onshape = require('./lib/onshape.js');

const documentId = 'b514be5375ddaa2d1b91372e';
const workspaceId = '6967c4cb2b697a174cb06517';

console.log('Testing document access...');
console.log(`Document ID: ${documentId}`);
console.log(`Workspace ID: ${workspaceId}`);

// Try to get document metadata first
const opts = {
  path: `/api/documents/${documentId}`
};

onshape.get(opts, (data, err) => {
  if (err) {
    console.log('\n❌ Failed to access document:');
    console.log(JSON.stringify(err, null, 2));
  } else {
    console.log('\n✓ Document accessible. Metadata:');
    const doc = JSON.parse(data.toString());
    console.log(`  Name: ${doc.name}`);
    console.log(`  Owner: ${doc.owner ? doc.owner.name : 'Unknown'}`);
    console.log(`  Created: ${doc.createdAt}`);

    // Now try to get elements
    console.log('\nTrying to get elements...');
    const elemOpts = {
      path: `/api/documents/d/${documentId}/w/${workspaceId}/elements`
    };

    onshape.get(elemOpts, (elemData, elemErr) => {
      if (elemErr) {
        console.log('❌ Failed to get elements:');
        console.log(JSON.stringify(elemErr, null, 2));
      } else {
        const elements = JSON.parse(elemData.toString());
        console.log(`✓ Found ${elements.length} elements`);
        elements.forEach(e => console.log(`  - ${e.elementType}: ${e.name}`));
      }
    });
  }
});
