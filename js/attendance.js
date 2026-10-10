/* =========================================================
   SMARTABS — Absensi
   Guru : kelola status kehadiran per kelas
   Siswa: melakukan absensi harian
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'attendance') return;

  const role = document.body.dataset.role;

  if (role === 'guru') await initAbsensiGuru();
  else await initAbsensiSiswa();
});

/* =========================================================
   GURU
   ========================================================= */

let dataAbsensiGuru = [];
let dataSiswaGuru = [];

async function initAbsensiGuru() {
  const session = Session.get();
  const tbody = document.getElementById('attendanceTableBody');
  tbody.innerHTML = loadingRow(7);

  const teacher = await API.getTeacherByUsername(session.username);
  const classes = await API.getClasses();

  const classSelect = document.getElementById('attendanceClass');
  classSelect.innerHTML = classes
    .map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`)
    .join('');

  /* Default: kelas yang diampu guru */
  const defaultClass = teacher ? teacher.className : (classes[0] ? classes[0].name : '');
  if (defaultClass) classSelect.value = defaultClass;

  document.getElementById('attendanceDate').value = todayISO();

  await muatAbsensiGuru();

  classSelect.addEventListener('change', muatAbsensiGuru);
  document.getElementById('attendanceDate').addEventListener('change', muatAbsensiGuru);
  document.getElementById('searchAttendance').addEventListener('input', debounce(renderAbsensiGuru));

  document.getElementById('closeStatusModal').addEventListener('click', () => closeModal('statusModal'));
  document.getElementById('cancelStatusModal').addEventListener('click', () => closeModal('statusModal'));
  document.getElementById('statusForm').addEventListener('submit', simpanStatusKehadiran);
}

async function muatAbsensiGuru() {
  const className = document.getElementById('attendanceClass').value;
  const date = document.getElementById('attendanceDate').value || todayISO();

  const tbody = document.getElementById('attendanceTableBody');
  tbody.innerHTML = loadingRow(7);

  [dataSiswaGuru, dataAbsensiGuru] = await Promise.all([
    API.getStudents(),
    API.getAttendanceByDate(date, className)
  ]);

  dataSiswaGuru = dataSiswaGuru.filter((siswa) => siswa.className === className && siswa.status === 'Aktif');

  renderAbsensiGuru();
}

function renderAbsensiGuru() {
  const keyword = document.getElementById('searchAttendance').value.trim().toLowerCase();
  const tbody = document.getElementById('attendanceTableBody');

  const hasil = dataSiswaGuru.filter((siswa) =>
    !keyword || siswa.name.toLowerCase().includes(keyword) || siswa.nis.includes(keyword)
  );

  tbody.innerHTML = hasil.length
    ? hasil.map((siswa, index) => {
        const record = dataAbsensiGuru.find((row) => row.studentId === siswa.nis);
        const status = record ? record.status : 'Belum Absen';
        const waktu  = record && record.time ? record.time : '-';

        return `
          <tr>
            <td class="text-center">${index + 1}</td>
            <td class="text-muted">${escapeHtml(siswa.nis)}</td>
            <td class="cell-strong">${escapeHtml(siswa.name)}</td>
            <td>${escapeHtml(siswa.className)}</td>
            <td>${badge(status)}</td>
            <td>${escapeHtml(waktu)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-icon" data-action="status" data-nis="${siswa.nis}" title="Ubah Status">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('')
    : emptyTableRow(7, 'Tidak ada siswa', 'Kelas ini belum memiliki siswa aktif.');

  tbody.querySelectorAll('[data-action="status"]').forEach((button) =>
    button.addEventListener('click', () => openStatusForm(button.dataset.nis)));

  /* Ringkasan */
  const hitung = (status) => dataAbsensiGuru.filter((row) => row.status === status).length;
  const belum = dataSiswaGuru.length - dataAbsensiGuru.length;

  document.getElementById('attendanceSummary').innerHTML = `
    <span class="summary-item"><i class="fa-solid fa-users"></i> Total: <strong>${dataSiswaGuru.length}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Hadir: <strong>${hitung('Hadir')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-file-lines" style="color:#7c3aed"></i> Izin: <strong>${hitung('Izin')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-notes-medical" style="color:#d97706"></i> Sakit: <strong>${hitung('Sakit')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-user-xmark" style="color:#dc2626"></i> Alpa: <strong>${hitung('Alpa')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-hourglass-half"></i> Belum Absen: <strong>${Math.max(belum, 0)}</strong></span>`;
}

function openStatusForm(nis) {
  const siswa = dataSiswaGuru.find((item) => item.nis === nis);
  if (!siswa) return;

  const record = dataAbsensiGuru.find((row) => row.studentId === nis);

  document.getElementById('statusNis').value = nis;
  document.getElementById('statusStudentInfo').textContent =
    `${siswa.name} — ${siswa.nis} (${siswa.className})`;
  document.getElementById('statusValue').value = record ? record.status : 'Hadir';
  document.getElementById('statusNote').value = record ? (record.note || '') : '';

  openModal('statusModal');
}

async function simpanStatusKehadiran(event) {
  event.preventDefault();

  const nis = document.getElementById('statusNis').value;
  const siswa = dataSiswaGuru.find((item) => item.nis === nis);
  if (!siswa) return;

  const status = document.getElementById('statusValue').value;
  const note   = document.getElementById('statusNote').value.trim();
  const date   = document.getElementById('attendanceDate').value || todayISO();

  try {
    await API.saveAttendance({
      studentId: siswa.nis,
      name: siswa.name,
      className: siswa.className,
      date,
      time: status === 'Hadir' ? currentTime() : '-',
      status,
      note: note || 'Diinput oleh guru'
    });

    Toast.success(`Status ${siswa.name} berhasil diperbarui.`);
    closeModal('statusModal');
    await muatAbsensiGuru();

  } catch (error) {
    Toast.error('Gagal memperbarui status kehadiran.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initAbsensiSiswa() {
  const session = Session.get();
  const today = todayISO();

  const panel      = document.getElementById('attendancePanel');
  const infoBox    = document.getElementById('attendanceInfo');
  const statusBox  = document.getElementById('attendanceStatusBox');
  const iconBox    = document.getElementById('attendanceIcon');
  const title      = document.getElementById('attendanceTitle');
  const subtitle   = document.getElementById('attendanceSubtitle');
  const button     = document.getElementById('btnAbsen');

  infoBox.innerHTML = loadingBlock();

  const student = await API.getStudentByNis(session.nis);
  if (!student) {
    infoBox.innerHTML = '';
    statusBox.className = 'attendance-status warn';
    statusBox.textContent = 'Data siswa tidak ditemukan. Hubungi administrator.';
    statusBox.classList.remove('hidden');
    button.disabled = true;
    return;
  }

  const existing = await API.getAttendanceByStudentDate(student.nis, today);

  infoBox.innerHTML = `
    <div><span>Nama</span><strong>${escapeHtml(student.name)}</strong></div>
    <div><span>NIS</span><strong>${escapeHtml(student.nis)}</strong></div>
    <div><span>Kelas</span><strong>${escapeHtml(student.className)}</strong></div>
    <div><span>Tanggal</span><strong>${escapeHtml(formatDateLong(today))}</strong></div>
    <div><span>Jam Sekarang</span><strong>${escapeHtml(currentTime())}</strong></div>
    <div><span>Status</span><strong>${existing ? existing.status : 'Belum Absen'}</strong></div>`;

  if (existing) {
    iconBox.classList.add('success');
    iconBox.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    title.textContent = 'Absensi Sudah Tercatat';
    subtitle.textContent = 'Anda sudah melakukan absensi hari ini.';

    statusBox.className = 'attendance-status ok';
    statusBox.classList.remove('hidden');
    statusBox.innerHTML = `
      <i class="fa-solid fa-circle-check"></i>
      Absensi hari ini sudah tercatat${existing.time && existing.time !== '-' ? ` pada pukul <strong>${escapeHtml(existing.time)}</strong>` : ''}
      dengan status <strong>${escapeHtml(existing.status)}</strong>.`;

    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-check"></i> SUDAH ABSEN';
    return;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.innerHTML = '<span class="spinner spinner-sm"></span> Memproses...';

    try {
      /* Fast feedback only; the Firestore transaction is the authoritative duplicate guard. */
      const cek = await API.getAttendanceByStudentDate(student.nis, today);
      if (cek) {
        Toast.warning('Anda sudah melakukan absensi hari ini.');
        button.innerHTML = '<i class="fa-solid fa-check"></i> SUDAH ABSEN';
        return;
      }

      const record = await API.saveAttendance({
        studentId: student.nis,
        name: student.name,
        className: student.className,
        date: today,
        time: currentTime(),
        status: 'Hadir',
        note: 'Absensi mandiri melalui SMARTABS'
      });

      iconBox.classList.add('success');
      iconBox.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      title.textContent = 'Absensi Berhasil';
      subtitle.textContent = 'Kehadiran Anda telah tercatat pada sistem.';

      statusBox.className = 'attendance-status ok';
      statusBox.classList.remove('hidden');
      statusBox.innerHTML = `
        <i class="fa-solid fa-circle-check"></i>
        Absensi berhasil dicatat pada pukul <strong>${escapeHtml(record.time)}</strong>.`;

      button.innerHTML = '<i class="fa-solid fa-check"></i> SUDAH ABSEN';
      Toast.success('Absensi berhasil!', 'Kehadiran Anda tercatat.');

    } catch (error) {
      Toast.error(error.message || 'Absensi gagal. Silakan coba lagi.');
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-fingerprint"></i> ABSEN SEKARANG';
    }
  });
}