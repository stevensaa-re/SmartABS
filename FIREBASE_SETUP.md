# Firebase setup and security boundaries

Firebase Authentication, Cloud Firestore, and Cloud Functions are the shared backend for the
website, Android, and desktop clients. Do not configure a second database for another client.

## Project setup

1. Create or select the school-owned Firebase project. Enable Email/Password in Authentication
   and create the default Firestore database.
2. Configure the web app in `js/config.js` and Android Studio's local
   `SmartabsAndroid/app/google-services.json`. These are client identifiers; never put an Admin
   SDK key in a client.
3. Use Node.js 22 and install the Functions dependencies with `npm ci` in `functions/`.
4. Test rules and callables against the emulators before any deployment. For a deployment approved
   by the project owner, deploy `firestore:rules`, `firestore:indexes`, and `functions` together:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,functions
   ```

   Cloud Functions deployment may require a billing-enabled Firebase/Google Cloud plan. This
   repository change does not deploy to a Firebase project.

Callable Functions are in `functions/index.js` and use `asia-southeast1`. Account provisioning,
QR session creation/rotation/closure, and QR attendance check-in must go through these callables.
Admin SDK writes bypass Firestore Rules, so each callable must authenticate, authorize, validate
tenant relationships, and validate input itself.

## Firestore data outline

| Collection | Main key / fields | Purpose |
|---|---|---|
| `schools/{schoolId}` | `name`, `status`, `timeZone` | Tenant metadata; active tenant is checked by sensitive callables |
| `users/{uid}` | `role`, `status`, `schoolId`, `nis`, `className` | Authenticated account profile and role |
| `students/{nis}` | `nis`, `userId`, `className`, `schoolId` | Student academic profile |
| `teachers/{id}` | `username`, `className`, `subject`, `schoolId` | Teacher profile |
| `classes/{id}` | `name`, `schoolId` | Class roster grouping |
| `schedules/{id}` | `teacherUid`, `className`, `subject`, `schoolId` | Lesson assignment |
| `attendance/{id}` | `studentId`, `scheduleId`, `sessionId`, `status`, `source`, `schoolId` | Attendance result |
| `attendanceSessions/{id}` | `scheduleId`, `date`, `token`, `expiresAt`, `active`, `schoolId` | Short-lived QR session |
| `attendanceSessionLocks/{id}` | `sessionId`, `scheduleId`, `date`, `schoolId` | Prevents concurrent active sessions |
| `attendance/{id}/history/{entryId}` | change metadata | Attendance correction history |
| `auditLogs/{id}` | actor/action/entity metadata | Administrative audit trail |
| `permissions/{id}` | student, date, status, school | Leave/sick requests |

Other collections used by the current clients include announcements, calendar events, holidays,
and report-related records. Refer to `database/firebase/firestore.indexes.json` for composite
indexes and `database/firebase/firestore.rules` for the deployed client access policy.

## Tenant and rollout limitations

Callables enforce `schoolId` equality and require an active `schools/{schoolId}` document when
the caller profile has a `schoolId`. Firestore Rules now deny cross-school access, and the website
Firebase adapter adds the active `schoolId` to queries and new document writes. Android still
needs the matching query/write behavior and legacy records need a reviewed, backed-up migration.
Therefore **multi-school production use is not yet safe or supported**. Do not assign multiple
schools to one project until Android integration, data migration, and cross-platform emulator
tests are complete.

For a tenant-bound admin profile, `schools/{schoolId}` must exist with `status: "Aktif"` and a
valid IANA `timeZone` (for example `Asia/Jakarta`). School provisioning is an operator/bootstrap
task; there is not yet a self-service school creation workflow.

## Other Firebase services

Firebase Storage upload rules and client upload flows are not yet implemented. FCM push delivery
is also deferred; do not treat notification delivery as available. Neither feature should use
private service-account material in a client.

## Local emulator checks

Run the Firestore Rules tests from this directory with the Firebase CLI and Auth/Firestore
emulators. Run Functions unit tests with `npm test` from `functions/`; the callable integration
test is enabled when Auth, Firestore, and Functions emulator host variables are present. Keep
emulator data separate from school data.
