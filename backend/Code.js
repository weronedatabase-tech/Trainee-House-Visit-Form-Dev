// =====================================================================
// 2. BACKEND ENVIRONMENT CONFIGURATION
// (Environment settings are now managed in config.js)
// =====================================================================

function getSpreadsheetId() {
  return typeof APP_ENVIRONMENT !== 'undefined' && APP_ENVIRONMENT === "Exp" ? EXP_SPREADSHEET_ID : PROD_SPREADSHEET_ID;
}

const FORM_SHEET_NAME = "Form Responses 1";
const LOOKUP_SHEET_NAME = "lookup";
const MAPPING_SHEET_NAME = "Field-Section-Mapping";

function setupPasswords() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_PASSWORD')) props.setProperty('APP_PASSWORD', 'compassion');
  if (!props.getProperty('SETTINGS_PASSWORD')) props.setProperty('SETTINGS_PASSWORD', 'werone');
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ 
    status: "Online", 
    version: "v20",
    mode: typeof APP_ENVIRONMENT !== 'undefined' && APP_ENVIRONMENT === "Exp" ? "Experimentation" : "Production"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    let requestData = {};
    if (e.postData && e.postData.contents) requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;
    
    // AUTH
    if (action === 'login') return sendJSON({ success: requestData.password === props.getProperty('APP_PASSWORD') });
    if (action === 'validateSettings') return sendJSON({ success: requestData.password === props.getProperty('SETTINGS_PASSWORD') });
    if (action === 'changePassword') {
      const prop = requestData.type === 'APP' ? 'APP_PASSWORD' : 'SETTINGS_PASSWORD';
      props.setProperty(prop, requestData.newPassword);
      return sendJSON({ success: true });
    }

    const ss = SpreadsheetApp.openById(getSpreadsheetId());
    const formSheet = ss.getSheetByName(FORM_SHEET_NAME);
    const lookupSheet = ss.getSheetByName(LOOKUP_SHEET_NAME);
    const mappingSheet = ss.getSheetByName(MAPPING_SHEET_NAME);

    // CONFIG
    if (action === 'getConfig') {
      let headers =[];
      if (formSheet) {
        headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      }

      let uniqueNames = [], uniqueProjects =[];
      if (lookupSheet && lookupSheet.getLastRow() > 1) {
        const lookupHeaders = lookupSheet.getRange(1, 1, 1, lookupSheet.getLastColumn()).getValues()[0];
      
        let nameCol = lookupHeaders.findIndex(h => String(h).toLowerCase().includes("name") || String(h).toLowerCase().includes("trainee"));
        if (nameCol === -1) nameCol = 0;
        const rawNames = lookupSheet.getRange(2, nameCol + 1, lookupSheet.getLastRow() - 1, 1).getValues();
        uniqueNames =[...new Set(rawNames.flat().filter(n => n && String(n).trim() !== ""))];

        let projCol = lookupHeaders.findIndex(h => String(h).toLowerCase().includes("project"));
        if (projCol > -1) {
           const rawProjects = lookupSheet.getRange(2, projCol + 1, lookupSheet.getLastRow() - 1, 1).getValues();
           uniqueProjects =[...new Set(rawProjects.flat().filter(p => p && String(p).trim() !== ""))];
        }
      }

      let fieldMapping = {};
      let sectionOrder =[];
    
      if (mappingSheet) {
        const lastCol = mappingSheet.getLastColumn();
        if (lastCol > 0) {
          const mapRange = mappingSheet.getRange(1, 1, 2, lastCol).getValues();
          const mapFields = mapRange[0];
          const mapSections = mapRange[1];

          mapFields.forEach((field, i) => {
            if (field && mapSections[i]) {
              fieldMapping[String(field).trim()] = String(mapSections[i]).trim();
            }
          });
        }

        const orderRange = mappingSheet.getRange(15, 1, 26, 1).getValues();
        sectionOrder = orderRange.flat().filter(s => s && String(s).trim() !== "");
      }

      return sendJSON({
        headers: headers,
        trainees: uniqueNames,
        projects: uniqueProjects,
        mapping: fieldMapping,
        sectionOrder: sectionOrder
      });
    }

    // HISTORY (FIXED: MAPS BY HEADER NAME NOW, SORTS BY TIMESTAMP)
    if (action === 'getHistory') {
      const traineeName = requestData.trainee;
      const data = formSheet.getDataRange().getValues();
      const headers = data[0];
    
      // 1. Find Trainee Name Column
      let nameIndex = headers.findIndex(h => {
         const s = String(h).toLowerCase();
         return s.includes("trainee") && s.includes("name");
      });

      // 2. Fallback: Search for "Name" but EXCLUDE Volunteer/Caregiver/Parent
      if (nameIndex === -1) {
         nameIndex = headers.findIndex(h => {
             const s = String(h).toLowerCase();
             return s.includes("name") && !s.includes("volunteer") && !s.includes("caregiver") && !s.includes("parent");
         });
      }

      if (nameIndex === -1) return sendJSON({});

      // 3. Find Timestamp Column (Strictly using Timestamp now, ignoring Date of Visit)
      let timestampIndex = headers.findIndex(h => String(h).toLowerCase().includes("timestamp"));

      // 4. Collect Matches
      let matches =[];
      for (let i = 1; i < data.length; i++) {
         if (String(data[i][nameIndex]).trim() === String(traineeName).trim()) {
             matches.push({
                 rowIndex: i,
                 timestampVal: timestampIndex > -1 ? data[i][timestampIndex] : null,
                 rowData: data[i]
             });
         }
      }

      if (matches.length === 0) return sendJSON({});

      // Helper function to safely parse dates regardless of if they are JS Date objects or text
      const getEpoch = (val) => {
          if (!val) return 0;
          if (val instanceof Date) return val.getTime(); // Handle native Apps Script date objects
          const parsedTime = new Date(val).getTime(); // Handle Format 1 (11/26/2022) & Format 2 (ISO) strings
          return isNaN(parsedTime) ? 0 : parsedTime;
      };

      // 5. Sort Matches (Latest First using the Timestamp)
      matches.sort((a, b) => {
         if (timestampIndex > -1) {
             const timeA = getEpoch(a.timestampVal);
             const timeB = getEpoch(b.timestampVal);
             
             // If both dates are valid, sort descending
             if (timeA > 0 && timeB > 0) return timeB - timeA;
             // If only one is valid, push the valid one to the top
             if (timeA > 0) return -1;
             if (timeB > 0) return 1;
         }
         // Fallback: If timestamps are missing/invalid, highest row number is the newest
         return b.rowIndex - a.rowIndex; 
      });

      // 6. Return Map { "Header Name": "Value" } instead of { Index: Value }
      const bestMatch = matches[0].rowData;
      let result = {};
      headers.forEach((h, idx) => {
          const headerKey = String(h); // Ensure string key
          result[headerKey] = bestMatch[idx];
      });
      return sendJSON(result);
    }

    // SUBMIT
    if (action === 'submit') {
      // 1. Append the form response
      formSheet.appendRow(requestData.row);
      
      // 2. Auto-add new trainee to lookup sheet
      const newTraineeName = requestData.traineeName;
      if (newTraineeName && String(newTraineeName).trim() !== "" && lookupSheet) {
        const cleanNewName = String(newTraineeName).trim();
        const lookupHeaders = lookupSheet.getRange(1, 1, 1, lookupSheet.getLastColumn()).getValues()[0];
        
        // Find the Trainee Name column in the lookup sheet
        let nameCol = lookupHeaders.findIndex(h => String(h).toLowerCase().includes("name") || String(h).toLowerCase().includes("trainee"));
        if (nameCol === -1) nameCol = 0; // Fallback to column A
        
        // Get all existing names to check for duplicates and find the last row of THIS specific column
        const colValues = lookupSheet.getRange(1, nameCol + 1, lookupSheet.getMaxRows(), 1).getValues();
        let existingNames =[];
        let lastRowInCol = 0;
        
        for (let i = 0; i < colValues.length; i++) {
          const val = colValues[i][0];
          if (val !== "") {
            existingNames.push(String(val).trim().toLowerCase());
            lastRowInCol = i + 1;
          }
        }
        
        // If the name doesn't exist, append it to the bottom of the column
        if (!existingNames.includes(cleanNewName.toLowerCase())) {
          lookupSheet.getRange(lastRowInCol + 1, nameCol + 1).setValue(cleanNewName);
        }
      }
      
      return sendJSON({ success: true });
    }

    // COLUMNS
    if (action === 'addColumn') {
      formSheet.getRange(1, formSheet.getLastColumn() + 1).setValue(requestData.headerName);
      return sendJSON({ success: true });
    }
    if (action === 'renameColumn') {
      formSheet.getRange(1, parseInt(requestData.colIndex) + 1).setValue(requestData.newName);
      return sendJSON({ success: true });
    }

    if (action === 'generateMockData') {
      if (typeof APP_ENVIRONMENT === 'undefined' || APP_ENVIRONMENT !== "Exp") {
        return sendJSON({ error: "Only available in Experimentation mode." });
      }
      
      const file = DriveApp.getFileById(ss.getId());
      const parents = file.getParents();
      let folder = DriveApp.getRootFolder();
      if (parents.hasNext()) {
        folder = parents.next();
      }
      
      const newFile = file.makeCopy("Mock Data - " + ss.getName(), folder);
      const mockSS = SpreadsheetApp.openById(newFile.getId());
      
      const mFormSheet = mockSS.getSheetByName(FORM_SHEET_NAME);
      const mLookupSheet = mockSS.getSheetByName(LOOKUP_SHEET_NAME);
      
      if (mFormSheet) {
        if (mFormSheet.getLastRow() > 1) {
          mFormSheet.getRange(2, 1, mFormSheet.getLastRow() - 1, mFormSheet.getLastColumn()).clearContent();
        }
        
        const headers = mFormSheet.getRange(1, 1, 1, mFormSheet.getLastColumn()).getValues()[0];
        const mockDataRows = [];
        const mockTrainees = [];
        for (let i = 1; i <= 100; i++) {
           mockTrainees.push("Mock Trainee " + i);
        }
        
        const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
        const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
        const streets = ["Orchard Road", "Changi Business Park", "Marina Boulevard", "Tampines Avenue", "Jurong East Street", "Woodlands Drive", "Bukit Batok East", "Serangoon North", "Bishan Street", "Yishun Ring Road"];
        
        for (let i = 0; i < 100; i++) {
          let row = [];
          headers.forEach(h => {
            const rawH = String(h);
            const lowerH = rawH.toLowerCase();
            
            // Replicate App.js field detection logic
            const isDate = lowerH.includes('date') || lowerH.includes('dob') || lowerH.includes('birthday') || lowerH.includes('timestamp');
            const isLikertScale = lowerH.includes('mobility') || lowerH.includes('comprehension') || lowerH.includes('verbal');
            const isProjectField = lowerH.trim() === 'project';
            const shortKeywords = ['name','nric','gender','sex','race','religion','blood','height','weight','shirt','relation','contact','mobile','phone','email'];
            const isShortInput = shortKeywords.some(k => lowerH.includes(k));
            const isLongText = !isDate && !isShortInput && !isProjectField && !isLikertScale;

            if (lowerH.includes("timestamp") || (isDate && lowerH.includes("visit"))) {
               row.push(new Date(Date.now() - Math.floor(Math.random() * 31536000000)));
            } else if (isDate) {
               // E.g., Date of birth
               const start = new Date(1960, 0, 1).getTime();
               const end = new Date(2005, 0, 1).getTime();
               row.push(new Date(start + Math.random() * (end - start)));
            } else if (isLikertScale) {
               row.push(Math.floor(Math.random() * 5) + 1);
            } else if (isProjectField) {
               row.push("Mock Project " + (Math.floor(Math.random() * 5) + 1));
            } else if (isShortInput) {
               if (lowerH.includes("name") && lowerH.includes("trainee")) {
                  row.push(mockTrainees[i]);
               } else if (lowerH.includes("name") || lowerH.includes("volunteer")) {
                  const randomFirst = firstNames[Math.floor(Math.random() * firstNames.length)];
                  const randomLast = lastNames[Math.floor(Math.random() * lastNames.length)];
                  row.push(randomFirst + " " + randomLast);
               } else if (lowerH.includes("nric") || lowerH.includes("id")) {
                  row.push(Math.floor(Math.random() * 900 + 100) + String.fromCharCode(65 + Math.floor(Math.random() * 26)));
               } else if (lowerH.includes("blood")) {
                  const bloodTypes = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
                  row.push(bloodTypes[Math.floor(Math.random() * bloodTypes.length)]);
               } else if (lowerH.includes("contact") || lowerH.includes("phone") || lowerH.includes("mobile")) {
                  row.push("8" + Math.floor(Math.random() * 9000000 + 1000000));
               } else if (lowerH.includes("gender") || lowerH.includes("sex")) {
                  row.push(Math.random() > 0.5 ? "Male" : "Female");
               } else if (lowerH.includes("race") || lowerH.includes("ethnicity")) {
                  const races = ["Chinese", "Malay", "Indian", "Eurasian", "Others"];
                  row.push(races[Math.floor(Math.random() * races.length)]);
               } else if (lowerH.includes("religion")) {
                  const rel = ["Buddhism", "Christianity", "Islam", "Hinduism", "Free Thinker", "Others"];
                  row.push(rel[Math.floor(Math.random() * rel.length)]);
               } else if (lowerH.includes("shirt")) {
                  const sizes = ["S", "M", "L", "XL", "XXL"];
                  row.push(sizes[Math.floor(Math.random() * sizes.length)]);
               } else if (lowerH.includes("relation")) {
                  const rels = ["Mother", "Father", "Sibling", "Spouse", "Child", "Guardian"];
                  row.push(rels[Math.floor(Math.random() * rels.length)]);
               } else if (lowerH.includes("weight")) {
                  row.push((Math.floor(Math.random() * 40) + 50) + " kg");
               } else if (lowerH.includes("height")) {
                  row.push((Math.floor(Math.random() * 40) + 150) + " cm");
               } else if (lowerH.includes("email")) {
                  row.push("mock" + i + "@example.com");
               } else {
                  row.push("Short Text Entry");
               }
            } else if (isLongText) {
               if (lowerH.includes("address")) {
                  const blk = Math.floor(Math.random() * 900) + 1;
                  const street = streets[Math.floor(Math.random() * streets.length)];
                  const unit = "#" + (Math.floor(Math.random() * 20) + 1) + "-" + (Math.floor(Math.random() * 900) + 100);
                  row.push("Blk " + blk + " " + street + " " + unit);
               } else if (lowerH.includes("pressure") || lowerH.includes("bp")) {
                  row.push((Math.floor(Math.random() * 40) + 100) + "/" + (Math.floor(Math.random() * 20) + 70));
               } else if (lowerH.includes("heart rate") || lowerH.includes("pulse")) {
                  row.push(Math.floor(Math.random() * 40) + 60);
               } else if (lowerH.includes("status")) {
                  const statuses = ["Active", "Pending", "Completed", "Follow-up Needed"];
                  row.push(statuses[Math.floor(Math.random() * statuses.length)]);
               } else if (lowerH.includes("is ") || lowerH.includes("has ") || lowerH.includes("did ") || lowerH.includes("can ")) {
                  row.push(Math.random() > 0.5 ? "Yes" : "No");
               } else {
                  const notes = [
                     "Session went very well today, making good overall progress.", 
                     "Needs more attention on the physical exercises next time.", 
                     "Engaged actively and communicated clearly with the team.", 
                     "A bit tired today, kept the session light and easy.", 
                     "Excellent participation and high energy levels observed.", 
                     "Follow up required next week regarding the new routine.", 
                     "No major issues to report, continuing with current plan."
                  ];
                  row.push(notes[Math.floor(Math.random() * notes.length)]);
               }
            } else {
               row.push("Mock Data");
            }
          });
          mockDataRows.push(row);
        }
        
        if (mockDataRows.length > 0) {
          mFormSheet.getRange(mFormSheet.getLastRow() + 1, 1, mockDataRows.length, headers.length).setValues(mockDataRows);
        }
        
        if (mLookupSheet) {
          if (mLookupSheet.getLastRow() > 1) {
            mLookupSheet.getRange(2, 1, mLookupSheet.getLastRow() - 1, mLookupSheet.getLastColumn()).clearContent();
          }
          const lHeaders = mLookupSheet.getRange(1, 1, 1, mLookupSheet.getLastColumn()).getValues()[0];
          let nameCol = lHeaders.findIndex(h => String(h).toLowerCase().includes("name") || String(h).toLowerCase().includes("trainee"));
          if (nameCol === -1) nameCol = 0;
          const traineeRows = mockTrainees.map(t => [t]);
          mLookupSheet.getRange(mLookupSheet.getLastRow() + 1, nameCol + 1, traineeRows.length, 1).setValues(traineeRows);
        }
      }
      
      return sendJSON({ success: true, url: newFile.getUrl() });
    }

    return sendJSON({ error: "Unknown Action" });

  } catch (err) { return sendJSON({ success: false, error: err.toString() }); }
  finally { lock.releaseLock(); }
}

function sendJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this function manually in the Google Apps Script IDE 
 * to trigger the authorization popup for Drive and Sheets scopes.
 */
function triggerAuthorization() {
  // The static analyzer scans all code (even unreachable code) to determine scopes.
  // By explicitly referencing makeCopy and setTrashed, we force Google to ask for full Drive access.
  if (false) {
    var dummyFile = DriveApp.getFileById("dummy_id");
    dummyFile.makeCopy("dummy_name");
    dummyFile.setTrashed(true);
    DriveApp.getFiles();
  }
  Logger.log("Authorization scopes detected. If no popup appears, follow the instructions to revoke cached permissions.");
}
