// ========================================================
// master.js — โหลด + cache Master Data จาก ENC-MASTER
// (Migration Step 2) ทุกหน้าใหม่ render จากข้อมูลชุดนี้
// cache ใน localStorage — เปิดเร็ว, refresh เบื้องหลังทุกครั้ง
// ========================================================

const Master = {
  data: null,
  version: null,

  LS_KEY: 'fp_master_cache',
  LS_TPLMAP: 'fp_template_map', // map form_id → template path (สำหรับ print/fill)

  // โหลด master: ใช้ cache ก่อนถ้ามี แล้ว refresh เบื้องหลัง
  async load() {
    if (this.data) return this.data;
    const cached = this._readCache();
    if (cached) {
      this.data = cached.master;
      this.version = cached.version;
      this._refreshInBackground();
      return this.data;
    }
    return this._fetch();
  },

  async _fetch() {
    const res = await API.get('master.getAll', {});
    this.data = res.master;
    this.version = res.master_version;
    try {
      localStorage.setItem(this.LS_KEY, JSON.stringify({
        version: res.master_version,
        master: res.master,
        ts: Date.now()
      }));
    } catch (e) { /* cache เต็ม — ข้าม */ }
    return this.data;
  },

  _readCache() {
    try {
      const raw = localStorage.getItem(this.LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  _refreshInBackground() {
    const self = this;
    API.get('master.getAll', {}).then(function (res) {
      if (String(res.master_version) !== String(self.version)) {
        self.data = res.master;
        self.version = res.master_version;
        try {
          localStorage.setItem(self.LS_KEY, JSON.stringify({
            version: res.master_version, master: res.master, ts: Date.now()
          }));
        } catch (e) { /* ข้าม */ }
        // แจ้งหน้าให้ re-render ถ้าสนใจ
        document.dispatchEvent(new CustomEvent('master-updated'));
      }
    }).catch(function () { /* offline — ใช้ cache ต่อ */ });
  },

  // ---------- helpers (ทุกตัวต้องเรียกหลัง load()) ----------
  _sorted(rows, key) {
    return (rows || []).slice().sort(function (a, b) {
      return (Number(a[key]) || 0) - (Number(b[key]) || 0);
    });
  },

  lines() {
    return this._sorted(this.data.M_Line, 'sequence');
  },

  // รายชื่อพนักงานสำหรับ dropdown "เลือกชื่อผู้บันทึก (Recorder)" ก่อนเซ็นลายเซ็น (fill.html)
  employees() {
    return this._sorted(this.data.M_Employee, 'sequence');
  },

  line(lineId) {
    return (this.data.M_Line || []).find(function (l) { return String(l.line_id) === String(lineId); });
  },

  stations(lineId) {
    const rows = (this.data.M_Station || []).filter(function (s) {
      return String(s.line_id) === String(lineId);
    });
    return this._sorted(rows, 'sequence');
  },

  station(stationId) {
    return (this.data.M_Station || []).find(function (s) { return String(s.station_id) === String(stationId); });
  },

  docTypes() {
    return this._sorted(this.data.M_DocType, 'sequence');
  },

  docType(id) {
    return (this.data.M_DocType || []).find(function (t) { return String(t.doctype_id) === String(id); });
  },

  families() {
    return this._sorted(this.data.M_ProductFamily, 'sequence');
  },

  // รุ่นย่อยของ Family (สำหรับ dropdown "Product Model" ตอนกรอกฟอร์ม — กันพิมพ์ผิด)
  // seriesTag (ถ้ามี — เช่นเอกสารนี้เป็น "Classic" หรือ "Visi Smart" ใน family LC เดียวกัน) กรองซ้ำอีกชั้น:
  // - ไม่ระบุ seriesTag (เอกสารไม่ได้ผูกซีรีส์ไว้) = โชว์ทุกรุ่นของ family เหมือนเดิม
  // - รุ่น (M_Model) ที่ไม่ได้ระบุ series_tag ของตัวเอง = ใช้ได้กับทุกซีรีส์ ไม่ถูกกรองออก
  // modelGroup (ถ้ามี — แยกย่อยกว่า series_tag อีกชั้น เช่น series="Visi Smart" แต่มีเอกสารแยกรุ่น EZ / L) กรองซ้ำแบบเดียวกัน
  models(familyId, seriesTag, modelGroup) {
    return (this.data.M_Model || []).filter(function (m) {
      if (String(m.family_id) !== String(familyId)) return false;
      if (seriesTag && m.series_tag && String(m.series_tag) !== String(seriesTag)) return false;
      if (modelGroup && m.model_group && String(m.model_group) !== String(modelGroup)) return false;
      return true;
    });
  },

  // ค่าซีรีส์ย่อยทั้งหมดที่เคยตั้งไว้ใน M_Model ของ family นี้ (ใช้ทำ datalist กันพิมพ์ผิดตอนตั้งเอกสาร)
  seriesTagsForFamily(familyId) {
    const set = {};
    (this.data.M_Model || []).forEach(function (m) {
      if (String(m.family_id) === String(familyId) && m.series_tag) set[m.series_tag] = true;
    });
    return Object.keys(set).sort();
  },

  // ค่ากลุ่มรุ่นย่อยทั้งหมดที่เคยตั้งไว้ใน M_Model ของ family นี้ (ใช้ทำ datalist กันพิมพ์ผิดตอนตั้งเอกสาร)
  modelGroupsForFamily(familyId) {
    const set = {};
    (this.data.M_Model || []).forEach(function (m) {
      if (String(m.family_id) === String(familyId) && m.model_group) set[m.model_group] = true;
    });
    return Object.keys(set).sort();
  },

  document(docId) {
    return (this.data.M_Document || []).find(function (d) { return String(d.doc_id) === String(docId); });
  },

  revisions(docId) {
    return (this.data.M_Revision || []).filter(function (r) {
      return String(r.doc_id) === String(docId);
    });
  },

  currentRevision(docId) {
    return this.revisions(docId).find(function (r) { return String(r.status) === 'CURRENT'; }) || null;
  },

  // เอกสารของ Station: (1) ผูกตรงใน M_DocAssign หรือ
  // (2) เอกสาร scope ระดับไลน์/ทั้งโรงงาน (line_id='*' หรือตรงไลน์) ที่ยังไม่ผูก Station ใดเลย
  documentsForStation(stationId, lineId) {
    const assigns = (this.data.M_DocAssign || []);
    const assignedHere = {};
    const hasAnyAssign = {};
    assigns.forEach(function (a) {
      hasAnyAssign[a.doc_id] = true;
      if (String(a.station_id) === String(stationId)) assignedHere[a.doc_id] = true;
    });
    const self = this;
    return (this.data.M_Document || []).filter(function (d) {
      if (assignedHere[d.doc_id]) return true;
      if (hasAnyAssign[d.doc_id]) return false; // ผูก Station อื่นไว้เจาะจงแล้ว
      return String(d.line_id) === '*' || String(d.line_id) === String(lineId);
    }).map(function (d) {
      return Object.assign({}, d, {
        doctype: self.docType(d.doctype_id),
        current_rev: self.currentRevision(d.doc_id)
      });
    });
  },

  // เอกสารทั้งหมดของไลน์ (รวมทุก Station) — ใช้กับหมวดที่ไม่ต้องเลือก Station เช่น First Piece
  // (1 ชุด = 1 ไฟล์ = ครอบคลุมทุก Station ของไลน์นั้น) รวมผลจากทุก Station แล้วตัดซ้ำด้วย doc_id
  documentsForLine(lineId) {
    const stations = this.stations(lineId);
    const self = this;
    const seen = {};
    const out = [];
    stations.forEach(function (s) {
      self.documentsForStation(s.station_id, lineId).forEach(function (d) {
        if (!seen[d.doc_id]) { seen[d.doc_id] = true; out.push(d); }
      });
    });
    if (!stations.length) {
      // เผื่อไลน์ยังไม่มี Station seed แต่มีเอกสาร scope ทั้งไลน์ผูกไว้แล้ว
      (this.data.M_Document || []).forEach(function (d) {
        if (seen[d.doc_id]) return;
        if (String(d.line_id) === '*' || String(d.line_id) === String(lineId)) {
          seen[d.doc_id] = true;
          out.push(Object.assign({}, d, {
            doctype: self.docType(d.doctype_id),
            current_rev: self.currentRevision(d.doc_id)
          }));
        }
      });
    }
    return out;
  },

  // ---------- หา template path จาก form_id (สำหรับ print record เก่า/ใหม่) ----------
  // 1) ลองจาก CONFIG.FORMS (ระบบเดิม)  2) ลองจาก map ที่เคย resolve แล้ว
  // 3) ไล่ fetch template ของ revision CURRENT ทุกตัวจนเจอ form_id ที่ตรง (cache ผลไว้)
  async resolveTemplate(formId) {
    const legacy = CONFIG.FORMS.find(function (f) { return f.form_id === formId; });
    if (legacy) return legacy.template_file;

    let map = {};
    try { map = JSON.parse(localStorage.getItem(this.LS_TPLMAP) || '{}'); } catch (e) { map = {}; }
    if (map[formId]) return map[formId];

    await this.load();
    const jsonRevs = (this.data.M_Revision || []).filter(function (r) {
      return String(r.status) === 'CURRENT' && /\.json$/.test(String(r.content_ref));
    });
    for (let i = 0; i < jsonRevs.length; i++) {
      const path = String(jsonRevs[i].content_ref);
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (!res.ok) continue;
        const tpl = await res.json();
        map[tpl.form_id] = path;
      } catch (e) { /* ข้ามไฟล์ที่โหลดไม่ได้ */ }
      if (map[formId]) break;
    }
    try { localStorage.setItem(this.LS_TPLMAP, JSON.stringify(map)); } catch (e) { /* ข้าม */ }
    if (!map[formId]) throw new Error('ไม่พบ template ของฟอร์ม: ' + formId);
    return map[formId];
  }
};
