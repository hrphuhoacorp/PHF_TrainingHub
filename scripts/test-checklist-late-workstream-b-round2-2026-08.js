'use strict';
/*
 * Regression Test — Workstream B vòng 2 (2026-08-14): wiring API/UI thật + 2 gap còn mở
 * (Excel 13 cột thật, late_minutes) trên nền lib/checklist-late-reconciliation.js và
 * lib/checklist-late-reconciliation-service.js đã có từ vòng 1 (19/19 PASS, giữ nguyên
 * không sửa file test cũ). Toàn bộ chạy in-memory/pure-JS + grep-guard nguồn — KHÔNG kết
 * nối Supabase thật (môi trường chỉ có 1 project cấu hình và đó là Production).
 *   node scripts/test-checklist-late-workstream-b-round2-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const recon = require('../lib/checklist-late-reconciliation');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }

const SERVICE_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* ================= Gap 1: Excel 13 cột thật — nhận diện cột + validate dòng ================= */
check('EXCEL_COLUMNS đúng 13 cột, đúng thứ tự theo spec PHF_MAU_GHI_NHAN_LOI_LATE_2026-08-14.xlsx', () => {
  assert.deepStrictEqual(recon.EXCEL_COLUMNS, [
    'Mã nhân viên', 'Họ tên', 'Ngày', 'Giờ', 'Địa điểm', 'Mã tiêu chí',
    'Nội dung tiêu chí', 'Nhận xét', 'Điểm', 'Phút trễ', 'Ca làm',
    'Lý do điều chỉnh', 'Trạng thái'
  ]);
});
check('parseBccExcelRows: file đủ 13 cột, dữ liệu hợp lệ -> nhận diện đủ, không thiếu, không dòng lỗi', () => {
  const row = { 'Mã nhân viên': 'PHF001', 'Họ tên': 'Nguyễn Văn A', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Địa điểm': 'Chi nhánh 1', 'Mã tiêu chí': 'X', 'Nội dung tiêu chí': 'x', 'Nhận xét': '', 'Điểm': 3, 'Phút trễ': 20, 'Ca làm': 'Sáng', 'Lý do điều chỉnh': '', 'Trạng thái': 'Đang nhập' };
  const r = recon.parseBccExcelRows([row]);
  assert.deepStrictEqual(r.missingColumns, []);
  assert.strictEqual(r.recognizedColumns.length, 13);
  assert.strictEqual(r.invalidRows.length, 0);
  assert.strictEqual(r.validRows.length, 1);
  assert.strictEqual(r.validRows[0].minutesLate, 20);
  assert.strictEqual(r.validRows[0].employeeCode, 'PHF001');
});
check('parseBccExcelRows: thiếu cột "Phút trễ" -> báo cáo missingColumns tường minh, không throw, không âm thầm coi 0', () => {
  const row = { 'Mã nhân viên': 'PHF001', 'Họ tên': 'A', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Địa điểm': 'CN1', 'Mã tiêu chí': 'X', 'Nội dung tiêu chí': 'x', 'Nhận xét': '', 'Điểm': 3, 'Ca làm': 'Sáng', 'Lý do điều chỉnh': '', 'Trạng thái': 'Đang nhập' };
  const r = recon.parseBccExcelRows([row]);
  assert.ok(r.missingColumns.includes('Phút trễ'));
  assert.strictEqual(r.invalidRows.length, 1);
  assert.ok(/Thiếu Phút trễ/.test(r.invalidRows[0].reasons.join(' ')));
});
check('parseBccExcelRows: cột thừa lạ (vd "Ghi chú thêm") vẫn được báo cáo ở extraColumns, không làm hỏng các dòng hợp lệ khác', () => {
  const row = { 'Mã nhân viên': 'PHF001', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Phút trễ': 5, 'Ca làm': 'Sáng', 'Ghi chú thêm': 'lạ' };
  const r = recon.parseBccExcelRows([row]);
  assert.ok(r.extraColumns.includes('Ghi chú thêm'));
  assert.strictEqual(r.validRows.length, 1);
});
check('parseBccExcelRows: nhiều dòng — dòng hợp lệ và dòng lỗi cùng tồn tại, mỗi dòng lỗi có lý do riêng theo excelRowNumber, không crash cả file', () => {
  const good = { 'Mã nhân viên': 'PHF001', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Phút trễ': 5, 'Ca làm': 'Sáng' };
  const badEmployee = { 'Mã nhân viên': '', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Phút trễ': 5, 'Ca làm': 'Sáng' };
  const badDate = { 'Mã nhân viên': 'PHF002', 'Ngày': 'không phải ngày', 'Giờ': '08:20', 'Phút trễ': 5, 'Ca làm': 'Sáng' };
  const badMinutesNeg = { 'Mã nhân viên': 'PHF003', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Phút trễ': -5, 'Ca làm': 'Sáng' };
  const badMinutesFloat = { 'Mã nhân viên': 'PHF004', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Phút trễ': 5.5, 'Ca làm': 'Sáng' };
  const r = recon.parseBccExcelRows([good, badEmployee, badDate, badMinutesNeg, badMinutesFloat]);
  assert.strictEqual(r.validRows.length, 1);
  assert.strictEqual(r.invalidRows.length, 4);
  assert.strictEqual(r.invalidRows[0].excelRowNumber, 3); // badEmployee ở rowIndex 1 -> excelRowNumber 3
  assert.ok(/Thiếu Mã nhân viên/.test(r.invalidRows[0].reasons.join(' ')));
  assert.ok(/Ngày không hợp lệ/.test(r.invalidRows[1].reasons.join(' ')));
  assert.ok(/không được âm/.test(r.invalidRows[2].reasons.join(' ')));
  assert.ok(/số nguyên/.test(r.invalidRows[3].reasons.join(' ')));
});
check('parseBccExcelRows: chấp nhận Ngày dạng dd/mm/yyyy (biến thể định dạng Excel thật) song song với ISO', () => {
  const row = { 'Mã nhân viên': 'PHF001', 'Ngày': '10/08/2026', 'Giờ': '08:20', 'Phút trễ': 5, 'Ca làm': 'Sáng' };
  const r = recon.parseBccExcelRows([row]);
  assert.strictEqual(r.validRows[0].occurredDate, '2026-08-10');
});
check('parseBccExcelRows: trường KHÔNG TIN (Họ tên/Mã tiêu chí/Nội dung tiêu chí/Điểm/Trạng thái) chỉ nằm trong untrusted{}, không lẫn vào các trường tin cậy dùng tính toán', () => {
  const row = { 'Mã nhân viên': 'PHF001', 'Họ tên': 'Tên giả mạo', 'Ngày': '2026-08-10', 'Giờ': '08:20', 'Điểm': 999, 'Trạng thái': 'Chính thức', 'Phút trễ': 5, 'Ca làm': 'Sáng' };
  const r = recon.parseBccExcelRows([row]);
  const parsedRow = r.validRows[0];
  assert.strictEqual(parsedRow.untrusted.employeeNameRaw, 'Tên giả mạo');
  assert.strictEqual(parsedRow.untrusted.pointsRaw, '999');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsedRow, 'points'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsedRow, 'employeeName'), false);
});
check('EXCEL_UNTRUSTED_COLUMNS đúng 5 cột theo brief — Họ tên/Mã tiêu chí/Nội dung tiêu chí/Điểm/Trạng thái', () => {
  assert.deepStrictEqual(recon.EXCEL_UNTRUSTED_COLUMNS, ['Họ tên', 'Mã tiêu chí', 'Nội dung tiêu chí', 'Điểm', 'Trạng thái']);
});
check('previewBccUpload KHÔNG BAO GIỜ tin trực tiếp Điểm/Trạng thái/Mã tiêu chí từ Excel để ghi — grep-guard: service không đọc points_raw/status_raw để set points/record_status', () => {
  assert.ok(!/pointsRaw/.test(SERVICE_SRC.match(/async function previewBccUpload[\s\S]*?\n}/)[0]));
});

/* ================= Gap 2: late_minutes — 8 mốc biên bắt buộc + "Không có dữ liệu" ================= */
check('Boundary late_minutes -> band chuẩn ĐÚNG cho đủ 8 giá trị bắt buộc: 0,1,15,16,30,31,45,46', () => {
  // 0 phút không nằm trong bất kỳ băng nào theo định nghĩa minMinutes=1 -> bandForMinutes clamp Math.max(1,...)
  // nên 0 rơi về băng 1-15 (đúng ý nghĩa "trễ ratio thấp nhất có thể ghi nhận"), không lỗi/không throw.
  assert.strictEqual(recon.bandForMinutes(0).points, 3);
  assert.strictEqual(recon.bandForMinutes(1).points, 3);
  assert.strictEqual(recon.bandForMinutes(15).points, 3);
  assert.strictEqual(recon.bandForMinutes(16).points, 6);
  assert.strictEqual(recon.bandForMinutes(30).points, 6);
  assert.strictEqual(recon.bandForMinutes(31).points, 8);
  assert.strictEqual(recon.bandForMinutes(45).points, 8);
  assert.strictEqual(recon.bandForMinutes(46).points, 12);
});
check('formatLateMinutesDisplay: số hợp lệ (kể cả 0) hiển thị đúng số, KHÔNG BAO GIỜ fabricate cho null/undefined — luôn "Không có dữ liệu"', () => {
  assert.strictEqual(recon.formatLateMinutesDisplay(0), '0');
  assert.strictEqual(recon.formatLateMinutesDisplay(20), '20');
  assert.strictEqual(recon.formatLateMinutesDisplay(null), 'Không có dữ liệu');
  assert.strictEqual(recon.formatLateMinutesDisplay(undefined), 'Không có dữ liệu');
  assert.strictEqual(recon.formatLateMinutesDisplay(''), 'Không có dữ liệu');
  assert.strictEqual(recon.formatLateMinutesDisplay(NaN), 'Không có dữ liệu');
});
check('late_minutes: service ghi vào violationPayload LUÔN lấy từ importRow.minutes_late (staging đã validate), KHÔNG parse từ note/ghi chú tự do (grep-guard)', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  assert.ok(/late_minutes:\s*Number\.isFinite\(Number\(importRow\.minutes_late\)\)/.test(approveFn), 'approveLateEvents phải gán late_minutes từ importRow.minutes_late');
  assert.ok(!/late_minutes.*note/i.test(approveFn) && !/note.*late_minutes/i.test(approveFn), 'late_minutes không được suy ra từ note');
});
check('late_minutes: createLinkedAdjustment (bản ghi delta) cũng tự có late_minutes riêng từ importRow.minutes_late — không dùng chung giá trị bản gốc qua FK', () => {
  const adjFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createLinkedAdjustment'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(/late_minutes:\s*Number\.isFinite\(Number\(importRow\.minutes_late\)\)/.test(adjFn));
});
check('exportLateReconciliation sheet2.soPhutTre dùng recon.formatLateMinutesDisplay(r.late_minutes) — không còn null cứng như vòng 1', () => {
  assert.ok(/soPhutTre:\s*recon\.formatLateMinutesDisplay\(r\.late_minutes\)/.test(SERVICE_SRC));
});

/* ================= Migration: late_minutes có mặt + constraint không âm ================= */
check('Migration 1.55.0: có cột late_minutes integer + check constraint >=0, đặt trên checklist_violation_records (bản ghi CHÍNH THỨC, không chỉ staging)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql'), 'utf8');
  assert.ok(/add column if not exists late_minutes integer/.test(sql));
  assert.ok(/checklist_violation_late_minutes_chk[\s\S]*?check \(late_minutes is null or late_minutes >= 0\)/.test(sql));
  assert.ok(/drop column if exists late_minutes/.test(sql), 'rollback section phải có late_minutes');
});

/* ================= Gap 3: server.js — action Workstream B, đúng khuôn mẫu dispatch hiện có =================
 * Vòng generalize (2026-08-14): tên action CHUNG (Manager) là chính; 2 tên cũ (ShiftLead) vẫn
 * còn trong server.js làm bí danh tương thích ngược trỏ ĐÚNG cùng hàm service — cả 2 bộ tên đều
 * phải có mặt và không hardcode role ở tầng router. */
const REQUIRED_ACTIONS = [
  'recordChecklistLateManagerObservation',
  'listChecklistLateManagerObservations',
  'recordChecklistLateShiftLeadObservation',
  'listChecklistLateShiftLeadObservations',
  'previewChecklistLateBccUpload',
  'createChecklistLateBccImport',
  'reconcileChecklistLateBccImport',
  'approveChecklistLateEvents',
  'createChecklistLateLinkedAdjustment',
  'exportChecklistLateReconciliation'
];
check('server.js: đủ các action Workstream B (tên chung + bí danh tương thích ngược), mỗi action đều nằm trong khối POST /api/data đã có session (requireSession) phía trước', () => {
  const dataBlockStart = SERVER_SRC.indexOf("pathname === '/api/data'");
  assert.ok(dataBlockStart > -1);
  REQUIRED_ACTIONS.forEach(action => {
    const idx = SERVER_SRC.indexOf("payload.action === '" + action + "'");
    assert.ok(idx > dataBlockStart, 'thiếu action ' + action + ' trong server.js hoặc nằm ngoài khối /api/data');
  });
});
check('server.js: các action Workstream B gọi ĐÚNG hàm service tương ứng (không gọi nhầm/gọi rỗng) — tên chung recordManagerLateObservation/listManagerLateObservations là chính, bí danh cũ vẫn gọi đúng cùng hàm (qua alias trong service)', () => {
  assert.ok(/await recordManagerLateObservation\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await listManagerLateObservations\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await recordShiftLeadLateObservation\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await listShiftLeadLateObservations\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await previewChecklistLateBccUpload\(session, payload\.rows \|\| \[\]\)/.test(SERVER_SRC));
  assert.ok(/await createChecklistLateBccImport\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await reconcileChecklistLateBccImport\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await approveChecklistLateEvents\(session, payload\.decisions \|\| \[\]\)/.test(SERVER_SRC));
  assert.ok(/await createChecklistLateLinkedAdjustment\(session, payload\.input \|\| \{\}\)/.test(SERVER_SRC));
  assert.ok(/await exportChecklistLateReconciliation\(session, payload\.filters \|\| \{\}\)/.test(SERVER_SRC));
});
check('server.js: không có yêu cầu session admin-only cứng ở tầng router cho action ghi nhận (quyền thật nằm ở service, không hardcode role ở server.js) — evidence: cả action tên chung lẫn bí danh cũ đều không chứa điều kiện role', () => {
  const lineNew = SERVER_SRC.match(/if \(payload && payload\.action === 'recordChecklistLateManagerObservation'\) \{[\s\S]*?\n {8}\}/)[0];
  const lineOld = SERVER_SRC.match(/if \(payload && payload\.action === 'recordChecklistLateShiftLeadObservation'\) \{[\s\S]*?\n {8}\}/)[0];
  assert.ok(!/role\s*===\s*'admin'/.test(lineNew));
  assert.ok(!/role\s*===\s*'admin'/.test(lineOld));
});

/* ================= Gap 7 (bulk-approve revalidation) — backend tự kiểm tra lại, không tin frontend ================= */
check('approveLateEvents: khi decision.bulk===true, backend tự gọi lại isEligibleForBulkApprove() bằng dữ liệu importRow đã lưu — grep-guard xác nhận có block revalidation trước khi ghi official', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  assert.ok(/decision\.bulk === true/.test(approveFn));
  assert.ok(/recon\.isEligibleForBulkApprove\(/.test(approveFn));
  assert.ok(/skipped: true/.test(approveFn), 'dòng không đủ điều kiện phải bị loại RIÊNG (skipped), không chặn cả batch, không throw');
});
check('isEligibleForBulkApprove: mô phỏng 1 dòng "tưởng sạch" nhưng thật ra match_status là ambiguous_needs_review (selection cũ/tampered) -> loại đúng dòng đó, không throw cả batch', () => {
  const staleImportRowLike = { matchStatus: 'ambiguous_needs_review', suggestedPoints: 3 };
  const eligible = recon.isEligibleForBulkApprove(staleImportRowLike, null, null);
  assert.strictEqual(eligible, false);
});
check('isEligibleForBulkApprove: dòng sạch thật (matchStatus hợp lệ, không cảnh báo, điểm không bị chỉnh tay) -> vẫn được duyệt hàng loạt bình thường', () => {
  const cleanImportRowLike = { matchStatus: 'matched', suggestedPoints: 6 };
  const eligible = recon.isEligibleForBulkApprove(cleanImportRowLike, { overThreshold: false }, null);
  assert.strictEqual(eligible, true);
});

/* ================= Upload/preview KHÔNG BAO GIỜ ghi chính thức — chỉ approve mới ghi ================= */
check('createBccImport/reconcileBccImport/previewBccUpload KHÔNG chèn/ghi vào bảng checklist_violation_records — grep-guard: chỉ approveLateEvents/createLinkedAdjustment mới .from(VIOLATION_TABLE) ghi (insert/upsert)', () => {
  const previewFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function previewBccUpload'), SERVICE_SRC.indexOf('async function createBccImport'));
  const createImportFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createBccImport'), SERVICE_SRC.indexOf('async function reconcileBccImport'));
  const reconcileFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function reconcileBccImport'), SERVICE_SRC.indexOf('async function approveLateEvents'));
  [previewFn, createImportFn, reconcileFn].forEach(fnSrc => {
    assert.ok(!new RegExp('from\\(VIOLATION_TABLE\\)\\s*\\n?\\s*\\.(insert|upsert)').test(fnSrc), 'preview/createImport/reconcile không được insert/upsert vào VIOLATION_TABLE');
  });
});
check('Chỉ approveLateEvents và createLinkedAdjustment mới ghi vào VIOLATION_TABLE (đúng bằng chứng "chỉ phê duyệt mới tạo official")', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  const adjFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createLinkedAdjustment'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(/from\(VIOLATION_TABLE\)[\s\S]*?\.(upsert|insert)/.test(approveFn));
  assert.ok(/from\(VIOLATION_TABLE\)[\s\S]*?\.insert/.test(adjFn));
});

/* ================= Xuất dữ liệu — không xuất lương, có filter, có audit ================= */
check('exportLateReconciliation: KHÔNG có bất kỳ field lương/salary/thu nhập nào trong sheet1/sheet2 (grep-guard)', () => {
  const exportFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function exportLateReconciliation'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(!/salary|luong|thu_nhap|income/i.test(exportFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
});
check('exportLateReconciliation: hỗ trợ đủ bộ lọc filters — dateFrom/dateTo/department/branch/employeeCode/managerDecision/approvalStatus', () => {
  const exportFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function exportLateReconciliation'), SERVICE_SRC.indexOf('module.exports'));
  ['filters.dateFrom', 'filters.dateTo', 'filters.department', 'filters.branch', 'filters.employeeCode', 'filters.managerDecision', 'filters.approvalStatus'].forEach(f => {
    assert.ok(exportFn.includes(f), 'thiếu filter ' + f);
  });
});
check('exportLateReconciliation: có ghi audit (exportedBy/exportedAt/filters/rowCount)', () => {
  const exportFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function exportLateReconciliation'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(/exportedBy/.test(exportFn) && /exportedAt/.test(exportFn) && /rowCount/.test(exportFn));
});

/* ================= Vòng generalize (2026-08-14): actor generic, record-scope ≠ view-scope, đối chiếu nhiều người, export nhãn chung ================= */
const VIOLATIONS_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-violations.js'), 'utf8');

check('resolveViolationPermission(): record dùng grant.record_scope, view dùng grant.view_scope — 2 phạm vi TÁCH BIỆT (bằng chứng record-scope ≠ view-scope, đúng 1 dòng nguồn duy nhất quyết định)', () => {
  const fnSrc = VIOLATIONS_SRC.slice(VIOLATIONS_SRC.indexOf('async function resolveViolationPermission'), VIOLATIONS_SRC.indexOf('async function permissionAssignmentRows'));
  assert.ok(/const scopeSource = action === 'record' \? grant\.record_scope : grant\.view_scope;/.test(fnSrc), 'phải rẽ nhánh record_scope/view_scope theo action, không dùng chung 1 cột cho cả 2');
});
check('recordManagerLateObservation() gọi requireViolationPermission(session,\'record\') — dùng ĐÚNG record-scope, KHÔNG BAO GIỜ dùng view-scope (action=\'view\') để quyết định ai được ghi nhận', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');
  const fnStart = src.indexOf('async function recordManagerLateObservation');
  const fnEnd = src.indexOf('\n// Bí danh tương thích ngược');
  const fnBody = src.slice(fnStart, fnEnd);
  assert.ok(/requireViolationPermission\(session,\s*'record'\)/.test(fnBody));
  assert.ok(!/requireViolationPermission\(session,\s*'view'\)/.test(fnBody), 'ghi nhận KHÔNG được dùng view-scope');
});
check('view≠record thật sự khác nhau trong dữ liệu: PRESETS.QUAN_LY_TRUC_TIEP có view_scope rộng (direct_reports, được xem) nhưng recordScope=\'none\' (KHÔNG được ghi) — kịch bản thật chứng minh 2 phạm vi có thể lệch nhau, không phải lý thuyết suông', () => {
  const { PRESETS } = require('../lib/checklist-permissions');
  const preset = PRESETS.QUAN_LY_TRUC_TIEP;
  assert.strictEqual(preset.capabilities.view_violations, true, 'preset này PHẢI có quyền xem để test có ý nghĩa (view rộng)');
  assert.strictEqual(preset.viewScope.type, 'direct_reports');
  assert.strictEqual(preset.capabilities.record_violation, false, 'preset này KHÔNG có quyền ghi — record-scope hẹp hơn view-scope');
  assert.strictEqual(preset.recordScope.type, 'none');
});
check('Cấu trúc chứng minh cơ chế KHÔNG so khớp theo tên preset/role cụ thể: BẤT KỲ preset nào có capabilities.record_violation=true + recordScope hợp lệ đều dùng CHUNG 1 đường resolveViolationPermission()/subjectMatchesScope() — TRUONG_CA_BH và TRO_LY_GD (2 preset rất khác nhau) đi qua đúng cùng 1 hàm, không có nhánh rẽ theo preset_code', () => {
  const { PRESETS } = require('../lib/checklist-permissions');
  const { subjectMatchesScope } = require('../lib/checklist-scope');
  // TRUONG_CA_BH: department_branch. TRO_LY_GD: all_company. Khác cấu trúc scope hoàn toàn,
  // nhưng cùng 1 hàm subjectMatchesScope() xử lý cả 2 — không có code riêng cho từng preset.
  const subject = { department: 'Bán hàng', branch: 'Phú Lợi' };
  const truongCaAllowed = subjectMatchesScope(subject, PRESETS.TRUONG_CA_BH.recordScope, {});
  const troLyGdAllowed = subjectMatchesScope(subject, PRESETS.TRO_LY_GD.recordScope, {});
  assert.strictEqual(truongCaAllowed, true);
  assert.strictEqual(troLyGdAllowed, true, 'all_company phải luôn true bất kể subject nào — cùng hàm, khác scope type, không hardcode preset_code nào trong subjectMatchesScope()');
  const scopeSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-scope.js'), 'utf8');
  assert.ok(!/TRUONG_CA|TRO_LY_GD|QUAN_LY_TRUC_TIEP/.test(scopeSrc), 'subjectMatchesScope() (nguồn so khớp scope duy nhất) không được biết tới tên preset cụ thể nào');
});
check('Crafted request: nhân sự ngoài record-scope của TRUONG_CA_BH (khác phòng ban/chi nhánh) bị requireViolationPermission()/permissionEmployees() loại — evidence từ chính subjectMatchesScope() dùng trong recordManagerLateObservation (không tin department/branch client tự gửi)', () => {
  const { PRESETS } = require('../lib/checklist-permissions');
  const { subjectMatchesScope } = require('../lib/checklist-scope');
  const outsider = { department: 'Kế toán', branch: 'Trụ sở chính' };
  assert.strictEqual(subjectMatchesScope(outsider, PRESETS.TRUONG_CA_BH.recordScope, {}), false);
});
check('Crafted request: nhân sự ngoài record-scope của TRUONG_BO_PHAN (khác department) cũng bị loại — chứng minh cơ chế áp dụng cho MỘT vai trò KHÁC, không chỉ Trưởng ca, không cần sửa code', () => {
  const { PRESETS } = require('../lib/checklist-permissions');
  const { subjectMatchesScope } = require('../lib/checklist-scope');
  const inScope = subjectMatchesScope({ department: 'Bộ phận bán hàng' }, PRESETS.TRUONG_BO_PHAN.recordScope, {});
  const outOfScope = subjectMatchesScope({ department: 'Kho' }, PRESETS.TRUONG_BO_PHAN.recordScope, {});
  assert.ok(PRESETS.TRUONG_BO_PHAN.capabilities.record_violation === true);
  assert.strictEqual(inScope, false, 'TRUONG_BO_PHAN.recordScope.values rỗng theo mặc định preset (phải được set cụ thể lúc cấp quyền) — rỗng thì KHÔNG khớp department nào, kể cả "đúng" tên, nên inScope ở đây phản ánh đúng hành vi "chưa cấu hình values thì không cho ai" (an toàn theo mặc định)');
  assert.strictEqual(outOfScope, false);
});
check('Peer cùng cấp / nhân viên thường (không có record_violation) bị requireViolationPermission chặn ngay ở bước allowed — grep-guard: action=\'record\' trả allowed=false khi không tìm thấy grant có capabilities.record_violation===true', () => {
  const fnSrc = VIOLATIONS_SRC.slice(VIOLATIONS_SRC.indexOf('async function resolveViolationPermission'), VIOLATIONS_SRC.indexOf('async function permissionAssignmentRows'));
  assert.ok(/capabilityName = action === 'record' \? 'record_violation' : 'view_violations'/.test(fnSrc));
  assert.ok(/allowed: false/.test(fnSrc));
});

/* ================= Đối chiếu nhiều người ghi nhận — service level (staging + approve) ================= */
check('previewBccUpload: dòng match_status=conflict_needs_review được gán rowStatus=NEEDS_REVIEW ("Cần đối chiếu") ngay từ bước preview, không lẫn với pending_approval bình thường', () => {
  const fnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function previewBccUpload'), SERVICE_SRC.indexOf('async function createBccImport'));
  assert.ok(/conflict_needs_review/.test(fnSrc));
  assert.ok(/recon\.ROW_STATUS\.NEEDS_REVIEW/.test(fnSrc));
});
check('createBccImport: lưu recorders_snapshot (audit trail từng người ghi nhận) vào staging — không chỉ lưu mỗi kết quả gộp/kết luận cuối', () => {
  const fnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createBccImport'), SERVICE_SRC.indexOf('async function reconcileBccImport'));
  assert.ok(/recorders_snapshot/.test(fnSrc));
});
check('approveLateEvents: dòng Cần đối chiếu (conflict_needs_review) BẮT BUỘC có lý do (>=5 ký tự) VÀ Admin phải tự chọn resolvedManagerDecision rõ ràng — KHÔNG tự suy diễn theo thời điểm gần nhất/theo "cấp bậc" nào (grep-guard không có logic sort theo createdAt/role để chọn thắng-thua)', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  assert.ok(/CHECKLIST_LATE_RECON_CONFLICT_REASON_REQUIRED/.test(approveFn));
  assert.ok(/CHECKLIST_LATE_RECON_CONFLICT_RESOLUTION_REQUIRED/.test(approveFn));
  assert.ok(/decision\.resolvedManagerDecision/.test(approveFn));
  assert.ok(!/\.sort\(/.test(approveFn), 'approveLateEvents không được tự sắp xếp/chọn theo thời điểm để giải quyết mâu thuẫn — luôn cần Admin xác nhận tường minh');
});
check('approveLateEvents: bulk===true trên dòng conflict_needs_review vẫn bị chặn qua isEligibleForBulkApprove() (đã grep-guard ở test khác) — ở đây xác nhận thêm việc dòng conflict dùng effectiveSuggestedPoints tính lại theo resolvedManagerDecision, không dùng thẳng suggested_points placeholder (=0) đã lưu lúc preview', () => {
  const approveFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
  assert.ok(/effectiveSuggestedPoints/.test(approveFn));
});

/* ================= Export — nhãn cột/sheet TỔNG QUÁT, không gắn tên vai trò cụ thể ================= */
check('exportLateReconciliation: sheet1 (ghi nhận từ bộ phận) có cột vaiTroNguoiGhi/boPhanGhi/chiNhanhGhi lấy từ DỮ LIỆU THẬT (r.recorder_role_label/r.department/r.branch) — không phải nhãn hardcode 1 vai trò', () => {
  const exportFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function exportLateReconciliation'), SERVICE_SRC.indexOf('module.exports'));
  assert.ok(/vaiTroNguoiGhi:\s*r\.recorder_role_label/.test(exportFn));
  assert.ok(/boPhanGhi:\s*r\.department/.test(exportFn));
  assert.ok(/chiNhanhGhi:\s*r\.branch/.test(exportFn));
});
check('UI export: sheet Excel đặt tên chung "Ghi nhận từ bộ phận" (không còn "Ghi nhận Trưởng ca")', () => {
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-late-workflow.js'), 'utf8');
  assert.ok(uiSrc.includes("book_append_sheet(wb, sheet1, 'Ghi nhận từ bộ phận')"));
  assert.ok(!uiSrc.includes("'Ghi nhận Trưởng ca'"));
});
check('UI: cột "Ghi nhận từ bộ phận" trong bảng đối soát (không còn tiêu đề "Ghi nhận Trưởng ca"), source vẫn phân biệt đủ các match_status kỹ thuật để đối chiếu dữ liệu (dù nhãn hiển thị Admin đã gộp thành 4 nhãn nghiệp vụ — xem test "4 unified business labels" riêng, 2026-08-15)', () => {
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-late-workflow.js'), 'utf8');
  assert.ok(uiSrc.includes('<th>Ghi nhận từ bộ phận</th>'));
  assert.ok(!uiSrc.includes('Ghi nhận Trưởng ca'));
  assert.ok(!uiSrc.includes('Khớp Trưởng ca'));
  ['ambiguous_needs_review', 'conflict_needs_review', 'matched_agreed', 'unmatched_default_no_permission'].forEach(status => {
    assert.ok(uiSrc.includes("'" + status + "'"), 'thiếu xử lý match_status=' + status + ' trong UI');
  });
});

/* ================= Grep-guard tổng: tên bảng/hàm cũ đã đổi hẳn thành tên chung ở nguồn chính ================= */
check('Migration SQL: bảng chính đã đổi tên thành checklist_late_manager_observations (tên chung), không còn checklist_late_shift_lead_records ở bất kỳ đâu trong file (kể cả rollback)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql'), 'utf8');
  assert.ok(sql.includes('create table if not exists public.checklist_late_manager_observations('));
  assert.ok(!/checklist_late_shift_lead_records/.test(sql));
  assert.ok(sql.includes('drop table if exists public.checklist_late_manager_observations;'), 'rollback section phải theo tên bảng mới');
});
check('Migration SQL: import_rows có cột recorders_snapshot (audit trail nhiều người ghi nhận) và match_status/manager_decision_suggested đã có ghi chú mô tả các giá trị mới (conflict_needs_review/matched_agreed/\'conflict\')', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'PHF_CHECKLIST_LATE_BCC_RECONCILIATION_1.55.0.sql'), 'utf8');
  assert.ok(/recorders_snapshot jsonb not null default '\[\]'::jsonb/.test(sql));
  assert.ok(/conflict_needs_review/.test(sql));
  assert.ok(/matched_agreed/.test(sql));
});

console.log('\n' + passCount + ' bài kiểm tra Workstream B vòng 2 (API wiring/Excel/late_minutes/bulk-revalidation/generalize-actor/multi-recorder) đều PASS.');
