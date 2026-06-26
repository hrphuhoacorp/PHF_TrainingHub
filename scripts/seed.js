require('dotenv').config();
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

seed().catch(e => {
  console.error('Loi:', e.message);
  process.exit(1);
});
