const { test } = require('node:test');
const assert = require('node:assert/strict');

const projectId = process.env.GCLOUD_PROJECT || 'demo-smartabs-rules';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const enabled = Boolean(authHost && firestoreHost && process.env.FUNCTIONS_EMULATOR_HOST);
const firestoreBase =
  `http://${firestoreHost || '127.0.0.1:8080'}/v1/projects/${projectId}/databases/(default)/documents`;
const documentPrefix =
  `projects/${projectId}/databases/(default)/documents`;
const functionsBase = `http://${functionsHost}/${projectId}/asia-southeast1`;

test('Firebase callables provision accounts and enforce QR attendance atomically', {
  skip: !enabled && 'Run with Auth, Firestore, and Functions emulators.'
}, async () => {
  const admin = await createIdentity('admin');
  const teacher = await createIdentity('teacher');
  const unassignedTeacher = await createIdentity('unassigned-teacher');
  const student = await createIdentity('student');
  const otherClassStudent = await createIdentity('other-class-student');
  const crossSchoolStudent = await createIdentity('cross-school-student');

  const seed = await commit([
    write('schools/school-a', {
      name: string('School A'),
      status: string('Aktif'),
      timeZone: string('Asia/Jakarta'),
      activeSemesterId: string('semester-a')
    }),
    write('schools/school-b', {
      name: string('School B'),
      status: string('Aktif'),
      timeZone: string('Asia/Jakarta')
    }),
    write(`users/${admin.uid}`, {
      name: string('School Admin'),
      username: string('school-admin'),
      usernameLower: string('school-admin'),
      role: string('admin'),
      status: string('Aktif'),
      schoolId: string('school-a')
    }),
    write(`users/${teacher.uid}`, {
      name: string('Teacher A'),
      username: string('teacher-a'),
      usernameLower: string('teacher-a'),
      role: string('guru'),
      status: string('Aktif'),
      className: string('Class One'),
      schoolId: string('school-a')
    }),
    write(`users/${unassignedTeacher.uid}`, {
      name: string('Unassigned Teacher'),
      username: string('unassigned-teacher'),
      usernameLower: string('unassigned-teacher'),
      role: string('guru'),
      status: string('Aktif'),
      schoolId: string('school-a')
    }),
    write(`users/${student.uid}`, {
      name: string('Student A'),
      username: string('student-a'),
      usernameLower: string('student-a'),
      role: string('siswa'),
      status: string('Aktif'),
      nis: string('NIS-1'),
      schoolId: string('school-a')
    }),
    write(`users/${crossSchoolStudent.uid}`, {
      name: string('Student B'),
      username: string('student-b'),
      usernameLower: string('student-b'),
      role: string('siswa'),
      status: string('Aktif'),
      nis: string('NIS-2'),
      schoolId: string('school-b')
    }),
    write(`users/${otherClassStudent.uid}`, {
      name: string('Student Other Class'),
      username: string('student-other-class'),
      usernameLower: string('student-other-class'),
      role: string('siswa'),
      status: string('Aktif'),
      nis: string('NIS-3'),
      schoolId: string('school-a')
    }),
    write('classes/class-one', {
      name: string('Class One'),
      schoolId: string('school-a')
    }),
    write('semesters/semester-a', {
      name: string('Semester Aktif'),
      status: string('Aktif'),
      schoolId: string('school-a')
    }),
    write('students/NIS-1', {
      nis: string('NIS-1'),
      name: string('Student A'),
      className: string('Class One'),
      status: string('Aktif'),
      schoolId: string('school-a')
    }),
    write('students/NIS-2', {
      nis: string('NIS-2'),
      name: string('Student B'),
      className: string('Class One'),
      status: string('Aktif'),
      schoolId: string('school-b')
    }),
    write('students/NIS-3', {
      nis: string('NIS-3'),
      name: string('Student Other Class'),
      className: string('Class Two'),
      status: string('Aktif'),
      schoolId: string('school-a')
    }),
    write('schedules/schedule-a', {
      teacherUid: string(teacher.uid),
      teacher: string('Teacher A'),
      className: string('Class One'),
      subject: string('Mathematics'),
      semesterId: string('semester-a'),
      schoolId: string('school-a')
    })
  ]);
  assert.equal(seed.status, 200, `Emulator seeding failed: ${seed.body}`);

  const unauthorized = await callFunction('createUser', {
    name: 'Should Not Exist',
    username: 'no-admin',
    email: 'no-admin@example.test',
    password: 'secure-password',
    role: 'guru'
  }, student.token);
  assert.notEqual(unauthorized.status, 200);

  const teacherResult = await callFunction('createTeacherAccount', {
    account: {
      name: 'New Teacher',
      username: 'new-teacher',
      email: 'new-teacher@example.test',
      password: 'secure-password'
    },
    teacher: { className: 'Class One', subject: 'Science', status: 'Aktif' }
  }, admin.token);
  assert.equal(teacherResult.status, 200, teacherResult.body);
  assert.equal(teacherResult.data.teacher.className, 'Class One');
  assert.equal(teacherResult.data.user.schoolId, 'school-a');

  const studentResult = await callFunction('createStudentAccount', {
    account: {
      name: 'New Student',
      username: 'new-student',
      email: 'new-student@example.test',
      password: 'secure-password'
    },
    student: { nis: '12345', className: 'Class One', gender: 'P', status: 'Aktif' }
  }, admin.token);
  assert.equal(studentResult.status, 200, studentResult.body);
  assert.equal(studentResult.data.student.userId, studentResult.data.user.id);

  const duplicateEmail = await callFunction('createStudentAccount', {
    account: {
      name: 'Duplicate Email',
      username: 'duplicate-email',
      email: 'new-teacher@example.test',
      password: 'secure-password'
    },
    student: { nis: '12346', className: 'Class One', gender: 'P', status: 'Aktif' }
  }, admin.token);
  assert.notEqual(duplicateEmail.status, 200);

  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const sessionResult = await callFunction('startAttendanceSession', {
    scheduleId: 'schedule-a',
    date
  }, teacher.token);
  assert.equal(sessionResult.status, 200, sessionResult.body);
  const session = sessionResult.data;
  assert.match(session.token, /^[a-f0-9]{32}$/);

  const unassignedSession = await callFunction('startAttendanceSession', {
    scheduleId: 'schedule-a',
    date
  }, unassignedTeacher.token);
  assert.notEqual(unassignedSession.status, 200);

  const [firstScan, replayedScan] = await Promise.all([
    callFunction('submitQrAttendance', { sessionId: session.id, token: session.token }, student.token),
    callFunction('submitQrAttendance', { sessionId: session.id, token: session.token }, student.token)
  ]);
  assert.equal([firstScan.status, replayedScan.status].filter((status) => status === 200).length, 1);
  assert.equal([firstScan.status, replayedScan.status].filter((status) => status !== 200).length, 1);

  const crossSchoolScan = await callFunction('submitQrAttendance', {
    sessionId: session.id,
    token: session.token
  }, crossSchoolStudent.token);
  assert.notEqual(crossSchoolScan.status, 200);
  const wrongClassScan = await callFunction('submitQrAttendance', {
    sessionId: session.id,
    token: session.token
  }, otherClassStudent.token);
  assert.notEqual(wrongClassScan.status, 200);

  const closeResult = await callFunction('closeAttendanceSession', { sessionId: session.id }, teacher.token);
  assert.equal(closeResult.status, 200, closeResult.body);
  const closedScan = await callFunction('submitQrAttendance', {
    sessionId: session.id,
    token: session.token
  }, student.token);
  assert.notEqual(closedScan.status, 200);

  const expiredSessionResult = await callFunction('startAttendanceSession', {
    scheduleId: 'schedule-a',
    date
  }, teacher.token);
  assert.equal(expiredSessionResult.status, 200, expiredSessionResult.body);
  const expiredSession = expiredSessionResult.data;
  const expirationUpdate = await commit([updateWrite(
    `attendanceSessions/${expiredSession.id}`,
    { expiresAt: { timestampValue: new Date(Date.now() - 60_000).toISOString() } }
  )]);
  assert.equal(expirationUpdate.status, 200, expirationUpdate.body);
  const expiredScan = await callFunction('submitQrAttendance', {
    sessionId: expiredSession.id,
    token: expiredSession.token
  }, student.token);
  assert.notEqual(expiredScan.status, 200);
});

async function createIdentity(name) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${name}-${Math.random().toString(36).slice(2)}@example.test`,
        password: 'LocalTestPassword123!',
        returnSecureToken: true
      })
    }
  );
  const body = await response.json();
  assert.equal(response.ok, true, `Auth emulator sign-up failed (${response.status}).`);
  return { uid: body.localId, token: body.idToken };
}

async function callFunction(name, data, token) {
  const response = await fetch(`${functionsBase}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data })
  });
  const body = await response.json();
  return { status: response.status, data: body.result ?? body.data, body: JSON.stringify(body) };
}

async function commit(writes) {
  const response = await fetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  return { status: response.status, body: await response.text() };
}

function write(path, fields) {
  return {
    update: { name: `${documentPrefix}/${path}`, fields },
    currentDocument: { exists: false }
  };
}

function updateWrite(path, fields) {
  return {
    update: { name: `${documentPrefix}/${path}`, fields },
    updateMask: { fieldPaths: Object.keys(fields) }
  };
}

function string(value) {
  return { stringValue: value };
}