/* =========================================================
   SMARTABS — Utilitas umum
   Kumpulan helper murni (tanpa akses DOM kompleks) yang
   dipakai oleh seluruh modul lain.
   ========================================================= */

/* ---------- Selector ---------- */
const $  = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/* ---------- Keamanan output ---------- */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

/* ---------- Tanggal & waktu ---------- */
const NAMA_HARI  = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function pad2(number) {
  return String(number).padStart(2, '0');
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayISO() {
  return toISODate(new Date());
}

function shiftDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function currentTime() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function currentDayName() {
  return NAMA_HARI[new Date().getDay()];
}

/* "2026-10-07" harus dibaca sebagai tanggal lokal. new Date("2026-10-07")
   dibaca UTC sehingga bisa bergeser sehari di zona waktu tertentu. */
function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(iso);
}

function formatDate(iso) {
  if (!iso) return '-';
  const date = parseISODate(iso);
  if (isNaN(date.getTime())) return iso;
  return `${pad2(date.getDate())} ${NAMA_BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateLong(iso) {
  if (!iso) return '-';
  const date = parseISODate(iso);
  if (isNaN(date.getTime())) return iso;
  return `${NAMA_HARI[date.getDay()]}, ${pad2(date.getDate())} ${NAMA_BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

/* ---------- Nama & inisial ---------- */
function initials(name) {
  return String(name || '?')
    .replace(/[^A-Za-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || '?';
}

function validateSchoolDetails(fields) {
  if (fields.npsn && !/^\d{8}$/.test(fields.npsn)) {
    throw new Error('NPSN harus tepat 8 digit.');
  }
  if (fields.principalName.length > 120 || fields.email.length > 160 || fields.website.length > 200) {
    throw new Error('Periksa batas panjang kepala sekolah, email, atau website.');
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    throw new Error('Format email resmi sekolah tidak valid.');
  }
  if (fields.website) {
    let parsed;
    try {
      parsed = new URL(fields.website);
    } catch {
      throw new Error('Website sekolah harus berupa URL valid dengan http:// atau https://.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Website sekolah harus menggunakan http:// atau https://.');
    }
  }
  if (fields.accreditation && !['A', 'B', 'C', 'Belum Terakreditasi'].includes(fields.accreditation)) {
    throw new Error('Pilihan akreditasi tidak valid.');
  }
  if (fields.foundedYear &&
      (!/^\d{4}$/.test(fields.foundedYear) || Number(fields.foundedYear) < 1800 ||
       Number(fields.foundedYear) > new Date().getFullYear())) {
    throw new Error('Tahun berdiri harus antara 1800 dan tahun ini.');
  }
}

/* ---------- Badge status ---------- */
const STATUS_TONE = {
  'Hadir': 'success',
  'Izin': 'info',
  'Sakit': 'warning',
  'Alpa': 'danger',
  'Terlambat': 'warning',
  'Aktif': 'success',
  'Nonaktif': 'danger',
  'Menunggu': 'warning',
  'Disetujui': 'success',
  'Ditolak': 'danger',
  'Publish': 'success',
  'Draft': 'muted',
  'Belum Absen': 'muted'
};

function badge(status) {
  const tone = STATUS_TONE[status] || 'muted';
  return `<span class="badge badge-${tone}">${escapeHtml(status)}</span>`;
}

function percentageTone(percentage) {
  if (percentage >= 85) return 'high';
  if (percentage >= 70) return 'mid';
  return 'low';
}

/* ---------- Komponen HTML kecil ---------- */
function emptyState(message, subMessage = '') {
  return `
    <div class="empty-state">
      <i class="fa-regular fa-folder-open"></i>
      <p>${escapeHtml(message)}</p>
      ${subMessage ? `<span>${escapeHtml(subMessage)}</span>` : ''}
    </div>`;
}

function emptyTableRow(colspan, message, subMessage = '') {
  return `<tr><td colspan="${colspan}">${emptyState(message, subMessage)}</td></tr>`;
}

function loadingRow(colspan, text = 'Memuat data...') {
  return `<tr><td colspan="${colspan}">
    <div class="loading-inline"><span class="spinner"></span> ${escapeHtml(text)}</div>
  </td></tr>`;
}

function loadingBlock(text = 'Memuat data...') {
  return `<div class="loading-inline"><span class="spinner"></span> ${escapeHtml(text)}</div>`;
}

/* ---------- Debounce (untuk search realtime) ---------- */
function debounce(fn, wait = 220) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ---------- Role ---------- */
const ROLE_LABEL = {
  admin: 'Administrator',
  guru: 'Guru',
  siswa: 'Siswa'
};