'use strict';

require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const manifest=require('../scripts/data/PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json');
const {reconcile}=require('../scripts/phf-knl-foundation-reconciliation');
const {resolveActorGrant,requireManageFrameworkForSession,incomeScopeAllows}=require('./knl-permissions');
const {loadKnlOrganizationRows}=require('./knl-people');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
const MIGRATION='scripts/PHF_KNL_COMPETENCY_GRADE_COMPENSATION_FOUNDATION_1.50.0.sql';
function text(v){return String(v==null?'':v).trim();}
function fail(message,statusCode=400,code='KNL_FOUNDATION_INVALID'){const e=new Error(message);e.statusCode=statusCode;e.code=code;throw e;}
function ensureDb(){if(!db)fail('Supabase chưa được cấu hình cho KNL Foundation.',503,'SUPABASE_NOT_CONFIGURED');}
function uuid(v,label='ID'){const value=text(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail(label+' không hợp lệ.',400,'KNL_ID_INVALID');return value;}
/* Kỳ khuyến nghị = tháng hiện tại (theo đồng hồ server) + 1 - mục 4/5 Batch 2
 * Income Assignment. Chỉ dùng để XÁC ĐỊNH hồi tố (period < kỳ này), KHÔNG
 * hard-lock kỳ Admin được chọn (mục 17: "N+1 chỉ là default"). */
function recommendedPayrollPeriod(){const d=new Date();let y=d.getUTCFullYear(),m=d.getUTCMonth()+2;if(m>12){m-=12;y+=1;}return y+'-'+(m<10?'0'+m:''+m);}
function actor(session){return{id:text(session?.account?.id||session?.sub)||null,name:text(session?.account?.name||session?.account?.email||session?.email)||null,employeeCode:text(session?.employeeCode||session?.employee_code||session?.account?.employeeCode||session?.account?.employee_code).toUpperCase(),role:text(session?.role).toLowerCase()};}
function throwDb(error){if(!error)return;const code=text(error.code),message=text(error.message);if(code==='PGRST205'||code==='42P01'||/schema cache|does not exist|not find the table/i.test(message))fail('Schema KNL Foundation chưa được cài đặt. Hãy chạy '+MIGRATION+'.',503,'KNL_FOUNDATION_SCHEMA_MISSING');throw error;}
function requireAdmin(session){if(actor(session).role!=='admin')fail('Chỉ Admin được quản trị cơ cấu thu nhập tham chiếu.',403,'KNL_COMPENSATION_ADMIN_REQUIRED');}
function publicAssignment(row){const s=row.structure_snapshot||{};return{id:row.id,employeeCode:row.employee_code,employeeName:row.employee_name,payrollPeriod:row.payroll_period,employmentType:row.employment_type,gradeId:row.compensation_grade_id||'',gradeCode:s.gradeCode||'',gradeNumber:Number(s.gradeNumber||0),ladderCode:s.ladderCode||'',ladderName:s.ladderName||'',versionId:s.versionId||'',versionNumber:Number(s.versionNumber||0),effectivePeriod:s.effectivePeriod||'',isProfessionalAllowance:row.has_professional_allowance===true,isManagementAllowance:row.has_management_allowance===true,isMealAllowance:row.has_meal_allowance===true,probationAmount:Number(row.probation_amount||0),baseSalary:Number(s.baseSalary||0),hqcv:Number(s.hqcv||0),standardProfessionalAllowance:Number(s.professionalAllowance||0),standardManagementAllowance:Number(s.managementAllowance||0),professionalAllowance:row.has_professional_allowance?Number(s.professionalAllowance||0):0,managementAllowance:row.has_management_allowance?Number(s.managementAllowance||0):0,mealAllowance:Number(row.meal_allowance||0),extraAllowances:row.extra_allowances||[],totalReferenceIncome:Number(row.reference_total||0),organizationSnapshot:row.organization_snapshot||{},updatedAt:row.updated_at};}
function publicCompensationVersion(row){return{id:row.id,ladderId:row.ladder_id,versionNumber:row.version_number,name:row.name,status:row.status,sourcePeriod:row.source_period,effectivePeriod:row.effective_period||'',effectiveFrom:row.effective_from||'',effectiveTo:row.effective_to||'',basedOnVersionId:row.based_on_version_id||'',note:row.note||'',updatedAt:row.updated_at};}

async function getKnlGradeMatrix(session,input={}){
  ensureDb();await requireManageFrameworkForSession(session);const versionId=uuid(input.versionId,'Version ID');
  const [grades,requirements]=await Promise.all([db.from('knl_grade_definitions').select('*').eq('version_id',versionId).order('sort_order'),db.from('knl_grade_requirements').select('*').eq('version_id',versionId)]);
  throwDb(grades.error);throwDb(requirements.error);
  return{grades:(grades.data||[]).map(r=>({id:r.id,versionId:r.version_id,gradeCode:r.grade_code,gradeNumber:r.grade_number,label:r.label,sortOrder:r.sort_order})),requirements:(requirements.data||[]).map(r=>({itemId:r.item_id,gradeId:r.grade_id,requiredColumnId:r.required_column_id,requiredLevelNumber:r.required_level_number}))};
}
async function saveKnlGradeMatrix(session,input={}){ensureDb();await requireManageFrameworkForSession(session);const a=actor(session);const {data,error}=await db.rpc('knl_save_grade_matrix',{p_version_id:uuid(input.versionId,'Version ID'),p_grades:Array.isArray(input.grades)?input.grades:[],p_requirements:Array.isArray(input.requirements)?input.requirements:[],p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{saved:data};}
async function setKnlVersionEffectivity(session,input={}){ensureDb();await requireManageFrameworkForSession(session);const value=text(input.effectiveFrom);if(!value||Number.isNaN(Date.parse(value)))fail('Ngày hiệu lực không hợp lệ.',400,'KNL_EFFECTIVE_FROM_REQUIRED');const a=actor(session),{data,error}=await db.rpc('knl_set_version_effectivity',{p_version_id:uuid(input.versionId,'Version ID'),p_effective_from:new Date(value).toISOString(),p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{effectivity:data};}
async function listKnlCompensationStandards(session){ensureDb();requireAdmin(session);const [ladders,versions,grades,assignments]=await Promise.all([db.from('knl_compensation_ladders').select('*').order('code'),db.from('knl_compensation_versions').select('*').order('effective_period',{ascending:false}),db.from('knl_compensation_grades').select('*').order('grade_number'),db.from('knl_employee_compensation_assignments').select('employee_code,compensation_grade_id,payroll_period').eq('status','ACTIVE')]);[ladders,versions,grades,assignments].forEach(r=>throwDb(r.error));const latestByEmployee=new Map();(assignments.data||[]).forEach(r=>{const old=latestByEmployee.get(r.employee_code);if(!old||text(r.payroll_period)>text(old.payroll_period))latestByEmployee.set(r.employee_code,r);});const counts=new Map();latestByEmployee.forEach(r=>{if(r.compensation_grade_id)counts.set(r.compensation_grade_id,(counts.get(r.compensation_grade_id)||0)+1);});return{ladders:(ladders.data||[]).map(l=>({...l,versions:(versions.data||[]).filter(v=>v.ladder_id===l.id).map(v=>({...v,grades:(grades.data||[]).filter(g=>g.version_id===v.id).map(g=>({...g,employeeCount:counts.get(g.id)||0}))}))}))};}
async function previewKnlCompensationFoundation(session){requireAdmin(session);const result=reconcile(manifest,await loadKnlOrganizationRows());return{...result,standardCounts:{ladders:manifest.ladders.length,grades:manifest.ladders.reduce((n,l)=>n+l.grades.length,0)},sourceFile:manifest.sourceFile,sourceSha256:manifest.sourceSha256,overrides:manifest.overrides};}
async function applyKnlCompensationFoundation(session,input={}){ensureDb();requireAdmin(session);const period=text(input.effectivePeriod);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))fail('Phải xác nhận kỳ lương áp dụng theo YYYY-MM.',400,'KNL_EFFECTIVE_PERIOD_REQUIRED');if(input.confirmSourcePeriod!==true)fail('Phải xác nhận đã đối chiếu kỳ nguồn '+manifest.sourcePeriod+'.',400,'KNL_SOURCE_PERIOD_CONFIRM_REQUIRED');const preview=await previewKnlCompensationFoundation(session);if(preview.counts.NEEDS_REVIEW)fail('Còn bản ghi NEEDS_REVIEW; không được seed.',409,'KNL_RECONCILIATION_NOT_CLEAN');const a=actor(session),{data,error}=await db.rpc('knl_seed_compensation_foundation',{p_manifest:{...manifest,effectivePeriod:period},p_reconciled_rows:preview.groups.WILL_ASSIGN,p_effective_period:period,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{seed:data,counts:preview.counts};}
/* incomeScopeAllows giờ SỐNG ở lib/knl-permissions.js (đã import ở đầu file
 * này) — chỉ re-export lại đây để KHÔNG đổi public API cho consumer cũ
 * (scripts/test-knl-income-batch1-2026-08.js gọi
 * require('../lib/knl-foundation').incomeScopeAllows). Xem comment gốc ở
 * lib/knl-permissions.js để biết lý do di dời (tránh circular require với
 * lib/knl-people.js — mục "canViewIncome per-row" 2026-08-12). */
function incomeTargetRows(rows,resolved,ownCode){const own=text(ownCode).toUpperCase();return(rows||[]).filter(row=>{const code=text(row.employee_code).toUpperCase(),status=text(row.employee_status).toLowerCase();if(!code||status==='inactive'||status==='terminated'||status.includes('nghỉ việc'))return false;return code===own||incomeScopeAllows(resolved,{employeeCode:code,department:row.department,branch:row.branch,title:row.title});}).map(row=>({employeeCode:text(row.employee_code).toUpperCase(),employeeName:text(row.employee_name),department:text(row.department),branch:text(row.branch),title:text(row.title),position:text(row.position)}));}
async function listKnlIncomeTargets(session){ensureDb();const a=actor(session),resolved=await resolveActorGrant(session),rows=await loadKnlOrganizationRows();return{people:incomeTargetRows(rows,resolved,a.employeeCode),ownEmployeeCode:a.employeeCode,canSelectOthers:resolved.source==='admin_recovery'||resolved.capabilities.income_view===true};}
async function getKnlEmployeeIncome(session,input={}){ensureDb();const a=actor(session),employeeCode=text(input.employeeCode||a.employeeCode).toUpperCase();if(!employeeCode)fail('Không xác định được mã nhân viên.',409,'KNL_EMPLOYEE_CODE_REQUIRED');if(employeeCode!==a.employeeCode){const resolved=await resolveActorGrant(session);const orgRows=await loadKnlOrganizationRows();const person=orgRows.find(r=>text(r.employee_code).toUpperCase()===employeeCode);const scopeSubject=person?{employeeCode,department:person.department,branch:person.branch,title:person.title}:employeeCode;if(!incomeScopeAllows(resolved,scopeSubject))fail('Không có quyền xem thu nhập của nhân sự này.',403,'KNL_INCOME_VIEW_DENIED');}const [current,history]=await Promise.all([db.from('knl_employee_compensation_assignments').select('*').eq('employee_code',employeeCode).eq('status','ACTIVE').order('payroll_period',{ascending:false}).limit(1).maybeSingle(),db.from('knl_employee_compensation_history').select('*').eq('employee_code',employeeCode).order('changed_at',{ascending:false}).limit(100)]);throwDb(current.error);throwDb(history.error);return{employeeCode,current:current.data?publicAssignment(current.data):null,history:(history.data||[]).map(r=>({id:r.id,payrollPeriod:r.payroll_period,action:r.action,beforeData:r.before_data||{},afterData:r.after_data||{},reason:r.reason||'',changedAt:r.changed_at,changedByName:r.changed_by_name||''}))};}
/* Mục 11 Batch 2 Income Assignment: đọc TOÀN BỘ các kỳ đã có của 1 nhân sự
 * trực tiếp từ knl_employee_compensation_assignments (mỗi row = cơ cấu ĐẦY ĐỦ
 * của đúng 1 kỳ, không phải diff before/after như
 * knl_employee_compensation_history) - phục vụ "lịch sử nghiệp vụ theo kỳ"
 * (khác audit kỹ thuật ở listKnlEmployeeCompensationHistory, vẫn giữ riêng).
 * Cùng cơ chế quyền với getKnlEmployeeIncome: tự xem của mình luôn được, xem
 * người khác phải qua incomeScopeAllows. Không hard-delete/sửa dữ liệu. */
async function listKnlEmployeeCompensationPeriods(session,input={}){ensureDb();const a=actor(session),employeeCode=text(input.employeeCode||a.employeeCode).toUpperCase();if(!employeeCode)fail('Không xác định được mã nhân viên.',409,'KNL_EMPLOYEE_CODE_REQUIRED');if(employeeCode!==a.employeeCode){const resolved=await resolveActorGrant(session);const orgRows=await loadKnlOrganizationRows();const person=orgRows.find(r=>text(r.employee_code).toUpperCase()===employeeCode);const scopeSubject=person?{employeeCode,department:person.department,branch:person.branch,title:person.title}:employeeCode;if(!incomeScopeAllows(resolved,scopeSubject))fail('Không có quyền xem thu nhập của nhân sự này.',403,'KNL_INCOME_VIEW_DENIED');}const{data,error}=await db.from('knl_employee_compensation_assignments').select('*').eq('employee_code',employeeCode).eq('status','ACTIVE').order('payroll_period',{ascending:false}).limit(120);throwDb(error);return{employeeCode,periods:(data||[]).map(publicAssignment)};}
async function saveKnlEmployeeIncome(session,input={}){ensureDb();requireAdmin(session);const code=text(input.employeeCode).toUpperCase(),period=text(input.payrollPeriod);if(!code)fail('Mã nhân viên là bắt buộc.');if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))fail('Kỳ lương phải theo YYYY-MM.');if(period<recommendedPayrollPeriod()&&text(input.reason).length<5)fail('Kỳ '+period+' trước kỳ khuyến nghị '+recommendedPayrollPeriod()+' — đây là điều chỉnh hồi tố, bắt buộc nhập lý do hồi tố (tối thiểu 5 ký tự).',400,'KNL_RETROACTIVE_REASON_REQUIRED');const rows=await loadKnlOrganizationRows(),person=rows.find(r=>text(r.employee_code).toUpperCase()===code);if(!person)fail('Nhân sự không có trong organization hiện hành.',404,'KNL_EMPLOYEE_NOT_FOUND');const a=actor(session),{data,error}=await db.rpc('knl_save_employee_compensation',{p_employee_code:code,p_employee_name:text(person.employee_name),p_payroll_period:period,p_employment_type:text(input.employmentType||'OFFICIAL').toUpperCase(),p_grade_id:input.gradeId?uuid(input.gradeId,'Grade ID'):null,p_has_professional:input.isProfessionalAllowance===true,p_has_management:input.isManagementAllowance===true,p_has_meal:input.isMealAllowance===true,p_meal_amount:input.mealOverride==null?0:Number(input.mealOverride),p_probation_amount:input.probationAmount==null?0:Number(input.probationAmount),p_extra_allowances:Array.isArray(input.extraAllowances)?input.extraAllowances:[],p_organization_snapshot:{employeeCode:code,employeeName:text(person.employee_name),department:text(person.department),branch:text(person.branch),position:text(person.position),title:text(person.title)},p_reason:text(input.reason),p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{assignment:data};}

/* Batch 1D — Sửa kỳ hiệu lực (effective period) của 1 assignment đã nhập sai
 * kỳ (vd Huỳnh: 08/2026 lẽ ra 09/2026). Admin-only (cùng gate requireAdmin
 * như saveKnlEmployeeIncome — KHÔNG mở thêm capability). Toàn bộ logic
 * nghiệp vụ (lock source ACTIVE, chặn conflict kỳ đích, copy nội dung, void
 * source, ghi history CORRECT_EFFECTIVE_PERIOD) nằm trong RPC transactional
 * knl_correct_employee_compensation_period() — service chỉ validate boundary
 * + dịch lỗi RPC sang message rõ nghĩa cho UI (không lộ raw SQL error), cùng
 * pattern throwDb() đã dùng cho các RPC khác trong file này. */
function throwCorrectionDb(error){
  if(!error)return;
  const message=text(error.message);
  if(/KNL_CORRECTION_SOURCE_NOT_FOUND/.test(message))fail('Không tìm thấy cơ cấu thu nhập đang áp dụng ở kỳ hiện tại (có thể đã được điều chỉnh trước đó).',409,'KNL_CORRECTION_SOURCE_NOT_FOUND');
  if(/KNL_CORRECTION_TARGET_CONFLICT/.test(message))fail('Kỳ mới đã có cơ cấu thu nhập đang áp dụng. Không thể tự động ghi đè.',409,'KNL_CORRECTION_TARGET_CONFLICT');
  if(/KNL_CORRECTION_TARGET_SAME_AS_SOURCE/.test(message))fail('Kỳ mới phải khác kỳ hiện tại.',400,'KNL_CORRECTION_TARGET_SAME_AS_SOURCE');
  if(/KNL_CORRECTION_REASON_REQUIRED/.test(message))fail('Phải nhập lý do điều chỉnh (tối thiểu 5 ký tự).',400,'KNL_CORRECTION_REASON_REQUIRED');
  if(/KNL_PAYROLL_PERIOD_INVALID/.test(message))fail('Kỳ lương phải theo định dạng YYYY-MM.',400,'KNL_PAYROLL_PERIOD_INVALID');
  throwDb(error);
}
async function correctKnlEmployeeCompensationPeriod(session,input={}){
  ensureDb();requireAdmin(session);
  const code=text(input.employeeCode).toUpperCase();
  const sourcePeriod=text(input.sourcePeriod);
  const targetPeriod=text(input.targetPeriod);
  const reason=text(input.reason);
  if(!code)fail('Mã nhân viên là bắt buộc.',400,'KNL_EMPLOYEE_CODE_REQUIRED');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sourcePeriod)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(targetPeriod))fail('Kỳ lương phải theo định dạng YYYY-MM.',400,'KNL_PAYROLL_PERIOD_INVALID');
  if(sourcePeriod===targetPeriod)fail('Kỳ mới phải khác kỳ hiện tại.',400,'KNL_CORRECTION_TARGET_SAME_AS_SOURCE');
  if(reason.length<5)fail('Phải nhập lý do điều chỉnh (tối thiểu 5 ký tự).',400,'KNL_CORRECTION_REASON_REQUIRED');
  const a=actor(session);
  const {data,error}=await db.rpc('knl_correct_employee_compensation_period',{
    p_employee_code:code,p_source_period:sourcePeriod,p_target_period:targetPeriod,
    p_reason:reason,p_actor_id:a.id,p_actor_name:a.name
  });
  throwCorrectionDb(error);
  return{correction:{sourceAssignmentId:data.sourceAssignmentId,targetAssignmentId:data.targetAssignmentId,oldPeriod:data.oldPeriod,newPeriod:data.newPeriod,status:data.status}};
}

async function listKnlCompensationAssignmentTargets(session){ensureDb();requireAdmin(session);const rows=await loadKnlOrganizationRows();return{people:rows.filter(r=>{const status=text(r.employee_status).toLowerCase();return text(r.employee_code)&&status!=='inactive'&&status!=='terminated'&&!status.includes('nghỉ việc');}).map(r=>({employeeCode:text(r.employee_code).toUpperCase(),employeeName:text(r.employee_name),department:text(r.department),branch:text(r.branch),title:text(r.title),position:text(r.position)}))};}

async function cloneKnlCompensationVersion(session,input={}){ensureDb();requireAdmin(session);const a=actor(session),{data,error}=await db.rpc('knl_clone_compensation_version',{p_source_version_id:uuid(input.versionId,'Version ID'),p_name:text(input.name)||null,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{version:publicCompensationVersion(data)};}

async function saveKnlCompensationGrades(session,input={}){ensureDb();requireAdmin(session);if(!Array.isArray(input.grades)||!input.grades.length)fail('Danh sách bậc là bắt buộc.',400,'KNL_COMPENSATION_GRADES_REQUIRED');const grades=input.grades.map(g=>({id:uuid(g.id,'Grade ID'),baseSalary:Number(g.baseSalary||0),hqcv:Number(g.hqcv||0),professionalAllowance:Number(g.professionalAllowance||0),managementAllowance:Number(g.managementAllowance||0)}));const a=actor(session),{data,error}=await db.rpc('knl_save_compensation_grades',{p_version_id:uuid(input.versionId,'Version ID'),p_grades:grades,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{saved:data};}

async function scheduleKnlCompensationVersion(session,input={}){ensureDb();requireAdmin(session);const period=text(input.effectivePeriod);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))fail('Kỳ hiệu lực phải theo YYYY-MM.',400,'KNL_EFFECTIVE_PERIOD_REQUIRED');const effectiveFrom=text(input.effectiveFrom)||(period+'-01');if(Number.isNaN(Date.parse(effectiveFrom)))fail('Ngày hiệu lực không hợp lệ.',400,'KNL_EFFECTIVE_FROM_REQUIRED');const a=actor(session),{data,error}=await db.rpc('knl_schedule_compensation_version',{p_version_id:uuid(input.versionId,'Version ID'),p_effective_period:period,p_effective_from:effectiveFrom,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return{scheduled:data};}

async function getKnlCompensationVersionAudit(session){ensureDb();requireAdmin(session);const [audit,versions,ladders]=await Promise.all([db.from('knl_compensation_audit').select('*').in('entity_type',['compensation_version','compensation_grades']).order('created_at',{ascending:false}).limit(200),db.from('knl_compensation_versions').select('id,ladder_id,version_number'),db.from('knl_compensation_ladders').select('id,code,name')]);[audit,versions,ladders].forEach(r=>throwDb(r.error));const versionById=new Map((versions.data||[]).map(v=>[v.id,v]));const ladderById=new Map((ladders.data||[]).map(l=>[l.id,l]));return{entries:(audit.data||[]).map(row=>{const v=versionById.get(row.entity_id),l=v?ladderById.get(v.ladder_id):null;return{id:row.id,entityType:row.entity_type,action:row.action,ladderCode:l?l.code:'',ladderName:l?l.name:'',versionNumber:v?v.version_number:null,beforeData:row.before_data||{},afterData:row.after_data||{},actorName:row.actor_name||'',createdAt:row.created_at};})};}

async function listKnlEmployeeCompensationHistory(session,input={}){ensureDb();requireAdmin(session);const code=text(input.employeeCode).toUpperCase();let query=db.from('knl_employee_compensation_history').select('*').order('changed_at',{ascending:false}).limit(300);if(code)query=query.eq('employee_code',code);const {data,error}=await query;throwDb(error);return{history:(data||[]).map(r=>({id:r.id,employeeCode:r.employee_code,payrollPeriod:r.payroll_period,action:r.action,beforeData:r.before_data||{},afterData:r.after_data||{},reason:r.reason||'',changedAt:r.changed_at,changedByName:r.changed_by_name||''}))};}

/* "Thu nhập tham chiếu bậc lương kế tiếp" — HOÀN TOÀN trong hệ Compensation,
 * KHÔNG đọc/suy từ KNL competency grade (bậc năng lực và bậc lương là 2 hệ
 * độc lập, đã chốt). Next grade = compensation_grade kế tiếp trong CÙNG
 * version_id của chính assignment hiện tại (order by grade_number, unique
 * per version_id — deterministic, xem knl_compensation_grades schema), không
 * mapping từ đâu khác. Cùng cơ chế quyền self/incomeScope như
 * getKnlEmployeeIncome (không dùng requirePropose của Grade Promotion
 * Proposal — đó là domain/permission khác).
 * Whitelist: has_professional_allowance/has_management_allowance là field
 * LƯU TRÊN CHÍNH assignment hiện tại của nhân sự (per-employee thật đang
 * hưởng, không phải cấu hình mặc định của grade) — carry-forward đúng 2 cờ
 * này sang preview bậc kế tiếp, KHÔNG tự suy nhân sự sẽ tiếp tục/ngừng hưởng
 * khi thật sự đổi bậc (đó là quyết định Admin tại thời điểm gán thật, ngoài
 * phạm vi preview này). Không đọc mealAllowance/extraAllowances vì đó không
 * phải cấu hình theo bậc trong knl_compensation_grades. */
async function getKnlEmployeeNextCompensationGrade(session,input={}){
  ensureDb();
  const a=actor(session),employeeCode=text(input.employeeCode||a.employeeCode).toUpperCase();
  if(!employeeCode)fail('Không xác định được mã nhân viên.',409,'KNL_EMPLOYEE_CODE_REQUIRED');
  if(employeeCode!==a.employeeCode){
    const resolved=await resolveActorGrant(session);
    const orgRows=await loadKnlOrganizationRows();
    const person=orgRows.find(r=>text(r.employee_code).toUpperCase()===employeeCode);
    const scopeSubject=person?{employeeCode,department:person.department,branch:person.branch,title:person.title}:employeeCode;
    if(!incomeScopeAllows(resolved,scopeSubject))fail('Không có quyền xem thu nhập của nhân sự này.',403,'KNL_INCOME_VIEW_DENIED');
  }
  const {data:row,error}=await db.from('knl_employee_compensation_assignments').select('*').eq('employee_code',employeeCode).eq('status','ACTIVE').order('payroll_period',{ascending:false}).limit(1).maybeSingle();
  throwDb(error);
  if(!row||!row.compensation_grade_id)return{employeeCode,hasCurrentGrade:false,currentGrade:null,isMaxGrade:false,nextGrade:null,preview:null};
  const current=publicAssignment(row);
  if(!current.versionId||!current.gradeNumber)return{employeeCode,hasCurrentGrade:false,currentGrade:null,isMaxGrade:false,nextGrade:null,preview:null};
  const {data:nextRow,error:nextError}=await db.from('knl_compensation_grades')
    .select('id,grade_code,grade_number,base_salary,hqcv,professional_allowance,management_allowance')
    .eq('version_id',current.versionId).gt('grade_number',current.gradeNumber)
    .order('grade_number',{ascending:true}).limit(1).maybeSingle();
  throwDb(nextError);
  const currentGrade={code:current.gradeCode,number:current.gradeNumber,ladderCode:current.ladderCode,ladderName:current.ladderName,versionNumber:current.versionNumber};
  if(!nextRow)return{employeeCode,hasCurrentGrade:true,currentGrade,isMaxGrade:true,nextGrade:null,preview:null};
  const preview={
    baseSalary:Number(nextRow.base_salary||0),hqcv:Number(nextRow.hqcv||0),
    isProfessionalAllowance:current.isProfessionalAllowance,
    professionalAllowance:current.isProfessionalAllowance?Number(nextRow.professional_allowance||0):0,
    isManagementAllowance:current.isManagementAllowance,
    managementAllowance:current.isManagementAllowance?Number(nextRow.management_allowance||0):0
  };
  return{employeeCode,hasCurrentGrade:true,currentGrade,isMaxGrade:false,nextGrade:{code:nextRow.grade_code,number:nextRow.grade_number},preview};
}

module.exports={getKnlGradeMatrix,saveKnlGradeMatrix,setKnlVersionEffectivity,listKnlCompensationStandards,previewKnlCompensationFoundation,applyKnlCompensationFoundation,listKnlIncomeTargets,getKnlEmployeeIncome,saveKnlEmployeeIncome,incomeScopeAllows,incomeTargetRows,listKnlCompensationAssignmentTargets,cloneKnlCompensationVersion,saveKnlCompensationGrades,scheduleKnlCompensationVersion,getKnlCompensationVersionAudit,listKnlEmployeeCompensationHistory,listKnlEmployeeCompensationPeriods,getKnlEmployeeNextCompensationGrade,correctKnlEmployeeCompensationPeriod};
