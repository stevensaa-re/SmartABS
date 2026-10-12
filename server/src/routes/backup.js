const router = require('express').Router();
const { query, transaction } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, isValidDate, oneOf } = require('../util');

const TABLES = ['classes', 'students', 'teachers', 'schedules', 'announcements', 'attendance', 'permissions', 'calendarEvents'];
const safeArray = (data, key) => {
  const rows = data[key] || [];
  assert(Array.isArray(rows), `Bagian ${key} pada backup tidak valid.`);
  return rows;
};

router.use(requireRole('admin'));
router.get('/', asyncHandler(async (_req, res) => {
  const [classes, students, teachers, schedules, announcements, attendance, permissions, calendarEvents] = await Promise.all([
    query('SELECT id, name, level, major, homeroom, capacity FROM classes'),
    query(`SELECT s.nis, s.name, c.name AS className, s.gender, s.status, '' AS userId, s.phone
      FROM students s JOIN classes c ON c.id = s.class_id`),
    query(`SELECT t.id, u.username, t.name, t.subject, COALESCE(c.name, '') AS className, t.status
      FROM teachers t JOIN users u ON u.id = t.user_id LEFT JOIN classes c ON c.id = t.class_id`),
    query(`SELECT j.id, j.day, LEFT(j.start_time,5) AS start, LEFT(j.end_time,5) AS end,
      j.subject, j.teacher_name AS teacher, c.name AS className FROM schedules j JOIN classes c ON c.id = j.class_id`),
    query(`SELECT id, title, content, DATE_FORMAT(\`date\`,'%Y-%m-%d') AS date, status FROM announcements`),
    query(`SELECT a.id, a.student_nis AS studentId, s.name, c.name AS className, DATE_FORMAT(a.\`date\`,'%Y-%m-%d') AS date,
      COALESCE(TIME_FORMAT(a.\`time\`,'%H:%i'), '-') AS time, a.subject, a.status, a.note
      FROM attendance a JOIN students s ON s.nis = a.student_nis LEFT JOIN classes c ON c.id = a.class_id`),
    query(`SELECT p.id, p.student_nis AS studentId, s.name, c.name AS className, DATE_FORMAT(p.\`date\`,'%Y-%m-%d') AS date,
      p.type, p.note, p.status FROM permissions p JOIN students s ON s.nis = p.student_nis LEFT JOIN classes c ON c.id = p.class_id`),
    query(`SELECT id, title, type, DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
      DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate, description, is_holiday AS isHoliday FROM calendar_events`)
  ]);
  res.json({ format: 'smartabs-backup', version: 1, generatedAt: new Date().toISOString(),
    limitations: ['Akun login dan kata sandi tidak termasuk; akun harus tersedia terlebih dahulu.'],
    data: { classes, students, teachers, schedules, announcements, attendance, permissions, calendarEvents } });
}));

router.post('/restore', asyncHandler(async (req, res) => {
  const backup = req.body;
  assert(backup && backup.format === 'smartabs-backup' && backup.version === 1 && backup.data,
    'Format backup SMARTABS tidak valid.');
  const total = TABLES.reduce((sum, key) => sum + safeArray(backup.data, key).length, 0);
  assert(total <= 5000, 'Backup melebihi batas pemulihan 5.000 dokumen.');
  const result = await transaction(async (tx) => {
    const counters = { restored: 0, skipped: 0 };
    const classId = async (name) => {
      if (!name) return null;
      const row = await tx.queryOne('SELECT id FROM classes WHERE name = ?', [String(name)]);
      return row?.id || null;
    };
    const exists = async (table, key, value) =>
      Boolean(await tx.queryOne(`SELECT 1 AS found FROM ${table} WHERE ${key} = ?`, [value]));
    const insert = async (table, columns, values) => {
      const result = await tx.query(
        `INSERT IGNORE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
      if (result.affectedRows) counters.restored++;
      else counters.skipped++;
    };

    for (const item of safeArray(backup.data, 'classes')) {
      assert(item.id && item.name && item.level && item.major, 'Backup memiliki data kelas yang tidak lengkap.');
      await insert('classes', ['id', 'name', 'level', 'major', 'homeroom', 'capacity'],
        [String(item.id), String(item.name), String(item.level), String(item.major), String(item.homeroom || ''), Number(item.capacity) || 36]);
    }
    for (const item of safeArray(backup.data, 'students')) {
      assert(/^\d{4,20}$/.test(String(item.nis || '')) && item.name && item.className, 'Backup memiliki data siswa yang tidak valid.');
      const id = await classId(item.className);
      if (!id) { counters.skipped++; continue; }
      await insert('students', ['nis', 'name', 'class_id', 'gender', 'status', 'user_id', 'phone'],
        [String(item.nis), String(item.name), id, oneOf(item.gender, ['L', 'P']) ? item.gender : 'L',
          oneOf(item.status, ['Aktif', 'Nonaktif']) ? item.status : 'Aktif', null, String(item.phone || '')]);
    }
    for (const item of safeArray(backup.data, 'teachers')) {
      assert(item.id && item.username && item.name, 'Backup memiliki data guru yang tidak valid.');
      const user = await tx.queryOne("SELECT id FROM users WHERE username = ? AND role = 'guru' AND status = 'Aktif'", [item.username]);
      const id = await classId(item.className);
      if (!user || !id) { counters.skipped++; continue; }
      await insert('teachers', ['id', 'user_id', 'name', 'subject', 'class_id', 'status'],
        [String(item.id), user.id, String(item.name), String(item.subject || ''), id,
          oneOf(item.status, ['Aktif', 'Nonaktif']) ? item.status : 'Aktif']);
    }
    for (const item of safeArray(backup.data, 'schedules')) {
      const id = await classId(item.className);
      if (!item.id || !id || !oneOf(item.day, ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end || '')) {
        counters.skipped++; continue;
      }
      await insert('schedules', ['id', 'day', 'start_time', 'end_time', 'subject', 'teacher_name', 'class_id'],
        [String(item.id), item.day, `${item.start}:00`, `${item.end}:00`, String(item.subject || ''),
          String(item.teacher || ''), id]);
    }
    for (const item of safeArray(backup.data, 'announcements')) {
      if (!item.id || !item.title || !item.content || !isValidDate(String(item.date || ''))) { counters.skipped++; continue; }
      await insert('announcements', ['id', 'title', 'content', '`date`', 'status'],
        [String(item.id), String(item.title).slice(0, 200), String(item.content), item.date,
          oneOf(item.status, ['Publish', 'Draft']) ? item.status : 'Draft']);
    }
    for (const item of safeArray(backup.data, 'calendarEvents')) {
      if (!item.id || !item.title || !isValidDate(String(item.startDate || '')) || !isValidDate(String(item.endDate || '')) ||
          item.startDate > item.endDate) { counters.skipped++; continue; }
      await insert('calendar_events', ['id', 'title', 'type', 'start_date', 'end_date', 'description', 'is_holiday'],
        [String(item.id), String(item.title).slice(0, 120), String(item.type || 'Akademik').slice(0, 30),
          item.startDate, item.endDate, String(item.description || ''), Boolean(item.isHoliday)]);
    }
    for (const item of safeArray(backup.data, 'attendance')) {
      if (!item.id || !/^\d{4,20}$/.test(String(item.studentId || '')) || !isValidDate(String(item.date || '')) ||
          !oneOf(item.status, ['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa'])) { counters.skipped++; continue; }
      const student = await tx.queryOne('SELECT nis, class_id FROM students WHERE nis = ?', [item.studentId]);
      if (!student) { counters.skipped++; continue; }
      const time = /^([01]\d|2[0-3]):[0-5]\d/.test(String(item.time || '')) ? String(item.time).slice(0, 8) : null;
      await insert('attendance', ['id', 'student_nis', 'class_id', '`date`', '`time`', 'subject', 'status', 'note'],
        [String(item.id), student.nis, student.class_id, item.date, time, String(item.subject || '').slice(0, 100),
          item.status, String(item.note || '').slice(0, 255)]);
    }
    for (const item of safeArray(backup.data, 'permissions')) {
      if (!item.id || !/^\d{4,20}$/.test(String(item.studentId || '')) || !isValidDate(String(item.date || '')) ||
          !oneOf(item.type, ['Izin', 'Sakit', 'Alpa']) || !oneOf(item.status, ['Menunggu', 'Disetujui', 'Ditolak'])) {
        counters.skipped++; continue;
      }
      const student = await tx.queryOne('SELECT s.nis, s.class_id FROM students s WHERE s.nis = ?', [item.studentId]);
      if (!student) { counters.skipped++; continue; }
      await insert('permissions', ['id', 'student_nis', 'class_id', '`date`', 'type', 'note', 'status'],
        [String(item.id), student.nis, student.class_id, item.date, item.type, String(item.note || '').slice(0, 255), item.status]);
    }
    await tx.query(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, summary)
      VALUES (?, ?, ?, 'restore', 'backup', '', ?)`,
    [req.user.id, req.user.name, req.user.role, `Pemulihan backup merge: ${counters.restored} data dipulihkan, ${counters.skipped} dilewati.`]);
    return counters;
  });
  res.json(result);
}));

module.exports = router;
