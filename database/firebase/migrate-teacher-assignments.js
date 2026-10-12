/*
 * Backfill teacher class assignments onto users/{uid} for Firestore Rules.
 * Run from database/firebase after configuring Application Default Credentials,
 * or provide GOOGLE_APPLICATION_CREDENTIALS to a service-account file.
 * This updates only the className field and does not change Auth credentials.
 */

const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function migrate() {
  const db = admin.firestore();
  const [schoolSnapshot, userSnapshot] = await Promise.all([
    db.collection('schools').get(),
    db.collection('users').get()
  ]);
  const usersBySchoolAndUsername = new Map(userSnapshot.docs.map((doc) => [
    `${doc.get('schoolId')}:${String(doc.get('usernameLower') || doc.get('username') || '').toLowerCase()}`,
    doc
  ]));
  const assignments = new Map();

  for (const school of schoolSnapshot.docs) {
    const teacherSnapshot = await school.ref.collection('teachers').get();
    for (const teacher of teacherSnapshot.docs) {
      const username = String(teacher.get('username') || '').toLowerCase();
      const user = usersBySchoolAndUsername.get(`${school.id}:${username}`);
      if (!username || !user) {
        console.warn(`Skip ${school.id}/${teacher.id}: matching user profile not found.`);
        continue;
      }
      if (user.get('role') !== 'guru') {
        console.warn(`Skip ${school.id}/${username}: profile role is not guru.`);
        continue;
      }
      if (assignments.has(user.id)) {
        throw new Error(`Multiple teacher profiles are linked to ${username}; resolve this before migration.`);
      }
      assignments.set(user.id, String(teacher.get('className') || ''));
    }
  }

  let batch = db.batch();
  let writes = 0;
  for (const [uid, className] of assignments) {
    batch.update(db.collection('users').doc(uid), { className });
    writes++;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  console.log(`Updated class assignments for ${assignments.size} teacher profiles.`);
}

migrate().catch((error) => {
  console.error('Teacher assignment migration failed:', error.message);
  process.exitCode = 1;
});