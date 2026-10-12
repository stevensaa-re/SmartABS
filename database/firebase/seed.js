/* =========================================================
   SMARTABS — Seed Firebase (Auth + Firestore) dengan Admin SDK
   ---------------------------------------------------------
   Hanya untuk project demo kosong. Jangan jalankan pada data nyata.

   Gunakan ADC (`gcloud auth application-default login`) atau
   GOOGLE_APPLICATION_CREDENTIALS dari secret lokal yang tidak di-commit.
   ========================================================= */

const admin = require('firebase-admin');
const seed = require('../seed-data');

const LOGIN_DOMAIN = process.env.LOGIN_DOMAIN || 'gmail.com';   // harus sama dengan APP_CONFIG.FIREBASE_LOGIN_DOMAIN
const SCHOOL_ID = process.env.SCHOOL_ID || 'smartabs-demo';
const SCHOOL_NAME = process.env.SCHOOL_NAME || 'SMARTABS Demo';
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!PROJECT_ID) throw new Error('Atur GCLOUD_PROJECT atau FIREBASE_PROJECT_ID sebelum menjalankan seed.');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID
});

const auth = admin.auth();
const db = admin.firestore();
const schoolRef = db.collection('schools').doc(SCHOOL_ID);
const schoolCollection = (name) => schoolRef.collection(name);

async function commit(operations) {
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch();
    operations.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

async function ensureAuthUser(user) {
  const email = `${user.username.toLowerCase()}@${LOGIN_DOMAIN}`;
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password: user.password, disabled: user.status !== 'Aktif' });
    return existing.uid;
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    const created = await auth.createUser({
      email, password: user.password, displayName: user.name, disabled: user.status !== 'Aktif'
    });
    return created.uid;
  }
}

(async () => {
  const ops = [];
  const uidOf = {};      // id lama (U001) -> uid Firebase

  ops.push((b) => b.set(schoolRef, {
    name: SCHOOL_NAME,
    address: '',
    phone: '',
    educationLevels: ['SMA', 'SMK'],
    majors: [...new Set(seed.classes.map((c) => c.major).filter(Boolean))],
    status: 'Aktif',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }));

  for (const u of seed.users) {
    uidOf[u.id] = await ensureAuthUser(u);
    const student = seed.students.find((s) => s.userId === u.id);
    const teacher = seed.teachers.find((t) => t.username.toLowerCase() === u.username.toLowerCase());

    ops.push((b) => b.set(db.collection('users').doc(uidOf[u.id]), {
      name: u.name, username: u.username, usernameLower: u.username.toLowerCase(),
      role: u.role, status: u.status, email: u.email,
      schoolId: SCHOOL_ID,
      ...(student ? { nis: student.nis } : {}),
      ...(teacher ? { className: teacher.className } : {})
    }));
    if (u.role === 'admin') {
      ops.push((b) => b.set(db.collection('platformAdmins').doc(uidOf[u.id]), {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        bootstrap: 'demo-seed'
      }));
    }
  }

  seed.classes.forEach((c) => {
    const { id, ...rest } = c;
    ops.push((b) => b.set(schoolCollection('classes').doc(id), {
      ...rest, educationLevel: c.educationLevel || 'SMK'
    }));
  });

  seed.students.forEach((s) => {
    const { nis, ...rest } = s;
    ops.push((b) => b.set(schoolCollection('students').doc(nis), { ...rest, userId: s.userId ? uidOf[s.userId] : '' }));
  });

  seed.teachers.forEach((t) => {
    const { id, ...rest } = t;
    ops.push((b) => b.set(schoolCollection('teachers').doc(id), rest));
  });

  seed.schedules.forEach((j) => {
    const { id, ...rest } = j;
    ops.push((b) => b.set(schoolCollection('schedules').doc(id), rest));
  });

  seed.announcements.forEach((a) => {
    const { id, ...rest } = a;
    ops.push((b) => b.set(schoolCollection('announcements').doc(id), rest));
  });

  seed.permissions.forEach((p) => {
    const { id, daysAgo, ...rest } = p;
    ops.push((b) => b.set(schoolCollection('permissions').doc(id), { ...rest, date: seed.isoDate(daysAgo) }));
  });

  const nameOf = Object.fromEntries(seed.students.map((s) => [s.nis, s.name]));
  seed.buildAttendance().forEach((r) => {
    ops.push((b) => b.set(schoolCollection('attendance').doc(`${r.date}_${r.studentId}`), {
      studentId: r.studentId, name: nameOf[r.studentId], className: r.className,
      date: r.date, time: r.time || '-', status: r.status, note: r.note
    }));
  });

  await commit(ops);
  console.log(`✔ Seed Firebase selesai untuk sekolah "${SCHOOL_NAME}" (${seed.users.length} akun, ${ops.length} dokumen).`);
  console.log('  Login demo: admin / admin123 — GANTI password sebelum dipakai sungguhan.');
})().catch((e) => { console.error('✘ Gagal:', e.message); process.exit(1); });
