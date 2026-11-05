/* =========================================================
   SMARTABS — Admin: Data Kelas
   ========================================================= */

let daftarKelasAdmin = [];
let daftarSiswaKelas = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'classes') return;

  const tbody = document.getElementById('classTableBody');
  tbody.innerHTML = loadingRow(8);

  [daftarKelasAdmin, daftarSiswaKelas] = await Promise.all([
    API.getClasses(),
    API.getStudents()
  ]);

  renderKelas();

  document.getElementById('searchClass').addEventListener('input', debounce(renderKelas));
  document.getElementById('btnAddClass')?.addEventListener('click', (event) => {
    if (APP_CONFIG.BACKEND === 'firebase') return;
    event.preventDefault();
    openClassForm();
  });
  document.getElementById('closeClassModal').addEventListener('click', () => closeModal('classModal'));
  document.getElementById('cancelClassModal').addEventListener('click', () => closeModal('classModal'));
  document.getElementById('classForm').addEventListener('submit', simpanKelas);
});

function hitungSiswa(namaKelas) {
  return daftarSiswaKelas.filter((siswa) => siswa.className === namaKelas && siswa.status === 'Aktif').length;
}

function renderKelas() {
  const keyword = document.getElementById('searchClass').value.trim().toLowerCase();
  const tbody = document.getElementById('classTableBody');

  const hasil = daftarKelasAdmin.filter((kelas) =>
    !keyword || kelas.name.toLowerCase().includes(keyword)
  );

  tbody.innerHTML = hasil.length
    ? hasil.map((kelas) => `
        <tr>
          <td class="text-muted">${escapeHtml(kelas.id)}</td>
          <td class="cell-strong">${escapeHtml(kelas.name)}</td>
          <td>${escapeHtml(kelas.level)}</td>
          <td>${escapeHtml(kelas.major)}</td>
          <td>${escapeHtml(kelas.homeroom || '-')}</td>
          <td><span class="badge badge-info">${hitungSiswa(kelas.name)} siswa</span></td>
          <td><span class="badge ${kelas.isActive === false ? 'badge-muted' : 'badge-success'}">${kelas.isActive === false ? 'Nonaktif' : 'Aktif'}</span></td>
          <td>
            <div class="action-btns">
              <a class="btn btn-outline btn-sm" href="school.html?type=classes">Buka master data</a>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(8, 'Kelas tidak ditemukan', 'Kelola rombongan belajar melalui Setup Sekolah.');

  document.getElementById('classCount').textContent = `${hasil.length} kelas ditampilkan`;

  if (APP_CONFIG.BACKEND === 'firebase') {
    document.getElementById('btnAddClass')?.remove();
    return;
  }
}

function openClassForm(id = null) {
  const form = document.getElementById('classForm');
  form.reset();
  document.getElementById('errClassName').textContent = '';
  document.getElementById('classId').value = id || '';
  document.getElementById('classModalTitle').textContent = id ? 'Edit Kelas' : 'Tambah Kelas';

  if (id) {
    const kelas = daftarKelasAdmin.find((item) => item.id === id);
    if (kelas) {
      document.getElementById('className').value = kelas.name;
      document.getElementById('classLevel').value = kelas.level;
      document.getElementById('classMajor').value = kelas.major;
      document.getElementById('classHomeroom').value = kelas.homeroom || '';
    }
  }

  openModal('classModal');
}

async function simpanKelas(event) {
  event.preventDefault();

  const id       = document.getElementById('classId').value;
  const name     = document.getElementById('className').value.trim();
  const level    = document.getElementById('classLevel').value;
  const major    = document.getElementById('classMajor').value;
  const homeroom = document.getElementById('classHomeroom').value.trim();

  if (name.length < 3) {
    document.getElementById('errClassName').textContent = 'Nama kelas minimal 3 karakter.';
    return;
  }

  try {
    const payload = { name, level, major, homeroom };

    if (id) {
      await API.updateClass(id, payload);
      Toast.success('Data kelas berhasil diperbarui.');
    } else {
      await API.createClass(payload);
      Toast.success('Kelas baru berhasil ditambahkan.');
    }

    daftarKelasAdmin = await API.getClasses();
    renderKelas();
    closeModal('classModal');

  } catch (error) {
    Toast.error(error.message || 'Gagal menyimpan data kelas.');
  }
}

async function hapusKelas(id) {
  const kelas = daftarKelasAdmin.find((item) => item.id === id);
  if (!kelas) return;

  const confirmed = await confirmDialog({
    title: 'Hapus Kelas?',
    message: `Kelas "${kelas.name}" akan dihapus. Pastikan tidak ada siswa aktif di kelas ini.`,
    confirmText: 'Ya, Hapus',
    danger: true
  });

  if (!confirmed) return;

  try {
    await API.deleteClass(id);
    daftarKelasAdmin = await API.getClasses();
    renderKelas();
    Toast.success('Kelas berhasil dihapus.');
  } catch (error) {
    Toast.error(error.message || 'Gagal menghapus kelas.');
  }
}