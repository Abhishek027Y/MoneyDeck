// MoneyDeck — Express application entry point
'use strict';
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { attachUser } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
db.open();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(attachUser);
app.use(rateLimit('api'));

// Static frontend (project root: index.html + stitch pages + app pages)
const ROOT = path.join(__dirname, '..', '..');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { index: false, dotfiles: 'ignore' }));
// NOTE: /uploads is intentionally *not* a direct file portal — authorized document
// access flows through /api/documents/:id/content (auth + access control there).

app.use('/api', require('./routes'));

// Plain stand-in root so the API base URL is easy to check.
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'moneydeck-api', time: new Date().toISOString() }));

if (process.env.MD_SERVE_FRONTEND !== '0') {
  // Serve existing pages at their natural paths.
  app.use('/app', express.static(path.join(ROOT, 'app'), { index: false }));
  app.use(express.static(ROOT, { index: 'index.html' }));
}

// 404 for unknown API routes.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler — never leaks stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[moneydeck] error on', req.method, req.url, err);
  else console.warn('[moneydeck] rejected', req.method, req.url, '-', err.message);
  const message = status < 500 && err.message ? err.message : 'Server error. Please try again.';
  res.status(status).json({ error: message });
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  // Start the deterministic notification scheduler alongside the API.
  const { startScheduler } = require('./services/notifications/scheduler');
  startScheduler();
  app.listen(PORT, () => {
    console.log(`[moneydeck] API server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
