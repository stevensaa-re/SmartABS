/* =========================================================
   SMARTABS — Data Mock
   Data awal untuk demo. Dipakai oleh api.js saat pertama kali
   aplikasi dijalankan (belum ada backend).
   ========================================================= */

const MOCK_DATA = {

  /* ---------- Pengguna ---------- */
  users: [
    { id: 'U001', name: 'Administrator',       username: 'admin', password: 'admin123', role: 'admin', status: 'Aktif',    email: 'admin@smartabs.sch.id' },
    { id: 'U002', name: 'Budi Santoso, S.Kom', username: 'guru',  password: 'guru123',  role: 'guru',  status: 'Aktif',    email: 'budi@smartabs.sch.id' },
    { id: 'U003', name: 'Andi Pratama',        username: 'siswa', password: 'siswa123', role: 'siswa', status: 'Aktif',    email: 'andi@smartabs.sch.id' },
    { id: 'U004', name: 'Siti Aminah, S.Kom',  username: 'siti',  password: 'siti123',  role: 'guru',  status: 'Aktif',    email: 'siti@smartabs.sch.id' },
    { id: 'U005', name: 'Bunga Citra',         username: 'bunga', password: 'bunga123', role: 'siswa', status: 'Aktif',    email: 'bunga@smartabs.sch.id' },
    { id: 'U006', name: 'Rina Marlina',        username: 'rina',  password: 'rina123',  role: 'admin', status: 'Nonaktif', email: 'rina@smartabs.sch.id' },
    { id: 'U007', name: 'Hendra Gunawan, S.Pd', username: 'hendra', password: 'hendra123', role: 'guru', status: 'Aktif',  email: 'hendra@smartabs.sch.id' }
  ],

  /* ---------- Siswa ---------- */
  students: [
    { nis: '2024001', name: 'Andi Pratama',     className: 'XII RPL 2', gender: 'L', status: 'Aktif',    userId: 'U003', phone: '0812-1111-0001' },
    { nis: '2024002', name: 'Bunga Citra',      className: 'XII RPL 2', gender: 'P', status: 'Aktif',    userId: 'U005', phone: '0812-1111-0002' },
    { nis: '2024003', name: 'Cahya Nugraha',    className: 'XII RPL 2', gender: 'L', status: 'Aktif',    userId: '',     phone: '0812-1111-0003' },
    { nis: '2024004', name: 'Dewi Lestari',     className: 'XII RPL 2', gender: 'P', status: 'Aktif',    userId: '',     phone: '0812-1111-0004' },
    { nis: '2024005', name: 'Eko Wijaya',       className: 'XII RPL 2', gender: 'L', status: 'Aktif',    userId: '',     phone: '0812-1111-0005' },
    { nis: '2024006', name: 'Fitri Handayani',  className: 'XII RPL 2', gender: 'P', status: 'Aktif',    userId: '',     phone: '0812-1111-0006' },
    { nis: '2023011', name: 'Galih Ramadhan',   className: 'XI RPL 1',  gender: 'L', status: 'Aktif',    userId: '',     phone: '0812-2222-0011' },
    { nis: '2023012', name: 'Hana Safira',      className: 'XI RPL 1',  gender: 'P', status: 'Aktif',    userId: '',     phone: '0812-2222-0012' },
    { nis: '2023013', name: 'Irfan Maulana',    className: 'XI RPL 1',  gender: 'L', status: 'Aktif',    userId: '',     phone: '0812-2222-0013' },
    { nis: '2023014', name: 'Jihan Aulia',      className: 'XI RPL 1',  gender: 'P', status: 'Nonaktif', userId: '',     phone: '0812-2222-0014' },
    { nis: '2022010', name: 'Kevin Saputra',    className: 'XII RPL 1', gender: 'L', status: 'Aktif',    userId: '',     phone: '0812-3333-0010' },
    { nis: '2022011', name: 'Laras Ayu',        className: 'XII RPL 1', gender: 'P', status: 'Aktif',    userId: '',     phone: '0812-3333-0011' }
  ],

  /* ---------- Guru ---------- */
  teachers: [
    { id: 'G001', name: 'Budi Santoso, S.Kom', username: 'guru', subject: 'Pemrograman Web & Perangkat Bergerak', className: 'XII RPL 2', status: 'Aktif' },
    { id: 'G002', name: 'Siti Aminah, S.Kom',  username: 'siti', subject: 'Basis Data',                          className: 'XI RPL 1',  status: 'Aktif' },
    { id: 'G003', name: 'Hendra Gunawan, S.Pd', username: 'hendra', subject: 'Matematika',                        className: 'XII RPL 1', status: 'Aktif' }
  ],

  /* ---------- Kelas ---------- */
  classes: [
    { id: 'K001', name: 'X RPL 1',   level: 'X',   major: 'RPL', homeroom: 'Drs. Hendra Wijaya',   capacity: 36 },
    { id: 'K002', name: 'X RPL 2',   level: 'X',   major: 'RPL', homeroom: 'Ibu Ratna Sari, S.Pd', capacity: 36 },
    { id: 'K003', name: 'XI RPL 1',  level: 'XI',  major: 'RPL', homeroom: 'Siti Aminah, S.Kom',   capacity: 36 },
    { id: 'K004', name: 'XI RPL 2',  level: 'XI',  major: 'RPL', homeroom: 'Bapak Yudi Hartono',   capacity: 36 },
    { id: 'K005', name: 'XII RPL 1', level: 'XII', major: 'RPL', homeroom: 'Hendra Gunawan, S.Pd', capacity: 36 },
    { id: 'K006', name: 'XII RPL 2', level: 'XII', major: 'RPL', homeroom: 'Budi Santoso, S.Kom',  capacity: 36 }
  ],

  /* ---------- Jadwal ---------- */
  schedules: [
    { id: 'J001', day: 'Senin',  start: '07:00', end: '09:30', subject: 'Pemrograman Web',        teacher: 'Budi Santoso, S.Kom', className: 'XII RPL 2' },
    { id: 'J002', day: 'Senin',  start: '09:45', end: '12:00', subject: 'Basis Data',             teacher: 'Siti Aminah, S.Kom',  className: 'XII RPL 2' },
    { id: 'J003', day: 'Selasa', start: '07:00', end: '09:30', subject: 'Pemodelan Perangkat Lunak', teacher: 'Hendra Gunawan, S.Pd', className: 'XII RPL 2' },
    { id: 'J004', day: 'Selasa', start: '10:00', end: '12:00', subject: 'Bahasa Indonesia',       teacher: 'Ibu Ratna Sari, S.Pd', className: 'XII RPL 2' },
    { id: 'J005', day: 'Rabu',   start: '07:00', end: '09:30', subject: 'Pemrograman Berorientasi Objek', teacher: 'Budi Santoso, S.Kom', className: 'XII RPL 2' },
    { id: 'J006', day: 'Rabu',   start: '09:45', end: '11:15', subject: 'Matematika',             teacher: 'Hendra Gunawan, S.Pd', className: 'XII RPL 2' },
    { id: 'J007', day: 'Kamis',  start: '07:00', end: '09:30', subject: 'Basis Data Lanjutan',    teacher: 'Siti Aminah, S.Kom',  className: 'XII RPL 2' },
    { id: 'J008', day: 'Kamis',  start: '10:00', end: '12:00', subject: 'Bahasa Inggris',         teacher: 'Mrs. Diana Putri',    className: 'XII RPL 2' },
    { id: 'J009', day: 'Jumat',  start: '07:00', end: '09:00', subject: 'Projek Kreatif',         teacher: 'Budi Santoso, S.Kom', className: 'XII RPL 2' },
    { id: 'J010', day: 'Senin',  start: '07:00', end: '09:30', subject: 'Basis Data',             teacher: 'Siti Aminah, S.Kom',  className: 'XI RPL 1' },
    { id: 'J011', day: 'Selasa', start: '09:45', end: '12:00', subject: 'Pemrograman Dasar',      teacher: 'Budi Santoso, S.Kom', className: 'XI RPL 1' },
    { id: 'J012', day: 'Rabu',   start: '07:00', end: '09:30', subject: 'Matematika',             teacher: 'Hendra Gunawan, S.Pd', className: 'XII RPL 1' }
  ],

  /* ---------- Pengumuman ---------- */
  announcements: [
    {
      id: 'P001',
      title: 'Pelaksanaan Ujian Tengah Semester',
      content: 'Ujian Tengah Semester (UTS) akan dilaksanakan pada tanggal 20 s.d. 25 Oktober 2026. Seluruh siswa wajib membawa kartu ujian dan hadir 15 menit sebelum ujian dimulai.',
      date: '2026-10-10',
      status: 'Publish'
    },
    {
      id: 'P002',
      title: 'Pemeliharaan Perangkat Absensi IoT',
      content: 'Perangkat absensi RFID di gerbang sekolah akan dilakukan pemeliharaan pada hari Sabtu. Selama proses berlangsung, absensi dapat dilakukan melalui halaman absensi SMARTABS.',
      date: '2026-10-08',
      status: 'Publish'
    },
    {
      id: 'P003',
      title: 'Rapat Wali Murid Kelas XII',
      content: 'Rapat koordinasi persiapan ujian akhir akan dilaksanakan pada hari Jumat pukul 13.00 di aula sekolah. Diharapkan kehadiran seluruh wali murid kelas XII.',
      date: '2026-10-05',
      status: 'Publish'
    },
    {
      id: 'P004',
      title: 'Draft Jadwal Ekstrakurikuler',
      content: 'Draft jadwal kegiatan ekstrakurikuler semester ganjil sedang disusun oleh pembina.',
      date: '2026-10-01',
      status: 'Draft'
    }
  ],

  /* ---------- Pengajuan Izin / Sakit / Alpa ---------- */
  permissions: [
    { id: 'I001', studentId: '2024003', name: 'Cahya Nugraha',  className: 'XII RPL 2', date: shiftDate(-1), type: 'Izin',  note: 'Menghadiri acara keluarga',   status: 'Menunggu'  },
    { id: 'I002', studentId: '2024004', name: 'Dewi Lestari',   className: 'XII RPL 2', date: shiftDate(-2), type: 'Sakit', note: 'Demam, ada surat dokter',      status: 'Disetujui' },
    { id: 'I003', studentId: '2024005', name: 'Eko Wijaya',     className: 'XII RPL 2', date: shiftDate(-3), type: 'Alpa',  note: 'Tanpa keterangan',             status: 'Ditolak'   },
    { id: 'I004', studentId: '2024006', name: 'Fitri Handayani',className: 'XII RPL 2', date: shiftDate(0),  type: 'Izin',  note: 'Mengikuti lomba LKS',          status: 'Menunggu'  },
    { id: 'I005', studentId: '2023012', name: 'Hana Safira',    className: 'XI RPL 1',  date: shiftDate(-1), type: 'Sakit', note: 'Migrain',                      status: 'Menunggu'  }
  ]
};

/* =========================================================
   Generator riwayat absensi (untuk demo)
   ========================================================= */

const JENIS_KETERANGAN = {
  Hadir: 'Absensi RFID/QR',
  Izin: 'Keperluan keluarga',
  Sakit: 'Surat keterangan dokter',
  Alpa: 'Tanpa keterangan'
};

/* Membuat absensi 14 hari ke belakang (tidak termasuk hari ini) */
function buildAttendanceHistory() {
  const rows = [];
  const pola = ['Hadir', 'Hadir', 'Hadir', 'Hadir', 'Hadir', 'Hadir', 'Hadir', 'Hadir', 'Izin', 'Sakit', 'Alpa'];

  for (let back = 14; back >= 1; back--) {
    const date = shiftDate(-back);

    MOCK_DATA.students.forEach((student, index) => {
      if (student.status !== 'Aktif') return;

      const status = pola[(index * 3 + back) % pola.length];
      const minute = 5 + ((index * 7 + back) % 25);

      rows.push({
        id: `A-${date}-${student.nis}`,
        studentId: student.nis,
        name: student.name,
        className: student.className,
        date,
        time: status === 'Hadir' ? `07:${pad2(minute)}` : '-',
        status,
        note: JENIS_KETERANGAN[status]
      });
    });
  }

  return rows;
}

/* Membuat absensi hari ini (siswa demo "2024001" sengaja belum absen) */
function buildTodayAttendance(date) {
  const rows = [];
  const SISWA_DEMO = '2024001';

  MOCK_DATA.students.forEach((student, index) => {
    if (student.status !== 'Aktif') return;
    if (student.nis === SISWA_DEMO) return; // agar fitur "Absen Sekarang" bisa dicoba

    const sisa = (index * 5) % 12;
    const status = sisa === 8 ? 'Izin' : sisa === 10 ? 'Sakit' : sisa === 11 ? 'Alpa' : 'Hadir';

    rows.push({
      id: `A-${date}-${student.nis}`,
      studentId: student.nis,
      name: student.name,
      className: student.className,
      date,
      time: status === 'Hadir' ? `07:${pad2(6 + ((index * 3) % 22))}` : '-',
      status,
      note: JENIS_KETERANGAN[status]
    });
  });

  return rows;
}