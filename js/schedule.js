/* =========================================================
   SMARTABS — Jadwal Pelajaran
   Admin : CRUD + filter
   Guru  : jadwal mengajar pribadi
   Siswa : hanya melihat jadwal kelasnya
   ========================================================= */

const HARI_SEKOLAH = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

let daftarJadwal = [];
let kelasBerdasarkanNama = new Map();

function labelKelasDanBlok(className) {
  const block = kelasBerdasarkanNama.get(className)?.block;
  return block ? `${className} · ${block}` : className;
}

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;
  if (page !== 'schedule') return;

  const role = document.body.dataset.role;

  if (role === 'admin') await initJadwalAdmin();
  else if (role === 'guru') await initJadwalGuru();
  else await initJadwalSiswa();
});

function urutJadwal(a, b) {
  const selisihHari = HARI_SEKOLAH.indexOf(a.day) - HARI_SEKOLAH.indexOf(b.day);
  return selisihHari || a.start.localeCompare(b.start);
}

function barisHari(hari, jumlah, kolom) {
  return `<tr class="schedule-day-heading">
    <td colspan="${kolom}">
      <span>${escapeHtml(hari)}</span>
      <span class="schedule-day-count">${jumlah} pelajaran</span>
    </td>
  </tr>`;
}

/* =========================================================
   ADMIN
   ========================================================= */

async function initJadwalAdmin() {
  const tbody = document.getElementById('scheduleTableBody');
  tbody.innerHTML = loadingRow(6);

  const [schedules, classes] = await Promise.all([API.getSchedules(), API.getClasses()]);
  kelasBerdasarkanNama = new Map(classes.map((kelas) => [kelas.name, kelas]));

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
    String(jadwal.subject || '').toLowerCase().includes(keyword) ||
    String(jadwal.teacher || '').toLowerCase().includes(keyword);
    const cocokHari = !hari || jadwal.day === hari;
    const cocokKelas = !kelas || jadwal.className === kelas;
    return cocokKeyword && cocokHari && cocokKelas;
  });

  const urut = [...hasil].sort(urutJadwal);

  const tbody = document.getElementById('scheduleTableBody');

  tbody.innerHTML = urut.length
    ? HARI_SEKOLAH.filter((hari) => !document.getElementById('filterScheduleDay').value ||
        document.getElementById('filterScheduleDay').value === hari)
      .map((hari) => {
        const jadwalHari = urut.filter((jadwal) => jadwal.day === hari);
        if (!jadwalHari.length) return '';
        return barisHari(hari, jadwalHari.length, 6) + jadwalHari.map((jadwal) => `
          <tr>
            <td class="cell-strong">${escapeHtml(jadwal.start)} - ${escapeHtml(jadwal.end)}</td>
            <td>${escapeHtml(jadwal.subject)}</td>
            <td>${escapeHtml(jadwal.teacher)}</td>
            <td>${escapeHtml(labelKelasDanBlok(jadwal.className))}</td>
            <td colspan="2">
              <div class="action-btns">
                <button class="btn-icon" data-action="edit" data-id="${escapeHtml(jadwal.id)}" title="Edit jadwal ${escapeHtml(jadwal.subject)}" aria-label="Edit jadwal ${escapeHtml(jadwal.subject)}">
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-icon danger" data-action="delete" data-id="${escapeHtml(jadwal.id)}" title="Hapus jadwal ${escapeHtml(jadwal.subject)}" aria-label="Hapus jadwal ${escapeHtml(jadwal.subject)}">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>`).join('');
      }).join('')
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
  } else if (end <= start) {
    Toast.warning('Jam selesai harus setelah jam mulai.');
    valid = false;
  }
  if (!valid) return;

  const bentrok = daftarJadwal.find((jadwal) => {
    if (jadwal.id === id || jadwal.day !== day) return false;
    const waktuBertabrakan = start < jadwal.end && end > jadwal.start;
    const kelasSama = jadwal.className === className;
    const guruSama = jadwal.teacher.trim().toLocaleLowerCase() === teacher.toLocaleLowerCase();
    return waktuBertabrakan && (kelasSama || guruSama);
  });
  if (bentrok) {
    const alasan = bentrok.className === className
      ? `Kelas ${className} sudah memiliki ${bentrok.subject}`
      : `${teacher} sudah mengajar ${bentrok.subject} di kelas ${bentrok.className}`;
    Toast.warning(`${alasan} pada ${day}, ${bentrok.start}–${bentrok.end}.`);
    return;
  }

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
    Toast.error(error.message || 'Gagal menyimpan jadwal.');
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
    Toast.error(error.message || 'Gagal menghapus jadwal.');
  }
}

async function initJadwalGuru() {
  const session = Session.get();
  const tbody = document.getElementById('scheduleTableBody');
  const dayFilter = document.getElementById('dayFilter');
  tbody.innerHTML = loadingRow(4);

  try {
    const [teacher, schedules, classes] = await Promise.all([
      API.getTeacherByUsername(session.username),
      API.getSchedules(),
      API.getClasses()
    ]);
    kelasBerdasarkanNama = new Map(classes.map((kelas) => [kelas.name, kelas]));
    if (!teacher || teacher.status === 'Nonaktif') {
      tbody.innerHTML = emptyTableRow(4, 'Profil guru belum tersedia', 'Hubungi admin untuk menautkan akun ke data guru.');
      return;
    }

    document.getElementById('scheduleSubtitle').textContent =
      `Jadwal mengajar ${teacher.name}${teacher.className ? ` · ${teacher.className}` : ''}.`;
    daftarJadwal = schedules.filter((jadwal) =>
      String(jadwal.teacher || '').trim().toLocaleLowerCase() === teacher.name.trim().toLocaleLowerCase()
    );
    setupJadwalHarian(dayFilter, () => {
      const rows = renderJadwalHarian(daftarJadwal, dayFilter.value, true);
      tbody.innerHTML = rows || emptyTableRow(4, 'Tidak ada jadwal', 'Jadwal mengajar Anda belum tersedia untuk hari yang dipilih.');
    });
  } catch (error) {
    tbody.innerHTML = emptyTableRow(4, 'Jadwal gagal dimuat', escapeHtml(error.message || 'Periksa koneksi lalu coba lagi.'));
    Toast.error(error.message || 'Jadwal guru gagal dimuat.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initJadwalSiswa() {
  const session = Session.get();
  const tbody = document.getElementById('scheduleTableBody');
  const dayFilter = document.getElementById('dayFilter');

  tbody.innerHTML = loadingRow(3);

  const [student, classes] = await Promise.all([
    API.getStudentByNis(session.nis),
    API.getClasses()
  ]);
  kelasBerdasarkanNama = new Map(classes.map((kelas) => [kelas.name, kelas]));
  const className = student ? student.className : session.className;

  document.getElementById('scheduleSubtitle').textContent =
    `Jadwal pelajaran kelas ${labelKelasDanBlok(className || '-')}.`;

  const semua = await API.getSchedules();
  daftarJadwal = semua.filter((jadwal) => jadwal.className === className);

  setupJadwalHarian(dayFilter, () => {
    const rows = renderJadwalHarian(daftarJadwal, dayFilter.value);
    tbody.innerHTML = rows || emptyTableRow(3, 'Tidak ada jadwal', 'Belum ada jadwal untuk hari yang dipilih.');
  });
}

function setupJadwalHarian(dayFilter, render) {
  const today = currentDayName();
  const defaultDay = HARI_SEKOLAH.includes(today) ? today : 'Semua';
  dayFilter.classList.add('schedule-day-filter');
  dayFilter.innerHTML = ['Semua', ...HARI_SEKOLAH]
    .map((hari) => `<button type="button" class="chip ${hari === defaultDay ? 'active' : ''}" data-day="${hari}" aria-pressed="${hari === defaultDay}">
      ${hari === today ? 'Hari ini · ' : ''}${hari}
    </button>`)
    .join('');
  dayFilter.value = defaultDay;
  dayFilter.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      dayFilter.value = chip.dataset.day;
      dayFilter.querySelectorAll('.chip').forEach((item) => {
        const active = item === chip;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      render();
    });
  });
  render();
}

function renderJadwalHarian(schedules, activeDay, teacherView = false) {
  const hasil = schedules
    .filter((jadwal) => activeDay === 'Semua' || jadwal.day === activeDay)
    .sort(urutJadwal);
  if (!hasil.length) return '';

  return HARI_SEKOLAH
    .filter((hari) => activeDay === 'Semua' || hari === activeDay)
    .map((hari) => {
      const jadwalHari = hasil.filter((jadwal) => jadwal.day === hari);
      if (!jadwalHari.length) return '';
      return barisHari(hari, jadwalHari.length, teacherView ? 4 : 3) + jadwalHari.map((jadwal) => `
        <tr>
          <td class="cell-strong schedule-time">${escapeHtml(jadwal.start)} – ${escapeHtml(jadwal.end)}</td>
          <td class="cell-strong">${escapeHtml(jadwal.subject)}</td>
          <td>${escapeHtml(teacherView ? labelKelasDanBlok(jadwal.className) : jadwal.teacher)}</td>
          ${teacherView ? `<td><a class="btn btn-outline schedule-attendance-link" href="attendance.html?scheduleId=${encodeURIComponent(jadwal.id)}">
            <i class="fa-solid fa-clipboard-check"></i> Buka absensi
          </a></td>` : ''}
        </tr>`).join('');
    }).join('');
}