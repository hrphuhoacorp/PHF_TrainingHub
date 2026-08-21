require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', '..', 'data.json');
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const MAX_BACKUPS = 10;
const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const allowLocalData = String(process.env.PHF_ALLOW_LOCAL_DATA || '').trim().toLowerCase() === 'true';

// Xếp hàng thao tác ghi theo từng học viên trong cùng một tiến trình server.
// Mục tiêu: hai tab/trình duyệt gửi lưu gần như đồng thời không cùng đọc một bản tiến độ cũ
// rồi ghi đè mất phần thay đổi của nhau.
const employeeWriteQueues = new Map();

async function runWithEmployeeWriteQueue(employeeId, task) {
  const queueKey = String(employeeId || '').trim() || '__unknown_employee__';
  const previous = employeeWriteQueues.get(queueKey) || Promise.resolve();
  const execution = previous.catch(() => undefined).then(task);
  let queued;
  queued = execution.finally(() => {
    if (employeeWriteQueues.get(queueKey) === queued) employeeWriteQueues.delete(queueKey);
  });
  employeeWriteQueues.set(queueKey, queued);
  return execution;
}


function createRecordId(prefix) {
  const safePrefix = String(prefix || 'record').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'record';
  if (typeof crypto.randomUUID === 'function') {
    return `${safePrefix}-${crypto.randomUUID()}`;
  }
  return `${safePrefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

let supabase = null;

if (hasSupabaseEnv) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );
} else if (allowLocalData) {
  console.warn('PHF Training Hub: đang chạy chế độ dữ liệu local theo PHF_ALLOW_LOCAL_DATA=true. Dữ liệu chỉ lưu trên máy này.');
} else {
  console.error('PHF Training Hub: thiếu cấu hình Supabase. Hệ thống sẽ không tự chuyển sang data.json.');
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
      confidentialityCommitments: [],
      probationRecords: [],
      systemNotifications: []
    };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function rotateBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(name => /^data-\d{8}T\d{6}\d{3}Z\.json$/i.test(name))
    .map(name => ({ name, time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  files.slice(MAX_BACKUPS).forEach(file => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, file.name)); } catch (err) { console.warn('PHF không xóa được backup cũ:', err.message); }
  });
}

function backupDataFile() {
  if (!fs.existsSync(DATA_FILE)) return;
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');
  const target = path.join(BACKUP_DIR, `data-${stamp}.json`);
  fs.copyFileSync(DATA_FILE, target);
  rotateBackups();
}

function writeDataFile(data) {
  backupDataFile();
  const tempFile = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
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


function isPassedTestResult(row) {
  const status = String(row && (row.status || row.result_status) || '').trim().toLowerCase();
  const score = Number(row && row.score);
  const passScore = Number(row && (row.passScore || row.pass_score) || 80);
  return ['đạt','passed','pass','completed'].includes(status) ||
    (Number.isFinite(score) && Number.isFinite(passScore) && score >= passScore);
}

function testStageFromPage(pageValue) {
  const page = String(pageValue || '').trim().toLowerCase();
  if (page === 'step2-final' || page === 'lesson:62' || page === 'step2finaltest') return 2;
  if (page === 'step3-final' || page === 'lesson:71') return 3;
  if (page === 'step4-final' || page === 'lesson:107') return 4;
  return 0;
}

function derivePassedStages(testRows, pendingResult) {
  const passed = {2:false, 3:false, 4:false};
  const rows = [...(Array.isArray(testRows) ? testRows : [])];
  if (pendingResult) rows.push(pendingResult);
  rows.forEach(row => {
    if (!isPassedTestResult(row)) return;
    const stage = testStageFromPage(row.page);
    if (stage) passed[stage] = true;
  });
  return passed;
}

function sanitizeLearnerProgress(existingProgress, payload, testRows) {
  const existingUnlocked = Array.isArray(existingProgress && (existingProgress.unlockedSteps || existingProgress.unlocked_steps))
    ? (existingProgress.unlockedSteps || existingProgress.unlocked_steps) : [];
  const existingCompleted = Array.isArray(existingProgress && (existingProgress.completedPages || existingProgress.completed_pages))
    ? (existingProgress.completedPages || existingProgress.completed_pages) : [];
  const incomingUnlocked = Array.isArray(payload && payload.unlockedSteps) ? payload.unlockedSteps : [];
  const incomingCompleted = Array.isArray(payload && payload.completedPages) ? payload.completedPages : [];

  const blockedUnlock = /^(GD3|GD4|GD5)$/i;
  const blockedUnlockLabel = /^Bước\s*(3|4|5)\s*-/i;
  const blockedComplete = /ADMIN_TEST_UNLOCK_ALL|Admin test mở khóa|Bước\s*2\s*-\s*Đã đạt|Bước\s*3\s*-\s*Đã đạt|Bước\s*4\s*-\s*Đã đạt|^GD[234]$/i;

  const unlocked = [...existingUnlocked, ...incomingUnlocked]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => !blockedUnlock.test(value) && !blockedUnlockLabel.test(value) && !/ADMIN_TEST/i.test(value));

  const completed = [...existingCompleted, ...incomingCompleted]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => !blockedComplete.test(value));

  unlocked.push('GD1', 'Bước 1 - Hội nhập');
  const passed = derivePassedStages(testRows, payload && payload.testResult);

  if (passed[2]) {
    completed.push('GD2', 'step2FinalTest', 'Bước 2 - Đã đạt test cuối');
    unlocked.push('GD3', 'Bước 3 - Quy trình');
  }
  if (passed[3]) {
    completed.push('GD3', 'Bước 3 - Đã đạt bài kiểm tra');
    unlocked.push('GD4', 'Bước 4 - Thực hành');
  }
  if (passed[4]) {
    completed.push('GD4', 'Bước 4 - Đã đạt bài kiểm tra cuối');
    unlocked.push('GD5', 'Bước 5 - Đánh giá');
  }

  return {
    unlockedSteps:Array.from(new Set(unlocked)),
    completedPages:Array.from(new Set(completed))
  };
}


function isMissingCommitmentTableError(error) {
  const message = String(error?.message || error || '');
  return /commitment_records|relation .* does not exist|schema cache|could not find the table|PGRST205/i.test(message);
}

function mapCommitmentRecord(row) {
  const snapshot = row && typeof row.content_snapshot === 'object' && row.content_snapshot
    ? row.content_snapshot
    : {};
  const metadata = row && typeof row.metadata === 'object' && row.metadata ? row.metadata : {};
  return {
    ...snapshot,
    id: row.id || snapshot.id || '',
    employeeId: row.employee_id || snapshot.employeeId || '',
    commitmentType: row.commitment_type || 'confidentiality',
    documentCode: row.document_code || snapshot.documentCode || 'PHF-BMTT',
    documentVersion: row.document_version || snapshot.documentVersion || 'PHF-BMTT',
    documentTitle: row.document_title || snapshot.documentTitle || 'Cam kết bảo mật thông tin',
    confirmedName: row.confirmed_name || snapshot.confirmedName || snapshot.signName || snapshot.fullName || '',
    confirmedPhone: row.confirmed_phone || snapshot.confirmedPhone || snapshot.signPhone || snapshot.phone || '',
    confirmedAt: row.confirmed_at || snapshot.confirmedAt || snapshot.signedAt || snapshot.confirmDate || '',
    confirmedByEmail: snapshot.confirmedByEmail || snapshot.accountEmail || metadata.accountEmail || '',
    confirmedByAccountId: snapshot.confirmedByAccountId || metadata.accountId || '',
    acknowledgementText: snapshot.acknowledgementText || '',
    checkedCount: Number(snapshot.checkedCount || 0),
    requiredCheckCount: Number(snapshot.requiredCheckCount || 0),
    status: row.status || snapshot.status || 'active',
    signedAt: snapshot.signedAt || row.confirmed_at || '',
    savedAt: row.created_at || row.confirmed_at || '',
    updatedAt: row.updated_at || row.created_at || ''
  };
}

function mapLegacyCommitmentLog(row) {
  try {
    const parsed = JSON.parse(row.current_page || row.currentPage || '{}');
    return {
      ...parsed,
      employeeId: row.employee_id || row.employeeId || '',
      savedAt: row.saved_at || row.savedAt || '',
      status: parsed.status || 'active',
      legacyStorage: true
    };
  } catch (e) {
    return {
      employeeId: row.employee_id || row.employeeId || '',
      savedAt: row.saved_at || row.savedAt || '',
      raw: row.current_page || row.currentPage || '',
      status: 'active',
      legacyStorage: true
    };
  }
}


function isMissingOptionalTableError(error, tableName) {
  const message = String(error?.message || error || '');
  const table = String(tableName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${table}|relation .* does not exist|schema cache|could not find the table|PGRST205`, 'i').test(message);
}

function addDaysIso(value, days) {
  const raw = String(value || '').slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function mapProbationRecord(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    expectedEndDate: row.expected_end_date || '',
    status: row.status || 'in_progress',
    conclusion: row.conclusion || '',
    proposedBy: row.proposed_by || '',
    proposedAt: row.proposed_at || '',
    confirmedBy: row.confirmed_by || '',
    confirmedAt: row.confirmed_at || '',
    extensionReason: row.extension_reason || '',
    notes: row.notes || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    metadata: row.metadata || {}
  };
}

function notificationStateMap(rows) {
  const map = new Map();
  (rows || []).forEach(row => map.set(String(row.id || ''), row));
  return map;
}

function buildDerivedNotifications({ employees, probationRecords, testResults, evaluationRecords, commitments, stateRows, role, employeeId }) {
  const states = notificationStateMap(stateRows);
  const today = new Date();
  today.setHours(0,0,0,0);
  const probationByEmployee = new Map((probationRecords || []).map(row => [String(row.employeeId || ''), row]));
  const notifications = [];

  function push(item) {
    const persisted = states.get(item.id) || {};
    notifications.push({
      ...item,
      status: persisted.status || 'new',
      readAt: persisted.read_at || '',
      resolvedAt: persisted.resolved_at || '',
      resolvedBy: persisted.resolved_by || '',
      createdAt: persisted.created_at || item.createdAt || new Date().toISOString()
    });
  }

  (employees || []).forEach(emp => {
    const id = String(emp.id || '');
    if (!id) return;
    if (employeeId && id !== String(employeeId)) return;

    const name = emp.fullName || 'Nhân viên';
    const start = String(emp.studyStartDate || '').slice(0,10);
    const probation = probationByEmployee.get(id);
    const expected = String(probation?.expectedEndDate || addDaysIso(start, 59)).slice(0,10);
    const status = String(probation?.status || (start ? 'in_progress' : 'missing_start'));

    if (!start) {
      push({
        id:`missing-start-${id}`, employeeId:id, targetRole:'manager',
        type:'missing_profile', priority:'high',
        title:'Thiếu ngày bắt đầu học',
        message:`${name} chưa có ngày bắt đầu học/thử việc.`,
        sourceType:'probation', sourceId:probation?.id || `probation-${id}`
      });
    }

    if (expected && !['passed','failed','resigned','confirmed'].includes(status)) {
      const end = new Date(`${expected}T00:00:00`);
      const days = Math.ceil((end.getTime()-today.getTime())/86400000);
      if (days < 0) {
        push({
          id:`probation-overdue-${id}`, employeeId:id, targetRole:'manager',
          type:'probation_overdue', priority:'high',
          title:'Thử việc đã quá hạn',
          message:`${name} đã quá hạn ${Math.abs(days)} ngày nhưng chưa có kết luận chính thức.`,
          dueAt:`${expected}T23:59:59`, sourceType:'probation', sourceId:probation?.id || `probation-${id}`
        });
      } else if (days <= 3) {
        push({
          id:`probation-3day-${id}`, employeeId:id, targetRole:'manager',
          type:'probation_due', priority:'high',
          title:'Sắp đến hạn thử việc',
          message:`${name} còn ${days} ngày đến hạn kết thúc thử việc.`,
          dueAt:`${expected}T23:59:59`, sourceType:'probation', sourceId:probation?.id || `probation-${id}`
        });
      } else if (days <= 7) {
        push({
          id:`probation-7day-${id}`, employeeId:id, targetRole:'manager',
          type:'probation_due', priority:'normal',
          title:'Nhắc đánh giá thử việc',
          message:`${name} còn ${days} ngày đến hạn kết thúc thử việc.`,
          dueAt:`${expected}T23:59:59`, sourceType:'probation', sourceId:probation?.id || `probation-${id}`
        });
      }
    }

    const finalEval = (evaluationRecords || []).find(row =>
      String(row.employeeId || '') === id &&
      String(row.formType || '') === 'final'
    );
    if (expected && !finalEval && !['passed','failed','resigned'].includes(status)) {
      const end = new Date(`${expected}T00:00:00`);
      const days = Math.ceil((end.getTime()-today.getTime())/86400000);
      if (days <= 3) {
        push({
          id:`missing-final-eval-${id}`, employeeId:id, targetRole:'manager',
          type:'missing_evaluation', priority:'high',
          title:'Chưa có phiếu kết thúc thử việc',
          message:`${name} sắp/đã đến hạn nhưng chưa có phiếu đánh giá kết thúc.`,
          dueAt:`${expected}T23:59:59`, sourceType:'evaluation', sourceId:id
        });
      }
    }

    const hasCommitment = (commitments || []).some(row => String(row.employeeId || '') === id);
    if (!hasCommitment) {
      push({
        id:`missing-bmtt-${id}`, employeeId:id, targetRole:'manager',
        type:'missing_commitment', priority:'normal',
        title:'Chưa có cam kết BMTT',
        message:`${name} chưa xác nhận cam kết bảo mật thông tin.`,
        sourceType:'commitment', sourceId:id
      });
    }

    if (probation?.proposedBy && !probation?.confirmedBy &&
        !['passed','failed','resigned'].includes(status)) {
      push({
        id:`probation-await-confirm-${id}`, employeeId:id, targetRole:'admin',
        type:'awaiting_confirmation', priority:'high',
        title:'Chờ xác nhận kết luận thử việc',
        message:`${probation.proposedBy} đã gửi đề xuất cho ${name}.`,
        sourceType:'probation', sourceId:probation.id
      });
    }

    if (role === 'learner') {
      // Học viên chỉ nhận nhắc việc của chính mình, không nhận cảnh báo quản trị.
      notifications.forEach(n => {
        if (n.employeeId === id) n.targetRole = 'learner';
      });
    }
  });

  const allowed = notifications.filter(item => {
    if (role === 'learner') return item.employeeId === String(employeeId || '');
    if (role === 'manager') return item.targetRole !== 'admin';
    return true;
  });

  return allowed
    .filter(item => item.status !== 'resolved' && item.status !== 'dismissed')
    .sort((a,b) => {
      const weight = {high:3,normal:2,low:1};
      return (weight[b.priority]||0)-(weight[a.priority]||0) ||
        String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999'));
    });
}

function clampActivityLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(20, Math.min(500, Math.floor(parsed)));
}

function limitActivityRows(rows, limit, employeeId) {
  const id = String(employeeId || '').trim();
  const filtered = (Array.isArray(rows) ? rows : []).filter(row => {
    if (!id) return true;
    return String(row?.employeeId || row?.employee_id || '') === id;
  });
  return filtered
    .slice()
    .sort((a, b) => new Date(b?.savedAt || b?.saved_at || 0) - new Date(a?.savedAt || a?.saved_at || 0))
    .slice(0, limit)
    .reverse();
}

async function readDataFromFile(options = {}) {
  const data = readDataFile();
  const activityLimit = clampActivityLimit(options.activityLimit, 200);
  const employeeId = String(options.employeeId || '').trim();
  const allRows = Array.isArray(data.activityLog) ? data.activityLog : [];
  const recentRows = limitActivityRows(allRows, activityLimit, employeeId);
  const dedicatedCommitments = (Array.isArray(data.confidentialityCommitments) ? data.confidentialityCommitments : [])
    .filter(row => !employeeId || String(row.employeeId || row.employee_id || '') === employeeId);
  const commitments = dedicatedCommitments.length
    ? dedicatedCommitments
    : allRows
      .filter(row => row && row.type === 'confidentiality-commitment')
      .filter(row => !employeeId || String(row.employeeId || row.employee_id || '') === employeeId)
      .map(mapLegacyCommitmentLog);

  const probationRecords = (Array.isArray(data.probationRecords) ? data.probationRecords : []).map(row => ({
    ...row,
    employeeId: row.employeeId || row.employee_id || ''
  }));
  const notifications = buildDerivedNotifications({
    employees: data.employees || [],
    probationRecords,
    testResults: data.testResults || [],
    evaluationRecords: data.evaluationRecords || [],
    commitments,
    stateRows: data.systemNotifications || [],
    role: options.role || 'manager',
    employeeId
  });

  return {
    ...data,
    activityLog: recentRows,
    confidentialityCommitments: commitments,
    probationRecords,
    systemNotifications: notifications,
    activityLogMeta: {
      limit: activityLimit,
      returned: recentRows.length,
      totalKnown: employeeId
        ? allRows.filter(row => String(row?.employeeId || row?.employee_id || '') === employeeId).length
        : allRows.length,
      hasMore: employeeId
        ? allRows.filter(row => String(row?.employeeId || row?.employee_id || '') === employeeId).length > recentRows.length
        : allRows.length > recentRows.length
    }
  };
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
  const employeeId = String(employee.id || '').trim();
  if (!employeeId) throw new Error('Không xác định được mã học viên. Hệ thống chưa ghi dữ liệu.');

  // PHF Bản 1.1.0: department/position/branch chỉ lấy từ hồ sơ nhân sự thật.
  // Training Hub không được ghi đè các field dùng chung này (Checklist/Classroom cũng đọc).
  const employeeRecord = {
    id: employeeId,
    fullName: employee.fullName || employee.name || '',
    birthday: employee.birthday || '',
    phone: employee.phone || '',
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
  let testResultSaved = !payload.testResult;
  let progressSaved = Boolean(payload.skipProgress);
  let savedTestResult = null;
  let savedProgress = null;

  // Quiz phải được ghi nhận trước khi tính lại progress. Khi retry, kết quả trùng
  // trong cửa sổ ngắn vẫn được xem là đã lưu để tiếp tục hoàn tất progress.
  if (payload.testResult) {
    const result = payload.testResult || {};
    const duplicateWindowMs = 15000;
    const duplicate = data.testResults.find(row =>
      String(row.employeeId || row.employee_id || '') === employeeId &&
      String(row.page || '') === String(result.page || '') &&
      String(row.status || '') === String(result.status || '') &&
      Number(row.score ?? -1) === Number(result.score ?? -1) &&
      Math.abs(Date.now() - new Date(row.savedAt || row.saved_at || 0).getTime()) <= duplicateWindowMs
    );
    if (duplicate) {
      savedTestResult = duplicate;
      testResultSaved = true;
    } else {
      savedTestResult = {
        id: String(result.submissionId || '').trim() || createRecordId('test'),
        employeeId,
        page: result.page || '',
        score: result.score ?? null,
        passScore: result.passScore || data.settings.passScore || 80,
        status: result.status || '',
        resultText: result.resultText || '',
        savedAt: now
      };
      data.testResults.push(savedTestResult);
      testResultSaved = true;
    }
  }

  if (!payload.skipProgress) {
    const learnerProgress = String(payload.actorRole || '').toLowerCase() === 'learner'
      ? sanitizeLearnerProgress(existingProgress, payload, (data.testResults || []).filter(row =>
          String(row.employeeId || row.employee_id || '') === employeeId
        ))
      : {
          unlockedSteps:Array.from(new Set([...(existingProgress.unlockedSteps || []), ...(payload.unlockedSteps || [])])),
          completedPages:Array.from(new Set([...(existingProgress.completedPages || []), ...(payload.completedPages || [])]))
        };
    savedProgress = {
      currentPage: chooseCurrentPage(payload.currentPage, existingProgress.currentPage),
      unlockedSteps: learnerProgress.unlockedSteps,
      completedPages: learnerProgress.completedPages,
      lastUpdatedAt: now
    };
    data.progress[employeeId] = savedProgress;
    progressSaved = true;
  }

  if (payload.evaluationRecord) {
    if (!payload.adminMode && !payload.managerMode) {
      throw new Error('Chỉ tài khoản quản lý/HCNS được tạo hoặc sửa phiếu đánh giá.');
    }
    const r = payload.evaluationRecord;
    const record = {
      id: r.id || createRecordId('eval'),
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
      id: r.id || createRecordId('bmtt'),
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
      confirmedByEmail: r.confirmedByEmail || '',
      confirmedByAccountId: r.confirmedByAccountId || '',
      status: r.status || 'signed',
      savedAt: now
    };
    const idx = data.confidentialityCommitments.findIndex(x => x.employeeId === employeeId && x.documentVersion === record.documentVersion);
    if (idx >= 0) data.confidentialityCommitments[idx] = { ...data.confidentialityCommitments[idx], ...record };
    else data.confidentialityCommitments.push(record);
  }

  data.activityLog.push({
    id: createRecordId('log'),
    employeeId,
    type: payload.type || 'autosave',
    currentPage: payload.currentPage || '',
    savedAt: now
  });

  writeDataFile(data);
  return {
    ok: true,
    savedAt: now,
    data,
    receipt: {
      testResultSaved,
      progressSaved,
      employeeId,
      quizKey: payload.testResult ? String(payload.testResult.page || '') : '',
      score: payload.testResult ? Number(payload.testResult.score ?? 0) : null,
      status: payload.testResult ? String(payload.testResult.status || '') : '',
      completedPage: String(payload.currentPage || ''),
      completedPages: savedProgress ? savedProgress.completedPages : [],
      nextPageAllowed: Boolean(savedProgress && String(payload.currentPage || '') && savedProgress.completedPages.includes(String(payload.currentPage || ''))),
      savedAt: now,
      duplicateTestResult: Boolean(payload.testResult && savedTestResult && savedTestResult.savedAt !== now)
    }
  };
}

async function readDataFromSupabase(options = {}) {
  const activityLimit = clampActivityLimit(options.activityLimit, 200);
  const employeeId = String(options.employeeId || '').trim();

  let recentActivityQuery = supabase
    .from('activity_log')
    .select('id, employee_id, type, current_page, saved_at')
    .order('saved_at', { ascending: false })
    .limit(activityLimit);

  let commitmentQuery = supabase
    .from('commitment_records')
    .select('*')
    .order('confirmed_at', { ascending: false });

  let legacyCommitmentQuery = supabase
    .from('activity_log')
    .select('id, employee_id, type, current_page, saved_at')
    .eq('type', 'confidentiality-commitment')
    .order('saved_at', { ascending: false });

  let probationQuery = supabase
    .from('probation_records')
    .select('*')
    .order('updated_at', { ascending: false });

  let notificationStateQuery = supabase
    .from('system_notifications')
    .select('*')
    .order('updated_at', { ascending: false });

  if (employeeId) {
    recentActivityQuery = recentActivityQuery.eq('employee_id', employeeId);
    commitmentQuery = commitmentQuery.eq('employee_id', employeeId);
    legacyCommitmentQuery = legacyCommitmentQuery.eq('employee_id', employeeId);
    probationQuery = probationQuery.eq('employee_id', employeeId);
    notificationStateQuery = notificationStateQuery.eq('employee_id', employeeId);
  }


  let employeesQuery = supabase.from('employees').select('*');
  let progressQuery = supabase.from('progress').select('*');
  let testResultsQuery = supabase.from('test_results').select('*').order('saved_at');
  let progressRecoveryQuery = supabase
    .from('activity_log')
    .select('employee_id, current_page, saved_at')
    .not('current_page', 'is', null)
    .neq('type', 'confidentiality-commitment')
    .order('saved_at', { ascending: false })
    .limit(employeeId ? 100 : 500);

  if (employeeId) {
    employeesQuery = employeesQuery.eq('id', employeeId);
    progressQuery = progressQuery.eq('employee_id', employeeId);
    testResultsQuery = testResultsQuery.eq('employee_id', employeeId);
    progressRecoveryQuery = progressRecoveryQuery.eq('employee_id', employeeId);
  }

  const [
    { data: settingsRow },
    { data: employees },
    { data: progressRows },
    { data: testResults },
    { data: recentActivityLog, error: activityError },
    { data: progressRecoveryLog, error: recoveryError },
    { data: commitmentRows, error: commitmentError },
    { data: legacyCommitmentLog, error: legacyCommitmentError },
    { data: probationRows, error: probationError },
    { data: notificationStateRows, error: notificationStateError }
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    employeesQuery,
    progressQuery,
    testResultsQuery,
    recentActivityQuery,
    progressRecoveryQuery,
    commitmentQuery,
    legacyCommitmentQuery,
    probationQuery,
    notificationStateQuery
  ]);

  if (activityError) console.warn('PHF activity_log gần nhất chưa tải được:', activityError.message || activityError);
  if (recoveryError) console.warn('PHF activity_log phục hồi tiến độ chưa tải được:', recoveryError.message || recoveryError);
  if (commitmentError && !isMissingCommitmentTableError(commitmentError)) {
    console.warn('PHF commitment_records chưa tải được:', commitmentError.message || commitmentError);
  }
  if (legacyCommitmentError) {
    console.warn('PHF BMTT cũ trong activity_log chưa tải được:', legacyCommitmentError.message || legacyCommitmentError);
  }
  if (probationError && !isMissingOptionalTableError(probationError, 'probation_records')) {
    console.warn('PHF probation_records chưa tải được:', probationError.message || probationError);
  }
  if (notificationStateError && !isMissingOptionalTableError(notificationStateError, 'system_notifications')) {
    console.warn('PHF system_notifications chưa tải được:', notificationStateError.message || notificationStateError);
  }

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

  // Chỉ dùng tối đa 500 bản ghi nhẹ để phục hồi các dữ liệu progress cũ.
  // Các bản ghi này không được trả về trình duyệt.
  const recoverySeen = new Set();
  (progressRecoveryLog || []).forEach(l => {
    if (!l || !l.employee_id || recoverySeen.has(l.employee_id)) return;
    if (!isMeaningfulProgressPage(l.current_page)) return;
    recoverySeen.add(l.employee_id);
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

  // Query trả về mới nhất trước; đảo lại để giữ tương thích thứ tự cũ.
  const activityLogMapped = (recentActivityLog || [])
    .slice()
    .reverse()
    .map(l => ({
      id: l.id,
      employeeId: l.employee_id,
      type: l.type,
      currentPage: l.current_page,
      savedAt: l.saved_at
    }));

  let evaluationRecordsMapped = [];
  try {
    let evaluationQuery = supabase
      .from('evaluation_records')
      .select('*')
      .order('updated_at');
    if (employeeId) evaluationQuery = evaluationQuery.eq('employee_id', employeeId);
    const { data: evaluationRecords, error: evalError } = await evaluationQuery;

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

  const useDedicatedCommitments = !commitmentError;
  const confidentialityCommitmentsMapped = useDedicatedCommitments
    ? (commitmentRows || []).map(mapCommitmentRecord)
    : (legacyCommitmentLog || []).map(mapLegacyCommitmentLog);

  return {
    settings,
    employees: employeesMapped,
    progress,
    testResults: testResultsMapped,
    activityLog: activityLogMapped,
    activityLogMeta: {
      limit: activityLimit,
      returned: activityLogMapped.length,
      hasMore: activityLogMapped.length >= activityLimit,
      scope: employeeId ? 'employee' : 'staff'
    },
    evaluationRecords: evaluationRecordsMapped,
    confidentialityCommitments: confidentialityCommitmentsMapped,
    probationRecords: (probationRows || []).map(mapProbationRecord),
    systemNotifications: buildDerivedNotifications({
      employees: employeesMapped,
      probationRecords: (probationRows || []).map(mapProbationRecord),
      testResults: testResultsMapped,
      evaluationRecords: evaluationRecordsMapped,
      commitments: confidentialityCommitmentsMapped,
      stateRows: notificationStateRows || [],
      role: options.role || 'manager',
      employeeId
    })
  };
}

async function saveDataToSupabase(payload) {
  const now = new Date().toISOString();
  const employee = payload.employee || {};
  const employeeId = String(employee.id || '').trim();
  if (!employeeId) throw new Error('Không xác định được mã học viên. Hệ thống chưa ghi dữ liệu.');

  // PHF Bản 1.1.0: department/position/branch chỉ lấy từ hồ sơ nhân sự thật.
  // Training Hub không được ghi đè các field dùng chung này (Checklist/Classroom cũng đọc
  // cùng bảng employees). Không đưa 3 field này vào payload upsert nữa.
  const employeeBase = {
    id: employeeId,
    full_name: employee.fullName || employee.name || '',
    birthday: employee.birthday || '',
    created_at: employee.createdAt || now,
    last_active_at: now
  };

  const employeeExtended = {
    ...employeeBase,
    phone: employee.phone || '',
    study_start_date: employee.studyStartDate || employee.study_start_date || '',
    program_id: employee.programId || 'new_sales'
  };

  let officialEmployee = null;
  if (payload.confidentialityCommitment) {
    const officialRead = await supabase.from('employees').select('*').eq('id', employeeId).maybeSingle();
    if (officialRead.error) throw new Error('Chưa thể đối chiếu hồ sơ nhân viên trước khi ký BMTT.');
    officialEmployee = officialRead.data || null;
    if (!officialEmployee) throw new Error('Không tìm thấy hồ sơ nhân viên chính thức để ký BMTT.');
  } else {
    // Ưu tiên lưu đủ thông tin thật. Nếu database chưa được nâng cột,
    // fallback về schema cũ để web không bị gãy; chạy file SQL cập nhật để lưu đủ SĐT/ngày học.
    let employeeSave = await supabase.from('employees').upsert(employeeExtended);
    if (employeeSave.error && /column|schema cache|could not find|study_start_date|phone|program_id/i.test(employeeSave.error.message || '')) {
      console.warn('PHF employees schema chưa có cột mở rộng, tạm lưu schema cũ:', employeeSave.error.message);
      employeeSave = await supabase.from('employees').upsert(employeeBase);
    }
    if (employeeSave.error) throw employeeSave.error;
  }

  const progressRead = await supabase
    .from('progress').select('*').eq('employee_id', employeeId).maybeSingle();
  if (progressRead.error) {
    console.error('[PHF Supabase] Không đọc được tiến độ hiện tại:', progressRead.error.message || progressRead.error);
    throw new Error('Chưa thể kiểm tra tiến độ hiện tại. Hệ thống chưa ghi thay đổi.');
  }
  const existing = progressRead.data || null;
  let existingTestRows = [];
  let testResultSaved = !payload.testResult;
  let progressSaved = Boolean(payload.skipProgress);
  let savedTestResult = null;
  let savedProgress = null;
  let duplicateTestResult = false;

  if (String(payload.actorRole || '').toLowerCase() === 'learner' && !payload.skipProgress) {
    const testRead = await supabase
      .from('test_results')
      .select('page,score,pass_score,status')
      .eq('employee_id', employeeId)
      .limit(500);
    if (testRead.error) {
      console.warn('[PHF Supabase] Không đọc được kết quả để xác minh mở khóa:', testRead.error.message || testRead.error);
    } else {
      existingTestRows = testRead.data || [];
    }
  }

  // Ghi/nhận diện kết quả quiz trước, sau đó mới tính progress từ dữ liệu đã có
  // cộng với kết quả hiện tại. Retry không tạo bản ghi trùng nhưng vẫn tiếp tục lưu progress.
  if (payload.testResult) {
    const result = payload.testResult || {};
    const submissionId = String(result.submissionId || '').trim() || createRecordId('test');
    const since = new Date(Date.now() - 15000).toISOString();
    const duplicateRead = await supabase
      .from('test_results')
      .select('id,page,score,pass_score,status,result_text,saved_at')
      .eq('employee_id', employeeId)
      .eq('page', result.page || '')
      .eq('status', result.status || '')
      .gte('saved_at', since)
      .order('saved_at', {ascending:false})
      .limit(5);
    if (duplicateRead.error) {
      console.warn('[PHF Supabase] Không kiểm tra được kết quả trùng:', duplicateRead.error.message || duplicateRead.error);
    }
    const duplicate = !duplicateRead.error && (duplicateRead.data || []).find(row =>
      Number(row.score ?? -1) === Number(result.score ?? -1)
    );
    if (duplicate) {
      savedTestResult = duplicate;
      duplicateTestResult = true;
      testResultSaved = true;
    } else {
      const testPayload = {
        id: submissionId,
        employee_id: employeeId,
        page: result.page || '',
        score: result.score ?? null,
        pass_score: result.passScore || 80,
        status: result.status || '',
        result_text: result.resultText || '',
        saved_at: now
      };
      const testSave = await supabase.from('test_results').insert(testPayload).select('id,page,score,pass_score,status,result_text,saved_at').single();
      if (testSave.error) {
        if (!/duplicate key|unique constraint/i.test(testSave.error.message || '')) {
          console.error('[PHF Supabase] Không lưu được kết quả kiểm tra:', testSave.error.message || testSave.error);
          throw new Error('Chưa thể lưu kết quả kiểm tra. Vui lòng thử lại.');
        }
        const retryRead = await supabase
          .from('test_results')
          .select('id,page,score,pass_score,status,result_text,saved_at')
          .eq('id', submissionId)
          .maybeSingle();
        if (retryRead.error || !retryRead.data) {
          throw new Error('Kết quả kiểm tra có dấu hiệu đã lưu nhưng máy chủ chưa xác minh được. Vui lòng lưu lại kết quả.');
        }
        savedTestResult = retryRead.data;
        duplicateTestResult = true;
      } else {
        savedTestResult = testSave.data;
      }
      testResultSaved = Boolean(savedTestResult);
    }
  }

  if (!payload.skipProgress) {
    const learnerProgress = String(payload.actorRole || '').toLowerCase() === 'learner'
      ? sanitizeLearnerProgress(existing || {}, payload, existingTestRows)
      : {
          unlockedSteps:Array.from(new Set([...(existing?.unlocked_steps || []), ...(payload.unlockedSteps || [])])),
          completedPages:Array.from(new Set([...(existing?.completed_pages || []), ...(payload.completedPages || [])]))
        };
    const progressPayload = {
      employee_id: employeeId,
      current_page: chooseCurrentPage(payload.currentPage, existing?.current_page),
      unlocked_steps: learnerProgress.unlockedSteps,
      completed_pages: learnerProgress.completedPages,
      last_updated_at: now
    };
    const progressSave = await supabase.from('progress').upsert(progressPayload).select('current_page,unlocked_steps,completed_pages,last_updated_at').single();
    if (progressSave.error) {
      console.error('[PHF Supabase] Không lưu được tiến độ:', progressSave.error.message || progressSave.error);
      throw new Error('Kết quả kiểm tra đã được ghi nhận nhưng chưa thể cập nhật tiến độ. Hãy bấm “Lưu lại kết quả”.');
    }
    savedProgress = progressSave.data || progressPayload;
    progressSaved = true;
  }

  if (payload.evaluationRecord) {
    if (!payload.adminMode && !payload.managerMode) {
      throw new Error('Chỉ tài khoản quản lý/HCNS được tạo hoặc sửa phiếu đánh giá.');
    }
    const r = payload.evaluationRecord;
    const evalSave = await supabase.from('evaluation_records').upsert({
      id: r.id || createRecordId('eval'),
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

  let savedCommitmentRecord = null;
  if (payload.confidentialityCommitment) {
    const r = payload.confidentialityCommitment || {};
    const documentVersion = String(r.documentVersion || '').trim();
    const acknowledgementText = 'Tôi đã đọc, hiểu và đồng ý thực hiện cam kết bảo mật thông tin.';
    const confirmedName = String(officialEmployee?.full_name || '').trim();
    const confirmedPhone = String(officialEmployee?.phone || '').trim();
    const confirmedByEmail = String(payload.actorEmail || '').trim();
    const confirmedByAccountId = String(payload.actorAccountId || '').trim();
    if (!documentVersion || !confirmedName || !confirmedByEmail || !confirmedByAccountId) {
      throw new Error('Hồ sơ hoặc tài khoản ký BMTT chưa đủ thông tin bắt buộc.');
    }
    if (Number(r.checkedCount || 0) < 1 || Number(r.requiredCheckCount || 0) < 1 || Number(r.checkedCount) !== Number(r.requiredCheckCount)) {
      throw new Error('Bạn chưa xác nhận đầy đủ nội dung cam kết BMTT.');
    }

    const existingRead = await supabase.from('commitment_records')
      .select('*').eq('employee_id', employeeId).eq('commitment_type', 'confidentiality')
      .eq('document_version', documentVersion).maybeSingle();
    if (existingRead.error && !isMissingCommitmentTableError(existingRead.error)) throw existingRead.error;

    const existingMapped = existingRead.data ? mapCommitmentRecord(existingRead.data) : null;
    const existingComplete = !!(existingMapped && existingMapped.id && existingMapped.employeeId && existingMapped.confirmedName && existingMapped.confirmedByEmail && existingMapped.confirmedAt && existingMapped.documentVersion && existingMapped.acknowledgementText && Number(existingMapped.checkedCount) >= 1 && Number(existingMapped.requiredCheckCount) >= 1);
    if (existingComplete) {
      savedCommitmentRecord = existingMapped;
    } else {
      const commitmentId = createRecordId('bmtt');
      const snapshot = {
        id: commitmentId,
        employeeId,
        employeeCode: employeeId,
        documentCode: 'PHF-BMTT',
        documentVersion,
        documentTitle: 'Cam kết bảo mật thông tin',
        acknowledgementText,
        fullName: confirmedName,
        birthday: officialEmployee?.birthday || '',
        cccd: r.cccd || '',
        cccdDate: r.cccdDate || '',
        cccdPlace: r.cccdPlace || '',
        phone: confirmedPhone,
        position: officialEmployee?.position || '',
        branch: officialEmployee?.branch || '',
        signName: confirmedName,
        signPhone: confirmedPhone,
        confirmDate: now.slice(0,10),
        checkedCount: 1,
        requiredCheckCount: 1,
        signedAt: now,
        confirmedByEmail,
        confirmedByAccountId,
        status: 'signed'
      };
      const commitmentSave = await supabase.from('commitment_records').upsert({
        id: commitmentId,
        employee_id: employeeId,
        commitment_type: 'confidentiality',
        document_code: snapshot.documentCode,
        document_version: documentVersion,
        document_title: snapshot.documentTitle,
        content_snapshot: snapshot,
        confirmed_name: confirmedName,
        confirmed_phone: confirmedPhone,
        confirmed_at: now,
        status: 'active',
        created_at: now,
        updated_at: now,
        metadata: { source: 'PHF Training Hub', accountId: confirmedByAccountId, accountEmail: confirmedByEmail }
      }, { onConflict: 'employee_id,commitment_type,document_version' }).select('*').single();
      if (commitmentSave.error) {
        if (isMissingCommitmentTableError(commitmentSave.error)) throw new Error('Chưa thể lưu cam kết BMTT vì cơ sở dữ liệu chưa được nâng cấp.');
        throw new Error('Chưa thể lưu cam kết bảo mật. Vui lòng thử lại.');
      }
      savedCommitmentRecord = mapCommitmentRecord(commitmentSave.data);
      if (!savedCommitmentRecord.id || !savedCommitmentRecord.confirmedName || !savedCommitmentRecord.confirmedByEmail || !savedCommitmentRecord.confirmedAt || !savedCommitmentRecord.documentVersion || !savedCommitmentRecord.acknowledgementText) {
        throw new Error('Máy chủ đã lưu nhưng chưa trả lại đủ thông tin biên bản BMTT.');
      }
    }
  }

  const activityPayload = {
    id: createRecordId('log'),
    employee_id: employeeId,
    type: payload.confidentialityCommitment ? 'commitment-confirmed' : (payload.type || 'autosave'),
    current_page: payload.confidentialityCommitment ? '' : (payload.currentPage || ''),
    saved_at: now
  };

  const activitySave = await supabase.from('activity_log').insert(activityPayload);
  if (activitySave.error) {
    console.error('[PHF Supabase] Không lưu được nhật ký hoạt động:', activitySave.error.message || activitySave.error);
  }

  let refreshedData = null;
  const warnings = [];
  if (activitySave.error) warnings.push('ACTIVITY_LOG_NOT_SAVED');
  try {
    refreshedData = await readDataFromSupabase();
  } catch (readBackError) {
    console.error('[PHF Supabase] Đã ghi dữ liệu nhưng chưa đọc lại được dữ liệu mới:', readBackError.message || readBackError);
    warnings.push('READ_BACK_FAILED');
  }

  return {
    ok: true,
    savedAt: now,
    data: refreshedData,
    commitmentRecord: savedCommitmentRecord,
    warnings,
    receipt: {
      testResultSaved,
      progressSaved,
      employeeId,
      quizKey: payload.testResult ? String(payload.testResult.page || '') : '',
      score: payload.testResult ? Number(payload.testResult.score ?? 0) : null,
      status: payload.testResult ? String(payload.testResult.status || '') : '',
      completedPage: String(payload.currentPage || ''),
      completedPages: savedProgress ? (savedProgress.completed_pages || savedProgress.completedPages || []) : [],
      nextPageAllowed: Boolean(savedProgress && String(payload.currentPage || '') && (savedProgress.completed_pages || savedProgress.completedPages || []).includes(String(payload.currentPage || ''))),
      savedAt: now,
      duplicateTestResult
    }
  };
}


async function deleteEmployeeFromFile(payload) {
  if (!payload.adminMode) {
    const error = new Error('Chỉ Admin được xóa học viên.');
    error.statusCode = 403;
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }

  const employeeId = String(payload?.employee?.id || '').trim();
  if (!employeeId) throw new Error('Không xác định được học viên cần xóa.');

  const data = readDataFile();
  data.employees = Array.isArray(data.employees) ? data.employees : [];
  data.progress = data.progress || {};
  data.testResults = Array.isArray(data.testResults) ? data.testResults : [];
  data.activityLog = Array.isArray(data.activityLog) ? data.activityLog : [];
  data.evaluationRecords = Array.isArray(data.evaluationRecords) ? data.evaluationRecords : [];
  data.confidentialityCommitments = Array.isArray(data.confidentialityCommitments) ? data.confidentialityCommitments : [];

  const before = {
    employees: data.employees.length,
    testResults: data.testResults.length,
    activityLog: data.activityLog.length,
    evaluationRecords: data.evaluationRecords.length,
    confidentialityCommitments: data.confidentialityCommitments.length
  };

  data.employees = data.employees.filter(e => String(e?.id || '') !== employeeId);
  delete data.progress[employeeId];
  data.testResults = data.testResults.filter(r => String(r?.employeeId || r?.employee_id || '') !== employeeId);
  data.activityLog = data.activityLog.filter(r => String(r?.employeeId || r?.employee_id || '') !== employeeId);
  data.evaluationRecords = data.evaluationRecords.filter(r => String(r?.employeeId || r?.employee_id || '') !== employeeId);
  data.confidentialityCommitments = data.confidentialityCommitments.filter(r => String(r?.employeeId || r?.employee_id || '') !== employeeId);

  writeDataFile(data);

  return {
    ok: true,
    action: 'deleteEmployee',
    employeeId,
    deleted: {
      employees: before.employees - data.employees.length,
      progress: 1,
      testResults: before.testResults - data.testResults.length,
      activityLog: before.activityLog - data.activityLog.length,
      evaluationRecords: before.evaluationRecords - data.evaluationRecords.length,
      confidentialityCommitments: before.confidentialityCommitments - data.confidentialityCommitments.length
    },
    data
  };
}

async function deleteEmployeeFromSupabase(payload) {
  if (!payload.adminMode) {
    const error = new Error('Chỉ Admin được xóa học viên.');
    error.statusCode = 403;
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }

  if (payload.cleanupUnlinkedEmployee !== true) {
    const error = new Error('Yêu cầu xóa hồ sơ chưa liên kết không hợp lệ.');
    error.statusCode = 400;
    error.code = 'UNLINKED_CLEANUP_CONFIRM_REQUIRED';
    throw error;
  }

  const employeeId = String(payload?.employee?.id || '').trim();
  if (!employeeId) throw new Error('Không xác định được học viên cần xóa.');

  // Luôn đọc lại dữ liệu thật ở backend. Không tin vào trạng thái hiển thị ở frontend.
  const employeeRead = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .maybeSingle();

  if (employeeRead.error) {
    throw new Error('Không kiểm tra được hồ sơ nhân viên trước khi xóa.');
  }
  if (!employeeRead.data) {
    const error = new Error('Hồ sơ không còn tồn tại.');
    error.statusCode = 404;
    error.code = 'EMPLOYEE_NOT_FOUND';
    throw error;
  }

  // Một số dữ liệu cũ có thể từng lưu mã nhân viên ngay trong employees.
  const employeeCode = String(
    employeeRead.data.employee_code ||
    employeeRead.data.employeeCode ||
    employeeRead.data.staff_code ||
    employeeRead.data.staffCode ||
    ''
  ).trim();

  if (employeeCode) {
    const error = new Error('Nhân viên đã có mã PHF nên không được xóa. Hãy chuyển trạng thái ngưng hoạt động.');
    error.statusCode = 409;
    error.code = 'EMPLOYEE_CODE_LOCKED';
    throw error;
  }

  // Mã PHF hiện chủ yếu nằm trong user_accounts. Có bất kỳ tài khoản liên kết nào
  // cũng phải chặn xóa, kể cả tài khoản đang khóa/ngưng hoạt động.
  const accountRead = await supabase
    .from('user_accounts')
    .select('id,employee_code,email,status')
    .eq('employee_id', employeeId)
    .limit(1);

  if (accountRead.error && !isMissingOptionalTableError(accountRead.error, 'user_accounts')) {
    throw new Error('Không kiểm tra được tài khoản liên kết trước khi xóa.');
  }
  if (Array.isArray(accountRead.data) && accountRead.data.length > 0) {
    const error = new Error('Hồ sơ đang có tài khoản hoặc mã nhân viên liên kết nên không được xóa tại Checklist.');
    error.statusCode = 409;
    error.code = 'EMPLOYEE_ACCOUNT_LINKED';
    throw error;
  }

  // Xóa dữ liệu con trước rồi mới xóa employees. Các bảng Classroom là tùy chọn
  // để không làm hỏng môi trường chưa có đủ toàn bộ schema Classroom.
  const steps = [
    ['classroom_notification_recipients', 'employee_id', true],
    ['classroom_test_attempts', 'employee_id', true],
    ['classroom_material_progress', 'employee_id', true],
    ['classroom_learning_progress', 'employee_id', true],
    ['classroom_attendance', 'employee_id', true],
    ['classroom_enrollments', 'employee_id', true],
    ['system_notifications', 'employee_id', true],
    ['probation_records', 'employee_id', true],
    ['commitment_records', 'employee_id', true],
    ['activity_log', 'employee_id', false],
    ['evaluation_records', 'employee_id', false],
    ['test_results', 'employee_id', false],
    ['progress', 'employee_id', false],
    ['employees', 'id', false]
  ];

  const deleted = {};
  for (const [table, column, optionalDuringUpgrade] of steps) {
    const result = await supabase
      .from(table)
      .delete()
      .eq(column, employeeId)
      .select(column);

    if (result.error) {
      if (optionalDuringUpgrade && isMissingOptionalTableError(result.error, table)) {
        console.warn(`[PHF Supabase] Bỏ qua ${table} vì bảng/cột chưa có trong schema hiện tại.`);
        continue;
      }
      console.error(`[PHF Supabase] Không xóa được ${table}:`, result.error.message || result.error);
      throw new Error(`Chưa thể xóa dữ liệu tại bảng ${table}. Không tiếp tục để tránh xóa dở dang.`);
    }
    deleted[table] = Array.isArray(result.data) ? result.data.length : 0;
  }

  const refreshedData = await readDataFromSupabase();
  return {
    ok: true,
    action: 'deleteEmployee',
    employeeId,
    deleted,
    data: refreshedData
  };
}

async function saveProbationRecord(payload) {
  assertStorageConfigured();
  const record = payload.probationRecord || {};
  const employeeId = String(record.employeeId || payload?.employee?.id || '').trim();
  if (!employeeId) throw new Error('Không xác định được nhân viên thử việc.');

  const now = new Date().toISOString();
  const currentUser = String(payload.actorName || '').trim();
  const role = payload.adminMode ? 'admin' : (payload.managerMode ? 'manager' : 'learner');
  if (role === 'learner') {
    const error = new Error('Học viên không được cập nhật kết quả thử việc.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  if (!hasSupabaseEnv) {
    const data = readDataFile();
    data.probationRecords = Array.isArray(data.probationRecords) ? data.probationRecords : [];
    const idx = data.probationRecords.findIndex(x => String(x.employeeId || '') === employeeId);
    const old = idx >= 0 ? data.probationRecords[idx] : {};
    const next = {
      ...old,
      id: old.id || `probation-${employeeId}`,
      employeeId,
      expectedEndDate: record.expectedEndDate || old.expectedEndDate || '',
      status: record.status || old.status || 'in_progress',
      conclusion: record.conclusion != null ? String(record.conclusion) : (old.conclusion || ''),
      notes: record.notes != null ? String(record.notes) : (old.notes || ''),
      extensionReason: record.extensionReason != null ? String(record.extensionReason) : (old.extensionReason || ''),
      proposedBy: role === 'manager' ? (currentUser || old.proposedBy || '') : (record.proposedBy || old.proposedBy || ''),
      proposedAt: role === 'manager' ? now : (old.proposedAt || ''),
      confirmedBy: role === 'admin' && record.confirm === true ? currentUser : (old.confirmedBy || ''),
      confirmedAt: role === 'admin' && record.confirm === true ? now : (old.confirmedAt || ''),
      updatedAt: now,
      createdAt: old.createdAt || now
    };
    if (idx >= 0) data.probationRecords[idx] = next; else data.probationRecords.push(next);
    writeDataFile(data);
    return { ok:true, action:'saveProbation', probationRecord:next, data:await readDataFromFile({role}) };
  }

  const { data: existing } = await supabase
    .from('probation_records')
    .select('*')
    .eq('employee_id', employeeId)
    .maybeSingle();

  const next = {
    id: existing?.id || `probation-${employeeId}`,
    employee_id: employeeId,
    expected_end_date: record.expectedEndDate || existing?.expected_end_date || null,
    status: record.status || existing?.status || 'in_progress',
    conclusion: record.conclusion != null ? String(record.conclusion) : (existing?.conclusion || ''),
    notes: record.notes != null ? String(record.notes) : (existing?.notes || ''),
    extension_reason: record.extensionReason != null ? String(record.extensionReason) : (existing?.extension_reason || ''),
    proposed_by: role === 'manager' ? (currentUser || existing?.proposed_by || '') : (record.proposedBy || existing?.proposed_by || ''),
    proposed_at: role === 'manager' ? now : (existing?.proposed_at || null),
    confirmed_by: role === 'admin' && record.confirm === true ? currentUser : (existing?.confirmed_by || null),
    confirmed_at: role === 'admin' && record.confirm === true ? now : (existing?.confirmed_at || null),
    created_at: existing?.created_at || now,
    updated_at: now,
    metadata: { ...(existing?.metadata || {}), startSource:'employees.study_start_date' }
  };

  const { data: saved, error } = await supabase
    .from('probation_records')
    .upsert(next, { onConflict:'employee_id' })
    .select('*')
    .single();

  if (error) {
    if (isMissingOptionalTableError(error, 'probation_records')) {
      throw new Error('Chưa thể lưu thử việc vì database chưa được nâng cấp. Vui lòng chạy file SQL Bản 27.0.');
    }
    throw error;
  }

  return { ok:true, action:'saveProbation', probationRecord:mapProbationRecord(saved) };
}

async function updateNotificationState(payload) {
  assertStorageConfigured();
  const action = String(payload.action || '');
  const role = payload.adminMode ? 'admin' : (payload.managerMode ? 'manager' : 'learner');
  const actor = String(payload.actorName || '').trim();
  const now = new Date().toISOString();
  const ids = action === 'markAllNotificationsRead'
    ? (Array.isArray(payload.notificationIds) ? payload.notificationIds : [])
    : [String(payload.notificationId || '')].filter(Boolean);

  if (!ids.length) return { ok:true, action, updated:0 };

  if (!hasSupabaseEnv) {
    const data = readDataFile();
    data.systemNotifications = Array.isArray(data.systemNotifications) ? data.systemNotifications : [];
    ids.forEach(id => {
      const idx = data.systemNotifications.findIndex(x => String(x.id || '') === id);
      const old = idx >= 0 ? data.systemNotifications[idx] : { id };
      const next = {
        ...old,
        id,
        status: action === 'resolveNotification' ? 'resolved' : 'read',
        read_at: old.read_at || now,
        resolved_at: action === 'resolveNotification' ? now : (old.resolved_at || ''),
        resolved_by: action === 'resolveNotification' ? actor : (old.resolved_by || ''),
        updated_at: now
      };
      if (idx >= 0) data.systemNotifications[idx] = next; else data.systemNotifications.push(next);
    });
    writeDataFile(data);
    return { ok:true, action, updated:ids.length };
  }

  const rows = ids.map(id => ({
    id,
    target_role: role,
    notification_type: 'derived',
    title: 'Trạng thái thông báo',
    message: '',
    priority: 'normal',
    status: action === 'resolveNotification' ? 'resolved' : 'read',
    read_at: now,
    resolved_at: action === 'resolveNotification' ? now : null,
    resolved_by: action === 'resolveNotification' ? actor : null,
    updated_at: now,
    metadata: { derived:true }
  }));

  const { error } = await supabase
    .from('system_notifications')
    .upsert(rows, { onConflict:'id' });

  if (error) {
    if (isMissingOptionalTableError(error, 'system_notifications')) {
      throw new Error('Chưa thể lưu trạng thái thông báo vì database chưa được nâng cấp.');
    }
    throw error;
  }
  return { ok:true, action, updated:ids.length };
}

async function deleteEmployeeData(payload) {
  assertStorageConfigured();
  const employeeId = String(payload?.employee?.id || '').trim();
  return runWithEmployeeWriteQueue(employeeId, () => (
    hasSupabaseEnv ? deleteEmployeeFromSupabase(payload) : deleteEmployeeFromFile(payload)
  ));
}

function assertStorageConfigured() {
  if (hasSupabaseEnv || allowLocalData) return;
  const error = new Error('Hệ thống chưa được cấu hình kết nối dữ liệu. Vui lòng kiểm tra SUPABASE_URL và SUPABASE_SECRET_KEY.');
  error.code = 'STORAGE_NOT_CONFIGURED';
  error.status = 503;
  throw error;
}

async function readData(options = {}) {
  assertStorageConfigured();
  return hasSupabaseEnv ? readDataFromSupabase(options) : readDataFromFile(options);
}

async function saveData(payload) {
  assertStorageConfigured();
  if (payload?.action === 'deleteEmployee') {
    return deleteEmployeeData(payload);
  }
  if (payload?.action === 'saveProbation') {
    return saveProbationRecord(payload);
  }
  if (['markNotificationRead','markAllNotificationsRead','resolveNotification'].includes(payload?.action)) {
    return updateNotificationState(payload);
  }
  const employeeId = String(payload?.employee?.id || '').trim();
  return runWithEmployeeWriteQueue(employeeId, () => (
    hasSupabaseEnv ? saveDataToSupabase(payload) : saveDataToFile(payload)
  ));
}

module.exports = { readData, saveData, deleteEmployeeData, saveProbationRecord, updateNotificationState };
