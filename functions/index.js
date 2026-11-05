const { randomBytes } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  sameSchool,
  validateAccount,
  validateStudent,
  validateTeacher
} = require('./domain');

initializeApp();

const db = getFirestore();
const auth = getAuth();
const REGION = 'asia-southeast1';

function fail(code, message) {
  throw new HttpsError(code, message);
}

async function requireActiveUser(request) {
  if (!request.auth) fail('unauthenticated', 'Silakan login kembali.');
  const userRef = db.collection('users').doc(request.auth.uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists || snapshot.get('status') !== 'Aktif') {
    fail('permission-denied', 'Akun aktif tidak ditemukan.');
  }
  const profile = snapshot.data();
  let schoolTimeZone = 'Asia/Jakarta';
  if (profile.schoolId) {
    const schoolSnapshot = await db.collection('schools').doc(profile.schoolId).get();
    if (!schoolSnapshot.exists || schoolSnapshot.get('status') !== 'Aktif') {
      fail('permission-denied', 'Sekolah akun ini tidak aktif atau belum dikonfigurasi.');
    }
    schoolTimeZone = schoolSnapshot.get('timeZone') || schoolTimeZone;
  }
  return { ref: userRef, uid: request.auth.uid, ...profile, schoolTimeZone };
}

async function requireAdmin(request) {
  const actor = await requireActiveUser(request);
  if (actor.role !== 'admin') fail('permission-denied', 'Hanya admin sekolah yang dapat melakukan tindakan ini.');
  return actor;
}

function requireSameSchool(actor, ...records) {
  if (!sameSchool(actor.schoolId, ...records)) {
    fail('permission-denied', 'Data berada di sekolah yang berbeda atau belum dimigrasikan ke sekolah ini.');
  }
}

async function assertUsernameAvailable(usernameLower) {
  const users = await db.collection('users')
    .where('usernameLower', '==', usernameLower).limit(1).get();
  if (!users.empty) fail('already-exists', 'Username sudah digunakan.');
}

function schoolQuery(query, schoolId) {
  return schoolId ? query.where('schoolId', '==', schoolId) : query;
}

function dateInTimeZone(timeZone, instant = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function auditWrite(actor, action, entity, entityId, summary) {
  const ref = db.collection('auditLogs').doc();
  return {
    ref,
    data: {
      actorUid: actor.uid,
      actorName: actor.name || '',
      actorRole: actor.role,
      action,
      entity,
      entityId,
      summary,
      ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
      createdAt: FieldValue.serverTimestamp()
    }
  };
}

async function createAuthUser(account) {
  try {
    return await auth.createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
      disabled: account.status === 'Nonaktif'
    });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') fail('already-exists', 'Email login sudah digunakan.');
    if (error.code === 'auth/invalid-password') fail('invalid-argument', 'Password minimal 6 karakter.');
    throw error;
  }
}

async function commitWithAuthRollback(user, batch, operation) {
  try {
    await batch.commit();
  } catch (error) {
    try {
      await auth.deleteUser(user.uid);
    } catch (cleanupError) {
      logger.error('Failed to remove Auth user after Firestore provisioning failure.', {
        uid: user.uid,
        operation,
        error: cleanupError
      });
      fail('internal', 'Profil gagal disimpan dan akun Auth sementara tidak dapat dibersihkan. Hubungi administrator.');
    }
    logger.error('Firestore account provisioning failed; the temporary Auth user was removed.', {
      uid: user.uid,
      operation,
      error
    });
    fail('internal', 'Akun gagal disimpan. Silakan periksa data lalu coba kembali.');
  }
}

exports.createUser = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  let account;
  try {
    account = validateAccount(request.data, request.data?.role);
  } catch (error) {
    fail('invalid-argument', error.message);
  }
  await assertUsernameAvailable(account.usernameLower);

  const user = await createAuthUser(account);
  const userRef = db.collection('users').doc(user.uid);
  const profile = {
    name: account.name,
    username: account.username,
    usernameLower: account.usernameLower,
    role: account.role,
    status: account.status,
    email: account.email,
    ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
    createdAt: FieldValue.serverTimestamp()
  };
  const audit = auditWrite(actor, 'create', 'user', user.uid,
    `Membuat akun ${account.username} dengan role ${account.role}.`);
  const batch = db.batch();
  batch.set(userRef, profile);
  batch.set(audit.ref, audit.data);
  await commitWithAuthRollback(user, batch, 'createUser');
  return { id: user.uid, ...profile, createdAt: new Date().toISOString() };
});

exports.createTeacherAccount = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  let account;
  let teacher;
  try {
    account = validateAccount(request.data?.account, 'guru');
    teacher = validateTeacher(request.data?.teacher);
  } catch (error) {
    fail('invalid-argument', error.message);
  }
  await assertUsernameAvailable(account.usernameLower);

  const classQuery = schoolQuery(
    db.collection('classes').where('name', '==', teacher.className),
    actor.schoolId
  );
  const scopedClassSnapshot = await classQuery.limit(2).get();
  if (scopedClassSnapshot.size !== 1) fail('failed-precondition', 'Kelas tidak ditemukan atau namanya tidak unik.');
  requireSameSchool(actor, scopedClassSnapshot.docs[0].data());

  const teacherMatches = await schoolQuery(
    db.collection('teachers').where('username', '==', account.username),
    actor.schoolId
  ).limit(1).get();
  if (!teacherMatches.empty) fail('already-exists', 'Profil guru dengan username ini sudah ada.');
  account.status = teacher.status;

  const user = await createAuthUser(account);
  const userRef = db.collection('users').doc(user.uid);
  const teacherRef = db.collection('teachers').doc();
  const profile = {
    name: account.name,
    username: account.username,
    usernameLower: account.usernameLower,
    role: 'guru',
    status: account.status,
    email: account.email,
    className: teacher.className,
    ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
    createdAt: FieldValue.serverTimestamp()
  };
  const teacherProfile = {
    name: account.name,
    username: account.username,
    subject: teacher.subject,
    className: teacher.className,
    status: teacher.status,
    ...(actor.schoolId ? { schoolId: actor.schoolId } : {})
  };
  const audit = auditWrite(actor, 'create', 'teacher', teacherRef.id,
    `Membuat akun dan profil guru ${account.name}.`);
  const batch = db.batch();
  batch.set(userRef, profile);
  batch.set(teacherRef, teacherProfile);
  batch.set(audit.ref, audit.data);
  await commitWithAuthRollback(user, batch, 'createTeacherAccount');
  return {
    teacher: { id: teacherRef.id, ...teacherProfile },
    user: {
      id: user.uid,
      name: profile.name,
      username: profile.username,
      usernameLower: profile.usernameLower,
      role: profile.role,
      status: profile.status,
      email: profile.email,
      schoolId: profile.schoolId || ''
    }
  };
});

exports.createStudentAccount = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  let account;
  let student;
  try {
    account = validateAccount(request.data?.account, 'siswa');
    student = validateStudent(request.data?.student);
  } catch (error) {
    fail('invalid-argument', error.message);
  }
  await assertUsernameAvailable(account.usernameLower);

  const classQuery = schoolQuery(
    db.collection('classes').where('name', '==', student.className),
    actor.schoolId
  );
  const scopedClassSnapshot = await classQuery.limit(2).get();
  if (scopedClassSnapshot.size !== 1) fail('failed-precondition', 'Kelas tidak ditemukan atau namanya tidak unik.');
  requireSameSchool(actor, scopedClassSnapshot.docs[0].data());
  const studentRef = db.collection('students').doc(student.nis);
  if ((await studentRef.get()).exists) fail('already-exists', 'NIS sudah terdaftar.');
  account.status = student.status;

  const user = await createAuthUser(account);
  const userRef = db.collection('users').doc(user.uid);
  const profile = {
    name: account.name,
    username: account.username,
    usernameLower: account.usernameLower,
    role: 'siswa',
    status: account.status,
    email: account.email,
    nis: student.nis,
    ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
    createdAt: FieldValue.serverTimestamp()
  };
  const studentProfile = {
    nis: student.nis,
    name: account.name,
    className: student.className,
    gender: student.gender,
    status: student.status,
    userId: user.uid,
    phone: student.phone,
    ...(actor.schoolId ? { schoolId: actor.schoolId } : {})
  };
  const audit = auditWrite(actor, 'create', 'student', student.nis,
    `Membuat akun dan profil siswa ${account.name} (${student.nis}).`);
  const batch = db.batch();
  batch.set(userRef, profile);
  batch.set(studentRef, studentProfile);
  batch.set(audit.ref, audit.data);
  await commitWithAuthRollback(user, batch, 'createStudentAccount');
  return {
    student: studentProfile,
    user: {
      id: user.uid,
      name: profile.name,
      username: profile.username,
      usernameLower: profile.usernameLower,
      role: profile.role,
      status: profile.status,
      email: profile.email,
      schoolId: profile.schoolId || ''
    }
  };
});

function randomToken() {
  return randomBytes(16).toString('hex');
}

function sessionView(id, data) {
  return {
    id,
    scheduleId: data.scheduleId,
    teacherUid: data.teacherUid,
    subject: data.subject,
    className: data.className,
    date: data.date,
    token: data.token,
    expiresAt: data.expiresAt.toMillis(),
    sessionStartedAtSeconds: data.createdAt.seconds,
    sessionStartedAtNanos: data.createdAt.nanoseconds
  };
}

exports.startAttendanceSession = onCall({ region: REGION }, async (request) => {
  const actor = await requireActiveUser(request);
  if (!['admin', 'guru'].includes(actor.role)) fail('permission-denied', 'Hanya guru atau admin yang dapat membuka sesi.');
  const scheduleId = typeof request.data?.scheduleId === 'string' ? request.data.scheduleId : '';
  const date = typeof request.data?.date === 'string' ? request.data.date : '';
  if (!scheduleId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('invalid-argument', 'Jadwal atau tanggal tidak valid.');
  const scheduleRef = db.collection('schedules').doc(scheduleId);
  const sessionRef = db.collection('attendanceSessions').doc();
  const lockScope = actor.schoolId || 'legacy';
  const lockRef = db.collection('attendanceSessionLocks').doc(`${lockScope}_${scheduleId}_${date}`);
  const now = Date.now();
  let serverDate;
  try {
    serverDate = dateInTimeZone(actor.schoolTimeZone);
  } catch {
    fail('failed-precondition', 'Zona waktu sekolah tidak valid. Periksa pengaturan sekolah.');
  }
  if (date !== serverDate) fail('failed-precondition', 'Sesi absensi hanya dapat dibuka untuk tanggal sekolah saat ini.');
  let sessionData;
  await db.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    if (!scheduleSnapshot.exists) fail('not-found', 'Jadwal mata pelajaran tidak ditemukan.');
    const schedule = scheduleSnapshot.data();
    requireSameSchool(actor, schedule);
    if (actor.role === 'guru' && schedule.teacherUid !== actor.uid) {
      fail('permission-denied', 'Jadwal ini tidak ditugaskan kepada akun Anda.');
    }
    if (!schedule.teacherUid) fail('failed-precondition', 'Jadwal belum memiliki akun guru yang ditautkan.');

    const lockSnapshot = await transaction.get(lockRef);
    if (lockSnapshot.exists && lockSnapshot.get('sessionId')) {
      const currentRef = db.collection('attendanceSessions').doc(lockSnapshot.get('sessionId'));
      const currentSnapshot = await transaction.get(currentRef);
      if (currentSnapshot.exists && currentSnapshot.get('active') === true &&
          currentSnapshot.get('expiresAt').toMillis() > now) {
        fail('already-exists', 'Sesi QR untuk jadwal ini masih aktif.');
      }
    }
    sessionData = {
      scheduleId,
      subject: schedule.subject,
      className: schedule.className,
      date,
      teacherUid: schedule.teacherUid,
      teacherName: schedule.teacher || actor.name || '',
      token: randomToken(),
      previousToken: '',
      active: true,
      expiresAt: Timestamp.fromMillis(now + 30_000),
      createdAt: Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
      ...(actor.schoolId ? { schoolId: actor.schoolId } : {})
    };
    transaction.set(sessionRef, sessionData);
    transaction.set(lockRef, {
      sessionId: sessionRef.id,
      scheduleId,
      date,
      ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return sessionView(sessionRef.id, sessionData);
});

exports.rotateAttendanceSession = onCall({ region: REGION }, async (request) => {
  const actor = await requireActiveUser(request);
  const sessionId = typeof request.data?.sessionId === 'string' ? request.data.sessionId : '';
  if (!sessionId) fail('invalid-argument', 'ID sesi tidak valid.');
  const ref = db.collection('attendanceSessions').doc(sessionId);
  const now = Date.now();
  const nextToken = randomToken();
  let result;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('not-found', 'Sesi absensi tidak ditemukan.');
    const current = snapshot.data();
    requireSameSchool(actor, current);
    if (actor.role !== 'admin' && current.teacherUid !== actor.uid) {
      fail('permission-denied', 'Anda tidak berhak mengubah sesi ini.');
    }
    if (current.active !== true) fail('failed-precondition', 'Sesi absensi sudah ditutup.');
    if (current.expiresAt.toMillis() <= now) fail('failed-precondition', 'Sesi QR sudah kedaluwarsa. Tutup lalu mulai sesi baru.');
    const updated = {
      ...current,
      token: nextToken,
      previousToken: current.token,
      expiresAt: Timestamp.fromMillis(now + 30_000),
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.update(ref, {
      token: updated.token,
      previousToken: updated.previousToken,
      expiresAt: updated.expiresAt,
      updatedAt: updated.updatedAt
    });
    result = sessionView(ref.id, updated);
  });
  return result;
});

exports.closeAttendanceSession = onCall({ region: REGION }, async (request) => {
  const actor = await requireActiveUser(request);
  const sessionId = typeof request.data?.sessionId === 'string' ? request.data.sessionId : '';
  if (!sessionId) fail('invalid-argument', 'ID sesi tidak valid.');
  const ref = db.collection('attendanceSessions').doc(sessionId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('not-found', 'Sesi absensi tidak ditemukan.');
    const session = snapshot.data();
    requireSameSchool(actor, session);
    if (actor.role !== 'admin' && session.teacherUid !== actor.uid) {
      fail('permission-denied', 'Anda tidak berhak menutup sesi ini.');
    }
    const lockScope = actor.schoolId || 'legacy';
    const lockRef = db.collection('attendanceSessionLocks')
      .doc(`${lockScope}_${session.scheduleId}_${session.date}`);
    const lock = await transaction.get(lockRef);
    transaction.update(ref, {
      active: false,
      closedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    if (lock.exists && lock.get('sessionId') === sessionId) {
      transaction.update(lockRef, { sessionId: '', updatedAt: FieldValue.serverTimestamp() });
    }
  });
  return { ok: true };
});

exports.submitQrAttendance = onCall({ region: REGION }, async (request) => {
  const actor = await requireActiveUser(request);
  if (actor.role !== 'siswa') fail('permission-denied', 'Hanya akun siswa aktif yang dapat melakukan absensi QR.');
  const sessionId = typeof request.data?.sessionId === 'string' ? request.data.sessionId : '';
  const token = typeof request.data?.token === 'string' ? request.data.token : '';
  if (!sessionId || !/^[a-f0-9]{32}$/.test(token)) fail('invalid-argument', 'QR absensi tidak valid.');
  const nis = typeof actor.nis === 'string' ? actor.nis : '';
  if (!nis) fail('failed-precondition', 'Akun belum ditautkan ke data siswa.');

  const studentRef = db.collection('students').doc(nis);
  const sessionRef = db.collection('attendanceSessions').doc(sessionId);
  const attendanceRef = db.collection('attendance').doc(`${sessionId}_${nis}`);
  const now = Date.now();
  let attendance;
  await db.runTransaction(async (transaction) => {
    const [studentSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(studentRef),
      transaction.get(sessionRef)
    ]);
    if (!studentSnapshot.exists || studentSnapshot.get('status') !== 'Aktif') {
      fail('failed-precondition', 'Data siswa tidak aktif atau tidak ditemukan.');
    }
    if (!sessionSnapshot.exists) fail('not-found', 'Sesi QR tidak ditemukan.');
    const student = studentSnapshot.data();
    const session = sessionSnapshot.data();
    requireSameSchool(actor, student, session);
    if (session.active !== true) fail('failed-precondition', 'Sesi absensi sudah ditutup.');
    if (session.expiresAt.toMillis() <= now) fail('deadline-exceeded', 'QR sudah kedaluwarsa.');
    if (session.token !== token && session.previousToken !== token) {
      fail('permission-denied', 'QR tidak valid atau sudah diperbarui.');
    }
    if (student.className !== session.className) fail('permission-denied', 'Anda bukan peserta kelas ini.');

    const scheduleRef = db.collection('schedules').doc(session.scheduleId);
    const scheduleSnapshot = await transaction.get(scheduleRef);
    if (!scheduleSnapshot.exists) fail('failed-precondition', 'Jadwal sesi tidak ditemukan.');
    const schedule = scheduleSnapshot.data();
    requireSameSchool(actor, schedule);
    if (schedule.className !== student.className ||
        schedule.teacherUid !== session.teacherUid ||
        schedule.subject !== session.subject) {
      fail('permission-denied', 'Jadwal sesi tidak sesuai dengan kelas siswa.');
    }

    const duplicate = await transaction.get(attendanceRef);
    if (duplicate.exists) fail('already-exists', 'Absensi mata pelajaran ini sudah tercatat.');
    attendance = {
      sessionId,
      scheduleId: session.scheduleId,
      teacherUid: session.teacherUid,
      subject: session.subject,
      studentId: nis,
      name: student.name,
      className: student.className,
      date: session.date,
      sessionStartedAt: session.createdAt,
      time: FieldValue.serverTimestamp(),
      status: 'Hadir',
      source: 'qr',
      note: `Absensi QR · ${session.subject}`,
      createdAt: FieldValue.serverTimestamp(),
      ...(actor.schoolId ? { schoolId: actor.schoolId } : {})
    };
    transaction.create(attendanceRef, attendance);
  });
  return {
    id: attendanceRef.id,
    sessionId: attendance.sessionId,
    scheduleId: attendance.scheduleId,
    subject: attendance.subject,
    studentId: attendance.studentId,
    name: attendance.name,
    className: attendance.className,
    date: attendance.date,
    status: attendance.status,
    source: attendance.source,
    ...(attendance.schoolId ? { schoolId: attendance.schoolId } : {})
  };
});