/* =========================================================
   Inisialisasi database
     npm run db:init    -> buat database & tabel (MENGHAPUS data lama)
     npm run db:seed    -> isi data demo
     npm run db:reset   -> keduanya
   ========================================================= */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const seed = require('../../database/seed-data');

const args = process.argv.slice(2);

async function connect(withDatabase) {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: withDatabase ? (process.env.DB_NAME || 'smartabs') : undefined,
    multipleStatements: true,
    charset: 'utf8mb4'
  });
}

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../../database/mysql/schema.sql'), 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS smartabs/g, `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'smartabs'}\``)
    .replace(/USE smartabs;/g, `USE \`${process.env.DB_NAME || 'smartabs'}\`;`);

  const connection = await connect(false);
  await connection.query(sql);
  await connection.end();
  console.log('✔ Skema database dibuat.');
}

async function seedData() {
  const db = await connect(true);
  const idOf = {};

  try {
    await db.beginTransaction();

    for (const c of seed.classes) {
      await db.execute(
        'INSERT INTO classes (id, name, level, major, homeroom, capacity) VALUES (?, ?, ?, ?, ?, ?)',
        [c.id, c.name, c.level, c.major, c.homeroom, c.capacity]);
      idOf[c.name] = c.id;
    }

    const userByUsername = {};
    for (const u of seed.users) {
      await db.execute(
        'INSERT INTO users (id, name, username, password_hash, role, status, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.name, u.username, await bcrypt.hash(u.password, 10), u.role, u.status, u.email]);
      userByUsername[u.username] = u.id;
    }

    for (const s of seed.students) {
      await db.execute(
        'INSERT INTO students (nis, name, class_id, gender, status, user_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.nis, s.name, idOf[s.className], s.gender, s.status, s.userId || null, s.phone]);
    }

    for (const t of seed.teachers) {
      await db.execute(
        'INSERT INTO teachers (id, user_id, name, subject, class_id, status) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, userByUsername[t.username], t.name, t.subject, idOf[t.className] || null, t.status]);
    }

    for (const j of seed.schedules) {
      await db.execute(
        'INSERT INTO schedules (id, day, start_time, end_time, subject, teacher_name, class_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [j.id, j.day, j.start, j.end, j.subject, j.teacher, idOf[j.className]]);
    }

    for (const a of seed.announcements) {
      await db.execute(
        'INSERT INTO announcements (id, title, content, `date`, status) VALUES (?, ?, ?, ?, ?)',
        [a.id, a.title, a.content, a.date, a.status]);
    }

    const studentClass = Object.fromEntries(seed.students.map((s) => [s.nis, idOf[s.className]]));

    for (const p of seed.permissions) {
      await db.execute(
        'INSERT INTO permissions (id, student_nis, class_id, `date`, type, note, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.studentId, studentClass[p.studentId], seed.isoDate(p.daysAgo), p.type, p.note, p.status]);
    }

    const rows = seed.buildAttendance().map((r) => [
      `A-${r.date}-${r.studentId}`, r.studentId, idOf[r.className], r.date, r.time, r.status, r.note
    ]);
    await db.query(
      'INSERT INTO attendance (id, student_nis, class_id, `date`, `time`, status, note) VALUES ?', [rows]);

    await db.commit();
    console.log(`✔ Data demo dimasukkan (${seed.users.length} akun, ${seed.students.length} siswa, ${rows.length} absensi).`);
    console.log('  Login demo: admin / admin123 — GANTI password sebelum dipakai sungguhan.');
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

(async () => {
  if (!args.includes('--schema') && !args.includes('--seed')) {
    console.log('Gunakan: npm run db:init | db:seed | db:reset');
    return;
  }
  if (args.includes('--schema')) await applySchema();
  if (args.includes('--seed')) await seedData();
})().catch((error) => {
  console.error('✘ Gagal:', error.message);
  process.exit(1);
});
