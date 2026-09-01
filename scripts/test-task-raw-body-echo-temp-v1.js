'use strict';

/*
 * TEMPORARY PREVIEW RAW BODY TEST — REMOVE BEFORE PROD.
 *
 * Proves the throwaway /api/task-raw-body-echo branch inside api/task-attachment.js
 * (Preview-only; verifies Vercel delivers a raw binary POST body byte-intact
 * under bodyParser:false). This branch, its vercel.json rewrite, and this test
 * file MUST all be deleted before the 1.66.8 production release.
 *
 * MOCK ONLY — every real _lib dependency of api/task-attachment.js is replaced
 * via require.cache. No network, no DB, no phf-hr-api, no filesystem. The echo
 * branch itself uses only Node's crypto + the request stream.
 *
 * A. Unauthorized — secret unset -> 503; wrong bearer -> 401; body NOT read
 * B. ~500,000 random bytes -> exact length + exact SHA-256
 * C. ~3,900,000 random bytes -> exact length + exact SHA-256
 * D. body over the 4.25 MB echo cap -> 413, rejected safely
 * E. routing regression: /api/task-attachment, /api/evidence, /evidence/:id,
 *    and the recurrence-cron rewrite are unchanged
 * F. Vercel serverless function count stays exactly 12
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}
function rr(p) { return require.resolve(path.join(ROOT, p)); }
function stub(p, exports) { const id = rr(p); require.cache[id] = { id, filename: id, loaded: true, exports }; }
function unstub(p) { delete require.cache[rr(p)]; }

// Stub the media/evidence deps so requiring the function file is hermetic.
const evidenceCalls = { stream: 0 }; const attachmentCalls = { handle: 0 };
stub('api/_lib/auth', { requireSession: async () => ({ role: 'admin', account: { employeeCode: 'PHF001' } }) });
stub('api/_lib/checklist-evidence', { streamChecklistEvidenceDownload: async (req, res) => { evidenceCalls.stream++; res.writeHead(200, {}); res.end('EV'); } });
stub('api/_lib/api-response', { sendError: (res, e) => { res.writeHead(e.statusCode || 500, {}); res.end(JSON.stringify({ ok: false, code: e.code })); } });
stub('api/_lib/task-attachment-endpoint', { handleTaskAttachmentRequest: async (req, res) => { attachmentCalls.handle++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, marker: 'attachment-handler' })); } });

unstub('api/task-attachment');
const handler = require(rr('api/task-attachment'));

function mockRes() {
  return {
    statusCode: 0, headers: {}, _chunks: [], headersSent: false, _done: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); this.headersSent = true; },
    write(c) { this._chunks.push(Buffer.from(c)); return true; },
    end(c) { if (c) this._chunks.push(Buffer.from(c)); this._done = true; },
  };
}
function bodyJson(res) { try { return JSON.parse(Buffer.concat(res._chunks).toString('utf8')); } catch (_e) { return null; } }
async function settle(res) { for (let i = 0; i < 400 && !res._done; i++) await new Promise((r) => setImmediate(r)); }

function echoReq(buf, { bearer, method = 'POST', url = '/api/task-raw-body-echo', omitContentLength = false, spyRead } = {}) {
  const parts = buf == null ? [] : (Array.isArray(buf) ? buf : [buf]);
  const req = Readable.from(parts);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/octet-stream' };
  if (!omitContentLength && buf != null) req.headers['content-length'] = String(Buffer.isBuffer(buf) ? buf.length : parts.reduce((a, p) => a + p.length, 0));
  if (bearer !== undefined) req.headers.authorization = 'Bearer ' + bearer;
  if (spyRead) {
    const origOn = req.on.bind(req);
    req.on = (ev, fn) => { if (ev === 'data') spyRead.dataListeners++; return origOn(ev, fn); };
  }
  return req;
}

const SECRET = 'echo-test-secret-not-real';

(async () => {
  // ---- A. unauthorized ----
  {
    delete process.env.TASK_RAW_BODY_ECHO_SECRET;
    const spy = { dataListeners: 0 };
    const req = echoReq(crypto.randomBytes(1000), { bearer: SECRET, spyRead: spy });
    const res = mockRes();
    await handler(req, res); await settle(res);
    check('A1 secret unset -> 503 RAW_BODY_ECHO_DISABLED', res.statusCode === 503 && bodyJson(res).code === 'RAW_BODY_ECHO_DISABLED', res.statusCode);
    check('A1 body never read when disabled', spy.dataListeners === 0, spy);
  }
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    const spy = { dataListeners: 0 };
    const req = echoReq(crypto.randomBytes(1000), { bearer: 'wrong-secret', spyRead: spy });
    const res = mockRes();
    await handler(req, res); await settle(res);
    check('A2 wrong bearer -> 401 RAW_BODY_ECHO_UNAUTHORIZED', res.statusCode === 401 && bodyJson(res).code === 'RAW_BODY_ECHO_UNAUTHORIZED', res.statusCode);
    check('A2 body never read on auth failure', spy.dataListeners === 0, spy);
  }
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    const req = echoReq(crypto.randomBytes(10), { bearer: SECRET, method: 'GET' });
    const res = mockRes();
    await handler(req, res); await settle(res);
    check('A3 non-POST -> 405', res.statusCode === 405, res.statusCode);
  }

  // ---- B. ~500,000 bytes ----
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    const N = 500000;
    const buf = crypto.randomBytes(N); buf[0] = 0; buf[N - 1] = 255;
    const parts = []; for (let i = 0; i < N; i += 6143) parts.push(buf.subarray(i, Math.min(N, i + 6143)));
    const req = echoReq(parts, { bearer: SECRET });
    const res = mockRes();
    await handler(req, res); await settle(res);
    const j = bodyJson(res);
    check('B1 -> 200 ok', res.statusCode === 200 && j && j.ok === true, res.statusCode);
    check('B2 exact byte length', j && j.length === N, j && j.length);
    check('B3 exact SHA-256', j && j.sha256 === crypto.createHash('sha256').update(buf).digest('hex'));
    check('B4 no body echoed back / no filename in response', j && Object.keys(j).sort().join(',') === 'length,ok,sha256');
    check('B5 Cache-Control no-store', res.headers['cache-control'] === 'no-store');
    check('B6 attachment & evidence handlers NOT invoked', attachmentCalls.handle === 0 && evidenceCalls.stream === 0);
  }

  // ---- C. ~3,900,000 bytes ----
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    const N = 3900000;
    const buf = crypto.randomBytes(N); buf[0] = 255; buf[N - 1] = 0;
    const parts = []; for (let i = 0; i < N; i += 8191) parts.push(buf.subarray(i, Math.min(N, i + 8191)));
    const req = echoReq(parts, { bearer: SECRET });
    const res = mockRes();
    await handler(req, res); await settle(res);
    const j = bodyJson(res);
    check('C1 -> 200 ok', res.statusCode === 200 && j && j.ok === true, res.statusCode);
    check('C2 exact byte length (3.9 MB)', j && j.length === N, j && j.length);
    check('C3 exact SHA-256 (3.9 MB, multi-chunk)', j && j.sha256 === crypto.createHash('sha256').update(buf).digest('hex'));
  }

  // ---- D. over the 4.25 MB cap ----
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    const CAP = Math.floor(4.25 * 1024 * 1024);
    // D1: content-length header over cap -> rejected before reading
    {
      const req = echoReq(crypto.randomBytes(1024), { bearer: SECRET });
      req.headers['content-length'] = String(CAP + 1);
      const res = mockRes();
      await handler(req, res); await settle(res);
      check('D1 content-length > cap -> 413 RAW_BODY_ECHO_TOO_LARGE', res.statusCode === 413 && bodyJson(res).code === 'RAW_BODY_ECHO_TOO_LARGE', res.statusCode);
    }
    // D2: streamed bytes exceed cap (content-length omitted) -> rejected mid-stream
    {
      const N = CAP + 50000;
      const parts = []; for (let i = 0; i < N; i += 65536) parts.push(Buffer.alloc(Math.min(65536, N - i), 7));
      const req = echoReq(parts, { bearer: SECRET, omitContentLength: true });
      const res = mockRes();
      await handler(req, res); await settle(res);
      check('D2 streamed body > cap -> 413, safely aborted', res.statusCode === 413 && bodyJson(res).code === 'RAW_BODY_ECHO_TOO_LARGE', res.statusCode);
    }
  }

  // ---- E. routing regression (business branches untouched) ----
  {
    process.env.TASK_RAW_BODY_ECHO_SECRET = SECRET;
    attachmentCalls.handle = 0; evidenceCalls.stream = 0;

    const aRes = mockRes();
    await handler(echoReq(Buffer.from('x'), { url: '/api/task-attachment?taskId=11111111-1111-4111-8111-111111111111' }), aRes); await settle(aRes);
    check('E1 /api/task-attachment still routes to the attachment handler', attachmentCalls.handle === 1 && bodyJson(aRes) && bodyJson(aRes).marker === 'attachment-handler');

    const eRes = mockRes();
    const eReq = echoReq(null, { method: 'GET', url: '/api/task-attachment?id=EV1&__phf_route=evidence' });
    eReq.query = { id: 'EV1', __phf_route: 'evidence' };
    await handler(eReq, eRes); await settle(eRes);
    check('E2 evidence marker still routes to the evidence handler', evidenceCalls.stream === 1 && Buffer.concat(eRes._chunks).toString() === 'EV');

    const eRes2 = mockRes();
    await handler(echoReq(null, { method: 'GET', url: '/evidence/ABC-9?id=ABC-9' }), eRes2); await settle(eRes2);
    check('E3 /evidence/:id path still routes to evidence', evidenceCalls.stream === 2);

    check('E4 config.api.bodyParser still false', handler.config && handler.config.api && handler.config.api.bodyParser === false);

    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const rw = vj.rewrites.map((r) => r.source);
    const idxEcho = rw.indexOf('/api/task-raw-body-echo');
    const idxIdentity = rw.indexOf('/api/:path*');
    check('E5 echo rewrite present & before identity /api rewrite', idxEcho >= 0 && idxEcho < idxIdentity, { idxEcho, idxIdentity });
    check('E5b echo rewrite dest carries the marker', vj.rewrites[idxEcho].destination === '/api/task-attachment?__phf_route=raw-body-echo');
    check('E6 /api/evidence + /evidence/:id + recurrence-cron rewrites unchanged',
      rw.includes('/api/evidence') && rw.includes('/evidence/:id') && rw.includes('/api/task-recurrence-cron')
      && vj.rewrites[rw.indexOf('/evidence/:id')].destination === '/api/task-attachment?id=:id&__phf_route=evidence'
      && vj.rewrites[rw.indexOf('/api/task-recurrence-cron')].destination === '/api/checklist-monthly-cron?__phf_cron=task-recurrence');
    check('E7 SPA fallback still last', rw[rw.length - 1] === '/:path*');
  }

  // ---- F. function count == 12 ----
  {
    const walk = (d, acc) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('_')) continue; const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp, acc); else if (e.name.endsWith('.js')) acc.push(path.relative(path.join(ROOT, 'api'), fp)); } return acc; };
    const fns = walk(path.join(ROOT, 'api'), []);
    check('F Vercel serverless function count still exactly 12 (no 13th top-level function)', fns.length === 12, { count: fns.length, fns });
  }

  ['api/_lib/auth', 'api/_lib/checklist-evidence', 'api/_lib/api-response', 'api/_lib/task-attachment-endpoint', 'api/task-attachment'].forEach(unstub);
  delete process.env.TASK_RAW_BODY_ECHO_SECRET;

  console.log('\n' + (FAIL === 0 ? 'ALL PASS' : 'FAIL') + '  (' + PASS + ' passed, ' + FAIL + ' failed)');
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
