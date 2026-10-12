# SMARTABS

**Smart Attendance System** untuk mengelola jadwal dan kehadiran sekolah. Website ini menyediakan
panel untuk **admin, guru, dan siswa**; aplikasi Android native menggunakan Firebase yang sama.

> SMARTABS sedang dikembangkan untuk proyek akhir semester. Fitur yang belum tercantum sebagai
tersedia di bawah tidak boleh dianggap sudah siap dipakai.

## Fitur

- Akses sesuai peran: admin, guru, dan siswa.
- Pengelolaan kelas, siswa, guru, akun, jadwal pelajaran, dan pengumuman.
- Jadwal disusun per hari; guru melihat jadwal mengajarnya dan dapat membuka absensi langsung dari
  mata pelajaran pada agenda.
- Absensi QR per mata pelajaran dengan kode yang berganti otomatis; satu siswa hanya dapat
  mencatat kehadiran satu kali per sesi.
- Pengajuan izin/sakit dan persetujuan oleh petugas.
- Filter laporan berdasarkan periode, kelas, mata pelajaran, dan status; ekspor CSV di website.
- Dukungan Firebase Authentication + Cloud Firestore, serta backend MySQL untuk website.

### Sedang direncanakan

Pengembangan lanjutan mencakup kalender akademik dan semester, impor data CSV/Excel, dashboard
wali kelas, cakupan log audit/backup yang lebih luas, notifikasi push, serta aplikasi desktop
Windows. Notifikasi push otomatis membutuhkan pengirim tepercaya; fitur ini ditunda sampai ada
backend yang dapat digunakan tanpa biaya hosting tetap. Rilis desktop belum tersedia.

## Menjalankan website

Gunakan server HTTP lokal (jangan membuka HTML dengan klik dua kali):

```bash
npx serve .
```

Mode `local` memakai `localStorage` browser dan hanya cocok untuk demo. Akun contoh:
`admin/admin123`, `guru/guru123`, dan `siswa/siswa123`. Jangan gunakan akun demo untuk data nyata.

### Backend Firebase

1. Buat Firebase project sendiri dan aktifkan **Authentication → Email/Password** serta
   **Cloud Firestore**.
2. Salin konfigurasi aplikasi web dari Firebase Console ke `js/config.js` dan pilih
   `BACKEND: 'firebase'`.
3. Dari folder ini, deploy rules dan indexes:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

4. Buat pengguna admin melalui Firebase Authentication, lalu buat dokumen `users/{uid}` yang
   sesuai di Firestore. Hubungkan akun guru/siswa dengan profil akademiknya sebelum digunakan.
5. Untuk database yang sudah berisi data, backup dahulu. Jangan menjalankan seed demo pada data
   produksi.

Website dan Android memakai project Firebase yang sama. Android memerlukan file
`app/google-services.json` milik project tersebut; file itu tidak disertakan dalam repository ini.

### Backend MySQL

```bash
cd server
npm install
cp .env.example .env
# Isi DB_*, JWT_SECRET (acak dan minimal 32 karakter), serta CORS_ORIGIN di .env.
npm run db:reset
npm start
```

Atur `BACKEND: 'mysql'` dan `MYSQL.API_URL` di `js/config.js`. Gunakan `npm run db:init` untuk
membuat tabel tanpa data demo. QR per mata pelajaran memerlukan Firebase dan tidak tersedia pada
mode MySQL maupun local.

## Keamanan dan konfigurasi privat

- Jangan commit `serviceAccountKey.json`, `.env`, kunci signing Android, atau file kredensial
  lainnya. Aturan Git mengabaikan file rahasia tersebut.
- Konfigurasi Firebase web (`apiKey`, `projectId`, dan sejenisnya) adalah pengenal aplikasi klien,
  bukan password server. Website tetap harus memuat konfigurasi tersebut agar bisa terhubung ke
  Firebase. Batasi API key sesuai domain web, package Android, dan API yang digunakan; tegakkan
  akses data melalui Firestore Rules.
- Jangan menaruh Firebase Admin SDK atau service-account key pada JavaScript browser maupun APK.
- Browser camera memerlukan HTTPS (atau `localhost`). QR yang sedang aktif masih bisa dibagikan
  dalam waktu singkat; guru perlu mengawasi proses scan.
- Firebase Rules, bukan menu/guard browser, adalah batas otorisasi data sebenarnya. Tinjau rules
  sebelum deploy ke project yang berisi data.

## Struktur repository

```text
admin/                 Halaman admin
guru/                  Halaman guru
siswa/                 Halaman siswa
css/                   Gaya dan layout responsive
js/                    Logika UI, kontrak API, dan adapter backend
js/adapters/           Adapter local, MySQL, dan Firebase
database/firebase/     Firestore Rules, indexes, dan utilitas migrasi/seed
database/mysql/        Skema dan migrasi MySQL
server/                REST API Node.js + MySQL
tools/                 Utilitas persiapan rilis
.github/workflows/     Otomasi GitHub Pages
```

Android native dikembangkan dalam folder project terpisah `SmartabsAndroid` di workspace. Untuk
membangun aplikasi Android, buka folder tersebut dengan Android Studio dan siapkan file
`google-services.json` Firebase lokal.

## Publikasi GitHub Pages

Workflow `.github/workflows/pages.yml` menerbitkan website saat ada push ke branch `main`. Di
repository GitHub, pilih **Settings → Pages → Build and deployment → GitHub Actions**, lalu
tambahkan domain hosting ke **Firebase Authentication → Authorized domains**. Mode Firebase
memerlukan konfigurasi project milik pemilik deployment.

## Catatan produksi

- Pilih Firebase atau MySQL untuk data nyata; jangan gunakan backend `local`.
- Ganti/hapus akun demo dan pastikan email serta status setiap akun benar.
- Untuk MySQL, gunakan HTTPS, akun database dengan hak minimum, dan JWT secret acak.
- Buat backup database terjadwal dan uji prosedur pemulihan sebelum operasi nyata.
- Firestore Spark mendukung CRUD klien langsung, tetapi pekerjaan terjadwal dan push server-side
  memerlukan backend tepercaya.

## Kontribusi pengembangan

Halaman web memanggil `API` di `js/api.js`. Saat menambahkan operasi backend, perbarui
`API_CONTRACT` dan implementasikan pada adapter yang didukung. Untuk perubahan data, perbarui
Firestore Rules, skema/migrasi bila diperlukan, serta dokumentasi setup.
