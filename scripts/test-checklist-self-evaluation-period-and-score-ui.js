'use strict';
/*
 * Regression — SELF EVALUATION CLOSE-OUT (source-scan; no Production DB):
 *   A. Tự đánh giá có selector "Kỳ đánh giá" (chỉ liệt kê kỳ NV thực sự có phiếu; đổi kỳ -> tải lại).
 *   B. Dòng Checklist tự động (CT-03 "Tuân thủ tiêu chuẩn công việc") hiển thị chỉ đọc,
 *      không input/spinner, ghi rõ "Điểm hệ thống / Tự động từ lỗi Checklist".
 *
 * Không đổi: công thức điểm, permission contract, review_scope, RPC, schema, migration.
 * Thẩm định (reviewer) giữ nguyên — chỉ nới nhận diện dòng tự động ở nhánh Tự đánh giá.
 *
 *   node scripts/test-checklist-self-evaluation-period-and-score-ui.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); failed++; } else console.log('PASS: ' + m); };

const lib = fs.readFileSync(path.resolve(__dirname, '..', 'api/_lib/checklist-monthly.js'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');

// ---------- A. Server: availablePeriods cho selector ----------
ok(/const periodListRes=await db\.from\('checklist_monthly_forms'\)\.select\('period_month,status'\)\.eq\(idCol,idVal\)/.test(lib),
  'A1. myMonthlyForm truy vấn danh sách kỳ từ chính phiếu của tài khoản (không dựng kỳ giả)');
ok(/availablePeriods\.push\(\{month:m,formStatus:t\(r\.status\)\}\)/.test(lib),
  'A2. availablePeriods = các period_month duy nhất NV thực sự có phiếu');
ok((lib.match(/availablePeriods,selectedMonth/g) || []).length >= 2 && /period:periodData,availablePeriods,selectedMonth:selectedMonth\|\|\(refreshed&&refreshed\.period_month\)/.test(lib),
  'A3. Mọi nhánh return của myMonthlyForm đều kèm availablePeriods + selectedMonth');
ok(/if\(input\.month\)q=q\.eq\('period_month',month\(input\.month\)\)/.test(lib),
  'A4. Chọn kỳ lịch sử -> lọc đúng period_month (đã có sẵn, giữ nguyên)');
ok(!/CREATE (TABLE|OR REPLACE FUNCTION)|ALTER TABLE|migration/i.test(lib.split('async function myMonthlyForm')[1].split('\n}')[0]),
  'A5. Không schema/migration trong myMonthlyForm');

// ---------- A. Frontend: selector UI + reload ----------
ok(/function roleMonthlySelectorHtml\(\)\{/.test(app), 'A6. Có roleMonthlySelectorHtml()');
ok(/data-phfck-self-period/.test(app) && /phfck-reviews-toolbar/.test(app.split('function roleMonthlySelectorHtml')[1].split('function roleMonthlyHtml')[0]),
  'A7. Selector dùng lại thành phần .phfck-reviews-toolbar/.phfck-reviews-filter như Thẩm định');
ok(/roleWorkspaceState\.monthlyAvailablePeriods/.test(app) && /if\(months\.length<1\)return ''/.test(app),
  'A8. Chỉ render khi có kỳ thật; không có kỳ -> không hiện selector rỗng');
ok(/function loadRoleMonthlyPeriod\(root,month\)\{/.test(app) && /roleWorkspaceRequest\('checklistMonthlySelf','getMyChecklistMonthly','Không thể tải phiếu tháng\.',\{month:month\}\)/.test(app),
  'A9. Đổi kỳ -> gọi lại getMyChecklistMonthly với {month} (không đụng formId kỳ khác)');
ok(/e\.target\.matches\('\[data-phfck-self-period\]'\)\)\{loadRoleMonthlyPeriod\(root,e\.target\.value/.test(app),
  'A10. change trên selector -> loadRoleMonthlyPeriod');
ok(/monthlySelectedPeriod=data\.selectedMonth\|\|\(data\.form&&data\.form\.period_month\)/.test(app),
  'A11. Mặc định theo kỳ server trả (kỳ đang thực hiện nếu có / newest hợp lệ)');
ok(/loadRoleMonthlyPeriod[\s\S]{0,400}monthlyLoading\|\|roleWorkspaceState\.savingMonthly\)return/.test(app),
  'A12. Không đổi kỳ khi đang lưu/đang tải (tránh ghi nhầm)');

// ---------- B. Checklist tự động: chỉ đọc, không input ----------
// Nhánh Tự đánh giá: automatic true -> render <span class="phfck-auto-score is-system-locked">, KHÔNG <input>.
const selfBody = app.split("'<div class=\"phfck-self-table\"")[1].split('function roleMonthlyChecklistBreakdownHtml')[0] || app;
ok(/var automatic=monthlyAutomaticSource\(r\.source,r\.name,r\.sourceType\)\|\|r\.source==='Checklist'/.test(app),
  "B1. Tự đánh giá: dòng có source='Checklist' (khớp tên 'Tuân thủ tiêu chuẩn công việc') luôn coi là tự động");
ok(/phfck-auto-score is-system-locked"><b>'\+esc\(value\)\+'<\/b><small>🔒 Điểm hệ thống<\/small>/.test(app),
  'B2. Dòng tự động: primary = giá trị điểm, secondary gọn = "🔒 Điểm hệ thống" (không câu dài chen chỗ)');
ok(/phfck-auto-note">Tự động từ lỗi Checklist · '/.test(app), 'B3. Text phụ trợ "Tự động từ lỗi Checklist" nằm ở ô ghi chú, ngoài ô điểm');
ok(!/automatic\?'<input[^']*data-phfck-self-value/.test(app),
  'B4. Dòng tự động KHÔNG có <input data-phfck-self-value> (không spinner/không focus edit)');

// roleMonthlyRows: gán source='Checklist' theo tên kể cả snapshot cũ không có source.type
ok(/normalizeMatchText\(item\.name\)\.indexOf\('tuan thu tieu chuan cong viec'\)>=0\)item\.source='Checklist'/.test(app),
  'B5. roleMonthlyRows chuẩn hóa source=\'Checklist\' cho snapshot cũ (không có field source.type)');

// ---------- B. Server vẫn là nguồn chân lý của điểm Checklist ----------
ok(/const rows=allRows\.filter\(r=>!isAutomaticSource\(r\.source,r\.name\)\),allowed=new Set\(rows\.map\(r=>r\.code\)\)/.test(lib),
  'B6. saveMyMonthly loại mã tự động khỏi tập đáp án hợp lệ (crafted CT-03 bị bỏ)');
ok(/if\(!allowed\.has\(t\(k\)\)\)return;/.test(lib),
  'B7. Đáp án cho code không thuộc allowed bị drop (không ghi checklist score thủ công)');
ok(/checklist_score:breakdown\.score/.test(lib) && /form=\{\.\.\.form,checklist_score:breakdown\.score,checklist_breakdown:breakdown\}/.test(lib),
  'B8. checklist_score luôn = breakdown.score do server tính');
ok(/phf_save_checklist_monthly_self/.test(lib) && /p_expected_checklist_score:Number\(form\.checklist_score/.test(lib),
  'B9. RPC phf_save_checklist_monthly_self tự tính lại điểm chính thức (không đổi RPC)');

// ---------- Hard rules: không đổi formula/permission/RPC/schema ----------
ok(!/SCORE_FORMULA_VERSION\s*=/.test(lib), 'C1. Không định nghĩa lại formula version');
ok(/isAutomaticSource\(sourceType!==undefined/.test(lib) === false || /function isAutomaticSource/.test(lib),
  'C2. isAutomaticSource phía server giữ nguyên');
ok((lib.match(/CHECKLIST_MONTHLY_PERIOD_LOCKED/g) || []).length >= 2,
  'C3. Kỳ đã khóa vẫn chặn ghi (self + review) — B4 giữ nguyên');
ok(/canEdit:statusAllowed&&!periodLocked/.test(lib),
  'C4. B4: quá hạn không khóa; chỉ kỳ Admin khóa mới read-only');
ok(/if\(!access\.canReview\|\|!allowed\)fail\('Quyền thẩm định đã thay đổi/.test(lib),
  'C5. review_scope / permission contract của Thẩm định không đổi');

// ---------- Reviewer path không đổi ----------
ok(/monthlyAutomaticSource\(r\.source,r\.name,r\.sourceType\),sa=self\[r\.code\]/.test(app),
  'D1. Nhánh Thẩm định vẫn dùng monthlyAutomaticSource nguyên bản (không thêm ||r.source)');
ok(/data-phfck-review-checklist-score/.test(app) && /data-phfck-review-checklist-reason/.test(app),
  'D2. Điều khiển điểm Checklist phía reviewer giữ nguyên');

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nALL PASS (Self-evaluation period selector + Checklist auto-score display-only; no formula/permission/RPC/schema change; reviewer unchanged)');
