require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function readData() {
  const [
    { data: settingsRow },
    { data: employees },
    { data: progressRows },
    { data: testResults },
    { data: activityLog }
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    supabase.from('employees').select('*'),
    supabase.from('progress').select('*'),
    supabase.from('test_results').select('*').order('saved_at'),
    supabase.from('activity_log').select('*').order('saved_at')
  ]);

  const settings = settingsRow
    ? { passScore: settingsRow.pass_score, appName: settingsRow.app_name, note: settingsRow.note }
    : { passScore: 80 };

  const employeesMapped = (employees || []).map(e => ({
    id: e.id,
    fullName: e.full_name,
    branch: e.branch,
    position: e.position,
    birthday: e.birthday,
    createdAt: e.created_at,
    lastActiveAt: e.last_active_at
  }));

  const progress = {};
  (progressRows || []).forEach(p => {
    progress[p.employee_id] = {
      currentPage: p.current_page,
      unlockedSteps: p.unlocked_steps || [],
      completedPages: p.completed_pages || [],
      lastUpdatedAt: p.last_updated_at
    };
  });

  const testResultsMapped = (testResults || []).map(t => ({
    id: t.id,
    employeeId: t.employee_id,
    page: t.page,
    score: t.score,
    passScore: t.pass_score,
    status: t.status,
    resultText: t.result_text,
    savedAt: t.saved_at
  }));

  const activityLogMapped = (activityLog || []).map(l => ({
    id: l.id,
    employeeId: l.employee_id,
    type: l.type,
    currentPage: l.current_page,
    savedAt: l.saved_at
  }));

  return { settings, employees: employeesMapped, progress, testResults: testResultsMapped, activityLog: activityLogMapped };
}

async function saveData(payload) {
  const now = new Date().toISOString();
  const employee = payload.employee || {};
  const employeeId = employee.id || 'demo-nv-001';

  await supabase.from('employees').upsert({
    id: employeeId,
    full_name: employee.fullName || employee.name || 'Nhân viên demo PHF',
    branch: employee.branch || employee.store || '',
    position: employee.position || 'Nhân viên bán hàng mới',
    birthday: employee.birthday || '',
    last_active_at: now
  });

  const { data: existing } = await supabase
    .from('progress').select('*').eq('employee_id', employeeId).single();

  await supabase.from('progress').upsert({
    employee_id: employeeId,
    current_page: payload.currentPage || existing?.current_page || 'welcomePage',
    unlocked_steps: Array.from(new Set([...(existing?.unlocked_steps || []), ...(payload.unlockedSteps || [])])),
    completed_pages: Array.from(new Set([...(existing?.completed_pages || []), ...(payload.completedPages || [])])),
    last_updated_at: now
  });

  if (payload.testResult) {
    await supabase.from('test_results').insert({
      id: `test-${Date.now()}`,
      employee_id: employeeId,
      page: payload.testResult.page || '',
      score: payload.testResult.score ?? null,
      pass_score: payload.testResult.passScore || 80,
      status: payload.testResult.status || '',
      result_text: payload.testResult.resultText || '',
      saved_at: now
    });
  }

  await supabase.from('activity_log').insert({
    id: `log-${Date.now()}`,
    employee_id: employeeId,
    type: payload.type || 'autosave',
    current_page: payload.currentPage || '',
    saved_at: now
  });

  return { ok: true, savedAt: now };
}

module.exports = { readData, saveData };
