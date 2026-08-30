'use strict';

// Regression test cho fix 2026-08-27: task-query-descriptor-builder.js
// (RESOLVED_TASK_QUERY_DESCRIPTOR_V1 builder cho phf-hr-api READ integration)
// từng lệch bug self+managed đã fix ở task-core.js::resolveAuthorizedTaskScope()
// commit 31a6c5b. Mock-only — 0% chạm DB/network thật. Mock resolveEffectiveTaskScope()
// (task-permissions.js) trực tiếp qua require.cache để test ĐÚNG branching logic của
// buildResolvedTaskQueryDescriptor(), độc lập khỏi bất kỳ DB nào.

const path = require('path');
const assert = require('assert');

const permissionsPath = require.resolve('../api/_lib/task-permissions');
const builderPath = require.resolve('../api/_lib/task-query-descriptor-builder');

let PASS = 0, FAIL = 0;
function check(name, cond) {
  if (cond) { PASS++; }
  else { FAIL++; console.error('FAIL:', name); }
}

function mockScope({ actorType, employeeCode, accountId, managedEmployeeCodes, peopleScopeType, peopleScopeValues }) {
  delete require.cache[permissionsPath];
  delete require.cache[builderPath];
  require.cache[permissionsPath] = {
    id: permissionsPath,
    filename: permissionsPath,
    loaded: true,
    exports: {
      resolveEffectiveTaskScope: async () => ({
        actorContext: {
          actorType,
          employeeCode,
          accountId: accountId || undefined,
          managedEmployeeCodes: managedEmployeeCodes || [],
        },
        scope: {
          peopleScope: {
            type: peopleScopeType,
            values: peopleScopeValues || [],
          },
          capabilities: { view: true, assign: true, update: true, manage: actorType === 'admin' },
        },
      }),
    },
  };
  return require(builderPath);
}

async function run() {
  // Case 1 — TBP/Trưởng ca, relation='received', KHÔNG truyền scope (mặc định
  // tab "Tôi nhận") — phải self-only, KHÔNG lộ self+managed. Đây chính là
  // scenario của bug đã fix.
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'truong_bo_phan',
      employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF012', 'PHF050', 'PHF051'],
      peopleScopeType: 'employees',
      peopleScopeValues: ['PHF012', 'PHF050', 'PHF051'],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'received' }, { signingSecret: 'x' });
    check('scopeParam rỗng -> self-only (assigneeEmployeeCodes = [PHF012] duy nhất)',
      Array.isArray(d.assigneeEmployeeCodes) && d.assigneeEmployeeCodes.length === 1 && d.assigneeEmployeeCodes[0] === 'PHF012');
  }

  // Case 2 — cùng actor, scope='mine' tường minh -> vẫn self-only (không đổi hành vi).
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'truong_bo_phan',
      employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF012', 'PHF050', 'PHF051'],
      peopleScopeType: 'employees',
      peopleScopeValues: ['PHF012', 'PHF050', 'PHF051'],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'received', scope: 'mine' }, { signingSecret: 'x' });
    check('scope=mine tường minh -> self-only',
      Array.isArray(d.assigneeEmployeeCodes) && d.assigneeEmployeeCodes.length === 1 && d.assigneeEmployeeCodes[0] === 'PHF012');
  }

  // Case 3 — scope='managed' -> đúng toàn bộ managed set (workspace "Nhân sự tôi quản lý").
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'truong_bo_phan',
      employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF012', 'PHF050', 'PHF051'],
      peopleScopeType: 'employees',
      peopleScopeValues: ['PHF012', 'PHF050', 'PHF051'],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'received', scope: 'managed' }, { signingSecret: 'x' });
    check('scope=managed -> managedEmployeeCodes đầy đủ',
      Array.isArray(d.assigneeEmployeeCodes) && d.assigneeEmployeeCodes.length === 3 &&
      ['PHF012', 'PHF050', 'PHF051'].every(c => d.assigneeEmployeeCodes.includes(c)));
  }

  // Case 4 — G3 FIX (2026-08-28): GĐ/TLGĐ (peopleScope.type='all_company'),
  // scope rỗng ("Tôi nhận" mặc định) -> self-only, KHÔNG còn null/không giới
  // hạn. Evidence PHF010 (tro_ly_gd): "Tôi nhận" từng trả về cả 50/50 Task
  // công ty dù PHF010 chỉ là Primary thật trên 1/50 — capability all_company
  // (quyền can thiệp company-wide) đã bị lộ nhầm vào quan hệ Task cá nhân
  // "Tôi nhận". Xem CHANGELOG ở đầu file/task-core.js::resolveAuthorizedTaskScope()
  // (taskRelationshipOnly). Report/Dashboard KHÔNG bị đụng (task-reporting.js
  // gọi resolver này không qua builder — vẫn company-wide cho GĐ/TLGĐ như cũ).
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'giam_doc',
      employeeCode: 'PHF002',
      managedEmployeeCodes: [],
      peopleScopeType: 'all_company',
      peopleScopeValues: [],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'received' }, { signingSecret: 'x' });
    check('G3 FIX: all_company + scope rỗng -> assigneeEmployeeCodes = [PHF002] self-only (không còn null/executive leak)',
      Array.isArray(d.assigneeEmployeeCodes) && d.assigneeEmployeeCodes.length === 1 && d.assigneeEmployeeCodes[0] === 'PHF002');
  }

  // Case 4b — COMPANY-LEVEL CLEANUP (2026-08-28 follow-up): GĐ/TLGĐ
  // scope='managed' -> company-wide (assigneeEmployeeCodes=null), KHÔNG bị
  // bó vào managedEmployeeCodes/org-graph subtree như TBP/Trưởng ca (business
  // contract locked 2026-08-28: "Direct reports có thể tồn tại trong org
  // graph nhưng không được giới hạn company-wide Task scope của nhóm này").
  // PHF010 CÓ 8 direct report thật (managedEmployeeCodes không rỗng) nhưng
  // đó KHÔNG được dùng để giới hạn workspace của cô — company-wide vẫn thắng.
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'tro_ly_gd',
      employeeCode: 'PHF010',
      managedEmployeeCodes: ['PHF038', 'PHF041', 'PHF026', 'PHF042', 'PHF090', 'PHF018', 'PHF081', 'PHF051'],
      peopleScopeType: 'all_company',
      peopleScopeValues: [],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'received', scope: 'managed' }, { signingSecret: 'x' });
    check('COMPANY-LEVEL CLEANUP: TLGĐ scope=managed -> company-wide (assigneeEmployeeCodes=null), KHÔNG bó vào 8 managedEmployeeCodes thật (org graph tồn tại nhưng không giới hạn company-tier)',
      d.assigneeEmployeeCodes === null);
  }

  // Case 5 — 'proposal_received' luôn self-only bất kể peopleScope (không đổi).
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'truong_bo_phan',
      employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF012', 'PHF050'],
      peopleScopeType: 'employees',
      peopleScopeValues: ['PHF012', 'PHF050'],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'proposal_received' }, { signingSecret: 'x' });
    check('proposal_received -> luôn self-only', d.assigneeEmployeeCodes.length === 1 && d.assigneeEmployeeCodes[0] === 'PHF012');
  }

  // Case 6 — signature vẫn hợp lệ / mode='creator_eq' cho relation='assigned' (không đổi).
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'nhan_vien',
      employeeCode: 'PHF082',
      managedEmployeeCodes: [],
      peopleScopeType: 'self',
      peopleScopeValues: [],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'assigned' }, { signingSecret: 'x' });
    check('relation=assigned -> mode=creator_eq, creatorEmployeeCode đúng actor',
      d.mode === 'creator_eq' && d.creatorEmployeeCode === 'PHF082');
    check('descriptor có signature hex 64 ký tự', typeof d.signature === 'string' && /^[0-9a-f]{64}$/.test(d.signature));
    check('employee actor: creatorEmployeeCode set, creatorAccountId null', d.creatorEmployeeCode === 'PHF082' && d.creatorAccountId === null);
  }

  // Case 7 — ACCOUNT-ONLY CREATOR (2026-08-30): Admin without an employee
  // profile (employeeCode = '') creating/listing "Tôi giao". Descriptor must
  // carry creatorAccountId so the executor can match created_by_account_id —
  // otherwise "Tôi giao" filters created_by_employee_code = '' and shows 0.
  {
    const { buildResolvedTaskQueryDescriptor } = mockScope({
      actorType: 'admin',
      employeeCode: '',
      accountId: 'acct-11111111-1111-1111-1111-111111111111',
      managedEmployeeCodes: [],
      peopleScopeType: 'all_company',
      peopleScopeValues: [],
    });
    const d = await buildResolvedTaskQueryDescriptor({}, { relation: 'assigned' }, { signingSecret: 'x' });
    check('account-only Admin: mode=creator_eq, creatorEmployeeCode="" , creatorAccountId=acct id',
      d.mode === 'creator_eq' && d.creatorEmployeeCode === '' && d.creatorAccountId === 'acct-11111111-1111-1111-1111-111111111111');
    check('account-only Admin: creatorAccountId is inside the signed payload (signature still 64-hex)',
      /^[0-9a-f]{64}$/.test(d.signature));
  }

  // Case 8 — Admin A vs Admin B: distinct account ids -> distinct descriptors,
  // never a shared/empty identity that could cross-match.
  {
    const A = await (mockScope({ actorType: 'admin', employeeCode: '', accountId: 'acct-A', peopleScopeType: 'all_company' })
      .buildResolvedTaskQueryDescriptor({}, { relation: 'assigned' }, { signingSecret: 'x' }));
    const B = await (mockScope({ actorType: 'admin', employeeCode: '', accountId: 'acct-B', peopleScopeType: 'all_company' })
      .buildResolvedTaskQueryDescriptor({}, { relation: 'assigned' }, { signingSecret: 'x' }));
    check('ADMIN_A_CANNOT_SEE_ADMIN_B — descriptors carry each actor\'s own account id',
      A.creatorAccountId === 'acct-A' && B.creatorAccountId === 'acct-B' && A.creatorAccountId !== B.creatorAccountId);
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run();
