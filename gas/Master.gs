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
  Object.keys(MASTER_SHEET_DEFS).forEach(function (name) {
    // ส่งเฉพาะแถว active (status ว่าง = ถือว่า active)
    data[name] = readMaster(name).filter(function (r) {
      return !('status' in r) || r.status === '' || String(r.status).toUpperCase() === 'ACTIVE';
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
