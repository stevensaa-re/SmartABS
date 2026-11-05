# SMARTABS API and callable contract

The browser and Android clients use Firebase SDKs; there is no public REST service that is the
authoritative source of account or attendance data. Cloud Functions are deployed in
`asia-southeast1`.

## Callable Functions

All callables require Firebase Authentication. The backend reloads the `users/{uid}` profile and
checks active status and role. When the profile contains `schoolId`, it also requires an active
`schools/{schoolId}` record and checks related data ownership.

| Callable | Authorized caller | Input | Result / behavior |
|---|---|---|---|
| `getSchoolSetup` | Active school admin | none | Returns the admin's school profile and school-scoped academic, user, semester, and schedule records; creates a `Persiapan` placeholder school document if missing |
| `getSchoolSummary` | Active school user | none | Returns a safe school-profile summary and the school's validated active-semester summary for role dashboards and read-only information screens |
| `saveSchoolProfile` | Active school admin | school profile fields | Validates and saves school identity, level/type, contact, active academic year, operating hours, timezone, and late tolerance; activates the prepared school and audits the change |
| `saveAcademicMaster` | Active school admin | `type`, optional `recordId`, `payload` | Creates or updates one school-scoped program, academic level, room, subject, or class; validates references and duplicate codes/names and writes an audit entry |
| `saveActiveSchedule` | Active school admin | optional `scheduleId`, schedule `payload` | Creates or updates a schedule in the school's active semester after validating class, subject, teacher assignment, room, and conflicts |
| `deleteActiveSchedule` | Active school admin | `scheduleId` | Deletes a schedule from the active semester only when it has no attendance history or active QR session |
| `createUser` | Admin | `name`, `username`, `email`, `password`, `role`, `status` | Creates an Auth identity and matching `users/{uid}` profile |
| `createTeacherAccount` | Admin | `account`, `teacher` | Creates Auth identity, user profile, teacher profile, and audit entry |
| `createStudentAccount` | Admin | `account`, `student` | Creates Auth identity, user profile, student profile, and audit entry |
| `startAttendanceSession` | Active admin or assigned teacher | `scheduleId`, current school `date` | Creates a 30-second QR session and per-schedule/day lock |
| `rotateAttendanceSession` | Active admin or owning teacher | `sessionId` | Rotates the random token; previous token is briefly accepted during rollover |
| `closeAttendanceSession` | Active admin or owning teacher | `sessionId` | Closes the session and releases its lock |
| `submitQrAttendance` | Active linked student | `sessionId`, `token` | Transactionally validates and creates one attendance record |
| `getActiveSemester` | Active school user | none | Returns only the caller's school's active semester ID for client schedule filtering |
| `createSemester` | School admin | `name`, `academicYear`, `term`, `startDate`, `endDate`, optional `importCurrentConfiguration` | Creates an editable Draft and may snapshot current class/schedule configuration |
| `updateSemester` | School admin | `semesterId` and semester fields | Updates a Draft; active and archived semesters are immutable |
| `previewSemesterConfigurationCopy` | School admin | `sourceSemesterId`, `targetSemesterId`, `types[]` | Returns per-category create/skip counts and schedule/assignment conflicts |
| `copySemesterConfiguration` | School admin | Same as preview | Copies selected configuration into a Draft using deterministic new document IDs; retry-safe |
| `updateSemesterConfiguration` | School admin | `configurationId`, `payload` | Validates and edits a Draft configuration, rejecting duplicate relations and conflicts |
| `deleteSemesterConfiguration` | School admin | `configurationId` | Removes one configuration from a Draft |
| `activateSemester` | School admin | `semesterId` | Applies class settings, creates semester-bound schedules, archives the previous active semester, and records an audit event |

Successful responses contain JSON-safe values only. Errors use callable error codes, including
`unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, and
`failed-precondition`. Firebase Rules separately reject direct client writes to QR session
documents and QR attendance records.

## School setup and academic master data

The Website admin setup page stores the school profile in `schools/{schoolId}` and uses Cloud
Functions for profile and master-data writes. A pre-linked active admin can initialize a missing
school document in `Persiapan` state, then save a validated profile to activate the school. The
admin account itself must already have a trusted `schoolId`; this flow does not create the initial
administrator or school identity.

`saveAcademicMaster` accepts `programs`, `academicLevels`, `rooms`, `subjects`, or `classes`.
Document IDs are the relationship keys; display names and codes are not primary keys. SMK
programs are only accepted for an SMK school, class major/room/homeroom references are validated,
and subjects must support the school's education level. The Website supports a CSV subject
preview/import/export flow. CSV writes are per row rather than atomic; the UI reports partial
success so a failed import can be corrected and retried.

## Semester preparation

The Website admin page at `admin/semesters.html` creates editable Drafts, previews and copies
subjects per class, teacher assignments, schedules, lesson periods, and class settings, and
activates a reviewed Draft. Semester records live in `semesters/{semesterId}`; copied rows live in
`semesterConfigurations/{configurationId}` and carry `schoolId`, `semesterId`, `type`,
`relationKey`, `sourceRelationKey`, and a validated `payload`.

The copy operation does not read or write attendance, attendance history, QR sessions, or QR
session locks. Deterministic target IDs make a retry safe; existing relations are skipped. Preview
and copy both check class-time and teacher-time overlaps plus conflicting subject assignments.
Copy fails if any conflict remains. Activation is transactional, archives the prior active
semester, applies class settings, and materializes schedules with new IDs and the active `semesterId`.
QR session opening and check-in reject schedules outside the school's active semester. Audit entries
are written for semester creation, editing, copy, configuration changes, deletion, and activation.

## Validation notes

The Functions validate role, account fields, class/schedule existence, school relationship,
session expiry/token, roster membership, and duplicate attendance. Firebase Auth accounts are
deleted if their Firestore profile batch fails. Android and website clients scope ordinary
Firestore queries and new writes by `schoolId`; these changes still require wider emulator coverage
and a reviewed migration of historical records before a multi-school rollout.
