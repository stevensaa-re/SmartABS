const MASTER_LABELS = {
  programs: 'Jurusan / Program Keahlian',
  academicLevels: 'Tingkat Kelas',
  rooms: 'Ruangan',
  subjects: 'Mata Pelajaran',
  classes: 'Rombongan Belajar'
};
const MASTER_PAGE_SIZE = 20;
const SCHOOL_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
let schoolSetup = null;
let masterPageNumber = 0;
let editingMaster = null;
let subjectImportRows = [];

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'school') return;
  initSchoolSetup().catch((error) => {
    Toast.error(error.message || 'Setup sekolah gagal dimuat.');
  });
});

async function initSchoolSetup() {
  if (API.name !== 'firebase') {
    showSetupMessage('Setup sekolah dan master akademik memerlukan Firebase + Cloud Functions.');
    return;
  }
  bindSchoolSetupEvents();
  await loadSchoolSetup();
}

function bindSchoolSetupEvents() {
  document.getElementById('schoolProfileForm').addEventListener('submit', saveSchoolForm);
  document.getElementById('schoolLevel').addEventListener('change', updateMasterTypeOptions);
  document.getElementById('schoolLogoFile').addEventListener('change', previewSchoolLogo);
  document.getElementById('masterType').addEventListener('change', () => {
    masterPageNumber = 0;
    renderMasterTable();
  });
  document.getElementById('masterSearch').addEventListener('input', debounce(() => {
    masterPageNumber = 0;
    renderMasterTable();
  }));
  document.getElementById('masterStatus').addEventListener('change', () => {
    masterPageNumber = 0;
    renderMasterTable();
  });
  document.getElementById('addMasterButton').addEventListener('click', () => openMasterForm());
  document.getElementById('masterForm').addEventListener('submit', saveMasterForm);
  document.getElementById('masterBody').addEventListener('click', handleMasterAction);
  document.getElementById('closeMasterModal').addEventListener('click', closeMasterModal);
  document.getElementById('cancelMasterModal').addEventListener('click', closeMasterModal);
  document.getElementById('masterPrev').addEventListener('click', () => {
    masterPageNumber = Math.max(0, masterPageNumber - 1);
    renderMasterTable();
  });
  document.getElementById('masterNext').addEventListener('click', () => {
    masterPageNumber++;
    renderMasterTable();
  });
  document.getElementById('exportSubjectsButton').addEventListener('click', exportSubjectsCsv);
  document.getElementById('subjectCsvFile').addEventListener('change', previewSubjectsCsv);
  document.getElementById('importSubjectsButton').addEventListener('click', importSubjectsCsv);
}

async function loadSchoolSetup() {
  schoolSetup = await API.getSchoolSetup();
  populateSchoolForm(schoolSetup.school);
  const requestedType = new URLSearchParams(window.location.search).get('type');
  if (requestedType && Object.hasOwn(MASTER_LABELS, requestedType)) {
    document.getElementById('masterType').value = requestedType;
  }
  updateMasterTypeOptions();
  renderSetupChecklist();
  renderMasterTable();
}

function showSetupMessage(message) {
  document.getElementById('setupChecklist').innerHTML =
    `<div class="semester-notice semester-notice-warning">${escapeHtml(message)}</div>`;
  document.querySelectorAll('#schoolProfileForm input, #schoolProfileForm select, #schoolProfileForm button, #masterType, #addMasterButton').forEach((el) => {
    el.disabled = true;
  });
}

function populateSchoolForm(school) {
  const values = {
    schoolName: school.name,
    schoolNpsn: school.npsn,
    schoolLevel: school.schoolLevel,
    schoolType: school.schoolType,
    schoolAddress: school.address,
    schoolPhone: school.phone,
    schoolEmail: school.email,
    principalName: school.principalName,
    schoolAcademicYear: school.academicYear,
    schoolTimeZone: school.timeZone || 'Asia/Jakarta',
    schoolOpen: school.openingTime,
    schoolClose: school.closingTime,
    lateTolerance: school.lateToleranceMinutes ?? 10
  };
  for (const [id, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) document.getElementById(id).value = value;
  }
  const days = new Set(school.operatingDays || []);
  document.querySelectorAll('input[name="operatingDay"]').forEach((input) => {
    input.checked = days.has(input.value);
  });
  const activeSemester = (schoolSetup.records.semesters || []).find((semester) =>
    semester.id === school.activeSemesterId);
  document.getElementById('activeSemesterName').value = activeSemester
    ? `${activeSemester.name} (${activeSemester.academicYear})`
    : 'Belum ada semester aktif';
  renderLogoPreview(school.logoUrl || '');
}

async function previewSchoolLogo() {
  const file = document.getElementById('schoolLogoFile').files[0];
  if (!file) return renderLogoPreview(schoolSetup.school.logoUrl || '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    document.getElementById('schoolLogoFile').value = '';
    Toast.warning('Pilih PNG, JPEG, atau WebP dengan ukuran maksimal 2 MB.');
    return;
  }
  renderLogoPreview(URL.createObjectURL(file));
}

function renderLogoPreview(url) {
  document.getElementById('logoPreview').innerHTML = url
    ? `<img class="school-logo-preview" src="${escapeHtml(url)}" alt="Logo sekolah">`
    : '<span class="text-muted">Belum ada logo</span>';
}

async function saveSchoolForm(event) {
  event.preventDefault();
  const button = document.getElementById('saveSchoolButton');
  button.disabled = true;
  try {
    let logoUrl = schoolSetup.school.logoUrl || '';
    const file = document.getElementById('schoolLogoFile').files[0];
    if (file) logoUrl = await FirebaseAdapter.uploadSchoolLogo(file);
    const payload = {
      name: document.getElementById('schoolName').value.trim(),
      npsn: document.getElementById('schoolNpsn').value.trim(),
      schoolLevel: document.getElementById('schoolLevel').value,
      schoolType: document.getElementById('schoolType').value,
      address: document.getElementById('schoolAddress').value.trim(),
      phone: document.getElementById('schoolPhone').value.trim(),
      email: document.getElementById('schoolEmail').value.trim(),
      principalName: document.getElementById('principalName').value.trim(),
      academicYear: document.getElementById('schoolAcademicYear').value.trim(),
      timeZone: document.getElementById('schoolTimeZone').value,
      openingTime: document.getElementById('schoolOpen').value,
      closingTime: document.getElementById('schoolClose').value,
      lateToleranceMinutes: Number(document.getElementById('lateTolerance').value),
      operatingDays: [...document.querySelectorAll('input[name="operatingDay"]:checked')]
        .map((input) => input.value),
      logoUrl
    };
    await API.saveSchoolProfile(payload);
    document.getElementById('schoolLogoFile').value = '';
    await loadSchoolSetup();
    Toast.success('Profil dan pengaturan sekolah tersimpan.');
  } catch (error) {
    Toast.error(error.message || 'Profil sekolah gagal disimpan.');
  } finally {
    button.disabled = false;
  }
}

function renderSetupChecklist() {
  const school = schoolSetup.school;
  const records = schoolSetup.records;
  const activeSemester = (records.semesters || []).some((semester) =>
    semester.id === school.activeSemesterId && semester.status === 'Aktif');
  const checks = [
    ['Profil sekolah', Boolean(school.name && school.npsn && school.schoolLevel && school.principalName)],
    ['Tahun ajaran & semester aktif', Boolean(school.academicYear && activeSemester)],
    ['Program keahlian SMK', school.schoolLevel !== 'SMK' || (records.programs || []).some((item) => item.isActive)],
    ['Tingkat dan rombongan belajar', (records.academicLevels || []).some((item) => item.isActive) &&
      (records.classes || []).some((item) => item.isActive !== false)],
    ['Katalog mata pelajaran', (records.subjects || []).some((item) => item.isActive)],
    ['Guru dan ruangan', (records.users || []).some((item) => item.role === 'guru' && item.status === 'Aktif') &&
      (records.rooms || []).some((item) => item.isActive)]
  ];
  const complete = checks.filter(([, done]) => done).length;
  document.getElementById('setupChecklist').innerHTML = `
    <div class="setup-check ${complete === checks.length ? 'complete' : 'incomplete'}">
      <strong>${complete}/${checks.length} langkah selesai</strong>
      <p>${complete === checks.length ? 'Konfigurasi dasar sekolah lengkap.' : 'Lengkapi langkah berikut sebelum semester digunakan.'}</p>
    </div>
    ${checks.map(([label, done]) => `
      <div class="setup-check ${done ? 'complete' : 'incomplete'}">
        <strong><i class="fa-solid ${done ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${escapeHtml(label)}</strong>
        <p>${done ? 'Siap' : 'Perlu dilengkapi'}</p>
      </div>`).join('')}`;
}

function updateMasterTypeOptions() {
  const programs = document.querySelector('#masterType option[value="programs"]');
  const isSmk = document.getElementById('schoolLevel').value === 'SMK';
  programs.hidden = !isSmk;
  if (!isSmk && document.getElementById('masterType').value === 'programs') {
    document.getElementById('masterType').value = 'academicLevels';
  }
  renderMasterTable();
}

function activeMasterType() {
  return document.getElementById('masterType').value;
}

function allMasterRecords() {
  return (schoolSetup?.records?.[activeMasterType()] || []).slice();
}

function filteredMasterRecords() {
  const keyword = document.getElementById('masterSearch').value.trim().toLocaleLowerCase('id');
  const status = document.getElementById('masterStatus').value;
  return allMasterRecords().filter((record) => {
    const text = Object.values(record).filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase('id');
    return (!keyword || text.includes(keyword)) &&
      (!status || String(record.isActive !== false) === status);
  }).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), 'id'));
}

function renderMasterTable() {
  if (!schoolSetup) return;
  const type = activeMasterType();
  const fields = masterColumns(type);
  document.getElementById('masterHead').innerHTML =
    `<tr>${fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}<th>Status</th><th>Aksi</th></tr>`;
  const records = filteredMasterRecords();
  const pages = Math.max(1, Math.ceil(records.length / MASTER_PAGE_SIZE));
  masterPageNumber = Math.min(masterPageNumber, pages - 1);
  const start = masterPageNumber * MASTER_PAGE_SIZE;
  const pageRows = records.slice(start, start + MASTER_PAGE_SIZE);
  document.getElementById('masterBody').innerHTML = pageRows.length
    ? pageRows.map((record) => `
      <tr>
        ${fields.map((field) => `<td>${escapeHtml(formatMasterCell(type, field.key, record))}</td>`).join('')}
        <td><span class="badge ${record.isActive === false ? 'badge-muted' : 'badge-success'}">${record.isActive === false ? 'Nonaktif' : 'Aktif'}</span></td>
        <td><div class="action-btns">
          <button type="button" class="btn-icon" data-action="edit" data-id="${escapeHtml(record.id)}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn btn-outline btn-sm" data-action="toggle" data-id="${escapeHtml(record.id)}">${record.isActive === false ? 'Aktifkan' : 'Nonaktifkan'}</button>
        </div></td>
      </tr>`).join('')
    : emptyTableRow(fields.length + 2, `Belum ada ${MASTER_LABELS[type].toLowerCase()}`, 'Tambah data atau ubah filter pencarian.');
  document.getElementById('masterCount').textContent = `${records.length} data`;
  document.getElementById('masterPage').textContent = `Halaman ${masterPageNumber + 1} dari ${pages}`;
  document.getElementById('masterPrev').disabled = masterPageNumber === 0;
  document.getElementById('masterNext').disabled = masterPageNumber >= pages - 1;
}

function masterColumns(type) {
  if (type === 'programs') return [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Program Keahlian' }, { key: 'level', label: 'Jenjang' }];
  if (type === 'academicLevels') return [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Tingkat' }, { key: 'sortOrder', label: 'Urutan' }];
  if (type === 'rooms') return [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Ruangan' }, { key: 'capacity', label: 'Kapasitas' }];
  if (type === 'subjects') return [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Mata Pelajaran' }, { key: 'category', label: 'Kategori' }, { key: 'educationLevels', label: 'Jenjang' }];
  return [{ key: 'name', label: 'Rombongan Belajar' }, { key: 'level', label: 'Tingkat' }, { key: 'major', label: 'Jurusan' }, { key: 'homeroom', label: 'Wali Kelas' }, { key: 'capacity', label: 'Kapasitas' }];
}

function formatMasterCell(type, key, record) {
  if (key === 'educationLevels') return (record[key] || []).join(', ');
  if (type === 'classes' && key === 'roomId') return record.roomName || record[key] || '-';
  return record[key] ?? '-';
}

function openMasterForm(record = null) {
  editingMaster = record;
  const type = activeMasterType();
  document.getElementById('masterRecordId').value = record?.id || '';
  document.getElementById('masterModalTitle').textContent = `${record ? 'Edit' : 'Tambah'} ${MASTER_LABELS[type]}`;
  document.getElementById('masterFields').innerHTML = masterFields(type, record || {});
  openModal('masterModal');
}

function masterFields(type, record) {
  const text = (key, label, value = '', required = true, hint = '') => `
    <div class="form-group"><label for="master-${key}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <input id="master-${key}" class="form-control" value="${escapeHtml(value ?? '')}" ${required ? 'required' : ''}>
      ${hint ? `<small class="text-muted">${escapeHtml(hint)}</small>` : ''}</div>`;
  const select = (key, label, options, value = '', required = true) => `
    <div class="form-group"><label for="master-${key}">${escapeHtml(label)}${required ? ' *' : ''}</label>
      <select id="master-${key}" class="form-control" ${required ? 'required' : ''}>${options.map(([id, name]) =>
        `<option value="${escapeHtml(id)}" ${String(value) === String(id) ? 'selected' : ''}>${escapeHtml(name)}</option>`
      ).join('')}</select></div>`;
  const active = `<div class="form-group"><label><input id="master-isActive" type="checkbox" ${record.isActive !== false ? 'checked' : ''}> Aktif</label></div>`;
  if (type === 'programs') return text('code', 'Kode program', record.code) + text('name', 'Nama program keahlian', record.name) + select('level', 'Jenjang', [['SMK', 'SMK']], record.level || 'SMK') + active;
  if (type === 'academicLevels') return text('code', 'Kode tingkat', record.code) + text('name', 'Nama tingkat', record.name) + text('sortOrder', 'Urutan (angka)', record.sortOrder || '1') + select('level', 'Jenis jenjang', [['', 'Berlaku untuk semua'], ...['SD', 'SMP', 'SMA', 'SMK'].map((level) => [level, level])], record.level || '', false) + active;
  if (type === 'rooms') return text('code', 'Kode ruangan', record.code) + text('name', 'Nama ruangan', record.name) + text('capacity', 'Kapasitas', record.capacity || '36') + active;
  if (type === 'subjects') {
    const levels = ['SD', 'SMP', 'SMA', 'SMK'].filter((level) => level === schoolSetup.school.schoolLevel);
    const selected = new Set(record.educationLevels || levels);
    return text('code', 'Kode mata pelajaran', record.code) +
      text('name', 'Nama mata pelajaran', record.name) +
      text('category', 'Kategori', record.category || 'Umum') +
      `<div class="form-group"><label>Jenjang yang memakai mapel *</label>${levels.map((level) =>
        `<label class="semester-copy-type"><input name="master-education-level" type="checkbox" value="${level}" ${selected.has(level) ? 'checked' : ''}> ${level}</label>`
      ).join('')}</div>${active}`;
  }
  const programs = [{ id: '', name: 'Tanpa jurusan' }, ...(schoolSetup.records.programs || [])
    .filter((item) => item.isActive).map((item) => ({ id: item.id, name: `${item.code} — ${item.name}` }))];
  const rooms = [{ id: '', name: 'Belum ditentukan' }, ...(schoolSetup.records.rooms || [])
    .filter((item) => item.isActive).map((item) => ({ id: item.id, name: `${item.code} — ${item.name}` }))];
  const teachers = [{ id: '', name: 'Belum ditentukan' }, ...(schoolSetup.records.users || [])
    .filter((item) => item.role === 'guru' && item.status === 'Aktif')
    .map((item) => ({ id: item.id, name: item.name }))];
  const levels = (schoolSetup.records.academicLevels || [])
    .filter((item) => item.isActive && (!item.level || item.level === schoolSetup.school.schoolLevel))
    .map((item) => [item.name, item.name]);
  return text('name', 'Nama rombongan belajar', record.name) +
    select('level', 'Tingkat kelas', levels.length ? levels : [[record.level || '', 'Buat tingkat kelas terlebih dahulu']], record.level || '') +
    (schoolSetup.school.schoolLevel === 'SMK' ? select('majorId', 'Program keahlian', programs.map((item) => [item.id, item.name]), record.majorId || '', false) : '') +
    select('roomId', 'Ruangan', rooms.map((item) => [item.id, item.name]), record.roomId || '', false) +
    select('homeroomTeacherUid', 'Wali kelas', teachers.map((item) => [item.id, item.name]), record.homeroomTeacherUid || '', false) +
    text('capacity', 'Kapasitas', record.capacity || '36') + active;
}

function readMasterForm(type) {
  const read = (key) => document.getElementById(`master-${key}`)?.value || '';
  const payload = { isActive: Boolean(document.getElementById('master-isActive')?.checked) };
  if (type === 'programs') Object.assign(payload, { code: read('code'), name: read('name'), level: read('level') });
  else if (type === 'academicLevels') Object.assign(payload, {
    code: read('code'), name: read('name'), level: read('level'), sortOrder: Number(read('sortOrder'))
  });
  else if (type === 'rooms') Object.assign(payload, { code: read('code'), name: read('name'), capacity: Number(read('capacity')) });
  else if (type === 'subjects') Object.assign(payload, {
    code: read('code'), name: read('name'), category: read('category'),
    educationLevels: [...document.querySelectorAll('input[name="master-education-level"]:checked')].map((input) => input.value)
  });
  else {
    const major = schoolSetup.records.programs.find((item) => item.id === read('majorId'));
    const homeroomTeacher = schoolSetup.records.users.find((item) => item.id === read('homeroomTeacherUid'));
    Object.assign(payload, {
      name: read('name'), level: read('level'), majorId: read('majorId'),
      major: major?.name || '', roomId: read('roomId'),
      homeroomTeacherUid: read('homeroomTeacherUid'),
      homeroom: homeroomTeacher?.name || '', capacity: Number(read('capacity'))
    });
  }
  return payload;
}

async function saveMasterForm(event) {
  event.preventDefault();
  const button = document.getElementById('saveMasterButton');
  button.disabled = true;
  try {
    await API.saveAcademicMaster(activeMasterType(),
      document.getElementById('masterRecordId').value || '',
      readMasterForm(activeMasterType()));
    closeMasterModal();
    await loadSchoolSetup();
    Toast.success('Data akademik tersimpan.');
  } catch (error) {
    Toast.error(error.message || 'Data akademik gagal disimpan.');
  } finally {
    button.disabled = false;
  }
}

async function handleMasterAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const record = allMasterRecords().find((item) => item.id === button.dataset.id);
  if (!record) return;
  if (button.dataset.action === 'edit') return openMasterForm(record);
  const action = record.isActive === false ? 'mengaktifkan' : 'menonaktifkan';
  const confirmed = await confirmDialog({
    title: `Konfirmasi ${action} data`,
    message: `Data "${record.name || record.code}" akan ${action}. Relasi lama tetap dipertahankan.`,
    confirmText: record.isActive === false ? 'Aktifkan' : 'Nonaktifkan',
    danger: record.isActive !== false
  });
  if (!confirmed) return;
  try {
    await API.saveAcademicMaster(activeMasterType(), record.id, { ...record, isActive: record.isActive === false });
    await loadSchoolSetup();
    Toast.success(`Data berhasil ${record.isActive === false ? 'diaktifkan' : 'dinonaktifkan'}.`);
  } catch (error) {
    Toast.error(error.message || 'Status data gagal diperbarui.');
  }
}

function closeMasterModal() {
  closeModal('masterModal');
  editingMaster = null;
}

function csvEscape(value) {
  const raw = Array.isArray(value) ? value.join(';') : String(value ?? '');
  return `"${raw.replaceAll('"', '""')}"`;
}

function exportSubjectsCsv() {
  const rows = schoolSetup.records.subjects || [];
  const csv = [
    ['code', 'name', 'category', 'educationLevels', 'isActive'].map(csvEscape).join(','),
    ...rows.map((row) => [row.code, row.name, row.category, row.educationLevels, row.isActive !== false].map(csvEscape).join(','))
  ].join('\r\n');
  downloadTextFile(`smartabs-mata-pelajaran-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

async function previewSubjectsCsv(event) {
  const file = event.target.files[0];
  subjectImportRows = [];
  document.getElementById('importSubjectsButton').disabled = true;
  const preview = document.getElementById('subjectImportPreview');
  if (!file) { preview.hidden = true; return; }
  try {
    const lines = parseCsv(await file.text());
    const header = lines.shift()?.map((value) => value.trim().toLowerCase()) || [];
    const required = ['code', 'name', 'category', 'educationlevels'];
    if (required.some((key) => !header.includes(key))) throw new Error('CSV harus memiliki kolom code,name,category,educationLevels.');
    subjectImportRows = lines.filter((row) => row.some(Boolean)).map((row, index) => {
      const record = Object.fromEntries(header.map((key, column) => [key, row[column] || '']));
      return {
        rowNumber: index + 2,
        code: record.code.trim().toUpperCase(),
        name: record.name.trim(),
        category: record.category.trim(),
        educationLevels: record.educationlevels.split(/[;|]/).map((item) => item.trim()).filter(Boolean),
        isActive: !['false', '0', 'nonaktif'].includes(record.isactive.trim().toLowerCase())
      };
    });
    const errors = validateSubjectImport(subjectImportRows);
    preview.hidden = false;
    preview.className = `semester-notice semester-notice-${errors.length ? 'warning' : 'success'}`;
    preview.innerHTML = `<strong>Preview ${subjectImportRows.length} baris</strong><p>${errors.length ? `${errors.length} baris tidak valid; tidak ada data yang disimpan.` : 'Semua baris lolos validasi awal.'}</p>${
      errors.length ? `<ul>${errors.slice(0, 20).map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : ''
    }<p class="text-muted">${subjectImportRows.slice(0, 5).map((row) => `${escapeHtml(row.code)} — ${escapeHtml(row.name)}`).join('<br>')}</p>`;
    document.getElementById('importSubjectsButton').disabled = errors.length > 0 || !subjectImportRows.length;
  } catch (error) {
    preview.hidden = false;
    preview.className = 'semester-notice semester-notice-error';
    preview.textContent = error.message || 'File CSV tidak dapat diproses.';
  }
}

function validateSubjectImport(rows) {
  const errors = [];
  const codes = new Set((schoolSetup.records.subjects || []).map((row) => row.code.toUpperCase()));
  for (const row of rows) {
    if (!row.code || !row.name || !row.category) errors.push(`Baris ${row.rowNumber}: kode, nama, dan kategori wajib diisi.`);
    if (codes.has(row.code)) errors.push(`Baris ${row.rowNumber}: kode ${row.code} duplikat/ sudah ada.`);
    codes.add(row.code);
    if (!row.educationLevels.length || row.educationLevels.some((level) => level !== schoolSetup.school.schoolLevel)) {
      errors.push(`Baris ${row.rowNumber}: jenjang hanya boleh ${schoolSetup.school.schoolLevel}.`);
    }
  }
  return errors;
}

async function importSubjectsCsv() {
  const confirmed = await confirmDialog({
    title: 'Import mata pelajaran?',
    message: `${subjectImportRows.length} mata pelajaran akan ditambahkan. Data yang ada tidak akan ditimpa.`,
    confirmText: 'Import'
  });
  if (!confirmed) return;
  const button = document.getElementById('importSubjectsButton');
  button.disabled = true;
  let created = 0;
  try {
    for (const row of subjectImportRows) {
      const { rowNumber, ...payload } = row;
      await API.saveAcademicMaster('subjects', '', payload);
      created++;
    }
    subjectImportRows = [];
    document.getElementById('subjectCsvFile').value = '';
    document.getElementById('subjectImportPreview').hidden = true;
    await loadSchoolSetup();
    Toast.success(`${created} mata pelajaran berhasil diimpor.`);
  } catch (error) {
    await loadSchoolSetup();
    Toast.error(`${created} mata pelajaran sudah tersimpan sebelum kegagalan. Lakukan preview/import ulang; duplikasi akan ditolak. ${error.message || ''}`);
  } finally {
    button.disabled = true;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('CSV memiliki kutip yang tidak berpasangan.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function downloadTextFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
