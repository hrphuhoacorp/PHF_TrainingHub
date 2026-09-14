'use strict';

// PHF HR — QTTH Truth Data · Dữ liệu chi phí kế toán · raw-binary upload endpoint.
//
// WHY A DEDICATED ENDPOINT (not a /api/data action):
//   /api/data is JSON-only, capped at MAX_BODY_BYTES = 1 MB. The FAST
//   "Bảng kê chứng từ theo bộ phận" export is ~4 MB (≈5.5 MB as base64) — it
//   cannot travel through /api/data. This mirrors api/_lib/task-attachment-
//   endpoint.js: a flat, session-authenticated function that reads the raw
//   request body and forwards it to phf-hr-api through the verified-actor QTTH
//   bridge. It NEVER touches the filesystem or Supabase itself.
//
//   POST /api/qtth-accounting-upload?period=YYYY-MM
//        headers: X-Accounting-Filename (URI-encoded), Content-Type: <xlsx mime>
//        body: raw .xlsx bytes
//   -> streaming parse + classification + previewed version persisted in
//      phf-hr-api (accounting.uploadPreview); returns the §16 preview report.
//
// AUTH: session (manager/admin) required here; QTTH manage-authority (Admin OR
// active permission_manager_grant OR dev-operator) is enforced server-side in
// api/_lib/qtth-actions.js + phf-hr-api. Client-supplied actor headers ignored.

const { requireSession } = require('./auth');
const { assertSameOrigin, publicError } = require('./request-guard');
const { isQtthBridgeEnabled } = require('./qtth-bridge');
const { accountingUploadPreviewViaBridge } = require('./qtth-actions');

const PERIOD_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
const MAX_FILE_SIZE = 32 * 1024 * 1024;      // matches qtth-accounting-storage MAX_BYTES
const HARD_BODY_CAP = MAX_FILE_SIZE + 64 * 1024;

function httpError(message, statusCode, code) { const e = new Error(message); e.statusCode = statusCode; e.code = code; return e; }

function sendJsonRaw(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  res.end(JSON.stringify(payload));
}
function sendErrorRaw(res, error) {
  console.error('[PHF QTTH ACCOUNTING UPLOAD]', error && (error.code || error.name || 'ERROR'), error && error.message);
  if (res.headersSent) { try { res.end(); } catch (_) {} return; }
  const out = publicError(error);
  sendJsonRaw(res, out.status, out.body);
}
function q(req, name) { try { return new URL(req.url, 'http://localhost').searchParams.get(name) || ''; } catch (_) { return ''; } }

function readRawBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) { reject(httpError('Tệp vượt quá dung lượng cho phép (tối đa 32 MB).', 413, 'ACCOUNTING_FILE_TOO_LARGE')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleQtthAccountingUpload(req, res) {
  try {
    assertSameOrigin(req);
    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw httpError('Phương thức không được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }
    const session = await requireSession(req, ['manager', 'admin']);

    if (!isQtthBridgeEnabled()) {
      return sendJsonRaw(res, 503, { ok: false, code: 'QTTH_BRIDGE_DISABLED', error: 'Module Quản trị tổng hợp chưa được bật (PHF_QTTH_BRIDGE_ENABLED).' });
    }

    const period = q(req, 'period') || q(req, 'period_month');
    if (!PERIOD_RE.test(period)) throw httpError('Kỳ quản trị không hợp lệ (YYYY-MM).', 400, 'ACCOUNTING_PERIOD_INVALID');

    const clen = req.headers['content-length'];
    if (clen && Number(clen) > HARD_BODY_CAP) throw httpError('Tệp vượt quá dung lượng cho phép (tối đa 32 MB).', 413, 'ACCOUNTING_FILE_TOO_LARGE');

    let fileName = '';
    try { fileName = decodeURIComponent(String(req.headers['x-accounting-filename'] || '')).trim(); } catch (_) { throw httpError('Tên tệp không hợp lệ.', 400, 'ACCOUNTING_FILENAME_INVALID'); }
    if (!fileName) fileName = 'ban-ke-fast-' + period + '.xlsx';

    const buffer = await readRawBody(req, HARD_BODY_CAP);
    if (!buffer.length) throw httpError('Tệp rỗng.', 400, 'ACCOUNTING_FILE_EMPTY');
    if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50) throw httpError('File không phải .xlsx hợp lệ.', 400, 'ACCOUNTING_NOT_XLSX');

    const data = await accountingUploadPreviewViaBridge(session, { periodMonth: period, fileName, buffer });
    sendJsonRaw(res, 200, { ok: true, data });
  } catch (error) {
    sendErrorRaw(res, error);
  }
}

module.exports = { handleQtthAccountingUpload };
