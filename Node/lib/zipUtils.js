const AdmZip = require('adm-zip');
const path = require('path');

/**
 * List all SolidWorks part and assembly files in a ZIP
 * @param {string} zipPath - Path to the ZIP file
 * @returns {string[]} Array of filenames (without extension, lowercase)
 */
function listSolidWorksFiles(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    return entries
      .filter(e => !e.isDirectory)
      .filter(e => e.entryName.match(/\.(sldprt|sldasm)$/i))
      .map(e => {
        const filename = path.basename(e.entryName);
        // Remove extension and convert to lowercase for matching
        return filename.replace(/\.[^/.]+$/, '').toLowerCase();
      });
  } catch (err) {
    console.error(`  Warning: Could not read ZIP file: ${err.message}`);
    return [];
  }
}

/**
 * List all SolidWorks files with their full info
 * @param {string} zipPath - Path to the ZIP file
 * @returns {Array<{filename: string, path: string, type: string}>}
 */
function listSolidWorksFilesDetailed(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    return entries
      .filter(e => !e.isDirectory)
      .filter(e => e.entryName.match(/\.(sldprt|sldasm)$/i))
      .map(e => {
        const filename = path.basename(e.entryName);
        const ext = path.extname(filename).toLowerCase();
        return {
          filename: filename,
          baseName: filename.replace(/\.[^/.]+$/, '').toLowerCase(),
          path: e.entryName,
          type: ext === '.sldprt' ? 'part' : 'assembly'
        };
      });
  } catch (err) {
    console.error(`  Warning: Could not read ZIP file: ${err.message}`);
    return [];
  }
}

module.exports = {
  listSolidWorksFiles,
  listSolidWorksFilesDetailed
};
