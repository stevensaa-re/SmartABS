let importRows = [];
let importErrors = [];
let importFileName = '';
let importLookups = null;
let backupToRestore = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'tools') return;
  const [students, teachers, classes, users] = await Promise.all([
    API.getStudents(), API.getTeachers(), API.getClasses(), API.getUsers()
  ]);
  importLookups = { students, teachers, classes, users };
  document.getElementById('importType').addEventListener('change', updateImportHint);
  document.getElementById('importFile').addEventListener('change', previewImportFile);
  document.getElementById('runImport').addEventListener('click', runImport);
  document.getElementById('downloadTemplate').addEventListener('click', downloadTemplate);
  document.getElementById('createBackup').addEventListener('click', createBackup);
  document.getElementById('restoreFile').addEventListener('change', readBackupFile);
  document.getElementById('restoreBackup').addEventListener('click', restoreBackup);
  document.getElementById('refreshAudit').addEventListener('click', loadAudit);
  updateImportHint();
  await loadAudit();
});

function updateImportHint() {
  const students = document.getElementById('importType').value === 'students';
  document.getElementById('importHint').textContent = students
    ? 'Header wajib: nis,nama,kelas. Opsional: jenis_kelamin (L/P),no_hp. Akun siswa ditautkan setelah impor dari Data Siswa.'
    : 'Header wajib: username,nama,kelas. Opsional: mata_pelajaran. Akun guru harus sudah dibuat dan aktif; impor tidak membuat akun/password.';
  resetImportPreview();
}

function resetImportPreview() {
  importRows = [];
  importErrors = [];
  importFileName = '';
  document.getElementById('importPreview').innerHTML = '';
  document.getElementById('importResult').innerHTML = '';
  document.getElementById('runImport').disabled = true;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted && char === '"' && input[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) {
      row.push(value.trim()); value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  if (quoted) throw new Error('Format CSV memiliki tanda kutip yang belum ditutup.');
  row.push(value.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV harus memiliki header dan minimal satu baris data.');
  return rows;
}

function normalizeHeader(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function previewImportFile() {
  resetImportPreview();
  const file = document.getElementById('importFile').files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    Toast.warning('Ukuran CSV melebihi batas 5 MB.');
    return;
  }
  try {
    const rows = parseCsv(await file.text());
    if (rows.length - 1 > 1000) throw new Error('CSV melebihi batas 1.000 baris data.');
    importFileName = file.name;
    const headers = rows[0].map(normalizeHeader);
    const type = document.getElementById('importType').value;
    const required = type === 'students' ? ['nis', 'nama', 'kelas'] : ['username', 'nama', 'kelas'];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length) throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')}.`);
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
    const seen = new Set();
    importRows = rows.slice(1).map((cells, index) => {
      const item = {};
      headers.forEach((header, column) => { item[header] = cells[column] || ''; });
      const value = (key, aliases = []) => {
        const header = [key, ...aliases].map(normalizeHeader).find((candidate) => indexes[candidate] !== undefined);
        return header ? String(item[header] || '').trim() : '';
      };
      const record = type === 'students' ? {
        nis: value('nis'), name: value('nama', ['name']), className: value('kelas', ['class']),
        gender: value('jenis_kelamin', ['gender', 'lp']).toUpperCase() || 'L',
        phone: value('no_hp', ['phone', 'telepon'])
      } : {
        username: value('username'), name: value('nama', ['name']),
        className: value('kelas', ['class']), subject: value('mata_pelajaran', ['subject', 'mapel'])
      };
      const key = type === 'students' ? record.nis : record.username.toLowerCase();
      const errors = [];
      if (type === 'students') {
        if (!/^\d{4,20}$/.test(record.nis)) errors.push('NIS harus 4–20 angka');
        if (importLookups.students.some((student) => student.nis === record.nis) || seen.has(key)) errors.push('NIS duplikat');
        if (!['L', 'P'].includes(record.gender)) errors.push('jenis_kelamin harus L atau P');
        if (record.phone.length > 30) errors.push('no_hp terlalu panjang');
      } else {
        if (!/^[\w.-]{2,50}$/.test(record.username)) errors.push('username tidak valid');
        if (importLookups.teachers.some((teacher) => teacher.username.toLowerCase() === key) || seen.has(key)) errors.push('profil guru duplikat');
        const user = importLookups.users.find((candidate) => candidate.username.toLowerCase() === key);
        if (!user || user.role !== 'guru' || user.status !== 'Aktif') errors.push('akun guru aktif belum ada');
      }
      if (!record.name || record.name.length > 100) errors.push('nama wajib, maksimal 100 karakter');
      if (!importLookups.classes.some((item) => item.name.toLowerCase() === record.className.toLowerCase())) errors.push('kelas belum tersedia');
      if (record.subject.length > 100) errors.push('mata pelajaran terlalu panjang');
      if (key) seen.add(key);
      if (errors.length) importErrors.push({ line: index + 2, errors });
      return { line: index + 2, record, errors };
    });
    renderImportPreview();
  } catch (error) {
    document.getElementById('importPreview').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderImportPreview() {
  const valid = importRows.filter((row) => !row.errors.length);
  const sample = importRows.slice(0, 30);
  const keys = document.getElementById('importType').value === 'students'
    ? [['nis', 'NIS'], ['name', 'Nama'], ['className', 'Kelas'], ['gender', 'L/P']]
    : [['username', 'Username'], ['name', 'Nama'], ['className', 'Kelas'], ['subject', 'Mapel']];
  document.getElementById('importPreview').innerHTML = `
    <p class="text-muted">Berkas: ${escapeHtml(importFileName)} · ${importRows.length} baris · ${valid.length} siap · ${importRows.length - valid.length} bermasalah. Pratinjau dibatasi 30 baris.</p>
    <table class="data-table"><thead><tr>${keys.map(([, label]) => `<th>${label}</th>`).join('')}<th>Validasi</th></tr></thead>
    <tbody>${sample.map(({ record, errors }) => `<tr>${keys.map(([key]) => `<td>${escapeHtml(record[key] || '-')}</td>`).join('')}
      <td>${errors.length ? `<span class="form-error">${escapeHtml(errors.join('; '))}</span>` : '<span class="text-muted">Siap</span>'}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('runImport').disabled = valid.length === 0;
}

async function runImport() {
  const type = document.getElementById('importType').value;
  const valid = importRows.filter((row) => !row.errors.length);
  if (!valid.length) return;
  const button = document.getElementById('runImport');
  button.disabled = true;
  let success = 0;
  const failures = [];
  for (let index = 0; index < valid.length; index++) {
    const { record, line } = valid[index];
    try {
      if (type === 'students') await API.createStudent({ ...record, status: 'Aktif', userId: '' });
      else await API.createTeacher({ ...record, status: 'Aktif' });
      success++;
    } catch (error) {
      failures.push(`Baris ${line}: ${error.message || 'gagal disimpan'}`);
    }
    button.textContent = `Menyimpan ${index + 1}/${valid.length}…`;
  }
  try {
    await API.logAudit({ action: 'import', entity: type, entityId: importFileName,
      summary: `Impor ${type}: ${success} berhasil, ${failures.length} gagal.` });
  } catch (error) { failures.push(`Audit: ${error.message}`); }
  document.getElementById('importResult').innerHTML = `<p>${success} data berhasil disimpan; ${failures.length} gagal.</p>` +
    (failures.length ? `<ul>${failures.slice(0, 50).map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>` : '');
  button.textContent = 'Impor baris valid';
  if (success) {
    Toast.success(`${success} data berhasil diimpor.`);
    importLookups = {
      students: await API.getStudents(), teachers: await API.getTeachers(),
      classes: importLookups.classes, users: importLookups.users
    };
  }
  await loadAudit();
}

function downloadTemplate() {
  const type = document.getElementById('importType').value;
  const content = type === 'students'
    ? 'nis,nama,kelas,jenis_kelamin,no_hp\n20260001,Nama Siswa,XI IPA 1,L,081234567890\n'
    : 'username,nama,kelas,mata_pelajaran\nguru01,Nama Guru,XI IPA 1,Matematika\n';
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `template-impor-${type}.csv`; link.click();
  URL.revokeObjectURL(url);
}

async function createBackup() {
  const button = document.getElementById('createBackup');
  button.disabled = true;
  try {
    const backup = await API.exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `smartabs-backup-${todayISO()}.json`; link.click();
    URL.revokeObjectURL(url);
    document.getElementById('backupResult').textContent = 'Backup berhasil dibuat dan diunduh.';
    Toast.success('Backup berhasil dibuat.');
  } catch (error) { Toast.error(error.message || 'Gagal membuat backup.'); }
  finally { button.disabled = false; }
}

async function readBackupFile() {
  backupToRestore = null;
  const button = document.getElementById('restoreBackup');
  button.disabled = true;
  const file = document.getElementById('restoreFile').files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { Toast.warning('Berkas backup melebihi batas 25 MB.'); return; }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.format !== 'smartabs-backup' || parsed.version !== 1 || !parsed.data) {
      throw new Error('Berkas bukan backup SMARTABS versi yang didukung.');
    }
    backupToRestore = parsed;
    button.disabled = false;
    document.getElementById('backupResult').textContent = `Siap memeriksa backup dari ${parsed.generatedAt || 'tanggal tidak diketahui'}.`;
  } catch (error) { Toast.error(error.message || 'Berkas backup tidak valid.'); }
}

async function restoreBackup() {
  if (!backupToRestore) return;
  const confirmed = await confirmDialog({
    title: 'Pulihkan backup dengan merge aman?',
    message: 'Dokumen yang ID-nya sudah ada tidak akan ditimpa. Pastikan backup berasal dari SMARTABS dan simpan salinan database saat ini terlebih dahulu.',
    confirmText: 'Pulihkan'
  });
  if (!confirmed) return;
  const button = document.getElementById('restoreBackup');
  button.disabled = true;
  try {
    const result = await API.restoreBackup(backupToRestore);
    document.getElementById('backupResult').textContent =
      `Pemulihan selesai: ${result.restored} dokumen dipulihkan, ${result.skipped} dokumen dilewati (duplikat atau tidak didukung).`;
    Toast.success('Pemulihan backup selesai.');
    await loadAudit();
  } catch (error) {
    document.getElementById('backupResult').textContent = `Pemulihan gagal: ${error.message || 'kesalahan tidak diketahui'}`;
    Toast.error(error.message || 'Pemulihan gagal.');
  } finally { button.disabled = false; }
}

async function loadAudit() {
  const tbody = document.getElementById('auditRows');
  tbody.innerHTML = loadingRow(5);
  try {
    const logs = await API.getAuditLogs();
    tbody.innerHTML = logs.length ? logs.map((log) => `<tr>
      <td>${escapeHtml(formatAuditTimestamp(log.createdAt))}</td>
      <td>${escapeHtml(log.actorName || '-')}</td><td>${escapeHtml(log.action || '-')}</td>
      <td>${escapeHtml(log.entity || '-')} ${escapeHtml(log.entityId || '')}</td>
      <td>${escapeHtml(log.summary || '-')}</td></tr>`).join('') : emptyTableRow(5, 'Belum ada log audit', 'Perubahan penting akan tercatat di sini.');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message || 'Gagal memuat log audit.')}</td></tr>`;
  }
}

function formatAuditTimestamp(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID');
}
