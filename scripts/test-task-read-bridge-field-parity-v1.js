'use strict';

// Regression test cho fix 2026-08-27: api/_lib/task-read-bridge.js::bridgeListTasks()
// trước đây hardcode category_code/progress_percent/progress_status = null vì
// phf-hr-api chưa SELECT các cột này. Nay phf-hr-api (task-query-executor.js)
// đã SELECT đủ (xem services/phf-hr-api/test-task-query-executor-mock-harness.js)
// và bridge phải map thẳng giá trị thật thay vì hardcode null.
//
// Mock-only: KHÔNG network thật (global.fetch bị thay bằng fake), KHÔNG DB thật
// (task-employee-scope.js/task-query-descriptor-builder.js/task-permissions.js
// bị mock qua require.cache).

const assert = require('assert');

const bridgePath = require.resolve('../api/_lib/task-read-bridge');
const descriptorBuilderPath = require.resolve('../api/_lib/task-query-descriptor-builder');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');

let PASS = 0, FAIL = 0;
function check(name, cond) {
  if (cond) { PASS++; } else { FAIL++; console.error('FAIL:', name); }
}

function setup({ fetchResponseBody }) {
  delete require.cache[bridgePath];
  delete require.cache[descriptorBuilderPath];
  delete require.cache[employeeScopePath];

  require.cache[descriptorBuilderPath] = {
    id: descriptorBuilderPath, filename: descriptorBuilderPath, loaded: true,
    exports: {
      buildResolvedTaskQueryDescriptor: async () => ({
        signature: 'fake', mode: 'creator_eq', statusFilter: 'all',
      }),
    },
  };
  require.cache[employeeScopePath] = {
    id: employeeScopePath, filename: employeeScopePath, loaded: true,
    exports: {
      loadOrgRows: async () => ([
        { employeeCode: 'PHF082', fullName: 'Nguyen Van A', department: 'Kinh doanh' },
      ]),
    },
  };

  process.env.PHF_HR_API_BASE_URL = 'https://fake-hr-api.internal';
  process.env.PHF_HR_API_SERVICE_TOKEN = 'fake-token';
  process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET = 'fake-secret';

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => fetchResponseBody,
  });

  const bridge = require(bridgePath);
  return { bridge, restore: () => { global.fetch = originalFetch; } };
}

async function run() {
  const { bridge, restore } = setup({
    fetchResponseBody: {
      data: [{
        id: 't1', taskCode: 'CV-2608-0099', title: 'Test', flowType: 'giao_viec',
        status: 'in_progress', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
        categoryCode: 'NHAN_SU', progressPercent: 40, progressStatus: 'on_track',
        isCrossDepartment: false, sourceDepartment: null, targetDepartment: null,
        createdByEmployeeCode: 'PHF082', primaryEmployeeCode: 'PHF082', rowVersion: 1,
      }],
      relation: 'assigned', scope: 'default', viewScopeType: 'self',
      requesterActorType: 'nhan_vien', offset: 0, limit: 50, hasMore: false,
    },
  });

  try {
    const result = await bridge.bridgeListTasks({}, { relation: 'assigned' });
    check('category_code map đúng giá trị thật (không còn hardcode null)',
      result.tasks[0].category_code === 'NHAN_SU');
    check('progress_percent map đúng giá trị thật', result.tasks[0].progress_percent === 40);
    check('progress_status map đúng giá trị thật', result.tasks[0].progress_status === 'on_track');
    check('full_name/department vẫn enrich cục bộ qua loadOrgRows (không regression)',
      result.tasks[0].primary && result.tasks[0].primary.full_name === 'Nguyen Van A');
  } finally {
    restore();
  }

  // Case 2 — server trả null tường minh cho category/progress (task chưa có
  // category hoặc chưa publish) -> bridge PHẢI giữ null, KHÔNG suy đoán giá trị khác.
  const { bridge: bridge2, restore: restore2 } = setup({
    fetchResponseBody: {
      data: [{
        id: 't2', taskCode: 'CV-2608-0100', title: 'Test2', flowType: 'giao_viec',
        status: 'draft', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
        categoryCode: null, progressPercent: null, progressStatus: null,
        isCrossDepartment: null, sourceDepartment: null, targetDepartment: null,
        createdByEmployeeCode: 'PHF082', primaryEmployeeCode: null, rowVersion: 1,
      }],
      relation: 'assigned', scope: 'default', viewScopeType: 'self',
      requesterActorType: 'nhan_vien', offset: 0, limit: 50, hasMore: false,
    },
  });
  try {
    const result2 = await bridge2.bridgeListTasks({}, { relation: 'assigned' });
    check('category_code null thật từ server vẫn giữ null (không fabricate)',
      result2.tasks[0].category_code === null);
    check('progress_percent null thật từ server vẫn giữ null',
      result2.tasks[0].progress_percent === null);
  } finally {
    restore2();
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run();
