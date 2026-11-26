// routes/bom.js
'use strict';
const express = require('express');
const router  = express.Router();
const { query, nextSeq } = require('../db/database');
const { requireAuth, requireEdit, requireApprove } = require('../db/auth');

const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
const who = r => r.user?.nama || 'System';
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);

// Snapshot exchange rates saat BOM dibuat/diupdate — capture semua currency di bom_lines
async function snapshotRates(bomId) {
  const lines = await query(
    `SELECT DISTINCT bl.currency FROM bom_groups bg
     JOIN bom_lines bl ON bl.group_id = bg.id
     WHERE bg.bom_id = ? AND bl.currency IS NOT NULL AND bl.currency != ''`,
    [bomId]
  );
  const currencies = new Set(['USD', ...lines.map(l => l.currency)]);

  for (const currency of currencies) {
    const [exrate] = await query(`SELECT id FROM exrates WHERE currency_id = ?`, [currency]);
    if (!exrate) continue;
    const [latest] = await query(
      `SELECT rate FROM exrate_lines WHERE exrate_id = ? ORDER BY tanggal DESC LIMIT 1`,
      [exrate.id]
    );
    if (!latest) continue;
    await query(
      `INSERT INTO bom_rate_snapshots (bom_id, currency, rate, snapped_dt)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), snapped_dt = VALUES(snapped_dt)`,
      [bomId, currency, parseFloat(latest.rate) || 0, now()]
    );
  }
}

// ── Helper: build groups with lines ──
async function buildGroups(groupTable, lineTable, dlfohTable, parentField, parentId) {
  const groups = await query(`SELECT * FROM ${groupTable} WHERE ${parentField}=? ORDER BY sort_order`, [parentId]);
  for (const g of groups) {
    g.lines      = await query(`SELECT * FROM ${lineTable} WHERE group_id=? ORDER BY sort_order`, [g.id]);
    // Load bom_dlfoh untuk BOM biasa (masterbom_dlfoh tidak lagi digunakan — DL-FOH berasal dari Master Route)
    if (dlfohTable === 'bom_dlfoh') {
      const dlfoh = await query(`SELECT * FROM ${dlfohTable} WHERE group_id=? ORDER BY sort_order`, [g.id]);
      g.dlfohLines = dlfoh.map(d => ({
        ...d,
        index:        parseFloat(d.idx || 0),
        index_manual: !!(d.index_manual),
        setup:        parseFloat(d.setup)  || 0,
        factor:       parseFloat(d.factor) || 1,
        total_hour:   parseFloat(d.total_hour) || 0,
        total_cost:   parseFloat(d.total_cost) || 0,
      }));
    } else {
      // masterbom_dlfoh diabaikan — DL-FOH hanya dari Master Route saat BOM dibuat
      g.dlfohLines = [];
    }
    // Normalize: add camelCase aliases for JS frontend compatibility
    g.kapPct     = parseFloat(g.kap_pct) || 100;
    g.dlLot      = parseFloat(g.dl_lot)  || 1;
    g.fohLot     = parseFloat(g.foh_lot) || 1;
    g.speed      = parseFloat(g.speed)   || 1;
  }
  return groups;
}

// ── MASTER BOM ──
router.get('/masterbom', requireAuth, async (req,res) => {
  try {
    const records = await query(`SELECT * FROM masterbom ORDER BY bomid`);
    const result  = [];
    for (const r of records) {
      const groups = await buildGroups('masterbom_groups','masterbom_lines','masterbom_dlfoh','masterbom_id',r.id);
      result.push({...r, groups, machine_lines:groups.map(g=>g.machine_line), lines:groups.flatMap(g=>g.lines)});
    }
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/masterbom', requireEdit, async (req,res) => {
  try {
    const {product,product_code,fiber_cnt,buffer_qty,fiber_qty,no_spec,groups} = req.body;
    if(!product) return res.status(400).json({error:'Product Name wajib.'});
    if(!groups?.length) return res.status(400).json({error:'Minimal 1 Machine Line.'});
    const seq   = await nextSeq('masterbom');
    const bomid = 'MBOM-'+String(seq).padStart(4,'0');
    const id    = 'MBOMDOC-'+bomid;
    await query(`INSERT INTO masterbom (id,bomid,product,product_code,fiber_cnt,buffer_qty,fiber_qty,no_spec,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,bomid,product,product_code||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',no_spec||'',who(req),now(),who(req),now()]);
    await insertMBomGroups(id,groups);
    res.json({id,bomid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/masterbom/:id', requireEdit, async (req,res) => {
  try {
    const {product,product_code,fiber_cnt,buffer_qty,fiber_qty,no_spec,groups} = req.body;
    await query(`UPDATE masterbom SET product=?,product_code=?,fiber_cnt=?,buffer_qty=?,fiber_qty=?,no_spec=?,modified_by=?,modified_dt=? WHERE id=?`,
      [product,product_code||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',no_spec||'',who(req),now(),req.params.id]);
    await deleteMBomGroups(req.params.id);
    await insertMBomGroups(req.params.id, groups||[]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/masterbom/:id', requireEdit, async (req,res) => {
  try {
    const [exists] = await query(`SELECT id FROM masterbom WHERE id=?`,[req.params.id]);
    if(!exists) return res.status(404).json({error:'Master BOM tidak ditemukan: '+req.params.id});
    await deleteMBomGroups(req.params.id);
    await query(`DELETE FROM masterbom WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

async function deleteMBomGroups(mbomId) {
  const grps = await query(`SELECT id FROM masterbom_groups WHERE masterbom_id=?`,[mbomId]);
  for (const g of grps) {
    await query(`DELETE FROM masterbom_lines WHERE group_id=?`,[g.id]);
    await query(`DELETE FROM masterbom_dlfoh WHERE group_id=?`,[g.id]); // cleanup data lama
  }
  await query(`DELETE FROM masterbom_groups WHERE masterbom_id=?`,[mbomId]);
}

async function insertMBomGroups(mbomId, groups) {
  for (let gi=0; gi<groups.length; gi++) {
    const g   = groups[gi];
    const gid = 'MG'+uid();
    await query(`INSERT INTO masterbom_groups (id,masterbom_id,machine_line,machine_id,kap_id,speed,kap_pct,dl_lot,foh_lot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [gid,mbomId,g.machine_line||'',g.machine_id||'',g.kap_id||'',g.speed||1,g.kapPct||100,g.dlLot||1,g.fohLot||1,gi]);
    for (let li=0; li<(g.lines||[]).length; li++) {
      const l=g.lines[li];
      await query(`INSERT INTO masterbom_lines (group_id,item_code,item_name,uom,qty,scrap,scrap_fix,factor,total_qty,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [gid,l.item_code||'',l.item_name||'',l.uom||'',l.qty||0,l.scrap||0,l.scrap_fix||0,l.factor||1,l.total_qty||0,li]);
    }
    // masterbom_dlfoh tidak lagi disimpan — DL-FOH berasal dari Master Route saat BOM dibuat
  }
}

// Helper: simpan routing snapshot ke bom_routing dari kapasitas.notes
// Jika masterRouteId (kapid) diberikan, gunakan kapasitas spesifik itu.
// Fallback ke kapasitas pertama yang cocok item_code.
// kapasitas.notes berisi JSON: [{machine_line, duration, setup}]
async function insertBomRoutingFromKap(bomId, itemCode, masterRouteId) {
  // Prioritaskan master_route_id (kapid spesifik), fallback ke item_code
  let kap = null;
  if (masterRouteId) {
    [kap] = await query(`SELECT notes FROM kapasitas WHERE kapid = ? LIMIT 1`, [masterRouteId]);
  }
  if (!kap && itemCode) {
    // Fallback: kapasitas pertama yang cocok dengan item_code (diurutkan kapid)
    [kap] = await query(`SELECT notes FROM kapasitas WHERE item_code = ? ORDER BY kapid LIMIT 1`, [itemCode]);
  }
  if (!kap) return;
  let lines = [];
  try { lines = JSON.parse(kap.notes || '[]'); } catch (e) { return; }

  let sortIdx = 0;
  for (const r of lines) {
    const machineLine = r.machine_line || '';
    if (!machineLine) continue; // skip baris tanpa machine_line

    const processTime = parseFloat(r.duration) || 0;
    const setupTime   = parseFloat(r.setup)    || 0;
    const factor      = 1;
    // total_hour = process_time × factor + setup_time (sama untuk DL, VFOH, FFOH pada machine_line yang sama)
    const totalHour   = processTime * factor + setupTime;

    // Ambil semua DL-FOH yang terdaftar untuk machine_line ini — rate general per machine_line
    const dlfohList = await query(
      `SELECT catid, type, rate FROM dlfoh WHERE machine_line = ? ORDER BY catid`,
      [machineLine]
    );

    for (const d of dlfohList) {
      const totalCost = totalHour * (parseFloat(d.rate) || 0);
      await query(
        `INSERT INTO bom_routing (bom_id, cat, type, process_time, setup_time, factor, total_hour, total_cost, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [bomId, d.catid, d.type, processTime, setupTime, factor, totalHour, totalCost, sortIdx++]
      );
    }
  }
}

// ── BOM ──
async function buildBomList(whereClause='', params=[]) {
  const boms = await query(`SELECT * FROM bom ${whereClause} ORDER BY bomid`, params);
  const result = [];
  for (const b of boms) {
    const groups  = await buildGroups('bom_groups','bom_lines','bom_dlfoh','bom_id',b.id);
    // Sertakan routing snapshot per BOM
    const routing = await query(`SELECT * FROM bom_routing WHERE bom_id = ? ORDER BY sort_order`, [b.id]);
    result.push({...b, groups, routing, machine_lines:groups.map(g=>g.machine_line), lines:groups.flatMap(g=>g.lines)});
  }
  return result;
}

router.get('/bom', requireAuth, async (req,res) => {
  try {
    // Hanya tampilkan BOM yang aktif (draft & pending) — history terpisah
    res.json(await buildBomList(`WHERE status NOT IN ('approved','rejected_l1','rejected_l2','rejected_l3','cancelled')`));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/bom/history', requireAuth, async (req,res) => {
  try {
    // History = semua status final: approved, rejected (semua level), cancelled
    res.json(await buildBomList(`WHERE status IN ('approved','rejected_l1','rejected_l2','rejected_l3','cancelled')`));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/bom/active', requireAuth, async (req,res) => {
  try {
    // Active = draft dan semua pending (sedang dalam proses approval)
    res.json(await buildBomList(`WHERE status NOT IN ('approved','rejected_l1','rejected_l2','rejected_l3','cancelled')`));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/bom', requireEdit, async (req,res) => {
  try {
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,master_route_id,item_code,usd_rate_snapshot,groups} = req.body;
    if(!product) return res.status(400).json({error:'Product Name wajib.'});
    if(!groups?.length) return res.status(400).json({error:'Pilih Master BOM ID untuk memuat Machine Line.'});
    const seq   = await nextSeq('bom');
    const bomid = 'BOM-'+String(seq).padStart(4,'0');
    const id    = 'BOMREC-'+bomid;
    const rateSnap = parseFloat(usd_rate_snapshot)||0;
    await query(`INSERT INTO bom (id,bomid,product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,master_route_id,item_code,usd_rate_snapshot,status,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,bomid,product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',price_id||'',master_bom_id||'',master_route_id||'',item_code||'',rateSnap,'draft',who(req),now(),who(req),now()]);
    await insertBomGroups(id,groups);
    await snapshotRates(id);
    // Routing: gunakan master_route_id (kapasitas spesifik) jika ada, fallback ke item_code
    await insertBomRoutingFromKap(id, item_code, master_route_id||'');
    res.json({id,bomid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/bom/:id', requireEdit, async (req,res) => {
  try {
    const [existing] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!existing) return res.status(404).json({error:'BOM tidak ditemukan.'});
    const editable = existing.status==='draft';
    if(!editable) return res.status(400).json({error:'Hanya BOM Draft/Rejected yang dapat diedit.'});
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,master_route_id,item_code,usd_rate_snapshot,groups} = req.body;
    await query(`UPDATE bom SET product=?,customer=?,project=?,fiber_cnt=?,buffer_qty=?,fiber_qty=?,price_id=?,master_bom_id=?,master_route_id=?,item_code=?,usd_rate_snapshot=?,modified_by=?,modified_dt=? WHERE id=?`,
      [product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',price_id||'',master_bom_id||'',master_route_id||'',item_code||'',parseFloat(usd_rate_snapshot)||0,who(req),now(),req.params.id]);
    await deleteBomGroups(req.params.id);
    await insertBomGroups(req.params.id, groups||[]);
    await snapshotRates(req.params.id);
    // Reset dan simpan ulang routing snapshot — gunakan master_route_id jika ada
    await query(`DELETE FROM bom_routing WHERE bom_id = ?`, [req.params.id]);
    await insertBomRoutingFromKap(req.params.id, item_code, master_route_id||'');
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Recalculate semua total_idr (bom_lines) dan total_cost (bom_dlfoh) server-side
// Menggunakan bom_rate_snapshots — tidak mengubah qty/price/hour, hanya update total
router.post('/bom/:id/recalculate', requireEdit, async (req, res) => {
  try {
    const [bom] = await query(`SELECT id, status FROM bom WHERE id = ?`, [req.params.id]);
    if (!bom) return res.status(404).json({ error: 'BOM tidak ditemukan.' });
    if (!['draft', 'pending_l1', 'pending_l2', 'pending_l3'].includes(bom.status))
      return res.status(400).json({ error: 'BOM sudah final, tidak dapat dihitung ulang.' });

    // Ambil snapshot rates untuk BOM ini
    const snapshots = await query(
      `SELECT currency, rate FROM bom_rate_snapshots WHERE bom_id = ?`,
      [req.params.id]
    );
    const rateMap = {};
    for (const s of snapshots) rateMap[s.currency] = parseFloat(s.rate) || 0;

    // Jika USD belum di-snapshot, coba ambil dari exrate_lines
    if (!rateMap['USD']) {
      const [usdEx] = await query(`SELECT id FROM exrates WHERE currency_id = 'USD'`);
      if (usdEx) {
        const [latest] = await query(
          `SELECT rate FROM exrate_lines WHERE exrate_id = ? ORDER BY tanggal DESC LIMIT 1`,
          [usdEx.id]
        );
        if (latest) rateMap['USD'] = parseFloat(latest.rate) || 0;
      }
    }
    const usdRate = rateMap['USD'] || 1;

    const groups = await query(`SELECT id FROM bom_groups WHERE bom_id = ?`, [req.params.id]);
    for (const g of groups) {
      // Recalc bom_lines: total_idr = total_qty × price × (1 + (landed+hedging)/100) × rate_IDR
      const bomLines = await query(`SELECT * FROM bom_lines WHERE group_id = ?`, [g.id]);
      for (const l of bomLines) {
        const currency = (l.currency || 'USD').trim();
        let currRate = rateMap[currency];
        if (!currRate) {
          const [ex] = await query(`SELECT id FROM exrates WHERE currency_id = ?`, [currency]);
          if (ex) {
            const [lat] = await query(
              `SELECT rate FROM exrate_lines WHERE exrate_id = ? ORDER BY tanggal DESC LIMIT 1`,
              [ex.id]
            );
            if (lat) currRate = rateMap[currency] = parseFloat(lat.rate) || 0;
          }
        }
        currRate = currRate || usdRate;

        const totalQty = parseFloat(l.total_qty) || 0;
        const price    = parseFloat(l.price) || 0;
        const landed   = parseFloat(l.landed) || 0;
        const hedging  = parseFloat(l.hedging) || 0;
        // totalAmt = jumlah dalam mata uang asli (IDR→IDR, USD→USD), bukan dikonversi ke USD
        const totalAmt = totalQty * price * (1 + (landed + hedging) / 100);
        // total_idr = total_amt × rate (formula: total * rate)
        // IDR = base currency (rate 1); semua currency lain → pakai rate terbaru dari master exchange rate
        // currRate sudah di-fetch dari DB exrate_lines (order tanggal DESC) untuk currency apapun (EUR, SGD, dll)
        // Tidak pakai l.usd_rate dari DB karena nilainya bisa stale (tersimpan saat last-save, bukan rate sekarang)
        const lineRate = currency === 'IDR' ? 1 : (currRate || usdRate);
        const totalIdr = totalAmt * lineRate;

        await query(
          `UPDATE bom_lines SET total_amt = ?, total_idr = ? WHERE id = ?`,
          [totalAmt, totalIdr, l.id]
        );
      }

      // Recalc bom_dlfoh: total_cost = idx*factor*rate_process + setup*rate_setup
      const dlfohLines = await query(`SELECT * FROM bom_dlfoh WHERE group_id = ?`, [g.id]);
      for (const d of dlfohLines) {
        if (!d.cat) continue;
        const [master] = await query(`SELECT rate,rate_process,rate_setup FROM dlfoh WHERE catid = ?`, [d.cat]);
        if (!master) continue;
        const rp = parseFloat(master.rate_process) || parseFloat(master.rate) || 0;
        const rs = parseFloat(master.rate_setup) || parseFloat(master.rate) || 0;
        const totalCost = (parseFloat(d.idx)||0)*(parseFloat(d.factor)||1)*rp + (parseFloat(d.setup)||0)*rs;
        await query(`UPDATE bom_dlfoh SET total_cost = ? WHERE id = ?`, [totalCost, d.id]);
      }
    }

    // Recalc bom_routing: total_cost = process_time*rate_process + setup_time*rate_setup
    const routingRows = await query(`SELECT * FROM bom_routing WHERE bom_id = ?`, [req.params.id]);
    for (const r of routingRows) {
      if (!r.cat) continue;
      const [dlfohMaster] = await query(`SELECT rate,rate_process,rate_setup FROM dlfoh WHERE catid = ?`, [r.cat]);
      if (!dlfohMaster) continue;
      const rp = parseFloat(dlfohMaster.rate_process) || parseFloat(dlfohMaster.rate) || 0;
      const rs = parseFloat(dlfohMaster.rate_setup) || parseFloat(dlfohMaster.rate) || 0;
      const totalCost = (parseFloat(r.process_time)||0)*(parseFloat(r.factor)||1)*rp + (parseFloat(r.setup_time)||0)*rs;
      await query(`UPDATE bom_routing SET total_cost = ? WHERE id = ?`, [totalCost, r.id]);
    }

    await query(
      `UPDATE bom SET modified_by = ?, modified_dt = ? WHERE id = ?`,
      [who(req), now(), req.params.id]
    );

    res.json({ ok: true, message: 'Recalculate berhasil.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/bom/:id', requireEdit, async (req,res) => {
  try {
    const [b] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!b) return res.status(404).json({error:'BOM tidak ditemukan.'});
    if(b.status!=='draft') return res.status(400).json({error:'Hanya BOM Draft yang dapat dihapus.'});
    await deleteBomGroups(req.params.id);
    // Hapus routing snapshot dan rate snapshots
    await query(`DELETE FROM bom_routing WHERE bom_id = ?`, [req.params.id]);
    await query(`DELETE FROM bom_rate_snapshots WHERE bom_id = ?`, [req.params.id]);
    await query(`DELETE FROM bom WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/bom/:id/submit', requireEdit, async (req,res) => {
  try {
    const [b] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!b) return res.status(404).json({error:'BOM tidak ditemukan.'});
    if(!['draft'].includes(b.status))
      return res.status(400).json({error:'Hanya BOM Draft yang dapat diajukan.'});
    await query(`UPDATE bom SET status='pending_l1',submitted_by=?,submitted_dt=?,modified_by=?,modified_dt=? WHERE id=?`,
      [who(req),now(),who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Cancel: kembalikan ke draft (bisa edit kembali)
router.post('/bom/:id/cancel', requireEdit, async (req,res) => {
  try {
    const [b] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!b) return res.status(404).json({error:'BOM tidak ditemukan.'});
    if(b.status === 'draft' || b.status === 'approved')
      return res.status(400).json({error:'BOM tidak dapat di-cancel dari status ini.'});
    // Reset all approval fields and return to draft
    await query(`UPDATE bom SET status='draft',
      submitted_by=NULL,submitted_dt=NULL,
      approved_by_l1=NULL,approval_date_l1=NULL,approval_note_l1=NULL,
      approved_by_l2=NULL,approval_date_l2=NULL,approval_note_l2=NULL,
      approved_by_l3=NULL,approval_date_l3=NULL,approval_note_l3=NULL,
      modified_by=?,modified_dt=? WHERE id=?`,
      [who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/bom/:id/approve', requireApprove, async (req,res) => {
  try {
    const {status: newStatus, note, lvKey} = req.body;
    const [b] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!b) return res.status(404).json({error:'BOM tidak ditemukan.'});
    const lk = lvKey || (b.status.replace('pending_',''));
    let sql = `UPDATE bom SET status=?,modified_by=?,modified_dt=?,approved_by_${lk}=?,approval_date_${lk}=?,approval_note_${lk}=?`;
    const params = [newStatus, who(req), now(), who(req), now(), note||''];
    if(newStatus==='approved') { sql+=`,approved_by=?,approval_date=?`; params.push(who(req),now()); }
    sql+=` WHERE id=?`; params.push(req.params.id);
    await query(sql, params);
    res.json({ok:true,status:newStatus});
  } catch(e) { res.status(500).json({error:e.message}); }
});

async function deleteBomGroups(bomId) {
  const grps = await query(`SELECT id FROM bom_groups WHERE bom_id=?`,[bomId]);
  for (const g of grps) {
    await query(`DELETE FROM bom_lines WHERE group_id=?`,[g.id]);
    await query(`DELETE FROM bom_dlfoh WHERE group_id=?`,[g.id]);
  }
  await query(`DELETE FROM bom_groups WHERE bom_id=?`,[bomId]);
}

async function insertBomGroups(bomId, groups) {
  for (let gi=0; gi<groups.length; gi++) {
    const g   = groups[gi];
    const gid = 'BG'+uid();
    await query(`INSERT INTO bom_groups (id,bom_id,machine_line,machine_id,kap_id,speed,kap_pct,dl_lot,foh_lot,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [gid,bomId,g.machine_line||'',g.machine_id||'',g.kap_id||'',g.speed||1,g.kapPct||100,g.dlLot||1,g.fohLot||1,gi]);
    for (let li=0; li<(g.lines||[]).length; li++) {
      const l=g.lines[li];
      // usd_rate = rate USD/IDR per line, digunakan untuk konversi total_amt (USD) → total_idr
      await query(`INSERT INTO bom_lines (group_id,item_code,item_name,uom,qty,scrap,factor,total_qty,currency,price,landed,hedging,total_amt,total_idr,usd_rate,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [gid,l.item_code||'',l.item_name||'',l.uom||'',l.qty||0,l.scrap||0,l.factor||1,l.total_qty||0,l.currency||'USD',l.price||0,l.landed||0,l.hedging||0,l.total_amt||0,l.total_idr||0,parseFloat(l.usd_rate)||0,li]);
    }
    for (let di=0; di<(g.dlfohLines||[]).length; di++) {
      const d=g.dlfohLines[di];
      let dtype = d.type||'';
      if(!dtype && d.cat) {
        const dlfohRows = await query(`SELECT type FROM dlfoh WHERE catid=?`, [d.cat]);
        if(dlfohRows.length) dtype = dlfohRows[0].type||'';
      }
      await query(`INSERT INTO bom_dlfoh (group_id,cat,type,idx,index_manual,setup,factor,total_hour,total_cost,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [gid,d.cat||'',dtype,d.index||0,d.index_manual?1:0,d.setup||0,d.factor||1,d.total_hour||0,d.total_cost||0,di]);
    }
  }
}

// ── COGS SUMMARY ──

router.get('/cogs', requireAuth, async (req, res) => {
  try {
    const docs = await query(`SELECT * FROM cogs_summary ORDER BY date DESC, created_dt DESC`);
    for (const d of docs) {
      d.rows = await query(
        `SELECT * FROM cogs_summary_lines WHERE cogs_id = ? ORDER BY sort_order`,
        [d.id]
      );
    }
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cogs', requireEdit, async (req, res) => {
  try {
    const { name, date, note, rows } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama COGS Summary wajib.' });

    const seq    = await nextSeq('cogs');
    const cogsid = 'COGS-' + String(seq).padStart(4, '0');
    const id     = 'COGSDOC-' + cogsid;

    const totalCogsIdr = (rows || []).reduce((s, r) => s + (parseFloat(r.cogsIDR || r.cogs_idr) || 0), 0);
    const totalCogsUsd = (rows || []).reduce((s, r) => s + (parseFloat(r.cogsUSD || r.cogs_usd) || 0), 0);

    await query(
      `INSERT INTO cogs_summary (id,cogsid,name,date,note,total_cogs_idr,total_cogs_usd,created_by,created_dt,modified_by,modified_dt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cogsid, name, date || '', note || '', totalCogsIdr, totalCogsUsd, who(req), now(), who(req), now()]
    );

    await insertCogsLines(id, rows || []);
    res.json({ id, cogsid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/cogs/:id', requireEdit, async (req, res) => {
  try {
    const { name, date, note, rows } = req.body;
    const [existing] = await query(`SELECT id FROM cogs_summary WHERE id = ?`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'COGS Summary tidak ditemukan.' });

    const totalCogsIdr = (rows || []).reduce((s, r) => s + (parseFloat(r.cogsIDR || r.cogs_idr) || 0), 0);
    const totalCogsUsd = (rows || []).reduce((s, r) => s + (parseFloat(r.cogsUSD || r.cogs_usd) || 0), 0);

    await query(
      `UPDATE cogs_summary SET name=?,date=?,note=?,total_cogs_idr=?,total_cogs_usd=?,modified_by=?,modified_dt=? WHERE id=?`,
      [name, date || '', note || '', totalCogsIdr, totalCogsUsd, who(req), now(), req.params.id]
    );
    await query(`DELETE FROM cogs_summary_lines WHERE cogs_id = ?`, [req.params.id]);
    await insertCogsLines(req.params.id, rows || []);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/cogs/:id', requireEdit, async (req, res) => {
  try {
    const [existing] = await query(`SELECT id FROM cogs_summary WHERE id = ?`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'COGS Summary tidak ditemukan.' });
    await query(`DELETE FROM cogs_summary_lines WHERE cogs_id = ?`, [req.params.id]);
    await query(`DELETE FROM cogs_summary WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function insertCogsLines(cogsId, rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await query(
      `INSERT INTO cogs_summary_lines
       (cogs_id,bom_id,bom_number,product,project,est_qty,jenis_fiber,
        fiber_usd,rm_others,usd_rate,total_idr,dl_idr,fohf_idr,fohv_idr,cogs_idr,cogs_usd,note,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cogsId,
        r.bomId      || r.bom_id      || '',
        r.bomid      || r.bom_number  || '',
        r.product    || '',
        r.project    || '',
        parseFloat(r.estQty    || r.est_qty)   || 0,
        r.jenisFiber || r.jenis_fiber           || '',
        parseFloat(r.fiberUSD  || r.fiber_usd)  || 0,
        parseFloat(r.rmOthers  || r.rm_others)  || 0,
        parseFloat(r.usdRate   || r.usd_rate)   || 0,
        parseFloat(r.totalIDR  || r.total_idr)  || 0,
        parseFloat(r.dlIDR     || r.dl_idr)     || 0,
        parseFloat(r.fohfIDR   || r.fohf_idr)   || 0,
        parseFloat(r.fohvIDR   || r.fohv_idr)   || 0,
        parseFloat(r.cogsIDR   || r.cogs_idr)   || 0,
        parseFloat(r.cogsUSD   || r.cogs_usd)   || 0,
        r.note || '',
        i,
      ]
    );
  }
}

module.exports = router;
