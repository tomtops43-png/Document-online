// One registry: WI is a filtered reading view; control groups every document type.
const DocumentLibrary = {
  control: new URLSearchParams(location.search).get('mode') === 'control',
  quality: new URLSearchParams(location.search).get('mode') === 'quality',
  active(row) { return !['DELETED', 'INACTIVE', 'DISABLED'].includes(String(row.status || '').toUpperCase()); },
  lineKey(value) {
    const key = String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
    const line = (Master.data.M_Line || []).find(l => [l.line_id, l.line_name, l.display_name].some(v =>
      String(v || '').trim().toLowerCase().replace(/[\s_-]/g, '') === key));
    return line ? String(line.line_id) : String(value || '').trim();
  },
  assignedStations(doc) {
    const ids = new Set((Master.data.M_DocAssign || []).filter(a => this.active(a) && String(a.doc_id) === String(doc.doc_id)).map(a => String(a.station_id)));
    return (Master.data.M_Station || []).filter(s => this.active(s) && ids.has(String(s.station_id)))
      .sort((a,b) => String(a.station_no || a.station_name).localeCompare(String(b.station_no || b.station_name), 'th', {numeric:true}));
  },
  stationLabel(station) {
    const label = 'Station ' + (station.station_no || station.station_id), name = String(station.station_name || '').trim();
    return name && name.toLowerCase().replace(/\s/g,'') !== label.toLowerCase().replace(/\s/g,'') ? label + ' — ' + name : label;
  },
  modelLabel(doc) {
    const family = (Master.data.M_ProductFamily || []).find(f => String(f.family_id) === String(doc.family_id));
    return [family ? (family.display_name || family.family_name) : (doc.family_id && doc.family_id !== '*' ? doc.family_id : 'ทุกรุ่น'), doc.series_tag, doc.model_group].filter(Boolean).join(' / ');
  },
  matchesModel(doc) {
    const value = document.getElementById('doc-model').value;
    if (!value) return true;
    const familyOnly = value.startsWith('family:');
    const model = familyOnly ? {family_id:value.slice(7)} : (Master.data.M_Model || []).find(m => String(m.model_id) === value.slice(6));
    if (!model) return false;
    return (!doc.family_id || doc.family_id === '*' || String(doc.family_id) === String(model.family_id)) &&
      (familyOnly || ((!doc.series_tag || !model.series_tag || String(doc.series_tag) === String(model.series_tag)) &&
      (!doc.model_group || !model.model_group || String(doc.model_group) === String(model.model_group))));
  },
  restore(select, value) { select.value = Array.from(select.options).some(o => o.value === value) ? value : ''; },

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

  filteredDocuments(ignoreStation = false) {
    const query = document.getElementById('doc-query').value.trim().toLocaleLowerCase();
    const category = document.getElementById('doc-category').value;
    const line = document.getElementById('doc-line').value;
    const station = ignoreStation ? '' : document.getElementById('doc-station').value;
    return (Master.data.M_Document || []).filter(d => {
      if (['DELETED', 'INACTIVE', 'DISABLED'].includes(String(d.status).toUpperCase())) return false;
      if (!this.includesType(Master.docType(d.doctype_id))) return false;
      if (category && String(d.doctype_id) !== category) return false;
      const assigned = this.assignedStations(d);
      if (line && this.lineKey(d.line_id) !== this.lineKey(line) && String(d.line_id) !== '*' && !assigned.some(s => this.lineKey(s.line_id) === this.lineKey(line))) return false;
      if (!this.matchesModel(d)) return false;
      if (station) {
        const selectedStation = Master.station(station);
        if (assigned.length ? !assigned.some(s => String(s.station_id) === station) :
          !selectedStation || (String(d.line_id) !== '*' && this.lineKey(d.line_id) !== this.lineKey(selectedStation.line_id))) return false;
      }
      return !query || [d.doc_name, d.doc_no, d.doc_id].join(' ').toLocaleLowerCase().includes(query);
    }).sort((a, b) => {
      if (!this.control && !this.quality) {
        const modelOrder = this.modelLabel(a).localeCompare(this.modelLabel(b), 'th');
        if (modelOrder) return modelOrder;
        const first = this.assignedStations(a)[0], second = this.assignedStations(b)[0];
        const stationOrder = String(first ? first.station_no : 'zz').localeCompare(String(second ? second.station_no : 'zz'), 'th', {numeric:true});
        if (stationOrder) return stationOrder;
      }
      return String(a.doc_name).localeCompare(String(b.doc_name), 'th');
    });
  },

  fillFilters() {
    const category = document.getElementById('doc-category');
    const line = document.getElementById('doc-line');
    const oldCategory = category.value, oldLine = line.value;
    category.replaceChildren(new Option(this.control || this.quality ? 'ทุกหมวด' : 'WI', ''));
    Master.docTypes().filter(t => this.includesType(t)).forEach(t =>
      category.add(new Option(t.display_name_th || t.doctype_name, t.doctype_id)));
    this.restore(category, oldCategory);
    category.closest('label').hidden = !this.control && !this.quality;
    line.replaceChildren(new Option('ทุกไลน์', ''));
    Master.lines().forEach(l => line.add(new Option(l.display_name || l.line_name, l.line_id)));
    this.restore(line, oldLine);
    const models = document.getElementById('doc-model'), oldModel = models.value;
    models.replaceChildren(new Option('ทุกโมเดล', ''));
    const families = new Map((Master.data.M_ProductFamily || []).filter(f => this.active(f)).map(f => [String(f.family_id), f.display_name || f.family_name || f.family_id]));
    (Master.data.M_Document || []).forEach(d => { if (d.family_id && d.family_id !== '*' && !families.has(String(d.family_id))) families.set(String(d.family_id), d.family_id); });
    families.forEach((label,id) => models.add(new Option(label + ' (ทุกรุ่น)', 'family:' + id)));
    (Master.data.M_Model || []).filter(m => this.active(m)).forEach(m => models.add(new Option(m.model_name || m.model_id, 'model:' + m.model_id)));
    this.restore(models, oldModel);
    this.fillStations();
  },

  fillStations() {
    const el = document.getElementById('doc-station'), old = el.value;
    const line = document.getElementById('doc-line').value;
    const wi = !this.control && !this.quality;
    const available = wi ? new Set(this.filteredDocuments(true).flatMap(d => this.assignedStations(d).map(s => String(s.station_id)))) : null;
    el.replaceChildren(new Option('ทุกสถานี', ''));
    (Master.data.M_Station || []).filter(s => this.active(s) && (!line || this.lineKey(s.line_id) === this.lineKey(line)) && (!available || available.has(String(s.station_id))))
      .sort((a,b) => String(a.station_no || '').localeCompare(String(b.station_no || ''), 'th', {numeric:true}))
      .forEach(s => el.add(new Option((line ? '' : s.line_id + ' / ') + this.stationLabel(s), s.station_id)));
    this.restore(el, old);
    el.disabled = el.options.length === 1;
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
    const wi = !this.control && !this.quality;
    docs.forEach(d => { const key = wi ? this.modelLabel(d) : d.doctype_id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(d); });
    groups.forEach((items, typeId) => {
      const type = Master.docType(typeId);
      const section = document.createElement('section'); section.className = 'card';
      const title = document.createElement('h2');
      title.textContent = (wi ? 'WI — ' + typeId : (type ? (type.display_name_th || type.doctype_name) : typeId)) + ' (' + items.length + ')';
      section.appendChild(title);
      if (wi) {
        const count = new Set(items.flatMap(d => this.assignedStations(d).map(s => String(s.station_id)))).size;
        const shared = items.filter(d => !this.assignedStations(d).length).length;
        const summary = document.createElement('p'); summary.className = 'station-summary';
        summary.textContent = 'ระบุแล้ว ' + count + ' Station' + (shared ? ' · ' + shared + ' เอกสารใช้ทั้งไลน์ / ยังไม่ระบุ Station เฉพาะ' : '');
        section.appendChild(summary);
      }
      const scroll = document.createElement('div'); scroll.className = 'table-scroll';
      const table = document.createElement('table'); table.className = 'record-table document-library-table';
      table.innerHTML = '<thead><tr><th>เอกสาร / เลขที่</th><th>ไลน์</th><th>Revision ปัจจุบัน</th><th>วันที่มีผล</th><th>เปิด / จัดการ</th></tr></thead>';
      if (wi) { table.classList.add('wi-station-table'); table.querySelector('thead tr').innerHTML = '<th>Station</th><th>เอกสาร / เลขที่</th><th>ไลน์</th><th>Revision ปัจจุบัน</th><th>วันที่มีผล</th><th>เปิด / พิมพ์</th>'; }
      const body = document.createElement('tbody');
      items.forEach(d => {
        const rev = Master.currentRevision(d.doc_id), line = Master.line(this.lineKey(d.line_id));
        const tr = document.createElement('tr');
        const values = [d.doc_name, line ? (line.display_name || line.line_name) : d.line_id,
          rev ? rev.rev_no : 'ยังไม่มีฉบับปัจจุบัน', rev ? rev.effective_date : ''];
        values.forEach(value => { const td = document.createElement('td'); td.textContent = value || '—'; tr.appendChild(td); });
        const ref = String(rev && rev.content_ref || '');
        if (!this.control && ref) {
          const nameCell = tr.children[0]; nameCell.replaceChildren();
          const formUrl = /\.json$/i.test(ref) ? 'print.html?form=' + encodeURIComponent(d.doc_id) + '&rev_id=' + encodeURIComponent(rev.rev_id) : null;
          const nameLink = this.link(nameCell, d.doc_name, formUrl || 'viewer.html?doc_id=' + encodeURIComponent(d.doc_id));
          nameLink.className = 'document-name-link';
          nameLink.onclick = event => { event.preventDefault(); DocumentPreview.open(d, rev, formUrl); };
        }
        const number = document.createElement('small'); number.textContent = d.doc_no || d.doc_id; tr.children[0].appendChild(number);
        if (wi) {
          const stationCell = document.createElement('td'), stations = this.assignedStations(d);
          stationCell.textContent = stations.length ? stations.map(s => this.stationLabel(s)).join('\n') : 'ทั้งไลน์ — ยังไม่ระบุ Station เฉพาะ';
          tr.insertBefore(stationCell, tr.firstChild);
        }
        const cell = document.createElement('td'), actions = document.createElement('div'); actions.className = 'document-actions';
        this.link(actions, 'ดู / ประวัติ Rev', 'viewer.html?doc_id=' + encodeURIComponent(d.doc_id));
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
    if (!Master.data) {
      const cached = Master._readCache();
      if (cached && cached.master) { Master.data = cached.master; Master.version = cached.version; }
    }
    if (Master.data) { this.fillFilters(); this.render(); }
    try { await Master._fetch(); this.fillFilters(); this.render(); }
    catch (err) { error.textContent = (Master.data ? 'เชื่อมต่อข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงข้อมูลที่เคยโหลดไว้: ' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่: ') + err.message; error.hidden = false; }
    finally { button.disabled = false; }
  },

  async init() {
    const user = Auth.requireLogin(); if (!user) return;
    if (this.control && user.role !== 'Admin') { location.replace('documents.html'); return; }
    AppShell.init(this.control ? 'admin' : this.quality ? 'quality' : 'wi');
    document.getElementById('doc-category').closest('label').hidden = !this.control && !this.quality;
    if (this.quality) {
      document.title = 'เอกสารควบคุมคุณภาพ — ENC QMS';
      document.getElementById('library-title').textContent = 'เอกสารควบคุมคุณภาพ';
      document.getElementById('library-help').textContent = 'กดชื่อรุ่น / เอกสารเพื่อเปิดดูและพิมพ์ฉบับปัจจุบันในป๊อปอัพ พร้อมประวัติ Revision (WI อยู่ในเมนูเอกสาร WI)';
    }
    if (this.control) {
      document.title = 'ควบคุมเอกสาร — ENC QMS';
      document.getElementById('library-title').textContent = 'ควบคุมเอกสาร';
      document.getElementById('library-help').textContent = 'ทะเบียนเอกสารทุกหมวด — เพิ่มเอกสาร แก้ไขข้อมูล อัปเดต Revision และดูประวัติจากที่เดียว';
      document.getElementById('control-actions').hidden = false;
    }
    ['doc-query', 'doc-category', 'doc-station', 'doc-model'].forEach(id =>
      document.getElementById(id).addEventListener(id === 'doc-query' ? 'input' : 'change', () => { if (id !== 'doc-station') this.fillStations(); this.render(); }));
    document.getElementById('doc-line').addEventListener('change', () => { this.fillStations(); this.render(); });
    document.getElementById('reload-documents').addEventListener('click', () => this.reload());
    document.addEventListener('master-updated', () => { this.fillFilters(); this.render(); });
    await this.reload();
  }
};
DocumentLibrary.init();
