'use strict';
/*
 * PHF Checklist — Đi trễ: batch hoàn thiện nghiệp vụ end-to-end (2026-08-16).
 * Cover phần SERVICE LAYER (previewBccUpload) của 2 thay đổi nghiệp vụ mới, bổ sung cho
 * scripts/test-checklist-late-reconciliation-2026-08.js (đã cover tầng thuần):
 *   A) REJECTED_BANDS (6/12/16/24) thật sự được service dùng khi build preview (không chỉ đúng
 *      ở tầng thuần lib/checklist-late-reconciliation.js).
 *   B) Quota "4 lần Duyệt/nhân sự/tháng" — service tự đếm ĐÚNG (existing official approved +
 *      trong CHÍNH file đang upload), gán approved_over_quota cho lần thứ 5+.
 *   C) Grep-guard: approveLateEvents() dùng ĐÚNG standardRejectedPoints khi Cần đối chiếu được
 *      Admin kết luận Không duyệt (fix bug dùng nhầm băng "Không xin phép") + bắt buộc Admin tự
 *      nhập điểm/lý do cho case approved_over_quota (không có LATE_APPROVAL_ENABLED=true trong
 *      môi trường test nên KHÔNG thể chạy runtime qua approveLateEvents() thật — xem
 *      test-checklist-late-approval-backend-guard-2026-08.js — đây chỉ verify bằng source-scan).
 * Chạy: node scripts/test-checklist-late-point-engine-quota-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('@supabase/supabase-js');

function parseOrClause(clauseStr, row) {
  const clauses = String(clauseStr || '').split(',').map(c => c.trim()).filter(Boolean);
  return clauses.some(clause => {
    const m = clause.match(/^([a-zA-Z0-9_]+)\.(eq|is|gte|lte|neq)\.(.*)$/);
    if (!m) return false;
    const [, field, op, rawVal] = m;
    const rowVal = row[field];
    if (op === 'is') return rawVal === 'null' ? (rowVal === null || rowVal === undefined || rowVal === '') : String(rowVal) === rawVal;
    if (op === 'eq') return String(rowVal) === rawVal;
    if (op === 'neq') return String(rowVal) !== rawVal;
    if (op === 'gte') return rowVal != null && String(rowVal) >= rawVal;
    if (op === 'lte') return rowVal != null && String(rowVal) <= rawVal;
    return false;
  });
}
function staticTable(getRows) {
  const filters = [];
  let limitN = null, wantSingle = false;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    or(clauseStr) { filters.push(r => parseOrClause(clauseStr, r)); return q; },
    order() { return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

const ASSIGNMENTS = [
  { employee_id: 'e40', employee_code: 'PHF040', employee_name: 'Nguyễn Văn Quota', department: 'Bán hàng', branch: 'CN1', employee_status: 'Đang làm việc' },
  { employee_id: 'e41', employee_code: 'PHF041', employee_name: 'Trần Thị Rejected', department: 'Bán hàng', branch: 'CN1', employee_status: 'Đang làm việc' }
];
const GRANTS = [
  {
    id: 'g-admin-like', account_id: 'admin-1', employee_code: 'ADMIN01', preset_code: 'TRO_LY_GD',
    capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true },
    view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] },
    record_scope: { type: 'all_company', values: [] }, export_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01'
  }
];
// EXISTING_OFFICIAL: 2 bản ghi Duyệt CHÍNH THỨC đã có sẵn trong tháng 2026-08 cho PHF040 —
// mô phỏng nhân sự đã có 2 lần Duyệt trước lượt upload này (đợt trước đã Approve).
const EXISTING_OFFICIAL = [
  { id: 'v1', employee_code: 'PHF040', occurred_date: '2026-08-02', late_standard_points: 3, points: 0, manager_decision: 'approved', record_status: 'official', import_row_key: 'old-key-1', is_test: false, criterion_code: 'PHF-DITRE-01' },
  { id: 'v2', employee_code: 'PHF040', occurred_date: '2026-08-03', late_standard_points: 3, points: 0, manager_decision: 'approved', record_status: 'official', import_row_key: 'old-key-2', is_test: false, criterion_code: 'PHF-DITRE-01' }
];
// MANAGER_RECORDS: quan sát Duyệt cho PHF040 ở 3 ngày mới (sẽ là lần Duyệt thứ 3,4,5 trong tháng
// khi cộng với 2 bản ghi chính thức đã có) + 1 quan sát Không duyệt cho PHF041.
const MANAGER_RECORDS = [
  { id: 'o1', employee_code: 'PHF040', occurred_date: '2026-08-10', manager_decision: 'approved', created_by_name: 'Trưởng ca A', created_at: '2026-08-10T08:00:00Z' },
  { id: 'o2', employee_code: 'PHF040', occurred_date: '2026-08-11', manager_decision: 'approved', created_by_name: 'Trưởng ca A', created_at: '2026-08-11T08:00:00Z' },
  { id: 'o3', employee_code: 'PHF040', occurred_date: '2026-08-12', manager_decision: 'approved', created_by_name: 'Trưởng ca A', created_at: '2026-08-12T08:00:00Z' },
  { id: 'o4', employee_code: 'PHF041', occurred_date: '2026-08-10', manager_decision: 'rejected', created_by_name: 'Trưởng ca A', created_at: '2026-08-10T08:00:00Z' }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_late_manager_observations') return staticTable(() => MANAGER_RECORDS);
        if (table === 'checklist_violation_records') return staticTable(() => EXISTING_OFFICIAL);
        return staticTable(() => []);
      }
    })
  }
};

const service = require('../api/_lib/checklist-late-reconciliation-service');
const recon = require('../api/_lib/checklist-late-reconciliation');

let failures = 0, passes = 0;
async function checkAsync(label, fn) { try { await fn(); passes++; console.log('PASS: ' + label); } catch (e) { failures++; console.error('FAIL: ' + label + ' :: ' + (e && e.message || e)); } }
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; console.log('PASS: ' + message); } }

const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' }, employeeCode: 'ADMIN01' };

function excelRow(employeeCode, occurredDate, minutesLate, shift, checkinTime) {
  return {
    'Mã nhân viên': employeeCode, 'Họ tên': '', 'Ngày': occurredDate, 'Giờ': checkinTime || '08:10',
    'Địa điểm': '', 'Mã tiêu chí': '', 'Nội dung tiêu chí': '', 'Nhận xét': '', 'Điểm': '',
    'Phút trễ': String(minutesLate), 'Ca làm': shift || 'sáng', 'Lý do điều chỉnh': '', 'Trạng thái': ''
  };
}

(async () => {
  // =========================================================================
  // A + B: previewBccUpload — REJECTED_BANDS thật sự dùng ở service + quota Duyệt tính đúng
  // =========================================================================
  const rows = [
    excelRow('PHF040', '2026-08-10', 10), // Duyệt lần 3 trong tháng (2 official trước + lần này)
    excelRow('PHF040', '2026-08-11', 10), // Duyệt lần 4
    excelRow('PHF040', '2026-08-12', 10), // Duyệt lần 5 -> vượt quota
    excelRow('PHF041', '2026-08-10', 40)  // Không duyệt, băng 31-45 -> REJECTED_BANDS = 16
  ];
  await checkAsync('previewBccUpload: build preview thành công với 4 dòng hợp lệ', async () => {
    const result = await service.previewBccUpload(adminSession, rows, 'MANUAL');
    assert.strictEqual(result.preview.length, 4, 'phải có đúng 4 dòng preview (không loại nhầm dòng nào)');
  });

  const result = await service.previewBccUpload(adminSession, rows, 'MANUAL');
  const byRowKey = {};
  result.preview.forEach(r => { byRowKey[r.employeeCode + '|' + r.occurredDate] = r; });

  check(byRowKey['PHF040|2026-08-10'].businessStatus === 'approved', 'B1. Lần Duyệt thứ 3 trong tháng vẫn businessStatus=approved (trong hạn mức)');
  check(byRowKey['PHF040|2026-08-10'].approvedQuota.occurrenceNumber === 3, 'B1b. occurrenceNumber phải = 3 (2 official trước + lần này)');
  check(byRowKey['PHF040|2026-08-10'].suggestedPoints === 0, 'B1c. suggestedPoints=0 khi trong hạn mức');

  check(byRowKey['PHF040|2026-08-11'].businessStatus === 'approved', 'B2. Lần Duyệt thứ 4 trong tháng vẫn businessStatus=approved (đúng ranh giới 4)');
  check(byRowKey['PHF040|2026-08-11'].approvedQuota.occurrenceNumber === 4, 'B2b. occurrenceNumber phải = 4');

  check(byRowKey['PHF040|2026-08-12'].businessStatus === 'approved_over_quota', 'B3. Lần Duyệt thứ 5 trong tháng -> approved_over_quota');
  check(byRowKey['PHF040|2026-08-12'].approvedQuota.occurrenceNumber === 5, 'B3b. occurrenceNumber phải = 5');
  check(byRowKey['PHF040|2026-08-12'].suggestedPoints === 0, 'B3c. suggestedPoints lưu DB = 0 (placeholder, KHÔNG phải gợi ý thật — Admin phải tự nhập)');
  check(byRowKey['PHF040|2026-08-12'].rowStatus === recon.ROW_STATUS.NEEDS_REVIEW, 'B3d. rowStatus=NEEDS_REVIEW để Admin biết cần tự kiểm tra, không lẫn pending_approval bình thường');
  check(result.overQuotaCount === 1, 'B3e. overQuotaCount tổng hợp = 1');

  check(byRowKey['PHF041|2026-08-10'].businessStatus === 'rejected', 'A1. PHF041 Không duyệt -> businessStatus=rejected');
  check(byRowKey['PHF041|2026-08-10'].suggestedPoints === 16, 'A2. Service THẬT SỰ dùng REJECTED_BANDS (31-45 phút = 16đ), KHÔNG còn dùng chung băng Không xin phép (8đ)');
  check(byRowKey['PHF041|2026-08-10'].standardPoints === 8, 'A3. "Điểm chuẩn" tham khảo Không xin phép vẫn giữ nguyên (băng LATE_BANDS 31-45=8) — không đổi ý nghĩa cột cũ');
  check(byRowKey['PHF041|2026-08-10'].standardRejectedPoints === 16, 'A4. standardRejectedPoints lưu đúng để approveLateEvents dùng khi resolve conflict thành Không duyệt');

  // Đảm bảo isEligibleForBulkApprove loại đúng dòng vượt quota (đã test ở tầng thuần, xác nhận
  // lại bằng dữ liệu THẬT từ preview service, không phải fixture tay).
  check(recon.isEligibleForBulkApprove(byRowKey['PHF040|2026-08-12'], null, null) === false, 'B4. Dòng vượt quota (dữ liệu preview thật) KHÔNG đủ điều kiện bulk-approve');
  check(recon.isEligibleForBulkApprove(byRowKey['PHF041|2026-08-10'], { overThreshold: false }, null) === true, 'A5. Dòng Không duyệt sạch (dữ liệu preview thật) vẫn đủ điều kiện bulk-approve bình thường');

  // =========================================================================
  // C: Grep-guard — approveLateEvents() dùng ĐÚNG standardRejectedPoints cho conflict->rejected,
  //    và bắt buộc Admin tự nhập điểm/lý do cho approved_over_quota (runtime bị chặn bởi
  //    LATE_APPROVAL_ENABLED=false nên chỉ verify được bằng source ở đây).
  // =========================================================================
  const SERVICE_SRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-late-reconciliation-service.js'), 'utf8');
  const RECON_SRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-late-reconciliation.js'), 'utf8');
  // 2026-08-16 (preflight refactor, residual bulk partial-write): validate logic (band-selection
  // fix + quota gates) tách sang recon.evaluateApproveDecision() dùng CHUNG cho preflight lẫn
  // write — service chỉ còn gọi lại, không validate inline nữa.
  const evalFnSrc = RECON_SRC.slice(RECON_SRC.indexOf('function evaluateApproveDecision'), RECON_SRC.indexOf('/* ============================================================================\n * 7)'));
  const approveFnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  check(/snapshot\.standardRejectedPoints\s*\?\?\s*importRow\.standard_points/.test(evalFnSrc), 'C1. evaluateApproveDecision dùng snapshot.standardRejectedPoints (KHÔNG còn dùng nhầm importRow.standard_points/LATE_BANDS) khi Cần đối chiếu kết luận Không duyệt');
  check(/CHECKLIST_LATE_RECON_QUOTA_POINTS_REQUIRED/.test(evalFnSrc), 'C2. evaluateApproveDecision có mã lỗi bắt buộc Admin tự nhập điểm cho case vượt quota (không có gợi ý mặc định)');
  check(/CHECKLIST_LATE_RECON_QUOTA_REASON_REQUIRED/.test(evalFnSrc), 'C3. evaluateApproveDecision có mã lỗi bắt buộc lý do cho case vượt quota');
  check(/isOverQuota/.test(evalFnSrc) && /businessStatus === 'approved_over_quota'/.test(evalFnSrc), 'C4. evaluateApproveDecision đọc businessStatus từ snapshot đã lưu, không tự suy luận lại');
  check(/recon\.evaluateApproveDecision\(/.test(approveFnSrc), 'C5. approveLateEvents (service) gọi recon.evaluateApproveDecision() ở bước preflight, không validate inline nữa');

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
