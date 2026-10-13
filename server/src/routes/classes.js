const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, buildSet } = require('../util');

const SELECT = 'SELECT id, name, education_level AS educationLevel, level, major, block, homeroom, capacity FROM classes';

function validate(body, { creating }) {
  const data = {
    name: body.name === undefined ? undefined : str(body.name),
    educationLevel: body.educationLevel === undefined ? undefined : str(body.educationLevel),
    level: body.level === undefined ? undefined : str(body.level),
    major: body.major === undefined ? undefined : str(body.major),
    block: body.block === undefined ? (creating ? '' : undefined) : str(body.block),
    homeroom: body.homeroom === undefined ? undefined : str(body.homeroom),
    capacity: body.capacity === undefined ? undefined : Number(body.capacity)
  };

  if (creating || data.name !== undefined) assert(data.name && data.name.length >= 3 && data.name.length <= 50, 'Nama kelas 3-50 karakter.');
  if (creating || data.educationLevel !== undefined) assert(oneOf(data.educationLevel, ['SD', 'SMP', 'SMA', 'SMK']), 'Jenjang pendidikan tidak valid.');
  if (creating || data.level !== undefined) assert(data.level && data.level.length <= 10, 'Tingkat kelas wajib diisi.');
  if (creating || data.major !== undefined) assert(data.major !== undefined && data.major.length <= 30, 'Jurusan tidak valid.');
  if (creating || data.block !== undefined) assert(oneOf(data.block, ['', 'Blok A', 'Blok B']), 'Blok sekolah tidak valid.');
  if (data.homeroom !== undefined) assert(data.homeroom.length <= 100, 'Nama wali kelas terlalu panjang.');
  if (data.capacity !== undefined) assert(Number.isInteger(data.capacity) && data.capacity > 0 && data.capacity < 200, 'Kapasitas tidak valid.');
  return data;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY level, name`));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = validate(req.body, { creating: true });
  const id = makeId('K');

  await query(
    'INSERT INTO classes (id, name, education_level, level, major, block, homeroom, capacity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.name, data.educationLevel, data.level, data.major, data.block || '', data.homeroom || '', data.capacity || 36]
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  assert(await queryOne('SELECT id FROM classes WHERE id = ?', [req.params.id]), 'Kelas tidak ditemukan.', 404);

  const data = validate(req.body, { creating: false });
  const set = buildSet({
    name: data.name,
    education_level: data.educationLevel,
    level: data.level,
    major: data.major,
    block: data.block,
    homeroom: data.homeroom,
    capacity: data.capacity
  });

  /* Rename aman: tabel lain memakai class_id, bukan nama kelas */
  if (!set.empty) await query(`UPDATE classes SET ${set.sql} WHERE id = ?`, [...set.params, req.params.id]);
  res.json(await queryOne(`${SELECT} WHERE id = ?`, [req.params.id]));
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const used = await queryOne('SELECT COUNT(*) AS total FROM students WHERE class_id = ?', [req.params.id]);
  assert(Number(used.total) === 0, 'Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu.', 409);

  await query('DELETE FROM classes WHERE id = ?', [req.params.id]);   // jadwal kelas ikut terhapus
  res.json({ ok: true });
}));

module.exports = router;
