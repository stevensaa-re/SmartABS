const SEMESTER_COPY_TYPES = [
  ['subjects', 'Mata pelajaran per kelas'],
  ['teacherAssignments', 'Penugasan guru'],
  ['schedules', 'Jadwal pelajaran'],
  ['periods', 'Jam pelajaran'],
  ['classes', 'Konfigurasi kelas']
];

const SEMESTER_TYPE_LABELS = Object.fromEntries(SEMESTER_COPY_TYPES);
let semesters = [];
let targetConfigurations = [];
let lastCopyPreview = null;
let academicSetup = null;

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'semesters') return;
  initSemesterPage();
});

async function initSemesterPage() {
  if (API.name !== 'firebase') {
    showSemesterMessage('Persiapan semester memerlukan backend Firebase dan Cloud Functions.', 'warning');
    return;
  }
  renderCopyTypes();
  bindSemesterEvents();
  academicSetup = await API.getSchoolSetup();
  await refreshSemesters();
}

function bindSemesterEvents() {
  document.getElementById('toggleSemesterForm').addEventListener('click', () => openSemesterForm());
  document.getElementById('cancelSemesterForm').addEventListener('click', closeSemesterForm);
  document.getElementById('semesterForm').addEventListener('submit', saveSemester);
  document.getElementById('semesterTableBody').addEventListener('click', handleSemesterAction);
  document.getElementById('sourceSemester').addEventListener('change', clearPreview);
  document.getElementById('targetSemester').addEventListener('change', async () => {
    clearPreview();
    await refreshTargetConfigurations();
  });
  document.getElementById('copyTypes').addEventListener('change', clearPreview);
  document.getElementById('previewCopyButton').addEventListener('click', previewCopy);
  document.getElementById('copyConfigurationButton').addEventListener('click', copyConfiguration);
  document.getElementById('configurationTableBody').addEventListener('click', handleConfigurationAction);
  document.getElementById('configurationForm').addEventListener('submit', saveConfiguration);
  document.getElementById('addConfigurationButton').addEventListener('click', () => openConfigurationModal());
  document.getElementById('configurationTypeSelector').addEventListener('change', () => renderConfigurationFields());
  document.getElementById('configurationFields').addEventListener('change', (event) => {
    if (event.target.id === 'config-classId') updateConfigSubjectOptions();
  });
  document.getElementById('closeConfigurationModal').addEventListener('click', closeConfigurationModal);
  document.getElementById('cancelConfigurationModal').addEventListener('click', closeConfigurationModal);
}

function renderCopyTypes() {
  document.getElementById('copyTypes').innerHTML = SEMESTER_COPY_TYPES.map(([value, label]) => `
    <label class="semester-copy-type">
      <input type="checkbox" name="copyType" value="${value}" checked>
      <span>${escapeHtml(label)}</span>
    </label>`).join('');
}

async function refreshSemesters(selectedTargetId = document.getElementById('targetSemester').value) {
  try {
    semesters = await API.getSemesters();
    renderSemesterTable();
    renderSemesterSelects(selectedTargetId);
    await refreshTargetConfigurations();
  } catch (error) {
    showSemesterMessage(error.message || 'Daftar semester gagal dimuat.', 'error');
    throw error;
  }
}

function renderSemesterTable() {
  const tbody = document.getElementById('semesterTableBody');
  if (!semesters.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Belum ada semester. Buat draft baru untuk memulai.</td></tr>';
    return;
  }
  tbody.innerHTML = semesters.map((semester) => `
    <tr>
      <td class="cell-strong">${escapeHtml(semester.name)}</td>
      <td>${escapeHtml(semester.academicYear)}</td>
      <td>${escapeHtml(semester.startDate)} – ${escapeHtml(semester.endDate)}</td>
      <td>${semesterStatusBadge(semester.status)}</td>
      <td><div class="action-btns">
        ${semester.status === 'Draft' ? `
          <button type="button" class="btn-icon" data-action="edit-semester" data-id="${escapeHtml(semester.id)}" aria-label="Edit ${escapeHtml(semester.name)}" title="Edit draft">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-action="activate-semester" data-id="${escapeHtml(semester.id)}">
            Aktifkan
          </button>` : ''}
      </div></td>
    </tr>`).join('');
}

function semesterStatusBadge(status) {
  const css = status === 'Aktif' ? 'badge-success' : status === 'Arsip' ? 'badge-muted' : 'badge-warning';
  return `<span class="badge ${css}">${escapeHtml(status || 'Draft')}</span>`;
}

function renderSemesterSelects(selectedTargetId = '') {
  const source = document.getElementById('sourceSemester');
  const target = document.getElementById('targetSemester');
  const sourceOptions = semesters.filter((semester) => semester.status !== 'Draft');
  source.innerHTML = sourceOptions.length
    ? sourceOptions.map((semester) =>
      `<option value="${escapeHtml(semester.id)}">${escapeHtml(semester.name)} (${escapeHtml(semester.status)})</option>`
    ).join('')
    : '<option value="">Aktifkan semester sumber terlebih dahulu</option>';
  const targetOptions = semesters.filter((semester) => semester.status === 'Draft');
  target.innerHTML = targetOptions.length
    ? targetOptions.map((semester) =>
      `<option value="${escapeHtml(semester.id)}">${escapeHtml(semester.name)}</option>`
    ).join('')
    : '<option value="">Buat semester Draft terlebih dahulu</option>';
  if (targetOptions.some((semester) => semester.id === selectedTargetId)) target.value = selectedTargetId;
}

function openSemesterForm(semester = null) {
  const form = document.getElementById('semesterForm');
  form.reset();
  document.getElementById('semesterId').value = semester?.id || '';
  document.getElementById('semesterFormTitle').textContent = semester ? 'Edit Semester Draft' : 'Semester Baru';
  document.getElementById('saveSemesterButton').textContent = semester ? 'Simpan Perubahan' : 'Simpan Draft';
  document.getElementById('importCurrentWrap').hidden = Boolean(semester);
  if (semester) {
    document.getElementById('semesterName').value = semester.name;
    document.getElementById('academicYear').value = semester.academicYear;
    document.getElementById('semesterTerm').value = semester.term;
    document.getElementById('semesterStart').value = semester.startDate;
    document.getElementById('semesterEnd').value = semester.endDate;
  } else {
    document.getElementById('importCurrent').checked = true;
  }
  document.getElementById('semesterFormCard').hidden = false;
  document.getElementById('semesterName').focus();
}

function closeSemesterForm() {
  document.getElementById('semesterFormCard').hidden = true;
  document.getElementById('semesterForm').reset();
}

async function saveSemester(event) {
  event.preventDefault();
  const semesterId = document.getElementById('semesterId').value;
  const payload = {
    name: document.getElementById('semesterName').value.trim(),
    academicYear: document.getElementById('academicYear').value.trim(),
    term: document.getElementById('semesterTerm').value,
    startDate: document.getElementById('semesterStart').value,
    endDate: document.getElementById('semesterEnd').value,
    importCurrentConfiguration: !semesterId && document.getElementById('importCurrent').checked
  };
  const submit = document.getElementById('saveSemesterButton');
  submit.disabled = true;
  try {
    const result = semesterId
      ? await API.updateSemester(semesterId, payload)
      : await API.createSemester(payload);
    closeSemesterForm();
    await refreshSemesters(result.id);
    showSemesterMessage(
      semesterId
        ? 'Draft semester berhasil diperbarui.'
        : `Draft berhasil dibuat. ${result.importedConfigurationCount || 0} konfigurasi awal disiapkan.`,
      'success'
    );
  } catch (error) {
    showSemesterMessage(error.message || 'Semester gagal disimpan.', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function handleSemesterAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const semester = semesters.find((item) => item.id === button.dataset.id);
  if (!semester) return;
  if (button.dataset.action === 'edit-semester') {
    openSemesterForm(semester);
    return;
  }
  if (button.dataset.action !== 'activate-semester') return;
  const confirmed = await confirmDialog({
    title: 'Aktifkan semester?',
    message: `Konfigurasi ${semester.name} akan diterapkan. Semester aktif sebelumnya menjadi arsip dan konfigurasi ini tidak dapat diedit lagi.`,
    confirmText: 'Aktifkan Semester'
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await API.activateSemester(semester.id);
    await refreshSemesters();
    showSemesterMessage(
      `Semester aktif. ${result.scheduleCount} jadwal baru diterapkan; absensi dan sesi QR lama tidak diubah.`,
      'success'
    );
  } catch (error) {
    showSemesterMessage(error.message || 'Semester gagal diaktifkan.', 'error');
  } finally {
    button.disabled = false;
  }
}

function selectedCopyTypes() {
  return [...document.querySelectorAll('input[name="copyType"]:checked')].map((input) => input.value);
}

function copyPayload() {
  return {
    sourceSemesterId: document.getElementById('sourceSemester').value,
    targetSemesterId: document.getElementById('targetSemester').value,
    types: selectedCopyTypes()
  };
}

async function previewCopy() {
  const payload = copyPayload();
  const button = document.getElementById('previewCopyButton');
  button.disabled = true;
  clearPreview();
  try {
    lastCopyPreview = { payload, result: await API.previewSemesterConfigurationCopy(payload) };
    renderCopyPreview(lastCopyPreview.result);
  } catch (error) {
    showCopyPreview(error.message || 'Preview gagal dibuat.', 'error');
  } finally {
    button.disabled = false;
  }
}

function renderCopyPreview(preview) {
  const rows = SEMESTER_COPY_TYPES.map(([type, label]) => {
    const counts = preview.categories[type] || { toCreate: 0, alreadyExists: 0 };
    return `<tr><td>${escapeHtml(label)}</td><td>${counts.toCreate}</td><td>${counts.alreadyExists}</td></tr>`;
  }).join('');
  const conflicts = preview.conflicts.length
    ? `<div class="semester-conflicts"><strong>Konflik harus diselesaikan sebelum menyalin:</strong><ul>${
      preview.conflicts.map((item) => `<li>${escapeHtml(item.message)}</li>`).join('')
    }</ul></div>`
    : '<p class="semester-no-conflicts">Tidak ditemukan konflik jadwal atau penugasan guru.</p>';
  const element = document.getElementById('copyPreview');
  element.innerHTML = `
    <strong>Preview: ${preview.totalToCreate} relasi baru, ${preview.totalAlreadyExists} relasi sudah tersedia.</strong>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Kategori</th><th>Baru</th><th>Sudah ada</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${conflicts}
    <p class="text-muted">Riwayat absensi, catatan kehadiran, dan sesi QR tidak termasuk dalam penyalinan.</p>`;
  element.className = `semester-notice semester-notice-${preview.conflicts.length ? 'warning' : 'success'}`;
  document.getElementById('copyConfigurationButton').disabled =
    preview.conflicts.length > 0 || preview.totalToCreate === 0;
}

async function copyConfiguration() {
  if (!lastCopyPreview || lastCopyPreview.result.conflicts.length) return;
  const button = document.getElementById('copyConfigurationButton');
  button.disabled = true;
  try {
    const result = await API.copySemesterConfiguration(lastCopyPreview.payload);
    const created = result.totalCreated;
    lastCopyPreview = null;
    await refreshTargetConfigurations();
    document.getElementById('copyPreview').innerHTML =
      `<strong>Penyalinan selesai.</strong> ${created} konfigurasi baru dibuat; ` +
      `${result.totalAlreadyExists} relasi yang sudah ada dilewati.`;
    document.getElementById('copyPreview').className = 'semester-notice semester-notice-success';
    showSemesterMessage('Konfigurasi tersalin. Draft tetap dapat diedit sebelum diaktifkan.', 'success');
  } catch (error) {
    showCopyPreview(error.message || 'Penyalinan gagal. Coba preview kembali.', 'error');
  } finally {
    button.disabled = true;
  }
}

function clearPreview() {
  lastCopyPreview = null;
  document.getElementById('copyConfigurationButton').disabled = true;
  showCopyPreview('Preview berubah atau belum dibuat. Tampilkan preview terbaru sebelum menyalin.', 'info');
}

function showCopyPreview(message, tone) {
  const element = document.getElementById('copyPreview');
  element.textContent = message;
  element.className = `semester-notice semester-notice-${tone}`;
}

async function refreshTargetConfigurations() {
  const semesterId = document.getElementById('targetSemester').value;
  const target = semesters.find((item) => item.id === semesterId);
  const tbody = document.getElementById('configurationTableBody');
  document.getElementById('addConfigurationButton').disabled = !target || target.status !== 'Draft';
  if (!semesterId) {
    targetConfigurations = [];
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Pilih atau buat semester Draft terlebih dahulu.</td></tr>';
    return;
  }
  try {
    targetConfigurations = await API.getSemesterConfigurations(semesterId);
    if (!targetConfigurations.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Belum ada konfigurasi pada semester ini.</td></tr>';
      return;
    }
    tbody.innerHTML = targetConfigurations.map((item) => `
      <tr>
        <td>${escapeHtml(SEMESTER_TYPE_LABELS[item.type] || item.type)}</td>
        <td>${escapeHtml(configurationSummary(item))}</td>
        <td>${target.status === 'Draft' ? `<div class="action-btns">
          <button type="button" class="btn-icon" data-action="edit-config" data-id="${escapeHtml(item.id)}" aria-label="Edit konfigurasi" title="Edit">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="btn-icon danger" data-action="delete-config" data-id="${escapeHtml(item.id)}" aria-label="Hapus konfigurasi" title="Hapus">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>` : '<span class="text-muted">Terkunci</span>'}</td>
      </tr>`).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message || 'Konfigurasi gagal dimuat.')}</td></tr>`;
  }
}

function configurationSummary(item) {
  const data = item.payload || {};
  if (item.type === 'subjects') return `${data.className} · ${data.subject}`;
  if (item.type === 'teacherAssignments') return `${data.className} · ${data.subject} → ${data.teacherName}`;
  if (item.type === 'schedules') {
    return `${data.day} ${data.start}–${data.end} · ${data.className} · ${data.subject} · ${data.teacherName}`;
  }
  if (item.type === 'periods') return `${data.day} ${data.start}–${data.end}${data.label ? ` · ${data.label}` : ''}`;
  return `${data.className} · Level ${data.level || '-'} · Jurusan ${data.major || '-'} · Wali ${data.homeroom || '-'} · Kapasitas ${data.capacity || '-'}`;
}

async function handleConfigurationAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = targetConfigurations.find((row) => row.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === 'edit-config') {
    openConfigurationModal(item);
    return;
  }
  const confirmed = await confirmDialog({
    title: 'Hapus konfigurasi?',
    message: `Relasi ${configurationSummary(item)} akan dihapus dari draft.`,
    confirmText: 'Hapus',
    danger: true
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await API.deleteSemesterConfiguration(item.id);
    await refreshTargetConfigurations();
    clearPreview();
    showSemesterMessage('Konfigurasi draft dihapus.', 'success');
  } catch (error) {
    showSemesterMessage(error.message || 'Konfigurasi gagal dihapus.', 'error');
  }
}

function openConfigurationModal(item = null) {
  const selector = document.getElementById('configurationTypeSelector');
  selector.disabled = Boolean(item);
  selector.value = item?.type || 'subjects';
  document.getElementById('configurationId').value = item?.id || '';
  document.getElementById('configurationType').value = item?.type || selector.value;
  document.getElementById('configurationClassId').value = item?.payload?.classId || '';
  document.getElementById('configurationModal').dataset.editing = String(Boolean(item));
  document.querySelector('#configurationModal .modal-header h3').textContent =
    item ? 'Edit Konfigurasi Draft' : 'Tambah Konfigurasi Draft';
  renderConfigurationFields(item?.payload || {});
  openModal('configurationModal');
}

function configOption(value, label) {
  return { value: String(value || ''), label: String(label || '') };
}

function configurationFields(type, data = {}) {
  const records = academicSetup?.records || {};
  const schoolLevel = academicSetup?.school?.schoolLevel || '';
  const classes = (records.classes || []).filter((item) => item.isActive !== false);
  const classOptions = classes.map((item) => configOption(item.id, item.name));
  if (data.classId && !classOptions.some((option) => option.value === data.classId)) {
    classOptions.unshift(configOption(data.classId, `${data.className || data.classId} (relasi lama)`));
  }
  const selectedClass = classes.find((item) => item.id === (data.classId || document.getElementById('config-classId')?.value));
  const subjects = (records.subjects || []).filter((item) =>
    item.isActive !== false && (!schoolLevel || item.educationLevels?.includes(schoolLevel)));
  const subjectOptions = subjects.map((item) => configOption(item.id, `${item.code} — ${item.name}`));
  if (data.subjectId && !subjectOptions.some((option) => option.value === data.subjectId)) {
    subjectOptions.unshift(configOption(data.subjectId, `${data.subject || data.subjectId} (relasi lama)`));
  }
  const teachers = (records.users || []).filter((item) =>
    item.role === 'guru' && item.status === 'Aktif')
    .map((item) => configOption(item.id, item.name));
  if (data.teacherUid && !teachers.some((option) => option.value === data.teacherUid)) {
    teachers.unshift(configOption(data.teacherUid, `${data.teacherName || data.teacherUid} (relasi lama)`));
  }
  const rooms = (records.rooms || []).filter((item) => item.isActive)
    .map((item) => configOption(item.id, `${item.code} — ${item.name}`));
  if (data.roomId && !rooms.some((option) => option.value === data.roomId)) {
    rooms.unshift(configOption(data.roomId, data.roomName || data.roomId));
  }
  const field = (key, label, options, value, required = true) => `
    <div class="form-group">
      <label for="config-${key}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <select id="config-${key}" class="form-control" ${required ? 'required' : ''}>
        <option value="">— Pilih —</option>
        ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(value || '') ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    </div>`;
  const input = (key, label, value = '', type = 'text', required = true) => `
    <div class="form-group">
      <label for="config-${key}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <input id="config-${key}" type="${type}" class="form-control" value="${escapeHtml(value)}"
        ${required ? 'required' : ''} ${type === 'number' ? 'min="1" max="500"' : ''}>
    </div>`;
  const timeFields = `
    ${field('day', 'Hari', ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map((day) => configOption(day, day)), data.day)}
    ${input('start', 'Jam mulai', data.start, 'time')}
    ${input('end', 'Jam selesai', data.end, 'time')}`;

  if (type === 'periods') return `${timeFields}${input('label', 'Label (opsional)', data.label || '', 'text', false)}`;
  if (type === 'classes') {
    const programs = (records.programs || []).filter((item) => item.isActive)
      .map((item) => configOption(item.id, `${item.code} — ${item.name}`));
    const majorOptions = [configOption('', 'Tanpa jurusan'), ...programs];
    if (data.majorId && !majorOptions.some((option) => option.value === data.majorId)) {
      majorOptions.push(configOption(data.majorId, data.major || data.majorId));
    }
    return `${field('classId', 'Kelas', classOptions, data.classId)}
      ${input('level', 'Tingkat', data.level || selectedClass?.level || '')}
      ${schoolLevel === 'SMK' ? field('majorId', 'Program keahlian', majorOptions, data.majorId || selectedClass?.majorId, false) : ''}
      ${field('roomId', 'Ruangan utama', [configOption('', 'Belum ditentukan'), ...rooms], data.roomId || selectedClass?.roomId, false)}
      ${field('homeroomTeacherUid', 'Wali kelas', teachers, data.homeroomTeacherUid, false)}
      ${input('capacity', 'Kapasitas siswa', data.capacity || selectedClass?.capacity || 36, 'number')}`;
  }
  const common = `${field('classId', 'Rombongan belajar', classOptions, data.classId)}
    ${field('subjectId', 'Mata pelajaran', subjectOptions, data.subjectId)}`;
  if (type === 'subjects') return common;
  if (type === 'teacherAssignments') {
    return `${common}${field('teacherUid', 'Guru', teachers, data.teacherUid)}`;
  }
  return `${common}
    ${field('teacherUid', 'Guru', teachers, data.teacherUid)}
    ${timeFields}
    ${field('roomId', 'Ruangan', rooms, data.roomId)}`;
}

function renderConfigurationFields(data = {}) {
  const type = document.getElementById('configurationTypeSelector').value;
  document.getElementById('configurationType').value = type;
  document.getElementById('configurationFields').innerHTML = configurationFields(type, data);
}

function updateConfigSubjectOptions() {
  const subjectSelect = document.getElementById('config-subjectId');
  if (!subjectSelect) return;
  const currentValue = subjectSelect.value;
  const html = configurationFields(
    document.getElementById('configurationTypeSelector').value,
    { classId: document.getElementById('config-classId')?.value || '' }
  );
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const updated = temp.querySelector('#config-subjectId');
  if (updated) {
    subjectSelect.innerHTML = updated.innerHTML;
    if ([...subjectSelect.options].some((option) => option.value === currentValue)) {
      subjectSelect.value = currentValue;
    }
  }
}

async function saveConfiguration(event) {
  event.preventDefault();
  const type = document.getElementById('configurationTypeSelector').value;
  const editing = document.getElementById('configurationModal').dataset.editing === 'true';
  const read = (key) => document.getElementById(`config-${key}`)?.value || '';
  const classRecord = (academicSetup.records.classes || []).find((item) => item.id === read('classId'));
  const subjectRecord = (academicSetup.records.subjects || []).find((item) => item.id === read('subjectId'));
  const teacherRecord = (academicSetup.records.users || []).find((item) => item.id === read('teacherUid'));
  const roomRecord = (academicSetup.records.rooms || []).find((item) => item.id === read('roomId'));
  const payload = {};
  if (type === 'periods') {
    Object.assign(payload, { day: read('day'), start: read('start'), end: read('end'), label: read('label') });
  } else if (type === 'classes') {
    const program = (academicSetup.records.programs || []).find((item) => item.id === read('majorId'));
    const room = (academicSetup.records.rooms || []).find((item) => item.id === read('roomId'));
    Object.assign(payload, {
      classId: read('classId'),
      className: classRecord?.name || '',
      level: read('level'),
      majorId: read('majorId'),
      major: program?.name || '',
      roomId: read('roomId'),
      roomName: room?.name || '',
      homeroomTeacherUid: read('homeroomTeacherUid'),
      homeroom: teacherRecord?.name || classRecord?.homeroom || '',
      capacity: Number(read('capacity'))
    });
  } else {
    Object.assign(payload, {
      classId: read('classId'),
      className: classRecord?.name || '',
      subjectId: read('subjectId'),
      subject: subjectRecord?.name || '',
      programId: classRecord?.majorId || ''
    });
    if (type === 'teacherAssignments' || type === 'schedules') {
      Object.assign(payload, {
        teacherUid: read('teacherUid'),
        teacherName: teacherRecord?.name || ''
      });
    }
    if (type === 'schedules') {
      Object.assign(payload, {
        day: read('day'),
        start: read('start'),
        end: read('end'),
        roomId: read('roomId'),
        roomName: roomRecord?.name || ''
      });
    }
  }
  try {
    if (editing) {
      await API.updateSemesterConfiguration(document.getElementById('configurationId').value, payload);
    } else {
      await API.saveSemesterConfiguration(document.getElementById('targetSemester').value, type, payload);
    }
    closeConfigurationModal();
    await refreshTargetConfigurations();
    clearPreview();
    showSemesterMessage('Perubahan konfigurasi draft disimpan.', 'success');
  } catch (error) {
    showSemesterMessage(error.message || 'Perubahan konfigurasi gagal disimpan.', 'error');
  }
}

function closeConfigurationModal() {
  closeModal('configurationModal');
  const modal = document.getElementById('configurationModal');
  modal.dataset.editing = 'false';
  document.getElementById('configurationTypeSelector').disabled = false;
}

function showSemesterMessage(message, tone) {
  if (tone === 'error') Toast.error(message);
  else if (tone === 'warning') Toast.warning(message);
  else if (tone === 'success') Toast.success(message);
}
