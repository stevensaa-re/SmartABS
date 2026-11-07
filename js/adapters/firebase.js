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
  let storage = null;
  let functionsApi = null;
  let initPromise = null;
  let activeSchoolId = null;

  function currentSchoolId() {
    return String(activeSchoolId !== null ? activeSchoolId : Session.get()?.schoolId || '');
  }

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
        loadScript(`${SDK_BASE}firebase-firestore-compat.js`),
        loadScript(`${SDK_BASE}firebase-functions-compat.js`),
        loadScript(`${SDK_BASE}firebase-storage-compat.js`)
      ]);

      if (!firebase.apps.length) firebase.initializeApp(APP_CONFIG.FIREBASE);
      auth = firebase.auth();
      db = firebase.firestore();
      storage = firebase.storage();
      functionsApi = firebase.app().functions(APP_CONFIG.FIREBASE_FUNCTIONS_REGION);
      activeSchoolId = String(Session.get()?.schoolId || '');

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

  const fromDoc = (doc) => {
    const data = doc.data();
    if (data.status === 'Hadir' &&
        data.createdAt && typeof data.createdAt.toMillis === 'function' &&
        data.sessionStartedAt && typeof data.sessionStartedAt.toMillis === 'function' &&
        data.createdAt.toMillis() >= data.sessionStartedAt.toMillis() + 15 * 60_000) {
      data.status = 'Terlambat';
    }
    if (data.time && typeof data.time.toDate === 'function') {
      data.time = new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      }).format(data.time.toDate());
    }
    return { id: doc.id, ...data };
  };
  const fromSnap = (snap) => snap.docs.map(fromDoc);
  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const col = (name) => {
    const collection = db.collection(name).withConverter({
      toFirestore: (data) => {
        const schoolId = currentSchoolId();
        return schoolId ? { ...data, schoolId } : data;
      },
      fromFirestore: (snapshot, options) => snapshot.data(options)
    });
    const queryForSchool = () => {
      const schoolId = currentSchoolId();
      return schoolId ? collection.where('schoolId', '==', schoolId) : collection;
    };
    return new Proxy(collection, {
      get(target, property) {
        if (property === 'get' || property === 'where' || property === 'orderBy' ||
            property === 'limit' || property === 'onSnapshot') {
          return (...args) => queryForSchool()[property](...args);
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  async function callFunction(name, data) {
    try {
      const result = await functionsApi.httpsCallable(name)(data);
      return result.data;
    } catch (error) {
      const message = String(error && error.message || '');
      if (error && error.code === 'functions/unauthenticated') {
        throw new Error('Sesi login berakhir. Silakan login kembali.');
      }
      if (error && error.code === 'functions/permission-denied') {
        throw new Error('Anda tidak memiliki izin untuk melakukan aksi ini.');
      }
      if (error && error.code === 'functions/already-exists') {
        throw new Error(message.replace(/^Firebase:\s*/i, '') || 'Data sudah terdaftar.');
      }
      if (error && error.code === 'functions/failed-precondition') {
        throw new Error(message.replace(/^Firebase:\s*/i, '') || 'Prasyarat data belum terpenuhi.');
      }
      throw new Error(message || `Cloud Function ${name} gagal dijalankan.`);
    }
  }

  async function activeSemesterId() {
    const result = await callFunction('getActiveSemester', {});
    return result.id || '';
  }

  async function provisionAccount(callable, payload) {
    const result = await callFunction(callable, payload);
    try {
      await auth.sendPasswordResetEmail(payload.account.email);
      return { ...result, invitationSent: true };
    } catch (error) {
      return {
        ...result,
        invitationSent: false,
        invitationError: `Akun berhasil dibuat, tetapi email pengaturan password gagal dikirim: ${error.message || 'kesalahan tidak diketahui'}. Gunakan fitur reset password untuk mengirim ulang.`
      };
    }
  }

  async function writeAudit(entry) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Sesi Firebase berakhir. Silakan login kembali.');
    const profile = await col('users').doc(firebaseUser.uid).get();
    if (!profile.exists || !['admin', 'guru'].includes(profile.data().role)) {
      throw new Error('Hanya petugas aktif yang dapat mencatat audit.');
    }
    try {
      await col('auditLogs').add({
        actorUid: firebaseUser.uid,
        actorName: String(profile.data().name || ''),
        actorRole: String(profile.data().role || ''),
        action: String(entry.action || ''),
        entity: String(entry.entity || ''),
        entityId: String(entry.entityId || ''),
        summary: String(entry.summary || ''),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      throw new Error(`Perubahan mungkin sudah tersimpan, tetapi log audit gagal dicatat: ${error.message || 'kesalahan tidak diketahui'}`);
    }
  }

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

  async function requireClass(className) {
    const normalized = String(className || '').trim();
    if (!normalized) throw new Error('Pilih kelas terlebih dahulu.');
    const classes = await col('classes').where('name', '==', normalized).limit(1).get();
    if (classes.empty) throw new Error('Kelas tidak ditemukan. Buat atau pilih kelas yang tersedia.');
    return normalized;
  }

  async function requireClassRecord(classId, className) {
    let ref = classId ? col('classes').doc(String(classId)) : null;
    let snap = ref ? await ref.get() : null;
    if (!snap || !snap.exists) {
      const normalized = String(className || '').trim();
      if (!normalized) throw new Error('Pilih kelas terlebih dahulu.');
      const matches = await col('classes').where('name', '==', normalized).limit(2).get();
      if (matches.size !== 1) throw new Error('Kelas tidak ditemukan atau nama kelas tidak unik.');
      snap = matches.docs[0];
    }
    if (snap.data().isActive === false) throw new Error('Kelas tidak aktif.');
    if (className && snap.get('name') !== String(className).trim()) {
      throw new Error('Nama kelas berubah. Muat ulang data sebelum menyimpan.');
    }
    return { id: snap.id, name: String(snap.get('name') || '') };
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

  async function getTeacherRoster() {
    const roster = await callFunction('getTeacherRoster', {});
    if (!roster || !Array.isArray(roster.classes) || !Array.isArray(roster.students) ||
        !Array.isArray(roster.permissions)) {
      throw new Error('Respons roster guru dari Firebase tidak valid.');
    }
    return roster;
  }

  async function resolveTeacherUid(teacherName) {
    const name = String(teacherName || '').trim();
    if (!name) throw new Error('Pilih guru yang akan mengajar jadwal ini.');
    const teachers = await col('teachers').where('name', '==', name).limit(2).get();
    if (teachers.empty) throw new Error(`Profil guru "${name}" tidak ditemukan.`);
    if (teachers.size > 1) throw new Error(`Nama guru "${name}" tidak unik. Perbarui data guru sebelum membuat jadwal.`);
    const username = String(teachers.docs[0].get('username') || '').trim().toLowerCase();
    if (!username) throw new Error(`Akun guru "${name}" belum ditautkan.`);
    const users = await col('users').where('usernameLower', '==', username).limit(2).get();
    if (users.size !== 1 || users.docs[0].get('role') !== 'guru' || users.docs[0].get('status') !== 'Aktif') {
      throw new Error(`Akun aktif untuk guru "${name}" tidak ditemukan.`);
    }
    return users.docs[0].id;
  }

  const loginEmail = (username) =>
    `${String(username).trim().toLowerCase()}@${APP_CONFIG.FIREBASE_LOGIN_DOMAIN}`;
  const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

  const AUTH_FAIL_CODES = [
    'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential',
    'auth/invalid-login-credentials', 'auth/invalid-email'
  ];

  /* =======================================================
     KONTRAK API
     ======================================================= */

  return {

    name: 'firebase',

    uploadSchoolLogo: (file) => run(async () => {
      const schoolId = currentSchoolId();
      if (!schoolId) throw new Error('Akun admin belum terhubung dengan sekolah.');
      if (!APP_CONFIG.FIREBASE.storageBucket) throw new Error('Konfigurasi Firebase Storage (storageBucket) belum tersedia.');
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file?.type];
      if (!extension || !file || file.size > 2 * 1024 * 1024) {
        throw new Error('Logo harus berupa PNG, JPEG, atau WebP maksimal 2 MB.');
      }
      const path = `schools/${schoolId}/logo/${Date.now()}.${extension}`;
      const upload = await storage.ref(path).put(file, { contentType: file.type });
      return upload.ref.getDownloadURL();
    }),

    /* ---------------- AUTH ---------------- */

    async login(username, password) {
      await init();
      activeSchoolId = '';

      const loginInput = String(username).trim();
      const credentialEmail = loginInput.includes('@') ? loginInput : loginEmail(loginInput);
      let credential;
      try {
          const login = String(username).trim();
          credential = await auth.signInWithEmailAndPassword(login.includes('@') ? login : loginEmail(login), password);
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
      activeSchoolId = String(profile.schoolId || '');
      return {
        ok: true,
        user: {
          id: snap.id,
          name: profile.name,
          username: profile.username,
          email: credential.user.email,
          role: profile.role,
          schoolId: activeSchoolId
        }
      };
    },

    async logout() {
      try { await init(); await auth.signOut(); } catch (error) { /* abaikan */ }
      activeSchoolId = '';
      return true;
    },

    /* ---------------- USERS ---------------- */

    getUsers: () => run(async () => fromSnap(await col('users').get())),

    createUser: (payload) => run(() => callFunction('createUser', payload)),
    createTeacherAccount: (payload) => run(() => provisionAccount('createTeacherAccount', payload)),
    createStudentAccount: (payload) => run(() => provisionAccount('createStudentAccount', payload)),

    updateUser: (id, payload) => run(async () => {
      const ref = col('users').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Pengguna tidak ditemukan.');

      const current = snap.data();

      const currentUsernameLower = String(current.usernameLower || current.username || '').trim().toLowerCase();
      if (payload.username && payload.username.trim().toLowerCase() !== currentUsernameLower) {
        throw new Error('Username tidak dapat diubah pada mode Firebase (username terhubung ke akun login).');
      }
      if (payload.email && payload.email.trim().toLowerCase() !== String(current.email || '').trim().toLowerCase()) {
        throw new Error('Email login tidak dapat diganti dari form admin. Pengguna dapat menggantinya lewat Firebase Authentication dengan verifikasi email.');
      }
      if (payload.password) {
        throw new Error('Password pengguna lain diubah lewat Firebase Console atau Cloud Function. Kosongkan kolom password.');
      }

      const changes = {
        name: payload.name ?? current.name,
        role: payload.role ?? current.role,
        status: payload.status ?? current.status,
        email: current.email || loginEmail(current.username)
      };

      if (changes.role !== current.role) {
        const [teacher, student] = await Promise.all([
          col('teachers').where('username', '==', current.username).limit(1).get(),
          col('students').where('userId', '==', id).limit(1).get()
        ]);
        if (!teacher.empty || !student.empty) {
          throw new Error('Lepas atau hapus profil guru/siswa sebelum mengganti role akun.');
        }
      }

      if (id === Session.get()?.id && (changes.role !== 'admin' || changes.status !== 'Aktif')) {
        throw new Error('Anda tidak dapat menonaktifkan atau mengubah role akun yang sedang digunakan.');
      }
      if (payload.passwordReset) {
        const storedEmail = String(current.email || '').trim();
        try {
          await auth.sendPasswordResetEmail(storedEmail || loginEmail(current.username));
        } catch (error) {
          if (!storedEmail || storedEmail.toLowerCase() === loginEmail(current.username).toLowerCase()) throw error;
          await auth.sendPasswordResetEmail(loginEmail(current.username));
        }
      }
      await ref.update(changes);
      await writeAudit({ action: 'update', entity: 'user', entityId: id,
        summary: `Memperbarui profil/status akun ${current.username}.` });
      return { id, ...current, ...changes };
    }),

    deleteUser: (id) => run(async () => {
      if (id === Session.get()?.id) throw new Error('Anda tidak dapat menonaktifkan akun yang sedang digunakan.');
      const ref = col('users').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;
      await ref.update({ status: 'Nonaktif' });
      await writeAudit({ action: 'deactivate', entity: 'user', entityId: id,
        summary: `Menonaktifkan akun ${snap.get('username') || id}.` });
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
      const className = await requireClass(payload.className);
      const exists = await col('teachers').where('username', '==', payload.username).limit(1).get();
      if (!exists.empty) throw new Error('Akun tersebut sudah terdaftar sebagai guru.');

      const data = { subject: '', status: 'Aktif', ...payload, className };
      const users = await col('users').where('usernameLower', '==', String(data.username).toLowerCase()).limit(1).get();
      if (users.empty || users.docs[0].data().role !== 'guru') {
        throw new Error('Pilih akun guru yang valid sebelum membuat profil guru.');
      }
      const ref = col('teachers').doc();
      const batch = db.batch();
      batch.set(ref, data);
      batch.update(users.docs[0].ref, { className: data.className });
      await batch.commit();
      await writeAudit({ action: 'create', entity: 'teacher', entityId: ref.id,
        summary: `Membuat profil guru ${data.name} untuk kelas ${data.className}.` });
      return { id: ref.id, ...data };
    }),

    updateTeacher: (id, payload) => run(async () => {
      const ref = col('teachers').doc(id);
      const current = await ref.get();
      if (!current.exists) throw new Error('Data guru tidak ditemukan.');
      if (payload.className !== undefined) payload.className = await requireClass(payload.className);
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
      await writeAudit({ action: 'update', entity: 'teacher', entityId: id,
        summary: `Memperbarui profil guru ${current.get('name') || id}.` });
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
      await writeAudit({ action: 'delete', entity: 'teacher', entityId: id,
        summary: `Menghapus profil guru ${teacher.get('name') || id}.` });
      return true;
    }),

    /* ---------------- STUDENTS ---------------- */

    getStudents: () => run(async () => {
      const session = Session.get();
      if (session?.role === 'guru') {
        return (await getTeacherRoster()).students;
      }
      if (session?.role === 'siswa') {
        const student = await FirebaseAdapter.getStudentByUserId(session.id);
        return student ? [student] : [];
      }
      let ref = col('students');
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
      const classRecord = await requireClassRecord(payload.classId, payload.className);
      const ref = col('students').doc(nis);

      if ((await ref.get()).exists) throw new Error('NIS sudah terdaftar.');

      let userRef = null;
      if (payload.userId) {
        const linked = await col('students').where('userId', '==', payload.userId).limit(1).get();
        if (!linked.empty) throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
        userRef = col('users').doc(payload.userId);
        const user = await userRef.get();
        if (!user.exists || user.data().role !== 'siswa') throw new Error('Akun yang dipilih bukan akun siswa yang valid.');
      }

      const { nis: _ignore, ...rest } = payload;
      const data = {
        userId: '', phone: '', gender: 'L', status: 'Aktif', ...rest,
        classId: classRecord.id,
        className: classRecord.name
      };
      const batch = db.batch();
      batch.set(ref, data);
      if (userRef) batch.update(userRef, { nis });
      await batch.commit();

      await writeAudit({ action: 'create', entity: 'student', entityId: nis,
        summary: `Membuat profil siswa ${data.name} (${nis}).` });
      return { nis, ...data };
    }),

    updateStudent: (nis, payload) => run(async () => {
      const ref = col('students').doc(String(nis));
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Siswa tidak ditemukan.');

      const current = snap.data();
      const { nis: _ignore, ...rest } = payload;
      if (rest.className !== undefined || rest.classId !== undefined) {
        const classRecord = await requireClassRecord(rest.classId || current.classId, rest.className || current.className);
        rest.classId = classRecord.id;
        rest.className = classRecord.name;
      }

      if (rest.userId && rest.userId !== current.userId) {
        const linked = await col('students').where('userId', '==', rest.userId).limit(1).get();
        if (!linked.empty) throw new Error('Akun tersebut sudah terhubung dengan siswa lain.');
      }

      let nextUserRef = null;
      if (rest.userId && rest.userId !== current.userId) {
        nextUserRef = col('users').doc(rest.userId);
        const user = await nextUserRef.get();
        if (!user.exists || user.data().role !== 'siswa') throw new Error('Akun yang dipilih bukan akun siswa yang valid.');
      }

      const batch = db.batch();
      batch.update(ref, rest);
      if (rest.userId !== undefined && rest.userId !== current.userId) {
        if (current.userId) batch.update(col('users').doc(current.userId), { nis: firebase.firestore.FieldValue.delete() });
        if (nextUserRef) batch.update(nextUserRef, { nis: String(nis) });
      }
      await batch.commit();

      await writeAudit({ action: 'update', entity: 'student', entityId: String(nis),
        summary: `Memperbarui profil siswa ${rest.name || current.name || nis}.` });
      return { nis: String(nis), ...current, ...rest };
    }),

    deleteStudent: (nis) => run(async () => {
      const id = String(nis);
      const ref = col('students').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;

      const batch = db.batch();
      batch.delete(ref);
      if (snap.data().userId) {
        batch.update(col('users').doc(snap.data().userId), { nis: firebase.firestore.FieldValue.delete() });
      }
      await batch.commit();
      await writeAudit({ action: 'delete', entity: 'student', entityId: id,
        summary: `Menghapus profil siswa ${snap.get('name') || id}.` });
      return true;
    }),

    /* ---------------- CLASSES ---------------- */

    getClasses: () => run(async () => {
      const session = Session.get();
      if (session?.role === 'guru') {
        return (await getTeacherRoster()).classes;
      }
      const className = session?.role === 'siswa' ? await assignedClassName() : '';
      const ref = session && ['guru', 'siswa'].includes(session.role)
        ? col('classes').where('name', '==', className || '__unassigned__')
        : col('classes');
      return fromSnap(await ref.get());
    }),

    createClass: (payload) => run(() =>
      callFunction('saveAcademicMaster', { type: 'classes', recordId: '', payload })),

    updateClass: (id, payload) => run(async () => {
      const ref = col('classes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Kelas tidak ditemukan.');
      return callFunction('saveAcademicMaster', {
        type: 'classes',
        recordId: id,
        payload: { ...snap.data(), ...payload }
      });
    }),
    deleteClass: (id) => run(async () => {
      const ref = col('classes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return true;
      await callFunction('saveAcademicMaster', {
        type: 'classes',
        recordId: id,
        payload: { ...snap.data(), isActive: false }
      });
      return true;
    }),

    getSchoolSetup: () => run(() => callFunction('getSchoolSetup', {})),
    saveSchoolProfile: (payload) => run(() => callFunction('saveSchoolProfile', payload)),
    saveAcademicMaster: (type, recordId, payload) =>
      run(() => callFunction('saveAcademicMaster', { type, recordId, payload })),
    saveSemesterConfiguration: (semesterId, type, payload) =>
      run(() => callFunction('saveSemesterConfiguration', { semesterId, type, payload })),
    saveActiveSchedule: (scheduleId, payload) =>
      run(() => callFunction('saveActiveSchedule', { scheduleId, payload })),
    deleteActiveSchedule: (scheduleId) =>
      run(() => callFunction('deleteActiveSchedule', { scheduleId })),

    /* ---------------- SEMESTER ---------------- */

    getSemesters: () => run(async () =>
      fromSnap(await col('semesters').get()).sort((a, b) =>
        String(b.startDate || '').localeCompare(String(a.startDate || '')))),
    getSemesterConfigurations: (semesterId) => run(async () =>
      fromSnap(await col('semesterConfigurations').where('semesterId', '==', semesterId).get())),
    createSemester: (payload) => run(() => callFunction('createSemester', payload)),
    updateSemester: (semesterId, payload) => run(() =>
      callFunction('updateSemester', { semesterId, ...payload })),
    previewSemesterConfigurationCopy: (payload) => run(() =>
      callFunction('previewSemesterConfigurationCopy', payload)),
    copySemesterConfiguration: (payload) => run(() =>
      callFunction('copySemesterConfiguration', payload)),
    updateSemesterConfiguration: (configurationId, payload) => run(() =>
      callFunction('updateSemesterConfiguration', { configurationId, payload })),
    deleteSemesterConfiguration: (configurationId) => run(() =>
      callFunction('deleteSemesterConfiguration', { configurationId })),
    activateSemester: (semesterId) => run(() =>
      callFunction('activateSemester', { semesterId })),

    /* ---------------- SCHEDULES ---------------- */

    getSchedules: () => run(async () => {
      const className = await assignedClassName();
      const session = Session.get();
      const activeId = await activeSemesterId();
      const ref = session?.role === 'guru'
        ? col('schedules').where('teacherUid', '==', auth.currentUser.uid)
        : session?.role === 'siswa'
          ? col('schedules').where('className', '==', className || '__unassigned__')
          : col('schedules');
      const schedules = fromSnap(await ref.get());
      return schedules.filter((schedule) =>
        activeId ? schedule.semesterId === activeId : !schedule.semesterId);
    }),

    createSchedule: (payload) => run(async () => {
      const data = { ...payload, teacherUid: await resolveTeacherUid(payload.teacher) };
      const semesterId = await activeSemesterId();
      if (semesterId) data.semesterId = semesterId;
      const ref = await col('schedules').add(data);
      await writeAudit({ action: 'create', entity: 'schedule', entityId: ref.id,
        summary: `Menambahkan jadwal ${data.subject} untuk kelas ${data.className}.` });
      return { id: ref.id, ...data };
    }),

    updateSchedule: (id, payload) => run(async () => {
      const ref = col('schedules').doc(id);
      const current = await ref.get();
      if (!current.exists) throw new Error('Jadwal tidak ditemukan.');
      const data = { ...payload };
      if (data.teacher !== undefined) data.teacherUid = await resolveTeacherUid(data.teacher);
      await ref.update(data);
      await writeAudit({ action: 'update', entity: 'schedule', entityId: id,
        summary: `Memperbarui jadwal ${payload.subject || id}.` });
      return fromDoc(await ref.get());
    }),

    deleteSchedule: (id) => run(async () => {
      const snap = await col('schedules').doc(id).get();
      await col('schedules').doc(id).delete();
      await writeAudit({ action: 'delete', entity: 'schedule', entityId: id,
        summary: `Menghapus jadwal ${snap.get('subject') || id}.` });
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
      await writeAudit({ action: 'create', entity: 'announcement', entityId: ref.id,
        summary: `Menerbitkan pengumuman ${data.title}.` });
      return { id: ref.id, ...data };
    }),

    updateAnnouncement: (id, payload) => run(async () => {
      await col('announcements').doc(id).update(payload);
      await writeAudit({ action: 'update', entity: 'announcement', entityId: id,
        summary: `Memperbarui pengumuman ${payload.title || id}.` });
      return fromDoc(await col('announcements').doc(id).get());
    }),

    deleteAnnouncement: (id) => run(async () => {
      const snap = await col('announcements').doc(id).get();
      await col('announcements').doc(id).delete();
      await writeAudit({ action: 'delete', entity: 'announcement', entityId: id,
        summary: `Menghapus pengumuman ${snap.get('title') || id}.` });
      return true;
    }),

    /* ---------------- ATTENDANCE ---------------- */

    getAttendanceRange: (from, to, className = null) => run(async () => {
      let ref = col('attendance');
      const session = Session.get();
      if (session && session.role === 'guru') {
        ref = ref.where('teacherUid', '==', auth.currentUser.uid);
        if (className) ref = ref.where('className', '==', className);
      } else if (className) {
        ref = ref.where('className', '==', className);
      }
      if (from) ref = ref.where('date', '>=', from);
      if (to) ref = ref.where('date', '<=', to);

      return fromSnap(await ref.get());
    }),

    getAttendanceByDate: (date, className = null) => run(async () => {
      let ref = col('attendance').where('date', '==', date);
      const session = Session.get();
      if (session && session.role === 'guru') {
        ref = ref.where('teacherUid', '==', auth.currentUser.uid);
        if (className) ref = ref.where('className', '==', className);
      } else if (className) {
        ref = ref.where('className', '==', className);
      }
      return fromSnap(await ref.get());
    }),

    subscribeAttendanceByDate(date, className, onData, onError = () => {}) {
      let cancelled = false;
      let unsubscribe = null;
      init().then(async () => {
        if (cancelled) return;
        let ref = col('attendance').where('date', '==', date);
        const session = Session.get();
        if (session && session.role === 'guru') {
          ref = ref.where('teacherUid', '==', auth.currentUser.uid);
          if (className) ref = ref.where('className', '==', className);
        } else if (className) {
          ref = ref.where('className', '==', className);
        }
        if (cancelled) return;
        unsubscribe = ref.onSnapshot(
          (snapshot) => onData(fromSnap(snapshot)),
          (error) => onError(error)
        );
      }).catch(onError);
      return () => {
        cancelled = true;
        if (unsubscribe) unsubscribe();
      };
    },

    getAttendanceByStudent: (nis) => run(async () =>
      fromSnap(await col('attendance').where('studentId', '==', String(nis)).get()).sort(byDateDesc)),

    getAttendanceByStudentDate: (nis, date) => run(async () => {
      const rows = fromSnap(await col('attendance')
        .where('studentId', '==', String(nis))
        .where('date', '==', String(date))
        .get());
      return rows[0] || null;
    }),

    getAttendanceForStudentDate: (nis, date) => run(async () =>
      fromSnap(await col('attendance')
        .where('studentId', '==', String(nis))
        .where('date', '==', String(date))
        .get())),

    saveAttendance: (payload) => run(async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Sesi Firebase berakhir. Silakan login kembali.');
      const userProfile = await col('users').doc(firebaseUser.uid).get();
      if (!userProfile.exists || userProfile.data().status !== 'Aktif') {
        throw new Error('Profil akun tidak aktif atau tidak ditemukan.');
      }
      const date = String(payload.date || '');
      const status = String(payload.status || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal absensi tidak valid.');
      if (!['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa'].includes(status)) throw new Error('Status absensi tidak valid.');
      const note = String(payload.note || '').trim();
      if (note.length < 5) throw new Error('Alasan perubahan wajib diisi minimal 5 karakter.');
      const student = await getStudentDoc(payload.studentId);
      if (student.status !== 'Aktif') throw new Error('Siswa tidak aktif.');
      if (!student.className) throw new Error('Siswa belum terhubung ke kelas.');
      const isStudentSelfCheckIn = userProfile.data().role === 'siswa';
      if (isStudentSelfCheckIn) {
        throw new Error('Siswa harus melakukan absensi melalui QR mata pelajaran yang aktif.');
      }
      const sessionId = String(payload.sessionId || '');
      const scheduleId = String(payload.scheduleId || '');
      let teacherUid = '';
      if (userProfile.data().role === 'guru') {
        if (!scheduleId) throw new Error('Pilih jadwal mata pelajaran yang menjadi kewenangan Anda.');
        const schedule = await col('schedules').doc(scheduleId).get();
        if (!schedule.exists || schedule.get('teacherUid') !== firebaseUser.uid ||
            schedule.get('className') !== student.className ||
            schedule.get('subject') !== String(payload.subject || '')) {
          throw new Error('Jadwal, mata pelajaran, atau kelas tidak sesuai dengan penugasan Anda.');
        }
        teacherUid = firebaseUser.uid;
      } else if (scheduleId) {
        const schedule = await col('schedules').doc(scheduleId).get();
        if (!schedule.exists || schedule.get('className') !== student.className ||
            schedule.get('subject') !== String(payload.subject || '') ||
            !String(schedule.get('teacherUid') || '')) {
          throw new Error('Jadwal, mata pelajaran, atau kelas tidak cocok dengan siswa.');
        }
        teacherUid = String(schedule.get('teacherUid'));
      }
      const dailyId = `${date}_${student.nis}`;
      const scheduleAttendanceId = scheduleId ? `${scheduleId}_${date}_${student.nis}` : dailyId;
      const id = String(payload.attendanceId || (sessionId ? `${sessionId}_${student.nis}` : scheduleAttendanceId));
      if (sessionId && id !== `${sessionId}_${student.nis}`) throw new Error('ID catatan sesi absensi tidak cocok.');
      if (!sessionId && id !== scheduleAttendanceId) throw new Error('ID catatan absensi tidak cocok.');

      const ref = col('attendance').doc(id);
      const historyRef = ref.collection('history').doc();
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (isStudentSelfCheckIn && current.exists) {
          throw new Error('Anda sudah melakukan absensi hari ini.');
        }
        const previous = current.exists ? current.data() : {};
        const data = {
          schoolId: String(userProfile.data().schoolId || ''),
          studentId: student.nis,
          name: student.name,
          className: student.className,
          date,
          subject: String(payload.subject || ''),
          source: 'manual',
          time: ['Hadir', 'Terlambat'].includes(status) ? currentTime() : '-',
          status,
          note,
          ...(sessionId ? { sessionId } : {}),
          ...(scheduleId ? { scheduleId, teacherUid } : {}),
          lastChangeId: historyRef.id,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        transaction.set(ref, data);
        transaction.set(historyRef, {
          actorUid: firebaseUser.uid,
          actorName: userProfile.data().name || '',
          action: current.exists ? 'updated' : 'created',
          studentId: student.nis,
          className: student.className,
          date,
          previousStatus: current.exists ? String(previous.status || '') : '',
          previousNote: current.exists ? String(previous.note || '') : '',
          nextStatus: status,
          nextNote: note,
          reason: note,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeAudit({ action: 'attendance-change', entity: 'attendance', entityId: id,
        summary: `Mengubah absensi ${student.name} (${date}) menjadi ${status}.` });
      return fromDoc(await ref.get());
    }),

    getAttendanceHistory: (id) => run(async () => {
      const snapshot = await col('attendance').doc(String(id)).collection('history').get();
      return snapshot.docs.map(fromDoc).sort((a, b) => {
        const aTime = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
      });
    }),

    getActiveAttendanceSession: (payload) => run(async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Sesi Firebase berakhir. Silakan login kembali.');
      const profileSnap = await col('users').doc(firebaseUser.uid).get();
      if (!profileSnap.exists || profileSnap.data().status !== 'Aktif') {
        throw new Error('Profil akun tidak aktif atau tidak ditemukan.');
      }
      const profile = profileSnap.data();
      if (!['admin', 'guru'].includes(profile.role)) {
        throw new Error('Hanya guru atau admin yang dapat memulihkan sesi absensi.');
      }
      let sessions = col('attendanceSessions')
        .where('scheduleId', '==', String(payload.scheduleId || ''))
        .where('date', '==', String(payload.date || todayISO()))
        .where('active', '==', true)
        .where('className', '==', String(payload.className || ''));
      if (profile.role === 'guru') {
        sessions = sessions.where('teacherUid', '==', firebaseUser.uid);
      }
      const snapshot = await sessions.get();
      const active = snapshot.docs
        .filter((doc) => doc.data().expiresAt && doc.data().expiresAt.toMillis() > Date.now())
        .sort((a, b) => b.data().createdAt.toMillis() - a.data().createdAt.toMillis())[0];
      if (!active) return null;
      const session = active.data();
      return {
        ...session,
        id: active.id,
        expiresAt: session.expiresAt.toMillis(),
        sessionStartedAtSeconds: session.createdAt.seconds,
        sessionStartedAtNanos: session.createdAt.nanoseconds
      };
    }),

    startAttendanceSession: (payload) => run(() => callFunction('startAttendanceSession', {
      scheduleId: String(payload.scheduleId || ''),
      date: String(payload.date || todayISO())
    })),

    rotateAttendanceSession: (sessionId) => run(() =>
      callFunction('rotateAttendanceSession', { sessionId: String(sessionId) })),

    closeAttendanceSession: (sessionId) => run(async () => {
      await callFunction('closeAttendanceSession', { sessionId: String(sessionId) });
      return true;
    }),

    submitQrAttendance: (payload) => run(async () => {
      const result = await callFunction('submitQrAttendance', {
        sessionId: String(payload.sessionId || ''),
        token: String(payload.token || '')
      });
      return result;
    }),

    deleteAttendance: (id) => run(async () => {
      throw new Error('Catatan absensi dan riwayatnya tidak dapat dihapus; koreksi status dengan alasan.');
    }),

    /* ---------------- PERMISSIONS ---------------- */

    getPermissions: () => run(async () => {
      const session = Session.get();
      if (session?.role === 'guru') {
        return (await getTeacherRoster()).permissions.sort(byDateDesc);
      }
      const ref = session?.role === 'siswa'
        ? col('permissions').where('studentId', '==', String(session.nis || ''))
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
      if (Session.get()?.role !== 'siswa') {
        await writeAudit({ action: 'create', entity: 'permission', entityId: ref.id,
          summary: `Membuat pengajuan ${data.type} untuk ${data.name} (${data.date}).` });
      }
      return { id: ref.id, ...data };
    }),

    reviewPermission: (id, status) => run(async () => {
      if (!['Disetujui', 'Ditolak'].includes(status)) throw new Error('Status tidak valid.');
      if (Session.get()?.role === 'guru') {
        return callFunction('reviewTeacherPermission', { permissionId: String(id), status });
      }

      const permRef = col('permissions').doc(id);
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Sesi Firebase berakhir. Silakan login kembali.');
      const actorSnap = await col('users').doc(firebaseUser.uid).get();
      if (!actorSnap.exists || actorSnap.data().status !== 'Aktif' ||
          !['admin', 'guru'].includes(actorSnap.data().role)) {
        throw new Error('Profil petugas aktif tidak ditemukan.');
      }
      const actorName = actorSnap.data().name || '';

      const result = await db.runTransaction(async (transaction) => {
        const permissionSnap = await transaction.get(permRef);
        if (!permissionSnap.exists) throw new Error('Pengajuan tidak ditemukan.');
        if (permissionSnap.data().status !== 'Menunggu') {
          throw new Error('Pengajuan ini sudah pernah diputuskan.');
        }
        const item = { id, ...permissionSnap.data(), status };
        const attRef = col('attendance').doc(`${item.date}_${item.studentId}`);
        const attSnap = await transaction.get(attRef);
        transaction.update(permRef, { status });

        /* Catatan Hadir dari QR/petugas tidak pernah ditimpa oleh persetujuan. */
        if (!attSnap.exists || attSnap.data().status !== 'Hadir') {
          const historyRef = attRef.collection('history').doc();
          const attendanceStatus = status === 'Disetujui' ? item.type : 'Alpa';
          const attendanceNote = status === 'Disetujui'
            ? (item.note || item.type)
            : `Pengajuan ditolak${item.note ? `: ${item.note}` : ''}`;
          transaction.set(attRef, {
            studentId: item.studentId,
            name: item.name,
            className: item.className,
            date: item.date,
            source: 'permission',
            permissionId: id,
            time: '-',
            status: attendanceStatus,
            note: attendanceNote,
            lastChangeId: historyRef.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          transaction.set(historyRef, {
            actorUid: firebaseUser.uid,
            actorName,
            action: attSnap.exists ? 'updated' : 'created',
            studentId: item.studentId,
            className: item.className,
            date: item.date,
            previousStatus: attSnap.exists ? String(attSnap.data().status || '') : '',
            previousNote: attSnap.exists ? String(attSnap.data().note || '') : '',
            nextStatus: attendanceStatus,
            nextNote: attendanceNote,
            reason: `Keputusan pengajuan ${item.type}: ${status}`,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        return item;
      });
      await writeAudit({ action: 'review', entity: 'permission', entityId: id,
        summary: `Memutus pengajuan ${id} sebagai ${status}.` });
      return result;
    }),

    /* ---------------- REPORTS ---------------- */

    getReport: ({ from, to, className, subject, status } = {}) => run(async () => {
      let ref = col('attendance');
      const session = Session.get();
      if (session && session.role === 'guru') {
        ref = ref.where('teacherUid', '==', auth.currentUser.uid);
      }
      if (from) ref = ref.where('date', '>=', from);
      if (to) ref = ref.where('date', '<=', to);

      const studentsPromise = session?.role === 'guru'
        ? getTeacherRoster().then((roster) => roster.students)
        : col('students').get().then((snapshot) =>
          snapshot.docs.map((doc) => ({ nis: doc.id, ...doc.data() })));
      const [students, attendanceSnap] = await Promise.all([studentsPromise, ref.get()]);

      const activeStudents = students
        .filter((s) => s.status === 'Aktif' && (!className || s.className === className));

      const attendance = fromSnap(attendanceSnap).filter((row) =>
        (!className || row.className === className) &&
        (!subject || row.subject === subject) &&
        (!status || row.status === status));

      return buildReport(activeStudents, attendance);
    }),

    getCalendarEvents: () => run(async () =>
      fromSnap(await col('calendarEvents').orderBy('startDate').get())),

    saveCalendarEvent: (payload) => run(async () => {
      const title = String(payload.title || '').trim();
      const startDate = String(payload.startDate || '');
      const endDate = String(payload.endDate || '');
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
        throw new Error('Lengkapi judul dan rentang tanggal kalender yang valid.');
      }
      const ref = payload.id ? col('calendarEvents').doc(String(payload.id)) : col('calendarEvents').doc();
      const current = payload.id ? await ref.get() : null;
      if (payload.id && !current.exists) throw new Error('Agenda kalender tidak ditemukan.');
      const data = {
        title,
        type: String(payload.type || 'Akademik'),
        startDate,
        endDate,
        description: String(payload.description || ''),
        isHoliday: Boolean(payload.isHoliday),
        ...(current?.exists ? { updatedAt: firebase.firestore.FieldValue.serverTimestamp() } : {
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      };
      await ref.set(data, { merge: Boolean(payload.id) });
      await writeAudit({
        action: payload.id ? 'update' : 'create',
        entity: 'calendarEvent',
        entityId: ref.id,
        summary: `${payload.id ? 'Memperbarui' : 'Menambahkan'} agenda "${title}".`
      });
      return { id: ref.id, ...data };
    }),

    deleteCalendarEvent: (id) => run(async () => {
      const ref = col('calendarEvents').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Agenda kalender tidak ditemukan.');
      await ref.delete();
      await writeAudit({ action: 'delete', entity: 'calendarEvent', entityId: ref.id,
        summary: `Menghapus agenda "${snap.get('title') || ref.id}".` });
      return true;
    }),

    getAuditLogs: () => run(async () =>
      fromSnap(await col('auditLogs').orderBy('createdAt', 'desc').limit(500).get())),

    logAudit: (entry) => run(async () => {
      await writeAudit(entry);
      return true;
    }),

    exportBackup: () => run(async () => {
      const profile = await col('users').doc(auth.currentUser.uid).get();
      if (!profile.exists || profile.data().role !== 'admin') throw new Error('Backup hanya dapat dibuat oleh admin.');
      const collections = ['classes', 'students', 'teachers', 'schedules', 'announcements',
        'attendance', 'permissions', 'calendarEvents'];
      const snapshots = await Promise.all(collections.map((name) => col(name).get()));
      const data = {};
      snapshots.forEach((snapshot, index) => {
        data[collections[index]] = snapshot.docs.map((doc) => {
          const value = doc.data();
          Object.keys(value).forEach((key) => {
            if (value[key] && typeof value[key].toDate === 'function') value[key] = value[key].toDate().toISOString();
          });
          return { id: doc.id, ...value };
        });
      });
      return {
        format: 'smartabs-backup',
        version: 1,
        generatedAt: new Date().toISOString(),
        limitations: ['Akun Firebase Authentication dan kredensial tidak termasuk.', 'Subkoleksi riwayat audit absensi QR tidak termasuk.'],
        data
      };
    }),

    restoreBackup: (backup) => run(async () => {
      const profile = await col('users').doc(auth.currentUser.uid).get();
      if (!profile.exists || profile.data().role !== 'admin') throw new Error('Pemulihan backup hanya dapat dilakukan oleh admin.');
      if (!backup || backup.format !== 'smartabs-backup' || backup.version !== 1 || !backup.data ||
          typeof backup.data !== 'object') throw new Error('Format backup SMARTABS tidak valid.');
      const collections = ['classes', 'students', 'teachers', 'schedules', 'announcements',
        'attendance', 'permissions', 'calendarEvents'];
      const prepared = [];
      let total = 0;
      for (const name of collections) {
        const rows = backup.data[name] || [];
        if (!Array.isArray(rows)) throw new Error(`Bagian ${name} pada backup tidak valid.`);
        total += rows.length;
        if (total > 5000) throw new Error('Backup melebihi batas pemulihan 5.000 dokumen.');
        for (const row of rows) {
          if (!row || typeof row !== 'object') throw new Error(`Dokumen dalam ${name} tidak valid.`);
          const id = String(name === 'students' ? row.nis : row.id || '');
          if (!id || id.length > 128) throw new Error(`Ada dokumen ${name} tanpa ID yang valid.`);
          prepared.push({ name, id, row });
        }
      }
      const result = { restored: 0, skipped: 0 };
      const actorUid = auth.currentUser.uid;
      const actorName = String(profile.data().name || '');
      const present = new Map(collections.map((name) => [name, new Set()]));
      for (const name of collections) {
        const ids = prepared.filter((item) => item.name === name).map((item) => item.id);
        for (let offset = 0; offset < ids.length; offset += 30) {
          const snapshot = await col(name)
            .where(firebase.firestore.FieldPath.documentId(), 'in', ids.slice(offset, offset + 30)).get();
          snapshot.docs.forEach((doc) => present.get(name).add(doc.id));
        }
      }
      const usernames = [...new Set(prepared
        .filter((item) => item.name === 'teachers')
        .map((item) => String(item.row.username || '').toLowerCase())
        .filter(Boolean))];
      const teacherUsers = new Map();
      for (let offset = 0; offset < usernames.length; offset += 30) {
        const snapshot = await col('users')
          .where('usernameLower', 'in', usernames.slice(offset, offset + 30)).get();
        snapshot.docs.forEach((doc) => {
          const user = doc.data();
          if (user.role === 'guru' && user.status === 'Aktif') {
            teacherUsers.set(String(user.usernameLower).toLowerCase(), doc.ref);
          }
        });
      }
      const operations = [];
      for (const item of prepared) {
        if (present.get(item.name).has(item.id)) { result.skipped++; continue; }
        if (item.name === 'teachers' && !teacherUsers.has(String(item.row.username || '').toLowerCase())) {
          result.skipped++;
          continue;
        }
        const ref = col(item.name).doc(item.id);
        const { id: _id, ...row } = item.row;
        const data = { ...row };
        if (item.name === 'students') data.userId = '';
        if (item.name === 'attendance') {
          if (data.sessionId) { result.skipped++; continue; }
          const historyRef = ref.collection('history').doc();
          data.lastChangeId = historyRef.id;
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          operations.push((batch) => batch.set(ref, data));
          operations.push((batch) => batch.set(historyRef, {
            actorUid, actorName, action: 'created', studentId: String(data.studentId || ''),
            className: String(data.className || ''), date: String(data.date || ''),
            previousStatus: '', previousNote: '', nextStatus: String(data.status || ''),
            nextNote: String(data.note || ''), reason: 'Pemulihan dari backup SMARTABS',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }));
        } else if (item.name === 'calendarEvents') {
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          operations.push((batch) => batch.set(ref, data));
        } else {
          operations.push((batch) => batch.set(ref, data));
          if (item.name === 'teachers') {
            operations.push((batch) => batch.update(
              teacherUsers.get(String(item.row.username).toLowerCase()), { className: data.className || '' }));
          }
        }
        result.restored++;
      }
      await commitInChunks(operations);
      await writeAudit({ action: 'restore', entity: 'backup', entityId: '',
        summary: `Pemulihan backup merge: ${result.restored} data dipulihkan, ${result.skipped} duplikat/QR dilewati.` });
      return result;
    }),

    async resetDatabase() {
      throw new Error('Reset database hanya tersedia pada mode local.');
    }
  };
})();
