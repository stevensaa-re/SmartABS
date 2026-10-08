const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole, assertCanAccessStudent } = require('../auth');
const { asyncHandler, assert, str, oneOf, buildSet, HttpError } = require('../util');

const GENDERS = ['L', 'P'];
const STATUSES = ['Aktif', 'Nonaktif'];

const SELECT = `
  SELECT s.nis, s.name, c.name AS className, s.gender, s.status,
         COALESCE(s.user_id, '') AS userId, s.phone
  FROM students s
  JOIN classes c ON c.id = s.class_id`;

async function classIdByName(name) {
  const row = await queryOne('SELECT id FROM classes WHERE name = ?', [name]);
  assert(row, `Kelas "${name}" tidak ditemukan.`);
  return row.id;
}

/* '' -> NULL; selain itu harus akun ber-role siswa */
async function resolveUserId(userId) {
  if (!userId) return null;
  const row = await queryOne("SELECT id FROM users WHERE id = ? AND role = 'siswa'", [userId]);
  assert(row, 'Akun siswa tidak ditemukan.');
  return row.id;
}

function validate(body, { creating }) {
  const data = {
    nis: body.nis === undefined ? undefined : str(String(body.nis)),
    name: body.name === undefined ? undefined : str(body.name),
    className: body.className === undefined ? undefined : str(body.className),
    gender: body.gender,
    status: body.status,
    phone: body.phone === undefined ? undefined : str(body.phone),
    userId: body.userId
  };

  if (creating) assert(/^\d{4,20}$/.test(data.nis || ''), 'NIS harus berupa angka minimal 4 digit.');
  if (creating || data.name !== undefined) assert(data.name && data.name.length >= 3 && data.name.length <= 100, 'Nama minimal 3 karakter.');
  if (creating || data.className !== undefined) assert(data.className, 'Kelas wajib diisi.');
  if (data.gender !== undefined) assert(oneOf(data.gender, GENDERS), 'Jenis kelamin tidak valid.');
  if (data.status !== undefined) assert(oneOf(data.status, STATUSES), 'Status tidak valid.');
  if (data.phone !== undefined) assert(data.phone.length <= 30, 'No. HP terlalu panjang.');
  return data;
}

router.get('/', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY c.name, s.name`));
}));

/* Harus didefinisikan sebelum '/:nis' */
router.get('/by-user/:userId', asyncHandler(async (req, res) => {
  if (req.user.role === 'siswa' && req.user.id !== req.params.userId) {
    throw new HttpError(403, 'Anda hanya dapat mengakses data milik sendiri.');
  }
  res.json(await queryOne(`${SELECT} WHERE s.user_id = ?`, [req.params.userId]));
}));

router.get('/:nis', asyncHandler(async (req, res) => {
  await assertCanAccessStudent(req, req.params.nis);
  res.json(await queryOne(`${SELECT} WHERE s.nis = ?`, [req.params.nis]));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = validate(req.body, { creating: true });

  await query(
    `INSERT INTO students (nis, name, class_id, gender, status, user_id, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.nis, data.name, await classIdByName(data.className), data.gender || 'L',
     data.status || 'Aktif', await resolveUserId(data.userId), data.phone || '']
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE s.nis = ?`, [data.nis]));
}));

router.put('/:nis', requireRole('admin'), asyncHandler(async (req, res) => {
  const { nis } = req.params;
  assert(await queryOne('SELECT nis FROM students WHERE nis = ?', [nis]), 'Siswa tidak ditemukan.', 404);

  const data = validate(req.body, { creating: false });
  assert(data.nis === undefined || data.nis === nis, 'NIS tidak dapat diubah.');

  const set = buildSet({
    name: data.name,
    class_id: data.className === undefined ? undefined : await classIdByName(data.className),
    gender: data.gender,
    status: data.status,
    phone: data.phone,
    user_id: data.userId === undefined ? undefined : await resolveUserId(data.userId)
  });

  if (!set.empty) await query(`UPDATE students SET ${set.sql} WHERE nis = ?`, [...set.params, nis]);
  res.json(await queryOne(`${SELECT} WHERE s.nis = ?`, [nis]));
}));

/* Absensi & pengajuan izin siswa ikut terhapus (ON DELETE CASCADE) */
router.delete('/:nis', requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM students WHERE nis = ?', [req.params.nis]);
  res.json({ ok: true });
}));

module.exports = router;
