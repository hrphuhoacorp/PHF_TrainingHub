'use strict';
/*
 * PHF Task — FILE ATTACHMENT V1 real-DB gate (LOCAL ONLY).
 * Real route layer + real attachment orchestrator/storage/DB-layer + throwaway
 * phf_hr_e2e + a throwaway OS temp dir as PHF_HR_ATTACHMENT_ROOT.
 * No Supabase, no mail, no cron, no prod.
 *
 * This gate proves the phf-hr-api layer of FILE ATTACHMENT V1:
 *   - file policy: 4 MB ceiling, DOCX/XLSX allowlisted, MIME<->extension pairing
 *   - the single-task READ returns ONLY active attachments, safe projection
 *     (no stored_object_key / checksum / deleted_* ever leaves the service)
 *   - byte-for-byte authorized download
 *   - logical remove -> excluded from the active list, task.events truthful
 *   - idempotency replay stays green
 *
 * The MAIN-APP authorization (creator/active-primary/management may upload;
 * uploader/creator/management may remove; plain viewer denied) is proven in
 * scripts/test-task-permission-v1.js + scripts/test-task-server-integration-admin-v1.js.
 *
 *   PHF_HR_E2E_DB_ENV=<abs path to e2e/phf-hr-e2e-db.env> \
 *     node scripts/task-attachment-e2e-dev.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'services', 'phf-hr-api');
const { Client } = require(path.join(API_DIR, 'node_modules', 'pg'));

let PASS = 0, FAIL = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
function loadEnvFile(p) {
  const kv = {}; if (!fs.existsSync(p)) return kv;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) kv[m[1]] = m[2]; });
  return kv;
}
async function jreq(base, token, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}
async function uploadRaw(base, token, taskId, { buf, filename, mimeType, actor, actorAccountId, idem }) {
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': mimeType,
    'Content-Length': String(buf.length),
    'X-Attachment-Filename': encodeURIComponent(filename),
    'X-Attachment-Idempotency-Key': idem,
  };
  // ATTACHMENT ACTOR IDENTITY (2026-09-02) — employee-code and/or account-id.
  if (actor !== undefined) headers['X-Attachment-Actor-Employee-Code'] = actor;
  if (actorAccountId !== undefined) headers['X-Attachment-Actor-Account-Id'] = actorAccountId;
  const res = await fetch(base + '/v1/task/tasks/' + taskId + ':uploadAttachment', { method: 'POST', headers, body: buf });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main() {
  const dbEnv = loadEnvFile(process.env.PHF_HR_E2E_DB_ENV || path.join(ROOT, 'e2e', 'phf-hr-e2e-db.env'));
  const testEnv = loadEnvFile(path.join(ROOT, '.env.test'));
  if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(String(dbEnv.PHF_HR_DB_NAME || ''))) { console.error('throwaway DB env required'); process.exit(2); }

  const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
  const ATTACH_ROOT = path.join(os.tmpdir(), 'phf-attach-e2e-' + Date.now());
  fs.mkdirSync(ATTACH_ROOT, { recursive: true });
  Object.assign(process.env, {
    SUPABASE_URL: testEnv.SUPABASE_URL, SUPABASE_SECRET_KEY: testEnv.SUPABASE_SECRET_KEY,
    PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN, PHF_HR_API_BIND_HOST: '127.0.0.1', PORT: '0',
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT), PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME,
    PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER, PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: ATTACH_ROOT,
  });
  const { loadConfig } = require(path.join(API_DIR, 'lib', 'config'));
  const { createServer } = require(path.join(API_DIR, 'server'));
  const config = loadConfig();
  if (!config.ok) { console.error('config invalid', config.errors); process.exit(2); }
  const server = createServer(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const admin = new Client({ host: dbEnv.PHF_HR_DB_HOST, port: +dbEnv.PHF_HR_DB_PORT, database: dbEnv.PHF_HR_DB_NAME, user: dbEnv.PHF_HR_DB_RUNTIME_USER, password: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD });
  await admin.connect();
  async function q(sql, params) {
    await admin.query('BEGIN'); await admin.query('SET LOCAL ROLE phf_hr_app');
    try { const r = await admin.query(sql, params || []); await admin.query('COMMIT'); return r; }
    catch (e) { await admin.query('ROLLBACK').catch(() => {}); throw e; }
  }

  const cols = await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='task' AND table_name='attachments'`);
  if (cols.rows[0].n === 0) { console.log('\nSCHEMA_NOT_APPLIED — task.attachments missing.'); await admin.end(); server.close(); process.exit(3); }

  const TAG = 'ATT_' + Date.now();
  const REQ = { employeeCode: TAG + '_C', accountId: null };
  const CATEGORY = (await q("SELECT category_code c FROM task.categories WHERE is_active=true ORDER BY sort_order LIMIT 1")).rows[0].c;
  const taskIds = [];

  async function makeTask() {
    let r = await jreq(BASE, SERVICE_TOKEN, 'POST', '/v1/task/tasks:create', {
      flowType: 'giao_viec', title: TAG + ' task', content: '', categoryCode: CATEGORY, priority: 'thuong',
      startAt: '2026-01-01T00:00:00Z', deadline: '2026-06-01T00:00:00Z', primaryEmployeeCode: TAG + '_P',
      idempotencyKey: crypto.randomUUID(), actor: REQ,
    });
    if (r.status !== 200 || !r.body.ok) throw new Error('create failed: ' + JSON.stringify(r.body));
    const id = r.body.data.id; taskIds.push(id);
    r = await jreq(BASE, SERVICE_TOKEN, 'POST', '/v1/task/tasks/' + id + ':publish', { expectedRowVersion: r.body.data.row_version, actor: REQ });
    if (r.status !== 200 || !r.body.ok) throw new Error('publish failed: ' + JSON.stringify(r.body));
    return id;
  }
  const detail = async (id) => (await jreq(BASE, SERVICE_TOKEN, 'GET', '/v1/task/tasks/' + id)).body.data;
  const evPayloads = async (id) => (await q("SELECT payload FROM task.events WHERE task_id=$1 AND event_type='attachment' ORDER BY occurred_at ASC", [id])).rows.map(r => r.payload);

  try {
    const tid = await makeTask();
    const ACTOR = TAG + '_C';

    // 1) blank/invalid filename extension
    let r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.from('x'), filename: 'noext', mimeType: 'application/pdf', actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_ORCHESTRATION_EXTENSION_REQUIRED', '1: filename without extension -> 400', r);

    // 2) disallowed MIME
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.from('x'), filename: 'a.zip', mimeType: 'application/zip', actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_ORCHESTRATION_MIME_INVALID', '2: application/zip -> 400 MIME_INVALID', r);

    // 3) MIME/extension mismatch (both individually allowed, disagree)
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.from('x'), filename: 'a.pdf', mimeType: 'image/jpeg', actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_ORCHESTRATION_MIME_EXTENSION_MISMATCH', '3: .pdf declared image/jpeg -> 400 MIME_EXTENSION_MISMATCH', r);

    // 4) > 4 MB rejected (Content-Length fail-fast)
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.alloc(4 * 1024 * 1024 + 1, 1), filename: 'big.pdf', mimeType: 'application/pdf', actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_STORAGE_TOO_LARGE', '4: > 4 MB -> 400 TOO_LARGE', r);

    // 5) empty file rejected
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.alloc(0), filename: 'empty.pdf', mimeType: 'application/pdf', actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_ORCHESTRATION_EMPTY_FILE', '5: empty file -> 400 EMPTY_FILE', r);

    // 6) PDF accepted
    const pdfBuf = Buffer.from('%PDF-1.4 phf attachment v1 e2e fixture body');
    const pdfIdem = crypto.randomUUID();
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: pdfBuf, filename: 'minh chứng.pdf', mimeType: 'application/pdf', actor: ACTOR, idem: pdfIdem });
    ok(r.status === 200 && r.body.ok && r.body.data.originalFilename === 'minh chứng.pdf' && r.body.data.mimeType === 'application/pdf', '6: PDF upload -> 200', r.body);
    const pdfId = r.body.data.id;
    ok(r.body.data.stored_object_key === undefined && r.body.data.storageKey === undefined && r.body.data.storage_key === undefined, '6b: upload response carries NO storage key/path', r.body.data);

    // 7) DOCX accepted
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.from('PK fake docx'), filename: 'ke hoach.docx', mimeType: DOCX_MIME, actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 200 && r.body.ok && r.body.data.extension === 'docx', '7: DOCX upload -> 200', r.body);

    // 8) XLSX accepted
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: Buffer.from('PK fake xlsx'), filename: 'bang tinh.xlsx', mimeType: XLSX_MIME, actor: ACTOR, idem: crypto.randomUUID() });
    ok(r.status === 200 && r.body.ok && r.body.data.extension === 'xlsx', '8: XLSX upload -> 200', r.body);
    const xlsxId = r.body.data.id;

    // 9) idempotency replay — same key, no duplicate row / event
    r = await uploadRaw(BASE, SERVICE_TOKEN, tid, { buf: pdfBuf, filename: 'minh chứng.pdf', mimeType: 'application/pdf', actor: ACTOR, idem: pdfIdem });
    ok(r.status === 200 && r.body.data.id === pdfId && r.body.data.replayed === true, '9: replay same idempotencyKey -> same id, replayed:true', r.body);

    // 10) READ — active list, safe projection only, correct order
    let d = await detail(tid);
    ok(Array.isArray(d.attachments) && d.attachments.length === 3, '10: GET detail returns 3 active attachments', d.attachments);
    const sample = d.attachments.find(a => a.id === pdfId);
    ok(sample && sample.stored_object_key === undefined && sample.checksum_sha256 === undefined && sample.deleted_at === undefined && sample.status === undefined,
      '10b: attachment row is safe projection (no object key / checksum / status / deleted_*)', sample);
    ok(sample && sample.original_filename === 'minh chứng.pdf' && sample.mime_type === 'application/pdf' && sample.extension === 'pdf' && Number(sample.size_bytes) === pdfBuf.length && sample.uploaded_by_employee_code === ACTOR && !!sample.created_at,
      '10c: attachment row carries exactly the 7 safe fields', sample);

    // 11) audit — one add event per real upload (3), payload truthful
    const addEvents = (await evPayloads(tid)).filter(p => p && p.action === 'add');
    ok(addEvents.length === 3 && addEvents.every(p => p.attachment_id && p.original_filename && typeof p.size_bytes === 'number'),
      '11: exactly 3 attachment/add events, payload truthful', addEvents);

    // 12) download — byte-for-byte
    const dl = await fetch(BASE + '/v1/task/tasks/' + tid + '/attachments/' + pdfId, { headers: { Authorization: 'Bearer ' + SERVICE_TOKEN } });
    const dlBuf = Buffer.from(await dl.arrayBuffer());
    ok(dl.status === 200 && Buffer.compare(dlBuf, pdfBuf) === 0 && dl.headers.get('content-type') === 'application/pdf', '12: authorized download is byte-for-byte', { status: dl.status, len: dlBuf.length });
    ok(String(dl.headers.get('cache-control') || '').includes('no-store'), '12b: download is Cache-Control private/no-store', dl.headers.get('cache-control'));

    // 13) logical remove -> excluded from active list, task stays, remove event
    r = await jreq(BASE, SERVICE_TOKEN, 'POST', '/v1/task/tasks/' + tid + ':removeAttachment', { attachmentId: xlsxId, reason: 'nhầm bản', actor: { employeeCode: ACTOR } });
    ok(r.status === 200 && r.body.ok && r.body.data.status === 'pending_delete', '13: removeAttachment -> 200 pending_delete', r.body);
    d = await detail(tid);
    ok(d.attachments.length === 2 && !d.attachments.some(a => a.id === xlsxId), '13b: removed attachment excluded from active detail list', d.attachments.map(a => a.id));
    const removeEvents = (await evPayloads(tid)).filter(p => p && p.action === 'remove');
    ok(removeEvents.length === 1 && removeEvents[0].attachment_id === xlsxId && removeEvents[0].reason === 'nhầm bản', '13c: one attachment/remove event with reason (nothing deleted/hidden)', removeEvents);

    // 14) download a removed attachment -> uniform 404 (no existence disclosure)
    const dl2 = await fetch(BASE + '/v1/task/tasks/' + tid + '/attachments/' + xlsxId, { headers: { Authorization: 'Bearer ' + SERVICE_TOKEN } });
    ok(dl2.status === 404, '14: download of a removed attachment -> 404', dl2.status);

    // 15) remove again -> already removed
    r = await jreq(BASE, SERVICE_TOKEN, 'POST', '/v1/task/tasks/' + tid + ':removeAttachment', { attachmentId: xlsxId, reason: 'x', actor: { employeeCode: ACTOR } });
    ok(r.status === 409 && r.body.code === 'TASK_ATTACHMENT_ALREADY_REMOVED', '15: re-remove -> 409 ALREADY_REMOVED', r);

    // 16) the physical bytes for the removed row are NOT unlinked (evidence kept)
    const stillOnDisk = (await q("SELECT stored_object_key FROM task.attachments WHERE id=$1", [xlsxId])).rows[0].stored_object_key;
    ok(fs.existsSync(path.join(ATTACH_ROOT, stillOnDisk)), '16: removed attachment binary still on disk (physical cleanup deferred)', stillOnDisk);

    // =====================================================================
    // ATTACHMENT ACTOR IDENTITY (2026-09-02) — Admin-only actor (no
    // employeeCode, accountId present). Object key -> ACC_<id>, metadata
    // uploaded_by_employee_code NULL + uploaded_by_account_id set.
    // =====================================================================
    const atid = await makeTask();
    const ADMIN_ACC = 'e2e-admin-' + crypto.randomBytes(6).toString('hex');
    const admPdf = Buffer.from('%PDF-1.4 admin-only actor e2e fixture');
    const admIdem = crypto.randomUUID();

    // 17) account-only upload -> 200
    r = await uploadRaw(BASE, SERVICE_TOKEN, atid, { buf: admPdf, filename: 'admin-bao-cao.pdf', mimeType: 'application/pdf', actor: '', actorAccountId: ADMIN_ACC, idem: admIdem });
    ok(r.status === 200 && r.body.ok && r.body.data.uploadedByEmployeeCode === null && r.body.data.uploadedByAccountId === ADMIN_ACC,
      '17: admin account-only upload -> 200, metadata employeeCode NULL + accountId set', r.body && r.body.data);
    const admId = r.body.data.id;

    // 18) on-disk object key uses the typed ACC_ segment; row semantics correct
    const admRow = (await q("SELECT stored_object_key, uploaded_by_employee_code, uploaded_by_account_id FROM task.attachments WHERE id=$1", [admId])).rows[0];
    ok(admRow.stored_object_key.includes('/ACC_' + ADMIN_ACC + '/') && admRow.uploaded_by_employee_code === null && admRow.uploaded_by_account_id === ADMIN_ACC,
      '18: object key typed ACC_<accountId>, never employeeCode = accountId', admRow);
    ok(fs.existsSync(path.join(ATTACH_ROOT, admRow.stored_object_key)), '18b: admin upload binary physically present', admRow.stored_object_key);

    // 19) audit event actor token = accountId; actor_account_id column set
    const admEv = (await q("SELECT actor_employee_code, actor_account_id, payload FROM task.events WHERE task_id=$1 AND event_type='attachment' ORDER BY occurred_at DESC LIMIT 1", [atid])).rows[0];
    ok(admEv.actor_employee_code === ADMIN_ACC && admEv.actor_account_id === ADMIN_ACC && admEv.payload.action === 'add',
      '19: attachment/add event carries account identity (audit token + actor_account_id)', admEv);

    // 20) download byte-for-byte, then remove by the same account-only actor
    const admDl = await fetch(BASE + '/v1/task/tasks/' + atid + '/attachments/' + admId, { headers: { Authorization: 'Bearer ' + SERVICE_TOKEN } });
    const admDlBuf = Buffer.from(await admDl.arrayBuffer());
    ok(admDl.status === 200 && Buffer.compare(admDlBuf, admPdf) === 0, '20: admin-uploaded attachment downloads byte-for-byte', { status: admDl.status });
    r = await jreq(BASE, SERVICE_TOKEN, 'POST', '/v1/task/tasks/' + atid + ':removeAttachment', { attachmentId: admId, reason: 'admin cleanup', actor: { accountId: ADMIN_ACC } });
    ok(r.status === 200 && r.body.ok && r.body.data.status === 'pending_delete', '20b: account-only actor removes their own upload -> pending_delete', r.body);
    const admRemoved = (await q("SELECT deleted_by_employee_code, deleted_by_account_id FROM task.attachments WHERE id=$1", [admId])).rows[0];
    ok(admRemoved.deleted_by_employee_code === null && admRemoved.deleted_by_account_id === ADMIN_ACC,
      '20c: remove metadata deleted_by_account_id set, employeeCode NULL', admRemoved);

    // 21) neither identity -> rejected before FS/DB
    r = await uploadRaw(BASE, SERVICE_TOKEN, atid, { buf: admPdf, filename: 'x.pdf', mimeType: 'application/pdf', actor: '', actorAccountId: '', idem: crypto.randomUUID() });
    ok(r.status === 400 && r.body.code === 'ATTACHMENT_STORAGE_INVALID_ACTOR', '21: no actor identity -> 400 INVALID_ACTOR', r.body);

  } finally {
    await admin.end(); server.close();
    try { fs.rmSync(ATTACH_ROOT, { recursive: true, force: true }); } catch (_e) {}
  }

  console.log('\n==== FILE_ATTACHMENT_V1_E2E  PASS=' + PASS + '  FAIL=' + FAIL + ' ====');
  if (FAIL) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
