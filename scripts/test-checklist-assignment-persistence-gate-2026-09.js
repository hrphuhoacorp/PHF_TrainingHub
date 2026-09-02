'use strict';
/* BUG #1 - Assignment persistence false-success gate (Admin -> Checklist -> Nhân sự).
   Trước fix: confirmFormAssignment() ghi localStorage rồi báo "Đã gán mẫu" NGAY, DB persist
   là fire-and-forget/debounce 450ms. Nếu stale -> RPC rollback cả batch, client set blocked=true,
   các lần gán sau bị bỏ qua âm thầm nhưng UI vẫn báo thành công -> F5 hydrate lại mẫu cũ.

   Fix: confirmFormAssignment() phải await persistChecklistAssignmentsToDatabase({throwOnError})
   và CHỈ báo success sau khi Supabase (canonical) xác nhận commit; nếu lỗi -> hoàn tác ghi tạm
   trên trình duyệt + hiện lỗi trung thực.

   SOURCE-SCAN convention (như scripts/test-checklist-actionable-notifications-ui.js phần A).
   Chạy thủ công: node scripts/test-checklist-assignment-persistence-gate-2026-09.js
*/
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/js/checklist/phf-checklist-app.js'), 'utf8');
const lib = fs.readFileSync(path.join(root, 'api/_lib/checklist-assignments.js'), 'utf8');

let failures = 0;
function check(cond, msg){ if(!cond){ console.error('FAIL: '+msg); failures++; } else console.log('PASS: '+msg); }

// Isolate confirmFormAssignment body.
const start = app.indexOf('function confirmFormAssignment(');
const body = app.slice(start, app.indexOf('\n  }\n', start));

check(start > 0, 'confirmFormAssignment tồn tại');
check(/persistChecklistAssignmentsToDatabase\(\{[^}]*throwOnError:\s*true/.test(body),
  'confirmFormAssignment gọi persistChecklistAssignmentsToDatabase với throwOnError:true (chờ DB xác nhận)');

// The success toast must be INSIDE the resolved .then of the persist promise, never before it.
const persistIdx = body.indexOf('persistChecklistAssignmentsToDatabase(');
const successIdx = body.indexOf("checklistToast('success'");
check(successIdx > persistIdx && successIdx > 0,
  "toast('success') nằm SAU lời gọi persist (không báo thành công lạc quan)");
check(/\.then\(function\(\)\{\s*checklistToast\('success'/.test(body.replace(/\s+/g, ' ')) ||
      /then\(function\(\) *\{ *checklistToast\('success'/.test(body),
  "toast('success') nằm trong .then() của persist promise");

check(/\.catch\(function\(error\)\{/.test(body.replace(/\s+/g,'')),
  'có nhánh .catch xử lý lỗi persist');
check(/if\(previous\)revert\[key\]=previous;\s*else\s+delete revert\[key\]/.test(body),
  'nhánh lỗi HOÀN TÁC ghi tạm localStorage về giá trị trước đó (revert)');
check(body.indexOf("checklistToast('error'") > successIdx,
  "nhánh lỗi hiện toast('error') trung thực");
check(/CHECKLIST_ASSIGNMENT_STALE/.test(body) && /F5/.test(body),
  'nhánh lỗi phân biệt stale và hướng dẫn F5');
check(/CHƯA được áp dụng/.test(body),
  'thông điệp lỗi nói rõ mẫu CHƯA được áp dụng (không giả vờ canonical)');

// Guard against regression: no bare synchronous success toast left on the happy path.
check(!/refreshPeopleWorkspace\(root\);checklistToast\('success'/.test(body),
  'không còn toast success đồng bộ ngay sau refreshPeopleWorkspace (false-success cũ đã bỏ)');

// blocked=true must still force truthful error (not silent skip) via throwOnError path.
check(/if\(checklistAssignmentDbState\.blocked\)\{if\(options\.throwOnError\)\{var blockedError[\s\S]{0,200}code='CHECKLIST_ASSIGNMENT_STALE'/.test(app),
  'persistChecklistAssignmentsToDatabase: khi blocked + throwOnError -> ném lỗi STALE (không nuốt âm thầm)');

// Datastore lock: Checklist assignments = Supabase only, same client for read & write.
check(/createClient\(String\(process\.env\.SUPABASE_URL\)/.test(lib) &&
      /const supabase = /.test(lib),
  'checklist-assignments.js: 1 Supabase client duy nhất cho cả đọc & ghi (cùng project)');
check(!/phf_hr|Company Postgres|task\./i.test(lib),
  'checklist-assignments.js: KHÔNG dính phf_hr / Company PG / task.* (Supabase-only)');
check(lib.indexOf("'checklist_employee_assignments'") > 0 &&
      lib.indexOf("'checklist_employee_assignment_history'") > 0,
  'canonical table + history table đúng tên');

console.log(failures ? ('\n'+failures+' FAIL') : '\nALL PASS');
process.exit(failures ? 1 : 0);
