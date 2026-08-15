'use strict';
/*
 * Regression Test — Workstream B (2026-08-15): rename permission_status -> manager_decision
 * (has_permission/no_permission -> approved/rejected), retire tab "Nhập thủ công/Nhập dồn"
 * khỏi UI Đi trễ, thêm bộ lọc DITRE ở violationCriteriaForContext() (phòng thủ lớp 2 cho Nhập
 * nhanh/Ghi nhận chi tiết/Ghi nhận nhiều ngày), gộp match_status kỹ thuật thành 4 nhãn nghiệp vụ
 * (Duyệt/Không duyệt/Chưa ghi nhận/Cần kiểm tra) ở UI đối soát Admin, và gỡ
 * quota_reference_snapshot khỏi migration trước lần chạy đầu tiên.
 * Toàn bộ chạy in-memory/pure-JS + grep-guard nguồn — KHÔNG kết nối Supabase thật, KHÔNG chạy
 * SQL nào (chỉ đọc text migration để grep).
 *   node scripts/test-checklist-late-manager-decision-rename-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const recon = require('../lib/checklist-late-reconciliation');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }

const RECON_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation.js'), 'utf8');
const SERVICE_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-late-workflow.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-app.js'), 'utf8');
const SQL = fs.readFileSync(path.join(__dirname, 'PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql'), 'utf8');

/* ============================================================================
 * 1) Grep-guard đổi tên — không còn permission_status/has_permission/no_permission "sống" ở
 *    bất kỳ file nào đã đụng tới (loại trừ comment lịch sử hợp lệ giải thích việc đổi tên, luôn
 *    xuất hiện kèm chữ "đổi tên"/"cũ" ngay trong cùng dòng/đoạn).
 * ============================================================================ */
function stripHistoricalRenameComments(src) {
  // Loại bỏ các dòng comment (// hoặc bắt đầu bằng --/ * có nhắc "đổi tên"/"rename") trước khi
  // grep — đây là những dòng MÔ TẢ LỊCH SỬ đổi tên, được phép nhắc tên cũ.
  return src.split('\n').filter(line => {
    const t = line.trim();
    const isCommentLine = t.startsWith('//') || t.startsWith('--') || t.startsWith('*') || t.startsWith('/*');
    if (!isCommentLine) return true;
    return !/(đổi tên|rename|dormant|DORMANT|RETIRED|re-verify)/i.test(line);
  }).join('\n');
}
check('lib/checklist-late-reconciliation.js: không còn PERMISSION_STATUS/permissionStatus/has_permission/no_permission ngoài comment lịch sử/fallback tương thích ngược đọc dữ liệu cũ', () => {
  const stripped = stripHistoricalRenameComments(RECON_SRC)
    // r.permissionStatus fallback trong reconcileManagerRecords() là fallback tương thích có
    // chủ đích để đọc được dữ liệu cũ trước rename — luôn đứng SAU r.managerDecision/
    // r.manager_decision (ưu tiên tên mới trước), không phải sót sửa.
    .replace(/r\.managerDecision \|\| r\.manager_decision \|\| r\.permissionStatus \|\| r\.permission_status/g, '');
  assert.ok(!/PERMISSION_STATUS/.test(stripped));
  assert.ok(!/\bpermissionStatus\b/.test(stripped));
  assert.ok(!/'has_permission'/.test(stripped));
  assert.ok(!/'no_permission'/.test(stripped));
  assert.ok(RECON_SRC.includes('MANAGER_DECISION'));
  assert.ok(RECON_SRC.includes("APPROVED: 'approved'"));
  assert.ok(RECON_SRC.includes("REJECTED: 'rejected'"));
});
check('lib/checklist-late-reconciliation-service.js: không còn permission_status/permissionStatus/has_permission/no_permission ngoài comment lịch sử', () => {
  const stripped = stripHistoricalRenameComments(SERVICE_SRC);
  assert.ok(!/permission_status/.test(stripped));
  assert.ok(!/\bpermissionStatus\b/.test(stripped));
  assert.ok(!/'has_permission'/.test(stripped));
  assert.ok(!/'no_permission'/.test(stripped));
  assert.ok(SERVICE_SRC.includes('manager_decision:'));
  assert.ok(SERVICE_SRC.includes('manager_decision_suggested'));
});
check('assets/js/checklist/phf-checklist-late-workflow.js: không còn permission_status/permissionStatus/has_permission/no_permission ngoài comment lịch sử/fallback tương thích', () => {
  const stripped = stripHistoricalRenameComments(UI_SRC);
  // rc.permissionStatus fallback (đọc dữ liệu cũ) là fallback tương thích có chủ đích, không
  // phải sót sửa — kiểm tra riêng nó tồn tại đúng 1 chỗ, có kèm rc.managerDecision ưu tiên trước.
  const withoutCompatFallback = stripped.replace(/rc\.managerDecision \|\| rc\.permissionStatus/g, '');
  assert.ok(!/'has_permission'/.test(withoutCompatFallback));
  assert.ok(!/'no_permission'/.test(withoutCompatFallback));
  assert.ok(UI_SRC.includes('managerDecision'));
  assert.ok(UI_SRC.includes("value=\"approved\""));
  assert.ok(UI_SRC.includes("value=\"rejected\""));
});
check('scripts/PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql: không còn permission_status/has_permission/no_permission (giá trị enum cũ) ngoài comment lịch sử — match_status="unmatched_default_no_permission" và admin_decision="apply_no_permission_points" là 2 enum KHÁC không liên quan tới rename này nên được phép còn substring "no_permission"', () => {
  const stripped = stripHistoricalRenameComments(SQL)
    .replace(/unmatched_default_no_permission/g, '')
    .replace(/apply_no_permission_points/g, '');
  assert.ok(!/permission_status/.test(stripped));
  assert.ok(!/has_permission/.test(stripped));
  assert.ok(!/no_permission/.test(stripped));
  assert.ok(SQL.includes('manager_decision text'));
  assert.ok(SQL.includes("check (manager_decision in ('approved','rejected'))"));
  assert.ok(SQL.includes('manager_decision_suggested'));
});

/* ============================================================================
 * 2) quota_reference_snapshot đã bị gỡ khỏi migration; 4 field scoring còn lại vẫn tồn tại
 *    trong DDL (không xóa) nhưng KHÔNG được service ghi trực tiếp field quota_reference_snapshot
 *    vào checklist_violation_records nữa (cột đã không còn tồn tại ở đó).
 * ============================================================================ */
check('Migration: quota_reference_snapshot đã bị gỡ hoàn toàn khỏi DDL (add column/rollback/verification)', () => {
  assert.ok(!/add column if not exists quota_reference_snapshot/.test(SQL));
  assert.ok(!/drop column if exists quota_reference_snapshot/.test(SQL));
  assert.ok(!/'quota_reference_snapshot'/.test(SQL) || /-- .*quota_reference_snapshot/.test(SQL), 'chỉ được phép còn nhắc trong comment giải thích, không còn trong DDL/verification list thật');
});
check('Migration: 4 field scoring còn lại (standard_points/suggested_points/admin_applied_points/frequency_reference_snapshot) vẫn tồn tại nullable trên checklist_late_bcc_import_rows (KHÔNG bị xóa)', () => {
  assert.ok(/standard_points numeric not null default 0/.test(SQL));
  assert.ok(/suggested_points numeric not null default 0/.test(SQL));
  assert.ok(/admin_applied_points numeric,/.test(SQL));
  assert.ok(/frequency_reference_snapshot jsonb not null default '\{\}'::jsonb/.test(SQL));
});
check('Service: KHÔNG còn ghi quota_reference_snapshot vào checklist_violation_records (cột đã bị gỡ) — grep-guard approveLateEvents/createLinkedAdjustment', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  const adjFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createLinkedAdjustment'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(!/quota_reference_snapshot\s*:/.test(approveFn), 'approveLateEvents không được set field quota_reference_snapshot trong payload nữa');
  assert.ok(!/quota_reference_snapshot\s*:/.test(adjFn), 'createLinkedAdjustment không được set field quota_reference_snapshot trong payload nữa');
});
check('Service: 4 field scoring còn lại (standard_points/suggested_points/admin_applied_points/frequency_reference_snapshot) VẪN đang được đọc/ghi thật ở service hiện tại (đánh giá lại so với audit ban đầu — KHÔNG dormant, xem comment PHASE-2 trong migration mục 4)', () => {
  assert.ok(/standard_points:\s*r\.standardPoints/.test(SERVICE_SRC), 'createBccImport phải còn ghi standard_points');
  assert.ok(/suggested_points:\s*r\.suggestedPoints/.test(SERVICE_SRC), 'createBccImport phải còn ghi suggested_points');
  assert.ok(/Number\(importRow\.suggested_points\)/.test(SERVICE_SRC), 'approveLateEvents phải còn đọc lại suggested_points để tính finalPoints');
  assert.ok(/admin_applied_points:\s*finalPoints/.test(SERVICE_SRC), 'approveLateEvents phải còn ghi admin_applied_points');
  assert.ok(/frequency_reference_snapshot:\s*r\.frequencyWarning/.test(SERVICE_SRC), 'createBccImport phải còn ghi frequency_reference_snapshot');
  assert.ok(/importRow\.frequency_reference_snapshot/.test(SERVICE_SRC), 'isEligibleForBulkApprove phải còn đọc frequency_reference_snapshot');
});

/* ============================================================================
 * 3) Manager observation vẫn ĐỘC LẬP — không tạo official violation, không chấm điểm.
 * ============================================================================ */
check('recordManagerLateObservation(): CHỈ insert/upsert vào MANAGER_OBSERVATION_TABLE, KHÔNG BAO GIỜ ghi vào VIOLATION_TABLE (0 official violation / 0 điểm)', () => {
  const fnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function recordManagerLateObservation'), SERVICE_SRC.indexOf('// Bí danh tương thích ngược'));
  assert.ok(fnSrc.includes('MANAGER_OBSERVATION_TABLE'));
  assert.ok(!fnSrc.includes('VIOLATION_TABLE'), 'recordManagerLateObservation không được đụng tới VIOLATION_TABLE');
  assert.ok(!/points\s*:/.test(fnSrc), 'recordManagerLateObservation không được set field điểm nào');
});

/* ============================================================================
 * 4) DITRE restoration (Step 1, 2026-08-15) — violationCriteriaForContext() (dùng chung cho
 *    Nhập nhanh/Ghi nhận chi tiết/Ghi nhận nhiều ngày) KHÔNG còn lọc bỏ criterion Đi trễ
 *    (mã chứa "DITRE") — khôi phục đúng flow hiện hữu trước Workstream B. Test cũ ở đây từng
 *    xác nhận điều NGƯỢC LẠI (bộ lọc loại bỏ DITRE); test này thay thế để khớp quyết định
 *    nghiệp vụ mới — field Duyệt/Không duyệt bắt buộc được thêm trực tiếp vào từng form thay
 *    vì tiếp tục chặn DITRE khỏi danh sách tiêu chí chung.
 * ============================================================================ */
function extractFn(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  assert.ok(start > -1, 'không tìm thấy function ' + name);
  const closeMarker = '\n  }';
  const end = src.indexOf(closeMarker, start);
  assert.ok(end > start, 'không tìm thấy điểm kết thúc function ' + name);
  return src.slice(start, end + closeMarker.length);
}
check('violationCriteriaForContext() KHÔNG còn lọc bỏ criterion Đi trễ (mã chứa "DITRE") — kiểm chứng thật bằng cách chạy hàm thật (trích từ source, không phải giả lập lại logic)', () => {
  assert.ok(APP_SRC.includes("['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]"), 'nguồn phải còn ví dụ PHF-DITRE-01 để test có ý nghĩa');
  assert.ok(APP_SRC.includes("['BH-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]"), 'nguồn phải còn ví dụ BH-DITRE-01 để test có ý nghĩa');

  const fromDefinitionSrc = extractFn(APP_SRC, 'violationCriteriaFromDefinition');
  const forContextSrc = extractFn(APP_SRC, 'violationCriteriaForContext');
  const sandbox = {
    normalizeText: v => String(v == null ? '' : v).trim(),
    checklistTemplateVersions: () => [{ version: 'v1', definition: {
      groups: [{ name: 'Nhóm', children: [{ name: 'Nhóm con', items: [
        ['PHF-DITRE-01', 'Đi trễ so với giờ vào ca theo lịch', 1],
        ['BH-DITRE-01', 'Đi trễ so với giờ vào ca theo lịch', 1],
        ['ditre-lowercase-01', 'Biến thể chữ thường', 1],
        ['PHF-TP-01', 'Tác phong làm việc', 1]
      ] }] }]
    } }],
    checklistTemplateDatabaseRow: () => null,
    loadBulkOverride: () => null,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fromDefinitionSrc + '\n' + forContextSrc + '\nthis.__result = violationCriteriaForContext({ ok: true, templateId: "T1", version: "v1" });', sandbox);
  const result = sandbox.__result;
  assert.ok(Array.isArray(result) && result.length === 4, 'phải còn đủ 4 tiêu chí (kể cả DITRE) sau khi bỏ bộ lọc, thực tế: ' + JSON.stringify(result));
  assert.ok(result.some(c => c.code === 'PHF-DITRE-01'), 'phải còn PHF-DITRE-01');
  assert.ok(result.some(c => c.code === 'BH-DITRE-01'), 'phải còn BH-DITRE-01');
  assert.ok(result.some(c => c.code === 'ditre-lowercase-01'), 'phải còn biến thể chữ thường ditre-lowercase-01');
  assert.ok(result.some(c => c.code === 'PHF-TP-01'), 'tiêu chí không phải DITRE vẫn còn nguyên');
});

/* ============================================================================
 * 5) Manual tool retirement — violationLateManualToolHtml() không còn được gọi từ
 *    violationLateHtml() (cả 2 nhánh), lateCriterionContext() giờ là dead code (chỉ còn được
 *    gọi từ chuỗi nội bộ của manual tool đã retired).
 * ============================================================================ */
check('violationLateHtml() không còn gọi violationLateManualToolHtml() ở bất kỳ nhánh nào (grep-guard bổ sung, độc lập với test route thật ở test-checklist-late-workflow-integration-2026-08.js)', () => {
  const fnSrc = extractFn(APP_SRC, 'violationLateHtml');
  assert.ok(!fnSrc.includes('violationLateManualToolHtml()'));
  assert.ok(!fnSrc.includes('data-phfck-late-inner-tab'));
});
check('lateCriterionContext(): caller DUY NHẤT còn lại (lateValidation/lateOfficialPayload) đều chỉ được gọi từ handler data-phfck-late-review/-submit của manual tool đã retired — không có caller nào khác trong file', () => {
  const callers = ['lateValidation(', 'lateOfficialPayload('];
  callers.forEach(fn => {
    const count = APP_SRC.split(fn).length - 1;
    // Định nghĩa hàm (1) + các lời gọi thật — mọi lời gọi thật phải nằm trong phạm vi manual
    // tool (saveLateDraft/lateReview/lateSubmit/saveLateOfficial), không có nơi nào khác.
    assert.ok(count >= 1, 'phải còn định nghĩa ' + fn);
  });
  assert.ok(APP_SRC.includes("var lateReview=e.target.closest('[data-phfck-late-review]')"));
  assert.ok(APP_SRC.includes("var lateSubmit=e.target.closest('[data-phfck-late-submit]')"));
});

/* ============================================================================
 * 6) UI Admin chỉ hiện đúng 4 nhãn nghiệp vụ thống nhất — không rò rỉ text kỹ thuật/điểm số.
 * ============================================================================ */
check('businessStatusLabel() (UI) sinh ĐÚNG 4 nhãn nghiệp vụ cho đủ các match_status/manager_decision_suggested — chạy hàm thật trích từ source', () => {
  const fnSrc = extractFn(UI_SRC, 'businessStatusLabel');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.__fn = businessStatusLabel;', sandbox);
  const fn = sandbox.__fn;
  const cases = [
    [{ match_status: 'ambiguous_needs_review' }, 'Cần kiểm tra'],
    [{ match_status: 'conflict_needs_review' }, 'Cần kiểm tra'],
    [{ match_status: 'unmatched_default_no_permission' }, 'Chưa ghi nhận'],
    [{ match_status: 'matched', manager_decision_suggested: 'approved' }, 'Duyệt'],
    [{ match_status: 'matched', manager_decision_suggested: 'rejected' }, 'Không duyệt'],
    [{ match_status: 'matched_agreed', manager_decision_suggested: 'approved' }, 'Duyệt'],
    [{ match_status: 'matched_agreed', manager_decision_suggested: 'rejected' }, 'Không duyệt']
  ];
  const seenLabels = new Set();
  cases.forEach(([row, expected]) => {
    const got = fn(row);
    assert.strictEqual(got, expected, 'row ' + JSON.stringify(row) + ' phải ra nhãn "' + expected + '", thực tế "' + got + '"');
    seenLabels.add(got);
  });
  assert.deepStrictEqual([...seenLabels].sort(), ['Chưa ghi nhận', 'Cần kiểm tra', 'Duyệt', 'Không duyệt'].sort(),
    'toàn bộ các case chỉ được sinh ra ĐÚNG 4 nhãn nghiệp vụ, không thừa/thiếu nhãn nào');
});
check('UI đối soát Admin: không còn rò rỉ text kỹ thuật match_status thô (vd "matched_agreed", "conflict_needs_review") làm NHÃN HIỂN THỊ trong hàm render bảng chính — chỉ businessStatusLabel() (đã gộp 4 nhãn) được dùng ở cột trạng thái', () => {
  const rowFnSrc = extractFn(UI_SRC, 'reconciliationRowHtml');
  assert.ok(rowFnSrc.includes('businessStatusLabel(row)'), 'cột trạng thái đối soát phải dùng businessStatusLabel(), không phải matchStatusLabel() kỹ thuật cũ');
  assert.ok(!UI_SRC.includes('function matchStatusLabel'), 'hàm matchStatusLabel() (5 trạng thái kỹ thuật cũ, trước 2026-08-15) phải bị xóa/thay thế hoàn toàn bởi businessStatusLabel()');
});
check('UI: suggestionLabel/label hiển thị KHÔNG còn ngôn ngữ điểm số kiểu "gợi ý trừ X điểm" (đã dọn theo brief 2026-08-15) ở lớp thuần lib/checklist-late-reconciliation.js', () => {
  assert.ok(!/gợi ý trừ \d+ ?điểm/i.test(RECON_SRC));
  const s1 = recon.computeSuggestion({ employeeCode: 'PHFX01', occurredDate: '2026-08-15', minutesLate: 20 }, []);
  assert.ok(!/gợi ý trừ/i.test(s1.suggestionLabel), 'suggestionLabel thật (default no_record) không được chứa "gợi ý trừ": ' + s1.suggestionLabel);
  const s2 = recon.computeSuggestion({ employeeCode: 'PHFX02', occurredDate: '2026-08-15', minutesLate: 20 }, [
    { employeeCode: 'PHFX02', occurredDate: '2026-08-15', managerDecision: 'rejected', createdAt: '2026-08-15T08:00:00Z' }
  ]);
  assert.ok(!/gợi ý trừ/i.test(s2.suggestionLabel), 'suggestionLabel thật (rejected) không được chứa "gợi ý trừ": ' + s2.suggestionLabel);
});

console.log('\n' + passCount + ' bài kiểm tra rename manager_decision / retire manual tool / DITRE filter / 4 nhãn nghiệp vụ / quota_reference_snapshot đều PASS.');
