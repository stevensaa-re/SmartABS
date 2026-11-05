const TENANT_COLLECTIONS = Object.freeze([
  'users',
  'students',
  'teachers',
  'classes',
  'schedules',
  'announcements',
  'attendance',
  'attendanceSessions',
  'attendanceSessionLocks',
  'permissions',
  'calendarEvents',
  'auditLogs'
]);

function planSchoolIdUpdate(data, schoolId) {
  const hasSchoolId = Object.prototype.hasOwnProperty.call(data, 'schoolId');
  const currentSchoolId = data.schoolId;

  if (currentSchoolId === schoolId) return { status: 'already-tagged' };
  if (!hasSchoolId || currentSchoolId === '') {
    return {
      status: 'update',
      rollback: {
        hadSchoolId: hasSchoolId,
        ...(hasSchoolId ? { previousSchoolId: currentSchoolId } : {})
      }
    };
  }
  return { status: 'conflict', currentSchoolId };
}

function planSchoolIdRollback(data, entry, schoolId) {
  const hasSchoolId = Object.prototype.hasOwnProperty.call(data, 'schoolId');
  const currentSchoolId = data.schoolId;
  const wasAlreadyRestored = entry.hadSchoolId
    ? hasSchoolId && currentSchoolId === entry.previousSchoolId
    : !hasSchoolId;

  if (wasAlreadyRestored) return { status: 'already-restored' };
  if (!hasSchoolId) {
    return entry.hadSchoolId
      ? { status: 'conflict', currentSchoolId: undefined }
      : { status: 'already-restored' };
  }
  if (currentSchoolId !== schoolId) return { status: 'conflict', currentSchoolId };

  return {
    status: 'restore',
    ...(entry.hadSchoolId ? { schoolId: entry.previousSchoolId } : {})
  };
}

module.exports = {
  TENANT_COLLECTIONS,
  planSchoolIdUpdate,
  planSchoolIdRollback
};
