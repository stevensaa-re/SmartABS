const router = require('express').Router();
const { query, queryOne } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, makeId, str, oneOf, HHMM, buildSet } = require('../util');

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const SELECT = `
  SELECT s.id, s.day,
         TIME_FORMAT(s.start_time, '%H:%i') AS \`start\`,
         TIME_FORMAT(s.end_time, '%H:%i')   AS \`end\`,
         s.subject, s.teacher_name AS teacher, c.name AS className
  FROM schedules s
  JOIN classes c ON c.id = s.class_id`;

async function classIdByName(name) {
  const row = await queryOne('SELECT id FROM classes WHERE name = ?', [name]);
  assert(row, `Kelas "${name}" tidak ditemukan.`);
  return row.id;
}

function validate(body, { creating }) {
  const data = {
    day: body.day,
    className: body.className === undefined ? undefined : str(body.className),
    start: body.start,
    end: body.end,
    subject: body.subject === undefined ? undefined : str(body.subject),
    teacher: body.teacher === undefined ? undefined : str(body.teacher)
  };

  if (creating || data.day !== undefined) assert(oneOf(data.day, DAYS), 'Hari tidak valid.');
  if (creating || data.className !== undefined) assert(data.className, 'Kelas wajib diisi.');
  if (creating || data.start !== undefined) assert(HHMM.test(data.start || ''), 'Jam mulai tidak valid (HH:MM).');
  if (creating || data.end !== undefined) assert(HHMM.test(data.end || ''), 'Jam selesai tidak valid (HH:MM).');
  if (data.start && data.end) assert(data.start < data.end, 'Jam selesai harus setelah jam mulai.');
  if (creating || data.subject !== undefined) assert(data.subject && data.subject.length >= 3 && data.subject.length <= 100, 'Mata pelajaran 3-100 karakter.');
  if (creating || data.teacher !== undefined) assert(data.teacher && data.teacher.length >= 3 && data.teacher.length <= 100, 'Nama guru 3-100 karakter.');
  return data;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await query(`${SELECT} ORDER BY FIELD(s.day, 'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'), s.start_time`));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = validate(req.body, { creating: true });
  const id = makeId('J');

  await query(
    `INSERT INTO schedules (id, day, start_time, end_time, subject, teacher_name, class_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.day, data.start, data.end, data.subject, data.teacher, await classIdByName(data.className)]
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE s.id = ?`, [id]));
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  assert(await queryOne('SELECT id FROM schedules WHERE id = ?', [req.params.id]), 'Jadwal tidak ditemukan.', 404);

  const data = validate(req.body, { creating: false });
  const set = buildSet({
    day: data.day,
    start_time: data.start,
    end_time: data.end,
    subject: data.subject,
    teacher_name: data.teacher,
    class_id: data.className !== undefined ? await classIdByName(data.className) : undefined
  });

  if (!set.empty) await query(`UPDATE schedules SET ${set.sql} WHERE id = ?`, [...set.params, req.params.id]);
  res.json(await queryOne(`${SELECT} WHERE s.id = ?`, [req.params.id]));
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
