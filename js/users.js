/* =========================================================
   SMARTABS — Admin: Data Pengguna
   ========================================================= */

let daftarPengguna = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'users') return;

  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = loadingRow(6);

  daftarPengguna = await API.getUsers();
  renderUsers();

  /* ---- Pencarian & filter realtime ---- */
  document.getElementById('searchUser').addEventListener('input', debounce(renderUsers));
  document.getElementById('filterRole').addEventListener('change', renderUsers);
  document.getElementById('filterStatus').addEventListener('change', renderUsers);

  /* ---- Tombol tambah ---- */
  document.getElementById('btnAddUser').addEventListener('click', () => openUserForm());

  /* ---- Modal ---- */
  document.getElementById('closeUserModal').addEventListener('click', () => closeModal('userModal'));
  document.getElementById('cancelUserModal').addEventListener('click', () => closeModal('userModal'));
  document.getElementById('userForm').addEventListener('submit', simpanUser);
});

/* ---------- Render tabel ---------- */

function renderUsers() {
  const keyword = document.getElementById('searchUser').value.trim().toLowerCase();
  const role    = document.getElementById('filterRole').value;
  const status  = document.getElementById('filterStatus').value;

  const hasil = daftarPengguna.filter((user) => {
    const cocokKeyword =
      !keyword ||
      user.name.toLowerCase().includes(keyword) ||
      user.username.toLowerCase().includes(keyword);
    const cocokRole = !role || user.role === role;
    const cocokStatus = !status || user.status === status;
    return cocokKeyword && cocokRole && cocokStatus;
  });

  const tbody = document.getElementById('userTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((user) => `
        <tr>
          <td class="text-muted">${escapeHtml(user.id)}</td>
          <td class="cell-strong">${escapeHtml(user.name)}</td>
          <td>${escapeHtml(user.username)}</td>
          <td>${badge(ROLE_LABEL[user.role] || user.role)}</td>
          <td>${badge(user.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon" data-action="edit" data-id="${user.id}" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="delete" data-id="${user.id}" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(6, 'Pengguna tidak ditemukan', 'Coba ubah kata kunci atau filter.');

  document.getElementById('userCount').textContent = `${hasil.length} pengguna ditampilkan`;

  /* Event listener tombol aksi (tanpa inline onclick) */
  tbody.querySelectorAll('[data-action="edit"]').forEach((button) => {
    button.addEventListener('click', () => openUserForm(button.dataset.id));
  });

  tbody.querySelectorAll('[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', () => hapusUser(button.dataset.id));
  });
}

/* ---------- Form modal ---------- */

function openUserForm(id = null) {
  const form = document.getElementById('userForm');
  form.reset();

  ['errUserName', 'errUserUsername', 'errUserPassword'].forEach((elementId) => {
    document.getElementById(elementId).textContent = '';
  });

  document.getElementById('userId').value = id || '';
  document.getElementById('userModalTitle').textContent = id ? 'Edit Pengguna' : 'Tambah Pengguna';

  /* Password tidak pernah ditampilkan. Saat edit, kosong = tidak diubah. */
  document.getElementById('userPassword').placeholder =
    id ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter';
  document.getElementById('userPasswordReq').classList.toggle('hidden', !!id);

  if (id) {
    const user = daftarPengguna.find((item) => item.id === id);
    if (user) {
      document.getElementById('userName').value = user.name;
      document.getElementById('userUsername').value = user.username;
      document.getElementById('userRole').value = user.role;
      document.getElementById('userStatus').value = user.status;
      document.getElementById('userEmail').value = user.email || '';
    }
  } else {
    document.getElementById('userStatus').value = 'Aktif';
  }

  openModal('userModal');
}

async function simpanUser(event) {
  event.preventDefault();

  const id       = document.getElementById('userId').value;
  const name     = document.getElementById('userName').value.trim();
  const username = document.getElementById('userUsername').value.trim();
  const password = document.getElementById('userPassword').value.trim();
  const role     = document.getElementById('userRole').value;
  const status   = document.getElementById('userStatus').value;
  const email    = document.getElementById('userEmail').value.trim();

  let valid = true;

  document.getElementById('errUserName').textContent = '';
  document.getElementById('errUserUsername').textContent = '';
  document.getElementById('errUserPassword').textContent = '';

  if (name.length < 3) {
    document.getElementById('errUserName').textContent = 'Nama minimal 3 karakter.';
    valid = false;
  }
  if (username.length < 3) {
    document.getElementById('errUserUsername').textContent = 'Username minimal 3 karakter.';
    valid = false;
  }
  if ((!id || password) && password.length < 6) {
    document.getElementById('errUserPassword').textContent = 'Password minimal 6 karakter.';
    valid = false;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    Toast.warning('Format email tidak valid.');
    valid = false;
  }
  if (!valid) return;

  const button = document.getElementById('saveUserBtn');
  button.disabled = true;
  button.textContent = 'Menyimpan...';

  try {
    const payload = { name, username, role, status, email };
    if (password) payload.password = password;

    if (id) {
      await API.updateUser(id, payload);
      Toast.success('Data pengguna berhasil diperbarui.');
    } else {
      await API.createUser(payload);
      Toast.success('Pengguna baru berhasil ditambahkan.');
    }

    daftarPengguna = await API.getUsers();
    renderUsers();
    closeModal('userModal');

  } catch (error) {
    Toast.error(error.message || 'Gagal menyimpan pengguna.');
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan';
  }
}

/* ---------- Hapus ---------- */

async function hapusUser(id) {
  const user = daftarPengguna.find((item) => item.id === id);
  if (!user) return;

  const me = Session.get();
  if (me && me.id === id) {
    Toast.warning('Anda tidak dapat menghapus akun yang sedang dipakai login.');
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Hapus Pengguna?',
    message: `Akun "${user.name}" akan dihapus permanen dan tidak dapat dikembalikan.`,
    confirmText: 'Ya, Hapus',
    danger: true
  });

  if (!confirmed) return;

  try {
    await API.deleteUser(id);
    daftarPengguna = await API.getUsers();
    renderUsers();
    Toast.success('Pengguna berhasil dihapus.');
  } catch (error) {
    Toast.error('Gagal menghapus pengguna.');
  }
}