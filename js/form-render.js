// ========================================================
// form-render.js — engine สร้างฟอร์มกรอกจาก template JSON
// ใช้กับ fill.html (ห้าม hardcode รายการตรวจในหน้า HTML)
// ========================================================

const FormRender = {
  template: null,
  context: {},      // { form_id, station, header: {...} } จาก sessionStorage
  answers: {},      // {item_id: {value, way, texts, checks, torque_actual, recorder, time}}
  photos: {},       // {item_id: [{dataUrl, base64}]}
  recovery: [],     // [{item_id, problem, countermeasure}]
  draftKey: '',

  // ---------- เริ่มต้น ----------
  async init(template, context) {
    this.template = template;
    this.context = context;
    this.draftKey = CONFIG.LS_DRAFT_PREFIX + template.form_id + '_' + (context.station || 'single');
    this.restoreDraft();
    this.renderHeader();
    this.renderSections();
    this.updateProgress();
  },

  // ---------- draft ใน localStorage (ห้ามให้ข้อมูลหาย) ----------
  saveDraft() {
    try {
      localStorage.setItem(this.draftKey, JSON.stringify({
        header: this.context.header,
        answers: this.answers,
        photos: this.photos,
        recovery: this.recovery,
        saved_at: new Date().toISOString()
      }));
    } catch (e) {
      // localStorage เต็ม (รูปเยอะ) — เก็บเฉพาะคำตอบ ไม่เก็บรูป
      try {
        localStorage.setItem(this.draftKey, JSON.stringify({
          header: this.context.header,
          answers: this.answers,
          recovery: this.recovery,
          saved_at: new Date().toISOString()
        }));
      } catch (e2) { /* เก็บไม่ได้จริงๆ */ }
    }
  },

  restoreDraft() {
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      // ใช้ draft เฉพาะเมื่อ header ตรงกัน (วันเดียวกัน/รุ่นเดียวกัน)
      const same = draft.header && this.context.header &&
        draft.header.date === this.context.header.date &&
        draft.header.product_model === this.context.header.product_model;
      if (same) {
        this.answers = draft.answers || {};
        this.photos = draft.photos || {};
        this.recovery = draft.recovery || [];
        showToast('กู้คืนข้อมูลที่กรอกค้างไว้แล้ว', 'info');
      } else {
        localStorage.removeItem(this.draftKey);
      }
    } catch (e) { /* draft เสีย — ข้าม */ }
  },

  clearDraft() {
    localStorage.removeItem(this.draftKey);
  },

  // ---------- render ส่วนหัว ----------
  renderHeader() {
    const el = document.getElementById('form-header');
    const t = this.template;
    let html = '<div class="form-title">' + esc(t.title_th) + '</div>';
    html += '<div class="form-docno">' + esc(t.doc_no) + '</div>';
    html += '<div class="header-grid">';
    (t.header_fields || []).forEach(function (f) {
      const val = FormRender.context.header[f.key] || '';
      html += '<div class="header-field"><span class="hf-label">' + esc(f.label) + ':</span> <span class="hf-value">' + esc(val) + '</span></div>';
    });
    if (this.context.station) {
      html += '<div class="header-field"><span class="hf-label">Station:</span> <span class="hf-value">' + esc(String(this.context.station)) + '</span></div>';
    }
    html += '</div>';
    el.innerHTML = html;
  },

  // ---------- render ทุก section ----------
  renderSections() {
    const container = document.getElementById('form-sections');
    container.innerHTML = '';
    this.template.sections.forEach(function (section) {
      const secEl = document.createElement('div');
      secEl.className = 'section-card';
      secEl.innerHTML = '<div class="section-title">' + esc(section.title) + '</div>';
      section.items.forEach(function (item) {
        secEl.appendChild(FormRender.renderItem(item));
      });
      container.appendChild(secEl);
    });
    document.getElementById('form-sections').addEventListener('input', function () {
      FormRender.saveDraft();
      FormRender.updateProgress();
    });
  },

  // ---------- render 1 item ----------
  renderItem(item) {
    const el = document.createElement('div');
    el.className = 'item-card' + (item.critical ? ' item-critical' : '');
    el.dataset.itemId = item.item_id;

    const ans = this.getAnswer(item.item_id);
    let html = '<div class="item-text">' + (item.critical ? '<span class="critical-mark">✱</span> ' : '');
    if (item.no) html += '<span class="item-no">' + esc(item.no) + '.</span> ';
    html += esc(item.text_th);
    if (item.frequency_th) html += ' <span class="item-freq">(' + esc(item.frequency_th) + ')</span>';
    html += '</div>';
    if (item.sub_th && item.sub_th.length) {
      html += '<div class="item-sub">' + item.sub_th.map(esc).join('<br>') + '</div>';
    }
    if (item.note_th) html += '<div class="item-note">' + esc(item.note_th) + '</div>';

    const extra = item.options_extra || {};

    // way_select (เลือกรุ่น single-select)
    if (extra.way_select) {
      html += '<div class="way-group" data-role="way">';
      extra.way_select.forEach(function (w) {
        html += '<button type="button" class="btn-way' + (ans.way === w ? ' selected' : '') + '" data-way="' + escAttr(w) + '">' + esc(w) + '</button>';
      });
      html += '</div>';
    }

    // ช่องข้อความประกอบ (เช่น ระบุรุ่นบน Label, Date Code)
    if (extra.texts) {
      html += '<div class="text-group">';
      extra.texts.forEach(function (tf) {
        const v = (ans.texts && ans.texts[tf.key]) || '';
        html += '<label class="text-field"><span>' + esc(tf.label) + '</span>' +
          '<input type="text" data-role="extra-text" data-key="' + escAttr(tf.key) + '" value="' + escAttr(v) + '"></label>';
      });
      html += '</div>';
    }

    // checkbox ประกอบ (เช่น TH)
    if (extra.checkboxes) {
      html += '<div class="check-group">';
      extra.checkboxes.forEach(function (cb) {
        const checked = ans.checks && ans.checks[cb];
        html += '<label class="check-field"><input type="checkbox" data-role="extra-check" data-key="' + escAttr(cb) + '"' + (checked ? ' checked' : '') + '> ' + esc(cb) + '</label>';
      });
      html += '</div>';
    }

    // ---- คำตอบหลักตาม answer_type ----
    if (item.answer_type === 'acc_rej') {
      html += '<div class="answer-row" data-role="answer">' +
        '<button type="button" class="btn-acc' + (ans.value === 'ACC' ? ' selected' : '') + '" data-value="ACC">Acc ✓</button>' +
        '<button type="button" class="btn-rej' + (ans.value === 'REJ' ? ' selected' : '') + '" data-value="REJ">Rej ✗</button>' +
        '</div>';
    } else if (item.answer_type === 'ok_nok_na') {
      html += '<div class="answer-row" data-role="answer">' +
        '<button type="button" class="btn-acc' + (ans.value === 'OK' ? ' selected' : '') + '" data-value="OK">OK</button>' +
        '<button type="button" class="btn-rej' + (ans.value === 'NOK' ? ' selected' : '') + '" data-value="NOK">NOK</button>' +
        '<button type="button" class="btn-na' + (ans.value === 'NA' ? ' selected' : '') + '" data-value="NA">N/A</button>' +
        '</div>';
    } else if (item.answer_type === 'torque_value') {
      // หน้างานจริงส่วนใหญ่แค่ติ๊ก Acc/Rej เหมือนข้ออื่นๆ ไม่ได้พิมพ์ค่า Torque ที่วัดได้จริง —
      // เก็บ spec ไว้เป็นข้อความอ้างอิงให้ผู้ตรวจดูเทียบเฉยๆ
      const spec = item.torque_spec || {};
      html += '<div class="answer-row" data-role="answer">' +
        '<button type="button" class="btn-acc' + (ans.value === 'ACC' ? ' selected' : '') + '" data-value="ACC">Acc ✓</button>' +
        '<button type="button" class="btn-rej' + (ans.value === 'REJ' ? ' selected' : '') + '" data-value="REJ">Rej ✗</button>' +
        '</div>' +
        '<div class="torque-spec">Spec: ' + esc(spec.display || (spec.min + '-' + spec.max + ' ' + (spec.unit || ''))) + '</div>';
    } else if (item.answer_type === 'text') {
      html += '<input type="text" class="answer-text" data-role="answer-text" value="' + escAttr(ans.value || '') + '">';
    }

    // ช่องถ่ายรูป (แทนการแปะฉลากจริง)
    if (item.photo) {
      const required = item.photo.required !== false;
      html += '<div class="photo-block">' +
        '<div class="photo-label">📷 ' + esc(item.photo.label || 'แนบรูป') + (required ? ' <span class="req">*บังคับ</span>' : '') + '</div>' +
        '<div class="photo-previews" data-role="photo-previews"></div>' +
        '<button type="button" class="btn-photo" data-role="btn-photo">ถ่ายรูป / แนบรูป</button>' +
        '</div>';
    }

    // Time (บันทึกอัตโนมัติตอนตอบ Acc/Rej — Recorder เซ็นครั้งเดียวท้ายฟอร์มต่อ Station ไม่ต้องเซ็นซ้ำทีละข้อ)
    if (item.time) {
      html += '<div class="rt-row"><label class="text-field"><span>Time</span><input type="text" data-role="time" value="' + escAttr(ans.time || '') + '" readonly placeholder="บันทึกอัตโนมัติเมื่อตอบ"></label></div>';
    }

    el.innerHTML = html;
    this.bindItemEvents(el, item);
    if (item.photo) this.renderPhotoPreviews(el, item);
    return el;
  },

  // ---------- event ต่อ item ----------
  bindItemEvents(el, item) {
    const self = this;

    // ปุ่มคำตอบหลัก
    const answerRow = el.querySelector('[data-role="answer"]');
    if (answerRow) {
      answerRow.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          answerRow.querySelectorAll('button').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          const ans = self.getAnswer(item.item_id);
          ans.value = btn.dataset.value;
          if (!ans.time) {
            ans.time = new Date().toTimeString().slice(0, 5);
            const timeInput = el.querySelector('[data-role="time"]');
            if (timeInput) timeInput.value = ans.time;
          }
          self.saveDraft();
          self.updateProgress();
          // NOK/REJ บนข้อ critical → บังคับ Recovery Plan ทันที
          if (item.critical && (ans.value === 'NOK' || ans.value === 'REJ')) {
            self.openRecoveryModal(item);
          }
        });
      });
    }

    // way_select
    const wayGroup = el.querySelector('[data-role="way"]');
    if (wayGroup) {
      wayGroup.querySelectorAll('.btn-way').forEach(function (btn) {
        btn.addEventListener('click', function () {
          wayGroup.querySelectorAll('.btn-way').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          self.getAnswer(item.item_id).way = btn.dataset.way;
          self.saveDraft();
          self.updateProgress();
        });
      });
    }

    // ช่องข้อความหลัก (answer_type: text)
    const answerText = el.querySelector('[data-role="answer-text"]');
    if (answerText) {
      answerText.addEventListener('input', function () {
        self.getAnswer(item.item_id).value = answerText.value;
      });
    }

    // extra texts / checks / recorder / time
    el.querySelectorAll('[data-role="extra-text"]').forEach(function (input) {
      input.addEventListener('input', function () {
        const ans = self.getAnswer(item.item_id);
        ans.texts = ans.texts || {};
        ans.texts[input.dataset.key] = input.value;
      });
    });
    el.querySelectorAll('[data-role="extra-check"]').forEach(function (input) {
      input.addEventListener('change', function () {
        const ans = self.getAnswer(item.item_id);
        ans.checks = ans.checks || {};
        ans.checks[input.dataset.key] = input.checked;
      });
    });
    // ปุ่มถ่ายรูป
    const btnPhoto = el.querySelector('[data-role="btn-photo"]');
    if (btnPhoto) {
      btnPhoto.addEventListener('click', async function () {
        try {
          const shot = await Camera.capture();
          if (!shot) return;
          self.photos[item.item_id] = self.photos[item.item_id] || [];
          self.photos[item.item_id].push(shot);
          self.renderPhotoPreviews(el, item);
          self.saveDraft();
          self.updateProgress();
        } catch (err) {
          showToast('ถ่ายรูปไม่สำเร็จ: ' + err.message, 'error');
        }
      });
    }
  },

  renderPhotoPreviews(el, item) {
    const box = el.querySelector('[data-role="photo-previews"]');
    const list = this.photos[item.item_id] || [];
    box.innerHTML = '';
    const self = this;
    list.forEach(function (p, idx) {
      const wrap = document.createElement('div');
      wrap.className = 'photo-preview';
      const src = p.dataUrl || (p.fileId ? drivePhotoUrl(p.fileId, 400) : '');
      wrap.innerHTML = '<img src="' + src + '" alt="photo"><button type="button" class="btn-del-photo">✕</button>';
      wrap.querySelector('.btn-del-photo').addEventListener('click', function () {
        list.splice(idx, 1);
        self.renderPhotoPreviews(el, item);
        self.saveDraft();
        self.updateProgress();
      });
      box.appendChild(wrap);
    });
  },

  getAnswer(itemId) {
    if (!this.answers[itemId]) this.answers[itemId] = {};
    return this.answers[itemId];
  },

  // ---------- progress ----------
  allItems() {
    const items = [];
    this.template.sections.forEach(function (s) { s.items.forEach(function (i) { items.push(i); }); });
    return items;
  },

  isItemAnswered(item) {
    const ans = this.answers[item.item_id] || {};
    if (item.answer_type === 'text') return !!(ans.value && String(ans.value).trim());
    if (item.photo && item.photo.required !== false) {
      const photos = this.photos[item.item_id] || [];
      if (!photos.length) return false;
    }
    if (item.answer_type === 'acc_rej' || item.answer_type === 'ok_nok_na' || item.answer_type === 'torque_value') return !!ans.value;
    return true;
  },

  updateProgress() {
    const items = this.allItems();
    const done = items.filter(this.isItemAnswered.bind(this)).length;
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (bar) bar.style.width = (items.length ? (done / items.length) * 100 : 0) + '%';
    if (label) label.textContent = 'ตอบแล้ว ' + done + '/' + items.length + ' ข้อ';
  },

  // ---------- Recovery Plan modal ----------
  openRecoveryModal(item) {
    const existing = this.recovery.find(function (r) { return r.item_id === item.item_id; });
    const modal = document.getElementById('recovery-modal');
    modal.style.display = 'flex';
    document.getElementById('recovery-item-label').textContent = (item.no ? item.no + '. ' : '') + item.text_th;
    document.getElementById('recovery-problem').value = existing ? existing.problem : '';
    document.getElementById('recovery-countermeasure').value = existing ? existing.countermeasure : '';
    modal.dataset.itemId = item.item_id;
  },

  saveRecoveryFromModal() {
    const modal = document.getElementById('recovery-modal');
    const itemId = modal.dataset.itemId;
    const problem = document.getElementById('recovery-problem').value.trim();
    const countermeasure = document.getElementById('recovery-countermeasure').value.trim();
    if (!problem || !countermeasure) {
      showToast('กรุณากรอกปัญหาและการแก้ไขให้ครบ', 'error');
      return false;
    }
    const existing = this.recovery.find(function (r) { return r.item_id === itemId; });
    if (existing) {
      existing.problem = problem;
      existing.countermeasure = countermeasure;
    } else {
      this.recovery.push({ item_id: itemId, problem: problem, countermeasure: countermeasure });
    }
    modal.style.display = 'none';
    this.saveDraft();
    return true;
  },

  // ---------- validate ก่อน submit ----------
  validate() {
    const errors = [];
    const self = this;
    this.allItems().forEach(function (item) {
      if (!self.isItemAnswered(item)) {
        errors.push((item.no ? item.no + '. ' : '') + item.text_th);
        return;
      }
      const ans = self.answers[item.item_id] || {};
      // critical + NOK/REJ ต้องมี recovery
      if (item.critical && (ans.value === 'NOK' || ans.value === 'REJ')) {
        const hasRecovery = self.recovery.some(function (r) { return r.item_id === item.item_id; });
        if (!hasRecovery) errors.push('ข้อ ' + (item.no || item.text_th) + ' ตอบ NOK ต้องกรอก Recovery Plan');
      }
    });
    return errors;
  },

  hasNok() {
    const answers = this.answers;
    return Object.keys(answers).some(function (k) {
      return answers[k].value === 'NOK' || answers[k].value === 'REJ';
    });
  },

  // ---------- submit ----------
  async submit() {
    const errors = this.validate();
    if (errors.length) {
      showToast('ยังกรอกไม่ครบ: ' + errors[0] + (errors.length > 1 ? ' (และอีก ' + (errors.length - 1) + ' ข้อ)' : ''), 'error');
      // เลื่อนไปข้อแรกที่ยังไม่ตอบ
      const firstMissing = this.allItems().find(function (i) { return !FormRender.isItemAnswered(i); });
      if (firstMissing) {
        const el = document.querySelector('[data-item-id="' + firstMissing.item_id + '"]');
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-missing'); }
      }
      return;
    }

    const canvas = document.getElementById('signature-canvas');
    if (canvas) {
      const isBlank = typeof canvasIsBlank !== 'undefined' 
        ? canvasIsBlank(canvas) 
        : (canvas.toDataURL() === document.createElement('canvas').toDataURL());
      if (isBlank) {
        showToast('กรุณาเซ็นชื่อผู้ตรวจสอบก่อนส่ง', 'error');
        return;
      }
      this.answers._operator_sign = cropCanvas(canvas).toDataURL('image/png');
    }

    // เซ็นครั้งเดียวต่อ Station — ใช้ลายเซ็นเดียวกันนี้เป็น Recorder ของทุกข้อในสถานีนี้ (ไม่ต้องเซ็นซ้ำทีละข้อ)
    const self = this;
    this.allItems().forEach(function (item) {
      if (item.recorder) self.getAnswer(item.item_id).recorder = self.answers._operator_sign;
    });

    const t = this.template;
    const ctx = this.context;
    // โหมด log-sheet: บันทึกเวลาของ entry (คอลัมน์ "เวลา/Time" บนกระดาษ)
    if (t.mode === 'log-sheet' && !this.answers._entry) {
      this.answers._entry = { time: new Date().toTimeString().slice(0, 5) };
    }
    Loading.show('กำลังบันทึกข้อมูล...');
    try {
      // 1) สร้าง record
      const res = await API.post('createRecord', {
        form_id: t.form_id,
        template_rev: t.template_rev,
        mode: t.mode,
        line: ctx.header.line || (t.lines && t.lines[0]) || '',
        station: ctx.station || '',
        product_model: ctx.header.product_model || '',
        date: ctx.header.date || '',
        shift: ctx.header.shift || '',
        answers: this.answers,
        has_nok: this.hasNok(),
        recovery: this.recovery
      });
      const recordId = res.record_id;

      // 2) อัปโหลดรูปทีละรูป (มี progress)
      const uploads = [];
      const photos = this.photos;
      Object.keys(photos).forEach(function (itemId) {
        (photos[itemId] || []).forEach(function (p, idx) {
          if (p.base64) uploads.push({ item_id: itemId, index: idx, base64: p.base64 });
        });
      });
      for (let i = 0; i < uploads.length; i++) {
        Loading.show('กำลังอัปโหลดรูป ' + (i + 1) + '/' + uploads.length + '...');
        await API.post('uploadPhoto', {
          record_id: recordId,
          item_id: uploads[i].item_id,
          line: ctx.header.line || (t.lines && t.lines[0]) || '',
          base64: uploads[i].base64
        });
      }

      this.clearDraft();
      Loading.hide();
      document.getElementById('success-record-id').textContent = recordId;
      document.getElementById('success-modal').style.display = 'flex';
    } catch (err) {
      Loading.hide();
      // ข้อมูลยังอยู่ใน draft — ผู้ใช้กด Submit ใหม่ได้
      showToast('บันทึกไม่สำเร็จ: ' + err.message + ' (ข้อมูลถูกเก็บไว้ กด Submit ใหม่ได้)', 'error');
    }
  }
};

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function cropCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[((y * w) + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX === -1) return canvas;
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return cropCanvas;
}
