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

// โหลด template JSON จาก templates/
async function loadTemplate(formId) {
  const form = CONFIG.FORMS.find(function (f) { return f.form_id === formId; });
  if (!form) throw new Error('ไม่พบฟอร์ม: ' + formId);
  const res = await fetch(form.template_file, { cache: 'no-cache' });
  if (!res.ok) throw new Error('โหลด template ไม่สำเร็จ: ' + form.template_file);
  return res.json();
}
