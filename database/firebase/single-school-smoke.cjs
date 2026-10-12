const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-smartabs';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error('Jalankan test ini melalui Firebase Emulator Suite (Firestore dan Authentication).');
}

const documentsUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const ownerHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

function firestoreValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { stringValue: String(value) };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function writeDocument(path, fields) {
  const result = await request(`${documentsUrl}/${path}`, {
    method: 'PATCH',
    headers: ownerHeaders,
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]))
    })
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Gagal menyiapkan ${path}: ${JSON.stringify(result.body)}`);
  }
}

async function expectStatus(label, result, expected) {
  if (result.status !== expected) {
    throw new Error(`${label}: mengharapkan HTTP ${expected}, menerima ${result.status}: ${JSON.stringify(result.body)}`);
  }
  console.log(`PASS ${label}`);
}

async function createUser(email, username, role, nis) {
  const result = await request(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'test-password-123', returnSecureToken: true })
    }
  );
  if (result.status < 200 || result.status >= 300) throw new Error(`Gagal membuat user emulator: ${JSON.stringify(result.body)}`);
  await writeDocument(`users/${result.body.localId}`, {
    name: username, username, role, status: 'Aktif', ...(nis ? { nis } : {})
  });
  return { uid: result.body.localId, headers: { Authorization: `Bearer ${result.body.idToken}` } };
}

async function updateSchoolProfile(headers) {
  const result = await request(`${documentsUrl}:commit`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `projects/${projectId}/databases/(default)/documents/schoolSettings/main`,
          fields: {
            name: { stringValue: 'SMA Contoh' },
            address: { stringValue: 'Jl. Pendidikan 1' },
            phone: { stringValue: '021123456' },
            educationLevels: { arrayValue: { values: [{ stringValue: 'SMA' }] } },
            majors: { arrayValue: { values: [{ stringValue: 'IPA' }] } }
          }
        },
        updateMask: { fieldPaths: ['name', 'address', 'phone', 'educationLevels', 'majors'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
      }]
    })
  });
  return result;
}

async function main() {
  const suffix = Date.now();
  const admin = await createUser(`admin-${suffix}@example.test`, 'Admin', 'admin');
  const student = await createUser(`student-${suffix}@example.test`, 'Student', 'siswa', '20260001');
  await writeDocument('students/20260001', {
    name: 'Student', className: 'X-A', gender: 'P', status: 'Aktif', userId: student.uid,
    nisn: '1234567890', birthPlace: 'Bandung', birthDate: '2008-04-12', address: 'Jl. Satu',
    fatherName: 'Ayah', motherName: 'Ibu', guardianName: '', phone: '081234567890'
  });
  await writeDocument('classes/class-1', { name: 'X-A' });
  await writeDocument('schoolSettings/main', {
    name: 'SMA Awal', address: '', phone: '',
    educationLevels: ['SMA'], majors: [], updatedAt: new Date().toISOString()
  });

  await expectStatus('Admin can read the single-school class collection',
    await request(`${documentsUrl}/classes/class-1`, { headers: admin.headers }), 200);
  await expectStatus('Student can read own student record with biodata',
    await request(`${documentsUrl}/students/20260001`, { headers: student.headers }), 200);
  await expectStatus('Active student can read the school profile',
    await request(`${documentsUrl}/schoolSettings/main`, { headers: student.headers }), 200);
  await expectStatus('School admin can update the single school profile',
    await updateSchoolProfile(admin.headers), 200);
  await expectStatus('Student cannot update school settings',
    await updateSchoolProfile(student.headers), 403);
  await expectStatus('Tenant-style school paths are not available',
    await request(`${documentsUrl}/schools/another-school`, { headers: admin.headers }), 403);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
