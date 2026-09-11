'use strict';
/* Batch B - "stabilize multi-day violation entry" (Ghi nhận lỗi nhiều ngày,
   modal "XEM LẠI NHIỀU NGÀY" = multiReviewModalHtml() trong
   assets/js/checklist/phf-checklist-app.js).

   AUDIT FINDING (2026-09) đã xác nhận trước khi sửa:
   1. Backend duplicate/idempotency guard cho checklist_violation_records đã
      TỒN TẠI TỪ TRƯỚC (Batch D1) và có test riêng độc lập
      (scripts/test-checklist-violation-duplicate-idempotency.js,
      scripts/test-checklist-violation-repeat-same-day*.js): khoá kỹ thuật DUY
      NHẤT là unique index trên request_id (upsert onConflict:'request_id',
      ignoreDuplicates:true) + đọc lại (readback) xác nhận; fingerprint nội
      dung (employee+date+criterion...) KHÔNG còn được dùng để chặn insert -
      2 vi phạm khác nhau cùng nhân viên/cùng ngày/cùng tiêu chí vẫn được tạo
      thành 2 record độc lập nếu nghiệp vụ cho phép (2 request_id khác nhau).
      => File này KHÔNG lặp lại các test đó, chỉ RUN LẠI chúng ở gate hồi quy.
   2. Bug THẬT SỰ tìm thấy ở lớp UI: multiReviewModalHtml() (panel review của
      "Ghi nhận nhiều ngày") dùng markup CŨ <div class="phfck-submodal-card">
      không có thuộc tính data-phfck-submodal ở gốc và không dùng bất kỳ class
      nào có CSS thật (.phfck-submodal-card/-head/-actions không có rule nào
      trong phf-checklist.css) - hệ quả: (a) appendSubmodal() không nhận diện
      được layer (không overlay/backdrop/focus-trap, tràn lề như nội dung
      thường - đúng triệu chứng "khoảng trắng dư, phân cấp không rõ, cuộn dài"
      trong đặc tả), và (b) nút đóng data-phfck-submodal-close không có tổ tiên
      [data-phfck-submodal] để đóng - bấm X KHÔNG có tác dụng (bug chức năng
      thật, đúng "misplaced close/X button").
      Fix: đổi sang ĐÚNG khung modal chuẩn dùng khắp file
      (.phfck-modal-layer.phfck-edit-layer[data-phfck-submodal] > .phfck-modal
      > .phfck-modal-head/-body/-foot) + tái dùng .phfck-quick-review-list/
      .phfck-quick-review-item đã có CSS, gom theo Ngày (chip) để rõ phân cấp
      Nhân viên (đầu modal) → Ngày → Lỗi. KHÔNG đổi multiValidation()/
      multiOfficialPayload()/saveMultiOfficial() - state machine lưu/giữ dữ
      liệu khi thất bại và chỉ xoá khi thành công đã ĐÚNG từ trước, file này
      chỉ KHOÁ LẠI (regression-lock) các bất biến đó bằng static assertion,
      không phát minh test giả cho hành vi "partial success" không tồn tại
      thật ở backend (saveChecklistViolations là atomic-cả-batch theo thiết kế
      đã ghi chú "chặn CẢ BATCH" - không có chuyện 1 dòng thành công/1 dòng
      thất bại trong CÙNG một lần POST ngoài cơ chế request_id ở trên).

   Same source-scanning convention as scripts/test-checklist-quick-multi-person-ui.js
   (không có jsdom trong repo, logic render nằm trong 1 IIFE khổng lồ) - assert
   trên MÃ NGUỒN THẬT, không tự dựng lại DOM.

   Chạy thủ công: node scripts/test-checklist-violation-multiday-stabilize-2026-09.js
*/
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const app = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function extractFnSource(source, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}');
  const m = source.match(re);
  return m ? m[0] : null;
}

const multiReviewSrc = extractFnSource(app, 'multiReviewModalHtml');
const saveMultiOfficialSrc = extractFnSource(app, 'saveMultiOfficial');
// Isolate the actual rendered markup (the `return '...'` statement) from the
// explanatory /* ... */ comment above it, which intentionally NAMES the old
// legacy classes/attribute it replaced - a plain substring/regex check over
// the whole function source would false-fail on the comment's own prose.
const multiReviewMarkup = multiReviewSrc ? multiReviewSrc.slice(multiReviewSrc.indexOf("return '")) : null;

// ---------- B-layout-1: modal is now a REAL, closable, styled submodal ----------
check(!!multiReviewSrc, 'setup: multiReviewModalHtml() found');
check(!!multiReviewMarkup, 'setup: multiReviewModalHtml() return/markup statement isolated from its leading comment');
if (multiReviewMarkup) {
  check(/class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal/.test(multiReviewMarkup),
    'B-layout-1a. multiReviewModalHtml() root now carries data-phfck-submodal (appendSubmodal() can find/manage this layer)');
  check(/class="phfck-modal phfck-multi-review-modal"/.test(multiReviewMarkup),
    'B-layout-1b. Uses the standard .phfck-modal card (shared head/body/foot CSS), not the unstyled legacy .phfck-submodal-card');
  check(/data-phfck-close-submodal/.test(multiReviewMarkup) && !/data-phfck-submodal-close/.test(multiReviewMarkup),
    'B-layout-1c. Close (X) button now uses data-phfck-close-submodal - the attribute the global delegated handler actually closes by finding a [data-phfck-submodal] ancestor');
  check(!/phfck-submodal-card|phfck-submodal-head|phfck-submodal-actions/.test(multiReviewMarkup),
    'B-layout-1d. Legacy unstyled classes (phfck-submodal-card/-head/-actions) removed from the rendered markup');
}

// ---------- B-layout-2: CSS actually exists for the classes now used ----------
check(/\.phfck-multi-review-modal\{/.test(css), 'B-layout-2a. .phfck-multi-review-modal has real CSS (sizing)');
check(/\.phfck-modal-layer/.test(css) && /\.phfck-modal-head/.test(css) && /\.phfck-modal-foot/.test(css),
  'B-layout-2b. Reused .phfck-modal-layer/.phfck-modal-head/.phfck-modal-foot already have CSS (shared with every other stable modal in the app)');
check(/\.phfck-quick-review-item\{/.test(css), 'B-layout-2c. Reused .phfck-quick-review-item (per-item card) already has real CSS - no new bespoke item styling invented');
check(!/\.phfck-submodal-card\{|\.phfck-submodal-head\{|\.phfck-submodal-actions\{/.test(css),
  'B-layout-2d. No CSS ever existed for the old classes (confirms the pre-fix bug was real, not just a missing style)');

// ---------- B-layout-3: Employee -> Date -> Error hierarchy ----------
if (multiReviewSrc) {
  check(/phfck-multi-review-date-group/.test(multiReviewSrc) && /phfck-multi-review-date-chip/.test(multiReviewSrc),
    'B-layout-3a. Items are grouped under a per-date chip/subheader (clear Date -> Error hierarchy within the single employee shown in the modal head)');
  check(/byDate\[d\]\.items\.push\(row\)/.test(multiReviewSrc),
    'B-layout-3b. Grouping keys strictly by row.date (no reshuffle of row order/content)');
}
check(/\.phfck-multi-review-date-chip\{/.test(css), 'B-layout-3c. Date-chip subheader has real CSS');

// ---------- B-safety-1: submit-button disabled for the duration of the in-flight request (unchanged, locked) ----------
check(/var multiOfficialSaving=false;/.test(app), 'B-safety-1a. multiOfficialSaving guard variable exists');
if (saveMultiOfficialSrc) {
  check(/if\(multiOfficialSaving\)return;/.test(saveMultiOfficialSrc),
    'B-safety-1b. saveMultiOfficial() re-entrancy guard (blocks a second call while one is in flight, e.g. double-click)');
  check(/btn\.disabled=true;btn\.textContent='Đang lưu\.\.\.'/.test(saveMultiOfficialSrc),
    'B-safety-1c. Confirm button is disabled + relabelled while the request is in flight');
  check(/finally\{multiOfficialSaving=false;if\(btn\)\{btn\.disabled=false;/.test(saveMultiOfficialSrc),
    'B-safety-1d. Guard + button are always released in finally (no permanently-stuck submit button on error)');
}

// ---------- B-safety-2: failure retains rows+data intact; only a confirmed success clears them ----------
if (saveMultiOfficialSrc) {
  const throwIdx = saveMultiOfficialSrc.indexOf("throw new Error(data.message||data.error||'Không thể lưu các sự việc.')");
  const clearIdx = saveMultiOfficialSrc.indexOf('violationUiState.multiRows=[multiDayRowDefault()]');
  check(throwIdx > -1 && clearIdx > -1 && clearIdx > throwIdx,
    'B-safety-2a. The row-clearing statement is textually AFTER the backend-failure throw - a rejected/erroring response can never reach the code path that clears rows');
  check(!/catch\(err\)\{[\s\S]*multiRows=\[multiDayRowDefault/.test(saveMultiOfficialSrc),
    'B-safety-2b. The catch{} block never clears violationUiState.multiRows - entered data survives a failed/ambiguous submit for retry');
  check(/catch\(err\)\{checklistToast\('error','Không thể hoàn tất ghi nhận'/.test(saveMultiOfficialSrc),
    'B-safety-2c. A backend failure always surfaces its own error toast (never silently reported as success)');
}

// ---------- B-safety-3: on full success, the panel is cleared/closed (idle again for a fresh batch) ----------
if (saveMultiOfficialSrc) {
  check(/deleteMultiDraft\(\);violationUiState\.multiRows\.forEach\(function\(row\)\{evidenceClearScope\(row\.id\);\}\);violationUiState\.multiRows=\[multiDayRowDefault\(\)\]/.test(saveMultiOfficialSrc),
    'B-safety-3a. On confirmed success: draft deleted, evidence scopes cleared, rows reset to a single fresh row');
  check(/var modal=root&&root\.querySelector\('\[data-phfck-submodal\]'\);if\(modal\)modal\.remove\(\);/.test(saveMultiOfficialSrc),
    'B-safety-3b. On confirmed success: the review submodal is removed/closed');
}

// ---------- B-safety-4: request_id stays stable across retries (the real duplicate-guard key on the frontend side) ----------
check(/function ensureMultiRequestId\(row\)\{if\(row&&!row\.requestId\)row\.requestId=newStableViolationRequestId\('MULTI'\);return row&&row\.requestId\|\|'';\}/.test(app),
  'B-safety-4a. ensureMultiRequestId() only assigns a NEW id when the row has none yet - a retried row keeps its original request_id (matches the backend upsert onConflict:request_id idempotency key)');
if (saveMultiOfficialSrc) {
  check(!/requestId=newStableViolationRequestId/.test(saveMultiOfficialSrc),
    'B-safety-4b. saveMultiOfficial() itself never mints a fresh request_id on retry (would break idempotency)');
}

// ---------- B-safety-5: server-side readback verification before treating the batch as confirmed ----------
if (saveMultiOfficialSrc) {
  check(/action:'listChecklistViolations',requestIds:requestIds/.test(saveMultiOfficialSrc),
    'B-safety-5a. After a 200/ok write response, the client reads the rows back by request_id before finishing');
  check(/if\(missing\.length\)throw new Error\('Máy chủ chưa xác nhận đủ '\+missing\.length/.test(saveMultiOfficialSrc),
    'B-safety-5b. If readback is missing any requestId, this is treated as a hard failure (data NOT assumed clean/cleared)');
}

// ---------- B-backend-1: the duplicate/idempotency guard this UI relies on already exists (do not re-add/duplicate it) ----------
const violationsLibPath = path.resolve(__dirname, '..', 'api/_lib/checklist-violations.js');
const violationsLib = fs.readFileSync(violationsLibPath, 'utf8');
check(/\.upsert\(clean, ?\{ ?onConflict: ?'request_id', ?ignoreDuplicates: ?true ?\}\)/.test(violationsLib),
  "B-backend-1a. saveChecklistViolations() persists via upsert(..., {onConflict:'request_id', ignoreDuplicates:true}) - technical dedupe key IS request_id");
check(/KHONG con duoc dung\s*\n\s*de quyet dinh co insert/.test(violationsLib),
  'B-backend-1b. duplicate_fingerprint (content-based) is documented as audit-only, NOT an insert-blocking key (multiple genuinely-independent violations for the same employee/day/criterion remain allowed)');
check(fs.existsSync(path.resolve(__dirname, 'test-checklist-violation-duplicate-idempotency.js')),
  'B-backend-1c. Dedicated backend test for this guard already exists (test-checklist-violation-duplicate-idempotency.js) - re-run in the regression gate, not duplicated here');

// ---------- B-regression: single-day ("Nhập nhanh"/"Ghi nhận chi tiết") flows are untouched by this fix ----------
for (const fn of ['quickValidation', 'multiValidation', 'multiOfficialPayload', 'multiDayRowDefault', 'multiContextAt', 'multiCriterionAt']) {
  check(new RegExp('function ' + fn + '\\(').test(app), 'B-regression-1. Existing function ' + fn + '() still present (not renamed/removed by the layout fix)');
}
check(/data-phfck-multi-confirm-official/.test(app), 'B-regression-2. data-phfck-multi-confirm-official action wiring preserved (event delegation still targets the same attribute)');

console.log('');
if (failures) {
  console.error(failures + ' FAILURE(S)');
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED');
}
