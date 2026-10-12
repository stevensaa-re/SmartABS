let calendarRows = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'calendar') return;
  const today = todayISO();
  document.getElementById('calendarFrom').value = today.slice(0, 4) + '-01-01';
  document.getElementById('calendarTo').value = today.slice(0, 4) + '-12-31';
  ['calendarFrom', 'calendarTo'].forEach((id) =>
    document.getElementById(id).addEventListener('change', renderCalendar));

  if (document.body.dataset.role === 'admin') {
    document.getElementById('addCalendarEvent').addEventListener('click', () => openCalendarForm());
    document.getElementById('calendarForm').addEventListener('submit', saveCalendarEvent);
    ['closeCalendarModal', 'cancelCalendarModal'].forEach((id) =>
      document.getElementById(id).addEventListener('click', () => closeModal('calendarModal')));
  }
  await loadCalendar();
});

async function loadCalendar() {
  const container = document.getElementById('calendarEvents');
  container.innerHTML = '<p class="text-muted">Memuat agenda…</p>';
  try {
    calendarRows = await API.getCalendarEvents();
    renderCalendar();
  } catch (error) {
    container.innerHTML = emptyState(error.message || 'Gagal memuat kalender.');
  }
}

function renderCalendar() {
  const container = document.getElementById('calendarEvents');
  const from = document.getElementById('calendarFrom').value;
  const to = document.getElementById('calendarTo').value;
  const rows = calendarRows.filter((event) =>
    (!from || event.endDate >= from) && (!to || event.startDate <= to));
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><strong>Tidak ada agenda pada periode ini.</strong></div>';
    return;
  }
  const admin = document.body.dataset.role === 'admin';
  container.innerHTML = rows.map((event) => `
    <article class="calendar-event ${event.isHoliday ? 'calendar-holiday' : ''}">
      <div class="calendar-date"><strong>${escapeHtml(formatDate(event.startDate))}</strong>
        ${event.endDate !== event.startDate ? `<span>— ${escapeHtml(formatDate(event.endDate))}</span>` : ''}
      </div>
      <div class="calendar-event-body"><div class="calendar-event-heading">
        <h3>${escapeHtml(event.title)}</h3><span class="badge badge-${event.isHoliday ? 'warning' : 'info'}">${escapeHtml(event.isHoliday ? 'Hari Libur' : event.type || 'Akademik')}</span>
      </div>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}</div>
      ${admin ? `<div class="calendar-actions"><button class="btn btn-outline btn-sm" data-edit="${escapeHtml(event.id)}">Ubah</button>
        <button class="btn btn-outline btn-sm" data-delete="${escapeHtml(event.id)}">Hapus</button></div>` : ''}
    </article>`).join('');
  container.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () =>
    openCalendarForm(calendarRows.find((row) => row.id === button.dataset.edit))));
  container.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
    const event = calendarRows.find((row) => row.id === button.dataset.delete);
    if (!event || !(await confirmDialog({ title: 'Hapus agenda?', message: `Agenda "${event.title}" akan dihapus.`, confirmText: 'Hapus', danger: true }))) return;
    try {
      await API.deleteCalendarEvent(event.id);
      if (APP_CONFIG.BACKEND === 'local') {
        await API.logAudit({ action: 'delete', entity: 'calendarEvent', entityId: event.id, summary: `Menghapus agenda "${event.title}".` });
      }
      Toast.success('Agenda dihapus.');
      await loadCalendar();
    } catch (error) { Toast.error(error.message || 'Gagal menghapus agenda.'); }
  }));
}

function openCalendarForm(event = null) {
  document.getElementById('calendarForm').reset();
  document.getElementById('calendarEventId').value = event?.id || '';
  document.getElementById('calendarModalTitle').textContent = event ? 'Ubah Agenda' : 'Tambah Agenda';
  document.getElementById('calendarTitle').value = event?.title || '';
  document.getElementById('calendarType').value = event?.type || 'Akademik';
  document.getElementById('calendarStart').value = event?.startDate || todayISO();
  document.getElementById('calendarEnd').value = event?.endDate || todayISO();
  document.getElementById('calendarDescription').value = event?.description || '';
  document.getElementById('calendarHoliday').checked = Boolean(event?.isHoliday);
  openModal('calendarModal');
}

async function saveCalendarEvent(event) {
  event.preventDefault();
  const id = document.getElementById('calendarEventId').value;
  const payload = {
    id: id || undefined,
    title: document.getElementById('calendarTitle').value.trim(),
    type: document.getElementById('calendarType').value,
    startDate: document.getElementById('calendarStart').value,
    endDate: document.getElementById('calendarEnd').value,
    description: document.getElementById('calendarDescription').value.trim(),
    isHoliday: document.getElementById('calendarHoliday').checked
  };
  if (!payload.title || !payload.startDate || !payload.endDate || payload.startDate > payload.endDate) {
    Toast.warning('Periksa judul dan rentang tanggal agenda.');
    return;
  }
  try {
    const saved = await API.saveCalendarEvent(payload);
    if (APP_CONFIG.BACKEND === 'local') {
      await API.logAudit({ action: id ? 'update' : 'create', entity: 'calendarEvent', entityId: saved.id,
        summary: `${id ? 'Memperbarui' : 'Menambahkan'} agenda "${payload.title}".` });
    }
    closeModal('calendarModal');
    Toast.success('Agenda kalender tersimpan.');
    await loadCalendar();
  } catch (error) { Toast.error(error.message || 'Gagal menyimpan agenda.'); }
}
