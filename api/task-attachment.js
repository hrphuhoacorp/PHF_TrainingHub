'use strict';

// PHF TASK — FILE ATTACHMENT V1 endpoint (flat Vercel function, same pattern as
// api/evidence.js). All logic lives in api/_lib/task-attachment-endpoint.js so
// the local dev server (server.js) can share it verbatim.
//
// bodyParser MUST be disabled: upload sends a raw binary request body and the
// handler reads req as a stream. Without this, @vercel/node would consume the
// body trying to parse it and the handler would see an empty stream.

const { handleTaskAttachmentRequest } = require('./_lib/task-attachment-endpoint');

module.exports = async function handler(req, res) {
  return handleTaskAttachmentRequest(req, res);
};

module.exports.config = { api: { bodyParser: false } };
