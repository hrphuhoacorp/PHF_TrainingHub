'use strict';
/*
 * PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 · LIVE LOCAL e2e (LOCAL ONLY).
 *
 * Full path exercised:
 *   dispatchNoticeAction (Vercel layer) -> notice-identity (People Master =
 *   Supabase PHF-HR-DEV, read) -> notice-bridge (flag ON) -> phf-hr-api child
 *   -> throwaway Company PostgreSQL phf_hr_e2e / schema notice.* (SSH tunnel 15432).
 *
 * TWO phases so the DEVELOPMENT GATE and the BUSINESS PERMISSION model are
 * proven SEPARATELY (brief §25 / §29):
 *   Phase A — NOTICE_DEV_ACCESS_ALLOW set: dev-lock blocks an ordinary user;
 *             Admin + allow-listed operator drive the full manage/feed flow.
 *   Phase B — NOTICE_DEV_ACCESS_ALLOW unset (GO-LIVE sim): PUBLIC business read
 *             works for every authenticated user; outside-"Áp dụng" ack works;
 *             a viewer still cannot manage; report/permission stay manager-only.
 *
 * PREREQ: migrations/phf_hr_notice_v1.sql applied to throwaway; SSH tunnel up;
 *   .env.test = PHF-HR-DEV keys ; e2e/phf-hr-e2e-db.env = throwaway PG.
 * Run: node scripts/notice-batch01-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const THROWAWAY_CONTAINER = process.env.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');

function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }
async function expectThrow(name, fn, codeWanted) {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, !codeWanted || e.code === codeWanted, 'got code=' + e.code + ' msg=' + e.message); }
}

function resetNotice() {
  psql(
    'set session_replication_role=replica; '
    + 'delete from notice.notice_acknowledgements; delete from notice.notice_views; delete from notice.notice_attachments; '
    + 'delete from notice.notice_keywords; delete from notice.notice_scopes; delete from notice.notice_revisions; '
    + 'delete from notice.notice_audit_logs; delete from notice.notice_permission_history; delete from notice.notice_permissions; '
    + 'delete from notice.notices; '
    // categories: drop test-created ones + re-sync the 4 system seeds to defaults
    + "delete from notice.notice_categories where is_system = false; "
    + "update notice.notice_categories set is_active = true; "
    + "update notice.notice_categories set name='Quy định', sort_order=10 where slug='regulation'; "
    + "update notice.notice_categories set name='Chính sách', sort_order=20 where slug='policy'; "
    + "update notice.notice_categories set name='Quy trình', sort_order=30 where slug='process'; "
    + "update notice.notice_categories set name='Hướng dẫn', sort_order=40 where slug='guide'; "
    + 'reset session_replication_role'
  );
}

// The Vercel bridge (api/_lib/notice-bridge.js) captures PHF_HR_API_BASE_URL
// into a module-level const at require time — so BOTH phases must talk to the
// SAME port. Phase B just restarts the child on that port with a different
// NOTICE_DEV_ACCESS_ALLOW.
const API_PORT = 18941;
let apiChild = null;
function stopApi() {
  if (!apiChild) return Promise.resolve();
  const c = apiChild; apiChild = null;
  return new Promise((res) => { c.once('exit', () => res()); try { c.kill('SIGTERM'); } catch (_) { res(); } setTimeout(res, 4000); });
}
process.on('exit', () => { if (apiChild) { try { apiChild.kill('SIGTERM'); } catch (_) {} } });

async function startApi(port, devAllow) {
  const env = Object.assign({}, process.env, {
    PORT: String(port), PHF_HR_API_BIND_HOST: '127.0.0.1',
    PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
    SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
    PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(os.tmpdir() + path.sep + 'notice-e2e-attach-'),
    TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  if (devAllow) env.NOTICE_DEV_ACCESS_ALLOW = devAllow; else delete env.NOTICE_DEV_ACCESS_ALLOW;
  apiChild = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'), env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = 'http://127.0.0.1:' + port;
  if (!(await waitHealth(base + '/healthz', 15000))) { stopApi(); die('phf-hr-api child not healthy on ' + port); }
  process.env.PHF_HR_API_BASE_URL = base;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_NOTICE_BRIDGE_ENABLED = 'true';
  process.env.SUPABASE_URL = envTest.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = envTest.SUPABASE_SECRET_KEY;
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='notice'") !== '1') die('schema notice chưa có trên throwaway — apply migrations/phf_hr_notice_v1.sql trước.');

  const svc = require(path.join(REPO, 'services/phf-hr-api/lib/notice-service'));
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

  const adminAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle()).data;
  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  const emps = (await sb.from('employee_profiles').select('employee_code,full_name,department,branch,employment_status').eq('employment_status', 'active')).data || [];
  // two ordinary users in DIFFERENT departments, neither on the allow-list
  const norm = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'learner').eq('status', 'active').not('employee_code', 'is', null).neq('employee_code', '').limit(40)).data || [];
  const empByCode = new Map(emps.map((e) => [String(e.employee_code).toUpperCase(), e]));
  const normUsers = norm
    .filter((a) => a.employee_code && String(a.employee_code).toUpperCase() !== String(opAcc && opAcc.employee_code || '').toUpperCase())
    .map((a) => Object.assign({}, a, { emp: empByCode.get(String(a.employee_code).toUpperCase()) }))
    .filter((a) => a.emp && a.emp.department);
  const U_IN = normUsers[0];
  const U_OUT = normUsers.find((u) => u.emp.department !== (U_IN && U_IN.emp.department)) || normUsers[1];
  const inactiveEmp = (await sb.from('employee_profiles').select('employee_code,full_name,department').neq('employment_status', 'active').limit(1).maybeSingle()).data;
  if (!adminAcc || !opAcc || !U_IN || !U_OUT) { stopApi(); die('không lấy đủ persona từ DEV'); }

  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_ADMIN = sess(adminAcc), S_OP = sess(opAcc), S_IN = sess(U_IN), S_OUT = sess(U_OUT);
  const DEV_ALLOW = 'PHF012,' + (opAcc.employee_code || '') + ',' + opAcc.id;

  const D = (session, payload) => require(path.join(REPO, 'api', '_lib', 'notice-actions')).dispatchNoticeAction(session, payload)
    .then((r) => { if (!r.handled) throw Object.assign(new Error('unhandled ' + payload.action), { code: 'UNHANDLED' }); return r.result; });

  console.log(`[e2e] admin=${adminAcc.email} operator=${opAcc.email}/${opAcc.employee_code} inScope=${U_IN.employee_code}(${U_IN.emp.department}) outScope=${U_OUT.employee_code}(${U_OUT.emp.department}) inactive=${inactiveEmp && inactiveEmp.employee_code}`);

  // =====================================================================
  // PHASE A — DEV GATE ON
  // =====================================================================
  console.log('\n=== PHASE A · NOTICE_DEV_ACCESS_ALLOW set (dev gate ON) ===\n');
  resetNotice();
  await startApi(API_PORT, DEV_ALLOW);

  const bootAdmin = await D(S_ADMIN, { action: 'noticeBootstrap' });
  check('A1  Admin vào module (canManage, devLocked)', bootAdmin.capabilities.canManage === true && bootAdmin.devLocked === true, JSON.stringify(bootAdmin.capabilities));
  const bootOp = await D(S_OP, { action: 'noticeBootstrap' });
  check('A2  Operator allow-listed vào module (canManage, devOperator)', bootOp.capabilities.canManage === true && bootOp.devOperator === true, JSON.stringify(bootOp));
  const bootIn = await D(S_IN, { action: 'noticeBootstrap' });
  check('A3  Người thường: bootstrap trả devLocked, canManage=false', bootIn.devLocked === true && bootIn.capabilities.canManage === false, JSON.stringify(bootIn));
  await expectThrow('A4  Người thường bị chặn mọi action khác (NOTICE_DEV_LOCKED)', () => D(S_IN, { action: 'noticeFeed' }), 'NOTICE_DEV_LOCKED');

  // operator creates + publishes the Voucher notice (scope = Bán hàng-ish: use U_IN dept)
  const scopeDept = U_IN.emp.department;
  const cr = await D(S_OP, { action: 'noticeCreate', title: 'Cập nhật cách bấm bill khi khách sử dụng Voucher',
    content_text: 'Voucher được ghi nhận dưới hình thức giảm giá đơn hàng, không chọn "Voucher" làm phương thức thanh toán như cách cũ.\n\n1. Voucher có mã giảm giá: Vào Chiết khấu đơn (F6) rồi Mã giảm giá. Nhập hoặc quét mã in trên voucher. Phần tiền khách còn phải trả ghi nhận theo phương thức thực tế.\n2. Voucher cũ không có mã: vào Chiết khấu đơn (F6), nhập thủ công số tiền giảm bằng đúng giá trị voucher, ghi chú trên đơn.',
    notice_type: 'guide', effective_from: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
    require_acknowledgement: true, scopes: [{ scope_type: 'department', scope_value: scopeDept }],
    keywords: ['voucher', 'bấm bill', 'F6', 'chiết khấu', 'mã giảm giá', 'POS'] });
  check('A5  Operator tạo được bản nháp', !!cr.id, JSON.stringify(cr));
  const pub = await D(S_OP, { action: 'noticePublish', id: cr.id });
  check('A6  Operator công bố được (revision #1)', pub.status === 'published' && pub.revision && pub.revision.revisionNo === 1, JSON.stringify(pub));

  const feedOp = await D(S_OP, { action: 'noticeFeed', q: '' });
  check('A7  Thông báo hiện trong feed', feedOp.notices.some((n) => n.id === cr.id), '');
  const fF6 = await D(S_OP, { action: 'noticeFeed', q: 'F6' });
  check('A8  Search "F6" ra bài (từ khóa trong body)', fF6.notices.some((n) => n.id === cr.id), JSON.stringify(fF6.notices.map((n) => n.title)));
  const fVc = await D(S_OP, { action: 'noticeFeed', q: 'bam bill' });
  check('A9  Search không dấu "bam bill" ra bài', fVc.notices.some((n) => n.id === cr.id), '');

  // second api process to prove restart persistence
  const det1 = await D(S_OP, { action: 'noticeDetail', id: cr.id });
  check('A10 Mở chi tiết ghi nhận view (firstViewedAt)', det1.viewer.viewed === true && !!det1.viewer.firstViewedAt, JSON.stringify(det1.viewer));
  const rev = det1.notice.currentRevisionId;

  // edit -> audit + new revision + require re-ack
  const upd = await D(S_OP, { action: 'noticeUpdate', id: cr.id, title: 'Cập nhật cách bấm bill khi khách sử dụng Voucher (v2)', require_reacknowledgement: true, change_summary: 'Bổ sung ví dụ' });
  check('A11 Sửa bài -> revision mới + require re-ack', upd.changed && upd.revision && upd.revision.revisionNo === 2 && upd.requireReack === true, JSON.stringify(upd));
  const auditCount = Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${cr.id}'`));
  check('A12 Audit log có bản ghi create/publish/edit/require_reack', auditCount >= 4, 'count=' + auditCount);

  await stopApi();

  // =====================================================================
  // PHASE B — DEV GATE OFF  (GO-LIVE simulation: public business rules)
  // =====================================================================
  console.log('\n=== PHASE B · NOTICE_DEV_ACCESS_ALLOW unset (GO-LIVE sim: business permission) ===\n');
  await sleep(1200);
  await startApi(API_PORT, '');

  const bootInB = await D(S_IN, { action: 'noticeBootstrap' });
  check('B1  GO-LIVE: người thường vào module, canManage=false, devLocked=false', bootInB.devLocked === false && bootInB.capabilities.canManage === false, JSON.stringify(bootInB));
  const feedIn = await D(S_IN, { action: 'noticeFeed', q: 'voucher' });
  check('B2  Public read: người trong scope thấy bài', feedIn.notices.some((n) => n.id === cr.id), '');
  const feedOut = await D(S_OUT, { action: 'noticeFeed', q: 'voucher' });
  check('B3  Public read: người NGOÀI scope Bán hàng vẫn thấy bài (Áp dụng ≠ ACL)', feedOut.notices.some((n) => n.id === cr.id), '');
  const detOut = await D(S_OUT, { action: 'noticeDetail', id: cr.id });
  check('B4  Người ngoài scope mở được chi tiết + ghi view', detOut.viewer.viewed === true, '');
  const ackOut = await D(S_OUT, { action: 'noticeAcknowledge', id: cr.id });
  check('B5  Người ngoài scope xác nhận được (AC08)', ackOut.acknowledged === true, JSON.stringify(ackOut));
  const ackOut2 = await D(S_OUT, { action: 'noticeAcknowledge', id: cr.id });
  check('B6  Xác nhận lần 2 idempotent (alreadyAcknowledged), không có bỏ tick', ackOut2.alreadyAcknowledged === true, JSON.stringify(ackOut2));
  const detOut2 = await D(S_OUT, { action: 'noticeDetail', id: cr.id });
  check('B7  Reload: xác nhận vẫn còn (AC07)', detOut2.viewer.acknowledged === true && detOut2.viewer.acknowledgedRevisionIsCurrent === true, JSON.stringify(detOut2.viewer));

  const ackDbRev = psql(`select revision_id from notice.notice_acknowledgements where employee_code='${U_OUT.employee_code}'`);
  const curRev = psql(`select current_revision_id from notice.notices where id='${cr.id}'`);
  check('B8  Ack gắn đúng REVISION hiện tại (AC12 nền)', ackDbRev === curRev && !!ackDbRev, ackDbRev + ' vs ' + curRev);

  await expectThrow('B9  Viewer KHÔNG tạo được thông báo (NOTICE_MANAGE_DENIED)', () => D(S_IN, { action: 'noticeCreate', title: 'x', content_text: 'y', notice_type: 'guide', effective_from: '2026-09-01' }), 'NOTICE_MANAGE_DENIED');
  await expectThrow('B10 Viewer KHÔNG mở được báo cáo (NOTICE_MANAGE_DENIED)', () => D(S_IN, { action: 'noticeReport', id: cr.id }), 'NOTICE_MANAGE_DENIED');
  await expectThrow('B11 Viewer KHÔNG xem được roster quyền', () => D(S_IN, { action: 'noticePermissionRoster' }), 'NOTICE_MANAGE_DENIED');

  // Admin grants U_IN manage; audit
  const setPerm = await D(S_ADMIN, { action: 'noticeSetPermission', employee_code: U_IN.employee_code, can_manage: true });
  check('B12 Admin cấp quyền quản trị nội dung cho U_IN', setPerm.changed === true && setPerm.canManage === true, JSON.stringify(setPerm));
  const permHistCount = Number(psql(`select count(*) from notice.notice_permission_history where employee_code='${U_IN.employee_code}'`));
  const permAudit = Number(psql(`select count(*) from notice.notice_audit_logs where action_type='permission_change'`));
  check('B13 Đổi quyền -> permission_history + audit (AC20)', permHistCount === 1 && permAudit >= 1, `hist=${permHistCount} audit=${permAudit}`);
  await expectThrow('B14 Non-admin content manager KHÔNG cấp quyền cho người khác (NOTICE_ADMIN_REQUIRED)', () => D(S_IN, { action: 'noticeSetPermission', employee_code: U_OUT.employee_code, can_manage: true }), 'NOTICE_ADMIN_REQUIRED');

  // U_IN (now manager) opens report
  const rep = await D(S_IN, { action: 'noticeReport', id: cr.id });
  check('B15 Báo cáo: mẫu số = tài khoản đang hoạt động trong nhóm áp dụng', rep.summary.denominator > 0, JSON.stringify(rep.summary));
  check('B16 Báo cáo: người ngoài scope đã ack nằm ở "others", không tính vào mẫu số', rep.others.some((o) => o.employeeCode === U_OUT.employee_code) && !rep.primary.some((p) => p.employeeCode === U_OUT.employee_code && p.acknowledgedAt), JSON.stringify({ others: rep.others.map((o) => o.employeeCode) }));

  // re-ack semantics: U_IN acknowledges current, then manager edits with reack -> stale
  await D(S_IN, { action: 'noticeDetail', id: cr.id });
  await D(S_IN, { action: 'noticeAcknowledge', id: cr.id });
  const upd2 = await D(S_IN, { action: 'noticeUpdate', id: cr.id, content_text: 'Nội dung đã thay đổi lần nữa — cần xác nhận lại.', require_reacknowledgement: true });
  const detInAfter = await D(S_IN, { action: 'noticeDetail', id: cr.id });
  check('B17 Sau khi bật re-ack: xác nhận cũ thành "phiên bản cũ", chưa đủ cho revision mới (AC12)', detInAfter.viewer.acknowledged === true && detInAfter.viewer.acknowledgedRevisionIsCurrent === false, JSON.stringify(detInAfter.viewer));
  const ackHistCount = Number(psql(`select count(*) from notice.notice_acknowledgements where employee_code='${U_IN.employee_code}' and notice_id='${cr.id}'`));
  check('B18 Xác nhận cũ KHÔNG bị xóa khỏi lịch sử', ackHistCount >= 1, 'count=' + ackHistCount);

  // effective status: create an upcoming + an expired, prove derivation + search
  const upNotice = await D(S_IN, { action: 'noticeCreate', title: 'Quy định nghỉ phép mới', content_text: 'Áp dụng quy trình xin nghỉ phép qua PHF HR.', notice_type: 'regulation', effective_from: new Date(Date.now() + 40 * 86400e3).toISOString().slice(0, 10) });
  await D(S_IN, { action: 'noticePublish', id: upNotice.id });
  const exp = await D(S_IN, { action: 'noticeCreate', title: 'Chính sách phụ cấp cũ 2025', content_text: 'Phụ cấp xăng xe theo mức 2025.', notice_type: 'policy', effective_from: '2025-01-01', effective_to: '2025-12-31' });
  await D(S_IN, { action: 'noticePublish', id: exp.id });
  const feedAll = await D(S_IN, { action: 'noticeFeed', q: '' });
  const upCard = feedAll.notices.find((n) => n.id === upNotice.id);
  const expCard = feedAll.notices.find((n) => n.id === exp.id);
  check('B19 effective_from tương lai => "upcoming" (AC04)', upCard && upCard.effectiveStatus === 'upcoming', JSON.stringify(upCard && upCard.effectiveStatus));
  check('B20 quá effective_to => "expired" (AC04)', expCard && expCard.effectiveStatus === 'expired', JSON.stringify(expCard && expCard.effectiveStatus));
  const feedExp = await D(S_IN, { action: 'noticeFeed', q: 'phụ cấp', status: 'expired' });
  check('B21 Hết hiệu lực vẫn search được (AC05)', feedExp.notices.some((n) => n.id === exp.id), '');

  // pin
  await D(S_IN, { action: 'noticeSetPin', id: exp.id, pinned: true });
  const feedPin = await D(S_IN, { action: 'noticeFeed', q: '' });
  check('B22 Ghim -> lên đầu feed (AC17)', feedPin.notices[0] && feedPin.notices[0].id === exp.id, feedPin.notices[0] && feedPin.notices[0].title);

  // soft delete
  await D(S_IN, { action: 'noticeDelete', id: exp.id });
  const feedDel = await D(S_OUT, { action: 'noticeFeed', q: 'phụ cấp' });
  check('B23 Soft delete -> ẩn khỏi feed người thường (AC13)', !feedDel.notices.some((n) => n.id === exp.id), '');
  const stillInDb = psql(`select count(*) from notice.notices where id='${exp.id}' and deleted_at is not null`);
  check('B24 Soft delete -> dữ liệu + audit vẫn còn', stillInDb === '1', stillInDb);

  await expectThrow('B25 Direct API: viewer gọi noticeUpdate bài bất kỳ -> chặn', () => D(S_OUT, { action: 'noticeUpdate', id: cr.id, title: 'hack' }), 'NOTICE_MANAGE_DENIED');

  // =====================================================================
  // PHASE C — BATCH 02 · functional completion (AC12–AC19), gate still OFF
  // =====================================================================
  console.log('\n=== PHASE C · Batch 02 — attachments / long-form / replacement / delete / inactive ===\n');

  // ---- AC15 attachments (file + link), revision-scoped, audited, secure ----
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 1x1
  const addF = await D(S_IN, { action: 'noticeAttachmentAdd', notice_id: cr.id, kind: 'file', file_name: 'huong-dan-voucher.png', mime_type: 'image/png', base64: PNG });
  check('C1  Manager thêm được tệp (image) — gắn revision hiện tại', !!addF.attachmentId, JSON.stringify(addF));
  const attRev = psql(`select revision_id from notice.notice_attachments where id='${addF.attachmentId}'`);
  const curRevC = psql(`select current_revision_id from notice.notices where id='${cr.id}'`);
  check('C2  Tệp gắn đúng revision_id hiện tại', attRev === curRevC && !!attRev, `${attRev} vs ${curRevC}`);
  const addL = await D(S_IN, { action: 'noticeAttachmentAdd', notice_id: cr.id, kind: 'link', link_url: 'https://phuhoafresh.info.vn/pos-guide' });
  check('C3  Manager thêm được liên kết', !!addL.attachmentId, '');
  await expectThrow('C4  Link không http(s) bị từ chối', () => D(S_IN, { action: 'noticeAttachmentAdd', notice_id: cr.id, kind: 'link', link_url: 'ftp://x' }), 'NOTICE_ATTACH_LINK');
  await expectThrow('C5  Đuôi tệp không hợp lệ bị từ chối', () => D(S_IN, { action: 'noticeAttachmentAdd', notice_id: cr.id, kind: 'file', file_name: 'x.exe', mime_type: 'application/x-msdownload', base64: PNG }), 'NOTICE_ATTACH_TYPE');
  const dl = await D(S_OUT, { action: 'noticeAttachmentDownload', notice_id: cr.id, attachment_id: addF.attachmentId });
  check('C6  Người thường (public read) tải được tệp qua kênh xác thực', dl.kind === 'file' && dl.base64 === PNG && dl.fileName === 'huong-dan-voucher.png', JSON.stringify({ k: dl.kind, n: dl.fileName }));
  const detWithAtt = await D(S_IN, { action: 'noticeDetail', id: cr.id });
  check('C7  Detail DTO liệt kê tệp KHÔNG lộ storage_key', detWithAtt.notice.attachments.length === 2 && detWithAtt.notice.attachments.every((a) => a.storageKey === undefined), JSON.stringify(detWithAtt.notice.attachments[0]));
  const attAdd = Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${cr.id}' and action_type='attachment_add'`));
  check('C8  Thêm tệp -> audit attachment_add (x2)', attAdd === 2, 'count=' + attAdd);
  // remove with re-ack -> new revision
  const rm = await D(S_IN, { action: 'noticeAttachmentRemove', notice_id: cr.id, attachment_id: addL.attachmentId, require_reacknowledgement: true });
  check('C9  Xóa tệp + Yêu cầu xác nhận lại -> tạo revision mới (AC12/AC15)', rm.removed === true && rm.revision && rm.revision.revisionNo > 2, JSON.stringify(rm));
  const attRm = Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${cr.id}' and action_type='attachment_remove'`));
  const attStillRow = psql(`select count(*) from notice.notice_attachments where id='${addL.attachmentId}' and deleted_at is not null`);
  check('C10 Xóa tệp = soft (deleted_at) + audit attachment_remove, hàng không mất', attRm === 1 && attStillRow === '1', `audit=${attRm} row=${attStillRow}`);
  await expectThrow('C11 Tệp đã xóa không tải được nữa', () => D(S_OUT, { action: 'noticeAttachmentDownload', notice_id: cr.id, attachment_id: addL.attachmentId }), 'NOTICE_ATTACH_NOT_FOUND');
  await expectThrow('C12 Viewer KHÔNG thêm được tệp', () => D(S_OUT, { action: 'noticeAttachmentAdd', notice_id: cr.id, kind: 'link', link_url: 'https://x.test' }), 'NOTICE_MANAGE_DENIED');

  // ---- AC16 long-form: headings -> TOC + inner-clause search ----
  const longBody = ['Quy định chung về sử dụng tài sản công ty.', '', '## Điều 1. Phạm vi áp dụng', 'Áp dụng cho toàn bộ nhân sự.', '', '## Điều 2. Voucher và chiết khấu', 'Khi khách dùng voucher, thu ngân vào Chiết khấu đơn (F6) và nhập mã. Không chọn voucher làm phương thức thanh toán.', '', '### Điều 2.1. Trường hợp mã hỏng', 'Nhập tay số tiền giảm đúng bằng giá trị voucher.'].join('\n');
  const longN = await D(S_IN, { action: 'noticeCreate', title: 'Nội quy sử dụng tài sản & quy định thanh toán', content_text: longBody, notice_type: 'regulation', effective_from: '2026-09-01', keywords: [] });
  await D(S_IN, { action: 'noticePublish', id: longN.id });
  const longDet = await D(S_IN, { action: 'noticeDetail', id: longN.id });
  check('C13 Long-form: HTML lưu có heading với id + auto-TOC (>=3 mục)', /<h2 id="/.test(longDet.notice.contentHtml) && longDet.notice.toc.length >= 3, JSON.stringify(longDet.notice.toc.map((t) => t.text)));
  check('C14 Long-form: TOC có phân cấp h2/h3', longDet.notice.toc.some((t) => t.level === 2) && longDet.notice.toc.some((t) => t.level === 3), '');
  const innerHit = await D(S_OUT, { action: 'noticeFeed', q: 'mã hỏng' });
  check('C15 Search ra điều khoản nằm SÂU trong nội dung dài (AC16)', innerHit.notices.some((x) => x.id === longN.id), '');

  // ---- AC14 replacement with a FUTURE effective_from ----
  const oldPol = await D(S_IN, { action: 'noticeCreate', title: 'Chính sách phụ cấp điện thoại 2026', content_text: 'Phụ cấp 200k/tháng.', notice_type: 'policy', effective_from: '2026-01-01' });
  await D(S_IN, { action: 'noticePublish', id: oldPol.id });
  const tomorrow = new Date(Date.now() + 7 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const newPol = await D(S_IN, { action: 'noticeCreate', title: 'Chính sách phụ cấp điện thoại 2026 (điều chỉnh)', content_text: 'Phụ cấp 300k/tháng.', notice_type: 'policy', effective_from: tomorrow, replaced_notice_id: oldPol.id });
  const pubNew = await D(S_IN, { action: 'noticePublish', id: newPol.id });
  check('C16 Publish bản thay thế hiệu lực TƯƠNG LAI -> chưa supersede bản cũ ngay', !pubNew.supersededOld, JSON.stringify(pubNew));
  const oldStatusNow = psql(`select coalesce(superseded_by_notice_id::text,'none') from notice.notices where id='${oldPol.id}'`);
  check('C17 Bản cũ vẫn đang hiệu lực khi bản mới chưa tới ngày', oldStatusNow === 'none', oldStatusNow);
  // simulate arrival: back-date the new notice's effective_from to today, then a feed read triggers the lazy flip
  psql(`update notice.notices set effective_from='2026-09-01' where id='${newPol.id}'`);
  const feedAfterFlip = await D(S_IN, { action: 'noticeFeed', q: 'phụ cấp điện thoại' });
  const oldCard = feedAfterFlip.notices.find((x) => x.id === oldPol.id);
  const newCard2 = feedAfterFlip.notices.find((x) => x.id === newPol.id);
  check('C18 Khi bản mới có hiệu lực -> bản cũ tự HẾT HIỆU LỰC (lazy flip, AC14)', oldCard && oldCard.effectiveStatus === 'expired' && oldCard.supersededByNoticeId === newPol.id, JSON.stringify(oldCard && { s: oldCard.effectiveStatus, by: oldCard.supersededByNoticeId }));
  check('C19 Hai bài link qua lại + search ưu tiên bản mới trên bản cũ', newCard2 && newCard2.replacedNoticeId === oldPol.id
    && feedAfterFlip.notices.findIndex((x) => x.id === newPol.id) < feedAfterFlip.notices.findIndex((x) => x.id === oldPol.id), '');
  const flipAudit = Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${oldPol.id}' and action_type='superseded'`));
  check('C20 Lazy flip được ghi audit (superseded)', flipAudit >= 1, 'count=' + flipAudit);

  // ---- AC13 draft delete + published soft-delete both leave the feed, keep history ----
  const draftDel = await D(S_IN, { action: 'noticeCreate', title: 'Nháp sẽ xóa', content_text: 'tạm.', notice_type: 'guide', effective_from: '2026-09-01' });
  const dRes = await D(S_IN, { action: 'noticeDelete', id: draftDel.id });
  const draftGone = !(await D(S_IN, { action: 'noticeFeed', q: '', include_drafts: true })).notices.some((x) => x.id === draftDel.id);
  const draftHistKept = psql(`select count(*) from notice.notices where id='${draftDel.id}' and deleted_at is not null`) === '1'
    && Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${draftDel.id}' and action_type='delete_draft'`)) === 1;
  check('C21 Draft xóa -> rời feed nhưng dữ liệu + audit vẫn còn (AC13)', dRes.deleted === true && dRes.wasDraft === true && draftGone && draftHistKept, JSON.stringify(dRes));

  // ---- AC17 pin does not change effective status ----
  const beforePinStatus = (await D(S_IN, { action: 'noticeFeed', q: 'tài sản' })).notices.find((x) => x.id === longN.id).effectiveStatus;
  await D(S_IN, { action: 'noticeSetPin', id: longN.id, pinned: true });
  const afterPin = (await D(S_IN, { action: 'noticeFeed', q: '' })).notices;
  const pinnedCard = afterPin.find((x) => x.id === longN.id);
  check('C22 Pin: lên đầu feed nhưng effective status KHÔNG đổi (AC17)', afterPin[0].id === longN.id && pinnedCard.effectiveStatus === beforePinStatus, `${afterPin[0].id} / ${pinnedCard.effectiveStatus} vs ${beforePinStatus}`);

  // ---- AC19 inactive not in denominator, history kept ----
  if (inactiveEmp) {
    // an inactive employee that viewed/acked historically still must not inflate the denominator
    psql(`insert into notice.notice_views(notice_id,viewer_key,employee_code) values ('${longN.id}','EMP:${inactiveEmp.employee_code}','${inactiveEmp.employee_code}') on conflict do nothing`);
    const rep19 = await D(S_IN, { action: 'noticeReport', id: longN.id });
    const inDenom = rep19.primary.filter((x) => x.active).length;
    const histKept = rep19.primary.concat(rep19.others).some((x) => x.employeeCode === inactiveEmp.employee_code && x.viewedAt);
    check('C23 Inactive account: KHÔNG tính vào denominator hiện tại, lịch sử view vẫn còn (AC19)', rep19.summary.denominator === inDenom && histKept, JSON.stringify({ d: rep19.summary.denominator, inDenom, histKept }));
  } else { check('C23 (skipped — no inactive employee in DEV)', true); }

  // ---- AC18 no comments — structural: no comment action exists ----
  check('C24 AC18 no comments: service has no comment/Q&A action', !svc.ACTIONS.some((a) => /comment|reply|discuss|qa/i.test(a)), svc.ACTIONS.join(','));

  // =====================================================================
  // PHASE D — FINAL FUNCTIONAL PATCH (categories / priority / keywords / dedup / create-flow / updated-label)
  // =====================================================================
  console.log('\n=== PHASE D · categories + priority + additional keywords + duplicate warning + updated label ===\n');
  if (psql("select count(*) from information_schema.tables where table_schema='notice' and table_name='notice_categories'") !== '1') { console.error('  FAIL  D0 phf_hr_notice_v1_2 migration not applied to throwaway'); FAIL++; }

  // ---- categories default migration + CRUD (§1, mandatory tests) ----
  const catList0 = await D(S_IN, { action: 'noticeCategoriesList' });
  const seeded = catList0.categories.map((c) => c.slug).sort().join(',');
  check('D1  4 default categories seeded (regulation/policy/process/guide)', seeded === 'guide,policy,process,regulation', seeded);
  check('D2  default categories are system + active + ordered', catList0.categories.every((c) => c.isSystem && c.isActive) && catList0.categories[0].sortOrder < catList0.categories[3].sortOrder, '');
  const catNew = await D(S_IN, { action: 'noticeCategoriesUpsert', name: 'Thông báo nội bộ khẩn' });
  check('D3  add category', !!catNew.slug && /^[a-z0-9-]+$/.test(catNew.slug), JSON.stringify(catNew));
  await D(S_IN, { action: 'noticeCategoriesUpsert', slug: catNew.slug, name: 'Thông báo nội bộ' });
  check('D4  rename category', (await D(S_IN, { action: 'noticeCategoriesList' })).categories.find((c) => c.slug === catNew.slug).name === 'Thông báo nội bộ', '');
  const beforeOrder = (await D(S_IN, { action: 'noticeCategoriesList' })).categories.map((c) => c.slug);
  const revOrder = beforeOrder.slice().reverse();
  await D(S_IN, { action: 'noticeCategoriesReorder', order: revOrder });
  check('D5  reorder category', (await D(S_IN, { action: 'noticeCategoriesList' })).categories.map((c) => c.slug).join(',') === revOrder.join(','), '');
  await D(S_IN, { action: 'noticeCategoriesUpsert', slug: catNew.slug, is_active: false });
  const afterDisable = (await D(S_IN, { action: 'noticeCategoriesList' })).categories.find((c) => c.slug === catNew.slug);
  check('D6  disable category (is_active=false, row kept)', afterDisable && afterDisable.isActive === false, JSON.stringify(afterDisable));
  await expectThrow('D7  cannot create notice with a DISABLED category', () => D(S_IN, { action: 'noticeCreate', title: 't', content_text: 'x', notice_type: catNew.slug, effective_from: '2026-09-01' }), 'NOTICE_CATEGORY_INACTIVE');
  await D(S_IN, { action: 'noticeCategoriesUpsert', slug: catNew.slug, is_active: true });
  // one category per notice + used category cannot be hard-deleted (no delete action exists)
  const catNotice = await D(S_IN, { action: 'noticeCreate', title: 'Bài dùng danh mục mới', content_text: 'nội dung.', notice_type: catNew.slug, effective_from: '2026-09-01' });
  await D(S_IN, { action: 'noticePublish', id: catNotice.id });
  check('D8  each notice has exactly one category (notice_type = the chosen slug)', psql(`select notice_type from notice.notices where id='${catNotice.id}'`) === catNew.slug, '');
  check('D9  used category cannot be hard-deleted (no delete action + no DELETE grant)', !svc.ACTIONS.some((a) => /categor.*delete|delete.*categor/i.test(a))
    && psql("select privilege_type from information_schema.role_table_grants where table_schema='notice' and table_name='notice_categories' and grantee='phf_hr_app' and privilege_type='DELETE'") === '', '');
  const catUseCount = (await D(S_IN, { action: 'noticeCategoriesList' })).categories.find((c) => c.slug === catNew.slug).useCount;
  check('D10 category use-count reflects published notices', catUseCount === 1, 'count=' + catUseCount);
  const catAudit = Number(psql("select count(*) from notice.notice_audit_logs where action_type in ('category_create','category_rename','category_reorder','category_disable','category_enable')"));
  check('D11 category admin -> audit (create/rename/reorder/disable/enable)', catAudit >= 5, 'count=' + catAudit);
  await expectThrow('D12 viewer cannot manage categories', () => D(S_OUT, { action: 'noticeCategoriesUpsert', name: 'hack' }), 'NOTICE_MANAGE_DENIED');
  // filter by category still works (search is automatic regardless)
  const feedByCat = await D(S_IN, { action: 'noticeFeed', type: catNew.slug });
  check('D13 feed filter by category returns only that category, search unaffected', feedByCat.notices.length >= 1 && feedByCat.notices.every((x) => x.noticeType === catNew.slug), JSON.stringify(feedByCat.notices.map((x) => x.noticeType)));

  // ---- priority (§3) ----
  const pN = await D(S_IN, { action: 'noticeCreate', title: 'Giá xăng cập nhật (thường)', content_text: 'nội dung thường.', notice_type: 'policy', priority: 'normal', effective_from: '2026-09-01' });
  const pI = await D(S_IN, { action: 'noticeCreate', title: 'Nhắc quy trình đóng ca (quan trọng)', content_text: 'quan trọng.', notice_type: 'process', priority: 'important', effective_from: '2026-09-01' });
  const pU = await D(S_IN, { action: 'noticeCreate', title: 'CẢNH BÁO gian lận voucher (hỏa tốc)', content_text: 'hỏa tốc, xử lý ngay.', notice_type: 'guide', priority: 'urgent', effective_from: '2026-09-01', require_acknowledgement: false });
  for (const x of [pN, pI, pU]) await D(S_IN, { action: 'noticePublish', id: x.id });
  const feedP = await D(S_OUT, { action: 'noticeFeed', q: '' });
  const cN = feedP.notices.find((n) => n.id === pN.id), cI = feedP.notices.find((n) => n.id === pI.id), cU = feedP.notices.find((n) => n.id === pU.id);
  check('D14 priority normal/important/urgent stored + returned', cN.priority === 'normal' && cI.priority === 'important' && cU.priority === 'urgent', '');
  check('D15 active Hỏa tốc ranks ahead of an active normal (not pinned)', feedP.notices.findIndex((n) => n.id === pU.id) < feedP.notices.findIndex((n) => n.id === pN.id), '');
  check('D16 Hỏa tốc does NOT force acknowledgement', cU.requireAcknowledgement === false, '');
  // expire the urgent -> loses the priority advantage
  psql(`update notice.notices set effective_from='2025-01-01', effective_to='2025-02-01' where id='${pU.id}'`);
  const feedPx = await D(S_OUT, { action: 'noticeFeed', q: '' });
  check('D17 expired Hỏa tốc loses the active-priority advantage', feedPx.notices.findIndex((n) => n.id === pU.id) > feedPx.notices.findIndex((n) => n.id === pN.id), '');
  check('D18 explicit Ghim still a separate function (pin outranks urgent)', await (async () => { await D(S_IN, { action: 'noticeSetPin', id: pN.id, pinned: true }); const f = await D(S_OUT, { action: 'noticeFeed', q: '' }); await D(S_IN, { action: 'noticeSetPin', id: pN.id, pinned: false }); return f.notices[0].id === pN.id; })(), '');

  // ---- automatic search preserved + additional keywords (§4) ----
  const kNo = await D(S_IN, { action: 'noticeCreate', title: 'Hướng dẫn xử lý đơn trả hàng', content_text: 'Khi khách trả hàng, lập phiếu hoàn tiền và nhập kho.', notice_type: 'guide', effective_from: '2026-09-01', keywords: [] });
  await D(S_IN, { action: 'noticePublish', id: kNo.id });
  check('D19 automatic search works with NO additional keywords (body term)', (await D(S_OUT, { action: 'noticeFeed', q: 'hoàn tiền' })).notices.some((n) => n.id === kNo.id), '');
  const kYes = await D(S_IN, { action: 'noticeUpdate', id: kNo.id, keywords: ['bùng đơn', 'ship COD', 'khách boom'] });
  check('D20 additional-keyword search finds a term NOT in the body', (await D(S_OUT, { action: 'noticeFeed', q: 'khách boom' })).notices.some((n) => n.id === kNo.id), '');
  const kwAudit = Number(psql(`select count(*) from notice.notice_audit_logs where notice_id='${kNo.id}' and action_type='edit'`));
  check('D21 keyword change captured in the edit audit (before/after keywords)', kwAudit >= 1, 'count=' + kwAudit);

  // ---- duplicate warning (§5) — non-blocking ----
  const dup = await D(S_IN, { action: 'noticeSimilar', title: 'Cập nhật cách bấm bill khi khách dùng voucher F6', content_text: 'chiết khấu đơn mã giảm giá', keywords: ['voucher'] });
  check('D22 duplicate warning returns related published notices', Array.isArray(dup.candidates) && dup.candidates.length >= 1 && dup.candidates.every((c) => c.id && c.title && c.categoryName), JSON.stringify(dup.candidates.map((c) => c.title)));
  const stillPublishes = await D(S_IN, { action: 'noticeCreate', title: 'Cập nhật cách bấm bill khi khách dùng voucher F6', content_text: 'nội dung mới về voucher.', notice_type: 'guide', effective_from: '2026-09-01' });
  const pubDup = await D(S_IN, { action: 'noticePublish', id: stillPublishes.id });
  check('D23 duplicate warning does NOT block publishing', pubDup.status === 'published', JSON.stringify(pubDup));
  check('D24 noticeSimilar is read-only (no audit rows for it)', Number(psql("select count(*) from notice.notice_audit_logs where action_type like '%similar%'")) === 0, '');

  // ---- edit without re-ack keeps old ack; updated label ----
  await D(S_OUT, { action: 'noticeDetail', id: kNo.id });
  await D(S_OUT, { action: 'noticeAcknowledge', id: kNo.id });
  await new Promise((r) => setTimeout(r, 1200));
  await D(S_IN, { action: 'noticeUpdate', id: kNo.id, title: 'Hướng dẫn xử lý đơn trả hàng (bổ sung)' });
  const detNoReack = await D(S_OUT, { action: 'noticeDetail', id: kNo.id });
  check('D25 edit WITHOUT re-ack -> old acknowledgement still counts (Đã xác nhận, current)', detNoReack.viewer.acknowledged === true && detNoReack.viewer.acknowledgedRevisionIsCurrent === true, JSON.stringify(detNoReack.viewer));
  const feedUpd = await D(S_OUT, { action: 'noticeFeed', q: 'đơn trả hàng' });
  const upCardD = feedUpd.notices.find((n) => n.id === kNo.id);
  check('D26 feed card shows "Đã cập nhật" (edited flag + lastUpdatedAt)', upCardD && upCardD.edited === true && !!upCardD.updatedAt, JSON.stringify({ edited: upCardD && upCardD.edited }));
  // edit WITH re-ack
  await new Promise((r) => setTimeout(r, 1100));
  await D(S_IN, { action: 'noticeUpdate', id: kNo.id, content_text: 'Nội dung thay đổi quan trọng — mọi người xác nhận lại.', require_reacknowledgement: true });
  const detReack = await D(S_OUT, { action: 'noticeDetail', id: kNo.id });
  check('D27 edit WITH re-ack -> viewer status becomes "cần xác nhận lại" (old ack historical)', detReack.viewer.acknowledged === true && detReack.viewer.acknowledgedRevisionIsCurrent === false, JSON.stringify(detReack.viewer));
  check('D28 old acknowledgement history remains', Number(psql(`select count(*) from notice.notice_acknowledgements where notice_id='${kNo.id}' and employee_code='${U_OUT.employee_code}'`)) >= 1, '');

  // ---- effective status still derived (regression) ----
  const upcD = await D(S_IN, { action: 'noticeCreate', title: 'Chính sách năm sau', content_text: 'áp dụng năm sau.', notice_type: 'policy', effective_from: '2027-01-01' });
  await D(S_IN, { action: 'noticePublish', id: upcD.id });
  check('D29 upcoming/active/expired still derived automatically (no manual switch)', (await D(S_IN, { action: 'noticeFeed', q: 'năm sau' })).notices.find((n) => n.id === upcD.id).effectiveStatus === 'upcoming'
    && !svc.ACTIONS.some((a) => /setStatus|setEffective|forceExpire/i.test(a)), '');

  stopApi();

  console.log(`\n==== NOTICE Batch 01+02+FinalPatch LIVE LOCAL e2e: ${PASS} PASS / ${FAIL} FAIL ====`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { stopApi(); console.error('E2E fatal: ' + (e && e.stack || e)); process.exit(1); });
