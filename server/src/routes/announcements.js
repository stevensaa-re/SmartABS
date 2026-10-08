const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, isValidDate, buildSet } = require('../util');

const SELECT = 'SELECT id, title, content, `date`, status FROM announcements';
const STATUSES = ['Publish', 'Draft'];

function validate(body, { creating }) {
  const data = {
    title: body.title === undefined ? undefined : str(body.title),
    content: body.content === undefined ? undefined : str(body.content),
    date: body.date,
    status: body.status
  };

  if (creating || data.title !== undefined) assert(data.title && data.title.length >= 5 && data.title.length <= 200, 'Judul 5-200 karakter.');
  if (creating || data.content !== undefined) assert(data.content && data.content.length >= 10 && data.content.length <= 5000, 'Isi pengumuman 10-5000 karakter.');
  if (creating || data.date !== undefined) assert(isValidDate(data.date || ''), 'Tanggal tidak valid.');
  if (data.status !== undefined) assert(oneOf(data.status, STATUSES), 'Status tidak valid.');
  return data;
}

/* Siswa & guru hanya melihat yang berstatus Publish; admin melihat semuanya */
router.get('/', asyncHandler(async (req, res) => {
  const where = req.user.role === 'admin' ? '' : "WHERE status = 'Publish'";
  res.json(await query(`${SELECT} ${where} ORDER BY \`date\` DESC, id DESC`));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = validate(req.body, { creating: true });
  const id = makeId('P');

  await query(
    'INSERT INTO announcements (id, title, content, `date`, status) VALUES (?, ?, ?, ?, ?)',
    [id, data.title, data.content, data.date, data.status || 'Publish']
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  assert(await queryOne('SELECT id FROM announcements WHERE id = ?', [req.params.id]), 'Pengumuman tidak ditemukan.', 404);

  const data = validate(req.body, { creating: false });
  const set = buildSet({ title: data.title, content: data.content, '`date`': data.date, status: data.status });

  if (!set.empty) await query(`UPDATE announcements SET ${set.sql} WHERE id = ?`, [...set.params, req.params.id]);
  res.json(await queryOne(`${SELECT} WHERE id = ?`, [req.params.id]));
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
