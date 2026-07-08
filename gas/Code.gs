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
      case 'getRecords':   return jsonOut(actionGetRecords(params, user));
      case 'getRecord':    return jsonOut(actionGetRecord(params, user));
      case 'getLogSheet':  return jsonOut(actionGetLogSheet(params, user));
      case 'createRecord': return jsonOut(actionCreateRecord(params, user));
      case 'approveRecord': return jsonOut(actionApproveRecord(params, user));
      case 'rejectRecord': return jsonOut(actionRejectRecord(params, user));
      case 'uploadPhoto':  return jsonOut(actionUploadPhoto(params, user));
      case 'addRecovery':  return jsonOut(actionAddRecovery(params, user));
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
