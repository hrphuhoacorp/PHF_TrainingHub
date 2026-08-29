'use strict';

/*
 * PHF Task — TASK_CREATE_CATEGORY_SUPABASE_DEPENDENCY fix — mock/unit suite.
 *
 * MOCK TEST — KHÔNG PHẢI OFFICIAL DATA VERIFICATION. Supabase + task-read-bridge
 * + task-employee-scope + task-permissions bị thay bằng in-memory stub qua
 * require.cache. Zero DB thật, zero network.
 *
 * Chứng minh:
 *   NORMAL_TASK_CATEGORY_POSTGRESQL_VALIDATION — createTaskDraftViaServer
 *     validate category qua bridgeListTaskCategories() (PostgreSQL task.categories).
 *   VIA_SERVER_NO_SUPABASE_TASK_CATEGORY_READ — đường ViaServer KHÔNG chạm
 *     supabase.from('task_categories') (stub ném lỗi nếu bị gọi).
 *   LEGACY_FLAG_OFF_BEHAVIOR_PRESERVED — resolveAndValidateCreateDraftInput()
 *     KHÔNG có opts vẫn dùng categoryActive() (Supabase) y như trước.
 */

process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const supabasePath = require.resolve('@supabase/supabase-js');
const employeeMasterPath = require.resolve(path.join(ROOT, 'api', '_lib', 'employee-master'));
const authPath = require.resolve(path.join(ROOT, 'api', '_lib', 'auth'));
const scopePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-employee-scope'));
const permissionsPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-permissions'));
const readBridgePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-read-bridge'));
const writeBridgePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-write-bridge'));
const corePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-core'));
const integrationPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-server-integration'));

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) { PASS += 1; } else { FAIL += 1; console.error('FAIL:', name); } }
async function throwsCode(factory, code, name) {
  try { await factory(); } catch (err) {
    check(name + ' (code=' + code + ')', err && err.code === code);
    return;
  }
  check(name + ' — did not throw', false);
}

// --- supabase stub: task_categories = tracked; bất kỳ read nào cũng ghi lại.
const supabaseCategoryReads = [];
let CATEGORY_ROWS = [];
function makeCategoryQuery() {
  let wantedCode = null;
  const builder = {
    select() { return builder; },
    eq(field, value) { if (field === 'category_code') wantedCode = String(value); return builder; },
    maybeSingle() {
      supabaseCategoryReads.push(wantedCode);
      const row = CATEGORY_ROWS.find((c) => c.category_code === wantedCode) || null;
      return Promise.resolve({ data: row, error: null });
    },
  };
  return builder;
}

function installMocks({ failIfSupabaseCategoryRead }) {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  [supabasePath, employeeMasterPath, authPath, scopePath, permissionsPath, readBridgePath, writeBridgePath, corePath, integrationPath]
    .forEach((p) => { delete require.cache[p]; });

  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      createClient() {
        return {
          from(table) {
            if (table === 'task_categories') {
              if (failIfSupabaseCategoryRead) {
                throw new Error('VIA_SERVER_NO_SUPABASE_TASK_CATEGORY_READ VIOLATED: supabase.from("task_categories") đã bị gọi trên đường ViaServer.');
              }
              return makeCategoryQuery();
            }
            throw new Error('Unexpected supabase table in this suite: ' + table);
          },
          rpc() { return Promise.resolve({ data: null, error: null }); },
        };
      },
    },
  };

  // task-employee-scope — chỉ cần resolveActorContext + loadOrgRows.
  require.cache[scopePath] = {
    id: scopePath, filename: scopePath, loaded: true,
    exports: {
      resolveActorContext: async () => ({ employeeCode: 'PHF010', accountId: null }),
      loadOrgRows: async () => [],
      resolveActorContextForRecord: async () => ({ employeeCode: 'PHF010', accountId: null }),
    },
  };

  // task-permissions — canAssignTaskTo dùng cho primaryEmployeeCode (không
  // dùng trong các case này vì không truyền primary). Trả stub an toàn.
  require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true,
    exports: {
      canAssignTaskTo: async () => true,
      canAddTaskRelated: async () => true,
      resolveTaskViewerAuthority: async () => ({}),
      canProposeTo: async () => true,
      listProposalRecipientEmployees: async () => ({ employees: [] }),
    },
  };

  // task-read-bridge — bridgeListTaskCategories trả nguồn "PostgreSQL" giả.
  const bridgeCategoryCalls = [];
  require.cache[readBridgePath] = {
    id: readBridgePath, filename: readBridgePath, loaded: true,
    exports: {
      bridgeListTaskCategories: async () => {
        bridgeCategoryCalls.push(Date.now());
        return {
          categories: [
            { category_code: 'KINH_DOANH', is_active: true },
            { category_code: 'BAO_CAO', is_active: true },
            { category_code: 'CU_KY', is_active: false },
          ],
        };
      },
      bridgeGetTaskDetail: async () => ({}),
      bridgeListTasks: async () => ({ tasks: [] }),
    },
  };

  const bridgeCreateCalls = [];
  require.cache[writeBridgePath] = {
    id: writeBridgePath, filename: writeBridgePath, loaded: true,
    exports: new Proxy({
      bridgeCreateDraftTask: async (params) => { bridgeCreateCalls.push(params); return { id: 'draft-1', row_version: 1, status: 'draft' }; },
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        // mọi bridge* khác: no-op async
        return async () => ({});
      },
    }),
  };

  const core = require(corePath);
  const integration = require(integrationPath);
  Module._resolveFilename = originalResolve;
  return { core, integration, bridgeCategoryCalls, bridgeCreateCalls };
}

(async () => {
  const session = { account: { employeeCode: 'PHF010' }, employeeCode: 'PHF010' };
  const baseInput = {
    flowType: 'giao_viec', title: 'Test seam', content: 'x',
    priority: 'thuong', deadline: '2026-09-30T00:00:00Z',
  };

  // =====================================================================
  // GROUP A — LEGACY path (no opts) vẫn dùng categoryActive() Supabase.
  // =====================================================================
  {
    supabaseCategoryReads.length = 0;
    CATEGORY_ROWS = [
      { category_code: 'KINH_DOANH', is_active: true },
      { category_code: 'CU_KY', is_active: false },
    ];
    const { core } = installMocks({ failIfSupabaseCategoryRead: false });

    const v = await core.resolveAndValidateCreateDraftInput(session, Object.assign({}, baseInput, { categoryCode: 'KINH_DOANH' }));
    check('LEGACY: resolveAndValidateCreateDraftInput không opts → PASS với category active', v.categoryCode === 'KINH_DOANH');
    check('LEGACY: categoryActive() Supabase ĐÃ được gọi (task_categories read)', supabaseCategoryReads.includes('KINH_DOANH'));

    await throwsCode(
      () => core.resolveAndValidateCreateDraftInput(session, Object.assign({}, baseInput, { categoryCode: 'CU_KY' })),
      'TASK_CATEGORY_INACTIVE',
      'LEGACY: category inactive → TASK_CATEGORY_INACTIVE (mã lỗi Legacy giữ nguyên)'
    );
    await throwsCode(
      () => core.resolveAndValidateCreateDraftInput(session, Object.assign({}, baseInput, { categoryCode: 'KHONG_CO' })),
      'TASK_CATEGORY_NOT_FOUND',
      'LEGACY: category không tồn tại → TASK_CATEGORY_NOT_FOUND'
    );
  }

  // =====================================================================
  // GROUP B — injected validator: categoryActive() Supabase KHÔNG được gọi.
  // =====================================================================
  {
    supabaseCategoryReads.length = 0;
    const { core } = installMocks({ failIfSupabaseCategoryRead: true });
    const injectedCalls = [];
    const opts = { validateCategory: async (c) => { injectedCalls.push(c); } };

    const v = await core.resolveAndValidateCreateDraftInput(session, Object.assign({}, baseInput, { categoryCode: 'KINH_DOANH' }), opts);
    check('INJECT: validator được gọi đúng 1 lần với category code đã chuẩn hoá', injectedCalls.length === 1 && injectedCalls[0] === 'KINH_DOANH');
    check('INJECT: KHÔNG đọc supabase task_categories', supabaseCategoryReads.length === 0);
    check('INJECT: kết quả validate vẫn đầy đủ field', v.categoryCode === 'KINH_DOANH' && v.title === 'Test seam');

    const boom = Object.assign(new Error('nope'), { code: 'TASK_CATEGORY_NOT_FOUND', statusCode: 400 });
    await throwsCode(
      () => core.resolveAndValidateCreateDraftInput(session, Object.assign({}, baseInput, { categoryCode: 'KINH_DOANH' }), { validateCategory: async () => { throw boom; } }),
      'TASK_CATEGORY_NOT_FOUND',
      'INJECT: lỗi từ validator được propagate nguyên vẹn'
    );
  }

  // =====================================================================
  // GROUP C — createTaskDraftViaServer end-to-end: PostgreSQL category
  // validation, zero Supabase task_categories.
  // =====================================================================
  {
    supabaseCategoryReads.length = 0;
    const { integration, bridgeCategoryCalls, bridgeCreateCalls } = installMocks({ failIfSupabaseCategoryRead: true });

    const draft = await integration.createTaskDraftViaServer(session, Object.assign({}, baseInput, { categoryCode: 'KINH_DOANH' }));
    check('VIASERVER: tạo draft PASS với category active từ nguồn PostgreSQL', draft && draft.id === 'draft-1');
    check('VIASERVER: bridgeListTaskCategories() (PostgreSQL) đã được gọi', bridgeCategoryCalls.length >= 1);
    check('VIASERVER: KHÔNG đọc supabase task_categories', supabaseCategoryReads.length === 0);
    check('VIASERVER: bridgeCreateDraftTask nhận đúng categoryCode', bridgeCreateCalls.length === 1 && bridgeCreateCalls[0].categoryCode === 'KINH_DOANH');

    await throwsCode(
      () => integration.createTaskDraftViaServer(session, Object.assign({}, baseInput, { categoryCode: 'KHONG_CO_TRONG_PG' })),
      'TASK_CATEGORY_NOT_FOUND',
      'VIASERVER: category không có trong task.categories → TASK_CATEGORY_NOT_FOUND'
    );
    await throwsCode(
      () => integration.createTaskDraftViaServer(session, Object.assign({}, baseInput, { categoryCode: 'CU_KY' })),
      'TASK_CATEGORY_NOT_FOUND',
      'VIASERVER: category inactive trong task.categories → bị từ chối (business rule giữ nguyên, gộp mã NOT_FOUND)'
    );
    check('VIASERVER: sau 2 lần fail vẫn KHÔNG chạm supabase task_categories', supabaseCategoryReads.length === 0);
  }

  console.log('\n' + PASS + '/' + (PASS + FAIL) + ' PASS');
  process.exit(FAIL > 0 ? 1 : 0);
})().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
