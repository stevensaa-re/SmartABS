/* =========================================================
   SMARTABS — Konfigurasi aplikasi
   ---------------------------------------------------------
   Ubah BACKEND untuk memilih sumber data:

     'local'    -> localStorage (demo, tanpa server)
     'mysql'    -> REST API Node.js + MySQL  (lihat folder /server)
     'firebase' -> Firebase Auth + Cloud Firestore

   Halaman HTML dan modul UI TIDAK perlu diubah saat berpindah
   backend, karena semuanya hanya memanggil objek API.
   ========================================================= */

const APP_CONFIG = {

  BACKEND: 'firebase',

  /* ---------- MySQL (REST API di folder /server) ---------- */
  MYSQL: {
    API_URL: 'http://localhost:3000/api'
  },

  /* ---------- Firebase ----------
     Isi dari: Firebase Console > Project settings > Your apps > Web app */
  FIREBASE: {
    apiKey: 'AIzaSyAn54f-U7qqpHPyz-S3KYn4lhwdRzd6jkE',
    authDomain: 'smartabs-e069c.firebaseapp.com',
    projectId: 'smartabs-e069c',
    storageBucket: 'smartabs-e069c.firebasestorage.app',
    messagingSenderId: '506493403997',
    appId: '1:506493403997:web:ee7b6d48d06e6d30f55eb4',
    measurementId: 'G-N3RJBY96W0'
  },

    /* Akun lama dapat login dengan username yang dipetakan ke domain ini.
      Akun baru memakai email Firebase Auth yang diinput saat dibuat. */
  FIREBASE_LOGIN_DOMAIN: 'gmail.com',

  /* ---------- Sesi ---------- */
  SESSION_HOURS: 12,      // masa berlaku sesi biasa
  REMEMBER_DAYS: 30,      // masa berlaku jika "Ingat saya" dicentang

  /* Tampilkan tombol akun demo di halaman login (hanya efektif di mode 'local') */
  SHOW_DEMO_ACCOUNTS: true
};
