// scripts/backup.js
const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '..', 'data', 'cogm.json');
const BACK_DIR = path.join(__dirname, '..', 'data', 'backups');

if (!fs.existsSync(BACK_DIR)) fs.mkdirSync(BACK_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH))  { console.log('Database belum ada, skip backup.'); process.exit(0); }

const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const dest = path.join(BACK_DIR, `cogm_${ts}.json`);
fs.copyFileSync(DB_PATH, dest);
console.log(`✅ Backup berhasil: ${dest}`);

// Keep only last 30 backups
const files = fs.readdirSync(BACK_DIR).filter(f=>f.endsWith('.json')).sort();
while (files.length > 30) {
  const old = files.shift();
  fs.unlinkSync(path.join(BACK_DIR, old));
  console.log(`🗑  Dihapus: ${old}`);
}
