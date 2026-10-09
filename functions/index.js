const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

const db = getFirestore();
const auth = getAuth();
const allowedRoles = new Set(['admin', 'guru', 'siswa']);
const allowedStatuses = new Set(['Aktif', 'Nonaktif']);

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Silakan login kembali.');
  const profile = await db.collection('users').doc(request.auth.uid).get();
  if (!profile.exists || profile.get('role') !== 'admin' || profile.get('status') !== 'Aktif') {
    throw new HttpsError('permission-denied', 'Hanya admin aktif yang dapat mengelola akun.');
  }
  return request.auth.uid;
}

function validateUserPayload(data) {
  const name = String(data.name || '').trim();
  const role = String(data.role || '');
  const status = String(data.status || 'Aktif');
  const email = String(data.email || '').trim();
  const password = typeof data.password === 'string' ? data.password : '';

  if (name.length < 3 || name.length > 100) {
    throw new HttpsError('invalid-argument', 'Nama harus 3 sampai 100 karakter.');
  }
  if (!allowedRoles.has(role)) throw new HttpsError('invalid-argument', 'Role tidak valid.');
  if (!allowedStatuses.has(status)) throw new HttpsError('invalid-argument', 'Status tidak valid.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) {
    throw new HttpsError('invalid-argument', 'Format email tidak valid.');
  }
  if (password && (password.length < 6 || password.length > 128)) {
    throw new HttpsError('invalid-argument', 'Password harus 6 sampai 128 karakter.');
  }
  return { name, role, status, email, password };
}

exports.updateManagedUser = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data.uid || '');
  if (!uid) throw new HttpsError('invalid-argument', 'UID pengguna wajib diisi.');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Pengguna tidak ditemukan.');
  const current = userSnap.data();
  const next = validateUserPayload({
    name: request.data.name ?? current.name,
    role: request.data.role ?? current.role,
    status: request.data.status ?? current.status,
    email: request.data.email ?? current.email,
    password: request.data.password || ''
  });
  if (uid === adminUid && (next.status !== 'Aktif' || next.role !== 'admin')) {
    throw new HttpsError('failed-precondition', 'Admin tidak dapat menonaktifkan atau mengubah role akunnya sendiri.');
  }

  if (next.role !== current.role) {
    const [teacher, student] = await Promise.all([
      db.collection('teachers').where('username', '==', current.username).limit(1).get(),
      db.collection('students').where('userId', '==', uid).limit(1).get()
    ]);
    if (!teacher.empty || !student.empty) {
      throw new HttpsError('failed-precondition', 'Lepas atau hapus profil guru/siswa sebelum mengganti role akun.');
    }
  }

  const profilePatch = {
    name: next.name,
    role: next.role,
    status: next.status,
    email: next.email
  };
  await userRef.update(profilePatch);

  try {
    const authPatch = {
      displayName: next.name,
      disabled: next.status !== 'Aktif'
    };
    if (next.password) authPatch.password = next.password;
    await auth.updateUser(uid, authPatch);
  } catch (error) {
    await userRef.update({
      name: current.name,
      role: current.role,
      status: current.status,
      email: current.email || ''
    }).catch(() => {});
    throw new HttpsError('internal', 'Perubahan akun Authentication gagal; perubahan profil dibatalkan.');
  }

  return { ok: true, uid };
});

exports.deleteManagedUser = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data.uid || '');
  if (!uid) throw new HttpsError('invalid-argument', 'UID pengguna wajib diisi.');
  if (uid === adminUid) throw new HttpsError('failed-precondition', 'Admin tidak dapat menghapus akun yang sedang digunakan.');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { ok: true, uid, alreadyDeleted: true };

  const username = String(userSnap.get('username') || '');
  await userRef.update({ status: 'Nonaktif' });

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', 'Akun Authentication gagal dihapus. Profil dinonaktifkan; ulangi hapus untuk mencoba kembali.');
    }
  }

  const [studentDocs, teacherDocs] = await Promise.all([
    db.collection('students').where('userId', '==', uid).get(),
    db.collection('teachers').where('username', '==', username).get()
  ]);
  const batch = db.batch();
  studentDocs.docs.forEach((doc) => batch.update(doc.ref, { userId: '' }));
  teacherDocs.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(userRef);
  await batch.commit().catch((error) => {
    throw new HttpsError('internal', `Akun Auth terhapus, tetapi pembersihan profil Firestore perlu dicoba ulang: ${error.message}`);
  });

  return { ok: true, uid };
});
