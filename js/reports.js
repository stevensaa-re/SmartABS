/* =========================================================
   SMARTABS — Laporan Absensi (Admin & Guru)
   ========================================================= */

let dataLaporan = [];
let kelasTersedia = [];
let jadwalLaporan = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'reports') return;

  const tbody = document.getElementById('reportTableBody');
  tbody.innerHTML = loadingRow(9);

  /* Default periode: 14 hari terakhir */
  document.getElementById('reportFrom').value = shiftDate(-14);
  document.getElementById('reportTo').value = todayISO();
  initializeSemesterFilters();

  kelasTersedia = await API.getClasses();
  jadwalLaporan = await API.getSchedules();
  document.getElementById('reportClass').innerHTML =
    '<option value="">Semua Kelas</option>' +
    kelasTersedia.map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`).join('');

  /* Guru langsung difokuskan ke kelasnya */
  if (document.body.dataset.role === 'guru') {
    const session = Session.get();
    const teacher = await API.getTeacherByUsername(session.username);
    if (teacher && teacher.className) {
      document.getElementById('reportClass').value = teacher.className;
    }
  }

  document.getElementById('reportClass').addEventListener('change', updateReportSubjects);
  document.getElementById('reportFrom').addEventListener('change', clearSemesterPreset);
  document.getElementById('reportTo').addEventListener('change', clearSemesterPreset);
  updateReportSubjects();
  document.getElementById('btnFilterReport').addEventListener('click', muatLaporan);
  document.getElementById('btnExportCsv').addEventListener('click', exportCsv);
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  await muatLaporan();
});

function initializeSemesterFilters() {
  const yearSelect = document.getElementById('reportAcademicYear');
  const today = new Date();
  const currentStartYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  yearSelect.innerHTML = '<option value="">Pilih tahun ajaran</option>' +
    Array.from({ length: 6 }, (_, index) => currentStartYear + 1 - index)
      .map((year) => `<option value="${year}">${year}/${year + 1}</option>`)
      .join('');
  yearSelect.value = String(currentStartYear);
  document.getElementById('reportSemester').addEventListener('change', applySemesterPreset);
  yearSelect.addEventListener('change', applySemesterPreset);
}

function applySemesterPreset() {
  const year = Number(document.getElementById('reportAcademicYear').value);
  const semester = document.getElementById('reportSemester').value;
  if (!year || !['1', '2'].includes(semester)) return;

  const startYear = semester === '1' ? year : year + 1;
  const from = semester === '1' ? `${startYear}-07-01` : `${startYear}-01-01`;
  const to = semester === '1' ? `${startYear}-12-31` : `${startYear}-06-30`;
  document.getElementById('reportFrom').value = from;
  document.getElementById('reportTo').value = to;
  muatLaporan();
}

function clearSemesterPreset() {
  document.getElementById('reportSemester').value = '';
}

function updateReportSubjects() {
  const className = document.getElementById('reportClass').value;
  const select = document.getElementById('reportSubject');
  const previous = select.value;
  const subjects = [...new Set(jadwalLaporan
    .filter((schedule) => !className || schedule.className === className)
    .map((schedule) => schedule.subject)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  select.innerHTML = '<option value="">Semua Mata Pelajaran</option>' +
    subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');
  if (subjects.includes(previous)) select.value = previous;
}

async function muatLaporan() {
  const from = document.getElementById('reportFrom').value;
  const to   = document.getElementById('reportTo').value;
  const className = document.getElementById('reportClass').value;
  const subject = document.getElementById('reportSubject').value;
  const status = document.getElementById('reportStatus').value;

  if (from && to && from > to) {
    Toast.warning('Tanggal "Dari" tidak boleh lebih besar dari tanggal "Sampai".');
    return;
  }

  const tbody = document.getElementById('reportTableBody');
  tbody.innerHTML = loadingRow(9);

  dataLaporan = await API.getReport({ from, to, className, subject, status });
  renderLaporan();

  document.getElementById('reportPeriod').textContent =
    `${from ? formatDate(from) : 'Awal'} — ${to ? formatDate(to) : 'Sekarang'}${subject ? ` · ${subject}` : ''}`;
}

function renderLaporan() {
  const tbody = document.getElementById('reportTableBody');
  const tfoot = document.getElementById('reportTableFoot');

  if (!dataLaporan.length) {
    tbody.innerHTML = emptyTableRow(9, 'Tidak ada data laporan', 'Coba ubah periode atau filter kelas.');
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = dataLaporan.map((row) => {
    const tone = percentageTone(row.percentage);

    return `
      <tr>
        <td class="cell-strong">${escapeHtml(row.name)}</td>
        <td class="text-muted">${escapeHtml(row.nis)}</td>
        <td>${escapeHtml(row.className)}</td>
        <td class="text-center">${row.hadir}</td>
        <td class="text-center">${row.terlambat}</td>
        <td class="text-center">${row.izin}</td>
        <td class="text-center">${row.sakit}</td>
        <td class="text-center">${row.alpa}</td>
        <td>
          <div class="progress-cell">
            <div class="progress-track">
              <div class="progress-fill ${tone}" style="width:${row.percentage}%"></div>
            </div>
            <span class="progress-value">${row.percentage}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  const total = dataLaporan.reduce((acc, row) => {
    acc.hadir += row.hadir;
    acc.terlambat += row.terlambat;
    acc.izin += row.izin;
    acc.sakit += row.sakit;
    acc.alpa += row.alpa;
    acc.total += row.total;
    return acc;
  }, { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, total: 0 });

  const rataRata = total.total ? Math.round(((total.hadir + total.terlambat) / total.total) * 100) : 0;

  tfoot.innerHTML = `
    <tr>
      <td colspan="3">TOTAL (${dataLaporan.length} siswa)</td>
      <td class="text-center">${total.hadir}</td>
      <td class="text-center">${total.terlambat}</td>
      <td class="text-center">${total.izin}</td>
      <td class="text-center">${total.sakit}</td>
      <td class="text-center">${total.alpa}</td>
      <td>Rata-rata: ${rataRata}%</td>
    </tr>`;
}

/* ---------- Export CSV ---------- */

function exportCsv() {
  if (!dataLaporan.length) {
    Toast.warning('Tidak ada data untuk diexport.');
    return;
  }

  const header = ['Nama', 'NIS', 'Kelas', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa', 'Persentase'];

  const baris = dataLaporan.map((row) => [
    row.name,
    row.nis,
    row.className,
    row.hadir,
    row.terlambat,
    row.izin,
    row.sakit,
    row.alpa,
    `${row.percentage}%`
  ]);

  const csv = [header, ...baris]
    .map((kolom) => kolom.map((nilai) => `"${String(nilai).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `laporan-absensi-smartabs-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  Toast.success('Laporan berhasil diexport ke CSV.');
}