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

const { handleTaskAttachmentRequest } = require('./_lib/task-attachment-endpoint');
const { requireSession } = require('./_lib/auth');
const { streamChecklistEvidenceDownload } = require('./_lib/checklist-evidence');
const { sendError } = require('./_lib/api-response');

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
  if (isEvidenceRoute(req)) return handleEvidence(req, res);
  return handleTaskAttachmentRequest(req, res);
};

module.exports.config = { api: { bodyParser: false } };
