'use strict';
/*
 * PHF Checklist — Workstream B backend service (Supabase-touching layer).
 * Lớp mỏng bọc quanh logic thuần ở lib/checklist-late-reconciliation.js, theo đúng khuôn
 * mẫu lib/checklist-template-retroactive-service.js của Workstream A (logic thuần tách
 * riêng để unit-test không cần DB, service chỉ lo I/O + quyền + audit).
 *
 * QUYỀN — KHÔNG dùng requireAdmin() hardcode cho hành động "ghi nhận nhanh" của người có
 * quyền ghi nhận (Trưởng ca CHỈ là một ví dụ — có thể là Trưởng bộ phận, Trợ lý Giám đốc,
 * Giám đốc, Admin, hay bất kỳ vai trò nào khác có capability record_violation + scope bao
 * phủ nhân sự được chọn): dùng lại đúng requireViolationPermission()/resolveViolationPermission()
 * đã export từ lib/checklist-violations.js (nguồn quyền thật, đọc checklist_permission_grants,
 * so khớp scope qua subjectMatchesScope() dùng chung với lib/checklist-scope.js) — dùng ĐÚNG
 * record_scope (action='record'), KHÔNG BAO GIỜ dùng view_scope (action='view') cho việc ghi
 * nhận, vì 2 phạm vi này có thể khác nhau (1 tài khoản có thể xem rộng nhưng chỉ được ghi hẹp,
 * hoặc ngược lại — xem resolveViolationPermission() ở checklist-violations.js). BCC
 * upload/duyệt/điều chỉnh điểm/hủy vẫn Admin-only theo đúng nghiệp vụ đã chốt.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const {
  requireViolationPermission,
  permissionEmployees,
  cancelChecklistViolation
} = require('./checklist-violations');
const { PRESETS } = require('./checklist-permissions');
const recon = require('./checklist-late-reconciliation');

const okEnv = Boolean(
  String(process.env.SUPABASE_URL || '').trim() &&
  String(process.env.SUPABASE_SECRET_KEY || '').trim()
);
const supabase = okEnv
  ? createClient(
      String(process.env.SUPABASE_URL).trim(),
      String(process.env.SUPABASE_SECRET_KEY).trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : null;

const MANAGER_OBSERVATION_TABLE = 'checklist_late_manager_observations';
const IMPORT_TABLE = 'checklist_late_bcc_imports';
const IMPORT_ROW_TABLE = 'checklist_late_bcc_import_rows';
const VIOLATION_TABLE = 'checklist_violation_records';
const LATE_CRITERION_CODE = 'PHF-DITRE-01';
const LATE_CRITERION_NAME = 'Đi trễ so với giờ vào ca';

function t(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return t(value).toUpperCase(); }
function isoDate(value) {
  const s = t(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}
function fail(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  throw error;
}
function actor(session) {
  return {
    id: t(session?.account?.id || session?.sub),
    name: t(session?.account?.name || session?.account?.email || session?.email),
    employeeCode: upper(session?.employeeCode || session?.account?.employeeCode),
    role: t(session?.role).toLowerCase()
  };
}
function requireAdmin(session, message) {
  if (!session || session.role !== 'admin') {
    fail(message || 'Chỉ Admin được thực hiện thao tác này.', 403, 'CHECKLIST_LATE_RECON_ADMIN_ONLY');
  }
}
function requireDb() {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
}

// P0 backend guard — LOCAL ACTIVATION (2026-08-16): audit lifecycle đầy đủ (request_id/
// import_row_key idempotency, re-approve đọc lại linked_violation_id không tạo trùng, official
// record_status='official'+is_test=false, monthly checklistBreakdown() chỉ đọc đúng 2 điều kiện
// đó — xem scripts/test-checklist-late-approval-activation-2026-08.js) PASS, band-selection bug
// (REJECTED_BANDS cho case Cần đối chiếu->Không duyệt) đã fix. Bật true CHỈ Ở LOCAL — biến hằng
// cứng (không đọc env) vì đây là quyết định nghiệp vụ có chủ đích, không phải cấu hình môi trường.
// KHÔNG được coi đây là đã release Production — release gate Production là quyết định RIÊNG,
// KHÔNG tự suy ra từ việc flag này = true ở local.
const LATE_APPROVAL_ENABLED = true;
function requireLateApprovalEnabled() {
  if (!LATE_APPROVAL_ENABLED) {
    fail('Phê duyệt/ghi nhận chính thức Đi trễ chưa được kích hoạt ở giai đoạn này.', 403, 'CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED');
  }
}

/* ============================================================================
 * A) NGƯỜI CÓ QUYỀN GHI NHẬN — "Ghi nhận nhanh" đi trễ. KHÔNG hardcode theo tên vai trò
 *    (Trưởng ca CHỈ là một ví dụ — có thể là Trưởng bộ phận, Trợ lý Giám đốc, Giám đốc,
 *    Admin, hay bất kỳ tài khoản nào khác). Route qua
 *    requireViolationPermission(session,'record', rows) — CHÍNH LÀ hệ thống capability/scope
 *    thật (đọc checklist_permission_grants, so khớp record_scope — KHÔNG phải view_scope —
 *    qua subjectMatchesScope() dùng chung), hoàn toàn không hardcode role/preset ở đây.
 *    Server luôn tự resolve employee_code/department/branch/scope từ input — không tin
 *    department/branch client tự gửi để mở rộng phạm vi (crafted request).
 * ============================================================================ */
async function recordManagerLateObservation(session, input = {}) {
  requireDb();
  const employeeCode = upper(input.employeeCode || input.employee_code);
  const occurredDate = isoDate(input.occurredDate || input.occurred_date);
  const managerDecision = t(input.managerDecision || input.manager_decision);
  const note = t(input.note);
  if (!employeeCode) fail('Thiếu mã nhân sự.', 400, 'CHECKLIST_LATE_RECON_EMPLOYEE_REQUIRED');
  if (managerDecision !== recon.MANAGER_DECISION.APPROVED && managerDecision !== recon.MANAGER_DECISION.REJECTED) {
    fail('Phải chọn đúng một trong hai: Duyệt / Không duyệt.', 400, 'CHECKLIST_LATE_RECON_MANAGER_DECISION_REQUIRED');
  }

  // Xác định phòng ban/chi nhánh THẬT từ hồ sơ phân công (không tin client gửi lên) — dùng
  // permissionEmployees() (đã export sẵn từ checklist-violations.js) để lấy đúng subject cần
  // so khớp RECORD scope (không phải view scope), giống hệt cách requireViolationPermission()
  // đang tự kiểm tra trong record(). Đây là bước duy nhất quyết định "được ghi nhận cho ai" —
  // hoàn toàn dựa trên capability+scope thật của session, KHÔNG có bất kỳ so khớp role-string nào.
  const permission = await requireViolationPermission(session, 'record');
  const scopedEmployees = await permissionEmployees(permission);
  const subject = scopedEmployees.find(row => upper(row.employee_code) === employeeCode);
  if (!subject) {
    fail('Nhân sự nằm ngoài phạm vi được cấp quyền ghi nhận.', 403, 'CHECKLIST_VIOLATION_OUT_OF_SCOPE', { employeeCode });
  }

  const currentActor = actor(session);
  const requestId = t(input.requestId || input.request_id) ||
    ('mlo-' + employeeCode + '-' + occurredDate + '-' + Date.now().toString(36));

  const row = {
    employee_code: employeeCode,
    employee_name: t(subject.employee_name),
    department: t(subject.department),
    branch: t(subject.branch),
    occurred_date: occurredDate,
    manager_decision: managerDecision,
    note,
    request_id: requestId,
    created_by: currentActor.id,
    created_by_name: currentActor.name,
    // recorder_role_label: DỮ LIỆU THẬT của tài khoản đang ghi nhận (tên preset quyền hiện có,
    // vd "Trưởng ca bán hàng"/"Trưởng bộ phận"/"Trợ lý Giám đốc – Điều hành web") — CHỈ dùng để
    // HIỂN THỊ (byline "ghi nhận bởi: X (chức danh thật)"), không dùng để quyết định quyền/logic.
    recorder_role_label: t((PRESETS[permission.presetCode] || {}).name || permission.presetCode)
  };

  const { data, error } = await supabase
    .from(MANAGER_OBSERVATION_TABLE)
    .upsert(row, { onConflict: 'request_id', ignoreDuplicates: true })
    .select('*');
  if (error) throw error;

  let saved = data && data[0];
  if (!saved) {
    const read = await supabase.from(MANAGER_OBSERVATION_TABLE).select('*').eq('request_id', requestId).maybeSingle();
    if (read.error) throw read.error;
    saved = read.data;
  }
  return { saved: true, record: saved };
}
// Bí danh tương thích ngược — TÊN CHUNG (recordManagerLateObservation) là nguồn chính, tên cũ
// chỉ giữ lại để không phá vỡ các nơi gọi cũ nếu còn sót (server.js dùng tên chung làm chính).
const recordShiftLeadLateObservation = recordManagerLateObservation;

/* 2026-08-16 (Trợ lý thẩm định): trước đây hàm này CHỈ kiểm tra caller có quyền 'view' (capability
   view_violations) rồi trả TOÀN BỘ observation (limit 500) — KHÔNG lọc theo view_scope thật của
   caller. Với Admin/Trợ lý (scope all_company) hành vi không đổi (vẫn thấy toàn công ty đúng
   quyền), nhưng với Trưởng ca/quản lý có scope hẹp hơn (department/direct_reports) đây là lỗ hổng
   thật — họ đang thấy nhiều hơn scope được cấp. Fix tái dùng ĐÚNG permissionEmployees() (đã dùng
   cho exportLateReconciliation ở dưới, cùng pattern) để lọc theo scope thật — KHÔNG đổi capability
   gate (vẫn requireViolationPermission(session,'view')), KHÔNG tạo permission/scope mới. */
async function listManagerLateObservations(session, input = {}) {
  requireDb();
  const permission = await requireViolationPermission(session, 'view');
  const employeeCode = upper(input.employeeCode);
  let query = supabase.from(MANAGER_OBSERVATION_TABLE).select('*').order('occurred_date', { ascending: false }).limit(500);
  if (employeeCode) {
    query = query.eq('employee_code', employeeCode);
  } else if (permission.scopeType !== 'all_company') {
    const scopedEmployees = await permissionEmployees(permission);
    const allowedCodes = [...new Set(scopedEmployees.map(row => upper(row.employee_code)).filter(Boolean))];
    if (!allowedCodes.length) return { records: [] };
    query = query.in('employee_code', allowedCodes);
  }
  if (input.dateFrom) query = query.gte('occurred_date', isoDate(input.dateFrom));
  if (input.dateTo) query = query.lte('occurred_date', isoDate(input.dateTo));
  const { data, error } = await query;
  if (error) throw error;
  return { records: data || [] };
}
const listShiftLeadLateObservations = listManagerLateObservations;

/* 2026-08-16: "Kiểm tra ghi nhận cấp trên" ở màn Admin (Admin → Ghi nhận lỗi → Đi trễ) cần
   Admin-only THẬT ở backend — requireAdmin() (role==='admin'), KHÔNG dùng lại capability 'view'
   chung như listManagerLateObservations() ở trên (Trợ lý cũng có view_scope=all_company nên
   nếu tái dùng đúng hàm đó, Trợ lý sẽ vô tình có cùng khả năng xem "màn Admin-only" dù chủ đích
   nghiệp vụ đã chốt Trợ lý chỉ dùng reviewer shell riêng theo quyền thẩm định — xem
   listManagerLateObservations()). Vì đã requireAdmin(), Admin xem TOÀN BỘ observation không giới
   hạn theo scope của chính Admin (khác listManagerLateObservations vốn lọc theo scope của caller
   cho Trưởng ca/Trợ lý) — đúng nghiệp vụ "Admin đối soát toàn công ty". Read-only: KHÔNG sửa/xóa
   observation, KHÔNG scoring, KHÔNG approve. */
async function listAdminLateManagerObservations(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được xem danh sách ghi nhận cấp trên (Admin-only).');
  requireDb();
  const employeeCode = upper(input.employeeCode);
  let query = supabase.from(MANAGER_OBSERVATION_TABLE).select('*').order('occurred_date', { ascending: false }).limit(2000);
  if (employeeCode) query = query.eq('employee_code', employeeCode);
  if (input.dateFrom) query = query.gte('occurred_date', isoDate(input.dateFrom));
  if (input.dateTo) query = query.lte('occurred_date', isoDate(input.dateTo));
  const managerDecision = t(input.managerDecision);
  if (managerDecision === recon.MANAGER_DECISION.APPROVED || managerDecision === recon.MANAGER_DECISION.REJECTED) {
    query = query.eq('manager_decision', managerDecision);
  }
  const { data, error } = await query;
  if (error) throw error;
  return { records: data || [] };
}

/* ============================================================================
 * B) ADMIN — Upload BCC -> preview (KHÔNG ghi gì chính thức).
 *    Backend tự tính lại điểm/trạng thái — KHÔNG BAO GIỜ tin trực tiếp cột Điểm/Trạng
 *    thái/Mã tiêu chí do file Excel tự khai.
 *
 *    Gap 1 (2026-08-14): input là các dòng THÔ đọc từ sheet "DỮ LIỆU" của
 *    PHF_MAU_GHI_NHAN_LOI_LATE_2026-08-14.xlsx (13 cột cố định, key = tên cột tiếng Việt
 *    — đúng dạng XLSX.utils.sheet_to_json({defval:''}) trả về ở client). Nhận diện cột +
 *    validate từng dòng được tách ra lớp thuần recon.parseBccExcelRows() để test không cần
 *    Excel/DB thật; service chỉ lo tra cứu DB cho các dòng ĐÃ HỢP LỆ và báo cáo rõ dòng nào
 *    bị loại kèm lý do (không âm thầm bỏ qua).
 * ============================================================================ */
/* Nguồn dữ liệu hợp lệ cho preview — whitelist tối thiểu, KHÔNG tin chuỗi client gửi tự do.
   'BCC' vẫn là mặc định khi không truyền/ truyền giá trị lạ, để KHÔNG đổi hành vi Excel hiện có. */
function normalizeUploadSource(source) {
  const s = String(source || '').trim().toUpperCase();
  return s === 'MANUAL' ? 'MANUAL' : 'BCC';
}

async function previewBccUpload(session, rows = [], source) {
  requireAdmin(session, 'Chỉ Admin được tải lên dữ liệu BCC.');
  requireDb();
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) fail('Không có dòng dữ liệu BCC nào để xem trước.', 400, 'CHECKLIST_LATE_RECON_UPLOAD_EMPTY');
  if (input.length > 5000) fail('Mỗi lượt chỉ được tải tối đa 5000 dòng.', 400, 'CHECKLIST_LATE_RECON_UPLOAD_LIMIT');
  const uploadSource = normalizeUploadSource(source);

  const parsed = recon.parseBccExcelRows(input);
  if (!parsed.validRows.length) {
    fail('Không có dòng dữ liệu hợp lệ nào trong file (kiểm tra cột/định dạng).', 400, 'CHECKLIST_LATE_RECON_UPLOAD_ROW_INVALID', {
      missingColumns: parsed.missingColumns,
      invalidRows: parsed.invalidRows.map(r => ({ excelRowNumber: r.excelRowNumber, reasons: r.reasons }))
    });
  }

  // uploadSource đi vào normalizedRows TRƯỚC khi computeSuggestion()/buildImportRowKey() chạy
  // ở dưới — bắt buộc để identity/importRowKey phản ánh ĐÚNG nguồn ngay từ lúc hình thành, KHÔNG
  // được đổi nhãn source ở tầng trên (client) sau khi identity/key đã bake theo nguồn khác.
  const normalizedRows = parsed.validRows.map(r => ({
    rowIndex: r.rowIndex,
    excelRowNumber: r.excelRowNumber,
    employeeCode: r.employeeCode,
    employeeNameRaw: r.untrusted.employeeNameRaw, // hiển thị tham khảo — KHÔNG dùng để ghi
    occurredDate: r.occurredDate,
    shift: r.shift,
    checkinTime: r.checkinTime,
    location: r.location,
    minutesLate: r.minutesLate,
    adjustReasonRaw: r.adjustReason,
    bccTransactionId: '', // sheet thật 13 cột không có cột mã giao dịch riêng — identity dùng employee+date+ca/giờ
    source: uploadSource
  }));

  // Xác thực Mã nhân viên là nhân sự THẬT và nằm trong phạm vi (không tin mã Excel tự khai) —
  // dùng đúng permissionEmployees() như luồng ghi nhận thủ công, KHÔNG tự suy diễn nhân sự lạ.
  const permission = await requireViolationPermission(session, 'view');
  const scopedEmployees = await permissionEmployees(permission);
  const scopedByCode = new Map(scopedEmployees.map(row => [upper(row.employee_code), row]));
  const unknownEmployeeRows = normalizedRows.filter(r => !scopedByCode.has(r.employeeCode));
  const knownRows = normalizedRows.filter(r => scopedByCode.has(r.employeeCode));
  if (!knownRows.length) {
    fail('Không có dòng nào khớp mã nhân viên hợp lệ trong phạm vi.', 400, 'CHECKLIST_LATE_RECON_UPLOAD_NO_KNOWN_EMPLOYEE', {
      unknownEmployeeCodes: [...new Set(unknownEmployeeRows.map(r => r.employeeCode))]
    });
  }

  const employeeCodes = [...new Set(knownRows.map(r => r.employeeCode))];
  const dates = [...new Set(knownRows.map(r => r.occurredDate))];

  const [managerObservationRead, officialRead] = await Promise.all([
    supabase.from(MANAGER_OBSERVATION_TABLE).select('*').in('employee_code', employeeCodes).in('occurred_date', dates),
    supabase.from(VIOLATION_TABLE)
      .select('id,employee_code,occurred_date,late_standard_points,points,manager_decision,record_status,import_row_key')
      .eq('is_test', false).eq('criterion_code', LATE_CRITERION_CODE)
      .in('employee_code', employeeCodes)
  ]);
  if (managerObservationRead.error) throw managerObservationRead.error;
  if (officialRead.error) throw officialRead.error;
  const managerRecords = managerObservationRead.data || [];
  const officialByImportKey = new Map((officialRead.data || []).filter(r => r.import_row_key).map(r => [r.import_row_key, r]));

  // Cảnh báo tần suất CỘNG DỒN toàn kỳ (không chỉ file vừa upload) — đếm theo band trên
  // TOÀN BỘ bản ghi chính thức hiện có (khớp late_standard_points === band.points) cộng số
  // lần xuất hiện của band đó trong chính file đang xem trước. THAM KHẢO CHUNG cho mọi business
  // case (Không báo/Không duyệt/Duyệt) — KHÔNG BAO GIỜ chặn/tự đổi điểm, xem buildFrequencyWarning().
  // Quota "4 lần Duyệt/tháng" (2026-08-16, dưới đây) là cơ chế RIÊNG, CHÍNH THỨC cho case Duyệt —
  // supersede vai trò cảnh báo tần suất chung khi xét case Duyệt cụ thể, nhưng KHÔNG xoá cơ chế
  // tham khảo chung này (vẫn còn giá trị cho Không báo/Không duyệt, chưa có quota riêng).
  const officialAllForFreq = (officialRead.data || []).filter(r => r.record_status === 'official');
  function periodOccurrenceCount(employeeCode, band, uploadFileCountSoFar) {
    const officialCount = officialAllForFreq.filter(r => upper(r.employee_code) === employeeCode && Number(r.late_standard_points) === band.points).length;
    return officialCount + uploadFileCountSoFar;
  }

  // Quota "4 lần Duyệt/nhân sự/tháng" (chốt 2026-08-16, xem lib/checklist-late-reconciliation.js
  // computeApprovedQuotaState) — đếm THEO CALENDAR MONTH của occurred_date, gồm cả bản ghi CHÍNH
  // THỨC đã Duyệt trước đó (officialRead) lẫn các dòng Duyệt khác trong CHÍNH file đang xem trước.
  // Bước 1 (peek): gọi computeSuggestion KHÔNG kèm quota để biết managerDecision từng dòng — hàm
  // THUẦN, gọi lại lần 2 bên dưới với quota xác định không có side-effect nào.
  const peekSuggestions = knownRows.map(r => recon.computeSuggestion(r, managerRecords.filter(s => upper(s.employee_code) === r.employeeCode)));
  const existingApprovedCountByEmployeeMonth = new Map();
  officialAllForFreq.forEach(r => {
    if (t(r.manager_decision) !== recon.MANAGER_DECISION.APPROVED) return;
    const key = upper(r.employee_code) + '|' + String(r.occurred_date || '').slice(0, 7);
    existingApprovedCountByEmployeeMonth.set(key, (existingApprovedCountByEmployeeMonth.get(key) || 0) + 1);
  });
  // Thứ tự "lần Duyệt thứ mấy trong tháng" cho các dòng Duyệt trong CHÍNH file này — sắp theo ngày
  // xảy ra tăng dần (rồi theo thứ tự dòng gốc) để có thứ tự nghiệp vụ ổn định, dễ giải thích.
  const approvedOccurrenceByRowIndex = new Map();
  const runningApprovedCountByEmployeeMonth = new Map();
  knownRows
    .map((r, idx) => ({ idx, row: r, peek: peekSuggestions[idx] }))
    .filter(x => x.peek.managerDecision === recon.MANAGER_DECISION.APPROVED)
    .sort((a, b) => t(a.row.occurredDate).localeCompare(t(b.row.occurredDate)) || a.idx - b.idx)
    .forEach(({ idx, row }) => {
      const monthKey = upper(row.employeeCode) + '|' + t(row.occurredDate).slice(0, 7);
      const existing = existingApprovedCountByEmployeeMonth.get(monthKey) || 0;
      const soFar = runningApprovedCountByEmployeeMonth.get(monthKey) || 0;
      runningApprovedCountByEmployeeMonth.set(monthKey, soFar + 1);
      approvedOccurrenceByRowIndex.set(idx, existing + soFar + 1);
    });

  const uploadBandCounter = new Map(); // employeeCode|bandKey -> count trong CHÍNH file này (đếm dồn khi lặp qua)
  const preview = knownRows.map((r, idx) => {
    const subject = scopedByCode.get(r.employeeCode) || {};
    const suggestion = recon.computeSuggestion(
      r,
      managerRecords.filter(s => upper(s.employee_code) === r.employeeCode),
      { approvedOccurrenceNumber: approvedOccurrenceByRowIndex.get(idx) }
    );
    const importRowKey = recon.buildImportRowKey(r);
    const alreadyOfficial = officialByImportKey.get(importRowKey) || null;

    const bandKey = r.employeeCode + '|' + suggestion.band.key;
    const soFar = uploadBandCounter.get(bandKey) || 0;
    uploadBandCounter.set(bandKey, soFar + 1);
    const occurrencesInPeriod = periodOccurrenceCount(r.employeeCode, suggestion.band, soFar + 1);
    const frequencyWarning = recon.buildFrequencyWarning({
      band: suggestion.band,
      occurrencesInPeriod,
      managerDecision: suggestion.managerDecision,
      employeeName: subject.employee_name || r.employeeNameRaw
    });

    // suggestedPoints ở tầng thuần là null khi 'conflict_needs_review' HOẶC 'approved_over_quota'
    // (chưa có điểm gợi ý xác định cho tới khi Admin tự xử lý — xem computeSuggestion). Cột DB
    // suggested_points là NOT NULL nên lưu 0 làm placeholder — UI/Admin PHẢI dựa vào
    // businessStatus (không phải cột điểm) để biết dòng này cần đối chiếu/kiểm tra.
    const rowStatus = alreadyOfficial
      ? recon.ROW_STATUS.APPLIED
      : (suggestion.matchStatus === 'conflict_needs_review' || suggestion.businessStatus === 'approved_over_quota')
        ? recon.ROW_STATUS.NEEDS_REVIEW
        : recon.ROW_STATUS.PENDING_APPROVAL;

    return {
      ...r,
      employeeName: subject.employee_name || '',
      department: subject.department || '',
      branch: subject.branch || '',
      importRowKey,
      identity: suggestion.identity,
      matchStatus: suggestion.matchStatus,
      // businessStatus: nhãn nghiệp vụ CHỦ ĐẠO cho bảng Admin (2026-08-16) — 'no_report' (Case A,
      // không báo/không xin phép) | 'rejected' (Case B, TBP không duyệt) | 'approved' (Case C,
      // trong hạn mức 4 lần/tháng) | 'approved_over_quota' (Case C, vượt hạn mức — Admin tự quyết)
      // | 'conflict_needs_review' | 'ambiguous_needs_review' (cả 2 gộp "Cần kiểm tra" ở UI).
      businessStatus: suggestion.businessStatus,
      approvedQuota: suggestion.approvedQuota,
      // manager_decision_suggested (DB) là NOT NULL — 'conflict' là sentinel riêng cho trường
      // hợp nhiều người ghi nhận mâu thuẫn (suggestion.managerDecision=null ở tầng thuần); KHÁC
      // với 3 giá trị chuẩn approved/rejected/no_record dùng cho bản ghi CHÍNH THỨC.
      managerDecisionSuggested: suggestion.managerDecision == null ? 'conflict' : suggestion.managerDecision,
      standardPoints: suggestion.standardPoints,
      // standardRejectedPoints: điểm chuẩn "TBP Không duyệt" (REJECTED_BANDS) — cần lưu riêng để
      // approveLateEvents() dùng ĐÚNG băng khi 1 dòng "Cần đối chiếu" được Admin kết luận là
      // Không duyệt (KHÔNG được lấy nhầm standard_points/LATE_BANDS cho case B, xem audit
      // approveLateEvents 2026-08-16).
      standardRejectedPoints: suggestion.standardRejectedPoints,
      suggestedPoints: suggestion.suggestedPoints == null ? 0 : suggestion.suggestedPoints,
      suggestionLabel: suggestion.suggestionLabel,
      // recorders: audit trail từng người ghi nhận đã khớp sự kiện này (agreed hoặc conflict) —
      // luôn giữ nguyên TỪNG input gốc, không chỉ mỗi kết quả gộp/kết luận cuối.
      recorders: suggestion.recorders,
      reconciliationStatus: suggestion.reconciliationStatus,
      frequencyWarning,
      alreadyOfficialViolationId: alreadyOfficial ? alreadyOfficial.id : null,
      rowStatus
    };
  });

  return {
    preview,
    totalRows: preview.length,
    needsReviewCount: preview.filter(r => r.matchStatus === 'ambiguous_needs_review').length,
    alreadyOfficialCount: preview.filter(r => r.alreadyOfficialViolationId).length,
    // overQuotaCount: dòng Duyệt vượt 4 lần/tháng (2026-08-16) — cảnh báo tổng hợp riêng cho
    // Admin, KHÔNG gộp vào needsReviewCount (giữ nguyên ý nghĩa/giá trị field đó cho consumer cũ).
    overQuotaCount: preview.filter(r => r.businessStatus === 'approved_over_quota').length,
    // Báo cáo nhận diện cột + dòng bị loại — Gap 1: KHÔNG âm thầm bỏ qua, luôn tường minh.
    columnReport: {
      expectedColumns: parsed.expectedColumns,
      recognizedColumns: parsed.recognizedColumns,
      missingColumns: parsed.missingColumns,
      extraColumns: parsed.extraColumns
    },
    invalidRows: parsed.invalidRows.map(r => ({ excelRowNumber: r.excelRowNumber, reasons: r.reasons })),
    unknownEmployeeRows: unknownEmployeeRows.map(r => ({ excelRowNumber: r.excelRowNumber, employeeCode: r.employeeCode })),
    validRowCount: knownRows.length,
    invalidRowCount: parsed.invalidRows.length,
    unknownEmployeeRowCount: unknownEmployeeRows.length
  };
}

/* Ghi lại 1 lượt upload đã preview thành staging thật (checklist_late_bcc_imports/rows) để
   phục vụ đối soát nhiều lần / nhiều phiên. */
async function createBccImport(session, { fileName, previewRows } = {}) {
  requireAdmin(session, 'Chỉ Admin được lưu lượt tải BCC.');
  requireDb();
  const rows = Array.isArray(previewRows) ? previewRows : [];
  if (!rows.length) fail('Không có dữ liệu để lưu.', 400, 'CHECKLIST_LATE_RECON_IMPORT_EMPTY');
  const currentActor = actor(session);
  const dates = rows.map(r => r.occurredDate).filter(Boolean).sort();

  const importInsert = await supabase.from(IMPORT_TABLE).insert({
    file_name: t(fileName),
    period_start: dates[0] || null,
    period_end: dates[dates.length - 1] || null,
    uploaded_by: currentActor.id,
    uploaded_by_name: currentActor.name,
    row_count: rows.length,
    status: 'previewed'
  }).select('*').single();
  if (importInsert.error) throw importInsert.error;
  const importRow = importInsert.data;

  const rowInserts = rows.map((r, index) => ({
    import_id: importRow.id,
    row_index: index,
    employee_code: r.employeeCode,
    employee_name_raw: r.employeeNameRaw,
    occurred_date: r.occurredDate,
    shift: r.shift,
    checkin_time: r.checkinTime,
    minutes_late: r.minutesLate,
    bcc_transaction_id: r.bccTransactionId,
    source: r.source,
    bcc_identity: r.identity,
    import_row_key: r.importRowKey,
    match_status: r.matchStatus,
    manager_decision_suggested: r.managerDecisionSuggested,
    standard_points: r.standardPoints,
    suggested_points: r.suggestedPoints,
    row_status: r.rowStatus,
    // frequency_reference_snapshot: KHÔNG có cột riêng cho businessStatus/approvedQuota/
    // standardRejectedPoints (2026-08-16, tránh migration chỉ để thêm field) — gộp thêm vào
    // đúng cột jsonb đã có sẵn cho mục đích "snapshot tham khảo lúc preview". approveLateEvents()
    // đọc lại các field này để: (a) re-validate bulk-eligibility (Gap 7, không tin thẳng client),
    // (b) chọn ĐÚNG băng điểm khi Admin kết luận 1 dòng "Cần đối chiếu" là Không duyệt.
    frequency_reference_snapshot: {
      ...(r.frequencyWarning || {}),
      businessStatus: r.businessStatus,
      approvedQuota: r.approvedQuota || null,
      standardRejectedPoints: r.standardRejectedPoints
    },
    // recorders_snapshot: audit trail từng người đã ghi nhận sự kiện này lúc preview (agreed
    // hoặc conflict) — giữ nguyên để Admin xem lại ở bước phê duyệt và để export sau này.
    recorders_snapshot: Array.isArray(r.recorders) ? r.recorders : []
  }));
  const rowsInsert = await supabase.from(IMPORT_ROW_TABLE).insert(rowInserts).select('*');
  if (rowsInsert.error) throw rowsInsert.error;
  return { import: importRow, rows: rowsInsert.data || [] };
}

/* ============================================================================
 * C) ADMIN — Đối soát khi trùng khoảng ngày với các import trước (3 lựa chọn).
 * ============================================================================ */
async function reconcileBccImport(session, { importId, choice, rowDecisions } = {}) {
  requireAdmin(session, 'Chỉ Admin được đối soát dữ liệu BCC.');
  requireDb();
  if (!Object.values(recon.RECONCILE_CHOICE).includes(choice)) {
    fail('Lựa chọn đối soát không hợp lệ.', 400, 'CHECKLIST_LATE_RECON_CHOICE_INVALID');
  }
  const currentImportRead = await supabase.from(IMPORT_ROW_TABLE).select('*').eq('import_id', importId);
  if (currentImportRead.error) throw currentImportRead.error;
  const currentRows = currentImportRead.data || [];
  if (!currentRows.length) fail('Không tìm thấy lượt tải BCC.', 404, 'CHECKLIST_LATE_RECON_IMPORT_NOT_FOUND');

  const employeeCodes = [...new Set(currentRows.map(r => r.employee_code))];
  const priorRead = await supabase.from(IMPORT_ROW_TABLE)
    .select('*').neq('import_id', importId).in('employee_code', employeeCodes);
  if (priorRead.error) throw priorRead.error;
  const priorByKey = new Map((priorRead.data || []).map(r => [r.import_row_key, {
    row: { minutesLate: r.minutes_late, shift: r.shift, checkinTime: r.checkin_time, source: r.source, transactionId: r.bcc_transaction_id },
    status: r.linked_violation_id ? 'official' : 'draft',
    importRowId: r.id
  }]));

  const newRowsForClassify = currentRows.map(r => ({
    minutesLate: r.minutes_late, shift: r.shift, checkinTime: r.checkin_time, source: r.source,
    employeeCode: r.employee_code, occurredDate: r.occurred_date, bccTransactionId: r.bcc_transaction_id,
    __rowId: r.id
  }));
  const classification = recon.classifyImportRows(newRowsForClassify, priorByKey);
  const actions = recon.applyReconciliationChoice(classification, choice, { rowDecisions: rowDecisions || {} });

  const updates = actions.map(a => ({ id: a.row.__rowId, row_status: a.rowStatus }));
  for (const u of updates) {
    const upd = await supabase.from(IMPORT_ROW_TABLE).update({ row_status: u.row_status, updated_at: new Date().toISOString() }).eq('id', u.id);
    if (upd.error) throw upd.error;
  }
  await supabase.from(IMPORT_TABLE).update({ reconciliation_choice: choice, status: 'reconciled' }).eq('id', importId);

  return { actions, updated: updates.length };
}

/* ============================================================================
 * D) ADMIN — Phê duyệt/Ghi nhận: CHỈ LÚC NÀY mới tạo bản ghi chính thức + trừ điểm.
 * ============================================================================ */
async function approveLateEvents(session, decisions = []) {
  requireAdmin(session, 'Chỉ Admin được phê duyệt ghi nhận đi trễ.');
  requireDb();
  requireLateApprovalEnabled();
  const input = Array.isArray(decisions) ? decisions : [];
  if (!input.length) fail('Không có dòng nào để phê duyệt.', 400, 'CHECKLIST_LATE_RECON_APPROVE_EMPTY');
  const currentActor = actor(session);

  // ============================================================================
  // PREFLIGHT (2026-08-16, residual "bulk approval partial-write" đã audit trước release):
  // approveLateEvents KHÔNG có transaction DB thật (không migration/refactor lớn) — nếu 1
  // decision malformed throw() GIỮA vòng lặp ghi cũ, các dòng ghi TRƯỚC đó trong CÙNG request
  // đã commit thật, các dòng SAU chưa chạy => partial write khó kiểm soát. Khắc phục TỐI THIỂU:
  // đọc TOÀN BỘ import rows liên quan (1 lượt, .in('id',...)) rồi validate TỪNG decision bằng
  // ĐÚNG 1 hàm thuần recon.evaluateApproveDecision() (dùng lại y hệt ở lượt ghi bên dưới, không
  // tính 2 lần có thể lệch nhau) TRƯỚC KHI chạm bất kỳ lệnh ghi nào. Nếu BẤT KỲ decision nào
  // (trừ dòng bulk===true bị loại vì không eligible — đó là "skip" hợp lệ theo đúng thiết kế Gap 7
  // cũ, không phải lỗi) fail validate, toàn bộ request bị reject ở đây — 0 official write, 0
  // update staging nào từng chạy.
  // ============================================================================
  const importRowIds = [...new Set(input.map(d => t(d && d.importRowId)).filter(Boolean))];
  if (importRowIds.length !== input.length) {
    fail('Mỗi dòng phê duyệt phải có importRowId hợp lệ.', 400, 'CHECKLIST_LATE_RECON_ROW_ID_REQUIRED');
  }
  const rowsRead = await supabase.from(IMPORT_ROW_TABLE).select('*').in('id', importRowIds);
  if (rowsRead.error) throw rowsRead.error;
  const rowsById = new Map((rowsRead.data || []).map(r => [r.id, r]));

  const prepared = [];
  for (const decision of input) {
    const importRowId = t(decision.importRowId);
    const importRow = rowsById.get(importRowId);
    if (!importRow) fail('Không tìm thấy dòng đối soát.', 404, 'CHECKLIST_LATE_RECON_ROW_NOT_FOUND', { importRowId });

    // Gap 7 — Phê duyệt hàng loạt: KHÔNG tin frontend tự lọc "dòng sạch". Backend tự
    // kiểm tra lại đúng điều kiện isEligibleForBulkApprove() bằng dữ liệu ĐÃ LƯU trên server
    // (match_status/frequency_reference_snapshot/suggested_points), độc lập với những gì
    // client gửi lên — 1 dòng client tưởng "sạch" nhưng thật ra không đủ điều kiện (selection
    // cũ/bị sửa) sẽ bị loại RIÊNG dòng đó, không chặn cả batch, không bị âm thầm approve. Đây
    // là "skip" hợp lệ (không phải lỗi validate) nên KHÔNG làm preflight reject cả request.
    if (decision.bulk === true) {
      const snapshot = importRow.frequency_reference_snapshot || {};
      const suggestionLike = {
        matchStatus: importRow.match_status,
        businessStatus: snapshot.businessStatus,
        suggestedPoints: (snapshot.businessStatus === 'approved_over_quota') ? null : Number(importRow.suggested_points)
      };
      const adminDecisionLike = decision.appliedPoints != null ? { appliedPoints: Number(decision.appliedPoints) } : null;
      const eligible = recon.isEligibleForBulkApprove(suggestionLike, snapshot, adminDecisionLike);
      if (!eligible) {
        prepared.push({ importRow, decision, skip: true, skipReason: 'Dòng không đủ điều kiện phê duyệt hàng loạt (server tự kiểm tra lại) — cần xử lý riêng từng dòng.' });
        continue;
      }
    }

    const evalResult = recon.evaluateApproveDecision(importRow, decision);
    if (!evalResult.ok) {
      // Reject NGUYÊN request ở đây — TRƯỚC bất kỳ lệnh ghi nào đã chạy cho request này.
      fail(evalResult.message, 400, evalResult.code, { importRowId });
    }
    prepared.push({ importRow, decision, skip: false, eval: evalResult });
  }

  // ============================================================================
  // WRITE — toàn bộ decisions[] đã qua preflight validate (trừ bulk-skip). Từ đây trở đi
  // fail() chỉ còn có thể xảy ra do lỗi hạ tầng DB thật (network/constraint), không còn do lý
  // do validation nghiệp vụ nữa — đúng mục tiêu "loại malformed input gây partial write".
  // ============================================================================
  const results = [];
  for (const item of prepared) {
    const { importRow, decision, skip } = item;
    if (skip) {
      results.push({ importRowId: importRow.id, applied: false, skipped: true, reason: item.skipReason });
      continue;
    }
    const { adminDecision, isConflict, isOverQuota, terminal, resolvedManagerDecision, differsFromSuggestion, finalPoints } = item.eval;

    if (terminal) {
      const upd = await supabase.from(IMPORT_ROW_TABLE).update({
        row_status: adminDecision === recon.ADMIN_DECISION.HOLD_FOR_REVIEW ? recon.ROW_STATUS.NEEDS_REVIEW : recon.ROW_STATUS.NOT_APPLIED,
        admin_decision: adminDecision, admin_decision_reason: t(decision.reason),
        admin_decision_by: currentActor.id, admin_decision_by_name: currentActor.name,
        admin_decision_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('id', importRow.id).select('*').maybeSingle();
      if (upd.error) throw upd.error;
      results.push({ importRowId: importRow.id, applied: false, record: null });
      continue;
    }

    const lateEventId = importRow.linked_violation_id ? importRow.late_event_id : cryptoRandomUuid();
    const violationPayload = {
      employee_code: importRow.employee_code,
      employee_name: importRow.employee_name_raw,
      criterion_code: LATE_CRITERION_CODE,
      criterion_name: LATE_CRITERION_NAME,
      criterion_group: 'Nội quy chung',
      factor: 1,
      points: finalPoints,
      late_standard_points: Number(importRow.standard_points),
      // late_minutes: LUÔN lấy từ cột "Phút trễ" đã validate integer>=0 lưu ở staging
      // (checklist_late_bcc_import_rows.minutes_late) — KHÔNG BAO GIỜ parse từ note/text tự do.
      late_minutes: Number.isFinite(Number(importRow.minutes_late)) ? Number(importRow.minutes_late) : null,
      late_adjustment_reason: differsFromSuggestion ? t(decision.reason) : '',
      occurred_date: importRow.occurred_date,
      occurred_time: importRow.checkin_time || null,
      note: 'Đi trễ đối soát BCC · nguồn ' + (importRow.source || 'BCC') +
        (importRow.bcc_transaction_id ? (' · GD ' + importRow.bcc_transaction_id) : '') +
        (importRow.shift ? (' · Ca ' + importRow.shift) : ''),
      evidence_required: false,
      has_evidence: false,
      record_status: 'official',
      is_test: false,
      request_id: importRow.import_row_key,
      manager_decision: resolvedManagerDecision,
      bcc_identity: {
        employeeCode: importRow.employee_code, occurredDate: importRow.occurred_date,
        checkinTime: importRow.checkin_time, shift: importRow.shift, source: importRow.source,
        transactionId: importRow.bcc_transaction_id
      },
      import_row_key: importRow.import_row_key,
      late_event_id: lateEventId,
      // Cột "quota reference snapshot" đã bị GỠ khỏi checklist_violation_records trong migration
      // (2026-08-15, đây là cột phase-2/quota duy nhất thật sự chưa dùng) — KHÔNG còn ghi field
      // này nữa. frequency_reference_snapshot vẫn còn lưu ở checklist_late_bcc_import_rows
      // (staging) để phục vụ isEligibleForBulkApprove(), không mirror sang bản ghi chính thức.
      admin_decision: adminDecision,
      admin_decision_reason: t(decision.reason),
      admin_decision_by: currentActor.id,
      admin_decision_by_name: currentActor.name,
      admin_decision_at: new Date().toISOString(),
      created_by: currentActor.id,
      created_by_name: currentActor.name
    };

    let record;
    if (importRow.linked_violation_id) {
      // Đã có bản ghi chính thức trước đó cho ĐÚNG import_row_key này (idempotent re-approve
      // hoặc dữ liệu không đổi) — không tạo dòng mới, chỉ đọc lại.
      const existing = await supabase.from(VIOLATION_TABLE).select('*').eq('id', importRow.linked_violation_id).maybeSingle();
      if (existing.error) throw existing.error;
      record = existing.data;
    } else {
      const { data: insertedData, error: insertError } = await supabase
        .from(VIOLATION_TABLE)
        .upsert(violationPayload, { onConflict: 'request_id', ignoreDuplicates: true })
        .select('*');
      if (insertError) throw insertError;
      record = insertedData && insertedData[0];
      if (!record) {
        const read = await supabase.from(VIOLATION_TABLE).select('*').eq('request_id', importRow.import_row_key).maybeSingle();
        if (read.error) throw read.error;
        record = read.data;
      }
    }

    const rowUpd = await supabase.from(IMPORT_ROW_TABLE).update({
      row_status: recon.ROW_STATUS.APPLIED,
      linked_violation_id: record.id,
      admin_applied_points: finalPoints,
      admin_decision: adminDecision, admin_decision_reason: t(decision.reason),
      admin_decision_by: currentActor.id, admin_decision_by_name: currentActor.name,
      admin_decision_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', importRow.id);
    if (rowUpd.error) throw rowUpd.error;

    results.push({ importRowId: importRow.id, applied: true, record });
  }

  return { approved: results.filter(r => r.applied).length, results };
}

function cryptoRandomUuid() {
  // Node >=20 có crypto.randomUUID toàn cục qua require('crypto') — tránh phụ thuộc thêm.
  return require('crypto').randomUUID();
}

/*
 * Điều chỉnh 1 dòng ĐÃ CHÍNH THỨC bị phát hiện thay đổi khi import lại: KHÔNG sửa đè bản
 * ghi cũ — hủy bản ghi cũ qua cancelChecklistViolation() thật (tôn trọng đúng ranh giới
 * period đã khoá/thẩm định vì RPC phf_mutate_checklist_violation đang dùng đã kiểm tra sẵn,
 * xem lib/checklist-violations.js#cancelChecklistViolation) rồi mới tạo bản ghi mới đúng số
 * liệu, liên kết adjustment_of_violation_id để giữ audit before/after. Lý do dùng
 * "hủy + tạo mới" thay vì cộng/trừ delta thuần: checklistBreakdown() (lib/checklist-monthly.js)
 * clamp điểm mỗi dòng ở Math.max(0, points) trước khi cộng — một dòng delta ÂM (khi điểm mới
 * THẤP hơn điểm cũ) sẽ bị làm tròn về 0 và KHÔNG trừ lại được số đã cộng dư, gây double-count
 * ẩn. Hủy + tạo mới đảm bảo tại một thời điểm chỉ có ĐÚNG MỘT bản ghi 'official' cho 1
 * late_event_id được checklistBreakdown() tính — không phụ thuộc dấu của delta.
 */
async function createLinkedAdjustment(session, { originalViolationId, importRowId, reason } = {}) {
  requireAdmin(session, 'Chỉ Admin được điều chỉnh bản ghi đi trễ đã chính thức.');
  requireDb();
  requireLateApprovalEnabled();
  if (t(reason).length < 10) fail('Lý do điều chỉnh cần tối thiểu 10 ký tự.', 400, 'CHECKLIST_LATE_RECON_ADJUST_REASON_REQUIRED');

  const cancelResult = await cancelChecklistViolation(session, { id: originalViolationId, reason: 'Điều chỉnh theo dữ liệu BCC mới: ' + t(reason) });

  const importRowRead = await supabase.from(IMPORT_ROW_TABLE).select('*').eq('id', importRowId).maybeSingle();
  if (importRowRead.error) throw importRowRead.error;
  const importRow = importRowRead.data;
  if (!importRow) fail('Không tìm thấy dòng đối soát cần điều chỉnh.', 404, 'CHECKLIST_LATE_RECON_ROW_NOT_FOUND');

  const currentActor = actor(session);
  const adjustedRequestId = importRow.import_row_key + '-adj-' + Date.now().toString(36);
  const payload = {
    employee_code: importRow.employee_code,
    employee_name: importRow.employee_name_raw,
    criterion_code: LATE_CRITERION_CODE,
    criterion_name: LATE_CRITERION_NAME,
    criterion_group: 'Nội quy chung',
    factor: 1,
    points: Number(importRow.admin_applied_points ?? importRow.suggested_points),
    late_standard_points: Number(importRow.standard_points),
    late_minutes: Number.isFinite(Number(importRow.minutes_late)) ? Number(importRow.minutes_late) : null,
    late_adjustment_reason: t(reason),
    occurred_date: importRow.occurred_date,
    occurred_time: importRow.checkin_time || null,
    note: 'Điều chỉnh theo dữ liệu BCC mới (thay cho bản ghi ' + originalViolationId + ')',
    evidence_required: false,
    has_evidence: false,
    record_status: 'official',
    is_test: false,
    request_id: adjustedRequestId,
    manager_decision: importRow.manager_decision_suggested === 'conflict' ? null : importRow.manager_decision_suggested,
    import_row_key: importRow.import_row_key,
    adjustment_of_violation_id: originalViolationId,
    admin_decision: recon.ADMIN_DECISION.ADJUST_POINTS,
    admin_decision_reason: t(reason),
    admin_decision_by: currentActor.id,
    admin_decision_by_name: currentActor.name,
    admin_decision_at: new Date().toISOString(),
    created_by: currentActor.id,
    created_by_name: currentActor.name
  };
  const inserted = await supabase.from(VIOLATION_TABLE).insert(payload).select('*').single();
  if (inserted.error) throw inserted.error;

  await supabase.from(IMPORT_ROW_TABLE).update({
    linked_violation_id: inserted.data.id, row_status: recon.ROW_STATUS.APPLIED, updated_at: new Date().toISOString()
  }).eq('id', importRow.id);

  return { cancelled: cancelResult.record, created: inserted.data };
}

/* ============================================================================
 * E) XUẤT DỮ LIỆU — enforce quyền/scope ở BACKEND (không chỉ ẩn nút UI), audit người
 *    xuất/thời điểm/bộ lọc/số dòng. KHÔNG xuất lương/salary.
 * ============================================================================ */
async function exportLateReconciliation(session, filters = {}) {
  requireDb();
  const permission = await requireViolationPermission(session, 'view');
  const scopedEmployees = await permissionEmployees(permission);
  const allowedCodes = new Set(scopedEmployees.map(row => upper(row.employee_code)));

  let managerQuery = supabase.from(MANAGER_OBSERVATION_TABLE).select('*').order('occurred_date', { ascending: false }).limit(5000);
  let bccQuery = supabase.from(VIOLATION_TABLE).select('*').eq('criterion_code', LATE_CRITERION_CODE).order('occurred_date', { ascending: false }).limit(5000);
  if (filters.dateFrom) { managerQuery = managerQuery.gte('occurred_date', isoDate(filters.dateFrom)); bccQuery = bccQuery.gte('occurred_date', isoDate(filters.dateFrom)); }
  if (filters.dateTo) { managerQuery = managerQuery.lte('occurred_date', isoDate(filters.dateTo)); bccQuery = bccQuery.lte('occurred_date', isoDate(filters.dateTo)); }
  const filterEmployeeCode = upper(filters.employeeCode);
  if (filterEmployeeCode) { managerQuery = managerQuery.eq('employee_code', filterEmployeeCode); bccQuery = bccQuery.eq('employee_code', filterEmployeeCode); }
  if (t(filters.department)) managerQuery = managerQuery.eq('department', t(filters.department));
  if (t(filters.branch)) managerQuery = managerQuery.eq('branch', t(filters.branch));
  if (t(filters.managerDecision)) { managerQuery = managerQuery.eq('manager_decision', t(filters.managerDecision)); bccQuery = bccQuery.eq('manager_decision', t(filters.managerDecision)); }
  if (t(filters.approvalStatus)) bccQuery = bccQuery.eq('record_status', t(filters.approvalStatus));

  const [managerRead, bccRead] = await Promise.all([managerQuery, bccQuery]);
  if (managerRead.error) throw managerRead.error;
  if (bccRead.error) throw bccRead.error;

  const scopeFilter = row => permission.scopeType === 'all_company' || allowedCodes.has(upper(row.employee_code));
  const departmentBranchFilter = row => {
    if (filterEmployeeCode && upper(row.employee_code) !== filterEmployeeCode) return false;
    return true;
  };
  // Sheet "Ghi nhận từ bộ phận" — mỗi dòng là 1 ghi nhận CÁ NHÂN (chưa gộp), đúng tên đã chốt
  // trong brief (không gắn với tên vai trò cụ thể nào). vaiTroNguoiGhi/boPhanGhi/chiNhanhGhi là
  // DỮ LIỆU THẬT của tài khoản đã ghi nhận (không phải nhãn chung chung hardcode).
  const sheet1 = (managerRead.data || []).filter(scopeFilter).filter(departmentBranchFilter).map(r => ({
    nhanSu: r.employee_code, tenNhanSu: r.employee_name, ngayCa: r.occurred_date,
    nguoiGhi: r.created_by_name,
    vaiTroNguoiGhi: r.recorder_role_label || '',
    boPhanGhi: r.department || '',
    chiNhanhGhi: r.branch || '',
    coXinPhep: r.manager_decision === 'approved' ? 'Duyệt' : 'Không duyệt',
    ghiChu: r.note, thoiDiemGhi: r.created_at
  }));
  // Trường XÁC ĐỊNH không xuất lương: chỉ chọn field nghiệp vụ Đi trễ, KHÔNG bao gồm bất kỳ
  // cột lương/salary/thu nhập nào dù bảng gốc có hay không.
  const sheet2 = (bccRead.data || []).filter(scopeFilter).filter(departmentBranchFilter).map(r => ({
    nhanSu: r.employee_code, ngay: r.occurred_date, gioVao: r.occurred_time,
    // late_minutes (Gap 2): LUÔN từ cột cấu trúc — bản ghi cũ trước 1.55.0 không có field này
    // sẽ hiển thị "Không có dữ liệu" (formatLateMinutesDisplay), KHÔNG bao giờ fabricate 0.
    soPhutTre: recon.formatLateMinutesDisplay(r.late_minutes),
    ketQuaXinPhep: r.manager_decision, matchStatus: r.record_status,
    diemGoiY: r.late_standard_points, quyetDinhAdmin: r.admin_decision,
    diemApDung: r.points, lyDo: r.admin_decision_reason || r.late_adjustment_reason, trangThaiDong: r.record_status
  }));

  const currentActor = actor(session);
  const auditEntry = {
    exportedBy: currentActor.id, exportedByName: currentActor.name,
    exportedAt: new Date().toISOString(), filters, rowCount: sheet1.length + sheet2.length
  };
  // Ghi audit export (best-effort, không chặn export nếu bảng audit chưa cấu hình — dùng
  // console.warn thay vì fail() để không biến việc thiếu bảng audit phụ thành lỗi 5xx của
  // một thao tác đọc dữ liệu hợp lệ).
  try {
    await supabase.from('checklist_violation_record_history').insert({
      record_id: null, action: 'export_late_reconciliation', before_data: {}, after_data: auditEntry,
      reason: 'Xuất dữ liệu đối soát Đi trễ', changed_by: currentActor.id, changed_by_name: currentActor.name
    });
  } catch (e) {
    console.warn('[PHF Checklist][Late Recon] export audit insert failed (non-blocking)', e && e.message || e);
  }

  return { sheet1, sheet2, audit: auditEntry };
}

module.exports = {
  // Tên CHUNG — nguồn chính, dùng cho code/test mới.
  recordManagerLateObservation,
  listManagerLateObservations,
  listAdminLateManagerObservations,
  // Bí danh tương thích ngược (cùng hàm) — chỉ giữ để không phá vỡ nơi gọi cũ nếu còn sót.
  recordShiftLeadLateObservation,
  listShiftLeadLateObservations,
  previewBccUpload,
  createBccImport,
  reconcileBccImport,
  approveLateEvents,
  createLinkedAdjustment,
  exportLateReconciliation
};
