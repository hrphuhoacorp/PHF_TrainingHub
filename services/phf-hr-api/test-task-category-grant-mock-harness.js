'use strict';

// TEST/MOCK HARNESS cho 7 operation mới của lib/task-write.js (Gate 12 —
// Category CRUD + Exception-grant CRUD). Cùng kỹ thuật fake-pg đã dùng ở
// test-task-write-mock-harness.js. KHÔNG kết nối DB thật.
//
// Chạy: node test-task-category-grant-mock-harness.js

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
  PHF_HR_DB_HOST: 'mock-host-not-real', PHF_HR_DB_PORT: 5432, PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real', PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

const BEGIN = /^BEGIN$/;
const SET_ROLE = /^SET LOCAL ROLE phf_hr_app$/;
const COMMIT = /^COMMIT$/;
const ROLLBACK = /^ROLLBACK$/;

(async () => {
  // =========================================================================
  // createTaskCategory
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^INSERT INTO task\.categories \( category_code, display_name, is_active, created_by_account_id, created_by_employee_code, updated_by_account_id, updated_by_employee_code, updated_at \) VALUES \(\$1, \$2, true, \$3, \$4, \$3, \$4, now\(\)\) RETURNING \*$/,
        result: { rows: [{ category_code: 'DAO_TAO_2', display_name: 'Đào tạo 2', is_active: true }] } },
      { expect: COMMIT, result: {} },
    ]);
    const { createTaskCategory } = loadTaskWriteWithFakePg(client);
    const out = await createTaskCategory(MOCK_CONFIG, { categoryCode: 'dao_tao_2', displayName: 'Đào tạo 2', actorAccountId: 'acct-1', actorEmployeeCode: null });
    record('createTaskCategory_SUCCESS', out.category_code === 'DAO_TAO_2' && client._remainingSteps() === 0, { out });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskCategory(MOCK_CONFIG, { categoryCode: '', displayName: 'x' }); } catch (e) { error = e; }
    record('createTaskCategory_CODE_REQUIRED', error && error.code === 'TASK_CATEGORY_CODE_INVALID' && client.calls.length === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskCategory(MOCK_CONFIG, { categoryCode: 'X', displayName: '' }); } catch (e) { error = e; }
    record('createTaskCategory_NAME_REQUIRED', error && error.code === 'TASK_CATEGORY_NAME_REQUIRED', { code: error && error.code });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^INSERT INTO task\.categories/, error: Object.assign(new Error('duplicate key'), { code: '23505' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { createTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskCategory(MOCK_CONFIG, { categoryCode: 'X', displayName: 'x', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('createTaskCategory_CODE_EXISTS', error && error.code === 'TASK_CATEGORY_CODE_EXISTS' && client._remainingSteps() === 0, { code: error && error.code });
  }

  // =========================================================================
  // renameTaskCategory
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^UPDATE task\.categories SET display_name = \$2, updated_by_account_id = \$3, updated_by_employee_code = \$4, updated_at = now\(\) WHERE category_code = \$1 RETURNING \*$/,
        result: { rows: [{ category_code: 'X', display_name: 'New name' }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { renameTaskCategory } = loadTaskWriteWithFakePg(client);
    const out = await renameTaskCategory(MOCK_CONFIG, { categoryCode: 'x', displayName: 'New name', actorAccountId: 'a' });
    record('renameTaskCategory_SUCCESS', out.display_name === 'New name', { out });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^UPDATE task\.categories SET display_name/, result: { rows: [], rowCount: 0 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { renameTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await renameTaskCategory(MOCK_CONFIG, { categoryCode: 'MISSING', displayName: 'x', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('renameTaskCategory_NOT_FOUND', error && error.code === 'TASK_CATEGORY_NOT_FOUND' && client._remainingSteps() === 0, { code: error && error.code });
  }

  // =========================================================================
  // setTaskCategoryActive
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^UPDATE task\.categories SET is_active = \$2, updated_by_account_id = \$3, updated_by_employee_code = \$4, updated_at = now\(\) WHERE category_code = \$1 RETURNING \*$/,
        result: { rows: [{ category_code: 'X', is_active: false }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { setTaskCategoryActive } = loadTaskWriteWithFakePg(client);
    const out = await setTaskCategoryActive(MOCK_CONFIG, { categoryCode: 'x', isActive: false, actorAccountId: 'a' });
    record('setTaskCategoryActive_SUCCESS', out.is_active === false, { out });
  }
  {
    const client = makeFakeClient([]);
    const { setTaskCategoryActive } = loadTaskWriteWithFakePg(client);
    let error; try { await setTaskCategoryActive(MOCK_CONFIG, { categoryCode: 'x', isActive: 'yes', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('setTaskCategoryActive_INVALID_TYPE', error && error.code === 'TASK_CATEGORY_ACTIVE_INVALID' && client.calls.length === 0, { code: error && error.code });
  }

  // =========================================================================
  // reorderTaskCategory
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^UPDATE task\.categories SET sort_order = \$2, updated_by_account_id = \$3, updated_by_employee_code = \$4, updated_at = now\(\) WHERE category_code = \$1 RETURNING \*$/,
        result: { rows: [{ category_code: 'X', sort_order: 3 }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { reorderTaskCategory } = loadTaskWriteWithFakePg(client);
    const out = await reorderTaskCategory(MOCK_CONFIG, { categoryCode: 'x', sortOrder: 3, actorAccountId: 'a' });
    record('reorderTaskCategory_SUCCESS', out.sort_order === 3, { out });
  }
  {
    const client = makeFakeClient([]);
    const { reorderTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await reorderTaskCategory(MOCK_CONFIG, { categoryCode: 'x', sortOrder: '3abc', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('reorderTaskCategory_INVALID_SORT_STRING', error && error.code === 'TASK_CATEGORY_SORT_ORDER_INVALID' && client.calls.length === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([]);
    const { reorderTaskCategory } = loadTaskWriteWithFakePg(client);
    let error; try { await reorderTaskCategory(MOCK_CONFIG, { categoryCode: 'x', sortOrder: 0, actorAccountId: 'a' }); } catch (e) { error = e; }
    record('reorderTaskCategory_INVALID_SORT_ZERO', error && error.code === 'TASK_CATEGORY_SORT_ORDER_INVALID', { code: error && error.code });
  }

  // =========================================================================
  // deleteTaskCategoryIfUnused
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)$/, result: {} },
      { expect: /^SELECT 1 FROM task\.tasks WHERE category_code = \$1 LIMIT 1$/, result: { rows: [], rowCount: 0 } },
      { expect: /^DELETE FROM task\.categories WHERE category_code = \$1 RETURNING category_code$/, result: { rows: [{ category_code: 'X' }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { deleteTaskCategoryIfUnused } = loadTaskWriteWithFakePg(client);
    const out = await deleteTaskCategoryIfUnused(MOCK_CONFIG, { categoryCode: 'x' });
    const lockCall = client.calls.find((c) => /pg_advisory_xact_lock/.test(c.sql));
    record('deleteTaskCategoryIfUnused_SUCCESS', out.deleted === true && lockCall.params[0] === 'task-category-delete|X', { out, lockParam: lockCall.params });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT pg_advisory_xact_lock/, result: {} },
      { expect: /^SELECT 1 FROM task\.tasks/, result: { rows: [{ '?column?': 1 }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { deleteTaskCategoryIfUnused } = loadTaskWriteWithFakePg(client);
    let error; try { await deleteTaskCategoryIfUnused(MOCK_CONFIG, { categoryCode: 'x' }); } catch (e) { error = e; }
    record('deleteTaskCategoryIfUnused_IN_USE', error && error.code === 'TASK_CATEGORY_IN_USE' && client._remainingSteps() === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT pg_advisory_xact_lock/, result: {} },
      { expect: /^SELECT 1 FROM task\.tasks/, result: { rows: [], rowCount: 0 } },
      { expect: /^DELETE FROM task\.categories/, result: { rows: [], rowCount: 0 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { deleteTaskCategoryIfUnused } = loadTaskWriteWithFakePg(client);
    let error; try { await deleteTaskCategoryIfUnused(MOCK_CONFIG, { categoryCode: 'missing' }); } catch (e) { error = e; }
    record('deleteTaskCategoryIfUnused_NOT_FOUND', error && error.code === 'TASK_CATEGORY_NOT_FOUND' && client._remainingSteps() === 0, { code: error && error.code });
  }

  // =========================================================================
  // createTaskPermissionGrant
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^INSERT INTO task\.permission_grants \( grantee_employee_code, grant_type, people_scope, capabilities, effective_from, effective_to, reason, is_active, created_by_account_id, created_by_employee_code, updated_by_account_id, updated_by_employee_code, updated_at \) VALUES \(\$1, 'extend', \$2::jsonb, '\{\}'::jsonb, now\(\), NULL, \$3, true, \$4, \$5, \$4, \$5, now\(\)\) RETURNING \*$/,
        result: { rows: [{ id: 'g1', grantee_employee_code: 'PHF010', grant_type: 'extend', is_active: true }] } },
      { expect: /^INSERT INTO task\.permission_grant_history \( grant_id, changed_field, old_value, new_value, changed_by_employee_code, changed_by_account_id, reason \) VALUES \(\$1, 'created', NULL, \$2::jsonb, \$3, \$4, \$5\)$/,
        result: { rows: [], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { createTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    const out = await createTaskPermissionGrant(MOCK_CONFIG, {
      granteeEmployeeCode: 'phf010', peopleScope: { type: 'employees', values: ['phf004'] },
      reason: 'test reason', actorAccountId: 'acct-admin', actorEmployeeCode: null,
    });
    const insertCall = client.calls.find((c) => /INSERT INTO task\.permission_grants/.test(c.sql));
    record('createTaskPermissionGrant_SUCCESS',
      out.id === 'g1' && insertCall.params[0] === 'PHF010' && JSON.parse(insertCall.params[1]).values[0] === 'PHF004',
      { out, params: insertCall.params });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskPermissionGrant(MOCK_CONFIG, { granteeEmployeeCode: '', peopleScope: { type: 'all_company' }, reason: 'r', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('createTaskPermissionGrant_GRANTEE_REQUIRED', error && error.code === 'TASK_PERMISSION_GRANT_GRANTEE_REQUIRED' && client.calls.length === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskPermissionGrant(MOCK_CONFIG, { granteeEmployeeCode: 'X', peopleScope: { type: 'employees', values: [] }, reason: 'r', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('createTaskPermissionGrant_SCOPE_EMPTY_VALUES', error && error.code === 'TASK_PERMISSION_GRANT_SCOPE_REQUIRED', { code: error && error.code });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskPermissionGrant(MOCK_CONFIG, { granteeEmployeeCode: 'X', peopleScope: { type: 'all_company' }, reason: '' , actorAccountId: 'a' }); } catch (e) { error = e; }
    record('createTaskPermissionGrant_REASON_REQUIRED', error && error.code === 'TASK_PERMISSION_GRANT_REASON_REQUIRED', { code: error && error.code });
  }
  {
    const client = makeFakeClient([]);
    const { createTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await createTaskPermissionGrant(MOCK_CONFIG, { granteeEmployeeCode: 'X', peopleScope: { type: 'all_company' }, reason: 'r', actorAccountId: null, actorEmployeeCode: null }); } catch (e) { error = e; }
    record('createTaskPermissionGrant_ACTOR_REQUIRED', error && error.code === 'TASK_PERMISSION_GRANT_ACTOR_REQUIRED', { code: error && error.code });
  }

  // =========================================================================
  // revokeTaskPermissionGrant
  // =========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT \* FROM task\.permission_grants WHERE id = \$1 FOR UPDATE$/, result: { rows: [{ id: 'g1', grant_type: 'extend', is_active: true, grantee_employee_code: 'PHF010' }], rowCount: 1 } },
      { expect: /^UPDATE task\.permission_grants SET is_active = false, updated_by_account_id = \$2, updated_by_employee_code = \$3, updated_at = now\(\) WHERE id = \$1 AND is_active = true RETURNING \*$/,
        result: { rows: [{ id: 'g1', grantee_employee_code: 'PHF010', is_active: false }], rowCount: 1 } },
      { expect: /^INSERT INTO task\.permission_grant_history/, result: { rows: [], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const { revokeTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    const out = await revokeTaskPermissionGrant(MOCK_CONFIG, { grantId: 'g1', reason: 'no longer needed', actorAccountId: 'acct-admin' });
    record('revokeTaskPermissionGrant_SUCCESS', out.revoked === true && out.grant_id === 'g1' && client._remainingSteps() === 0, { out });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT \* FROM task\.permission_grants WHERE id = \$1 FOR UPDATE$/, result: { rows: [], rowCount: 0 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { revokeTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await revokeTaskPermissionGrant(MOCK_CONFIG, { grantId: 'missing', reason: 'r', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('revokeTaskPermissionGrant_NOT_FOUND', error && error.code === 'TASK_PERMISSION_GRANT_NOT_FOUND' && client._remainingSteps() === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT \* FROM task\.permission_grants WHERE id = \$1 FOR UPDATE$/, result: { rows: [{ id: 'g1', grant_type: 'restrict', is_active: true }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { revokeTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await revokeTaskPermissionGrant(MOCK_CONFIG, { grantId: 'g1', reason: 'r', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('revokeTaskPermissionGrant_TYPE_NOT_SUPPORTED', error && error.code === 'TASK_PERMISSION_REVOKE_TYPE_NOT_SUPPORTED' && client._remainingSteps() === 0, { code: error && error.code });
  }
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: /^SELECT \* FROM task\.permission_grants WHERE id = \$1 FOR UPDATE$/, result: { rows: [{ id: 'g1', grant_type: 'extend', is_active: false }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const { revokeTaskPermissionGrant } = loadTaskWriteWithFakePg(client);
    let error; try { await revokeTaskPermissionGrant(MOCK_CONFIG, { grantId: 'g1', reason: 'r', actorAccountId: 'a' }); } catch (e) { error = e; }
    record('revokeTaskPermissionGrant_ALREADY_REVOKED', error && error.code === 'TASK_PERMISSION_GRANT_ALREADY_REVOKED' && client._remainingSteps() === 0, { code: error && error.code });
  }

  const allPass = results.every((r) => r.pass);
  console.log('OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
})();
