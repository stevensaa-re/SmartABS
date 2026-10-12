const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole, assertCanAccessStudent } = require('../auth');
const { asyncHandler, assert, str, oneOf, buildSet, HttpError, isValidDate } = require('../util');

const GENDERS = ['L', 'P'];
const STATUSES = ['Aktif', 'Nonaktif'];

const SELECT = `
  SELECT s.nis, s.name, c.name AS className, s.gender, s.status,
         COALESCE(s.user_id, '') AS userId, s.phone, COALESCE(s.nisn, '') AS nisn,
         s.birth_place AS birthPlace, DATE_FORMAT(s.birth_date, '%Y-%m-%d') AS birthDate,
         s.address, s.father_name AS fatherName, s.mother_name AS motherName,
         s.guardian_name AS guardianName
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
    nisn: body.nisn === undefined ? undefined : str(body.nisn),
    birthPlace: body.birthPlace === undefined ? undefined : str(body.birthPlace),
    birthDate: body.birthDate === undefined ? undefined : str(body.birthDate),
    address: body.address === undefined ? undefined : str(body.address),
    fatherName: body.fatherName === undefined ? undefined : str(body.fatherName),
    motherName: body.motherName === undefined ? undefined : str(body.motherName),
    guardianName: body.guardianName === undefined ? undefined : str(body.guardianName),
    userId: body.userId
  };

  if (creating) assert(/^\d{4,20}$/.test(data.nis || ''), 'NIS harus berupa angka minimal 4 digit.');
  if (creating || data.name !== undefined) assert(data.name && data.name.length >= 3 && data.name.length <= 100, 'Nama minimal 3 karakter.');
  if (creating || data.className !== undefined) assert(data.className, 'Kelas wajib diisi.');
  if (data.gender !== undefined) assert(oneOf(data.gender, GENDERS), 'Jenis kelamin tidak valid.');
  if (data.status !== undefined) assert(oneOf(data.status, STATUSES), 'Status tidak valid.');
  if (data.phone !== undefined) assert(data.phone.length <= 30, 'No. HP terlalu panjang.');
  if (data.nisn !== undefined) assert(!data.nisn || /^\d{10}$/.test(data.nisn), 'NISN harus terdiri dari 10 angka.');
  if (data.birthPlace !== undefined) assert(data.birthPlace.length <= 100, 'Tempat lahir terlalu panjang.');
  if (data.birthDate !== undefined) assert(!data.birthDate || isValidDate(data.birthDate), 'Tanggal lahir tidak valid.');
  if (data.address !== undefined) assert(data.address.length <= 500, 'Alamat terlalu panjang.');
  for (const key of ['fatherName', 'motherName', 'guardianName']) {
    if (data[key] !== undefined) assert(data[key].length <= 100, 'Nama orang tua/wali terlalu panjang.');
  }
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
    `INSERT INTO students
      (nis, name, nisn, class_id, gender, status, user_id, phone, birth_place, birth_date,
       address, father_name, mother_name, guardian_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.nis, data.name, data.nisn || null, await classIdByName(data.className),
      data.gender || 'L', data.status || 'Aktif', await resolveUserId(data.userId),
      data.phone || '', data.birthPlace || '', data.birthDate || null, data.address || '',
      data.fatherName || '', data.motherName || '', data.guardianName || ''
    ]
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
    nisn: data.nisn === undefined ? undefined : (data.nisn || null),
    birth_place: data.birthPlace,
    birth_date: data.birthDate === undefined ? undefined : (data.birthDate || null),
    address: data.address,
    father_name: data.fatherName,
    mother_name: data.motherName,
    guardian_name: data.guardianName,
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
