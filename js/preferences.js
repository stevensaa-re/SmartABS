const DEFAULT_PREFERENCES = {
  theme: 'system',
  accent: 'blue',
  fontSize: 'normal',
  density: 'comfortable'
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'preferences') return;
  const session = Session.get();
  if (!session) return;

  const storageKey = `smartabs.preferences.${session.id}`;
  const savedStatus = document.getElementById('preferencesSaved');
  let preferences = { ...DEFAULT_PREFERENCES, ...currentUserPreferences() };

  const apply = () => {
    preferences = {
      theme: ['light', 'dark', 'system'].includes(preferences.theme) ? preferences.theme : 'system',
      accent: ['blue', 'violet', 'teal'].includes(preferences.accent) ? preferences.accent : 'blue',
      fontSize: ['small', 'normal', 'large'].includes(preferences.fontSize) ? preferences.fontSize : 'normal',
      density: ['comfortable', 'compact'].includes(preferences.density) ? preferences.density : 'comfortable'
    };
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    applyUserPreferences();
    savedStatus.textContent = 'Tersimpan otomatis di perangkat ini.';
  };

  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === preferences.theme;
    input.addEventListener('change', () => {
      preferences.theme = input.value;
      apply();
    });
  });
  document.querySelectorAll('input[name="accent"]').forEach((input) => {
    input.checked = input.value === preferences.accent;
    input.addEventListener('change', () => {
      preferences.accent = input.value;
      apply();
    });
  });

  const fontSize = document.getElementById('fontSize');
  fontSize.value = preferences.fontSize;
  fontSize.addEventListener('change', () => {
    preferences.fontSize = fontSize.value;
    apply();
  });

  const compactMode = document.getElementById('compactMode');
  compactMode.checked = preferences.density === 'compact';
  compactMode.addEventListener('change', () => {
    preferences.density = compactMode.checked ? 'compact' : 'comfortable';
    apply();
  });

  document.getElementById('resetPreferences').addEventListener('click', () => {
    preferences = { ...DEFAULT_PREFERENCES };
    document.querySelector('input[name="theme"][value="system"]').checked = true;
    document.querySelector('input[name="accent"][value="blue"]').checked = true;
    fontSize.value = 'normal';
    compactMode.checked = false;
    apply();
  });
});
