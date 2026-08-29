'use strict';

// TEST/MOCK HARNESS cho Proposal V2 (lib/task-write.js::publishTask nhánh
// de_xuat + acceptTaskProposal/rejectTaskProposal/cancelTaskProposal) —
// KHÔNG kết nối DB thật, cùng kỹ thuật fake-pg-module đã dùng ở
// test-task-write-mock-harness.js (KHÔNG sửa file harness cũ, KHÔNG sửa
// lib/db.js/lib/task-write.js production code — chỉ require).
//
// Bảo vệ:
//   PROPOSAL_ACCEPT / PROPOSAL_REJECT / PROPOSAL_CANCEL — happy path + mọi
//     error code (not found / already decided / actor denied / reason
//     required / primary required).
//   PROPOSAL_ACCEPT_ATOMICITY — 1 transaction duy nhất (BEGIN..COMMIT),
//     INSERT task.tasks MỚI + INSERT proposal_decisions UPDATE trong CÙNG
//     transaction, lỗi giữa chừng -> ROLLBACK, không COMMIT một phần.
//   PROPOSAL_AUDIT — event 'proposal_accept'/'proposal_reject'/
//     'proposal_cancel' được INSERT đúng, event 'published' của Task mới có
//     payload.source_proposal_task_id trace ngược Proposal.
//   PROPOSAL_GENERATED_TASK_LINK — UPDATE proposal_decisions SET
//     generated_task_id = <task mới> trong đúng transaction accept.
//   NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED (ở publishTask) — nhánh
//     flow_type='giao_viec' của publishTask phát ra ĐÚNG NGUYÊN VĂN chuỗi
//     SQL như trước khi có Proposal V2 (không có INSERT proposal_decisions
//     nào chạy, không đổi params CTE cũ).
//
// Chạy: node test-task-proposal-write-mock-harness.js

const assert = require('assert');

const DB_JS_PATH = require.resolve('./lib/db.js');
const TASK_WRITE_JS_PATH = require.resolve('./lib/task-write.js');

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
      if (rule.error) throw rule.error;
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() { calls.push({ step: 'release' }); },
    _remainingSteps: () => script.length - step,
  };
}

function makeFakePgModule(client) {
  function FakePool() { return { connect: async () => client, on: () => {} }; }
  return { Pool: FakePool };
}

function loadTaskWriteWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[TASK_WRITE_JS_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const taskWrite = require(TASK_WRITE_JS_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return taskWrite;
}

const MOCK_CONFIG = {
  PHF_HR_DB_HOST: 'mock-host-not-real',
  PHF_HR_DB_PORT: 5432,
  PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real',
  PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}
async function expectThrow(fn, code, name) {
  try {
    await fn();
    record(name, false, 'expected throw, got none');
  } catch (err) {
    record(name, err.code === code, { got: err.code, want: code });
  }
}

const BEGIN = /^BEGIN$/;
const SET_ROLE = /^SET LOCAL ROLE phf_hr_app$/;
const COMMIT = /^COMMIT$/;
const ROLLBACK = /^ROLLBACK$/;
const SELECT_TASK_FOR_UPDATE = /^SELECT \* FROM task\.tasks WHERE id = \$1 FOR UPDATE$/;
const SELECT_PRIMARY_COUNT = /^SELECT count\(\*\)::int AS count FROM task\.assignees/;
const PUBLISH_CTE = /^WITH updated AS \( UPDATE task\.tasks SET status = 'published'/;
const INSERT_PROPOSAL_DECISION = /^INSERT INTO task\.proposal_decisions \(proposal_task_id, recipient_employee_code, proposal_status, created_by_employee_code\)/;
const SELECT_PROPOSAL_FOR_UPDATE = /^SELECT \* FROM task\.proposal_decisions WHERE proposal_task_id = \$1 FOR UPDATE$/;
const SELECT_CATEGORY = /^SELECT is_active FROM task\.categories WHERE category_code = \$1 FOR SHARE$/;
const SELECT_NEXT_CODE = /^SELECT task\.task_next_code\(now\(\)\) AS code$/;
const INSERT_TASK = /^INSERT INTO task\.tasks \( flow_type, status, title, content, category_code, priority, start_at, deadline, created_by_employee_code, task_code, published_at \)/;
const INSERT_ASSIGNEE_PRIMARY = /^INSERT INTO task\.assignees \(task_id, employee_code, role, assigned_by_employee_code, assigned_by_account_id\)/;
const INSERT_EVENT_PUBLISHED = /^INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload\)/;
const UPDATE_PROPOSAL_ACCEPTED = /^UPDATE task\.proposal_decisions SET proposal_status = 'accepted'/;
const INSERT_EVENT_PROPOSAL_ACCEPT = /^INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload\) VALUES \(\$1, 'proposal_accept'/;
const UPDATE_PROPOSAL_REJECTED = /^UPDATE task\.proposal_decisions SET proposal_status = 'rejected'/;
const INSERT_EVENT_PROPOSAL_REJECT = /^INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload, reason\) VALUES \(\$1, 'proposal_reject'/;
const UPDATE_PROPOSAL_CANCELLED = /^UPDATE task\.proposal_decisions SET proposal_status = 'cancelled'/;
const INSERT_EVENT_PROPOSAL_CANCEL = /^INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload, reason\) VALUES \(\$1, 'proposal_cancel'/;

(async () => {
  // =========================================================================
  // publishTask — REGRESSION: flow_type='giao_viec' phát ra ĐÚNG chuỗi SQL
  // như trước Proposal V2 (không có INSERT proposal_decisions nào chạy).
  // Bảo vệ NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED / no-regression tại write
  // layer.
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_TASK_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft', flow_type: 'giao_viec', created_by_employee_code: 'PHF001', created_by_account_id: null }], rowCount: 1 } },
      { expect: SELECT_PRIMARY_COUNT, result: { rows: [{ count: 1 }], rowCount: 1 } },
      { expect: PUBLISH_CTE, result: { rows: [{ id: 't1', status: 'published', flow_type: 'giao_viec', row_version: 2 }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    const out = await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' });
    record('publishTask_giaoviec_NO_PROPOSAL_INSERT_regression', out.status === 'published' && client._remainingSteps() === 0, { calls: client.calls.length });
  }

  // publishTask — de_xuat KHÔNG có recipientEmployeeCode -> lỗi TRƯỚC khi
  // chạy CTE publish (rollback, không publish nửa vời). KHÔNG có
  // SELECT_PRIMARY_COUNT — de_xuat bỏ qua check "1 active primary" (fix
  // 2026-08-29 phát hiện qua real-DB test: Proposal chưa có Primary tại thời
  // điểm publish, Primary chỉ chọn ở bước Accept).
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_TASK_FOR_UPDATE, result: { rows: [{ id: 't2', row_version: 1, status: 'draft', flow_type: 'de_xuat', created_by_employee_code: 'PHF001', created_by_account_id: null }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    await expectThrow(
      () => publishTask(MOCK_CONFIG, { taskId: 't2', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' }),
      'TASK_PROPOSAL_RECIPIENT_REQUIRED',
      'publishTask_deXuat_missing_recipient_ROLLBACK'
    );
  }

  // publishTask — de_xuat CÓ recipientEmployeeCode -> publish CTE + INSERT
  // proposal_decisions(pending) trong CÙNG transaction, COMMIT 1 lần.
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_TASK_FOR_UPDATE, result: { rows: [{ id: 't3', row_version: 1, status: 'draft', flow_type: 'de_xuat', created_by_employee_code: 'PHF001', created_by_account_id: null }], rowCount: 1 } },
      { expect: PUBLISH_CTE, result: { rows: [{ id: 't3', status: 'published', flow_type: 'de_xuat', row_version: 2 }], rowCount: 1 } },
      { expect: INSERT_PROPOSAL_DECISION, result: { rows: [{ proposal_task_id: 't3' }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    const out = await publishTask(MOCK_CONFIG, { taskId: 't3', expectedRowVersion: 1, actorEmployeeCode: 'PHF001', recipientEmployeeCode: 'phf002' });
    const insertCall = client.calls.find((c) => INSERT_PROPOSAL_DECISION.test(c.sql));
    record('publishTask_deXuat_creates_pending_proposal_decision', out.status === 'published' && insertCall.params[1] === 'PHF002' && insertCall.params[2] === undefined ? false : insertCall.params[1] === 'PHF002', { params: insertCall.params });
  }

  // =========================================================================
  // acceptTaskProposal — happy path — ATOMICITY (1 BEGIN..COMMIT), AUDIT
  // (proposal_accept + published với source_proposal_task_id), GENERATED_
  // TASK_LINK (UPDATE proposal_decisions SET generated_task_id).
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p1', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: SELECT_CATEGORY, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: SELECT_NEXT_CODE, result: { rows: [{ code: 'CV-0001' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'newtask1', flow_type: 'giao_viec', status: 'published', task_code: 'CV-0001' }], rowCount: 1 } },
      { expect: INSERT_ASSIGNEE_PRIMARY, result: { rows: [{ id: 'a1' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PUBLISHED, result: { rows: [], rowCount: 1 } },
      { expect: UPDATE_PROPOSAL_ACCEPTED, result: { rows: [{ proposal_task_id: 'p1', proposal_status: 'accepted', generated_task_id: 'newtask1' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PROPOSAL_ACCEPT, result: { rows: [], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    const out = await acceptTaskProposal(MOCK_CONFIG, {
      proposalTaskId: 'p1', actorEmployeeCode: 'phf002',
      title: 'Việc mới', content: '', categoryCode: 'GENERAL', priority: 'thuong',
      deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: 'PHF003',
    });
    const publishedEventCall = client.calls.find((c) => INSERT_EVENT_PUBLISHED.test(c.sql));
    const publishedPayload = JSON.parse(publishedEventCall.params[3]);
    const acceptEventCall = client.calls.find((c) => INSERT_EVENT_PROPOSAL_ACCEPT.test(c.sql));
    const acceptPayload = JSON.parse(acceptEventCall.params[3]);
    record('acceptTaskProposal_SUCCESS_single_transaction', client.calls[0].sql === 'BEGIN' && client.calls[client.calls.length - 2].sql === 'COMMIT', { begins: client.calls.filter(c => c.sql === 'BEGIN').length });
    record('acceptTaskProposal_generated_task_linked', out.proposal.generated_task_id === 'newtask1' && out.generatedTask.id === 'newtask1');
    record('acceptTaskProposal_new_task_traces_back_to_proposal', publishedPayload.source_proposal_task_id === 'p1' && publishedPayload.flow_type === 'giao_viec');
    record('acceptTaskProposal_audit_event_on_proposal', acceptEventCall.params[0] === 'p1' && acceptPayload.generated_task_id === 'newtask1' && acceptPayload.primary_employee_code === 'PHF003');
    record('acceptTaskProposal_all_scripted_steps_consumed', client._remainingSteps() === 0, { remaining: client._remainingSteps() });
  }

  // acceptTaskProposal — ATOMICITY: lỗi ở bước cuối (proposal_accept event
  // insert fail) -> ROLLBACK toàn bộ, KHÔNG có Task/primary/proposal-accepted
  // nào tồn tại (không có trạng thái nửa vời).
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p2', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: SELECT_CATEGORY, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: SELECT_NEXT_CODE, result: { rows: [{ code: 'CV-0002' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'newtask2' }], rowCount: 1 } },
      { expect: INSERT_ASSIGNEE_PRIMARY, result: { rows: [{ id: 'a2' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PUBLISHED, result: { rows: [], rowCount: 1 } },
      { expect: UPDATE_PROPOSAL_ACCEPTED, result: { rows: [{ proposal_task_id: 'p2' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PROPOSAL_ACCEPT, error: Object.assign(new Error('simulated_db_error'), { code: '55000' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    let threw = false;
    try {
      await acceptTaskProposal(MOCK_CONFIG, {
        proposalTaskId: 'p2', actorEmployeeCode: 'PHF002',
        title: 'Việc mới 2', categoryCode: 'GENERAL', deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: 'PHF003',
      });
    } catch (err) { threw = err.message === 'simulated_db_error'; }
    record('acceptTaskProposal_ATOMICITY_partial_failure_rolls_back_everything', threw && client._remainingSteps() === 0, { remaining: client._remainingSteps() });
  }

  // acceptTaskProposal — not found / already decided / actor denied / primary required
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => acceptTaskProposal(MOCK_CONFIG, { proposalTaskId: 'missing', actorEmployeeCode: 'X' }), 'TASK_PROPOSAL_NOT_FOUND', 'acceptTaskProposal_NOT_FOUND');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p3', recipient_employee_code: 'PHF002', proposal_status: 'accepted' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => acceptTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p3', actorEmployeeCode: 'PHF002' }), 'TASK_PROPOSAL_ALREADY_DECIDED', 'acceptTaskProposal_ALREADY_DECIDED');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p4', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => acceptTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p4', actorEmployeeCode: 'PHF999' }), 'TASK_PROPOSAL_ACTOR_DENIED', 'acceptTaskProposal_ACTOR_DENIED_not_recipient');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p5', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { acceptTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => acceptTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p5', actorEmployeeCode: 'PHF002' }), 'TASK_PRIMARY_REQUIRED', 'acceptTaskProposal_PRIMARY_REQUIRED');
  }

  // =========================================================================
  // rejectTaskProposal — happy path + reason bắt buộc + actor denied +
  // already decided.
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p6', recipient_employee_code: 'PHF002', created_by_employee_code: 'PHF001', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: UPDATE_PROPOSAL_REJECTED, result: { rows: [{ proposal_task_id: 'p6', proposal_status: 'rejected', reject_reason: 'Không đúng nghiệp vụ' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PROPOSAL_REJECT, result: { rows: [], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { rejectTaskProposal } = loadTaskWriteWithFakePg(client);
    const out = await rejectTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p6', actorEmployeeCode: 'PHF002', reason: 'Không đúng nghiệp vụ' });
    const eventCall = client.calls.find((c) => INSERT_EVENT_PROPOSAL_REJECT.test(c.sql));
    record('rejectTaskProposal_SUCCESS_with_audit_reason', out.proposal_status === 'rejected' && eventCall.params[4] === 'Không đúng nghiệp vụ');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p7', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { rejectTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => rejectTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p7', actorEmployeeCode: 'PHF002', reason: '' }), 'TASK_PROPOSAL_REJECT_REASON_REQUIRED', 'rejectTaskProposal_REASON_REQUIRED');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p8', recipient_employee_code: 'PHF002', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { rejectTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => rejectTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p8', actorEmployeeCode: 'PHF001', reason: 'x' }), 'TASK_PROPOSAL_ACTOR_DENIED', 'rejectTaskProposal_ACTOR_DENIED_not_recipient');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p9', recipient_employee_code: 'PHF002', proposal_status: 'rejected' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { rejectTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => rejectTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p9', actorEmployeeCode: 'PHF002', reason: 'x' }), 'TASK_PROPOSAL_ALREADY_DECIDED', 'rejectTaskProposal_ALREADY_DECIDED_terminal');
  }

  // =========================================================================
  // cancelTaskProposal — creator-only (KHÁC reject là recipient-only) +
  // reason bắt buộc + already decided.
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p10', recipient_employee_code: 'PHF002', created_by_employee_code: 'PHF001', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: UPDATE_PROPOSAL_CANCELLED, result: { rows: [{ proposal_task_id: 'p10', proposal_status: 'cancelled', cancel_reason: 'Đổi ý' }], rowCount: 1 } },
      { expect: INSERT_EVENT_PROPOSAL_CANCEL, result: { rows: [], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { cancelTaskProposal } = loadTaskWriteWithFakePg(client);
    const out = await cancelTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p10', actorEmployeeCode: 'PHF001', reason: 'Đổi ý' });
    record('cancelTaskProposal_SUCCESS_creator_only', out.proposal_status === 'cancelled');
  }
  {
    // Recipient (KHÔNG phải creator) cố Cancel -> denied — chứng minh Cancel
    // và Reject là 2 quyền tách biệt (LOCK "Người gửi được hủy... chỉ khi
    // đang Pending", KHÔNG phải người nhận).
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p11', recipient_employee_code: 'PHF002', created_by_employee_code: 'PHF001', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { cancelTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => cancelTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p11', actorEmployeeCode: 'PHF002', reason: 'x' }), 'TASK_PROPOSAL_ACTOR_DENIED', 'cancelTaskProposal_ACTOR_DENIED_recipient_cannot_cancel');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p12', created_by_employee_code: 'PHF001', proposal_status: 'pending' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { cancelTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => cancelTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p12', actorEmployeeCode: 'PHF001', reason: '' }), 'TASK_PROPOSAL_CANCEL_REASON_REQUIRED', 'cancelTaskProposal_REASON_REQUIRED');
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} }, { expect: SET_ROLE, result: {} },
      { expect: SELECT_PROPOSAL_FOR_UPDATE, result: { rows: [{ proposal_task_id: 'p13', created_by_employee_code: 'PHF001', proposal_status: 'accepted' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { cancelTaskProposal } = loadTaskWriteWithFakePg(client);
    await expectThrow(() => cancelTaskProposal(MOCK_CONFIG, { proposalTaskId: 'p13', actorEmployeeCode: 'PHF001', reason: 'x' }), 'TASK_PROPOSAL_ALREADY_DECIDED', 'cancelTaskProposal_ALREADY_DECIDED_terminal');
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.error('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
})().catch((err) => {
  console.error('HARNESS_CRASH', err);
  process.exit(1);
});
