/* =========================================================
   SMARTABS — Siswa: Riwayat Kehadiran
   ========================================================= */

let riwayatSiswa = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'history') return;

  const session = Session.get();
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = loadingRow(4);

  riwayatSiswa = await API.getAttendanceByStudent(session.nis);
  renderRiwayat();

  document.getElementById('searchHistory').addEventListener('input', debounce(renderRiwayat));
  document.getElementById('filterHistoryDate').addEventListener('change', renderRiwayat);
  document.getElementById('filterHistoryStatus').addEventListener('change', renderRiwayat);
});

function renderRiwayat() {
  const keyword = document.getElementById('searchHistory').value.trim().toLowerCase();
  const tanggal = document.getElementById('filterHistoryDate').value;
  const status  = document.getElementById('filterHistoryStatus').value;

  const hasil = riwayatSiswa.filter((row) => {
    const cocokKeyword = !keyword || String(row.note || '').toLowerCase().includes(keyword);
    const cocokTanggal = !tanggal || row.date === tanggal;
    const cocokStatus  = !status || row.status === status;
    return cocokKeyword && cocokTanggal && cocokStatus;
  });

  const tbody = document.getElementById('historyTableBody');

  tbody.innerHTML = hasil.length
    ? hasil.map((row) => `
        <tr>
          <td class="cell-strong">${escapeHtml(formatDate(row.date))}</td>
          <td>${escapeHtml(row.time)}</td>
          <td>${badge(row.status)}</td>
          <td class="text-muted">${escapeHtml(row.note || '-')}</td>
        </tr>`).join('')
    : emptyTableRow(4, 'Riwayat tidak ditemukan', 'Coba ubah filter pencarian.');

  document.getElementById('historyCount').textContent = `${hasil.length} data ditampilkan`;
}