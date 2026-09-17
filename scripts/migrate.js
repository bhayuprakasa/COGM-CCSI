// scripts/migrate.js — Migrate cogm.json to MySQL
// Run: node scripts/migrate.js
'use strict';
const path = require('path');
const fs   = require('fs');

const DB_JSON = path.join(__dirname, '..', 'data', 'cogm.json');

if (!fs.existsSync(DB_JSON)) {
  console.error('❌ File data/cogm.json tidak ditemukan!');
  console.error('   Pastikan file ada di folder data/');
  process.exit(1);
}

const { query, initSchema, nextSeq } = require('../db/database');
const data = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));

const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const safe = v => v || '';
const num  = v => parseFloat(v) || 0;
const int  = v => parseInt(v)   || 0;

async function run() {
  console.log('\n🚀 Mulai migrasi cogm.json → MySQL\n');

  await initSchema();

  // ── Users ──
  if ((data.users||[]).length) {
    console.log(`📋 Migrasi ${data.users.length} users...`);
    for (const u of data.users) {
      try {
        await query(`INSERT IGNORE INTO users (id,username,password,nama,role,custom_pages,created_dt,updated_dt) VALUES (?,?,?,?,?,?,?,?)`,
          [safe(u.id)||'u'+Date.now(), safe(u.username), safe(u.password||u.pass||''), safe(u.nama), safe(u.role||'viewer'), safe(u.custom_pages||'[]'), safe(u.created_dt||now()), safe(u.updated_dt||now())]);
      } catch(e) { console.warn(`  ⚠️  User ${u.username}: ${e.message}`); }
    }
    console.log(`  ✅ Users selesai`);
  }

  // ── Items ──
  if ((data.items||[]).length) {
    console.log(`📋 Migrasi ${data.items.length} items...`);
    for (const i of data.items) {
      try {
        await query(`INSERT IGNORE INTO items (id,code,name,uom,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?)`,
          [safe(i.id), safe(i.code), safe(i.name), safe(i.uom), safe(i.created_by), safe(i.created_dt||i.created||now()), safe(i.modified_by), safe(i.modified_dt||i.updated||now())]);
      } catch(e) { console.warn(`  ⚠️  Item ${i.code}: ${e.message}`); }
    }
    console.log(`  ✅ Items selesai`);
  }

  // ── Prices ──
  if ((data.prices||[]).length) {
    console.log(`📋 Migrasi ${data.prices.length} purchase prices...`);
    for (const p of data.prices) {
      try {
        await query(`INSERT IGNORE INTO prices (id,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?)`,
          [safe(p.id), safe(p.created_by), safe(p.created_dt||p.created||now()), safe(p.modified_by), safe(p.modified_dt||p.updated||now())]);
        for (const l of (p.lines||[])) {
          await query(`INSERT INTO price_lines (price_id,item_code,item_name,qty,currency,price,hedging,landed,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [p.id, safe(l.item_code), safe(l.item_name), num(l.qty), safe(l.currency||'USD'), num(l.price), num(l.hedging), num(l.landed), safe(l.modified_by), safe(l.modified_dt||now())]);
        }
      } catch(e) { console.warn(`  ⚠️  Price ${p.id}: ${e.message}`); }
    }
    console.log(`  ✅ Prices selesai`);
  }

  // ── Exchange Rates ──
  if ((data.exrates||[]).length) {
    console.log(`📋 Migrasi ${data.exrates.length} exchange rates...`);
    for (const e of data.exrates) {
      try {
        await query(`INSERT IGNORE INTO exrates (id,currency_id,created_dt,updated_dt) VALUES (?,?,?,?)`,
          [safe(e.id), safe(e.currency_id), safe(e.created_dt||now()), safe(e.updated_dt||now())]);
        for (const l of (e.lines||[])) {
          await query(`INSERT INTO exrate_lines (exrate_id,tanggal,rate,rate_conversion) VALUES (?,?,?,?)`,
            [e.id, safe(l.tanggal), num(l.rate), num(l.rate_conversion||1)]);
        }
      } catch(e2) { console.warn(`  ⚠️  ExRate ${e.currency_id}: ${e2.message}`); }
    }
    console.log(`  ✅ Exchange rates selesai`);
  }

  // ── DL-FOH ──
  if ((data.dlfoh||[]).length) {
    console.log(`📋 Migrasi ${data.dlfoh.length} DL-FOH...`);
    for (const d of data.dlfoh) {
      try {
        await query("INSERT IGNORE INTO dlfoh (id,catid,`desc`,type,rate,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?)",
          [safe(d.id), safe(d.catid), safe(d.desc), safe(d.type), num(d.rate), safe(d.created_by), safe(d.created_dt||now()), safe(d.modified_by), safe(d.modified_dt||now())]);
      } catch(e) { console.warn(`  ⚠️  DL-FOH ${d.catid}: ${e.message}`); }
    }
    console.log(`  ✅ DL-FOH selesai`);
  }

  // ── Mesin ──
  if ((data.mesin||[]).length) {
    console.log(`📋 Migrasi ${data.mesin.length} mesin...`);
    for (const m of data.mesin) {
      try {
        await query(`INSERT IGNORE INTO mesin (id,machine_id,machine_name,machine_line,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?)`,
          [safe(m.id), safe(m.machine_id), safe(m.machine_name), safe(m.machine_line), safe(m.created_by), safe(m.created_dt||now()), safe(m.modified_by), safe(m.modified_dt||now())]);
      } catch(e) { console.warn(`  ⚠️  Mesin ${m.machine_id}: ${e.message}`); }
    }
    console.log(`  ✅ Mesin selesai`);
  }

  // ── Kapasitas ──
  if ((data.kapasitas||[]).length) {
    console.log(`📋 Migrasi ${data.kapasitas.length} kapasitas...`);
    for (const k of data.kapasitas) {
      try {
        await query(`INSERT IGNORE INTO kapasitas (id,kapid,item_code,item_name,proses,machine_id,machine_name,tube,fiber,kecepatan,dl,efisiensi,notes,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [safe(k.id), safe(k.kapid), safe(k.item_code), safe(k.item_name), safe(k.proses), safe(k.machine_id), safe(k.machine_name), int(k.tube), int(k.fiber), num(k.kecepatan), int(k.dl), num(k.efisiensi), safe(k.notes), safe(k.created_by), safe(k.created_dt||now()), safe(k.modified_by), safe(k.modified_dt||now())]);
      } catch(e) { console.warn(`  ⚠️  Kapasitas ${k.kapid}: ${e.message}`); }
    }
    console.log(`  ✅ Kapasitas selesai`);
  }

  // ── Master BOM ──
  if ((data.masterbom||[]).length) {
    console.log(`📋 Migrasi ${data.masterbom.length} Master BOM...`);
    for (const mb of data.masterbom) {
      try {
        await query(`INSERT IGNORE INTO masterbom (id,bomid,product,customer,project,fiber_cnt,buffer_qty,fiber_qty,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [safe(mb.id), safe(mb.bomid), safe(mb.product), safe(mb.customer), safe(mb.project), safe(mb.fiber_cnt), safe(mb.buffer_qty), safe(mb.fiber_qty), safe(mb.created_by), safe(mb.created_dt||mb.created||now()), safe(mb.modified_by), safe(mb.modified_dt||mb.updated||now())]);

        for (let gi=0; gi<(mb.groups||[]).length; gi++) {
          const g = mb.groups[gi];
          const gid = 'MG'+uid();
          await query(`INSERT INTO masterbom_groups (id,masterbom_id,machine_line,machine_id,kap_id,speed,kap_pct,dl_lot,foh_lot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [gid, mb.id, safe(g.machine_line), safe(g.machine_id), safe(g.kap_id), num(g.speed||1), num(g.kapPct||g.kap_pct||100), num(g.dlLot||g.dl_lot||1), num(g.fohLot||g.foh_lot||1), gi]);
          for (let li=0; li<(g.lines||[]).length; li++) {
            const l = g.lines[li];
            await query(`INSERT INTO masterbom_lines (group_id,item_code,item_name,uom,qty,scrap,factor,total_qty,sort_order,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              [gid, safe(l.item_code), safe(l.item_name), safe(l.uom), num(l.qty), num(l.scrap), num(l.factor||1), num(l.total_qty), li, safe(l.modified_by), safe(l.modified_dt||'')]);
          }
          for (let di=0; di<(g.dlfohLines||[]).length; di++) {
            const d = g.dlfohLines[di];
            await query(`INSERT INTO masterbom_dlfoh (group_id,cat,type,idx,index_manual,setup,factor,total_hour,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
              [gid, safe(d.cat), safe(d.type), num(d.index||d.idx), d.index_manual?1:0, num(d.setup), num(d.factor||1), num(d.total_hour), di]);
          }
        }
      } catch(e) { console.warn(`  ⚠️  MasterBOM ${mb.bomid}: ${e.message}`); }
    }
    console.log(`  ✅ Master BOM selesai`);
  }

  // ── BOM ──
  const allBom = [...(data.bom||[]), ...(data.bomHistory||[])];
  if (allBom.length) {
    console.log(`📋 Migrasi ${allBom.length} BOM...`);
    for (const b of allBom) {
      try {
        await query(`INSERT IGNORE INTO bom (id,bomid,product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,status,submitted_by,submitted_dt,approved_by,approval_date,approval_note,approved_by_l1,approval_date_l1,approval_note_l1,approved_by_l2,approval_date_l2,approval_note_l2,approved_by_l3,approval_date_l3,approval_note_l3,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [safe(b.id), safe(b.bomid), safe(b.product), safe(b.customer), safe(b.project), safe(b.fiber_cnt), safe(b.buffer_qty), safe(b.fiber_qty), safe(b.price_id), safe(b.master_bom_id), safe(b.status||'draft'), safe(b.submitted_by), safe(b.submitted_dt), safe(b.approved_by), safe(b.approval_date), safe(b.approval_note), safe(b.approved_by_l1), safe(b.approval_date_l1), safe(b.approval_note_l1), safe(b.approved_by_l2), safe(b.approval_date_l2), safe(b.approval_note_l2), safe(b.approved_by_l3), safe(b.approval_date_l3), safe(b.approval_note_l3), safe(b.created_by), safe(b.created_dt||b.created||now()), safe(b.modified_by), safe(b.modified_dt||b.updated||now())]);

        for (let gi=0; gi<(b.groups||[]).length; gi++) {
          const g = b.groups[gi];
          const gid = 'BG'+uid();
          await query(`INSERT INTO bom_groups (id,bom_id,machine_line,machine_id,kap_id,speed,kap_pct,dl_lot,foh_lot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [gid, b.id, safe(g.machine_line), safe(g.machine_id), safe(g.kap_id), num(g.speed||1), num(g.kapPct||g.kap_pct||100), num(g.dlLot||g.dl_lot||1), num(g.fohLot||g.foh_lot||1), gi]);
          for (let li=0; li<(g.lines||[]).length; li++) {
            const l = g.lines[li];
            await query(`INSERT INTO bom_lines (group_id,item_code,item_name,uom,qty,scrap,factor,total_qty,currency,price,landed,hedging,total_amt,total_idr,sort_order,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [gid, safe(l.item_code), safe(l.item_name), safe(l.uom), num(l.qty), num(l.scrap), num(l.factor||1), num(l.total_qty), safe(l.currency||'USD'), num(l.price), num(l.landed), num(l.hedging), num(l.total_amt), num(l.total_idr), li, safe(l.modified_by), safe(l.modified_dt||'')]);
          }
          for (let di=0; di<(g.dlfohLines||[]).length; di++) {
            const d = g.dlfohLines[di];
            await query(`INSERT INTO bom_dlfoh (group_id,cat,type,idx,index_manual,setup,factor,total_hour,total_cost,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [gid, safe(d.cat), safe(d.type), num(d.index||d.idx), d.index_manual?1:0, num(d.setup), num(d.factor||1), num(d.total_hour), num(d.total_cost), di]);
          }
        }
      } catch(e) { console.warn(`  ⚠️  BOM ${b.bomid}: ${e.message}`); }
    }
    console.log(`  ✅ BOM selesai`);
  }

  // ── Update sequences ──
  const seqUpdates = [
    ['item',      (data.items||[]).length],
    ['price',     (data.prices||[]).length],
    ['kap',       (data.kapasitas||[]).length],
    ['masterbom', (data.masterbom||[]).length],
    ['bom',       allBom.length],
  ];
  for (const [name, val] of seqUpdates) {
    if (val > 0) await query(`UPDATE sequences SET value=? WHERE name=? AND value<?`, [val, name, val]);
  }

  console.log('\n✅ Migrasi selesai!\n');
  console.log('📊 Ringkasan:');
  for (const [tbl, key] of [['users','users'],['items','items'],['prices','prices'],['exrates','exrates'],['dlfoh','dlfoh'],['mesin','mesin'],['kapasitas','kapasitas'],['masterbom','masterbom'],['bom','bom']]) {
    const rows = await query(`SELECT COUNT(*) as c FROM ${tbl}`);
    console.log(`   ${tbl.padEnd(12)}: ${rows[0].c} records`);
  }
  console.log('\nServer siap dijalankan dengan: node server.js\n');
  process.exit(0);
}

run().catch(e => {
  console.error('\n❌ Migrasi gagal:', e.message);
  if (e.code === 'ECONNREFUSED') {
    console.error('\n   Pastikan XAMPP MySQL sudah dinyalakan!');
    console.error('   Buka XAMPP Control Panel → klik Start di sebelah MySQL\n');
  } else if (e.code === 'ER_BAD_DB_ERROR') {
    console.error('\n   Database "cogm_db" belum dibuat!');
    console.error('   Jalankan setup-db.bat terlebih dahulu\n');
  }
  process.exit(1);
});
