const router = require('express').Router();
const { query } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, str, oneOf, isValidDate } = require('../util');

router.use(requireRole('admin', 'guru'));

/* Rekap kehadiran per siswa aktif, dihitung langsung di database */
router.get('/', asyncHandler(async (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const className = str(req.query.className);
  const status = str(req.query.status);

  if (from) assert(isValidDate(from), 'Tanggal "dari" tidak valid.');
  if (to) assert(isValidDate(to), 'Tanggal "sampai" tidak valid.');
  if (from && to) assert(from <= to, 'Tanggal "dari" tidak boleh melebihi "sampai".');
  if (status) assert(oneOf(status, ['Hadir', 'Izin', 'Sakit', 'Alpa']), 'Status tidak valid.');

  /* Filter periode & status ditaruh pada JOIN agar siswa tanpa data tetap muncul (0 hari) */
  const joinConditions = ['a.student_nis = s.nis'];
  const params = [];

  if (from) { joinConditions.push('a.`date` >= ?'); params.push(from); }
  if (to)   { joinConditions.push('a.`date` <= ?'); params.push(to); }
  if (status) { joinConditions.push('a.status = ?'); params.push(status); }

  const where = ["s.status = 'Aktif'"];
  if (className) { where.push('c.name = ?'); params.push(className); }

  const rows = await query(
    `SELECT s.nis, s.name, c.name AS className,
            COALESCE(SUM(a.status = 'Hadir'), 0) AS hadir,
            COALESCE(SUM(a.status = 'Izin'),  0) AS izin,
            COALESCE(SUM(a.status = 'Sakit'), 0) AS sakit,
            COALESCE(SUM(a.status = 'Alpa'),  0) AS alpa
     FROM students s
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN attendance a ON ${joinConditions.join(' AND ')}
     WHERE ${where.join(' AND ')}
     GROUP BY s.nis, s.name, c.name
     ORDER BY s.name`,
    params
  );

  res.json(rows.map((row) => {
    const hadir = Number(row.hadir), izin = Number(row.izin), sakit = Number(row.sakit), alpa = Number(row.alpa);
    const total = hadir + izin + sakit + alpa;
    return {
      nis: row.nis, name: row.name, className: row.className,
      hadir, izin, sakit, alpa, total,
      percentage: total > 0 ? Math.round((hadir / total) * 100) : 0
    };
  }));
}));

module.exports = router;
