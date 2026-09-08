'use strict';
/*
 * Regression — Historical period visibility (IA V1)
 * In-memory only. No Production Database. Safe for future verification.
 *
 * monthlyReviewVisible() (api/_lib/checklist-monthly.js) — a reviewer must keep
 * VIEW access to a historical form on which their own identity is the recorded
 * reviewer (reviewer_code / reviewer_id), even after the employee moves out of
 * the reviewer's current review_scope. Must NOT expose another reviewer's forms
 * and must NOT change current appraisal scope or submit permission.
 *
 * Also source-scans the frontend historical-population rule and asserts
 * saveMonthlyReview()'s own scope + window checks are untouched.
 *
 *   node scripts/test-checklist-monthly-historical-review-visibility.js
 */
const fs = require('fs');
const path = require('path');
const { monthlyReviewVisible } = require('../api/_lib/checklist-monthly');

let failed = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failed++; } else console.log('PASS: ' + msg); }

// actor(session) resolves employeeCode (UPPER) + employeeId from session; build a
// context the same shape monthlyReviewAccessContext() returns.
function ctx({ code = '', id = '', allowCodes = [], allowIds = [], assistantSelfReview = false } = {}) {
  return {
    a: { employeeCode: String(code).toUpperCase(), employeeId: String(id) },
    assistantSelfReview,
    allowedIds: new Set(allowIds.map(String)),
    allowedCodes: new Set(allowCodes.map(x => String(x).toUpperCase())),
  };
}
const S = { role: 'manager' };
function form(o) {
  return Object.assign({
    employee_id: 'E-EMP', employee_code: 'EMP01', reviewer_id: '', reviewer_code: '', status: 'waiting_review', admin_exception_open: false,
  }, o);
}

// 1. Current-scope employee — historical form still visible (clause A, unchanged).
check(monthlyReviewVisible(S, ctx({ code: 'MGR1', allowCodes: ['EMP01'] }), form({ reviewer_code: 'SOMEONE' })) === true,
  '1. Nhân sự trong review_scope hiện tại → phiếu lịch sử vẫn hiển thị (nhánh A giữ nguyên)');

// 2. Employee moved out of scope — visible to the reviewer recorded on the form (clause B).
check(monthlyReviewVisible(S, ctx({ code: 'MGR1', allowCodes: ['OTHER'] }), form({ reviewer_code: 'MGR1' })) === true,
  '2. Nhân sự đã rời review_scope → phiếu vẫn hiển thị cho người thẩm định ghi trên phiếu');

// 3. Same moved employee — NOT visible to an unrelated manager.
check(monthlyReviewVisible(S, ctx({ code: 'MGR2', allowCodes: ['OTHER'] }), form({ reviewer_code: 'MGR1' })) === false,
  '3. Phiếu lịch sử KHÔNG lộ cho quản lý khác (không phải reviewer, không trong scope)');

// 4. reviewer_code match works.
check(monthlyReviewVisible(S, ctx({ code: 'TBP-KHO' }), form({ reviewer_code: 'tbp-kho' })) === true,
  '4. Khớp reviewer_code (không phân biệt hoa/thường)');

// 5. reviewer_id match works.
check(monthlyReviewVisible(S, ctx({ id: 'acc-777' }), form({ reviewer_id: 'acc-777', reviewer_code: '' })) === true,
  '5. Khớp reviewer_id');

// 6. Manager with no historical form does not gain company-wide history.
check(monthlyReviewVisible(S, ctx({ code: 'MGR9', allowCodes: [] }), form({ reviewer_code: 'MGR1', reviewer_id: 'acc-1' })) === false,
  '6. Không có phiếu lịch sử nào của mình → không thấy lịch sử toàn công ty');

// isOwn guard still wins — never see/appraise your own form.
check(monthlyReviewVisible(S, ctx({ code: 'EMP01' }), form({ employee_code: 'EMP01', reviewer_code: 'EMP01' })) === false,
  '6b. Không bao giờ thấy phiếu của chính mình (isOwn) dù có khớp reviewer');

// admin_exception_open + waiting_review is hidden regardless (unchanged).
check(monthlyReviewVisible(S, ctx({ code: 'MGR1', allowCodes: ['EMP01'] }), form({ reviewer_code: 'MGR1', admin_exception_open: true, status: 'waiting_review' })) === false,
  '6c. admin_exception_open + waiting_review vẫn bị ẩn (giữ nguyên)');

// 7. Current/future appraisal scope behavior unchanged — no reviewer match, in scope → still true; not in scope, no match → false.
check(monthlyReviewVisible(S, ctx({ code: 'MGR1', allowIds: ['E-EMP'] }), form({ reviewer_code: '' })) === true,
  '7. Nhánh A (khớp allowedIds) vẫn hoạt động y như cũ');
check(monthlyReviewVisible(S, ctx({ code: 'MGR1', allowCodes: ['X'], allowIds: ['Y'] }), form({ reviewer_code: '', reviewer_id: '' })) === false,
  '7b. Ngoài scope + không phải reviewer → vẫn bị loại (không nới lỏng ngoài ý định)');

// Admin bypass unchanged.
check(monthlyReviewVisible({ role: 'admin' }, ctx({}), form({ reviewer_code: 'ZZZ' })) === true,
  '7c. Admin vẫn thấy tất cả (giữ nguyên)');

// ---------- Source-scan: FE historical population + submit path untouched ----------
const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');
const lib = fs.readFileSync(path.resolve(__dirname, '..', 'api/_lib/checklist-monthly.js'), 'utf8');

// 8. saveMonthlyReview keeps its own current-scope check + window-closed guard (NOT relaxed here / B4 untouched).
check(/if\(!access\.canReview\|\|!allowed\)fail\('Quyền thẩm định đã thay đổi/.test(lib),
  '8. saveMonthlyReview vẫn kiểm tra phạm vi thẩm định HIỆN TẠI (access.people) — không đổi');
check(/CHECKLIST_MONTHLY_REVIEW_WINDOW_CLOSED/.test(lib) && /reviewWindow\.canReview/.test(lib),
  '8b. saveMonthlyReview vẫn chặn quá hạn (CHECKLIST_MONTHLY_REVIEW_WINDOW_CLOSED) — B4 chưa làm');
check(!/reviewer_code.*===.*a\.employeeCode/.test(lib.slice(lib.indexOf('async function saveMonthlyReview'))) || /const assigned=/.test(lib),
  '8c. saveMonthlyReview không thêm nhánh bỏ qua phạm vi dựa trên reviewer snapshot');

// 9. 08/2026 appears in the Kỳ selector when the server returns at least one form (period options derived from reviews list).
check(/function managerReviewsPeriodOptions\(\)\{[\s\S]*roleWorkspaceState\.reviews[\s\S]*period_month/.test(app),
  '9. managerReviewsPeriodOptions() lấy danh sách kỳ từ roleWorkspaceState.reviews (server trả phiếu → kỳ xuất hiện)');

// 10. Historical period population = actual forms only (no synthetic "Chưa có phiếu" rows for non-participants).
check(/var isHistorical=period!==checklistActiveWorkPeriodValue\(\);/.test(app),
  '10. managerReviewsModel phân biệt kỳ lịch sử vs kỳ đang thực hiện');
check(/if\(!isHistorical\)Object\.keys\(rosterByCode\)\.forEach\(function\(c\)\{codes\[c\]=1;\}\);/.test(app),
  '10b. Kỳ lịch sử: dân số CHỈ từ phiếu thật (không thêm roster hiện tại → không "chưa đánh giá" giả cho chi nhánh không tham gia)');
check(/legacy:!inRoster&&!!form/.test(app) && /phfck-legacy-tag/.test(app),
  '10c. Nhân sự ngoài phạm vi hiện tại nhưng có phiếu kỳ cũ được gắn nhãn nhẹ "Phiếu kỳ cũ"');

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nALL PASS (' + 'historical review visibility + population + submit-path untouched' + ')');
