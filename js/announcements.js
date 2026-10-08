/* =========================================================
   SMARTABS — Pengumuman
   Admin : CRUD
   Siswa : hanya membaca pengumuman "Publish"
   ========================================================= */

let daftarPengumuman = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'announcements') return;

  const role = document.body.dataset.role;

  if (role === 'admin') await initPengumumanAdmin();
  else await initPengumumanSiswa();
});

/* =========================================================
   ADMIN
   ========================================================= */

async function initPengumumanAdmin() {
  const tbody = document.getElementById('announcementTableBody');
  tbody.innerHTML = loadingRow(4);

  daftarPengumuman = await API.getAnnouncements();
  renderPengumumanAdmin();

  document.getElementById('searchAnnouncement').addEventListener('input', debounce(renderPengumumanAdmin));
  document.getElementById('filterAnnouncementStatus').addEventListener('change', renderPengumumanAdmin);

  document.getElementById('btnAddAnnouncement').addEventListener('click', () => openAnnouncementForm());
  document.getElementById('closeAnnouncementModal').addEventListener('click', () => closeModal('announcementModal'));
  document.getElementById('cancelAnnouncementModal').addEventListener('click', () => closeModal('announcementModal'));
  document.getElementById('announcementForm').addEventListener('submit', simpanPengumuman);
}

function renderPengumumanAdmin() {
  const keyword = document.getElementById('searchAnnouncement').value.trim().toLowerCase();
  const status  = document.getElementById('filterAnnouncementStatus').value;

  const hasil = daftarPengumuman.filter((item) => {
    const cocokKeyword = !keyword || item.title.toLowerCase().includes(keyword);
    const cocokStatus = !status || item.status === status;
    return cocokKeyword && cocokStatus;
  });

  const tbody = document.getElementById('announcementTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((item) => `
        <tr>
          <td>
            <div class="cell-strong">${escapeHtml(item.title)}</div>
            <div class="cell-sub">${escapeHtml(item.content.slice(0, 70))}${item.content.length > 70 ? '...' : ''}</div>
          </td>
          <td>${escapeHtml(formatDate(item.date))}</td>
          <td>${badge(item.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon" data-action="edit" data-id="${item.id}" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="delete" data-id="${item.id}" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : emptyTableRow(4, 'Belum ada pengumuman', 'Klik "Buat Pengumuman" untuk menambahkan.');

  tbody.querySelectorAll('[data-action="edit"]').forEach((button) =>
    button.addEventListener('click', () => openAnnouncementForm(button.dataset.id)));

  tbody.querySelectorAll('[data-action="delete"]').forEach((button) =>
    button.addEventListener('click', () => hapusPengumuman(button.dataset.id)));
}

function openAnnouncementForm(id = null) {
  const form = document.getElementById('announcementForm');
  form.reset();

  document.getElementById('errAnnouncementTitle').textContent = '';
  document.getElementById('errAnnouncementContent').textContent = '';

  document.getElementById('announcementId').value = id || '';
  document.getElementById('announcementModalTitle').textContent =
    id ? 'Edit Pengumuman' : 'Buat Pengumuman';

  if (id) {
    const item = daftarPengumuman.find((p) => p.id === id);
    if (item) {
      document.getElementById('announcementTitle').value = item.title;
      document.getElementById('announcementContent').value = item.content;
      document.getElementById('announcementDate').value = item.date;
      document.getElementById('announcementStatus').value = item.status;
    }
  } else {
    document.getElementById('announcementDate').value = todayISO();
  }

  openModal('announcementModal');
}

async function simpanPengumuman(event) {
  event.preventDefault();

  const id      = document.getElementById('announcementId').value;
  const title   = document.getElementById('announcementTitle').value.trim();
  const content = document.getElementById('announcementContent').value.trim();
  const date    = document.getElementById('announcementDate').value;
  const status  = document.getElementById('announcementStatus').value;

  let valid = true;
  document.getElementById('errAnnouncementTitle').textContent = '';
  document.getElementById('errAnnouncementContent').textContent = '';

  if (title.length < 5) {
    document.getElementById('errAnnouncementTitle').textContent = 'Judul minimal 5 karakter.';
    valid = false;
  }
  if (content.length < 10) {
    document.getElementById('errAnnouncementContent').textContent = 'Isi pengumuman minimal 10 karakter.';
    valid = false;
  }
  if (!valid) return;

  try {
    const payload = { title, content, date, status };

    if (id) {
      await API.updateAnnouncement(id, payload);
      Toast.success('Pengumuman berhasil diperbarui.');
    } else {
      await API.createAnnouncement(payload);
      Toast.success('Pengumuman berhasil dibuat.');
    }

    daftarPengumuman = await API.getAnnouncements();
    renderPengumumanAdmin();
    closeModal('announcementModal');

  } catch (error) {
    Toast.error('Gagal menyimpan pengumuman.');
  }
}

async function hapusPengumuman(id) {
  const confirmed = await confirmDialog({
    title: 'Hapus Pengumuman?',
    message: 'Pengumuman ini akan dihapus permanen.',
    confirmText: 'Ya, Hapus',
    danger: true
  });

  if (!confirmed) return;

  try {
    await API.deleteAnnouncement(id);
    daftarPengumuman = await API.getAnnouncements();
    renderPengumumanAdmin();
    Toast.success('Pengumuman berhasil dihapus.');
  } catch (error) {
    Toast.error('Gagal menghapus pengumuman.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initPengumumanSiswa() {
  const container = document.getElementById('announcementList');
  container.innerHTML = loadingBlock();

  const semua = await API.getAnnouncements();
  const publish = semua.filter((item) => item.status === 'Publish');

  container.innerHTML = publish.length
    ? publish.map((item) => `
        <article class="announcement-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.content)}</p>
          <div class="announcement-meta">
            <i class="fa-regular fa-calendar"></i>
            ${escapeHtml(formatDateLong(item.date))}
          </div>
        </article>`).join('')
    : emptyState('Belum ada pengumuman', 'Pengumuman akan tampil di sini setelah dipublikasikan.');
}