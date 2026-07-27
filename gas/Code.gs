/**
 * ========================================================
 * Code.gs — Backend ระบบ First Piece / OK 1st Part
 * Google Apps Script Web App (Execute as: Me / Access: Anyone)
 *
 * Sheets ที่ต้องมีใน spreadsheet (ดู SETUP.md):
 *   Records | Recovery | Users | Config
 *   Records-<YYYY> — ชีท archive รายปี สร้างอัตโนมัติเมื่อมี record แรกของปีนั้น
 *   (ดูหัวข้อ "Records archive" ด้านล่าง — Records เดิมกลายเป็น legacy sheet แช่แข็ง)
 *
 * CORS: frontend ส่ง POST เป็น text/plain (เลี่ยง preflight)
 * อ่าน payload จาก e.postData.contents
 * ========================================================
 */

// ---------- ค่าคงที่ ----------
var SHEET_RECORDS = 'Records';
var SHEET_RECOVERY = 'Recovery';
var SHEET_USERS = 'Users';
var SHEET_CONFIG = 'Config';

var TOKEN_LIFETIME_HOURS = 12;

var RECORDS_HEADER = [
  'record_id', 'form_id', 'template_rev', 'mode', 'line', 'station', 'product_model', 'date', 'shift',
  'answers_json', 'photos_json', 'status', 'has_nok', 'reject_reason',
  'operator_id', 'operator_name', 'operator_ts',
  'leader_id', 'leader_name', 'leader_ts',
  'qi_id', 'qi_name', 'qi_ts',
  'created_at', 'updated_at',
  // เพิ่มใหม่ (ต่อท้าย — ปลอดภัยกับข้อมูลเดิม): doctype_id ใช้อ่าน workflow แบบ data-driven,
  // client_uuid เป็น idempotency key กัน record ซ้ำเมื่อเน็ตหลุดแล้ว submit ซ้ำ
  'doctype_id', 'client_uuid',
  // resubmit_of: record_id เดิมที่ถูกตีกลับแล้วกรอกใหม่จากปุ่ม "แก้ไขและส่งใหม่" (records.html)
  // ว่างสำหรับ record ปกติที่ไม่ใช่การส่งซ้ำ
  'resubmit_of'
];

// จำนวนแถวสูงสุดที่ getRecords คืนกลับ (กัน payload บวม/ช้าเมื่อ record โตหลักหมื่น)
var MAX_RECORDS_RETURN = 1000;
var RECOVERY_HEADER = [
  'record_id', 'item_id', 'problem', 'countermeasure',
  'operator_sign', 'operator_ts', 'leader_sign', 'leader_ts', 'decision'
];
var USERS_HEADER = [
  'employee_id', 'name', 'pin', 'role', 'line', 'token', 'token_expiry', 'active'
];

// ---------- entry points ----------
function doGet(e) {
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  var params;
  try {
    if (method === 'POST') {
      params = JSON.parse(e.postData.contents);
    } else {
      params = e.parameter || {};
    }
  } catch (err) {
    return jsonOut({ success: false, error: 'BAD_REQUEST: อ่านข้อมูลไม่ได้' });
  }

  var action = params.action || '';
  try {
    // login ไม่ต้องมี token
    if (action === 'login') return jsonOut(actionLogin(params));

    // ทุก action อื่นต้อง validate token
    var user = validateToken(params.token);
    if (!user) return jsonOut({ success: false, error: 'INVALID_TOKEN' });

    switch (action) {
      // ---- Master Data Layer (Migration Step 1-2) ----
      case 'master.getAll': return jsonOut(actionMasterGetAll(params, user));

      // ---- Admin: จัดการเอกสาร (self-service — Migration Step 2) ----
      case 'doc.register':    return jsonOut(actionDocRegister(params, user));
      case 'doc.addRevision': return jsonOut(actionDocAddRevision(params, user));
      case 'doc.assign':      return jsonOut(actionDocAssign(params, user));
      case 'doc.delete':      return jsonOut(actionDocDelete(params, user));
      case 'doc.update':      return jsonOut(actionDocUpdate(params, user));

      // ---- Admin: จัดการรายชื่อพนักงาน (M_Employee — dropdown Recorder) ----
      case 'employee.create': return jsonOut(actionEmployeeCreate(params, user));
      case 'employee.update': return jsonOut(actionEmployeeUpdate(params, user));
      case 'employee.delete': return jsonOut(actionEmployeeDelete(params, user));

      // ---- Dashboard / Notification / User management ----
      case 'stats.dashboard': return jsonOut(actionDashboardStats(params, user));
      case 'notif.list':      return jsonOut(actionNotifList(params, user));
      case 'notif.markRead':  return jsonOut(actionNotifMarkRead(params, user));
      case 'user.list':       return jsonOut(actionUserList(params, user));
      case 'user.create':     return jsonOut(actionUserCreate(params, user));
      case 'user.update':     return jsonOut(actionUserUpdate(params, user));

      // ---- ระบบเดิม (form-driven) — ยังทำงานเหมือนเดิมระหว่าง migration ----
      case 'getRecords':   return jsonOut(actionGetRecords(params, user));
      case 'getRecord':    return jsonOut(actionGetRecord(params, user));
      case 'getLogSheet':  return jsonOut(actionGetLogSheet(params, user));
      case 'createRecord': return jsonOut(actionCreateRecord(params, user));
      case 'approveRecord': return jsonOut(actionApproveRecord(params, user));
      case 'rejectRecord': return jsonOut(actionRejectRecord(params, user));
      case 'uploadPhoto':  return jsonOut(actionUploadPhoto(params, user));
      case 'uploadPhotoPending': return jsonOut(actionUploadPhotoPending(params, user));
      case 'uploadSignature': return jsonOut(actionUploadSignature(params, user));
      case 'addRecovery':  return jsonOut(actionAddRecovery(params, user));
      case 'search':       return jsonOut(actionSearch(params, user));
      default:
        return jsonOut({ success: false, error: 'UNKNOWN_ACTION: ' + action });
    }
  } catch (err) {
    return jsonOut({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- sheet helpers (อ่าน/เขียน batch เท่านั้น) ----------
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีท: ' + name + ' (รัน setupSheets() ก่อน)');
  return sheet;
}

// อ่านทั้งชีทเป็น array ของ object (key = header แถวแรก)
function readAll(sheetName) {
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { header: values[0] || [], rows: [] };
  var header = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _rowIndex: i + 1 }; // เลขแถวจริงในชีท
    for (var j = 0; j < header.length; j++) obj[header[j]] = values[i][j];
    rows.push(obj);
  }
  return { header: header, rows: rows };
}

// เขียนทับ 1 แถวจาก object ตาม header
function writeRow(sheetName, rowIndex, header, obj) {
  var row = header.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  getSheet(sheetName).getRange(rowIndex, 1, 1, header.length).setValues([row]);
}

// ========================================================
// Records archive — แยกชีทเป็นรายปี (Records-<YYYY>) กัน sheet เดียวโตจนช้า
// (ตาม docs/ARCHITECTURE.md ข้อ "Scalability ของ Google Sheets": Sheets ช้าเห็นชัด
// หลัง ~30-50k แถว, GAS execution มี quota 6 นาที/ครั้ง)
//
// ชีท "Records" เดิม (ไม่มีปีต่อท้าย) กลายเป็น legacy/archive แช่แข็งตั้งแต่ deploy นี้
// — ไม่ย้ายข้อมูลเดิม (additive ตามหลักการเดิม) เขียนใหม่ทั้งหมดตั้งแต่วันนี้ไปเข้า
// ชีทรายปีแทน (Records-2026, Records-2027, ...) สร้างอัตโนมัติเมื่อมี record แรกของปีนั้น
//
// record_id มีรูปแบบ {PREFIX}-{LINE}-{YYYYMMDD}-{seq} — ฝัง YYYYMMDD ไว้แล้ว จึง route
// ไปชีทปีที่ถูกต้องได้ทันทีโดยไม่ต้องเดา/สแกนหลายชีท (ยกเว้น legacy ที่เช็คเป็น fallback เสมอ
// เพราะข้อมูลก่อน migration ปนทุกปีอยู่ในนั้น — แต่ขนาดคงที่ ไม่โตต่อ จึงสแกนได้ไม่แพง)
// ========================================================
function recordsYearSheetName_(year) {
  return 'Records-' + year;
}
function recordYearFromDate_(dateStr) {
  var y = String(dateStr || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}
function recordYearFromId_(recordId) {
  var m = String(recordId || '').match(/-(\d{4})\d{4}-\d+$/);
  return m ? m[1] : null;
}
// เปิดชีทของปีนั้น สร้างใหม่พร้อม header ถ้ายังไม่มี (เรียกตอนจะเขียนเท่านั้น)
function ensureRecordsYearSheet_(year) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = recordsYearSheetName_(year);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, RECORDS_HEADER.length).setValues([RECORDS_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
// ชีทรายปีทั้งหมดที่มีอยู่จริง (ใช้ตอนค้นหาแบบไม่จำกัดช่วงวันที่ — ต้องไล่ทุกปีที่มีข้อมูล)
function listExistingRecordYearSheets_() {
  var years = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (s) {
    var m = s.getName().match(/^Records-(\d{4})$/);
    if (m) years.push(m[1]);
  });
  return years;
}
// รายชื่อชีทที่ต้องอ่านสำหรับช่วงวันที่ที่ขอ — ระบุช่วงชัดเจน = อ่านแค่ปีที่เกี่ยวข้อง (เร็ว)
// ไม่ระบุช่วง (null) = ต้องไล่ทุกปีที่มีจริง (เช่น คิวรออนุมัติที่ไม่กรองวันที่)
function recordSheetNamesForRange_(dateFrom, dateTo) {
  var names = [SHEET_RECORDS]; // legacy เสมอ — ขนาดคงที่ ไม่โตต่อหลัง migration
  if (dateFrom && dateTo) {
    var yFrom = parseInt(String(dateFrom).slice(0, 4), 10);
    var yTo = parseInt(String(dateTo).slice(0, 4), 10);
    if (!isNaN(yFrom) && !isNaN(yTo) && yFrom <= yTo) {
      for (var y = yFrom; y <= yTo; y++) names.push(recordsYearSheetName_(y));
      return names;
    }
  }
  listExistingRecordYearSheets_().forEach(function (y) { names.push(recordsYearSheetName_(y)); });
  return names;
}
// อ่านหลายชีทรวมเป็นก้อนเดียว — ข้ามชีทที่ยังไม่มีอยู่จริงอย่างเงียบๆ (ปกติสำหรับปีที่ยังไม่มีข้อมูล)
function readRecordsAcross_(sheetNames) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [];
  sheetNames.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    var h = values[0];
    for (var i = 1; i < values.length; i++) {
      var obj = { _rowIndex: i + 1, _sheet: name };
      for (var j = 0; j < h.length; j++) obj[h[j]] = values[i][j];
      rows.push(obj);
    }
  });
  return { header: RECORDS_HEADER, rows: rows };
}
// หา record ทีละแถว: ลองชีทปีของมันก่อน (จาก record_id) แล้วค่อย fallback legacy
// คืน sheetName มาด้วย เพื่อให้ writeRow กลับไปเขียนถูกชีท
function findRecordRow(recordId) {
  var year = recordYearFromId_(recordId);
  if (year) {
    var found = findInSheet_(recordsYearSheetName_(year), recordId);
    if (found) return found;
  }
  return findInSheet_(SHEET_RECORDS, recordId);
}
function findInSheet_(sheetName, recordId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var header = values[0];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(recordId)) { // record_id เป็นคอลัมน์แรกเสมอ
      var obj = { _rowIndex: i + 1 };
      for (var j = 0; j < header.length; j++) obj[header[j]] = values[i][j];
      return { header: header, row: obj, sheetName: sheetName };
    }
  }
  return null;
}
// นับ record สถานะ PENDING_* ทุกปี — อ่านเฉพาะคอลัมน์ status (ไม่ดึงทั้งแถว) ประหยัด quota
// เพราะ dashboard เรียก action นี้บ่อย และคิวรออนุมัติต้องนับข้ามทุกปีเสมอ (นับไม่ได้แค่ปีปัจจุบัน)
function countPendingAcrossAllYears_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = [SHEET_RECORDS];
  listExistingRecordYearSheets_().forEach(function (y) { names.push(recordsYearSheetName_(y)); });
  var statusCol = RECORDS_HEADER.indexOf('status') + 1;
  var count = 0;
  names.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var values = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
    values.forEach(function (row) { if (String(row[0]).indexOf('PENDING_') === 0) count++; });
  });
  return count;
}

function nowISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

// วันที่จาก Sheet อาจกลายเป็น Date object — แปลงกลับเป็น yyyy-MM-dd
function normDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '');
}

// ---------- auth ----------
function actionLogin(params) {
  var empId = String(params.employee_id || '').trim();
  var pin = String(params.pin || '').trim();
  if (!empId || !pin) return { success: false, error: 'กรุณากรอกรหัสพนักงานและ PIN' };

  var data = readAll(SHEET_USERS);
  for (var i = 0; i < data.rows.length; i++) {
    var u = data.rows[i];
    if (String(u.employee_id) === empId) {
      if (String(u.active).toLowerCase() !== 'true' && u.active !== true) {
        return { success: false, error: 'บัญชีถูกปิดใช้งาน' };
      }
      if (String(u.pin) !== pin) {
        return { success: false, error: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง' };
      }
      // ออก token ใหม่
      var token = Utilities.getUuid();
      var expiry = new Date(Date.now() + TOKEN_LIFETIME_HOURS * 3600 * 1000);
      u.token = token;
      u.token_expiry = Utilities.formatDate(expiry, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
      writeRow(SHEET_USERS, u._rowIndex, data.header, u);
      return {
        success: true,
        token: token,
        employee_id: String(u.employee_id),
        name: String(u.name),
        role: String(u.role),
        line: String(u.line || '')
      };
    }
  }
  return { success: false, error: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง' };
}

function validateToken(token) {
  if (!token) return null;
  var data = readAll(SHEET_USERS);
  for (var i = 0; i < data.rows.length; i++) {
    var u = data.rows[i];
    if (String(u.token) === String(token)) {
      var expiry = u.token_expiry instanceof Date ? u.token_expiry : new Date(String(u.token_expiry));
      if (isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) return null;
      if (String(u.active).toLowerCase() !== 'true' && u.active !== true) return null;
      return {
        employee_id: String(u.employee_id),
        name: String(u.name),
        role: String(u.role),
        line: String(u.line || '')
      };
    }
  }
  return null;
}

function requireRole(user, roles) {
  if (user.role === 'Admin') return;
  if (roles.indexOf(user.role) < 0) throw new Error('สิทธิ์ไม่เพียงพอ (ต้องเป็น ' + roles.join('/') + ')');
}

// ---------- records ----------
function actionGetRecords(params, user) {
  var data = readRecordsAcross_(recordSheetNamesForRange_(params.date_from, params.date_to));
  var out = [];
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    var date = normDate(r.date);
    if (params.form_id && String(r.form_id) !== String(params.form_id)) continue;
    if (params.line && String(r.line) !== String(params.line)) continue;
    if (params.station && String(r.station) !== String(params.station)) continue;
    if (params.status && String(r.status) !== String(params.status)) continue;
    if (params.product_model && String(r.product_model).toLowerCase().indexOf(String(params.product_model).toLowerCase()) < 0) continue;
    if (params.date_from && date < String(params.date_from)) continue;
    if (params.date_to && date > String(params.date_to)) continue;
    // list ไม่ส่ง answers/photos เต็ม (เพื่อความเร็ว)
    out.push({
      record_id: String(r.record_id),
      form_id: String(r.form_id),
      mode: String(r.mode),
      line: String(r.line),
      station: String(r.station),
      product_model: String(r.product_model),
      date: date,
      shift: String(r.shift),
      status: String(r.status),
      has_nok: String(r.has_nok),
      operator_name: String(r.operator_name),
      created_at: String(r.created_at)
    });
  }
  // ใหม่สุดก่อน
  out.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  // จำกัดจำนวนแถวที่คืน — กัน payload บวม/ช้าเมื่อ record โต (แนะนำให้ filter ด้วย date range)
  var truncated = out.length > MAX_RECORDS_RETURN;
  if (truncated) out = out.slice(0, MAX_RECORDS_RETURN);
  return { success: true, records: out, truncated: truncated, total_matched: truncated ? undefined : out.length };
}

function recordToClient(r) {
  var out = {};
  for (var k in r) {
    if (k === '_rowIndex') continue;
    out[k] = k === 'date' ? normDate(r[k]) : (r[k] instanceof Date ? Utilities.formatDate(r[k], Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss") : r[k]);
  }
  return out;
}

function actionGetRecord(params, user) {
  var found = findRecordRow(params.record_id);
  if (!found) return { success: false, error: 'ไม่พบบันทึก: ' + params.record_id };
  var recovery = readAll(SHEET_RECOVERY).rows.filter(function (rv) {
    return String(rv.record_id) === String(params.record_id);
  }).map(function (rv) { delete rv._rowIndex; return rv; });
  return { success: true, record: recordToClient(found.row), recovery: recovery };
}

// log-sheet: ทุก entry ของ form+station+date (สำหรับพิมพ์รวมแผ่นเดียว)
function actionGetLogSheet(params, user) {
  var data = readRecordsAcross_(recordSheetNamesForRange_(params.date, params.date));
  var records = [];
  var ids = {};
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    if (String(r.form_id) !== String(params.form_id)) continue;
    if (String(r.station) !== String(params.station)) continue;
    if (normDate(r.date) !== String(params.date)) continue;
    if (params.shift && String(r.shift) !== String(params.shift)) continue;
    if (String(r.status) === 'REJECTED') continue; // แผ่นพิมพ์ไม่รวม record ที่ถูกตีกลับ
    records.push(recordToClient(r));
    ids[String(r.record_id)] = true;
  }
  records.sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
  var recovery = readAll(SHEET_RECOVERY).rows.filter(function (rv) {
    return ids[String(rv.record_id)];
  }).map(function (rv) { delete rv._rowIndex; return rv; });
  return { success: true, records: records, recovery: recovery };
}

// อ่านค่าคอลัมน์เดียวของชีท (ข้าม header) — สำคัญกับชีท Records มาก: getDataRange().getValues()
// ลากทุกคอลัมน์รวม answers_json/photos_json (เซลล์ละหลายหมื่นตัวอักษร) มาด้วยทุกแถว ทั้งที่ผู้เรียก
// ใช้แค่คอลัมน์เดียว — ยิ่ง record สะสมมาก ยิ่งช้าลงเรื่อยๆ โดยเปล่าประโยชน์ และงานพวกนี้เกิด "ใน lock"
// ตอน submit ทุกครั้ง = บล็อกทั้งระบบนานขึ้นตามขนาดชีท
function readColumn_(sheet, colIndex1Based) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || sheet.getLastColumn() < colIndex1Based) return [];
  return sheet.getRange(2, colIndex1Based, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

// สร้าง record_id: FP-{LINE}-{YYYYMMDD}-{running 3 หลัก} (กัน race ด้วย LockService)
// สแกนแค่ชีทปีของ record นี้ + legacy (ไม่ใช่ทั้งประวัติ) — legacy ต้องเช็คด้วยเพราะวันที่ deploy
// ชีทรายปีของปีปัจจุบันยังว่าง ในขณะที่ legacy อาจมี record ของวันเดียวกันอยู่แล้ว (กัน id ชนกัน)
// อ่านเฉพาะคอลัมน์ record_id (คอลัมน์เดียว) — ไม่ลากทั้งตาราง
function generateRecordId(line, dateStr) {
  var ymd = String(dateStr || '').replace(/-/g, '');
  var prefix = 'FP-' + String(line || 'X').toUpperCase() + '-' + ymd + '-';
  var year = recordYearFromDate_(dateStr);
  var max = 0;
  [recordsYearSheetName_(year), SHEET_RECORDS].forEach(function (name) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) return;
    readColumn_(sheet, 1).forEach(function (id) {
      if (id.indexOf(prefix) === 0) {
        var n = parseInt(id.substring(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  });
  var next = String(max + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + next;
}

// ========================================================
// ลายเซ็น/รูปที่ฝังมาใน answers เป็น data:image base64 ตรงๆ — ต้องอัปโหลดขึ้น Drive แทน
// ห้ามฝังในเซลล์ตรงๆ เพราะ Google Sheets จำกัด 50,000 ตัวอักษรต่อเซลล์เดียว ฟอร์มที่มี
// ลายเซ็นผู้บันทึกหลาย Station (เช่น First Piece 18-21 Station) ฝังรูปตรงๆ ไม่กี่รูปก็เกินแล้ว
// เก็บเป็น "drive:<fileId>" แทน (ฝั่ง client resolve ด้วย signatureImgSrc() ใน config.js)
// ========================================================
function uploadInlineImage_(dataUrl, recordId, tag, line, dateStr) {
  var m = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) return dataUrl; // ไม่ใช่ data:image base64 (อาจเป็น "drive:..." อยู่แล้ว หรือค่าว่าง) — คืนค่าเดิม
  var ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  var safeTag = String(tag).replace(/[^a-zA-Z0-9_-]/g, '') || 'sign';
  var fileName = recordId + '_' + safeTag + '_' + Date.now() + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], fileName);
  var folder = getPhotoFolder(line, dateStr, recordId, 'signatures');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'drive:' + file.getId();
}

// เดินทั้ง object หา string ที่เป็น data:image base64 แล้วอัปโหลดแทนที่ด้วย marker (ทำ in-place)
// คืนจำนวนรูปที่อัปโหลดจริง — ให้ผู้เรียกรู้ว่าต้องเขียนกลับชีทซ้ำอีกรอบไหม (ฟอร์มส่วนใหญ่ไม่มี
// ลายเซ็นฝังเลย ไม่ควรต้องเสียเวลา lock+เขียนซ้ำเปล่าๆ)
//
// dedupe ตาม dataUrl เป๊ะๆ: ฟอร์มที่เซ็น Recorder ครั้งเดียวต่อ Station (ไม่ใช่ต่อข้อ) ฝั่ง client
// จะ apply ลายเซ็นเดิม (base64 เดียวกัน) ไปทับทุก item ใน Station นั้น (ดู applyToStation ใน
// form-render.js) — ฟอร์ม 20 Station ก็คือรูปเดิมซ้ำๆ กัน 40-50 ครั้งทั่ว answers ถ้าอัปโหลดตรงๆ
// ทีละจุดจะยิง Drive API ซ้ำโดยใช่เหตุ (นี่คือสาเหตุหลักที่ submit ช้ามากในฟอร์มหลาย Station) —
// อัปโหลดรูปที่ไบต์เหมือนกันแค่ครั้งเดียว แล้วใช้ fileId เดียวกันแทนที่ทุกจุดที่ซ้ำ
function uploadInlineImagesDeep_(obj, recordId, line, dateStr) {
  var count = 0;
  var uploaded = {}; // dataUrl → 'drive:<fileId>' ที่อัปโหลดไปแล้วในรอบนี้
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === 'string' && v.indexOf('data:image/') === 0) {
        if (!uploaded[v]) {
          uploaded[v] = uploadInlineImage_(v, recordId, k, line, dateStr);
          count++;
        }
        o[k] = uploaded[v];
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    });
  }
  walk(obj);
  return count;
}

// เช็คเร็วๆ (ไม่แตะ Drive) ว่า answers มีรูปฝัง data:image อยู่บ้างไหม — ใช้ตัดสินใจว่า
// createRecord ต้องเดิน 2 รอบ (จอง record_id ก่อน แล้วค่อยอัปโหลดรูปนอก lock) หรือรอบเดียวพอ
function hasInlineImages_(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (var k in obj) {
    var v = obj[k];
    if (typeof v === 'string' && v.indexOf('data:image/') === 0) return true;
    if (v && typeof v === 'object' && hasInlineImages_(v)) return true;
  }
  return false;
}

function actionCreateRecord(params, user) {
  var answersObj = params.answers || {};
  // ฟอร์มส่วนใหญ่ไม่มีลายเซ็นฝังใน answers เลย (log-sheet, ฟอร์มไม่กี่ Station) — กรณีนี้เขียน
  // answers_json จริงได้ในรอบ lock เดียวเหมือนเดิม ไม่ต้องเสีย round-trip Drive เลย
  var needsImageUpload = hasInlineImages_(answersObj);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var recordId, targetYear, wf;
  try {
    // idempotency: ถ้า client ส่ง client_uuid มาแล้วมี record นั้นอยู่แล้ว (submit ซ้ำเพราะเน็ตหลุด)
    // → คืน record_id เดิม ไม่สร้างซ้ำ — เช็คแค่ชีทปีเป้าหมาย (submit ซ้ำเกิดใกล้เวลากันเสมอ ไม่ข้ามปี)
    var clientUuid = String(params.client_uuid || '').trim();
    targetYear = recordYearFromDate_(params.date);
    if (clientUuid) {
      // fast path: cache uuid→record_id ที่เขียนไว้ตอนสร้าง record สำเร็จ (ท้ายฟังก์ชันนี้) —
      // submit ซ้ำเกิดห่างจากครั้งแรกไม่กี่วินาที/นาที (เน็ตหลุดแล้วกดใหม่) อยู่ใน TTL 6 ชม. เสมอ
      // เจอใน cache = ตอบได้ทันทีโดยไม่แตะชีทเลย
      var cachedDupId = CacheService.getScriptCache().get('cuuid_' + clientUuid);
      if (cachedDupId) return { success: true, record_id: cachedDupId, duplicate: true };

      // cache หาย (ถูก evict/ script restart) — fallback อ่านชีท แต่อ่านเฉพาะคอลัมน์ client_uuid
      // คอลัมน์เดียว ไม่ getDataRange ทั้งตาราง (ซึ่งลาก answers_json ยักษ์มาด้วยทุกแถว)
      var candSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(recordsYearSheetName_(targetYear));
      if (candSheet) {
        var uuids = readColumn_(candSheet, RECORDS_HEADER.indexOf('client_uuid') + 1);
        for (var e = 0; e < uuids.length; e++) {
          if (uuids[e] === clientUuid) {
            var dupId = String(candSheet.getRange(e + 2, 1).getValue());
            return { success: true, record_id: dupId, duplicate: true };
          }
        }
      }
    }

    var now = nowISO();
    recordId = generateRecordId(params.line, params.date);
    var doctypeId = String(params.doctype_id || '');
    var mode = params.mode || 'single-record';
    // สถานะเริ่มต้นอ่านจาก workflow (data-driven) — ปกติได้ PENDING_LEADER เหมือนเดิม
    wf = resolveWorkflow({ doctype_id: doctypeId, mode: mode });
    var initStatus = wf.length ? ('PENDING_' + String(wf[0].role).toUpperCase()) : 'PENDING_LEADER';

    // "แก้ไขและส่งใหม่" จาก record ที่ถูกตีกลับ (records.html) — ไม่ต้องอัปโหลดรูปที่มีอยู่แล้วซ้ำ
    // แค่คัดลอก photos_json (fileId เดิม) มาตั้งต้น แล้วให้ client อัปโหลดเพิ่มเฉพาะรูปที่ยังขาด/
    // เปลี่ยนใหม่ผ่าน uploadPhoto ตามปกติ (จะ push ต่อท้าย list เดิมของ item นั้น)
    var resubmitOf = String(params.copy_from_record_id || '').trim();
    var photosObj = {};
    if (resubmitOf) {
      var oldFound = findRecordRow(resubmitOf);
      if (oldFound && oldFound.row.photos_json) {
        try { photosObj = JSON.parse(String(oldFound.row.photos_json)) || {}; } catch (e) { photosObj = {}; }
      }
    }
    // รูปที่ fill.html อัปโหลด "เงียบๆ" ไปล่วงหน้าระหว่างกรอกฟอร์ม (ดู actionUploadPhotoPending) —
    // ตอนนั้นยังไม่มี record_id เลยเก็บไว้ในโฟลเดอร์ชั่วคราวก่อน มาผูกเข้ากับ record จริงตรงนี้เลย
    // ไม่ต้องให้ client เสียเวลาอัปโหลดซ้ำผ่าน uploadPhoto อีกรอบตอน submit
    var pendingPhotos = params.pending_photos || {};
    Object.keys(pendingPhotos).forEach(function (itemId) {
      var arr = pendingPhotos[itemId] || [];
      if (!arr.length) return;
      photosObj[itemId] = photosObj[itemId] || [];
      arr.forEach(function (p) {
        if (p && p.fileId) photosObj[itemId].push({ fileId: p.fileId, fileName: p.fileName || '', ts: now });
      });
    });
    var copiedPhotosJson = JSON.stringify(photosObj);

    // ถ้ามีรูปฝัง เขียน answers_json ว่างไปก่อน (จองแถว/record_id เฉยๆ) แล้วไปอัปโหลดขึ้น Drive
    // นอก lock ด้านล่าง ไม่งั้น answers_json ดิบเกิน 50,000 ตัวอักษร/เซลล์ของ Sheets เขียนไม่ได้เลย
    var record = {
      record_id: recordId,
      form_id: params.form_id,
      template_rev: params.template_rev || '',
      mode: mode,
      line: params.line || '',
      station: params.station || '',
      product_model: params.product_model || '',
      date: params.date || '',
      shift: params.shift || '',
      answers_json: needsImageUpload ? '{}' : JSON.stringify(answersObj),
      photos_json: copiedPhotosJson,
      status: initStatus,
      has_nok: params.has_nok ? 'true' : 'false',
      reject_reason: '',
      operator_id: user.employee_id,
      operator_name: user.name,
      operator_ts: now,
      leader_id: '', leader_name: '', leader_ts: '',
      qi_id: '', qi_name: '', qi_ts: '',
      created_at: now,
      updated_at: now,
      doctype_id: doctypeId,
      client_uuid: clientUuid,
      resubmit_of: resubmitOf
    };
    var row = RECORDS_HEADER.map(function (h) { return record[h] !== undefined ? record[h] : ''; });
    ensureRecordsYearSheet_(targetYear).appendRow(row);

    // จำ uuid→record_id ไว้ให้ fast path ของการเช็ค submit ซ้ำด้านบน (TTL 6 ชม. — ค่าสูงสุดของ
    // CacheService) — เขียนในนี้ (ยังถือ lock อยู่) เพื่อให้ retry ที่ต่อคิว lock ถัดไปเจอ cache ทันที
    if (clientUuid) {
      try { CacheService.getScriptCache().put('cuuid_' + clientUuid, recordId, 21600); } catch (ce) { /* cache ล่มไม่ใช่เหตุให้ submit fail — fallback อ่านชีทยังอยู่ */ }
    }

    // recovery แนบมาพร้อม submit
    var recovery = params.recovery || [];
    if (recovery.length) {
      var rvRows = recovery.map(function (rv) {
        return [recordId, rv.item_id || '', rv.problem || '', rv.countermeasure || '',
          user.name, now, '', '', ''];
      });
      var rvSheet = getSheet(SHEET_RECOVERY);
      rvSheet.getRange(rvSheet.getLastRow() + 1, 1, rvRows.length, RECOVERY_HEADER.length).setValues(rvRows);
    }

    try {
      var keywords = (params.product_model || '') + ' ' + (user.name || '');
      if (recovery.length) {
        recovery.forEach(function(r) { keywords += ' ' + (r.problem || '') + ' ' + (r.item_id || ''); });
      }
      buildSearchIndex('Record', recordId, params.line || '', params.station || '', params.form_id || '', keywords);
    } catch(e) {
      Logger.log('Search Index Error: ' + e);
    }

    // แจ้งเตือน role ผู้อนุมัติ step แรก + แจ้ง NOK แยก event (สีต่างกันในกระดิ่งแจ้งเตือน)
    var firstRole = wf.length ? String(wf[0].role) : 'Leader';
    var where = (params.line || '') + (params.station ? ' / Station ' + params.station : '');
    pushNotification('approval', firstRole, '',
      'เอกสารรอตรวจ: ' + recordId, where + ' โดย ' + user.name, 'records.html');
    if (params.has_nok) {
      pushNotification('nok', firstRole, '',
        'พบ NOK: ' + recordId, where + ' — มีรายการตรวจไม่ผ่าน ต้องติดตาม Recovery', 'records.html');
    }
  } finally {
    lock.releaseLock();
  }

  if (needsImageUpload) {
    // นอก lock: อัปโหลดลายเซ็น/รูปฝังขึ้น Drive (ช้า, หลาย round-trip) แล้วเขียน answers_json
    // จริงกลับเข้าแถวที่จองไว้ — ถ้าถือ lock ทั้งระบบไว้ตลอดขั้นตอนนี้จะบล็อกทุกคนพร้อมกัน
    uploadInlineImagesDeep_(answersObj, recordId, params.line, params.date);
    var lock2 = LockService.getScriptLock();
    lock2.waitLock(20000);
    try {
      var found = findRecordRow(recordId);
      if (found) {
        found.row.answers_json = JSON.stringify(answersObj);
        found.row.updated_at = nowISO();
        writeRow(found.sheetName, found.row._rowIndex, found.header, found.row);
      }
    } finally {
      lock2.releaseLock();
    }
  }

  return { success: true, record_id: recordId };
}

// อ่านลำดับการอนุมัติของ record จาก M_DocType.workflow_json (data-driven)
// เพิ่ม step ใหม่ (เช่น QA ก่อน QI) = แก้ workflow_json ในชีท ไม่ต้องแก้โค้ด
// record เก่าที่ไม่มี doctype_id → fallback ตาม mode (พฤติกรรมเดิมเป๊ะ)
function resolveWorkflow(record) {
  var doctypeId = String(record.doctype_id || '');
  if (doctypeId) {
    var dts = readMaster('M_DocType');
    for (var i = 0; i < dts.length; i++) {
      if (String(dts[i].doctype_id) === doctypeId && dts[i].workflow_json) {
        try {
          var wf = JSON.parse(dts[i].workflow_json);
          if (wf && wf.length) return wf;
        } catch (e) { /* workflow_json เสีย — ใช้ fallback */ }
      }
    }
  }
  // fallback: log-sheet = Leader ขั้นเดียว, single-record = Leader → QI
  return (String(record.mode) === 'log-sheet')
    ? [{ step: 1, role: 'Leader', label: 'หัวหน้างานยืนยัน' }]
    : [{ step: 1, role: 'Leader', label: 'หัวหน้างานยืนยัน' }, { step: 2, role: 'QI', label: 'QI อนุมัติ' }];
}

// หา index ของ step ที่ค้างอยู่จากสถานะ PENDING_<ROLE>
function pendingStepIndex(wf, status) {
  var s = String(status || '');
  if (s.indexOf('PENDING_') !== 0) return -1;
  var role = s.substring('PENDING_'.length).toUpperCase();
  for (var i = 0; i < wf.length; i++) {
    if (String(wf[i].role).toUpperCase() === role) return i;
  }
  return -1;
}

// อนุมัติ 1 step ตาม workflow — สิทธิ์เช็คจาก M_Permission (can) ไม่ใช่ if(role==...) ตายตัว
function actionApproveRecord(params, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findRecordRow(params.record_id);
    if (!found) return { success: false, error: 'ไม่พบบันทึก' };
    var r = found.row;
    var now = nowISO();
    var status = String(r.status);
    if (status.indexOf('PENDING_') !== 0) {
      return { success: false, error: 'สถานะปัจจุบัน (' + status + ') อนุมัติไม่ได้' };
    }

    var wf = resolveWorkflow(r);
    var idx = pendingStepIndex(wf, status);
    if (idx < 0) idx = 0; // status role ไม่อยู่ใน workflow (ถูกแก้ทีหลัง) — ให้เริ่มที่ step แรก
    var stepRole = String(wf[idx].role);

    // สิทธิ์: ต้องเป็น role ของ step นี้ (หรือ Admin) และมีสิทธิ์ record.approve.step (จาก M_Permission)
    var isRightRole = (user.role === stepRole) || (user.role === 'Admin');
    var hasPerm = can(user, 'record.approve.step', { line_id: r.line, doctype_id: r.doctype_id });
    if (!isRightRole || !hasPerm) {
      return { success: false, error: 'ขั้นนี้ต้องให้ ' + stepRole + ' อนุมัติ' };
    }

    var answers = {};
    try { answers = JSON.parse(r.answers_json || '{}'); } catch (e) { answers = {}; }
    var roleKey = stepRole.toLowerCase();
    // เก็บลง column เฉพาะ Leader/QI (backward compat กับหน้าจอ/พิมพ์เดิม)
    if (roleKey === 'leader') { r.leader_id = user.employee_id; r.leader_name = user.name; r.leader_ts = now; }
    else if (roleKey === 'qi') { r.qi_id = user.employee_id; r.qi_name = user.name; r.qi_ts = now; }
    // ลายเซ็นผู้อนุมัติต้องอัปโหลดขึ้น Drive ก่อนเก็บ (เหมือนตอน createRecord) — ถ้าฝัง data:image
    // ตรงๆ ทับกับลายเซ็น Station ที่มีอยู่แล้วใน answers_json อาจดันยอดรวมเกิน 50,000 ตัวอักษร/เซลล์
    if (params.signature) answers['_' + roleKey + '_sign'] = uploadInlineImage_(String(params.signature), r.record_id, roleKey + '_sign', r.line, normDate(r.date));
    // ประวัติอนุมัติแบบ generic (รองรับ role ใหม่ + เตรียมย้ายเป็น T_Approval ในอนาคต)
    answers._approvals = answers._approvals || [];
    answers._approvals.push({ step: wf[idx].step || (idx + 1), role: stepRole, user_id: user.employee_id, user_name: user.name, ts: now });
    r.answers_json = JSON.stringify(answers);

    // ไป step ถัดไป หรือจบ
    r.status = (idx + 1 < wf.length) ? ('PENDING_' + String(wf[idx + 1].role).toUpperCase()) : 'COMPLETED';
    r.updated_at = now;
    writeRow(found.sheetName, r._rowIndex, found.header, r);

    // แจ้งเตือน: จบครบทุก step → บอกผู้กรอก, ยังมี step ถัดไป → บอก role ถัดไป
    if (r.status === 'COMPLETED') {
      pushNotification('approved', '', String(r.operator_id),
        'อนุมัติครบแล้ว: ' + r.record_id, 'เอกสารของคุณผ่านการอนุมัติทุกขั้นตอน', 'records.html');
    } else {
      pushNotification('approval', String(wf[idx + 1].role), '',
        'เอกสารรอตรวจ: ' + r.record_id, (r.line || '') + ' — ผ่านขั้น ' + stepRole + ' แล้ว', 'records.html');
    }

    return { success: true, status: r.status };
  } finally {
    lock.releaseLock();
  }
}

function actionRejectRecord(params, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findRecordRow(params.record_id);
    if (!found) return { success: false, error: 'ไม่พบบันทึก' };
    var r = found.row;
    var status = String(r.status);
    if (status.indexOf('PENDING_') !== 0) {
      return { success: false, error: 'สถานะปัจจุบัน (' + status + ') ตีกลับไม่ได้' };
    }
    // ตีกลับได้เฉพาะผู้ที่อนุมัติ step ปัจจุบันได้ (role ของ step นี้ หรือ Admin) + มีสิทธิ์
    var wf = resolveWorkflow(r);
    var idx = pendingStepIndex(wf, status);
    if (idx < 0) idx = 0;
    var stepRole = String(wf[idx].role);
    var isRightRole = (user.role === stepRole) || (user.role === 'Admin');
    var hasPerm = can(user, 'record.approve.step', { line_id: r.line, doctype_id: r.doctype_id });
    if (!isRightRole || !hasPerm) {
      return { success: false, error: 'ขั้นนี้ต้องให้ ' + stepRole + ' เป็นผู้ตรวจ' };
    }
    r.status = 'REJECTED';
    r.reject_reason = String(params.reason || '');
    r.updated_at = nowISO();
    writeRow(found.sheetName, r._rowIndex, found.header, r);

    // แจ้งเตือนเจาะจงถึงผู้กรอก — ให้แก้แล้ว submit ใหม่
    pushNotification('rejected', '', String(r.operator_id),
      'ถูกตีกลับ: ' + r.record_id,
      'เหตุผล: ' + (params.reason || '-') + ' — แก้ไขแล้ว Submit ใหม่ได้', 'records.html');

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- photo ----------
function getConfigValue(key) {
  var data = readAll(SHEET_CONFIG);
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i].key) === key) return String(data.rows[i].value);
  }
  return '';
}

// โฟลเดอร์ {root}/{line}/{YYYY-MM}/{recordId}/{subType}/ (สร้างถ้ายังไม่มี)
// แยกไฟล์ของแต่ละ record ออกจากกัน (recordId) และแยกรูปที่ถ่ายหน้างาน (photos) ออกจาก
// ลายเซ็นผู้บันทึก/ผู้อนุมัติ (signatures) กันไฟล์นับร้อยของทั้งเดือนกองรวมกันเป็นชั้นเดียว
// หาย/งงตอนไล่หาไฟล์ทีหลัง
// cache ID โฟลเดอร์ต่อ line+เดือน+record+subType ไว้ 6 ชม. — ไม่งั้นทุกรูปที่อัปโหลดต้องเดิน Drive API
// ค้นหา/สร้างโฟลเดอร์ซ้ำหลายรอบ ซึ่งช้าและสะสมได้เยอะเมื่อมีคนอัปพร้อมกันหลายคน
function getPhotoFolder(line, dateStr, recordId, subType) {
  var ym = String(dateStr || nowISO()).substring(0, 7); // YYYY-MM
  var lineKey = String(line || 'X');
  var recKey = String(recordId || '_misc');
  var subKey = String(subType || 'photos');
  var cacheKey = 'photofolder_' + lineKey + '_' + ym + '_' + recKey + '_' + subKey;
  var cache = CacheService.getScriptCache();
  var cachedId = cache.get(cacheKey);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* โฟลเดอร์ถูกลบ/ย้าย — หาใหม่ */ }
  }

  var rootId = getConfigValue('drive_root_folder_id');
  if (!rootId) throw new Error('ยังไม่ได้ตั้งค่า drive_root_folder_id ในชีท Config');
  var folder = DriveApp.getFolderById(rootId);
  [lineKey, ym, recKey, subKey].forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  cache.put(cacheKey, folder.getId(), 21600); // 6 ชม. (ค่าสูงสุดที่ CacheService รองรับ)
  return folder;
}

// อัปโหลดลายเซ็นแบบ "เงียบๆ" ระหว่างกรอกฟอร์ม (ก่อนมี record_id จริง) — fill.html เรียกตอนเซ็นเสร็จ
// แต่ละ Station ทันที แทนที่จะรอฝัง base64 ไปกับ createRecord ตอนกด Submit ท้ายฟอร์มทีเดียวหมด
// (ฟอร์มหลาย Station เดิมต้องรออัปโหลดหลายรูปติดกันตอน submit ทำให้ "กำลังบันทึกข้อมูล..." ค้างนาน)
// ยังไม่มี record_id ตอนนี้ — ใช้ client_uuid (สร้างตั้งแต่เปิดฟอร์ม) เป็นชื่อโฟลเดอร์ชั่วคราวแทน
// ถ้าอัปโหลดสำเร็จ client จะแทนที่ base64 ในคำตอบด้วย "drive:<fileId>" ที่ได้ทันที — พอกด Submit
// จริง uploadInlineImagesDeep_ จะข้ามรูปที่อัปโหลดไปแล้วกลุ่มนี้ไปเลย (ไม่ใช่ data:image ซ้ำ)
function actionUploadSignature(params, user) {
  var clientUuid = String(params.client_uuid || '').trim();
  if (!clientUuid || !params.data_url) {
    return { success: false, error: 'ข้อมูลไม่ครบ (client_uuid/data_url)' };
  }
  var tag = String(params.tag || 'sign');
  var ref = uploadInlineImage_(String(params.data_url), 'pending-' + clientUuid, tag, params.line || '', params.date || '');
  if (String(ref).indexOf('drive:') !== 0) {
    return { success: false, error: 'อัปโหลดลายเซ็นไม่สำเร็จ' };
  }
  return { success: true, ref: ref };
}

// อัปโหลดรูปที่ถ่ายแนบระหว่างกรอกฟอร์มแบบ "เงียบๆ" เหมือน actionUploadSignature — ยังไม่มี record_id
// ตอนนี้ (record สร้างตอน submit) จึงเก็บไว้ในโฟลเดอร์ชั่วคราว "pending-<client_uuid>/photos/" ก่อน
// ไม่ต้องแตะ/ล็อกแถว record เลย (ยังไม่มีให้แตะ) แค่คืน fileId มาให้ client เก็บไว้เฉยๆ
// ตอน submit จริง createRecord จะรับ pending_photos (fileId ที่อัปโหลดไปล่วงหน้าแล้วพวกนี้) ไปใส่ใน
// photos_json ของ record ใหม่ตรงๆ โดยไม่ต้องอัปโหลดซ้ำผ่าน actionUploadPhoto อีกรอบ
function actionUploadPhotoPending(params, user) {
  var clientUuid = String(params.client_uuid || '').trim();
  var itemId = String(params.item_id || '');
  if (!clientUuid || !itemId || !params.base64) {
    return { success: false, error: 'ข้อมูลรูปไม่ครบ (client_uuid/item_id/base64)' };
  }
  var fileName = 'pending-' + clientUuid + '_' + itemId + '_' + Date.now() + '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(params.base64), 'image/jpeg', fileName);
  var folder = getPhotoFolder(params.line || '', params.date || '', 'pending-' + clientUuid, 'photos');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true, fileId: file.getId(), fileName: fileName };
}

function actionUploadPhoto(params, user) {
  var recordId = String(params.record_id || '');
  var itemId = String(params.item_id || '');
  if (!recordId || !itemId || !params.base64) {
    return { success: false, error: 'ข้อมูลรูปไม่ครบ (record_id/item_id/base64)' };
  }

  var found0 = findRecordRow(recordId);
  if (!found0) return { success: false, error: 'ไม่พบบันทึก: ' + recordId };
  var n = (JSON.parse(String(found0.row.photos_json || '{}'))[itemId] || []).length + 1;

  // อัปโหลดไฟล์ขึ้น Drive "นอก" lock — เป็นขั้นตอนที่ช้าที่สุด (สร้าง/ค้นหาโฟลเดอร์ + อัปโหลดไฟล์
  // หลาย round-trip ไป Drive API) ถ้าถือ lock ทั้งเส้นทางนี้ จะบล็อกทุก request อื่นทั้งระบบ
  // (createRecord, approve, uploadPhoto รูปอื่น ฯลฯ) พร้อมกันหลายคนพร้อมกันบนโรงงานจริง
  // ทำให้คิวยาว จน connection ฝั่ง client หลุดเป็น "Failed to fetch" ก่อน GAS จะตอบทัน
  var fileName = recordId + '_' + itemId + '_' + n + '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(params.base64), 'image/jpeg', fileName);
  var folder = getPhotoFolder(params.line || found0.row.line, normDate(found0.row.date), recordId, 'photos');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // ถือ lock เฉพาะช่วงอ่าน-แก้ไข-เขียนแถวชีท (เร็วมาก) กัน race condition ตอนอัปหลายรูปพร้อมกัน
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var found = findRecordRow(recordId); // อ่านซ้ำให้สดที่สุดก่อนเขียน กันทับข้อมูลที่เพิ่งเปลี่ยนระหว่างอัปโหลด
    if (!found) return { success: false, error: 'ไม่พบบันทึก: ' + recordId };
    var r = found.row;
    var photos = {};
    try { photos = JSON.parse(String(r.photos_json || '{}')); } catch (e) { photos = {}; }
    photos[itemId] = photos[itemId] || [];
    photos[itemId].push({ fileId: file.getId(), fileName: fileName, ts: nowISO() });
    r.photos_json = JSON.stringify(photos);
    r.updated_at = nowISO();
    writeRow(found.sheetName, r._rowIndex, found.header, r);

    return { success: true, fileId: file.getId(), fileName: fileName };
  } finally {
    lock.releaseLock();
  }
}

// ---------- recovery ----------
function actionAddRecovery(params, user) {
  if (!params.record_id || !params.item_id) {
    return { success: false, error: 'ข้อมูล Recovery ไม่ครบ' };
  }
  getSheet(SHEET_RECOVERY).appendRow([
    params.record_id, params.item_id,
    params.problem || '', params.countermeasure || '',
    user.name, nowISO(),
    params.leader_sign || '', params.leader_sign ? nowISO() : '',
    params.decision || ''
  ]);
  return { success: true };
}

// ========================================================
// ฟังก์ชันตั้งค่าครั้งแรก — รันจาก GAS editor (ไม่ใช่ web)
// ========================================================

// สร้างชีท + header ทั้งหมด
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = [
    [SHEET_RECORDS, RECORDS_HEADER],
    [SHEET_RECOVERY, RECOVERY_HEADER],
    [SHEET_USERS, USERS_HEADER],
    [SHEET_CONFIG, ['key', 'value']]
  ];
  defs.forEach(function (def) {
    var sheet = ss.getSheetByName(def[0]) || ss.insertSheet(def[0]);
    sheet.getRange(1, 1, 1, def[1].length).setValues([def[1]]);
    sheet.setFrozenRows(1);
  });
  Logger.log('สร้างชีทครบแล้ว — เพิ่มผู้ใช้ด้วย addUser() และใส่ drive_root_folder_id ในชีท Config');
}

// เพิ่มผู้ใช้ (แก้ค่าแล้วรันจาก editor): addUser('10001', 'สมชาย ใจดี', '1234', 'Operator', 'NMS')
function addUser(employeeId, name, pin, role, line) {
  employeeId = employeeId || '10001';
  name = name || 'ผู้ดูแลระบบ';
  pin = pin || '1234';
  role = role || 'Admin';
  line = line || '';
  getSheet(SHEET_USERS).appendRow([employeeId, name, pin, role, line, '', '', 'true']);
  Logger.log('เพิ่มผู้ใช้ %s (%s) แล้ว', name, role);
}


/**
 * ========================================================
 * Master.gs — Master Data Layer (Migration Step 1)
 * ENC Manufacturing Quality Management System
 *
 * - Master Data อยู่ใน spreadsheet แยก: "ENC-MASTER"
 *   (ID เก็บใน Script Properties: MASTER_SPREADSHEET_ID)
 * - ไฟล์นี้เป็น additive ล้วนๆ — ไม่แตะพฤติกรรมเดิมใน Code.gs
 *   ระบบเดิม (CONFIG.FORMS) ยังทำงานเหมือนเดิมทุกประการ
 *
 * ติดตั้ง: สร้างไฟล์ใหม่ชื่อ Master.gs ใน GAS editor แล้ววางโค้ดนี้
 * จากนั้นรัน setupMasterSheets() → seedMaster() (ครั้งเดียว)
 * ========================================================
 */

// ---------- นิยามชีท Master ทั้งหมด (ชีทละ 1 entity) ----------
var MASTER_SHEET_DEFS = {
  M_Plant: ['plant_id', 'plant_name', 'display_name', 'status'],
  M_Line: ['line_id', 'plant_id', 'line_name', 'display_name', 'sequence', 'status'],
  M_Station: ['station_id', 'line_id', 'station_no', 'station_name', 'sequence', 'status'],
  M_DocType: ['doctype_id', 'doctype_name', 'display_name_th', 'behavior', 'workflow_json', 'record_prefix', 'icon', 'sequence', 'status'],
  M_Document: ['doc_id', 'doctype_id', 'family_id', 'line_id', 'doc_name', 'doc_no', 'current_rev_id', 'drive_folder_id', 'print_css', 'status', 'series_tag', 'model_group'],
  M_DocAssign: ['assign_id', 'doc_id', 'station_id', 'status'],
  M_Revision: ['rev_id', 'doc_id', 'rev_no', 'content_ref', 'effective_date', 'approved_by', 'approved_date', 'reason', 'status', 'created_at'],
  M_Role: ['role_id', 'role_name', 'display_name_th', 'sequence', 'status'],
  M_Permission: ['perm_id', 'role_id', 'action', 'scope_line', 'scope_doctype'],
  M_ProductFamily: ['family_id', 'family_name', 'display_name', 'sequence', 'status'],
  M_Model: ['model_id', 'family_id', 'model_name', 'status', 'series_tag', 'model_group'],
  M_Shift: ['shift_id', 'shift_name', 'time_range', 'status'],
  // รายชื่อพนักงาน — ใช้เติม dropdown "เลือกชื่อผู้บันทึก (Recorder)" ก่อนเซ็นลายเซ็นใน fill.html
  // (แยกจาก SHEET_USERS ซึ่งเป็นบัญชี login — ชีทนี้แค่รายชื่อให้เลือก ไม่มี pin/role) แก้ไข/เพิ่มชื่อ
  // ได้ตรงในชีท M_Employee ของ ENC-MASTER เลย ไม่ต้องมี UI แยก
  // shift = กะที่พนักงานคนนี้ประจำอยู่ (ค่าจาก M_Shift เช่น A/B) หรือ ALL = ขึ้นได้ทุกกะ
  // — ต่อท้ายคอลัมน์เดิมเสมอ เพื่อให้ชีทที่มีข้อมูลอยู่แล้วไม่ต้องย้ายคอลัมน์ แค่รัน setupMasterSheets() ซ้ำ
  M_Employee: ['employee_id', 'name', 'sequence', 'status', 'shift']
};

// ---------- เปิด/สร้าง spreadsheet ENC-MASTER ----------
function getMasterSS() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MASTER_SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('เปิด ENC-MASTER ไม่ได้ (id=' + id + ') — ตรวจ Script Properties');
    }
  }
  throw new Error('ยังไม่ได้สร้าง ENC-MASTER — รัน setupMasterSheets() ก่อน');
}

// อ่านทั้งชีทจาก master เป็น array ของ object
function readMaster(sheetName) {
  var ss = getMasterSS();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < header.length; j++) {
      var v = values[i][j];
      obj[header[j]] = v instanceof Date
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : v;
    }
    rows.push(obj);
  }
  return rows;
}

// version ของ master (client ใช้ตัดสินใจว่า cache เก่าหรือยัง)
function getMasterVersion() {
  return PropertiesService.getScriptProperties().getProperty('MASTER_VERSION') || '0';
}

// รันทุกครั้งหลังแก้ Master ด้วยมือ (หรือถูกเรียกจาก master.update ในอนาคต)
function bumpMasterVersion() {
  var props = PropertiesService.getScriptProperties();
  var v = parseInt(props.getProperty('MASTER_VERSION') || '0', 10) + 1;
  props.setProperty('MASTER_VERSION', String(v));
  Logger.log('MASTER_VERSION = %s', v);
  return v;
}

// ========================================================
// API actions (เรียกจาก router ใน Code.gs)
// ========================================================

// master.getAll — คืน master ทุกชีท + version (client cache ทั้งก้อน)
function actionMasterGetAll(params, user) {
  var data = {};
  // ทิ้งเฉพาะแถวที่ปิดใช้งานจริงๆ — ห้ามทิ้ง CURRENT/OBSOLETE (M_Revision ใช้ค่าเหล่านี้)
  // viewer ต้องเห็น OBSOLETE เพื่อดูประวัติ revision ด้วย
  var DROP = { 'INACTIVE': 1, 'DELETED': 1, 'DISABLED': 1 };
  Object.keys(MASTER_SHEET_DEFS).forEach(function (name) {
    data[name] = readMaster(name).filter(function (r) {
      return !('status' in r) || !DROP[String(r.status).toUpperCase()];
    });
  });
  return { success: true, master: data, master_version: getMasterVersion() };
}

// ========================================================
// Permission แบบ dynamic (ใช้แทน requireRole ในขั้นถัดไป)
// can(user, 'record.approve.step', {line_id:'L4', doctype_id:'first-piece'})
// ========================================================
function can(user, action, scope) {
  scope = scope || {};
  if (!user) return false;
  var perms = readMaster('M_Permission');
  for (var i = 0; i < perms.length; i++) {
    var p = perms[i];
    if (String(p.role_id) !== String(user.role) && String(p.role_id) !== '*') continue;
    if (String(p.action) !== action && String(p.action) !== '*') continue;
    var lineOk = String(p.scope_line) === '*' || !scope.line_id || String(p.scope_line) === String(scope.line_id);
    var docOk = String(p.scope_doctype) === '*' || !scope.doctype_id || String(p.scope_doctype) === String(scope.doctype_id);
    if (lineOk && docOk) return true;
  }
  return false;
}

// ========================================================
// Drive: สร้างโฟลเดอร์ตาม path (สร้างทุกชั้นที่ยังไม่มี) แล้วคืน folder
// ensureFolderPath(['ENC','Line4','Station12','WI'])
// ========================================================
function ensureFolderPath(parts) {
  var rootId = getConfigValue('drive_root_folder_id');
  if (!rootId) throw new Error('ยังไม่ได้ตั้งค่า drive_root_folder_id ในชีท Config');
  var folder = DriveApp.getFolderById(rootId);
  (parts || []).forEach(function (name) {
    name = String(name || '').trim() || 'X';
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

// ดึง fileId จากลิงก์ Google Drive หลายรูปแบบ หรือรับ id ตรงๆ
function extractDriveId(input) {
  var s = String(input || '').trim();
  if (!s) return '';
  var m = s.match(/[-\w]{25,}/); // id ของ Drive ยาว 25+ อักขระ
  return m ? m[0] : s;
}

// ========================================================
// Admin: ลงทะเบียนเอกสารไฟล์ (WI/Drawing/OWS/...) — self-service ผ่านหน้าเว็บ
// อัปโหลดไฟล์ (base64) หรืออ้าง Drive fileId เดิม → สร้าง Document + Revision + Assign
// ========================================================
function actionDocRegister(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ (ต้องมีสิทธิ์ document.manage)' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var lineId = String(params.line_id || '');
    var doctypeId = String(params.doctype_id || '');
    var docName = String(params.doc_name || '').trim();
    if (!lineId || !doctypeId || !docName) {
      return { success: false, error: 'กรอกไม่ครบ (line/doctype/ชื่อเอกสาร)' };
    }
    var stationIds = params.station_ids || [];
    var revNo = String(params.rev_no || 'Rev01').trim();

    // doc_id: DOC-{DOCTYPE}-{LINE}-{seq} (unique)
    var docId = String(params.doc_id || '').trim();
    if (!docId) {
      docId = 'DOC-' + doctypeId.toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + lineId + '-' + Date.now().toString(36);
    }

    // หาชื่อไลน์/ประเภทสำหรับตั้งชื่อโฟลเดอร์
    var lineName = lineId, doctypeName = doctypeId;
    var lineRows = readMaster('M_Line');
    for (var i = 0; i < lineRows.length; i++) if (String(lineRows[i].line_id) === lineId) lineName = lineRows[i].line_name;
    var dtRows = readMaster('M_DocType');
    for (var j = 0; j < dtRows.length; j++) if (String(dtRows[j].doctype_id) === doctypeId) doctypeName = dtRows[j].doctype_name;

    // เนื้อหา revision: template JSON ใน repo (behavior=form) หรืออัปโหลดไฟล์ หรืออ้าง fileId
    var contentRef = '';
    var driveFolderId = '';
    if (params.template_path) {
      // เอกสารประเภทฟอร์ม — เนื้อหาคือไฟล์ template ที่ push เข้า git แล้ว ไม่ต้องใช้ Drive
      contentRef = String(params.template_path).trim();
    } else if (params.base64 && params.file_name) {
      // สร้างโฟลเดอร์ ENC/{Line}/{Station|_Shared}/{DocType}/
      var stationSeg = (stationIds.length === 1) ? stationLabel(stationIds[0]) : '_Shared';
      var folder = ensureFolderPath(['ENC', lineName, stationSeg, doctypeName]);
      driveFolderId = folder.getId();
      var mime = params.mime_type || 'application/pdf';
      var blob = Utilities.newBlob(Utilities.base64Decode(params.base64), mime, revNo + '_' + params.file_name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      contentRef = file.getId();
    } else if (params.drive_id) {
      contentRef = extractDriveId(params.drive_id);
      // เปิดสิทธิ์อ่านให้ลิงก์ (ถ้าเป็นไฟล์ของเรา)
      try {
        DriveApp.getFileById(contentRef).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) { /* อาจเป็นไฟล์คนอื่น — ข้าม */ }
    } else {
      return { success: false, error: 'ต้องแนบไฟล์ หรือใส่ลิงก์/ID ของ Google Drive' };
    }

    registerDocument({
      doc_id: docId,
      doctype_id: doctypeId,
      family_id: String(params.family_id || '*'),
      line_id: lineId,
      doc_name: docName,
      doc_no: String(params.doc_no || ''),
      drive_folder_id: driveFolderId,
      rev_no: revNo,
      content_ref: contentRef,
      effective_date: String(params.effective_date || ''),
      approved_by: user.name,
      reason: String(params.reason || 'ลงทะเบียนครั้งแรก'),
      station_ids: stationIds,
      series_tag: String(params.series_tag || ''),
      model_group: String(params.model_group || '')
    });

    auditLog(user, 'document.register', 'M_Document', docId, '', JSON.stringify({ rev: revNo, ref: contentRef }));
    return { success: true, doc_id: docId, content_ref: contentRef };
  } finally {
    lock.releaseLock();
  }
}

// เพิ่ม revision ใหม่ให้เอกสารเดิม (ตัวเก่ากลายเป็น OBSOLETE อัตโนมัติใน registerDocument)
function actionDocAddRevision(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ (ต้องมีสิทธิ์ document.manage)' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var docId = String(params.doc_id || '');
    if (!docId) return { success: false, error: 'ไม่ระบุ doc_id' };
    var docRows = readMaster('M_Document');
    var doc = null;
    for (var i = 0; i < docRows.length; i++) if (String(docRows[i].doc_id) === docId) doc = docRows[i];
    if (!doc) return { success: false, error: 'ไม่พบเอกสาร: ' + docId };

    var revNo = String(params.rev_no || '').trim();
    if (!revNo) return { success: false, error: 'ไม่ระบุเลข Revision' };

    var contentRef = '';
    if (params.template_path) {
      contentRef = String(params.template_path).trim();
    } else if (params.base64 && params.file_name) {
      var folder = doc.drive_folder_id
        ? DriveApp.getFolderById(doc.drive_folder_id)
        : ensureFolderPath(['ENC', '_Uploads']);
      var mime = params.mime_type || 'application/pdf';
      var blob = Utilities.newBlob(Utilities.base64Decode(params.base64), mime, revNo + '_' + params.file_name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      contentRef = file.getId();
    } else if (params.drive_id) {
      contentRef = extractDriveId(params.drive_id);
    } else {
      return { success: false, error: 'ต้องแนบไฟล์ หรือใส่ลิงก์ Drive' };
    }

    registerDocument({
      doc_id: docId,
      doctype_id: doc.doctype_id,
      family_id: doc.family_id,
      line_id: doc.line_id,
      doc_name: doc.doc_name,
      doc_no: doc.doc_no,
      drive_folder_id: doc.drive_folder_id,
      print_css: doc.print_css,
      rev_no: revNo,
      content_ref: contentRef,
      effective_date: String(params.effective_date || ''),
      approved_by: user.name,
      reason: String(params.reason || ''),
      station_ids: []
    });

    auditLog(user, 'document.addRevision', 'M_Document', docId, doc.current_rev_id, revNo);
    return { success: true, doc_id: docId, rev_no: revNo };
  } finally {
    lock.releaseLock();
  }
}

// ผูก/ถอนเอกสารกับสถานี (แก้ M_DocAssign ผ่านหน้าเว็บแทนการแก้ชีทเอง)
function actionDocAssign(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ' };
  }
  var ss = getMasterSS();
  var sheet = ss.getSheetByName('M_DocAssign');
  var docId = String(params.doc_id || '');
  var stationId = String(params.station_id || '');
  if (!docId || !stationId) return { success: false, error: 'ต้องระบุ doc_id + station_id' };

  var data = sheet.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === docId && String(data[i][2]) === stationId) { rowIdx = i + 1; break; }
  }
  if (params.remove) {
    if (rowIdx > 0) sheet.getRange(rowIdx, 4).setValue('INACTIVE');
  } else {
    if (rowIdx > 0) sheet.getRange(rowIdx, 4).setValue('ACTIVE');
    else sheet.appendRow([docId + '@' + stationId, docId, stationId, 'ACTIVE']);
  }
  bumpMasterVersion();
  auditLog(user, params.remove ? 'doc.unassign' : 'doc.assign', 'M_DocAssign', docId + '@' + stationId, '', '');
  return { success: true };
}

// ========================================================
// Admin: ลบเอกสาร (soft-delete — ตั้ง status=DELETED เพื่อให้หายจากทุกหน้าทันที
// ข้อมูลเดิมยังอยู่ในชีท ENC-MASTER กู้คืนได้เองโดยแก้ status กลับเป็น ACTIVE)
// ========================================================
function actionDocDelete(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ' };
  }
  var docId = String(params.doc_id || '');
  if (!docId) return { success: false, error: 'ต้องระบุ doc_id' };

  var ss = getMasterSS();
  var sheet = ss.getSheetByName('M_Document');
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var statusCol = header.indexOf('status') + 1;
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === docId) { rowIdx = i + 1; break; }
  }
  if (rowIdx < 0) return { success: false, error: 'ไม่พบเอกสารนี้: ' + docId };
  sheet.getRange(rowIdx, statusCol).setValue('DELETED');

  // ปิดการผูก Station เดิมของเอกสารนี้ด้วย (เก็บประวัติไว้ แค่ไม่ให้ active)
  var assignSheet = ss.getSheetByName('M_DocAssign');
  var aData = assignSheet.getDataRange().getValues();
  for (var j = 1; j < aData.length; j++) {
    if (String(aData[j][1]) === docId && String(aData[j][3]).toUpperCase() !== 'INACTIVE') {
      assignSheet.getRange(j + 1, 4).setValue('INACTIVE');
    }
  }

  bumpMasterVersion();
  auditLog(user, 'doc.delete', 'M_Document', docId, 'ACTIVE', 'DELETED');
  return { success: true };
}

// ========================================================
// Admin: แก้ไขข้อมูลเอกสารที่ลงทะเบียนผิด (ไลน์/ประเภท/รุ่นหลัก/ชื่อ/เลขที่เอกสาร)
// ไม่แตะ revision/content_ref — ใช้แท็บ "เพิ่ม Revision" แยกถ้าต้องการเปลี่ยนไฟล์
// ========================================================
function actionDocUpdate(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ' };
  }
  var docId = String(params.doc_id || '');
  if (!docId) return { success: false, error: 'ต้องระบุ doc_id' };

  var ss = getMasterSS();
  var sheet = ss.getSheetByName('M_Document');
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var col = {};
  header.forEach(function (h, i) { col[h] = i + 1; });

  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === docId) { rowIdx = i + 1; break; }
  }
  if (rowIdx < 0) return { success: false, error: 'ไม่พบเอกสารนี้: ' + docId };

  var before = JSON.stringify(data[rowIdx - 1]);
  var fields = { doctype_id: params.doctype_id, family_id: params.family_id, line_id: params.line_id,
    doc_name: params.doc_name, doc_no: params.doc_no, series_tag: params.series_tag, model_group: params.model_group };
  Object.keys(fields).forEach(function (key) {
    if (fields[key] !== undefined && fields[key] !== null && col[key]) {
      sheet.getRange(rowIdx, col[key]).setValue(String(fields[key]));
    }
  });

  bumpMasterVersion();
  auditLog(user, 'doc.update', 'M_Document', docId, before, JSON.stringify(fields));
  return { success: true };
}

// ========================================================
// Admin: จัดการรายชื่อพนักงาน (M_Employee) — เติม dropdown "เลือกชื่อผู้บันทึก (Recorder)"
// ใช้สิทธิ์ document.manage ร่วมกับเมนู Admin อื่นๆ ในหน้าเดียวกัน ไม่แยก permission ใหม่
// (M_Employee ต้องมีอยู่แล้ว — รัน setupMasterSheets() ครั้งเดียวก่อนใช้งานเมนูนี้)
// ========================================================
// กะของพนักงาน — ว่าง/*/ALL ถือว่า "ขึ้นได้ทุกกะ" (หัวหน้า/QC ที่เดินข้ามกะ และแถวเก่าที่ยังไม่เคย
// ตั้งค่าก่อนมีคอลัมน์นี้) นอกนั้นเก็บเป็นตัวพิมพ์ใหญ่ให้ตรงกับ shift_id ในชีท M_Shift
function normEmployeeShift_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return (!s || s === '*' || s === 'ALL') ? 'ALL' : s;
}

// เขียนแถวใหม่โดยอ้างชื่อคอลัมน์จาก header จริงของชีท (ไม่ใช่ลำดับตายตัว) — ชีทของแต่ละที่อาจมี
// คอลัมน์ไม่ครบ/สลับลำดับหลังเพิ่มฟิลด์ใหม่ appendRow แบบ positional จะเขียนผิดช่อง
function appendMasterRowByHeader_(sheet, obj) {
  var header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  sheet.appendRow(header.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  }));
}

function actionEmployeeCreate(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ (ต้องมีสิทธิ์ document.manage)' };
  }
  var name = String(params.name || '').trim();
  if (!name) return { success: false, error: 'กรุณากรอกชื่อพนักงาน' };
  var shift = normEmployeeShift_(params.shift);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getMasterSS();
    var sheet = ss.getSheetByName('M_Employee');
    if (!sheet) return { success: false, error: 'ยังไม่มีชีท M_Employee — รัน setupMasterSheets() ใน Apps Script editor ก่อน' };
    var rows = readMaster('M_Employee');
    // ใช้เลข ID ที่กรอกเอง (เช่น รหัสพนักงานจริงของโรงงาน) ถ้ามี — ไม่งั้น auto-generate ให้
    var employeeId = String(params.employee_id || '').trim();
    if (employeeId) {
      var dup = rows.some(function (r) { return String(r.employee_id) === employeeId; });
      if (dup) return { success: false, error: 'มีรหัสพนักงาน "' + employeeId + '" อยู่แล้ว' };
    } else {
      employeeId = 'EMP-' + Date.now().toString(36).toUpperCase();
    }
    var nextSeq = rows.reduce(function (max, r) { return Math.max(max, Number(r.sequence) || 0); }, 0) + 1;
    appendMasterRowByHeader_(sheet, {
      employee_id: employeeId, name: name, sequence: nextSeq, status: 'ACTIVE', shift: shift
    });
    bumpMasterVersion();
    auditLog(user, 'employee.create', 'M_Employee', employeeId, '', name + ' / กะ ' + shift);
    return { success: true, employee_id: employeeId };
  } finally {
    lock.releaseLock();
  }
}

// params.employee_id = รหัสเดิม (ใช้หาแถว) / params.new_employee_id = รหัสใหม่ที่จะเปลี่ยนเป็น (ถ้าจะแก้รหัสด้วย)
function actionEmployeeUpdate(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ' };
  }
  var employeeId = String(params.employee_id || '');
  var name = String(params.name || '').trim();
  if (!employeeId || !name) return { success: false, error: 'ข้อมูลไม่ครบ' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getMasterSS();
    var sheet = ss.getSheetByName('M_Employee');
    if (!sheet) return { success: false, error: 'ไม่พบชีท M_Employee' };
    var data = sheet.getDataRange().getValues();
    var header = data[0];
    var idCol = header.indexOf('employee_id') + 1;
    var nameCol = header.indexOf('name') + 1;
    var shiftCol = header.indexOf('shift') + 1; // 0 = ชีทยังไม่มีคอลัมน์นี้ (ยังไม่ได้รัน setupMasterSheets ใหม่)
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === employeeId) { rowIdx = i + 1; break; }
    }
    if (rowIdx < 0) return { success: false, error: 'ไม่พบพนักงานนี้: ' + employeeId };
    var before = JSON.stringify({
      employee_id: employeeId,
      name: String(data[rowIdx - 1][nameCol - 1]),
      shift: shiftCol ? normEmployeeShift_(data[rowIdx - 1][shiftCol - 1]) : ''
    });

    var newEmployeeId = String(params.new_employee_id || '').trim();
    if (newEmployeeId && newEmployeeId !== employeeId) {
      var dup = false;
      for (var j = 1; j < data.length; j++) {
        if (j !== rowIdx - 1 && String(data[j][0]) === newEmployeeId) { dup = true; break; }
      }
      if (dup) return { success: false, error: 'มีรหัสพนักงาน "' + newEmployeeId + '" อยู่แล้ว' };
      sheet.getRange(rowIdx, idCol).setValue(newEmployeeId);
      employeeId = newEmployeeId;
    }
    sheet.getRange(rowIdx, nameCol).setValue(name);
    // ส่ง shift มาเมื่อไหร่ค่อยเขียนทับ — ไม่ส่งมา = ไม่แตะค่าเดิม (กันหน้าจอเก่าที่ยังไม่รู้จักฟิลด์นี้
    // เผลอล้างกะของทุกคนทิ้ง)
    var shift = '';
    if (shiftCol && params.shift !== undefined && params.shift !== null && String(params.shift) !== '') {
      shift = normEmployeeShift_(params.shift);
      sheet.getRange(rowIdx, shiftCol).setValue(shift);
    }

    bumpMasterVersion();
    auditLog(user, 'employee.update', 'M_Employee', employeeId, before,
      JSON.stringify({ employee_id: employeeId, name: name, shift: shift }));
    return { success: true, employee_id: employeeId };
  } finally {
    lock.releaseLock();
  }
}

function actionEmployeeDelete(params, user) {
  if (!can(user, 'document.manage', {})) {
    return { success: false, error: 'สิทธิ์ไม่พอ' };
  }
  var employeeId = String(params.employee_id || '');
  if (!employeeId) return { success: false, error: 'ต้องระบุ employee_id' };
  var ss = getMasterSS();
  var sheet = ss.getSheetByName('M_Employee');
  if (!sheet) return { success: false, error: 'ไม่พบชีท M_Employee' };
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var statusCol = header.indexOf('status') + 1;
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === employeeId) { rowIdx = i + 1; break; }
  }
  if (rowIdx < 0) return { success: false, error: 'ไม่พบพนักงานนี้: ' + employeeId };
  sheet.getRange(rowIdx, statusCol).setValue('DELETED');
  bumpMasterVersion();
  auditLog(user, 'employee.delete', 'M_Employee', employeeId, 'ACTIVE', 'DELETED');
  return { success: true };
}

// label สถานีสำหรับตั้งชื่อโฟลเดอร์ (เช่น Station12)
function stationLabel(stationId) {
  var rows = readMaster('M_Station');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].station_id) === String(stationId)) {
      var no = String(rows[i].station_no);
      return 'Station' + (no.length < 2 ? '0' + no : no);
    }
  }
  return String(stationId);
}

// ========================================================
// Audit Log (T_AuditLog ใน spreadsheet เดิม — สร้างชีทถ้ายังไม่มี)
// ========================================================
function auditLog(user, action, entityType, entityId, before, after) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('T_AuditLog');
    if (!sheet) {
      sheet = ss.insertSheet('T_AuditLog');
      sheet.getRange(1, 1, 1, 8).setValues([['ts', 'user_id', 'user_name', 'action', 'entity_type', 'entity_id', 'before', 'after']]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([nowISO(), user ? user.employee_id : '', user ? user.name : '',
      action, entityType, entityId, String(before || '').slice(0, 500), String(after || '').slice(0, 500)]);
  } catch (e) { /* audit ห้ามทำให้ action หลักล้ม */ }
}

// ========================================================
// Search Index (T_SearchIndex ใน spreadsheet เดิม — สร้างชีทถ้ายังไม่มี)
// 1 แถวต่อ entity — upsert เมื่อบันทึก record/ลงทะเบียนเอกสาร
// ========================================================
var SEARCH_INDEX_HEADER = ['entity_type', 'entity_id', 'line_id', 'station_id', 'doctype_id', 'keywords', 'updated_at'];

function getSearchIndexSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('T_SearchIndex');
  if (!sheet) {
    sheet = ss.insertSheet('T_SearchIndex');
    sheet.getRange(1, 1, 1, SEARCH_INDEX_HEADER.length).setValues([SEARCH_INDEX_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function buildSearchIndex(entityType, entityId, lineId, stationId, doctypeId, keywords) {
  var sheet = getSearchIndexSheet_();
  var values = sheet.getDataRange().getValues();
  var row = [entityType, entityId, lineId || '', stationId || '', doctypeId || '', String(keywords || '').slice(0, 1000), nowISO()];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === entityType && String(values[i][1]) === String(entityId)) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sheet.appendRow(row);
}

// ค้นหาทั้งระบบ — กรองด้วย query (substring ใน keywords/entity_id) + line/station/doctype
function actionSearch(params, user) {
  var sheet = getSearchIndexSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { success: true, results: [] };
  var header = values[0];
  var q = String(params.query || '').trim().toLowerCase();
  var lineFilter = String(params.line || '');
  var stationFilter = String(params.station || '');
  var doctypeFilter = String(params.doctype || '');

  var results = [];
  for (var i = 1; i < values.length; i++) {
    var r = {};
    for (var j = 0; j < header.length; j++) r[header[j]] = values[i][j];
    if (q) {
      var hay = (String(r.keywords || '') + ' ' + String(r.entity_id || '')).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }
    if (lineFilter && String(r.line_id || '') !== lineFilter) continue;
    if (stationFilter && String(r.station_id || '').indexOf(stationFilter) < 0) continue;
    if (doctypeFilter && String(r.doctype_id || '') !== doctypeFilter) continue;
    results.push({
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      line: r.line_id,
      station: r.station_id,
      doctype: r.doctype_id,
      keywords: r.keywords,
      updated_at: r.updated_at instanceof Date
        ? Utilities.formatDate(r.updated_at, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss")
        : String(r.updated_at || '')
    });
    if (results.length >= 100) break; // จำกัดผลลัพธ์
  }
  results.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
  return { success: true, results: results };
}

// ========================================================
// ลงทะเบียนเอกสารใหม่ + revision (ใช้ตอนแนบ Master Excel ที่แปลงเป็น template แล้ว)
// เรียกจาก editor หรือจาก API document.manage ในอนาคต
//
// ตัวอย่าง:
// registerDocument({
//   doc_id: 'DOC-FP-NLC-L1',       doctype_id: 'first-piece',
//   family_id: 'NLC',              line_id: 'L1',
//   doc_name: 'First Piece: NLC (Line1)',
//   doc_no: 'JRTLQR860-05/1',      // อ่านจากเอกสาร Master; ไม่มี = ผู้สร้างกำหนด
//   print_css: 'css/print/fp-nlc-l1.css',
//   rev_no: 'Rev01',
//   content_ref: 'templates/fp-nlc-l1-rev01.json',
//   effective_date: '2026-07-15',  approved_by: 'Admin', reason: 'First issue',
//   station_ids: ['L1-ST01','L1-ST02']   // สถานีที่ใช้เอกสารนี้
// });
// ========================================================
function registerDocument(def) {
  var ss = getMasterSS();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  var revId = def.doc_id + ':' + def.rev_no;

  // 1) M_Revision — revision ใหม่เป็น CURRENT, ตัวเก่าของ doc เดียวกันเป็น OBSOLETE
  var revSheet = ss.getSheetByName('M_Revision');
  var revData = revSheet.getDataRange().getValues();
  for (var i = 1; i < revData.length; i++) {
    if (String(revData[i][1]) === def.doc_id && String(revData[i][8]) === 'CURRENT') {
      revSheet.getRange(i + 1, 9).setValue('OBSOLETE');
    }
  }
  revSheet.appendRow([revId, def.doc_id, def.rev_no, def.content_ref,
    def.effective_date || '', def.approved_by || '', def.approved_date || def.effective_date || '',
    def.reason || '', 'CURRENT', now]);

  // 2) M_Document — เพิ่มใหม่ หรืออัปเดต current_rev_id ถ้ามีอยู่แล้ว
  var docSheet = ss.getSheetByName('M_Document');
  var docData = docSheet.getDataRange().getValues();
  var found = false;
  for (var d = 1; d < docData.length; d++) {
    if (String(docData[d][0]) === def.doc_id) {
      docSheet.getRange(d + 1, 7).setValue(revId); // current_rev_id
      found = true;
      break;
    }
  }
  if (!found) {
    docSheet.appendRow([def.doc_id, def.doctype_id, def.family_id || '*', def.line_id || '*',
      def.doc_name, def.doc_no || '', revId, def.drive_folder_id || '', def.print_css || '', 'ACTIVE', def.series_tag || '', def.model_group || '']);
  }

  // 3) M_DocAssign — ผูกกับสถานี (ข้ามคู่ที่มีอยู่แล้ว)
  var stationIds = def.station_ids || [];
  if (stationIds.length) {
    var asSheet = ss.getSheetByName('M_DocAssign');
    var existing = {};
    var asData = asSheet.getDataRange().getValues();
    for (var a = 1; a < asData.length; a++) {
      existing[asData[a][1] + '|' + asData[a][2]] = true;
    }
    var newRows = [];
    stationIds.forEach(function (st) {
      if (!existing[def.doc_id + '|' + st]) {
        newRows.push([def.doc_id + '@' + st, def.doc_id, st, 'ACTIVE']);
      }
    });
    if (newRows.length) {
      asSheet.getRange(asSheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
    }
  }

  try {
    var keywords = def.doc_name + ' ' + (def.doc_no || '') + ' ' + def.rev_no;
    buildSearchIndex('Document', def.doc_id, def.line_id || '', (def.station_ids || []).join(','), def.doctype_id || '', keywords);
  } catch(e) {
    Logger.log('Search Index Error: ' + e);
  }

  bumpMasterVersion();
  Logger.log('ลงทะเบียน %s %s แล้ว (%s สถานี)', def.doc_id, def.rev_no, stationIds.length);
  return revId;
}

// ========================================================
// ตั้งค่าครั้งแรก — รันจาก GAS editor
// ========================================================

// สร้าง spreadsheet ENC-MASTER + ชีททั้งหมด (รันซ้ำได้ ไม่ทำลายข้อมูล)
function setupMasterSheets() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MASTER_SPREADSHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('ENC-MASTER');
    props.setProperty('MASTER_SPREADSHEET_ID', ss.getId());
    Logger.log('สร้าง ENC-MASTER แล้ว: %s', ss.getUrl());
  }
  Object.keys(MASTER_SHEET_DEFS).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.getRange(1, 1, 1, MASTER_SHEET_DEFS[name].length).setValues([MASTER_SHEET_DEFS[name]]);
    sheet.setFrozenRows(1);
  });
  // ลบชีท default "Sheet1" ถ้ายังว่าง
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  setupModelSheetValidation(ss);
  setupEmployeeShiftColumn(ss);

  Logger.log('ชีท Master ครบแล้ว — รัน seedMaster() ต่อ');
  return ss.getUrl();
}

// คอลัมน์ shift ของ M_Employee: เติม ALL ให้แถวเก่าที่ยังว่าง (แถวที่มีอยู่ก่อนจะมีฟีเจอร์กะ ต้องขึ้น
// ได้ทุกกะไว้ก่อน ไม่งั้นรายชื่อจะหายไปจากทุก dropdown ทันทีที่เปิดใช้การกรองกะ) + ใส่ dropdown ให้
// เลือกได้เฉพาะกะที่มีจริงในชีท M_Shift หรือ ALL เวลาแก้ในชีทด้วยมือ — รันซ้ำได้ปลอดภัย
function setupEmployeeShiftColumn(ss) {
  var sheet = ss.getSheetByName('M_Employee');
  if (!sheet) return;
  var lastCol = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var shiftCol = header.indexOf('shift') + 1;
  if (!shiftCol) return;

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var range = sheet.getRange(2, shiftCol, lastRow - 1, 1);
    var vals = range.getValues();
    var changed = false;
    for (var i = 0; i < vals.length; i++) {
      var norm = normEmployeeShift_(vals[i][0]);
      if (String(vals[i][0]).trim() !== norm) { vals[i][0] = norm; changed = true; }
    }
    if (changed) range.setValues(vals);
  }

  var options = ['ALL'];
  readMaster('M_Shift').forEach(function (s) {
    var id = String(s.shift_id || '').trim().toUpperCase();
    if (id && String(s.status).toUpperCase() !== 'INACTIVE' && options.indexOf(id) === -1) options.push(id);
  });
  sheet.getRange(2, shiftCol, Math.max(500, lastRow), 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(options, true).setAllowInvalid(false)
      .setHelpText('เลือกกะจาก M_Shift หรือ ALL = ขึ้นได้ทุกกะ')
      .build()
  );
}

// ป้องกันพิมพ์ผิดตอนกรอกชีท M_Model ด้วยมือ:
// - family_id (คอลัมน์ B) ต้องเป็นค่าที่มีอยู่จริงใน M_ProductFamily คอลัมน์ A เท่านั้น (dropdown)
// - status (คอลัมน์ D) จำกัดเป็น ACTIVE/INACTIVE
// รันซ้ำได้ปลอดภัย — แค่ตั้งกฎ validation ใหม่ทับของเดิม ไม่แตะข้อมูล
function setupModelSheetValidation(ss) {
  var famSheet = ss.getSheetByName('M_ProductFamily');
  var modelSheet = ss.getSheetByName('M_Model');
  var docSheet = ss.getSheetByName('M_Document');
  if (!famSheet || !modelSheet) return;

  var famRange = famSheet.getRange('A2:A500'); // family_id — เผื่อแถวว่างล่วงหน้าไว้เพิ่มรุ่นหลักใหม่ได้เลย
  var famRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(famRange, true).setAllowInvalid(false)
    .setHelpText('เลือก family_id จากชีท M_ProductFamily เท่านั้น — ป้องกันพิมพ์ผิดจนเชื่อมรุ่นหลักไม่ติด')
    .build();
  modelSheet.getRange('B2:B2000').setDataValidation(famRule);

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['ACTIVE', 'INACTIVE'], true).setAllowInvalid(false)
    .build();
  modelSheet.getRange('D2:D2000').setDataValidation(statusRule);

  // ---- M_Document: กันพิมพ์ผิดตอนแก้ family_id / series_tag ตรงในชีทเลย (bulk edit แทนแก้ทีละเอกสารในหน้าเว็บ) ----
  if (docSheet) {
    // family_id (คอลัมน์ C) — เหมือน M_Model แต่ M_Document อนุญาต '*' (ทุกรุ่นหลัก) และเว้นว่างได้ด้วย จึงไม่บังคับปฏิเสธค่านอกลิสต์
    var docFamRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(famRange, true).setAllowInvalid(true)
      .setHelpText('เลือก family_id จาก M_ProductFamily หรือพิมพ์ * เองถ้าใช้ได้ทุกรุ่นหลัก')
      .build();
    docSheet.getRange('C2:C2000').setDataValidation(docFamRule);

    // series_tag (คอลัมน์ K) — อ้างอิงค่าที่เคยตั้งไว้ใน M_Model คอลัมน์ E (ซ้ำกันได้ ไม่เป็นไร) เว้นว่างได้ (= ใช้ได้ทุกซีรีส์)
    var modelSeriesRange = modelSheet.getRange('E2:E2000');
    var docSeriesRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(modelSeriesRange, true).setAllowInvalid(true)
      .setHelpText('เลือกซีรีส์ที่เคยตั้งไว้ใน M_Model เท่านั้น — เว้นว่างได้ถ้าเอกสารนี้ใช้ได้ทุกซีรีส์ของรุ่นหลัก')
      .build();
    docSheet.getRange('K2:K2000').setDataValidation(docSeriesRule);

    // model_group (คอลัมน์ L) — แยกย่อยกว่า series_tag อีกชั้น (เช่น series="Visi Smart" แต่แยกเอกสารเป็นรุ่น EZ / L)
    // อ้างอิงค่าที่เคยตั้งไว้ใน M_Model คอลัมน์ F เว้นว่างได้ (= ไม่แยกกลุ่มรุ่นย่อย)
    var modelGroupRange = modelSheet.getRange('F2:F2000');
    var docModelGroupRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(modelGroupRange, true).setAllowInvalid(true)
      .setHelpText('เลือกกลุ่มรุ่นย่อยที่เคยตั้งไว้ใน M_Model เท่านั้น — เว้นว่างได้ถ้าเอกสารนี้ไม่ต้องแยกกลุ่มรุ่น')
      .build();
    docSheet.getRange('L2:L2000').setDataValidation(docModelGroupRule);
  }
}

// seed ข้อมูลตั้งต้น: ENC + Line1/4/5 + 37 สถานี + DocType + Role + Permission
// (รันซ้ำได้ — ข้ามชีทที่มีข้อมูลแล้ว เพื่อไม่ทับของที่ Admin แก้ไป)
function seedMaster() {
  var ss = getMasterSS();

  function seedIfEmpty(name, rows) {
    var sheet = ss.getSheetByName(name);
    if (sheet.getLastRow() > 1) {
      Logger.log('%s มีข้อมูลแล้ว — ข้าม', name);
      return;
    }
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      Logger.log('%s: seed %s แถว', name, rows.length);
    }
  }

  // ---- Plant ----
  seedIfEmpty('M_Plant', [['ENC', 'ENC', 'ENC (H9)', 'ACTIVE']]);

  // ---- Lines ----
  seedIfEmpty('M_Line', [
    ['L1', 'ENC', 'Line1', 'ไลน์ 1', 1, 'ACTIVE'],
    ['L4', 'ENC', 'Line4', 'ไลน์ 4', 2, 'ACTIVE'],
    ['L5', 'ENC', 'Line5', 'ไลน์ 5', 3, 'ACTIVE']
  ]);

  // ---- Stations: L1 8 สถานี, L4 21 สถานี, L5 8 สถานี ----
  var stations = [];
  [['L1', 8], ['L4', 21], ['L5', 8]].forEach(function (def) {
    for (var n = 1; n <= def[1]; n++) {
      var no = (n < 10 ? '0' : '') + n;
      stations.push([def[0] + '-ST' + no, def[0], n, 'Station ' + n, n, 'ACTIVE']);
    }
  });
  seedIfEmpty('M_Station', stations);

  // ---- Document Types (behavior + workflow เป็นข้อมูล — เพิ่มได้ไม่แก้โค้ด) ----
  var WF_LEADER_QI = JSON.stringify([
    { step: 1, role: 'Leader', label: 'หัวหน้างานยืนยัน' },
    { step: 2, role: 'QI', label: 'QI อนุมัติ' }
  ]);
  var WF_LEADER = JSON.stringify([
    { step: 1, role: 'Leader', label: 'หัวหน้างานยืนยัน' }
  ]);
  seedIfEmpty('M_DocType', [
    ['first-piece', 'First Piece', 'ตรวจชิ้นงานตัวแรก', 'form', WF_LEADER_QI, 'FP', '🔍', 1, 'ACTIVE'],
    ['ok-1st-part', 'OK 1st Part', 'Checklist ประจำสถานี', 'form', WF_LEADER, 'OK', '✅', 2, 'ACTIVE'],
    ['check-sheet', 'Check Sheet', 'ใบตรวจสอบ', 'form', WF_LEADER, 'CS', '📋', 3, 'ACTIVE'],
    ['inspection-record', 'Inspection Record', 'บันทึกการตรวจสอบ', 'form', WF_LEADER_QI, 'IR', '📝', 4, 'ACTIVE'],
    ['audit', 'Audit Form', 'แบบฟอร์ม Audit', 'form', WF_LEADER_QI, 'AU', '🕵️', 5, 'ACTIVE'],
    ['wi', 'WI', 'Work Instruction', 'file', '', '', '📖', 6, 'ACTIVE'],
    ['ows', 'OWS', 'Operation Work Standard', 'file', '', '', '📄', 7, 'ACTIVE'],
    ['drawing', 'Drawing', 'แบบ Drawing', 'file', '', '', '📐', 8, 'ACTIVE'],
    ['specification', 'Specification', 'ข้อกำหนด', 'file', '', '', '📑', 9, 'ACTIVE'],
    ['standard', 'Standard', 'มาตรฐาน', 'file', '', '', '📚', 10, 'ACTIVE'],
    ['ng-example', 'NG Example', 'ตัวอย่างงานเสีย', 'file', '', '', '⚠️', 11, 'ACTIVE'],
    ['photo-standard', 'Photo Standard', 'รูปมาตรฐาน', 'file', '', '', '🖼️', 12, 'ACTIVE'],
    ['training', 'Training Document', 'เอกสารฝึกอบรม', 'file', '', '', '🎓', 13, 'ACTIVE'],
    ['recovery', 'Recovery', 'แผนแก้ไข', 'recovery', WF_LEADER, 'RC', '🔧', 14, 'ACTIVE']
  ]);

  // ---- Roles (dynamic — 4 เดิม + เตรียมอนาคต) ----
  seedIfEmpty('M_Role', [
    ['Admin', 'Admin', 'ผู้ดูแลระบบ', 1, 'ACTIVE'],
    ['Operator', 'Operator', 'พนักงานปฏิบัติการ', 2, 'ACTIVE'],
    ['Leader', 'Leader', 'หัวหน้างาน', 3, 'ACTIVE'],
    ['QI', 'QI', 'Quality Inspector', 4, 'ACTIVE'],
    ['QA', 'QA', 'Quality Assurance', 5, 'ACTIVE'],
    ['PE', 'PE', 'Process Engineer', 6, 'ACTIVE'],
    ['DocControl', 'Document Control', 'ควบคุมเอกสาร', 7, 'ACTIVE'],
    ['ProdManager', 'Production Manager', 'ผู้จัดการฟ่ายผลิต', 8, 'ACTIVE'],
    ['SectionManager', 'Section Manager', 'ผู้จัดการส่วน', 9, 'ACTIVE'],
    ['FactoryManager', 'Factory Manager', 'ผู้จัดการโรงงาน', 10, 'ACTIVE']
  ]);

  // ---- Permissions (เทียบเท่าพฤติกรรมระบปจจุบันเป๊ะ + สิทธิ์อ่านให้ role ใหม่) ----
  seedIfEmpty('M_Permission', [
    ['P001', 'Admin', '*', '*', '*'],
    ['P010', 'Operator', 'record.create', '*', '*'],
    ['P011', 'Operator', 'record.view', '*', '*'],
    ['P012', 'Operator', 'doc.view', '*', '*'],
    ['P013', 'Operator', 'recovery.create', '*', '*'],
    ['P020', 'Leader', 'record.approve.step', '*', '*'],
    ['P021', 'Leader', 'record.view', '*', '*'],
    ['P022', 'Leader', 'doc.view', '*', '*'],
    ['P023', 'Leader', 'record.create', '*', '*'],
    ['P024', 'Leader', 'recovery.close', '*', '*'],
    ['P030', 'QI', 'record.approve.step', '*', '*'],
    ['P031', 'QI', 'record.view', '*', '*'],
    ['P032', 'QI', 'doc.view', '*', '*'],
    ['P040', 'QA', 'record.view', '*', '*'],
    ['P041', 'QA', 'doc.view', '*', '*'],
    ['P050', 'PE', 'record.view', '*', '*'],
    ['P051', 'PE', 'doc.view', '*', '*'],
    ['P060', 'DocControl', 'document.manage', '*', '*'],
    ['P061', 'DocControl', 'doc.view', '*', '*'],
    ['P070', 'ProdManager', 'record.view', '*', '*'],
    ['P071', 'ProdManager', 'doc.view', '*', '*'],
    ['P080', 'SectionManager', 'record.view', '*', '*'],
    ['P081', 'SectionManager', 'doc.view', '*', '*'],
    ['P090', 'FactoryManager', 'record.view', '*', '*'],
    ['P091', 'FactoryManager', 'doc.view', '*', '*']
  ]);

  // ---- Product Families (รุ่นหลัก — รุ่นย่อย import เข้า M_Model ภายหลัง) ----
  seedIfEmpty('M_ProductFamily', [
    ['NMS', 'NMS', 'NMS', 1, 'ACTIVE'],
    ['NLC', 'NLC', 'NLC', 2, 'ACTIVE'],
    ['LC', 'LC', 'Loadcenter', 3, 'ACTIVE'],
    ['CU', 'CU', 'Loadcenter CU', 4, 'ACTIVE']
  ]);

  // ---- Shifts ----
  seedIfEmpty('M_Shift', [
    ['A', 'A', '08:00-20:00', 'ACTIVE'],
    ['B', 'B', '20:00-08:00', 'ACTIVE']
  ]);

  // ---- ลงทะเบียนเอกสารเดิม 2 ใบเข้าทะเบียนใหม่ (ของเดิมยังใช้ผ่าน CONFIG.FORMS ตามปกติ) ----
  if (readMaster('M_Document').length === 0) {
    registerDocument({
      doc_id: 'DOC-FP-NMS',
      doctype_id: 'first-piece',
      family_id: 'NMS',
      line_id: '*',
      doc_name: 'First Piece Check List: NMS',
      doc_no: 'JRTLQR860-04/1',
      print_css: 'css/print-nms.css',
      rev_no: 'Rev01',
      content_ref: 'templates/nms-first-piece-rev1.json',
      effective_date: '2026-07-08',
      approved_by: 'Admin',
      reason: 'Initial registration (migrated from Phase 1)',
      station_ids: []
    });
    registerDocument({
      doc_id: 'DOC-OK-NLC',
      doctype_id: 'ok-1st-part',
      family_id: 'NLC',
      line_id: '*',
      doc_name: 'OK 1st Part Workstation Checklist (NLC)',
      doc_no: 'THPLSTL-QA-FRM0-3434 Rev.0 (05/23)',
      print_css: 'css/print-ok1st.css',
      rev_no: 'Rev00',
      content_ref: 'templates/ok-1st-part-nlc-rev0.json',
      effective_date: '2026-07-08',
      approved_by: 'Admin',
      reason: 'Initial registration (migrated from Phase 1)',
      station_ids: []
    });
  }

  bumpMasterVersion();
  Logger.log('seedMaster เสร็จ — เปิด ENC-MASTER ตรวจข้อมูล แล้วผูกเอกสารกับสถานีใน M_DocAssign');
  return getMasterSS().getUrl();
}

// ========================================================
// Dashboard Stats — สรุป KPI + trend 7 วัน + activity
// client เอา slim record ไป aggregate เอง (กรอง Line/Station ได้โดยไม่ยิง API ซ้ำ)
//
// pending นับข้ามทุกปีเสมอ (ของค้างอาจเก่าข้ามปีได้) แต่ใช้ countPendingAcrossAllYears_()
// ที่อ่านแค่คอลัมน์ status ประหยัดกว่าดึงทั้งแถว — ส่วน today/week/recent อ่านแค่ปีที่เกี่ยวข้อง
// (recordSheetNamesForRange_ + legacy) ไม่ต้องไล่ทุกปีเหมือน pending
// ========================================================
function actionDashboardStats(params, user) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var since = Utilities.formatDate(new Date(Date.now() - 6 * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var data = readRecordsAcross_(recordSheetNamesForRange_(since, today));

  var todayTotal = 0, todayNok = 0;
  var week = [];   // slim record 7 วันล่าสุด — client กรอง/aggregate เอง
  var recent = []; // activity ล่าสุด

  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    var status = String(r.status);
    var date = normDate(r.date);
    var isNok = String(r.has_nok) === 'true';
    if (date === today && status !== 'REJECTED') {
      todayTotal++;
      if (isNok) todayNok++;
    }
    if (date >= since && date <= today && status !== 'REJECTED' && week.length < 2000) {
      week.push({ date: date, line: String(r.line), station: String(r.station), nok: isNok });
    }
    recent.push({
      record_id: String(r.record_id), form_id: String(r.form_id),
      line: String(r.line), station: String(r.station), status: status,
      has_nok: String(r.has_nok), operator_name: String(r.operator_name),
      created_at: String(r.created_at)
    });
  }
  recent.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  var pending = countPendingAcrossAllYears_();
  return {
    success: true,
    today: today, since: since,
    pending: pending, today_total: todayTotal, today_nok: todayNok,
    week: week,
    recent: recent.slice(0, 12)
  };
}

// ========================================================
// Notification — event ถึง role หรือเจาะจง user (T_Notification ใน spreadsheet เดิม)
// read state เก็บเป็นรายชื่อ employee_id ใน read_by (คั่น ,) — ทีมขนาดโรงงานพอไหว
// ========================================================
var NOTIF_HEADER = ['notif_id', 'ts', 'event_type', 'target_role', 'target_user', 'title', 'body', 'link', 'read_by'];

function getNotifSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('T_Notification');
  if (!sheet) {
    sheet = ss.insertSheet('T_Notification');
    sheet.getRange(1, 1, 1, NOTIF_HEADER.length).setValues([NOTIF_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// เรียกจากจุด state change — ห้ามทำให้ action หลักล้ม
function pushNotification(eventType, targetRole, targetUser, title, body, link) {
  try {
    getNotifSheet_().appendRow([
      'N-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4),
      nowISO(), eventType, targetRole || '', targetUser || '',
      String(title || '').slice(0, 200), String(body || '').slice(0, 400), link || '', ''
    ]);
  } catch (e) { Logger.log('Notification Error: ' + e); }
}

// แจ้งเตือนของฉัน: เจาะจงถึงฉัน (target_user) หรือถึง role ของฉัน — ล่าสุดก่อน สูงสุด 30
function actionNotifList(params, user) {
  var sheet = getNotifSheet_();
  var values = sheet.getDataRange().getValues();
  var out = [], unread = 0;
  for (var i = values.length - 1; i >= 1 && out.length < 30; i--) {
    var row = {};
    for (var j = 0; j < NOTIF_HEADER.length; j++) row[NOTIF_HEADER[j]] = values[i][j];
    var toMe = String(row.target_user) === String(user.employee_id);
    var toMyRole = !row.target_user && (String(row.target_role) === String(user.role) || String(row.target_role) === '*');
    if (!toMe && !toMyRole) continue;
    var readBy = String(row.read_by || '').split(',');
    var isRead = readBy.indexOf(String(user.employee_id)) >= 0;
    if (!isRead) unread++;
    out.push({
      notif_id: String(row.notif_id),
      ts: row.ts instanceof Date ? Utilities.formatDate(row.ts, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss") : String(row.ts),
      event_type: String(row.event_type), personal: toMe,
      title: String(row.title), body: String(row.body), link: String(row.link || ''),
      read: isRead
    });
  }
  return { success: true, notifications: out, unread: unread };
}

// ตั้งอ่านแล้วทั้งหมดของ user นี้ (เติม employee_id ลง read_by)
function actionNotifMarkRead(params, user) {
  var sheet = getNotifSheet_();
  var values = sheet.getDataRange().getValues();
  var me = String(user.employee_id);
  for (var i = 1; i < values.length; i++) {
    var targetUser = String(values[i][4]);
    var targetRole = String(values[i][3]);
    var toMe = targetUser === me;
    var toMyRole = !targetUser && (targetRole === String(user.role) || targetRole === '*');
    if (!toMe && !toMyRole) continue;
    var readBy = String(values[i][8] || '');
    if (readBy.split(',').indexOf(me) < 0) {
      sheet.getRange(i + 1, 9).setValue(readBy ? readBy + ',' + me : me);
    }
  }
  return { success: true };
}

// ========================================================
// User Management — Admin (หรือสิทธิ์ user.manage) เท่านั้น
// ========================================================
function actionUserList(params, user) {
  if (!can(user, 'user.manage', {})) return { success: false, error: 'สิทธิ์ไม่พอ (ต้องเป็น Admin)' };
  var data = readAll(SHEET_USERS);
  var out = data.rows.map(function (u) {
    return {
      employee_id: String(u.employee_id), name: String(u.name),
      role: String(u.role), line: String(u.line || ''),
      active: String(u.active).toLowerCase() === 'true' || u.active === true
    };
  });
  return { success: true, users: out };
}

function actionUserCreate(params, user) {
  if (!can(user, 'user.manage', {})) return { success: false, error: 'สิทธิ์ไม่พอ (ต้องเป็น Admin)' };
  var empId = String(params.employee_id || '').trim();
  var name = String(params.name || '').trim();
  var pin = String(params.pin || '').trim();
  var role = String(params.role || 'Operator').trim();
  if (!empId || !name || !pin) return { success: false, error: 'กรอกไม่ครบ (รหัสพนักงาน/ชื่อ/PIN)' };
  if (pin.length < 4) return { success: false, error: 'PIN ต้องยาวอย่างน้อย 4 หลัก' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var data = readAll(SHEET_USERS);
    for (var i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i].employee_id) === empId) {
        return { success: false, error: 'รหัสพนักงาน ' + empId + ' มีอยู่แล้ว' };
      }
    }
    getSheet(SHEET_USERS).appendRow([empId, name, pin, role, String(params.line || ''), '', '', 'true']);
    auditLog(user, 'user.create', 'Users', empId, '', JSON.stringify({ name: name, role: role }));
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// แก้ไขผู้ใช้: ชื่อ/role/line/เปิด-ปิดบัญชี/reset PIN — ตาม field ที่ส่งมา
function actionUserUpdate(params, user) {
  if (!can(user, 'user.manage', {})) return { success: false, error: 'สิทธิ์ไม่พอ (ต้องเป็น Admin)' };
  var empId = String(params.employee_id || '').trim();
  if (!empId) return { success: false, error: 'ไม่ระบุรหัสพนักงาน' };

  var data = readAll(SHEET_USERS);
  for (var i = 0; i < data.rows.length; i++) {
    var u = data.rows[i];
    if (String(u.employee_id) !== empId) continue;
    var before = JSON.stringify({ name: u.name, role: u.role, line: u.line, active: u.active });
    if (params.name !== undefined) u.name = String(params.name);
    if (params.role !== undefined) u.role = String(params.role);
    if (params.line !== undefined) u.line = String(params.line);
    if (params.active !== undefined) {
      u.active = (params.active === true || params.active === 'true') ? 'true' : 'false';
      if (u.active === 'false') { u.token = ''; u.token_expiry = ''; } // ปิดบัญชี = ตัด session ทันที
    }
    if (params.new_pin) {
      if (String(params.new_pin).length < 4) return { success: false, error: 'PIN ใหม่ต้องยาวอย่างน้อย 4 หลัก' };
      u.pin = String(params.new_pin);
      u.token = ''; u.token_expiry = '';
    }
    writeRow(SHEET_USERS, u._rowIndex, data.header, u);
    auditLog(user, 'user.update', 'Users', empId, before,
      JSON.stringify({ name: u.name, role: u.role, line: u.line, active: u.active, pin_reset: !!params.new_pin }));
    return { success: true };
  }
  return { success: false, error: 'ไม่พบผู้ใช้: ' + empId };
}
