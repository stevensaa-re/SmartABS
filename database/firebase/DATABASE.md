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
- Firestore Rules enforce same-school access; the website adapter scopes queries and adds the
  tenant key to new documents. Android and legacy data still need migration before multi-school
  use; see the rollout warning in `../../FIREBASE_SETUP.md`.

## Attendance

QR session tokens are generated server-side, expire after 30 seconds, and rotate via callable
Functions. A Firestore transaction checks the session, active student profile, class/schedule
match, and duplicate attendance before creating the attendance record. The per-schedule/date lock
prevents opening another active session. Direct client writes to
`attendanceSessions/{id}` and QR attendance creation are denied by Rules.

Manual attendance remains a distinct staff operation guarded by Firestore Rules. Corrections
write history so the previous attendance state remains auditable.

## Schema and migrations

Rules: `firestore.rules`  
Composite indexes: `firestore.indexes.json`  
Tenant bootstrap and migration are not yet automated. Back up the Firestore project, dry-run a
school mapping, review collisions and unassigned records, and test rollback before changing
existing documents. Never use a demo seed/reset operation on a school project.

## Data retention and backup

Admin JSON export is a client-side manual export and does not include Firebase Authentication
credentials, QR-session lock data, or every subcollection. Configure Firebase-managed scheduled
exports independently and rehearse restore procedures before production use.
