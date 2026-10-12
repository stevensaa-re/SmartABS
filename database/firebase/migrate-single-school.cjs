#!/usr/bin/env node

const admin = require('firebase-admin');

const COLLECTIONS = [
  'classes', 'students', 'teachers', 'schedules', 'announcements',
  'attendance', 'attendanceSessions', 'permissions', 'calendarEvents', 'auditLogs'
];
const PAGE_SIZE = 250;
const BATCH_SIZE = 400;

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--apply') {
      values.set('apply', true);
    } else if (key.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.set(key.slice(2), argv[++index]);
    } else {
      throw new Error(`Argumen tidak dikenal/tidak lengkap: ${key}`);
    }
  }
  return values;
}

async function visitPages(collection, visitor) {
  let cursor = null;
  let count = 0;
  while (true) {
    let query = collection.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      await visitor(doc);
      count++;
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }
  return count;
}

async function main() {
  const args = argumentsMap(process.argv);
  const projectId = args.get('project');
  const schoolId = args.get('school-id');
  const schoolName = args.get('school-name');
  const platformAdminUid = args.get('platform-admin-uid');
  const apply = args.get('apply') === true;
  if (!projectId || !schoolId || !schoolName || !platformAdminUid) {
    throw new Error(
      'Wajib isi --project, --school-id, --school-name, dan --platform-admin-uid. ' +
      'Jalankan tanpa --apply terlebih dahulu untuk dry-run.'
    );
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const schoolRef = db.collection('schools').doc(schoolId);
  const school = await schoolRef.get();
  if (school.exists && school.get('name') !== schoolName) {
    throw new Error(`schools/${schoolId} sudah ada dengan nama berbeda; migrasi dibatalkan.`);
  }
  const bootstrapAdmin = await db.collection('users').doc(platformAdminUid).get();
  if (!bootstrapAdmin.exists || bootstrapAdmin.get('role') !== 'admin' || bootstrapAdmin.get('status') !== 'Aktif') {
    throw new Error('UID administrator platform harus menunjuk ke profil users/{uid} ber-role admin dan berstatus Aktif.');
  }
  const authUser = await admin.auth().getUser(platformAdminUid);
  if (authUser.disabled) throw new Error('Akun Firebase Authentication administrator platform sedang dinonaktifkan.');
  if (bootstrapAdmin.get('schoolId') && bootstrapAdmin.get('schoolId') !== schoolId) {
    throw new Error('Administrator platform sudah terhubung ke sekolah lain; tidak ada data yang diubah.');
  }

  const summary = {};
  for (const name of COLLECTIONS) {
    let sourceCount = 0;
    let targetCount = 0;
    let historyCount = 0;
    await visitPages(db.collection(name), async (source) => {
      sourceCount++;
      if ((await schoolRef.collection(name).doc(source.id).get()).exists) targetCount++;
      if (name === 'attendance') {
        historyCount += (await source.ref.collection('history').get()).size;
      }
    });
    summary[name] = { sourceCount, alreadyPresentAtDestination: targetCount, attendanceHistory: historyCount };
  }

  let userCount = 0;
  let usersAlreadyScoped = 0;
  const teacherClassByUsername = new Map();
  await visitPages(db.collection('teachers'), async (teacher) => {
    const username = String(teacher.get('usernameLower') || teacher.get('username') || '').toLowerCase();
    if (!username) return;
    if (teacherClassByUsername.has(username)) {
      throw new Error(`Lebih dari satu profil guru memakai username ${username}; migrasi dibatalkan.`);
    }
    teacherClassByUsername.set(username, String(teacher.get('className') || ''));
  });
  await visitPages(db.collection('users'), async (user) => {
    userCount++;
    const existingSchoolId = user.get('schoolId');
    if (existingSchoolId && existingSchoolId !== schoolId) {
      throw new Error(`users/${user.id} sudah milik sekolah ${existingSchoolId}; migrasi single-school dibatalkan.`);
    }
    if (existingSchoolId === schoolId) usersAlreadyScoped++;
  });

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY RUN (tidak ada perubahan)',
    projectId, schoolId, schoolName, userCount, usersAlreadyScoped, collections: summary
  }, null, 2));
  if (!apply) {
    console.log('Periksa backup dan ringkasan di atas. Jalankan kembali dengan --apply untuk menyalin data.');
    return;
  }

  if (!school.exists) {
    const majors = new Set();
    await visitPages(db.collection('classes'), async (classDoc) => {
      const major = String(classDoc.get('major') || '').trim();
      if (major) majors.add(major);
    });
    await schoolRef.create({
      name: schoolName,
      address: '',
      phone: '',
      educationLevels: ['SD', 'SMP', 'SMA', 'SMK'],
      majors: [...majors],
      status: 'Aktif',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      migration: 'single-school-v1'
    });
  }

  let batch = db.batch();
  let operations = 0;
  async function enqueue(operation) {
    operation(batch);
    operations++;
    if (operations >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }
  async function flush() {
    if (operations) await batch.commit();
    batch = db.batch();
    operations = 0;
  }

  for (const name of COLLECTIONS) {
    await visitPages(db.collection(name), async (source) => {
      const target = schoolRef.collection(name).doc(source.id);
      if (!(await target.get()).exists) await enqueue((writeBatch) => writeBatch.create(target, source.data()));
      if (name === 'attendance') {
        await visitPages(source.ref.collection('history'), async (change) => {
          const historyTarget = target.collection('history').doc(change.id);
          if (!(await historyTarget.get()).exists) {
            await enqueue((writeBatch) => writeBatch.create(historyTarget, change.data()));
          }
        });
      }
    });
  }
  await visitPages(db.collection('users'), async (user) => {
    const username = String(user.get('usernameLower') || user.get('username') || '').toLowerCase();
    const className = user.get('role') === 'guru' ? teacherClassByUsername.get(username) : undefined;
    const changes = {
      ...(user.get('schoolId') !== schoolId ? { schoolId } : {}),
      ...(className !== undefined ? { className } : {})
    };
    if (Object.keys(changes).length) {
      await enqueue((writeBatch) => writeBatch.update(user.ref, changes));
    }
  });
  await flush();
  await db.collection('platformAdmins').doc(platformAdminUid).set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    bootstrap: 'single-school-migration'
  }, { merge: true });
  console.log('Migrasi selesai. Data lama tetap dipertahankan sebagai salinan sumber.');
}

main().catch((error) => {
  console.error(`Migrasi gagal: ${error.message}`);
  process.exitCode = 1;
});
