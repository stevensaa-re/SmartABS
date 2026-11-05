# Firestore database reference

Firestore is the canonical shared data store for website, Android, and desktop. No client should
maintain a separate authoritative attendance or roster database.

## Identity and tenant keys

- Firebase Authentication UID is the primary account key at `users/{uid}`.
- `students/{nis}` uses the school student number as its document key; its `userId` links the
  authentication profile.
- `teachers/{id}` uses an application-generated document ID and links to a user through username
  and schedule `teacherUid`.
- `schoolId` identifies tenant ownership on profiles and records. Names and class labels are not
  tenant identifiers.
- Firestore Rules enforce same-school access; Website and Android adapters scope queries and add
  the tenant key to new documents. Existing records still need a reviewed migration before
  multi-school use; see the rollout warning in `../../FIREBASE_SETUP.md`.

## Semester configuration

- `semesters/{semesterId}` stores school-scoped name, academic year, term, date range, status
  (`Draft`, `Aktif`, or `Arsip`), and configuration-category initialization markers.
- `schools/{schoolId}.activeSemesterId` identifies the active semester used by Website schedules
  and QR attendance validation.
- `semesterConfigurations/{configurationId}` stores editable Draft snapshot rows. `type` is one
  of `subjects`, `teacherAssignments`, `schedules`, `periods`, or `classes`; each row includes
  `schoolId`, `semesterId`, deterministic `relationKey`, `sourceRelationKey`, and validated
  `payload`.
- Configuration copies use deterministic IDs derived from the target semester, type, and
  relation key. Existing relations are skipped and repeated copy requests do not create duplicates.
  Schedule time overlaps by class or teacher and conflicting subject-teacher assignments block
  copying and activation.
- Activation materializes schedules in `schedules/{scheduleId}` with fresh IDs and the active
  `semesterId`, applies class settings to existing class documents, archives the previous active
  semester, and records the operation in `auditLogs`.
- Attendance, attendance history, QR sessions, and session locks are excluded from snapshot/copy
  operations. Semester callables are the only writers; Rules allow same-school admin reads.

## Attendance

QR session tokens are generated server-side, expire after 30 seconds, and rotate via callable
Functions. A Firestore transaction checks the session, active student profile, class/schedule
match, and duplicate attendance before creating the attendance record. The per-schedule/date lock
prevents opening another active session. Direct client writes to
`attendanceSessions/{id}` and QR attendance creation are denied by Rules.

Manual attendance remains a distinct staff operation guarded by Firestore Rules. Corrections
write history so the previous attendance state remains auditable.

## Schema and tenant migration

Rules: `firestore.rules`  
Composite indexes: `firestore.indexes.json`  
Create the `schools/{schoolId}` record and assign the initial admin using a trusted operator
workflow; there is no public school-bootstrap callable.

`migrate-school-id.js` defaults to a read-only dry run. It scans tenant-owned collections, refuses
conflicting assignments, and accepts an explicit school ID only when that school is active. Before
any apply, make and verify a full Firestore export. The script also writes a new, mode-restricted
rollback manifest before adding tenant tags; the manifest is not a full data backup.

```bash
export GCLOUD_PROJECT=your-firebase-project
node migrate-school-id.js --school-id=school-id
node migrate-school-id.js --apply --school-id=school-id \
  --confirm-project=your-firebase-project --confirm-school=school-id \
  --confirm-export=gs://your-backup-bucket/verified-export \
  --backup-file=/secure/path/school-id-migration.json
node migrate-school-id.js --rollback=/secure/path/school-id-migration.json \
  --school-id=school-id --confirm-project=your-firebase-project \
  --confirm-school=school-id
```

Apply and rollback are never automatic. Use Application Default Credentials only from a trusted
operator environment, test the full process against an emulator copy first, and do not run it
against production until the export and tenant mapping are independently reviewed.
`--confirm-export` records the verified export reference in the manifest; the script cannot verify
the export contents or restoreability on its own.

The migration apply/rollback integration test uses its own empty emulator project:

```bash
firebase emulators:exec --only firestore --project demo-smartabs-migration \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 RUN_SCHOOL_ID_MIGRATION_EMULATOR_TESTS=1 node --test database/firebase/test/school-id-migration-emulator.test.js"
```

## Data retention and backup

Admin JSON export is a client-side manual export and does not include Firebase Authentication
credentials, QR-session lock data, or every subcollection. Configure Firebase-managed scheduled
exports independently and rehearse restore procedures before production use.
