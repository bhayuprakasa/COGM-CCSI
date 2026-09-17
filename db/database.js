// db/database.js — MySQL/XAMPP via mysql2
'use strict';
const mysql = require('mysql2/promise');
const path  = require('path');
const fs    = require('fs');

const CFG_PATH = path.join(__dirname, '..', 'config.json');
let cfg = { host:'localhost', port:3306, user:'root', password:'', database:'cogm_db' };
if (fs.existsSync(CFG_PATH)) {
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH,'utf8'))); }
  catch(e) { console.warn('config.json error:', e.message); }
}

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: cfg.host, port: cfg.port || 3306,
      user: cfg.user, password: cfg.password || '',
      database: cfg.database,
      waitForConnections: true,
      connectionLimit:    5,
      queueLimit:         0,
      connectTimeout:     30000,
      charset:            'utf8mb4',
    });
    // Test with single connection
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log(`✅ MySQL connected: ${cfg.host}:${cfg.port||3306}/${cfg.database}`);
  }
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// ── Run all schema in ONE dedicated connection ──
async function initSchema() {
  const p    = await getPool();
  const conn = await p.getConnection();
  try {
    console.log('   Creating tables...');

    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL, nama VARCHAR(200) NOT NULL,
        role VARCHAR(100) NOT NULL DEFAULT 'viewer', custom_pages TEXT,
        created_dt VARCHAR(50), updated_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS items (
        id VARCHAR(50) PRIMARY KEY, code VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL, uom VARCHAR(50) NOT NULL,
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS item_prices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_code VARCHAR(100) NOT NULL,
        currency VARCHAR(20) DEFAULT 'USD',
        price DECIMAL(20,6) DEFAULT 0,
        hedging DECIMAL(10,4) DEFAULT 0,
        landed DECIMAL(10,4) DEFAULT 0,
        effective_date VARCHAR(50),
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50),
        UNIQUE KEY uk_item_code (item_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS item_price_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_code VARCHAR(100) NOT NULL,
        old_price DECIMAL(20,6) DEFAULT 0,
        new_price DECIMAL(20,6) DEFAULT 0,
        old_currency VARCHAR(20),
        new_currency VARCHAR(20),
        old_hedging DECIMAL(10,4) DEFAULT 0,
        new_hedging DECIMAL(10,4) DEFAULT 0,
        old_landed DECIMAL(10,4) DEFAULT 0,
        new_landed DECIMAL(10,4) DEFAULT 0,
        old_effective_date VARCHAR(50),
        new_effective_date VARCHAR(50),
        changed_by VARCHAR(100),
        changed_dt VARCHAR(50),
        note VARCHAR(255)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS exrates (
        id VARCHAR(100) PRIMARY KEY, currency_id VARCHAR(20) UNIQUE NOT NULL,
        created_dt VARCHAR(50), updated_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS exrate_lines (
        id INT AUTO_INCREMENT PRIMARY KEY, exrate_id VARCHAR(100) NOT NULL,
        tanggal VARCHAR(50), rate DECIMAL(20,6) DEFAULT 0,
        rate_conversion DECIMAL(20,6) DEFAULT 1,
        FOREIGN KEY (exrate_id) REFERENCES exrates(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS dlfoh (
        id VARCHAR(100) PRIMARY KEY, catid VARCHAR(100) UNIQUE NOT NULL,
        \`desc\` VARCHAR(255), type VARCHAR(50), rate DECIMAL(20,4) DEFAULT 0,
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS mesin (
        id VARCHAR(100) PRIMARY KEY, machine_id VARCHAR(100) UNIQUE NOT NULL,
        machine_name VARCHAR(255) NOT NULL, machine_line VARCHAR(100) NOT NULL,
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS kapasitas (
        id VARCHAR(100) PRIMARY KEY, kapid VARCHAR(100) UNIQUE NOT NULL,
        item_code VARCHAR(100), item_name VARCHAR(255), proses VARCHAR(255),
        machine_id VARCHAR(100), machine_name VARCHAR(255),
        tube INT DEFAULT 0, fiber INT DEFAULT 0,
        kecepatan DECIMAL(15,4) DEFAULT 0, dl INT DEFAULT 0,
        efisiensi DECIMAL(10,4) DEFAULT 0, notes TEXT,
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS masterbom (
        id VARCHAR(100) PRIMARY KEY, bomid VARCHAR(50) UNIQUE NOT NULL,
        product VARCHAR(255) NOT NULL, customer VARCHAR(255),
        project VARCHAR(255), fiber_cnt VARCHAR(50),
        buffer_qty VARCHAR(50), fiber_qty VARCHAR(50),
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS masterbom_groups (
        id VARCHAR(100) PRIMARY KEY, masterbom_id VARCHAR(100) NOT NULL,
        machine_line VARCHAR(100), machine_id VARCHAR(100), kap_id VARCHAR(100),
        speed DECIMAL(10,4) DEFAULT 1, kap_pct DECIMAL(10,4) DEFAULT 100,
        dl_lot DECIMAL(10,4) DEFAULT 1, foh_lot DECIMAL(10,4) DEFAULT 1,
        sort_order INT DEFAULT 0,
        FOREIGN KEY (masterbom_id) REFERENCES masterbom(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS masterbom_lines (
        id INT AUTO_INCREMENT PRIMARY KEY, group_id VARCHAR(100) NOT NULL,
        item_code VARCHAR(100), item_name VARCHAR(255), uom VARCHAR(50),
        qty DECIMAL(15,4) DEFAULT 0, scrap DECIMAL(10,4) DEFAULT 0,
        factor DECIMAL(10,4) DEFAULT 1, total_qty DECIMAL(15,4) DEFAULT 0,
        sort_order INT DEFAULT 0,
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS masterbom_dlfoh (
        id INT AUTO_INCREMENT PRIMARY KEY, group_id VARCHAR(100) NOT NULL,
        cat VARCHAR(100), type VARCHAR(50),
        idx DECIMAL(15,6) DEFAULT 0, index_manual TINYINT DEFAULT 0,
        setup DECIMAL(10,4) DEFAULT 0, factor DECIMAL(10,4) DEFAULT 1,
        total_hour DECIMAL(15,6) DEFAULT 0, sort_order INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS bom (
        id VARCHAR(100) PRIMARY KEY, bomid VARCHAR(50) UNIQUE NOT NULL,
        product VARCHAR(255) NOT NULL, customer VARCHAR(255),
        project VARCHAR(255), fiber_cnt VARCHAR(50),
        buffer_qty VARCHAR(50), fiber_qty VARCHAR(50),
        price_id VARCHAR(100), master_bom_id VARCHAR(100),
        usd_rate_snapshot DECIMAL(20,4) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'draft',
        submitted_by VARCHAR(100), submitted_dt VARCHAR(50),
        approved_by VARCHAR(100), approval_date VARCHAR(50), approval_note TEXT,
        approved_by_l1 VARCHAR(100), approval_date_l1 VARCHAR(50), approval_note_l1 TEXT,
        approved_by_l2 VARCHAR(100), approval_date_l2 VARCHAR(50), approval_note_l2 TEXT,
        approved_by_l3 VARCHAR(100), approval_date_l3 VARCHAR(50), approval_note_l3 TEXT,
        created_by VARCHAR(100), created_dt VARCHAR(50),
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS bom_groups (
        id VARCHAR(100) PRIMARY KEY, bom_id VARCHAR(100) NOT NULL,
        machine_line VARCHAR(100), machine_id VARCHAR(100), kap_id VARCHAR(100),
        speed DECIMAL(10,4) DEFAULT 1, kap_pct DECIMAL(10,4) DEFAULT 100,
        dl_lot DECIMAL(10,4) DEFAULT 1, foh_lot DECIMAL(10,4) DEFAULT 1,
        sort_order INT DEFAULT 0,
        FOREIGN KEY (bom_id) REFERENCES bom(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS bom_lines (
        id INT AUTO_INCREMENT PRIMARY KEY, group_id VARCHAR(100) NOT NULL,
        item_code VARCHAR(100), item_name VARCHAR(255), uom VARCHAR(50),
        qty DECIMAL(15,4) DEFAULT 0, scrap DECIMAL(10,4) DEFAULT 0,
        factor DECIMAL(10,4) DEFAULT 1, total_qty DECIMAL(15,4) DEFAULT 0,
        currency VARCHAR(20) DEFAULT 'USD', price DECIMAL(20,6) DEFAULT 0,
        landed DECIMAL(10,4) DEFAULT 0, hedging DECIMAL(10,4) DEFAULT 0,
        total_amt DECIMAL(20,6) DEFAULT 0, total_idr DECIMAL(20,4) DEFAULT 0,
        sort_order INT DEFAULT 0,
        modified_by VARCHAR(100), modified_dt VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS bom_dlfoh (
        id INT AUTO_INCREMENT PRIMARY KEY, group_id VARCHAR(100) NOT NULL,
        cat VARCHAR(100), type VARCHAR(50),
        idx DECIMAL(15,6) DEFAULT 0, index_manual TINYINT DEFAULT 0,
        setup DECIMAL(10,4) DEFAULT 0, factor DECIMAL(10,4) DEFAULT 1,
        total_hour DECIMAL(15,6) DEFAULT 0, total_cost DECIMAL(20,4) DEFAULT 0,
        sort_order INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      `CREATE TABLE IF NOT EXISTS sequences (
        name VARCHAR(50) PRIMARY KEY, value INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ];

    for (const sql of tables) {
      await conn.execute(sql);
    }

    // ── Migration: safely add missing columns ──
    // Uses INFORMATION_SCHEMA — one query per table, works on all MariaDB/MySQL versions
    console.log('   Running migrations...');
    const toAdd = [
      { table:'masterbom_lines', col:'modified_by',       def:'VARCHAR(100)'            },
      { table:'masterbom_lines', col:'modified_dt',       def:'VARCHAR(50)'             },
      { table:'bom_lines',       col:'modified_by',       def:'VARCHAR(100)'            },
      { table:'bom_lines',       col:'modified_dt',       def:'VARCHAR(50)'             },
      { table:'bom',             col:'usd_rate_snapshot', def:'DECIMAL(20,4) DEFAULT 0' },
    ];

    // Batch check all columns at once — include all tables and columns being migrated
    const [existing] = await conn.execute(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME IN ('masterbom_lines','bom_lines','bom')
         AND COLUMN_NAME IN ('modified_by','modified_dt','usd_rate_snapshot')`,
      [cfg.database]
    );
    const existSet = new Set(existing.map(r => r.TABLE_NAME + '.' + r.COLUMN_NAME));

    for (const {table, col, def} of toAdd) {
      if (!existSet.has(table + '.' + col)) {
        await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
        console.log(`   + Added ${table}.${col}`);
      }
    }

    // ── Seed sequences ──
    for (const name of ['item','price','kap','masterbom','bom']) {
      await conn.execute(`INSERT IGNORE INTO sequences (name,value) VALUES (?,0)`, [name]);
    }

    // ── Seed default users ──
    const [[{c}]] = await conn.execute(`SELECT COUNT(*) as c FROM users`);
    if (c === 0) {
      const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
      for (const [id,u,pass,nama,role] of [
        ['u1','admin',   'admin123', 'Administrator',        'admin'],
        ['u2','editor',  'edit123',  'Editor User',          'editor'],
        ['u3','viewer',  'view123',  'Viewer User',          'viewer'],
        ['u4','finance', 'fin123',   'Finance Director',     'finance_director'],
        ['u5','sales',   'sales123', 'Sales & Mktg Director','sales_director'],
        ['u6','vp',      'vp123',    'VP Director',          'vp_director'],
      ]) {
        await conn.execute(
          `INSERT IGNORE INTO users (id,username,password,nama,role,custom_pages,created_dt,updated_dt)
           VALUES (?,?,?,?,?,'[]',?,?)`,
          [id,u,pass,nama,role,now(),now()]
        );
      }
      console.log('   ✅ Default users seeded');
    }

    console.log('✅ MySQL schema ready');
  } finally {
    conn.release();
  }
}

async function nextSeq(name) {
  await query(`UPDATE sequences SET value=value+1 WHERE name=?`, [name]);
  const rows = await query(`SELECT value FROM sequences WHERE name=?`, [name]);
  return rows[0]?.value || 1;
}

module.exports = { query, getPool, initSchema, nextSeq };
