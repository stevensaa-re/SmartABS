/* =========================================================
   SMARTABS — Adapter FIREBASE (Authentication + Firestore)
   ---------------------------------------------------------
   SDK Firebase dimuat otomatis hanya saat BACKEND = 'firebase'.

   Struktur koleksi Firestore:
     users/{uid}              name, username, usernameLower, role, status, email, nis?
     teachers/{autoId}        name, username, subject, className, status
     students/{nis}           name, className, gender, status, userId, phone
     classes/{autoId}         name, level, major, homeroom, capacity
     schedules/{autoId}       day, start, end, subject, teacher, className
     announcements/{autoId}   title, content, date, status
     attendance/{date_nis}    studentId, name, className, date, time, status, note
     permissions/{autoId}     studentId, name, className, date, type, note, status

   Hak akses ditegakkan oleh database/firebase/firestore.rules,
   bukan oleh kode di browser.
   ========================================================= */

const FirebaseAdapter = (() => {

  const SDK_VERSION = '10.12.2';
  const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;

  let db = null;
  let auth = null;
  let initPromise = null;

  /* ---------- Pemuatan SDK ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Gagal memuat Firebase SDK. Periksa koneksi internet.'));
      document.head.appendChild(script);
    });
  }

  function loginPath() {
    return /\/(admin|guru|siswa)\//.test(window.location.pathname) ? '../login.html' : 'login.html';
  }

  function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (!APP_CONFIG.FIREBASE.apiKey || !APP_CONFIG.FIREBASE.projectId) {
        throw new Error('Konfigurasi Firebase belum diisi. Lengkapi APP_CONFIG.FIREBASE di js/config.js.');
      }

      await loadScript(`${SDK_BASE}firebase-app-compat.js`);
      await Promise.all([
        loadScript(`${SDK_BASE}firebase-auth-compat.js`),
        loadScript(`${SDK_BASE}firebase-firestore-compat.js`)
      ]);

      if (!firebase.apps.length) firebase.initializeApp(APP_CONFIG.FIREBASE);
      auth = firebase.auth();
      db = firebase.firestore();

      /* Tunggu Firebase memulihkan sesi login sebelum query pertama,
         jika tidak, query akan dikirim tanpa autentikasi dan ditolak. */
      await new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged(() => { unsubscribe(); resolve(); });
      });

      /* Sesi aplikasi masih ada tetapi sesi Firebase hilang -> login ulang */
      const onLoginPage = !!document.getElementById('loginForm');
      if (!auth.currentUser && Session.get() && !onLoginPage) {
        Session.clear();
        window.location.replace(loginPath());
      }
    })();

    /* Bila gagal, izinkan percobaan ulang pada pemanggilan berikutnya */
    initPromise.catch(() => { initPromise = null; });
    return initPromise;
  }

  /* ---------- Helper ---------- */

  const fromDoc = (doc) => ({ id: doc.id, ...doc.data() });
  const fromSnap = (snap) => snap.docs.map(fromDoc);
  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const col = (name) => db.collection(name);

  /* Jalankan fungsi dengan init + terjemahan pesan error */
  async function run(fn) {
    await init();
    try {
      return await fn();
    } catch (error) {
      if (error && error.code === 'permission-denied') {
        throw new Error('Anda tidak memiliki izin untuk melakukan aksi ini.');
      }
      if (error && error.code === 'unavailable') {
        throw new Error('Tidak dapat terhubung ke Firebase. Periksa koneksi internet.');
      }
      throw error;
    }
  }

  /* Firestore membatasi 500 operasi per batch */
  async function commitInChunks(operations) {
    for (let i = 0; i < operations.length; i += 400) {
      const batch = db.batch();
      operations.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  async function getStudentDoc(nis) {
    const snap = await col('students').doc(String(nis)).get();
    if (!snap.exists) throw new Error('Siswa tidak ditemukan.');
    return { nis: snap.id, ...snap.data() };
  }

  async function assignedClassName() {
    const session = Session.get();
    if (!session || !['guru', 'siswa'].includes(session.role)) return '';
    const profile = await col('users').doc(session.id).get();
    if (!profile.exists) return '';
    if (session.role === 'guru') return String(profile.data().className || '');
    const nis = String(profile.data().nis || session.nis || '');
    if (!nis) return '';
    const student = await col('students').doc(nis).get();
    return student.exists ? String(student.data().className || '') : '';
  }

  const loginEmail = (username) =>
    `${String(username).trim().toLowerCase()}@${APP_CONFIG.FIREBASE_LOGIN_DOMAIN}`;

  /* Instance Firebase kedua, khusus untuk membuat akun baru tanpa
     mengeluarkan admin yang sedang login. */
  function secondaryAuth() {
    let app = firebase.apps.find((item) => item.name === 'smartabs-secondary');
    if (!app) app = firebase.initializeApp(APP_CONFIG.FIREBASE, 'smartabs-secondary');
    return app.auth();
  }

  const AUTH_FAIL_CODES = [
    'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential',
    'auth/invalid-login-credentials', 'auth/invalid-email'
  ];

  /* =======================================================
     KONTRAK API
     ======================================================= */

  return {

    name: 'firebase',

    /* ---------------- AUTH ---------------- */

    async login(username, password) {
      await init();

      let credential;
      try {
        credential = await auth.signInWithEmailAndPassword(loginEmail(username), password);
      } catch (error) {
        if (AUTH_FAIL_CODES.includes(error.code)) return { ok: false, message: 'Username atau password salah.' };
        if (error.code === 'auth/too-many-requests') {
          return { ok: false, message: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };
        }
        if (error.code === 'auth/network-request-failed') {
          return { ok: false, message: 'Tidak dapat terhubung ke Firebase. Periksa koneksi internet.' };
        }
        throw error;
      }

      const snap = await col('users').doc(credential.user.uid).get();

      if (!snap.exists) {
        await auth.signOut();
        return { ok: false, message: 'Akun belum terdaftar pada sistem. Hubungi administrator.' };
      }

      const profile = snap.data();
      if (profile.status !== 'Aktif') {
        await auth.signOut();
        return { ok: false, message: 'Akun Anda tidak aktif. Hubungi administrator.' };
      }

      return {
        ok: true,
        user: { id: snap.id, name: profile.name, username: profile.username, role: profile.role }
      };
    },

    async logout() {
      try { await init(); await auth.signOut(); } catch (error) { /* abaikan */ }
      return true;
    },

    /* ---------------- USERS ---------------- */

    getUsers: () => run(async () => fromSnap(await col('users').get())),

    createUser: (payload) => run(async () => {
      const username = String(payload.username).trim();
      const usernameLower = username.toLowerCase();

      const exists = await col('users').where('usernameLower', '==', usernameLower).limit(1).get();
      if (!exists.empty) throw new Error('Username sudah digunakan.');

      const sAuth = secondaryAuth();
      let credential;
      try {
        credential = await sAuth.createUserWithEmailAndPassword(loginEmail(username), payload.password);
      } catch (error) {
        if (error.code === 'auth/email-already-in-use') throw new Error('Username sudah digunakan.');
        if (error.code === 'auth/weak-password') throw new Error('Password terlalu lemah (minimal 6 karakter).');
        throw error;
      }
      await sAuth.signOut();

      const profile = {
        name: payload.name,
        username,
        usernameLower,
        role: payload.role,
        status: payload.status || 'Aktif',
        email: payload.email || ''
      };

      await col('users').doc(credential.user.uid).set(profile);
      return { id: credential.user.uid, ...profile };
    }),

    updateUser: (id, payload) => run(async () => {
      const ref = col('users').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Pengguna tidak ditemukan.');

      const current = snap.data();

      if (payload.username && payload.username.trim().toLowerCase() !== current.usernameLower) {
        throw new Error('Username tidak dapat diubah pada mode Firebase (username terhubung ke akun login).');
      }
      if (payload.password) {
        throw new Error('Password pengguna lain diubah lewat Firebase Console atau Cloud Function. Kosongkan kolom password.');
      }

      const changes = {
        name: payload.name ?? current.name,
        role: payload.role ?? current.role,
        status: payload.status ?? current.status,
        email: payload.email ?? current.email
      };

      await ref.update(changes);
      return { id, ...current, ...changes };
    }),

    /* Catatan: menghapus akun login di Firebase Auth membutuhkan Admin SDK /
       Cloud Function. Di sini hanya profil Firestore yang dihapus, sehingga
       akun tersebut tidak dapat masuk lagi ke aplikasi. */
    deleteUser: (id) => run(async () => {
      const ref = col('users').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;
      const { username } = snap.data();

      const [students, teachers] = await Promise.all([
        col('students').where('userId', '==', id).get(),
        col('teachers').where('username', '==', username).get()
      ]);

      const ops = [(batch) => batch.delete(ref)];
      students.docs.forEach((doc) => ops.push((batch) => batch.update(doc.ref, { userId: '' })));
      teachers.docs.forEach((doc) => ops.push((batch) => batch.delete(doc.ref)));

      await commitInChunks(ops);
      return true;
    }),

    /* ---------------- TEACHERS ---------------- */

    getTeachers: () => run(async () => {
      const session = Session.get();
      const ref = session && session.role === 'guru'
        ? col('teachers').where('username', '==', session.username)
        : col('teachers');
      return fromSnap(await ref.get());
    }),

    getTeacherByUsername: (username) => run(async () => {
      const snap = await col('teachers').where('username', '==', username).limit(1).get();
      return snap.empty ? null : fromDoc(snap.docs[0]);
    }),

    createTeacher: (payload) => run(async () => {
      const exists = await col('teachers').where('username', '==', payload.username).limit(1).get();
      if (!exists.empty) throw new Error('Akun tersebut sudah terdaftar sebagai guru.');

      const data = { subject: '', className: '', status: 'Aktif', ...payload };
      const users = await col('users').where('usernameLower', '==', String(data.username).toLowerCase()).limit(1).get();
      if (users.empty || users.docs[0].data().role !== 'guru') {
        throw new Error('Pilih akun guru yang valid sebelum membuat profil guru.');
      }
      const ref = col('teachers').doc();
      const batch = db.batch();
      batch.set(ref, data);
      batch.update(users.docs[0].ref, { className: data.className });
      await batch.commit();
      return { id: ref.id, ...data };
    }),

    updateTeacher: (id, payload) => run(async () => {
      const ref = col('teachers').doc(id);
      const current = await ref.get();
      if (!current.exists) throw new Error('Data guru tidak ditemukan.');
      if (payload.username && payload.username !== current.data().username) {
        throw new Error('Akun guru tidak dapat diganti dari formulir ini.');
      }
      if (payload.username) {
        const dup = await col('teachers').where('username', '==', payload.username).get();
        if (dup.docs.some((doc) => doc.id !== id)) throw new Error('Akun tersebut sudah terdaftar sebagai guru.');
      }
      const users = await col('users').where('usernameLower', '==', String(current.data().username).toLowerCase()).limit(1).get();
      const batch = db.batch();
      batch.update(ref, payload);
      if (!users.empty && payload.className !== undefined) {
        batch.update(users.docs[0].ref, { className: payload.className });
      }
      await batch.commit();
      return fromDoc(await ref.get());
    }),

    deleteTeacher: (id) => run(async () => {
      const ref = col('teachers').doc(id);
      const teacher = await ref.get();
      if (!teacher.exists) return true;
      const users = await col('users').where('usernameLower', '==', String(teacher.data().username).toLowerCase()).limit(1).get();
      const batch = db.batch();
      batch.delete(ref);
      if (!users.empty) batch.update(users.docs[0].ref, { className: '' });
      await batch.commit();
      return true;
    }),

    /* ---------------- STUDENTS ---------------- */

    getStudents: () => run(async () => {
      const className = await assignedClassName();
      const session = Session.get();
      let ref = col('students');
      if (session && session.role === 'guru') {
        if (!className) return [];
        ref = ref.where('className', '==', className);
      }
      return fromSnap(await ref.get()).map(({ id, ...student }) => ({ nis: id, ...student }));
    }),

    getStudentByNis: (nis) => run(async () => {
      const snap = await col('students').doc(String(nis)).get();
      return snap.exists ? { nis: snap.id, ...snap.data() } : null;
    }),

    getStudentByUserId: (userId) => run(async () => {
      /* Siswa tidak boleh menjalankan query berdasarkan userId (rules membatasi lewat NIS),
         jadi NIS dibaca dari profil akunnya lalu dokumen siswa diambil langsung. */
      const profile = await col('users').doc(userId).get();
      if (profile.exists && profile.data().nis) {
        const direct = await col('students').doc(profile.data().nis).get();
        return direct.exists ? { nis: direct.id, ...direct.data() } : null;
      }

      const snap = await col('students').where('userId', '==', userId).limit(1).get();
      if (snap.empty) return null;
      return { nis: snap.docs[0].id, ...snap.docs[0].data() };
    }),

    createStudent: (payload) => run(async () => {
      const nis = String(payload.nis);
      const ref = col('students').doc(nis);

      if ((await ref.get()).exists) throw new Error('NIS sudah terdaftar.');

      if (payload.userId) {
        const linked = await col('students').where('userId', '==', payload.userId).limit(1).get();
        if (!linked.empty) throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
      }

      const { nis: _ignore, ...rest } = payload;
      const data = { userId: '', phone: '', gender: 'L', status: 'Aktif', ...rest };
      await ref.set(data);

      /* Simpan NIS pada profil akun agar rules bisa membatasi data milik siswa */
      if (data.userId) await col('users').doc(data.userId).update({ nis });

      return { nis, ...data };
    }),

    updateStudent: (nis, payload) => run(async () => {
      const ref = col('students').doc(String(nis));
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Siswa tidak ditemukan.');

      const current = snap.data();
      const { nis: _ignore, ...rest } = payload;

      if (rest.userId && rest.userId !== current.userId) {
        const linked = await col('students').where('userId', '==', rest.userId).limit(1).get();
        if (!linked.empty) throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
      }

      await ref.update(rest);

      if (rest.userId !== undefined && rest.userId !== current.userId) {
        if (current.userId) {
          await col('users').doc(current.userId).update({ nis: firebase.firestore.FieldValue.delete() }).catch(() => {});
        }
        if (rest.userId) await col('users').doc(rest.userId).update({ nis: String(nis) });
      }

      return { nis: String(nis), ...current, ...rest };
    }),

    deleteStudent: (nis) => run(async () => {
      const id = String(nis);
      const ref = col('students').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;

      const batch = db.batch();
      batch.delete(ref);
      await batch.commit();

      if (snap.data().userId) {
        await col('users').doc(snap.data().userId)
          .update({ nis: firebase.firestore.FieldValue.delete() }).catch(() => {});
      }
      return true;
    }),

    /* ---------------- CLASSES ---------------- */

    getClasses: () => run(async () => {
      const className = await assignedClassName();
      const session = Session.get();
      const ref = session && ['guru', 'siswa'].includes(session.role)
        ? col('classes').where('name', '==', className || '__unassigned__')
        : col('classes');
      return fromSnap(await ref.get());
    }),

    createClass: (payload) => run(async () => {
      const exists = await col('classes').where('name', '==', payload.name).limit(1).get();
      if (!exists.empty) throw new Error('Nama kelas sudah digunakan.');

      const data = { capacity: 36, homeroom: '', ...payload };
      const ref = await col('classes').add(data);
      return { id: ref.id, ...data };
    }),

    updateClass: (id, payload) => run(async () => {
      const ref = col('classes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Kelas tidak ditemukan.');

      const oldName = snap.data().name;

      if (payload.name && payload.name !== oldName) {
        const dup = await col('classes').where('name', '==', payload.name).limit(1).get();
        if (!dup.empty) throw new Error('Nama kelas sudah digunakan.');

        /* Nama kelas disalin ke banyak dokumen di Firestore, jadi rename
           dibatasi untuk kelas yang belum dipakai. */
        const [students, schedules, teachers] = await Promise.all([
          col('students').where('className', '==', oldName).limit(1).get(),
          col('schedules').where('className', '==', oldName).limit(1).get(),
          col('teachers').where('className', '==', oldName).limit(1).get()
        ]);
        if (!students.empty || !schedules.empty || !teachers.empty) {
          throw new Error('Nama kelas tidak dapat diubah karena sudah dipakai siswa/jadwal/guru. Buat kelas baru lalu pindahkan datanya.');
        }
      }

      await ref.update(payload);
      return fromDoc(await ref.get());
    }),

    deleteClass: (id) => run(async () => {
      const ref = col('classes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;

      const name = snap.data().name;
      const students = await col('students').where('className', '==', name).limit(1).get();
      if (!students.empty) throw new Error('Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu.');

      const schedules = await col('schedules').where('className', '==', name).get();
      const ops = [(batch) => batch.delete(ref)];
      schedules.docs.forEach((doc) => ops.push((batch) => batch.delete(doc.ref)));

      await commitInChunks(ops);
      return true;
    }),

    /* ---------------- SCHEDULES ---------------- */

    getSchedules: () => run(async () => {
      const className = await assignedClassName();
      const session = Session.get();
      const ref = session && ['guru', 'siswa'].includes(session.role)
        ? col('schedules').where('className', '==', className || '__unassigned__')
        : col('schedules');
      return fromSnap(await ref.get());
    }),

    createSchedule: (payload) => run(async () => {
      const ref = await col('schedules').add(payload);
      return { id: ref.id, ...payload };
    }),

    updateSchedule: (id, payload) => run(async () => {
      await col('schedules').doc(id).update(payload);
      return fromDoc(await col('schedules').doc(id).get());
    }),

    deleteSchedule: (id) => run(async () => {
      await col('schedules').doc(id).delete();
      return true;
    }),

    /* ---------------- ANNOUNCEMENTS ---------------- */

    /* Non-admin hanya boleh membaca yang Publish; filter ini wajib ada di query
       agar lolos Security Rules. */
    getAnnouncements: () => run(async () => {
      const session = Session.get();
      let ref = col('announcements');
      if (!session || session.role !== 'admin') ref = ref.where('status', '==', 'Publish');
      return fromSnap(await ref.get()).sort(byDateDesc);
    }),

    createAnnouncement: (payload) => run(async () => {
      const data = { status: 'Publish', ...payload };
      const ref = await col('announcements').add(data);
      return { id: ref.id, ...data };
    }),

    updateAnnouncement: (id, payload) => run(async () => {
      await col('announcements').doc(id).update(payload);
      return fromDoc(await col('announcements').doc(id).get());
    }),

    deleteAnnouncement: (id) => run(async () => {
      await col('announcements').doc(id).delete();
      return true;
    }),

    /* ---------------- ATTENDANCE ---------------- */

    getAttendanceRange: (from, to, className = null) => run(async () => {
      let ref = col('attendance');
      const session = Session.get();
      const assigned = await assignedClassName();
      if (session && session.role === 'guru') {
        if (!assigned || (className && className !== assigned)) return [];
        ref = ref.where('className', '==', assigned);
      }
      if (from) ref = ref.where('date', '>=', from);
      if (to) ref = ref.where('date', '<=', to);

      const rows = fromSnap(await ref.get());
      return className ? rows.filter((row) => row.className === className) : rows;
    }),

    getAttendanceByDate: (date, className = null) => run(async () => {
      let ref = col('attendance').where('date', '==', date);
      const session = Session.get();
      const assigned = await assignedClassName();
      if (session && session.role === 'guru') {
        if (!assigned || (className && className !== assigned)) return [];
        ref = ref.where('className', '==', assigned);
      }
      const rows = fromSnap(await ref.get());
      return className ? rows.filter((row) => row.className === className) : rows;
    }),

    getAttendanceByStudent: (nis) => run(async () =>
      fromSnap(await col('attendance').where('studentId', '==', String(nis)).get()).sort(byDateDesc)),

    getAttendanceByStudentDate: (nis, date) => run(async () => {
      const snap = await col('attendance').doc(`${date}_${nis}`).get();
      return snap.exists ? fromDoc(snap) : null;
    }),

    saveAttendance: (payload) => run(async () => {
      const student = await getStudentDoc(payload.studentId);
      const id = `${payload.date}_${student.nis}`;

      const data = {
        note: '',
        time: currentTime(),
        ...payload,
        studentId: student.nis,
        name: student.name,
        className: student.className
      };

      await col('attendance').doc(id).set(data, { merge: true });
      return { id, ...data };
    }),

    deleteAttendance: (id) => run(async () => {
      await col('attendance').doc(id).delete();
      return true;
    }),

    /* ---------------- PERMISSIONS ---------------- */

    getPermissions: () => run(async () => {
      const className = await assignedClassName();
      const session = Session.get();
      const ref = session && session.role === 'guru'
        ? col('permissions').where('className', '==', className || '__unassigned__')
        : col('permissions');
      return fromSnap(await ref.get()).sort(byDateDesc);
    }),

    getPermissionsByStudent: (nis) => run(async () =>
      fromSnap(await col('permissions').where('studentId', '==', String(nis)).get()).sort(byDateDesc)),

    createPermission: (payload) => run(async () => {
      const student = await getStudentDoc(payload.studentId);

      const existing = fromSnap(await col('permissions').where('studentId', '==', student.nis).get());
      if (existing.some((p) => p.date === payload.date && p.status === 'Menunggu')) {
        throw new Error('Anda sudah mengajukan izin untuk tanggal tersebut.');
      }

      const data = {
        studentId: student.nis,
        name: student.name,
        className: student.className,
        date: payload.date,
        type: payload.type,
        note: payload.note || '',
        status: 'Menunggu'
      };

      const ref = await col('permissions').add(data);
      return { id: ref.id, ...data };
    }),

    reviewPermission: (id, status) => run(async () => {
      if (!['Disetujui', 'Ditolak'].includes(status)) throw new Error('Status tidak valid.');

      const permRef = col('permissions').doc(id);
      const permSnap = await permRef.get();
      if (!permSnap.exists) throw new Error('Pengajuan tidak ditemukan.');

      const item = { id, ...permSnap.data(), status };
      const attRef = col('attendance').doc(`${item.date}_${item.studentId}`);
      const attSnap = await attRef.get();

      const batch = db.batch();
      batch.update(permRef, { status });

      /* Catatan "Hadir" tidak pernah ditimpa */
      if (!attSnap.exists || attSnap.data().status !== 'Hadir') {
        batch.set(attRef, {
          studentId: item.studentId,
          name: item.name,
          className: item.className,
          date: item.date,
          time: '-',
          status: status === 'Disetujui' ? item.type : 'Alpa',
          note: status === 'Disetujui'
            ? (item.note || item.type)
            : `Pengajuan ditolak${item.note ? `: ${item.note}` : ''}`
        }, { merge: true });
      }

      await batch.commit();
      return item;
    }),

    /* ---------------- REPORTS ---------------- */

    getReport: ({ from, to, className, status } = {}) => run(async () => {
      let ref = col('attendance');
      const session = Session.get();
      const assigned = await assignedClassName();
      if (session && session.role === 'guru') {
        if (!assigned || (className && className !== assigned)) return [];
        ref = ref.where('className', '==', assigned);
      }
      if (from) ref = ref.where('date', '>=', from);
      if (to) ref = ref.where('date', '<=', to);

      let studentsRef = col('students');
      if (session && session.role === 'guru') studentsRef = studentsRef.where('className', '==', assigned);
      const [studentSnap, attendanceSnap] = await Promise.all([studentsRef.get(), ref.get()]);

      const students = studentSnap.docs
        .map((doc) => ({ nis: doc.id, ...doc.data() }))
        .filter((s) => s.status === 'Aktif' && (!className || s.className === className));

      const attendance = fromSnap(attendanceSnap).filter((row) =>
        (!className || row.className === className) && (!status || row.status === status));

      return buildReport(students, attendance);
    }),

    async resetDatabase() {
      throw new Error('Reset database hanya tersedia pada mode local.');
    }
  };
})();
