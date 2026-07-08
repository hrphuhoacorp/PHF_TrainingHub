require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let supabase = null;

if (hasSupabaseEnv) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );
} else {
  console.log('PHF Training Hub: chưa có SUPABASE_URL / SUPABASE_SECRET_KEY, tạm dùng data.json để chạy local.');
}

function readDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      settings: { passScore: 80, appName: 'PHF Training Hub', note: '' },
      employees: [],
      progress: {},
      testResults: [],
      activityLog: [],
      evaluationRecords: [],
      confidentialityCommitments: []
    };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeDataFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function isMeaningfulProgressPage(page) {
  const p = String(page || '').trim();
  if (!p) return false;
  if (/^lesson:(\d+)$/i.test(p)) {
    const n = Number(p.split(':')[1]);
    return Number.isFinite(n) && n >= 2;
  }
  // Không cho các màn chào mừng/thông tin ghi đè trang đang học thật.
  if (/welcomePage|infoPage|Trước khi học|Chào mừng/i.test(p)) return false;
  return true;
}

function chooseCurrentPage(incoming, existing) {
  const oldPage = existing || 'welcomePage';
  if (isMeaningfulProgressPage(incoming)) return incoming;
  if (isMeaningfulProgressPage(oldPage)) return oldPage;
  return incoming || oldPage;
}

async function readDataFromFile() {
  return readDataFile();
}

async function saveDataToFile(payload) {
  const now = new Date().toISOString();
  const data = readDataFile();

  data.settings = data.settings || { passScore: 80, appName: 'PHF Training Hub', note: '' };
  data.employees = Array.isArray(data.employees) ? data.employees : [];
  data.progress = data.progress || {};
  data.testResults = Array.isArray(data.testResults) ? data.testResults : [];
  data.activityLog = Array.isArray(data.activityLog) ? data.activityLog : [];
  data.evaluationRecords = Array.isArray(data.evaluationRecords) ? data.evaluationRecords : [];
  data.confidentialityCommitments = Array.isArray(data.confidentialityCommitments) ? data.confidentialityCommitments : [];

  const employee = payload.employee || {};
  const employeeId = employee.id || 'demo-nv-001';

  const employeeRecord = {
    id: employeeId,
    fullName: employee.fullName || employee.name || 'Nhân viên demo PHF',
    branch: employee.branch || employee.store || '',
    position: employee.position || 'Nhân viên bán hàng mới',
    birthday: employee.birthday || '',
    phone: employee.phone || '',
    department: employee.department || '',
    studyStartDate: employee.studyStartDate || employee.study_start_date || '',
    programId: employee.programId || 'new_sales',
    createdAt: employee.createdAt || now,
    lastActiveAt: now
  };

  const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
  if (employeeIndex >= 0) {
    data.employees[employeeIndex] = { ...data.employees[employeeIndex], ...employeeRecord };
  } else {
    data.employees.push(employeeRecord);
  }

  const existingProgress = data.progress[employeeId] || {};
  if (!payload.skipProgress) {
    data.progress[employeeId] = {
      currentPage: chooseCurrentPage(payload.currentPage, existingProgress.currentPage),
      unlockedSteps: Array.from(new Set([...(existingProgress.unlockedSteps || []), ...(payload.unlockedSteps || [])])),
      completedPages: Array.from(new Set([...(existingProgress.completedPages || []), ...(payload.completedPages || [])])),
      lastUpdatedAt: now
    };
  }

  if (payload.testResult) {
    data.testResults.push({
      id: `test-${Date.now()}`,
      employeeId,
      page: payload.testResult.page || '',
      score: payload.testResult.score ?? null,
      passScore: payload.testResult.passScore || data.settings.passScore || 80,
      status: payload.testResult.status || '',
      resultText: payload.testResult.resultText || '',
      savedAt: now
    });
  }

  if (payload.evaluationRecord) {
    if (!payload.adminMode && !payload.managerMode) {
      throw new Error('Chỉ tài khoản quản lý/HCNS được tạo hoặc sửa phiếu đánh giá.');
    }
    const r = payload.evaluationRecord;
    const record = {
      id: r.id || `eval-${Date.now()}`,
      employeeId,
      formType: r.formType || 'weekly',
      periodKey: r.periodKey || '',
      periodLabel: r.periodLabel || '',
      periodStart: r.periodStart || '',
      periodEnd: r.periodEnd || '',
      evaluator: r.evaluator || '',
      statusItems: r.statusItems || {},
      notes: r.notes || '',
      issues: r.issues || '',
      nextFocus: r.nextFocus || '',
      conclusion: r.conclusion || '',
      savedAt: now,
      updatedAt: now
    };
    const idx = data.evaluationRecords.findIndex(x => x.id === record.id);
    if (idx >= 0) data.evaluationRecords[idx] = { ...data.evaluationRecords[idx], ...record };
    else data.evaluationRecords.push(record);
  }

  if (payload.confidentialityCommitment) {
    const r = payload.confidentialityCommitment;
    const record = {
      id: r.id || `bmtt-${Date.now()}`,
      employeeId,
      documentVersion: r.documentVersion || 'PHF-BMTT-2026-06-06',
      fullName: r.fullName || '',
      birthday: r.birthday || '',
      cccd: r.cccd || '',
      cccdDate: r.cccdDate || '',
      cccdPlace: r.cccdPlace || '',
      phone: r.phone || '',
      position: r.position || '',
      branch: r.branch || '',
      signName: r.signName || '',
      signPhone: r.signPhone || '',
      confirmDate: r.confirmDate || '',
      checkedCount: r.checkedCount || 0,
      requiredCheckCount: r.requiredCheckCount || 0,
      signedAt: r.signedAt || now,
      savedAt: now
    };
    const idx = data.confidentialityCommitments.findIndex(x => x.employeeId === employeeId && x.documentVersion === record.documentVersion);
    if (idx >= 0) data.confidentialityCommitments[idx] = { ...data.confidentialityCommitments[idx], ...record };
    else data.confidentialityCommitments.push(record);
  }

  data.activityLog.push({
    id: `log-${Date.now()}`,
    employeeId,
    type: payload.type || 'autosave',
    currentPage: payload.currentPage || '',
    savedAt: now
  });

  writeDataFile(data);
  return { ok: true, savedAt: now, data };
}

async function readDataFromSupabase() {
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
    phone: e.phone || '',
    department: e.department || '',
    studyStartDate: e.study_start_date || e.studyStartDate || '',
    programId: e.program_id || 'new_sales',
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

  // Nếu progress.current_page từng bị ghi đè về màn thông tin, dùng activity_log mới nhất
  // có dạng lesson:N để mở lại đúng bài học hơn.
  (activityLog || []).forEach(l => {
    if (!l || !l.employee_id || !isMeaningfulProgressPage(l.current_page)) return;
    const existingProgress = progress[l.employee_id] || { unlockedSteps: [], completedPages: [] };
    if (!isMeaningfulProgressPage(existingProgress.currentPage) || new Date(l.saved_at || 0) >= new Date(existingProgress.lastUpdatedAt || 0)) {
      progress[l.employee_id] = {
        ...existingProgress,
        currentPage: l.current_page,
        lastUpdatedAt: l.saved_at || existingProgress.lastUpdatedAt
      };
    }
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

  let evaluationRecordsMapped = [];
  try {
    const { data: evaluationRecords, error: evalError } = await supabase
      .from('evaluation_records')
      .select('*')
      .order('updated_at');

    if (!evalError) {
      evaluationRecordsMapped = (evaluationRecords || []).map(r => ({
        id: r.id,
        employeeId: r.employee_id,
        formType: r.form_type,
        periodKey: r.period_key,
        periodLabel: r.period_label,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        evaluator: r.evaluator,
        statusItems: r.status_items || {},
        notes: r.notes || '',
        issues: r.issues || '',
        nextFocus: r.next_focus || '',
        conclusion: r.conclusion || '',
        savedAt: r.created_at,
        updatedAt: r.updated_at
      }));
    }
  } catch (err) {
    console.warn('PHF evaluation_records chưa sẵn sàng:', err.message);
  }

  const confidentialityCommitmentsMapped = activityLogMapped
    .filter(l => l && l.type === 'confidentiality-commitment')
    .map(l => {
      try {
        const parsed = JSON.parse(l.currentPage || '{}');
        return { ...parsed, employeeId: l.employeeId, savedAt: l.savedAt };
      } catch (e) {
        return { employeeId: l.employeeId, savedAt: l.savedAt, raw: l.currentPage || '' };
      }
    });

  return { settings, employees: employeesMapped, progress, testResults: testResultsMapped, activityLog: activityLogMapped, evaluationRecords: evaluationRecordsMapped, confidentialityCommitments: confidentialityCommitmentsMapped };
}

async function saveDataToSupabase(payload) {
  const now = new Date().toISOString();
  const employee = payload.employee || {};
  const employeeId = employee.id || 'demo-nv-001';

  const employeeBase = {
    id: employeeId,
    full_name: employee.fullName || employee.name || 'Nhân viên demo PHF',
    branch: employee.branch || employee.store || '',
    position: employee.position || 'Nhân viên bán hàng mới',
    birthday: employee.birthday || '',
    created_at: employee.createdAt || now,
    last_active_at: now
  };

  const employeeExtended = {
    ...employeeBase,
    phone: employee.phone || '',
    department: employee.department || '',
    study_start_date: employee.studyStartDate || employee.study_start_date || '',
    program_id: employee.programId || 'new_sales'
  };

  // Ưu tiên lưu đủ thông tin thật. Nếu database chưa được nâng cột,
  // fallback về schema cũ để web không bị gãy; chạy file SQL cập nhật để lưu đủ SĐT/ngày học.
  let employeeSave = await supabase.from('employees').upsert(employeeExtended);
  if (employeeSave.error && /column|schema cache|could not find|study_start_date|department|phone|program_id/i.test(employeeSave.error.message || '')) {
    console.warn('PHF employees schema chưa có cột mở rộng, tạm lưu schema cũ:', employeeSave.error.message);
    employeeSave = await supabase.from('employees').upsert(employeeBase);
  }

  if (employeeSave.error) throw employeeSave.error;

  const { data: existing } = await supabase
    .from('progress').select('*').eq('employee_id', employeeId).single();

  if (!payload.skipProgress) {
    await supabase.from('progress').upsert({
      employee_id: employeeId,
      current_page: chooseCurrentPage(payload.currentPage, existing?.current_page),
      unlocked_steps: Array.from(new Set([...(existing?.unlocked_steps || []), ...(payload.unlockedSteps || [])])),
      completed_pages: Array.from(new Set([...(existing?.completed_pages || []), ...(payload.completedPages || [])])),
      last_updated_at: now
    });
  }

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

  if (payload.evaluationRecord) {
    if (!payload.adminMode && !payload.managerMode) {
      throw new Error('Chỉ tài khoản quản lý/HCNS được tạo hoặc sửa phiếu đánh giá.');
    }
    const r = payload.evaluationRecord;
    const evalSave = await supabase.from('evaluation_records').upsert({
      id: r.id || `eval-${Date.now()}`,
      employee_id: employeeId,
      form_type: r.formType || 'weekly',
      period_key: r.periodKey || '',
      period_label: r.periodLabel || '',
      period_start: r.periodStart || '',
      period_end: r.periodEnd || '',
      evaluator: r.evaluator || '',
      status_items: r.statusItems || {},
      notes: r.notes || '',
      issues: r.issues || '',
      next_focus: r.nextFocus || '',
      conclusion: r.conclusion || '',
      updated_at: now
    });
    if (evalSave.error) throw evalSave.error;
  }

  const activityPayload = {
    id: `log-${Date.now()}`,
    employee_id: employeeId,
    type: payload.type || 'autosave',
    current_page: payload.currentPage || '',
    saved_at: now
  };

  if (payload.confidentialityCommitment) {
    const r = payload.confidentialityCommitment;
    activityPayload.type = 'confidentiality-commitment';
    activityPayload.current_page = JSON.stringify({
      id: r.id || `bmtt-${Date.now()}`,
      documentVersion: r.documentVersion || 'PHF-BMTT-2026-06-06',
      fullName: r.fullName || '',
      birthday: r.birthday || '',
      cccd: r.cccd || '',
      cccdDate: r.cccdDate || '',
      cccdPlace: r.cccdPlace || '',
      phone: r.phone || '',
      position: r.position || '',
      branch: r.branch || '',
      signName: r.signName || '',
      signPhone: r.signPhone || '',
      confirmDate: r.confirmDate || '',
      checkedCount: r.checkedCount || 0,
      requiredCheckCount: r.requiredCheckCount || 0,
      signedAt: r.signedAt || now
    });
  }

  await supabase.from('activity_log').insert(activityPayload);

  return { ok: true, savedAt: now, data: await readDataFromSupabase() };
}

async function readData() {
  return hasSupabaseEnv ? readDataFromSupabase() : readDataFromFile();
}

async function saveData(payload) {
  return hasSupabaseEnv ? saveDataToSupabase(payload) : saveDataToFile(payload);
}

module.exports = { readData, saveData };
