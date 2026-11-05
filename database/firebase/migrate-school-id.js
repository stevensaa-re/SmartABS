const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const {
  TENANT_COLLECTIONS,
  planSchoolIdUpdate,
  planSchoolIdRollback
} = require('./school-id-migration');

const argv = process.argv.slice(2);
const valueArg = (name) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const apply = argv.includes('--apply');
const rollbackFile = valueArg('--rollback');
const schoolId = valueArg('--school-id');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const confirmation = valueArg('--confirm-project');
const confirmedSchoolId = valueArg('--confirm-school');
const confirmedExport = valueArg('--confirm-export');
const backupFile = valueArg('--backup-file');

async function main() {
  const allowedValueArgs = [
    '--school-id',
    '--confirm-project',
    '--confirm-school',
    '--confirm-export',
    '--backup-file',
    '--rollback'
  ];
  const invalidOption = argv.find((arg) =>
    arg !== '--apply' && !allowedValueArgs.some((name) => arg.startsWith(`${name}=`))
  );
  if (invalidOption) throw new Error(`Unknown option: ${invalidOption}`);
  if (!projectId) throw new Error('Set GCLOUD_PROJECT to the exact Firebase project ID.');
  if (!schoolId || schoolId.length > 128 || schoolId.includes('/') || schoolId.trim() !== schoolId) {
    throw new Error('Provide a valid --school-id=<school-id>. No data was changed.');
  }
  if (apply && rollbackFile) throw new Error('Choose either --apply or --rollback, not both.');
  if (apply || rollbackFile) {
    requireConfirmation();
  }

  const appOptions = { projectId };
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    appOptions.credential = admin.credential.applicationDefault();
  }
  admin.initializeApp(appOptions);
  const db = admin.firestore();

  if (rollbackFile) {
    await rollbackMigration(db, rollbackFile);
    return;
  }

  const school = await db.collection('schools').doc(schoolId).get();
  if (!school.exists || school.get('status') !== 'Aktif') {
    throw new Error(`schools/${schoolId} must exist with status "Aktif". No data was changed.`);
  }

  const plan = await buildPlan(db);
  printPlan(plan);
  if (plan.conflicts.length) {
    throw new Error('Tenant conflicts found; resolve them before applying any migration.');
  }
  if (!apply) {
    console.log('Dry run only. No documents were changed.');
    return;
  }
  if (!backupFile) throw new Error('Apply requires --backup-file=<new-manifest-path>. No data was changed.');
  if (!confirmedExport || !confirmedExport.trim()) {
    throw new Error('Apply requires --confirm-export=<verified-export-reference>. No data was changed.');
  }

  const manifest = {
    version: 1,
    operation: 'add-schoolId',
    projectId,
    schoolId,
    confirmedExport,
    createdAt: new Date().toISOString(),
    documents: plan.updates
  };
  writeNewManifest(backupFile, manifest);
  console.log(`Rollback manifest saved: ${path.resolve(backupFile)}`);

  let updated = 0;
  for (const group of chunks(plan.updates, 10)) {
    await Promise.all(group.map(async (entry) => {
      const ref = db.doc(entry.path);
      const changed = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error(`${entry.path} disappeared after preflight.`);
        const decision = planSchoolIdUpdate(snapshot.data(), schoolId);
        if (decision.status === 'already-tagged') return false;
        if (decision.status !== 'update') {
          throw new Error(`${entry.path} changed tenant after preflight; stop and review the manifest.`);
        }
        transaction.update(ref, { schoolId });
        return true;
      });
      if (changed) updated++;
    }));
  }
  console.log(`Migration completed: ${updated} documents tagged with schoolId=${schoolId}.`);
}

async function buildPlan(db) {
  const updates = [];
  const alreadyTagged = [];
  const conflicts = [];

  for (const collectionName of TENANT_COLLECTIONS) {
    let cursor = null;
    while (true) {
      let query = db.collection(collectionName)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(400);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const snapshot of page.docs) {
        const decision = planSchoolIdUpdate(snapshot.data(), schoolId);
        if (decision.status === 'update') {
          updates.push({ path: snapshot.ref.path, ...decision.rollback });
        } else if (decision.status === 'already-tagged') {
          alreadyTagged.push(snapshot.ref.path);
        } else {
          conflicts.push({
            path: snapshot.ref.path,
            schoolId: decision.currentSchoolId
          });
        }
      }
      if (page.size < 400) break;
      cursor = page.docs[page.docs.length - 1];
    }
  }

  return { updates, alreadyTagged, conflicts };
}

async function rollbackMigration(db, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.operation !== 'add-schoolId' ||
      manifest.projectId !== projectId || manifest.schoolId !== schoolId ||
      !Array.isArray(manifest.documents)) {
    throw new Error('Rollback manifest does not match the confirmed project and school.');
  }

  const conflicts = [];
  for (const group of chunks(manifest.documents, 10)) {
    const snapshots = await Promise.all(group.map((entry) => db.doc(entry.path).get()));
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const decision = planSchoolIdRollback(snapshot.data(), group[index], schoolId);
      if (decision.status === 'conflict') conflicts.push(snapshot.ref.path);
    });
  }
  if (conflicts.length) {
    throw new Error(
      `Rollback stopped before writing; ${conflicts.length} documents now belong to another school: ` +
      conflicts.slice(0, 20).join(', ')
    );
  }

  let restored = 0;
  for (const group of chunks(manifest.documents, 10)) {
    await Promise.all(group.map(async (entry) => {
      const ref = db.doc(entry.path);
      const changed = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return false;
        const decision = planSchoolIdRollback(snapshot.data(), entry, schoolId);
        if (decision.status === 'already-restored') return false;
        if (decision.status !== 'restore') {
          throw new Error(`${entry.path} changed during rollback; stop and review the migration.`);
        }
        transaction.update(ref, {
          schoolId: entry.hadSchoolId ? decision.schoolId : admin.firestore.FieldValue.delete()
        });
        return true;
      });
      if (changed) restored++;
    }));
  }
  console.log(`Rollback completed: ${restored} manifest documents restored.`);
}

function requireConfirmation() {
  if (confirmation !== projectId || confirmedSchoolId !== schoolId) {
    throw new Error(
      `Writes require --confirm-project=${projectId} --confirm-school=${schoolId}. No data was changed.`
    );
  }
}

function writeNewManifest(filePath, manifest) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(absolutePath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function printPlan(plan) {
  console.log(`Project: ${projectId}`);
  console.log(`School: ${schoolId}`);
  console.log(`Documents to tag: ${plan.updates.length}`);
  console.log(`Already tagged: ${plan.alreadyTagged.length}`);
  console.log(`Tenant conflicts: ${plan.conflicts.length}`);
  if (plan.conflicts.length) {
    console.error('Conflicts (first 20):');
    for (const conflict of plan.conflicts.slice(0, 20)) {
      console.error(`  ${conflict.path}: schoolId=${JSON.stringify(conflict.schoolId)}`);
    }
  }
}

function* chunks(items, size) {
  for (let offset = 0; offset < items.length; offset += size) {
    yield items.slice(offset, offset + size);
  }
}

main().catch((error) => {
  console.error('School ID migration failed:', error.message);
  process.exitCode = 1;
});
