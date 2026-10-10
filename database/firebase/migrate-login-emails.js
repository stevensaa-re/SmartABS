/*
 * Review or align existing Firebase Auth emails with users/{uid}.email.
 * Default mode is dry-run. Pass --apply only after reviewing the preview.
 * Uses Application Default Credentials; no credential file is loaded by this script.
 */

const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const apply = process.argv.includes('--apply');
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function migrate() {
  const db = admin.firestore();
  const auth = admin.auth();
  const profiles = await db.collection('users').get();
  let changed = 0;
  let skipped = 0;

  for (const profile of profiles.docs) {
    const uid = profile.id;
    const email = String(profile.get('email') || '').trim().toLowerCase();
    if (!email || !validEmail.test(email)) {
      console.log(`SKIP ${uid}: no valid profile email`);
      skipped++;
      continue;
    }

    let account;
    try {
      account = await auth.getUser(uid);
    } catch (error) {
      console.log(`SKIP ${uid}: Firebase Auth account not found`);
      skipped++;
      continue;
    }
    if ((account.email || '').toLowerCase() === email) continue;

    try {
      await auth.getUserByEmail(email);
      console.log(`SKIP ${uid}: ${email} is already used by another Auth account`);
      skipped++;
      continue;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    console.log(`${apply ? 'UPDATE' : 'PREVIEW'} ${uid}: ${account.email || '(no Auth email)'} -> ${email}`);
    if (apply) {
      await auth.updateUser(uid, { email, emailVerified: false });
      changed++;
    }
  }

  console.log(`${apply ? 'Applied' : 'Preview only'}: ${changed} changed; ${skipped} skipped.`);
  if (!apply) console.log('Re-run with --apply only after reviewing every email change above.');
}

migrate().catch((error) => {
  console.error('Login email migration failed:', error.message);
  process.exitCode = 1;
});
