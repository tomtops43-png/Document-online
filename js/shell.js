// ========================================================
// shell.js — App Shell ที่ใช้ร่วมกันทุกหน้าหลังล็อกอิน
// = Sidebar (ซ้าย) + Topbar (บน: ชื่อหน้า + กระดิ่งแจ้งเตือน + Drawer)
// เรียก AppShell.init('home' | 'dashboard' | 'search' | 'records' | 'admin' | 'users', 'ชื่อหน้า')
// หลัง Auth.requireLogin() สำเร็จ — ไม่ต้องเขียนโครงซ้ำทุกหน้า
// ========================================================

const AppShell = {
  // เมนูหลัก — เพิ่มเมนูใหม่ในอนาคตแค่เพิ่ม object ในลิสต์นี้ที่เดียว
  NAV_ITEMS: [
    { key: 'home', href: 'home.html', icon: '📊', label: 'Dashboard' },
    { key: 'dashboard', href: 'dashboard.html', icon: '🏭', label: 'Document Center' },
    { key: 'search', href: 'search.html', icon: '🔍', label: 'ค้นหา' },
    { key: 'records', href: 'records.html', icon: '📋', label: 'บันทึก / อนุมัติ' }
  ],
  NAV_ITEMS_ADMIN: [
    { key: 'admin', href: 'admin.html', icon: '⚙️', label: 'จัดการเอกสาร Master', roles: ['Admin', 'DocControl'] },
    { key: 'users', href: 'users.html', icon: '👥', label: 'จัดการผู้ใช้งาน', roles: ['Admin'] }
  ],
  PAGE_TITLES: {
    home: 'Dashboard', dashboard: 'Document Center', search: 'ค้นหา',
    records: 'บันทึก / อนุมัติ', admin: 'จัดการเอกสาร Master', users: 'จัดการผู้ใช้งาน'
  },

  _notifLoaded: false,

  init(activeKey, pageTitle) {
    const user = Auth.currentUser();
    document.body.classList.add('has-shell');

    // ---------- Sidebar ----------
    const nav = document.createElement('nav');
    nav.className = 'app-sidebar';

    let itemsHtml = '';
    this.NAV_ITEMS.forEach((item) => { itemsHtml += this._renderLink(item, activeKey); });

    const adminItems = this.NAV_ITEMS_ADMIN.filter((item) => {
      if (!user) return false;
      return user.role === 'Admin' || item.roles.indexOf(user.role) >= 0;
    });
    let adminHtml = '';
    if (adminItems.length) {
      adminHtml = '<div class="sidebar-section-label">ผู้ดูแลระบบ</div>';
      adminItems.forEach((item) => { adminHtml += this._renderLink(item, activeKey); });
    }

    const initials = user ? user.name.trim().slice(0, 1).toUpperCase() : '?';

    nav.innerHTML =
      '<a href="home.html" class="sidebar-brand">' +
      '<span class="logo">🏭</span><span class="brand-text">ENC QMS</span></a>' +
      '<div class="sidebar-nav">' + itemsHtml + adminHtml + '</div>' +
      '<div class="sidebar-footer">' +
      '<div class="sidebar-user">' +
      '<div class="avatar">' + esc(initials) + '</div>' +
      '<div class="who"><div class="name">' + esc(user ? user.name : '') + '</div>' +
      '<div class="role">' + esc(user ? user.role : '') + '</div></div>' +
      '</div>' +
      '<button type="button" class="sidebar-refresh" onclick="AppShell.refreshMaster()" title="ใช้เมื่อแก้ข้อมูลในชีท ENC-MASTER โดยตรงแล้วหน้าเว็บยังไม่อัปเดตตาม">' +
      '🔄 <span class="label">รีเฟรชข้อมูล Master</span></button>' +
      '<button type="button" class="sidebar-logout" onclick="Auth.logoutAndRedirect()">⏻ <span class="label">ออกจากระบบ</span></button>' +
      '</div>';

    document.body.insertBefore(nav, document.body.firstChild);

    // ---------- Topbar (ชื่อหน้า + กระดิ่งแจ้งเตือน) ----------
    const topbar = document.createElement('header');
    topbar.className = 'app-topbar';
    const title = pageTitle || this.PAGE_TITLES[activeKey] || 'ENC QMS';
    topbar.innerHTML =
      '<div class="topbar-title">' + esc(title) + '</div>' +
      '<div class="topbar-actions">' +
      '<button type="button" class="notif-bell" id="notif-bell" title="การแจ้งเตือน">🔔' +
      '<span class="notif-dot" id="notif-dot"></span></button>' +
      '</div>';
    document.body.insertBefore(topbar, nav.nextSibling);

    // ---------- Notification Drawer ----------
    const backdrop = document.createElement('div');
    backdrop.className = 'notif-backdrop';
    backdrop.id = 'notif-backdrop';
    const drawer = document.createElement('aside');
    drawer.className = 'notif-drawer';
    drawer.id = 'notif-drawer';
    drawer.innerHTML =
      '<div class="notif-head"><h3>🔔 การแจ้งเตือน</h3>' +
      '<button type="button" class="btn-small" id="notif-mark-read">อ่านแล้วทั้งหมด</button></div>' +
      '<div class="notif-list" id="notif-list"><div class="notif-empty">กำลังโหลด...</div></div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    document.getElementById('notif-bell').addEventListener('click', () => this.toggleDrawer(true));
    backdrop.addEventListener('click', () => this.toggleDrawer(false));
    document.getElementById('notif-mark-read').addEventListener('click', () => this.markAllRead());

    // โหลดจำนวนแจ้งเตือนแบบเงียบๆ (ไม่ block หน้า)
    this.loadNotifications(true);
  },

  _renderLink(item, activeKey) {
    const cls = 'sidebar-link' + (item.key === activeKey ? ' active' : '');
    return '<a class="' + cls + '" href="' + item.href + '">' +
      '<span class="icon">' + item.icon + '</span><span class="label">' + esc(item.label) + '</span></a>';
  },

  // ---------- Notifications ----------
  toggleDrawer(open) {
    document.getElementById('notif-backdrop').classList.toggle('open', open);
    document.getElementById('notif-drawer').classList.toggle('open', open);
    if (open && !this._notifLoaded) this.loadNotifications(false);
  },

  async loadNotifications(quiet) {
    try {
      const res = await API.post('notif.list', {});
      this._notifLoaded = true;
      const dot = document.getElementById('notif-dot');
      if (dot) dot.classList.toggle('on', (res.unread || 0) > 0);
      this.renderNotifList(res.notifications || []);
    } catch (e) {
      if (!quiet) {
        const list = document.getElementById('notif-list');
        if (list) list.innerHTML = '<div class="notif-empty">โหลดการแจ้งเตือนไม่สำเร็จ<br>' + esc(e.message) + '</div>';
      }
    }
  },

  renderNotifList(items) {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="notif-empty">ยังไม่มีการแจ้งเตือน</div>';
      return;
    }
    const ICONS = { nok: '⚠️', rejected: '↩️', approved: '✅', approval: '⏳' };
    list.innerHTML = items.map(function (n) {
      const icon = ICONS[n.event_type] || '🔔';
      const time = String(n.ts || '').replace('T', ' ').slice(5, 16);
      return '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-type="' + esc(n.event_type) + '">' +
        '<div class="n-icon">' + icon + '</div>' +
        '<div class="n-body">' +
        '<div class="n-title">' + esc(n.title) + '</div>' +
        '<div class="n-text">' + esc(n.body) + '</div>' +
        '<div class="n-meta">' + esc(time) +
        (n.personal ? ' <span class="n-personal">ถึงคุณ</span>' : '') +
        (n.link ? ' <a href="' + esc(n.link) + '" style="color:var(--brand-600);font-weight:700">เปิดดู →</a>' : '') +
        '</div></div></div>';
    }).join('');
  },

  async markAllRead() {
    try {
      await API.post('notif.markRead', {});
      const dot = document.getElementById('notif-dot');
      if (dot) dot.classList.remove('on');
      document.querySelectorAll('.notif-item.unread').forEach(function (el) { el.classList.remove('unread'); });
    } catch (e) { showToast('ไม่สำเร็จ: ' + e.message, 'error'); }
  },

  // ล้าง cache ของ Master Data ในเครื่อง แล้วโหลดหน้าใหม่ — ใช้เมื่อแก้ข้อมูลในชีท ENC-MASTER
  // ตรงๆ (ไม่ผ่าน action ของแอป) เพราะกรณีนั้น master_version จะไม่ถูก bump อัตโนมัติ
  // หน้าเว็บจึงยังเห็นข้อมูลเก่าจาก cache ต่อไปเรื่อยๆ จนกว่าจะล้าง cache เอง
  refreshMaster() {
    try { localStorage.removeItem(typeof Master !== 'undefined' ? Master.LS_KEY : 'fp_master_cache'); } catch (e) { /* ข้าม */ }
    location.reload();
  }
};

// เผื่อ esc() ยังไม่ถูกโหลด (หน้าที่ไม่ได้รวม form-render.js)
if (typeof esc === 'undefined') {
  window.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
}
