const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, str } = require('../util');

const LEVELS = ['SD', 'SMP', 'SMA', 'SMK'];

function parseList(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function shape(row) {
  return {
    id: 'main',
    name: row?.name || '',
    address: row?.address || '',
    phone: row?.phone || '',
    educationLevels: parseList(row?.educationLevels, ['SMA']),
    majors: parseList(row?.majors, [])
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const row = await queryOne(
    `SELECT name, address, phone, education_levels AS educationLevels, majors
     FROM school_profile WHERE id = 1`
  );
  res.json(shape(row));
}));

router.put('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const name = str(req.body.name);
  const address = str(req.body.address);
  const phone = str(req.body.phone);
  const rawLevels = Array.isArray(req.body.educationLevels) ? req.body.educationLevels : [];
  const rawMajors = Array.isArray(req.body.majors) ? req.body.majors : [];
  assert(rawLevels.every((level) => LEVELS.includes(level)), 'Jenjang pendidikan tidak valid.');
  assert(rawMajors.every((major) => typeof major === 'string'), 'Format jurusan tidak valid.');
  const educationLevels = [...new Set(rawLevels)];
  const majors = [...new Set(Array.isArray(req.body.majors)
    ? req.body.majors.map(str).filter(Boolean) : [])];

  assert(name.length > 0 && name.length <= 160, 'Nama sekolah wajib diisi dan maksimal 160 karakter.');
  assert(address.length <= 500, 'Alamat sekolah maksimal 500 karakter.');
  assert(phone.length <= 40, 'Nomor telepon maksimal 40 karakter.');
  assert(educationLevels.length > 0, 'Pilih minimal satu jenjang pendidikan.');
  assert(majors.every((major) => major.length <= 40), 'Nama jurusan maksimal 40 karakter.');

  const classes = await query('SELECT education_level AS educationLevel, major FROM classes');
  if (classes.some((item) => !educationLevels.includes(item.educationLevel))) {
    assert(false, 'Pindahkan kelas yang memakai jenjang tersebut sebelum menghapus jenjang dari profil sekolah.');
  }
  if (classes.some((item) =>
    ['SMA', 'SMK'].includes(item.educationLevel) && item.major && !majors.includes(item.major))) {
    assert(false, 'Pindahkan kelas yang memakai jurusan tersebut sebelum menghapus jurusan dari profil sekolah.');
  }

  await query(
    `INSERT INTO school_profile (id, name, address, phone, education_levels, majors)
     VALUES (1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), address = VALUES(address), phone = VALUES(phone),
       education_levels = VALUES(education_levels), majors = VALUES(majors)`,
    [name, address, phone, JSON.stringify(educationLevels), JSON.stringify(majors)]
  );
  res.json(shape({ name, address, phone, educationLevels: JSON.stringify(educationLevels), majors: JSON.stringify(majors) }));
}));

module.exports = router;
