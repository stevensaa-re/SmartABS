const { test } = require('node:test');
const assert = require('node:assert/strict');

const projectId = process.env.GCLOUD_PROJECT || 'demo-smartabs-rules';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const enabled = Boolean(authHost && firestoreHost && process.env.FUNCTIONS_EMULATOR_HOST);
const firestoreBase =
  `http://${firestoreHost || '127.0.0.1:8080'}/v1/projects/${projectId}/databases/(default)/documents`;
const functionsBase = `http://${functionsHost}/${projectId}/asia-southeast1`;
const documentPath = `projects/${projectId}/databases/(default)/documents`;

test('school setup bootstraps an SMK profile and saves scoped academic masters', {
  skip: !enabled && 'Run with Auth, Firestore, and Functions emulators.'
}, async () => {
  const admin = await createIdentity('setup-admin');
  const seed = await commit([write(`users/${admin.uid}`, {
    name: string('Setup Admin'),
    role: string('admin'),
    status: string('Aktif'),
    schoolId: string('setup-school')
  })]);
  assert.equal(seed.status, 200, seed.body);

  const initialSetup = await callFunction('getSchoolSetup', {}, admin.token);
  assert.equal(initialSetup.status, 200, initialSetup.body);
  assert.equal(initialSetup.data.school.id, 'setup-school');
  assert.equal(initialSetup.data.school.status, 'Persiapan');

  const profile = await callFunction('saveSchoolProfile', {
    name: 'SMK SMARTABS',
    npsn: '12345678',
    schoolLevel: 'SMK',
    schoolType: 'Negeri',
    address: 'Jl. Pendidikan 1',
    phone: '021123456',
    email: 'info@smartabs.example',
    principalName: 'Kepala Sekolah',
    academicYear: '2026/2027',
    operatingDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
    openingTime: '07:00',
    closingTime: '15:00',
    timeZone: 'Asia/Jakarta',
    lateToleranceMinutes: 10
  }, admin.token);
  assert.equal(profile.status, 200, profile.body);
  assert.equal(profile.data.schoolLevel, 'SMK');

  const schoolSummary = await callFunction('getSchoolSummary', {}, admin.token);
  assert.equal(schoolSummary.status, 200, schoolSummary.body);
  assert.equal(schoolSummary.data.school.name, 'SMK SMARTABS');
  assert.equal(schoolSummary.data.activeSemester, null);

  const activeSemesterSeed = await commit([
    write('semesters/setup-active-semester', {
      name: string('2026/2027 Ganjil'),
      academicYear: string('2026/2027'),
      term: string('Ganjil'),
      startDate: string('2026-07-01'),
      endDate: string('2026-12-31'),
      status: string('Aktif'),
      schoolId: string('setup-school')
    }),
    updateWrite('schools/setup-school', {
      activeSemesterId: string('setup-active-semester')
    })
  ]);
  assert.equal(activeSemesterSeed.status, 200, activeSemesterSeed.body);
  const activeSummary = await callFunction('getSchoolSummary', {}, admin.token);
  assert.equal(activeSummary.status, 200, activeSummary.body);
  assert.equal(activeSummary.data.activeSemester.name, '2026/2027 Ganjil');

  const pplg = await saveMaster(admin.token, 'programs', {
    code: 'PPLG',
    name: 'Pengembangan Perangkat Lunak dan Gim',
    level: 'SMK'
  });
  const tjkt = await saveMaster(admin.token, 'programs', {
    code: 'TJKT',
    name: 'Teknik Jaringan Komputer dan Telekomunikasi',
    level: 'SMK'
  });
  const classPplg = await saveMaster(admin.token, 'classes', {
    name: 'X PPLG 1',
    level: 'X',
    majorId: pplg.data.id,
    capacity: 36
  });
  const classTjkt = await saveMaster(admin.token, 'classes', {
    name: 'X TJKT 1',
    level: 'X',
    majorId: tjkt.data.id,
    capacity: 36
  });
  await saveMaster(admin.token, 'subjects', {
    code: 'PPLG-DASAR',
    name: 'Dasar Pengembangan Perangkat Lunak',
    category: 'Kejuruan',
    educationLevels: ['SMK']
  });
  await saveMaster(admin.token, 'subjects', {
    code: 'TJKT-DASAR',
    name: 'Dasar Teknik Jaringan',
    category: 'Kejuruan',
    educationLevels: ['SMK']
  });

  assert.notEqual(classPplg.data.id, classTjkt.data.id);
  assert.equal(classPplg.data.major, 'Pengembangan Perangkat Lunak dan Gim');
  assert.equal(classTjkt.data.major, 'Teknik Jaringan Komputer dan Telekomunikasi');

  const duplicate = await callFunction('saveAcademicMaster', {
    type: 'subjects',
    recordId: '',
    payload: {
      code: 'PPLG-DASAR',
      name: 'Duplikat',
      category: 'Kejuruan',
      educationLevels: ['SMK']
    }
  }, admin.token);
  assert.notEqual(duplicate.status, 200);

  const nonAdmin = await createIdentity('setup-teacher');
  const nonAdminSeed = await commit([write(`users/${nonAdmin.uid}`, {
    name: string('Setup Teacher'),
    role: string('guru'),
    status: string('Aktif'),
    schoolId: string('setup-school')
  })]);
  assert.equal(nonAdminSeed.status, 200, nonAdminSeed.body);
  const deniedProfile = await callFunction('saveSchoolProfile', {
    name: 'Unauthorized Update'
  }, nonAdmin.token);
  assert.notEqual(deniedProfile.status, 200);

  const finalSetup = await callFunction('getSchoolSetup', {}, admin.token);
  assert.equal(finalSetup.status, 200, finalSetup.body);
  assert.equal(finalSetup.data.records.programs.length, 2);
  assert.equal(finalSetup.data.records.classes.length, 2);
  assert.equal(finalSetup.data.records.subjects.length, 2);
  assert.ok(finalSetup.data.records.classes.every((record) =>
    record.schoolId === 'setup-school'
  ));
});

async function saveMaster(token, type, payload) {
  const result = await callFunction('saveAcademicMaster', {
    type,
    recordId: '',
    payload
  }, token);
  assert.equal(result.status, 200, result.body);
  assert.equal(result.data.schoolId, 'setup-school');
  return result;
}

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
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ writes })
  });
  return { status: response.status, body: await response.text() };
}

function write(path, fields) {
  return {
    update: { name: `${documentPath}/${path}`, fields },
    currentDocument: { exists: false }
  };
}

function updateWrite(path, fields) {
  return {
    update: { name: `${documentPath}/${path}`, fields },
    updateMask: { fieldPaths: Object.keys(fields) }
  };
}

function string(value) {
  return { stringValue: value };
}
