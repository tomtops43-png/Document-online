// Local Blob PDFs allow printing inside the dialog without crossing Drive's origin.
const DocumentPreview = {
  url: null,
  request: 0,
  open(doc, rev, formUrl) {
    if (!this.dialog) this.create();
    this.closeContent();
    const request = ++this.request;
    this.doc = doc; this.rev = rev; this.formUrl = formUrl; this.wantPrint = false;
    this.title.textContent = doc.doc_name + (rev ? ' — ' + rev.rev_no : '');
    this.message.textContent = 'กำลังโหลดเอกสาร…';
    this.printButton.disabled = true;
    this.dialog.showModal();
    this.frame.onload = () => {
      if (request !== this.request) return;
      if (formUrl || this.url) { this.printButton.disabled = false; this.message.textContent = ''; if (this.wantPrint) { this.wantPrint = false; this.print(); } }
    };
    if (formUrl) { this.frame.src = formUrl; return; }
    // Embedded preview remains available with older Apps Script deployments.
    this.frame.src = 'https://drive.google.com/file/d/' + encodeURIComponent(rev.content_ref) + '/preview';
    this.loadPdf(request);
  },
  loadPdf(request) {
    this.printButton.disabled = true;
    this.message.textContent = 'กำลังเตรียม PDF สำหรับ Print…';
    API.get('doc.getPdf', { doc_id: this.doc.doc_id, rev_id: this.rev.rev_id }).then(data => {
      if (request !== this.request) return;
      if (!data.base64) throw new Error('ต้องอัปเดต Apps Script เพื่อใช้การพิมพ์ PDF ในเว็บ');
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      this.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      this.frame.src = this.url;
    }).catch(err => {
      if (request === this.request) { this.message.textContent = 'โหลดไฟล์สำหรับ Print ไม่สำเร็จ กด Print เพื่อลองใหม่: ' + err.message; this.printButton.disabled = false; this.wantPrint = false; }
    });
  },
  create() {
    const dialog = document.createElement('dialog'); dialog.className = 'document-preview';
    dialog.innerHTML = '<div class="document-preview-header"><h2></h2><button type="button" class="btn-secondary preview-print" disabled>Print</button><button type="button" class="btn-secondary preview-close" aria-label="ปิดเอกสาร">ปิด ✕</button></div><p role="status" aria-live="polite"></p><iframe title="ตัวอย่างเอกสาร"></iframe>';
    document.body.appendChild(dialog);
    this.dialog = dialog; this.title = dialog.querySelector('h2'); this.frame = dialog.querySelector('iframe');
    this.message = dialog.querySelector('p'); this.printButton = dialog.querySelector('.preview-print');
    dialog.querySelector('.preview-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { ++this.request; this.closeContent(); });
    this.printButton.onclick = () => {
      if (!this.formUrl && !this.url) { this.wantPrint = true; this.loadPdf(this.request); return; }
      this.print();
    };
  },
  print() {
      try {
        const loading = this.frame.contentDocument && this.frame.contentDocument.getElementById('loading-overlay');
        if (loading && loading.style.display !== 'none') { this.message.textContent = 'กำลังโหลด กรุณารอสักครู่'; return; }
        this.frame.contentWindow.focus(); this.frame.contentWindow.print();
      } catch (err) { this.message.textContent = 'เบราว์เซอร์ไม่อนุญาตให้ Print จากกรอบนี้ กรุณาใช้ปุ่ม Print ในตัวดู PDF'; }
  },
  closeContent() {
    if (this.frame) { this.frame.onload = null; this.frame.src = 'about:blank'; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
};
