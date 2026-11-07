/* =========================================================
   SMARTABS — Aplikasi Utama
   Menyusun layout (sidebar + navbar), modal helper, dan
   komponen bersama untuk seluruh halaman terproteksi.
   ========================================================= */

/* ---------- Definisi menu per role ---------- */

const MENUS = {
  admin: [
    { label: 'Ringkasan', items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html' }
    ]},
    { label: 'Akademik', items: [
      { key: 'semesters', label: 'Tahun Ajaran & Semester', icon: 'fa-copy', href: 'semesters.html' },
      { key: 'classes', label: 'Kelas & Jurusan', icon: 'fa-school', href: 'classes.html' },
      { key: 'school', label: 'Mata Pelajaran & Setup', icon: 'fa-building', href: 'school.html' },
      { key: 'schedule', label: 'Jadwal Pelajaran & Sesi QR', icon: 'fa-calendar-days', href: 'schedule.html' },
      { key: 'calendar', label: 'Kalender Akademik', icon: 'fa-calendar-check', href: 'calendar.html' }
    ]},
    { label: 'Pengelolaan', items: [
      { key: 'teachers', label: 'Guru', icon: 'fa-chalkboard-user', href: 'teachers.html' },
      { key: 'students', label: 'Siswa', icon: 'fa-user-graduate', href: 'students.html' },
      { key: 'users', label: 'Pengguna & Hak Akses', icon: 'fa-users-gear', href: 'users.html' }
    ]},
    { label: 'Presensi & Analisis', items: [
      { key: 'reports', label: 'Laporan', icon: 'fa-chart-column', href: 'reports.html' }
    ]},
    { label: 'Sistem', items: [
      { key: 'tools', label: 'Impor, Backup & Audit', icon: 'fa-shield-halved', href: 'tools.html' },
      { key: 'announcements', label: 'Pengumuman', icon: 'fa-bullhorn', href: 'announcements.html' }
    ]}
  ],
  guru: [
    { label: 'Ringkasan', items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html' }
    ]},
    { label: 'Mengajar', items: [
      { key: 'schedule', label: 'Jadwal Mengajar', icon: 'fa-calendar-days', href: 'schedule.html' },
      { key: 'students', label: 'Kelas & Siswa', icon: 'fa-user-graduate', href: 'students.html' },
      { key: 'attendance', label: 'Sesi QR & Absensi', icon: 'fa-clipboard-check', href: 'attendance.html' },
      { key: 'permissions', label: 'Izin / Sakit / Alpa', icon: 'fa-file-circle-check', href: 'permissions.html' }
    ]},
    { label: 'Analisis', items: [
      { key: 'reports', label: 'Laporan Kehadiran', icon: 'fa-chart-column', href: 'reports.html' },
      { key: 'calendar', label: 'Kalender Akademik', icon: 'fa-calendar-check', href: 'calendar.html' }
    ]}
  ],
  siswa: [
    { label: 'Ringkasan', items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html' }
    ]},
    { label: 'Kegiatan Saya', items: [
      { key: 'schedule', label: 'Jadwal Pelajaran', icon: 'fa-calendar-days', href: 'schedule.html' },
      { key: 'attendance', label: 'Absen dengan QR', icon: 'fa-fingerprint', href: 'attendance.html' },
      { key: 'permissions', label: 'Pengajuan Izin', icon: 'fa-file-circle-plus', href: 'permissions.html' },
      { key: 'history', label: 'Riwayat Kehadiran', icon: 'fa-clock-rotate-left', href: 'history.html' }
    ]},
    { label: 'Informasi', items: [
      { key: 'calendar', label: 'Kalender Akademik', icon: 'fa-calendar-check', href: 'calendar.html' },
      { key: 'announcements', label: 'Pengumuman', icon: 'fa-bullhorn', href: 'announcements.html' }
    ]}
  ]
};

function getPageInfo(role, key) {
  const groups = MENUS[role] || [];
  const item = groups.flatMap((group) => group.items).find((entry) => entry.key === key);
  return item || { label: 'Dashboard', icon: 'fa-gauge-high' };
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function sidebarHTML(session, activePage) {
  const groups = MENUS[session.role] || [];
  const items = groups.map((group) => {
    const active = group.items.some((item) => item.key === activePage);
    return `
      <section class="nav-group ${active ? 'is-active' : ''}">
        <button class="nav-group-toggle" type="button" aria-expanded="${active ? 'true' : 'false'}">
          <span>${escapeHtml(group.label)}</span>
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="nav-group-items">
          ${group.items.map((item) => `
            <a class="nav-item ${item.key === activePage ? 'active' : ''}" href="${item.href}">
              <i class="fa-solid ${item.icon}"></i>
              <span>${escapeHtml(item.label)}</span>
            </a>`).join('')}
        </div>
      </section>`;
  }).join('');

  return `
    <div class="sidebar-brand">
      <div class="brand-mark"><i class="fa-solid fa-fingerprint"></i></div>
      <div class="brand-text">
        <strong>SMARTABS</strong>
        <span>Smart Attendance System</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <p class="nav-title">${escapeHtml(ROLE_LABEL[session.role] || '')}</p>
      ${items}
    </nav>

    <div class="sidebar-footer">
      <button class="btn-logout" id="logoutBtn">
        <i class="fa-solid fa-right-from-bracket"></i> Keluar
      </button>
    </div>`;
}

/* =========================================================
   NAVBAR
   ========================================================= */

function navbarHTML(session, pageInfo) {
  return `
    <button class="icon-btn" id="menuToggle" aria-label="Buka menu">
      <i class="fa-solid fa-bars"></i>
    </button>

    <div class="navbar-title">
      <h2>${escapeHtml(pageInfo.label)}</h2>
      <p>SMARTABS — Smart Attendance System</p>
    </div>

    <div class="navbar-right">
      <span class="navbar-date">
        <i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateLong(todayISO()))}
      </span>
      <div class="user-chip">
        <div class="avatar">${escapeHtml(initials(session.name))}</div>
        <div class="user-info">
          <strong>${escapeHtml(session.name)}</strong>
          <span>${escapeHtml(ROLE_LABEL[session.role] || '')}</span>
        </div>
      </div>
    </div>`;
}

/* =========================================================
   RENDER LAYOUT
   ========================================================= */

function renderLayout() {
  const role = document.body.dataset.role;
  const page = document.body.dataset.page;
  if (!role) return;

  const session = Session.get();
  if (!session) return;

  const pageInfo = getPageInfo(role, page);

  const sidebar = document.getElementById('sidebar');
  const navbar  = document.getElementById('navbar');

  if (sidebar) sidebar.innerHTML = sidebarHTML(session, page);
  if (navbar)  navbar.innerHTML = navbarHTML(session, pageInfo);

  document.title = `${pageInfo.label} — SMARTABS`;

  bindLayoutEvents();
}

function bindLayoutEvents() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle  = document.getElementById('menuToggle');
  const logout  = document.getElementById('logoutBtn');

  const openSidebar = () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  };

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  };

  if (toggle)  toggle.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  if (logout) {
    logout.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Keluar dari SMARTABS?',
        message: 'Anda akan diarahkan kembali ke halaman login.',
        confirmText: 'Ya, Keluar',
        danger: true
      });

      if (confirmed) {
        try { await API.logout(); } catch (error) { /* tetap keluar */ }
        Session.clear();
        window.location.replace('../login.html');
      }
    });
  }

  /* Tutup sidebar otomatis saat menu diklik (mobile) */
  document.querySelectorAll('.nav-item').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeSidebar();
    });

    document.querySelectorAll('.nav-group-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.nav-group');
        const expanded = group.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(expanded));
      });
    });
  });

  /* Tutup sidebar bila layar diperbesar */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) closeSidebar();
  });
}

/* =========================================================
   MODAL HELPER
   ========================================================= */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 120);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.remove('open');
  document.body.style.overflow = '';
}

/* Klik overlay & tombol ESC untuk menutup modal */
function bindModalGlobalEvents() {
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    document.querySelectorAll('.modal.open').forEach((modal) => {
      if (modal.querySelector('[data-action="confirm"]')) return; // dialog konfirmasi
      closeModal(modal.id);
    });
  });
}

/* =========================================================
   KOMPONEN KARTU STATISTIK
   ========================================================= */

function statCard({ label, value, icon, tone = 'primary', hint = '' }) {
  return `
    <div class="stat-card">
      <div class="stat-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
      <div>
        <div class="stat-value">${escapeHtml(String(value))}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        ${hint ? `<div class="stat-hint">${escapeHtml(hint)}</div>` : ''}
      </div>
    </div>`;
}

/* =========================================================
   GRAFIK (Chart.js dengan fallback CSS)
   ========================================================= */

const chartRegistry = {};

function renderChart(canvasId, config, fallbackItems) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    renderCssChart(canvas, fallbackItems || []);
    return;
  }

  if (chartRegistry[canvasId]) chartRegistry[canvasId].destroy();
  chartRegistry[canvasId] = new Chart(canvas.getContext('2d'), config);
}

function renderCssChart(canvas, items) {
  if (!items.length) return;

  const max = Math.max(...items.map((item) => item.value), 1);

  const wrapper = document.createElement('div');
  wrapper.className = 'css-chart';
  wrapper.innerHTML = items.map((item) => `
    <div class="css-chart-row">
      <span class="css-chart-label">${escapeHtml(item.label)}</span>
      <div class="css-chart-track">
        <div class="css-chart-bar" style="width:${((item.value / max) * 100).toFixed(1)}%;background:${item.color}"></div>
      </div>
      <span class="css-chart-value">${item.value}</span>
    </div>`).join('');

  canvas.replaceWith(wrapper);
}

/* =========================================================
   INIT
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  renderLayout();
  bindModalGlobalEvents();
});