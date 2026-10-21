// Local Blob PDFs allow printing inside the dialog without crossing Drive's origin.
const DocumentPreview = {
  url: null,
  request: 0,
  open(doc, rev, formUrl) {
    if (!this.dialog) this.create();
    this.closeContent();
    const request = ++this.request;
    this.title.textContent = doc.doc_name + (rev ? ' — ' + rev.rev_no : '');
    this.message.textContent = 'กำลังโหลดเอกสาร…';
    this.printButton.disabled = true;
    this.dialog.showModal();
    this.frame.onload = () => {
      if (request !== this.request) return;
      if (formUrl || this.url) { this.printButton.disabled = false; this.message.textContent = ''; }
    };
    if (formUrl) { this.frame.src = formUrl; return; }
    // Embedded preview remains available with older Apps Script deployments.
    this.frame.src = 'https://drive.google.com/file/d/' + encodeURIComponent(rev.content_ref) + '/preview';
    API.post('doc.getPdf', { doc_id: doc.doc_id, rev_id: rev.rev_id }).then(data => {
      if (request !== this.request) return;
      if (!data.base64) throw new Error('ต้องอัปเดต Apps Script เพื่อใช้การพิมพ์ PDF ในเว็บ');
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      this.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      this.frame.src = this.url;
    }).catch(() => {
      if (request === this.request) this.message.textContent = 'เปิดดูได้ในกรอบนี้ แต่การพิมพ์ในเว็บต้อง Deploy gas/Code.gs เวอร์ชันใหม่ หากยังโหลดไม่ได้ให้ตรวจสิทธิ์ไฟล์หรือดาวน์โหลด';
    });
  },
  create() {
    const dialog = document.createElement('dialog'); dialog.className = 'document-preview';
    dialog.innerHTML = '<div class="document-preview-header"><h2></h2><button type="button" class="btn-secondary preview-print" disabled>พิมพ์</button><button type="button" class="btn-secondary preview-close" aria-label="ปิดเอกสาร">ปิด ✕</button></div><p role="status" aria-live="polite"></p><iframe title="ตัวอย่างเอกสาร"></iframe>';
    document.body.appendChild(dialog);
    this.dialog = dialog; this.title = dialog.querySelector('h2'); this.frame = dialog.querySelector('iframe');
    this.message = dialog.querySelector('p'); this.printButton = dialog.querySelector('.preview-print');
    dialog.querySelector('.preview-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { ++this.request; this.closeContent(); });
    this.printButton.onclick = () => {
      try {
        const loading = this.frame.contentDocument && this.frame.contentDocument.getElementById('loading-overlay');
        if (loading && loading.style.display !== 'none') { this.message.textContent = 'กำลังโหลด กรุณารอสักครู่'; return; }
        this.frame.contentWindow.focus(); this.frame.contentWindow.print();
      } catch (err) { this.message.textContent = 'กรุณาใช้ปุ่มพิมพ์ในตัวดู PDF หรือดาวน์โหลดเพื่อพิมพ์'; }
    };
  },
  closeContent() {
    if (this.frame) { this.frame.onload = null; this.frame.src = 'about:blank'; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
};
