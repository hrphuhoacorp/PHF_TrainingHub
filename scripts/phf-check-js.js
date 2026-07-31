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

console.log(`CHECK PASS: ${javascriptCount} JS files · API parity · SQL stability gates · no backup artifacts`);
