/* =========================================================
   SMARTABS — Autentikasi & Session
   Mengelola login, logout, dan penyimpanan sesi pengguna.
   ========================================================= */

const SESSION_KEY = 'smartabs_session';

const Session = {

  /* Mengambil sesi aktif (localStorage untuk "Ingat saya", sessionStorage untuk sesi biasa).
     Sesi yang sudah melewati masa berlakunya otomatis dihapus. */
  get() {
    try {
      const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);
      const config = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
      const hours = data.remember ? (config.REMEMBER_DAYS || 30) * 24 : (config.SESSION_HOURS || 12);
      const age = Date.now() - new Date(data.loginAt).getTime();

      if (!data.loginAt || isNaN(age) || age > hours * 3600 * 1000) {
        Session.clear();
        return null;
      }
      return data;
    } catch (error) {
      return null;
    }
  },

  /* Menyimpan sesi */
  set(user, remember = false) {
    const data = { ...user, remember: !!remember, loginAt: new Date().toISOString() };
    const payload = JSON.stringify(data);

    if (remember) {
      localStorage.setItem(SESSION_KEY, payload);
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, payload);
      localStorage.removeItem(SESSION_KEY);
    }
  },

  /* Menghapus sesi */
  clear() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  },

  /* Memastikan user punya role tertentu */
  hasRole(role) {
    const session = Session.get();
    return !!session && session.role === role;
  }
};

/* =========================================================
   Login Page Controller
   Hanya berjalan pada halaman login.html
   ========================================================= */

function initLoginPage() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  /* Jika sudah login, langsung arahkan ke dashboard */
  const existing = Session.get();
  if (existing) {
    window.location.replace(`${existing.role}/dashboard.html`);
    return;
  }

  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const toggleButton  = document.getElementById('togglePassword');
  const rememberInput = document.getElementById('rememberMe');
  const errorBox      = document.getElementById('loginError');
  const errorText     = document.getElementById('loginErrorText');
  const submitButton  = document.getElementById('loginButton');
  const buttonText    = submitButton.querySelector('.btn-text');
  const buttonSpinner = submitButton.querySelector('.spinner');

  /* Akun demo hanya relevan pada mode local */
  const demoBox = document.querySelector('.demo-accounts');
  if (demoBox && !(APP_CONFIG.BACKEND === 'local' && APP_CONFIG.SHOW_DEMO_ACCOUNTS)) {
    demoBox.remove();
  }

  /* ---------- Show / hide password ---------- */
  toggleButton.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleButton.innerHTML = isPassword
      ? '<i class="fa-solid fa-eye-slash"></i>'
      : '<i class="fa-solid fa-eye"></i>';
  });

  /* ---------- Isi otomatis akun demo ---------- */
  document.querySelectorAll('.demo-account').forEach((button) => {
    button.addEventListener('click', () => {
      usernameInput.value = button.dataset.username;
      passwordInput.value = button.dataset.password;
      hideError();
      usernameInput.focus();
    });
  });

  function showError(message) {
    errorText.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function hideError() {
    errorBox.classList.add('hidden');
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    buttonText.textContent = isLoading ? 'Memproses...' : 'Masuk';
    buttonSpinner.classList.toggle('hidden', !isLoading);
  }

  /* ---------- Submit ---------- */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError('Username dan password wajib diisi.');
      return;
    }

    setLoading(true);

    try {
      const result = await API.login(username, password);

      if (!result.ok) {
        showError(result.message);
        setLoading(false);
        return;
      }

      /* Lengkapi data sesi untuk role siswa (NIS & kelas) */
      const user = { ...result.user };
      if (result.token) user.token = result.token; // JWT (mode MySQL)

      if (user.role === 'siswa') {
        const student = await API.getStudentByUserId(user.id);
        if (student) {
          user.nis = student.nis;
          user.className = student.className;
        }
      }

      Session.set(user, rememberInput.checked);
      Toast.success(`Selamat datang, ${user.name}!`, 'Mengalihkan ke dashboard...');

      setTimeout(() => {
        window.location.replace(`${user.role}/dashboard.html`);
      }, 500);

    } catch (error) {
      showError(error && error.message ? error.message : 'Terjadi kesalahan pada sistem. Silakan coba lagi.');
      setLoading(false);
    }
  });
}

/* =========================================================
   Splash / index.html — arahkan otomatis
   ========================================================= */

function initSplashPage() {
  if (!document.body.classList.contains('page-splash')) return;

  const session = Session.get();

  setTimeout(() => {
    window.location.replace(session ? `${session.role}/dashboard.html` : 'login.html');
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initSplashPage();
});