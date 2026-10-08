/* =========================================================
   SMARTABS — Izin / Sakit / Alpa
   Guru  : verifikasi pengajuan siswa
   Siswa : mengajukan izin / sakit dan memantau statusnya
   ========================================================= */

let daftarPengajuan = [];
let siswaPengaju = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'permissions') return;

  if (document.body.dataset.role === 'siswa') await initPengajuanSiswa();
  else await initPengajuanGuru();
});

/* =========================================================
   GURU
   ========================================================= */

async function initPengajuanGuru() {
  const tbody = document.getElementById('permissionTableBody');
  tbody.innerHTML = loadingRow(7);

  daftarPengajuan = await API.getPermissions();
  renderPengajuan();

  document.getElementById('searchPermission').addEventListener('input', debounce(renderPengajuan));
  document.getElementById('filterPermissionType').addEventListener('change', renderPengajuan);
  document.getElementById('filterPermissionStatus').addEventListener('change', renderPengajuan);
}

function renderPengajuan() {
  const keyword = document.getElementById('searchPermission').value.trim().toLowerCase();
  const jenis   = document.getElementById('filterPermissionType').value;
  const status  = document.getElementById('filterPermissionStatus').value;

  const hasil = daftarPengajuan.filter((item) => {
    const cocokKeyword = !keyword || item.name.toLowerCase().includes(keyword);
    const cocokJenis = !jenis || item.type === jenis;
    const cocokStatus = !status || item.status === status;
    return cocokKeyword && cocokJenis && cocokStatus;
  });

  const tbody = document.getElementById('permissionTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((item) => `
        <tr>
          <td class="cell-strong">${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.className)}</td>
          <td>${escapeHtml(formatDate(item.date))}</td>
          <td>${badge(item.type)}</td>
          <td class="text-muted">${escapeHtml(item.note || '-')}</td>
          <td>${badge(item.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon success" data-action="approve" data-id="${escapeHtml(item.id)}" title="Setujui"
                ${item.status === 'Disetujui' ? 'disabled' : ''}>
                <i class="fa-solid fa-check"></i>
              </button>
              <button class="btn-icon danger" data-action="reject" data-id="${escapeHtml(item.id)}" title="Tolak"
                ${item.status === 'Ditolak' ? 'disabled' : ''}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(7, 'Tidak ada pengajuan', 'Belum ada pengajuan pada filter yang dipilih.');

  tbody.querySelectorAll('[data-action="approve"]').forEach((button) =>
    button.addEventListener('click', () => ubahStatus(button.dataset.id, 'Disetujui')));

  tbody.querySelectorAll('[data-action="reject"]').forEach((button) =>
    button.addEventListener('click', () => ubahStatus(button.dataset.id, 'Ditolak')));
}

async function ubahStatus(id, statusBaru) {
  const item = daftarPengajuan.find((p) => p.id === id);
  if (!item) return;

  const setuju = statusBaru === 'Disetujui';

  const confirmed = await confirmDialog({
    title: setuju ? 'Setujui Pengajuan?' : 'Tolak Pengajuan?',
    message: setuju
      ? `Pengajuan ${item.type} dari ${item.name} disetujui dan dicatat sebagai "${item.type}" pada absensi.`
      : `Pengajuan ${item.type} dari ${item.name} ditolak dan hari tersebut dicatat sebagai "Alpa" (kecuali siswa sudah absen Hadir).`,
    confirmText: setuju ? 'Ya, Setujui' : 'Ya, Tolak',
    danger: !setuju
  });

  if (!confirmed) return;

  try {
    /* Update status + sinkronisasi absensi dilakukan satu kali oleh API */
    await API.reviewPermission(id, statusBaru);

    daftarPengajuan = await API.getPermissions();
    renderPengajuan();
    Toast.success(`Pengajuan berhasil ${setuju ? 'disetujui' : 'ditolak'}.`);

  } catch (error) {
    Toast.error(error.message || 'Gagal memperbarui status pengajuan.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initPengajuanSiswa() {
  const session = Session.get();
  const tbody = document.getElementById('myPermissionTableBody');
  const button = document.getElementById('btnAddPermission');

  tbody.innerHTML = loadingRow(5);

  siswaPengaju = session.nis ? await API.getStudentByNis(session.nis) : null;

  if (!siswaPengaju) {
    tbody.innerHTML = emptyTableRow(5, 'Data siswa tidak ditemukan', 'Akun Anda belum dihubungkan dengan data siswa. Hubungi administrator.');
    button.disabled = true;
    return;
  }

  await muatPengajuanSiswa();

  button.addEventListener('click', openPermissionForm);
  document.getElementById('closePermissionModal').addEventListener('click', () => closeModal('permissionModal'));
  document.getElementById('cancelPermissionModal').addEventListener('click', () => closeModal('permissionModal'));
  document.getElementById('permissionForm').addEventListener('submit', kirimPengajuan);
  document.getElementById('filterMyPermissionStatus').addEventListener('change', renderPengajuanSiswa);
}

async function muatPengajuanSiswa() {
  daftarPengajuan = await API.getPermissionsByStudent(siswaPengaju.nis);
  renderPengajuanSiswa();
}

function renderPengajuanSiswa() {
  const status = document.getElementById('filterMyPermissionStatus').value;
  const hasil = daftarPengajuan.filter((item) => !status || item.status === status);

  document.getElementById('myPermissionTableBody').innerHTML = hasil.length
    ? hasil.map((item) => `
        <tr>
          <td class="cell-strong">${escapeHtml(formatDate(item.date))}</td>
          <td>${badge(item.type)}</td>
          <td class="text-muted">${escapeHtml(item.note || '-')}</td>
          <td>${badge(item.status)}</td>
        </tr>`).join('')
    : emptyTableRow(4, 'Belum ada pengajuan', 'Klik "Ajukan Izin" untuk membuat pengajuan baru.');

  document.getElementById('myPermissionCount').textContent = `${hasil.length} pengajuan`;
}

function openPermissionForm() {
  document.getElementById('permissionForm').reset();
  document.getElementById('errPermissionDate').textContent = '';
  document.getElementById('errPermissionNote').textContent = '';

  const dateInput = document.getElementById('permissionDate');
  dateInput.min = shiftDate(-7);
  dateInput.max = shiftDate(30);
  dateInput.value = todayISO();

  openModal('permissionModal');
}

async function kirimPengajuan(event) {
  event.preventDefault();

  const date = document.getElementById('permissionDate').value;
  const type = document.getElementById('permissionType').value;
  const note = document.getElementById('permissionNote').value.trim();

  let valid = true;
  document.getElementById('errPermissionDate').textContent = '';
  document.getElementById('errPermissionNote').textContent = '';

  if (!date || date < shiftDate(-7) || date > shiftDate(30)) {
    document.getElementById('errPermissionDate').textContent = 'Tanggal harus antara 7 hari lalu s.d. 30 hari ke depan.';
    valid = false;
  }
  if (note.length < 5) {
    document.getElementById('errPermissionNote').textContent = 'Keterangan minimal 5 karakter.';
    valid = false;
  }
  if (!valid) return;

  const button = document.getElementById('savePermissionBtn');
  button.disabled = true;
  button.textContent = 'Mengirim...';

  try {
    await API.createPermission({ studentId: siswaPengaju.nis, date, type, note });
    closeModal('permissionModal');
    await muatPengajuanSiswa();
    Toast.success('Pengajuan berhasil dikirim. Menunggu verifikasi guru.');
  } catch (error) {
    Toast.error(error.message || 'Gagal mengirim pengajuan.');
  } finally {
    button.disabled = false;
    button.textContent = 'Kirim Pengajuan';
  }
}
