# First Piece / OK 1st Part — Digital Quality Forms

เว็บแอปแปลงเอกสารตรวจสอบคุณภาพหน้าไลน์ผลิตจากกระดาษเป็นดิจิทัล
กรอกบนแท็บเล็ต (Android Chrome) เก็บลง Google Sheets + รูปลง Google Drive
และพิมพ์ออก A4 ให้เหมือนฟอร์มกระดาษต้นฉบับ

## ฟอร์มที่รองรับ

| ฟอร์ม | เลขเอกสาร | โหมด |
|---|---|---|
| First Piece Check List: NMS | `JRTLQR860-04/1` | single-record (1 แผ่น = 1 การตรวจ) |
| OK 1st Part Workstation Checklist (NLC, 19 สถานี) | `THPLSTL-QA-FRM0-3434 Rev.0 (05/23)` | log-sheet (1 แผ่น = ทั้งกะ หลาย entry) |

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework/build step) บน GitHub Pages
- **Backend:** Google Apps Script Web App (`gas/Code.gs`)
- **Database:** Google Sheets | **รูปถ่าย:** Google Drive
- **Font:** Sarabun (Google Fonts)

## โครงสร้าง

```
├── index.html          # login + เลือกฟอร์ม/ไลน์/สถานี
├── fill.html           # กรอกฟอร์ม (render จาก template JSON)
├── records.html        # ค้นหาบันทึก + คิวรออนุมัติ (Leader/QI)
├── print.html          # Print view A4
├── css/                # app.css (UI) + print-*.css (layout พิมพ์ต่อฟอร์ม)
├── js/                 # config, api, auth, camera, form-render, print-render
├── templates/          # นิยามฟอร์มเป็น JSON (เพิ่มฟอร์มใหม่ = เพิ่มไฟล์ที่นี่)
└── gas/Code.gs         # backend ทั้งหมด (copy ไปวางใน GAS editor)
```

**หลักการ:** โค้ดเป็น template-driven ทั้งหมด — `fill.html`/`print.html`
ไม่ hardcode รายการตรวจ เพิ่มไลน์/ฟอร์ม/Rev. ใหม่ได้โดยเพิ่มไฟล์ JSON
ไฟล์เดียว + 1 บรรทัดใน `js/config.js`

## Workflow ลายเซ็น

```
Operator submit → PENDING_LEADER → Leader อนุมัติ
  → (NMS) PENDING_QI → QI อนุมัติ → COMPLETED
  → (OK 1st) COMPLETED
ตีกลับได้ทุกขั้น → REJECTED → แก้แล้ว submit ใหม่
```

- ข้อ critical (*) ตอบ NOK → บังคับกรอก Recovery Plan ก่อน submit
- ช่อง "แปะฉลาก" บนกระดาษ → บังคับถ่ายรูปแนบ และแสดงในกรอบเดิมตอนพิมพ์
- ค่า Torque validate ตาม spec อัตโนมัติ (นอกช่วง = เตือนแดง + flag)
- ข้อมูล draft เก็บใน localStorage — network หลุดข้อมูลไม่หาย

## ติดตั้ง

ดู **[SETUP.md](SETUP.md)** — ตั้งค่า Google Sheets/Drive, deploy GAS,
เปิด GitHub Pages ทีละขั้น

## Roadmap

- [x] Phase 1: NMS First Piece end-to-end (กรอก → รูป → อนุมัติ → พิมพ์ A4)
- [x] Phase 2: OK 1st Part (log-sheet) + Recovery Plan + คิวอนุมัติ
- [ ] Phase 3: template Loadcenter CU (`cu-first-piece-rev1.json`), Dashboard สรุป NOK, หน้า Admin จัดการ Users
