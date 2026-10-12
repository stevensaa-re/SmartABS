/* =========================================================
   SMARTABS — Adapter LOCAL (localStorage)
   ---------------------------------------------------------
   Untuk demo / pengembangan tanpa server.
   Mengimplementasikan kontrak API yang sama dengan adapter
   MySQL dan Firebase. PASSWORD DISIMPAN POLOS DI SINI HANYA
   UNTUK DEMO — jangan dipakai untuk data sekolah sungguhan.
   ========================================================= */

const LocalAdapter = (() => {

  const STORAGE_KEYS = {
    users:         'smartabs_users',
    students:      'smartabs_students',
    teachers:      'smartabs_teachers',
    classes:       'smartabs_classes',
    attendance:    'smartabs_attendance',
    schedules:     'smartabs_schedules',
    announcements: 'smartabs_announcements',
    permissions:   'smartabs_permissions',
    seed:          'smartabs_seed_version'
  };

  const SEED_VERSION = '1.1.0';
  const NETWORK_DELAY = 120; // simulasi latency jaringan (ms)

  /* ---------- Helper internal ---------- */

  const delay = (ms = NETWORK_DELAY) => new Promise((resolve) => setTimeout(resolve, ms));

  function readTable(name) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[name]);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error(`Gagal membaca tabel ${name}:`, error);
      return [];
    }
  }

  function writeTable(name, rows) {
    localStorage.setItem(STORAGE_KEYS[name], JSON.stringify(rows));
  }

  function makeId(prefix) {
    return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }

  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  /* ---------- Seed ---------- */

  function seed(force = false) {
    const currentVersion = localStorage.getItem(STORAGE_KEYS.seed);

    if (currentVersion !== SEED_VERSION || force) {
      Object.keys(STORAGE_KEYS).forEach((key) => {
        if (key !== 'seed') localStorage.removeItem(STORAGE_KEYS[key]);
      });

      writeTable('users', MOCK_DATA.users);
      writeTable('students', MOCK_DATA.students);
      writeTable('teachers', MOCK_DATA.teachers);
      writeTable('classes', MOCK_DATA.classes);
      writeTable('schedules', MOCK_DATA.schedules);
      writeTable('announcements', MOCK_DATA.announcements);
      writeTable('permissions', MOCK_DATA.permissions);
      writeTable('attendance', buildAttendanceHistory());

      localStorage.setItem(STORAGE_KEYS.seed, SEED_VERSION);
    }

    ensureTodayAttendance();
  }

  /* Pastikan selalu ada data absensi "hari ini" agar demo tetap hidup */
  function ensureTodayAttendance() {
    const today = todayISO();
    const rows = readTable('attendance');
    if (rows.some((row) => row.date === today)) return;
    writeTable('attendance', rows.concat(buildTodayAttendance(today)));
  }

  /* ---------- Validasi bersama ---------- */

  function requireStudent(nis) {
    const student = readTable('students').find((s) => s.nis === String(nis));
    if (!student) throw new Error('Siswa tidak ditemukan.');
    return student;
  }

  /* =======================================================
     KONTRAK API
     ======================================================= */

  return {

    seed,
    name: 'local',

    /* ---------------- AUTH ---------------- */

    async login(username, password) {
      await delay(500);
      const input = String(username || '').trim().toLowerCase();

      const user = readTable('users').find(
        (item) => item.username.toLowerCase() === input && item.password === password
      );

      if (!user) return { ok: false, message: 'Username atau password salah.' };
      if (user.status !== 'Aktif') {
        return { ok: false, message: 'Akun Anda tidak aktif. Hubungi administrator.' };
      }

      return {
        ok: true,
        user: { id: user.id, name: user.name, username: user.username, role: user.role }
      };
    },

    async logout() { return true; },

    /* ---------------- USERS ---------------- */

    async getUsers() {
      await delay();
      /* Password tidak pernah dikirim ke UI */
      return readTable('users').map(({ password, ...safe }) => safe);
    },

    async createUser(payload) {
      await delay();
      const users = readTable('users');

      if (users.some((u) => u.username.toLowerCase() === String(payload.username).toLowerCase())) {
        throw new Error('Username sudah digunakan.');
      }

      const user = { id: makeId('U'), status: 'Aktif', email: '', ...payload };
      users.push(user);
      writeTable('users', users);

      const { password, ...safe } = user;
      return safe;
    },

    async updateUser(id, payload) {
      await delay();
      const users = readTable('users');
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) throw new Error('Pengguna tidak ditemukan.');

      if (payload.username) {
        const duplikat = users.some(
          (u) => u.id !== id && u.username.toLowerCase() === String(payload.username).toLowerCase()
        );
        if (duplikat) throw new Error('Username sudah digunakan.');
      }

      const next = { ...payload };
      if (!next.password) delete next.password; // kosong = password tidak diubah

      const oldUsername = users[index].username;
      users[index] = { ...users[index], ...next };
      writeTable('users', users);

      /* Jaga relasi guru -> akun bila username berubah */
      if (next.username && next.username !== oldUsername) {
        writeTable('teachers', readTable('teachers').map((t) =>
          t.username === oldUsername ? { ...t, username: next.username } : t));
      }

      const { password, ...safe } = users[index];
      return safe;
    },

    async deleteUser(id) {
      await delay();
      const users = readTable('users');
      const target = users.find((u) => u.id === id);

      writeTable('users', users.filter((u) => u.id !== id));

      /* Lepas tautan di data siswa, hapus profil guru terkait */
      writeTable('students', readTable('students').map((s) => (s.userId === id ? { ...s, userId: '' } : s)));
      if (target) {
        writeTable('teachers', readTable('teachers').filter((t) => t.username !== target.username));
      }
      return true;
    },

    /* ---------------- TEACHERS ---------------- */

    async getTeachers() {
      await delay();
      return readTable('teachers');
    },

    async getTeacherByUsername(username) {
      await delay();
      return readTable('teachers').find((t) => t.username === username) || null;
    },

    async createTeacher(payload) {
      await delay();
      const teachers = readTable('teachers');

      if (teachers.some((t) => t.username === payload.username)) {
        throw new Error('Akun tersebut sudah terdaftar sebagai guru.');
      }

      const item = { id: makeId('G'), subject: '', className: '', status: 'Aktif', ...payload };
      teachers.push(item);
      writeTable('teachers', teachers);
      return item;
    },

    async updateTeacher(id, payload) {
      await delay();
      const teachers = readTable('teachers');
      const index = teachers.findIndex((t) => t.id === id);
      if (index === -1) throw new Error('Guru tidak ditemukan.');

      if (payload.username && teachers.some((t) => t.id !== id && t.username === payload.username)) {
        throw new Error('Akun tersebut sudah terdaftar sebagai guru.');
      }

      teachers[index] = { ...teachers[index], ...payload };
      writeTable('teachers', teachers);
      return teachers[index];
    },

    async deleteTeacher(id) {
      await delay();
      writeTable('teachers', readTable('teachers').filter((t) => t.id !== id));
      return true;
    },

    /* ---------------- STUDENTS ---------------- */

    async getStudents() {
      await delay();
      return readTable('students');
    },

    async getStudentByNis(nis) {
      await delay();
      return readTable('students').find((s) => s.nis === String(nis)) || null;
    },

    async getStudentByUserId(userId) {
      await delay();
      return readTable('students').find((s) => s.userId === userId) || null;
    },

    async createStudent(payload) {
      await delay();
      const students = readTable('students');

      if (students.some((s) => s.nis === String(payload.nis))) {
        throw new Error('NIS sudah terdaftar.');
      }
      if (payload.userId && students.some((s) => s.userId === payload.userId)) {
        throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
      }

      const student = { userId: '', phone: '', gender: 'L', status: 'Aktif', ...payload };
      students.push(student);
      writeTable('students', students);
      return student;
    },

    async updateStudent(nis, payload) {
      await delay();
      const students = readTable('students');
      const index = students.findIndex((s) => s.nis === nis);
      if (index === -1) throw new Error('Siswa tidak ditemukan.');

      if (payload.userId && students.some((s) => s.nis !== nis && s.userId === payload.userId)) {
        throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
      }

      students[index] = { ...students[index], ...payload };
      writeTable('students', students);
      return students[index];
    },

    async deleteStudent(nis) {
      await delay();
      writeTable('students', readTable('students').filter((s) => s.nis !== nis));
      /* Setara ON DELETE CASCADE pada MySQL */
      writeTable('attendance', readTable('attendance').filter((r) => r.studentId !== nis));
      writeTable('permissions', readTable('permissions').filter((p) => p.studentId !== nis));
      return true;
    },

    /* ---------------- CLASSES ---------------- */

    async getClasses() {
      await delay();
      return readTable('classes');
    },

    async createClass(payload) {
      await delay();
      const classes = readTable('classes');

      if (classes.some((c) => c.name.toLowerCase() === String(payload.name).toLowerCase())) {
        throw new Error('Nama kelas sudah digunakan.');
      }

      const item = { id: makeId('K'), capacity: 36, homeroom: '', ...payload };
      classes.push(item);
      writeTable('classes', classes);
      return item;
    },

    async updateClass(id, payload) {
      await delay();
      const classes = readTable('classes');
      const index = classes.findIndex((c) => c.id === id);
      if (index === -1) throw new Error('Kelas tidak ditemukan.');

      const oldName = classes[index].name;
      const newName = payload.name || oldName;

      if (classes.some((c) => c.id !== id && c.name.toLowerCase() === newName.toLowerCase())) {
        throw new Error('Nama kelas sudah digunakan.');
      }

      classes[index] = { ...classes[index], ...payload };
      writeTable('classes', classes);

      /* Rename dirambatkan ke tabel lain (pada MySQL cukup via FK) */
      if (newName !== oldName) {
        ['students', 'schedules', 'teachers', 'attendance', 'permissions'].forEach((table) => {
          writeTable(table, readTable(table).map((row) =>
            row.className === oldName ? { ...row, className: newName } : row));
        });
      }
      return classes[index];
    },

    async deleteClass(id) {
      await delay();
      const classes = readTable('classes');
      const target = classes.find((c) => c.id === id);

      if (target && readTable('students').some((s) => s.className === target.name)) {
        throw new Error('Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu.');
      }

      writeTable('classes', classes.filter((c) => c.id !== id));
      if (target) {
        writeTable('schedules', readTable('schedules').filter((s) => s.className !== target.name));
      }
      return true;
    },

    /* ---------------- SCHEDULES ---------------- */

    async getSchedules() {
      await delay();
      return readTable('schedules');
    },

    async createSchedule(payload) {
      await delay();
      const schedules = readTable('schedules');
      const item = { id: makeId('J'), ...payload };
      schedules.push(item);
      writeTable('schedules', schedules);
      return item;
    },

    async updateSchedule(id, payload) {
      await delay();
      const schedules = readTable('schedules');
      const index = schedules.findIndex((s) => s.id === id);
      if (index === -1) throw new Error('Jadwal tidak ditemukan.');

      schedules[index] = { ...schedules[index], ...payload };
      writeTable('schedules', schedules);
      return schedules[index];
    },

    async deleteSchedule(id) {
      await delay();
      writeTable('schedules', readTable('schedules').filter((s) => s.id !== id));
      return true;
    },

    /* ---------------- ANNOUNCEMENTS ---------------- */

    async getAnnouncements() {
      await delay();
      return readTable('announcements').sort(byDateDesc);
    },

    async createAnnouncement(payload) {
      await delay();
      const list = readTable('announcements');
      const item = { id: makeId('P'), status: 'Publish', ...payload };
      list.push(item);
      writeTable('announcements', list);
      return item;
    },

    async updateAnnouncement(id, payload) {
      await delay();
      const list = readTable('announcements');
      const index = list.findIndex((a) => a.id === id);
      if (index === -1) throw new Error('Pengumuman tidak ditemukan.');

      list[index] = { ...list[index], ...payload };
      writeTable('announcements', list);
      return list[index];
    },

    async deleteAnnouncement(id) {
      await delay();
      writeTable('announcements', readTable('announcements').filter((a) => a.id !== id));
      return true;
    },

    /* ---------------- ATTENDANCE ---------------- */

    /* Rentang tanggal (inklusif) — dipakai dashboard agar tidak memuat seluruh tabel */
    async getAttendanceRange(from, to, className = null) {
      await delay();
      return readTable('attendance').filter((row) =>
        (!from || row.date >= from) &&
        (!to || row.date <= to) &&
        (!className || row.className === className));
    },

    async getAttendanceByDate(date, className = null) {
      await delay();
      return readTable('attendance').filter(
        (row) => row.date === date && (!className || row.className === className)
      );
    },

    async getAttendanceByStudent(nis) {
      await delay();
      return readTable('attendance').filter((row) => row.studentId === String(nis)).sort(byDateDesc);
    },

    async getAttendanceByStudentDate(nis, date) {
      await delay();
      return readTable('attendance').find(
        (row) => row.studentId === String(nis) && row.date === date
      ) || null;
    },

    async getAttendanceForStudentDate(nis, date) {
      await delay();
      return readTable('attendance').filter(
        (row) => row.studentId === String(nis) && row.date === date
      );
    },

    async startAttendanceSession() {
      throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.');
    },
    async rotateAttendanceSession() {
      throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.');
    },
    async closeAttendanceSession() {
      throw new Error('Sesi QR per mata pelajaran memerlukan backend Firebase.');
    },
    async submitQrAttendance() {
      throw new Error('Absensi QR per mata pelajaran memerlukan backend Firebase.');
    },

    /* Simpan absensi (baru atau perbarui jika siswa+tanggal sudah ada) */
    async saveAttendance(payload) {
      await delay();
      const student = requireStudent(payload.studentId);
      const rows = readTable('attendance');
      const index = rows.findIndex(
        (row) => row.studentId === student.nis && row.date === payload.date
      );

      /* Nama & kelas selalu diambil dari data induk siswa */
      const data = {
        ...payload,
        studentId: student.nis,
        name: student.name,
        className: student.className
      };

      if (index >= 0) {
        rows[index] = { ...rows[index], ...data };
        writeTable('attendance', rows);
        return rows[index];
      }

      const record = { id: `A-${data.date}-${student.nis}`, note: '', time: currentTime(), ...data };
      rows.push(record);
      writeTable('attendance', rows);
      return record;
    },

    async deleteAttendance(id) {
      await delay();
      writeTable('attendance', readTable('attendance').filter((row) => row.id !== id));
      return true;
    },

    /* ---------------- PERMISSIONS (Izin/Sakit/Alpa) ---------------- */

    async getPermissions() {
      await delay();
      return readTable('permissions').sort(byDateDesc);
    },

    async getPermissionsByStudent(nis) {
      await delay();
      return readTable('permissions').filter((p) => p.studentId === String(nis)).sort(byDateDesc);
    },

    /* Diajukan siswa. Nama & kelas diambil dari data induk. */
    async createPermission(payload) {
      await delay();
      const student = requireStudent(payload.studentId);
      const list = readTable('permissions');

      const duplikat = list.some((p) =>
        p.studentId === student.nis && p.date === payload.date && p.status === 'Menunggu');
      if (duplikat) throw new Error('Anda sudah mengajukan izin untuk tanggal tersebut.');

      const item = {
        id: makeId('I'),
        studentId: student.nis,
        name: student.name,
        className: student.className,
        date: payload.date,
        type: payload.type,
        note: payload.note || '',
        status: 'Menunggu'
      };

      list.push(item);
      writeTable('permissions', list);
      return item;
    },

    /* Guru menyetujui/menolak, sekaligus menyinkronkan data absensi.
       Disetujui -> status absensi = jenis pengajuan (Izin/Sakit/Alpa)
       Ditolak   -> dicatat Alpa. Catatan "Hadir" tidak pernah ditimpa. */
    async reviewPermission(id, status) {
      await delay();
      if (!['Disetujui', 'Ditolak'].includes(status)) throw new Error('Status tidak valid.');

      const list = readTable('permissions');
      const index = list.findIndex((p) => p.id === id);
      if (index === -1) throw new Error('Pengajuan tidak ditemukan.');

      const item = { ...list[index], status };
      list[index] = item;
      writeTable('permissions', list);

      const rows = readTable('attendance');
      const existing = rows.findIndex((r) => r.studentId === item.studentId && r.date === item.date);

      if (existing < 0 || rows[existing].status !== 'Hadir') {
        const attendanceStatus = status === 'Disetujui' ? item.type : 'Alpa';
        const note = status === 'Disetujui' ? (item.note || item.type) : `Pengajuan ditolak${item.note ? `: ${item.note}` : ''}`;
        const record = {
          studentId: item.studentId, name: item.name, className: item.className,
          date: item.date, time: '-', status: attendanceStatus, note
        };

        if (existing >= 0) rows[existing] = { ...rows[existing], ...record };
        else rows.push({ id: `A-${item.date}-${item.studentId}`, ...record });

        writeTable('attendance', rows);
      }

      return item;
    },

    /* ---------------- REPORTS ---------------- */

    async getReport({ from, to, className, status } = {}) {
      await delay();

      const students = readTable('students').filter(
        (s) => s.status === 'Aktif' && (!className || s.className === className)
      );

      const attendance = readTable('attendance').filter((row) => {
        if (from && row.date < from) return false;
        if (to && row.date > to) return false;
        if (className && row.className !== className) return false;
        if (status && row.status !== status) return false;
        return true;
      });

      return buildReport(students, attendance);
    },

    /* ---------------- UTIL ---------------- */

    async resetDatabase() {
      seed(true);
      return true;
    }
  };
})();

/* Inisialisasi data demo hanya bila backend = local */
if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.BACKEND === 'local') {
  LocalAdapter.seed();
}
