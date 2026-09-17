// db/auth.js — File-persisted sessions, MySQL user lookup
'use strict';
const path = require('path');
const fs   = require('fs');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'sessions.json');
const SESSION_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Load sessions from file on startup ──
let sessions = {};
try {
  if (fs.existsSync(SESSION_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    // Remove expired sessions
    Object.entries(raw).forEach(([token, user]) => {
      if ((now - (user.loginTime || 0)) < SESSION_TTL) sessions[token] = user;
    });
    console.log(`✅ Sessions loaded: ${Object.keys(sessions).length} active`);
  }
} catch(e) { console.warn('Sessions load error:', e.message); }

// ── Persist sessions to file ──
function saveSessions() {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch(e) { console.warn('Sessions save error:', e.message); }
}

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36) +
         Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// ── Login — verify against MySQL ──
async function login(username, password) {
  const { query } = require('./database');
  const rows = await query(
    `SELECT id, username, nama, role, custom_pages FROM users WHERE username=? AND password=?`,
    [username, password]
  );
  if (!rows.length) return null;
  const user = rows[0];
  const token = generateToken();
  sessions[token] = { ...user, loginTime: Date.now() };
  saveSessions();
  console.log(`✅ Login: ${username} (${user.role}) → token=${token.slice(0,8)}...`);
  return token;
}

// ── Logout ──
function logout(token) {
  if (!token) return;
  const user = sessions[token];
  if (user) console.log(`👋 Logout: ${user.username}`);
  delete sessions[token];
  saveSessions();
}

// ── Get user from token (with MySQL refresh) ──
async function getUser(token) {
  if (!token || !token.trim()) return null;
  const t = token.trim();
  const session = sessions[t];
  if (!session) return null;

  // Check TTL
  if ((Date.now() - (session.loginTime || 0)) >= SESSION_TTL) {
    delete sessions[t]; saveSessions(); return null;
  }

  // Refresh user data from MySQL
  try {
    const { query } = require('./database');
    const rows = await query(
      `SELECT id, username, nama, role, custom_pages FROM users WHERE id=?`,
      [session.id]
    );
    if (!rows.length) { delete sessions[t]; saveSessions(); return null; }
    // Update cached session
    sessions[t] = { ...rows[0], loginTime: session.loginTime };
    return sessions[t];
  } catch(e) {
    // MySQL not reachable — use cached session data
    return session;
  }
}

// ── Middleware ──
function requireAuth(req, res, next) {
  const token = (req.headers['x-token'] || req.query.token || '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Sesi berakhir. Silakan login ulang.' });
  }
  getUser(token).then(user => {
    if (!user) {
      console.warn(`🔒 Auth failed: token=${token.slice(0,8)}... path=${req.path}`);
      return res.status(401).json({ error: 'Sesi berakhir. Silakan login ulang.' });
    }
    req.user = user;
    next();
  }).catch(e => {
    console.error('Auth error:', e.message);
    res.status(500).json({ error: 'Auth error: ' + e.message });
  });
}

function requireEdit(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'editor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak. Hanya admin/editor.' });
    }
    next();
  });
}

function requireApprove(req, res, next) {
  requireAuth(req, res, () => {
    const approveRoles = ['admin','finance_director','sales_director','vp_director','approver'];
    if (!approveRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak. Role tidak memiliki izin approval.' });
    }
    next();
  });
}

module.exports = { login, logout, getUser, requireAuth, requireEdit, requireApprove };
