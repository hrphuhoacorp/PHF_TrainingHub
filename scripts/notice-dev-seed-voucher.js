'use strict';
/*
 * PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 · LOCAL demo fixture (Voucher).
 *
 * Seeds the brief §22/§28 Voucher notice into the THROWAWAY phf_hr_e2e
 * (schema notice.*) so an Operator can do a live localhost visual review
 * (feed / search F6 / search voucher / detail / acknowledge / report).
 *
 * LOCAL TEST DATA ONLY. Never inserts into PROD. Idempotent (skips if a notice
 * with the same title already exists).
 *
 * Prereq: SSH tunnel 15432 up; migrations/phf_hr_notice_v1.sql applied to
 * throwaway; .env.test = PHF-HR-DEV; e2e/phf-hr-e2e-db.env = throwaway PG.
 * Run: node scripts/notice-dev-seed-voucher.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const CONTAINER = process.env.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('SEED_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }
function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }

const TITLE = 'Cập nhật cách bấm bill khi khách sử dụng Voucher';
const BODY = [
  'Voucher được ghi nhận dưới hình thức giảm giá đơn hàng, không chọn "Voucher" làm phương thức thanh toán như cách cũ.',
  '',
  '1. Voucher có mã giảm giá',
  'Vào Chiết khấu đơn (F6) → Mã giảm giá. Nhập hoặc quét mã in trên voucher. Kiểm tra đúng số tiền giảm trước khi thanh toán. Phần tiền khách còn phải trả được ghi nhận theo phương thức thực tế: tiền mặt, chuyển khoản, thẻ…',
  '',
  '2. Voucher cũ không có mã giảm giá',
  'Trong thời gian chuyển đổi: vào Chiết khấu đơn (F6), nhập thủ công số tiền giảm bằng đúng giá trị voucher, ghi chú trên đơn "Sử dụng voucher [loại voucher/giá trị voucher]", phần tiền còn lại ghi nhận theo phương thức thực tế khách thanh toán.',
  '',
  'Ví dụ: Tổng đơn 650.000 đồng, voucher sinh nhật 200.000 đồng → chiết khấu tổng đơn 200.000 đồng → khách còn thanh toán 450.000 đồng → nếu chuyển khoản thì phương thức thanh toán là Chuyển khoản.',
].join('\n');

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='notice'") !== '1') die('schema notice chưa có trên throwaway.');
  if (psql(`select count(*) from notice.notices where title='${TITLE}'`) !== '0') { console.log('Fixture đã tồn tại — bỏ qua (idempotent).'); process.exit(0); }

  const PORT = 18951;
  const TOKEN = crypto.randomBytes(32).toString('hex');
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT), PHF_HR_API_BIND_HOST: '127.0.0.1', PHF_HR_API_SERVICE_TOKEN: TOKEN,
      SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
      PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
      PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
      PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
      PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(require('os').tmpdir() + path.sep + 'notice-seed-'),
      TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
      NOTICE_DEV_ACCESS_ALLOW: 'PHF012',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.on('exit', () => { try { api.kill('SIGTERM'); } catch (_) {} });
  if (!(await waitHealth('http://127.0.0.1:' + PORT + '/healthz', 15000))) die('phf-hr-api child not healthy');

  process.env.PHF_HR_API_BASE_URL = 'http://127.0.0.1:' + PORT;
  process.env.PHF_HR_API_SERVICE_TOKEN = TOKEN;
  process.env.PHF_NOTICE_BRIDGE_ENABLED = 'true';
  process.env.SUPABASE_URL = envTest.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = envTest.SUPABASE_SECRET_KEY;

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  if (!opAcc) die('không thấy operator account trên DEV');
  const session = { account: { id: opAcc.id, employeeCode: opAcc.employee_code || 'PHF012', role: opAcc.role, email: opAcc.email, name: opAcc.email }, role: opAcc.role, sub: opAcc.id };

  const { dispatchNoticeAction } = require(path.join(REPO, 'api', '_lib', 'notice-actions'));
  const D = (payload) => dispatchNoticeAction(session, payload).then((r) => r.result);

  // "Bán hàng" scope — use a real active Sales department string from People Master
  const sales = (await sb.from('employee_profiles').select('department').eq('employment_status', 'active').ilike('department', '%bán hàng%').limit(1).maybeSingle()).data;
  const scopeValue = (sales && sales.department) || 'Bộ phận bán hàng';

  const cr = await D({ action: 'noticeCreate', title: TITLE, content_text: BODY, notice_type: 'guide',
    effective_from: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
    require_acknowledgement: true,
    scopes: [{ scope_type: 'department', scope_value: scopeValue }],
    keywords: ['voucher', 'bấm bill', 'F6', 'chiết khấu', 'mã giảm giá', 'POS', 'voucher sinh nhật'] });
  await D({ action: 'noticePublish', id: cr.id });

  console.log('\nLOCAL Voucher fixture seeded (throwaway phf_hr_e2e).');
  console.log('  notice id   = ' + cr.id);
  console.log('  Áp dụng     = ' + scopeValue + '  (nhãn — KHÔNG giới hạn quyền xem)');
  console.log('  search test = "F6" | "voucher" | "bam bill" | "mã giảm giá"');
  console.log('  route       = /{admin|ql|hv}/thong-bao  then open the card\n');
  process.exit(0);
})().catch((e) => { console.error('SEED fatal: ' + (e && e.stack || e)); process.exit(1); });
