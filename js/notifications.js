/* =========================================================
   SMARTABS — Notifikasi (Toast) & Dialog Konfirmasi
   ========================================================= */

const Toast = {

  /* Membuat container sekali saja */
  container() {
    let element = document.querySelector('.toast-container');
    if (!element) {
      element = document.createElement('div');
      element.className = 'toast-container';
      document.body.appendChild(element);
    }
    return element;
  },

  /* Menampilkan toast */
  show(message, type = 'info', title = '') {
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-xmark',
      warning: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    };

    const titles = {
      success: 'Berhasil',
      error: 'Gagal',
      warning: 'Perhatian',
      info: 'Informasi'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type] || icons.info}"></i>
      <div>
        <strong>${escapeHtml(title || titles[type])}</strong>
        <span>${escapeHtml(message)}</span>
      </div>`;

    Toast.container().appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  },

  success(message, title = '') { Toast.show(message, 'success', title); },
  error(message, title = '')   { Toast.show(message, 'error', title); },
  warning(message, title = '') { Toast.show(message, 'warning', title); },
  info(message, title = '')    { Toast.show(message, 'info', title); }
};

/* =========================================================
   Dialog konfirmasi (menggantikan window.confirm)
   Mengembalikan Promise<boolean>
   ========================================================= */

function confirmDialog({
  title = 'Konfirmasi',
  message = 'Apakah Anda yakin?',
  confirmText = 'Ya, Lanjutkan',
  cancelText = 'Batal',
  danger = false
} = {}) {
  return new Promise((resolve) => {

    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <p style="font-size:13.5px;color:#475569;margin:0;">${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    function close(result) {
      modal.remove();
      document.body.style.overflow = '';
      resolve(result);
    }

    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close(false);
    });
  });
}