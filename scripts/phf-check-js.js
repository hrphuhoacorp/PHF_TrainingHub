'use strict';
const fs=require('fs');
const path=require('path');
const cp=require('child_process');

const root=path.resolve(__dirname,'..');
const skippedDirectories=new Set(['node_modules','backups','private','.git','_ROLLBACK_BAN52','_backup_old','release-clean']);
let javascriptCount=0;
const forbiddenArtifacts=[];

function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(skippedDirectories.has(entry.name))continue;
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())walk(absolute);
    else{
      const relative=path.relative(root,absolute).replace(/\\/g,'/');
      if(/\.(?:bak|tmp|orig|rej)$/i.test(entry.name))forbiddenArtifacts.push(relative);
      if(entry.name.endsWith('.js')){
        cp.execFileSync(process.execPath,['--check',absolute],{stdio:'pipe'});
        javascriptCount++;
      }
    }
  }
}

function read(relative){return fs.readFileSync(path.join(root,relative),'utf8');}
function assert(condition,message){if(!condition)throw new Error(message);}
function occurrences(source,needle){return source.split(needle).length-1;}
function actionSet(file){
  const source=read(file);
  const matches=[...source.matchAll(/(?:payload\.action|action)\s*===\s*['"]([^'"]+)['"]/g)];
  return new Set(matches.map(match=>match[1]));
}

walk(root);
assert(!forbiddenArtifacts.length,`Không được đóng gói file backup/tạm: ${forbiddenArtifacts.join(', ')}`);

const localActions=actionSet('server.js');
const vercelActions=actionSet('api/data.js');
const missing=[...localActions].filter(action=>!vercelActions.has(action));
const extra=[...vercelActions].filter(action=>!localActions.has(action));
assert(!missing.length&&!extra.length,`API ACTION PARITY FAILED. Missing in Vercel: ${missing.join(', ')||'none'}; extra: ${extra.join(', ')||'none'}`);

const sqlPath='scripts/PHF_CHECKLIST_PRODUCTION_STABILITY_1.33.1.sql';
assert(fs.existsSync(path.join(root,sqlPath)),'Thiếu SQL Production Stability 1.33.1.');
const sql=read(sqlPath);
const requiredFunctions=[
  'phf_save_checklist_assignments','phf_save_checklist_template','phf_create_checklist_monthly',
  'phf_assert_checklist_violation_period_open','phf_guard_checklist_violation_finalized_period',
  'phf_mutate_checklist_violation','phf_delete_checklist_test_violations','phf_transition_checklist_task',
  'phf_save_checklist_permission_grants','phf_disable_checklist_permission_grant',
  'phf_save_checklist_monthly_self','phf_save_checklist_monthly_review',
  'phf_save_checklist_monthly_overdue_policy','phf_save_checklist_monthly_score_policy',
  'phf_save_checklist_late_points_policy','phf_save_checklist_repeat_violation_policy',
  'phf_apply_monthly_overdue_batch','phf_checklist_production_health'
];
for(const name of requiredFunctions){
  assert(occurrences(sql,`create or replace function public.${name}(`)===1,`SQL phải khai báo đúng một lần function ${name}.`);
}
assert((sql.match(/\$\$/g)||[]).length%2===0,'SQL có cặp dollar quote $$ không cân bằng.');
assert(/create trigger trg_phf_guard_violation_finalized_period[\s\S]*before insert or update or delete/i.test(sql),'Trigger khóa kỳ phải bảo vệ INSERT, UPDATE và DELETE.');
assert(/create unique index if not exists uq_checklist_violation_active_fingerprint/i.test(sql),'Thiếu unique index chống trùng lỗi official.');
assert(/CHECKLIST_DUPLICATE_DATA_EXISTS/i.test(sql),'Thiếu release gate dừng deploy khi dữ liệu lỗi đang trùng.');
assert(/CHECKLIST_SOURCE_SNAPSHOT_STALE/i.test(sql),'Thiếu khóa revision nguồn phân công/mẫu khi tạo kỳ.');
assert(/drop function if exists public\.phf_create_checklist_monthly\(text,jsonb,jsonb,text,text\)/i.test(sql),'Phải loại bỏ chữ ký RPC tạo kỳ cũ để không có đường ghi bypass revision.');
assert(/revoke all on function public\.phf_create_checklist_monthly\(text,jsonb,jsonb,jsonb,text,text\)/i.test(sql),'Thiếu REVOKE cho chữ ký RPC tạo kỳ mới.');
assert(/grant execute on function public\.phf_create_checklist_monthly\(text,jsonb,jsonb,jsonb,text,text\) to service_role/i.test(sql),'Thiếu GRANT service_role cho RPC tạo kỳ mới.');
assert(/drop function if exists public\.phf_disable_checklist_permission_grant\(uuid,text,text,text\)/i.test(sql),'Phải loại bỏ chữ ký RPC ngừng quyền cũ.');
assert(/revoke all on function public\.phf_disable_checklist_permission_grant\(uuid,text,text,text,timestamptz\)/i.test(sql),'Thiếu REVOKE cho RPC ngừng quyền có optimistic lock.');
assert(/CHECKLIST_MONTHLY_OVERDUE_SCORE_CHANGED/i.test(sql),'Xử lý quá hạn phải kiểm tra lại ledger lỗi trong transaction.');
assert(/phf_checklist_template_global/i.test(sql)&&/phf_checklist_assignment_global/i.test(sql),'Khởi tạo kỳ phải khóa đồng bộ cả phân công và thư viện mẫu.');

const monthly=read('lib/checklist-monthly.js');
assert(monthly.includes("db.rpc('phf_save_checklist_monthly_self'"),'Tự đánh giá phải lưu qua RPC transaction.');
assert(monthly.includes("db.rpc('phf_save_checklist_monthly_review'"),'Thẩm định phải lưu qua RPC transaction.');
assert(monthly.includes('p_source_revision:sourceRevision'),'Khởi tạo kỳ phải gửi revision snapshot phân công và thư viện mẫu.');
assert(monthly.includes("readAllRows('checklist_employee_assignment_history'"),'Lịch sử phân công phải được đọc phân trang đầy đủ.');

const recoveryBackend=read('lib/checklist-recovery.js');
const recoverySyncSql=read('scripts/PHF_CHECKLIST_RECOVERY_SYNC_1.40.0.sql');
const recoveryDeleteSql=read('scripts/PHF_CHECKLIST_RECOVERY_DELETE_1.40.1.sql');
assert(recoveryBackend.includes("db.rpc('phf_recovery_create_missing_monthly_forms'"),'Recovery đồng bộ phải ghi qua RPC transaction riêng.');
assert(recoveryBackend.includes("db.rpc('phf_recovery_delete_monthly_form'"),'Recovery xóa phải ghi qua RPC transaction riêng.');
assert(/create trigger phf_checklist_recovery_audit_immutable[\s\S]*before update or delete/i.test(recoverySyncSql),'Recovery audit ledger chưa được bảo vệ bất biến.');
assert(/admin_create_missing_form/i.test(recoverySyncSql)&&/on conflict\(period_month,employee_code\) do nothing/i.test(recoverySyncSql),'RPC đồng bộ thiếu audit hoặc idempotency theo phiếu.');
assert(/CHECKLIST_RECOVERY_SOURCE_STALE/i.test(recoverySyncSql)&&/phf_checklist_monthly\|/i.test(recoverySyncSql),'RPC đồng bộ thiếu source revision hoặc advisory lock.');
assert(/v_period\.status not in\('draft','open'\)/i.test(recoverySyncSql)&&/CHECKLIST_RECOVERY_PERIOD_LOCKED/i.test(recoverySyncSql),'RPC đồng bộ phải chỉ cho kỳ draft/open và chặn locked.');
assert(/admin_delete_monthly_form/i.test(recoveryDeleteSql)&&/v_form\.status not in\('waiting_self','waiting_review','reviewed'\)/i.test(recoveryDeleteSql),'RPC xóa thiếu audit hoặc whitelist trạng thái.');
assert(/v_form\.status='reviewed' and not coalesce\(p_confirm_pilot_test,false\)/i.test(recoveryDeleteSql),'Phiếu reviewed thiếu xác nhận Pilot/Test phía database.');
assert(/delete from public\.checklist_notifications[\s\S]*delete from public\.checklist_monthly_form_history[\s\S]*delete from public\.checklist_monthly_forms/i.test(recoveryDeleteSql),'Thứ tự xóa notification/history/form không an toàn.');
assert(/exception when others[\s\S]*admin_delete_monthly_form_failed/i.test(recoveryDeleteSql),'RPC xóa thiếu rollback subtransaction và failed audit.');
assert(!/delete from public\.checklist_violation_records|delete from public\.checklist_violation_tasks/i.test(recoveryDeleteSql),'Recovery xóa không được tác động violation hoặc task.');

const assignmentBackend=read('lib/checklist-assignments.js');
const templateBackend=read('lib/checklist-templates.js');
const permissionBackend=read('lib/checklist-permissions.js');
const taskBackend=read('lib/checklist-tasks.js');
assert(assignmentBackend.includes('expected_absent'),'Phân công thiếu optimistic-lock cho trường hợp bản ghi chưa tồn tại.');
assert(templateBackend.includes('expected_absent'),'Mẫu thiếu optimistic-lock cho trường hợp bản ghi chưa tồn tại.');
assert(permissionBackend.includes('expected_updated_at'),'Phân quyền thiếu optimistic-lock theo updated_at.');
assert(taskBackend.includes('operationTimingPolicy({required:true})'),'Task mutation chưa fail-closed khi thiếu chính sách thời hạn.');
assert(taskBackend.includes('p_expected_updated_at:before.updated_at'),'Task mutation thiếu optimistic-lock theo updated_at.');

const html=read('index.html');
const router=read('assets/js/phf-url-router.js');
assert(html.includes('1.33.1_production_stability')&&router.includes('1.33.1_production_stability'),'Cache version Checklist chưa đồng bộ 1.33.1_production_stability.');

/* PHF Release Hardening Sprint 1: assets/js|css|data dùng
   Cache-Control: public, max-age=31536000, immutable (Sprint 1 Commit 2).
   Nếu sửa các asset này (hoặc runtime loader trong index.html tính URL
   versioned) mà không bump build-info.json, trình duyệt sẽ giữ mãi bản cache
   cũ dưới cùng URL -> version skew HTML mới/asset cũ (sự cố Production đã
   xảy ra sau Sprint 2). Gate này chặn lại tình huống đó trước khi commit. */
function gitOutput(args){
  try{return cp.execFileSync('git',args,{cwd:root,encoding:'utf8'});}
  catch(e){return '';}
}
function gitNameList(args){
  return gitOutput(['diff','--name-only',...args]).split('\n').map(s=>s.trim()).filter(Boolean);
}
function releaseGateChangedFiles(){
  const untracked=gitOutput(['ls-files','--others','--exclude-standard']).split('\n').map(s=>s.trim()).filter(Boolean);
  let files=[...new Set([...gitNameList(['--cached']),...gitNameList([]),...untracked])];
  if(!files.length)files=gitNameList(['HEAD~1','HEAD']);
  return files;
}
function indexHtmlLoaderChanged(){
  let diff=gitOutput(['diff','--cached','--','index.html'])+gitOutput(['diff','--','index.html']);
  if(!diff.trim())diff=gitOutput(['diff','HEAD~1','HEAD','--','index.html']);
  if(!diff.trim())return false;
  const markers=['phf-runtime-loader','phf-build-bootstrap','phfAssetUrl'];
  return diff.split('\n').some(line=>/^[+-]/.test(line)&&!/^(\+\+\+|---)/.test(line)&&markers.some(m=>line.includes(m)));
}
const RELEASE_ASSET_PATTERN=/^assets\/(?:js|css|data)\//;
const releaseChangedFiles=releaseGateChangedFiles();
const releaseAssetTouched=releaseChangedFiles.filter(f=>RELEASE_ASSET_PATTERN.test(f));
const releaseLoaderTouched=releaseChangedFiles.includes('index.html')&&indexHtmlLoaderChanged();
const releaseBuildInfoTouched=releaseChangedFiles.includes('build-info.json');
if((releaseAssetTouched.length||releaseLoaderTouched)&&!releaseBuildInfoTouched){
  const touched=releaseLoaderTouched?[...releaseAssetTouched,'index.html (runtime loader)']:releaseAssetTouched;
  assert(false,`RELEASE GATE FAILED: đã sửa ${touched.join(', ')} nhưng build-info.json chưa bump version/fingerprint. Static assets dùng Cache-Control immutable 1 năm - phải đổi build-info.json để trình duyệt tải bản mới.`);
}

/* Một số asset KHÔNG dùng runtime loader phfAssetUrl() — chúng cache-bust
   qua thẻ <script>/<link> ?v= viết tay trong index.html, riêng biệt với
   build-info.json. Bump build-info.json không tự động xoay các thẻ này
   (đây chính là sự cố đã xảy ra ở 1.50.3 cho phf-knl-app.js/phf-knl.css,
   và lặp lại ở 1.50.5 cho phf-account-admin-safe.js: code đã deploy đúng
   nhưng browser vẫn giữ JS cũ vì quên bump thẻ ?v=). Gate nhỏ, cô lập: nếu
   1 trong các file dưới đây nằm trong changed-files thì thẻ ?v= tương ứng
   trong index.html phải có giá trị khác so với HEAD. */
function manualAssetTagChanged(assetHref){
  const headHtml=gitOutput(['show','HEAD:index.html']);
  if(!headHtml)return true;
  const pattern=new RegExp(assetHref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?v=([^"\']+)');
  const before=(headHtml.match(pattern)||[])[1];
  const after=(html.match(pattern)||[])[1];
  if(before===undefined||after===undefined)return true;
  return before!==after;
}
const MANUAL_VERSIONED_ASSETS=['assets/js/knl/phf-knl-app.js','assets/css/phf-knl.css','assets/js/phf-account-admin-safe.js'];
MANUAL_VERSIONED_ASSETS.forEach(assetPath=>{
  if(releaseChangedFiles.includes(assetPath)){
    assert(manualAssetTagChanged(assetPath),`RELEASE GATE FAILED: đã sửa ${assetPath} nhưng thẻ ?v= tương ứng trong index.html chưa đổi giá trị so với HEAD — browser sẽ giữ mãi bản cache cũ (đúng sự cố đã xảy ra ở 1.50.3). Hãy bump ?v= của asset này trong index.html.`);
  }
});

console.log(`CHECK PASS: ${javascriptCount} JS files · API parity · SQL stability gates · no backup artifacts · release fingerprint gate · KNL manual asset-tag gate`);
