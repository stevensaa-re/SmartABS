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
QR session creation/rotation/closure, QR attendance check-in, and semester preparation/activation
must go through these callables. Clients obtain the current semester ID through
`getActiveSemester`; they do not need broad read access to school or semester documents to filter
their schedules.
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
| `semesters/{semesterId}` | `name`, academic year, dates, status | School-scoped semester lifecycle; active pointer is `schools/{schoolId}.activeSemesterId` |
| `semesterConfigurations/{configurationId}` | `semesterId`, `type`, relation keys, validated `payload`, `schoolId` | Editable semester snapshot for subjects, teacher assignments, schedules, lesson periods, and class settings |

Other collections used by the current clients include announcements, calendar events, holidays,
and report-related records. Refer to `database/firebase/firestore.indexes.json` for composite
indexes and `database/firebase/firestore.rules` for the deployed client access policy.

Semester copies use new deterministic document IDs and are safe to retry. Preview and backend copy
reject teacher/class schedule overlaps and conflicting assignments. Only Draft semesters can be
edited; activation applies class settings, creates semester-bound schedules, updates
`schools/{schoolId}.activeSemesterId`, archives the previous active semester, and writes audit
records. Attendance, attendance history, QR sessions, and session locks are never part of a
semester copy. Firestore Rules allow same-school admin reads and deny direct client writes to
semester records; Cloud Functions are the only writer.

## Tenant and rollout limitations

Callables enforce `schoolId` equality and require an active `schools/{schoolId}` document when
the caller profile has a `schoolId`. Firestore Rules deny cross-school access. Website and Android
Firebase adapters scope queries and writes by the active school, and the C# Desktop app embeds the
same website source. Android source compilation and server-side emulator checks have passed, but
there is not yet broad cross-platform emulator coverage or a reviewed, backed-up migration for
historical records. Therefore **multi-school production use is not yet safe or supported**. Do not
assign multiple schools to one project until migration and data coverage are verified.

The dry-run-first tenant migration utility, its confirmation gates, and rollback-manifest workflow
are documented in [DATABASE.md](./database/firebase/DATABASE.md). It does not create a full backup;
an independently verified Firestore export is still required before applying it.

For a tenant-bound admin profile, `schools/{schoolId}` must exist with `status: "Aktif"` and a
valid IANA `timeZone` (for example `Asia/Jakarta`). School provisioning is an operator/bootstrap
task; there is not yet a self-service school creation workflow.

## Other Firebase services

Firebase Storage upload rules and client upload flows are not yet implemented. FCM push delivery
is also deferred; do not treat notification delivery as available. Neither feature should use
private service-account material in a client.

## Local emulator checks

From the website root, run the callable integration test with all three emulators:

```bash
firebase emulators:exec --only auth,firestore,functions --project demo-smartabs-rules \
  "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001 npm --prefix functions test"
```

The Functions suite includes a semester lifecycle scenario covering tenant isolation, preview,
conflict rejection, idempotent retry, Draft edits, activation, current-configuration snapshotting,
and exclusion of attendance/QR data.

Run Firestore Rules tests separately:

```bash
firebase emulators:exec --only auth,firestore --project demo-smartabs-rules \
  "npm --prefix database/firebase test"
```

Functions unit tests can also run without emulators using `npm test` from `functions/`. Keep
emulator data separate from school data; the demo project ID prevents access to live Firebase
services.
