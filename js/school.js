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

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'school') return;

  const schoolForm = document.getElementById('schoolForm');
  const educationBox = document.getElementById('educationLevels');
  try {
    const school = await API.getSchoolProfile();
    document.getElementById('schoolName').value = school.name || '';
    document.getElementById('schoolAddress').value = school.address || '';
    document.getElementById('schoolPhone').value = school.phone || '';
    document.getElementById('schoolMajors').value = (school.majors || []).join(', ');
    renderEducationOptions(educationBox, school.educationLevels || ['SMA']);
  } catch (error) {
    Toast.error(error.message || 'Gagal memuat profil sekolah.');
    return;
  }

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
      Toast.success('Profil sekolah berhasil disimpan.');
    } catch (error) {
      Toast.error(error.message || 'Profil sekolah gagal disimpan.');
    } finally {
      button.disabled = false;
    }
  });
});
