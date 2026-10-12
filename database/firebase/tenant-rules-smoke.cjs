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
    body: JSON.stringify({ fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])
    ) })
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

async function main() {
  const authResult = await request(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `tenant-admin-${Date.now()}@example.test`,
        password: 'test-password-123',
        returnSecureToken: true
      })
    }
  );
  if (authResult.status < 200 || authResult.status >= 300) {
    throw new Error(`Gagal membuat akun Auth emulator: ${JSON.stringify(authResult.body)}`);
  }
  const { localId: uid, idToken } = authResult.body;

  await writeDocument('schools/school-a', { name: 'Sekolah A', status: 'Aktif' });
  await writeDocument('schools/school-b', { name: 'Sekolah B', status: 'Aktif' });
  await writeDocument(`users/${uid}`, {
    name: 'Admin A', username: 'admin-a', role: 'admin', status: 'Aktif', schoolId: 'school-a'
  });
  await writeDocument('users/other-school-user', {
    name: 'Admin B', username: 'admin-b', role: 'admin', status: 'Aktif', schoolId: 'school-b'
  });
  await writeDocument('schools/school-a/classes/class-a', { name: 'X-A' });
  await writeDocument('schools/school-b/classes/class-b', { name: 'X-B' });

  const userHeaders = { Authorization: `Bearer ${idToken}` };
  await expectStatus(
    'Admin can read own school class',
    await request(`${documentsUrl}/schools/school-a/classes/class-a`, { headers: userHeaders }),
    200
  );
  await expectStatus(
    'Admin cannot read another school class',
    await request(`${documentsUrl}/schools/school-b/classes/class-b`, { headers: userHeaders }),
    403
  );
  await expectStatus(
    'Admin cannot read another school profile',
    await request(`${documentsUrl}/users/other-school-user`, { headers: userHeaders }),
    403
  );
  await expectStatus(
    'Admin can read only own school user query',
    await request(`${documentsUrl}:runQuery`, {
      method: 'POST',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'schoolId' },
              op: 'EQUAL',
              value: { stringValue: 'school-a' }
            }
          }
        }
      })
    }),
    200
  );
  await expectStatus(
    'Admin cannot query another school users',
    await request(`${documentsUrl}:runQuery`, {
      method: 'POST',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'schoolId' },
              op: 'EQUAL',
              value: { stringValue: 'school-b' }
            }
          }
        }
      })
    }),
    403
  );
  await expectStatus(
    'School admin cannot create a school',
    await request(`${documentsUrl}/schools/not-authorized`, {
      method: 'PATCH',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'Tidak diizinkan' }, status: { stringValue: 'Aktif' } } })
    }),
    403
  );

  await writeDocument(`platformAdmins/${uid}`, { bootstrap: 'tenant-rules-smoke' });
  await expectStatus(
    'Platform admin can provision a new school',
    await request(`${documentsUrl}/schools/school-c`, {
      method: 'PATCH',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        name: { stringValue: 'Sekolah C' },
        status: { stringValue: 'Aktif' }
      } })
    }),
    200
  );
  await expectStatus(
    'Platform admin can provision its first school administrator',
    await request(`${documentsUrl}/users/new-school-admin`, {
      method: 'PATCH',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        name: { stringValue: 'Admin C' },
        role: { stringValue: 'admin' },
        status: { stringValue: 'Aktif' },
        schoolId: { stringValue: 'school-c' }
      } })
    }),
    200
  );
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
