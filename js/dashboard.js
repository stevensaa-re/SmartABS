/* =========================================================
   SMARTABS — Dashboard (Admin, Guru, Siswa)
   ========================================================= */

const WARNA_STATUS = {
  Hadir: '#16a34a',
  Terlambat: '#d97706',
  Izin:  '#7c3aed',
  Sakit: '#d97706',
  Alpa:  '#dc2626'
};

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'dashboard') return;

  const role = document.body.dataset.role;

  if (role === 'admin') await initAdminDashboard();
  else if (role === 'guru') await initGuruDashboard();
  else if (role === 'siswa') await initSiswaDashboard();
});

/* =========================================================
   ADMIN
   ========================================================= */

async function initAdminDashboard() {
  const grid = document.getElementById('statsGrid');
  const tbody = document.getElementById('recentAttendance');
  const today = todayISO();

  grid.innerHTML = loadingBlock();
  tbody.innerHTML = loadingRow(4);

  const [students, teachers, attendance] = await Promise.all([
    API.getStudents(),
    API.getTeachers(),
    API.getAttendanceRange(shiftDate(-6), today)   // cukup 7 hari terakhir
  ]);

  const todayRows = attendance.filter((row) => row.date === today);

  const hadir = todayRows.filter((r) => r.status === 'Hadir').length;
  const terlambat = todayRows.filter((r) => r.status === 'Terlambat').length;
  const izin  = todayRows.filter((r) => r.status === 'Izin').length;
  const sakit = todayRows.filter((r) => r.status === 'Sakit').length;
  const alpa  = todayRows.filter((r) => r.status === 'Alpa').length;

  grid.innerHTML = [
    statCard({ label: 'Total Siswa', value: students.filter((s) => s.status === 'Aktif').length, icon: 'fa-user-graduate', tone: 'primary' }),
    statCard({ label: 'Total Guru', value: teachers.filter((t) => t.status === 'Aktif').length, icon: 'fa-chalkboard-user', tone: 'info' }),
    statCard({ label: 'Hadir Hari Ini', value: hadir, icon: 'fa-circle-check', tone: 'success' }),
    statCard({ label: 'Terlambat', value: terlambat, icon: 'fa-clock', tone: 'warning' }),
    statCard({ label: 'Izin', value: izin, icon: 'fa-file-lines', tone: 'info' }),
    statCard({ label: 'Sakit', value: sakit, icon: 'fa-notes-medical', tone: 'warning' }),
    statCard({ label: 'Alpa', value: alpa, icon: 'fa-user-xmark', tone: 'danger' })
  ].join('');

  /* ---- Tren 7 hari ---- */
  const labels = [];
  const hadirTrend = [];

  for (let back = 6; back >= 0; back--) {
    const date = shiftDate(-back);
    labels.push(formatDate(date).slice(0, 6));
    hadirTrend.push(attendance.filter((r) => r.date === date && ['Hadir', 'Terlambat'].includes(r.status)).length);
  }

  renderChart('trendChart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Jumlah Hadir',
        data: hadirTrend,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: '#2563eb'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  }, labels.map((label, index) => ({
    label,
    value: hadirTrend[index],
    color: '#2563eb'
  })));

  /* ---- Komposisi hari ini ---- */
  renderChart('statusChart', {
    type: 'doughnut',
    data: {
      labels: ['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa'],
      datasets: [{
        data: [hadir, terlambat, izin, sakit, alpa],
        backgroundColor: ['#16a34a', '#d97706', '#7c3aed', '#f59e0b', '#dc2626'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } }
    }
  }, [
    { label: 'Hadir', value: hadir, color: '#16a34a' },
    { label: 'Terlambat', value: terlambat, color: '#d97706' },
    { label: 'Izin',  value: izin,  color: '#7c3aed' },
    { label: 'Sakit', value: sakit, color: '#d97706' },
    { label: 'Alpa',  value: alpa,  color: '#dc2626' }
  ]);

  document.getElementById('todayLabel').textContent = formatDate(today);

  /* ---- Absensi terbaru ---- */
  const recent = todayRows
    .filter((row) => row.time && row.time !== '-')
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .slice(0, 6);

  tbody.innerHTML = recent.length
    ? recent.map((row) => `
        <tr>
          <td class="cell-strong">${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.className)}</td>
          <td>${escapeHtml(row.time)}</td>
          <td>${badge(row.status)}</td>
        </tr>`).join('')
    : emptyTableRow(4, 'Belum ada absensi hari ini', 'Data akan muncul setelah siswa melakukan absensi.');
}

/* =========================================================
   GURU
   ========================================================= */

async function initGuruDashboard() {
  const session = Session.get();
  const grid = document.getElementById('statsGrid');
  const tbody = document.getElementById('recentAttendance');

  grid.innerHTML = loadingBlock();
  tbody.innerHTML = loadingRow(4);

  const teacher = await API.getTeacherByUsername(session.username);
  const className = teacher ? teacher.className : null;

  const today = todayISO();

  const [students, attendance] = await Promise.all([
    API.getStudents(),
    API.getAttendanceRange(shiftDate(-6), today, className)
  ]);

  const classStudents = students.filter(
    (s) => s.status === 'Aktif' && (!className || s.className === className)
  );
  const todayRows = attendance.filter(
    (row) => row.date === today && (!className || row.className === className)
  );

  if (teacher) {
    document.getElementById('guruClassInfo').textContent =
      `Ringkasan kehadiran kelas ${className} hari ini.`;
  } else {
    document.getElementById('guruClassInfo').textContent =
      'Ringkasan kehadiran seluruh siswa hari ini.';
  }

  const hadir = todayRows.filter((r) => r.status === 'Hadir').length;
  const terlambat = todayRows.filter((r) => r.status === 'Terlambat').length;
  const izin  = todayRows.filter((r) => r.status === 'Izin').length;
  const sakit = todayRows.filter((r) => r.status === 'Sakit').length;
  const alpa  = todayRows.filter((r) => r.status === 'Alpa').length;

  grid.innerHTML = [
    statCard({ label: 'Total Siswa', value: classStudents.length, icon: 'fa-user-graduate', tone: 'primary' }),
    statCard({ label: 'Hadir Hari Ini', value: hadir, icon: 'fa-circle-check', tone: 'success' }),
    statCard({ label: 'Terlambat', value: terlambat, icon: 'fa-clock', tone: 'warning' }),
    statCard({ label: 'Izin', value: izin, icon: 'fa-file-lines', tone: 'info' }),
    statCard({ label: 'Sakit', value: sakit, icon: 'fa-notes-medical', tone: 'warning' }),
    statCard({ label: 'Alpa', value: alpa, icon: 'fa-user-xmark', tone: 'danger' })
  ].join('');

  /* ---- Tren 7 hari ---- */
  const labels = [];
  const values = [];

  for (let back = 6; back >= 0; back--) {
    const date = shiftDate(-back);
    labels.push(formatDate(date).slice(0, 6));
    values.push(attendance.filter((r) =>
      r.date === date && ['Hadir', 'Terlambat'].includes(r.status) && (!className || r.className === className)
    ).length);
  }

  renderChart('guruTrendChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Hadir',
        data: values,
        backgroundColor: '#2563eb',
        borderRadius: 6,
        maxBarThickness: 34
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  }, labels.map((label, index) => ({ label, value: values[index], color: '#2563eb' })));

  renderChart('guruStatusChart', {
    type: 'doughnut',
    data: {
      labels: ['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa'],
      datasets: [{
        data: [hadir, terlambat, izin, sakit, alpa],
        backgroundColor: ['#16a34a', '#d97706', '#7c3aed', '#f59e0b', '#dc2626'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } }
    }
  }, [
    { label: 'Hadir', value: hadir, color: '#16a34a' },
    { label: 'Terlambat', value: terlambat, color: '#d97706' },
    { label: 'Izin',  value: izin,  color: '#7c3aed' },
    { label: 'Sakit', value: sakit, color: '#d97706' },
    { label: 'Alpa',  value: alpa,  color: '#dc2626' }
  ]);

  document.getElementById('todayLabel').textContent = formatDate(today);

  const recent = todayRows
    .filter((row) => row.time && row.time !== '-')
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .slice(0, 6);

  tbody.innerHTML = recent.length
    ? recent.map((row) => `
        <tr>
          <td class="cell-strong">${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.className)}</td>
          <td>${escapeHtml(row.time)}</td>
          <td>${badge(row.status)}</td>
        </tr>`).join('')
    : emptyTableRow(4, 'Belum ada absensi hari ini', 'Belum ada siswa yang tercatat hadir.');
}

/* =========================================================
   SISWA
   ========================================================= */

async function initSiswaDashboard() {
  const session = Session.get();
  const grid = document.getElementById('statsGrid');

  grid.innerHTML = loadingBlock();

  const student = await API.getStudentByNis(session.nis) || {
    nis: session.nis || '-',
    name: session.name,
    className: session.className || '-'
  };

  const history = await API.getAttendanceByStudent(student.nis);

  const hadir = history.filter((r) => r.status === 'Hadir').length;
  const terlambat = history.filter((r) => r.status === 'Terlambat').length;
  const izin  = history.filter((r) => r.status === 'Izin').length;
  const sakit = history.filter((r) => r.status === 'Sakit').length;
  const alpa  = history.filter((r) => r.status === 'Alpa').length;
  const total = history.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;

  document.getElementById('studentGreeting').textContent = student.name.split(' ')[0];

  document.getElementById('studentProfile').innerHTML = `
    <div class="profile-avatar">${escapeHtml(initials(student.name))}</div>
    <div class="profile-info">
      <h2>${escapeHtml(student.name)}</h2>
      <p>NIS ${escapeHtml(student.nis)} — ${escapeHtml(student.className)}</p>
    </div>
    <div class="profile-meta">
      <div><span>Total Absensi</span><strong>${total} hari</strong></div>
      <div><span>Persentase</span><strong>${persen}%</strong></div>
      <div><span>Status</span><strong>${persen >= 75 ? 'Baik' : 'Perlu Perhatian'}</strong></div>
    </div>`;

  grid.innerHTML = [
    statCard({ label: 'Hadir', value: hadir, icon: 'fa-circle-check', tone: 'success' }),
    statCard({ label: 'Terlambat', value: terlambat, icon: 'fa-clock', tone: 'warning' }),
    statCard({ label: 'Izin', value: izin, icon: 'fa-file-lines', tone: 'info' }),
    statCard({ label: 'Sakit', value: sakit, icon: 'fa-notes-medical', tone: 'warning' }),
    statCard({ label: 'Alpa', value: alpa, icon: 'fa-user-xmark', tone: 'danger' }),
    statCard({ label: 'Persentase Kehadiran', value: `${persen}%`, icon: 'fa-chart-pie', tone: 'primary' })
  ].join('');

  renderChart('studentStatusChart', {
    type: 'doughnut',
    data: {
      labels: ['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpa'],
      datasets: [{
        data: [hadir, terlambat, izin, sakit, alpa],
        backgroundColor: ['#16a34a', '#d97706', '#7c3aed', '#f59e0b', '#dc2626'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } }
    }
  }, [
    { label: 'Hadir', value: hadir, color: '#16a34a' },
    { label: 'Terlambat', value: terlambat, color: '#d97706' },
    { label: 'Izin',  value: izin,  color: '#7c3aed' },
    { label: 'Sakit', value: sakit, color: '#d97706' },
    { label: 'Alpa',  value: alpa,  color: '#dc2626' }
  ]);

  const labels = [];
  const values = [];

  for (let back = 6; back >= 0; back--) {
    const date = shiftDate(-back);
    labels.push(formatDate(date).slice(0, 6));
    values.push(history.filter((r) => r.date === date && ['Hadir', 'Terlambat'].includes(r.status)).length);
  }

  renderChart('studentTrendChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Hadir',
        data: values,
        backgroundColor: '#16a34a',
        borderRadius: 6,
        maxBarThickness: 30
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 1, ticks: { precision: 0 } } }
    }
  }, labels.map((label, index) => ({ label, value: values[index], color: '#16a34a' })));

  const tbody = document.getElementById('recentHistory');
  const recent = history.slice(0, 6);

  tbody.innerHTML = recent.length
    ? recent.map((row) => `
        <tr>
          <td>${escapeHtml(formatDate(row.date))}</td>
          <td>${escapeHtml(row.time)}</td>
          <td>${badge(row.status)}</td>
          <td class="text-muted">${escapeHtml(row.note || '-')}</td>
        </tr>`).join('')
    : emptyTableRow(4, 'Belum ada riwayat kehadiran', 'Riwayat akan muncul setelah Anda melakukan absensi.');
}