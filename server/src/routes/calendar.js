const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, isValidDate, oneOf } = require('../util');

const TYPES = ['Akademik', 'Ujian', 'Kegiatan', 'Libur'];
const SELECT = `SELECT id, title, type, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
  DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate, description, is_holiday AS isHoliday
  FROM calendar_events`;

function validate(body, creating) {
  const value = {
    title: body.title === undefined ? undefined : str(body.title),
    type: body.type === undefined ? undefined : str(body.type),
    startDate: body.startDate,
    endDate: body.endDate,
    description: body.description === undefined ? undefined : str(body.description),
    isHoliday: body.isHoliday
  };
  if (creating || value.title !== undefined) assert(value.title && value.title.length <= 120, 'Judul agenda wajib diisi (maks. 120 karakter).');
  if (value.type !== undefined) assert(oneOf(value.type, TYPES), 'Jenis agenda tidak valid.');
  if (creating || value.startDate !== undefined) assert(isValidDate(value.startDate || ''), 'Tanggal mulai tidak valid.');
  if (creating || value.endDate !== undefined) assert(isValidDate(value.endDate || ''), 'Tanggal selesai tidak valid.');
  if (value.startDate && value.endDate) assert(value.startDate <= value.endDate, 'Tanggal mulai tidak boleh melewati tanggal selesai.');
  if (value.description !== undefined) assert(value.description.length <= 1000, 'Keterangan maksimal 1.000 karakter.');
  if (value.isHoliday !== undefined) assert(typeof value.isHoliday === 'boolean', 'Penanda hari libur tidak valid.');
  return value;
}

router.use(requireRole('admin', 'guru', 'siswa'));
router.get('/', asyncHandler(async (_req, res) => {
  res.json(await query(`${SELECT} ORDER BY start_date, title`));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = validate(req.body, true);
  const id = makeId('CAL');
  await query(`INSERT INTO calendar_events (id, title, type, start_date, end_date, description, is_holiday)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, data.title, data.type || 'Akademik', data.startDate, data.endDate, data.description || '', data.isHoliday || false]);
  res.status(201).json(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const current = await queryOne(`${SELECT} WHERE id = ?`, [req.params.id]);
  assert(current, 'Agenda kalender tidak ditemukan.', 404);
  const data = validate(req.body, false);
  const next = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  assert(next.startDate <= next.endDate, 'Tanggal mulai tidak boleh melewati tanggal selesai.');
  await query(`UPDATE calendar_events SET title = ?, type = ?, start_date = ?, end_date = ?, description = ?, is_holiday = ?
    WHERE id = ?`, [next.title, next.type, next.startDate, next.endDate, next.description, next.isHoliday, req.params.id]);
  res.json(await queryOne(`${SELECT} WHERE id = ?`, [req.params.id]));
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM calendar_events WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
