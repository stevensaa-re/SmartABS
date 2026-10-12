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
  const backendNotice = document.getElementById('backendNotice');
  if (APP_CONFIG.BACKEND !== 'firebase') {
    backendNotice.classList.remove('hidden');
    document.getElementById('schoolForm').classList.add('hidden');
    return;
  }

  const schoolForm = document.getElementById('schoolForm');
  const platformSection = document.getElementById('platformSection');
  const educationBox = document.getElementById('educationLevels');
  const newEducationBox = document.getElementById('newEducationLevels');

  try {
    const school = await API.getSchoolProfile();
    document.getElementById('schoolName').value = school.name || '';
    document.getElementById('schoolAddress').value = school.address || '';
    document.getElementById('schoolPhone').value = school.phone || '';
    document.getElementById('schoolMajors').value = (school.majors || []).join(', ');
    renderEducationOptions(educationBox, school.educationLevels || ['SMA']);

    if (await API.isPlatformAdmin()) {
      platformSection.classList.remove('hidden');
      renderEducationOptions(newEducationBox, ['SMA']);
    }
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
      await API.updateSchoolProfile({
        name: document.getElementById('schoolName').value,
        address: document.getElementById('schoolAddress').value,
        phone: document.getElementById('schoolPhone').value,
        educationLevels,
        majors: splitSchoolMajors(document.getElementById('schoolMajors').value)
      });
      const session = Session.get();
      if (session) {
        session.schoolName = document.getElementById('schoolName').value.trim();
        Session.set(session, session.remember);
      }
      Toast.success('Profil sekolah berhasil disimpan.');
    } catch (error) {
      Toast.error(error.message || 'Profil sekolah gagal disimpan.');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('newSchoolForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const educationLevels = selectedEducationLevels(newEducationBox);
    if (!educationLevels.length) {
      Toast.error('Pilih minimal satu jenjang pendidikan.');
      return;
    }
    const button = document.getElementById('createSchool');
    button.disabled = true;
    try {
      await API.createSchool({
        name: document.getElementById('newSchoolName').value,
        address: document.getElementById('newSchoolAddress').value,
        phone: document.getElementById('newSchoolPhone').value,
        educationLevels,
        majors: splitSchoolMajors(document.getElementById('newSchoolMajors').value),
        adminName: document.getElementById('newAdminName').value,
        adminUsername: document.getElementById('newAdminUsername').value,
        adminEmail: document.getElementById('newAdminEmail').value,
        adminPassword: document.getElementById('newAdminPassword').value
      });
      event.currentTarget.reset();
      renderEducationOptions(newEducationBox, ['SMA']);
      Toast.success('Sekolah dan admin pertamanya berhasil dibuat.');
    } catch (error) {
      Toast.error(error.message || 'Sekolah gagal dibuat.');
    } finally {
      button.disabled = false;
    }
  });
});
