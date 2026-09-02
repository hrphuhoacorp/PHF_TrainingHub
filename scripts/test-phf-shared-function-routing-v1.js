'use strict';

/*
 * PHF 1.66.8 — SHARED Vercel function routing test (Hobby 12-function budget).
 *
 * Two physical functions each host two public routes:
 *   api/task-attachment.js        -> /api/task-attachment  +  /evidence/:id (/api/evidence)
 *   api/checklist-monthly-cron.js -> /api/checklist-monthly-cron  +  /api/task-recurrence-cron
 *
 * MOCK ONLY — every _lib dependency is replaced via require.cache. No DB, no
 * phf-hr-api, no network, no engine.
 *
 * Proves:
 *   1. media fn: /evidence marker  -> evidence branch (requireSession + stream), NOT attachment
 *   2. media fn: /evidence/:id path -> evidence branch, id extracted from query
 *   3. media fn: attachment route  -> raw binary handler, bytes byte-identical (SHA-256)
 *   4. media fn: evidence is GET/HEAD only -> POST = 405
 *   5. media fn: attachment route never runs the evidence branch
 *   6. cron fn: task-recurrence marker + TASK secret -> runTaskRecurrence
 *   7. cron fn: plain route + CHECKLIST secret -> syncMonthlyCycle
 *   8. cron fn: each secret is fail-closed on the other route
 *   9. vercel.json: specific /api rewrites precede the identity /api/:path* rewrite;
 *      /evidence/:id and /api/evidence point at the shared media fn with the marker;
 *      /api/task-recurrence-cron points at the shared cron fn with the marker;
 *      SPA fallback stays last; nothing else reordered.
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
function stub(p, exports) { const id = rr(p); require.cache[id] = { id, filename: id, loaded: true, exports }; return id; }
function unstub(p) { delete require.cache[rr(p)]; }

function mockRes() {
  const res = {
    statusCode: 0, headers: {}, _chunks: [], headersSent: false, _done: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); this.headersSent = true; },
    write(c) { this._chunks.push(Buffer.from(c)); return true; },
    end(c) { if (c) this._chunks.push(Buffer.from(c)); this.headersSent = true; this._done = true; },
    status(s) { this.statusCode = s; return this; },
    json(o) { this._chunks.push(Buffer.from(JSON.stringify(o))); this._done = true; return this; },
  };
  return res;
}
function body(res) { return Buffer.concat(res._chunks).toString('utf8'); }
function bodyJson(res) { try { return JSON.parse(body(res)); } catch (_e) { return null; } }
async function settle(res) { for (let i = 0; i < 200 && !res._done; i++) await new Promise((r) => setImmediate(r)); }

(async () => {
  // =========================================================================
  // MEDIA FUNCTION — api/task-attachment.js
  // =========================================================================
  const mediaCalls = { session: [], stream: [], upload: [] };
  stub('api/_lib/auth', {
    requireSession: async (req, roles) => { mediaCalls.session.push(roles); return { role: 'admin', account: { employeeCode: 'PHF001' } }; },
  });
  stub('api/_lib/checklist-evidence', {
    streamChecklistEvidenceDownload: async (req, res, session, id) => { mediaCalls.stream.push({ id, role: session && session.role }); res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from('EVIDENCE-STREAM')); },
  });
  stub('api/_lib/api-response', {
    sendError: (res, err) => { res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: err.code })); },
  });
  stub('api/_lib/request-guard', { assertSameOrigin: () => {}, publicError: (e) => ({ status: e.statusCode || 500, body: { ok: false, code: e.code, error: e.message } }) });
  stub('api/_lib/task-server-integration', {
    isServerWriteEnabled: () => true,
    uploadTaskAttachmentViaServer: async (session, taskId, buf, opts) => { mediaCalls.upload.push({ taskId, buf, opts }); return { id: 'att-1' }; },
    removeTaskAttachmentViaServer: async () => ({}),
    downloadTaskAttachmentViaServer: async () => ({}),
  });
  unstub('api/_lib/task-attachment-endpoint');
  unstub('api/task-attachment');
  const mediaHandler = require(rr('api/task-attachment'));

  check('media fn exports config.api.bodyParser === false',
    mediaHandler.config && mediaHandler.config.api && mediaHandler.config.api.bodyParser === false, mediaHandler.config);

  // 1. evidence via marker query (what the vercel rewrite produces)
  {
    const req = Object.assign(Readable.from([]), { method: 'GET', url: '/api/task-attachment?id=EV123&__phf_route=evidence', headers: { host: 'localhost' }, query: { id: 'EV123', __phf_route: 'evidence' } });
    const res = mockRes();
    await mediaHandler(req, res); await settle(res);
    check('1 evidence marker -> stream called with id', mediaCalls.stream.length === 1 && mediaCalls.stream[0].id === 'EV123', mediaCalls.stream);
    check('1 evidence marker -> requireSession(evidence roles)', JSON.stringify(mediaCalls.session[mediaCalls.session.length - 1]) === JSON.stringify(['learner', 'manager', 'admin']));
    check('1 evidence marker -> NOT attachment upload', mediaCalls.upload.length === 0);
    check('1 evidence body streamed', body(res) === 'EVIDENCE-STREAM');
  }

  // 2. evidence via literal /evidence/:id path (direct / local-dev shape)
  {
    mediaCalls.stream.length = 0;
    const req = Object.assign(Readable.from([]), { method: 'GET', url: '/evidence/ABC-9?id=ABC-9', headers: { host: 'localhost' }, query: { id: 'ABC-9' } });
    const res = mockRes();
    await mediaHandler(req, res); await settle(res);
    check('2 /evidence/:id path -> evidence branch', mediaCalls.stream.length === 1 && mediaCalls.stream[0].id === 'ABC-9', mediaCalls.stream);
  }

  // 3. attachment route -> raw binary handler, bytes byte-identical
  {
    mediaCalls.stream.length = 0; mediaCalls.upload.length = 0;
    const TASK = '11111111-1111-4111-8111-111111111111';
    const IDEM = '33333333-3333-4333-8333-333333333333';
    const N = (2.7 * 1024 * 1024) | 0;
    const file = crypto.randomBytes(N); file[0] = 0; file[1] = 255; file[N - 1] = 0;
    const parts = []; for (let i = 0; i < N; i += 7001) parts.push(file.subarray(i, Math.min(N, i + 7001)));
    const req = Object.assign(Readable.from(parts), {
      method: 'POST', url: '/api/task-attachment?taskId=' + TASK,
      headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/pdf', 'content-length': String(N), 'x-attachment-filename': encodeURIComponent('tai lieu.pdf'), 'x-attachment-idempotency-key': IDEM },
      query: { taskId: TASK },
    });
    const res = mockRes();
    await mediaHandler(req, res); await settle(res);
    const up = mediaCalls.upload[0];
    check('3 attachment route -> upload handler reached', !!up && up.taskId === TASK, up && up.taskId);
    check('3 raw bytes byte-identical (SHA-256)', !!up && crypto.createHash('sha256').update(up.buf).digest('hex') === crypto.createHash('sha256').update(file).digest('hex'));
    check('3 exact length preserved', !!up && up.buf.length === N, up && up.buf.length);
    check('3 metadata forwarded', up && up.opts.filename === 'tai lieu.pdf' && up.opts.mimeType === 'application/pdf' && up.opts.idempotencyKey === IDEM);
    check('3 evidence branch NOT run for attachment route', mediaCalls.stream.length === 0);
    check('3 -> 200 ok', res.statusCode === 200 && bodyJson(res) && bodyJson(res).ok === true, res.statusCode);
  }

  // 4. evidence is GET/HEAD only
  {
    const req = Object.assign(Readable.from([]), { method: 'POST', url: '/api/task-attachment?__phf_route=evidence', headers: { host: 'localhost' }, query: { __phf_route: 'evidence' } });
    const res = mockRes();
    await mediaHandler(req, res); await settle(res);
    check('4 POST on evidence route -> 405', res.statusCode === 405, res.statusCode);
  }

  ['api/_lib/auth', 'api/_lib/checklist-evidence', 'api/_lib/api-response', 'api/_lib/request-guard', 'api/_lib/task-server-integration', 'api/_lib/task-attachment-endpoint', 'api/task-attachment'].forEach(unstub);

  // =========================================================================
  // CRON FUNCTION — api/checklist-monthly-cron.js
  // =========================================================================
  const cronCalls = { recurrence: 0, checklist: 0 };
  stub('api/_lib/task-recurrence-actions', { runTaskRecurrence: async () => { cronCalls.recurrence++; return { generated: 2 }; } });
  stub('api/_lib/checklist-monthly', { syncMonthlyCycle: async () => { cronCalls.checklist++; return { synced: true }; } });
  unstub('api/checklist-monthly-cron');
  const cronHandler = require(rr('api/checklist-monthly-cron'));

  const TASK_SECRET = 'routing-test-task-secret';
  const CHK_SECRET = 'routing-test-checklist-secret';
  process.env.TASK_RECURRENCE_CRON_SECRET = TASK_SECRET;
  process.env.CHECKLIST_CRON_SECRET = CHK_SECRET;

  async function hitCron(url, bearer, method = 'POST') {
    const req = { method, url, headers: { authorization: 'Bearer ' + bearer } };
    const res = mockRes();
    await cronHandler(req, res); await settle(res);
    return res;
  }

  // 6. recurrence marker + TASK secret
  { cronCalls.recurrence = cronCalls.checklist = 0;
    const res = await hitCron('/api/checklist-monthly-cron?__phf_cron=task-recurrence', TASK_SECRET);
    check('6 recurrence route + task secret -> 200 runTaskRecurrence', res.statusCode === 200 && cronCalls.recurrence === 1 && cronCalls.checklist === 0, res.statusCode); }

  // 7. plain route + CHECKLIST secret
  { cronCalls.recurrence = cronCalls.checklist = 0;
    const res = await hitCron('/api/checklist-monthly-cron', CHK_SECRET);
    check('7 checklist route + checklist secret -> 200 syncMonthlyCycle', res.statusCode === 200 && cronCalls.checklist === 1 && cronCalls.recurrence === 0, res.statusCode); }

  // 8. fail-closed cross-secret
  { cronCalls.recurrence = cronCalls.checklist = 0;
    const a = await hitCron('/api/checklist-monthly-cron?__phf_cron=task-recurrence', CHK_SECRET);
    const b = await hitCron('/api/checklist-monthly-cron', TASK_SECRET);
    check('8a recurrence route + checklist secret -> 401', a.statusCode === 401, a.statusCode);
    check('8b checklist route + task secret -> 401', b.statusCode === 401, b.statusCode);
    check('8 neither action invoked', cronCalls.recurrence === 0 && cronCalls.checklist === 0); }

  // 8c. wrong method / wrong secret
  { const c = await hitCron('/api/checklist-monthly-cron?__phf_cron=task-recurrence', TASK_SECRET, 'DELETE');
    check('8c DELETE -> 405', c.statusCode === 405, c.statusCode);
    const d = await hitCron('/api/checklist-monthly-cron?__phf_cron=task-recurrence', 'garbage');
    check('8c garbage secret -> 401', d.statusCode === 401, d.statusCode); }

  ['api/_lib/task-recurrence-actions', 'api/_lib/checklist-monthly', 'api/checklist-monthly-cron'].forEach(unstub);

  // =========================================================================
  // 9. vercel.json structure
  // =========================================================================
  {
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const rw = vj.rewrites.map((r) => r.source);
    const idxIdentity = rw.indexOf('/api/:path*');
    const idxRecCron = rw.indexOf('/api/task-recurrence-cron');
    const idxApiEvidence = rw.indexOf('/api/evidence');
    const idxEvidenceId = rw.indexOf('/evidence/:id');
    const idxSpa = rw.indexOf('/:path*');
    check('9 /api/task-recurrence-cron rewrite present & before identity', idxRecCron >= 0 && idxRecCron < idxIdentity, { idxRecCron, idxIdentity });
    check('9 /api/evidence rewrite present & before identity', idxApiEvidence >= 0 && idxApiEvidence < idxIdentity, { idxApiEvidence, idxIdentity });
    check('9 /evidence/:id present & before SPA fallback', idxEvidenceId >= 0 && idxEvidenceId < idxSpa, { idxEvidenceId, idxSpa });
    check('9 identity /api rewrite still before SPA fallback', idxIdentity >= 0 && idxIdentity < idxSpa);
    check('9 SPA fallback is last', idxSpa === rw.length - 1, { idxSpa, len: rw.length });
    const dRec = vj.rewrites[idxRecCron].destination;
    const dEvId = vj.rewrites[idxEvidenceId].destination;
    const dApiEv = vj.rewrites[idxApiEvidence].destination;
    check('9 recurrence-cron -> shared cron fn w/ marker', dRec === '/api/checklist-monthly-cron?__phf_cron=task-recurrence', dRec);
    check('9 /evidence/:id -> shared media fn w/ id + marker', dEvId === '/api/task-attachment?id=:id&__phf_route=evidence', dEvId);
    check('9 /api/evidence -> shared media fn w/ marker', dApiEv === '/api/task-attachment?__phf_route=evidence', dApiEv);
    check('9 assets / print / webmanifest rewrites untouched',
      rw.includes('/assets/:path*') && rw.includes('/print/commitments/:id') && rw.includes('/site.webmanifest') && rw.includes('/favicon.ico'));
    // header block untouched
    check('9 headers block intact', Array.isArray(vj.headers) && vj.headers.some((h) => h.source === '/build-info.json'));
  }

  // =========================================================================
  // 10. function count <= 12
  // =========================================================================
  {
    const walk = (d, acc) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('_')) continue; const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp, acc); else if (e.name.endsWith('.js')) acc.push(path.relative(path.join(ROOT, 'api'), fp)); } return acc; };
    const fns = walk(path.join(ROOT, 'api'), []);
    check('10 Vercel-visible endpoint function count <= 12', fns.length <= 12, { count: fns.length, fns });
    check('10 api/evidence.js removed', !fs.existsSync(path.join(ROOT, 'api', 'evidence.js')));
    check('10 api/task-recurrence-cron.js removed', !fs.existsSync(path.join(ROOT, 'api', 'task-recurrence-cron.js')));
  }

  console.log('\n' + (FAIL === 0 ? 'ALL PASS' : 'FAIL') + '  (' + PASS + ' passed, ' + FAIL + ' failed)');
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
