'use strict';
/*
 * PHF Checklist — Workstream B: Đi trễ BCC, đối soát ghi nhận từ bộ phận (bất kỳ tài khoản
 * nào có capability+scope ghi nhận lỗi — Trưởng ca CHỈ là một ví dụ) và Admin phê duyệt.
 * KHÔNG có quota cưỡng chế — mọi ngưỡng tần suất chỉ là cảnh báo tham khảo, KHÔNG BAO GIỜ
 * tự chặn/từ chối/áp điểm khác. Admin luôn là người quyết định điểm cuối cùng.
 *
 * Đây là lớp LOGIC THUẦN (pure JS) — không import @supabase/supabase-js, không đọc
 * process.env, không có side-effect I/O — để unit-test in-memory không cần DB thật,
 * đúng khuôn mẫu lib/checklist-template-retroactive.js của Workstream A. Lớp gọi
 * Supabase thật nằm ở lib/checklist-late-reconciliation-service.js (thin wrapper),
 * theo đúng khuôn mẫu checklist-template-retroactive-service.js.
 *
 * Nguồn số liệu điểm/ngưỡng tham khảo: Nội quy công ty (do chủ doanh nghiệp cung cấp,
 * KHÔNG phải số tự suy ra như "trọng số 10%" đã bị Workstream A bác trước đó):
 *   Không xin phép: 01–15 phút = 3đ · 16–30 phút = 6đ · 31–45 phút = 8đ · trên 45 phút = 12đ
 *   Có xin phép: gợi ý 0đ
 *   Ngưỡng THAM KHẢO (không cưỡng chế): 01–15 phút = 4 lần/tháng · 16–30 phút = 2 lần/tháng ·
 *     31–45 phút = 1 lần/tháng · trên 45 phút = 1 lần/tháng
 */

function t(value) {
  return String(value == null ? '' : value).trim();
}

function upper(value) {
  return t(value).toUpperCase();
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoDate(value) {
  const s = t(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function normalizeTime(value) {
  const s = t(value);
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  return m ? (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] : '';
}

/* MANAGER_DECISION: đổi tên từ PERMISSION_STATUS (2026-08-15) — ngữ nghĩa đổi từ "nhân sự có
 * xin phép hay không" sang "quyết định Duyệt/Không duyệt của người ghi nhận" (bản chất dữ liệu
 * KHÔNG đổi — vẫn cùng 1 trường nhị phân — chỉ đổi tên/nhãn cho đúng ngữ nghĩa thật trước khi
 * migration có dữ liệu, xem PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql). APPROVED tương
 * đương has_permission cũ ("Duyệt"), REJECTED tương đương no_permission cũ ("Không duyệt").
 * NO_RECORD giữ nguyên tên/giá trị — đây là SENTINEL "không có ghi nhận nào từ bộ phận", không
 * phải 1 quyết định Duyệt/Không duyệt thật, nên không đổi theo cặp approved/rejected. */
const MANAGER_DECISION = Object.freeze({
  APPROVED: 'approved',   // Duyệt
  REJECTED: 'rejected',   // Không duyệt
  NO_RECORD: 'no_record'  // Không có ghi nhận từ bộ phận
});

const ROW_STATUS = Object.freeze({
  PENDING_APPROVAL: 'pending_approval',   // Chờ duyệt
  NEEDS_REVIEW: 'needs_review',           // Cần đối chiếu (ambiguous merge / changed-blocked)
  APPLIED: 'applied',                     // Đã áp dụng
  NOT_APPLIED: 'not_applied',             // Không áp dụng
  UNCHANGED: 'unchanged',                 // Không thay đổi (trùng dữ liệu cũ hệt nhau)
  CHANGED: 'changed'                      // Dữ liệu thay đổi (khác bản cũ, cần xác nhận)
});

const ADMIN_DECISION = Object.freeze({
  ACCEPT_EXEMPT: 'accept_exempt',                       // chấp nhận miễn trừ
  APPLY_NO_PERMISSION_POINTS: 'apply_no_permission_points', // áp dụng điểm không xin phép
  ADJUST_POINTS: 'adjust_points',                       // điều chỉnh điểm (nhập số khác)
  NOT_APPLIED: 'not_applied',                           // không áp dụng
  HOLD_FOR_REVIEW: 'hold_for_review'                    // tạm giữ để kiểm tra
});

const RECONCILE_CHOICE = Object.freeze({
  KEEP_OLD: 'keep_old',
  UPDATE_NEWEST: 'update_newest',
  ROW_BY_ROW: 'row_by_row'
});

/* ============================================================================
 * 1) Bảng điểm chuẩn "Không xin phép" theo phút trễ + ngưỡng tham khảo tần suất.
 *    CHỈ dùng đúng 4 mức đã chốt — KHÔNG được thêm/bớt mức khác không có căn cứ.
 * ============================================================================ */
const LATE_BANDS = Object.freeze([
  { key: 'b1_15', minMinutes: 1, maxMinutes: 15, points: 3, referenceMonthlyCount: 4, label: '01–15 phút' },
  { key: 'b16_30', minMinutes: 16, maxMinutes: 30, points: 6, referenceMonthlyCount: 2, label: '16–30 phút' },
  { key: 'b31_45', minMinutes: 31, maxMinutes: 45, points: 8, referenceMonthlyCount: 1, label: '31–45 phút' },
  { key: 'b46_up', minMinutes: 46, maxMinutes: null, points: 12, referenceMonthlyCount: 1, label: 'Trên 45 phút' }
]);

function bandForMinutes(minutes) {
  const value = Math.max(1, Math.round(num(minutes, 0)));
  return LATE_BANDS.find(b => value >= b.minMinutes && (b.maxMinutes == null || value <= b.maxMinutes)) || LATE_BANDS[LATE_BANDS.length - 1];
}

/* Điểm CHUẨN gợi ý cho "Không xin phép" theo số phút trễ — KHÔNG áp dụng khi
   Có xin phép (điểm chuẩn 0) hoặc khi không xác định được số phút. */
function standardNoPermissionPoints(minutes) {
  return bandForMinutes(minutes).points;
}

/* ============================================================================
 * 2) Định danh 1 sự kiện đi trễ THẬT — KHÔNG chỉ employee+date (brief cấm dùng
 *    khoá thô đó vì sẽ làm mất 2 sự kiện thật khác nhau trong cùng ngày, và sẽ
 *    lặp lại đúng sai lầm mà migration 1.42.0 đã cố ý sửa). Khoá gồm:
 *      mã NV chuẩn hoá + ngày + ca/giờ vào chuẩn hoá + nguồn + mã giao dịch BCC
 *      (khi có). Khi KHÔNG có mã giao dịch BCC, khoá chỉ còn nhân viên+ngày+giờ+
 *      nguồn — vẫn phân biệt được 2 ca khác giờ trong ngày, nhưng nếu 2 dòng
 *      trùng hệt cả giờ lẫn nguồn mà không có transaction id thì PHẢI rơi vào
 *      trạng thái "cần kiểm tra" (needsReview=true) thay vì tự merge liều lĩnh.
 * ============================================================================ */
function buildEventIdentity(bccRow = {}) {
  const employeeCode = upper(bccRow.employeeCode || bccRow.employee_code);
  const occurredDate = isoDate(bccRow.occurredDate || bccRow.occurred_date);
  const checkinTime = normalizeTime(bccRow.checkinTime || bccRow.checkin_time || bccRow.occurredTime);
  const shift = t(bccRow.shift).toLowerCase();
  const source = t(bccRow.source || 'BCC').toUpperCase();
  const transactionId = t(bccRow.bccTransactionId || bccRow.bcc_transaction_id || bccRow.transactionId);
  const hasTransactionId = Boolean(transactionId);
  const keyParts = [employeeCode, occurredDate, shift || checkinTime || '00:00', source];
  if (hasTransactionId) keyParts.push(transactionId);
  return {
    employeeCode,
    occurredDate,
    checkinTime,
    shift,
    source,
    transactionId,
    hasTransactionId,
    // needsReview khi thiếu transaction id VÀ thiếu cả giờ/ca để phân biệt — dấu hiệu
    // duy nhất có thể tách 2 sự kiện thật trong cùng ngày lúc đó chỉ còn note/minutes,
    // không đủ tin cậy để tự merge.
    needsReview: !hasTransactionId && !shift && !checkinTime,
    identityKey: keyParts.join('|')
  };
}

/* import_row_key: khoá idempotency riêng cho DÒNG IMPORT (staging), tái dùng đúng
   khuôn mẫu request_id đã có ở checklist_violation_records (uq_checklist_violation_request_id,
   migration 1.13) — hash nội dung dòng để re-upload y hệt là no-op an toàn, KHÔNG
   phải constraint mới trên employee+date (không đụng tới quyết định 1.42.0). */
function buildImportRowKey(bccRow = {}) {
  const identity = buildEventIdentity(bccRow);
  const minutesLate = Math.round(num(bccRow.minutesLate ?? bccRow.minutes_late, 0));
  const raw = [identity.identityKey, minutesLate].join('|');
  // Không phụ thuộc crypto ở lớp thuần — hash đơn giản, ổn định, đủ dùng làm khoá
  // idempotency nội bộ (không cần chống va chạm mật mã học).
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return identity.identityKey + '#' + hash.toString(16);
}

/* ============================================================================
 * 3) Đối chiếu NGƯỜI GHI NHẬN — bất kỳ tài khoản nào có capability record_violation
 *    VÀ nhân sự được chọn nằm trong record-scope (backend-resolved) của tài khoản đó
 *    đều có thể ghi nhận phát hiện đi trễ: Trưởng ca, Trưởng bộ phận, Trợ lý Giám đốc,
 *    Giám đốc, Admin, hoặc bất kỳ vai trò nào khác — hoàn toàn do capability+scope
 *    thật quyết định, KHÔNG so khớp theo tên chức danh/role string ở đây. "Trưởng ca"
 *    trong ví dụ/tên biến cũ CHỈ là 1 ví dụ minh hoạ, không phải điều kiện.
 *
 *    Merge BCC + (một hoặc NHIỀU) ghi nhận thành 1 SỰ KIỆN duy nhất — không bao giờ
 *    ra 2 bản ghi cho cùng 1 sự việc:
 *      - Nhiều người ghi nhận CÙNG kết quả (đều Có xin phép, hoặc đều Không xin phép)
 *        -> gộp 1 kết quả duy nhất ("agreed_merged"), nhưng vẫn giữ audit trail từng
 *        người (ai, lúc nào, nói gì) ở `recorders` — KHÔNG chỉ giữ mỗi kết quả gộp.
 *      - Nhiều người ghi nhận KHÁC kết quả nhau -> "conflict": KHÔNG tự chọn theo
 *        thời điểm gần nhất hay theo "cấp bậc" (không có chính sách thâm niên/cấp bậc
 *        nào được chốt) — luôn đẩy lên Admin (matchStatus='conflict_needs_review'),
 *        Admin phải tự xem cả các input gốc rồi quyết định + nêu lý do (audit).
 * ============================================================================ */
function matchManagerRecords(bccRow, managerRecords = []) {
  const identity = buildEventIdentity(bccRow);
  const candidates = (managerRecords || []).filter(r =>
    upper(r.employeeCode || r.employee_code) === identity.employeeCode &&
    isoDate(r.occurredDate || r.occurred_date) === identity.occurredDate
  );
  // Sắp theo thời điểm ghi nhận mới nhất trước — CHỈ để hiển thị ổn định, KHÔNG dùng
  // thứ tự này để tự chọn "người ghi nhận đúng" khi có mâu thuẫn (xem reconcileManagerRecords).
  return candidates.slice().sort((a, b) =>
    t(b.createdAt || b.created_at).localeCompare(t(a.createdAt || a.created_at))
  );
}

/* reconcileManagerRecords: nhận danh sách ghi nhận ĐÃ khớp cùng 1 sự kiện (từ
 * matchManagerRecords) và tính trạng thái đối chiếu — thuần dữ liệu, không tự quyết
 * định gì khi có mâu thuẫn (đó luôn là việc của Admin ở tầng approve). */
function reconcileManagerRecords(candidates = []) {
  if (!candidates.length) {
    return { status: 'no_record', managerDecision: null, recorders: [] };
  }
  const recorders = candidates.map(r => ({
    recordedBy: t(r.createdBy || r.created_by),
    recordedByName: t(r.createdByName || r.created_by_name),
    recorderDepartment: t(r.department),
    recorderBranch: t(r.branch),
    recorderRoleLabel: t(r.recorderRoleLabel || r.recorder_role_label),
    managerDecision: t(r.managerDecision || r.manager_decision || r.permissionStatus || r.permission_status) === MANAGER_DECISION.APPROVED
      ? MANAGER_DECISION.APPROVED
      : MANAGER_DECISION.REJECTED,
    note: t(r.note),
    recordedAt: t(r.createdAt || r.created_at)
  }));
  const distinctStatuses = new Set(recorders.map(r => r.managerDecision));
  if (distinctStatuses.size > 1) {
    return { status: 'conflict', managerDecision: null, recorders };
  }
  return {
    status: candidates.length > 1 ? 'agreed_merged' : 'single',
    managerDecision: recorders[0].managerDecision,
    recorders
  };
}

/* Kết quả GỢI Ý — KHÔNG BAO GIỜ tự áp dụng. Admin luôn xem lại và quyết định. */
function computeSuggestion(bccRow, managerRecords = []) {
  const identity = buildEventIdentity(bccRow);
  const minutesLate = Math.round(num(bccRow.minutesLate ?? bccRow.minutes_late, 0));
  const band = bandForMinutes(minutesLate);
  const candidates = matchManagerRecords(bccRow, managerRecords);
  const reconciliation = reconcileManagerRecords(candidates);

  let managerDecision;
  let matchStatus;
  if (reconciliation.status === 'conflict') {
    // Mâu thuẫn giữa nhiều người ghi nhận — KHÔNG có managerDecision gợi ý (null),
    // Admin phải tự chọn khi phê duyệt (xem approveLateEvents ở service layer).
    managerDecision = null;
    matchStatus = 'conflict_needs_review';
  } else if (reconciliation.status === 'single' || reconciliation.status === 'agreed_merged') {
    managerDecision = reconciliation.managerDecision;
    matchStatus = reconciliation.status === 'agreed_merged' ? 'matched_agreed' : 'matched';
  } else {
    // Không có ghi nhận nào từ bộ phận -> mặc định "Không duyệt", nhãn rõ ràng.
    managerDecision = MANAGER_DECISION.NO_RECORD;
    matchStatus = 'unmatched_default_no_permission';
  }

  const suggestedPoints = managerDecision === MANAGER_DECISION.APPROVED
    ? 0
    : managerDecision === null
      ? null // conflict — chưa có điểm gợi ý cho tới khi Admin chọn kết luận
      : band.points;

  return {
    identity,
    minutesLate,
    band,
    matched: candidates[0] || null,
    matchedRecords: candidates,
    recorders: reconciliation.recorders,
    reconciliationStatus: reconciliation.status,
    matchStatus: identity.needsReview ? 'ambiguous_needs_review' : matchStatus,
    managerDecision,
    standardPoints: band.points,
    suggestedPoints,
    // suggestionLabel: mô tả trạng thái đối soát THUẦN — KHÔNG nêu điểm/số (out-of-scope phase
    // này, xem brief 2026-08-15). Điểm gợi ý hiển thị RIÊNG ở cột "Điểm gợi ý" trong UI, không
    // lồng vào câu mô tả trạng thái nữa.
    suggestionLabel: matchStatus === 'conflict_needs_review'
      ? 'Cần đối chiếu — nhiều người ghi nhận không khớp Duyệt/Không duyệt, Admin phải xem lại'
      : managerDecision === MANAGER_DECISION.APPROVED
        ? 'Duyệt — đã xin phép'
        : managerDecision === MANAGER_DECISION.NO_RECORD
          ? 'Không có ghi nhận từ bộ phận — mặc định Không duyệt'
          : 'Không duyệt — chưa xin phép'
  };
}

/* ============================================================================
 * 4) Cảnh báo tần suất — THAM KHẢO DUY NHẤT, không bao giờ đổi suggestedPoints,
 *    không bao giờ chặn approve. Tính CỘNG DỒN trên toàn kỳ (không chỉ file vừa
 *    upload) — nơi gọi phải truyền đủ occurrencesInPeriod (đếm toàn kỳ, kể cả
 *    dữ liệu upload trước đó + dữ liệu đang xét).
 * ============================================================================ */
function buildFrequencyWarning({ band, occurrencesInPeriod, managerDecision, employeeName }) {
  const count = Math.max(0, Math.round(num(occurrencesInPeriod, 0)));
  const threshold = band.referenceMonthlyCount;
  const overThreshold = count > threshold;
  const message = overThreshold
    ? 'Nhân sự' + (employeeName ? ' ' + employeeName : '') + ' đã có ' + count + ' lần đi trễ ' + band.label +
      (managerDecision === MANAGER_DECISION.APPROVED ? ' được duyệt (đã xin phép)' : '') +
      ' trong kỳ; mức tham khảo Nội quy là ' + threshold + ' lần.'
    : '';
  return {
    count,
    threshold,
    overThreshold,
    // referenceOnly=true LUÔN LUÔN — không có trường "blocking" ở đây theo thiết kế.
    referenceOnly: true,
    message
  };
}

/* ============================================================================
 * 5) Đối soát khi upload trùng khoảng ngày — 3 lựa chọn tường minh, không tự
 *    ghi đè im lặng. So khớp NỘI DUNG (không chỉ khoá) để phân loại
 *    identical/changed/new — dùng đúng field nghiệp vụ (không tính các field
 *    audit như updatedAt vào so sánh nội dung).
 * ============================================================================ */
const CONTENT_FIELDS_FOR_DIFF = ['minutesLate', 'shift', 'checkinTime', 'source', 'transactionId'];

function rowContentEqual(a, b) {
  return CONTENT_FIELDS_FOR_DIFF.every(field => t(a && a[field]) === t(b && b[field]) || num(a && a[field], null) === num(b && b[field], null));
}

/*
 * classifyImportRows: so 1 batch import mới với các importRowKey đã tồn tại
 * (existingByKey: Map importRowKey -> {row, officialViolationId|null, status}).
 * Trả về phân loại NEW/IDENTICAL/CHANGED cho từng dòng — thuần dữ liệu, không
 * ghi DB, không tự quyết định áp dụng gì (đó là việc của applyReconciliationChoice).
 */
function classifyImportRows(newRows = [], existingByKey = new Map()) {
  const identical = [];
  const changed = [];
  const fresh = [];
  (newRows || []).forEach(row => {
    const key = buildImportRowKey(row);
    const existing = existingByKey.get(key);
    if (!existing) {
      fresh.push({ row, importRowKey: key });
      return;
    }
    if (rowContentEqual(row, existing.row)) {
      identical.push({ row, importRowKey: key, existing });
    } else {
      changed.push({ row, importRowKey: key, existing });
    }
  });
  return { identical, changed, new: fresh };
}

/*
 * applyReconciliationChoice: áp dụng 1 trong 3 lựa chọn Admin cho kết quả
 * classifyImportRows(). Trả về danh sách "hành động" cần thực hiện ở lớp
 * service (KHÔNG tự ghi DB ở đây) — mỗi action có type rõ ràng để service
 * biết phải làm gì, và rowStatus để hiển thị UI.
 *
 * Quy tắc bất biến (không được vi phạm ở bất kỳ lựa chọn nào):
 *  - Dòng đã CHÍNH THỨC (existing.status==='official') KHÔNG BAO GIỜ bị ghi đè
 *    tại chỗ — nếu nội dung đổi, luôn tạo action 'create_linked_adjustment'
 *    (bản ghi delta liên kết before/after), không sửa row cũ.
 *  - Dòng còn DRAFT (existing.status==='draft') được thay thế tự do sau khi
 *    Admin xác nhận (choice !== keep_old).
 *  - row_by_row: mỗi dòng changed cần input.rowDecisions[importRowKey] riêng
 *    ('keep'|'update') — thiếu quyết định thì rơi về needs_review, KHÔNG suy
 *    diễn mặc định.
 */
function applyReconciliationChoice(classification, choice, input = {}) {
  const actions = [];
  const rowDecisions = input.rowDecisions || {};

  classification.new.forEach(({ row, importRowKey }) => {
    actions.push({ type: 'create_draft', importRowKey, row, rowStatus: ROW_STATUS.PENDING_APPROVAL });
  });

  classification.identical.forEach(({ row, importRowKey, existing }) => {
    // Trùng hệt tuyệt đối -> không ghi gì cả, không tạo dòng mới, không đổi trạng thái.
    actions.push({ type: 'no_op', importRowKey, row, existing, rowStatus: ROW_STATUS.UNCHANGED });
  });

  classification.changed.forEach(({ row, importRowKey, existing }) => {
    const isOfficial = existing && existing.status === 'official';
    if (isOfficial) {
      // Bất biến: KHÔNG bao giờ ghi đè bản chính thức tại chỗ.
      actions.push({
        type: 'create_linked_adjustment',
        importRowKey,
        row,
        existing,
        rowStatus: ROW_STATUS.NEEDS_REVIEW,
        reasonRequired: true
      });
      return;
    }
    if (choice === RECONCILE_CHOICE.KEEP_OLD) {
      actions.push({ type: 'no_op', importRowKey, row, existing, rowStatus: ROW_STATUS.CHANGED });
      return;
    }
    if (choice === RECONCILE_CHOICE.UPDATE_NEWEST) {
      // Chỉ update các dòng ĐÃ XÁC NHẬN thay đổi thật (changed) — draft mới được
      // thay thế tự do; không đụng gì tới dòng official (đã tách nhánh ở trên).
      actions.push({ type: 'replace_draft', importRowKey, row, existing, rowStatus: ROW_STATUS.PENDING_APPROVAL });
      return;
    }
    if (choice === RECONCILE_CHOICE.ROW_BY_ROW) {
      const decision = t(rowDecisions[importRowKey]);
      if (decision === 'update') {
        actions.push({ type: 'replace_draft', importRowKey, row, existing, rowStatus: ROW_STATUS.PENDING_APPROVAL });
      } else if (decision === 'keep') {
        actions.push({ type: 'no_op', importRowKey, row, existing, rowStatus: ROW_STATUS.CHANGED });
      } else {
        actions.push({ type: 'await_decision', importRowKey, row, existing, rowStatus: ROW_STATUS.NEEDS_REVIEW });
      }
      return;
    }
    // choice không hợp lệ / chưa chọn -> giữ nguyên, cần đối chiếu.
    actions.push({ type: 'await_decision', importRowKey, row, existing, rowStatus: ROW_STATUS.NEEDS_REVIEW });
  });

  return actions;
}

/* ============================================================================
 * 6) Điều kiện bulk-approve: chỉ những dòng KHÔNG có cảnh báo/conflict nào mới
 *    được gom vào bulk-approve. Mọi dòng mơ hồ/conflict/đã bị Admin điều chỉnh
 *    khác điểm chuẩn PHẢI xử lý riêng.
 * ============================================================================ */
function isEligibleForBulkApprove(suggestion, frequencyWarning, adminDecision) {
  if (!suggestion) return false;
  if (suggestion.matchStatus === 'ambiguous_needs_review') return false;
  // Cần đối chiếu (nhiều người ghi nhận mâu thuẫn) — KHÔNG BAO GIỜ được gom bulk-approve,
  // Admin luôn phải tự mở dòng này lên xem cả hai (hoặc nhiều) input gốc rồi quyết định.
  if (suggestion.matchStatus === 'conflict_needs_review') return false;
  if (frequencyWarning && frequencyWarning.overThreshold) return false;
  if (adminDecision && adminDecision.appliedPoints != null &&
      Math.abs(num(adminDecision.appliedPoints) - suggestion.suggestedPoints) > 0.000001) return false;
  return true;
}

/* ============================================================================
 * 7) Excel 13 cột thật (Gap 1) — sheet "DỮ LIỆU" của
 *    PHF_MAU_GHI_NHAN_LOI_LATE_2026-08-14.xlsx. Đây là khuôn dạng CỐ ĐỊNH đã
 *    biết trước (không phải vendor BCC thứ ba với cấu trúc tuỳ ý), nên KHÔNG
 *    cần hệ thống alias cột tổng quát — nhưng vẫn phải BÁO CÁO tường minh cột
 *    nào nhận diện được/thiếu (không âm thầm giả định vị trí cột) để chịu được
 *    biến thể tiêu đề nhẹ của file thật.
 *
 *    QUY TẮC TIN CẬY (đã chốt trong brief — không được vi phạm):
 *      - CHỈ dùng làm nguồn ghi dữ liệu: Mã nhân viên, Ngày, Giờ, Địa điểm,
 *        Phút trễ, Ca làm — và vẫn phải validate từng cột trước khi dùng.
 *      - KHÔNG BAO GIỜ tin trực tiếp để ghi chính thức: Họ tên, Mã tiêu chí,
 *        Nội dung tiêu chí, Điểm, Trạng thái — các cột này chỉ hiển thị tham
 *        khảo ở preview, điểm/tên luôn được server tự tính lại.
 * ============================================================================ */
const EXCEL_SHEET_DATA = 'DỮ LIỆU';
const EXCEL_SHEET_GUIDE = 'HƯỚNG DẪN';
const EXCEL_COLUMNS = Object.freeze([
  'Mã nhân viên', 'Họ tên', 'Ngày', 'Giờ', 'Địa điểm', 'Mã tiêu chí',
  'Nội dung tiêu chí', 'Nhận xét', 'Điểm', 'Phút trễ', 'Ca làm',
  'Lý do điều chỉnh', 'Trạng thái'
]);
// Cột KHÔNG được tin để ghi dữ liệu chính thức — chỉ hiển thị tham khảo ở preview.
const EXCEL_UNTRUSTED_COLUMNS = Object.freeze(['Họ tên', 'Mã tiêu chí', 'Nội dung tiêu chí', 'Điểm', 'Trạng thái']);
// Cột được dùng làm input tính toán thật — vẫn phải validate riêng từng cột (xem parseBccExcelRows).
const EXCEL_TRUSTED_INPUT_COLUMNS = Object.freeze(['Mã nhân viên', 'Ngày', 'Giờ', 'Địa điểm', 'Phút trễ', 'Ca làm']);

const EMPLOYEE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,19}$/;

/*
 * parseBccExcelRows: nhận mảng object 1 dòng = 1 record (đúng dạng
 * XLSX.utils.sheet_to_json({defval:''}) trả về, key = tên cột) của sheet
 * "DỮ LIỆU". KHÔNG đọc file — thuần xử lý dữ liệu đã đọc, để test được
 * không cần thư viện Excel thật. Trả về báo cáo nhận diện cột + validate
 * từng dòng, KHÔNG tự suy diễn/ghi gì.
 */
function parseBccExcelRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const seenColumns = new Set();
  rows.forEach(row => Object.keys(row || {}).forEach(key => seenColumns.add(t(key))));
  const recognizedColumns = EXCEL_COLUMNS.filter(col => seenColumns.has(col));
  const missingColumns = EXCEL_COLUMNS.filter(col => !seenColumns.has(col));
  const extraColumns = [...seenColumns].filter(col => !EXCEL_COLUMNS.includes(col));

  const parsedRows = rows.map((raw, index) => {
    const reasons = [];
    const employeeCode = upper(raw['Mã nhân viên']);
    const employeeNameRaw = t(raw['Họ tên']); // KHÔNG TIN — chỉ hiển thị tham khảo
    const occurredDate = isoDate(raw['Ngày']) || parseVietnameseDate(raw['Ngày']);
    const checkinTime = normalizeTime(raw['Giờ']);
    const location = t(raw['Địa điểm']);
    const shift = t(raw['Ca làm']);
    const adjustReason = t(raw['Lý do điều chỉnh']);
    const minutesRaw = raw['Phút trễ'];
    const minutesLateParsed = Number(minutesRaw);
    const minutesLateValid = t(minutesRaw) !== '' && Number.isFinite(minutesLateParsed) &&
      Number.isInteger(minutesLateParsed) && minutesLateParsed >= 0;

    if (!employeeCode) reasons.push('Thiếu Mã nhân viên.');
    else if (!EMPLOYEE_CODE_RE.test(employeeCode)) reasons.push('Mã nhân viên "' + employeeCode + '" sai định dạng.');
    if (!occurredDate) reasons.push('Ngày không hợp lệ hoặc trống.');
    if (t(minutesRaw) === '') reasons.push('Thiếu Phút trễ.');
    else if (!Number.isFinite(minutesLateParsed) || !Number.isInteger(minutesLateParsed)) reasons.push('Phút trễ phải là số nguyên.');
    else if (minutesLateParsed < 0) reasons.push('Phút trễ không được âm.');

    return {
      rowIndex: index,
      excelRowNumber: index + 2, // +1 header +1 vì Excel đánh số từ 1
      valid: reasons.length === 0,
      reasons,
      // Chỉ các trường TIN CẬY được dùng tiếp cho tính toán/ghi dữ liệu:
      employeeCode,
      occurredDate,
      checkinTime,
      location,
      shift,
      minutesLate: minutesLateValid ? minutesLateParsed : null,
      adjustReason,
      // Trường KHÔNG TIN — giữ lại CHỈ để hiển thị đối chiếu tham khảo ở preview,
      // không được dùng ở bất kỳ bước tính điểm/ghi chính thức nào.
      untrusted: {
        employeeNameRaw,
        criterionCodeRaw: t(raw['Mã tiêu chí']),
        criterionTextRaw: t(raw['Nội dung tiêu chí']),
        pointsRaw: t(raw['Điểm']),
        statusRaw: t(raw['Trạng thái']),
        noteRaw: t(raw['Nhận xét'])
      }
    };
  });

  return {
    sheetExpected: EXCEL_SHEET_DATA,
    guideSheetExpected: EXCEL_SHEET_GUIDE,
    expectedColumns: EXCEL_COLUMNS,
    recognizedColumns,
    missingColumns,
    extraColumns,
    totalRows: parsedRows.length,
    validRows: parsedRows.filter(r => r.valid),
    invalidRows: parsedRows.filter(r => !r.valid),
    rows: parsedRows
  };
}

function parseVietnameseDate(value) {
  const s = t(value);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return '';
  const day = m[1].padStart(2, '0'), month = m[2].padStart(2, '0'), year = m[3];
  return isoDate(year + '-' + month + '-' + day);
}

/* formatLateMinutesDisplay: KHÔNG BAO GIỜ suy đoán/backfill số phút cho bản ghi
   cũ thiếu dữ liệu — luôn hiển thị nhãn rõ ràng thay vì fabricate số hoặc 0. */
function formatLateMinutesDisplay(value) {
  const n = Number(value);
  return (value == null || value === '' || !Number.isFinite(n)) ? 'Không có dữ liệu' : String(Math.round(n));
}

module.exports = {
  MANAGER_DECISION,
  ROW_STATUS,
  ADMIN_DECISION,
  RECONCILE_CHOICE,
  LATE_BANDS,
  EXCEL_SHEET_DATA,
  EXCEL_SHEET_GUIDE,
  EXCEL_COLUMNS,
  EXCEL_UNTRUSTED_COLUMNS,
  EXCEL_TRUSTED_INPUT_COLUMNS,
  bandForMinutes,
  standardNoPermissionPoints,
  buildEventIdentity,
  buildImportRowKey,
  matchManagerRecords,
  reconcileManagerRecords,
  computeSuggestion,
  buildFrequencyWarning,
  classifyImportRows,
  applyReconciliationChoice,
  isEligibleForBulkApprove,
  parseBccExcelRows,
  formatLateMinutesDisplay
};
