'use strict';

// PHF — SHARED BINARY/MEDIA Vercel function (Hobby 12-function budget).
//
// Hosts TWO unrelated public routes in ONE serverless function to stay under
// the Vercel Hobby serverless-functions-per-deployment limit. The public URLs
// are unchanged; only the physical function file is shared:
//
//   POST/GET /api/task-attachment?taskId=<uuid>[&op=remove&attachmentId=<uuid>]
//        -> FILE ATTACHMENT V1 raw-binary endpoint. Delegates verbatim to
//           api/_lib/task-attachment-endpoint.js. The request body is NEVER
//           read or transformed before that handler (bodyParser disabled
//           below); 4 MB cap + byte integrity are enforced there and in
//           services/phf-hr-api/lib/attachment-policy.js.
//
//   GET/HEAD /evidence/:id   (vercel.json rewrites -> this file with
//           ?id=:id&__phf_route=evidence)
//        -> branded Checklist evidence viewer. Same behaviour as the former
//           api/evidence.js: requireSession(['learner','manager','admin'])
//           then streamChecklistEvidenceDownload(). GET/HEAD only. The evidence
//           branch never touches the request body, so bodyParser:false is inert
//           for it.
//
// Dispatch is by route marker only (query flag set by the rewrite, or the
// literal path when hit directly / in local dev). No business logic here.
//
// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY PREVIEW RAW BODY TEST — REMOVE BEFORE PROD
// A third, throwaway branch (/api/task-raw-body-echo, rewritten here with
// ?__phf_route=raw-body-echo) exists ONLY to verify that Vercel Preview
// delivers a raw binary POST body byte-intact under bodyParser:false. It reads
// the stream, returns { length, sha256 } and NOTHING ELSE — no session, no
// task-server-integration, no write bridge, no phf-hr-api, no DB, no Supabase,
// no filesystem, no body echoed back. Gated by its own Preview-only secret
// TASK_RAW_BODY_ECHO_SECRET (fail-closed: 503 when unset, 401 on mismatch).
// This branch and its vercel.json rewrite + test MUST be deleted before the
// 1.66.8 production release. See scripts/test-task-raw-body-echo-temp-v1.js.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { handleTaskAttachmentRequest } = require('./_lib/task-attachment-endpoint');
const { requireSession } = require('./_lib/auth');
const { streamChecklistEvidenceDownload } = require('./_lib/checklist-evidence');
const { sendError } = require('./_lib/api-response');

// TEMPORARY PREVIEW RAW BODY TEST — REMOVE BEFORE PROD
const RAW_ECHO_MAX_BYTES = Math.floor(4.25 * 1024 * 1024); // 4,456,448 — under Vercel's platform body ceiling

function isRawBodyEchoRoute(req) {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.searchParams.get('__phf_route') === 'raw-body-echo') return true;
    if (u.pathname === '/api/task-raw-body-echo') return true;
    return false;
  } catch (_e) {
    return false;
  }
}

function echoJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function handleRawBodyEcho(req, res) {
  // TEMPORARY PREVIEW RAW BODY TEST — REMOVE BEFORE PROD
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return echoJson(res, 405, { ok: false, error: 'Method not allowed' });
  }
  // Secret check BEFORE touching the body — nothing is read on an unauthorized call.
  const expected = String(process.env.TASK_RAW_BODY_ECHO_SECRET || '').trim();
  if (!expected) {
    return echoJson(res, 503, { ok: false, code: 'RAW_BODY_ECHO_DISABLED', error: 'Raw-body echo test chưa được bật.' });
  }
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== expected) {
    return echoJson(res, 401, { ok: false, code: 'RAW_BODY_ECHO_UNAUTHORIZED', error: 'Sai secret.' });
  }

  const cap = RAW_ECHO_MAX_BYTES;
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > cap) {
    return echoJson(res, 413, { ok: false, code: 'RAW_BODY_ECHO_TOO_LARGE', error: 'Body vượt giới hạn test (4.25 MB).' });
  }

  const hash = crypto.createHash('sha256');
  let length = 0;
  let aborted = false;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        length += chunk.length;
        if (length > cap) {
          aborted = true;
          try { req.destroy(); } catch (_e) {}
          reject(Object.assign(new Error('too large'), { code: 'RAW_BODY_ECHO_TOO_LARGE' }));
          return;
        }
        hash.update(chunk);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
  } catch (err) {
    if (aborted || (err && err.code === 'RAW_BODY_ECHO_TOO_LARGE')) {
      return echoJson(res, 413, { ok: false, code: 'RAW_BODY_ECHO_TOO_LARGE', error: 'Body vượt giới hạn test (4.25 MB).' });
    }
    return echoJson(res, 400, { ok: false, code: 'RAW_BODY_ECHO_READ_FAILED', error: 'Không đọc được body.' });
  }

  return echoJson(res, 200, { ok: true, length, sha256: hash.digest('hex') });
}

function isEvidenceRoute(req) {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.searchParams.get('__phf_route') === 'evidence') return true;
    if (u.pathname === '/api/evidence') return true;
    if (u.pathname.startsWith('/evidence/')) return true;
    return false;
  } catch (_e) {
    return false;
  }
}

async function handleEvidence(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, HEAD');
      const error = new Error('Phương thức không được hỗ trợ.');
      error.statusCode = 405;
      error.code = 'METHOD_NOT_ALLOWED';
      throw error;
    }
    const session = await requireSession(req, ['learner', 'manager', 'admin']);
    let id = String((req.query && req.query.id) || '').trim();
    if (!id) {
      try { id = String(new URL(req.url || '/', 'http://localhost').searchParams.get('id') || '').trim(); } catch (_e) {}
    }
    await streamChecklistEvidenceDownload(req, res, session, id);
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = async function handler(req, res) {
  // TEMPORARY PREVIEW RAW BODY TEST — REMOVE BEFORE PROD (must run first, fully
  // independent of attachment/evidence business handling).
  if (isRawBodyEchoRoute(req)) return handleRawBodyEcho(req, res);
  if (isEvidenceRoute(req)) return handleEvidence(req, res);
  return handleTaskAttachmentRequest(req, res);
};

module.exports.config = { api: { bodyParser: false } };
