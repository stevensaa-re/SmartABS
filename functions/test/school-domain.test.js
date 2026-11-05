const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MASTER_TYPES,
  SCHOOL_LEVELS,
  normalizeAcademicMaster,
  validateSchoolProfile
} = require('../school-domain');

const profile = {
  name: 'SMK Negeri 1',
  npsn: '12345678',
  schoolLevel: 'SMK',
  schoolType: 'Negeri',
  principalName: 'Kepala Sekolah',
  academicYear: '2026/2027',
  operatingDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
  openingTime: '07:00',
  closingTime: '15:00',
  timeZone: 'Asia/Jakarta',
  lateToleranceMinutes: 10
};

test('school profile validates NPSN, operation hours, timezone, and school type', () => {
  assert.equal(validateSchoolProfile(profile).schoolLevel, 'SMK');
  assert.throws(() => validateSchoolProfile({ ...profile, npsn: '123' }), /NPSN/);
  assert.throws(() => validateSchoolProfile({ ...profile, closingTime: '06:00' }), /operasional/);
  assert.throws(() => validateSchoolProfile({ ...profile, timeZone: 'Not/A_Timezone' }), /Zona waktu/);
  assert.throws(() => validateSchoolProfile({ ...profile, schoolType: 'Umum' }), /negeri\/swasta/);
});

test('academic masters allow dynamic SMK programs and differing active subject catalogues', () => {
  assert.deepEqual(MASTER_TYPES, ['programs', 'academicLevels', 'rooms', 'subjects', 'classes']);
  assert.deepEqual(SCHOOL_LEVELS, ['SD', 'SMP', 'SMA', 'SMK']);
  assert.equal(normalizeAcademicMaster('programs', {
    code: 'pplg', name: 'Pengembangan Perangkat Lunak dan Gim', level: 'SMK'
  }).code, 'PPLG');
  assert.equal(normalizeAcademicMaster('subjects', {
    code: 'DKV-X', name: 'Dasar Desain', category: 'Kejuruan',
    educationLevels: ['SMK']
  }).isActive, true);
  assert.throws(() => normalizeAcademicMaster('subjects', {
    code: 'IPA', name: 'Ilmu Pengetahuan Alam', category: 'Umum', educationLevels: ['TKJ']
  }), /jenjang/);
});
