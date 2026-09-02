'use strict';

/*
 * PHF TASK — FILE ATTACHMENT V1 action-layer (HTTP endpoint) mock test.
 *
 * MOCK ONLY. api/_lib/task-server-integration.js, api/_lib/auth.js and
 * api/_lib/request-guard.js are replaced via require.cache before loading
 * api/_lib/task-attachment-endpoint.js. No DB, no phf-hr-api, no network.
 *
 * Proves the endpoint contract:
 *   - upload reaches uploadTaskAttachmentViaServer with the EXACT binary bytes
 *     + filename/mime/idempotencyKey; actor is NEVER taken from a client header
 *   - auth denial (ViaServer 403) -> JSON error, bridge/ViaServer stops there
 *   - > 4 MB body -> friendly 413, ViaServer not called
 *   - malformed idempotency key -> 400, ViaServer not called
 *   - DOCX / XLSX mime forwarded unchanged
 *   - remove reaches removeTaskAttachmentViaServer(session, taskId, attId, reason)
 *   - remove auth denial -> 403
 *   - download reaches downloadTaskAttachmentViaServer, streams bytes, sets
 *     Content-Type / Content-Disposition / Cache-Control: private, no-store and
 *     never exposes a storage path/object key
 *   - server write path OFF -> 503, ViaServer not called
 */

const path = require('path');
const { Readable } = require('stream');
const { EventEmitter } = require('events');

const ROOT = path.resolve(__dirname, '..');
const endpointPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-attachment-endpoint'));
const integrationPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-server-integration'));
const authPath = require.resolve(path.join(ROOT, 'api', '_lib', 'auth'));
const guardPath = require.resolve(path.join(ROOT, 'api', '_lib', 'request-guard'));
const realGuard = require(guardPath);

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const ATT_ID = '22222222-2222-4222-8222-222222222222';
const IDEM = '33333333-3333-4333-8333-333333333333';

function load(overrides = {}) {
  delete require.cache[endpointPath];
  delete require.cache[integrationPath];
  delete require.cache[authPath];
  delete require.cache[guardPath];

  const calls = { upload: [], remove: [], download: [], session: [] };

  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      requireSession: async (req, roles) => {
        calls.session.push(roles);
        if (overrides.sessionThrows) throw overrides.sessionThrows;
        return { role: 'manager', account: { employeeCode: 'PHF010' } };
      },
    },
  };
  require.cache[guardPath] = {
    id: guardPath, filename: guardPath, loaded: true,
    exports: Object.assign({}, realGuard, {
      assertSameOrigin: () => {},
    }),
  };
  require.cache[integrationPath] = {
    id: integrationPath, filename: integrationPath, loaded: true,
    exports: {
      isServerWriteEnabled: () => overrides.writeEnabled !== false,
      uploadTaskAttachmentViaServer: async (session, taskId, fileBuffer, opts) => {
        calls.upload.push({ session, taskId, fileBuffer, opts });
        if (overrides.uploadThrows) throw overrides.uploadThrows;
        return overrides.uploadResult || { id: 'att-new', originalFilename: opts.filename, mimeType: opts.mimeType };
      },
      removeTaskAttachmentViaServer: async (session, taskId, attachmentId, reason) => {
        calls.remove.push({ session, taskId, attachmentId, reason });
        if (overrides.removeThrows) throw overrides.removeThrows;
        return overrides.removeResult || { id: attachmentId, status: 'pending_delete' };
      },
      downloadTaskAttachmentViaServer: async (session, taskId, attachmentId) => {
        calls.download.push({ session, taskId, attachmentId });
        if (overrides.downloadThrows) throw overrides.downloadThrows;
        const bytes = overrides.downloadBytes || Buffer.from('PDF-BYTES-HERE');
        const headers = new Map([
          ['content-type', 'application/pdf'],
          ['content-disposition', "attachment; filename=\"minh chứng.pdf\"; filename*=UTF-8''minh%20ch%E1%BB%A9ng.pdf"],
          ['content-length', String(bytes.length)],
        ]);
        return { headers: { get: (k) => headers.get(String(k).toLowerCase()) || null }, body: Readable.toWeb(Readable.from(bytes)) };
      },
    },
  };

  const { handleTaskAttachmentRequest } = require(endpointPath);
  return { handleTaskAttachmentRequest, calls };
}

function makeReq(method, url, headers, bodyBuf) {
  // A real paused Readable — data flows only once readRawBody() attaches its
  // 'data' listener, so no chunk is lost to a premature emit.
  const req = Readable.from(bodyBuf && bodyBuf.length ? [bodyBuf] : []);
  req.method = method;
  req.url = url;
  req.headers = Object.assign({ origin: 'http://localhost', host: 'localhost' }, headers || {});
  const origDestroy = req.destroy.bind(req);
  req.destroy = (e) => { req.emit('close'); return origDestroy(e); };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.headersSent = false;
  res.statusCode = 0;
  res._chunks = [];
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.writeHead = (status, hdrs) => { res.statusCode = status; Object.assign(res.headers, Object.fromEntries(Object.entries(hdrs || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
  res.write = (c) => { res._chunks.push(Buffer.from(c)); return true; };
  res.end = (c) => { if (c) res._chunks.push(Buffer.from(c)); res.headersSent = true; res.emit('finish'); res._done = true; };
  return res;
}

function bodyText(res) { return Buffer.concat(res._chunks).toString('utf8'); }
function bodyJson(res) { try { return JSON.parse(bodyText(res)); } catch (_e) { return null; } }
async function settle(res) { for (let i = 0; i < 50 && !res._done; i++) await new Promise((r) => setImmediate(r)); }

async function main() {
  // 1) upload — exact bytes + metadata; actor NOT from header
  {
    const { handleTaskAttachmentRequest, calls } = load();
    const file = Buffer.from('%PDF-1.4 hello attachment');
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
      'content-type': 'application/pdf',
      'content-length': String(file.length),
      'x-attachment-filename': encodeURIComponent('minh chứng.pdf'),
      'x-attachment-idempotency-key': IDEM,
      'x-attachment-actor-employee-code': 'HACKER999',
    }, file);
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    const c = calls.upload[0];
    check('1: upload reaches ViaServer with exact bytes', !!c && Buffer.compare(c.fileBuffer, file) === 0);
    check('1b: filename/mime/idempotencyKey forwarded', c && c.opts.filename === 'minh chứng.pdf' && c.opts.mimeType === 'application/pdf' && c.opts.idempotencyKey === IDEM);
    check('1c: no actorEmployeeCode taken from client header', c && !('actorEmployeeCode' in c.opts) && JSON.stringify(c.opts).indexOf('HACKER999') === -1);
    check('1d: 200 + ok envelope', res.statusCode === 200 && bodyJson(res).ok === true);
  }

  // 2) auth denial from ViaServer -> JSON error
  {
    const { handleTaskAttachmentRequest, calls } = load({ uploadThrows: Object.assign(new Error('deny'), { code: 'TASK_ATTACHMENT_UPLOAD_DENIED', statusCode: 403 }) });
    const file = Buffer.from('x');
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
      'content-type': 'application/pdf', 'x-attachment-filename': 'a.pdf', 'x-attachment-idempotency-key': IDEM,
    }, file);
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('2: upload denied -> 403 friendly JSON', res.statusCode === 403 && bodyJson(res).code === 'TASK_ATTACHMENT_UPLOAD_DENIED' && bodyJson(res).ok === false);
    check('2b: ViaServer was called exactly once (denial is its job)', calls.upload.length === 1);
  }

  // 3) > 4 MB -> 413, ViaServer NOT called
  {
    const { handleTaskAttachmentRequest, calls } = load();
    const big = Buffer.alloc(4 * 1024 * 1024 + 200 * 1024, 1);
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
      'content-type': 'application/pdf', 'content-length': String(big.length),
      'x-attachment-filename': 'big.pdf', 'x-attachment-idempotency-key': IDEM,
    }, big);
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('3: > 4 MB -> 413 TASK_ATTACHMENT_TOO_LARGE, ViaServer not called', res.statusCode === 413 && bodyJson(res).code === 'TASK_ATTACHMENT_TOO_LARGE' && calls.upload.length === 0);
  }

  // 4) malformed idempotency key -> 400, not called
  {
    const { handleTaskAttachmentRequest, calls } = load();
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
      'content-type': 'application/pdf', 'x-attachment-filename': 'a.pdf', 'x-attachment-idempotency-key': 'not-a-uuid',
    }, Buffer.from('x'));
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('4: bad idempotency key -> 400, ViaServer not called', res.statusCode === 400 && bodyJson(res).code === 'TASK_ATTACHMENT_IDEMPOTENCY_KEY_INVALID' && calls.upload.length === 0);
  }

  // 5) DOCX + XLSX mime forwarded unchanged
  {
    for (const [mime, fn] of [
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'ke-hoach.docx'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'bang.xlsx'],
    ]) {
      const { handleTaskAttachmentRequest, calls } = load();
      const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
        'content-type': mime, 'x-attachment-filename': fn, 'x-attachment-idempotency-key': IDEM,
      }, Buffer.from('PK\x03\x04 fake'));
      const res = makeRes();
      await handleTaskAttachmentRequest(req, res); await settle(res);
      check('5: ' + fn + ' mime forwarded to ViaServer', calls.upload[0] && calls.upload[0].opts.mimeType === mime && res.statusCode === 200);
    }
  }

  // 6) remove -> ViaServer(session, taskId, attId, reason)
  {
    const { handleTaskAttachmentRequest, calls } = load();
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID + '&op=remove&attachmentId=' + ATT_ID, {
      'content-type': 'application/json',
    }, Buffer.from(JSON.stringify({ reason: 'nhầm bản' })));
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    const c = calls.remove[0];
    check('6: remove reaches ViaServer with taskId/attId/reason', c && c.taskId === TASK_ID && c.attachmentId === ATT_ID && c.reason === 'nhầm bản');
    check('6b: 200 ok', res.statusCode === 200 && bodyJson(res).ok === true && calls.upload.length === 0);
  }

  // 7) remove auth denial -> 403
  {
    const { handleTaskAttachmentRequest } = load({ removeThrows: Object.assign(new Error('deny'), { code: 'TASK_ATTACHMENT_REMOVE_DENIED', statusCode: 403 }) });
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID + '&op=remove&attachmentId=' + ATT_ID, {}, Buffer.alloc(0));
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('7: remove denied -> 403', res.statusCode === 403 && bodyJson(res).code === 'TASK_ATTACHMENT_REMOVE_DENIED');
  }

  // 8) download -> stream + safe headers, no storage path leaked
  {
    const { handleTaskAttachmentRequest, calls } = load({ downloadBytes: Buffer.from('THE-REAL-PDF-BYTES') });
    const req = makeReq('GET', '/api/task-attachment?taskId=' + TASK_ID + '&attachmentId=' + ATT_ID, {});
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('8: download reaches ViaServer', calls.download[0] && calls.download[0].taskId === TASK_ID && calls.download[0].attachmentId === ATT_ID);
    check('8b: streams the bytes', Buffer.concat(res._chunks).toString() === 'THE-REAL-PDF-BYTES');
    check('8c: Content-Type + Content-Disposition preserved', res.headers['content-type'] === 'application/pdf' && /filename\*=UTF-8/.test(res.headers['content-disposition']));
    check('8d: Cache-Control private, no-store', String(res.headers['cache-control']).includes('no-store') && String(res.headers['cache-control']).includes('private'));
    check('8e: no storage path / object key in any header', !/tasks\/[0-9a-f-]+\//.test(JSON.stringify(res.headers)) && !/stored_object_key/i.test(JSON.stringify(res.headers)));
  }

  // 9) server write path OFF -> 503, ViaServer not called
  {
    const { handleTaskAttachmentRequest, calls } = load({ writeEnabled: false });
    const req = makeReq('POST', '/api/task-attachment?taskId=' + TASK_ID, {
      'content-type': 'application/pdf', 'x-attachment-filename': 'a.pdf', 'x-attachment-idempotency-key': IDEM,
    }, Buffer.from('x'));
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('9: write path OFF -> 503 TASK_ATTACHMENT_SERVER_REQUIRED, ViaServer not called', res.statusCode === 503 && bodyJson(res).code === 'TASK_ATTACHMENT_SERVER_REQUIRED' && calls.upload.length === 0);
  }

  // 10) bad taskId -> 400
  {
    const { handleTaskAttachmentRequest, calls } = load();
    const req = makeReq('GET', '/api/task-attachment?taskId=not-a-uuid&attachmentId=' + ATT_ID, {});
    const res = makeRes();
    await handleTaskAttachmentRequest(req, res); await settle(res);
    check('10: bad taskId -> 400, ViaServer not called', res.statusCode === 400 && calls.download.length === 0);
  }

  console.log('\n==== TASK_ATTACHMENT_ENDPOINT_V1  PASS=' + PASS + '  FAIL=' + FAIL + ' ====');
  if (FAIL) process.exit(1);
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
