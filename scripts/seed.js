require('dotenv').config();
const { assertSandboxTargetOrFailClosed } = require('../api/_lib/env-identity-guard');

// PHF ENV HARD GATE (Phase 2A) — scripts/seed.js upsert KHÔNG điều kiện
// vào settings/employees/progress/test_results/activity_log. Trước đây
// dùng thẳng SUPABASE_URL từ .env (mặc định = PHF_HR_MAIN) mà KHÔNG có
// bất kỳ guard nào — script này giờ CHỈ được phép chạy khi SUPABASE_URL
// trỏ đúng PHF_HR_SANDBOX. In project identity + fail-closed TRƯỚC khi
// bất kỳ createClient()/DB operation nào xảy ra (xem
// api/_lib/env-identity-guard.js::assertSandboxTargetOrFailClosed).
assertSandboxTargetOrFailClosed('(scripts/seed.js)');

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function seed() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data.json'), 'utf8'));

  // 1. Settings
  const { error: e1 } = await supabase.from('settings').upsert({
    id: 1,
    pass_score: data.settings.passScore,
    app_name: data.settings.appName,
    note: data.settings.note
  });
  if (e1) throw new Error('settings: ' + e1.message);
  console.log('settings OK');

  // 2. Employees
  const employees = data.employees.map(e => ({
    id: e.id,
    full_name: e.fullName,
    branch: e.branch || '',
    position: e.position || '',
    birthday: e.birthday || '',
    created_at: e.createdAt || null,
    last_active_at: e.lastActiveAt || null
  }));
  const { error: e2 } = await supabase.from('employees').upsert(employees);
  if (e2) throw new Error('employees: ' + e2.message);
  console.log(`employees OK (${employees.length} rows)`);

  // 3. Progress
  const progressRows = Object.entries(data.progress).map(([employeeId, p]) => ({
    employee_id: employeeId,
    current_page: p.currentPage || '',
    unlocked_steps: p.unlockedSteps || [],
    completed_pages: p.completedPages || [],
    last_updated_at: p.lastUpdatedAt || null
  }));
  const { error: e3 } = await supabase.from('progress').upsert(progressRows);
  if (e3) throw new Error('progress: ' + e3.message);
  console.log(`progress OK (${progressRows.length} rows)`);

  // 4. Test Results
  if (data.testResults.length > 0) {
    const testResults = data.testResults.map(t => ({
      id: t.id,
      employee_id: t.employeeId,
      page: t.page || '',
      score: t.score ?? null,
      pass_score: t.passScore || 80,
      status: t.status || '',
      result_text: t.resultText || '',
      saved_at: t.savedAt || null
    }));
    const { error: e4 } = await supabase.from('test_results').upsert(testResults);
    if (e4) throw new Error('test_results: ' + e4.message);
    console.log(`test_results OK (${testResults.length} rows)`);
  } else {
    console.log('test_results OK (trong)');
  }

  // 5. Activity Log
  if (data.activityLog.length > 0) {
    const logs = data.activityLog.map(l => ({
      id: l.id,
      employee_id: l.employeeId,
      type: l.type || '',
      current_page: l.currentPage || '',
      saved_at: l.savedAt || null
    }));
    const { error: e5 } = await supabase.from('activity_log').upsert(logs);
    if (e5) throw new Error('activity_log: ' + e5.message);
    console.log(`activity_log OK (${logs.length} rows)`);
  }

  console.log('\nXong! Tat ca du lieu da duoc day len Supabase.');
}

// Chỉ tự chạy khi được gọi trực tiếp (`node scripts/seed.js`) — KHÔNG đổi
// hành vi khi chạy như trước, chỉ cho phép require() file này an toàn cho
// mục đích test guard (scripts/test-env-write-scripts-sandbox-guard-v1.js)
// mà không kích hoạt seed() thật.
if (require.main === module) {
  seed().catch(e => {
    console.error('Loi:', e.message);
    process.exit(1);
  });
}

module.exports = { seed };
