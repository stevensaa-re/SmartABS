# SMARTABS

**Smart Attendance System** untuk mengelola jadwal dan kehadiran sekolah. Website ini menyediakan
panel untuk **admin, guru, dan siswa**; aplikasi Android native menggunakan Firebase yang sama.

> SMARTABS sedang dikembangkan untuk proyek akhir semester. Fitur yang belum tercantum sebagai
tersedia di bawah tidak boleh dianggap sudah siap dipakai.

## Fitur

- Akses sesuai peran: admin, guru, dan siswa.
- Pengaturan profil untuk satu sekolah: nama, alamat, telepon, jenjang, dan jurusan.
- Pengelolaan kelas, siswa, guru, akun, jadwal pelajaran, dan pengumuman.
- Biodata siswa meliputi NIS/NISN, kelas, jenis kelamin, tempat/tanggal lahir, alamat,
  nama orang tua/wali, dan kontak wali.
- Jadwal disusun per hari; guru melihat jadwal mengajarnya dan dapat membuka absensi langsung dari
  mata pelajaran pada agenda.
- Absensi QR per mata pelajaran dengan kode yang berganti otomatis; satu siswa hanya dapat
  mencatat kehadiran satu kali per sesi.
- Pengajuan izin/sakit dan persetujuan oleh petugas.
- Filter laporan berdasarkan periode, kelas, mata pelajaran, dan status; ekspor CSV di website.
- Kalender akademik untuk kegiatan dan hari libur, tersedia pada website dan Android.
- Dashboard pemantauan wali kelas untuk tren terlambat dan alpa tujuh hari terakhir.
- Impor roster siswa/guru melalui CSV dengan pratinjau, validasi kelas, dan deteksi duplikat.
- Backup JSON dan pemulihan merge tanpa menimpa dokumen yang sudah ada; log audit aktivitas
  penting dan histori koreksi absensi.
- Aplikasi desktop Windows x64 menggunakan UI website; workflow CI menghasilkan installer dan
  portable `.exe`.
- Dukungan Firebase Authentication + Cloud Firestore, serta backend MySQL untuk website.

Notifikasi push saat aplikasi tertutup sengaja ditunda. Pengiriman otomatis memerlukan backend
tepercaya dan tidak diaktifkan pada konfigurasi ini.

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
   Admin dapat mengatur satu profil sekolah dari menu **Profil Sekolah**; konfigurasi tersimpan
   di `schoolSettings/main`, sedangkan data akademik tetap di koleksi utama seperti `students`
   dan `attendance`.
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

Untuk database MySQL lama, buat salinan database lalu jalankan migrasi yang belum diterapkan.
Migrasi profil sekolah dan biodata siswa hanya perlu dijalankan sekali:

```bash
mysql -u smartabs_user -p smartabs < database/mysql/migrate-calendar-audit.sql
mysql -u smartabs_user -p smartabs < database/mysql/migrate-school-student-profile.sql
```

Profil sekolah hanya satu per instalasi. NISN, tempat/tanggal lahir, alamat, serta informasi
orang tua/wali adalah kolom opsional agar data siswa lama tetap dapat dipakai.

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

## Impor, audit, dan backup

Admin membuka menu **Impor, Backup & Audit**. Template impor tersedia untuk data siswa dan guru;
format CSV memakai header `nis,nama,kelas,jenis_kelamin,no_hp` atau
`username,nama,kelas,mata_pelajaran`. Impor guru hanya membuat profil untuk akun guru aktif yang
sudah ada; impor tidak membuat email, akun, atau password. Tautan akun siswa dapat disambungkan
kemudian dari menu Data Siswa.

Backup JSON tidak menyertakan kredensial maupun identitas Firebase Authentication. Pemulihan
bersifat merge: dokumen dengan ID yang sudah digunakan dilewati, bukan ditimpa. Dokumen akun
siswa yang diimpor tidak otomatis ditautkan kembali; hubungkan ulang profil akun secara manual.
Uji proses backup/pemulihan pada salinan project sebelum dipakai untuk data sekolah.

## Aplikasi desktop Windows

Paket Desktop menjalankan UI web melalui server loopback lokal dengan Electron terisolasi (tanpa
Node integration di halaman). Untuk membangun di Windows x64, gunakan Node.js 22.12 atau lebih
baru:

```bash
npm ci
npm run desktop:win
```

Hasil installer NSIS dan portable `.exe` berada di `dist/`. Keduanya menggunakan konfigurasi
Firebase web yang sama seperti `js/config.js`; konfigurasi Firebase klien memang bersifat publik,
tetapi jangan sertakan service-account key atau `.env`. Pada GitHub, workflow
`.github/workflows/desktop.yml` dapat dijalankan manual untuk menghasilkan artifacts atau
dipicu dengan tag `desktop-v*` untuk mengunggah kedua `.exe` ke GitHub Release.

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

Android native dikembangkan dalam folder project terpisah `SmartabsAndroid` di workspace. Android
menyediakan jadwal, kalender, pemantauan keterlambatan wali kelas, impor CSV, ekspor/pemulihan
backup, dan pembacaan log audit admin. Untuk membangun aplikasi Android, buka folder tersebut
dengan Android Studio dan siapkan file `google-services.json` Firebase lokal.

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
- Backup dari menu admin adalah ekspor/pemulihan manual client-side, bukan backup terjadwal.
- Push notification tertunda; fitur itu memerlukan pengirim tepercaya dan belum termasuk dalam
  rilis aplikasi.

## Kontribusi pengembangan

Halaman web memanggil `API` di `js/api.js`. Saat menambahkan operasi backend, perbarui
`API_CONTRACT` dan implementasikan pada adapter yang didukung. Untuk perubahan data, perbarui
Firestore Rules, skema/migrasi bila diperlukan, serta dokumentasi setup.
