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
/* Regression guard: Account Admin was briefly wired to /admin/quan-tri/tai-khoan,
   a path that belongs to the Training Hub's own "Quản trị chung" workspace
   (Danh mục chung / Cấu hình / Direct Training Test — none of it PHF HR). That
   path is Hub-owned in PHFAppShell.shellFor() (index.html), which has no rule
   for it and falls through to the default 'hub' shell — so Account Admin
   rendered inside the Training Hub's own nav/Việc cần làm/Tiến độ shell instead
   of PHF HR's. Account Admin must live under /admin/nhan-su/*, the one prefix
   both shellFor() and phf-account-admin-safe.js's own main() recognize as HR. */
assert(router.includes("if(path==='/admin/tai-khoan'||path==='/admin/quan-tri/tai-khoan'||path==='/admin/accounts') return '/admin/nhan-su/tai-khoan';"),'Legacy account routes (including the old Hub-owned /admin/quan-tri/tai-khoan mis-wire) must redirect to the canonical PHF HR Account Admin route.');
assert(router.includes("'/admin/nhan-su/tai-khoan':Object.freeze({area:'admin',screen:'accounts',roles:['admin']})"),'Account Admin must be registered as a PHF HR sub-route under /admin/nhan-su, not the Training Hub /admin/quan-tri workspace.');
assert(!router.includes("'/admin/quan-tri/tai-khoan':Object.freeze"),'Account Admin must not keep a route registry entry under /admin/quan-tri (Training Hub-owned "Quản trị chung"), which is what put it inside the Hub shell.');
assert(!router.includes("path==='/admin/quan-tri/tai-khoan'&&typeof window.phfRenderAccountAdminSafe"),'The /admin/quan-tri dispatch block (Training Hub "Quản trị chung") must no longer special-case Account Admin.');
assert(router.includes("commandWrap('phfRenderAccountAdminSafe',function(){return '/admin/nhan-su/tai-khoan';});"),"phfRenderAccountAdminSafe's declared route must match the URL the router actually dispatches it from, or the router's applyingRoute guard silently skips the render.");
assert(api.includes('employeeMasterMode')&&server.includes('employeeMasterMode'),'Both API runtimes must support Employee Master.');
assert(service.includes('requireAdmin(session)')&&service.includes('EMPLOYEE_MASTER_ADMIN_REQUIRED'),'Backend must fail closed for non-admin sessions.');
assert(migration.includes('employee_private_profiles')&&migration.includes('employee_compensation')&&migration.includes('employee_master_history'),'Migration must keep sensitive and history tables separated.');
assert(/revoke all on table public\.employee_compensation from anon,authenticated/i.test(migration),'Compensation must remain unavailable to client roles.');
assert(ui.includes('Thông tin cá nhân và thu nhập chỉ hiển thị khi mở hồ sơ.'),'Employee list must explain sensitive-data visibility.');
assert(!service.includes('password_hash')&&!service.includes('password_salt'),'Employee Master must not read password fields.');
assert(index.includes("nhan-su(?:\\/|$)"),'Shell ownership (PHFAppShell.shellFor in index.html) must recognize every /admin/nhan-su/* path as PHF HR via a prefix match — an exact-match-only rule leaves sub-routes like Account Admin falling through to the default Training Hub shell.');
assert(ui.includes('PHF HR</span><i>›</i><span>Quản trị nhân sự')&&ui.includes('Tài khoản &amp; Hồ sơ nhân sự'),'Employee Master breadcrumb identity is missing.');
assert(['Công việc','Cá nhân','Hợp đồng','Thu nhập','Tài khoản'].every(label=>ui.includes("'"+label+"'"))&&!ui.includes("['history','Lịch sử']"),'Employee detail must expose exactly the five requested top-level sections.');
assert(!ui.includes('hồ sơ canonical')&&!ui.includes('identity đăng nhập')&&!ui.includes('Read model'),'Technical implementation text leaked into the employee UI.');
assert(accountUi.includes('activateHr({clear:false,restoreTitle:false})'),'Account subview must remain inside the PHF HR shell.');
/* Regression guard: phf-account-admin-safe.js's own main() picked phfHrRoot
   only on an EXACT match against '/admin/nhan-su'. Once Account Admin moved to
   /admin/nhan-su/tai-khoan, that check would silently fail and main() would
   fall back to the Training Hub's own #mainLesson/<main> container — the
   second half of why the screen rendered inside the Hub shell even after the
   route itself pointed at the right URL. */
assert(accountUi.includes("/^\\/admin\\/nhan-su(?:\\/|$)/.test(location.pathname)"),"Account Admin's main() must mount into phfHrRoot for every /admin/nhan-su/* path via a prefix match, not only the exact /admin/nhan-su URL.");
/* Regression guard: some navigation paths into the Tài khoản tab (e.g. the
   internal tab bar inside Account Admin itself) call renderAccounts()
   directly rather than going through window.phfRenderAccountAdminSafe.
   renderAccounts() must trigger its own server refresh (now fired before the
   HTML body is built, so the first-load skeleton in accountRows() can see
   ACCOUNT_LIST_LOADING already set) so every entry path loads real accounts
   instead of relying on a possibly empty/stale localStorage cache. */
assert(accountUi.includes("catch(e){}loadAccountsFromServer(false).catch(function(error){console.warn('[PHF Accounts] Tải danh sách máy chủ:"),'renderAccounts() must trigger a server refresh so every navigation path into the Tài khoản tab (not just the canonical route) loads real accounts.');
assert(accountUi.includes('ACCOUNT_LIST_READY')&&accountUi.includes('ACCOUNT_LIST_LOAD_ERROR'),'A failed/pending server refresh must be tracked so the table can distinguish "loading", "load failed" and "genuinely no accounts".');
assert(accountUi.includes('phfAcctRetryLoad'),'Empty-state message must offer a retry action when the server refresh failed.');
/* Regression guard: the "Quản lý tài khoản" button used to call
   phfAcctSafeTab('accounts') directly, which mounts the Account Admin screen
   without ever touching the URL. Browser Back then had no history entry to
   return to and could skip straight past PHF HR. The click handler must go
   through the router (window.phfNavigate) so the canonical route is pushed
   into history. */
assert(ui.includes("window.phfNavigate)window.phfNavigate('/admin/nhan-su/tai-khoan')"),'"Quản lý tài khoản" must navigate to the canonical PHF HR Account Admin route through the router, not mount the screen without changing the URL.');
console.log(`Employee Master tests: ${passed}/${passed} PASS`);
