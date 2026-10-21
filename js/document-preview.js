// Uses the original Apps Script without requiring a PDF download API.
const DocumentPreview = {
  request: 0,
  open(doc, rev, formUrl) {
    if (!this.dialog) this.create();
    this.closeContent();
    const request = ++this.request;
    this.formUrl = formUrl;
    const ref = String(rev && rev.content_ref || '');
    this.printUrl = !formUrl && /^[\w-]+$/.test(ref)
      ? 'https://drive.google.com/file/d/' + encodeURIComponent(ref) + '/view' : null;
    this.title.textContent = doc.doc_name + (rev ? ' — ' + rev.rev_no : '');
    this.printButton.disabled = !this.printUrl;
    this.message.textContent = formUrl ? 'กำลังโหลดเอกสาร…' : 'กด Print เพื่อเปิดตัวดู Google Drive แล้วเลือกไอคอนเครื่องพิมพ์';
    this.dialog.showModal();
    this.frame.onload = () => {
      if (request === this.request && formUrl) { this.printButton.disabled = false; this.message.textContent = ''; }
    };
    if (formUrl) this.frame.src = formUrl;
    else if (this.printUrl) this.frame.src = 'https://drive.google.com/file/d/' + encodeURIComponent(ref) + '/preview';
    else this.message.textContent = 'เอกสารนี้ยังไม่มีไฟล์ที่เปิดได้';
  },
  create() {
    const dialog = document.createElement('dialog'); dialog.className = 'document-preview';
    dialog.innerHTML = '<div class="document-preview-header"><h2></h2><button type="button" class="btn-secondary preview-print" disabled>Print</button><button type="button" class="btn-secondary preview-close" aria-label="ปิดเอกสาร">ปิด ✕</button></div><p role="status" aria-live="polite"></p><iframe title="ตัวอย่างเอกสาร"></iframe>';
    document.body.appendChild(dialog);
    this.dialog = dialog; this.title = dialog.querySelector('h2'); this.frame = dialog.querySelector('iframe');
    this.message = dialog.querySelector('p'); this.printButton = dialog.querySelector('.preview-print');
    dialog.querySelector('.preview-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { ++this.request; this.closeContent(); });
    this.printButton.onclick = () => this.print();
  },
  print() {
    if (!this.formUrl) {
      if (this.printUrl) window.open(this.printUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const loading = this.frame.contentDocument && this.frame.contentDocument.getElementById('loading-overlay');
      if (loading && loading.style.display !== 'none') { this.message.textContent = 'กำลังโหลด กรุณารอสักครู่'; return; }
      this.frame.contentWindow.focus(); this.frame.contentWindow.print();
    } catch (err) { this.message.textContent = 'ยังเปิดหน้าต่าง Print ไม่สำเร็จ กรุณาลองใหม่'; }
  },
  closeContent() {
    if (this.frame) { this.frame.onload = null; this.frame.src = 'about:blank'; }
    this.printUrl = null;
  }
};
