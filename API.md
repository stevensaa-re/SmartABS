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
