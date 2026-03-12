#!/usr/bin/env node
const onshape = require("./lib/onshape");
const XLSX = require("xlsx");

const docName = process.argv[2] || "41065";

const wb = XLSX.readFile("/Users/theo/Library/CloudStorage/OneDrive-EnergyRecovery/000_Product Engineering/00 - Projects/Onshape/Share/Onshape_Upload_Assem.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Final"]);
const row = rows.find(r => String(r["document:name"]) === docName);

if (!row) {
  console.log("Document", docName, "not found in Excel");
  process.exit(1);
}

const docId = row["onshape:documentId"];
console.log("Document:", docName);
console.log("Document ID:", docId);
console.log("Level:", row["uploadLevel"]);

onshape.get({ path: "/api/documents/" + docId }, (d, e) => {
  if (e) { console.log("Error:", e.body || e); return; }
  const doc = JSON.parse(d.toString());
  const wid = doc.defaultWorkspace?.id;
  console.log("Workspace ID:", wid);

  // Get all elements first
  onshape.get({ path: "/api/documents/d/" + docId + "/w/" + wid + "/elements" }, (elemData, elemErr) => {
    if (elemErr) { console.log("Elements error:", elemErr.body || elemErr); return; }
    const elements = JSON.parse(elemData.toString());
    console.log("\nElements found:", elements.length);
    console.log("");

    let blanks = 0;
    let checked = 0;

    function checkNext() {
      if (checked >= elements.length) {
        console.log("\nTotal blanks:", blanks);
        return;
      }

      const elem = elements[checked++];

      // Get metadata for each element individually
      onshape.get({
        path: "/api/metadata/d/" + docId + "/w/" + wid + "/e/" + elem.id
      }, (metaData, metaErr) => {
        if (metaErr) {
          console.log(" ", elem.name, "(" + elem.type + "): Error getting metadata");
          setTimeout(checkNext, 200);
          return;
        }

        const meta = JSON.parse(metaData.toString());
        const pn = meta.properties?.find(p => p.name === "Part Number" || p.name === "Part number" || p.propertyId === "57f3fb8efa3416c06701d60f")?.value || "";
        const status = pn.trim() ? pn : "** BLANK **";
        if (!pn.trim()) blanks++;
        console.log(" ", elem.name, "(" + elem.type + "):", status);

        setTimeout(checkNext, 200);
      });
    }

    checkNext();
  });
});
