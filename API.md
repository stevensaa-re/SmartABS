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

Successful responses contain JSON-safe values only. Errors use callable error codes, including
`unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, and
`failed-precondition`. Firebase Rules separately reject direct client writes to QR session
documents and QR attendance records.

## Validation notes

The Functions validate role, account fields, class/schedule existence, school relationship,
session expiry/token, roster membership, and duplicate attendance. Firebase Auth accounts are
deleted if their Firestore profile batch fails. These callables do not make all other existing
client operations tenant-safe; the multi-school rollout remains blocked pending full Rules/query
coverage.
