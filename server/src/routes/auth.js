// MoneyDeck — authentication routes
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.post('/login', rateLimit('login'), (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your registered email and password.' });
  }
  const user = db.one(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, i.name AS institution_name,
            i.aicte_pid, i.region_bureau
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.email = ? AND u.is_active = 1`,
    String(email).trim().toLowerCase()
  );
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    audit({
      action: 'login.failed', ip: req.ip,
      details: { email: String(email).slice(0, 120) },
    });
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  const session = auth.createSession(user.id);
  auth.setSessionCookie(res, session.token, auth.SESSION_TTL_HOURS * 3600);
  audit({ actorUserId: user.id, ip: req.ip, action: 'login', entityType: 'user', entityId: user.id, details: { role: user.role_code } });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      designation: user.designation,
      role: user.role_code,
      roleName: user.role_name,
      institutionId: user.institution_id,
      institutionName: user.institution_name,
      aictePid: user.aicte_pid,
      regionBureau: user.region_bureau,
    },
    csrfToken: session.csrf,
    expiresAt: session.expiresAt,
  });
});

router.post('/logout', (req, res) => {
  if (req.user) {
    audit({
      actorUserId: req.user.user_id, ip: req.ip, action: 'logout', entityType: 'user', entityId: req.user.user_id,
    });
  }
  auth.revokeSession(req.sessionToken);
  auth.setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.user_id,
      email: req.user.email,
      displayName: req.user.display_name,
      designation: req.user.designation,
      role: req.user.role_code,
      roleName: req.user.role_name,
      institutionId: req.user.institution_id,
      institutionName: req.user.institution_name,
      aictePid: req.user.aicte_pid,
    },
    csrfToken: req.user.csrf_token,
  });
});

// CSRF token fetch for pages that lost their initial handoff (re-login guard).
router.get('/csrf', auth.requireAuth, (req, res) => {
  res.json({ csrfToken: req.user.csrf_token });
});

module.exports = router;
