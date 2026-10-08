/* =========================================================
   Autentikasi (JWT) & otorisasi per role
   ========================================================= */

const jwt = require('jsonwebtoken');
const { queryOne } = require('./db');
const { HttpError, asyncHandler } = require('./util');

function secret() {
  const value = process.env.JWT_SECRET || '';
  if (value.length < 32) {
    throw new Error('JWT_SECRET belum diatur atau kurang dari 32 karakter (lihat .env.example).');
  }
  return value;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

/* Wajib login. Status & role dicek ulang ke database pada setiap permintaan,
   sehingga akun yang dinonaktifkan/dihapus langsung kehilangan akses. */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Anda belum login.');

  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch (error) {
    throw new HttpError(401, 'Sesi berakhir. Silakan login kembali.');
  }

  const user = await queryOne(
    'SELECT id, name, username, role, status FROM users WHERE id = ?',
    [payload.sub]
  );
  if (!user || user.status !== 'Aktif') throw new HttpError(401, 'Akun tidak aktif atau tidak ditemukan.');

  req.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  next();
});

/* Batasi route hanya untuk role tertentu */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new HttpError(403, 'Anda tidak memiliki izin untuk mengakses data ini.'));
  }
  next();
};

/* NIS milik siswa yang sedang login (null jika akun belum dihubungkan) */
async function ownNis(req) {
  const row = await queryOne('SELECT nis FROM students WHERE user_id = ?', [req.user.id]);
  return row ? row.nis : null;
}

/* Siswa hanya boleh mengakses datanya sendiri; admin/guru bebas */
async function assertCanAccessStudent(req, nis) {
  if (req.user.role !== 'siswa') return;
  const mine = await ownNis(req);
  if (!mine || mine !== String(nis)) throw new HttpError(403, 'Anda hanya dapat mengakses data milik sendiri.');
}

module.exports = { signToken, authenticate, requireRole, ownNis, assertCanAccessStudent };
