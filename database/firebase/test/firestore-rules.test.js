const { before, test } = require('node:test');

const projectId = process.env.GCLOUD_PROJECT || 'demo-smartabs-rules';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const firestoreBase =
  `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const documentNamePrefix =
  `projects/${projectId}/databases/(default)/documents`;
const identities = {};
let sessionStart;

before(async () => {
  for (const [key, role, nis, schoolId] of [
    ['admin', 'admin'],
    ['teacherA', 'guru'],
    ['teacherB', 'guru'],
    ['studentA', 'siswa', 'NIS-1'],
    ['tenantAdminA', 'admin', '', 'school-a'],
    ['tenantAdminB', 'admin', '', 'school-b']
  ]) {
    identities[key] = await createIdentity(role, nis, schoolId);
  }

  const seedResult = await commit([
    updateWrite('schools/school-a', {
      status: string('Aktif'),
      timeZone: string('Asia/Jakarta')
    }, [], false),
    updateWrite('schools/school-b', {
      status: string('Aktif'),
      timeZone: string('Asia/Jakarta')
    }, [], false),
    ...Object.values(identities).map((identity) => updateWrite(
      `users/${identity.uid}`,
      {
        role: string(identity.role),
        status: string('Aktif'),
        name: string(identity.role),
        username: string(identity.uid),
        ...(identity.role === 'guru' ? { className: string('Class One') } : {}),
        ...(identity.nis ? { nis: string(identity.nis) } : {}),
        ...(identity.schoolId ? { schoolId: string(identity.schoolId) } : {})
      },
      [],
      false
    )),
    updateWrite('students/NIS-1', {
      nis: string('NIS-1'),
      name: string('Student One'),
      className: string('Class One'),
      status: string('Aktif')
    }, [], false),
    updateWrite('classes/tenant-class-a', {
      name: string('Tenant Class A'),
      schoolId: string('school-a')
    }, [], false),
    updateWrite('classes/tenant-class-b', {
      name: string('Tenant Class B'),
      schoolId: string('school-b')
    }, [], false),
    updateWrite('schedules/schedule-a', {
      teacherUid: string(identities.teacherA.uid),
      teacher: string('Teacher A'),
      className: string('Class One'),
      subject: string('Mathematics')
    }, [], false),
    updateWrite('schedules/schedule-b', {
      teacherUid: string(identities.teacherB.uid),
      teacher: string('Teacher B'),
      className: string('Class One'),
      subject: string('Science')
    }, [], false),
    updateWrite('permissions/permission-a', {
      studentId: string('NIS-1'),
      name: string('Student One'),
      className: string('Class One'),
      date: string('2026-11-04'),
      type: string('Izin'),
      note: string('Medical appointment'),
      status: string('Menunggu')
    }, [], false),
    updateWrite('semesters/semester-a', {
      name: string('School A Semester'),
      status: string('Draft'),
      schoolId: string('school-a')
    }, [], false),
    updateWrite('semesters/semester-b', {
      name: string('School B Semester'),
      status: string('Draft'),
      schoolId: string('school-b')
    }, [], false),
    updateWrite('semesterConfigurations/config-a', {
      semesterId: string('semester-a'),
      type: string('subjects'),
      schoolId: string('school-a')
    }, [], false),
    updateWrite('semesterConfigurations/config-b', {
      semesterId: string('semester-b'),
      type: string('subjects'),
      schoolId: string('school-b')
    }, [], false)
  ]);
  if (!seedResult.ok) throw new Error(`Firestore emulator seeding failed: ${await seedResult.text()}`);
});

test('school administrators cannot read or create data across school boundaries', async () => {
  const ownClass = await firestoreRequest(
    'classes/tenant-class-a',
    identities.tenantAdminA.token
  );
  const otherClass = await firestoreRequest(
    'classes/tenant-class-b',
    identities.tenantAdminA.token
  );
  const scopedQuery = await runQuery({
    from: [{ collectionId: 'classes' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'schoolId' },
        op: 'EQUAL',
        value: string('school-a')
      }
    }
  }, identities.tenantAdminA.token);
  const unscopedQuery = await runQuery({
    from: [{ collectionId: 'classes' }]
  }, identities.tenantAdminA.token);
  const crossSchoolWrite = await commit([
    updateWrite('classes/cross-school-class', {
      name: string('Cross School Class'),
      schoolId: string('school-b')
    }, [], false)
  ], identities.tenantAdminA.token);
  if (ownClass.status !== 200 || otherClass.status !== 403 ||
      scopedQuery.status !== 200 || unscopedQuery.status !== 403 ||
      crossSchoolWrite.status !== 403) {
    throw new Error(
      `Unexpected tenant access: own=${ownClass.status}, other=${otherClass.status}, ` +
      `scoped query=${scopedQuery.status}, unscoped query=${unscopedQuery.status}, ` +
      `cross-school write=${crossSchoolWrite.status}`
    );
  }
});

test('semester configuration reads are school scoped and clients cannot write directly', async () => {
  const ownSemester = await firestoreRequest('semesters/semester-a', identities.tenantAdminA.token);
  const otherSemester = await firestoreRequest('semesters/semester-b', identities.tenantAdminA.token);
  const ownConfig = await firestoreRequest(
    'semesterConfigurations/config-a',
    identities.tenantAdminA.token
  );
  const otherConfig = await firestoreRequest(
    'semesterConfigurations/config-b',
    identities.tenantAdminA.token
  );
  const directWrite = await commit([
    updateWrite('semesterConfigurations/client-created', {
      semesterId: string('semester-a'),
      type: string('subjects'),
      schoolId: string('school-a')
    }, [], false)
  ], identities.tenantAdminA.token);
  if (ownSemester.status !== 200 || otherSemester.status !== 403 ||
      ownConfig.status !== 200 || otherConfig.status !== 403 || directWrite.status !== 403) {
    throw new Error(
      `Unexpected semester access: own=${ownSemester.status}, other=${otherSemester.status}, ` +
      `own config=${ownConfig.status}, other config=${otherConfig.status}, write=${directWrite.status}`
    );
  }
});

test('a teacher cannot read another teacher schedule', async () => {
  const ownSchedule = await firestoreRequest(
    `schedules/schedule-a`,
    identities.teacherA.token
  );
  const otherSchedule = await firestoreRequest(
    `schedules/schedule-b`,
    identities.teacherA.token
  );
  if (ownSchedule.status !== 200 || otherSchedule.status !== 403) {
    throw new Error(
      `Unexpected schedule access: own=${ownSchedule.status} (${await ownSchedule.text()}), ` +
      `other=${otherSchedule.status} (${await otherSchedule.text()})`
    );
  }
});

test('a teacher cannot record attendance against a colleague schedule', async () => {
  const ownResult = await writeManualAttendance({
    scheduleId: 'schedule-a',
    teacherUid: identities.teacherA.uid,
    subject: 'Mathematics'
  });
  const otherResult = await writeManualAttendance({
    scheduleId: 'schedule-b',
    teacherUid: identities.teacherA.uid,
    subject: 'Science'
  });
  if (ownResult.status !== 200 || otherResult.status !== 403) {
    throw new Error(
      `Unexpected attendance write status: own=${ownResult.status} (${ownResult.body}), ` +
      `other=${otherResult.status} (${otherResult.body})`
    );
  }
});

test('a student cannot write QR attendance directly to Firestore', async () => {
  sessionStart = new Date();
  await commit([updateWrite('attendanceSessions/session-a', {
    active: bool(true),
    expiresAt: timestamp(new Date(Date.now() + 60_000)),
    token: string('0123456789abcdef0123456789abcdef'),
    previousToken: string(''),
    scheduleId: string('schedule-a'),
    teacherUid: string(identities.teacherA.uid),
    subject: string('Mathematics'),
    className: string('Class One'),
    date: string('2026-11-04'),
    createdAt: timestamp(sessionStart)
  }, [], false)]);

  const writes = [
    updateWrite('attendance/session-a_NIS-1', {
      sessionId: string('session-a'),
      sessionToken: string('0123456789abcdef0123456789abcdef'),
      scheduleId: string('schedule-a'),
      teacherUid: string(identities.teacherA.uid),
      subject: string('Mathematics'),
      studentId: string('NIS-1'),
      name: string('Student One'),
      className: string('Class One'),
      date: string('2026-11-04'),
      sessionStartedAt: timestamp(sessionStart),
      time: timestamp(new Date()),
      status: string('Hadir'),
      source: string('qr'),
      note: string('Absensi QR'),
      createdAt: timestamp(new Date())
    }, ['time', 'createdAt'], false)
  ];
  const result = await commit(writes, identities.studentA.token);
  const writeBody = await result.text();
  const ownRecord = await firestoreRequest('attendance/session-a_NIS-1', identities.studentA.token);
  if (result.status !== 403 || ownRecord.status !== 404) {
    throw new Error(
      `Direct QR writes must be denied: write=${result.status} (${writeBody}), ` +
      `record=${ownRecord.status} (${await ownRecord.text()})`
    );
  }
});

test('a teacher cannot create or mutate an attendance session directly', async () => {
  const create = await commit([
    updateWrite('attendanceSessions/client-session', {
      scheduleId: string('schedule-a'),
      subject: string('Mathematics'),
      className: string('Class One'),
      date: string('2026-11-04'),
      teacherUid: string(identities.teacherA.uid),
      teacherName: string('Teacher A'),
      token: string('0123456789abcdef0123456789abcdef'),
      previousToken: string(''),
      active: bool(false),
      expiresAt: timestamp(new Date()),
      createdAt: timestamp(new Date()),
      updatedAt: timestamp(new Date())
    }, ['createdAt', 'updatedAt'], false)
  ], identities.teacherA.token);
  if (create.status !== 403) {
    throw new Error(`Teacher-created QR session should be denied (${create.status}): ${await create.text()}`);
  }
});

test('a class teacher can approve a pending permission with matching attendance history', async () => {
  const permissionId = 'permission-a';
  const attendanceId = '2026-11-04_NIS-1';
  const historyId = 'permission-change';
  const permissionResponse = await commit([
    updateWrite(`permissions/${permissionId}`, {
      status: string('Disetujui')
    }, [], 'exists', ['status'])
  ], identities.teacherA.token);
  if (permissionResponse.status !== 200) {
    throw new Error(`Teacher could not approve pending permission: ${await permissionResponse.text()}`);
  }
  const response = await commit([
    updateWrite(`attendance/${attendanceId}`, {
      studentId: string('NIS-1'),
      name: string('Student One'),
      className: string('Class One'),
      date: string('2026-11-04'),
      source: string('permission'),
      permissionId: string(permissionId),
      time: string('-'),
      status: string('Izin'),
      note: string('Medical appointment'),
      lastChangeId: string(historyId),
      createdAt: timestamp(new Date()),
      updatedAt: timestamp(new Date())
    }, ['createdAt', 'updatedAt'], false),
    updateWrite(`attendance/${attendanceId}/history/${historyId}`, {
      actorUid: string(identities.teacherA.uid),
      actorName: string('Teacher A'),
      action: string('created'),
      studentId: string('NIS-1'),
      className: string('Class One'),
      date: string('2026-11-04'),
      previousStatus: string(''),
      previousNote: string(''),
      nextStatus: string('Izin'),
      nextNote: string('Medical appointment'),
      reason: string('Permission approved'),
      createdAt: timestamp(new Date())
    }, ['createdAt'], false)
  ], identities.teacherA.token);
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`Teacher permission approval was rejected (${response.status}): ${body}`);
  }
});

async function createIdentity(role, nis, schoolId = '') {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${role}-${Math.random().toString(36).slice(2)}@example.test`,
        password: 'LocalTestPassword123!',
        returnSecureToken: true
      })
    }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`Auth emulator sign-up failed (${response.status}).`);
  return { uid: body.localId, token: body.idToken, role, nis, schoolId };
}

async function writeManualAttendance({ scheduleId, teacherUid, subject }) {
  const id = `${scheduleId}_2026-11-04_NIS-1`;
  const changeId = `change-${scheduleId}`;
  const response = await commit([
    updateWrite(`attendance/${id}`, {
      studentId: string('NIS-1'),
      name: string('Student One'),
      className: string('Class One'),
      date: string('2026-11-04'),
      subject: string(subject),
      scheduleId: string(scheduleId),
      teacherUid: string(teacherUid),
      source: string('manual'),
      time: string('08:00'),
      status: string('Hadir'),
      note: string('Perbaikan data'),
      lastChangeId: string(changeId),
      createdAt: timestamp(new Date()),
      updatedAt: timestamp(new Date())
    }, ['createdAt', 'updatedAt'], false),
    updateWrite(`attendance/${id}/history/${changeId}`, {
      actorUid: string(identities.teacherA.uid),
      actorName: string('Teacher A'),
      action: string('created'),
      studentId: string('NIS-1'),
      className: string('Class One'),
      date: string('2026-11-04'),
      previousStatus: string(''),
      previousNote: string(''),
      nextStatus: string('Hadir'),
      nextNote: string('Perbaikan data'),
      reason: string('Perbaikan data'),
      createdAt: timestamp(new Date())
    }, ['createdAt'], false)
  ], identities.teacherA.token);
  return { status: response.status, body: await response.text() };
}

function updateWrite(path, fields, serverTimestampFields, mustNotExist = true, updateMask) {
  const write = {
    update: { name: `${documentNamePrefix}/${path}`, fields },
    updateTransforms: serverTimestampFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME'
    }))
  };
  if (updateMask) write.updateMask = { fieldPaths: updateMask };
  if (mustNotExist === true) write.currentDocument = { exists: false };
  else if (mustNotExist === 'exists') write.currentDocument = { exists: true };
  return write;
}

async function commit(writes, token = 'owner') {
  return fetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
}

async function firestoreRequest(path, token) {
  return fetch(`${firestoreBase}/${path}`, { headers: authHeaders(token) });
}

async function runQuery(structuredQuery, token) {
  return fetch(`${firestoreBase}:runQuery`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery })
  });
}

function ownerHeaders() {
  return { Authorization: 'Bearer owner' };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function string(value) {
  return { stringValue: value };
}

function bool(value) {
  return { booleanValue: value };
}

function timestamp(value) {
  return { timestampValue: value.toISOString() };
}
