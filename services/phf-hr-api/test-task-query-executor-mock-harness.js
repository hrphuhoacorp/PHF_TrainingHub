'use strict';

// TEST/MOCK HARNESS cho lib/task-query-executor.js — KHÔNG kết nối DB thật.
// Cùng kỹ thuật với test-task-write-mock-harness.js: inject module 'pg' giả
// vào require.cache TRƯỚC khi require lib/task-query-executor.js.
//
// Mục đích chính: regression cho fix 2026-08-27 — executeResolvedTaskQuery()
// trước đây KHÔNG SELECT category_code/progress_percent/progress_status,
// khiến task-read-bridge.js (main app) phải hardcode null cho 3 field này.
// Nay đã SELECT đủ và map ra categoryCode/progressPercent/progressStatus.
//
// Chạy: node test-task-query-executor-mock-harness.js

const assert = require('assert');
const crypto = require('crypto');

const EXECUTOR_PATH = require.resolve('./lib/task-query-executor.js');
const DB_JS_PATH = require.resolve('./lib/db.js');

function makeFakeClient(script) {
  const calls = [];
  let step = 0;
  return {
    calls,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const rule = script[step];
      calls.push({ step, sql: normalized, params });
      step += 1;
      if (!rule) throw new Error(`HARNESS_UNEXPECTED_EXTRA_QUERY: "${normalized}"`);
      if (!rule.expect.test(normalized)) {
        throw new Error(`HARNESS_QUERY_MISMATCH at step ${step - 1}: expected /${rule.expect}/ got "${normalized}"`);
      }
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

function makeFakePgModule(client) {
  function FakePool() { return { connect: async () => client, on: () => {} }; }
  return { Pool: FakePool };
}

function loadExecutorWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[EXECUTOR_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const executor = require(EXECUTOR_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return executor;
}

let PASS = 0, FAIL = 0;
function check(name, cond) {
  if (cond) { PASS++; }
  else { FAIL++; console.error('FAIL:', name); }
}

function signDescriptor(descriptor, secret) {
  const { signature, ...rest } = descriptor;
  const canon = JSON.stringify(rest, Object.keys(rest).sort());
  const sig = crypto.createHmac('sha256', secret).update(canon).digest('hex');
  return Object.assign({}, rest, { signature: sig });
}

async function run() {
  const secret = 'test-signing-secret';
  const baseDescriptor = {
    requesterEmployeeCode: 'PHF082',
    requesterActorType: 'nhan_vien',
    mode: 'creator_eq',
    creatorEmployeeCode: 'PHF082',
    assigneeEmployeeCodes: null,
    flowType: 'giao_viec',
    requirePrimaryRoleActive: true,
    excludeDraft: false,
    crossDepartmentOnly: false,
    statusFilter: 'all',
    search: '',
    offset: 0,
    limit: 50,
    relation: 'assigned',
    scope: 'default',
    viewScopeType: 'self',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15000).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const descriptor = signDescriptor(baseDescriptor, secret);

  const script = [
    { expect: /^BEGIN READ ONLY$/ },
    { expect: /^SET LOCAL ROLE phf_hr_app$/ },
    { expect: /^SET LOCAL statement_timeout/ },
    {
      // Proposal V2 (2026-08-29, additive) — executor nay SELECT qua alias
      // t./pd. (LEFT JOIN task.proposal_decisions) — regex cập nhật để khớp
      // đúng SQL mới, KHÔNG đổi ý nghĩa test (vẫn xác nhận đủ 3 cột category_
      // code/progress_percent/progress_status như mục đích gốc của file).
      expect: /SELECT t\.id, t\.task_code, t\.flow_type, t\.status, t\.title, t\.priority, t\.deadline, t\.category_code, t\.progress_percent, t\.progress_status/,
      result: {
        rows: [{
          id: 't1', task_code: 'CV-2608-0099', flow_type: 'giao_viec', status: 'in_progress',
          title: 'Test', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
          category_code: 'NHAN_SU', progress_percent: 40, progress_status: 'on_track',
          created_by_employee_code: 'PHF082', is_cross_department: false,
          source_department: null, target_department: null,
          created_at: '2026-08-27T00:00:00Z', row_version: 1,
        }],
      },
    },
    {
      expect: /SELECT task_id, employee_code\s+FROM task\.assignees/,
      result: { rows: [{ task_id: 't1', employee_code: 'PHF082' }] },
    },
    { expect: /^COMMIT$/ },
  ];
  const client = makeFakeClient(script);
  const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);

  const result = await executeResolvedTaskQuery({}, descriptor, secret);

  check('SELECT SQL đã bao gồm category_code/progress_percent/progress_status',
    /t\.category_code, t\.progress_percent, t\.progress_status/.test(client.calls[3].sql));
  check('SELECT SQL Proposal V2 — LEFT JOIN task.proposal_decisions có mặt (additive, không regression)',
    /LEFT JOIN task\.proposal_decisions pd ON pd\.proposal_task_id = t\.id/.test(client.calls[3].sql));
  check('response.data[0].proposalStatus = null cho row flow_type=giao_viec (LEFT JOIN không match)',
    result.data[0].proposalStatus === null);
  check('response.data[0].categoryCode map đúng giá trị thật (không còn null cứng)',
    result.data[0].categoryCode === 'NHAN_SU');
  check('response.data[0].progressPercent map đúng giá trị thật',
    result.data[0].progressPercent === 40);
  check('response.data[0].progressStatus map đúng giá trị thật',
    result.data[0].progressStatus === 'on_track');
  check('response.data[0].primaryEmployeeCode vẫn hoạt động (không regression)',
    result.data[0].primaryEmployeeCode === 'PHF082');

  // =========================================================================
  // Proposal V2 (2026-08-29) — de_xuat row CÓ match ở task.proposal_decisions
  // (JOIN thật trả dữ liệu) -> proposalStatus/generated_task_id map đúng.
  // =========================================================================
  {
    const proposalDescriptorBase = Object.assign({}, baseDescriptor, {
      mode: 'creator_eq', flowType: 'de_xuat', relation: 'proposal_sent',
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const proposalDescriptor = signDescriptor(proposalDescriptorBase, secret);
    const proposalScript = [
      { expect: /^BEGIN READ ONLY$/ },
      { expect: /^SET LOCAL ROLE phf_hr_app$/ },
      { expect: /^SET LOCAL statement_timeout/ },
      {
        expect: /LEFT JOIN task\.proposal_decisions pd ON pd\.proposal_task_id = t\.id/,
        result: {
          rows: [{
            id: 'p1', task_code: 'DX-2608-0001', flow_type: 'de_xuat', status: 'published',
            title: 'Đề xuất test', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
            category_code: 'NHAN_SU', progress_percent: 0, progress_status: 'chua_bat_dau',
            created_by_employee_code: 'PHF082', is_cross_department: null,
            source_department: null, target_department: null,
            created_at: '2026-08-29T00:00:00Z', row_version: 1,
            proposal_status: 'accepted', recipient_employee_code: 'PHF010',
            generated_task_id: 'newtask-abc', reject_reason: null, cancel_reason: null,
            decided_by_employee_code: 'PHF010', decided_at: '2026-08-29T01:00:00Z',
          }],
        },
      },
      { expect: /SELECT task_id, employee_code\s+FROM task\.assignees/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ];
    const client2 = makeFakeClient(proposalScript);
    const { executeResolvedTaskQuery: execProposal } = loadExecutorWithFakePg(client2);
    const result2 = await execProposal({}, proposalDescriptor, secret);
    check('Proposal V2 — proposalStatus map đúng khi JOIN có match (accepted)',
      result2.data[0].proposalStatus === 'accepted');
    check('Proposal V2 — proposalGeneratedTaskId map đúng (link tới Task sinh ra)',
      result2.data[0].proposalGeneratedTaskId === 'newtask-abc');
    check('Proposal V2 — proposalRecipientEmployeeCode map đúng',
      result2.data[0].proposalRecipientEmployeeCode === 'PHF010');
  }

  // =========================================================================
  // Account-only creator (2026-08-30) — Admin without an employee profile.
  // descriptor.creatorEmployeeCode = '' , creatorAccountId = 'acct-A'. The
  // creator_eq WHERE must key off created_by_account_id (NOT an empty-string
  // created_by_employee_code that matches nothing), and never widen to all rows.
  // =========================================================================
  {
    const adminBase = Object.assign({}, baseDescriptor, {
      requesterEmployeeCode: '', requesterActorType: 'admin',
      mode: 'creator_eq', creatorEmployeeCode: '', creatorAccountId: 'acct-A',
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const adminDescriptor = signDescriptor(adminBase, secret);
    const adminScript = [
      { expect: /^BEGIN READ ONLY$/ },
      { expect: /^SET LOCAL ROLE phf_hr_app$/ },
      { expect: /^SET LOCAL statement_timeout/ },
      {
        expect: /WHERE flow_type = \$1 AND t\.created_by_account_id = \$2 ORDER BY/,
        result: {
          rows: [{
            id: 'tA', task_code: 'CV-2608-0013', flow_type: 'giao_viec', status: 'published',
            title: 'PROD-SMOKE', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
            category_code: 'NHAN_SU', progress_percent: 0, progress_status: 'chua_bat_dau',
            created_by_employee_code: null, is_cross_department: false,
            source_department: null, target_department: null,
            created_at: '2026-08-30T00:00:00Z', row_version: 1,
          }],
        },
      },
      { expect: /SELECT task_id, employee_code\s+FROM task\.assignees/, result: { rows: [{ task_id: 'tA', employee_code: 'PHF012' }] } },
      { expect: /^COMMIT$/ },
    ];
    const clientA = makeFakeClient(adminScript);
    const { executeResolvedTaskQuery: execAdmin } = loadExecutorWithFakePg(clientA);
    const resultA = await execAdmin({}, adminDescriptor, secret);
    check('account-only creator_eq — WHERE keys off created_by_account_id = $2',
      / t\.created_by_account_id = \$2 /.test(clientA.calls[3].sql) && clientA.calls[3].params[1] === 'acct-A');
    check('account-only creator_eq — Task CV-2608-0013 returned to its Admin creator',
      resultA.data.length === 1 && resultA.data[0].taskCode === 'CV-2608-0013' && resultA.data[0].primaryEmployeeCode === 'PHF012');
  }

  // Admin B (acct-B) must NOT see Admin A's Task — account ids are unique, the
  // WHERE is an exact equality, so a different account id simply returns 0 rows.
  {
    const adminBBase = Object.assign({}, baseDescriptor, {
      requesterEmployeeCode: '', requesterActorType: 'admin',
      mode: 'creator_eq', creatorEmployeeCode: '', creatorAccountId: 'acct-B',
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const adminBDescriptor = signDescriptor(adminBBase, secret);
    const adminBScript = [
      { expect: /^BEGIN READ ONLY$/ },
      { expect: /^SET LOCAL ROLE phf_hr_app$/ },
      { expect: /^SET LOCAL statement_timeout/ },
      { expect: /WHERE flow_type = \$1 AND t\.created_by_account_id = \$2 ORDER BY/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ];
    const clientB = makeFakeClient(adminBScript);
    const { executeResolvedTaskQuery: execAdminB } = loadExecutorWithFakePg(clientB);
    const resultB = await execAdminB({}, adminBDescriptor, secret);
    check('ADMIN_A_CANNOT_SEE_ADMIN_B — acct-B query filters on its own id, 0 rows for acct-A Task',
      clientB.calls[3].params[1] === 'acct-B' && resultB.data.length === 0);
  }

  // Neither identity -> no wildcard, empty result, DB not even queried past setup.
  {
    const nullBase = Object.assign({}, baseDescriptor, {
      mode: 'creator_eq', creatorEmployeeCode: '', creatorAccountId: null,
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const nullDescriptor = signDescriptor(nullBase, secret);
    const nullClient = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ },
      { expect: /^SET LOCAL ROLE phf_hr_app$/ },
      { expect: /^SET LOCAL statement_timeout/ },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery: execNull } = loadExecutorWithFakePg(nullClient);
    const resultNull = await execNull({}, nullDescriptor, secret);
    check('creator_eq with no identity -> empty result, no task SELECT issued (no wildcard)',
      resultNull.data.length === 0 && !nullClient.calls.some((c) => /FROM task\.tasks/.test(c.sql)));
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
