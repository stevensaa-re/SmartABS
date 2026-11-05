const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIGURATION_TYPES,
  planConfigurationCopy,
  relationKey
} = require('../semester-domain');

const row = (type, payload) => ({
  type,
  payload,
  relationKey: relationKey(type, payload)
});

test('semester copy skips existing and repeated relationships idempotently', () => {
  const schedule = {
    className: '10-A',
    subject: 'Matematika',
    teacherUid: 'teacher-1',
    teacherName: 'Guru A',
    day: 'Senin',
    start: '08:00',
    end: '09:00'
  };
  const result = planConfigurationCopy(
    [
      row('subjects', { className: '10-A', subject: 'Matematika' }),
      row('subjects', { className: '10-A', subject: 'Matematika' }),
      row('schedules', schedule)
    ],
    [
      row('subjects', { className: '10-A', subject: 'Matematika' }),
      row('schedules', schedule)
    ],
    ['subjects', 'schedules']
  );
  assert.equal(result.planned.length, 0);
  assert.equal(result.skipped.length, 3);
  assert.deepEqual(result.conflicts, []);
});

test('semester copy reports class and teacher schedule overlaps', () => {
  const result = planConfigurationCopy(
    [
      row('schedules', {
        className: '10-A', subject: 'Fisika', teacherUid: 'teacher-2',
        teacherName: 'Guru B', day: 'Senin', start: '08:30', end: '09:30'
      }),
      row('schedules', {
        className: '10-B', subject: 'Kimia', teacherUid: 'teacher-1',
        teacherName: 'Guru A', day: 'Senin', start: '08:30', end: '09:30'
      })
    ],
    [
      row('schedules', {
        className: '10-A', subject: 'Matematika', teacherUid: 'teacher-1',
        teacherName: 'Guru A', day: 'Senin', start: '08:00', end: '09:00'
      })
    ],
    ['schedules']
  );
  assert.equal(result.planned.length, 2);
  assert.equal(result.conflicts.length, 2);
  assert.ok(result.conflicts.some(({ message }) => message.includes('kelas 10-A')));
  assert.ok(result.conflicts.some(({ message }) => message.includes('guru Guru A')));
});

test('semester copy blocks conflicting subject-teacher assignments', () => {
  const result = planConfigurationCopy(
    [row('teacherAssignments', {
      className: '10-A', subject: 'Matematika', teacherUid: 'teacher-2', teacherName: 'Guru B'
    })],
    [row('teacherAssignments', {
      className: '10-A', subject: 'Matematika', teacherUid: 'teacher-1', teacherName: 'Guru A'
    })],
    ['teacherAssignments']
  );
  assert.equal(result.planned.length, 1);
  assert.equal(result.conflicts.length, 1);
});

test('only the five supported semester configuration categories are accepted', () => {
  assert.deepEqual(CONFIGURATION_TYPES, [
    'subjects', 'teacherAssignments', 'schedules', 'periods', 'classes'
  ]);
  assert.throws(() => relationKey('attendance', {}), /Jenis konfigurasi/);
});
