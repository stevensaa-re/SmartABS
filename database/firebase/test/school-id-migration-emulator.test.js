const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');

const enabled = process.env.RUN_SCHOOL_ID_MIGRATION_EMULATOR_TESTS === '1' &&
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = process.env.GCLOUD_PROJECT || 'demo-smartabs-migration';
const schoolId = 'migration-test-school';
const app = admin.initializeApp({ projectId }, `school-id-migration-${process.pid}`);
const db = admin.firestore(app);
const scriptPath = path.resolve(__dirname, '../migrate-school-id.js');

test('school ID migration dry-runs, applies with a manifest, and safely rolls back', {
  skip: !enabled && 'Set RUN_SCHOOL_ID_MIGRATION_EMULATOR_TESTS=1 with the Firestore emulator.'
}, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartabs-school-id-'));
  const manifestPath = path.join(tempDir, 'rollback.json');
  const refs = [
    db.collection('users').doc('migration-test-user'),
    db.collection('classes').doc('migration-test-class'),
    db.collection('attendance').doc('migration-test-attendance'),
    db.collection('announcements').doc('migration-test-conflict')
  ];
  t.after(async () => {
    await Promise.all([...refs, db.collection('schools').doc(schoolId)].map((ref) => ref.delete()));
    fs.rmSync(tempDir, { recursive: true, force: true });
    await app.delete();
  });

  await db.collection('schools').doc(schoolId).set({ status: 'Aktif' });
  await refs[0].set({ name: 'Migration User', schoolId: '' });
  await refs[1].set({ name: 'Migration Class' });
  await refs[2].set({ studentId: 'NIS-1', schoolId });
  await refs[3].set({ title: 'Conflicting tenant', schoolId: 'another-school' });

  const conflictRun = runScript([`--school-id=${schoolId}`], tempDir);
  assert.equal(conflictRun.status, 1);
  assert.match(conflictRun.output, /Tenant conflicts found/);
  assert.equal((await refs[0].get()).get('schoolId'), '');
  await refs[3].delete();

  const dryRun = runScript([`--school-id=${schoolId}`], tempDir);
  assert.equal(dryRun.status, 0, dryRun.output);
  assert.match(dryRun.output, /Documents to tag: 2/);
  assert.equal((await refs[0].get()).get('schoolId'), '');
  assert.equal((await refs[1].get()).get('schoolId'), undefined);

  const apply = runScript([
    '--apply',
    `--school-id=${schoolId}`,
    `--confirm-project=${projectId}`,
    `--confirm-school=${schoolId}`,
    '--confirm-export=emulator-test-export',
    `--backup-file=${manifestPath}`
  ], tempDir);
  assert.equal(apply.status, 0, apply.output);
  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
  assert.equal((await refs[0].get()).get('schoolId'), schoolId);
  assert.equal((await refs[1].get()).get('schoolId'), schoolId);

  await refs[1].update({ schoolId: 'another-school' });
  const blockedRollback = runScript([
    `--rollback=${manifestPath}`,
    `--school-id=${schoolId}`,
    `--confirm-project=${projectId}`,
    `--confirm-school=${schoolId}`
  ], tempDir);
  assert.equal(blockedRollback.status, 1);
  assert.match(blockedRollback.output, /Rollback stopped before writing/);
  assert.equal((await refs[0].get()).get('schoolId'), schoolId);
  await refs[1].update({ schoolId });

  const rollback = runScript([
    `--rollback=${manifestPath}`,
    `--school-id=${schoolId}`,
    `--confirm-project=${projectId}`,
    `--confirm-school=${schoolId}`
  ], tempDir);
  assert.equal(rollback.status, 0, rollback.output);
  assert.equal((await refs[0].get()).get('schoolId'), '');
  assert.equal((await refs[1].get()).get('schoolId'), undefined);
  assert.equal((await refs[2].get()).get('schoolId'), schoolId);
});

function runScript(args, cwd) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GCLOUD_PROJECT: projectId
    },
    timeout: 60000
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`
  };
}
