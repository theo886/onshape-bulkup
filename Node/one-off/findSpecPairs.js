const XLSX = require('xlsx');
const fs = require('fs');
const wb = XLSX.readFile('/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Final']);

// Group files by document name
const docFiles = new Map();

rows.forEach(row => {
  const docName = String(row['document:name'] || '');
  const fileName = String(row['File Name'] || '');
  const ext = String(row['File Extension'] || '').toLowerCase();

  if (!docName || !fileName) return;

  if (!docFiles.has(docName)) {
    docFiles.set(docName, []);
  }
  docFiles.get(docName).push({ fileName, ext, row });
});

// Find -spec PDFs that have a matching non-spec PDF in same document
const specPairs = [];

docFiles.forEach((files, docName) => {
  const pdfs = files.filter(f => f.ext === '.pdf' || f.fileName.toLowerCase().endsWith('.pdf'));

  pdfs.forEach(pdf => {
    const name = pdf.fileName.toLowerCase();
    if (name.includes('-spec')) {
      // Look for matching non-spec version
      const nonSpecName = name.replace(/-spec/gi, '');
      const matchingNonSpec = pdfs.find(other => {
        const otherName = other.fileName.toLowerCase();
        return otherName === nonSpecName && !otherName.includes('-spec');
      });

      if (matchingNonSpec) {
        specPairs.push({
          document: docName,
          specFile: pdf.fileName,
          nonSpecFile: matchingNonSpec.fileName
        });
      }
    }
  });
});

// Output CSV
const csv = ['document,specFile,nonSpecFile'];
specPairs.forEach(p => {
  csv.push(p.document + ',' + p.specFile + ',' + p.nonSpecFile);
});

fs.writeFileSync('./output/spec_pdf_pairs.csv', csv.join('\n'));
console.log('Saved to output/spec_pdf_pairs.csv');
console.log('Total pairs:', specPairs.length);
