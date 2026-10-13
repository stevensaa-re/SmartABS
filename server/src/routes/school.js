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
    npsn: row?.npsn || '',
    principalName: row?.principalName || '',
    email: row?.email || '',
    website: row?.website || '',
    accreditation: row?.accreditation || '',
    foundedYear: row?.foundedYear ? String(row.foundedYear) : '',
    educationLevels: parseList(row?.educationLevels, ['SMA']),
    majors: parseList(row?.majors, [])
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const row = await queryOne(
    `SELECT name, address, phone, npsn, principal_name AS principalName, email, website,
       accreditation, founded_year AS foundedYear, education_levels AS educationLevels, majors
     FROM school_profile WHERE id = 1`
  );
  res.json(shape(row));
}));

router.put('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const name = str(req.body.name);
  const address = str(req.body.address);
  const phone = str(req.body.phone);
  const npsn = str(req.body.npsn);
  const principalName = str(req.body.principalName);
  const email = str(req.body.email);
  const website = str(req.body.website);
  const accreditation = str(req.body.accreditation);
  const foundedYear = str(req.body.foundedYear);
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
  assert(!npsn || /^\d{8}$/.test(npsn), 'NPSN harus tepat 8 digit.');
  assert(principalName.length <= 120, 'Nama kepala sekolah maksimal 120 karakter.');
  assert(email.length <= 160 && (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)), 'Format email resmi sekolah tidak valid.');
  assert(website.length <= 200, 'Website sekolah maksimal 200 karakter.');
  let websiteUrl;
  if (website) {
    try { websiteUrl = new URL(website); } catch { assert(false, 'Website sekolah harus berupa URL valid.'); }
    assert(['http:', 'https:'].includes(websiteUrl.protocol), 'Website sekolah harus menggunakan HTTP atau HTTPS.');
  }
  assert(!accreditation || ['A', 'B', 'C', 'Belum Terakreditasi'].includes(accreditation), 'Pilihan akreditasi tidak valid.');
  assert(!foundedYear || (/^\d{4}$/.test(foundedYear) && Number(foundedYear) >= 1800 &&
    Number(foundedYear) <= new Date().getFullYear()), 'Tahun berdiri harus antara 1800 dan tahun ini.');
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
    `INSERT INTO school_profile
       (id, name, address, phone, npsn, principal_name, email, website, accreditation, founded_year, education_levels, majors)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), address = VALUES(address), phone = VALUES(phone),
       npsn = VALUES(npsn), principal_name = VALUES(principal_name), email = VALUES(email),
       website = VALUES(website), accreditation = VALUES(accreditation), founded_year = VALUES(founded_year),
       education_levels = VALUES(education_levels), majors = VALUES(majors)`,
    [name, address, phone, npsn, principalName, email, website, accreditation,
      foundedYear ? Number(foundedYear) : null, JSON.stringify(educationLevels), JSON.stringify(majors)]
  );
  res.json(shape({
    name, address, phone, npsn, principalName, email, website, accreditation,
    foundedYear, educationLevels: JSON.stringify(educationLevels), majors: JSON.stringify(majors)
  }));
}));

module.exports = router;
