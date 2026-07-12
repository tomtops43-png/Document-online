// ========================================================
// print-render.js — เติมข้อมูล record ลงหน้า print (A4)
// โหมด single-record: ?record_id=FP-...
// โหมด log-sheet:     ?form=ok-1st-part-nlc&station=5&date=2026-07-08
// ========================================================

// helpers (สำเนาจาก form-render.js — หน้า print ไม่ได้โหลดไฟล์นั้น)
if (typeof esc === 'undefined') {
  window.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  window.escAttr = function (s) {
    return esc(s).replace(/"/g, '&quot;');
  };
}
// ans.recorder อาจเป็นลายเซ็น (data:image ฝังตรงๆ ของเก่า, หรือ "drive:<fileId>" ของใหม่) หรือชื่อ
// (ข้อความ — จากบันทึกเก่าก่อนเปลี่ยนเป็นลายเซ็น)
function recorderCellHtml(recorder) {
  if (typeof recorder === 'string' && isSignatureImage(recorder)) {
    return '<img src="' + signatureImgSrc(recorder) + '" class="sig-img-inline" alt="signature">';
  }
  return esc(recorder || '');
}

const PrintRender = {

  async init() {
    const params = new URLSearchParams(location.search);
    const recordId = params.get('record_id');
    const formId = params.get('form');

    try {
      if (recordId) {
        Loading.show('กำลังโหลดข้อมูล...');
        const res = await API.get('getRecord', { record_id: recordId });
        const record = res.record;
        const template = await PrintRender.smartLoadTemplate(record.form_id);
        this.loadPrintCss(template);
        if (template.mode === 'log-sheet') {
          // record เดี่ยวของ log-sheet → ดึงทั้งแผ่นของ station+date เดียวกัน
          const sheet = await API.get('getLogSheet', {
            form_id: record.form_id, station: record.station, date: record.date
          });
          this.renderLogSheet(template, record.station, record.date, sheet.records, sheet.recovery || []);
        } else {
          this.renderSingleRecord(template, record, res.recovery || []);
        }
      } else if (formId) {
        const station = params.get('station');
        const date = params.get('date');
        const template = await PrintRender.smartLoadTemplate(formId);
        this.loadPrintCss(template);
        if (template.mode === 'log-sheet') {
          Loading.show('กำลังโหลดข้อมูล...');
          const sheet = await API.get('getLogSheet', {
            form_id: formId, station: station, date: date, shift: params.get('shift') || ''
          });
          this.renderLogSheet(template, station, date, sheet.records, sheet.recovery || []);
        } else {
          // ฟอร์มเปล่า (ไม่มีข้อมูล) สำหรับพิมพ์แจกกระดาษ
          this.renderSingleRecord(template, null, []);
        }
      } else {
        document.getElementById('print-root').textContent = 'ไม่พบพารามิเตอร์ record_id หรือ form';
      }
    } catch (err) {
      document.getElementById('print-root').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
    } finally {
      Loading.hide();
    }
  },

  // หา template จาก form_id (ระบบเดิม) / doc_id (ระบบใหม่) / ค้นจาก Master
  async smartLoadTemplate(id) {
    try {
      return await loadTemplate(id); // CONFIG.FORMS (ระบบเดิม)
    } catch (e) { /* ลองทางอื่นต่อ */ }
    if (typeof Master !== 'undefined') {
      await Master.load();
      // id เป็น doc_id ของทะเบียนเอกสาร?
      const doc = Master.document(id);
      if (doc) {
        const rev = Master.currentRevision(doc.doc_id);
        if (rev && /\.json$/.test(String(rev.content_ref))) {
          return loadTemplate(null, rev.content_ref);
        }
      }
      // id เป็น form_id ของ template ที่ลงทะเบียนใน Master
      const path = await Master.resolveTemplate(id);
      return loadTemplate(null, path);
    }
    throw new Error('ไม่พบฟอร์ม: ' + id);
  },

  // โหลด print CSS ตามที่ template ระบุ (แต่ละฟอร์มมี layout ของตัวเอง)
  loadPrintCss(template) {
    if (template.print_css) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = template.print_css;
      document.head.appendChild(link);
    }
    // Inject signature styling
    const style = document.createElement('style');
    style.innerHTML = '.sig-img-inline { max-height: 8mm; max-width: 100%; display: block; margin: 0 auto; }';
    document.head.appendChild(style);
  },

  // ====================================================
  // โหมด single-record (NMS First Piece) — 1 record = 1 ชุด
  // ====================================================
  renderSingleRecord(template, record, recovery) {
    const root = document.getElementById('print-root');
    const answers = record ? (typeof record.answers_json === 'string' ? JSON.parse(record.answers_json || '{}') : record.answers_json || {}) : {};
    const photos = record ? (typeof record.photos_json === 'string' ? JSON.parse(record.photos_json || '{}') : record.photos_json || {}) : {};

    let html = '<div class="sheet sheet-nms">';

    // ---- หัวเอกสาร: โลโก้ + ชื่อฟอร์ม + เลขเอกสาร ----
    html += '<div class="nms-head">' +
      '<div class="nms-logo"><img src="assets/jhr-logo.jpg" alt="JHR"></div>' +
      '<div class="nms-title">' + esc(template.title_th) + '</div>' +
      '<div class="nms-docno">' + esc(template.doc_no) + '</div>' +
      '</div>';

    // ---- แถว header fields ----
    html += '<table class="nms-header-table"><tr>';
    (template.header_fields || []).forEach(function (f) {
      const v = record ? (record[f.key] || '') : '';
      html += '<td><span class="hlabel">' + esc(f.label) + ' :</span> <span class="hvalue">' + esc(v) + '</span></td>';
    });
    html += '</tr></table>';

    // ---- ตารางหลัก: Process | Inspection Point | Decision | Recorder | Time ----
    html += '<table class="nms-main">' +
      '<colgroup><col class="c-process"><col class="c-point"><col class="c-acc"><col class="c-rej"><col class="c-recorder"><col class="c-time"></colgroup>' +
      '<thead><tr>' +
      '<th>Process</th><th>Inspection Point</th><th colspan="2">Decision</th><th>Recorder</th><th>Time</th>' +
      '</tr></thead><tbody>';

    template.sections.forEach(function (section) {
      section.items.forEach(function (item, idx) {
        const ans = answers[item.item_id] || {};
        html += '<tr class="item-row">';
        if (idx === 0) {
          html += '<td class="cell-process" rowspan="' + section.items.length + '">' + esc(section.title) + '</td>';
        }
        // Inspection point + extras
        let pointHtml = esc(item.text_th);
        const extra = item.options_extra || {};
        if (extra.way_select) {
          const selectedWays = waySelectedList(ans);
          pointHtml += '<div class="way-line">';
          extra.way_select.forEach(function (w) {
            const on = selectedWays.indexOf(w) > -1;
            pointHtml += '<span class="way-opt"><span class="tickbox">' + (on ? '✓' : '&nbsp;') + '</span>' + esc(w) + '</span>';
          });
          pointHtml += '</div>';
        }
        if (extra.texts) {
          pointHtml += '<div class="text-line">';
          extra.texts.forEach(function (tf) {
            const v = (ans.texts && ans.texts[tf.key]) || '';
            pointHtml += '<span class="text-fill">' + esc(tf.label) + ': <span class="fill-value">' + esc(v) + '</span></span>';
          });
          pointHtml += '</div>';
        }
        if (extra.checkboxes) {
          pointHtml += '<div class="text-line">';
          extra.checkboxes.forEach(function (cb) {
            const on = ans.checks && ans.checks[cb];
            pointHtml += '<span class="way-opt"><span class="tickbox">' + (on ? '✓' : '&nbsp;') + '</span>' + esc(cb) + '</span>';
          });
          pointHtml += '</div>';
        }
        if (item.answer_type === 'torque_value') {
          // หน้างานจริงแค่ติ๊ก Acc/Rej เหมือนข้ออื่นๆ ไม่ได้พิมพ์ค่าที่วัดได้จริง — โชว์ spec ไว้อ้างอิงเฉยๆ
          const spec = item.torque_spec || {};
          pointHtml += ' <span class="torque-spec-print">Spec: ' + esc(spec.display || (spec.min + '-' + spec.max + ' ' + (spec.unit || ''))) + '</span>';
        }
        if (item.note_th) pointHtml += '<div class="note-line">' + esc(item.note_th) + '</div>';
        html += '<td class="cell-point">' + pointHtml + '</td>';

        // Decision Acc/Rej
        const decision = ans.value;
        html += '<td class="cell-acc">Acc <span class="tickbox">' + (decision === 'ACC' ? '✓' : '&nbsp;') + '</span></td>';
        html += '<td class="cell-rej">Rej <span class="tickbox">' + (decision === 'REJ' ? '✓' : '&nbsp;') + '</span></td>';
        html += '<td class="cell-recorder">' + recorderCellHtml(ans.recorder) + '</td>';
        html += '<td class="cell-time">' + esc(ans.time || '') + '</td>';
        html += '</tr>';
      });
    });
    html += '</tbody></table>';

    // ---- กรอบแปะฉลาก/รูปถ่าย (ตำแหน่งเดิมของช่องแปะฉลากบนกระดาษ) ----
    (template.photo_boxes || []).forEach(function (box) {
      const ans = answers[box.item_id] || {};
      const list = photos[box.item_id] || [];
      html += '<div class="photo-section">' +
        '<div class="photo-section-head">' + esc(box.station_label) +
        ' <span class="ps-role">Production Operator</span>' +
        ' <span class="ps-name">Recorder: ' + recorderCellHtml(ans.recorder) + '</span></div>' +
        '<div class="photo-frame">';
      if (list.length) {
        list.forEach(function (p) {
          html += '<img class="photo-img" src="' + escAttr(drivePhotoUrl(p.fileId, 1200)) + '" alt="">';
        });
      } else {
        html += '<span class="photo-placeholder">' + esc(box.box_label) + '</span>';
      }
      html += '</div></div>';
    });

    // ---- ลายเซ็น 3 ระดับ ----
    html += '<div class="sign-title">ลงชื่อผู้ตรวจสอบความถูกต้อง</div>';
    html += '<table class="sign-table">';
    (template.signatures || []).forEach(function (sig) {
      const name = record ? (record[sig.key + '_name'] || '') : '';
      const ts = record ? (record[sig.key + '_ts'] || '') : '';
      const dateStr = ts ? String(ts).slice(0, 10) : '';
      let signHtml = '';
      if (record && answers['_' + sig.key + '_sign']) {
        signHtml = '<img src="' + signatureImgSrc(answers['_' + sig.key + '_sign']) + '" class="sig-img-inline" style="max-height:10mm; display:inline-block; vertical-align:middle; margin-left:10px;">';
      }
      html += '<tr><td class="sig-role">' + esc(sig.label) + '</td>' +
        '<td class="sig-name">Name: <span class="fill-value">' + esc(name) + '</span>' + signHtml + '</td>' +
        '<td class="sig-date">Date: <span class="fill-value">' + esc(dateStr) + '</span></td></tr>';
    });
    html += '</table>';

    html += '</div>'; // .sheet
    root.innerHTML = html;
  },

  // ====================================================
  // โหมด log-sheet (OK 1st Part) — รวมทุก entry ของ station+date เป็นแผ่นเดียว
  // ====================================================
  renderLogSheet(template, station, date, records, recoveryRows) {
    const root = document.getElementById('print-root');
    const excl = (template.station_item_exclusions && template.station_item_exclusions[String(station || '')]) || [];
    const items = template.sections[0].items.filter(function (i) { return excl.indexOf(i.item_id) === -1; });
    const mainItems = items.filter(function (i) { return i.no !== 'LP'; });
    const lpItem = items.find(function (i) { return i.no === 'LP'; });
    const TOTAL_ROWS = 18; // จำนวนแถว entry ต่อแผ่น (แถวว่างพิมพ์เป็นช่องเปล่า)
    const RECOVERY_ROWS = 5;

    let html = '<div class="sheet sheet-ok1st">';

    // ---- หัวเอกสาร ----
    html += '<div class="ok-title">' + esc(template.title_th) + '</div>';
    html += '<div class="ok-lineinfo"><span>Line : <b>' + esc((template.lines || [''])[0]) + '</b></span>' +
      '<span>Station : <b>' + esc(String(station || '')) + '</b></span>' +
      '<span>Date : <b>' + esc(date || '') + '</b></span></div>';

    // ---- ตารางหลัก ----
    html += '<table class="ok-main"><thead>';
    // แถวความถี่
    html += '<tr class="freq-row"><th class="h-ref" rowspan="3">Product reference</th>' +
      '<th class="h-date" rowspan="3">วันที่<br>Date</th><th class="h-time" rowspan="3">เวลา<br>Time</th>';
    mainItems.forEach(function (i) {
      html += '<th class="h-freq">' + esc(i.frequency_th) + '</th>';
    });
    html += '<th class="h-sum" rowspan="2" colspan="2">สรุปผลการตรวจสอบ<br>(OK/NOK)</th>';
    html += '<th class="h-freq">' + esc(lpItem ? lpItem.frequency_th : '') + '</th></tr>';
    // แถวเลขข้อ
    html += '<tr class="no-row">';
    mainItems.forEach(function (i) {
      html += '<th>' + esc(i.no) + (i.critical ? '*' : '') + '</th>';
    });
    html += '<th>' + (lpItem && lpItem.critical ? '*' : '') + '</th></tr>';
    // แถวรายละเอียดข้อ (ตัวหนังสือแนวตั้งเหมือนต้นฉบับ)
    html += '<tr class="desc-row">';
    mainItems.forEach(function (i) {
      html += '<th class="h-desc"><div class="vtext"><b>' + esc(i.text_th) + '</b><br>' + (i.sub_th || []).map(esc).join('<br>') + '</div></th>';
    });
    html += '<th class="h-desc h-sign"><div class="vtext">ลงชื่อผู้ตรวจสอบ</div></th>' +
      '<th class="h-desc h-sign"><div class="vtext">หัวหน้างานยืนยัน</div></th>' +
      '<th class="h-desc"><div class="vtext"><b>' + esc(lpItem ? lpItem.text_th : '') + '</b><br>' + (lpItem ? (lpItem.sub_th || []).map(esc).join('<br>') : '') + '</div></th></tr>';
    html += '</thead><tbody>';

    // แถว entry — records จริงก่อน แล้วเติมแถวว่างจนครบ TOTAL_ROWS
    for (let r = 0; r < Math.max(TOTAL_ROWS, records.length); r++) {
      const rec = records[r];
      const ans = rec ? (typeof rec.answers_json === 'string' ? JSON.parse(rec.answers_json || '{}') : rec.answers_json || {}) : {};
      html += '<tr class="entry-row">';
      html += '<td>' + esc(rec ? rec.product_model : '') + '</td>';
      html += '<td>' + esc(rec ? rec.date : '') + '</td>';
      html += '<td>' + esc(rec && ans._entry ? ans._entry.time || '' : '') + '</td>';
      mainItems.forEach(function (i) {
        html += '<td class="c-mark">' + PrintRender.markPO(ans[i.item_id]) + '</td>';
      });
      // สรุปผล: ลงชื่อผู้ตรวจสอบ / หัวหน้างานยืนยัน
      let opSign = esc(rec ? (rec.operator_name || '') : '');
      if (rec && ans._operator_sign) {
        opSign = '<img src="' + signatureImgSrc(ans._operator_sign) + '" class="sig-img-inline">';
      }
      let ldSign = esc(rec && rec.leader_name && (rec.status === 'COMPLETED' || rec.status === 'PENDING_QI') ? rec.leader_name : '');
      if (rec && ans._leader_sign && (rec.status === 'COMPLETED' || rec.status === 'PENDING_QI')) {
        ldSign = '<img src="' + signatureImgSrc(ans._leader_sign) + '" class="sig-img-inline">';
      }
      html += '<td class="c-sign">' + opSign + '</td>';
      html += '<td class="c-sign">' + ldSign + '</td>';
      html += '<td class="c-mark">' + PrintRender.markPO(ans[lpItem ? lpItem.item_id : '']) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    // ---- Recovery plan ----
    html += '<div class="ok-recovery-title">Ok 1st Part Workstation recovery plan</div>';
    html += '<table class="ok-recovery"><thead><tr>' +
      '<th class="r-ref">Product reference</th><th class="r-date">วันที่<br>Date</th><th class="r-time">เวลา<br>Time</th>' +
      '<th class="r-item">รายการตรวจสอบ</th><th class="r-problem">ปัญหา / PROBLEM</th>' +
      '<th class="r-counter">การแก้ไข / COUNTERMEASURE</th><th class="r-op">ลงชื่อพนักงาน</th>' +
      '<th class="r-leader">ลงชื่อ Leader</th><th class="r-decision">ผลการตัดสินใจ</th></tr></thead><tbody>';
    for (let r = 0; r < Math.max(RECOVERY_ROWS, recoveryRows.length); r++) {
      const rv = recoveryRows[r];
      const rec = rv ? records.find(function (x) { return x.record_id === rv.record_id; }) : null;
      const itemDef = rv ? items.find(function (i) { return i.item_id === rv.item_id; }) : null;
      const ansEntry = rec ? (typeof rec.answers_json === 'string' ? JSON.parse(rec.answers_json || '{}') : rec.answers_json || {}) : {};
      html += '<tr>' +
        '<td>' + esc(rec ? rec.product_model : '') + '</td>' +
        '<td>' + esc(rec ? rec.date : '') + '</td>' +
        '<td>' + esc(rec && ansEntry._entry ? ansEntry._entry.time || '' : '') + '</td>' +
        '<td>' + esc(itemDef ? (itemDef.no + '. ' + itemDef.text_th) : '') + '</td>' +
        '<td>' + esc(rv ? rv.problem : '') + '</td>' +
        '<td>' + esc(rv ? rv.countermeasure : '') + '</td>' +
        '<td>' + esc(rv ? rv.operator_sign || '' : '') + '</td>' +
        '<td>' + esc(rv ? rv.leader_sign || '' : '') + '</td>' +
        '<td>' + esc(rv ? rv.decision || '' : '') + '</td></tr>';
    }
    html += '</tbody></table>';

    // ---- Footer กติกา + เลขเอกสาร ----
    html += '<div class="ok-footer">';
    (template.footer_notes || []).forEach(function (n) {
      html += '<div class="ok-note">' + esc(n) + '</div>';
    });
    html += '<div class="ok-docno">' + esc(template.doc_no) + '</div>';
    html += '</div>';

    html += '</div>'; // .sheet
    root.innerHTML = html;
  },

  // แปลงคำตอบเป็นเครื่องหมายบนกระดาษ: OK → ✓, NOK → O, NA → n/a
  markPO(ans) {
    if (!ans || !ans.value) return '&nbsp;';
    if (ans.value === 'OK' || ans.value === 'ACC') return '✓';
    if (ans.value === 'NOK' || ans.value === 'REJ') return 'O';
    if (ans.value === 'NA') return 'n/a';
    return esc(ans.value);
  }
};
