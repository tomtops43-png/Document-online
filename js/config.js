// ========================================================
// config.js — ค่าคงที่ของระบบ First Piece / OK 1st Part
// แก้ GAS_URL หลัง deploy Google Apps Script Web App แล้ว
// ========================================================
const CONFIG = {
  // URL ของ GAS Web App (ลงท้ายด้วย /exec) — ต้องแก้เป็นของจริงหลัง deploy
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwVpypb8iyWePmfNHhzommRpk9TEFWNitU9oT_s3-LAazaKXl7ZiRGz4RAvsV9f72SvwQ/exec',

  // รายชื่อฟอร์มที่ระบบรู้จัก (เพิ่มฟอร์มใหม่ = เพิ่มไฟล์ JSON ใน templates/ แล้วเพิ่มรายการที่นี่)
  FORMS: [
    {
      form_id: 'nms-first-piece',
      template_file: 'templates/nms-first-piece-rev1.json',
      title: 'First Piece Check List: NMS',
      mode: 'single-record'
    },
    {
      form_id: 'ok-1st-part-nlc',
      template_file: 'templates/ok-1st-part-nlc-rev0.json',
      title: 'OK 1st Part Workstation Checklist (NLC)',
      mode: 'log-sheet'
    }
  ],

  // การย่อรูปฝั่ง client ก่อนอัปโหลด
  PHOTO_MAX_DIMENSION: 1280,
  PHOTO_JPEG_QUALITY: 0.8,

  // localStorage keys
  LS_TOKEN: 'fp_token',
  LS_USER: 'fp_user',
  LS_DRAFT_PREFIX: 'fp_draft_',

  // สถานะ record + สีป้าย
  STATUS: {
    PENDING_LEADER: { label: 'รอ Leader อนุมัติ', color: '#e67e22' },
    PENDING_QI: { label: 'รอ QI อนุมัติ', color: '#f1c40f' },
    COMPLETED: { label: 'เสร็จสมบูรณ์', color: '#27ae60' },
    REJECTED: { label: 'ตีกลับ', color: '#e74c3c' }
  }
};

// URL รูปจาก Google Drive สำหรับแสดงผล/พิมพ์
function drivePhotoUrl(fileId, width) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + (width || 1200);
}

// ลายเซ็นที่บันทึกไว้มี 2 รูปแบบ: "data:image/..." ฝังตรงๆ (ของเก่า/ยังไม่ส่งเข้าเซิร์ฟเวอร์)
// หรือ "drive:<fileId>" (อัปโหลดขึ้น Drive แล้ว — กัน answers_json เกินลิมิต 50,000
// ตัวอักษรต่อเซลล์ของ Google Sheets เมื่อฟอร์มมีลายเซ็นหลาย Station)
function isSignatureImage(value) {
  var s = String(value || '');
  return s.indexOf('data:image') === 0 || s.indexOf('drive:') === 0;
}
function signatureImgSrc(value) {
  var s = String(value || '');
  if (s.indexOf('drive:') === 0) return drivePhotoUrl(s.slice(6), 400);
  return s;
}

// way_select เป็น multi-select toggle (เลือกได้หลายอัน กดซ้ำยกเลิก ไม่บังคับต้องเลือก) —
// เก็บใน ans.ways (array) แบบใหม่ รองรับ ans.way (string เดี่ยว) ของ record เก่าก่อนเปลี่ยนด้วย
function waySelectedList(ans) {
  if (ans && Array.isArray(ans.ways)) return ans.ways;
  if (ans && ans.way) return [ans.way];
  return [];
}

// โหลด template JSON จาก templates/
// - ระบบเดิม: loadTemplate('nms-first-piece') → หาจาก CONFIG.FORMS
// - ระบบใหม่ (data-driven): loadTemplate(null, 'templates/xxx.json') → โหลดตรงจาก path
//   (path มาจาก M_Revision.content_ref ใน ENC-MASTER)
async function loadTemplate(formId, templateFile) {
  let file = templateFile;
  if (!file) {
    const form = CONFIG.FORMS.find(function (f) { return f.form_id === formId; });
    if (!form) throw new Error('ไม่พบฟอร์ม: ' + formId);
    file = form.template_file;
  }
  const res = await fetch(file, { cache: 'no-cache' });
  if (!res.ok) throw new Error('โหลด template ไม่สำเร็จ: ' + file);
  return res.json();
}
