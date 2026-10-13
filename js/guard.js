/* =========================================================
   SMARTABS — Route guard
   Dimuat di awal <body> pada setiap halaman terproteksi.
   Memastikan pengguna sudah login dan memakai role yang tepat.

   CATATAN: ini hanya pengaman tampilan (UX). Hak akses yang
   sebenarnya ditegakkan oleh server (MySQL) atau Firestore Rules.
   ========================================================= */

(function guardPage() {
  const requiredRole = document.body.dataset.role;
  const session = Session.get();

  function redirect(target) {
    /* Sembunyikan halaman agar konten tidak sempat berkedip */
    document.documentElement.style.visibility = 'hidden';
    window.location.replace(target);
  }

  if (!session) {
    redirect(document.body.dataset.loginTarget || '../login.html');
    return;
  }

  if (requiredRole && session.role !== requiredRole) {
    redirect(`../${session.role}/dashboard.html`);
  }
})();
