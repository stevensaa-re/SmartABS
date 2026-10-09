/* =========================================================
   SMARTABS — Data Siswa
   Admin : CRUD lengkap
   Guru  : hanya melihat + status kehadiran hari ini
   ========================================================= */

let daftarSiswa = [];
let daftarKelas = [];
let absensiHariIni = [];
let daftarAkunSiswa = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'students') return;

  const role = document.body.dataset.role;
  const tbody = document.getElementById('studentTableBody');

  tbody.innerHTML = loadingRow(role === 'admin' ? 6 : 5);

  [daftarSiswa, daftarKelas, absensiHariIni] = await Promise.all([
    API.getStudents(),
    API.getClasses(),
    API.getAttendanceByDate(todayISO())
  ]);

  isiFilterKelas();

  if (role === 'admin') {
    isiPilihanKelasForm();
    daftarAkunSiswa = (await API.getUsers()).filter((u) => u.role === 'siswa' && u.status === 'Aktif');
    document.getElementById('btnAddStudent').addEventListener('click', () => {
      if (!daftarKelas.length) {
        Toast.warning('Buat kelas terlebih dahulu di menu Data Kelas sebelum menambahkan siswa.');
        return;
      }
      openStudentForm();
    });
    document.getElementById('closeStudentModal').addEventListener('click', () => closeModal('studentModal'));
    document.getElementById('cancelStudentModal').addEventListener('click', () => closeModal('studentModal'));
    document.getElementById('studentForm').addEventListener('submit', simpanSiswa);
    document.getElementById('closeDetailModal').addEventListener('click', () => closeModal('detailModal'));
    document.getElementById('closeDetailBtn').addEventListener('click', () => closeModal('detailModal'));
    renderSiswaAdmin();
  } else {
    renderSiswaGuru();
  }

  document.getElementById('searchStudent').addEventListener('input', debounce(() => {
    role === 'admin' ? renderSiswaAdmin() : renderSiswaGuru();
  }));
  document.getElementById('filterClass').addEventListener('change', () => {
    role === 'admin' ? renderSiswaAdmin() : renderSiswaGuru();
  });

  const statusFilter = document.getElementById('filterStudentStatus');
  if (statusFilter) {
    statusFilter.addEventListener('change', renderSiswaAdmin);
  }
});

/* ---------- Filter kelas ---------- */

function isiFilterKelas() {
  const select = document.getElementById('filterClass');
  const namaKelas = [...new Set(daftarSiswa.map((s) => s.className))].sort();

  select.innerHTML = '<option value="">Semua Kelas</option>' +
    namaKelas.map((nama) => `<option value="${escapeHtml(nama)}">${escapeHtml(nama)}</option>`).join('');
}

function isiPilihanKelasForm() {
  const select = document.getElementById('studentClass');
  select.innerHTML = '<option value="">— Pilih kelas —</option>' + daftarKelas
    .map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`)
    .join('');
}

/* Akun siswa yang belum dipakai siswa lain (plus akun milik siswa yang sedang diedit) */
function isiPilihanAkun(nisSaatIni = null) {
  const dipakai = new Set(
    daftarSiswa.filter((s) => s.userId && s.nis !== nisSaatIni).map((s) => s.userId)
  );

  document.getElementById('studentUser').innerHTML =
    '<option value="">— Belum dihubungkan —</option>' +
    daftarAkunSiswa
      .filter((akun) => !dipakai.has(akun.id))
      .map((akun) => `<option value="${escapeHtml(akun.id)}">${escapeHtml(akun.name)} (${escapeHtml(akun.username)})</option>`)
      .join('');
}

/* ---------- Ambil data terfilter ---------- */

function ambilSiswaTerfilter() {
  const keyword = document.getElementById('searchStudent').value.trim().toLowerCase();
  const kelas   = document.getElementById('filterClass').value;
  const statusEl = document.getElementById('filterStudentStatus');
  const status  = statusEl ? statusEl.value : '';

  return daftarSiswa.filter((siswa) => {
    const cocokKeyword =
      !keyword ||
      siswa.name.toLowerCase().includes(keyword) ||
      siswa.nis.toLowerCase().includes(keyword);
    const cocokKelas = !kelas || siswa.className === kelas;
    const cocokStatus = !status || siswa.status === status;
    return cocokKeyword && cocokKelas && cocokStatus;
  });
}

/* =========================================================
   ADMIN
   ========================================================= */

function renderSiswaAdmin() {
  const hasil = ambilSiswaTerfilter();
  const tbody = document.getElementById('studentTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((siswa) => `
        <tr>
          <td class="text-muted">${escapeHtml(siswa.nis)}</td>
          <td class="cell-strong">${escapeHtml(siswa.name)}</td>
          <td>${escapeHtml(siswa.className)}</td>
          <td>${escapeHtml(siswa.gender)}</td>
          <td>${badge(siswa.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon" data-action="detail" data-nis="${siswa.nis}" title="Detail">
                <i class="fa-solid fa-eye"></i>
              </button>
              <button class="btn-icon" data-action="edit" data-nis="${siswa.nis}" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="delete" data-nis="${siswa.nis}" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(6, 'Siswa tidak ditemukan', 'Coba ubah kata kunci atau filter.');

  document.getElementById('studentCount').textContent = `${hasil.length} siswa ditampilkan`;

  tbody.querySelectorAll('[data-action="detail"]').forEach((button) =>
    button.addEventListener('click', () => tampilkanDetail(button.dataset.nis)));

  tbody.querySelectorAll('[data-action="edit"]').forEach((button) =>
    button.addEventListener('click', () => openStudentForm(button.dataset.nis)));

  tbody.querySelectorAll('[data-action="delete"]').forEach((button) =>
    button.addEventListener('click', () => hapusSiswa(button.dataset.nis)));
}

function openStudentForm(nis = null) {
  const form = document.getElementById('studentForm');
  form.reset();

  ['errStudentNis', 'errStudentName'].forEach((id) => {
    document.getElementById(id).textContent = '';
  });

  document.getElementById('studentMode').value = nis || '';
  document.getElementById('studentModalTitle').textContent = nis ? 'Edit Siswa' : 'Tambah Siswa';
  document.getElementById('studentNis').readOnly = !!nis;
  isiPilihanAkun(nis);

  if (nis) {
    const siswa = daftarSiswa.find((item) => item.nis === nis);
    if (siswa) {
      document.getElementById('studentNis').value = siswa.nis;
      document.getElementById('studentName').value = siswa.name;
      document.getElementById('studentClass').value = siswa.className;
      document.getElementById('studentGender').value = siswa.gender;
      document.getElementById('studentStatus').value = siswa.status;
      document.getElementById('studentPhone').value = siswa.phone || '';
      document.getElementById('studentUser').value = siswa.userId || '';
    }
  } else {
    document.getElementById('studentNis').readOnly = false;
    document.getElementById('studentStatus').value = 'Aktif';
  }

  openModal('studentModal');
}

async function simpanSiswa(event) {
  event.preventDefault();

  const nis      = document.getElementById('studentNis').value.trim();
  const name     = document.getElementById('studentName').value.trim();
  const className = document.getElementById('studentClass').value;
  const gender   = document.getElementById('studentGender').value;
  const status   = document.getElementById('studentStatus').value;
  const phone    = document.getElementById('studentPhone').value.trim();
  const userId   = document.getElementById('studentUser').value;
  const mode     = document.getElementById('studentMode').value;

  let valid = true;
  document.getElementById('errStudentNis').textContent = '';
  document.getElementById('errStudentName').textContent = '';

  if (!/^\d{4,}$/.test(nis)) {
    document.getElementById('errStudentNis').textContent = 'NIS harus berupa angka minimal 4 digit.';
    valid = false;
  }
  if (name.length < 3) {
    document.getElementById('errStudentName').textContent = 'Nama minimal 3 karakter.';
    valid = false;
  }
  if (!className || !daftarKelas.some((kelas) => kelas.name === className)) {
    Toast.warning(daftarKelas.length
      ? 'Pilih kelas yang valid sebelum menyimpan siswa.'
      : 'Belum ada data kelas. Tambahkan kelas terlebih dahulu di menu Data Kelas.');
    valid = false;
  }
  if (!valid) return;

  const button = document.getElementById('saveStudentBtn');
  button.disabled = true;
  button.textContent = 'Menyimpan...';

  try {
    const payload = { nis, name, className, gender, status, phone, userId };

    if (mode) {
      await API.updateStudent(mode, payload);
      Toast.success('Data siswa berhasil diperbarui.');
    } else {
      await API.createStudent(payload);
      Toast.success('Siswa baru berhasil ditambahkan.');
    }

    daftarSiswa = await API.getStudents();
    renderSiswaAdmin();
    closeModal('studentModal');

  } catch (error) {
    Toast.error(error.message || 'Gagal menyimpan data siswa.');
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan';
  }
}

async function hapusSiswa(nis) {
  const siswa = daftarSiswa.find((item) => item.nis === nis);
  if (!siswa) return;

  const confirmed = await confirmDialog({
    title: 'Hapus Data Siswa?',
    message: `Data siswa "${siswa.name}" (${siswa.nis}) akan dihapus permanen.`,
    confirmText: 'Ya, Hapus',
    danger: true
  });

  if (!confirmed) return;

  try {
    await API.deleteStudent(nis);
    daftarSiswa = await API.getStudents();
    renderSiswaAdmin();
    Toast.success('Data siswa berhasil dihapus.');
  } catch (error) {
    Toast.error('Gagal menghapus data siswa.');
  }
}

async function tampilkanDetail(nis) {
  const siswa = daftarSiswa.find((item) => item.nis === nis);
  if (!siswa) return;

  const body = document.getElementById('detailBody');
  body.innerHTML = loadingBlock('Memuat detail...');
  openModal('detailModal');

  const riwayat = await API.getAttendanceByStudent(nis);

  const hadir = riwayat.filter((r) => r.status === 'Hadir').length;
  const izin  = riwayat.filter((r) => r.status === 'Izin').length;
  const sakit = riwayat.filter((r) => r.status === 'Sakit').length;
  const alpa  = riwayat.filter((r) => r.status === 'Alpa').length;
  const total = riwayat.length;
  const persen = total ? Math.round((hadir / total) * 100) : 0;

  body.innerHTML = `
    <div class="form-group">
      <label>Nama Lengkap</label>
      <div class="modal-info">${escapeHtml(siswa.name)}</div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>NIS</label>
        <div class="modal-info">${escapeHtml(siswa.nis)}</div>
      </div>
      <div class="form-group">
        <label>Kelas</label>
        <div class="modal-info">${escapeHtml(siswa.className)}</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Jenis Kelamin</label>
        <div class="modal-info">${siswa.gender === 'L' ? 'Laki-laki' : 'Perempuan'}</div>
      </div>
      <div class="form-group">
        <label>Status</label>
        <div class="modal-info">${badge(siswa.status)}</div>
      </div>
    </div>
    <div class="form-group">
      <label>No. HP Wali</label>
      <div class="modal-info">${escapeHtml(siswa.phone || '-')}</div>
    </div>
    <div class="form-group">
      <label>Ringkasan Kehadiran (${total} hari)</label>
      <div class="modal-info">
        Hadir: <strong>${hadir}</strong> &nbsp;|&nbsp;
        Izin: <strong>${izin}</strong> &nbsp;|&nbsp;
        Sakit: <strong>${sakit}</strong> &nbsp;|&nbsp;
        Alpa: <strong>${alpa}</strong> &nbsp;|&nbsp;
        Persentase: <strong>${persen}%</strong>
      </div>
    </div>`;
}

/* =========================================================
   GURU (read-only)
   ========================================================= */

function renderSiswaGuru() {
  const hasil = ambilSiswaTerfilter();
  const tbody = document.getElementById('studentTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((siswa) => {
        const record = absensiHariIni.find((row) => row.studentId === siswa.nis);
        const status = record ? record.status : 'Belum Absen';

        return `
          <tr>
            <td class="text-muted">${escapeHtml(siswa.nis)}</td>
            <td class="cell-strong">${escapeHtml(siswa.name)}</td>
            <td>${escapeHtml(siswa.className)}</td>
            <td>${escapeHtml(siswa.gender)}</td>
            <td>${badge(status)}</td>
          </tr>`;
      }).join('')
    : emptyTableRow(5, 'Siswa tidak ditemukan', 'Coba ubah kata kunci atau filter.');

  document.getElementById('studentCount').textContent = `${hasil.length} siswa ditampilkan`;
}