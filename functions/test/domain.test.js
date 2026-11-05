const test = require('node:test');
const assert = require('node:assert/strict');
const { sameSchool, validateAccount, validateStudent, validateTeacher } = require('../domain');

test('account validation normalizes login identifiers and rejects weak inputs', () => {
  assert.deepEqual(
    validateAccount({
      name: '  Siti Aminah ',
      username: '  Siti.A ',
      email: ' SITI@example.test ',
      password: 'secure1'
    }, 'guru'),
    {
      name: 'Siti Aminah',
      username: 'Siti.A',
      usernameLower: 'siti.a',
      email: 'siti@example.test',
      password: 'secure1',
      role: 'guru',
      status: 'Aktif'
    }
  );
  assert.throws(() => validateAccount({ name: 'A', username: 'u', email: 'bad', password: '123' }, 'guru'));
  assert.throws(() => validateAccount({ name: 'Valid Name', username: 'user.1', email: 'a@b.test', password: 'secret1' }, 'superadmin'));
});

test('students require a class while teacher profiles may be unassigned before semester placement', () => {
  assert.deepEqual(validateStudent({ nis: '1234', className: 'X-1' }), {
    nis: '1234',
    className: 'X-1',
    gender: 'L',
    status: 'Aktif',
    phone: ''
  });
  assert.throws(() => validateStudent({ nis: '12', className: 'X-1' }));
  assert.throws(() => validateTeacher({ className: 'X-1', status: 'Deleted' }));
  assert.deepEqual(validateTeacher({ status: 'Aktif' }), {
    className: '',
    status: 'Aktif',
    subject: ''
  });
});

test('school identity matching fails closed across tenant boundaries', () => {
  assert.equal(sameSchool('school-a', { schoolId: 'school-a' }, { schoolId: 'school-a' }), true);
  assert.equal(sameSchool('school-a', { schoolId: 'school-a' }, { schoolId: 'school-b' }), false);
  assert.equal(sameSchool('school-a', { schoolId: 'school-a' }, {}), false);
  assert.equal(sameSchool(undefined, {}, {}), true);
});
