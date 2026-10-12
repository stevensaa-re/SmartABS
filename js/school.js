const SCHOOL_LEVELS = ['SD', 'SMP', 'SMA', 'SMK'];

function renderEducationOptions(container, selected = ['SMA']) {
  container.innerHTML = SCHOOL_LEVELS.map((level) => `
    <label style="display:inline-flex;align-items:center;gap:6px;margin:0 16px 8px 0">
      <input type="checkbox" value="${level}" ${selected.includes(level) ? 'checked' : ''}>
      <span>${level}</span>
    </label>`).join('');
}

function selectedEducationLevels(container) {
  return [...container.querySelectorAll('input:checked')].map((input) => input.value);
}

function splitSchoolMajors(value) {
  return [...new Set(String(value || '').split(',').map((major) => major.trim()).filter(Boolean))];
}

function renderSchoolIdentityPreview() {
  const name = document.getElementById('schoolName').value.trim();
  const address = document.getElementById('schoolAddress').value.trim();
  const levels = selectedEducationLevels(document.getElementById('educationLevels'));
  const majors = splitSchoolMajors(document.getElementById('schoolMajors').value);
  document.getElementById('schoolPreviewName').textContent = name || 'Nama sekolah';
  document.getElementById('schoolPreviewAddress').textContent = address || 'Alamat sekolah belum diisi';
  document.getElementById('schoolPreviewLevels').textContent =
    `Jenjang tersedia: ${levels.length ? levels.join(', ') : 'belum dipilih'}`;
  document.getElementById('schoolPreviewMajors').textContent =
    `Jurusan tersedia: ${majors.length ? majors.join(', ') : 'belum diisi'}`;
}

function renderSchoolImpact(classes) {
  const notice = document.getElementById('schoolImpactNotice');
  const levels = selectedEducationLevels(document.getElementById('educationLevels'));
  const majors = splitSchoolMajors(document.getElementById('schoolMajors').value);
  const affectedClasses = classes.filter((item) => {
    const level = item.educationLevel || 'SMA';
    const removesLevel = !levels.includes(level);
    const removesMajor = ['SMA', 'SMK'].includes(level) && item.major &&
      !majors.includes(item.major);
    return removesLevel || removesMajor;
  });

  if (!affectedClasses.length) {
    notice.hidden = true;
    notice.replaceChildren();
    return;
  }

  const affectedDetails = affectedClasses.map((item) => {
    const level = item.educationLevel || 'SMA';
    return `${item.name} (${level}${item.major ? ` · ${item.major}` : ''})`;
  });
  notice.hidden = false;
  notice.innerHTML = `
    <span>Perubahan ini belum bisa disimpan karena jenjang/jurusan berikut masih dipakai kelas:
      ${escapeHtml(affectedDetails.join(', '))}.
      Ubah data kelas tersebut terlebih dahulu.</span>
    <a class="btn btn-outline" href="classes.html">Buka Data Kelas</a>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'school') return;

  const schoolForm = document.getElementById('schoolForm');
  const educationBox = document.getElementById('educationLevels');
  let existingClasses = [];
  try {
    const [school, classes] = await Promise.all([API.getSchoolProfile(), API.getClasses()]);
    existingClasses = classes;
    document.getElementById('schoolName').value = school.name || '';
    document.getElementById('schoolAddress').value = school.address || '';
    document.getElementById('schoolPhone').value = school.phone || '';
    document.getElementById('schoolMajors').value = (school.majors || []).join(', ');
    renderEducationOptions(educationBox, school.educationLevels || ['SMA']);
    renderSchoolIdentityPreview();
  } catch (error) {
    Toast.error(error.message || 'Gagal memuat profil sekolah.');
    return;
  }

  schoolForm.addEventListener('input', renderSchoolIdentityPreview);
  schoolForm.addEventListener('input', () => renderSchoolImpact(existingClasses));
  schoolForm.addEventListener('change', () => {
    renderSchoolIdentityPreview();
    renderSchoolImpact(existingClasses);
  });

  schoolForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const educationLevels = selectedEducationLevels(educationBox);
    if (!educationLevels.length) {
      Toast.error('Pilih minimal satu jenjang pendidikan.');
      return;
    }
    const button = document.getElementById('saveSchool');
    button.disabled = true;
    try {
      const school = await API.updateSchoolProfile({
        name: document.getElementById('schoolName').value,
        address: document.getElementById('schoolAddress').value,
        phone: document.getElementById('schoolPhone').value,
        educationLevels,
        majors: splitSchoolMajors(document.getElementById('schoolMajors').value)
      });
      const session = Session.get();
      if (session) {
        session.schoolName = school.name;
        Session.set(session, session.remember);
      }
      const subtitle = document.querySelector('#navbar .navbar-title p');
      if (subtitle) subtitle.textContent = `${school.name} · Smart Attendance System`;
      renderSchoolImpact(existingClasses);
      Toast.success('Profil sekolah berhasil disimpan.');
    } catch (error) {
      Toast.error(error.message || 'Profil sekolah gagal disimpan.');
    } finally {
      button.disabled = false;
    }
  });
});
