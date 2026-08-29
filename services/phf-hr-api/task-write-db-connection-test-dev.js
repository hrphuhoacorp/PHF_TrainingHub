'use strict';

// PHF HR — DB smoke test, READ-ONLY, 2 tầng. Chạy tay bởi deployer trên môi
// trường có services/phf-hr-api/.env thật (server, hoặc local dev nếu có
// .env riêng) — KHÔNG tự động chạy trong CI/boot. KHÔNG INSERT/UPDATE/DELETE
// ở bất kỳ đâu trong file này.
//
// SERVER-ADAPTED COPY — chỉ khác bản gốc
// (scripts/task-write-db-connection-test-dev.js trong repo monorepo local)
// ở đúng 2 dòng require path, để khớp layout deploy standalone trên server
// (phf-hr-api là root tại /opt/phf-hr/phf-hr-api, không có prefix
// services/phf-hr-api/...). Logic test KHÔNG đổi.
//
// Vị trí dự kiến trên server: /opt/phf-hr/phf-hr-api/task-write-db-connection-test-dev.js
//
// Cách chạy (trên server, từ root phf-hr-api):
//   cd /opt/phf-hr/phf-hr-api && node task-write-db-connection-test-dev.js
//
// Exit code 0 = cả 2 tầng PASS đúng kỳ vọng. Exit code 1 = có sai lệch, in
// rõ phase nào sai — KHÔNG tự "fix" hay retry, chỉ báo cáo.

const { loadConfig } = require('./lib/config');
const { testConnection, testTaskRoleBoundary } = require('./lib/db');

function fail(label, detail) {
  console.error(`FAIL ${label}`, detail || '');
  process.exitCode = 1;
}

function pass(label, detail) {
  console.log(`PASS ${label}`, detail || '');
}

(async () => {
  const config = loadConfig();
  if (!config.ok) {
    console.error('CONFIG_INVALID', config.errors);
    process.exit(1);
  }
  console.log('CONFIG_SUMMARY', config.summary);

  // ---- Tier 1: connectivity/auth only ----
  try {
    const conn = await testConnection(config);
    if (conn.ok === true) {
      pass('TIER1_CONNECTION', conn);
    } else {
      fail('TIER1_CONNECTION', conn);
    }
  } catch (err) {
    fail('TIER1_CONNECTION_THREW', err.message);
    process.exit(1);
  }

  // ---- Tier 2: role boundary proof ----
  let phases;
  try {
    phases = await testTaskRoleBoundary(config);
  } catch (err) {
    fail('TIER2_ROLE_BOUNDARY_THREW', { message: err.message, phases: err.phases });
    process.exit(1);
  }

  const checks = [
    {
      label: 'BEFORE_current_user_eq_runtime',
      ok: phases.beforeSetRole.current_user === 'phf_hr_runtime' && phases.beforeSetRole.session_user === 'phf_hr_runtime',
      detail: phases.beforeSetRole,
    },
    {
      label: 'DURING_current_user_eq_phf_hr_app_session_user_eq_runtime',
      ok: phases.duringSetRole.current_user === 'phf_hr_app' && phases.duringSetRole.session_user === 'phf_hr_runtime',
      detail: phases.duringSetRole,
    },
    {
      label: 'DURING_select_task_tasks_succeeded',
      ok: phases.duringSelectSucceeded === true,
      detail: { rowCount: phases.duringSelectRowCount },
    },
    {
      label: 'AFTER_ROLLBACK_current_user_eq_runtime',
      ok: phases.afterRollback.current_user === 'phf_hr_runtime' && phases.afterRollback.session_user === 'phf_hr_runtime',
      detail: phases.afterRollback,
    },
  ];

  for (const check of checks) {
    if (check.ok) {
      pass(`TIER2_${check.label}`, check.detail);
    } else {
      fail(`TIER2_${check.label}`, check.detail);
    }
  }

  if (process.exitCode === 1) {
    console.error('SMOKE_TEST_RESULT = FAIL — xem chi tiết phase phía trên. KHÔNG tiến hành Batch 1 write-path.');
  } else {
    console.log('SMOKE_TEST_RESULT = PASS');
  }
  process.exit(process.exitCode || 0);
})();
