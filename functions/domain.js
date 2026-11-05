const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;

function validateAccount(input, role) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input?.password === 'string' ? input.password : '';
  const status = input?.status || 'Aktif';

  if (name.length < 3 || name.length > 100) throw new Error('Nama harus 3-100 karakter.');
  if (!USERNAME_PATTERN.test(username)) throw new Error('Format username tidak valid.');
  if (!EMAIL_PATTERN.test(email) || email.length > 120) throw new Error('Email login tidak valid.');
  if (password.length < 6 || password.length > 128) throw new Error('Password harus 6-128 karakter.');
  if (!['admin', 'guru', 'siswa'].includes(role)) throw new Error('Role akun tidak valid.');
  if (!['Aktif', 'Nonaktif'].includes(status)) throw new Error('Status akun tidak valid.');

  return { name, username, usernameLower: username.toLowerCase(), email, password, role, status };
}

function validateStudent(input) {
  const nis = typeof input?.nis === 'string' ? input.nis.trim() : '';
  const classId = typeof input?.classId === 'string' ? input.classId.trim() : '';
  const className = typeof input?.className === 'string' ? input.className.trim() : '';
  const gender = input?.gender || 'L';
  const status = input?.status || 'Aktif';

  if (!/^\d{4,20}$/.test(nis)) throw new Error('NIS harus 4-20 digit.');
  if ((!classId && !className) || className.length > 50 || classId.length > 128) {
    throw new Error('Kelas wajib dipilih.');
  }
  if (!['L', 'P'].includes(gender)) throw new Error('Jenis kelamin tidak valid.');
  if (!['Aktif', 'Nonaktif'].includes(status)) throw new Error('Status siswa tidak valid.');

  return {
    nis,
    ...(classId ? { classId } : {}),
    className,
    gender,
    status,
    phone: typeof input.phone === 'string' ? input.phone.trim().slice(0, 30) : ''
  };
}

function validateTeacher(input) {
  const className = typeof input?.className === 'string' ? input.className.trim() : '';
  const status = input?.status || 'Aktif';
  if (className.length > 50) throw new Error('Nama kelas tidak boleh melebihi 50 karakter.');
  if (!['Aktif', 'Nonaktif'].includes(status)) throw new Error('Status guru tidak valid.');
  return {
    className,
    status,
    subject: typeof input?.subject === 'string' ? input.subject.trim().slice(0, 100) : ''
  };
}

function sameSchool(expectedSchoolId, ...records) {
  return records.every((record) => (record.schoolId || '') === (expectedSchoolId || ''));
}

module.exports = { validateAccount, validateStudent, validateTeacher, sameSchool };
