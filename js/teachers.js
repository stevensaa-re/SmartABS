/* =========================================================
   SMARTABS — Admin: Data Guru
   Menghubungkan akun (role Guru) dengan mata pelajaran dan
   kelas yang diampu. Kelas inilah yang menjadi default pada
   halaman absensi & laporan guru.
   ========================================================= */

let daftarGuru = [];
let daftarAkunGuru = [];
let daftarKelasGuru = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'teachers') return;

  const tbody = document.getElementById('teacherTableBody');
  tbody.innerHTML = loadingRow(6);

  const [teachers, users, classes] = await Promise.all([
    API.getTeachers(),
    API.getUsers(),
    API.getClasses()
  ]);

  daftarGuru = teachers;
  daftarAkunGuru = users.filter((u) => u.role === 'guru');
  daftarKelasGuru = classes;

  document.getElementById('teacherClass').innerHTML =
    '<option value="">— Tidak ada —</option>' +
    classes.map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`).join('');

  renderGuru();

  document.getElementById('searchTeacher').addEventListener('input', debounce(renderGuru));
  document.getElementById('filterTeacherStatus').addEventListener('change', renderGuru);
  document.getElementById('btnAddTeacher').addEventListener('click', () => openTeacherForm());
  document.getElementById('closeTeacherModal').addEventListener('click', () => closeModal('teacherModal'));
  document.getElementById('cancelTeacherModal').addEventListener('click', () => closeModal('teacherModal'));
  document.getElementById('teacherForm').addEventListener('submit', simpanGuru);

  /* Pilih akun -> nama otomatis terisi */
  document.getElementById('teacherUsername').addEventListener('change', (event) => {
    const akun = daftarAkunGuru.find((u) => u.username === event.target.value);
    const nameInput = document.getElementById('teacherName');
    if (akun && !nameInput.value.trim()) nameInput.value = akun.name;
  });
});

function renderGuru() {
  const keyword = document.getElementById('searchTeacher').value.trim().toLowerCase();
  const status = document.getElementById('filterTeacherStatus').value;

  const hasil = daftarGuru.filter((guru) => {
    const cocokKeyword = !keyword ||
      guru.name.toLowerCase().includes(keyword) ||
      String(guru.subject || '').toLowerCase().includes(keyword);
    return cocokKeyword && (!status || guru.status === status);
  });

  const tbody = document.getElementById('teacherTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((guru) => `
        <tr>
          <td class="cell-strong">${escapeHtml(guru.name)}</td>
          <td>${escapeHtml(guru.username)}</td>
          <td>${escapeHtml(guru.subject || '-')}</td>
          <td>${escapeHtml(guru.className || '-')}</td>
          <td>${badge(guru.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon" data-action="edit" data-id="${escapeHtml(guru.id)}" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="delete" data-id="${escapeHtml(guru.id)}" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(6, 'Guru tidak ditemukan', 'Klik "Tambah Guru" untuk mendaftarkan guru.');

  document.getElementById('teacherCount').textContent = `${hasil.length} guru ditampilkan`;

  tbody.querySelectorAll('[data-action="edit"]').forEach((button) =>
    button.addEventListener('click', () => openTeacherForm(button.dataset.id)));

  tbody.querySelectorAll('[data-action="delete"]').forEach((button) =>
    button.addEventListener('click', () => hapusGuru(button.dataset.id)));
}

function openTeacherForm(id = null) {
  document.getElementById('teacherForm').reset();
  ['errTeacherUsername', 'errTeacherName'].forEach((el) => { document.getElementById(el).textContent = ''; });

  document.getElementById('teacherId').value = id || '';
  document.getElementById('teacherModalTitle').textContent = id ? 'Edit Guru' : 'Tambah Guru';

  const guru = id ? daftarGuru.find((item) => item.id === id) : null;

  /* Akun yang belum terdaftar sebagai guru (+ akun milik guru yang sedang diedit) */
  const dipakai = new Set(daftarGuru.filter((g) => !guru || g.id !== guru.id).map((g) => g.username));
  const tersedia = daftarAkunGuru.filter((akun) => !dipakai.has(akun.username));

  const select = document.getElementById('teacherUsername');
  select.innerHTML = tersedia.length
    ? tersedia.map((akun) => `<option value="${escapeHtml(akun.username)}">${escapeHtml(akun.name)} (${escapeHtml(akun.username)})</option>`).join('')
    : '<option value="">Tidak ada akun Guru yang tersedia</option>';

  if (guru) {
    select.value = guru.username;
    document.getElementById('teacherName').value = guru.name;
    document.getElementById('teacherSubject').value = guru.subject || '';
    document.getElementById('teacherClass').value = guru.className || '';
    document.getElementById('teacherStatus').value = guru.status;
  } else if (tersedia.length) {
    document.getElementById('teacherName').value = tersedia[0].name;
  }

  openModal('teacherModal');
}

async function simpanGuru(event) {
  event.preventDefault();

  const id        = document.getElementById('teacherId').value;
  const username  = document.getElementById('teacherUsername').value;
  const name      = document.getElementById('teacherName').value.trim();
  const subject   = document.getElementById('teacherSubject').value.trim();
  const className = document.getElementById('teacherClass').value;
  const status    = document.getElementById('teacherStatus').value;

  let valid = true;
  document.getElementById('errTeacherUsername').textContent = '';
  document.getElementById('errTeacherName').textContent = '';

  if (!username) {
    document.getElementById('errTeacherUsername').textContent = 'Pilih akun guru. Buat akun role Guru di menu Data Pengguna jika belum ada.';
    valid = false;
  }
  if (name.length < 3) {
    document.getElementById('errTeacherName').textContent = 'Nama minimal 3 karakter.';
    valid = false;
  }
  if (!valid) return;

  const button = document.getElementById('saveTeacherBtn');
  button.disabled = true;
  button.textContent = 'Menyimpan...';

  try {
    const payload = { username, name, subject, className, status };

    if (id) {
      await API.updateTeacher(id, payload);
      Toast.success('Data guru berhasil diperbarui.');
    } else {
      await API.createTeacher(payload);
      Toast.success('Guru baru berhasil ditambahkan.');
    }

    daftarGuru = await API.getTeachers();
    renderGuru();
    closeModal('teacherModal');

  } catch (error) {
    Toast.error(error.message || 'Gagal menyimpan data guru.');
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan';
  }
}

async function hapusGuru(id) {
  const guru = daftarGuru.find((item) => item.id === id);
  if (!guru) return;

  const confirmed = await confirmDialog({
    title: 'Hapus Data Guru?',
    message: `Profil guru "${guru.name}" akan dihapus. Akun login-nya tidak ikut terhapus.`,
    confirmText: 'Ya, Hapus',
    danger: true
  });
  if (!confirmed) return;

  try {
    await API.deleteTeacher(id);
    daftarGuru = await API.getTeachers();
    renderGuru();
    Toast.success('Data guru berhasil dihapus.');
  } catch (error) {
    Toast.error(error.message || 'Gagal menghapus data guru.');
  }
}
