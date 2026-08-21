'use strict';
/*
 * PHF Checklist — Workstream A2/A3 backend service.
 * Lớp mỏng bọc quanh RPC ở scripts/PHF_CHECKLIST_RETROACTIVE_ENGINE_1.53.0.sql, theo
 * đúng khuôn mẫu lib/checklist-templates.js (ensureAdmin trước mọi thao tác ghi, RPC chạy
 * dưới service_role). Đây là bề mặt mà một UI admin (wizard 8 bước ở A3) sẽ gọi; wizard
 * UI đầy đủ chưa được dựng trong batch này (xem báo cáo bàn giao, mục "deviations") —
 * các hàm dưới đây đã đủ để thực hiện toàn bộ luồng qua script/console admin ngay.
 */
require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const {diffDefinitions,simulateScoreImpact,runRetroactiveBatch,planEmployeeImpactBatch}=require('./checklist-template-retroactive');
const {validateScoredDefinition}=require('./checklist-templates');
const {calculateMonthlyScore}=require('./checklist-score-engine');
const {checklistBreakdown}=require('./checklist-monthly');

const hasEnv=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=hasEnv?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
function t(v){return String(v==null?'':v).trim();}
function ensureAdmin(session){if(!session||session.role!=='admin'){const e=new Error('Chỉ Admin được vận hành công cụ áp dụng lại phiên bản mẫu Checklist.');e.statusCode=403;e.code='CHECKLIST_RETRO_ADMIN_REQUIRED';throw e;}}
function fail(message,code,statusCode){const e=new Error(message);e.statusCode=statusCode||400;e.code=code;throw e;}
function requireDb(){if(!db)fail('Supabase chưa được cấu hình.','SUPABASE_NOT_CONFIGURED',503);}

/* Bước 1-2-3: sao chép version + chỉnh sửa + validate (A1 connection-gate + weight). */
async function copyTemplateVersion(session,input={}){
  ensureAdmin(session);requireDb();
  const templateKey=t(input.templateKey).toLowerCase(),sourceVersion=t(input.sourceVersion),newVersion=t(input.newVersion),effectiveDate=t(input.effectiveDate);
  if(!templateKey||!sourceVersion||!newVersion)fail('Thiếu template_key, phiên bản nguồn hoặc phiên bản mới.','CHECKLIST_RETRO_INPUT_REQUIRED');
  if(input.definition)validateScoredDefinition(input.definition);
  const actorId=t(session.account?.id||session.sub),actorName=t(session.account?.name||session.email);
  const saved=await db.rpc('phf_copy_checklist_template_version',{
    p_template_key:templateKey,p_source_version:sourceVersion,p_new_version:newVersion,
    p_effective_date:effectiveDate||new Date().toISOString().slice(0,10),p_reason:t(input.reason),
    p_definition_override:input.definition||null,p_actor_id:actorId,p_actor_name:actorName
  });
  if(saved.error)fail(saved.error.message,'CHECKLIST_RETRO_COPY_FAILED',503);
  const result=saved.data||{};if(result.ok!==true)fail(t(result.message)||'Không sao chép được phiên bản.',t(result.code)||'CHECKLIST_RETRO_COPY_FAILED',409);
  return result;
}

/* Bước 4: preview/diff — thuần JS, không cần ghi DB.
   Không ghi dữ liệu nhưng vẫn lộ cấu trúc mẫu/điểm nội bộ nên vẫn bắt buộc
   admin-only ở server, không được để hở qua session learner/manager
   (route cha chỉ requireSession(['learner','manager','admin']) — xem server.js). */
function previewDiff(session,{oldDefinition,newDefinition}={}){
  ensureAdmin(session);
  const diff=diffDefinitions(oldDefinition,newDefinition);
  const errors=[];
  if(Math.abs(diff.totalWeightAfter-100)>0.001)errors.push('Tổng trọng số phiên bản mới phải bằng 100% (hiện tại '+diff.totalWeightAfter+'%).');
  try{validateScoredDefinition(newDefinition);}catch(e){errors.push(e.message);}
  return {...diff,errors,ok:errors.length===0};
}

/* A2.3: mô phỏng tác động điểm cho 1 nhân sự cụ thể bằng checklistBreakdown thật. */
async function simulateEmployeeImpact({checklistBreakdown,employeeCode,periodMonth,oldDefinition,newDefinition,selfActualByCode,reviewActualByCode}){
  const breakdown=await checklistBreakdown(employeeCode,periodMonth);
  return {checklistScore:breakdown.score,...simulateScoreImpact({oldDefinition,newDefinition,checklistScore:breakdown.score,selfActualByCode,reviewActualByCode,calculateMonthlyScore})};
}

/*
 * Residual A (2026-08-14) — bề mặt admin-gated cho Bước 5 wizard (trước đây
 * UI-only/không có action server, xem 'residual' trong phfck-retro-panel Bước
 * 5). KHÔNG tự viết lại công thức mô phỏng — gọi lại simulateEmployeeImpact()
 * ở trên (đã dùng calculateMonthlyScore/checklistBreakdown thật). Hàm này chỉ
 * cộng thêm 2 việc: (1) resolve batch nhiều mã nhân sự cùng lúc, (2) enforce
 * scope — chỉ mô phỏng cho nhân sự THỰC SỰ đang gán đúng template_key được
 * yêu cầu (đọc từ checklist_employee_assignments, không suy diễn từ input).
 * Nhân sự không thuộc phạm vi (mã sai/không gán đúng mẫu) hoặc không có phiếu
 * tháng thật cho đúng kỳ -> xếp vào manual[] với lý do "Cần xử lý thủ công",
 * KHÔNG bao giờ tính ra một con số giả định (0 mặc định) rồi hiển thị như dữ
 * liệu thật.
 */
async function simulateEmployeeImpactBatch(session,input={}){
  ensureAdmin(session);requireDb();
  const templateKey=t(input.templateKey).toLowerCase();
  const periodMonth=t(input.periodMonth);
  const employeeCodes=Array.isArray(input.employeeCodes)?[...new Set(input.employeeCodes.map(c=>t(c).toUpperCase()).filter(Boolean))]:[];
  const oldDefinition=input.oldDefinition,newDefinition=input.newDefinition;
  if(!templateKey||!periodMonth)fail('Thiếu template_key hoặc kỳ áp dụng.','CHECKLIST_RETRO_IMPACT_INPUT_REQUIRED');
  if(!employeeCodes.length)fail('Thiếu danh sách nhân sự cần mô phỏng.','CHECKLIST_RETRO_IMPACT_INPUT_REQUIRED');
  if(!oldDefinition||!newDefinition)fail('Thiếu định nghĩa phiên bản cũ/mới để mô phỏng.','CHECKLIST_RETRO_IMPACT_INPUT_REQUIRED');
  if(employeeCodes.length>200)fail('Chỉ mô phỏng tối đa 200 nhân sự mỗi lượt.','CHECKLIST_RETRO_IMPACT_TOO_MANY');

  // Scope thật: chỉ nhân sự đang gán đúng template_key này mới được mô phỏng —
  // chặn "crafted scope" (mã nhân viên hợp lệ nhưng không thuộc mẫu đang xét,
  // hoặc mã không tồn tại) rò rỉ ra kết quả. Việc phân loại scoped/manual/
  // fabricate-free thực hiện bởi planEmployeeImpactBatch() (lib/checklist-
  // template-retroactive.js) — hàm THUẦN, unit-test được không cần DB; ở đây
  // chỉ fetch dữ liệu thật rồi truyền vào.
  const assignmentResult=await db.from('checklist_employee_assignments')
    .select('employee_code,employee_name,department,template_id,employee_status')
    .eq('template_id',templateKey)
    .in('employee_code',employeeCodes);
  if(assignmentResult.error)fail(assignmentResult.error.message,'CHECKLIST_RETRO_IMPACT_SCOPE_LOOKUP_FAILED',503);
  const scopedByCode=new Map((assignmentResult.data||[]).map(row=>[t(row.employee_code).toUpperCase(),row]));
  const scopedCodes=employeeCodes.filter(code=>scopedByCode.has(code));

  const formByCode=new Map();
  if(scopedCodes.length){
    const formResult=await db.from('checklist_monthly_forms').select('id,employee_code,status,self_answers,review_answers').eq('period_month',periodMonth).eq('template_id',templateKey).in('employee_code',scopedCodes);
    if(formResult.error)fail(formResult.error.message,'CHECKLIST_RETRO_IMPACT_FORM_LOOKUP_FAILED',503);
    (formResult.data||[]).forEach(row=>formByCode.set(t(row.employee_code).toUpperCase(),row));
  }

  const checklistScoreByCode=new Map();
  for(const code of scopedCodes){
    if(!formByCode.has(code))continue; // không có phiếu -> planEmployeeImpactBatch tự xếp manual, không cần tính điểm.
    try{const breakdown=await checklistBreakdown(code,periodMonth);checklistScoreByCode.set(code,breakdown.score);}
    catch(e){/* để trống -> planEmployeeImpactBatch dùng mặc định 100 khi rawScore không hữu hạn; ghi log để không nuốt lỗi âm thầm */console.warn('[PHF Checklist] checklistBreakdown thất bại cho '+code+'/'+periodMonth,e&&e.message||e);}
  }

  const {results,manual}=planEmployeeImpactBatch({employeeCodes,scopedByCode,formByCode,checklistScoreByCode,oldDefinition,newDefinition,calculateMonthlyScore});
  return {templateKey,periodMonth,requested:employeeCodes.length,results,manual};
}

/* Bước 5-6: chọn kỳ/phạm vi + dry-run (đọc dữ liệu thật, tính bằng cùng logic apply thật). */
async function dryRunRetroactiveApply(session,input={}){
  return retroactiveApply(session,{...input,dryRun:true});
}

/* Bước 7: xác nhận + thực thi thật (RPC ghi dữ liệu, admin-only, idempotent theo batchId). */
async function retroactiveApply(session,input={}){
  ensureAdmin(session);requireDb();
  const batchId=t(input.batchId);if(!batchId)fail('Thiếu batch_id (bắt buộc để idempotent).','CHECKLIST_RETRO_BATCH_ID_REQUIRED');
  const templateKey=t(input.templateKey).toLowerCase(),oldVersion=t(input.oldVersion),newVersion=t(input.newVersion);
  if(!templateKey||!oldVersion||!newVersion)fail('Thiếu template_key hoặc phiên bản cũ/mới.','CHECKLIST_RETRO_INPUT_REQUIRED');
  const actorId=t(session.account?.id||session.sub),actorCode=t(session.account?.employeeCode).toUpperCase(),actorName=t(session.account?.name||session.email);
  const dryRun=input.dryRun===true;
  const rpc=await db.rpc('phf_retroactive_apply_checklist_template',{
    p_batch_id:batchId,p_template_key:templateKey,p_old_version:oldVersion,p_new_version:newVersion,
    p_period_month_from:t(input.periodMonthFrom)||null,p_period_month_to:t(input.periodMonthTo)||null,
    p_reason:t(input.reason),p_dry_run:dryRun,p_actor_id:actorId,p_actor_code:actorCode,p_actor_name:actorName
  });
  if(rpc.error)fail(rpc.error.message,'CHECKLIST_RETRO_APPLY_FAILED',503);
  const result=rpc.data||{};if(result.ok!==true)fail(t(result.message)||'Không áp dụng lại được.',t(result.code)||'CHECKLIST_RETRO_APPLY_FAILED',409);
  return result;
}

/* Con đường riêng — điều chỉnh 1 phiếu đã thẩm định. KHÔNG bao giờ gọi ngầm trong batch trên. */
async function retroactiveApplyReviewedForm(session,input={}){
  ensureAdmin(session);requireDb();
  const formId=t(input.formId),newVersion=t(input.newVersion),reason=t(input.reason);
  if(!formId||!newVersion)fail('Thiếu form_id hoặc phiên bản mới.','CHECKLIST_RETRO_INPUT_REQUIRED');
  if(input.confirm!==true)fail('Điều chỉnh phiếu đã thẩm định cần xác nhận tường minh.','CHECKLIST_RETRO_REVIEWED_CONFIRM_REQUIRED');
  if(reason.length<10)fail('Cần ghi lý do tối thiểu 10 ký tự.','CHECKLIST_RETRO_REVIEWED_REASON_REQUIRED');
  const actorId=t(session.account?.id||session.sub),actorCode=t(session.account?.employeeCode).toUpperCase(),actorName=t(session.account?.name||session.email);
  /* p_batch_id ở RPC là kiểu uuid VÀ checklist_retroactive_batch_items.batch_id là NOT NULL
     (xem migration SQL) — chuỗi rỗng ('') không phải uuid hợp lệ (Postgres raise lỗi cast
     thô) và null cũng không được vì vi phạm NOT NULL khi insert batch_items. Con đường điều
     chỉnh phiếu đã thẩm định được thiết kế để đứng độc lập, không bắt buộc đi kèm 1 batch
     thường nào, nên khi UI không truyền batchId, tự sinh một uuid mới ở đây làm "batch ảo"
     riêng cho lần điều chỉnh 1-phiếu này (đúng ngữ nghĩa: mỗi lần retroactive-touch 1 phiếu
     vẫn có đúng 1 batch_id để audit/idempotent theo unique(batch_id,form_id)). */
  const batchId=t(input.batchId)||crypto.randomUUID();
  const rpc=await db.rpc('phf_retroactive_apply_reviewed_form',{
    p_batch_id:batchId,p_form_id:formId,p_new_version:newVersion,p_confirm:true,p_reason:reason,
    p_actor_id:actorId,p_actor_code:actorCode,p_actor_name:actorName
  });
  if(rpc.error)fail(rpc.error.message,'CHECKLIST_RETRO_REVIEWED_APPLY_FAILED',503);
  const result=rpc.data||{};if(result.ok!==true)fail(t(result.message)||'Không điều chỉnh được phiếu đã thẩm định.',t(result.code)||'CHECKLIST_RETRO_REVIEWED_APPLY_FAILED',409);
  return {...result,batchId};
}

module.exports={copyTemplateVersion,previewDiff,simulateEmployeeImpact,simulateEmployeeImpactBatch,dryRunRetroactiveApply,retroactiveApply,retroactiveApplyReviewedForm,runRetroactiveBatch};
