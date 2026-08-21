'use strict';
/*
 * PHF Checklist — Monthly Result Baseline (Phase 2, 2026-08-18).
 * Lõi THUẦN JS (không Supabase, không side-effect) cho lớp KẾT QUẢ điểm
 * Checklist theo tháng — schema thiết kế ở scripts/PHF_CHECKLIST_MONTHLY_
 * RESULTS_1.56.0.sql (CHƯA chạy). Độc lập hoàn toàn với checklist_monthly_
 * forms (workflow form thật) và với 23 file WIP Retro/Template hiện có
 * trong repo — KHÔNG import/require bất kỳ file nào trong nhóm đó.
 *
 * Claude KHÔNG có file Excel thật ("diem checklist 2026.xlsx") ở batch này
 * — mọi hàm ở đây nhận INPUT ĐÃ ĐƯỢC PARSE thành object thuần
 * {employeeCode, employeeName, rawValue} (rawValue = nội dung ô "Điểm tổng
 * quy đổi" nguyên văn, có thể là number/string/blank/null) — việc đọc file
 * .xlsx thật và ánh xạ đúng cột là bước RIÊNG, sau này, khi có file thật.
 *
 * Nguyên tắc bất biến (đã chốt ở Phase 1 audit + yêu cầu batch này):
 *   - Không fuzzy-match tên. Chỉ exact employee_code match.
 *   - blank ≠ "không đánh giá" ≠ "thử việc" ≠ score 0 — 4 trạng thái tách
 *     biệt, không suy diễn cái này thành cái khác.
 *   - Không clamp/chia 10/nhân 10/tự sửa số bất thường (vd 948.666...).
 *   - source do SERVER gán — không bao giờ tin source từ input caller.
 */

function t(v) { return String(v == null ? '' : v).trim(); }

/* normalizeEmployeeCode — CHỈ normalize kỹ thuật an toàn (trim + uppercase),
 * đúng pattern đã dùng xuyên suốt codebase (lib/knl-people.js, lib/org-
 * directory.js, lib/ai-knl-income-tools.js) — KHÔNG strip khoảng trắng giữa
 * ký tự, KHÔNG đổi dạng mã theo suy đoán. */
function normalizeEmployeeCode(raw) {
  return t(raw).toUpperCase();
}

/* normalizeMatchText — accent-insensitive, dùng CHỈ để so khớp 2 cụm từ đã
 * biết trước ("không đánh giá"/"thử việc" và các biến thể gõ tắt/thiếu dấu
 * đã được xác nhận trong Excel thật: "ko đánh giá") — KHÔNG dùng để match
 * tên nhân sự (đó vẫn luôn là exact employee_code). */
function normalizeMatchText(value) {
  return t(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

const NO_ASSESSMENT_PATTERNS = ['khong danh gia', 'ko danh gia'];
const PROBATION_PATTERNS = ['thu viec'];

/*
 * classifyRawScoreCell(rawValue) -> {resultState, score, validation, reason}
 *
 * validation: 'VALID' | 'INVALID' | 'NEED_REVIEW'
 *   - VALID: resultState xác định rõ ràng, score (nếu SCORED) trong [0,100].
 *   - INVALID: SCORED nhưng số nằm ngoài [0,100] — KHÔNG tự sửa, chỉ đánh dấu.
 *   - NEED_REVIEW: nội dung ô không khớp bất kỳ pattern đã biết nào (không
 *     phải số, không phải blank, không khớp "không đánh giá"/"thử việc") —
 *     Admin phải tự xem, KHÔNG được đoán.
 *
 * resultState: 'SCORED' | 'NO_ASSESSMENT' | 'PROBATION' | 'NO_DATA' | null
 *   (null khi validation !== 'VALID' — chưa đủ căn cứ để gán state).
 */
function classifyRawScoreCell(rawValue) {
  const raw = rawValue == null ? '' : rawValue;
  const isBlank = typeof raw === 'string' ? t(raw) === '' : (raw === '' || raw == null);
  if (isBlank) {
    return { resultState: 'NO_DATA', score: null, validation: 'VALID', reason: 'Ô trống - không có kết quả.' };
  }

  const normalized = normalizeMatchText(raw);
  if (NO_ASSESSMENT_PATTERNS.some(p => normalized === p || normalized.includes(p))) {
    return { resultState: 'NO_ASSESSMENT', score: null, validation: 'VALID', reason: 'Nguồn ghi "không đánh giá" - không có điểm chính thức, KHÔNG phải điểm 0.' };
  }
  if (PROBATION_PATTERNS.some(p => normalized === p || normalized.includes(p))) {
    return { resultState: 'PROBATION', score: null, validation: 'VALID', reason: 'Nguồn ghi "thử việc" - trạng thái loại trừ, không có điểm chính thức.' };
  }

  // Chấp nhận number thật hoặc chuỗi số (dấu phẩy thập phân kiểu VN) - KHÔNG
  // chấp nhận chuỗi có ký tự chữ lẫn vào (tránh hiểu nhầm text lạ thành số).
  const asString = typeof raw === 'number' ? String(raw) : t(raw);
  const looksNumeric = /^-?\d+([.,]\d+)?%?$/.test(asString);
  if (!looksNumeric) {
    return { resultState: null, score: null, validation: 'NEED_REVIEW', reason: 'Nội dung ô không khớp số hợp lệ, "không đánh giá", hay "thử việc" - cần Admin xem lại thủ công. Giá trị gốc: "' + asString + '".' };
  }
  const numeric = Number(asString.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(numeric)) {
    return { resultState: null, score: null, validation: 'NEED_REVIEW', reason: 'Không parse được thành số. Giá trị gốc: "' + asString + '".' };
  }
  const rounded = Math.round(numeric * 100) / 100; // giữ nguyên độ chính xác nguồn (2 chữ số thập phân), KHÔNG làm tròn thô hơn
  if (rounded < 0 || rounded > 100) {
    return {
      resultState: 'SCORED', score: rounded, validation: 'INVALID',
      reason: 'Giá trị ' + rounded + ' nằm ngoài khoảng hợp lệ [0,100] - KHÔNG tự chia/nhân 10 hay làm tròn để "trông hợp lý". Cần Admin xác nhận nguồn Excel trước khi nhập.'
    };
  }
  return { resultState: 'SCORED', score: rounded, validation: 'VALID', reason: rounded === 0 ? 'Điểm 0 - đây LÀ kết quả thật theo nguồn, không phải giá trị mặc định.' : 'Điểm hợp lệ.' };
}

/*
 * classifyEmployeeEligibility({employeeCode}, currentEmployeeIndex)
 * currentEmployeeIndex: Map<normalizedCode, {employeeCode,employeeName,employmentStatus}>
 * - đã được service tải TRƯỚC từ employee_profiles (BUSINESS DECISION Phase 2:
 *   employee_profiles là nguồn eligibility, KHÔNG phải checklist_employee_assignments).
 * Trả {eligible, employmentStatusReason, resolvedEmployeeCode, resolvedEmployeeName}.
 */
function classifyEmployeeEligibility(rawEmployeeCode, currentEmployeeIndex) {
  const code = normalizeEmployeeCode(rawEmployeeCode);
  if (!code) return { status: 'MISSING_CODE', reason: 'Thiếu Mã nhân viên trong dòng nguồn - không suy đoán bằng tên.' };
  const index = currentEmployeeIndex instanceof Map ? currentEmployeeIndex : new Map();
  const person = index.get(code);
  if (!person) return { status: 'SKIP_NOT_CURRENT_EMPLOYEE', reason: 'Mã "' + code + '" không tồn tại trong employee_profiles hiện tại - không tạo/khôi phục nhân sự.' };
  if (t(person.employmentStatus) !== 'active') {
    return { status: 'SKIP_INACTIVE', reason: 'Nhân sự "' + code + '" tồn tại nhưng employment_status không phải active.', resolvedEmployeeCode: code, resolvedEmployeeName: person.employeeName || '' };
  }
  return { status: 'ELIGIBLE', resolvedEmployeeCode: code, resolvedEmployeeName: person.employeeName || '' };
}

/*
 * T08 Transition Import (2026-08-19) — 2 chi nhánh Lái Thiêu/Ngô Quyền đang
 * vận hành Checklist LIVE thật trong T08, các đơn vị còn lại (chủ yếu Phú
 * Lợi) CHƯA vận hành live nên Admin nhập tay kết quả cuối cùng qua
 * TRANSITION_IMPORT. Guard này CHỈ áp dụng khi resolvedSource===
 * 'TRANSITION_IMPORT' (source/context specific theo đúng yêu cầu nghiệp vụ)
 * - KHÔNG áp dụng cho BASELINE_IMPORT/MANUAL_IMPORT/SYSTEM_LIVE. Tên chi
 * nhánh CHÍNH TẮC lấy nguyên văn từ employee_profiles.branch (audit thật,
 * KHÔNG dùng viết tắt "LT"/"NQ" để so khớp).
 */
const TRANSITION_LIVE_BRANCHES = new Set(['Lái Thiêu', 'Ngô Quyền']);

/*
 * buildPreviewRow(rawRow, currentEmployeeIndex, existingResultIndex, options)
 * rawRow: {employeeCode, employeeName, periodMonth, rawValue} - đã parse từ Excel
 *   (parsing file .xlsx thật là bước RIÊNG, ngoài phạm vi module này).
 * currentEmployeeIndex: Map<code, {employeeCode,employeeName,employmentStatus,branch}>
 *   - branch CHỈ được dùng khi options.source==='TRANSITION_IMPORT' (LT/NQ guard).
 * existingResultIndex: Map<'CODE|period', {source}> - kết quả ĐÃ có trong
 *   checklist_monthly_results (đọc trước từ DB, module này KHÔNG tự query).
 * options.source: nguồn ĐANG preview/confirm hướng tới - dùng để phân biệt
 *   DUPLICATE (existing.source === resolvedSource) khỏi CONFLICT (nguồn khác).
 *   Mặc định '' -> coi như 'BASELINE_IMPORT' để KHÔNG đổi hành vi baseline cũ
 *   (mọi caller cũ không truyền options vẫn chạy y hệt trước đây).
 *
 * Trả 1 preview row với đúng 1 trong các status:
 *   READY | SKIP_LT_NQ_LIVE | SKIP_NOT_CURRENT_EMPLOYEE | SKIP_INACTIVE |
 *   MISSING_CODE | INVALID_SCORE | NEED_REVIEW | DUPLICATE |
 *   CONFLICT_SYSTEM_LIVE | CONFLICT
 */
// Cung mot bo quy tac voi lib/checklist-monthly.js#month() ('^\d{4}-(0[1-9]|1[0-2])$')
// - regex format thuan ('^\d{4}-\d{2}$') se cho lot "2026-99". Kiem tra o day
// (preview, truoc khi cham DB) de tra ve status ro rang thay vi de request
// that bai bang loi CHECK constraint tho cua Postgres o buoc confirm.
const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function buildPreviewRow(rawRow, currentEmployeeIndex, existingResultIndex, options = {}) {
  const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const periodMonth = t(row.periodMonth);
  const base = { employeeCodeInput: t(row.employeeCode), employeeNameInput: t(row.employeeName), periodMonth, rawValue: row.rawValue };
  const resolvedSource = t(options.source) || 'BASELINE_IMPORT';
  const isTransition = resolvedSource === 'TRANSITION_IMPORT';

  if (!PERIOD_MONTH_RE.test(periodMonth)) {
    return { ...base, status: 'NEED_REVIEW', reason: 'Kỳ tháng "' + periodMonth + '" không đúng định dạng YYYY-MM hợp lệ (01-12) - cần Admin xem lại nguồn.' };
  }

  const eligibility = classifyEmployeeEligibility(row.employeeCode, currentEmployeeIndex);
  if (eligibility.status === 'MISSING_CODE') return { ...base, status: 'MISSING_CODE', reason: eligibility.reason };
  if (eligibility.status === 'SKIP_NOT_CURRENT_EMPLOYEE') return { ...base, status: 'SKIP_NOT_CURRENT_EMPLOYEE', reason: eligibility.reason };
  if (eligibility.status === 'SKIP_INACTIVE') return { ...base, status: 'SKIP_INACTIVE', reason: eligibility.reason, employeeCode: eligibility.resolvedEmployeeCode };

  if (isTransition) {
    const index = currentEmployeeIndex instanceof Map ? currentEmployeeIndex : new Map();
    const person = index.get(eligibility.resolvedEmployeeCode);
    if (person && TRANSITION_LIVE_BRANCHES.has(t(person.branch))) {
      return {
        ...base, status: 'SKIP_LT_NQ_LIVE',
        reason: 'Chi nhánh "' + t(person.branch) + '" đang vận hành Checklist live chính thức trong kỳ chuyển tiếp - không nhập tay đè lên kết quả live.',
        employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName
      };
    }
  }

  const classified = classifyRawScoreCell(row.rawValue);
  if (classified.validation === 'NEED_REVIEW') {
    return { ...base, status: 'NEED_REVIEW', reason: classified.reason, employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName };
  }
  if (classified.validation === 'INVALID') {
    return { ...base, status: 'INVALID_SCORE', reason: classified.reason, employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName, rawScore: classified.score };
  }

  const key = eligibility.resolvedEmployeeCode + '|' + periodMonth;
  const index = existingResultIndex instanceof Map ? existingResultIndex : new Map();
  const existing = index.get(key);
  if (existing) {
    // DUPLICATE = đã có đúng nguồn đang preview/confirm hướng tới (double-run
    // an toàn, không ghi lại). CONFLICT(_SYSTEM_LIVE) = đã có authoritative
    // result KHÁC nguồn - KHÔNG tự ghi đè, cần Admin quyết định tường minh.
    if (existing.source === resolvedSource) {
      return {
        ...base, status: 'DUPLICATE',
        reason: 'Đã có kết quả ' + resolvedSource + ' cho nhân sự/tháng này - không ghi trùng.',
        employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName,
        existingSource: existing.source
      };
    }
    if (isTransition && existing.source === 'SYSTEM_LIVE') {
      return {
        ...base, status: 'CONFLICT_SYSTEM_LIVE',
        reason: 'Đã có kết quả CHÍNH THỨC từ Checklist live (SYSTEM_LIVE) cho nhân sự/tháng này - không ghi đè bằng dữ liệu nhập tay.',
        employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName,
        existingSource: existing.source
      };
    }
    return {
      ...base, status: 'CONFLICT',
      reason: 'Đã có kết quả authoritative khác nguồn (' + existing.source + ') cho nhân sự/tháng này - không tự động ghi đè, cần Admin xác nhận riêng.',
      employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName,
      existingSource: existing.source
    };
  }

  return {
    ...base, status: 'READY', reason: 'Hợp lệ, sẵn sàng nhập.',
    employeeCode: eligibility.resolvedEmployeeCode, employeeName: eligibility.resolvedEmployeeName,
    resultState: classified.resultState, score: classified.score
  };
}

const PREVIEW_STATUSES = ['READY', 'SKIP_LT_NQ_LIVE', 'SKIP_NOT_CURRENT_EMPLOYEE', 'SKIP_INACTIVE', 'MISSING_CODE', 'INVALID_SCORE', 'NEED_REVIEW', 'DUPLICATE', 'CONFLICT_SYSTEM_LIVE', 'CONFLICT'];

function buildPreviewBatch(rawRows, currentEmployeeIndex, existingResultIndex, options = {}) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(r => buildPreviewRow(r, currentEmployeeIndex, existingResultIndex, options));
  const counts = PREVIEW_STATUSES.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  return { total: rows.length, counts, rows };
}

/*
 * buildConfirmRows(previewRows, {source, batchId, actorId, actorName})
 * CHỈ nhận các dòng status==='READY' từ preview - bất kỳ dòng nào khác
 * status lọt vào đây là LỖI GỌI SAI (throw), không âm thầm bỏ qua, để
 * caller (service) không bao giờ vô tình ghi dữ liệu chưa qua preview.
 * source LUÔN lấy từ tham số thứ 2 (server quyết định) - object rawRow
 * không có field source nào được đọc ở đây, đúng "server assigns source".
 */
function buildConfirmRows(previewRows, { source, batchId, actorId, actorName } = {}) {
  const allowedSources = new Set(['BASELINE_IMPORT', 'TRANSITION_IMPORT', 'SYSTEM_LIVE', 'MANUAL_IMPORT']);
  const resolvedSource = t(source);
  if (!allowedSources.has(resolvedSource)) throw Object.assign(new Error('source không hợp lệ.'), { code: 'CHECKLIST_MONTHLY_RESULT_SOURCE_INVALID' });
  const rows = Array.isArray(previewRows) ? previewRows : [];
  const notReady = rows.filter(r => r.status !== 'READY');
  if (notReady.length) throw Object.assign(new Error('Chỉ được confirm các dòng đã preview READY - có ' + notReady.length + ' dòng chưa sẵn sàng.'), { code: 'CHECKLIST_MONTHLY_RESULT_NOT_READY' });
  return rows.map(r => ({
    employee_code: r.employeeCode,
    employee_name: r.employeeName || '',
    period_month: r.periodMonth,
    result_state: r.resultState,
    score: r.resultState === 'SCORED' ? r.score : null,
    source: resolvedSource,
    source_batch_id: t(batchId) || null,
    source_note: '',
    created_by: t(actorId),
    created_by_name: t(actorName),
    updated_by: t(actorId),
    updated_by_name: t(actorName)
  }));
}

module.exports = {
  normalizeEmployeeCode,
  normalizeMatchText,
  classifyRawScoreCell,
  classifyEmployeeEligibility,
  buildPreviewRow,
  buildPreviewBatch,
  buildConfirmRows,
  PREVIEW_STATUSES,
  TRANSITION_LIVE_BRANCHES
};
