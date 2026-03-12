var onshape = require('./lib/onshape.js');
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));

if (argv['h'] || argv['help'] || !argv['d'] || !argv['desc']) {
  console.log('\nUpdate the description of an Onshape document.\n');
  console.log('Usage: node updateDocumentDescription.js -d <documentId> --desc <description>\n');
  console.log('Options:');
  console.log('  -d          Document ID (required)');
  console.log('  --desc      New description text (required)');
  console.log('  -h, --help  Show this help message');
  process.exit(argv['h'] || argv['help'] ? 0 : 1);
}

var documentId = argv['d'];
var description = argv['desc'];

var opts = {
  path: '/api/documents/' + documentId,
  body: {
    description: description
  }
};

console.log('Updating document ' + documentId + '...');

onshape.post(opts, function(data, err) {
  if (err) {
    console.error('Failed to update document:', err);
    process.exit(1);
  }

  var result = JSON.parse(data);
  console.log('Document updated successfully.');
  console.log('Name: ' + result.name);
  console.log('Description: ' + result.description);
});
