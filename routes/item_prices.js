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
    const {item_code, item_name, uom, currency, price, hedging, landed, effective_date, note} = req.body;
    if(!item_code) return res.status(400).json({error:'Item Code wajib.'});

    // Check existing price
    const [existing] = await query(`SELECT * FROM item_prices WHERE item_code=?`, [item_code]);

    if(existing) {
      // Log the change
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,old_effective_date,new_effective_date,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code,
         existing.price, parseFloat(price)||0,
         existing.currency, currency||'USD',
         existing.hedging, parseFloat(hedging)||0,
         existing.landed, parseFloat(landed)||0,
         existing.effective_date, effective_date||'',
         who(req), now(), note||'']);

      // Update price — termasuk item_name dan uom
      await query(`UPDATE item_prices SET
        item_name=?, uom=?, currency=?, price=?, hedging=?, landed=?, effective_date=?,
        modified_by=?, modified_dt=? WHERE item_code=?`,
        [item_name||'', uom||'', currency||'USD', parseFloat(price)||0, parseFloat(hedging)||0,
         parseFloat(landed)||0, effective_date||'', who(req), now(), item_code]);

      res.json({ok:true, action:'updated'});
    } else {
      // Insert new price — termasuk item_name dan uom
      await query(`INSERT INTO item_prices
        (item_code,item_name,uom,currency,price,hedging,landed,effective_date,created_by,created_dt,modified_by,modified_dt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code, item_name||'', uom||'', currency||'USD', parseFloat(price)||0, parseFloat(hedging)||0,
         parseFloat(landed)||0, effective_date||now(), who(req), now(), who(req), now()]);

      // Log first entry
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,old_effective_date,new_effective_date,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code, 0, parseFloat(price)||0, '', currency||'USD', 0, parseFloat(hedging)||0,
         0, parseFloat(landed)||0, '', effective_date||'', who(req), now(), note||'Harga awal']);

      res.json({ok:true, action:'created'});
    }
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── PUT update item price ──
router.put('/item-prices/:itemCode', requireEdit, async (req,res) => {
  try {
    const {item_name, uom, currency, price, hedging, landed, effective_date, note} = req.body;
    const item_code = req.params.itemCode;

    const [existing] = await query(`SELECT * FROM item_prices WHERE item_code=?`, [item_code]);
    if(!existing) return res.status(404).json({error:'Harga item tidak ditemukan.'});

    // Hanya log jika ada perubahan harga/currency (bukan sekadar update nama/uom)
    const newPrice    = price!=null    ? parseFloat(price)||0    : existing.price;
    const newCurrency = currency||existing.currency||'USD';
    const newHedging  = hedging!=null  ? parseFloat(hedging)||0  : existing.hedging;
    const newLanded   = landed!=null   ? parseFloat(landed)||0   : existing.landed;
    const newEffDate  = effective_date!=null ? effective_date     : existing.effective_date||'';
    const priceChanged = newPrice!==existing.price || newCurrency!==existing.currency ||
                         newHedging!==existing.hedging || newLanded!==existing.landed;
    if(priceChanged) {
      await query(`INSERT INTO item_price_logs
        (item_code,old_price,new_price,old_currency,new_currency,old_hedging,new_hedging,
         old_landed,new_landed,old_effective_date,new_effective_date,changed_by,changed_dt,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item_code,
         existing.price, newPrice,
         existing.currency, newCurrency,
         existing.hedging, newHedging,
         existing.landed, newLanded,
         existing.effective_date, newEffDate,
         who(req), now(), note||'']);
    }

    // Update — pakai variabel yang sudah dihitung di atas (partial update aman)
    await query(`UPDATE item_prices SET
      item_name=?, uom=?, currency=?, price=?, hedging=?, landed=?, effective_date=?,
      modified_by=?, modified_dt=? WHERE item_code=?`,
      [item_name!=null ? item_name : existing.item_name||'',
       uom!=null       ? uom       : existing.uom||'',
       newCurrency, newPrice, newHedging, newLanded, newEffDate,
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
