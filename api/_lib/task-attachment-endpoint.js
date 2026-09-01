'use strict';

// PHF TASK — FILE ATTACHMENT V1 HTTP endpoint (2026-08-31).
//
// WHY A DEDICATED ENDPOINT (not a /api/data action):
//   /api/data is a JSON-only dispatcher guarded by assertJsonContentType() +
//   MAX_BODY_BYTES = 1 MB. A 4 MB file cannot travel through it in any form,
//   and base64-in-JSON is explicitly rejected (inflates ~33%, blows the 4 MB
//   envelope). The repo's ONLY other binary path (checklist evidence) offloads
//   bytes to Supabase Storage — forbidden here (Task binary must land on the
//   Company VPS filesystem via phf-hr-api, never Supabase).
//   So this mirrors api/evidence.js: a flat, session-authenticated function
//   that streams. It NEVER touches the filesystem or Supabase itself — every
//   byte goes main-app -> task-write-bridge -> phf-hr-api.
//
// TRANSPORT: raw binary request body for upload (Content-Type = the file's
// MIME, metadata in headers). No multipart, no base64. On Vercel this needs
// `config.api.bodyParser = false` (set on the wrapper in api/task-attachment.js).
//
//   POST /api/task-attachment?taskId=<uuid>
//        headers: X-Attachment-Filename (URI-encoded), X-Attachment-Idempotency-Key,
//                 Content-Type: <mime>
//        body: raw file bytes            -> upload
//   POST /api/task-attachment?taskId=<uuid>&op=remove&attachmentId=<uuid>
//        body: optional JSON { reason }  -> logical remove
//   GET  /api/task-attachment?taskId=<uuid>&attachmentId=<uuid>   -> download (stream)
//
// AUTH: session (any role) is required; the Task-level authorization
// (view / upload / remove) is enforced inside task-server-integration.js
// against the SERVER-SIDE session identity. Client-supplied actor headers are
// ignored.

const { Readable } = require('stream');
const { requireSession } = require('./auth');
const { assertSameOrigin, publicError } = require('./request-guard');
const {
  isServerWriteEnabled,
  uploadTaskAttachmentViaServer,
  removeTaskAttachmentViaServer,
  downloadTaskAttachmentViaServer,
} = require('./task-server-integration');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// FILE ATTACHMENT V1 ceiling = 4 MB (mirrors MAX_FILE_SIZE in
// services/phf-hr-api/lib/attachment-policy.js — that layer is authoritative
// and does the byte-accurate check; this is only a fast fail-early guard so a
// too-big body is never buffered). Small slack so the friendly "too large"
// comes from the accurate check, not a premature socket kill.
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const HARD_BODY_CAP = MAX_FILE_SIZE + 64 * 1024;
const MAX_REMOVE_BODY = 8 * 1024;

function httpError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Raw-Node-compatible JSON senders (this handler runs both on Vercel and inside
// server.js, whose `res` has no .status()/.json()). writeHead/end exist on both.
function sendJsonRaw(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(JSON.stringify(payload));
}

function sendErrorRaw(res, error) {
  console.error('[PHF TASK ATTACHMENT]', error && (error.code || error.name || 'ERROR'), error && error.message);
  if (res.headersSent) { try { res.end(); } catch (_e) {} return; }
  const out = publicError(error);
  sendJsonRaw(res, out.status, out.body);
}

function q(req, name) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get(name) || '';
  } catch (_e) {
    return '';
  }
}

function readRawBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) {
        reject(httpError('Tệp vượt quá dung lượng cho phép (tối đa 4 MB).', 413, 'TASK_ATTACHMENT_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleUpload(req, res, session, taskId) {
  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader && Number(contentLengthHeader) > HARD_BODY_CAP) {
    throw httpError('Tệp vượt quá dung lượng cho phép (tối đa 4 MB).', 413, 'TASK_ATTACHMENT_TOO_LARGE');
  }

  let filename = '';
  try {
    filename = decodeURIComponent(String(req.headers['x-attachment-filename'] || '')).trim();
  } catch (_e) {
    throw httpError('Tên tệp không hợp lệ.', 400, 'TASK_ATTACHMENT_FILENAME_INVALID');
  }
  if (!filename) throw httpError('Thiếu tên tệp.', 400, 'TASK_ATTACHMENT_FILENAME_REQUIRED');

  const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!mimeType) throw httpError('Thiếu định dạng tệp (Content-Type).', 400, 'TASK_ATTACHMENT_MIME_REQUIRED');

  const idempotencyKey = String(req.headers['x-attachment-idempotency-key'] || '').trim();
  if (!UUID_RE.test(idempotencyKey)) {
    throw httpError('Idempotency key không hợp lệ (phải là UUID).', 400, 'TASK_ATTACHMENT_IDEMPOTENCY_KEY_INVALID');
  }

  const fileBuffer = await readRawBody(req, HARD_BODY_CAP);
  if (!fileBuffer.length) throw httpError('Tệp rỗng.', 400, 'TASK_ATTACHMENT_EMPTY');

  // actorEmployeeCode is resolved from the session INSIDE the ViaServer call —
  // never from a client header.
  const data = await uploadTaskAttachmentViaServer(session, taskId, fileBuffer, {
    filename,
    mimeType,
    idempotencyKey,
  });
  sendJsonRaw(res, 200, { ok: true, data });
}

async function handleRemove(req, res, session, taskId) {
  const attachmentId = q(req, 'attachmentId');
  if (!attachmentId) throw httpError('Thiếu mã tệp đính kèm.', 400, 'TASK_ATTACHMENT_ID_REQUIRED');

  let reason = null;
  const raw = await readRawBody(req, MAX_REMOVE_BODY);
  if (raw.length) {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed && typeof parsed.reason === 'string' && parsed.reason.trim()) reason = parsed.reason.trim();
    } catch (_e) {
      throw httpError('Dữ liệu gửi lên không hợp lệ.', 400, 'JSON_INVALID');
    }
  }

  const data = await removeTaskAttachmentViaServer(session, taskId, attachmentId, reason);
  sendJsonRaw(res, 200, { ok: true, data });
}

async function handleDownload(req, res, session, taskId) {
  const attachmentId = q(req, 'attachmentId');
  if (!attachmentId) throw httpError('Thiếu mã tệp đính kèm.', 400, 'TASK_ATTACHMENT_ID_REQUIRED');

  const upstream = await downloadTaskAttachmentViaServer(session, taskId, attachmentId);
  if (!upstream || !upstream.body) {
    throw httpError('Không mở được tệp đính kèm.', 502, 'TASK_ATTACHMENT_DOWNLOAD_FAILED');
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  // Prefer the phf-hr-api Content-Disposition (already RFC 5987, UTF-8 filename)
  // but re-derive an ascii fallback here defensively; never echo storage paths.
  const disposition = upstream.headers.get('content-disposition') || 'attachment; filename="attachment"';

  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  const len = upstream.headers.get('content-length');
  if (len) headers['Content-Length'] = len;

  res.writeHead(200, headers);
  if ((req.method || 'GET') === 'HEAD') return res.end();

  const nodeStream = Readable.fromWeb(upstream.body);
  const onAbort = () => { try { nodeStream.destroy(); } catch (_e) {} };
  req.on('close', onAbort);
  nodeStream.on('error', () => { try { res.end(); } catch (_e) {} });
  nodeStream.pipe(res);
}

async function handleTaskAttachmentRequest(req, res) {
  try {
    assertSameOrigin(req);
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      res.setHeader('Allow', 'GET, HEAD, POST');
      throw httpError('Phương thức không được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }

    const session = await requireSession(req, ['learner', 'manager', 'admin']);

    // Attachments are greenfield on Company PostgreSQL — there is no Supabase
    // legacy path. When the server write path is off, the feature is simply
    // unavailable (never a silent Supabase fallback).
    if (!isServerWriteEnabled()) {
      // Explicit (not via publicError, which would opaque-ify any 5xx): this is
      // a known, safe, actionable state — the client should show "not enabled",
      // not a generic system error.
      return sendJsonRaw(res, 503, {
        ok: false,
        code: 'TASK_ATTACHMENT_SERVER_REQUIRED',
        error: 'Tính năng đính kèm tệp chưa được bật.',
      });
    }

    const taskId = q(req, 'taskId');
    if (!UUID_RE.test(taskId)) throw httpError('Mã công việc không hợp lệ.', 400, 'TASK_ATTACHMENT_TASK_ID_INVALID');

    if (method === 'GET' || method === 'HEAD') return await handleDownload(req, res, session, taskId);

    // POST
    if (q(req, 'op') === 'remove') return await handleRemove(req, res, session, taskId);
    return await handleUpload(req, res, session, taskId);
  } catch (error) {
    sendErrorRaw(res, error);
  }
}

module.exports = { handleTaskAttachmentRequest };
