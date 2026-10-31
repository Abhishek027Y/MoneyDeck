// MoneyDeck — authentication, session, CSRF, RBAC middleware
'use strict';
const crypto = require('node:crypto');
const db = require('../db');

const SESSION_COOKIE = 'md_session';
const SESSION_TTL_HOURS = 12;

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.run(
    'INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)',
    token, userId, csrf, expires
  );
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), userId);
  return { token, csrf, expiresAt: expires };
}

function revokeSession(token) {
  if (!token) return;
  db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', new Date().toISOString(), token);
}

function setSessionCookie(res, token, maxAgeSeconds) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}`
  );
}

function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.one(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
            u.id AS user_id, u.role_id, u.institution_id, u.email, u.display_name,
            u.designation, r.code AS role_code, r.name AS role_name,
            i.name AS institution_name, i.aicte_pid
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE s.id = ?`,
    token
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!row.user_id) return null;
  return row;
}

// Attach req.user (or null). Does not reject — used for optional endpoints.
function attachUser(req, _res, next) {
  req.user = getSessionUser(req);
  req.sessionToken = req.user ? parseCookies(req)[SESSION_COOKIE] : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

// CSRF: mutating verbs must carry the session's csrf token via header or body.
// GET/HEAD/OPTIONS and unauthenticated requests (e.g. login) pass through.
function requireCsrf(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return next();
  const supplied = req.get('X-MD-CSRF') || (req.body && req.body._csrf);
  if (!supplied || supplied !== req.user.csrf_token) {
    return res.status(403).json({ error: 'CSRF check failed. Refresh the page and try again.' });
  }
  next();
}

// Global router-level guard: anonymous requests pass through; signed-in
// mutating requests must present the CSRF token.
function csrfGuard(req, res, next) {
  if (!req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return next();
  return requireCsrf(req, res, next);
}

// RBAC: exact role match or, when using the permissions model, check role_permissions.
function hasPermission(roleId, code) {
  return !!db.one(
    `SELECT 1 FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.code = ?`,
    roleId, code
  );
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (!hasPermission(req.user.role_id, code)) {
      return res.status(403).json({ error: 'Your role does not allow this action.' });
    }
    next();
  };
}

function requireRole(...roleCodes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (!roleCodes.includes(req.user.role_code)) {
      return res.status(403).json({ error: 'You do not have access to this area.' });
    }
    next();
  };
}

// College users may only ever touch their own institution's data.
function requireSameInstitution(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (req.user.role_code === 'college') {
    const requested = Number(req.params.institutionId || req.body.institution_id || 0);
    if (requested && requested !== req.user.institution_id) {
      return res.status(403).json({ error: 'Access denied for another institution.' });
    }
  }
  next();
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_HOURS,
  parseCookies, createSession, revokeSession, setSessionCookie,
  attachUser, requireAuth, requireCsrf, csrfGuard, requireRole, requirePermission,
  requireSameInstitution, hasPermission,
};
