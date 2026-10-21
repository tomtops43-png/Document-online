// ========================================================
// api.js — wrapper เรียก GAS Web App
// สำคัญ: POST ต้องส่งเป็น text/plain เพื่อเลี่ยง CORS preflight
// (GAS ไม่ตอบ OPTIONS) — ฝั่ง GAS อ่านจาก e.postData.contents
// ========================================================

const API = {
  // GET: ส่ง action + params เป็น query string
  // เลี่ยง browser cache เด็ดขาด — ถ้า action เดิม+params เดิมถูกเรียกซ้ำ (เช่น โหลดลิสต์ใหม่
  // หลัง approve เสร็จ) query string จะเหมือนเดิมทุกตัวอักษร บาง browser/WebView จะคืนค่าที่
  // cache ไว้แทนที่จะยิงเน็ตจริง ทำให้เห็นสถานะเก่าค้างอยู่ทั้งที่เซิร์ฟเวอร์อัปเดตแล้ว
  async get(action, params) {
    const url = new URL(CONFIG.GAS_URL);
    url.searchParams.set('action', action);
    const token = localStorage.getItem(CONFIG.LS_TOKEN);
    if (token) url.searchParams.set('token', token);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        url.searchParams.set(k, params[k]);
      }
    });
    url.searchParams.set('_', Date.now().toString(36));
    return API._fetchWithRetry(url.toString(), { method: 'GET', cache: 'no-store' });
  },

  // POST: body เป็น JSON string แต่ Content-Type เป็น text/plain (เลี่ยง preflight)
  async post(action, payload) {
    const body = Object.assign({}, payload || {});
    body.action = action;
    const token = localStorage.getItem(CONFIG.LS_TOKEN);
    if (token && !body.token) body.token = token;
    return API._fetchWithRetry(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  },

  // fetch + retry 3 ครั้ง (exponential backoff) + แปลง JSON + โยน error ถ้า success=false
  async _fetchWithRetry(url, options, maxRetry) {
    maxRetry = maxRetry === undefined ? 3 : maxRetry;
    let lastErr;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && data.success === false) {
          // error จาก backend — ไม่ retry (เป็น error ทาง logic ไม่ใช่ network)
          if (data.error === 'INVALID_TOKEN') {
            // พาไปหน้า login ให้เลย — ไม่งั้นผู้ใช้ค้างอยู่หน้าเดิมแล้วกดอะไรก็ error ซ้ำๆ หาทางออกไม่เจอ
            // (ข้อมูลที่กรอกค้างอยู่ถูก saveDraft ลง localStorage ตลอด กลับมากรอกต่อได้หลัง login ใหม่)
            Auth.logout();
            if (!/index\.html$/.test(location.pathname)) {
              setTimeout(function () { location.href = 'index.html'; }, 1800);
            }
            throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
          }
          throw new Error(data.error || 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
        }
        return data;
      } catch (err) {
        lastErr = err;
        // retry เฉพาะ network error / HTTP error
        const msg = String(err && err.message || '');
        const isNetwork = err instanceof TypeError || msg.indexOf('HTTP ') === 0 || msg.indexOf('Failed to fetch') >= 0;
        if (!isNetwork || attempt === maxRetry) throw err;
        await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
      }
    }
    throw lastErr;
  }
};

// ---------- UI helper: loading overlay ----------
const Loading = {
  show(text) {
    let el = document.getElementById('loading-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading-overlay';
      el.innerHTML = '<div class="loading-box"><div class="spinner"></div><div id="loading-text"></div></div>';
      document.body.appendChild(el);
    }
    document.getElementById('loading-text').textContent = text || 'กำลังโหลด...';
    el.style.display = 'flex';
  },
  hide() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
  }
};

// ---------- UI helper: toast แจ้งเตือน ----------
function showToast(message, type) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'info');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(function () { el.classList.add('show'); }, 10);
  setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 300);
  }, 3500);
}
