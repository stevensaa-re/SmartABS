const admin = require('firebase-admin');

const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm-project='))?.split('=')[1];

admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function migrate() {
  const db = admin.firestore();
  const projectId = admin.app().options.projectId;
  if (!projectId) throw new Error('Project ID is unavailable; set GCLOUD_PROJECT before running.');
  if (apply && confirmation !== projectId) {
    throw new Error(`Apply requires --confirm-project=${projectId}. No data was changed.`);
  }

  const [teacherSnapshot, userSnapshot, scheduleSnapshot, attendanceSnapshot] = await Promise.all([
    db.collection('teachers').get(),
    db.collection('users').get(),
    db.collection('schedules').get(),
    db.collection('attendance').get()
  ]);
  const usersByUsername = new Map();
  for (const user of userSnapshot.docs) {
    const username = String(user.get('usernameLower') || user.get('username') || '').trim().toLowerCase();
    if (!username) continue;
    const matches = usersByUsername.get(username) || [];
    matches.push(user);
    usersByUsername.set(username, matches);
  }

  const teachersByName = new Map();
  const classAssignments = new Map();
  const linkedTeacherUids = new Set();
  for (const teacher of teacherSnapshot.docs) {
    const username = String(teacher.get('username') || '').trim().toLowerCase();
    const matches = usersByUsername.get(username) || [];
    if (!username || matches.length !== 1 || matches[0].get('role') !== 'guru' ||
        matches[0].get('status') !== 'Aktif') continue;
    const user = matches[0];
    if (linkedTeacherUids.has(user.id)) {
      throw new Error(`Multiple teacher profiles are linked to ${username}; resolve this before migration.`);
    }
    linkedTeacherUids.add(user.id);
    classAssignments.set(user.id, String(teacher.get('className') || ''));

    const name = String(teacher.get('name') || '').trim();
    if (!name) continue;
    const linkedUids = teachersByName.get(name) || [];
    linkedUids.push(user.id);
    teachersByName.set(name, linkedUids);
  }

  const schedulePlans = new Map();
  const schedulesByClassSubject = new Map();
  for (const schedule of scheduleSnapshot.docs) {
    const className = String(schedule.get('className') || '').trim();
    const subject = String(schedule.get('subject') || '').trim();
    const key = `${className}\u0000${subject}`;
    if (className && subject) {
      const matches = schedulesByClassSubject.get(key) || [];
      matches.push(schedule);
      schedulesByClassSubject.set(key, matches);
    }

    if (schedule.get('teacherUid')) continue;
    const name = String(schedule.get('teacher') || schedule.get('teacherName') || '').trim();
    const linkedUids = teachersByName.get(name) || [];
    if (linkedUids.length === 1) schedulePlans.set(schedule.id, linkedUids[0]);
  }

  const attendancePlans = new Map();
  for (const record of attendanceSnapshot.docs) {
    if (record.get('source') === 'permission') continue;
    const existingUid = String(record.get('teacherUid') || '');
    let schedule = null;
    const scheduleId = String(record.get('scheduleId') || '');
    if (scheduleId) schedule = scheduleSnapshot.docs.find((doc) => doc.id === scheduleId) || null;
    if (!schedule) {
      const key = `${String(record.get('className') || '').trim()}\u0000${String(record.get('subject') || '').trim()}`;
      const candidates = schedulesByClassSubject.get(key) || [];
      const candidateUids = new Set(candidates.map((candidate) =>
        String(candidate.get('teacherUid') || schedulePlans.get(candidate.id) || '')
      ).filter(Boolean));
      if (candidateUids.size === 1) {
        const assignedUid = [...candidateUids][0];
        schedule = candidates.find((candidate) =>
          String(candidate.get('teacherUid') || schedulePlans.get(candidate.id) || '') === assignedUid
        ) || null;
      }
    }
    if (!schedule) continue;

    const assignedUid = String(schedule.get('teacherUid') || schedulePlans.get(schedule.id) || '');
    if (!assignedUid || (existingUid && existingUid !== assignedUid) ||
        String(record.get('className') || '') !== String(schedule.get('className') || '') ||
        String(record.get('subject') || '') !== String(schedule.get('subject') || '')) continue;
    if (!existingUid || !record.get('scheduleId')) {
      attendancePlans.set(record.id, { teacherUid: assignedUid, scheduleId: schedule.id });
    }
  }

  const updates = [
    ...[...classAssignments].map(([uid, className]) => ({
      ref: db.collection('users').doc(uid),
      data: { className }
    })),
    ...[...schedulePlans].map(([id, teacherUid]) => ({
      ref: db.collection('schedules').doc(id),
      data: { teacherUid }
    })),
    ...[...attendancePlans].map(([id, assignment]) => ({
      ref: db.collection('attendance').doc(id),
      data: assignment
    }))
  ];
  console.log(`Project: ${projectId}`);
  console.log(`Teacher profiles to update: ${classAssignments.size}`);
  console.log(`Schedules to link: ${schedulePlans.size}`);
  console.log(`Attendance records to link: ${attendancePlans.size}`);
  if (!apply) {
    console.log('Dry run only. Back up and review the target data before running with --apply --confirm-project=<project-id>.');
    return;
  }

  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + 400)) batch.update(update.ref, update.data);
    await batch.commit();
  }
  console.log('Teacher assignment migration completed.');
}

migrate().catch((error) => {
  console.error('Teacher assignment migration failed:', error.message);
  process.exitCode = 1;
});