// =====================================================================
// 2. BACKEND ENVIRONMENT TOGGLE 
// Change this single value to "Dev" or "Prod"
// =====================================================================
const ENVIRONMENT = "Dev"; 

const DEV_SPREADSHEET_ID = "1C5C_9Wc-20DG-fBVn6OlLyvAqJnMXTIejR5SN1Dzk5M";
const PROD_SPREADSHEET_ID = "1tbw59RW6wDpe49V4mXohUaT4l2g8IpUrXh_qux3oa3c";

const SPREADSHEET_ID = ENVIRONMENT === "Dev" ? DEV_SPREADSHEET_ID : PROD_SPREADSHEET_ID;

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
    version: "v19",
    mode: ENVIRONMENT === "Dev" ? "Development" : "Production"
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

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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

    return sendJSON({ error: "Unknown Action" });

  } catch (err) { return sendJSON({ success: false, error: err.toString() }); }
  finally { lock.releaseLock(); }
}

function sendJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
