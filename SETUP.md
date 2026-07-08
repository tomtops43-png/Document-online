# SETUP.md — วิธีติดตั้งระบบ First Piece / OK 1st Part

ระบบประกอบด้วย 3 ส่วน ติดตั้งตามลำดับนี้:

1. **Google Sheets** — ฐานข้อมูล (1 spreadsheet)
2. **Google Apps Script (GAS)** — backend Web App
3. **GitHub Pages** — frontend สำหรับแท็บเล็ต

---

## 1. ตั้งค่า Google Sheets + Google Drive (ครั้งแรกครั้งเดียว)

### 1.1 สร้าง Spreadsheet

1. ไปที่ [sheets.new](https://sheets.new) สร้าง spreadsheet ใหม่ ตั้งชื่อ เช่น `FirstPiece-DB`
2. ไม่ต้องสร้างชีทเอง — เดี๋ยวให้สคริปต์สร้างให้ (ข้อ 2.3)

### 1.2 สร้างโฟลเดอร์รูปใน Google Drive

1. ไปที่ [drive.google.com](https://drive.google.com) สร้างโฟลเดอร์ใหม่ เช่น `FirstPiece-Photos`
2. เปิดโฟลเดอร์ แล้วคัดลอก **Folder ID** จาก URL:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGh...`** ← ส่วนนี้คือ ID
3. เก็บไว้ใช้ในข้อ 2.4

---

## 2. Deploy Google Apps Script

### 2.1 สร้างโปรเจกต์ GAS ผูกกับ Spreadsheet

1. เปิด spreadsheet จากข้อ 1.1 → เมนู **Extensions → Apps Script**
   (สำคัญ: ต้องเปิดจากใน spreadsheet เพื่อให้สคริปต์ผูกกับชีทอัตโนมัติ —
   โค้ดใช้ `SpreadsheetApp.getActiveSpreadsheet()`)
2. ลบโค้ดตัวอย่างทิ้ง แล้ว copy เนื้อหาทั้งไฟล์ `gas/Code.gs` จาก repo นี้ไปวาง
3. กด 💾 Save

### 2.2 รัน setupSheets() สร้างชีททั้งหมด

1. ใน GAS editor เลือกฟังก์ชัน `setupSheets` จาก dropdown แล้วกด **Run**
2. ครั้งแรกจะขอสิทธิ์ (Authorize) → กด Allow ทุกขั้น
3. กลับไปดู spreadsheet จะมีชีท `Records`, `Recovery`, `Users`, `Config` พร้อม header

### 2.3 เพิ่มผู้ใช้คนแรก (Admin)

ใน GAS editor เปิดไฟล์ Code.gs แล้วรันจาก console (เมนู Run > หรือเขียนฟังก์ชันชั่วคราว):

```javascript
function _initUsers() {
  addUser('10001', 'ชื่อ Admin', '1234', 'Admin', '');
  addUser('20001', 'ชื่อ Operator', '1111', 'Operator', 'NMS');
  addUser('30001', 'ชื่อ Leader', '2222', 'Leader', 'NMS');
  addUser('40001', 'ชื่อ QI', '3333', 'QI', 'NMS');
}
```

วางฟังก์ชันนี้ต่อท้าย Code.gs → เลือก `_initUsers` → Run → ลบฟังก์ชันทิ้งได้
(PIN ถูกเก็บเป็น SHA-256 hash — ไม่มี PIN ดิบในชีท)

Role ที่ระบบรู้จัก: `Operator` / `Leader` / `QI` / `Admin`

### 2.4 ใส่ Folder ID ของรูปในชีท Config

เปิดชีท `Config` เพิ่มแถว:

| key | value |
|---|---|
| `drive_root_folder_id` | `1AbCdEfGh...` (ID จากข้อ 1.2) |

### 2.5 Deploy เป็น Web App

1. ใน GAS editor: **Deploy → New deployment**
2. ประเภท: **Web app**
3. ตั้งค่า:
   - **Execute as: Me** (บัญชีของคุณ — รูป/ชีทเป็นของคุณทั้งหมด)
   - **Who has access: Anyone**
4. กด Deploy → คัดลอก **Web app URL** (ลงท้าย `/exec`)

> ⚠️ ทุกครั้งที่แก้ Code.gs ต้อง **Deploy → Manage deployments → ✏️ Edit →
> Version: New version → Deploy** ไม่งั้นโค้ดใหม่ไม่ทำงาน (URL เดิมไม่เปลี่ยน)

---

## 3. Deploy Frontend บน GitHub Pages

### 3.1 ใส่ GAS URL ใน config

แก้ไฟล์ `js/config.js` บรรทัด:

```javascript
GAS_URL: 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec',
```

ใส่ URL จากข้อ 2.5 → commit + push

### 3.2 เปิด GitHub Pages

1. ที่ repo บน GitHub: **Settings → Pages**
2. Source: **Deploy from a branch** → เลือก branch หลัก + folder `/ (root)` → Save
3. รอ 1-2 นาที จะได้ URL: `https://<username>.github.io/<repo>/`

### 3.3 ทดสอบ

1. เปิด URL บนแท็บเล็ต (Chrome) → login ด้วยผู้ใช้จากข้อ 2.3
2. เลือกฟอร์ม NMS First Piece → กรอก header → กรอกครบ + ถ่ายรูป → Submit
3. ตรวจว่า:
   - ชีท `Records` มีแถวใหม่ (status = `PENDING_LEADER`)
   - Drive มีรูปใน `{root}/NMS/{YYYY-MM}/`
4. login เป็น Leader → records.html → แท็บรออนุมัติ → อนุมัติ → status เป็น `PENDING_QI`
5. login เป็น QI → อนุมัติ → `COMPLETED`
6. กดปุ่ม 🖨 พิมพ์ → Chrome Print Preview → **A4 / Margins: None / Background graphics ✓**
   เทียบกับฟอร์มกระดาษต้นฉบับ

---

## 3.5 ติดตั้ง Master Data Layer (Migration Step 1 — ENC QMS)

> ส่วนนี้เป็นการเตรียมระบบไปสู่ ENC Manufacturing QMS (ดู `docs/ARCHITECTURE.md`)
> ติดตั้งแล้ว**ไม่กระทบระบบเดิม** — ฟอร์มเดิมทำงานเหมือนเดิมทุกอย่าง

> โค้ด GAS ทั้งหมดรวมอยู่ใน **ไฟล์เดียว**: `gas/Code.gs` — การอัปเดตทุกครั้งคือ
> เปิดไฟล์นี้จาก repo → เลือกทั้งหมด → วางทับใน GAS editor → Deploy new version

1. เปิด GAS editor → เปิดไฟล์ Code.gs → **ลบของเดิมทั้งหมด แล้ววาง `gas/Code.gs`
   เวอร์ชันล่าสุดจาก repo** → Save
2. รัน `setupMasterSheets` — สร้าง spreadsheet ใหม่ชื่อ **ENC-MASTER** อัตโนมัติ
   (ดู URL ใน Execution log ด้านล่าง)
3. รัน `seedMaster` — seed ENC + Line1/4/5 + 37 สถานี + Document Type 14 ประเภท
   + Role 10 role + Permission + ลงทะเบียนฟอร์มเดิม 2 ใบเข้าทะเบียนเอกสาร
4. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**

หลังจากนี้:
- แก้ Master (เพิ่มสถานี/role/สิทธิ์) = แก้ในชีท ENC-MASTER แล้วรัน `bumpMasterVersion`
- ลงทะเบียนเอกสารใหม่ (เช่น OK 1st Part ของ Line1 ที่แปลงจาก Excel Master แล้ว):
  ใช้ฟังก์ชัน `registerDocument({...})` — ดูตัวอย่างในคอมเมนต์ของ `gas/Master.gs`
- ผูกเอกสารกับสถานี: เพิ่มแถวในชีท `M_DocAssign`

## 4. การเพิ่มฟอร์ม/ไลน์ใหม่ (template-driven)

1. สร้างไฟล์ JSON ใหม่ใน `templates/` (copy จากไฟล์เดิมแล้วแก้)
2. เพิ่มรายการใน `CONFIG.FORMS` ใน `js/config.js`
3. (ถ้า layout พิมพ์ต่างจากเดิม) สร้างไฟล์ CSS ใหม่ใน `css/` แล้วชี้จาก
   field `print_css` ใน template
4. commit + push — จบ ไม่ต้องแตะโค้ด engine

การแก้ Rev. เอกสาร: สร้างไฟล์ template ใหม่ (เช่น `...-rev2.json`) แล้วอัปเดต
`CONFIG.FORMS` — ไฟล์เก่าเก็บไว้ใน git เป็นประวัติ

---

## 5. โครงสร้างข้อมูล (อ้างอิง)

### ชีท Records (1 แถว = 1 record)

```
record_id | form_id | template_rev | mode | line | station | product_model | date | shift |
answers_json | photos_json | status | has_nok | reject_reason |
operator_id | operator_name | operator_ts |
leader_id | leader_name | leader_ts |
qi_id | qi_name | qi_ts | created_at | updated_at
```

- `record_id` = `FP-{LINE}-{YYYYMMDD}-{running 3 หลัก}`
- โหมด log-sheet: 1 record = 1 entry (1 แถวบนกระดาษ) — หน้า print รวมทุก entry
  ของ station+date เดียวกันเป็นแผ่นเดียว

### Workflow สถานะ

```
DRAFT (localStorage เท่านั้น) → submit → PENDING_LEADER
  NMS (single-record): PENDING_LEADER → Leader → PENDING_QI → QI → COMPLETED
  OK 1st (log-sheet):  PENDING_LEADER → Leader → COMPLETED
  ทุกขั้น: ตีกลับ → REJECTED → Operator แก้ + submit ใหม่
```

### URL หน้า print

- single-record: `print.html?record_id=FP-NMS-20260708-001`
- log-sheet (ทั้งแผ่น): `print.html?form=ok-1st-part-nlc&station=5&date=2026-07-08`
- ฟอร์มเปล่า (พิมพ์แจก): `print.html?form=nms-first-piece`

---

## 6. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| กด Submit แล้ว error CORS | ตรวจว่า deploy GAS เป็น `Anyone` และ frontend ส่ง POST เป็น `text/plain` (มีในโค้ดแล้ว — อย่าแก้เป็น application/json) |
| แก้ Code.gs แล้วไม่มีผล | ต้อง Deploy → New version (ดูข้อ 2.5) |
| รูปไม่ขึ้นในหน้า print | ตรวจว่าไฟล์ใน Drive แชร์เป็น anyone-with-link (โค้ด set ให้อัตโนมัติ) และรอ thumbnail ของ Drive สร้างสักครู่ |
| login ไม่ผ่านทั้งที่ PIN ถูก | คอลัมน์ `active` ในชีท Users ต้องเป็น `true` |
| ข้อมูลหายตอน network หลุด | ไม่หาย — draft เก็บใน localStorage อัตโนมัติ เปิดฟอร์มเดิม (ฟอร์ม+สถานี+วันที่+รุ่นเดิม) จะกู้คืนให้ |
