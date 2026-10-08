const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, buildSet } = require('../util');

router.use(requireRole('admin'));

const ROLES = ['admin', 'guru', 'siswa'];
const STATUSES = ['Aktif', 'Nonaktif'];
const USERNAME = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SELECT = 'SELECT id, name, username, role, status, email FROM users';

function validate(body, { creating }) {
  const data = {
    name: body.name === undefined ? undefined : str(body.name),
    username: body.username === undefined ? undefined : str(body.username),
    role: body.role,
    status: body.status,
    email: body.email === undefined ? undefined : str(body.email),
    password: typeof body.password === 'string' && body.password ? body.password : undefined
  };

  if (creating || data.name !== undefined) assert(data.name && data.name.length >= 3, 'Nama minimal 3 karakter.');
  if (creating || data.username !== undefined) {
    assert(USERNAME.test(data.username || ''), 'Username 3-50 karakter: huruf, angka, titik, garis bawah, atau strip.');
  }
  if (creating || data.password !== undefined) {
    assert(data.password && data.password.length >= 6, 'Password minimal 6 karakter.');
    assert(data.password.length <= 72, 'Password maksimal 72 karakter.');
  }
  if (creating || data.role !== undefined) assert(oneOf(data.role, ROLES), 'Role tidak valid.');
  if (data.status !== undefined) assert(oneOf(data.status, STATUSES), 'Status tidak valid.');
  if (data.email) assert(EMAIL.test(data.email) && data.email.length <= 120, 'Format email tidak valid.');

  return data;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY id`));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = validate(req.body, { creating: true });
  const id = makeId('U');

  await query(
    `INSERT INTO users (id, name, username, password_hash, role, status, email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.username, await bcrypt.hash(data.password, 10), data.role, data.status || 'Aktif', data.email || '']
  );

  res.status(201).json(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const current = await queryOne('SELECT id, role FROM users WHERE id = ?', [id]);
  assert(current, 'Pengguna tidak ditemukan.', 404);

  const data = validate(req.body, { creating: false });

  /* Admin tidak boleh mengunci dirinya sendiri */
  if (id === req.user.id) {
    assert(data.status === undefined || data.status === 'Aktif', 'Anda tidak dapat menonaktifkan akun sendiri.');
    assert(data.role === undefined || data.role === 'admin', 'Anda tidak dapat mengubah role akun sendiri.');
  }

  const set = buildSet({
    name: data.name,
    username: data.username,
    role: data.role,
    status: data.status,
    email: data.email,
    password_hash: data.password ? await bcrypt.hash(data.password, 10) : undefined
  });

  if (!set.empty) await query(`UPDATE users SET ${set.sql} WHERE id = ?`, [...set.params, id]);

  /* Jaga integritas relasi bila role berubah */
  if (data.role && data.role !== current.role) {
    if (data.role !== 'guru') await query('DELETE FROM teachers WHERE user_id = ?', [id]);
    if (data.role !== 'siswa') await query('UPDATE students SET user_id = NULL WHERE user_id = ?', [id]);
  }

  res.json(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  assert(req.params.id !== req.user.id, 'Anda tidak dapat menghapus akun yang sedang dipakai login.');
  await query('DELETE FROM users WHERE id = ?', [req.params.id]);   // teachers ikut terhapus, students.user_id -> NULL
  res.json({ ok: true });
}));

module.exports = router;
