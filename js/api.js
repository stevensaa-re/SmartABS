/* =========================================================
   SMARTABS — API Layer (dispatcher)
   ---------------------------------------------------------
   Seluruh halaman dan modul UI hanya memanggil objek `API`.
   Objek ini adalah salah satu adapter, dipilih lewat
   APP_CONFIG.BACKEND di js/config.js:

     local    -> js/adapters/local.js     (localStorage, demo)
     mysql    -> js/adapters/mysql.js     (REST API + MySQL)
     firebase -> js/adapters/firebase.js  (Auth + Firestore)

   Semua adapter wajib memenuhi API_CONTRACT di bawah.
   ========================================================= */

const API_CONTRACT = [
  /* auth */
  'login', 'logout',
  /* users */
  'getUsers', 'createUser', 'updateUser', 'deleteUser',
  /* teachers */
  'getTeachers', 'getTeacherByUsername', 'createTeacher', 'updateTeacher', 'deleteTeacher',
  /* students */
  'getStudents', 'getStudentByNis', 'getStudentByUserId', 'createStudent', 'updateStudent', 'deleteStudent',
  /* classes */
  'getClasses', 'createClass', 'updateClass', 'deleteClass',
  /* schedules */
  'getSchedules', 'createSchedule', 'updateSchedule', 'deleteSchedule',
  /* announcements */
  'getAnnouncements', 'createAnnouncement', 'updateAnnouncement', 'deleteAnnouncement',
  /* attendance */
  'getAttendanceRange', 'getAttendanceByDate', 'getAttendanceByStudent',
  'getAttendanceByStudentDate', 'saveAttendance', 'deleteAttendance',
  'getAttendanceForStudentDate',
  'startAttendanceSession', 'rotateAttendanceSession', 'closeAttendanceSession',
  'submitQrAttendance',
  /* permissions */
  'getPermissions', 'getPermissionsByStudent', 'createPermission', 'reviewPermission',
  /* reports */
  'getReport'
];

const API = (() => {
  const adapters = {
    local:    typeof LocalAdapter    !== 'undefined' ? LocalAdapter    : null,
    mysql:    typeof MysqlAdapter    !== 'undefined' ? MysqlAdapter    : null,
    firebase: typeof FirebaseAdapter !== 'undefined' ? FirebaseAdapter : null
  };

  const adapter = adapters[APP_CONFIG.BACKEND];

  if (!adapter) {
    throw new Error(`APP_CONFIG.BACKEND "${APP_CONFIG.BACKEND}" tidak dikenali / adapter belum dimuat.`);
  }

  API_CONTRACT.forEach((method) => {
    if (typeof adapter[method] !== 'function') {
      console.error(`[SMARTABS] Adapter "${APP_CONFIG.BACKEND}" belum mengimplementasikan API.${method}()`);
    }
  });

  return adapter;
})();

/* ---------------------------------------------------------
   Rekap laporan kehadiran (dipakai adapter local & firebase;
   adapter MySQL menghitungnya langsung di SQL)
   --------------------------------------------------------- */
function buildReport(students, attendance) {
  const rekap = students.map((student) => {
    const rows = attendance.filter((row) => row.studentId === student.nis);

    const hadir = rows.filter((r) => r.status === 'Hadir').length;
    const izin  = rows.filter((r) => r.status === 'Izin').length;
    const sakit = rows.filter((r) => r.status === 'Sakit').length;
    const alpa  = rows.filter((r) => r.status === 'Alpa').length;
    const total = hadir + izin + sakit + alpa;

    return {
      nis: student.nis,
      name: student.name,
      className: student.className,
      hadir, izin, sakit, alpa,
      total,
      percentage: total > 0 ? Math.round((hadir / total) * 100) : 0
    };
  });

  return rekap.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}
