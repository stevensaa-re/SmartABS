const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { queryOne } = require('../db');
const { signToken } = require('../auth');
const { asyncHandler, HttpError, str } = require('../util');

/* Hash palsu: bcrypt.compare tetap dijalankan walau username tidak ada,
   agar waktu respons tidak membocorkan username mana yang valid. */
const DUMMY_HASH = bcrypt.hashSync('smartabs-dummy-password', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const username = str(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!username || !password) throw new HttpError(400, 'Username dan password wajib diisi.');

  const user = await queryOne(
    'SELECT id, name, username, password_hash, role, status FROM users WHERE username = ?',
    [username]
  );

  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) throw new HttpError(401, 'Username atau password salah.');
  if (user.status !== 'Aktif') throw new HttpError(403, 'Akun Anda tidak aktif. Hubungi administrator.');

  res.json({
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    token: signToken(user)
  });
}));

module.exports = router;
