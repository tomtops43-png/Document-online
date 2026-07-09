/**
 * Search.gs
 * จัดการระบบค้นหา Global Search (T_SearchIndex) ตาม Architecture 2.9
 */

var SHEET_SEARCH_INDEX = 'T_SearchIndex';
var SEARCH_INDEX_HEADER = ['entity_type', 'entity_id', 'line_id', 'station_id', 'doctype_id', 'keywords', 'updated_at'];

// เพิ่มชีท T_SearchIndex เข้าไปในระบบ (เรียกใช้ตอน setup หรือแยกต่างหาก)
function setupSearchIndex() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SEARCH_INDEX) || ss.insertSheet(SHEET_SEARCH_INDEX);
  sheet.getRange(1, 1, 1, SEARCH_INDEX_HEADER.length).setValues([SEARCH_INDEX_HEADER]);
  sheet.setFrozenRows(1);
}

/**
 * สร้างหรืออัปเดตดัชนีการค้นหาสำหรับ entity_id
 * entityType: 'Document' หรือ 'Record'
 */
function buildSearchIndex(entityType, entityId, lineId, stationId, doctypeId, keywords) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SEARCH_INDEX);
  if (!sheet) {
    setupSearchIndex();
    sheet = ss.getSheetByName(SHEET_SEARCH_INDEX);
  }
  
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  // วนหาว่ามี entity_id นี้ในดัชนีแล้วหรือยัง
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(entityType) && String(data[i][1]) === String(entityId)) {
      rowIndex = i + 1; // 1-based for Apps Script
      break;
    }
  }

  var updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  var rowData = [entityType, entityId, lineId || '', stationId || '', doctypeId || '', keywords || '', updated_at];

  if (rowIndex > -1) {
    // อัปเดตแถวเดิม
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // เพิ่มแถวใหม่
    sheet.appendRow(rowData);
  }
}

/**
 * ลบดัชนีการค้นหา (ถ้าเอกสารหรือ record ถูกลบ)
 */
function removeSearchIndex(entityType, entityId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SEARCH_INDEX);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(entityType) && String(data[i][1]) === String(entityId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

/**
 * ค้นหาข้อมูลผ่าน Web App (รับ query แล้ว filter ผ่าน T_SearchIndex)
 */
function actionSearch(params, user) {
  var query = String(params.query || '').trim().toLowerCase();
  var lineId = String(params.line || '').trim();
  var stationId = String(params.station || '').trim();
  var doctypeId = String(params.doctype || '').trim();

  if (!query && !lineId && !stationId && !doctypeId) {
    return { success: true, results: [] };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SEARCH_INDEX);
  if (!sheet) return { success: true, results: [] };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, results: [] };

  var out = [];
  // ค้นหาแบบ Full scan บนชีท T_SearchIndex เท่านั้น (เร็วมาก)
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rEntity = String(row[0]);
    var rId = String(row[1]);
    var rLine = String(row[2]);
    var rStation = String(row[3]);
    var rDoctype = String(row[4]);
    var rKeywords = String(row[5]).toLowerCase();
    var rUpdated = String(row[6]);

    // กรอง
    if (lineId && rLine && rLine !== lineId) continue;
    if (stationId && rStation && rStation.split(',').indexOf(stationId) < 0) continue; // station อาจเป็น comma-separated สำหรับ Document
    if (doctypeId && rDoctype && rDoctype !== doctypeId) continue;

    if (query) {
      // ค้นหาคำทุกคำ (AND)
      var terms = query.split(/\s+/);
      var matchAll = true;
      for (var t = 0; t < terms.length; t++) {
        if (rKeywords.indexOf(terms[t]) < 0) {
          matchAll = false;
          break;
        }
      }
      if (!matchAll) continue;
    }

    out.push({
      entity_type: rEntity,
      entity_id: rId,
      line: rLine,
      station: rStation,
      doctype: rDoctype,
      keywords: String(row[5]), // ส่งคำจริงกลับไปให้ไฮไลต์ได้
      updated_at: rUpdated
    });

    // จำกัดผลลัพธ์เพื่อประสิทธิภาพ
    if (out.length >= 100) break;
  }

  // เรียงลำดับตามวันที่อัปเดต (ใหม่สุดขึ้นก่อน)
  out.sort(function(a, b) { return a.updated_at < b.updated_at ? 1 : -1; });

  return { success: true, results: out };
}
