'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
let passed=0;
function assert(condition,message){if(!condition)throw new Error(message);passed++;}
const router=read('assets/js/phf-url-router.js');
const api=read('api/data.js');
const server=read('server.js');
const service=read('lib/employee-master.js');
const migration=read('scripts/PHF_EMPLOYEE_MASTER_1.46.0.sql');
const ui=read('assets/js/phf-employee-master.js');
const accountUi=read('assets/js/phf-account-admin-safe.js');
const index=read('index.html');
assert(router.includes("'/admin/nhan-su'"),'Missing canonical Employee Master route.');
assert(/quan-tri\/tai-khoan'\|\|path==='\/admin\/accounts'\) return '\/admin\/nhan-su'/.test(router),'Legacy account routes must redirect to the canonical route.');
assert(api.includes('employeeMasterMode')&&server.includes('employeeMasterMode'),'Both API runtimes must support Employee Master.');
assert(service.includes('requireAdmin(session)')&&service.includes('EMPLOYEE_MASTER_ADMIN_REQUIRED'),'Backend must fail closed for non-admin sessions.');
assert(migration.includes('employee_private_profiles')&&migration.includes('employee_compensation')&&migration.includes('employee_master_history'),'Migration must keep sensitive and history tables separated.');
assert(/revoke all on table public\.employee_compensation from anon,authenticated/i.test(migration),'Compensation must remain unavailable to client roles.');
assert(ui.includes('Thông tin cá nhân và thu nhập chỉ hiển thị khi mở hồ sơ.'),'Employee list must explain sensitive-data visibility.');
assert(!service.includes('password_hash')&&!service.includes('password_salt'),'Employee Master must not read password fields.');
assert(index.includes("path==='/admin/nhan-su')return 'hr'"),'Employee Master must use the standalone PHF HR shell.');
assert(ui.includes('PHF HR</span><i>›</i><span>Quản trị nhân sự')&&ui.includes('Tài khoản &amp; Hồ sơ nhân sự'),'Employee Master breadcrumb identity is missing.');
assert(['Công việc','Cá nhân','Hợp đồng','Thu nhập','Tài khoản'].every(label=>ui.includes("'"+label+"'"))&&!ui.includes("['history','Lịch sử']"),'Employee detail must expose exactly the five requested top-level sections.');
assert(!ui.includes('hồ sơ canonical')&&!ui.includes('identity đăng nhập')&&!ui.includes('Read model'),'Technical implementation text leaked into the employee UI.');
assert(accountUi.includes('activateHr({clear:false,restoreTitle:false})'),'Account subview must remain inside the PHF HR shell.');
/* Regression guard: reaching the Tài khoản tab via Employee Master's
   "Quản lý tài khoản" button calls phfAcctSafeTab('accounts') -> renderAccounts()
   directly, never window.phfRenderAccountAdminSafe (the only place that used to
   call loadAccountsFromServer). Without a server refresh inside renderAccounts()
   itself, any admin with an empty/stale localStorage cache sees a permanently
   empty "Chưa có tài khoản phù hợp" list with zero network calls. */
assert(/setTimeout\(accountBulkUpdateUi,0\);phfHrLoadAccessState\(false\);loadAccountsFromServer\(false\)/.test(accountUi),'renderAccounts() must trigger a server refresh so every navigation path into the Tài khoản tab (not just the legacy direct route) loads real accounts.');
assert(accountUi.includes('ACCOUNT_LIST_LOAD_ERROR'),'A failed server refresh must be tracked so the empty-state message can distinguish "load failed" from "genuinely no accounts".');
assert(accountUi.includes('phfAcctRetryLoad'),'Empty-state message must offer a retry action when the server refresh failed.');
console.log(`Employee Master tests: ${passed}/${passed} PASS`);
