// MoneyDeck — document management routes (authorized access only)
'use strict';
const express = require('express');
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { auditReq, audit } = require('../middleware/audit');
const storage = require('../services/storage');

const router = express.Router();

// Multer: memory buffer only; size/type validated before persisting.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: storage.MAX_PDF_BYTES, files: 1 },
});

/** Can this user read this FDR's documents? */
function canAccessFdr(user, fdrRow) {
  if (!fdrRow) return false;
  if (user.role_code === 'officer') return true;
  return user.role_code === 'college' && user.institution_id === fdrRow.institution_id;
}

function getFdrForUser(req, id) {
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ?', id);
  if (!fdr) return { error: 404 };
  if (!canAccessFdr(req.user, fdr)) return { error: 403 };
  return { fdr };
}

// GET /api/documents/:id/content — authorized preview/download
router.get('/:id/content', auth.requireAuth, (req, res) => {
  const doc = db.one(
    `SELECT d.*, f.institution_id FROM fdr_documents d JOIN fdr_records f ON f.id = d.fdr_id WHERE d.id = ?`,
    Number(req.params.id)
  );
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!canAccessFdr(req.user, { institution_id: doc.institution_id })) {
    return res.status(403).json({ error: 'Access denied for this document.' });
  }
  const buffer = storage.readDocument(doc);
  audit({
    actorUserId: req.user.user_id, ip: req.ip, action: 'document.downloaded',
    entityType: 'fdr_document', entityId: doc.id, details: { sha256: doc.sha256 },
  });
  res.setHeader('Content-Type', 'application/pdf');
  const disp = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="${doc.file_name}"`);
  res.send(buffer);
});

// GET /api/documents?institutionId=..&fdrId=.. — list (metadata) within ACL
router.get('/', auth.requireAuth, (req, res) => {
  const clauses = [];
  const params = [];
  if (req.user.role_code === 'college') {
    clauses.push('f.institution_id = ?'); params.push(req.user.institution_id);
  } else if (req.query.institutionId) {
    clauses.push('f.institution_id = ?'); params.push(Number(req.query.institutionId));
  }
  if (req.query.fdrId) {
    clauses.push('d.fdr_id = ?'); params.push(Number(req.query.fdrId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.all(
    `SELECT d.id, d.fdr_id, d.version_no, d.file_name, d.size_bytes, d.sha256, d.uploaded_at, d.is_current,
            u.display_name AS uploaded_by_name, f.submission_ref
       FROM fdr_documents d
       JOIN fdr_records f ON f.id = d.fdr_id
       JOIN users u ON u.id = d.uploaded_by
       ${where}
      ORDER BY d.fdr_id, d.version_no`,
    ...params
  );
  res.json({ documents: rows });
});

// GET /api/documents/:id — metadata
router.get('/:id', auth.requireAuth, (req, res) => {
  const doc = db.one(
    `SELECT d.*, f.institution_id, u.display_name AS uploaded_by_name
       FROM fdr_documents d JOIN fdr_records f ON f.id = d.fdr_id
       JOIN users u ON u.id = d.uploaded_by
      WHERE d.id = ?`,
    Number(req.params.id)
  );
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (!canAccessFdr(req.user, { institution_id: doc.institution_id })) {
    return res.status(403).json({ error: 'Access denied for this document.' });
  }
  res.json({ document: doc });
});

// POST /api/documents/upload — multipart: fdrId, versionNo?, file
router.post('/upload', auth.requireAuth, auth.requireCsrf, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(Object.assign(new Error('PDF exceeds the 10 MB limit.'), { status: 413 }));
    }
    return next(err);
  });
}, (req, res) => {
  try {
    storage.validatePdfFile(req.file);
    const fdrId = Number(req.body.fdrId);
    const { fdr, error } = getFdrForUser(req, fdrId);
    if (error === 404) return res.status(404).json({ error: 'FDR record not found.' });
    if (error === 403) return res.status(403).json({ error: 'Access denied for this FDR record.' });

    const versionNo = Math.max(1, Number(req.body.versionNo) || fdr.version_no || 1);
    const doc = storage.storeDocument({
      fdrId: fdr.id,
      versionNo,
      originalName: req.file.originalname,
      buffer: req.file.buffer,
      uploadedBy: req.user.user_id,
    });
    auditReq(req, 'document.uploaded', 'fdr_document', doc.id, {
      fdrId: fdr.id, sha256: doc.sha256, fileName: doc.file_name,
    });
    // OCR the newly uploaded document version after upload (async-ish, same tick).
    const ocrPipeline = require('../services/ocr/pipeline');
    let runId = null;
    try { runId = ocrPipeline.processDocument(doc, fdr); } catch { /* logged in pipeline */ }
    res.status(201).json({ document: doc, ocrRunId: runId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
