const CONFIGURATION_TYPES = Object.freeze([
  'subjects',
  'teacherAssignments',
  'schedules',
  'periods',
  'classes'
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function stableKey(value) {
  return JSON.stringify(stableValue(value));
}

function relationKey(type, payload) {
  switch (type) {
    case 'subjects':
      return stableKey([
        payload.classId || payload.className,
        payload.programId || '',
        payload.subjectId || payload.subject
      ]);
    case 'teacherAssignments':
      return stableKey([
        payload.classId || payload.className,
        payload.subjectId || payload.subject,
        payload.teacherUid || String(payload.teacherName || '').trim().toLowerCase()
      ]);
    case 'schedules':
      return stableKey([
        payload.classId || payload.className,
        payload.day,
        payload.start,
        payload.end,
        payload.subjectId || payload.subject,
        payload.teacherUid || String(payload.teacherName || '').trim().toLowerCase()
      ]);
    case 'periods':
      return stableKey([payload.day, payload.start, payload.end]);
    case 'classes':
      return stableKey(payload.classId || payload.className);
    default:
      throw new Error('Jenis konfigurasi semester tidak valid.');
  }
}

function intervalsOverlap(first, second) {
  return first.day === second.day && first.start < second.end && first.end > second.start;
}

function scheduleConflict(first, second) {
  if (!intervalsOverlap(first, second)) return '';
  if ((first.classId || first.className) === (second.classId || second.className)) {
    return `Jadwal kelas ${first.className} bertabrakan pada ${first.day} ${first.start}-${first.end}.`;
  }
  if (first.roomId && first.roomId === second.roomId) {
    return `Ruangan ${first.roomName || first.roomId} bertabrakan pada ${first.day} ${first.start}-${first.end}.`;
  }
  if (first.teacherUid && first.teacherUid === second.teacherUid) {
    return `Penugasan guru ${first.teacherName || first.teacherUid} bertabrakan pada ${first.day} ${first.start}-${first.end}.`;
  }
  const firstTeacher = String(first.teacherName || '').trim().toLowerCase();
  const secondTeacher = String(second.teacherName || '').trim().toLowerCase();
  if (firstTeacher && firstTeacher === secondTeacher) {
    return `Penugasan guru ${first.teacherName} bertabrakan pada ${first.day} ${first.start}-${first.end}.`;
  }
  return '';
}

function assignmentConflict(first, second) {
  if ((first.classId || first.className) !== (second.classId || second.className) ||
      (first.subjectId || first.subject) !== (second.subjectId || second.subject)) return '';
  const firstTeacher = first.teacherUid || String(first.teacherName || '').trim().toLowerCase();
  const secondTeacher = second.teacherUid || String(second.teacherName || '').trim().toLowerCase();
  return firstTeacher !== secondTeacher
    ? `Mata pelajaran ${first.subject} di kelas ${first.className} ditugaskan kepada guru yang berbeda.`
    : '';
}

function planConfigurationCopy(sourceRows, existingRows, selectedTypes) {
  const selected = new Set(selectedTypes);
  const existingByType = new Map(CONFIGURATION_TYPES.map((type) => [type, []]));
  const sourceByType = new Map(CONFIGURATION_TYPES.map((type) => [type, []]));
  const existingKeys = new Map(CONFIGURATION_TYPES.map((type) => [type, new Set()]));
  for (const row of existingRows) {
    if (existingByType.has(row.type)) existingByType.get(row.type).push(row);
  }
  for (const row of sourceRows) {
    if (sourceByType.has(row.type) && selected.has(row.type)) sourceByType.get(row.type).push(row);
  }
  for (const type of CONFIGURATION_TYPES) {
    for (const row of existingByType.get(type)) {
      existingKeys.get(type).add(row.relationKey || relationKey(type, row.payload));
      if (row.sourceRelationKey) existingKeys.get(type).add(row.sourceRelationKey);
    }
  }

  const planned = [];
  const skipped = [];
  const conflicts = [];
  const plannedSchedules = [...existingByType.get('schedules')].map((row) => row.payload);
  const plannedAssignments = [...existingByType.get('teacherAssignments')].map((row) => row.payload);
  const candidateKeys = new Map(CONFIGURATION_TYPES.map((type) => [type, new Set()]));

  for (const type of CONFIGURATION_TYPES) {
    if (!selected.has(type)) continue;
    for (const row of sourceByType.get(type)) {
      const payload = stableValue(row.payload);
      const key = row.relationKey || relationKey(type, payload);
      if (existingKeys.get(type).has(key) || candidateKeys.get(type).has(key)) {
        skipped.push({ type, relationKey: key });
        continue;
      }
      if (type === 'schedules') {
        for (const previous of plannedSchedules) {
          const message = scheduleConflict(payload, previous);
          if (message) conflicts.push({ type, message, relationKey: key });
        }
        for (const previous of plannedAssignments) {
          const message = assignmentConflict(payload, previous);
          if (message) conflicts.push({ type, message, relationKey: key });
        }
      } else if (type === 'teacherAssignments') {
        for (const previous of plannedAssignments) {
          const message = assignmentConflict(payload, previous);
          if (message) conflicts.push({ type, message, relationKey: key });
        }
        for (const previous of plannedSchedules) {
          const message = assignmentConflict(payload, previous);
          if (message) conflicts.push({ type, message, relationKey: key });
        }
      }
      candidateKeys.get(type).add(key);
      planned.push({ type, relationKey: key, payload });
      if (type === 'schedules') plannedSchedules.push(payload);
      if (type === 'teacherAssignments') plannedAssignments.push(payload);
    }
  }

  return { planned, skipped, conflicts };
}

module.exports = {
  CONFIGURATION_TYPES,
  relationKey,
  planConfigurationCopy
};
