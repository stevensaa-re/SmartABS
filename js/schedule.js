/* =========================================================
   SMARTABS — Jadwal Pelajaran
   Admin : CRUD + filter
   Siswa : hanya melihat jadwal kelasnya
   ========================================================= */

const HARI_SEKOLAH = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

let daftarJadwal = [];

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (page !== 'schedule') return;

  const role = document.body.dataset.role;

  if (role === 'admin') await initJadwalAdmin();
  else await initJadwalSiswa();
});

/* =========================================================
   ADMIN
   ========================================================= */

async function initJadwalAdmin() {
  const tbody = document.getElementById('scheduleTableBody');
  tbody.innerHTML = loadingRow(6);

  const [schedules, classes] = await Promise.all([
    API.getSchedules(),
    API.getClasses()
  ]);

  daftarJadwal = schedules;

  /* Filter hari */
  document.getElementById('filterScheduleDay').innerHTML =
    '<option value="">Semua Hari</option>' +
    HARI_SEKOLAH.map((hari) => `<option value="${hari}">${hari}</option>`).join('');

  /* Filter kelas */
  document.getElementById('filterScheduleClass').innerHTML =
    '<option value="">Semua Kelas</option>' +
    classes.map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`).join('');

  /* Pilihan pada form */
  document.getElementById('scheduleDay').innerHTML =
    HARI_SEKOLAH.map((hari) => `<option value="${hari}">${hari}</option>`).join('');

  document.getElementById('scheduleClass').innerHTML =
    classes.map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`).join('');

  renderJadwalAdmin();

  document.getElementById('searchSchedule').addEventListener('input', debounce(renderJadwalAdmin));
  document.getElementById('filterScheduleDay').addEventListener('change', renderJadwalAdmin);
  document.getElementById('filterScheduleClass').addEventListener('change', renderJadwalAdmin);

  document.getElementById('btnAddSchedule').addEventListener('click', () => openScheduleForm());
  document.getElementById('closeScheduleModal').addEventListener('click', () => closeModal('scheduleModal'));
  document.getElementById('cancelScheduleModal').addEventListener('click', () => closeModal('scheduleModal'));
  document.getElementById('scheduleForm').addEventListener('submit', simpanJadwal);
}

function renderJadwalAdmin() {
  const keyword = document.getElementById('searchSchedule').value.trim().toLowerCase();
  const hari    = document.getElementById('filterScheduleDay').value;
  const kelas   = document.getElementById('filterScheduleClass').value;

  const hasil = daftarJadwal.filter((jadwal) => {
    const cocokKeyword =
      !keyword ||
      jadwal.subject.toLowerCase().includes(keyword) ||
      jadwal.teacher.toLowerCase().includes(keyword);
    const cocokHari = !hari || jadwal.day === hari;
    const cocokKelas = !kelas || jadwal.className === kelas;
    return cocokKeyword && cocokHari && cocokKelas;
  });

  const urut = [...hasil].sort((a, b) => {
    const selisihHari = HARI_SEKOLAH.indexOf(a.day) - HARI_SEKOLAH.indexOf(b.day);
    return selisihHari !== 0 ? selisihHari : (a.start > b.start ? 1 : -1);
  });

  const tbody = document.getElementById('scheduleTableBody');

  tbody.innerHTML = urut.length
    ? urut.map((jadwal) => `
        <tr>
          <td class="cell-strong">${escapeHtml(jadwal.day)}</td>
          <td>${escapeHtml(jadwal.start)} - ${escapeHtml(jadwal.end)}</td>
          <td>${escapeHtml(jadwal.subject)}</td>
          <td>${escapeHtml(jadwal.teacher)}</td>
          <td>${escapeHtml(jadwal.className)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon" data-action="edit" data-id="${jadwal.id}" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="delete" data-id="${jadwal.id}" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(6, 'Jadwal tidak ditemukan', 'Coba ubah filter atau tambahkan jadwal baru.');

  document.getElementById('scheduleCount').textContent = `${urut.length} jadwal ditampilkan`;

  tbody.querySelectorAll('[data-action="edit"]').forEach((button) =>
    button.addEventListener('click', () => openScheduleForm(button.dataset.id)));

  tbody.querySelectorAll('[data-action="delete"]').forEach((button) =>
    button.addEventListener('click', () => hapusJadwal(button.dataset.id)));
}

function openScheduleForm(id = null) {
  const form = document.getElementById('scheduleForm');
  form.reset();

  document.getElementById('errScheduleSubject').textContent = '';
  document.getElementById('errScheduleTeacher').textContent = '';

  document.getElementById('scheduleId').value = id || '';
  document.getElementById('scheduleModalTitle').textContent = id ? 'Edit Jadwal' : 'Tambah Jadwal';

  if (id) {
    const jadwal = daftarJadwal.find((item) => item.id === id);
    if (jadwal) {
      document.getElementById('scheduleDay').value = jadwal.day;
      document.getElementById('scheduleClass').value = jadwal.className;
      document.getElementById('scheduleStart').value = jadwal.start;
      document.getElementById('scheduleEnd').value = jadwal.end;
      document.getElementById('scheduleSubject').value = jadwal.subject;
      document.getElementById('scheduleTeacher').value = jadwal.teacher;
    }
  }

  openModal('scheduleModal');
}

async function simpanJadwal(event) {
  event.preventDefault();

  const id      = document.getElementById('scheduleId').value;
  const day     = document.getElementById('scheduleDay').value;
  const className = document.getElementById('scheduleClass').value;
  const start   = document.getElementById('scheduleStart').value;
  const end     = document.getElementById('scheduleEnd').value;
  const subject = document.getElementById('scheduleSubject').value.trim();
  const teacher = document.getElementById('scheduleTeacher').value.trim();

  let valid = true;
  document.getElementById('errScheduleSubject').textContent = '';
  document.getElementById('errScheduleTeacher').textContent = '';

  if (subject.length < 3) {
    document.getElementById('errScheduleSubject').textContent = 'Nama mata pelajaran minimal 3 karakter.';
    valid = false;
  }
  if (teacher.length < 3) {
    document.getElementById('errScheduleTeacher').textContent = 'Nama guru minimal 3 karakter.';
    valid = false;
  }
  if (!start || !end) {
    Toast.warning('Jam mulai dan jam selesai wajib diisi.');
    valid = false;
  }
  if (!valid) return;

  try {
    const payload = { day, className, start, end, subject, teacher };

    if (id) {
      await API.updateSchedule(id, payload);
      Toast.success('Jadwal berhasil diperbarui.');
    } else {
      await API.createSchedule(payload);
      Toast.success('Jadwal baru berhasil ditambahkan.');
    }

    daftarJadwal = await API.getSchedules();
    renderJadwalAdmin();
    closeModal('scheduleModal');

  } catch (error) {
    Toast.error('Gagal menyimpan jadwal.');
  }
}

async function hapusJadwal(id) {
  const confirmed = await confirmDialog({
    title: 'Hapus Jadwal?',
    message: 'Jadwal mata pelajaran ini akan dihapus permanen.',
    confirmText: 'Ya, Hapus',
    danger: true
  });

  if (!confirmed) return;

  try {
    await API.deleteSchedule(id);
    daftarJadwal = await API.getSchedules();
    renderJadwalAdmin();
    Toast.success('Jadwal berhasil dihapus.');
  } catch (error) {
    Toast.error('Gagal menghapus jadwal.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initJadwalSiswa() {
  const session = Session.get();
  const tbody = document.getElementById('scheduleTableBody');
  const dayFilter = document.getElementById('dayFilter');

  tbody.innerHTML = loadingRow(4);

  const student = await API.getStudentByNis(session.nis);
  const className = student ? student.className : session.className;

  document.getElementById('scheduleSubtitle').textContent =
    `Jadwal pelajaran kelas ${className || '-'}.`;

  const semua = await API.getSchedules();
  daftarJadwal = semua.filter((jadwal) => jadwal.className === className);

  let hariAktif = currentDayName();

  dayFilter.innerHTML = ['Semua', ...HARI_SEKOLAH]
    .map((hari) => `<button class="chip ${hari === hariAktif ? 'active' : ''}" data-day="${hari}">${hari}</button>`)
    .join('');

  function render() {
    const hasil = daftarJadwal
      .filter((jadwal) => hariAktif === 'Semua' || jadwal.day === hariAktif)
      .sort((a, b) => {
        const selisihHari = HARI_SEKOLAH.indexOf(a.day) - HARI_SEKOLAH.indexOf(b.day);
        return selisihHari !== 0 ? selisihHari : (a.start > b.start ? 1 : -1);
      });

    tbody.innerHTML = hasil.length
      ? hasil.map((jadwal) => `
          <tr>
            <td class="cell-strong">${escapeHtml(jadwal.day)}</td>
            <td>${escapeHtml(jadwal.start)} - ${escapeHtml(jadwal.end)}</td>
            <td>${escapeHtml(jadwal.subject)}</td>
            <td>${escapeHtml(jadwal.teacher)}</td>
          </tr>`).join('')
      : emptyTableRow(4, 'Tidak ada jadwal', 'Belum ada jadwal untuk hari yang dipilih.');
  }

  dayFilter.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      hariAktif = chip.dataset.day;
      dayFilter.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      render();
    });
  });

  render();
}