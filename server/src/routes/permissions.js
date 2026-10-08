const router = require('express').Router();
const { query, queryOne, transaction } = require('../db');
const { requireRole, ownNis, assertCanAccessStudent } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, isValidDate, todayISO, shiftISO, HttpError } = require('../util');

const SELECT = `
  SELECT p.id, p.student_nis AS studentId, s.name,
         COALESCE(c.name, '-') AS className,
         p.\`date\` AS \`date\`, p.type, p.note, p.status
  FROM permissions p
  JOIN students s ON s.nis = p.student_nis
  LEFT JOIN classes c ON c.id = p.class_id`;

router.get('/', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY p.\`date\` DESC, p.created_at DESC`));
}));

router.get('/student/:nis', asyncHandler(async (req, res) => {
  await assertCanAccessStudent(req, req.params.nis);
  res.json(await query(`${SELECT} WHERE p.student_nis = ? ORDER BY p.\`date\` DESC, p.created_at DESC`, [req.params.nis]));
}));

/* Pengajuan oleh siswa untuk dirinya sendiri */
router.post('/', requireRole('siswa'), asyncHandler(async (req, res) => {
  const nis = await ownNis(req);
  assert(nis, 'Akun Anda belum dihubungkan dengan data siswa.', 403);
  assert(!req.body.studentId || String(req.body.studentId) === nis, 'Anda hanya dapat mengajukan untuk diri sendiri.', 403);

  const date = str(req.body.date);
  const type = req.body.type;
  const note = str(req.body.note);
  const today = todayISO();

  assert(isValidDate(date), 'Tanggal tidak valid.');
  assert(date >= shiftISO(today, -7) && date <= shiftISO(today, 30), 'Tanggal harus antara 7 hari lalu s.d. 30 hari ke depan.');
  assert(oneOf(type, ['Izin', 'Sakit']), 'Jenis pengajuan harus Izin atau Sakit.');
  assert(note.length >= 5 && note.length <= 255, 'Keterangan 5-255 karakter.');

  const student = await queryOne('SELECT class_id FROM students WHERE nis = ?', [nis]);

  const duplicate = await queryOne(
    "SELECT id FROM permissions WHERE student_nis = ? AND `date` = ? AND status = 'Menunggu'", [nis, date]);
  if (duplicate) throw new HttpError(409, 'Anda sudah mengajukan izin untuk tanggal tersebut.');

  const id = makeId('I');
  await query(
    `INSERT INTO permissions (id, student_nis, class_id, \`date\`, type, note, status)
     VALUES (?, ?, ?, ?, ?, ?, 'Menunggu')`,
    [id, nis, student.class_id, date, type, note]
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE p.id = ?`, [id]));
}));

/* Verifikasi guru. Update status + sinkronisasi absensi dalam SATU transaksi.
   Disetujui -> absensi = jenis pengajuan; Ditolak -> Alpa.
   Catatan "Hadir" tidak pernah ditimpa. */
router.post('/:id/review', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  const status = req.body.status;
  assert(oneOf(status, ['Disetujui', 'Ditolak']), 'Status tidak valid.');

  await transaction(async (tx) => {
    const item = await tx.queryOne(
      'SELECT id, student_nis, class_id, `date`, type, note FROM permissions WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!item) throw new HttpError(404, 'Pengajuan tidak ditemukan.');

    await tx.query(
      'UPDATE permissions SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [status, req.user.id, item.id]
    );

    const existing = await tx.queryOne(
      'SELECT status FROM attendance WHERE student_nis = ? AND `date` = ? FOR UPDATE',
      [item.student_nis, item.date]
    );

    if (!existing || existing.status !== 'Hadir') {
      const attendanceStatus = status === 'Disetujui' ? item.type : 'Alpa';
      const note = (status === 'Disetujui'
        ? (item.note || item.type)
        : `Pengajuan ditolak${item.note ? `: ${item.note}` : ''}`).slice(0, 255);

      await tx.query(
        `INSERT INTO attendance (id, student_nis, class_id, \`date\`, \`time\`, status, note)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE \`time\` = NULL, status = VALUES(status), note = VALUES(note)`,
        [`A-${item.date}-${item.student_nis}`, item.student_nis, item.class_id, item.date, attendanceStatus, note]
      );
    }
  });

  res.json(await queryOne(`${SELECT} WHERE p.id = ?`, [req.params.id]));
}));

module.exports = router;
