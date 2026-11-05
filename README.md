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
- Kalender akademik untuk kegiatan dan hari libur, tersedia pada website dan Android.
- Dashboard pemantauan wali kelas untuk tren terlambat dan alpa tujuh hari terakhir.
- Impor roster siswa/guru melalui CSV dengan pratinjau, validasi kelas, dan deteksi duplikat.
- Backup JSON dan pemulihan merge tanpa menimpa dokumen yang sudah ada; log audit aktivitas
  penting dan histori koreksi absensi.
- Aplikasi desktop Windows x64 menggunakan UI website; workflow CI menghasilkan installer dan
  portable `.exe`.
- Firebase Authentication + Cloud Firestore sebagai backend utama website dan Android.
- Cloud Functions untuk provisioning akun serta operasi QR yang tidak boleh dipercaya pada klien.

MySQL dan `localStorage` masih tersedia sebagai kode/demo legacy, tetapi bukan backend produksi,
bukan sumber data Android/Desktop, dan tidak menyediakan sinkronisasi lintas platform. Firebase
adalah satu-satunya sumber data yang didukung untuk penggunaan bersama.
Notifikasi push, unggahan Storage, dan integrasi tenant Android/migrasi data multi-sekolah belum
selesai; lihat
[FIREBASE_SETUP.md](./FIREBASE_SETUP.md) dan [REBUILD_PROGRESS.md](../REBUILD_PROGRESS.md).

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

4. Pasang Cloud Functions dengan Node.js 22 sesuai
   [FIREBASE_SETUP.md](./FIREBASE_SETUP.md); provisioning akun dan QR memerlukannya.
5. Buat sekolah dan akun admin melalui proses bootstrap tepercaya yang didokumentasikan di sana.
   Jangan mengaktifkan penggunaan multi-sekolah sebelum migrasi tenant dan pengujian Rules selesai.
6. Untuk project yang sudah berisi data, buat backup dan verifikasi rencana migrasi sebelum
   mengubah dokumen. Tidak ada deployment Firebase yang dijalankan oleh panduan ini.

Website dan Android memakai project Firebase yang sama. Android memerlukan file
`app/google-services.json` milik project tersebut; file itu tidak disertakan dalam repository ini.

### MySQL legacy (bukan backend produksi)

Kode REST/MySQL dipertahankan untuk kompatibilitas dan pengujian proyek lama. Jangan memilih
`BACKEND: 'mysql'` untuk instalasi sekolah atau menghubungkannya ke aplikasi Android/Desktop;
operasi itu akan membentuk sumber data terpisah dan tidak memenuhi arsitektur SMARTABS.

```bash
cd server
npm install
cp .env.example .env
# Isi DB_*, JWT_SECRET (acak dan minimal 32 karakter), serta CORS_ORIGIN di .env.
npm run db:init
# Opsional, hanya untuk database kosong/demo:
npm run db:seed
npm start
```

`db:init` hanya membuat database/tabel yang belum ada dan tidak menghapus data. `db:seed`
memasukkan data demo ke database kosong; jangan jalankan pada data sekolah. Perintah reset
destruktif hanya diizinkan untuk `DB_NAME=smartabs_demo`, bukan pada `NODE_ENV=production`,
dan memerlukan konfirmasi eksplisit:

```bash
DB_NAME=smartabs_demo npm run db:reset -- --confirm-destructive-reset
```

Perintah `db:init` tetap non-destruktif, tetapi skema dan migrasi MySQL bukan skema utama SMARTABS.
Mode local/MySQL tidak mendukung backend terpadu Firebase Functions dan alur QR saat ini.

Untuk database MySQL lama, buat salinan database lalu jalankan migrasi kalender/audit:

```bash
mysql -u smartabs_user -p smartabs < database/mysql/migrate-calendar-audit.sql
```

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
Desktop mengizinkan kamera hanya untuk halaman SMARTABS lokal agar pemindaian QR absensi berfungsi;
akses mikrofon dan permintaan izin dari origin lain tetap ditolak.

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

## Catatan kesiapan

- Gunakan Firebase; jangan gunakan backend `local` atau MySQL untuk data sekolah.
- Ganti/hapus akun demo dan pastikan email serta status setiap akun benar.
- Atur backup terjadwal pada Firebase dan uji pemulihan; ekspor dari menu admin adalah backup
  manual client-side, bukan backup terjadwal.
- Isolasi multi-sekolah, push notification, dan sebagian integrasi platform masih berstatus
  pekerjaan berjalan; jangan gunakan sebagai sistem produksi multi-tenant sebelum gerbang akhir
  pada [REBUILD_PROGRESS.md](../REBUILD_PROGRESS.md) ditutup.

## Kontribusi pengembangan

Halaman web memanggil `API` di `js/api.js`. Saat menambahkan operasi backend, perbarui
`API_CONTRACT` dan implementasikan pada adapter yang didukung. Untuk perubahan data, perbarui
Firestore Rules, skema/migrasi bila diperlukan, serta dokumentasi setup.
