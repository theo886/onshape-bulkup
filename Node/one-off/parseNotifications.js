const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const args = minimist(process.argv.slice(2), {
  string: ['i', 'o'],
  boolean: ['h', 'help', 'summary', 'json'],
  alias: { i: 'input', o: 'output', h: 'help' },
  default: { summary: true }
});

if (args.help || args.h || !args.input) {
  console.log('Parse Onshape Notifications');
  console.log('');
  console.log('Usage: node parseNotifications.js -i <notifications.txt> [options]');
  console.log('');
  console.log('Options:');
  console.log('  -i, --input     Notifications text file (required)');
  console.log('  -o, --output    Output JSON file (optional)');
  console.log('  --summary       Show summary (default: true)');
  console.log('  --json          Output full JSON to console');
  console.log('  -h, --help      Show this help');
  process.exit(0);
}

const inputFile = args.input;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n');

// Results
const results = {
  translationFailures: [],   // { filename, error }
  translationSuccesses: [],  // { filename }
  releaseFailures: [],       // { partNumber, error, precedingTranslation }
  releaseSuccesses: [],      // { filename or partNumber if can be inferred }
  summary: {
    translationFailures: 0,
    translationSuccesses: 0,
    releaseFailures: 0,
    releaseSuccesses: 0,
    failureReasons: {}
  }
};

// Parse line by line
let i = 0;
while (i < lines.length) {
  const line = lines[i].trim();

  // Translation failed
  const translationFailMatch = line.match(/^(.+?)\s+failed to translate:$/);
  if (translationFailMatch) {
    const filename = translationFailMatch[1];
    const errorLine = lines[i + 1] ? lines[i + 1].trim() : 'Unknown error';
    results.translationFailures.push({ filename, error: errorLine });
    results.summary.translationFailures++;

    // Track error reasons
    if (!results.summary.failureReasons[errorLine]) {
      results.summary.failureReasons[errorLine] = { count: 0, type: 'translation', files: [] };
    }
    results.summary.failureReasons[errorLine].count++;
    results.summary.failureReasons[errorLine].files.push(filename);

    i += 2;
    continue;
  }

  // Translation success
  const translationSuccessMatch = line.match(/^(.+?)\s+was translated successfully\.$/);
  if (translationSuccessMatch) {
    const filename = translationSuccessMatch[1];
    results.translationSuccesses.push({ filename });
    results.summary.translationSuccesses++;
    i++;
    continue;
  }

  // Failed release
  if (line === 'Failed transition: Release') {
    // Look for Error line
    let errorLine = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (lines[j].trim().startsWith('Error:')) {
        errorLine = lines[j].trim();
        break;
      }
    }

    // Extract part number from error
    const partNumberMatch = errorLine.match(/part number:\s*(.+?)\.?$/);
    const partNumber = partNumberMatch ? partNumberMatch[1] : 'Unknown';

    // Look ahead for the next translation (success or failure) - this is the file that was translated right before this release
    let precedingTranslation = null;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const lookLine = lines[j].trim();
      const successMatch = lookLine.match(/^(.+?)\s+was translated successfully\.$/);
      const failMatch = lookLine.match(/^(.+?)\s+failed to translate:$/);
      if (successMatch) {
        precedingTranslation = { filename: successMatch[1], status: 'success' };
        break;
      } else if (failMatch) {
        precedingTranslation = { filename: failMatch[1], status: 'failed' };
        break;
      }
    }

    results.releaseFailures.push({ partNumber, error: errorLine, precedingTranslation });
    results.summary.releaseFailures++;

    // Track release failure reasons (simplified)
    const releaseErrorKey = errorLine.replace(/part number:\s*.+$/, 'part number: [PN]');
    if (!results.summary.failureReasons[releaseErrorKey]) {
      results.summary.failureReasons[releaseErrorKey] = { count: 0, type: 'release', partNumbers: [] };
    }
    results.summary.failureReasons[releaseErrorKey].count++;
    results.summary.failureReasons[releaseErrorKey].partNumbers.push(partNumber);

    i++;
    continue;
  }

  // Successful release
  if (line.includes('performed transition Release')) {
    // Try to find related filename from nearby translation success
    results.releaseSuccesses.push({ raw: line });
    results.summary.releaseSuccesses++;
    i++;
    continue;
  }

  i++;
}

// Cross-reference: For each release failure, check if the part was translated successfully
const translatedFiles = new Set(results.translationSuccesses.map(t => {
  // Extract part number from filename (remove extension)
  return t.filename.replace(/\.(SLDPRT|sldprt|SLDASM|sldasm)$/, '');
}));

const failedTranslations = new Set(results.translationFailures.map(t => {
  return t.filename.replace(/\.(SLDPRT|sldprt|SLDASM|sldasm)$/, '');
}));

// Categorize release failures by translation status
const releaseFailureAnalysis = {
  translatedButFailedRelease: [],  // Part translated OK but release failed
  translationFailed: [],            // Part translation failed (so no release possible)
  unknown: []                       // Part number not found in translations
};

results.releaseFailures.forEach(rf => {
  const pn = rf.partNumber.trim();
  if (translatedFiles.has(pn)) {
    releaseFailureAnalysis.translatedButFailedRelease.push(pn);
  } else if (failedTranslations.has(pn)) {
    releaseFailureAnalysis.translationFailed.push(pn);
  } else {
    releaseFailureAnalysis.unknown.push(pn);
  }
});

// Output
console.log('='.repeat(70));
console.log('ONSHAPE NOTIFICATIONS ANALYSIS');
console.log('='.repeat(70));
console.log(`\nFile: ${inputFile}`);
console.log(`Total lines: ${lines.length}`);

console.log('\n' + '-'.repeat(40));
console.log('SUMMARY');
console.log('-'.repeat(40));
console.log(`Translation Successes:  ${results.summary.translationSuccesses}`);
console.log(`Translation Failures:   ${results.summary.translationFailures}`);
console.log(`Release Successes:      ${results.summary.releaseSuccesses}`);
console.log(`Release Failures:       ${results.summary.releaseFailures}`);

console.log('\n' + '-'.repeat(40));
console.log('FAILURE REASONS');
console.log('-'.repeat(40));
for (const [reason, data] of Object.entries(results.summary.failureReasons)) {
  console.log(`\n[${data.type.toUpperCase()}] ${reason}`);
  console.log(`  Count: ${data.count}`);
  if (data.files && data.files.length <= 10) {
    console.log(`  Files: ${data.files.join(', ')}`);
  } else if (data.partNumbers && data.partNumbers.length <= 10) {
    console.log(`  Part Numbers: ${data.partNumbers.join(', ')}`);
  } else {
    const items = data.files || data.partNumbers;
    console.log(`  First 10: ${items.slice(0, 10).join(', ')}...`);
  }
}

console.log('\n' + '-'.repeat(40));
console.log('RELEASE FAILURE ANALYSIS');
console.log('-'.repeat(40));
console.log(`\nParts that TRANSLATED OK but FAILED to RELEASE: ${releaseFailureAnalysis.translatedButFailedRelease.length}`);
if (releaseFailureAnalysis.translatedButFailedRelease.length > 0 && releaseFailureAnalysis.translatedButFailedRelease.length <= 20) {
  releaseFailureAnalysis.translatedButFailedRelease.forEach(pn => console.log(`  - ${pn}`));
} else if (releaseFailureAnalysis.translatedButFailedRelease.length > 20) {
  releaseFailureAnalysis.translatedButFailedRelease.slice(0, 20).forEach(pn => console.log(`  - ${pn}`));
  console.log(`  ... and ${releaseFailureAnalysis.translatedButFailedRelease.length - 20} more`);
}

console.log(`\nParts where TRANSLATION FAILED (release also failed): ${releaseFailureAnalysis.translationFailed.length}`);
if (releaseFailureAnalysis.translationFailed.length > 0 && releaseFailureAnalysis.translationFailed.length <= 20) {
  releaseFailureAnalysis.translationFailed.forEach(pn => console.log(`  - ${pn}`));
}

console.log(`\nParts with UNKNOWN translation status: ${releaseFailureAnalysis.unknown.length}`);
if (releaseFailureAnalysis.unknown.length > 0 && releaseFailureAnalysis.unknown.length <= 20) {
  releaseFailureAnalysis.unknown.forEach(pn => console.log(`  - ${pn}`));
} else if (releaseFailureAnalysis.unknown.length > 20) {
  releaseFailureAnalysis.unknown.slice(0, 20).forEach(pn => console.log(`  - ${pn}`));
  console.log(`  ... and ${releaseFailureAnalysis.unknown.length - 20} more`);
}

// Save output if requested
if (args.output) {
  const output = {
    summary: results.summary,
    releaseFailureAnalysis,
    translationFailures: results.translationFailures,
    translationSuccesses: results.translationSuccesses.map(t => t.filename),
    releaseFailures: results.releaseFailures,
    releaseSuccessCount: results.releaseSuccesses.length
  };
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  console.log(`\nSaved detailed results to: ${args.output}`);

  // Also save CSV files
  const baseDir = path.dirname(args.output);

  // Translation failures CSV
  const translationFailuresCsv = 'Filename,Error\n' +
    results.translationFailures.map(f => `"${f.filename}","${f.error}"`).join('\n');
  fs.writeFileSync(path.join(baseDir, 'translation_failures.csv'), translationFailuresCsv);
  console.log(`Saved: ${path.join(baseDir, 'translation_failures.csv')} (${results.translationFailures.length} rows)`);

  // Release failures CSV - with preceding translation filename
  const releaseFailuresCsv = 'Filename,PartNumber,Error\n' +
    results.releaseFailures.map(f => {
      const filename = f.precedingTranslation ? f.precedingTranslation.filename : '';
      return `"${filename}","${f.partNumber}","${f.error}"`;
    }).join('\n');
  fs.writeFileSync(path.join(baseDir, 'release_failures.csv'), releaseFailuresCsv);
  console.log(`Saved: ${path.join(baseDir, 'release_failures.csv')} (${results.releaseFailures.length} rows)`);

  // Parts that translated OK but failed release (the main issue)
  const translatedButFailedCsv = 'PartNumber\n' +
    releaseFailureAnalysis.translatedButFailedRelease.join('\n');
  fs.writeFileSync(path.join(baseDir, 'translated_but_release_failed.csv'), translatedButFailedCsv);
  console.log(`Saved: ${path.join(baseDir, 'translated_but_release_failed.csv')} (${releaseFailureAnalysis.translatedButFailedRelease.length} rows)`);
}

if (args.json) {
  console.log('\n' + '-'.repeat(40));
  console.log('FULL JSON OUTPUT');
  console.log('-'.repeat(40));
  console.log(JSON.stringify({
    translationFailures: results.translationFailures,
    releaseFailures: results.releaseFailures,
    releaseFailureAnalysis
  }, null, 2));
}

console.log('\n' + '='.repeat(70));
