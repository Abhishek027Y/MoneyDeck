// MoneyDeck — document storage service.
// Files live outside the web-served tree; access is only via the authorized
// /api/documents/:id/content endpoint (session + institution/role checks).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('../db');

const UPLOAD_DIR = process.env.MD_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(['application/pdf']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Store raw bytes as an fdr_documents row + on-disk file under uploads/. */
function storeDocument({ fdrId, versionNo = 1, originalName, buffer, uploadedBy }) {
  if (!ALLOWED_MIME.has('application/pdf') || !originalName) {
    throw Object.assign(new Error('Invalid file.'), { status: 400 });
  }
  const safeName = path.basename(originalName).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document.pdf';
  const mime = 'application/pdf';
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  // Reject exact duplicate uploads for the same FDR.
  const dup = db.one(
    'SELECT id FROM fdr_documents WHERE fdr_id = ? AND sha256 = ? AND version_no = ?',
    fdrId, sha256, versionNo
  );
  if (dup) throw Object.assign(new Error('This exact file was already uploaded for this record.'), { status: 409 });

  const relDir = path.join('fdr', String(fdrId));
  const absDir = path.join(UPLOAD_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const diskName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  const absPath = path.join(absDir, diskName);
  fs.writeFileSync(absPath, buffer);

  db.run(
    `UPDATE fdr_documents SET is_current = 0 WHERE fdr_id = ? AND version_no = ?`,
    fdrId, versionNo
  );
  const res = db.run(
    `INSERT INTO fdr_documents (fdr_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, uploaded_by, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    fdrId, versionNo, safeName, mime, buffer.length, sha256, path.join(relDir, diskName).replace(/\\/g, '/'), uploadedBy
  );
  return db.one('SELECT * FROM fdr_documents WHERE id = ?', Number(res.lastInsertRowid));
}

function readDocument(docRow) {
  const abs = path.join(UPLOAD_DIR, docRow.storage_path);
  return fs.readFileSync(abs);
}

function documentUrl(req, docRow) {
  return `${req.protocol}://${req.get('host')}/api/documents/${docRow.id}/content`;
}

function validatePdfFile(file) {
  if (!file) throw Object.assign(new Error('No file selected.'), { status: 400 });
  if (file.size === 0) throw Object.assign(new Error('File is empty.'), { status: 400 });
  if (file.size > MAX_PDF_BYTES) throw Object.assign(new Error('PDF exceeds the 10 MB limit.'), { status: 413 });
  if (path.extname(file.originalname || '').toLowerCase() !== '.pdf') {
    throw Object.assign(new Error('Only PDF files are accepted.'), { status: 400 });
  }
  if (file.mimetype && file.mimetype !== 'application/pdf') {
    throw Object.assign(new Error('Only PDF files are accepted.'), { status: 400 });
  }
}

module.exports = { UPLOAD_DIR, MAX_PDF_BYTES, storeDocument, readDocument, documentUrl, validatePdfFile };
