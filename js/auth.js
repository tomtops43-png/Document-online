// ========================================================
// auth.js — login / token / role guard (เก็บใน localStorage)
// ========================================================

const Auth = {
  // login ด้วยรหัสพนักงาน + PIN → เก็บ token + ข้อมูลผู้ใช้
  async login(employeeId, pin) {
    const data = await API.post('login', { employee_id: employeeId, pin: pin });
    localStorage.setItem(CONFIG.LS_TOKEN, data.token);
    localStorage.setItem(CONFIG.LS_USER, JSON.stringify({
      employee_id: data.employee_id,
      name: data.name,
      role: data.role,
      line: data.line || ''
    }));
    return data;
  },

  logout() {
    localStorage.removeItem(CONFIG.LS_TOKEN);
    localStorage.removeItem(CONFIG.LS_USER);
  },

  logoutAndRedirect() {
    Auth.logout();
    location.href = 'index.html';
  },

  currentUser() {
    try {
      const raw = localStorage.getItem(CONFIG.LS_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  isLoggedIn() {
    return !!localStorage.getItem(CONFIG.LS_TOKEN) && !!Auth.currentUser();
  },

  // เรียกตอนเปิดหน้า — ถ้ายังไม่ login ให้เด้งกลับ index.html
  requireLogin() {
    if (!Auth.isLoggedIn()) {
      location.href = 'index.html';
      return null;
    }
    return Auth.currentUser();
  },

  // ตรวจ role (Admin ทำได้ทุกอย่าง)
  hasRole(roles) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (user.role === 'Admin') return true;
    return roles.indexOf(user.role) >= 0;
  }
};
