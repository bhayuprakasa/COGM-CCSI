// routes/master.js
'use strict';
const express = require('express');
const router  = express.Router();
const { query, nextSeq } = require('../db/database');
const { requireAuth, requireEdit, login, logout } = require('../db/auth');

const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
const who = r => r.user?.nama || 'System';

// ── AUTH ──
router.post('/auth/login', async (req,res) => {
  try {
    const {username,password} = req.body;
    const token = await login(username, password);
    if (!token) return res.status(401).json({error:'Username atau password salah.'});
    const [user] = await query(`SELECT id,username,nama,role,custom_pages FROM users WHERE username=?`,[username]);
    res.json({token, user});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/auth/logout', requireAuth, (req,res) => {
  logout(req.headers['x-token']); res.json({ok:true});
});

router.get('/auth/me', requireAuth, (req,res) => {
  const {id,username,nama,role,custom_pages} = req.user;
  res.json({id,username,nama,role,custom_pages});
});

// ── USERS ──
router.get('/users', requireAuth, async (req,res) => {
  try { res.json(await query(`SELECT id,username,nama,role,custom_pages FROM users ORDER BY id`)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/users', requireEdit, async (req,res) => {
  try {
    const {username,nama,password,role,custom_pages} = req.body;
    if(!username||!nama||!password) return res.status(400).json({error:'Username, nama, password wajib.'});
    const id='u'+Date.now();
    await query(`INSERT INTO users (id,username,password,nama,role,custom_pages,created_dt,updated_dt) VALUES (?,?,?,?,?,?,?,?)`,
      [id,username,password,nama,role||'viewer',JSON.stringify(custom_pages||[]),now(),now()]);
    res.json({id,username,nama,role});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/users/:id', requireEdit, async (req,res) => {
  try {
    const {nama,password,role,custom_pages} = req.body;
    if(password) {
      await query(`UPDATE users SET nama=?,password=?,role=?,custom_pages=?,updated_dt=? WHERE id=?`,
        [nama,password,role,JSON.stringify(custom_pages||[]),now(),req.params.id]);
    } else {
      await query(`UPDATE users SET nama=?,role=?,custom_pages=?,updated_dt=? WHERE id=?`,
        [nama,role,JSON.stringify(custom_pages||[]),now(),req.params.id]);
    }
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/users/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM users WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── ITEMS ──
router.get('/items', requireAuth, async (req,res) => {
  try { res.json(await query(`SELECT * FROM items ORDER BY code`)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/items', requireEdit, async (req,res) => {
  try {
    const {code,name,uom} = req.body;
    if(!code||!name||!uom) return res.status(400).json({error:'Code, name, UOM wajib.'});
    const exists = await query(`SELECT id FROM items WHERE code=?`,[code]);
    if(exists.length) return res.status(400).json({error:'Item Code sudah ada.'});
    const seq = await nextSeq('item');
    const id = 'ITM-'+String(seq).padStart(4,'0');
    await query(`INSERT INTO items (id,code,name,uom,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?)`,
      [id,code,name,uom,who(req),now(),who(req),now()]);
    res.json({id,code,name,uom});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/items/:id', requireEdit, async (req,res) => {
  try {
    const {name,uom} = req.body;
    await query(`UPDATE items SET name=?,uom=?,modified_by=?,modified_dt=? WHERE id=?`,
      [name,uom,who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/items/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM items WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── PRICES ──
router.get('/prices', requireAuth, async (req,res) => {
  try {
    const prices = await query(`SELECT * FROM prices ORDER BY id`);
    const lines  = await query(`SELECT * FROM price_lines ORDER BY price_id,id`);
    res.json(prices.map(p=>({...p, lines:lines.filter(l=>l.price_id===p.id)})));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/prices', requireEdit, async (req,res) => {
  try {
    const {id,lines} = req.body;
    if(!id) return res.status(400).json({error:'Price ID wajib.'});
    const ex = await query(`SELECT id FROM prices WHERE id=?`,[id]);
    if(ex.length) return res.status(400).json({error:'Price ID sudah ada.'});
    await query(`INSERT INTO prices (id,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?)`,
      [id,who(req),now(),who(req),now()]);
    await insertPriceLines(id, lines||[]);
    res.json({id});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/prices/:id', requireEdit, async (req,res) => {
  try {
    await query(`UPDATE prices SET modified_by=?,modified_dt=? WHERE id=?`,[who(req),now(),req.params.id]);
    await query(`DELETE FROM price_lines WHERE price_id=?`,[req.params.id]);
    await insertPriceLines(req.params.id, req.body.lines||[]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/prices/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM prices WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

async function insertPriceLines(priceId, lines) {
  for (const l of lines) {
    await query(`INSERT INTO price_lines (price_id,item_code,item_name,qty,currency,price,hedging,landed) VALUES (?,?,?,?,?,?,?,?)`,
      [priceId,l.item_code||'',l.item_name||'',l.qty||0,l.currency||'USD',l.price||0,l.hedging||0,l.landed||0]);
  }
}

// ── EXCHANGE RATES ──
router.get('/exrates', requireAuth, async (req,res) => {
  try {
    const exrates = await query(`SELECT * FROM exrates ORDER BY currency_id`);
    const lines   = await query(`SELECT * FROM exrate_lines ORDER BY exrate_id,tanggal DESC`);
    res.json(exrates.map(e=>({...e, lines:lines.filter(l=>l.exrate_id===e.id)})));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/exrates', requireEdit, async (req,res) => {
  try {
    const {currency_id,lines} = req.body;
    if(!currency_id) return res.status(400).json({error:'Currency ID wajib.'});
    const id='EXR-'+currency_id;
    const ex=await query(`SELECT id FROM exrates WHERE id=?`,[id]);
    if(ex.length) return res.status(400).json({error:'Currency ID sudah ada.'});
    await query(`INSERT INTO exrates (id,currency_id,created_dt,updated_dt) VALUES (?,?,?,?)`,[id,currency_id,now(),now()]);
    await insertExrateLines(id, lines||[]);
    res.json({id,currency_id});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/exrates/:id', requireEdit, async (req,res) => {
  try {
    await query(`UPDATE exrates SET updated_dt=? WHERE id=?`,[now(),req.params.id]);
    // Get existing tanggal values to avoid duplicates
    const existing = await query(`SELECT tanggal FROM exrate_lines WHERE exrate_id=?`,[req.params.id]);
    const existingDates = new Set(existing.map(r=>r.tanggal));
    // Only insert NEW lines (not already stored by tanggal)
    const newLines = (req.body.lines||[]).filter(l=>!existingDates.has(l.tanggal));
    if(newLines.length > 0) {
      await insertExrateLines(req.params.id, newLines);
    }
    res.json({ok:true, added: newLines.length});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/exrates/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM exrates WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

async function insertExrateLines(exrateId, lines) {
  for (const l of lines) {
    await query(`INSERT INTO exrate_lines (exrate_id,tanggal,rate,rate_conversion) VALUES (?,?,?,?)`,
      [exrateId,l.tanggal||'',l.rate||0,l.rate_conversion||1]);
  }
}

// ── DL-FOH ──
router.get('/dlfoh', requireAuth, async (req,res) => {
  try { res.json(await query(`SELECT * FROM dlfoh ORDER BY catid`)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/dlfoh', requireEdit, async (req,res) => {
  try {
    const {catid,desc,type,rate} = req.body;
    if(!catid) return res.status(400).json({error:'Category ID wajib.'});
    const ex=await query(`SELECT id FROM dlfoh WHERE catid=?`,[catid]);
    if(ex.length) return res.status(400).json({error:'Category ID sudah ada.'});
    const id='DLFOH-'+catid;
    await query(`INSERT INTO dlfoh (id,catid,\`desc\`,type,rate,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id,catid,desc||'',type||'',rate||0,who(req),now(),who(req),now()]);
    res.json({id,catid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/dlfoh/:id', requireEdit, async (req,res) => {
  try {
    const {desc,type,rate}=req.body;
    await query(`UPDATE dlfoh SET \`desc\`=?,type=?,rate=?,modified_by=?,modified_dt=? WHERE id=?`,
      [desc,type,rate||0,who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/dlfoh/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM dlfoh WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── MESIN ──
router.get('/mesin', requireAuth, async (req,res) => {
  try { res.json(await query(`SELECT * FROM mesin ORDER BY machine_id`)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/mesin', requireEdit, async (req,res) => {
  try {
    const {machine_id,machine_name,machine_line}=req.body;
    if(!machine_id||!machine_name||!machine_line) return res.status(400).json({error:'Machine ID, Name, Line wajib.'});
    const mid=machine_id.toUpperCase();
    const ex=await query(`SELECT id FROM mesin WHERE machine_id=?`,[mid]);
    if(ex.length) return res.status(400).json({error:'Machine ID sudah ada.'});
    const id='MCH-'+mid;
    await query(`INSERT INTO mesin (id,machine_id,machine_name,machine_line,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?)`,
      [id,mid,machine_name,machine_line,who(req),now(),who(req),now()]);
    res.json({id,machine_id:mid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/mesin/:id', requireEdit, async (req,res) => {
  try {
    const {machine_name,machine_line}=req.body;
    await query(`UPDATE mesin SET machine_name=?,machine_line=?,modified_by=?,modified_dt=? WHERE id=?`,
      [machine_name,machine_line,who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/mesin/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM mesin WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── KAPASITAS ──
router.get('/kapasitas', requireAuth, async (req,res) => {
  try { res.json(await query(`SELECT * FROM kapasitas ORDER BY kapid`)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/kapasitas', requireEdit, async (req,res) => {
  try {
    const d=req.body;
    if(!d.kapid) return res.status(400).json({error:'Kapasitas ID wajib.'});
    const ex=await query(`SELECT id FROM kapasitas WHERE kapid=?`,[d.kapid]);
    if(ex.length) return res.status(400).json({error:'Kapasitas ID sudah ada.'});
    const id='KAP-'+d.kapid;
    await query(`INSERT INTO kapasitas (id,kapid,item_code,item_name,proses,machine_id,machine_name,tube,fiber,kecepatan,dl,efisiensi,notes,created_by,created_dt,modified_by,modified_dt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,d.kapid,d.item_code||'',d.item_name||'',d.proses||'',d.machine_id||'',d.machine_name||'',d.tube||0,d.fiber||0,d.kecepatan||0,d.dl||0,d.efisiensi||0,d.notes||'',who(req),now(),who(req),now()]);
    res.json({id,kapid:d.kapid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/kapasitas/:id', requireEdit, async (req,res) => {
  try {
    const d=req.body;
    await query(`UPDATE kapasitas SET item_code=?,item_name=?,proses=?,machine_id=?,machine_name=?,tube=?,fiber=?,kecepatan=?,dl=?,efisiensi=?,notes=?,modified_by=?,modified_dt=? WHERE id=?`,
      [d.item_code,d.item_name,d.proses,d.machine_id,d.machine_name,d.tube||0,d.fiber||0,d.kecepatan||0,d.dl||0,d.efisiensi||0,d.notes||'',who(req),now(),req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/kapasitas/:id', requireEdit, async (req,res) => {
  try { await query(`DELETE FROM kapasitas WHERE id=?`,[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── SEQUENCES ──
router.get('/sequences', requireAuth, async (req,res) => {
  try {
    const rows = await query(`SELECT name, value FROM sequences`);
    const out  = {};
    rows.forEach(r => out[r.name] = r.value);
    res.json(out);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
