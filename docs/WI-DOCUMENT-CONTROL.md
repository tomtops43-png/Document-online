# WI และการควบคุมเอกสาร

## อัปเดต: สิทธิ์และป๊อปอัพ PDF

การจัดการเอกสารและรายชื่อพนักงานในหน้า Admin อนุญาตเฉพาะ Role `Admin` เท่านั้น ฝั่ง API ปฏิเสธสิทธิ์ `document.manage` ของ Role อื่น แม้ M_Permission เดิมยังมีแถวอนุญาตอยู่ ต้อง Deploy Code.gs ใหม่จึงบังคับใช้ที่ Server จริง

ปุ่มเปิด PDF/พิมพ์และพิมพ์ฟอร์มเปิดใน dialog ภายในเว็บ API `doc.getPdf` อ่านเฉพาะไฟล์ของ Revision ในทะเบียนเอกสารที่เปิดใช้งาน ส่ง PDF ขนาดไม่เกิน 20 MB เป็น base64 เพื่อสร้าง Blob ในเบราว์เซอร์และพิมพ์จาก iframe โดยไม่ข้าม origin ของ Google Drive หาก Backend ยังเก่า จะแสดง Drive preview ใน dialog แต่ปุ่มพิมพ์ด้านบนยังไม่พร้อมใช้งานจน Deploy Backend ใหม่

## เมนู

- **เอกสาร WI** (`documents.html`): ผู้ใช้ที่ Login แล้วค้นหาและกรอง WI ตามไลน์/สถานี เปิดดูประวัติ ดาวน์โหลด และเปิด PDF ใน Google Drive เพื่อสั่งพิมพ์ได้
- **ควบคุมเอกสาร** (`documents.html?mode=control`): Admin/DocControl เห็นทะเบียนทุกหมวด เพิ่มเอกสาร ลงทะเบียนฟอร์ม แก้ข้อมูล ผูกสถานี ยกเลิกเอกสาร และอัปเดต Revision จากรายการเดียว

ใช้ทะเบียน M_Document, M_DocType, M_Revision และ M_DocAssign เดิม ไม่มีฐานข้อมูลชุดใหม่ หมวด WI ใช้ doctype_id `wi` (หรือ doctype_name `WI`) และ behavior `file` ซึ่งมีอยู่ใน seed เดิม

## เพิ่ม WI และอัปเดต

1. เปิดควบคุมเอกสาร → เพิ่มเอกสาร / WI → เลือกประเภท WI
2. กรอกชื่อ เลขที่เอกสาร ไลน์ รุ่น และสถานี แนบ PDF หรือวางลิงก์ Google Drive แล้วลงทะเบียน
3. เมื่อต้องเปลี่ยนฉบับ กด **อัปเดต Rev** ที่เอกสารเดิม กรอกเลขใหม่ วันที่มีผล เหตุผล และไฟล์ใหม่
4. ฉบับใหม่เป็น CURRENT และฉบับเดิมเป็น OBSOLETE โดยเก็บไฟล์เก่าและประวัติไว้ เลข Revision ซ้ำจะถูกปฏิเสธ
5. สำหรับฟอร์มดิจิทัล ให้เพิ่ม Template JSON และรายการใน manifest ก่อน แล้วเลือก Template ของ form_id เดียวกันในหน้าเพิ่ม Revision

วันที่มีผลเป็นข้อมูลกำกับตามระบบเดิม การบันทึก Revision จะเปลี่ยน CURRENT ทันที ไม่มีระบบตั้งเวลาให้เปลี่ยนฉบับในอนาคต

ปุ่มพิมพ์เปิดไฟล์ใน Google Drive ให้ผู้ใช้สั่งพิมพ์จากตัวดู PDF การดาวน์โหลดและพิมพ์ขึ้นกับสิทธิ์ไฟล์ที่เจ้าของ Drive กำหนด สำหรับไฟล์ของบัญชีอื่นต้องให้เจ้าของเปิดสิทธิ์เอง

## ติดตั้ง

1. อัปเดต frontend ใน branch ที่ GitHub Pages ใช้ โดยรวมไฟล์ใหม่ documents.html, css/documents.css และ js/document-library.js พร้อมไฟล์เดิมที่แก้ไข
2. วาง gas/Code.gs เวอร์ชันนี้ใน Apps Script project เดิม แล้ว Deploy → Manage deployments → Edit → New version → Deploy เพื่อใช้ URL เดิม
3. ไม่ต้อง seedMaster ใหม่ ไม่ต้องสร้างชีทใหม่ ตรวจว่ามี WI ใน M_DocType และ Admin/DocControl มี document.manage ตามระบบเดิม
4. Login และกดรีเฟรชข้อมูล Master ทดสอบด้วยเอกสารหนึ่งใบก่อนใช้งานจริง

## การตรวจสอบ

tests/document-control.cjs ใช้ Playwright พร้อม API/ข้อมูลจำลอง ทดสอบ WI ฉบับปัจจุบัน ตัวกรอง การเปิดหน้าแก้ Rev อัปโหลด PDF ประวัติฉบับเก่า หน้าจอมือถือ และสิทธิ์ Operator รวมถึง Backend ปฏิเสธ Rev ซ้ำ/ไม่มีเหตุผล ไม่เขียน Google Sheets หรือ Drive จริง

รัน `node tests/document-control.cjs` หลังติดตั้ง Playwright (ใช้ Edge channel) หรือกำหนด PLAYWRIGHT_MODULE ให้ชี้ไปยังโมดูล Playwright ที่มีอยู่
