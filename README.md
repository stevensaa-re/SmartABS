# SMARTABS — Smart Attendance System

Aplikasi absensi sekolah (Admin / Guru / Siswa). Frontend HTML + JS murni, data lewat satu lapisan `API`
sehingga **backend bisa diganti tanpa mengubah halaman**.

| Mode (`js/config.js` → `BACKEND`) | Data disimpan di | Cocok untuk |
|---|---|---|
| `local` (default) | localStorage browser | demo, belajar, pengembangan UI |
| `mysql` | MySQL lewat REST API Node.js (`/server`) | server sekolah / hosting sendiri |
| `firebase` | Firebase Auth + Cloud Firestore | tanpa server, hosting cloud |

---

## 1. Mode `local` (langsung jalan)

Buka lewat web server statis (jangan klik dua kali file HTML):

```bash
npx serve .          # atau: python3 -m http.server 8080 / ekstensi Live Server VS Code
```

Akun demo: `admin/admin123`, `guru/guru123`, `siswa/siswa123`.

## 2. Mode `mysql`

```bash
# 1) siapkan MySQL (buat user khusus, jangan pakai root untuk aplikasi)
# 2) server
cd server
npm install
cp .env.example .env        # isi DB_*, JWT_SECRET (min 32 karakter), CORS_ORIGIN
npm run db:reset            # buat tabel + data demo  (db:init = tabel saja)
npm start                   # http://localhost:3000/api/health

# 3) frontend: js/config.js
BACKEND: 'mysql',
MYSQL: { API_URL: 'http://localhost:3000/api' }
```

`CORS_ORIGIN` harus persis sama dengan alamat tempat frontend dibuka (mis. `http://localhost:5500`).

## 3. Mode `firebase`

1. Firebase Console → buat project → aktifkan **Authentication → Email/Password** dan **Firestore Database**.
2. Isi `APP_CONFIG.FIREBASE` di `js/config.js` (Project settings → Your apps → Web app), set `BACKEND: 'firebase'`.
3. Deploy aturan keamanan: `firebase deploy --only firestore:rules` (file `database/firebase/firestore.rules`).
   Untuk data lama, jalankan migrasi assignment guru setelah menyiapkan Application Default Credentials:
   `cd database/firebase && node migrate-teacher-assignments.js`.
4. Pengelolaan profil/status dan data akademik berjalan langsung ke Firestore pada paket Spark.
   Reset password dikirim ke email login; akun dinonaktifkan tanpa menghapus data/Auth.
5. Untuk mulai tanpa seed script: buat user admin di **Authentication**, lalu buat dokumen
   `users/{uid}` di Firestore dengan field `name`, `username`, `usernameLower`, `role: "admin"`,
   `status: "Aktif"`, dan `email`. Gunakan UID dari Authentication sebagai ID dokumen.
   Setelah login, admin dapat mengelola data dari aplikasi.

Login akun baru memakai email yang dimasukkan admin pada **Data Pengguna**. Untuk kompatibilitas,
akun lama tetap dapat login memakai username yang dipetakan ke domain `FIREBASE_LOGIN_DOMAIN`
di `js/config.js` sampai email Auth-nya disejajarkan.

Panduan lengkap untuk setup project yang sudah berisi data, backup, migrasi profil guru,
deployment rules/indexes, dan setup Android ada di [`../FIREBASE_SETUP.md`](../FIREBASE_SETUP.md).
Riwayat perubahan lintas platform ada di [`../CHANGELOG.md`](../CHANGELOG.md).

### Publikasi di GitHub Pages

Workflow `.github/workflows/pages.yml` menerbitkan situs otomatis setiap ada push ke branch `main`.
Buat repository GitHub, unggah proyek tanpa `serviceAccountKey.json`, lalu pilih
**Settings → Pages → Build and deployment → GitHub Actions**. Tambahkan domain
`<username>.github.io` ke **Firebase Authentication → Settings → Authorized domains**.
`.gitignore` mengabaikan service-account key dan `node_modules`; jangan pernah memaksa menambahkan
key ke repository.

---

## Struktur

```
index.html, login.html          halaman awal
admin/ guru/ siswa/             halaman per role
css/                            style, table, dashboard, login, responsive
js/config.js                    pilih backend & sesi
js/api.js                       dispatcher + daftar kontrak API (API_CONTRACT)
js/adapters/local|mysql|firebase.js
js/guard.js                     proteksi halaman (login + role)
server/                         REST API Express + MySQL
database/mysql/schema.sql       skema MySQL (FK, UNIQUE, ENUM)
database/firebase/              firestore.rules, seed.js
database/seed-data.js           data awal bersama (MySQL & Firebase)
tools/prepare-production.js     hapus data/akun demo sebelum produksi
```

## Menyiapkan produksi

1. `BACKEND` = `mysql` atau `firebase`.
2. Pada **salinan** folder: `node tools/prepare-production.js` (menghapus `mock-data.js`, adapter local, dan tombol akun demo).
3. **Ganti semua password demo** (`admin123`, dst.) atau buat admin baru lalu hapus akun demo.
4. MySQL: pakai HTTPS (reverse proxy), `JWT_SECRET` acak panjang, user DB berhak terbatas, `TRUST_PROXY=1` di belakang Nginx.
5. Cadangkan database secara berkala.

## Catatan keamanan

- Guard di browser (`guard.js`) hanya pengaman tampilan. Hak akses sebenarnya ditegakkan **server** (mode mysql: JWT + cek role + cek kepemilikan data) atau **Firestore Rules** (mode firebase).
- Password: `local` menyimpan polos (khusus demo); `mysql` memakai bcrypt; `firebase` dikelola Firebase Auth.
- Absen mandiri siswa di mode `mysql`: hanya "Hadir", hari ini, sekali, jam diambil dari server. Di mode `firebase` batas hari/jam tidak bisa ditegakkan Rules (zona UTC) — gunakan Cloud Function bila perlu.

## Perbedaan perilaku antar mode

| Hal | local | mysql | firebase |
|---|---|---|---|
| Ganti nama kelas yang sudah dipakai | boleh (merambat) | boleh | **ditolak** (nama disalin ke banyak dokumen) |
| Ubah username / password user lain dari panel admin | boleh | boleh | **tidak** (terikat akun Auth; lewat Firebase Console) |
| Hapus user | hapus akun | hapus akun | hapus profil saja; akun Auth tetap ada (butuh Admin SDK/Cloud Function) |

## Menambah fitur

Tambahkan nama fungsi ke `API_CONTRACT` (`js/api.js`), implementasikan di **ketiga** adapter, lalu panggil `API.namaFungsi()` dari halaman. Konsol browser akan memberi peringatan bila ada adapter yang belum lengkap.
