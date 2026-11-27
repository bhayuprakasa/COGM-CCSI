// routes/item_prices.js — Item Price (harga per item) + Price Log history
'use strict';
const express = require('express');
const router  = express.Router();
const { query } = require('../db/database');
const { requireAuth, requireEdit } = require('../db/auth');

const now = () => new Date().toLocaleString('id-ID',{hour12:false}).replace(',','');
const who = req => req.user ? req.user.nama : 'System';

// ── GET all item prices — item_name & uom tersimpan langsung di item_prices ──
router.get('/item-prices', requireAuth, async (req,res) => {
  try {
    const prices = await query(`SELECT ip.*, ip.uom as item_uom FROM item_prices ip
      ORDER BY ip.item_code`);
    res.json(prices);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── GET price for specific item ──
router.get('/item-prices/:itemCode', requireAuth, async (req,res) => {
  try {
    const [price] = await query(`SELECT ip.*, ip.uom as item_uom FROM item_prices ip
      WHERE ip.item_code=?`, [req.params.itemCode]);
    if(!price) return res.json(null);
    // Also get price history
    const logs = await query(`SELECT * FROM item_price_logs WHERE item_code=? ORDER BY id DESC LIMIT 50`,
      [req.params.itemCode]);
    res.json({...price, logs});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── GET price history for item ──
router.get('/item-prices/:itemCode/logs', requireAuth, async (req,res) => {
  try {
    const logs = await query(`SELECT * FROM item_price_logs WHERE item_code=? ORDER BY id DESC`,
      [req.params.itemCode]);
    res.json(logs);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── POST create/update item price (upsert) ──
router.post('/item-prices', requireEdit, async (req,res) => {
  try {
    const {item_code, item_name, uom, currency, price, hedging, landed, note,
           loose_tube_qty, fiber_per_tube_qty} = req.body;
    if(!item_code) return res.status(400).json({error:'Item Code wajib.'});

    // total_fiber_qty dihitung server-side dari perkalian loose_tube_qty × fiber_per_tube_qty
    const looseTube    = parseInt(loose_tube_qty)||0;
    const fiberPerTube = parseInt(fiber_per_tube_qty)||0;
    const totalFiber   = looseTube * fiberPerTube;

    // Check existing price
    const [existing] = await query(`SELECT * FROM item_prices WHERE item_code=?`, [item_code]);

    if(existing) {
      // Log the change
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code,
         existing.price, parseFloat(price)||0,
         existing.currency, currency||'USD',
         existing.hedging, parseFloat(hedging)||0,
         existing.landed, parseFloat(landed)||0,
         who(req), now(), note||'']);

      // Update price — termasuk item_name, uom, dan fiber spec
      await query(`UPDATE item_prices SET
        item_name=?, uom=?, currency=?, price=?, hedging=?, landed=?,
        loose_tube_qty=?, fiber_per_tube_qty=?, total_fiber_qty=?,
        modified_by=?, modified_dt=? WHERE item_code=?`,
        [item_name||'', uom||'', currency||'USD', parseFloat(price)||0, parseFloat(hedging)||0,
         parseFloat(landed)||0,
         looseTube, fiberPerTube, totalFiber,
         who(req), now(), item_code]);

      res.json({ok:true, action:'updated'});
    } else {
      // Insert new price — termasuk item_name, uom, dan fiber spec
      await query(`INSERT INTO item_prices
        (item_code,item_name,uom,currency,price,hedging,landed,
         loose_tube_qty,fiber_per_tube_qty,total_fiber_qty,
         created_by,created_dt,modified_by,modified_dt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code, item_name||'', uom||'', currency||'USD', parseFloat(price)||0, parseFloat(hedging)||0,
         parseFloat(landed)||0,
         looseTube, fiberPerTube, totalFiber,
         who(req), now(), who(req), now()]);

      // Log first entry
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code, 0, parseFloat(price)||0, '', currency||'USD', 0, parseFloat(hedging)||0,
         0, parseFloat(landed)||0, who(req), now(), note||'Harga awal']);

      res.json({ok:true, action:'created'});
    }
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── PUT update item price ──
router.put('/item-prices/:itemCode', requireEdit, async (req,res) => {
  try {
    const {item_name, uom, currency, price, hedging, landed, note,
           loose_tube_qty, fiber_per_tube_qty, new_item_code} = req.body;
    let item_code = req.params.itemCode;

    // Rename item_code jika new_item_code berbeda dari yang sekarang
    if (new_item_code && new_item_code.trim() !== item_code) {
      const newCode = new_item_code.trim();
      const [conflict] = await query(`SELECT 1 FROM item_prices WHERE item_code=?`, [newCode]);
      if (conflict) return res.status(400).json({error:'Item Code "'+newCode+'" sudah digunakan.'});
      // Update referensi di logs dulu, baru rename di item_prices
      await query(`UPDATE item_price_logs SET item_code=? WHERE item_code=?`, [newCode, item_code]);
      await query(`UPDATE item_prices SET item_code=? WHERE item_code=?`, [newCode, item_code]);
      item_code = newCode; // lanjutkan update field lain dengan code baru
    }

    const [existing] = await query(`SELECT * FROM item_prices WHERE item_code=?`, [item_code]);
    if(!existing) return res.status(404).json({error:'Harga item tidak ditemukan.'});

    // Hanya log jika ada perubahan harga/currency (bukan sekadar update nama/uom)
    const newPrice    = price!=null    ? parseFloat(price)||0    : existing.price;
    const newCurrency = currency||existing.currency||'USD';
    const newHedging  = hedging!=null  ? parseFloat(hedging)||0  : existing.hedging;
    const newLanded   = landed!=null   ? parseFloat(landed)||0   : existing.landed;

    // Fiber spec — gunakan nilai lama jika tidak dikirim
    const newLooseTube    = loose_tube_qty!=null    ? parseInt(loose_tube_qty)||0    : (existing.loose_tube_qty||0);
    const newFiberPerTube = fiber_per_tube_qty!=null? parseInt(fiber_per_tube_qty)||0: (existing.fiber_per_tube_qty||0);
    const newTotalFiber   = newLooseTube * newFiberPerTube;

    const priceChanged = newPrice!==existing.price || newCurrency!==existing.currency ||
                         newHedging!==existing.hedging || newLanded!==existing.landed;
    if(priceChanged) {
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code,
         existing.price, newPrice,
         existing.currency, newCurrency,
         existing.hedging, newHedging,
         existing.landed, newLanded,
         who(req), now(), note||'']);
    }

    // Update — termasuk fiber spec
    await query(`UPDATE item_prices SET
      item_name=?, uom=?, currency=?, price=?, hedging=?, landed=?,
      loose_tube_qty=?, fiber_per_tube_qty=?, total_fiber_qty=?,
      modified_by=?, modified_dt=? WHERE item_code=?`,
      [item_name!=null ? item_name : existing.item_name||'',
       uom!=null       ? uom       : existing.uom||'',
       newCurrency, newPrice, newHedging, newLanded,
       newLooseTube, newFiberPerTube, newTotalFiber,
       who(req), now(), item_code]);

    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── DELETE item price ──
router.delete('/item-prices/:itemCode', requireEdit, async (req,res) => {
  try {
    await query(`DELETE FROM item_prices WHERE item_code=?`, [req.params.itemCode]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── GET all price logs — item_name diambil dari item_prices ──
router.get('/price-logs', requireAuth, async (req,res) => {
  try {
    const logs = await query(`SELECT pl.*, ip.item_name FROM item_price_logs pl
      LEFT JOIN item_prices ip ON ip.item_code = pl.item_code
      ORDER BY pl.id DESC LIMIT 500`);
    res.json(logs);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
