/* =========================================================
   SMARTABS — Seed Firebase (Auth + Firestore) dengan Admin SDK
   ---------------------------------------------------------
   Jalankan SEKALI dari komputer Anda (bukan di browser):

     1. Firebase Console > Project settings > Service accounts >
        "Generate new private key" -> simpan sebagai
        database/firebase/serviceAccountKey.json   (JANGAN di-commit!)
     2. cd database/firebase && npm init -y && npm i firebase-admin
     3. node seed.js
   ========================================================= */

const admin = require('firebase-admin');
const path = require('path');
const seed = require('../seed-data');

const LOGIN_DOMAIN = process.env.LOGIN_DOMAIN || 'gmail.com';   // harus sama dengan APP_CONFIG.FIREBASE_LOGIN_DOMAIN

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json')))
});

const auth = admin.auth();
const db = admin.firestore();

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

  for (const u of seed.users) {
    uidOf[u.id] = await ensureAuthUser(u);
    const student = seed.students.find((s) => s.userId === u.id);

    ops.push((b) => b.set(db.collection('users').doc(uidOf[u.id]), {
      name: u.name, username: u.username, usernameLower: u.username.toLowerCase(),
      role: u.role, status: u.status, email: u.email,
      ...(student ? { nis: student.nis } : {})
    }));
  }

  seed.classes.forEach((c) => {
    const { id, ...rest } = c;
    ops.push((b) => b.set(db.collection('classes').doc(id), rest));
  });

  seed.students.forEach((s) => {
    const { nis, ...rest } = s;
    ops.push((b) => b.set(db.collection('students').doc(nis), { ...rest, userId: s.userId ? uidOf[s.userId] : '' }));
  });

  seed.teachers.forEach((t) => {
    const { id, ...rest } = t;
    ops.push((b) => b.set(db.collection('teachers').doc(id), rest));
  });

  seed.schedules.forEach((j) => {
    const { id, ...rest } = j;
    ops.push((b) => b.set(db.collection('schedules').doc(id), rest));
  });

  seed.announcements.forEach((a) => {
    const { id, ...rest } = a;
    ops.push((b) => b.set(db.collection('announcements').doc(id), rest));
  });

  seed.permissions.forEach((p) => {
    const { id, daysAgo, ...rest } = p;
    ops.push((b) => b.set(db.collection('permissions').doc(id), { ...rest, date: seed.isoDate(daysAgo) }));
  });

  const nameOf = Object.fromEntries(seed.students.map((s) => [s.nis, s.name]));
  seed.buildAttendance().forEach((r) => {
    ops.push((b) => b.set(db.collection('attendance').doc(`${r.date}_${r.studentId}`), {
      studentId: r.studentId, name: nameOf[r.studentId], className: r.className,
      date: r.date, time: r.time || '-', status: r.status, note: r.note
    }));
  });

  await commit(ops);
  console.log(`✔ Seed Firebase selesai (${seed.users.length} akun, ${ops.length} dokumen).`);
  console.log('  Login demo: admin / admin123 — GANTI password sebelum dipakai sungguhan.');
})().catch((e) => { console.error('✘ Gagal:', e.message); process.exit(1); });
