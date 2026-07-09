// ========================================================
// shell.js — Sidebar navigation ที่ใช้ร่วมกันทุกหน้าหลังล็อกอิน
// เรียก AppShell.init('dashboard' | 'search' | 'records' | 'admin')
// หลัง Auth.requireLogin() สำเร็จ — ไม่ต้องเขียนโครง sidebar ซ้ำทุกหน้า
// ========================================================

const AppShell = {
  // เมนูหลัก — เพิ่มเมนูใหม่ในอนาคตแค่เพิ่ม object ในลิสต์นี้ที่เดียว
  NAV_ITEMS: [
    { key: 'dashboard', href: 'dashboard.html', icon: '🏭', label: 'Document Center' },
    { key: 'search', href: 'search.html', icon: '🔍', label: 'ค้นหา' },
    { key: 'records', href: 'records.html', icon: '📋', label: 'บันทึก / อนุมัติ' }
  ],
  NAV_ITEMS_ADMIN: [
    { key: 'admin', href: 'admin.html', icon: '⚙️', label: 'จัดการเอกสาร Master', roles: ['Admin', 'DocControl'] }
  ],

  init(activeKey) {
    const user = Auth.currentUser();
    document.body.classList.add('has-shell');

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
      '<a href="dashboard.html" class="sidebar-brand">' +
      '<span class="logo">🏭</span><span class="brand-text">ENC QMS</span></a>' +
      '<div class="sidebar-nav">' + itemsHtml + adminHtml + '</div>' +
      '<div class="sidebar-footer">' +
      '<div class="sidebar-user">' +
      '<div class="avatar">' + esc(initials) + '</div>' +
      '<div class="who"><div class="name">' + esc(user ? user.name : '') + '</div>' +
      '<div class="role">' + esc(user ? user.role : '') + '</div></div>' +
      '</div>' +
      '<button type="button" class="sidebar-logout" onclick="Auth.logoutAndRedirect()">⏻ <span class="label">ออกจากระบบ</span></button>' +
      '</div>';

    document.body.insertBefore(nav, document.body.firstChild);
  },

  _renderLink(item, activeKey) {
    const cls = 'sidebar-link' + (item.key === activeKey ? ' active' : '');
    return '<a class="' + cls + '" href="' + item.href + '">' +
      '<span class="icon">' + item.icon + '</span><span class="label">' + esc(item.label) + '</span></a>';
  }
};

// เผื่อ esc() ยังไม่ถูกโหลด (หน้าที่ไม่ได้รวม form-render.js)
if (typeof esc === 'undefined') {
  window.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
}
