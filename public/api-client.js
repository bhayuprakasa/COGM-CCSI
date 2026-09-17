// api-client.js — connects frontend to backend REST API

const API_BASE = window.location.origin + '/api';

// ── Server version check — clear old token if server changed ──
(function(){
  const CURRENT_VERSION = '2.0-mysql';
  const savedVersion = localStorage.getItem('cogm_server_version');
  if (savedVersion !== CURRENT_VERSION) {
    localStorage.removeItem('cogm_token'); // clear old JSON-server token
    localStorage.setItem('cogm_server_version', CURRENT_VERSION);
    console.log('🔄 Server version changed to MySQL — session cleared, please login again.');
  }
})();

// Token always read fresh from localStorage — never stale
function getToken() { return localStorage.getItem('cogm_token') || ''; }

// ── HTTP helpers ──
async function apiGet(path) {
  const r = await fetch(API_BASE + path, {
    headers: { 'x-token': getToken() }, cache: 'no-cache'
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'API error ' + r.status);
  return data;
}

async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-token': getToken() },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'API error ' + r.status);
  return data;
}

async function apiPut(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-token': getToken() },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'API error ' + r.status);
  return data;
}

async function apiDelete(path) {
  const r = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: { 'x-token': getToken() }
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'API error ' + r.status);
  return data;
}

// ── Auth ──
window.serverLogin = async function(username, password) {
  const r = await fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Login gagal');
  // Store token in localStorage — getToken() will pick it up automatically
  localStorage.setItem('cogm_token', data.token);
  // Also update _authToken in main script scope if it exists
  if (typeof _authToken !== 'undefined') _authToken = data.token;
  return data.user;
};

window.serverLogout = async function() {
  try { await apiPost('/auth/logout', {}); } catch(e) {}
  localStorage.removeItem('cogm_token');
  if (typeof _authToken !== 'undefined') _authToken = '';
};

// ── Load ALL data from server → fully replace in-memory DB ──
window.loadAllData = async function() {
  const [items, prices, exrates, dlfoh, mesin, kapasitas, masterbom, bom, history, seqs] = await Promise.all([
    apiGet('/items'),
    apiGet('/prices'),
    apiGet('/exrates'),
    apiGet('/dlfoh'),
    apiGet('/mesin'),
    apiGet('/kapasitas'),
    apiGet('/masterbom'),
    apiGet('/bom'),
    apiGet('/bom/history'),
    apiGet('/sequences'),
  ]);

  // Fully replace — never merge with seed/sample data
  DB.items      = items      || [];
  DB.prices     = prices     || [];
  DB.exrates    = exrates    || [];
  DB.dlfoh      = dlfoh      || [];
  DB.mesin      = mesin      || [];
  DB.kap        = kapasitas  || [];
  DB.masterbom  = masterbom  || [];
  DB.bom        = bom        || [];
  DB.bomHistory = history    || [];

  // Sync sequence counters to avoid ID collisions
  if (seqs) {
    try { if (typeof itemSeq  !== 'undefined') itemSeq  = seqs.item      || 0; } catch(e){}
    try { if (typeof priceSeq !== 'undefined') priceSeq = seqs.price     || 0; } catch(e){}
    try { if (typeof kapSeq   !== 'undefined') kapSeq   = seqs.kap       || 0; } catch(e){}
    try { if (typeof mbomSeq  !== 'undefined') mbomSeq  = seqs.masterbom || 0; } catch(e){}
    try { if (typeof bomSeq   !== 'undefined') bomSeq   = seqs.bom       || 0; } catch(e){}
  }

  console.log('✅ DB loaded from server:', {
    items: DB.items.length, prices: DB.prices.length,
    mesin: DB.mesin.length, bom: DB.bom.length,
  });
  return true;
};

// ── API operations ──
window.API = {
  items:     { create: d => apiPost('/items',d),      update: (id,d) => apiPut('/items/'+id,d),      delete: id => apiDelete('/items/'+id) },
  prices:    { create: d => apiPost('/prices',d),     update: (id,d) => apiPut('/prices/'+id,d),     delete: id => apiDelete('/prices/'+id) },
  exrates:   { create: d => apiPost('/exrates',d),    update: (id,d) => apiPut('/exrates/'+id,d),    delete: id => apiDelete('/exrates/'+id) },
  dlfoh:     { create: d => apiPost('/dlfoh',d),      update: (id,d) => apiPut('/dlfoh/'+id,d),      delete: id => apiDelete('/dlfoh/'+id) },
  mesin:     { create: d => apiPost('/mesin',d),      update: (id,d) => apiPut('/mesin/'+id,d),      delete: id => apiDelete('/mesin/'+id) },
  kapasitas: { create: d => apiPost('/kapasitas',d),  update: (id,d) => apiPut('/kapasitas/'+id,d),  delete: id => apiDelete('/kapasitas/'+id) },
  masterbom: { create: d => apiPost('/masterbom',d),  update: (id,d) => apiPut('/masterbom/'+id,d),  delete: id => apiDelete('/masterbom/'+id) },
  bom: {
    create:  d           => apiPost('/bom', d),
    update:  (id, d)     => apiPut('/bom/'+id, d),
    delete:  id          => apiDelete('/bom/'+id),
    submit:  id          => apiPost('/bom/'+id+'/submit', {}),
    approve: (id,status,note) => apiPost('/bom/'+id+'/approve', {status, note}),
  },
  users: {
    list:   ()     => apiGet('/users'),
    create: d      => apiPost('/users', d),
    update: (id,d) => apiPut('/users/'+id, d),
    delete: id     => apiDelete('/users/'+id),
  },
};

// ── apiSave helper (also used in main script) ──
window.apiSave = function(apiCall, onSuccess) {
  Promise.resolve(apiCall).then(function(res) {
    onSuccess(res);
  }).catch(function(e) {
    console.error('API error:', e);
    var msg = e.message || '';
    // Auto-logout on ANY 401 / session expired error
    if (msg.includes('erakhir') || msg.includes('401') || msg.includes('login') || msg.includes('autentikasi')) {
      localStorage.removeItem('cogm_token');
      if (typeof _authToken !== 'undefined') _authToken = '';
      if (typeof currentUser !== 'undefined') currentUser = null;
      if (typeof toast !== 'undefined') toast('Sesi berakhir — silakan login ulang.', 'error');
      // Show login screen immediately
      var ls = document.getElementById('login_screen');
      if (ls) { ls.style.display = 'flex'; }
      var lp = document.getElementById('login_pass');
      if (lp) lp.value = '';
    } else {
      if (typeof toast !== 'undefined') toast('Error: ' + msg, 'error');
      else alert('Error: ' + msg);
    }
  });
};

console.log('✅ api-client.js loaded, BASE:', API_BASE);
