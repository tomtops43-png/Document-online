// One registry: WI is a filtered reading view; control groups every document type.
const DocumentLibrary = {
  control: new URLSearchParams(location.search).get('mode') === 'control',
  quality: new URLSearchParams(location.search).get('mode') === 'quality',

  includesType(type) {
    return this.control || (this.quality
      ? !!type && !this.isWI(type) && ['form', 'file'].includes(type.behavior)
      : this.isWI(type));
  },

  isWI(type) {
    if (!type) return false;
    return [type.doctype_id, type.doctype_name, type.display_name_th].some(value => {
      const name = String(value || '').trim();
      return /(^|[^a-z])wi([^a-z]|$)|work[\s_-]*instruction|วิธีปฏิบัติงาน/i.test(name);
    });
  },

  filteredDocuments() {
    const query = document.getElementById('doc-query').value.trim().toLocaleLowerCase();
    const category = document.getElementById('doc-category').value;
    const line = document.getElementById('doc-line').value;
    const station = document.getElementById('doc-station').value;
    const stationDocs = station ? Master.documentsForStation(station, line).map(d => String(d.doc_id)) : null;
    return (Master.data.M_Document || []).filter(d => {
      if (['DELETED', 'INACTIVE', 'DISABLED'].includes(String(d.status).toUpperCase())) return false;
      if (!this.includesType(Master.docType(d.doctype_id))) return false;
      if (category && String(d.doctype_id) !== category) return false;
      if (line && String(d.line_id) !== line && String(d.line_id) !== '*') return false;
      if (stationDocs && !stationDocs.includes(String(d.doc_id))) return false;
      return !query || [d.doc_name, d.doc_no, d.doc_id].join(' ').toLocaleLowerCase().includes(query);
    }).sort((a, b) => String(a.doc_name).localeCompare(String(b.doc_name), 'th'));
  },

  fillFilters() {
    const category = document.getElementById('doc-category');
    const line = document.getElementById('doc-line');
    const oldCategory = category.value, oldLine = line.value;
    category.replaceChildren(new Option(this.control || this.quality ? 'ทุกหมวด' : 'WI', ''));
    Master.docTypes().filter(t => this.includesType(t)).forEach(t =>
      category.add(new Option(t.display_name_th || t.doctype_name, t.doctype_id)));
    category.value = oldCategory;
    line.replaceChildren(new Option('ทุกไลน์', ''));
    Master.lines().forEach(l => line.add(new Option(l.display_name || l.line_name, l.line_id)));
    line.value = oldLine;
    this.fillStations();
  },

  fillStations() {
    const el = document.getElementById('doc-station'), old = el.value;
    const line = document.getElementById('doc-line').value;
    el.replaceChildren(new Option('ทุกสถานี', ''));
    (line ? Master.stations(line) : []).forEach(s => el.add(new Option(
      (s.station_no || '') + ' — ' + s.station_name, s.station_id)));
    el.value = old;
    el.disabled = !line;
  },

  link(parent, text, href, external) {
    const a = document.createElement('a');
    a.className = 'btn-small'; a.textContent = text; a.href = href;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    parent.appendChild(a);
    return a;
  },

  render() {
    const docs = this.filteredDocuments();
    const root = document.getElementById('document-groups');
    root.replaceChildren();
    document.getElementById('document-count').textContent = docs.length + ' เอกสาร';
    if (!docs.length) {
      const empty = document.createElement('section'); empty.className = 'card';
      empty.textContent = 'ยังไม่มีเอกสารในเงื่อนไขนี้'; root.appendChild(empty); return;
    }
    const groups = new Map();
    docs.forEach(d => { if (!groups.has(d.doctype_id)) groups.set(d.doctype_id, []); groups.get(d.doctype_id).push(d); });
    groups.forEach((items, typeId) => {
      const type = Master.docType(typeId);
      const section = document.createElement('section'); section.className = 'card';
      const title = document.createElement('h2');
      title.textContent = (type ? (type.display_name_th || type.doctype_name) : typeId) + ' (' + items.length + ')';
      section.appendChild(title);
      const scroll = document.createElement('div'); scroll.className = 'table-scroll';
      const table = document.createElement('table'); table.className = 'record-table document-library-table';
      table.innerHTML = '<thead><tr><th>เอกสาร / เลขที่</th><th>ไลน์</th><th>Revision ปัจจุบัน</th><th>วันที่มีผล</th><th>เปิด / จัดการ</th></tr></thead>';
      const body = document.createElement('tbody');
      items.forEach(d => {
        const rev = Master.currentRevision(d.doc_id), line = Master.line(d.line_id);
        const tr = document.createElement('tr');
        const values = [d.doc_name, line ? (line.display_name || line.line_name) : d.line_id,
          rev ? rev.rev_no : 'ยังไม่มีฉบับปัจจุบัน', rev ? rev.effective_date : ''];
        values.forEach(value => { const td = document.createElement('td'); td.textContent = value || '—'; tr.appendChild(td); });
        const number = document.createElement('small'); number.textContent = d.doc_no || d.doc_id; tr.children[0].appendChild(number);
        const cell = document.createElement('td'), actions = document.createElement('div'); actions.className = 'document-actions';
        this.link(actions, 'ดู / ประวัติ Rev', 'viewer.html?doc_id=' + encodeURIComponent(d.doc_id));
        const ref = String(rev && rev.content_ref || '');
        if (this.quality && rev && /\.json$/i.test(ref)) {
          const formUrl = 'print.html?form=' + encodeURIComponent(d.doc_id) + '&rev_id=' + encodeURIComponent(rev.rev_id);
          const formLink = this.link(actions, 'ดู / พิมพ์ฟอร์ม', formUrl);
          formLink.onclick = event => { event.preventDefault(); DocumentPreview.open(d, rev, formUrl); };
        }
        if (!this.control && ref && !/\.json$/i.test(ref) && /^[\w-]+$/.test(ref)) {
          this.link(actions, 'ดาวน์โหลด', 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(ref), true);
          const pdfLink = this.link(actions, 'เปิด PDF / พิมพ์', 'viewer.html?doc_id=' + encodeURIComponent(d.doc_id));
          pdfLink.onclick = event => { event.preventDefault(); DocumentPreview.open(d, rev); };
        }
        if (this.control) {
          this.link(actions, 'อัปเดต Rev', 'admin.html?tab=rev&doc_id=' + encodeURIComponent(d.doc_id));
          this.link(actions, 'แก้ข้อมูล', 'admin.html?tab=manage&doc_id=' + encodeURIComponent(d.doc_id));
          this.link(actions, 'ผูกสถานี', 'admin.html?tab=assign&doc_id=' + encodeURIComponent(d.doc_id));
        }
        cell.appendChild(actions); tr.appendChild(cell); body.appendChild(tr);
      });
      table.appendChild(body); scroll.appendChild(table); section.appendChild(scroll); root.appendChild(section);
    });
  },

  async reload() {
    const button = document.getElementById('reload-documents'); button.disabled = true;
    const error = document.getElementById('library-error'); error.hidden = true;
    try { await Master._fetch(); this.fillFilters(); this.render(); }
    catch (err) { error.textContent = 'โหลดฉบับล่าสุดไม่สำเร็จ: ' + err.message; error.hidden = false; }
    finally { button.disabled = false; }
  },

  async init() {
    const user = Auth.requireLogin(); if (!user) return;
    if (this.control && user.role !== 'Admin') { location.replace('documents.html'); return; }
    AppShell.init(this.control ? 'admin' : this.quality ? 'quality' : 'wi');
    if (this.quality) {
      document.title = 'เอกสารควบคุมคุณภาพ — ENC QMS';
      document.getElementById('library-title').textContent = 'เอกสารควบคุมคุณภาพ';
      document.getElementById('library-help').textContent = 'รวมเอกสารควบคุมคุณภาพและแบบฟอร์มทุกหมวด เช่น First Piece, Checklist, Drawing และมาตรฐาน — ดาวน์โหลด เปิด PDF หรือพิมพ์ฉบับปัจจุบัน พร้อมประวัติ Revision (WI อยู่ในเมนูเอกสาร WI)';
    }
    if (this.control) {
      document.title = 'ควบคุมเอกสาร — ENC QMS';
      document.getElementById('library-title').textContent = 'ควบคุมเอกสาร';
      document.getElementById('library-help').textContent = 'ทะเบียนเอกสารทุกหมวด — เพิ่มเอกสาร แก้ไขข้อมูล อัปเดต Revision และดูประวัติจากที่เดียว';
      document.getElementById('control-actions').hidden = false;
    }
    ['doc-query', 'doc-category', 'doc-station'].forEach(id =>
      document.getElementById(id).addEventListener(id === 'doc-query' ? 'input' : 'change', () => this.render()));
    document.getElementById('doc-line').addEventListener('change', () => { this.fillStations(); this.render(); });
    document.getElementById('reload-documents').addEventListener('click', () => this.reload());
    document.addEventListener('master-updated', () => { this.fillFilters(); this.render(); });
    await this.reload();
  }
};
DocumentLibrary.init();
