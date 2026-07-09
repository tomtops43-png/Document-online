# ENC Manufacturing QMS — Digital Quality Forms

เว็บแอปแปลงเอกสารตรวจสอบคุณภาพหน้าไลน์ผลิตจากกระดาษเป็นดิจิทัล
กรอกบนแท็บเล็ต (Android Chrome) เก็บลง Google Sheets + รูปลง Google Drive
และพิมพ์ออก A4 ให้เหมือนฟอร์มกระดาษต้นฉบับ

## ฟอร์มที่รองรับ (16 template)

| ฟอร์ม | Template File | โหมด |
|---|---|---|
| First Piece Check List: NMS | `nms-first-piece-rev1.json` | single-record |
| OK 1st Part Workstation Checklist (NLC) | `ok-1st-part-nlc-rev0.json` | log-sheet |
| NLC Extension Box First Piece | `nlc-extension-box-first-piece-rev1.json` | single-record |
| NLC EZ Diffuse First Piece | `nlc-ez-diffuse-first-piece-rev1.json` | single-record |
| NLC EZ Project First Piece | `nlc-ez-project-first-piece-rev1.json` | single-record |
| NLC LU Diffuse First Piece | `nlc-lu-diffuse-first-piece-rev1.json` | single-record |
| NLC LU Project First Piece | `nlc-lu-project-first-piece-rev1.json` | single-record |
| Loadcenter Classic EZ First Piece | `lc-classic-ez-first-piece-rev1.json` | single-record |
| Loadcenter Classic L First Piece | `lc-classic-l-first-piece-rev1.json` | single-record |
| Loadcenter Visismart EZ First Piece | `lc-visismart-ez-first-piece-rev1.json` | single-record |
| Loadcenter Visismart L First Piece | `lc-visismart-l-first-piece-rev1.json` | single-record |
| CU Line5 First Piece | `cu-line5-first-piece-rev1.json` | single-record |
| EZbox100 First Piece | `ezbox100-first-piece-rev1.json` | single-record |
| MAX9 First Piece | `max9-first-piece-rev1.json` | single-record |
| Resi9 AUL First Piece | `resi9-aul-first-piece-rev1.json` | single-record |
| Resi9 NZL First Piece | `resi9-nzl-first-piece-rev1.json` | single-record |

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework/build step) บน GitHub Pages
- **Backend:** Google Apps Script Web App (`gas/Code.gs`)
- **Database:** Google Sheets | **รูปถ่าย:** Google Drive
- **Font:** Sarabun (Google Fonts)

## โครงสร้าง

```
├── index.html          # login + เลือกฟอร์ม/ไลน์/สถานี
├── dashboard.html      # Document Center: เลือกไลน์ → สถานี → เอกสาร
├── fill.html           # กรอกฟอร์ม (render จาก template JSON)
├── records.html        # ค้นหาบันทึก + คิวรออนุมัติ (Leader/QI)
├── print.html          # Print view A4
├── search.html         # ค้นหาเอกสาร/บันทึก (Global Search)
├── viewer.html         # ดูเอกสารไฟล์ + ประวัติ Revision
├── admin.html          # Admin: จัดการเอกสาร Master (Doc Control/Admin)
├── css/                # app.css (UI) + print-*.css (layout พิมพ์ต่อฟอร์ม)
├── js/                 # config, api, auth, camera, form-render, master, print-render
├── templates/          # นิยามฟอร์มเป็น JSON (เพิ่มฟอร์มใหม่ = เพิ่มไฟล์ที่นี่)
└── gas/Code.gs         # backend ทั้งหมด (copy ไปวางใน GAS editor)
```

**หลักการ:** โค้ดเป็น template-driven ทั้งหมด — `fill.html`/`print.html`
ไม่ hardcode รายการตรวจ เพิ่มไลน์/ฟอร์ม/Rev. ใหม่ได้โดยเพิ่มไฟล์ JSON
ไฟล์เดียว แล้วลงทะเบียนผ่านหน้า Admin หรือ `registerDocument()` ใน GAS

## Workflow ลายเซ็น

```
Operator submit → PENDING_LEADER → Leader อนุมัติ
  → (NMS / First Piece) PENDING_QI → QI อนุมัติ → COMPLETED
  → (OK 1st / log-sheet) COMPLETED
ตีกลับได้ทุกขั้น → REJECTED → แก้แล้ว submit ใหม่
```

- ข้อ critical (*) ตอบ NOK → บังคับกรอก Recovery Plan ก่อน submit
- ช่อง "แปะฉลาก" บนกระดาษ → บังคับถ่ายรูปแนบ และแสดงในกรอบเดิมตอนพิมพ์
- ค่า Torque validate ตาม spec อัตโนมัติ (นอกช่วง = เตือนแดง + flag)
- ข้อมูล draft เก็บใน localStorage — network หลุดข้อมูลไม่หาย
- Master Data (ไลน์/สถานี/ประเภทเอกสาร) cache ใน localStorage — เปิดเร็ว

## ติดตั้ง

ดู **[SETUP.md](SETUP.md)** — ตั้งค่า Google Sheets/Drive, deploy GAS,
เปิด GitHub Pages ทีละขั้น

## Roadmap

- [x] Phase 1: NMS First Piece end-to-end (กรอก → รูป → อนุมัติ → พิมพ์ A4)
- [x] Phase 2: OK 1st Part (log-sheet) + Recovery Plan + คิวอนุมัติ
- [x] Phase 3a: Master Data Layer (ENC-MASTER spreadsheet + API)
- [x] Phase 3b: Document Center (dashboard.html) — เลือกไลน์ → สถานี → เอกสาร
- [x] Phase 3c: Admin UI (admin.html) — ลงทะเบียนเอกสาร, เพิ่ม Revision, ผูกสถานี
- [x] Phase 3d: Global Search (search.html) + Document Viewer (viewer.html)
- [x] Phase 3e: Template ครบ 16 ฟอร์ม (NLC/LC/CU/EZbox/MAX9/Resi9)
- [ ] Phase 4: Dashboard สรุป NOK (กราฟ trend + Pareto per line/station)
- [ ] Phase 5: LINE Notify / Email alert เมื่อมีคิวรออนุมัติ
- [ ] Phase 6: QR Code สแกนเปิดเอกสารตรงสถานี
