'use strict';
/*
 * PHF Checklist — Đi trễ: UI bảng đối soát Admin phản ánh đúng quota "4 lần Duyệt/tháng" và
 * business case A/B tách bạch (2026-08-16, batch hoàn thiện nghiệp vụ end-to-end).
 * Cover assets/js/checklist/phf-checklist-late-workflow.js:
 *   - quotaCellHtml(row, freq): ưu tiên hiển thị quota Duyệt khi có snapshot thật, fallback đúng
 *     hành vi cũ ("Cảnh báo tham chiếu") khi không có.
 *   - suggestedPointsCellHtml(row, isConflict): dòng approved_over_quota KHÔNG hiển thị "0 điểm"
 *     gây hiểu lầm miễn điểm (suggested_points DB chỉ là placeholder NOT NULL).
 *   - businessStatusLabel(row): nhãn "Duyệt — vượt quota" xuất hiện đúng khi có snapshot.
 * Chạy: node scripts/test-checklist-late-admin-review-table-quota-ui-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }

const UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-late-workflow.js'), 'utf8');

function extractFn(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  assert.ok(start > -1, 'không tìm thấy function ' + name);
  const closeMarker = '\n  }';
  const end = src.indexOf(closeMarker, start);
  assert.ok(end > start, 'không tìm thấy điểm kết thúc function ' + name);
  return src.slice(start, end + closeMarker.length);
}
function runFn(names) {
  const sandbox = { console };
  vm.createContext(sandbox);
  const helpers = 'function esc(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});}'
    + '\nfunction fmtPoints(n){var v=Number(n);return Number.isFinite(v)?v:0;}';
  const src = helpers + '\n' + names.map(n => extractFn(UI_SRC, n)).join('\n');
  vm.runInContext(src + '\n' + names.map(n => 'this.__' + n + ' = ' + n + ';').join('\n'), sandbox);
  return sandbox;
}

check('quotaCellHtml: có snapshot approvedQuota (overQuota=true) -> badge "Vượt quota (lần N/limit)" nổi bật (class is-quota-over), KHÔNG rơi về badge tham khảo cũ', () => {
  const sandbox = runFn(['quotaCellHtml']);
  const row = { frequency_reference_snapshot: { approvedQuota: { occurrenceNumber: 5, limit: 4, overQuota: true } } };
  const html = sandbox.__quotaCellHtml(row, {});
  assert.ok(html.includes('is-quota-over'), 'phải có class cảnh báo nổi bật');
  assert.ok(html.includes('5') && html.includes('4'), 'phải hiện đúng số lần/hạn mức');
});
check('quotaCellHtml: có snapshot approvedQuota (overQuota=false, trong hạn mức) -> hiện "Lần N/limit (trong hạn mức)", KHÔNG phải badge cảnh báo', () => {
  const sandbox = runFn(['quotaCellHtml']);
  const row = { frequency_reference_snapshot: { approvedQuota: { occurrenceNumber: 2, limit: 4, overQuota: false } } };
  const html = sandbox.__quotaCellHtml(row, {});
  assert.ok(!html.includes('is-quota-over'));
  assert.ok(html.includes('2') && html.includes('4') && html.includes('trong hạn mức'));
});
check('quotaCellHtml: KHÔNG có snapshot approvedQuota (dòng Không báo/Không duyệt, hoặc dữ liệu cũ) -> fallback ĐÚNG hành vi cũ "Cảnh báo tham chiếu" (giữ nguyên, không xoá cơ chế cũ)', () => {
  const sandbox = runFn(['quotaCellHtml']);
  const htmlOver = sandbox.__quotaCellHtml({}, { overThreshold: true, message: 'test msg' });
  assert.ok(htmlOver.includes('Cảnh báo tham chiếu'));
  const htmlNone = sandbox.__quotaCellHtml({}, { overThreshold: false });
  assert.strictEqual(htmlNone, '—');
});
check('suggestedPointsCellHtml: dòng approved_over_quota KHÔNG hiển thị "0 điểm" (dễ hiểu lầm miễn điểm) -> hiển thị "Cần kiểm tra" giống conflict', () => {
  const sandbox = runFn(['suggestedPointsCellHtml']);
  const rowOverQuota = { suggested_points: 0, frequency_reference_snapshot: { businessStatus: 'approved_over_quota' } };
  assert.strictEqual(sandbox.__suggestedPointsCellHtml(rowOverQuota, false), 'Cần kiểm tra');
  const rowConflict = { suggested_points: 0 };
  assert.strictEqual(sandbox.__suggestedPointsCellHtml(rowConflict, true), 'Cần kiểm tra');
});
check('suggestedPointsCellHtml: dòng bình thường (approved trong hạn mức, rejected, no_report) hiển thị đúng số điểm', () => {
  const sandbox = runFn(['suggestedPointsCellHtml']);
  const rowApproved = { suggested_points: 0, frequency_reference_snapshot: { businessStatus: 'approved' } };
  assert.strictEqual(sandbox.__suggestedPointsCellHtml(rowApproved, false), '0 điểm');
  const rowRejected = { suggested_points: 16, frequency_reference_snapshot: { businessStatus: 'rejected' } };
  assert.strictEqual(sandbox.__suggestedPointsCellHtml(rowRejected, false), '16 điểm');
});
check('businessStatusLabel: có snapshot businessStatus=approved_over_quota -> nhãn "Duyệt — vượt quota" (khác biệt rõ với "Duyệt" thường)', () => {
  const sandbox = runFn(['businessStatusLabel']);
  const row = { match_status: 'matched', manager_decision_suggested: 'approved', frequency_reference_snapshot: { businessStatus: 'approved_over_quota' } };
  assert.strictEqual(sandbox.__businessStatusLabel(row), 'Duyệt — vượt quota');
});
check('reconciliationRowHtml: bảng đối soát dùng quotaCellHtml()/suggestedPointsCellHtml() ở đúng 2 cột tương ứng (grep-guard wiring)', () => {
  const rowFnSrc = extractFn(UI_SRC, 'reconciliationRowHtml');
  assert.ok(rowFnSrc.includes('quotaCellHtml(row, freq)'), 'cột Cảnh báo quota Duyệt phải dùng quotaCellHtml()');
  assert.ok(rowFnSrc.includes('suggestedPointsCellHtml(row, isConflict)'), 'cột Điểm gợi ý phải dùng suggestedPointsCellHtml()');
});
check('Header bảng đối soát đổi đúng tên cột nghiệp vụ mới ("Trạng thái nghiệp vụ"/"Cảnh báo quota Duyệt")', () => {
  const tableFnSrc = extractFn(UI_SRC, 'reconciliationTableCardHtml');
  assert.ok(tableFnSrc.includes('Trạng thái nghiệp vụ'));
  assert.ok(tableFnSrc.includes('Cảnh báo quota Duyệt'));
});

check('rejectedBandPointsFor: ưu tiên frequency_reference_snapshot.standardRejectedPoints (băng REJECTED_BANDS thật), fallback về row.standard_points cho dòng staging cũ chưa có field mới', () => {
  const sandbox = runFn(['rejectedBandPointsFor']);
  const rowNew = { standard_points: 8, frequency_reference_snapshot: { standardRejectedPoints: 16 } };
  assert.strictEqual(sandbox.__rejectedBandPointsFor(rowNew), 16, 'phải ưu tiên standardRejectedPoints (16), KHÔNG lấy nhầm standard_points (8) là băng Không xin phép');
  const rowLegacy = { standard_points: 8 };
  assert.strictEqual(sandbox.__rejectedBandPointsFor(rowLegacy), 8, 'dòng cũ chưa có snapshot mới -> fallback về standard_points để không throw trên dữ liệu cũ');
});
check('buildApproveDecision: dòng Cần đối chiếu kết luận Không duyệt -> dùng rejectedBandPointsFor() (KHÔNG còn dùng thẳng row.standard_points) — grep-guard wiring', () => {
  const fnSrc = extractFn(UI_SRC, 'buildApproveDecision');
  assert.ok(/rejectedBandPointsFor\(row\)/.test(fnSrc), 'buildApproveDecision phải gọi rejectedBandPointsFor(row) khi tự tính resolvedPoints cho Không duyệt');
  assert.ok(!/resolvedManagerDecision === 'approved' \? 0 : Number\(row\.standard_points\)/.test(fnSrc), 'KHÔNG còn dùng nhầm row.standard_points trực tiếp (bug cũ đã fix)');
});
check('onChange resolveSel handler: auto-điền appliedPoints cho Không duyệt dùng rejectedBandPointsFor() — grep-guard wiring', () => {
  const idx = UI_SRC.indexOf("getAttribute('data-phfck-latewf-resolve')");
  assert.ok(idx > -1, 'không tìm thấy handler resolveSel');
  const snippet = UI_SRC.slice(idx, idx + 900);
  assert.ok(/rejectedBandPointsFor\(rrow\)/.test(snippet));
});
check('preselectCleanRows: KHÔNG auto-select dòng approved_over_quota (vượt quota Duyệt) — cùng nguyên tắc với conflict/ambiguous/frequency-warning (tiêu chí gộp chung vào isRowEligibleForBulk(), dùng lại cho cả preselectCleanRows và reviewSummaryCounts)', () => {
  const preselectSrc = extractFn(UI_SRC, 'preselectCleanRows');
  assert.ok(/isRowEligibleForBulk\(row\)/.test(preselectSrc), 'preselectCleanRows phải dùng isRowEligibleForBulk()');
  const eligibleSrc = extractFn(UI_SRC, 'isRowEligibleForBulk');
  assert.ok(/businessStatus\s*!==\s*'approved_over_quota'/.test(eligibleSrc), 'isRowEligibleForBulk phải loại trừ approved_over_quota khỏi auto-select');
});

console.log('\n' + passCount + ' bài kiểm tra UI bảng đối soát Admin (quota Duyệt/business case A-B) đều PASS.');
