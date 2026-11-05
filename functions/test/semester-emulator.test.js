const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relationKey } = require('../semester-domain');

const projectId = process.env.GCLOUD_PROJECT || 'demo-smartabs-rules';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const enabled = Boolean(authHost && firestoreHost && process.env.FUNCTIONS_EMULATOR_HOST);
const firestoreBase =
  `http://${firestoreHost || '127.0.0.1:8080'}/v1/projects/${projectId}/databases/(default)/documents`;
const functionsBase = `http://${functionsHost}/${projectId}/asia-southeast1`;

test('semester lifecycle is tenant-scoped, idempotent, editable, and excludes attendance', {
  skip: !enabled && 'Run with Auth, Firestore, and Functions emulators.'
}, async () => {
  const admin = await createIdentity('semester-admin');
  const otherAdmin = await createIdentity('semester-other-admin');

  const seed = await commit([
    write('schools/semester-school-a', {
      name: string('School A'),
      status: string('Aktif'),
      timeZone: string('Asia/Jakarta'),
      schoolLevel: string('SMA'),
      activeSemesterId: string('semester-source-a')
    }),
    write('schools/semester-school-b', {
      name: string('School B'),
      status: string('Aktif')
    }),
    write(`users/${admin.uid}`, {
      name: string('Admin A'),
      role: string('admin'),
      status: string('Aktif'),
      schoolId: string('semester-school-a')
    }),
    write(`users/${otherAdmin.uid}`, {
      name: string('Admin B'),
      role: string('admin'),
      status: string('Aktif'),
      schoolId: string('semester-school-b')
    }),
    write('users/semester-teacher-a', {
      name: string('Teacher A'),
      role: string('guru'),
      status: string('Aktif'),
      schoolId: string('semester-school-a')
    }),
    write('classes/semester-class-a', {
      name: string('10-A'),
      level: string('10'),
      major: string('IPA'),
      capacity: integer(30),
      schoolLevel: string('SMA'),
      schoolId: string('semester-school-a')
    }),
    write('subjects/subject-math', {
      code: string('MTK'),
      name: string('Matematika'),
      isActive: { booleanValue: true },
      educationLevels: { arrayValue: { values: [string('SMA')] } },
      schoolId: string('semester-school-a')
    }),
    write('rooms/room-one', {
      code: string('R-01'),
      name: string('Ruang 01'),
      isActive: { booleanValue: true },
      schoolId: string('semester-school-a')
    }),
    write('semesters/semester-source-a', {
      name: string('2025/2026 Ganjil'),
      nameLower: string('2025/2026 ganjil'),
      academicYear: string('2025/2026'),
      term: string('Ganjil'),
      startDate: string('2025-07-01'),
      endDate: string('2025-12-31'),
      status: string('Aktif'),
      initializedTypes: map({}),
      schoolId: string('semester-school-a')
    }),
    ...sourceConfigurations().map(({ id, type, payload, key }) =>
      write(`semesterConfigurations/${id}`, {
        semesterId: string('semester-source-a'),
        sourceSemesterId: string('semester-source-a'),
        type: string(type),
        relationKey: string(key),
        sourceRelationKey: string(key),
        payload: map(payload),
        schoolId: string('semester-school-a')
      })
    ),
    write('attendance/old-attendance', {
      schoolId: string('semester-school-a'),
      semesterId: string('semester-source-a'),
      studentId: string('student-a')
    }),
    write('attendanceSessions/old-session', {
      schoolId: string('semester-school-a'),
      semesterId: string('semester-source-a'),
      active: { booleanValue: true }
    })
  ]);
  assert.equal(seed.status, 200, seed.body);

  const created = await callFunction('createSemester', {
    name: '2025/2026 Genap',
    academicYear: '2025/2026',
    term: 'Genap',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    importCurrentConfiguration: false
  }, admin.token);
  assert.equal(created.status, 200, created.body);
  const targetId = created.data.id;

  const crossTenantPreview = await callFunction('previewSemesterConfigurationCopy', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types: ['subjects']
  }, otherAdmin.token);
  assert.notEqual(crossTenantPreview.status, 200);

  const conflicting = {
    classId: 'class-b',
    className: '10-B',
    subject: 'Fisika',
    teacherUid: 'semester-teacher-a',
    teacherName: 'Teacher A',
    day: 'Senin',
    start: '08:30',
    end: '09:30'
  };
  const conflictKey = relationKey('schedules', conflicting);
  const conflictId = 'conflict-target-schedule';
  const conflictSeed = await commit([write(`semesterConfigurations/${conflictId}`, {
    semesterId: string(targetId),
    type: string('schedules'),
    relationKey: string(conflictKey),
    sourceRelationKey: string(conflictKey),
    payload: map(conflicting),
    schoolId: string('semester-school-a')
  })]);
  assert.equal(conflictSeed.status, 200, conflictSeed.body);

  const conflictingPreview = await callFunction('previewSemesterConfigurationCopy', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types: ['subjects', 'teacherAssignments', 'schedules', 'periods', 'classes']
  }, admin.token);
  assert.equal(conflictingPreview.status, 200, conflictingPreview.body);
  assert.ok(conflictingPreview.data.conflicts.length > 0);
  const blockedCopy = await callFunction('copySemesterConfiguration', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types: ['subjects', 'teacherAssignments', 'schedules', 'periods', 'classes']
  }, admin.token);
  assert.notEqual(blockedCopy.status, 200);
  const conflictRemoval = await commit([{ delete: `${documentPath}/semesterConfigurations/${conflictId}` }]);
  assert.equal(conflictRemoval.status, 200, conflictRemoval.body);

  const types = ['subjects', 'teacherAssignments', 'schedules', 'periods', 'classes'];
  const preview = await callFunction('previewSemesterConfigurationCopy', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types
  }, admin.token);
  assert.equal(preview.status, 200, preview.body);
  assert.equal(preview.data.totalToCreate, types.length);
  assert.deepEqual(preview.data.conflicts, []);

  const copied = await callFunction('copySemesterConfiguration', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types
  }, admin.token);
  assert.equal(copied.status, 200, copied.body);
  assert.equal(copied.data.totalCreated, types.length);

  const retried = await callFunction('copySemesterConfiguration', {
    sourceSemesterId: 'semester-source-a',
    targetSemesterId: targetId,
    types
  }, admin.token);
  assert.equal(retried.status, 200, retried.body);
  assert.equal(retried.data.totalCreated, 0);

  const configs = await readCollection('semesterConfigurations', 'schoolId', 'semester-school-a');
  const targetConfigs = configs.filter((doc) => doc.fields.semesterId?.stringValue === targetId);
  assert.equal(targetConfigs.length, types.length);
  const sourceIds = new Set(sourceConfigurations().map(({ id }) => id));
  assert.ok(targetConfigs.every((doc) => !sourceIds.has(doc.id)));

  const classConfig = targetConfigs.find((doc) => doc.fields.type?.stringValue === 'classes');
  const classPayload = decodeValue(classConfig.fields.payload);
  const edited = await callFunction('updateSemesterConfiguration', {
    configurationId: classConfig.id,
    payload: { ...classPayload, capacity: 40 }
  }, admin.token);
  assert.equal(edited.status, 200, edited.body);
  const subjectConfig = targetConfigs.find((doc) => doc.fields.type?.stringValue === 'subjects');
  const deleted = await callFunction('deleteSemesterConfiguration', {
    configurationId: subjectConfig.id
  }, admin.token);
  assert.equal(deleted.status, 200, deleted.body);
  assert.equal(deleted.data.deleted, true);
  const restoredSubject = await callFunction('saveSemesterConfiguration', {
    semesterId: targetId,
    type: 'subjects',
    payload: {
      classId: 'semester-class-a',
      className: '10-A',
      subjectId: 'subject-math',
      subject: 'Matematika',
      programId: ''
    }
  }, admin.token);
  assert.equal(restoredSubject.status, 200, restoredSubject.body);

  const activated = await callFunction('activateSemester', { semesterId: targetId }, admin.token);
  assert.equal(activated.status, 200, activated.body);
  assert.equal(activated.data.active, true);
  assert.equal(activated.data.scheduleCount, 1);
  const retriedActivation = await callFunction('activateSemester', { semesterId: targetId }, admin.token);
  assert.equal(retriedActivation.status, 200, retriedActivation.body);
  assert.equal(retriedActivation.data.alreadyActive, true);

  const [school, oldSemester, classDoc, schedules, attendance, sessions] = await Promise.all([
    readDocument('schools/semester-school-a'),
    readDocument('semesters/semester-source-a'),
    readDocument('classes/semester-class-a'),
    readCollection('schedules', 'schoolId', 'semester-school-a'),
    readCollection('attendance', 'schoolId', 'semester-school-a'),
    readCollection('attendanceSessions', 'schoolId', 'semester-school-a')
  ]);
  assert.equal(school.fields.activeSemesterId.stringValue, targetId);
  assert.equal(oldSemester.fields.status.stringValue, 'Arsip');
  assert.equal(classDoc.fields.capacity.integerValue, '40');
  assert.equal(schedules.filter((doc) => doc.fields.semesterId?.stringValue === targetId).length, 1);
  assert.equal(attendance.filter((doc) => doc.fields.semesterId?.stringValue === targetId).length, 0);
  assert.equal(sessions.filter((doc) => doc.fields.semesterId?.stringValue === targetId).length, 0);
  assert.equal(attendance.length, 1);
  assert.equal(sessions.length, 1);
  const activeSemester = await callFunction('getActiveSemester', {}, admin.token);
  assert.equal(activeSemester.status, 200, activeSemester.body);
  assert.equal(activeSemester.data.id, targetId);
  const otherSchoolActiveSemester = await callFunction('getActiveSemester', {}, otherAdmin.token);
  assert.equal(otherSchoolActiveSemester.status, 200, otherSchoolActiveSemester.body);
  assert.equal(otherSchoolActiveSemester.data.id, '');

  const importedDraft = await callFunction('createSemester', {
    name: '2026/2027 Ganjil',
    academicYear: '2026/2027',
    term: 'Ganjil',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    importCurrentConfiguration: true
  }, admin.token);
  assert.equal(importedDraft.status, 200, importedDraft.body);
  assert.equal(importedDraft.data.importedConfigurationCount, types.length);
  const importedConfigs = await readCollection(
    'semesterConfigurations',
    'schoolId',
    'semester-school-a'
  );
  assert.equal(
    importedConfigs.filter((doc) => doc.fields.semesterId?.stringValue === importedDraft.data.id).length,
    types.length
  );
});

const documentPath = `projects/${projectId}/databases/(default)/documents`;

function sourceConfigurations() {
  const rows = [
    ['source-subject', 'subjects', {
      classId: 'semester-class-a', className: '10-A',
      subjectId: 'subject-math', subject: 'Matematika'
    }],
    ['source-assignment', 'teacherAssignments', {
      classId: 'semester-class-a', className: '10-A',
      subjectId: 'subject-math', subject: 'Matematika',
      teacherUid: 'semester-teacher-a', teacherName: 'Teacher A'
    }],
    ['source-schedule', 'schedules', {
      classId: 'semester-class-a', className: '10-A',
      subjectId: 'subject-math', subject: 'Matematika',
      teacherUid: 'semester-teacher-a', teacherName: 'Teacher A',
      day: 'Senin', start: '08:00', end: '09:00',
      roomId: 'room-one', roomName: 'Ruang 01'
    }],
    ['source-period', 'periods', {
      day: 'Senin', start: '08:00', end: '09:00', label: 'Jam 1'
    }],
    ['source-class', 'classes', {
      classId: 'semester-class-a', className: '10-A', level: '10',
      major: 'IPA', homeroom: 'Teacher A', capacity: 35
    }]
  ];
  return rows.map(([id, type, payload]) => ({
    id,
    type,
    payload,
    key: relationKey(type, payload)
  }));
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

async function readDocument(path) {
  const response = await fetch(`${firestoreBase}/${path}`, {
    headers: { Authorization: 'Bearer owner' }
  });
  assert.equal(response.ok, true, `Firestore read failed for ${path}.`);
  return response.json();
}

async function readCollection(collection, field, value) {
  const response = await fetch(`${firestoreBase}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: string(value)
          }
        }
      }
    })
  });
  assert.equal(response.ok, true, `Firestore query failed for ${collection}.`);
  const rows = await response.json();
  return rows.filter((row) => row.document).map((row) => ({
    id: row.document.name.split('/').pop(),
    fields: row.document.fields
  }));
}

function write(path, fields) {
  return {
    update: { name: `${documentPath}/${path}`, fields },
    currentDocument: { exists: false }
  };
}

function string(value) {
  return { stringValue: value };
}

function integer(value) {
  return { integerValue: String(value) };
}

function map(value) {
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        typeof item === 'number' ? integer(item) : string(item)
      ]))
    }
  };
}

function decodeValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.mapValue) {
    return Object.fromEntries(Object.entries(value.mapValue.fields).map(([key, item]) => [
      key,
      decodeValue(item)
    ]));
  }
  return value;
}
