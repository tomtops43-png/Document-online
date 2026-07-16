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

  clientUuid: '',
  resubmitOf: '', // record_id เดิมที่ถูกตีกลับ ถ้าเข้ามาทาง "แก้ไขและส่งใหม่" (records.html)
  _bgPhotoUploads: [], // promise ของรูปที่กำลังอัปโหลดเบื้องหลัง — submit() รอให้ settle ก่อนเสมอ (กัน race)

  // ---------- เริ่มต้น ----------
  async init(template, context) {
    this.template = template;
    this.context = context;
    this._bgPhotoUploads = [];
    this.excludedItemIds = this.getExcludedItemIds();
    this.draftKey = CONFIG.LS_DRAFT_PREFIX + template.form_id + '_' + (context.station || 'single');
    this.restoreDraft();
    // idempotency key: สร้างครั้งเดียวต่อการกรอก 1 ชุด เก็บใน draft — submit ซ้ำ (เน็ตหลุด) ใช้ค่าเดิม
    // server เห็น uuid ซ้ำ = คืน record เดิม ไม่สร้างซ้ำ
    if (!this.clientUuid) this.clientUuid = genClientUuid();
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
        client_uuid: this.clientUuid,
        resubmit_of: this.resubmitOf,
        saved_at: new Date().toISOString()
      }));
    } catch (e) {
      // localStorage เต็ม (รูปเยอะ) — เก็บเฉพาะคำตอบ ไม่เก็บรูป
      try {
        localStorage.setItem(this.draftKey, JSON.stringify({
          header: this.context.header,
          answers: this.answers,
          recovery: this.recovery,
          client_uuid: this.clientUuid,
          resubmit_of: this.resubmitOf,
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
        this.clientUuid = draft.client_uuid || '';
        this.resubmitOf = draft.resubmit_of || '';
        showToast(this.resubmitOf
          ? 'คัดลอกคำตอบจากใบที่ถูกตีกลับมาให้แล้ว แก้ไข/เพิ่มส่วนที่ขาดแล้ว Submit ใหม่ได้เลย'
          : 'กู้คืนข้อมูลที่กรอกค้างไว้แล้ว', 'info');
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

    // แถบสรุปใน app-bar (sticky) — เลื่อนฟอร์มลงไปไกลแค่ไหนก็ยังเห็นว่ากรอกเอกสาร/รุ่นไหนอยู่
    const sticky = document.getElementById('fill-context-info');
    if (sticky) {
      let info = '<span class="fci-title">' + esc(t.title_th) + '</span>';
      (t.header_fields || []).forEach(function (f) {
        const val = FormRender.context.header[f.key] || '';
        if (val) info += '<span class="fci-item">' + esc(f.label) + ': <b>' + esc(val) + '</b></span>';
      });
      if (this.context.station) {
        info += '<span class="fci-item">Station: <b>' + esc(String(this.context.station)) + '</b></span>';
      }
      sticky.innerHTML = info;
    }

    // .app-bar-fill เป็น position:fixed (ดูเหตุผลใน app.css) — ไม่มี padding-top ที่เนื้อหาข้างล่าง
    // จะโดนแถบด้านบนบัง ต้องวัดความสูงจริงแล้วเว้น padding ให้ .container พอดี วัดใหม่ทุกครั้งที่ resize
    // ด้วย (พลิกจอมือถือ/แท็บเล็ต หรือ context info ยาวจนขึ้นบรรทัดใหม่ ความสูงแถบจะเปลี่ยน)
    FormRender.adjustFillTopPadding();
    if (!FormRender._fillPaddingResizeBound) {
      window.addEventListener('resize', function () {
        clearTimeout(FormRender._fillPaddingResizeTimer);
        FormRender._fillPaddingResizeTimer = setTimeout(function () { FormRender.adjustFillTopPadding(); }, 150);
      });
      FormRender._fillPaddingResizeBound = true;
    }
  },

  adjustFillTopPadding() {
    const bar = document.querySelector('.app-bar-fill');
    const container = document.querySelector('main.container');
    if (!bar || !container) return;
    const h = bar.offsetHeight;
    container.style.paddingTop = (h + 20) + 'px';
    // ให้ scrollToNextStep() รู้ความสูงแถบจริง กัน auto-scroll พาเนื้อหาไปโผล่ใต้แถบ fixed พอดี
    document.documentElement.style.setProperty('--fill-bar-h', h + 'px');
  },

  // ---------- item ที่ Station ที่เลือกไม่ต้องตรวจ (ตาม Master Excel ต้นแบบ — คอลัมน์ N/A ต่อ Station) ----------
  getExcludedItemIds() {
    const excl = this.template && this.template.station_item_exclusions;
    if (!excl) return [];
    const station = String(this.context.station || '');
    return excl[station] || [];
  },

  sectionItems(section) {
    const excluded = this.excludedItemIds || [];
    if (!excluded.length) return section.items;
    return section.items.filter(function (i) { return excluded.indexOf(i.item_id) === -1; });
  },

  // ---------- render ทุก section ----------
  // แต่ละ section = 1 Station — ถ้ามีข้อที่ต้องมี Recorder ให้เซ็นชื่อครั้งเดียวท้าย section นั้น
  // (ไม่ใช่เซ็นทีละข้อ และไม่ใช่เซ็นครั้งเดียวรวมทั้งเอกสารที่มีหลาย Station)
  renderSections() {
    const container = document.getElementById('form-sections');
    container.innerHTML = '';
    this.stationSections = [];
    this.template.sections.forEach(function (section, idx) {
      const items = FormRender.sectionItems(section);
      const secEl = document.createElement('div');
      secEl.className = 'section-card';
      secEl.innerHTML = '<div class="section-title">' + esc(section.title) + '</div>';
      items.forEach(function (item) {
        secEl.appendChild(FormRender.renderItem(item));
      });
      const recorderItemIds = items.filter(function (i) { return i.recorder; }).map(function (i) { return i.item_id; });
      if (recorderItemIds.length) {
        const key = 'sec' + idx;
        FormRender.stationSections.push({ key: key, title: section.title, itemIds: recorderItemIds });
        secEl.appendChild(FormRender.buildStationSignatureBlock(key, section.title));
      }
      container.appendChild(secEl);
    });
    // ต้อง init signature pad หลังจาก element ถูกแนบเข้า DOM แล้วเท่านั้น (ต้องใช้ offsetWidth จริง)
    this.stationSections.forEach(function (s) { FormRender.initStationSignature(s); });
    document.getElementById('form-sections').addEventListener('input', function () {
      FormRender.saveDraft();
      FormRender.updateProgress();
    });
  },

  buildStationSignatureBlock(key, title) {
    const wrap = document.createElement('div');
    wrap.className = 'station-sig-block';
    wrap.dataset.stationKey = key;
    wrap.innerHTML = '<div class="station-sig-label">ลงชื่อผู้บันทึก (Recorder) — เซ็นครั้งเดียวสำหรับ ' + esc(title) + ' *</div>' +
      '<div class="station-sig-pad-wrap"><canvas class="station-sig-canvas" data-role="station-sig-canvas"></canvas>' +
      '<button type="button" class="btn-small station-sig-clear" data-role="station-sig-clear">ล้าง</button></div>';
    return wrap;
  },

  initStationSignature(s) {
    const wrap = document.querySelector('[data-station-key="' + s.key + '"]');
    if (!wrap) return;
    const canvas = wrap.querySelector('[data-role="station-sig-canvas"]');
    const clearBtn = wrap.querySelector('[data-role="station-sig-clear"]');
    if (!canvas || typeof initSignaturePad !== 'function') return;

    initSignaturePad(canvas, clearBtn);

    const self = this;
    const firstAns = this.getAnswer(s.itemIds[0]);
    // วาดตัวอย่างลายเซ็นเดิมลง canvas ได้เฉพาะ data: URL (same-origin, วาดแล้วอ่าน pixel กลับได้
    // ปกติ) — ค่าที่เป็น "drive:<fileId>" (ลายเซ็นจาก record เดิมตอนกด "แก้ไขและส่งใหม่") เป็นรูปจาก
    // Drive ข้าม origin จริง วาดลง canvas แล้วจะ taint canvas จน cropCanvas/getImageData ใช้ไม่ได้
    // ถ้า user เซ็นซ้ำทับ — คำตอบ (firstAns.recorder) ยังคงถูกเก็บไว้ใช้ได้ปกติ แค่ไม่โชว์พรีวิวบน pad
    if (firstAns.recorder && String(firstAns.recorder).indexOf('data:image') === 0) {
      const img = new Image();
      img.onload = function () { canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); };
      img.src = firstAns.recorder;
    }

    // เก็บลายเซ็นไว้แค่ที่ item แรกของ Station (ไม่ยัดซ้ำทุกข้อ) — validate()/submit() อ่านแค่
    // itemIds[0] อยู่แล้ว ส่วนตอนพิมพ์ print-render.js จะดึงค่านี้ไปโชว์ซ้ำทุกแถวของ Station เอง
    // ลดขนาดข้อมูล base64 ที่ต้องส่งไป server ตอน submit ได้มาก (ฟอร์มที่มีหลาย Station หลายข้อ
    // ต่อ Station เดิมส่งลายเซ็นเดิมซ้ำไปหลายสิบชุดโดยใช่เหตุ ทำให้ submit ช้า)
    let uploadDebounceTimer = null;
    function applyToStation(dataUrl) {
      self.getAnswer(s.itemIds[0]).recorder = dataUrl;
      self.saveDraft();
      self.updateProgress();
      // อัปโหลดลายเซ็นขึ้น Drive "เบื้องหลัง" ทันทีที่เซ็นเสร็จ (เงียบๆ ไม่รอ ไม่บล็อก UI) แทนที่จะรอ
      // ไปฝังรวมกับ createRecord ตอนกด Submit ท้ายฟอร์มทีเดียว — debounce กันยิงรัวๆ ระหว่างขีดหลาย
      // จังหวะ (เว้นจังหวะปากกา) ของลายเซ็นเดียวกัน รอ 1.2 วิหลังขีดจังหวะสุดท้ายค่อยอัปโหลดจริง
      clearTimeout(uploadDebounceTimer);
      if (dataUrl) {
        // debounce เดียวกันนี้ยังใช้เป็นจังหวะเลื่อนจอไป Station ถัดไปด้วย (รอเซ็นนิ่งก่อนค่อยเลื่อน
        // กันจอกระโดดหนีระหว่าง user ยังขีดๆ ลบๆ ลายเซ็นอยู่)
        uploadDebounceTimer = setTimeout(function () {
          self.backgroundUploadSignature(s.itemIds[0], dataUrl);
          self.scrollToNextStep(wrap);
        }, 1200);
      }
    }

    function captureSignature() {
      if (typeof canvasIsBlank === 'function' && canvasIsBlank(canvas)) return;
      const cropped = typeof cropCanvas === 'function' ? cropCanvas(canvas) : canvas;
      applyToStation(cropped.toDataURL('image/png'));
    }
    canvas.addEventListener('mouseup', captureSignature);
    canvas.addEventListener('touchend', captureSignature);
    // touchcancel เกิดได้เมื่อ OS/เบราว์เซอร์ตัดจังหวะการลากนิ้วกลางคัน (เช่น ปัดหน้าจอ, สลับแอป) —
    // ถ้าไม่ดักไว้ด้วย ลายเซ็นที่ขีดค้างอยู่บน canvas จะไม่ถูกบันทึกเข้า answers เลย แม้จะเห็นเส้นบนจอ
    canvas.addEventListener('touchcancel', captureSignature);
    // mouseleave: initSignaturePad (fill.html) หยุดวาดทันทีที่เมาส์ออกนอกกรอบ canvas (เส้นขาดที่ขอบ
    // เหมือนในภาพที่ user ส่งมา) แต่ browser จะไม่ยิง mouseup ให้ canvas อีกเพราะปล่อยปุ่มนอกกรอบไปแล้ว
    // ถ้าไม่ดัก mouseleave ไว้ด้วย ลายเซ็นที่ลากออกนอกกรอบจะติดอยู่บนจอเฉยๆ ไม่ถูกบันทึกเข้า answers เลย
    // ทั้งที่ user เห็นลายเซ็นครบแล้วบนหน้าจอ — ระบบเลยแจ้ง "ยังไม่ได้เซ็น" ทั้งที่เซ็นไปแล้วจริงๆ
    canvas.addEventListener('mouseleave', captureSignature);

    clearBtn.addEventListener('click', function () { applyToStation(''); });
  },

  // อัปโหลดลายเซ็น Station หนึ่งขึ้น Drive แบบเงียบๆ เบื้องหลัง (ไม่ block การกรอกฟอร์มต่อ) — เรียกจาก
  // initStationSignature หลัง debounce ยังไม่มี record_id ตอนนี้ (record สร้างตอน submit เท่านั้น)
  // จึงส่ง client_uuid (สร้างไว้ตั้งแต่เปิดฟอร์ม) ไปแทน ฝั่งเซิร์ฟเวอร์เก็บไว้ในโฟลเดอร์ชั่วคราว
  // สำเร็จแล้วแทนที่ base64 ในคำตอบด้วย "drive:<fileId>" ทันที — พอกด Submit จริง
  // uploadInlineImagesDeep_ จะข้ามรูปกลุ่มนี้ไปเลย (ไม่ใช่ data:image ซ้ำ) เหลืองานตอน submit
  // แค่ลายเซ็น Station ล่าสุดที่เพิ่งเซ็น (ยังไม่ทันอัปโหลดเบื้องหลังเสร็จ) เท่านั้น
  backgroundUploadSignature(itemId, dataUrl) {
    const self = this;
    const ctx = this.context;
    API.post('uploadSignature', {
      client_uuid: this.clientUuid,
      tag: itemId + '_sign',
      line: ctx.header.line || (this.template.lines && this.template.lines[0]) || '',
      date: ctx.header.date || '',
      data_url: dataUrl
    }).then(function (res) {
      const ans = self.getAnswer(itemId);
      // เช็คว่า user ยังไม่เซ็นทับใหม่/กดล้างระหว่างรออัปโหลด (ans.recorder เปลี่ยนไปแล้วจาก dataUrl
      // ที่ส่งไป) ถ้าเปลี่ยนแล้วห้ามเอาผลอัปโหลดเก่ามาทับค่าใหม่ล่าสุด
      if (res && res.success && ans.recorder === dataUrl) {
        ans.recorder = res.ref;
        self.saveDraft();
      }
    }).catch(function () { /* เงียบๆ ไม่ต้องแจ้ง user — ถ้าอัปโหลดเบื้องหลังไม่สำเร็จ ตอน submit จริง
      ก็ยังอัปโหลดจากค่า base64 เดิมได้ตามปกติ (fallback เดิมไม่เปลี่ยน) */ });
  },

  // อัปโหลดรูปที่เพิ่งถ่ายแนบขึ้น Drive แบบเงียบๆ เบื้องหลัง (เหมือน backgroundUploadSignature) — อ้างอิง
  // photoObj โดยตรง (ไม่ใช้ index) เพราะ user อาจลบรูปอื่นในลิสต์เดียวกันระหว่างรออัปโหลด ทำให้ index
  // เลื่อนได้ — เช็ค list.indexOf(photoObj) ก่อนแก้ กันกรณีรูปนี้เองถูกลบไปแล้วตอนอัปโหลดเสร็จ
  backgroundUploadPhoto(itemId, photoObj) {
    const self = this;
    const ctx = this.context;
    if (!photoObj.base64) return;
    const base64 = photoObj.base64;
    // เก็บ promise ไว้ใน _bgPhotoUploads เพื่อให้ submit() รอให้ settle ก่อนตัดสินใจว่ารูปไหนไป
    // pendingPhotos (อัปโหลดเสร็จแล้ว) หรือไป uploads (ยังมี base64) — ถ้าไม่รอ จะเกิด race: รูปที่
    // อัปโหลดเบื้องหลังเสร็จ "ระหว่าง" createRecord กำลัง await จะตกหล่นทั้งสองทาง (ตอนสร้าง
    // pendingPhotos ยังไม่ pending, พอ createRecord เสร็จ base64 ถูกลบไปแล้วเลยไม่เข้า uploads) →
    // รูปหายทั้งที่แนบแล้ว (นี่คือบั๊กที่รูป Carton Label/รูปสุดท้ายหลุดบ่อย)
    const p = API.post('uploadPhotoPending', {
      client_uuid: this.clientUuid,
      item_id: itemId,
      line: ctx.header.line || (this.template.lines && this.template.lines[0]) || '',
      date: ctx.header.date || '',
      base64: base64
    }).then(function (res) {
      const list = self.photos[itemId] || [];
      if (list.indexOf(photoObj) === -1 || photoObj.base64 !== base64) return;
      if (res && res.success) {
        delete photoObj.base64;
        photoObj.fileId = res.fileId;
        photoObj.fileName = res.fileName;
        photoObj.pending = true; // ต่างจากรูปที่ copy มาจาก record เดิมตอน resubmit (ไม่มี flag นี้)
        self.saveDraft();
      }
    }).catch(function () { /* เงียบๆ — เหลือ base64 ไว้ อัปโหลดจริงตอน submit ตามปกติ */ });
    this._bgPhotoUploads.push(p);
    // เอา promise ออกจากลิสต์เมื่อจบ (ใช้ then สองอาร์กิวเมนต์แทน .finally เพื่อรองรับ WebView เก่า)
    const cleanup = function () {
      const i = self._bgPhotoUploads.indexOf(p);
      if (i >= 0) self._bgPhotoUploads.splice(i, 1);
    };
    p.then(cleanup, cleanup);
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

    // way_select (เลือกรุ่น — multi-select toggle: กดเลือก กดซ้ำยกเลิก ไม่บังคับต้องเลือก)
    if (extra.way_select) {
      const selectedWays = waySelectedList(ans);
      html += '<div class="way-group" data-role="way">';
      extra.way_select.forEach(function (w) {
        html += '<button type="button" class="btn-way' + (selectedWays.indexOf(w) > -1 ? ' selected' : '') + '" data-way="' + escAttr(w) + '">' + esc(w) + '</button>';
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
          // NOK/REJ บนข้อ critical → บังคับ Recovery Plan ทันที (ห้ามเลื่อนหนีไปก่อน user จะกรอก
          // Recovery Plan ไม่เห็น modal ที่เพิ่งเด้งขึ้นมา)
          if (item.critical && (ans.value === 'NOK' || ans.value === 'REJ')) {
            self.openRecoveryModal(item);
          } else {
            self.scrollToNextStep(el);
          }
        });
      });
    }

    // way_select — toggle เลือกได้หลายอัน กดซ้ำยกเลิก
    const wayGroup = el.querySelector('[data-role="way"]');
    if (wayGroup) {
      wayGroup.querySelectorAll('.btn-way').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const ans = self.getAnswer(item.item_id);
          const ways = waySelectedList(ans).slice();
          const w = btn.dataset.way;
          const idx = ways.indexOf(w);
          if (idx > -1) { ways.splice(idx, 1); btn.classList.remove('selected'); }
          else { ways.push(w); btn.classList.add('selected'); }
          ans.ways = ways;
          delete ans.way; // เลิกใช้ฟิลด์เดิม (single-select) — ย้ายไปเก็บเป็น array ทั้งหมด
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
          // อัปโหลดรูปนี้ขึ้น Drive เบื้องหลังทันที เหมือนลายเซ็น Station — ไม่ต้องรอไปอัปโหลดตอน
          // submit ท้ายฟอร์ม (ฟอร์มที่มีหลายช่องแนบรูปเดิมต้องรออัปโหลดหลายรูปติดกันตอนกด Submit)
          self.backgroundUploadPhoto(item.item_id, shot);
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
    const self = this;
    this.template.sections.forEach(function (s) { self.sectionItems(s).forEach(function (i) { items.push(i); }); });
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

  // เลื่อนจอไปข้อ/ช่องเซ็นถัดไปอัตโนมัติ หลังตอบ Acc/Rej หรือเซ็นชื่อ Station เสร็จ — กันต้อง
  // เลื่อนมือทีละข้อในฟอร์มยาวๆ (20+ Station) ใช้ index ใน list รวม item-card + station-sig-block
  // ทั้งหน้า (ไม่ใช่ nextElementSibling ตรงๆ) กัน edge case ข้าม section ว่าง/section ไม่มีลายเซ็น
  scrollToNextStep(fromEl) {
    const steps = Array.from(document.querySelectorAll('.item-card, .station-sig-block'));
    const idx = steps.indexOf(fromEl);
    const next = idx >= 0 && idx + 1 < steps.length ? steps[idx + 1] : null;
    if (next) {
      next.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // ถึงข้อ/ลายเซ็นสุดท้ายแล้ว — เลื่อนไปหาปุ่ม Submit แทน
      const submitBar = document.querySelector('.submit-bar');
      if (submitBar) submitBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
    (this.stationSections || []).forEach(function (s) {
      const ans = self.getAnswer(s.itemIds[0]);
      if (!ans.recorder) errors.push('กรุณาเซ็นชื่อผู้บันทึก (Recorder) ให้ ' + s.title);
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
      document.querySelectorAll('.highlight-missing').forEach(function (el) { el.classList.remove('highlight-missing'); });
      // เลื่อนไปข้อแรกที่ยังไม่ตอบ
      const firstMissing = this.allItems().find(function (i) { return !FormRender.isItemAnswered(i); });
      if (firstMissing) {
        const el = document.querySelector('[data-item-id="' + firstMissing.item_id + '"]');
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-missing'); }
      } else {
        // ไม่มีข้อคำถามค้าง แต่ยังขาดลายเซ็น Recorder ของบาง Station — เลื่อนไปช่องเซ็นที่ขาดจริงๆ
        // (ไม่ใช่แค่บอกชื่อ Station ทาง toast อย่างเดียว ซึ่งหาเจอยากในฟอร์มที่มีหลาย Station)
        const firstMissingSection = (this.stationSections || []).find(function (s) { return !FormRender.getAnswer(s.itemIds[0]).recorder; });
        if (firstMissingSection) {
          const el = document.querySelector('[data-station-key="' + firstMissingSection.key + '"]');
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-missing'); }
        }
      }
      return;
    }

    // ฟอร์มที่มี Recorder ต่อ Station (เซ็นแล้วในแต่ละ section ตอนกรอก) ไม่ต้องเซ็นซ้ำที่ปุ่มเซ็นรวมท้ายฟอร์มอีก
    const usesStationSignatures = this.stationSections && this.stationSections.length > 0;
    const canvas = document.getElementById('signature-canvas');
    if (!usesStationSignatures && canvas) {
      const isBlank = typeof canvasIsBlank !== 'undefined'
        ? canvasIsBlank(canvas)
        : (canvas.toDataURL() === document.createElement('canvas').toDataURL());
      if (isBlank) {
        showToast('กรุณาเซ็นชื่อผู้ตรวจสอบก่อนส่ง', 'error');
        return;
      }
      this.answers._operator_sign = cropCanvas(canvas).toDataURL('image/png');
    } else if (usesStationSignatures) {
      // ฟอร์มที่เซ็น Recorder แยกท้าย Station แล้ว — เอาลายเซ็นของ Station สุดท้ายมาใช้เป็น
      // ลายเซ็น Production Operator ในตารางสรุปท้ายเอกสารด้วย (ไม่บังคับเซ็นซ้ำอีกรอบ)
      const lastSection = this.stationSections[this.stationSections.length - 1];
      const lastAns = this.getAnswer(lastSection.itemIds[0]);
      if (lastAns.recorder) this.answers._operator_sign = lastAns.recorder;
    }

    const t = this.template;
    const ctx = this.context;
    // โหมด log-sheet: บันทึกเวลาของ entry (คอลัมน์ "เวลา/Time" บนกระดาษ)
    if (t.mode === 'log-sheet' && !this.answers._entry) {
      this.answers._entry = { time: new Date().toTimeString().slice(0, 5) };
    }
    // สำคัญ: รอรูปที่กำลังอัปโหลดเบื้องหลังทั้งหมดให้ settle ก่อน แล้วค่อยแยกรูปไป pendingPhotos/uploads
    // ทุกรูปจะอยู่ในสถานะนิ่ง (มี base64 = ยังไม่อัปโหลด/อัปโหลดล้มเหลว, หรือ pending+fileId = อัปโหลด
    // เสร็จแล้ว) อย่างใดอย่างหนึ่งแน่นอน ไม่มีรูปที่ค้างกลางทางจนตกหล่นทั้งสองทางระหว่าง createRecord
    // await อีก (ดูรายละเอียดบั๊กใน backgroundUploadPhoto) — _bgPhotoUploads แต่ละตัว catch ไว้แล้ว
    // จึงไม่ reject, Promise.all ปลอดภัย (ใช้แทน allSettled เพื่อรองรับ WebView เก่า)
    if (this._bgPhotoUploads.length) {
      Loading.show('กำลังอัปโหลดรูปที่เหลือ...');
      try { await Promise.all(this._bgPhotoUploads.slice()); } catch (e) { /* ไม่ reject อยู่แล้ว */ }
    }

    // รูปที่อัปโหลดเบื้องหลังไปล่วงหน้าแล้วระหว่างกรอก (มี .pending — ต่างจากรูปที่ copy มาจาก record
    // เดิมตอน resubmit ซึ่งไม่มี flag นี้ ป้องกันส่งซ้ำไปผูกกับ record ใหม่ 2 รอบ) — ส่งไปให้
    // createRecord ผูกเข้ากับ record ที่เพิ่งสร้างตรงๆ ไม่ต้องอัปโหลดซ้ำผ่าน uploadPhoto อีกรอบ
    const pendingPhotos = {};
    Object.keys(this.photos).forEach(function (itemId) {
      (FormRender.photos[itemId] || []).forEach(function (p) {
        if (p.pending && p.fileId) {
          pendingPhotos[itemId] = pendingPhotos[itemId] || [];
          pendingPhotos[itemId].push({ fileId: p.fileId, fileName: p.fileName || '' });
        }
      });
    });

    Loading.show('กำลังบันทึกข้อมูล...');
    try {
      // 1) สร้าง record — client_uuid กัน record ซ้ำเมื่อ submit ซ้ำ, doctype_id ใช้เดิน workflow ฝั่ง server
      const res = await API.post('createRecord', {
        form_id: t.form_id,
        template_rev: t.template_rev,
        mode: t.mode,
        doctype_id: ctx.doctype_id || '',
        client_uuid: this.clientUuid,
        line: ctx.header.line || (t.lines && t.lines[0]) || '',
        station: ctx.station || '',
        product_model: ctx.header.product_model || '',
        date: ctx.header.date || '',
        shift: ctx.header.shift || '',
        answers: this.answers,
        has_nok: this.hasNok(),
        recovery: this.recovery,
        copy_from_record_id: this.resubmitOf || '',
        pending_photos: pendingPhotos
      });
      const recordId = res.record_id;

      // 2) อัปโหลดรูป — คำขอแรกอัปโหลดเดี่ยวๆ ก่อน (กันสร้างโฟลเดอร์ Drive ซ้ำซ้อนตอนแข่งกัน
      // สร้างโฟลเดอร์ของ record นี้ครั้งแรก) จากนั้นที่เหลือยิงพร้อมกันเป็นชุด (concurrency 3)
      // แทนที่จะรอทีละรูป — ฟอร์มที่มีหลายช่องแนบรูปจะไม่ต้องรอ N รอบ round-trip ต่อกันยาวๆ
      const uploads = [];
      const photos = this.photos;
      const uploadLine = ctx.header.line || (t.lines && t.lines[0]) || '';
      Object.keys(photos).forEach(function (itemId) {
        (photos[itemId] || []).forEach(function (p, idx) {
          if (p.base64) uploads.push({ item_id: itemId, index: idx, base64: p.base64 });
        });
      });
      // ชื่อรูปไว้ใช้ขึ้น error message ให้ user รู้ว่าจุดไหนหลุด (แทน "บันทึกไม่สำเร็จ" เฉยๆ ซึ่ง
      // หาสาเหตุไม่ได้ว่ารูปไหนของ Station ไหน)
      const itemLabelById = {};
      this.allItems().forEach(function (i) {
        itemLabelById[i.item_id] = (i.photo && i.photo.label) || i.text_th || i.item_id;
      });
      // retry ต่อรูป: ตอนอัปโหลดพร้อมกันหลายรูป (concurrency 3) มีโอกาสชน lock ของ GAS
      // (actionUploadPhoto ล็อกแถว record เดียวกันตอนเขียน photos_json กลับ) แล้วได้ error ที่ไม่ใช่
      // network error ธรรมดา (เช่น lock timeout) ซึ่ง API._fetchWithRetry ไม่ retry ให้อัตโนมัติ —
      // ถ้าไม่ retry ซ้ำตรงนี้ด้วย รูปนั้นจะหลุดเงียบๆ ทั้งที่ record หลักสร้างสำเร็จไปแล้ว
      // (บั๊กที่ user เจอ: แนบรูปแล้วแต่ไม่ขึ้นตอนพิมพ์)
      const doUpload = async function (u, attempt) {
        attempt = attempt || 1;
        try {
          return await API.post('uploadPhoto', {
            record_id: recordId,
            item_id: u.item_id,
            line: uploadLine,
            base64: u.base64
          });
        } catch (err) {
          if (attempt < 3) {
            await new Promise(function (r) { setTimeout(r, 800 * attempt); });
            return doUpload(u, attempt + 1);
          }
          throw new Error('อัปโหลดรูป "' + (itemLabelById[u.item_id] || u.item_id) + '" ไม่สำเร็จ: ' + err.message);
        }
      };
      if (uploads.length) {
        let done = 0;
        const total = uploads.length;
        const showProgress = function () {
          Loading.show('กำลังอัปโหลดรูป ' + done + '/' + total + '...');
        };
        showProgress();
        await doUpload(uploads[0]);
        done++;
        showProgress();
        const rest = uploads.slice(1);
        const CONCURRENCY = 3;
        for (let i = 0; i < rest.length; i += CONCURRENCY) {
          const batch = rest.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(function (u) {
            return doUpload(u).then(function () { done++; showProgress(); });
          }));
        }
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
// สร้าง UUID สำหรับ idempotency (ใช้ crypto ถ้ามี, ไม่มีก็ fallback สุ่มเอง)
function genClientUuid() {
  try {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fallback ด้านล่าง */ }
  return 'cu-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

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
