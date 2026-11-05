const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TENANT_COLLECTIONS,
  planSchoolIdUpdate,
  planSchoolIdRollback
} = require('../school-id-migration');

test('migration adds a school ID only to unassigned documents', () => {
  assert.deepEqual(planSchoolIdUpdate({ name: 'Student' }, 'school-a'), {
    status: 'update',
    rollback: { hadSchoolId: false }
  });
  assert.equal(planSchoolIdUpdate({ schoolId: '' }, 'school-a').status, 'update');
  assert.equal(planSchoolIdUpdate({ schoolId: 'school-a' }, 'school-a').status, 'already-tagged');
  assert.equal(planSchoolIdUpdate({ schoolId: 'school-b' }, 'school-a').status, 'conflict');
  assert.equal(planSchoolIdUpdate({ schoolId: null }, 'school-a').status, 'conflict');
});

test('rollback removes only the migration tag and preserves prior field values', () => {
  assert.deepEqual(
    planSchoolIdRollback({ schoolId: 'school-a' }, { hadSchoolId: false }, 'school-a'),
    { status: 'restore' }
  );
  assert.deepEqual(
    planSchoolIdRollback({ schoolId: 'school-a' }, {
      hadSchoolId: true,
      previousSchoolId: ''
    }, 'school-a'),
    { status: 'restore', schoolId: '' }
  );
  assert.equal(
    planSchoolIdRollback({}, { hadSchoolId: false }, 'school-a').status,
    'already-restored'
  );
  assert.equal(
    planSchoolIdRollback({ schoolId: 'school-b' }, { hadSchoolId: false }, 'school-a').status,
    'conflict'
  );
  assert.equal(
    planSchoolIdRollback({}, { hadSchoolId: true, previousSchoolId: '' }, 'school-a').status,
    'conflict'
  );
});

test('migration scope includes all tenant-owned SMARTABS collections', () => {
  assert.deepEqual(TENANT_COLLECTIONS, [
    'users', 'students', 'teachers', 'classes', 'schedules', 'announcements', 'attendance',
    'attendanceSessions', 'attendanceSessionLocks', 'permissions', 'calendarEvents', 'auditLogs'
  ]);
});
