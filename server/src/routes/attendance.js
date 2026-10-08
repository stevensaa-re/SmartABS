const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole, assertCanAccessStudent } = require('../auth');
const { asyncHandler, assert, str, oneOf, isValidDate, todayISO, nowHHMM, shiftISO, HHMM, HttpError } = require('../util');

const STATUSES = ['Hadir', 'Izin', 'Sakit', 'Alpa'];

const SELECT = `
  SELECT a.id, a.student_nis AS studentId, s.name,
         COALESCE(c.name, '-') AS className,
         a.\`date\` AS \`date\`,
         COALESCE(TIME_FORMAT(a.\`time\`, '%H:%i'), '-') AS \`time\`,
         a.status, a.note
  FROM attendance a
  JOIN students s ON s.nis = a.student_nis
  LEFT JOIN classes c ON c.id = a.class_id`;

/* Rentang tanggal (dipakai dashboard). Tanpa 'from' dibatasi 31 hari terakhir
   agar tidak pernah memindai seluruh tabel. */
router.get('/', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  const to = str(req.query.to) || todayISO();
  const from = str(req.query.from) || shiftISO(to, -31);
  assert(isValidDate(from) && isValidDate(to), 'Format tanggal tidak valid (YYYY-MM-DD).');

  const where = ['a.`date` >= ?', 'a.`date` <= ?'];
  const params = [from, to];

  if (req.query.className) {
    where.push('c.name = ?');
    params.push(str(req.query.className));
  }

  res.json(await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.\`date\`, s.name`, params));
}));

router.get('/date/:date', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  assert(isValidDate(req.params.date), 'Format tanggal tidak valid.');

  const where = ['a.`date` = ?'];
  const params = [req.params.date];

  if (req.query.className) {
    where.push('c.name = ?');
    params.push(str(req.query.className));
  }

  res.json(await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.name`, params));
}));

router.get('/student/:nis', asyncHandler(async (req, res) => {
  await assertCanAccessStudent(req, req.params.nis);
  res.json(await query(`${SELECT} WHERE a.student_nis = ? ORDER BY a.\`date\` DESC`, [req.params.nis]));
}));

router.get('/student/:nis/date/:date', asyncHandler(async (req, res) => {
  await assertCanAccessStudent(req, req.params.nis);
  assert(isValidDate(req.params.date), 'Format tanggal tidak valid.');
  res.json(await queryOne(`${SELECT} WHERE a.student_nis = ? AND a.\`date\` = ?`, [req.params.nis, req.params.date]));
}));

/* Simpan absensi (insert atau update untuk pasangan siswa+tanggal).
   - Admin/guru : bebas mengatur status siswa mana pun (bukan tanggal masa depan)
   - Siswa      : hanya absen "Hadir" untuk dirinya, HARI INI, sekali saja,
                  dengan jam yang diambil dari server (tidak bisa dipalsukan) */
router.post('/', requireRole('admin', 'guru', 'siswa'), asyncHandler(async (req, res) => {
  const nis = str(String(req.body.studentId || ''));
  const date = str(req.body.date);
  const status = req.body.status;

  assert(nis, 'Siswa wajib diisi.');
  assert(isValidDate(date), 'Tanggal tidak valid.');
  assert(oneOf(status, STATUSES), 'Status kehadiran tidak valid.');
  assert(date <= todayISO(), 'Tanggal tidak boleh di masa depan.');

  const student = await queryOne('SELECT nis, class_id, status FROM students WHERE nis = ?', [nis]);
  assert(student, 'Siswa tidak ditemukan.', 404);

  let time = null;
  let note = str(req.body.note).slice(0, 255);

  if (req.user.role === 'siswa') {
    await assertCanAccessStudent(req, nis);
    assert(status === 'Hadir' && date === todayISO(), 'Siswa hanya dapat melakukan absensi Hadir untuk hari ini.', 403);
    assert(student.status === 'Aktif', 'Siswa tidak aktif.', 403);

    const existing = await queryOne('SELECT id FROM attendance WHERE student_nis = ? AND `date` = ?', [nis, date]);
    if (existing) throw new HttpError(409, 'Anda sudah melakukan absensi hari ini.');

    time = nowHHMM();
    note = 'Absensi mandiri melalui SMARTABS';
  } else if (status === 'Hadir') {
    const given = str(req.body.time);
    time = HHMM.test(given) ? given : nowHHMM();
  }

  const id = `A-${date}-${nis}`;

  await query(
    `INSERT INTO attendance (id, student_nis, class_id, \`date\`, \`time\`, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       class_id = VALUES(class_id), \`time\` = VALUES(\`time\`),
       status = VALUES(status), note = VALUES(note)`,
    [id, nis, student.class_id, date, time, status, note]
  );

  res.status(201).json(await queryOne(`${SELECT} WHERE a.student_nis = ? AND a.\`date\` = ?`, [nis, date]));
}));

router.delete('/:id', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  await query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
