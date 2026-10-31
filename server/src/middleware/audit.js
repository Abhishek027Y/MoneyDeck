// MoneyDeck — audit logging helper.
// audit_logs is append-only at the DB level (triggers block UPDATE/DELETE).
'use strict';
const db = require('../db');

function audit({ actorUserId = null, ip = null, action, entityType = null, entityId = null, details = null }) {
  db.run(
    'INSERT INTO audit_logs (actor_user_id, actor_ip, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    actorUserId, ip, action, entityType,
    entityId === null ? null : String(entityId),
    details ? JSON.stringify(details) : null
  );
}

// Convenience wrapper for req handlers.
function auditReq(req, action, entityType = null, entityId = null, details = null) {
  audit({
    actorUserId: req.user ? req.user.user_id : null,
    ip: req.ip || null,
    action,
    entityType,
    entityId,
    details,
  });
}

module.exports = { audit, auditReq };
