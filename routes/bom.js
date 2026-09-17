// routes/bom.js
'use strict';
const express = require('express');
const router  = express.Router();
const { query, nextSeq } = require('../db/database');
const { requireAuth, requireEdit, requireApprove } = require('../db/auth');

const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
const who = r => r.user?.nama || 'System';
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);

// ── Helper: build groups with lines ──
async function buildGroups(groupTable, lineTable, dlfohTable, parentField, parentId) {
  const groups = await query(`SELECT * FROM ${groupTable} WHERE ${parentField}=? ORDER BY sort_order`, [parentId]);
  for (const g of groups) {
    g.lines      = await query(`SELECT * FROM ${lineTable} WHERE group_id=? ORDER BY sort_order`, [g.id]);
    const dlfoh  = await query(`SELECT * FROM ${dlfohTable} WHERE group_id=? ORDER BY sort_order`, [g.id]);
    // Normalize: add camelCase aliases for JS frontend compatibility
    g.kapPct     = parseFloat(g.kap_pct) || 100;
    g.dlLot      = parseFloat(g.dl_lot)  || 1;
    g.fohLot     = parseFloat(g.foh_lot) || 1;
    g.speed      = parseFloat(g.speed)   || 1;
    g.dlfohLines = dlfoh.map(d => ({
      ...d,
      index:        parseFloat(d.idx || 0),
      index_manual: !!(d.index_manual),
      setup:        parseFloat(d.setup)  || 0,
      factor:       parseFloat(d.factor) || 1,
      total_hour:   parseFloat(d.total_hour) || 0,
      total_cost:   parseFloat(d.total_cost) || 0,
    }));
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
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,groups} = req.body;
    if(!product) return res.status(400).json({error:'Product Name wajib.'});
    if(!groups?.length) return res.status(400).json({error:'Minimal 1 Machine Line.'});
    const seq   = await nextSeq('masterbom');
    const bomid = 'MBOM-'+String(seq).padStart(4,'0');
    const id    = 'MBOMDOC-'+bomid;
    await query(`INSERT INTO masterbom (id,bomid,product,customer,project,fiber_cnt,buffer_qty,fiber_qty,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,bomid,product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',who(req),now(),who(req),now()]);
    await insertMBomGroups(id,groups);
    res.json({id,bomid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/masterbom/:id', requireEdit, async (req,res) => {
  try {
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,groups} = req.body;
    await query(`UPDATE masterbom SET product=?,customer=?,project=?,fiber_cnt=?,buffer_qty=?,fiber_qty=?,modified_by=?,modified_dt=? WHERE id=?`,
      [product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',who(req),now(),req.params.id]);
    await deleteMBomGroups(req.params.id);
    await insertMBomGroups(req.params.id, groups||[]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/masterbom/:id', requireEdit, async (req,res) => {
  try {
    await deleteMBomGroups(req.params.id);
    await query(`DELETE FROM masterbom WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

async function deleteMBomGroups(mbomId) {
  const grps = await query(`SELECT id FROM masterbom_groups WHERE masterbom_id=?`,[mbomId]);
  for (const g of grps) {
    await query(`DELETE FROM masterbom_lines WHERE group_id=?`,[g.id]);
    await query(`DELETE FROM masterbom_dlfoh WHERE group_id=?`,[g.id]);
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
      await query(`INSERT INTO masterbom_lines (group_id,item_code,item_name,uom,qty,scrap,factor,total_qty,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
        [gid,l.item_code||'',l.item_name||'',l.uom||'',l.qty||0,l.scrap||0,l.factor||1,l.total_qty||0,li]);
    }
    for (let di=0; di<(g.dlfohLines||[]).length; di++) {
      const d=g.dlfohLines[di];
      // If type is empty, look up from dlfoh master table
      let dtype = d.type||'';
      if(!dtype && d.cat) {
        const dlfohRows = await query(`SELECT type FROM dlfoh WHERE catid=?`, [d.cat]);
        if(dlfohRows.length) dtype = dlfohRows[0].type||'';
      }
      await query(`INSERT INTO masterbom_dlfoh (group_id,cat,type,idx,index_manual,setup,factor,total_hour,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
        [gid,d.cat||'',dtype,d.index||0,d.index_manual?1:0,d.setup||0,d.factor||1,d.total_hour||0,di]);
    }
  }
}

// ── BOM ──
async function buildBomList(whereClause='', params=[]) {
  const boms = await query(`SELECT * FROM bom ${whereClause} ORDER BY bomid`, params);
  const result = [];
  for (const b of boms) {
    const groups = await buildGroups('bom_groups','bom_lines','bom_dlfoh','bom_id',b.id);
    result.push({...b, groups, machine_lines:groups.map(g=>g.machine_line), lines:groups.flatMap(g=>g.lines)});
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
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,usd_rate_snapshot,groups} = req.body;
    if(!product) return res.status(400).json({error:'Product Name wajib.'});
    if(!groups?.length) return res.status(400).json({error:'Pilih Master BOM ID untuk memuat Machine Line.'});
    const seq   = await nextSeq('bom');
    const bomid = 'BOM-'+String(seq).padStart(4,'0');
    const id    = 'BOMREC-'+bomid;
    const rateSnap = parseFloat(usd_rate_snapshot)||0;
    await query(`INSERT INTO bom (id,bomid,product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,usd_rate_snapshot,status,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,bomid,product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',price_id||'',master_bom_id||'',rateSnap,'draft',who(req),now(),who(req),now()]);
    await insertBomGroups(id,groups);
    res.json({id,bomid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/bom/:id', requireEdit, async (req,res) => {
  try {
    const [existing] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!existing) return res.status(404).json({error:'BOM tidak ditemukan.'});
    const editable = existing.status==='draft';
    if(!editable) return res.status(400).json({error:'Hanya BOM Draft/Rejected yang dapat diedit.'});
    const {product,customer,project,fiber_cnt,buffer_qty,fiber_qty,price_id,master_bom_id,usd_rate_snapshot,groups} = req.body;
    await query(`UPDATE bom SET product=?,customer=?,project=?,fiber_cnt=?,buffer_qty=?,fiber_qty=?,price_id=?,master_bom_id=?,usd_rate_snapshot=?,modified_by=?,modified_dt=? WHERE id=?`,
      [product,customer||'',project||'',fiber_cnt||'',buffer_qty||'',fiber_qty||'',price_id||'',master_bom_id||'',parseFloat(usd_rate_snapshot)||0,who(req),now(),req.params.id]);
    await deleteBomGroups(req.params.id);
    await insertBomGroups(req.params.id, groups||[]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/bom/:id', requireEdit, async (req,res) => {
  try {
    const [b] = await query(`SELECT status FROM bom WHERE id=?`,[req.params.id]);
    if(!b) return res.status(404).json({error:'BOM tidak ditemukan.'});
    if(b.status!=='draft') return res.status(400).json({error:'Hanya BOM Draft yang dapat dihapus.'});
    await deleteBomGroups(req.params.id);
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
      await query(`INSERT INTO bom_lines (group_id,item_code,item_name,uom,qty,scrap,factor,total_qty,currency,price,landed,hedging,total_amt,total_idr,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [gid,l.item_code||'',l.item_name||'',l.uom||'',l.qty||0,l.scrap||0,l.factor||1,l.total_qty||0,l.currency||'USD',l.price||0,l.landed||0,l.hedging||0,l.total_amt||0,l.total_idr||0,li]);
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

module.exports = router;
