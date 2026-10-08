/* =========================================================
   Menyiapkan folder untuk produksi (mode mysql / firebase):
   - menghapus data & akun demo (mock-data.js, adapters/local.js)
   - menghapus blok "akun demo" di login.html
   Jalankan dari folder utama proyek:  node tools/prepare-production.js
   JALANKAN PADA SALINAN folder, bukan satu-satunya salinan Anda.
   ========================================================= */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'server', 'database', 'tools'].includes(entry.name) ? [] : htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

let changed = 0;
for (const file of htmlFiles(root)) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  html = html.replace(/[ \t]*<script src="[^"]*js\/mock-data\.js"><\/script>\r?\n?/g, '');
  html = html.replace(/[ \t]*<script src="[^"]*js\/adapters\/local\.js"><\/script>\r?\n?/g, '');
  html = html.replace(/\s*<div class="demo-accounts">[\s\S]*?<\/div>\s*<\/div>\s*(?=<\/form>)/, '\n      ');

  if (html !== before) { fs.writeFileSync(file, html); changed++; }
}

for (const rel of ['js/mock-data.js', 'js/adapters/local.js']) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

console.log(`Selesai: ${changed} halaman diperbarui, file demo dihapus.`);
console.log('Pastikan APP_CONFIG.BACKEND di js/config.js sudah "mysql" atau "firebase".');
