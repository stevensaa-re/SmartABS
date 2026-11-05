const { createHash, randomBytes } = require('node:crypto');
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
const {
  CONFIGURATION_TYPES,
  relationKey,
  planConfigurationCopy
} = require('./semester-domain');

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

async function requireActiveSemesterSchedule(transaction, actor, schedule) {
  if (!actor.schoolId) return;
  const schoolSnapshot = await transaction.get(db.collection('schools').doc(actor.schoolId));
  if (!schoolSnapshot.exists || schoolSnapshot.get('status') !== 'Aktif') {
    fail('failed-precondition', 'Sekolah tidak aktif.');
  }
  const activeSemesterId = schoolSnapshot.get('activeSemesterId') || '';
  if ((activeSemesterId && schedule.semesterId !== activeSemesterId) ||
      (!activeSemesterId && schedule.semesterId)) {
    fail('failed-precondition', 'Jadwal tidak termasuk semester yang sedang aktif.');
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

function requireSchoolAdmin(actor) {
  if (!actor.schoolId) {
    fail('failed-precondition', 'Akun admin belum ditautkan ke schoolId. Lengkapi migrasi tenant terlebih dahulu.');
  }
}

async function getSemester(actor, semesterId) {
  if (typeof semesterId !== 'string' || !semesterId.trim() || semesterId.length > 128) {
    fail('invalid-argument', 'ID semester tidak valid.');
  }
  const ref = db.collection('semesters').doc(semesterId);
  const snapshot = await ref.get();
  if (!snapshot.exists) fail('not-found', 'Semester tidak ditemukan.');
  requireSameSchool(actor, snapshot.data());
  return { ref, snapshot, data: snapshot.data() };
}

function validateSemesterFields(input, existing = {}) {
  const name = typeof input?.name === 'string' ? input.name.trim() : existing.name || '';
  const academicYear = typeof input?.academicYear === 'string'
    ? input.academicYear.trim()
    : existing.academicYear || '';
  const term = typeof input?.term === 'string' ? input.term : existing.term || '';
  const startDate = typeof input?.startDate === 'string' ? input.startDate : existing.startDate || '';
  const endDate = typeof input?.endDate === 'string' ? input.endDate : existing.endDate || '';
  if (name.length < 3 || name.length > 100) fail('invalid-argument', 'Nama semester harus 3-100 karakter.');
  if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
    fail('invalid-argument', 'Tahun ajaran harus berformat YYYY/YYYY.');
  }
  if (!['Ganjil', 'Genap'].includes(term)) fail('invalid-argument', 'Pilih semester Ganjil atau Genap.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    fail('invalid-argument', 'Rentang tanggal semester tidak valid.');
  }
  return { name, academicYear, term, startDate, endDate };
}

function semesterConfigQuery(semesterId, schoolId) {
  return schoolQuery(
    db.collection('semesterConfigurations').where('semesterId', '==', semesterId),
    schoolId
  );
}

function semesterConfigRow(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    type: data.type,
    relationKey: data.sourceRelationKey || data.relationKey,
    payload: data.payload || {}
  };
}

function normalizeConfig(type, input) {
  if (!CONFIGURATION_TYPES.includes(type) || !input || typeof input !== 'object') {
    fail('invalid-argument', 'Jenis konfigurasi semester tidak valid.');
  }
  const text = (value, label, max = 100) => {
    const result = typeof value === 'string' ? value.trim() : '';
    if (!result || result.length > max) fail('invalid-argument', `${label} wajib diisi (maksimal ${max} karakter).`);
    return result;
  };
  if (type === 'periods') {
    const day = text(input.day, 'Hari', 12);
    const start = text(input.start, 'Jam mulai', 5);
    const end = text(input.end, 'Jam selesai', 5);
    if (!['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].includes(day) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) {
      fail('invalid-argument', 'Jam pelajaran tidak valid.');
    }
    return {
      day,
      start,
      end,
      label: typeof input.label === 'string' ? input.label.trim().slice(0, 60) : ''
    };
  }
  const className = text(input.className, 'Kelas', 50);
  const classId = typeof input.classId === 'string' ? input.classId.trim() : '';
  if (type === 'subjects') {
    return { classId, className, subject: text(input.subject, 'Mata pelajaran') };
  }
  if (type === 'teacherAssignments') {
    return {
      classId,
      className,
      subject: text(input.subject, 'Mata pelajaran'),
      teacherUid: text(input.teacherUid, 'Akun guru', 128),
      teacherName: text(input.teacherName, 'Nama guru')
    };
  }
  if (type === 'schedules') {
    const day = text(input.day, 'Hari', 12);
    if (!['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].includes(day)) {
      fail('invalid-argument', 'Hari jadwal tidak valid.');
    }
    const start = text(input.start, 'Jam mulai', 5);
    const end = text(input.end, 'Jam selesai', 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) {
      fail('invalid-argument', 'Jam jadwal tidak valid.');
    }
    return {
      classId,
      className,
      subject: text(input.subject, 'Mata pelajaran'),
      teacherUid: text(input.teacherUid, 'Akun guru', 128),
      teacherName: text(input.teacherName, 'Nama guru'),
      day,
      start,
      end
    };
  }
  const capacity = Number(input.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    fail('invalid-argument', 'Kapasitas kelas harus 1-500 siswa.');
  }
  return {
    classId,
    className,
    level: typeof input.level === 'string' ? input.level.trim().slice(0, 50) : '',
    major: typeof input.major === 'string' ? input.major.trim().slice(0, 80) : '',
    homeroom: typeof input.homeroom === 'string' ? input.homeroom.trim().slice(0, 100) : '',
    capacity
  };
}

function semesterDocumentId(semesterId, type, key) {
  return createHash('sha256')
    .update(`${semesterId}\u0000${type}\u0000${key}`)
    .digest('hex');
}

async function sourceLegacyRows(actor, sourceSemester, type) {
  if (sourceSemester.data.initializedTypes?.[type] === true) return [];
  if (type === 'classes') {
    const snapshot = await schoolQuery(db.collection('classes'), actor.schoolId).get();
    return snapshot.docs.map((doc) => ({
      classId: doc.id,
      className: doc.get('name') || '',
      level: doc.get('level') || '',
      major: doc.get('major') || '',
      homeroom: doc.get('homeroom') || '',
      capacity: Number(doc.get('capacity') || 36)
    })).map((payload) => ({ type, payload, relationKey: relationKey(type, payload) }));
  }

  const allSchedules = await schoolQuery(db.collection('schedules'), actor.schoolId).get();
  let schedules = allSchedules.docs.filter((doc) => doc.get('semesterId') === sourceSemester.snapshot.id);
  if (!schedules.length && !sourceSemester.data.initializedTypes?.schedules &&
      !sourceSemester.data.preferSemesterSchedules) {
    schedules = allSchedules.docs.filter((doc) => !doc.get('semesterId'));
  }
  const schedulePayloads = schedules.map((doc) => ({
    classId: doc.get('classId') || '',
    className: doc.get('className') || '',
    subject: doc.get('subject') || '',
    teacherUid: doc.get('teacherUid') || '',
    teacherName: doc.get('teacher') || doc.get('teacherName') || '',
    day: doc.get('day') || '',
    start: doc.get('start') || '',
    end: doc.get('end') || ''
  })).filter((row) => row.className && row.subject);

  if (type === 'schedules') {
    return schedulePayloads.map((row) => {
      const payload = normalizeConfig(type, row);
      return { type, payload, relationKey: relationKey(type, payload) };
    });
  }
  if (type === 'periods') {
    const unique = new Map();
    for (const schedule of schedulePayloads) {
      const payload = normalizeConfig(type, {
        day: schedule.day, start: schedule.start, end: schedule.end, label: ''
      });
      unique.set(relationKey(type, payload), payload);
    }
    return [...unique.values()].map((payload) => ({ type, payload, relationKey: relationKey(type, payload) }));
  }
  if (type === 'subjects') {
    const unique = new Map();
    for (const schedule of schedulePayloads) {
      const payload = normalizeConfig(type, schedule);
      unique.set(relationKey(type, payload), payload);
    }
    return [...unique.values()].map((payload) => ({ type, payload, relationKey: relationKey(type, payload) }));
  }

  const unique = new Map();
  for (const schedule of schedulePayloads) {
    if (!schedule.teacherUid || !schedule.teacherName) continue;
    const payload = normalizeConfig(type, schedule);
    unique.set(relationKey(type, payload), payload);
  }
  if (unique.size) {
    return [...unique.values()].map((payload) => ({ type, payload, relationKey: relationKey(type, payload) }));
  }

  const teacherSnapshot = await schoolQuery(db.collection('teachers'), actor.schoolId).get();
  for (const teacher of teacherSnapshot.docs) {
    const username = String(teacher.get('username') || '').trim().toLowerCase();
    const users = await schoolQuery(db.collection('users'), actor.schoolId)
      .where('usernameLower', '==', username).limit(2).get();
    if (!username || users.size !== 1 || users.docs[0].get('role') !== 'guru') continue;
    const payload = normalizeConfig(type, {
      className: String(teacher.get('className') || ''),
      subject: String(teacher.get('subject') || ''),
      teacherUid: users.docs[0].id,
      teacherName: String(teacher.get('name') || '')
    });
    unique.set(relationKey(type, payload), payload);
  }
  return [...unique.values()].map((payload) => ({ type, payload, relationKey: relationKey(type, payload) }));
}

async function sourceConfiguration(actor, sourceSemester) {
  const snapshot = await semesterConfigQuery(sourceSemester.snapshot.id, actor.schoolId).get();
  const configured = snapshot.docs.map(semesterConfigRow);
  const configuredTypes = new Set(configured.map((row) => row.type));
  const rows = [...configured];
  for (const type of CONFIGURATION_TYPES) {
    if (configuredTypes.has(type)) continue;
    rows.push(...await sourceLegacyRows(actor, sourceSemester, type));
  }
  return rows;
}

function groupedPlan(plan) {
  const categories = {};
  for (const type of CONFIGURATION_TYPES) {
    categories[type] = {
      toCreate: plan.planned.filter((row) => row.type === type).length,
      alreadyExists: plan.skipped.filter((row) => row.type === type).length
    };
  }
  return { categories, conflicts: plan.conflicts };
}

function copySelection(input) {
  if (!Array.isArray(input) || !input.length ||
      input.some((type) => !CONFIGURATION_TYPES.includes(type))) {
    fail('invalid-argument', 'Pilih minimal satu jenis konfigurasi yang valid.');
  }
  return [...new Set(input)];
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
    await requireActiveSemesterSchedule(transaction, actor, schedule);
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

exports.getActiveSemester = onCall({ region: REGION }, async (request) => {
  const actor = await requireActiveUser(request);
  if (!actor.schoolId) return { id: '' };
  const schoolSnapshot = await db.collection('schools').doc(actor.schoolId).get();
  if (!schoolSnapshot.exists || schoolSnapshot.get('status') !== 'Aktif') {
    fail('failed-precondition', 'Sekolah tidak aktif.');
  }
  return { id: schoolSnapshot.get('activeSemesterId') || '' };
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
    await requireActiveSemesterSchedule(transaction, actor, schedule);
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

exports.createSemester = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  requireSchoolAdmin(actor);
  const fields = validateSemesterFields(request.data);
  const importCurrentConfiguration = request.data?.importCurrentConfiguration === true;
  const nameLower = fields.name.toLocaleLowerCase('id');
  const duplicate = await schoolQuery(
    db.collection('semesters').where('nameLower', '==', nameLower),
    actor.schoolId
  ).limit(1).get();
  if (!duplicate.empty) fail('already-exists', 'Semester dengan nama tersebut sudah ada.');
  const ref = db.collection('semesters').doc();
  const schoolSnapshot = await db.collection('schools').doc(actor.schoolId).get();
  if (!schoolSnapshot.exists || schoolSnapshot.get('status') !== 'Aktif') {
    fail('failed-precondition', 'Sekolah tidak aktif.');
  }
  const activeSemesterId = schoolSnapshot.get('activeSemesterId') || '';
  const currentSemesterId = activeSemesterId || ref.id;
  const importedRowsResult = importCurrentConfiguration
    ? (await Promise.all(CONFIGURATION_TYPES.map((type) =>
      sourceLegacyRows(actor, {
        snapshot: { id: currentSemesterId },
        data: {
          initializedTypes: {},
          preferSemesterSchedules: Boolean(activeSemesterId)
        }
      }, type)
    ))).flat()
    : [];
  const importedRows = [...new Map(importedRowsResult.map((row) =>
    [`${row.type}:${row.relationKey}`, row]
  )).values()];
  if (importedRows.length > 448) {
    fail('resource-exhausted', 'Konfigurasi saat ini melebihi 448 relasi; pecah persiapan ke beberapa semester.');
  }
  const audit = auditWrite(actor, 'create', 'semester', ref.id,
    `Membuat semester ${fields.name} sebagai draft${importCurrentConfiguration ? ' dengan snapshot konfigurasi saat ini' : ''}.`);
  const batch = db.batch();
  batch.set(ref, {
    ...fields,
    nameLower,
    status: 'Draft',
    initializedTypes: importCurrentConfiguration
      ? Object.fromEntries(CONFIGURATION_TYPES.map((type) => [type, true]))
      : {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    schoolId: actor.schoolId
  });
  for (const row of importedRows) {
    const configRef = db.collection('semesterConfigurations')
      .doc(semesterDocumentId(ref.id, row.type, row.relationKey));
    batch.create(configRef, {
      semesterId: ref.id,
      sourceSemesterId: 'legacy-current',
      type: row.type,
      relationKey: row.relationKey,
      sourceRelationKey: row.relationKey,
      payload: row.payload,
      schoolId: actor.schoolId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  batch.set(audit.ref, audit.data);
  await batch.commit();
  return {
    id: ref.id,
    ...fields,
    nameLower,
    status: 'Draft',
    importedConfigurationCount: importedRows.length,
    schoolId: actor.schoolId
  };
});

exports.updateSemester = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  requireSchoolAdmin(actor);
  const { ref, data: current } = await getSemester(actor, request.data?.semesterId);
  if (current.status !== 'Draft') fail('failed-precondition', 'Semester hanya dapat diedit sebelum diaktifkan.');
  const fields = validateSemesterFields(request.data, current);
  const nameLower = fields.name.toLocaleLowerCase('id');
  const duplicate = await schoolQuery(
    db.collection('semesters').where('nameLower', '==', nameLower),
    actor.schoolId
  ).limit(2).get();
  if (duplicate.docs.some((doc) => doc.id !== ref.id)) {
    fail('already-exists', 'Semester dengan nama tersebut sudah ada.');
  }
  const audit = auditWrite(actor, 'update', 'semester', ref.id,
    `Memperbarui konfigurasi draft ${fields.name}.`);
  const batch = db.batch();
  batch.update(ref, { ...fields, nameLower, updatedAt: FieldValue.serverTimestamp() });
  batch.set(audit.ref, audit.data);
  await batch.commit();
  return { id: ref.id, ...fields, nameLower, status: current.status, schoolId: actor.schoolId };
});

async function prepareSemesterCopy(actor, input) {
  requireSchoolAdmin(actor);
  const sourceId = typeof input?.sourceSemesterId === 'string' ? input.sourceSemesterId : '';
  const targetId = typeof input?.targetSemesterId === 'string' ? input.targetSemesterId : '';
  if (!sourceId || !targetId || sourceId === targetId) {
    fail('invalid-argument', 'Pilih semester sumber dan tujuan yang berbeda.');
  }
  const selectedTypes = copySelection(input.types);
  const [source, target] = await Promise.all([
    getSemester(actor, sourceId),
    getSemester(actor, targetId)
  ]);
  if (source.data.status === 'Draft') {
    fail('failed-precondition', 'Semester sumber harus sudah diaktifkan atau diarsipkan.');
  }
  if (target.data.status !== 'Draft') {
    fail('failed-precondition', 'Semester tujuan harus berstatus Draft agar dapat diedit.');
  }
  const [sourceRows, existingSnapshot] = await Promise.all([
    sourceConfiguration(actor, source),
    semesterConfigQuery(targetId, actor.schoolId).get()
  ]);
  const existingRows = existingSnapshot.docs.map(semesterConfigRow);
  const plan = planConfigurationCopy(sourceRows, existingRows, selectedTypes);
  return { source, target, selectedTypes, existingRows, plan };
}

exports.previewSemesterConfigurationCopy = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  const prepared = await prepareSemesterCopy(actor, request.data);
  return {
    sourceSemesterId: prepared.source.snapshot.id,
    targetSemesterId: prepared.target.snapshot.id,
    selectedTypes: prepared.selectedTypes,
    ...groupedPlan(prepared.plan),
    excludedCollections: ['attendance', 'attendanceSessions', 'attendanceSessionLocks'],
    totalToCreate: prepared.plan.planned.length,
    totalAlreadyExists: prepared.plan.skipped.length
  };
});

exports.copySemesterConfiguration = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  const prepared = await prepareSemesterCopy(actor, request.data);
  if (prepared.plan.conflicts.length) {
    fail('failed-precondition', 'Konflik konfigurasi ditemukan. Perbaiki konflik sebelum menyalin.');
  }
  if (prepared.plan.planned.length > 450) {
    fail('resource-exhausted', 'Salinan melebihi 450 relasi. Pilih kategori lebih sedikit lalu ulangi.');
  }

  const targetRef = prepared.target.ref;
  const configQuery = semesterConfigQuery(targetRef.id, actor.schoolId);
  const configRefs = prepared.plan.planned.map((row) =>
    db.collection('semesterConfigurations')
      .doc(semesterDocumentId(targetRef.id, row.type, row.relationKey))
  );
  const audit = auditWrite(actor, 'copy', 'semesterConfiguration', targetRef.id,
    `Menyalin konfigurasi dari ${prepared.source.data.name} ke ${prepared.target.data.name}.`);
  const result = await db.runTransaction(async (transaction) => {
    const targetSnapshot = await transaction.get(targetRef);
    if (!targetSnapshot.exists || targetSnapshot.get('status') !== 'Draft' ||
        !sameSchool(actor.schoolId, targetSnapshot.data())) {
      fail('failed-precondition', 'Semester tujuan tidak lagi dapat diedit.');
    }
    const liveConfigSnapshot = await transaction.get(configQuery);
    const liveRows = liveConfigSnapshot.docs.map(semesterConfigRow);
    const livePlan = planConfigurationCopy(prepared.plan.planned.map((row) => ({
      ...row,
      type: row.type
    })), liveRows, prepared.selectedTypes);
    if (livePlan.conflicts.length) {
      fail('failed-precondition', 'Konfigurasi tujuan berubah dan kini memiliki konflik.');
    }
    const refsByKey = new Map(prepared.plan.planned.map((row, index) => [
      `${row.type}:${row.relationKey}`,
      configRefs[index]
    ]));
    const writeRows = livePlan.planned.filter((row) =>
      !liveRows.some((existing) =>
        existing.type === row.type &&
        (existing.relationKey || relationKey(existing.type, existing.payload)) === row.relationKey
      )
    );
    const refsToWrite = writeRows.map((row) =>
      refsByKey.get(`${row.type}:${row.relationKey}`) ||
      db.collection('semesterConfigurations')
        .doc(semesterDocumentId(targetRef.id, row.type, row.relationKey))
    );
    const existingDeterministic = refsToWrite.length
      ? await transaction.getAll(...refsToWrite)
      : [];
    const alreadyPresentIds = new Set(existingDeterministic.filter((doc) => doc.exists).map((doc) => doc.id));
    const createdByType = Object.fromEntries(CONFIGURATION_TYPES.map((type) => [type, 0]));
    for (let index = 0; index < writeRows.length; index++) {
      const row = writeRows[index];
      const ref = refsToWrite[index];
      if (alreadyPresentIds.has(ref.id)) continue;
      transaction.create(ref, {
        semesterId: targetRef.id,
        sourceSemesterId: prepared.source.snapshot.id,
        type: row.type,
        relationKey: row.relationKey,
        sourceRelationKey: row.relationKey,
        payload: row.payload,
        schoolId: actor.schoolId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      createdByType[row.type]++;
    }
    const initializedTypes = {
      ...(targetSnapshot.get('initializedTypes') || {})
    };
    for (const type of prepared.selectedTypes) initializedTypes[type] = true;
    transaction.update(targetRef, {
      initializedTypes,
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(audit.ref, {
      ...audit.data,
      summary: `Menyalin dari ${prepared.source.data.name} ke ${prepared.target.data.name}; ` +
        `${Object.values(createdByType).reduce((sum, count) => sum + count, 0)} relasi baru.`
    });
    return {
      created: createdByType,
      totalCreated: Object.values(createdByType).reduce((sum, count) => sum + count, 0),
      totalAlreadyExists: prepared.plan.skipped.length +
        (writeRows.length - Object.values(createdByType).reduce((sum, count) => sum + count, 0))
    };
  });
  return result;
});

exports.updateSemesterConfiguration = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  requireSchoolAdmin(actor);
  const configId = typeof request.data?.configurationId === 'string' ? request.data.configurationId : '';
  if (!configId) fail('invalid-argument', 'ID konfigurasi tidak valid.');
  const configRef = db.collection('semesterConfigurations').doc(configId);
  const configSnapshot = await configRef.get();
  if (!configSnapshot.exists) fail('not-found', 'Konfigurasi semester tidak ditemukan.');
  requireSameSchool(actor, configSnapshot.data());
  const { ref: semesterRef, data: semester } = await getSemester(actor, configSnapshot.get('semesterId'));
  if (semester.status !== 'Draft') fail('failed-precondition', 'Konfigurasi hanya dapat diedit sebelum semester diaktifkan.');
  const type = configSnapshot.get('type');
  const payload = normalizeConfig(type, request.data?.payload);
  const existingSnapshot = await semesterConfigQuery(semesterRef.id, actor.schoolId).get();
  const existingRows = existingSnapshot.docs
    .filter((doc) => doc.id !== configId)
    .map(semesterConfigRow);
  const candidate = { type, payload, relationKey: relationKey(type, payload) };
  const plan = planConfigurationCopy([candidate], existingRows, [type]);
  if (plan.conflicts.length) fail('failed-precondition', 'Perubahan menimbulkan konflik konfigurasi.');
  if (!plan.planned.length) fail('already-exists', 'Relasi konfigurasi tersebut sudah tersedia.');
  const audit = auditWrite(actor, 'update', 'semesterConfiguration', configId,
    `Mengedit konfigurasi ${type} pada ${semester.name}.`);
  const batch = db.batch();
  batch.update(configRef, {
    payload,
    relationKey: candidate.relationKey,
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.update(semesterRef, { updatedAt: FieldValue.serverTimestamp() });
  batch.set(audit.ref, audit.data);
  await batch.commit();
  return { id: configId, type, payload, relationKey: candidate.relationKey };
});

exports.deleteSemesterConfiguration = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  requireSchoolAdmin(actor);
  const configId = typeof request.data?.configurationId === 'string' ? request.data.configurationId : '';
  if (!configId) fail('invalid-argument', 'ID konfigurasi tidak valid.');
  const configRef = db.collection('semesterConfigurations').doc(configId);
  const configSnapshot = await configRef.get();
  if (!configSnapshot.exists) return { deleted: false };
  requireSameSchool(actor, configSnapshot.data());
  const { ref: semesterRef, data: semester } = await getSemester(actor, configSnapshot.get('semesterId'));
  if (semester.status !== 'Draft') fail('failed-precondition', 'Konfigurasi hanya dapat dihapus sebelum semester diaktifkan.');
  const audit = auditWrite(actor, 'delete', 'semesterConfiguration', configId,
    `Menghapus konfigurasi ${configSnapshot.get('type')} dari ${semester.name}.`);
  const batch = db.batch();
  batch.delete(configRef);
  batch.update(semesterRef, { updatedAt: FieldValue.serverTimestamp() });
  batch.set(audit.ref, audit.data);
  await batch.commit();
  return { deleted: true };
});

exports.activateSemester = onCall({ region: REGION }, async (request) => {
  const actor = await requireAdmin(request);
  requireSchoolAdmin(actor);
  const semesterId = typeof request.data?.semesterId === 'string' ? request.data.semesterId : '';
  const semesterRef = db.collection('semesters').doc(semesterId);
  const schoolRef = db.collection('schools').doc(actor.schoolId);
  const configQuery = semesterConfigQuery(semesterId, actor.schoolId);
  const activeQuery = schoolQuery(
    db.collection('semesters').where('status', '==', 'Aktif'),
    actor.schoolId
  );
  const classesQuery = schoolQuery(db.collection('classes'), actor.schoolId);
  const usersQuery = schoolQuery(db.collection('users'), actor.schoolId)
    .where('role', '==', 'guru').where('status', '==', 'Aktif');
  const audit = auditWrite(actor, 'activate', 'semester', semesterId,
    'Mengaktifkan semester dan menerapkan konfigurasi kelas serta jadwal.');

  return db.runTransaction(async (transaction) => {
    const [semesterSnapshot, schoolSnapshot, configSnapshot, activeSnapshot, classesSnapshot, usersSnapshot] =
      await Promise.all([
        transaction.get(semesterRef),
        transaction.get(schoolRef),
        transaction.get(configQuery),
        transaction.get(activeQuery),
        transaction.get(classesQuery),
        transaction.get(usersQuery)
      ]);
    if (!semesterSnapshot.exists) fail('not-found', 'Semester tidak ditemukan.');
    requireSameSchool(actor, semesterSnapshot.data());
    if (!schoolSnapshot.exists || schoolSnapshot.get('status') !== 'Aktif') {
      fail('failed-precondition', 'Sekolah tidak aktif.');
    }
    if (semesterSnapshot.get('status') === 'Aktif' &&
        schoolSnapshot.get('activeSemesterId') === semesterId) {
      return { active: true, alreadyActive: true, scheduleCount: 0 };
    }
    if (semesterSnapshot.get('status') !== 'Draft') {
      fail('failed-precondition', 'Hanya semester Draft yang dapat diaktifkan.');
    }
    const rows = configSnapshot.docs.map(semesterConfigRow);
    const schedules = rows.filter((row) => row.type === 'schedules');
    const classConfigs = rows.filter((row) => row.type === 'classes');
    if (schedules.length + classConfigs.length + activeSnapshot.size + 2 > 450) {
      fail('resource-exhausted', 'Semester memiliki terlalu banyak jadwal/kelas untuk diaktifkan secara aman.');
    }
    const schedulePlan = planConfigurationCopy(rows, [], ['teacherAssignments', 'schedules']);
    if (schedulePlan.conflicts.length) {
      fail('failed-precondition', 'Masih ada konflik jadwal atau penugasan guru pada semester tujuan.');
    }

    const classesById = new Map(classesSnapshot.docs.map((doc) => [doc.id, doc]));
    const classesByName = new Map();
    for (const doc of classesSnapshot.docs) {
      const key = String(doc.get('name') || '').toLocaleLowerCase('id');
      const group = classesByName.get(key) || [];
      group.push(doc);
      classesByName.set(key, group);
    }
    const classUpdates = [];
    for (const row of classConfigs) {
      const payload = row.payload;
      const classDoc = payload.classId
        ? classesById.get(payload.classId)
        : (classesByName.get(String(payload.className).toLocaleLowerCase('id')) || [])[0];
      if (!classDoc || !sameSchool(actor.schoolId, classDoc.data())) {
        fail('failed-precondition', `Kelas ${payload.className} tidak ditemukan pada sekolah ini.`);
      }
      classUpdates.push({
        ref: classDoc.ref,
        data: {
          level: payload.level || '',
          major: payload.major || '',
          homeroom: payload.homeroom || '',
          capacity: payload.capacity
        }
      });
    }
    const teachers = new Map(usersSnapshot.docs.map((doc) => [doc.id, doc]));
    const classesByNameUnique = new Map(
      [...classesByName].filter(([, values]) => values.length === 1).map(([name, values]) => [name, values[0]])
    );
    const scheduleWrites = [];
    for (const row of schedules) {
      const payload = row.payload;
      const classDoc = payload.classId
        ? classesById.get(payload.classId)
        : classesByNameUnique.get(String(payload.className).toLocaleLowerCase('id'));
      const teacher = teachers.get(payload.teacherUid);
      if (!classDoc || classDoc.get('name') !== payload.className) {
        fail('failed-precondition', `Kelas jadwal ${payload.className} tidak valid atau namanya berubah.`);
      }
      if (!teacher) fail('failed-precondition', `Akun guru ${payload.teacherName} tidak aktif atau tidak tersedia.`);
      const scheduleData = {
        semesterId,
        classId: classDoc.id,
        className: payload.className,
        subject: payload.subject,
        teacher: payload.teacherName,
        teacherUid: payload.teacherUid,
        day: payload.day,
        start: payload.start,
        end: payload.end,
        schoolId: actor.schoolId
      };
      const scheduleId = semesterDocumentId(semesterId, 'active-schedule', row.relationKey);
      scheduleWrites.push({ ref: db.collection('schedules').doc(scheduleId), data: scheduleData });
    }
    const currentSchedules = scheduleWrites.length
      ? await transaction.getAll(...scheduleWrites.map((entry) => entry.ref))
      : [];
    if (currentSchedules.some((doc) => doc.exists)) {
      fail('failed-precondition', 'Sebagian jadwal semester sudah diterapkan. Periksa status semester sebelum mencoba lagi.');
    }
    activeSnapshot.docs.forEach((doc) => {
      if (doc.id !== semesterId) {
        transaction.update(doc.ref, {
          status: 'Arsip',
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    });
    for (const entry of scheduleWrites) transaction.create(entry.ref, {
      ...entry.data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    for (const entry of classUpdates) transaction.update(entry.ref, {
      ...entry.data,
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.update(semesterRef, {
      status: 'Aktif',
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.update(schoolRef, {
      activeSemesterId: semesterId,
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(audit.ref, audit.data);
    return { active: true, alreadyActive: false, scheduleCount: scheduleWrites.length };
  });
});