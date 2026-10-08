const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, buildSet, HttpError } = require('../util');

const STATUSES = ['Aktif', 'Nonaktif'];

const SELECT = `
  SELECT t.id, t.name, u.username, t.subject,
         COALESCE(c.name, '') AS className, t.status
  FROM teachers t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN classes c ON c.id = t.class_id`;

async function classIdByName(name) {
  if (!name) return null;
  const row = await queryOne('SELECT id FROM classes WHERE name = ?', [name]);
  assert(row, `Kelas "${name}" tidak ditemukan.`);
  return row.id;
}

async function guruUserId(username) {
  const row = await queryOne("SELECT id FROM users WHERE username = ? AND role = 'guru'", [username]);
  assert(row, 'Akun guru tidak ditemukan (pastikan role akun = Guru).');
  return row.id;
}

router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY t.name`));
}));

/* Guru hanya boleh membaca profilnya sendiri */
router.get('/by-username/:username', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  if (req.user.role === 'guru' && req.user.username !== req.params.username) {
    throw new HttpError(403, 'Anda hanya dapat mengakses data milik sendiri.');
  }
  res.json(await queryOne(`${SELECT} WHERE u.username = ?`, [req.params.username]));   // null jika tidak ada
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const name = str(req.body.name);
  assert(name.length >= 3 && name.length <= 100, 'Nama minimal 3 karakter.');
  const status = req.body.status || 'Aktif';
  assert(oneOf(status, STATUSES), 'Status tidak valid.');

  const id = makeId('G');
  await query(
    'INSERT INTO teachers (id, user_id, name, subject, class_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    [id, await guruUserId(str(req.body.username)), name, str(req.body.subject).slice(0, 100),
     await classIdByName(str(req.body.className)), status]
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE t.id = ?`, [id]));
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  assert(await queryOne('SELECT id FROM teachers WHERE id = ?', [req.params.id]), 'Guru tidak ditemukan.', 404);

  const b = req.body;
  if (b.name !== undefined) assert(str(b.name).length >= 3 && str(b.name).length <= 100, 'Nama minimal 3 karakter.');
  if (b.status !== undefined) assert(oneOf(b.status, STATUSES), 'Status tidak valid.');

  const set = buildSet({
    name: b.name === undefined ? undefined : str(b.name),
    subject: b.subject === undefined ? undefined : str(b.subject).slice(0, 100),
    status: b.status,
    user_id: b.username === undefined ? undefined : await guruUserId(str(b.username)),
    class_id: b.className === undefined ? undefined : await classIdByName(str(b.className))
  });

  if (!set.empty) await query(`UPDATE teachers SET ${set.sql} WHERE id = ?`, [...set.params, req.params.id]);
  res.json(await queryOne(`${SELECT} WHERE t.id = ?`, [req.params.id]));
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM teachers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
