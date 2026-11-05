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
QR session creation/rotation/closure, QR attendance check-in, school profile/master-data writes,
active schedule changes, and semester preparation/activation must go through these callables.
Clients obtain the current semester ID through `getActiveSemester` and a safe school/semester
summary through `getSchoolSummary`; they do not need broad read access to school or semester
documents for normal displays.
Admin SDK writes bypass Firestore Rules, so each callable must authenticate, authorize, validate
tenant relationships, and validate input itself.

## Firestore data outline

| Collection | Main key / fields | Purpose |
|---|---|---|
| `schools/{schoolId}` | `name`, `npsn`, `logoUrl`, `schoolLevel`, `schoolType`, operating hours/days, `timeZone`, `lateToleranceMinutes`, `activeSemesterId`, `status` | School profile and operational configuration |
| `users/{uid}` | `role`, `status`, `schoolId`, `nis`, `className` | Authenticated account profile and role |
| `students/{nis}` | `nis`, `userId`, `className`, `schoolId` | Student academic profile |
| `teachers/{id}` | `username`, `className`, `subject`, `schoolId` | Teacher profile |
| `programs/{id}` | `code`, `name`, `level`, `isActive`, `schoolId` | Admin-managed SMK program/major catalog |
| `academicLevels/{id}` | `code`, `name`, `level`, `sortOrder`, `isActive`, `schoolId` | Configurable grade-level catalog |
| `rooms/{id}` | `code`, `name`, `capacity`, `isActive`, `schoolId` | School room catalog |
| `subjects/{id}` | `code`, `name`, `category`, `educationLevels`, `isActive`, `schoolId` | Dynamic subject catalog |
| `classes/{id}` | `name`, `level`, `majorId`, `roomId`, `homeroomTeacherUid`, `schoolId` | Class/rombel and roster grouping |
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
valid IANA `timeZone` (for example `Asia/Jakarta`) for regular use. A trusted operator must first
assign `schoolId` to the initial admin profile; the authenticated `getSchoolSetup` callable can
then initialize a `Persiapan` school placeholder for that admin, and `saveSchoolProfile` completes
the profile. This is not a public endpoint for creating arbitrary schools or admin accounts.

## Other Firebase services

Website school-logo upload uses Firebase Storage at
`schools/{schoolId}/logo/{fileName}`. `database/firebase/storage.rules` limits reads to school
members and writes/deletes to school admins; uploaded images are restricted to PNG, JPEG, or WebP
and 2 MiB. The Storage Emulator test is still outstanding. FCM push delivery is deferred; do not
treat notification delivery as available. Neither feature should use private service-account
material in a client.

## Local emulator checks

From the website root, run the callable integration test with all three emulators:

```bash
firebase emulators:exec --only auth,firestore,functions --project demo-smartabs-rules \
  "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001 npm --prefix functions test"
```

The Functions suite includes school setup/master-data coverage as well as a semester lifecycle
scenario covering tenant isolation, preview, conflict rejection, idempotent retry, Draft edits,
activation, current-configuration snapshotting, and exclusion of attendance/QR data.

Run Firestore Rules tests separately:

```bash
firebase emulators:exec --only auth,firestore --project demo-smartabs-rules \
  "npm --prefix database/firebase test"
```

Functions unit tests can also run without emulators using `npm test` from `functions/`. Keep
emulator data separate from school data; the demo project ID prevents access to live Firebase
services.
