'use strict';
/* Regression test for the branded evidence viewer (GET /evidence/:id).
   Exercises lib/checklist-evidence.js's streamChecklistEvidenceDownload
   in isolation - stubs @supabase/supabase-js and ./checklist-violations
   via the require cache (no network, no real Supabase project touched),
   and stubs global fetch to simulate the internal signed-URL fetch. This
   validates the 404/403/200 branches and confirms no Supabase signed URL
   ever reaches the response headers or body. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const { Writable } = require('stream');

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');
const evidencePath = require.resolve('../lib/checklist-evidence');

let evidenceRow = null;
let violationRow = null;
let permissionBehavior = async () => {};
let fetchBehavior = 'ok';
let lastSignedUrl = '';

function chain(result) {
  const obj = {
    select() { return obj; },
    eq() { return obj; },
    is() { return obj; },
    in() { return obj; },
    order() { return obj; },
    maybeSingle: async () => result
  };
  return obj;
}

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_evidence') return chain({ data: evidenceRow, error: null });
        if (table === 'checklist_violation_records') return chain({ data: violationRow, error: null });
        return chain({ data: null, error: null });
      },
      storage: {
        from() {
          return {
            createSignedUrl: async (storagePath) => {
              lastSignedUrl = 'https://fake-project.supabase.co/storage/v1/object/sign/' + storagePath + '?token=SECRET_TOKEN_SHOULD_NEVER_LEAK';
              return { data: { signedUrl: lastSignedUrl }, error: null };
            }
          };
        }
      }
    })
  }
};

require.cache[violationsPath] = {
  id: violationsPath, filename: violationsPath, loaded: true, exports: {
    requireViolationPermission: async (session, action, rows) => permissionBehavior(session, action, rows)
  }
};

function makeFakeReadableStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

global.fetch = async () => {
  if (fetchBehavior === 'missing') {
    return { ok: false, status: 404, body: null, headers: { get: () => null } };
  }
  return {
    ok: true,
    status: 200,
    body: makeFakeReadableStream('FAKE_EVIDENCE_BYTES'),
    headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? '20' : null) }
  };
};

const { streamChecklistEvidenceDownload } = require(evidencePath);

function makeFakeReq(method) {
  return { method: method || 'GET', on() {} };
}
function makeFakeRes() {
  const chunks = [];
  const res = new Writable({ write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  res.statusCode = 0;
  res.headers = {};
  res.writeHead = function (status, headers) { res.statusCode = status; res.headers = headers || {}; };
  res.getBody = () => Buffer.concat(chunks).toString('utf8');
  // pipe() into this Writable is fire-and-forget from the caller's side (same
  // as server.js's own fs.createReadStream(...).pipe(res) for static files) -
  // tests need to wait for the stream to actually finish before asserting body.
  res.waitForFinish = () => new Promise((resolve) => res.once('finish', resolve));
  return res;
}

const fakeSession = { role: 'admin', sub: 'admin-1', account: { id: 'admin-1', name: 'Admin' } };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

async function run() {
  // 1. Evidence row not found -> 404
  evidenceRow = null; violationRow = null; permissionBehavior = async () => {};
  try {
    await streamChecklistEvidenceDownload(makeFakeReq(), makeFakeRes(), fakeSession, 'missing-id');
    check(false, 'missing evidence row throws');
  } catch (e) {
    check(e.statusCode === 404 && e.code === 'CHECKLIST_EVIDENCE_NOT_FOUND', 'missing evidence row -> 404 CHECKLIST_EVIDENCE_NOT_FOUND (got ' + e.statusCode + '/' + e.code + ')');
  }

  // 2. Orphan draft (violation_id null) -> 404, never calls permission check
  evidenceRow = { id: 'e1', violation_id: null, storage_path: 'violations/x/y/e1/file.png', original_name: 'file.png', mime_type: 'image/png', size_bytes: 100 };
  violationRow = null;
  let permissionCalled = false;
  permissionBehavior = async () => { permissionCalled = true; };
  try {
    await streamChecklistEvidenceDownload(makeFakeReq(), makeFakeRes(), fakeSession, 'e1');
    check(false, 'orphan draft (violation_id null) throws');
  } catch (e) {
    check(e.statusCode === 404, 'orphan draft (violation_id null) -> 404 (got ' + e.statusCode + ')');
    check(!permissionCalled, 'orphan draft never reaches permission check');
  }

  // 3. Linked violation row missing (integrity edge case) -> 404
  evidenceRow = { id: 'e2', violation_id: 'v-missing', storage_path: 'violations/x/y/e2/file.png', original_name: 'file.png', mime_type: 'image/png', size_bytes: 100 };
  violationRow = null;
  try {
    await streamChecklistEvidenceDownload(makeFakeReq(), makeFakeRes(), fakeSession, 'e2');
    check(false, 'missing linked violation throws');
  } catch (e) {
    check(e.statusCode === 404, 'missing linked violation -> 404 (got ' + e.statusCode + ')');
  }

  // 4. Permission denied -> 403, no redirect, no signed URL minted
  evidenceRow = { id: 'e3', violation_id: 'v1', storage_path: 'violations/x/y/e3/file.png', original_name: 'file.png', mime_type: 'image/png', size_bytes: 100 };
  violationRow = { id: 'v1', employee_code: 'NV-001' };
  lastSignedUrl = '';
  permissionBehavior = async () => { const err = new Error('Ngoài phạm vi.'); err.statusCode = 403; err.code = 'CHECKLIST_VIOLATION_OUT_OF_SCOPE'; throw err; };
  try {
    await streamChecklistEvidenceDownload(makeFakeReq(), makeFakeRes(), fakeSession, 'e3');
    check(false, 'out-of-scope viewer throws');
  } catch (e) {
    check(e.statusCode === 403, 'out-of-scope viewer -> 403 (got ' + e.statusCode + ')');
    check(lastSignedUrl === '', 'out-of-scope viewer never causes a signed URL to be minted');
  }

  // 5. Storage object missing after a valid/authorized row -> 404
  permissionBehavior = async () => {};
  fetchBehavior = 'missing';
  try {
    await streamChecklistEvidenceDownload(makeFakeReq(), makeFakeRes(), fakeSession, 'e3');
    check(false, 'missing storage object throws');
  } catch (e) {
    check(e.statusCode === 404, 'missing storage object -> 404 (got ' + e.statusCode + ')');
  }

  // 6. Happy path -> 200, correct headers, streamed body, no leaked signed URL
  fetchBehavior = 'ok';
  const res = makeFakeRes();
  const resFinished = res.waitForFinish();
  await streamChecklistEvidenceDownload(makeFakeReq('GET'), res, fakeSession, 'e3');
  await resFinished;
  check(res.statusCode === 200, 'authorized view -> 200 (got ' + res.statusCode + ')');
  check(res.headers['Content-Type'] === 'image/png', 'Content-Type passed through from evidence row (got ' + res.headers['Content-Type'] + ')');
  check(/inline; filename="file\.png"/.test(res.headers['Content-Disposition'] || ''), 'Content-Disposition inline with sanitized filename (got ' + res.headers['Content-Disposition'] + ')');
  check(res.headers['Cache-Control'] === 'private, no-store', 'Cache-Control: private, no-store (got ' + res.headers['Cache-Control'] + ')');
  check(res.getBody() === 'FAKE_EVIDENCE_BYTES', 'response body streamed through unchanged');
  const headerBlob = JSON.stringify(res.headers);
  check(!headerBlob.includes('supabase.co') && !headerBlob.includes('SECRET_TOKEN_SHOULD_NEVER_LEAK'), 'no Supabase signed URL/token in response headers');
  check(!res.getBody().includes('supabase.co') && !res.getBody().includes('SECRET_TOKEN_SHOULD_NEVER_LEAK'), 'no Supabase signed URL/token in response body');

  // 7. HEAD request -> headers only, no body written
  const headRes = makeFakeRes();
  await streamChecklistEvidenceDownload(makeFakeReq('HEAD'), headRes, fakeSession, 'e3');
  check(headRes.statusCode === 200, 'HEAD request -> 200 (got ' + headRes.statusCode + ')');
  check(headRes.getBody() === '', 'HEAD request writes no body');

  if (failures) {
    console.error(failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
