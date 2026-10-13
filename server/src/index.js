/* =========================================================
   SMARTABS — REST API server
   ========================================================= */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { authenticate } = require('./auth');
const { query } = require('./db');
const { HttpError } = require('./util');

/* Gagal cepat bila konfigurasi wajib belum benar */
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET belum diatur atau kurang dari 32 karakter. Lihat server/.env.example.');
  process.exit(1);
}

const app = express();

/* Aktifkan bila server berada di belakang reverse proxy (Nginx, dll)
   agar pembatasan login per-IP membaca IP klien yang benar. */
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    /* Tanpa header Origin = curl / server-to-server */
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new HttpError(403, 'Origin tidak diizinkan oleh CORS.'));
  }
}));

app.use(express.json({ limit: '25mb' }));

/* ---------- Routes ---------- */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));            // publik (login)

/* Semua route di bawah wajib login; hak akses per role diatur di tiap route */
app.use('/api', authenticate);
app.use('/api', (req, res, next) => {
  const entity = req.path.split('/').filter(Boolean)[0] || 'api';
  const excluded = ['audit-logs'].includes(entity) ||
    (entity === 'backup' && req.path.endsWith('/restore'));
  const shouldAudit = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    !excluded && ['admin', 'guru'].includes(req.user.role);
  if (!shouldAudit) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) return originalJson(body);
    const resourceId = req.path.split('/').filter(Boolean)[1] || '';
    const action = ({ POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' })[req.method];
    return query(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, req.user.name, req.user.role, action, entity, resourceId.slice(0, 100),
      `${req.method} ${req.path}`.slice(0, 500)])
      .then(() => originalJson(body))
      .catch((error) => {
        console.error('Perubahan API tersimpan, tetapi audit gagal dicatat:', error);
        next(new HttpError(500, 'Perubahan mungkin sudah tersimpan, tetapi log audit gagal dicatat. Periksa data sebelum mengulangi aksi.'));
      });
  };
  next();
});
app.use('/api/users', require('./routes/users'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/students', require('./routes/students'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/backup', require('./routes/backup'));

app.use((req, res) => res.status(404).json({ message: 'Endpoint tidak ditemukan.' }));

/* ---------- Error handler ---------- */

const DUPLICATE_MESSAGES = [
  ['uq_users_username', 'Username sudah digunakan.'],
  ['uq_classes_name', 'Nama kelas sudah digunakan.'],
  ['uq_students_user', 'Akun tersebut sudah terhubung dengan siswa lain.'],
  ['uq_teachers_user', 'Akun tersebut sudah terdaftar sebagai guru.'],
  ['students.PRIMARY', 'NIS sudah terdaftar.'],
  ["for key 'PRIMARY'", 'NIS sudah terdaftar.']
];

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });

  if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Format JSON tidak valid.' });

  if (error.code === 'ER_DUP_ENTRY') {
    const match = DUPLICATE_MESSAGES.find(([key]) => String(error.message).includes(key));
    return res.status(409).json({ message: match ? match[1] : 'Data sudah ada (duplikat).' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ message: 'Data masih dipakai oleh data lain dan tidak dapat dihapus.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ message: 'Data referensi tidak ditemukan.' });
  }

  /* Detail error hanya ke log server, bukan ke klien */
  console.error(error);
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`SMARTABS API berjalan di http://localhost:${port}/api`));
