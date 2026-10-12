/* =========================================================
   SMARTABS — Absensi
   Guru : kelola status kehadiran per kelas
   Siswa: melakukan absensi harian
   ========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'attendance') return;

  const role = document.body.dataset.role;

  if (role === 'guru') await initAbsensiGuru();
  else await initAbsensiSiswa();
});

/* =========================================================
   GURU
   ========================================================= */

let dataAbsensiGuru = [];
let dataSiswaGuru = [];
let semuaSiswaGuru = [];
let schedulesGuru = [];
let teacherQrSession = null;
let teacherQrRotationTimer = null;
let teacherQrCountdownTimer = null;
let teacherAttendanceUnsubscribe = null;

async function initAbsensiGuru() {
  const session = Session.get();
  const tbody = document.getElementById('attendanceTableBody');
  tbody.innerHTML = loadingRow(7);

  const teacher = await API.getTeacherByUsername(session.username);
  const [classes, schedules, students] = await Promise.all([
    API.getClasses(),
    API.getSchedules(),
    API.getStudents()
  ]);
  schedulesGuru = schedules.filter((schedule) => !teacher || schedule.teacher === teacher.name);
  semuaSiswaGuru = students;

  const classSelect = document.getElementById('attendanceClass');
  classSelect.innerHTML = classes
    .map((kelas) => `<option value="${escapeHtml(kelas.name)}">${escapeHtml(kelas.name)}</option>`)
    .join('');

  /* Default: kelas yang diampu guru */
  const defaultClass = teacher ? teacher.className : (classes[0] ? classes[0].name : '');
  if (defaultClass) classSelect.value = defaultClass;
  refreshQrSchedules(schedulesGuru, defaultClass);

  document.getElementById('attendanceDate').value = todayISO();

  await muatAbsensiGuru();

  classSelect.addEventListener('change', () => {
    refreshQrSchedules(schedulesGuru, classSelect.value);
    muatAbsensiGuru();
  });
  document.getElementById('attendanceDate').addEventListener('change', muatAbsensiGuru);
  document.getElementById('searchAttendance').addEventListener('input', debounce(renderAbsensiGuru));

  document.getElementById('closeStatusModal').addEventListener('click', () => closeModal('statusModal'));
  document.getElementById('cancelStatusModal').addEventListener('click', () => closeModal('statusModal'));
  document.getElementById('statusForm').addEventListener('submit', simpanStatusKehadiran);
  document.getElementById('btnStartQr').addEventListener('click', startTeacherQrSession);
  document.getElementById('btnCloseQr').addEventListener('click', closeTeacherQrSession);
  document.getElementById('qrSchedule').addEventListener('change', renderAbsensiGuru);
}

function refreshQrSchedules(schedules, className) {
  const select = document.getElementById('qrSchedule');
  const available = schedules.filter((schedule) => schedule.className === className);
  select.innerHTML = available.length
    ? available.map((schedule) => {
        const label = `${schedule.day} · ${schedule.start}-${schedule.end} · ${schedule.subject}`;
        return `<option value="${escapeHtml(schedule.id)}">${escapeHtml(label)}</option>`;
      }).join('')
    : '<option value="">Tidak ada jadwal untuk kelas ini</option>';
}

async function startTeacherQrSession() {
  const button = document.getElementById('btnStartQr');
  const scheduleId = document.getElementById('qrSchedule').value;
  const schedule = schedulesGuru.find((item) => item.id === scheduleId);
  if (typeof QRCode === 'undefined') {
    Toast.error('Pembuat QR gagal dimuat. Periksa koneksi internet.');
    return;
  }
  if (!schedule) {
    Toast.warning('Pilih jadwal mata pelajaran yang valid.');
    return;
  }

  button.disabled = true;
  try {
    if (teacherQrSession) {
      await API.closeAttendanceSession(teacherQrSession.id);
      teacherQrSession = null;
      clearQrTimers();
      stopTeacherAttendanceSubscription();
      document.getElementById('attendanceQrCode').innerHTML = '';
      document.getElementById('qrSessionPanel').classList.add('hidden');
      setTeacherAttendanceControls(false);
    }
    teacherQrSession = await API.startAttendanceSession({
      scheduleId: schedule.id,
      subject: schedule.subject,
      className: schedule.className,
      date: todayISO()
    });
    renderTeacherQr();
    document.getElementById('qrSessionPanel').classList.remove('hidden');
    setTeacherAttendanceControls(true);
    subscribeTeacherAttendance();
    teacherQrRotationTimer = setInterval(rotateTeacherQr, 20_000);
    teacherQrCountdownTimer = setInterval(updateQrCountdown, 1_000);
    Toast.success(`Sesi QR ${schedule.subject} dimulai.`);
  } catch (error) {
    Toast.error(error.message || 'Gagal memulai sesi QR.');
  } finally {
    button.disabled = false;
  }
}

function renderTeacherQr() {
  if (!teacherQrSession) return;
  const target = document.getElementById('attendanceQrCode');
  target.innerHTML = '';
  const payload = {
    v: 1,
    sessionId: teacherQrSession.id,
    token: teacherQrSession.token,
    scheduleId: teacherQrSession.scheduleId,
    subject: teacherQrSession.subject,
    className: teacherQrSession.className,
    date: teacherQrSession.date
  };
  new QRCode(target, {
    text: JSON.stringify(payload),
    width: 240,
    height: 240,
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById('qrSessionSubject').textContent = teacherQrSession.subject;
  document.getElementById('qrSessionInfo').textContent =
    `${teacherQrSession.className} · ${teacherQrSession.date} · QR diperbarui otomatis`;
  updateQrCountdown();
}

async function rotateTeacherQr() {
  if (!teacherQrSession) return;
  try {
    teacherQrSession = await API.rotateAttendanceSession(teacherQrSession.id);
    renderTeacherQr();
  } catch (error) {
    clearQrTimers();
    stopTeacherAttendanceSubscription();
    Toast.error(error.message || 'QR tidak dapat diperbarui. Sesi dihentikan demi keamanan.');
  }
}

function subscribeTeacherAttendance() {
  stopTeacherAttendanceSubscription();
  if (typeof API.subscribeAttendanceByDate !== 'function') return;
  const date = document.getElementById('attendanceDate').value || todayISO();
  const className = document.getElementById('attendanceClass').value;
  teacherAttendanceUnsubscribe = API.subscribeAttendanceByDate(
    date,
    className,
    (rows) => {
      dataAbsensiGuru = rows;
      renderAbsensiGuru();
    },
    (error) => Toast.error(error.message || 'Gagal memantau absensi secara langsung.')
  );
}

function stopTeacherAttendanceSubscription() {
  if (teacherAttendanceUnsubscribe) teacherAttendanceUnsubscribe();
  teacherAttendanceUnsubscribe = null;
}

function updateQrCountdown() {
  if (!teacherQrSession) return;
  const seconds = Math.max(0, Math.ceil((teacherQrSession.expiresAt - Date.now()) / 1000));
  document.getElementById('qrSessionCountdown').textContent =
    seconds > 0 ? `QR kedaluwarsa dalam ${seconds} detik` : 'QR kedaluwarsa · menunggu pembaruan';
}

async function closeTeacherQrSession() {
  if (!teacherQrSession) return;
  try {
    await API.closeAttendanceSession(teacherQrSession.id);
    Toast.success('Sesi absensi ditutup.');
    teacherQrSession = null;
    clearQrTimers();
    stopTeacherAttendanceSubscription();
    document.getElementById('attendanceQrCode').innerHTML = '';
    document.getElementById('qrSessionPanel').classList.add('hidden');
    setTeacherAttendanceControls(false);
  } catch (error) {
    Toast.error(error.message || 'Gagal menutup sesi QR.');
  }
}

function clearQrTimers() {
  clearInterval(teacherQrRotationTimer);
  clearInterval(teacherQrCountdownTimer);
  teacherQrRotationTimer = null;
  teacherQrCountdownTimer = null;
}

function setTeacherAttendanceControls(disabled) {
  document.getElementById('attendanceClass').disabled = disabled;
  document.getElementById('attendanceDate').disabled = disabled;
  document.getElementById('qrSchedule').disabled = disabled;
}

async function muatAbsensiGuru() {
  const className = document.getElementById('attendanceClass').value;
  const date = document.getElementById('attendanceDate').value || todayISO();

  const tbody = document.getElementById('attendanceTableBody');
  tbody.innerHTML = loadingRow(7);

  dataAbsensiGuru = await API.getAttendanceByDate(date, className);
  dataSiswaGuru = semuaSiswaGuru.filter((siswa) => siswa.className === className && siswa.status === 'Aktif');

  renderAbsensiGuru();
}

function renderAbsensiGuru() {
  const keyword = document.getElementById('searchAttendance').value.trim().toLowerCase();
  const tbody = document.getElementById('attendanceTableBody');
  const selectedSchedule = schedulesGuru.find((item) => item.id === document.getElementById('qrSchedule').value);
  const selectedRecords = dataAbsensiGuru.filter((row) =>
    !row.subject || !selectedSchedule || row.subject === selectedSchedule.subject
  );

  const hasil = dataSiswaGuru.filter((siswa) =>
    !keyword || siswa.name.toLowerCase().includes(keyword) || siswa.nis.includes(keyword)
  );

  tbody.innerHTML = hasil.length
    ? hasil.map((siswa, index) => {
        const record = selectedRecords.find((row) => row.studentId === siswa.nis);
        const status = record ? record.status : 'Belum Absen';
        const waktu  = record && record.time ? record.time : '-';

        return `
          <tr>
            <td class="text-center">${index + 1}</td>
            <td class="text-muted">${escapeHtml(siswa.nis)}</td>
            <td class="cell-strong">${escapeHtml(siswa.name)}</td>
            <td>${escapeHtml(siswa.className)}</td>
            <td>${badge(status)}</td>
            <td>${escapeHtml(waktu)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-icon" data-action="status" data-nis="${siswa.nis}" title="Ubah Status">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('')
    : emptyTableRow(7, 'Tidak ada siswa', 'Kelas ini belum memiliki siswa aktif.');

  tbody.querySelectorAll('[data-action="status"]').forEach((button) =>
    button.addEventListener('click', () => openStatusForm(button.dataset.nis)));

  /* Ringkasan */
  const hitung = (status) => selectedRecords.filter((row) => row.status === status).length;
  const sudahAbsen = new Set(selectedRecords.map((row) => row.studentId)).size;
  const belum = dataSiswaGuru.length - sudahAbsen;

  document.getElementById('attendanceSummary').innerHTML = `
    <span class="summary-item"><i class="fa-solid fa-users"></i> Total: <strong>${dataSiswaGuru.length}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Hadir: <strong>${hitung('Hadir')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-file-lines" style="color:#7c3aed"></i> Izin: <strong>${hitung('Izin')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-notes-medical" style="color:#d97706"></i> Sakit: <strong>${hitung('Sakit')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-user-xmark" style="color:#dc2626"></i> Alpa: <strong>${hitung('Alpa')}</strong></span>
    <span class="summary-item"><i class="fa-solid fa-hourglass-half"></i> Belum Absen: <strong>${Math.max(belum, 0)}</strong></span>`;
}

function openStatusForm(nis) {
  const siswa = dataSiswaGuru.find((item) => item.nis === nis);
  if (!siswa) return;

  const record = dataAbsensiGuru.find((row) => row.studentId === nis);

  document.getElementById('statusNis').value = nis;
  document.getElementById('statusStudentInfo').textContent =
    `${siswa.name} — ${siswa.nis} (${siswa.className})`;
  document.getElementById('statusValue').value = record ? record.status : 'Hadir';
  document.getElementById('statusNote').value = record ? (record.note || '') : '';

  openModal('statusModal');
}

async function simpanStatusKehadiran(event) {
  event.preventDefault();

  const nis = document.getElementById('statusNis').value;
  const siswa = dataSiswaGuru.find((item) => item.nis === nis);
  if (!siswa) return;

  const status = document.getElementById('statusValue').value;
  const note   = document.getElementById('statusNote').value.trim();
  const date   = document.getElementById('attendanceDate').value || todayISO();

  try {
    await API.saveAttendance({
      studentId: siswa.nis,
      name: siswa.name,
      className: siswa.className,
      date,
      time: status === 'Hadir' ? currentTime() : '-',
      status,
      note: note || 'Diinput oleh guru'
    });

    Toast.success(`Status ${siswa.name} berhasil diperbarui.`);
    closeModal('statusModal');
    await muatAbsensiGuru();

  } catch (error) {
    Toast.error('Gagal memperbarui status kehadiran.');
  }
}

/* =========================================================
   SISWA
   ========================================================= */

async function initAbsensiSiswa() {
  const session = Session.get();
  const today = todayISO();

  const infoBox    = document.getElementById('attendanceInfo');
  const statusBox  = document.getElementById('attendanceStatusBox');
  const button     = document.getElementById('btnAbsen');
  const scanTarget = document.getElementById('qrScanner');
  const scanMessage = document.getElementById('qrScanMessage');
  const attendanceList = document.getElementById('todaySubjectAttendance');

  infoBox.innerHTML = loadingBlock();

  const student = await API.getStudentByUserId(session.id);
  if (!student) {
    infoBox.innerHTML = '';
    statusBox.className = 'attendance-status warn';
    statusBox.textContent = 'Data siswa tidak ditemukan. Hubungi administrator.';
    statusBox.classList.remove('hidden');
    button.disabled = true;
    return;
  }

  let scanner = null;
  let scanInProgress = false;
  const refreshAttendance = async () => {
    const records = await API.getAttendanceForStudentDate(student.nis, today);
    attendanceList.innerHTML = records.length
      ? records.map((record) => `
          <div>
            <span>${escapeHtml(record.subject || 'Absensi umum')}</span>
            <strong>${escapeHtml(record.status)}${record.time ? ` · ${escapeHtml(record.time)}` : ''}</strong>
          </div>`).join('')
      : '<p class="text-muted">Belum ada absensi mata pelajaran tercatat hari ini.</p>';
    return records;
  };

  const records = await refreshAttendance();

  infoBox.innerHTML = `
    <div><span>Nama</span><strong>${escapeHtml(student.name)}</strong></div>
    <div><span>NIS</span><strong>${escapeHtml(student.nis)}</strong></div>
    <div><span>Kelas</span><strong>${escapeHtml(student.className)}</strong></div>
    <div><span>Tanggal</span><strong>${escapeHtml(formatDateLong(today))}</strong></div>
    <div><span>Mata pelajaran tercatat</span><strong>${records.length}</strong></div>`;

  const stopScanner = async () => {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      await scanner.clear();
    } catch (error) {
      console.warn('Kamera QR tidak dapat dihentikan dengan bersih.', error);
    }
    scanner = null;
    scanTarget.classList.add('hidden');
  };

  button.addEventListener('click', async () => {
    try {
      if (scanner) {
        await stopScanner();
        button.innerHTML = '<i class="fa-solid fa-camera"></i> PINDAI QR MATA PELAJARAN';
        return;
      }
      if (typeof Html5Qrcode === 'undefined') throw new Error('Pemindai QR gagal dimuat. Periksa koneksi internet.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Kamera hanya dapat digunakan melalui HTTPS atau localhost.');
      }
      scanMessage.textContent = 'Izinkan akses kamera, lalu arahkan ke QR yang ditampilkan guru.';
      scanTarget.classList.remove('hidden');
      scanner = new Html5Qrcode('qrScanner');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          if (scanInProgress) return;
          scanInProgress = true;
          button.disabled = true;
          try {
            await stopScanner();
            const payload = JSON.parse(decodedText);
            if (payload.v !== 1) throw new Error('Format QR tidak dikenali.');
            const record = await API.submitQrAttendance(payload);
            statusBox.className = 'attendance-status ok';
            statusBox.classList.remove('hidden');
            statusBox.textContent = `Hadir · ${record.subject}`;
            scanMessage.textContent = 'Absensi berhasil dicatat untuk mata pelajaran tersebut.';
            await refreshAttendance();
            Toast.success(`Absensi ${record.subject} berhasil dicatat.`);
          } catch (error) {
            scanMessage.textContent = error.message || 'QR tidak valid atau sudah kedaluwarsa.';
            Toast.error(error.message || 'QR tidak valid atau sudah kedaluwarsa.');
          } finally {
            scanInProgress = false;
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-camera"></i> PINDAI QR MATA PELAJARAN';
          }
        },
        () => {}
      );
      button.innerHTML = '<i class="fa-solid fa-xmark"></i> TUTUP PEMINDAI';
    } catch (error) {
      await stopScanner();
      scanMessage.textContent = error.message || 'Kamera tidak dapat dibuka.';
      Toast.error(error.message || 'Kamera tidak dapat dibuka.');
      button.disabled = false;
    }
  });
}