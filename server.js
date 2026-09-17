'use strict';
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health — MUST be before static & wildcard ──
app.get('/api/health', async (req, res) => {
  try {
    const { query } = require('./db/database');
    const counts = {};
    for (const t of ['items','mesin','bom','masterbom','users']) {
      try { const [r] = await query(`SELECT COUNT(*) as c FROM ${t}`); counts[t] = r.c; }
      catch(e) { counts[t] = '?'; }
    }
    res.json({ status:'ok', time:new Date().toLocaleString('id-ID'), version:'2.0.0', db:counts });
  } catch(e) {
    res.json({ status:'error', error:e.message });
  }
});

// ── API Routes ──
app.use('/api', require('./routes/master'));
app.use('/api', require('./routes/bom'));
app.use('/api', require('./routes/item_prices'));

// ── Static frontend ──
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));

// ── Fallback ──
app.get('*', (req, res) => {
  const idx = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Salin bom-system.html ke public/index.html');
});

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const n of Object.keys(nets))
    for (const net of nets[n])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

// ── Init DB then start ──
const { initSchema } = require('./db/database');
initSchema().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n╔══════════════════════════════════════════╗');
    console.log(  '║   COGM Manufacturing BOM System v2       ║');
    console.log(  '╠══════════════════════════════════════════╣');
    console.log(`║  Local  : http://localhost:${PORT}           ║`);
    console.log(`║  Network: http://${ip}:${PORT}`.padEnd(44)+'║');
    console.log(  '╠══════════════════════════════════════════╣');
    console.log(  '║  Database : MySQL ✅                     ║');
    console.log(  '║  Test     : /api/health                  ║');
    console.log(  '╚══════════════════════════════════════════╝\n');
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} sudah dipakai!`);
      console.error(`   netstat -ano | findstr :${PORT}  →  taskkill /PID <PID> /F\n`);
      process.exit(1);
    }
    throw e;
  });
}).catch(err => {
  console.error('\n❌ Server gagal start!\n');
  console.error('   Error code   :', err.code || '—');
  console.error('   Error message:', err.message);
  console.error('   Error detail :', err.sqlMessage || err.stack?.split('\n')[0] || '—');
  console.error('');
  if (err.code === 'ECONNREFUSED') {
    console.error('   ➡ Pastikan XAMPP MySQL sudah START');
    console.error('   Buka XAMPP Control Panel → klik START di baris MySQL');
  } else if (err.code === 'ER_BAD_DB_ERROR') {
    console.error('   ➡ Database "cogm_db" belum dibuat di phpMyAdmin');
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('   ➡ Username/password salah di config.json');
    console.error('   XAMPP default: user=root, password=kosong');
  } else if (err.code === 'ER_DUP_FIELDNAME') {
    console.error('   ➡ Kolom duplikat saat migrasi — ini seharusnya tertangani otomatis');
    console.error('   Coba hapus database cogm_db di phpMyAdmin lalu buat ulang');
  } else {
    console.error('   ➡ Periksa file config.json dan pastikan MySQL berjalan');
  }
  console.error('');
  process.exit(1);
});
