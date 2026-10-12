/* =========================================================
   SMARTABS — Adapter MYSQL (klien REST API)
   ---------------------------------------------------------
   Browser TIDAK pernah terhubung langsung ke MySQL. Semua
   permintaan dikirim ke server Node.js (folder /server) yang
   memvalidasi token JWT, memeriksa hak akses per role, lalu
   menjalankan query ke MySQL.
   ========================================================= */

const MysqlAdapter = (() => {

  const baseUrl = () => String(APP_CONFIG.MYSQL.API_URL).replace(/\/$/, '');

  const enc = encodeURIComponent;

  function query(params) {
    const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return clean.length ? `?${new URLSearchParams(clean).toString()}` : '';
  }

  function loginPath() {
    return /\/(admin|guru|siswa)\//.test(window.location.pathname) ? '../login.html' : 'login.html';
  }

  async function request(method, path, body, { auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };

    if (auth) {
      const session = Session.get();
      if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
    }

    let response;
    try {
      response = await fetch(baseUrl() + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw new Error('Tidak dapat terhubung ke server. Pastikan server API sudah berjalan.');
    }

    const data = await response.json().catch(() => null);

    /* Token kedaluwarsa / tidak valid -> paksa login ulang */
    if (response.status === 401 && auth) {
      Session.clear();
      window.location.replace(loginPath());
      throw new Error('Sesi berakhir. Silakan login kembali.');
    }

    if (!response.ok) {
      throw new Error((data && data.message) || `Permintaan gagal (${response.status}).`);
    }

    return data;
  }

  const get  = (path)        => request('GET', path);
  const post = (path, body)  => request('POST', path, body);
  const put  = (path, body)  => request('PUT', path, body);
  const del  = (path)        => request('DELETE', path);

  return {

    name: 'mysql',

    /* ---------------- AUTH ---------------- */

    async login(username, password) {
      let response;
      try {
        response = await fetch(`${baseUrl()}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
      } catch (error) {
        return { ok: false, message: 'Tidak dapat terhubung ke server. Pastikan server API sudah berjalan.' };
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        return { ok: false, message: (data && data.message) || 'Username atau password salah.' };
      }
      return { ok: true, user: data.user, token: data.token };
    },

    async logout() { return true; },

    /* ---------------- USERS ---------------- */

    getUsers:   ()            => get('/users'),
    createUser: (payload)     => post('/users', payload),
    updateUser: (id, payload) => put(`/users/${enc(id)}`, payload),
    deleteUser: (id)          => del(`/users/${enc(id)}`).then(() => true),

    /* ---------------- TEACHERS ---------------- */

    getTeachers:          ()            => get('/teachers'),
    getTeacherByUsername: (username)    => get(`/teachers/by-username/${enc(username)}`),
    createTeacher:        (payload)     => post('/teachers', payload),
    updateTeacher:        (id, payload) => put(`/teachers/${enc(id)}`, payload),
    deleteTeacher:        (id)          => del(`/teachers/${enc(id)}`).then(() => true),

    /* ---------------- STUDENTS ---------------- */

    getStudents:        ()             => get('/students'),
    getStudentByNis:    (nis)          => get(`/students/${enc(nis)}`),
    getStudentByUserId: (userId)       => get(`/students/by-user/${enc(userId)}`),
    createStudent:      (payload)      => post('/students', payload),
    updateStudent:      (nis, payload) => put(`/students/${enc(nis)}`, payload),
    deleteStudent:      (nis)          => del(`/students/${enc(nis)}`).then(() => true),

    /* ---------------- CLASSES ---------------- */

    getClasses:  ()            => get('/classes'),
    createClass: (payload)     => post('/classes', payload),
    updateClass: (id, payload) => put(`/classes/${enc(id)}`, payload),
    deleteClass: (id)          => del(`/classes/${enc(id)}`).then(() => true),

    /* ---------------- SCHEDULES ---------------- */

    getSchedules:   ()            => get('/schedules'),
    createSchedule: (payload)     => post('/schedules', payload),
    updateSchedule: (id, payload) => put(`/schedules/${enc(id)}`, payload),
    deleteSchedule: (id)          => del(`/schedules/${enc(id)}`).then(() => true),

    /* ---------------- ANNOUNCEMENTS ---------------- */

    getAnnouncements:   ()            => get('/announcements'),
    createAnnouncement: (payload)     => post('/announcements', payload),
    updateAnnouncement: (id, payload) => put(`/announcements/${enc(id)}`, payload),
    deleteAnnouncement: (id)          => del(`/announcements/${enc(id)}`).then(() => true),

    /* ---------------- ATTENDANCE ---------------- */

    getAttendanceRange:         (from, to, className = null) => get(`/attendance${query({ from, to, className })}`),
    getAttendanceByDate:        (date, className = null)     => get(`/attendance/date/${enc(date)}${query({ className })}`),
    getAttendanceByStudent:     (nis)                        => get(`/attendance/student/${enc(nis)}`),
    getAttendanceByStudentDate: (nis, date)                  => get(`/attendance/student/${enc(nis)}/date/${enc(date)}`),
    getAttendanceForStudentDate: async (nis, date) => {
      return get(`/attendance/student/${enc(nis)}/date/${enc(date)}/all`);
    },
    saveAttendance:             (payload)                    => post('/attendance', payload),
    deleteAttendance:           (id)                         => del(`/attendance/${enc(id)}`).then(() => true),
    startAttendanceSession:     async () => { throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.'); },
    getActiveAttendanceSession: async () => { throw new Error('Pemulihan sesi QR memerlukan backend Firebase.'); },
    rotateAttendanceSession:    async () => { throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.'); },
    closeAttendanceSession:     async () => { throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.'); },
    submitQrAttendance:         async () => { throw new Error('Absensi QR per mata pelajaran memerlukan backend Firebase.'); },

    /* ---------------- PERMISSIONS ---------------- */

    getPermissions:          ()              => get('/permissions'),
    getPermissionsByStudent: (nis)           => get(`/permissions/student/${enc(nis)}`),
    createPermission:        (payload)       => post('/permissions', payload),
    reviewPermission:        (id, status)    => post(`/permissions/${enc(id)}/review`, { status }),

    /* ---------------- REPORTS ---------------- */

    getReport: ({ from, to, className, subject, status } = {}) =>
      get(`/reports${query({ from, to, className, subject, status })}`),

    async resetDatabase() {
      throw new Error('Reset database hanya tersedia pada mode local.');
    }
  };
})();
