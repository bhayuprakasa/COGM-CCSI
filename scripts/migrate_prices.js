/**
 * Migrasi data harga bahan baku dari data/price_import.json ke MySQL.
 * Jalankan setelah migrate.js: node scripts/migrate_prices.js
 */
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'cogm',
};

async function main() {
  // Gabungkan dua file split agar tetap di bawah batas ukuran GitHub push
  const lines = [
    ...JSON.parse(fs.readFileSync(path.join(__dirname, '../data/price_import_1.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(__dirname, '../data/price_import_2.json'), 'utf8')),
  ];
  console.log(`📋 Migrasi ${lines.length} price lines...`);

  const conn = await mysql.createConnection(dbConfig);

  // Pastikan tabel prices & price_lines ada
  await conn.query(`CREATE TABLE IF NOT EXISTS prices (
    id VARCHAR(50) PRIMARY KEY,
    created_by VARCHAR(50), created_dt VARCHAR(30),
    modified_by VARCHAR(50), modified_dt VARCHAR(30)
  )`);
  await conn.query(`CREATE TABLE IF NOT EXISTS price_lines (
    id VARCHAR(50) PRIMARY KEY,
    price_id VARCHAR(50), item_code VARCHAR(50), item_name TEXT,
    qty DOUBLE, currency VARCHAR(10), price DOUBLE,
    hedging DOUBLE, landed DOUBLE,
    modified_by VARCHAR(50), modified_dt VARCHAR(30),
    INDEX idx_item_code (item_code)
  )`);

  // Buat satu price header jika belum ada
  const priceId = 'PRC80e6d870ef7bed15';
  await conn.query(
    `INSERT IGNORE INTO prices (id, created_by, created_dt, modified_by, modified_dt)
     VALUES (?, 'import', '10/11/2026 00.00.00', 'import', '10/11/2026 00.00.00')`,
    [priceId]
  );

  let ok = 0, skip = 0;
  for (const l of lines) {
    try {
      await conn.query(
        `INSERT IGNORE INTO price_lines
         (id, price_id, item_code, item_name, qty, currency, price, hedging, landed, modified_by, modified_dt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [l.id, priceId, l.item_code, l.item_name, l.qty||1,
         l.currency||'USD', l.price||0, l.hedging||0, l.landed||0,
         l.modified_by||'import', l.modified_dt||'']
      );
      ok++;
    } catch (e) {
      console.warn(`  ⚠️  ${l.item_code}: ${e.message}`);
      skip++;
    }
  }

  await conn.end();
  console.log(`✅ Selesai: ${ok} inserted, ${skip} skipped`);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
