const SCHOOL_LEVELS = Object.freeze(['SD', 'SMP', 'SMA', 'SMK']);
const WEEKDAYS = Object.freeze(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']);
const MASTER_TYPES = Object.freeze(['programs', 'academicLevels', 'rooms', 'subjects', 'classes']);

function requiredText(value, label, maxLength) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > maxLength) {
    throw new Error(`${label} wajib diisi (maksimal ${maxLength} karakter).`);
  }
  return result;
}

function optionalText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validateSchoolProfile(input, existing = {}) {
  const value = { ...existing, ...(input || {}) };
  const name = requiredText(value.name, 'Nama sekolah', 150);
  const npsn = requiredText(value.npsn, 'NPSN', 10);
  if (!/^\d{8}$/.test(npsn)) throw new Error('NPSN harus tepat 8 digit.');
  if (!SCHOOL_LEVELS.includes(value.schoolLevel)) throw new Error('Jenjang sekolah tidak valid.');
  if (!['Negeri', 'Swasta'].includes(value.schoolType)) throw new Error('Status negeri/swasta tidak valid.');

  const academicYear = requiredText(value.academicYear, 'Tahun ajaran aktif', 9);
  if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
    throw new Error('Tahun ajaran aktif harus berformat YYYY/YYYY.');
  }
  const operatingDays = Array.isArray(value.operatingDays) ? [...new Set(value.operatingDays)] : [];
  if (!operatingDays.length || operatingDays.some((day) => !WEEKDAYS.includes(day))) {
    throw new Error('Pilih minimal satu hari operasional yang valid.');
  }
  const openingTime = requiredText(value.openingTime, 'Jam buka', 5);
  const closingTime = requiredText(value.closingTime, 'Jam pulang', 5);
  if (!isTime(openingTime) || !isTime(closingTime) || closingTime <= openingTime) {
    throw new Error('Rentang jam operasional tidak valid.');
  }
  const timeZone = requiredText(value.timeZone, 'Zona waktu', 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  } catch {
    throw new Error('Zona waktu harus menggunakan nama IANA yang valid.');
  }
  const lateToleranceMinutes = Number(value.lateToleranceMinutes);
  if (!Number.isInteger(lateToleranceMinutes) || lateToleranceMinutes < 0 || lateToleranceMinutes > 180) {
    throw new Error('Toleransi keterlambatan harus 0-180 menit.');
  }
  const email = optionalText(value.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email sekolah tidak valid.');
  }
  const logoUrl = optionalText(value.logoUrl, 2048);
  if (logoUrl && !/^https:\/\/.+/.test(logoUrl)) throw new Error('URL logo harus menggunakan HTTPS.');

  return {
    name,
    npsn,
    logoUrl,
    schoolLevel: value.schoolLevel,
    schoolType: value.schoolType,
    address: optionalText(value.address, 500),
    phone: optionalText(value.phone, 30),
    email,
    principalName: requiredText(value.principalName, 'Nama kepala sekolah', 100),
    academicYear,
    operatingDays,
    openingTime,
    closingTime,
    timeZone,
    lateToleranceMinutes
  };
}

function normalizeAcademicMaster(type, input) {
  if (!MASTER_TYPES.includes(type) || !input || typeof input !== 'object') {
    throw new Error('Jenis data akademik tidak valid.');
  }
  const isActive = input.isActive !== false;
  if (type === 'programs') {
    return {
      code: requiredText(input.code, 'Kode program', 20).toUpperCase(),
      name: requiredText(input.name, 'Nama program', 100),
      level: SCHOOL_LEVELS.includes(input.level) ? input.level : 'SMK',
      isActive
    };
  }
  if (type === 'academicLevels') {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 1 || sortOrder > 20) {
      throw new Error('Urutan tingkat harus berupa angka 1-20.');
    }
    return {
      code: requiredText(input.code, 'Kode tingkat', 20).toUpperCase(),
      name: requiredText(input.name, 'Nama tingkat', 60),
      level: SCHOOL_LEVELS.includes(input.level) ? input.level : '',
      sortOrder,
      isActive
    };
  }
  if (type === 'rooms') {
    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new Error('Kapasitas ruangan harus 1-500.');
    }
    return {
      code: requiredText(input.code, 'Kode ruangan', 20).toUpperCase(),
      name: requiredText(input.name, 'Nama ruangan', 100),
      capacity,
      isActive
    };
  }
  if (type === 'subjects') {
    const category = requiredText(input.category, 'Kategori mata pelajaran', 60);
    const educationLevels = Array.isArray(input.educationLevels)
      ? [...new Set(input.educationLevels)]
      : [];
    if (!educationLevels.length || educationLevels.some((level) => !SCHOOL_LEVELS.includes(level))) {
      throw new Error('Pilih minimal satu jenjang yang didukung untuk mata pelajaran.');
    }
    return {
      code: requiredText(input.code, 'Kode mata pelajaran', 20).toUpperCase(),
      name: requiredText(input.name, 'Nama mata pelajaran', 100),
      category,
      educationLevels,
      isActive
    };
  }

  const capacity = Number(input.capacity || 36);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw new Error('Kapasitas kelas harus 1-500.');
  }
  return {
    name: requiredText(input.name, 'Nama kelas', 80),
    level: requiredText(input.level, 'Tingkat kelas', 30),
    majorId: optionalText(input.majorId, 128),
    major: optionalText(input.major, 80),
    roomId: optionalText(input.roomId, 128),
    homeroomTeacherUid: optionalText(input.homeroomTeacherUid, 128),
    homeroom: optionalText(input.homeroom, 100),
    capacity,
    isActive
  };
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

module.exports = {
  SCHOOL_LEVELS,
  WEEKDAYS,
  MASTER_TYPES,
  validateSchoolProfile,
  normalizeAcademicMaster,
  isTime
};
