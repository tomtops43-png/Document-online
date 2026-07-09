/**
 * ========================================================
 * Code.gs — Backend ระบบ First Piece / OK 1st Part
 * Google Apps Script Web App (Execute as: Me / Access: Anyone)
 *
 * Sheets ที่ต้องมีใน spreadsheet (ดู SETUP.md):
 *   Records | Recovery | Users | Config
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
  'created_at', 'updated_at'
];
var RECOVERY_HEADER = [
  'record_id', 'item_id', 'problem', 'countermeasure',
  'operator_sign', 'operator_ts', 'leader_sign', 'leader_ts', 'decision'
];
var USERS_HEADER = [
  'employee_id', 'name', 'pin_hash', 'role', 'line', 'token', 'token_expiry', 'active'
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

      // ---- ระบบเดิม (form-driven) — ยังทำงานเหมือนเดิมระหว่าง migration ----
      case 'getRecords':   return jsonOut(actionGetRecords(params, user));
      case 'getRecord':    return jsonOut(actionGetRecord(params, user));
      case 'getLogSheet':  return jsonOut(actionGetLogSheet(params, user));
      case 'createRecord': return jsonOut(actionCreateRecord(params, user));
      case 'approveRecord': return jsonOut(actionApproveRecord(params, user));
      case 'rejectRecord': return jsonOut(actionRejectRecord(params, user));
      case 'uploadPhoto':  return jsonOut(actionUploadPhoto(params, user));
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

function hashPin(pin) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin), Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

// ---------- auth ----------
function actionLogin(params) {
  var empId = String(params.employee_id || '').trim();
  var pin = String(params.pin || '').trim();
  if (!empId || !pin) return { success: false, error: 'กรุณากรอกรหัสพนักงานและ PIN' };

  var data = readAll(SHEET_USERS);
  var pinHash = hashPin(pin);
  for (var i = 0; i < data.rows.length; i++) {
    var u = data.rows[i];
    if (String(u.employee_id) === empId) {
      if (String(u.active).toLowerCase() !== 'true' && u.active !== true) {
        return { success: false, error: 'บัญชีถูกปิดใช้งาน' };
      }
      if (String(u.pin_hash) !== pinHash) {
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
  var data = readAll(SHEET_RECORDS);
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
  return { success: true, records: out };
}

function findRecordRow(recordId) {
  var data = readAll(SHEET_RECORDS);
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i].record_id) === String(recordId)) {
      return { header: data.header, row: data.rows[i] };
    }
  }
  return null;
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
  var data = readAll(SHEET_RECORDS);
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

// สร้าง record_id: FP-{LINE}-{YYYYMMDD}-{running 3 หลัก} (กัน race ด้วย LockService)
function generateRecordId(line, dateStr) {
  var ymd = String(dateStr || '').replace(/-/g, '');
  var prefix = 'FP-' + String(line || 'X').toUpperCase() + '-' + ymd + '-';
  var data = readAll(SHEET_RECORDS);
  var max = 0;
  for (var i = 0; i < data.rows.length; i++) {
    var id = String(data.rows[i].record_id);
    if (id.indexOf(prefix) === 0) {
      var n = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  var next = String(max + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + next;
}

function actionCreateRecord(params, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = nowISO();
    var recordId = generateRecordId(params.line, params.date);
    var record = {
      record_id: recordId,
      form_id: params.form_id,
      template_rev: params.template_rev || '',
      mode: params.mode || 'single-record',
      line: params.line || '',
      station: params.station || '',
      product_model: params.product_model || '',
      date: params.date || '',
      shift: params.shift || '',
      answers_json: JSON.stringify(params.answers || {}),
      photos_json: JSON.stringify({}),
      status: 'PENDING_LEADER',
      has_nok: params.has_nok ? 'true' : 'false',
      reject_reason: '',
      operator_id: user.employee_id,
      operator_name: user.name,
      operator_ts: now,
      leader_id: '', leader_name: '', leader_ts: '',
      qi_id: '', qi_name: '', qi_ts: '',
      created_at: now,
      updated_at: now
    };
    var row = RECORDS_HEADER.map(function (h) { return record[h] !== undefined ? record[h] : ''; });
    getSheet(SHEET_RECORDS).appendRow(row);

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

    return { success: true, record_id: recordId };
  } finally {
    lock.releaseLock();
  }
}

// Leader อนุมัติ → PENDING_QI (single-record) หรือ COMPLETED (log-sheet)
// QI อนุมัติ → COMPLETED
function actionApproveRecord(params, user) {
  requireRole(user, ['Leader', 'QI']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findRecordRow(params.record_id);
    if (!found) return { success: false, error: 'ไม่พบบันทึก' };
    var r = found.row;
    var now = nowISO();

    if (String(r.status) === 'PENDING_LEADER') {
      if (user.role !== 'Leader' && user.role !== 'Admin') {
        return { success: false, error: 'ขั้นนี้ต้องให้ Leader อนุมัติ' };
      }
      r.leader_id = user.employee_id;
      r.leader_name = user.name;
      r.leader_ts = now;
      // log-sheet มี 2 ระดับ: Leader อนุมัติ = จบ
      r.status = (String(r.mode) === 'log-sheet') ? 'COMPLETED' : 'PENDING_QI';
    } else if (String(r.status) === 'PENDING_QI') {
      if (user.role !== 'QI' && user.role !== 'Admin') {
        return { success: false, error: 'ขั้นนี้ต้องให้ QI อนุมัติ' };
      }
      r.qi_id = user.employee_id;
      r.qi_name = user.name;
      r.qi_ts = now;
      r.status = 'COMPLETED';
    } else {
      return { success: false, error: 'สถานะปัจจุบัน (' + r.status + ') อนุมัติไม่ได้' };
    }
    r.updated_at = now;
    writeRow(SHEET_RECORDS, r._rowIndex, found.header, r);
    return { success: true, status: r.status };
  } finally {
    lock.releaseLock();
  }
}

function actionRejectRecord(params, user) {
  requireRole(user, ['Leader', 'QI']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findRecordRow(params.record_id);
    if (!found) return { success: false, error: 'ไม่พบบันทึก' };
    var r = found.row;
    if (String(r.status) !== 'PENDING_LEADER' && String(r.status) !== 'PENDING_QI') {
      return { success: false, error: 'สถานะปัจจุบัน (' + r.status + ') ตีกลับไม่ได้' };
    }
    r.status = 'REJECTED';
    r.reject_reason = String(params.reason || '');
    r.updated_at = nowISO();
    writeRow(SHEET_RECORDS, r._rowIndex, found.header, r);
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

// โฟลเดอร์ {root}/{line}/{YYYY-MM}/ (สร้างถ้ายังไม่มี)
function getPhotoFolder(line, dateStr) {
  var rootId = getConfigValue('drive_root_folder_id');
  if (!rootId) throw new Error('ยังไม่ได้ตั้งค่า drive_root_folder_id ในชีท Config');
  var folder = DriveApp.getFolderById(rootId);
  var ym = String(dateStr || nowISO()).substring(0, 7); // YYYY-MM
  [String(line || 'X'), ym].forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function actionUploadPhoto(params, user) {
  var recordId = String(params.record_id || '');
  var itemId = String(params.item_id || '');
  if (!recordId || !itemId || !params.base64) {
    return { success: false, error: 'ข้อมูลรูปไม่ครบ (record_id/item_id/base64)' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var found = findRecordRow(recordId);
    if (!found) return { success: false, error: 'ไม่พบบันทึก: ' + recordId };
    var r = found.row;

    var photos = {};
    try { photos = JSON.parse(String(r.photos_json || '{}')); } catch (e) { photos = {}; }
    var n = (photos[itemId] || []).length + 1;

    var fileName = recordId + '_' + itemId + '_' + n + '.jpg';
    var blob = Utilities.newBlob(Utilities.base64Decode(params.base64), 'image/jpeg', fileName);
    var folder = getPhotoFolder(params.line || r.line, normDate(r.date));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    photos[itemId] = photos[itemId] || [];
    photos[itemId].push({ fileId: file.getId(), fileName: fileName, ts: nowISO() });
    r.photos_json = JSON.stringify(photos);
    r.updated_at = nowISO();
    writeRow(SHEET_RECORDS, r._rowIndex, found.header, r);

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
  getSheet(SHEET_USERS).appendRow([employeeId, name, hashPin(pin), role, line, '', '', 'true']);
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
  M_Document: ['doc_id', 'doctype_id', 'family_id', 'line_id', 'doc_name', 'doc_no', 'current_rev_id', 'drive_folder_id', 'print_css', 'status'],
  M_DocAssign: ['assign_id', 'doc_id', 'station_id', 'status'],
  M_Revision: ['rev_id', 'doc_id', 'rev_no', 'content_ref', 'effective_date', 'approved_by', 'approved_date', 'reason', 'status', 'created_at'],
  M_Role: ['role_id', 'role_name', 'display_name_th', 'sequence', 'status'],
  M_Permission: ['perm_id', 'role_id', 'action', 'scope_line', 'scope_doctype'],
  M_ProductFamily: ['family_id', 'family_name', 'display_name', 'sequence', 'status'],
  M_Model: ['model_id', 'family_id', 'model_name', 'status'],
  M_Shift: ['shift_id', 'shift_name', 'time_range', 'status']
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
      station_ids: stationIds
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
      def.doc_name, def.doc_no || '', revId, def.drive_folder_id || '', def.print_css || '', 'ACTIVE']);
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
  Logger.log('ชีท Master ครบแล้ว — รัน seedMaster() ต่อ');
  return ss.getUrl();
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
    ['ProdManager', 'Production Manager', 'ผู้จัดการฝ่ายผลิต', 8, 'ACTIVE'],
    ['SectionManager', 'Section Manager', 'ผู้จัดการส่วน', 9, 'ACTIVE'],
    ['FactoryManager', 'Factory Manager', 'ผู้จัดการโรงงาน', 10, 'ACTIVE']
  ]);

  // ---- Permissions (เทียบเท่าพฤติกรรมระบบปัจจุบันเป๊ะ + สิทธิ์อ่านให้ role ใหม่) ----
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
