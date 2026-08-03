'use strict';
// PHF Checklist 1.38.52 · Marketing KPI template-key mapping fix
require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const {getChecklistExportAccess,getChecklistMonthlyReviewAccess}=require('./checklist-permissions');
const ready=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const db=ready?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
function t(v){return String(v==null?'':v).trim();}
const MARKETING_MONTHLY_TEMPLATE_IDS=new Set(['tbp-mkt-1.0','nv-media-1.0']);
const MARKETING_MONTHLY_TEMPLATE_KEY_MAP=Object.freeze({'tbp-mkt-1.0':'tbp-marketing','nv-media-1.0':'nv-marketing'});
const MARKETING_MONTHLY_TEMPLATE_ID_BY_KEY=Object.freeze(Object.fromEntries(Object.entries(MARKETING_MONTHLY_TEMPLATE_KEY_MAP).map(([id,key])=>[key,id])));
function marketingMonthlyTemplateId(value){const normalized=t(value).toLowerCase();return MARKETING_MONTHLY_TEMPLATE_IDS.has(normalized)?normalized:(MARKETING_MONTHLY_TEMPLATE_ID_BY_KEY[normalized]||'');}
function marketingMonthlyTemplateKey(value){const id=marketingMonthlyTemplateId(value);return id?MARKETING_MONTHLY_TEMPLATE_KEY_MAP[id]:'';}
function isMarketingMonthlyTemplate(value){return Boolean(marketingMonthlyTemplateId(value));}
function normalizeDepartment(value){return t(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
function marketingDepartment(value){return normalizeDepartment(value)==='marketing';}
function marketingKpiWindow(periodMonth){return {openAt:periodDateTime(periodMonth,1,'00:00'),closeAt:periodDateTime(periodMonth,3,'23:59')};}
function marketingKpiWindowState(periodMonth){const window=marketingKpiWindow(periodMonth),now=Date.now(),open=Date.parse(window.openAt),close=Date.parse(window.closeAt);return {...window,isOpen:now>=open&&now<=close,isBefore:now<open,isClosed:now>close};}
function templateDefinition(snapshot){const value=snapshot&&snapshot.version&&snapshot.version.definition;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function cloneJson(value){return JSON.parse(JSON.stringify(value==null?null:value));}
function marketingConfigDbError(error){
 const message=String(error&&error.message||''),code=String(error&&error.code||'');
 if(code==='42P01'||code==='PGRST204'||code==='PGRST205'||/schema cache|checklist_monthly_kpi_configs|phf_save_marketing_monthly_kpi/i.test(message))fail('Chưa chạy SQL cập nhật KPI tháng Marketing 1.38.50.',503,'CHECKLIST_MARKETING_KPI_SQL_MISSING');
 throw error;
}
async function marketingKpiPermission(session,department){
 if(t(session?.role).toLowerCase()==='admin')return {role:'admin',presetCode:'ADMIN_SYSTEM',department:t(department)||'Marketing',canEdit:true,canException:true};
 const access=await getChecklistMonthlyReviewAccess(session),preset=t(access?.grant?.presetCode).toUpperCase(),dept=t(department)||'Marketing';
 if(preset==='TRO_LY_GD')return {role:'assistant',presetCode:preset,department:dept,canEdit:true,canException:true};
 if(preset!=='TRUONG_BO_PHAN')fail('Chỉ Trưởng bộ phận Marketing hoặc Trợ lý Giám đốc được cập nhật KPI tháng.',403,'CHECKLIST_MARKETING_KPI_FORBIDDEN');
 const scopes=[access?.grant?.viewScope,access?.grant?.reviewScope].filter(Boolean),allowed=scopes.some(scope=>Array.isArray(scope.values)&&scope.values.some(value=>marketingDepartment(value)));
 if(!allowed||!marketingDepartment(dept))fail('Tài khoản không thuộc phạm vi Marketing được cấp.',403,'CHECKLIST_MARKETING_KPI_SCOPE_FORBIDDEN');
 return {role:'department_head',presetCode:preset,department:'Marketing',canEdit:true,canException:false};
}
function normalizeMarketingKpiRows(rows){
 if(!Array.isArray(rows)||!rows.length)fail('Danh sách tiêu chí tháng không hợp lệ.',409,'CHECKLIST_MARKETING_KPI_ROWS_REQUIRED');
 return rows.slice(0,100).map((row,index)=>{
  const source=row&&typeof row==='object'&&!Array.isArray(row)?row:{},code=t(source.code),name=t(source.name),target=Number(source.target),weight=Number(source.weight);
  if(!code)fail('Tiêu chí dòng '+(index+1)+' thiếu mã nhận diện.',409,'CHECKLIST_MARKETING_KPI_CODE_REQUIRED');
  if(!name)fail('Tiêu chí '+code+' chưa có nội dung.',409,'CHECKLIST_MARKETING_KPI_NAME_REQUIRED');
  if(!Number.isFinite(target)||target<=0)fail('Mục tiêu '+code+' phải là số lớn hơn 0.',409,'CHECKLIST_MARKETING_KPI_TARGET_INVALID');
  if(!Number.isFinite(weight)||weight<=0||weight>100)fail('Tỷ trọng '+code+' phải lớn hơn 0 và không vượt quá 100.',409,'CHECKLIST_MARKETING_KPI_WEIGHT_INVALID');
  return {code,name,target,weight:Math.round(weight*100)/100};
 });
}
function applyMarketingRowsToDefinition(definition,rows){
 const next=cloneJson(definition||{}),existing=Array.isArray(next.totalRows)?next.totalRows:[],byCode=new Map(rows.map(row=>[t(row.code).toLowerCase(),row]));
 if(existing.length!==rows.length)fail('Không được thêm hoặc xóa dòng tiêu chí trong cấu hình tháng.',409,'CHECKLIST_MARKETING_KPI_ROW_COUNT_CHANGED');
 const seen=new Set();
 next.totalRows=existing.map((row,index)=>{
  const item=Array.isArray(row)?row.slice():{...row},code=t(Array.isArray(item)?item[1]:item.code).toLowerCase(),override=byCode.get(code);
  if(!override)fail('Danh sách tiêu chí không khớp mẫu nền tại dòng '+(index+1)+'.',409,'CHECKLIST_MARKETING_KPI_ROW_MISMATCH');
  seen.add(code);
  if(Array.isArray(item)){item[2]=override.name;item[3]=override.target;item[5]=override.weight;}
  else{item.content=override.name;item.name=override.name;item.target=override.target;item.weight=override.weight;}
  return item;
 });
 if(seen.size!==rows.length)fail('Danh sách tiêu chí có mã trùng hoặc không thuộc mẫu nền.',409,'CHECKLIST_MARKETING_KPI_ROW_MISMATCH');
 return next;
}
const MONTHLY_OVERDUE_SETTING_KEY='monthly_self_overdue_policy';
const MONTHLY_SCORE_POLICY_DEFAULT=Object.freeze({effectiveFromPeriod:'2026-08',selfWeight:1,reviewWeight:2,reason:'',updatedAt:'',updatedBy:'',source:'default',formulaVersion:'weighted_average_v1'});
function defaultMonthlyOverduePolicy(){return {mode:'max',effectiveFromPeriod:'2026-08',selfDueDay:2,employeeResponseDays:3,reviewerResponseDays:3,monthlyCutoffDay:4,monthlyCutoffTime:'23:59',adminAfterLock:'controlled',updatedAt:'',updatedBy:'',reason:''};}
function boundedInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;}
function validTime(value,fallback='23:59'){const text=t(value);return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)?text:fallback;}
function parseMonthlyOverduePolicy(value){try{const x=JSON.parse(t(value)||'{}'),base=defaultMonthlyOverduePolicy();return {...base,...x,mode:x.mode==='zero'?'zero':'max',effectiveFromPeriod:/^\d{4}-(0[1-9]|1[0-2])$/.test(t(x.effectiveFromPeriod))?t(x.effectiveFromPeriod):base.effectiveFromPeriod,selfDueDay:boundedInt(x.selfDueDay,base.selfDueDay,1,28),employeeResponseDays:boundedInt(x.employeeResponseDays,base.employeeResponseDays,1,30),reviewerResponseDays:boundedInt(x.reviewerResponseDays,base.reviewerResponseDays,1,30),monthlyCutoffDay:boundedInt(x.monthlyCutoffDay,base.monthlyCutoffDay,1,28),monthlyCutoffTime:validTime(x.monthlyCutoffTime,base.monthlyCutoffTime),adminAfterLock:x.adminAfterLock==='disabled'?'disabled':'controlled'};}catch(_){return defaultMonthlyOverduePolicy();}}
async function getMonthlyOverduePolicy(session){admin(session);const got=await db.from('checklist_system_settings').select('*').eq('setting_key',MONTHLY_OVERDUE_SETTING_KEY).maybeSingle();if(got.error)throw got.error;const policy=parseMonthlyOverduePolicy(got.data&&got.data.setting_value);return {policy:{...policy,updatedAt:got.data&&got.data.updated_at||policy.updatedAt,updatedBy:got.data&&got.data.updated_by||policy.updatedBy},ready:true};}
async function saveMonthlyOverduePolicy(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const reason=t(input.reason);if(reason.length<10)fail('Lý do thay đổi cần tối thiểu 10 ký tự.',409,'CHECKLIST_MONTHLY_POLICY_REASON_REQUIRED');
 const old=await getMonthlyOverduePolicy(session),current=old.policy,effectiveFromPeriod=month(input.effectiveFromPeriod||current.effectiveFromPeriod||'2026-08'),a=actor(session);
 const policy={...current,mode:Object.prototype.hasOwnProperty.call(input,'mode')?(input.mode==='zero'?'zero':'max'):current.mode,effectiveFromPeriod,selfDueDay:Object.prototype.hasOwnProperty.call(input,'selfDueDay')?boundedInt(input.selfDueDay,current.selfDueDay,1,28):current.selfDueDay,employeeResponseDays:Object.prototype.hasOwnProperty.call(input,'employeeResponseDays')?boundedInt(input.employeeResponseDays,current.employeeResponseDays,1,30):current.employeeResponseDays,reviewerResponseDays:Object.prototype.hasOwnProperty.call(input,'reviewerResponseDays')?boundedInt(input.reviewerResponseDays,current.reviewerResponseDays,1,30):current.reviewerResponseDays,monthlyCutoffDay:Object.prototype.hasOwnProperty.call(input,'monthlyCutoffDay')?boundedInt(input.monthlyCutoffDay,current.monthlyCutoffDay,1,28):current.monthlyCutoffDay,monthlyCutoffTime:Object.prototype.hasOwnProperty.call(input,'monthlyCutoffTime')?validTime(input.monthlyCutoffTime,current.monthlyCutoffTime):current.monthlyCutoffTime,adminAfterLock:Object.prototype.hasOwnProperty.call(input,'adminAfterLock')&&input.adminAfterLock==='disabled'?'disabled':(Object.prototype.hasOwnProperty.call(input,'adminAfterLock')?'controlled':current.adminAfterLock),reason,updatedAt:new Date().toISOString(),updatedBy:a.name};
 const saved=await db.rpc('phf_save_checklist_monthly_overdue_policy',{p_policy:policy,p_reason:reason,p_actor_id:a.id,p_actor_code:a.employeeCode,p_actor_name:a.name});
 if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MONTHLY_POLICY_PERIOD_LOCKED/i.test(message))fail('Kỳ '+effectiveFromPeriod+' đã khóa nên không thể đổi chính sách áp dụng cho kỳ này.',409,'CHECKLIST_MONTHLY_POLICY_PERIOD_LOCKED');if(/phf_save_checklist_monthly_overdue_policy/i.test(message))fail('Chưa chạy SQL ổn định Production cho chính sách quá hạn.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw saved.error;}
 return {saved:true,policy:parseMonthlyOverduePolicy(JSON.stringify(saved.data&&saved.data.policy||policy))};
}

const MONTHLY_CYCLE_SETTING_KEY='monthly_cycle_policy';
function monthlyCycleDbError(error,operation='chu kỳ đánh giá'){
 const message=String(error&&error.message||''),code=String(error&&error.code||'');
 if(code==='PGRST204'||/schema cache/i.test(message)){
  if(/setting_key|setting_value|checklist_system_settings/i.test(message))fail('CSDL cấu hình Checklist chưa đúng schema. Vui lòng chạy SQL PHF_CHECKLIST_MONTHLY_CYCLE_SCHEMA_1.36.3.sql rồi thử lại.',503,'CHECKLIST_MONTHLY_CYCLE_SETTINGS_SCHEMA_MISSING');
  if(/cycle_policy_snapshot|self_open_at|review_open_at|scheduled_lock_at|checklist_monthly_periods/i.test(message))fail('CSDL kỳ đánh giá chưa có đủ cột chu kỳ tự động. Vui lòng chạy SQL PHF_CHECKLIST_MONTHLY_CYCLE_SCHEMA_1.36.3.sql.',503,'CHECKLIST_MONTHLY_CYCLE_PERIOD_SCHEMA_MISSING');
  if(/checklist_monthly_period_overrides|checklist_monthly_cycle_policy_history/i.test(message))fail('CSDL chưa có bảng ngoại lệ/lịch sử chu kỳ. Vui lòng chạy SQL PHF_CHECKLIST_MONTHLY_CYCLE_SCHEMA_1.36.3.sql.',503,'CHECKLIST_MONTHLY_CYCLE_AUDIT_SCHEMA_MISSING');
 }
 if(code==='42P01')fail('Thiếu bảng dữ liệu cho '+operation+'. Vui lòng chạy SQL PHF_CHECKLIST_MONTHLY_CYCLE_SCHEMA_1.36.3.sql.',503,'CHECKLIST_MONTHLY_CYCLE_TABLE_MISSING');
 throw error;
}
function defaultMonthlyCyclePolicy(){return {autoCreateEnabled:true,sourceMode:'previous_period',createDay:1,createTime:'00:05',selfStartDay:1,selfEndDay:3,reviewStartDay:1,reviewEndDay:4,lockDay:4,lockTime:'23:59',effectiveFromPeriod:'2026-08',updatedAt:'',updatedBy:'',reason:''};}
function parseMonthlyCyclePolicy(value){try{const x=JSON.parse(t(value)||'{}'),b=defaultMonthlyCyclePolicy();return {...b,...x,autoCreateEnabled:x.autoCreateEnabled!==false,sourceMode:x.sourceMode==='current_assignments'?'current_assignments':'previous_period',createDay:boundedInt(x.createDay,b.createDay,1,28),createTime:validTime(x.createTime,b.createTime),selfStartDay:boundedInt(x.selfStartDay,b.selfStartDay,1,28),selfEndDay:boundedInt(x.selfEndDay,b.selfEndDay,1,28),reviewStartDay:boundedInt(x.reviewStartDay,b.reviewStartDay,1,28),reviewEndDay:boundedInt(x.reviewEndDay,b.reviewEndDay,1,28),lockDay:boundedInt(x.lockDay,b.lockDay,1,28),lockTime:validTime(x.lockTime,b.lockTime),effectiveFromPeriod:/^\d{4}-(0[1-9]|1[0-2])$/.test(t(x.effectiveFromPeriod))?t(x.effectiveFromPeriod):b.effectiveFromPeriod};}catch(_){return defaultMonthlyCyclePolicy();}}
function nextMonth(periodMonth){const [y,m]=month(periodMonth).split('-').map(Number),d=new Date(Date.UTC(y,m,1));return d.toISOString().slice(0,7);}
function periodDateTime(periodMonth,day,time){const actionMonth=nextMonth(periodMonth),parts=actionMonth.split('-'),last=new Date(Number(parts[0]),Number(parts[1]),0).getDate(),safe=Math.min(boundedInt(day,1,1,31),last),hh=validTime(time,'00:00');return `${actionMonth}-${String(safe).padStart(2,'0')}T${hh}:00+07:00`; }
async function monthlyCycleOverride(periodMonth){const got=await db.from('checklist_monthly_period_overrides').select('*').eq('period_month',month(periodMonth)).maybeSingle();if(got.error&&String(got.error.code)!=='42P01')throw got.error;return got.data||null;}
async function getMonthlyCyclePolicy(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');if(input.public!==true)admin(session);const got=await db.from('checklist_system_settings').select('*').eq('setting_key',MONTHLY_CYCLE_SETTING_KEY).maybeSingle();if(got.error)monthlyCycleDbError(got.error,'tải cấu hình chu kỳ');const policy=parseMonthlyCyclePolicy(got.data&&got.data.setting_value),period=month(input.period||new Date().toISOString().slice(0,7)),override=await monthlyCycleOverride(period);return {policy:{...policy,updatedAt:got.data&&got.data.updated_at||'',updatedBy:got.data&&got.data.updated_by||''},override,period,window:await resolveMonthlyCycleWindow(period,policy,override)};}
async function resolveMonthlyCycleWindow(periodMonth,policyArg,overrideArg){const policy=policyArg||parseMonthlyCyclePolicy((await db.from('checklist_system_settings').select('setting_value').eq('setting_key',MONTHLY_CYCLE_SETTING_KEY).maybeSingle()).data?.setting_value),override=overrideArg===undefined?await monthlyCycleOverride(periodMonth):overrideArg||null;const pick=(key,base)=>override&&override[key]!=null?override[key]:base;return {periodMonth:month(periodMonth),selfOpenAt:periodDateTime(periodMonth,pick('self_start_day',policy.selfStartDay),'00:00'),selfDueAt:periodDateTime(periodMonth,pick('self_end_day',policy.selfEndDay),'23:59'),reviewOpenAt:periodDateTime(periodMonth,pick('review_start_day',policy.reviewStartDay),'00:00'),reviewDueAt:periodDateTime(periodMonth,pick('review_end_day',policy.reviewEndDay),'23:59'),lockAt:periodDateTime(periodMonth,pick('lock_day',policy.lockDay),pick('lock_time',policy.lockTime)),isOverride:Boolean(override),overrideReason:t(override&&override.reason)};}
async function saveMonthlyCyclePolicy(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const reason=t(input.reason);if(reason.length<10)fail('Lý do thay đổi cần tối thiểu 10 ký tự.',409,'CHECKLIST_MONTHLY_CYCLE_REASON_REQUIRED');const old=await getMonthlyCyclePolicy(session,{period:input.effectiveFromPeriod}),a=actor(session),policy=parseMonthlyCyclePolicy(JSON.stringify({...old.policy,...input,reason,updatedAt:new Date().toISOString(),updatedBy:a.name}));if(policy.selfEndDay<policy.selfStartDay)fail('Ngày kết thúc tự đánh giá phải từ ngày bắt đầu trở đi.');if(policy.reviewEndDay<policy.reviewStartDay)fail('Ngày kết thúc thẩm định phải từ ngày bắt đầu trở đi.');const saved=await db.from('checklist_system_settings').upsert({setting_key:MONTHLY_CYCLE_SETTING_KEY,setting_value:JSON.stringify(policy),description:'Chu kỳ tự động phiếu đánh giá tháng',updated_at:new Date().toISOString(),updated_by:a.name},{onConflict:'setting_key'}).select('*').single();if(saved.error)monthlyCycleDbError(saved.error,'lưu cấu hình chu kỳ');const history=await db.from('checklist_monthly_cycle_policy_history').insert({before_data:old.policy,after_data:policy,reason,changed_by:a.id,changed_by_code:a.employeeCode,changed_by_name:a.name});if(history.error)monthlyCycleDbError(history.error,'ghi lịch sử chu kỳ');return {saved:true,policy,window:await resolveMonthlyCycleWindow(policy.effectiveFromPeriod,policy,null)};}
async function saveMonthlyCycleOverride(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const period=month(input.period),reason=t(input.reason);if(reason.length<10)fail('Lý do ngoại lệ cần tối thiểu 10 ký tự.');const a=actor(session),row={period_month:period,self_start_day:input.selfStartDay==null?null:boundedInt(input.selfStartDay,1,1,28),self_end_day:input.selfEndDay==null?null:boundedInt(input.selfEndDay,3,1,28),review_start_day:input.reviewStartDay==null?null:boundedInt(input.reviewStartDay,1,1,28),review_end_day:input.reviewEndDay==null?null:boundedInt(input.reviewEndDay,4,1,28),lock_day:input.lockDay==null?null:boundedInt(input.lockDay,4,1,28),lock_time:input.lockTime?validTime(input.lockTime):null,reason,updated_at:new Date().toISOString(),updated_by:a.id,updated_by_code:a.employeeCode,updated_by_name:a.name};const saved=await db.from('checklist_monthly_period_overrides').upsert(row,{onConflict:'period_month'}).select('*').single();if(saved.error)monthlyCycleDbError(saved.error,'lưu ngoại lệ chu kỳ');return {saved:true,override:saved.data,window:await resolveMonthlyCycleWindow(period,null,saved.data)};}
async function reconcileMissingMonthlyReviewers(session,periodMonth){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const m=month(periodMonth),a=actor(session),end=periodBounds(m).end,assignmentState=await assignmentSnapshotsAt(end),byCode=new Map((assignmentState.snapshots||[]).map(x=>[t(x.employee_code).toUpperCase(),x]));
 const got=await db.from('checklist_monthly_forms').select('*').eq('period_month',m).eq('status','draft').limit(1000);if(got.error)throw got.error;
 const changed=[],warnings=[];
 for(const form of got.data||[]){
  const current=byCode.get(t(form.employee_code).toUpperCase())||{};
  const currentReviewerId=t(current.manager_id),currentReviewerCode=t(current.manager_code).toUpperCase();
  const hasCurrentReviewer=Boolean(currentReviewerId||currentReviewerCode);
  if(!hasCurrentReviewer){
   if(!t(form.reviewer_id)&&!t(form.reviewer_code)){warnings.push({code:'MISSING_REVIEWER',employeeCode:t(form.employee_code).toUpperCase(),employeeName:t(form.employee_name),message:'Chưa có người thẩm định trong phân công hiệu lực của kỳ.'});}
   continue;
  }
  const matchesCurrent=t(form.reviewer_id)===currentReviewerId&&t(form.reviewer_code).toUpperCase()===currentReviewerCode;
  if(matchesCurrent)continue;
  const reviewerId=currentReviewerId,reviewerCode=currentReviewerCode,reviewerName=t(current.manager_name);
  if(!reviewerName){warnings.push({code:'MISSING_REVIEWER_NAME',employeeCode:t(form.employee_code).toUpperCase(),employeeName:t(form.employee_name),message:'Người thẩm định hiệu lực chưa có họ tên.'});continue;}
  const reason='Hệ thống đồng bộ người thẩm định theo phân công hiệu lực của kỳ '+m+'.';
  const rpc=await db.rpc('change_checklist_monthly_reviewer',{p_form_id:form.id,p_reviewer_id:reviewerId,p_reviewer_code:reviewerCode,p_reviewer_name:reviewerName,p_reason:reason,p_actor_id:a.id,p_actor_code:a.employeeCode,p_actor_name:a.name});
  if(rpc.error){warnings.push({code:'REVIEWER_RECONCILE_FAILED',employeeCode:t(form.employee_code).toUpperCase(),employeeName:t(form.employee_name),message:t(rpc.error.message)||'Không thể đồng bộ người thẩm định.'});continue;}
  const result=rpc.data||{};
  if(result.ok===true)changed.push({formId:form.id,employeeCode:t(form.employee_code).toUpperCase(),employeeName:t(form.employee_name),reviewerId,reviewerCode,reviewerName});
  else warnings.push({code:t(result.code)||'REVIEWER_RECONCILE_BLOCKED',employeeCode:t(form.employee_code).toUpperCase(),employeeName:t(form.employee_name),message:t(result.message)||'Không thể đồng bộ người thẩm định.'});
 }
 return {updated:changed.length,changed,warnings};
}
async function syncMonthlyCycle(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const period=month(input.month||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date()).replace('/','-')),
  cfg=await getMonthlyCyclePolicy(session,{period}),window=cfg.window;
 if(input.automatic===true&&cfg.policy.autoCreateEnabled===false)return {synced:false,skipped:'AUTO_DISABLED',window,policy:cfg.policy};
 const existingRead=await db.from('checklist_monthly_periods').select('*').eq('period_month',period).maybeSingle();if(existingRead.error)monthlyCycleDbError(existingRead.error,'đọc kỳ hiện tại');
 let existing=existingRead.data||null,createdResult={created:0,skippedExisting:0,forms:[],period:existing},reconciled=false,reviewerReconcile={updated:0,changed:[],warnings:[]};
 const lastSync=existing&&existing.synced_at?Date.parse(existing.synced_at):0,needsReconcile=input.automatic!==true||!existing||!lastSync||Date.now()-lastSync>20*60*60*1000;
 if(needsReconcile){createdResult=await createMonthly(session,{month:period});reviewerReconcile=await reconcileMissingMonthlyReviewers(session,period);reconciled=true;const readAgain=await db.from('checklist_monthly_periods').select('*').eq('period_month',period).maybeSingle();if(readAgain.error)monthlyCycleDbError(readAgain.error,'đọc lại kỳ sau đồng bộ');existing=readAgain.data||existing;}
 let opened=false,locked=false,lockBlocked=false;const warnings=[...(reviewerReconcile.warnings||[])],now=Date.now();
 const patch={cycle_policy_snapshot:cfg.policy,source_period_month:cfg.policy.sourceMode==='previous_period'?previousPeriod(period):null,auto_created:input.automatic===true||(existing&&existing.auto_created===true),synced_at:reconciled?new Date().toISOString():(existing&&existing.synced_at||new Date().toISOString()),self_open_at:window.selfOpenAt,self_due_at:window.selfDueAt,review_open_at:window.reviewOpenAt,review_due_at:window.reviewDueAt,scheduled_lock_at:window.lockAt};
 const updated=await db.from('checklist_monthly_periods').update(patch).eq('period_month',period).select('*').maybeSingle();if(updated.error)monthlyCycleDbError(updated.error,'lưu snapshot lịch kỳ');if(updated.data)existing=updated.data;
 if(existing&&existing.status==='draft'&&now>=Date.parse(window.selfOpenAt)){
  try{const openedResult=await openMonthly(session,{month:period});opened=openedResult&&openedResult.ok!==false;existing=openedResult.period||existing;}
  catch(err){
   const code=t(err&&err.code).toUpperCase(),message=t(err&&err.message)||'Chưa thể mở kỳ.';
   if(code==='MISSING_REVIEWER'||code==='CHECKLIST_MONTHLY_MISSING_REVIEWER'||/MISSING_REVIEWER|chưa có người thẩm định/i.test(message))warnings.push({code:'MISSING_REVIEWER',message});
   else throw err;
  }
 }
 if(now>Date.parse(window.lockAt)&&existing&&existing.status!=='locked'){
  const pending=await db.from('checklist_monthly_forms').select('id',{count:'exact',head:true}).eq('period_month',period).in('status',['waiting_self','waiting_review']);if(pending.error)throw pending.error;
  if(Number(pending.count||0)===0){try{await lockMonthly(session,{month:period,reason:'Hệ thống tự khóa kỳ theo lịch cấu hình.',force:false});locked=true;}catch(_){lockBlocked=true;}}
  else lockBlocked=true;
 }
 const missingReviewerForms=(createdResult.forms||[]).filter(x=>!t(x.reviewer_code)&&!t(x.reviewer_id)).map(x=>({code:'MISSING_REVIEWER',employeeCode:t(x.employee_code).toUpperCase(),employeeName:t(x.employee_name),message:'Chưa có người thẩm định.'}));
 missingReviewerForms.forEach(item=>{if(!warnings.some(w=>w.code==='MISSING_REVIEWER'&&w.employeeCode===item.employeeCode))warnings.push(item);});
 return {synced:true,reconciled,opened,locked,lockBlocked,warnings,warningCount:warnings.length,window,policy:cfg.policy,created:Number(createdResult.created||0),skippedExisting:Number(createdResult.skippedExisting||0),reviewerUpdated:Number(reviewerReconcile.updated||0),reviewerChanges:reviewerReconcile.changed||[],forms:createdResult.forms||[],period:existing||createdResult.period};
}
function previousPeriod(period){const [y,m]=month(period).split('-').map(Number),d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);}
function reviewWindowState(window,form){const now=Date.now(),start=Date.parse(window.reviewOpenAt),end=Date.parse(window.reviewDueAt),selfSubmitted=Boolean(form.self_submitted_at)||['waiting_review','reviewed','locked'].includes(form.status);let state='not_open',canReview=false,label='Chưa đến thời gian thẩm định';if(now>=start&&now<=end){state=selfSubmitted?'ready':'waiting_self';canReview=selfSubmitted&&form.status==='waiting_review';label=selfSubmitted?'Đang trong thời gian thẩm định':'Đang mở · chờ nhân viên gửi tự đánh giá';}else if(now>end){state=form.status==='reviewed'||form.status==='locked'?'completed':'overdue';label=state==='completed'?'Đã hoàn tất':'Đã hết thời gian thẩm định';}return {state,canReview,label,...window};}

function scoreWeight(value,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n*100)/100)):fallback;}
function normalizeMonthlyScorePolicy(value,source='database'){
 const row=value&&typeof value==='object'&&!Array.isArray(value)?value:{},base=MONTHLY_SCORE_POLICY_DEFAULT;
 const selfWeight=scoreWeight(row.selfWeight==null?row.self_weight:row.selfWeight,base.selfWeight),reviewWeight=scoreWeight(row.reviewWeight==null?row.review_weight:row.reviewWeight,base.reviewWeight);
 return {id:t(row.id),effectiveFromPeriod:/^\d{4}-(0[1-9]|1[0-2])$/.test(t(row.effectiveFromPeriod||row.effective_from_period))?t(row.effectiveFromPeriod||row.effective_from_period):base.effectiveFromPeriod,selfWeight,reviewWeight,reason:t(row.reason),updatedAt:row.updatedAt||row.updated_at||'',updatedBy:t(row.updatedBy||row.updated_by_name||row.updated_by),source:row.source||source,formulaVersion:t(row.formulaVersion||row.formula_version)||base.formulaVersion};
}
function monthlyScorePolicySnapshot(value,periodMonth=''){
 const p=normalizeMonthlyScorePolicy(value,value&&value.source||'snapshot'),sum=p.selfWeight+p.reviewWeight;
 return {effectiveFromPeriod:p.effectiveFromPeriod,selfWeight:p.selfWeight,reviewWeight:p.reviewWeight,totalWeight:Math.round(sum*100)/100,formulaVersion:p.formulaVersion,periodMonth:t(periodMonth)};
}
async function resolveMonthlyScorePolicyAt(periodMonth){
 const m=month(periodMonth),got=await db.from('checklist_monthly_score_policies').select('*').eq('is_active',true).lte('effective_from_period',m).order('effective_from_period',{ascending:false}).limit(1);
 if(got.error)throw got.error;return normalizeMonthlyScorePolicy(got.data&&got.data[0]||MONTHLY_SCORE_POLICY_DEFAULT,got.data&&got.data.length?'database':'default');
}
async function getChecklistMonthlyScorePolicy(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const requested=/^\d{4}-(0[1-9]|1[0-2])$/.test(t(input.period))?t(input.period):new Date().toISOString().slice(0,7);
 const [policiesResult,historyResult]=await Promise.all([
  db.from('checklist_monthly_score_policies').select('*').eq('is_active',true).order('effective_from_period',{ascending:false}).limit(100),
  db.from('checklist_monthly_score_policy_history').select('*').order('changed_at',{ascending:false}).limit(30)
 ]);
 if(policiesResult.error)throw policiesResult.error;if(historyResult.error)throw historyResult.error;
 const policies=(policiesResult.data||[]).map(x=>normalizeMonthlyScorePolicy(x,'database'));
 const eligible=policies.filter(x=>x.effectiveFromPeriod<=requested).sort((a,b)=>a.effectiveFromPeriod.localeCompare(b.effectiveFromPeriod));
 const policy=eligible.length?eligible[eligible.length-1]:(policies[policies.length-1]||normalizeMonthlyScorePolicy(MONTHLY_SCORE_POLICY_DEFAULT,'default'));
 return {policy,policies,history:(historyResult.data||[]).map(x=>({id:x.id,effectiveFromPeriod:x.effective_from_period,beforeData:x.before_data||{},afterData:x.after_data||{},reason:t(x.reason),changedByName:t(x.changed_by_name),changedAt:x.changed_at})),requestedPeriod:requested};
}
async function saveChecklistMonthlyScorePolicy(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const effectiveFromPeriod=month(input.effectiveFromPeriod||'2026-08'),selfWeight=scoreWeight(input.selfWeight,NaN),reviewWeight=scoreWeight(input.reviewWeight,NaN),reason=t(input.reason);
 if(!Number.isFinite(selfWeight)||!Number.isFinite(reviewWeight))fail('Trọng số phải là số hợp lệ.',409,'CHECKLIST_MONTHLY_SCORE_WEIGHT_INVALID');
 if(selfWeight+reviewWeight<=0)fail('Tổng trọng số phải lớn hơn 0.',409,'CHECKLIST_MONTHLY_SCORE_WEIGHT_ZERO');
 if(reason.length<10)fail('Lý do thay đổi cần tối thiểu 10 ký tự.',409,'CHECKLIST_MONTHLY_SCORE_REASON_REQUIRED');
 const a=actor(session),saved=await db.rpc('phf_save_checklist_monthly_score_policy',{p_effective_from_period:effectiveFromPeriod,p_self_weight:selfWeight,p_review_weight:reviewWeight,p_reason:reason,p_actor_id:a.id,p_actor_code:a.employeeCode,p_actor_name:a.name});
 if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MONTHLY_SCORE_PERIOD_LOCKED/i.test(message))fail('Kỳ '+effectiveFromPeriod+' đã khóa nên không thể đổi chính sách áp dụng cho kỳ này.',409,'CHECKLIST_MONTHLY_SCORE_PERIOD_LOCKED');if(/CHECKLIST_MONTHLY_SCORE_FORMS_EXIST:([^\s]+)/i.test(message)){const found=message.match(/CHECKLIST_MONTHLY_SCORE_FORMS_EXIST:([^\s]+)/i);fail('Đã có phiếu từ kỳ '+(found&&found[1]||effectiveFromPeriod)+'. Trọng số của các kỳ đã tạo được bảo vệ; vui lòng chọn kỳ áp dụng mới hơn.',409,'CHECKLIST_MONTHLY_SCORE_FORMS_EXIST');}if(/phf_save_checklist_monthly_score_policy/i.test(message))fail('Chưa chạy SQL ổn định Production cho trọng số phiếu tháng.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw saved.error;}
 const after=normalizeMonthlyScorePolicy(saved.data&&saved.data.policy||{},'database');
 return {saved:true,policy:after,message:'Đã lưu trọng số '+selfWeight+':'+reviewWeight+' từ kỳ '+effectiveFromPeriod+'. Các kỳ/phiếu đã tạo trước đó giữ nguyên bản chụp cũ.'};
}
async function ensurePeriodScorePolicy(period,periodMonth){
 if(period&&period.score_policy_snapshot&&typeof period.score_policy_snapshot==='object'&&Number(period.score_policy_snapshot.selfWeight??period.score_policy_snapshot.self_weight)+Number(period.score_policy_snapshot.reviewWeight??period.score_policy_snapshot.review_weight)>0)return monthlyScorePolicySnapshot(period.score_policy_snapshot,periodMonth);
 const resolved=await resolveMonthlyScorePolicyAt(periodMonth),snapshot=monthlyScorePolicySnapshot(resolved,periodMonth);
 if(period&&period.id){const saved=await db.from('checklist_monthly_periods').update({score_policy_snapshot:snapshot}).eq('id',period.id).select('*').single();if(saved.error)throw saved.error;Object.assign(period,saved.data);}
 return snapshot;
}
function monthlySelfDeadline(periodMonth,day=2){const y=Number(periodMonth.slice(0,4)),m=Number(periodMonth.slice(5,7));return new Date(Date.UTC(y,m,day,16,59,59,999));}
async function processMonthlySelfOverdue(session,input={}){
 admin(session);const m=month(input.month),manual=input.manual===true,policyData=await getMonthlyOverduePolicy(session),policy=policyData.policy;
 if(m<policy.effectiveFromPeriod)return {processed:0,skipped:true,message:'Chính sách áp dụng từ kỳ '+policy.effectiveFromPeriod+'.',policy};
 const now=new Date();if(now<monthlySelfDeadline(m,policy.selfDueDay))fail('Chưa đến hạn tự đánh giá của kỳ '+m+'.',409,'CHECKLIST_MONTHLY_SELF_NOT_DUE');
 const got=await db.from('checklist_monthly_forms').select('*').eq('period_month',m).eq('status','waiting_self').limit(1000);if(got.error)throw got.error;
 const a=actor(session),reason='Hệ thống áp dụng chính sách quá hạn '+(policy.mode==='zero'?'0 điểm':'điểm tối đa')+' cho kỳ '+m,rows=[];
 for(const form of got.data||[]){const answers={};manualRows(form).forEach(r=>{answers[r.code]={value:String(policy.mode==='zero'?0:r.weight),note:'Hệ thống áp dụng do quá hạn tự đánh giá.'};});const breakdown=await checklistBreakdown(form.employee_code,m),summary=scoreSummary({...form,self_answers:answers,checklist_score:breakdown.score}),stamp=new Date().toISOString();rows.push({form_id:form.id,expected_updated_at:form.updated_at,self_answers:answers,self_note:reason,checklist_score:breakdown.score,self_total_score:summary.selfTotalScore,self_saved_at:stamp,self_submitted_at:stamp,after_data:{status:'waiting_review',policyMode:policy.mode,selfTotalScore:summary.selfTotalScore}});}
 if(!rows.length)return {processed:0,policy,message:'Không có phiếu quá hạn cần xử lý.'};
 const actorId=manual?a.id:'system',actorCode=manual?a.employeeCode:'SYSTEM',actorName=manual?a.name:'Hệ thống';
 const saved=await db.rpc('phf_apply_monthly_overdue_batch',{p_period_month:m,p_rows:rows,p_reason:reason,p_actor_id:actorId,p_actor_code:actorCode,p_actor_name:actorName});
 if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MONTHLY_PERIOD_LOCKED/i.test(message))fail('Kỳ đã khóa, không thể xử lý quá hạn.',409,'CHECKLIST_MONTHLY_PERIOD_LOCKED');if(/CHECKLIST_MONTHLY_OVERDUE_STALE/i.test(message))fail('Có phiếu vừa được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi xử lý quá hạn.',409,'CHECKLIST_MONTHLY_OVERDUE_STALE');if(/CHECKLIST_MONTHLY_OVERDUE_SCORE_CHANGED/i.test(message))fail('Điểm Checklist vừa thay đổi trong lúc xử lý quá hạn. Vui lòng tải lại để hệ thống tính đúng điểm.',409,'CHECKLIST_MONTHLY_OVERDUE_SCORE_CHANGED');if(/phf_apply_monthly_overdue_batch/i.test(message))fail('Chưa chạy SQL ổn định Production cho xử lý quá hạn.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw saved.error;}
 const processed=Number(saved.data&&saved.data.processed||0);return {processed,policy,message:processed?'Đã xử lý '+processed+' phiếu quá hạn.':'Không có phiếu quá hạn cần xử lý.'};
}
function fail(m,s=400,c='CHECKLIST_MONTHLY_INVALID'){const e=new Error(m);e.statusCode=s;e.code=c;throw e;}
function admin(s){if(!s||s.role!=='admin')fail('Chỉ Admin được vận hành kỳ đánh giá.',403,'CHECKLIST_MONTHLY_ADMIN_ONLY');}
function month(v){v=t(v);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))fail('Kỳ đánh giá không hợp lệ.');return v;}
function actor(s){return {id:t(s?.account?.id||s?.sub),name:t(s?.account?.name||s?.account?.email),employeeId:t(s?.employeeId||s?.account?.employeeId),employeeCode:t(s?.employeeCode||s?.account?.employeeCode).toUpperCase()};}
function periodBounds(m){const year=Number(m.slice(0,4)),monthNo=Number(m.slice(5,7));return {start:m+'-01',end:new Date(Date.UTC(year,monthNo,0)).toISOString().slice(0,10)};}
function sameTimestamp(a,b){const x=Date.parse(t(a)),y=Date.parse(t(b));return Number.isFinite(x)&&Number.isFinite(y)&&x===y;}
function assertFresh(form,expected,code){if(t(expected)&&!sameTimestamp(expected,form&&form.updated_at))fail('Phiếu đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi lưu.',409,code||'CHECKLIST_MONTHLY_STALE');}
async function readAllRows(table,orderColumns,pageSize=1000){
 const rows=[];let from=0;
 while(true){
  let query=db.from(table).select('*');
  (orderColumns||[]).forEach(column=>{query=query.order(column,{ascending:true});});
  const result=await query.range(from,from+pageSize-1);if(result.error)throw result.error;
  const page=Array.isArray(result.data)?result.data:[];rows.push(...page);
  if(page.length<pageSize)break;from+=pageSize;
 }
 return rows;
}
function parseObject(value){if(!value)return null;if(typeof value==='object'&&!Array.isArray(value))return value;try{const parsed=JSON.parse(String(value));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch(_){return null;}}
function assignmentIdentity(row){return t(row&&row.employee_key).toLowerCase()||t(row&&row.employee_id).toLowerCase()||t(row&&row.employee_code).toUpperCase();}
function normalizeAssignmentSnapshot(source,sourceRank=0){if(!source||typeof source!=='object')return null;return {...source,employee_key:t(source.employee_key).toLowerCase(),employee_id:t(source.employee_id),employee_code:t(source.employee_code).toUpperCase(),employee_name:t(source.employee_name),department:t(source.department),title:t(source.title),branch:t(source.branch),manager_id:t(source.manager_id),manager_code:t(source.manager_code).toUpperCase(),manager_name:t(source.manager_name),employee_status:t(source.employee_status),template_id:t(source.template_id).toLowerCase(),template_version:t(source.template_version),effective_date:t(source.effective_date),_changed_at:t(source.changed_at||source.updated_at||source.created_at),_source_rank:sourceRank};}
function latestStamp(rows,columns){let latest='';(rows||[]).forEach(row=>(columns||[]).forEach(column=>{const stamp=t(row&&row[column]);if(stamp&&(!latest||stamp>latest))latest=stamp;}));return latest;}
async function assignmentSnapshotsAt(cutoffDate){
 const [currentRows,historyRows]=await Promise.all([
  readAllRows('checklist_employee_assignments',['employee_key','updated_at','id']),
  readAllRows('checklist_employee_assignment_history',['employee_key','changed_at','id'])
 ]);
 const candidatesByKey=new Map();
 function add(raw,rank){const row=normalizeAssignmentSnapshot(raw,rank),key=assignmentIdentity(row);if(!row||!key||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.effective_date)||row.effective_date>cutoffDate)return;if(!candidatesByKey.has(key))candidatesByKey.set(key,[]);candidatesByKey.get(key).push(row);}
 currentRows.forEach(row=>add(row,3));
 historyRows.forEach(row=>{add(row,2);add(parseObject(row.previous_data),1);});
 const snapshots=[];
 candidatesByKey.forEach(rows=>{rows.sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b._changed_at.localeCompare(a._changed_at)||b._source_rank-a._source_rank);if(rows[0])snapshots.push(rows[0]);});
 return {snapshots,revision:{current_count:currentRows.length,history_count:historyRows.length,current_max:latestStamp(currentRows,['updated_at','created_at']),history_max:latestStamp(historyRows,['changed_at','updated_at','created_at'])}};
}
function normalizedSource(v){return t(v).toLocaleLowerCase('vi-VN');}
function isAutomaticSource(v,name=''){const s=normalizedSource(v),n=normalizedSource(name);return s==='checklist'||s==='hệ thống'||s==='he thong'||n.includes('tuân thủ tiêu chuẩn công việc')||n.includes('tuan thu tieu chuan cong viec');}
function numeric(v){const n=Number(String(v==null?'':v).replace('%','').replace(',','.').trim());return Number.isFinite(n)?n:0;}
function round2(v){return Math.round((Number(v)||0)*100)/100;}
async function mapWithConcurrency(items,limit,worker){
 const rows=Array.from(items||[]),results=new Array(rows.length),size=Math.max(1,Math.min(Number(limit)||1,rows.length||1));let cursor=0;
 async function run(){while(cursor<rows.length){const index=cursor++;results[index]=await worker(rows[index],index);}}
 await Promise.all(Array.from({length:size},run));return results;
}
async function checklistBreakdown(employeeCode,periodMonth){
 const code=t(employeeCode).toUpperCase(),m=month(periodMonth),range=periodBounds(m);
 if(!code)return {baseScore:100,totalPoints:0,count:0,score:100,violations:[]};
 const {data,error}=await db.from('checklist_violation_records').select('id,criterion_code,criterion_name,criterion_group,points,occurred_date,occurred_time,location,note,created_by_name,created_at').eq('employee_code',code).eq('is_test',false).eq('record_status','official').gte('occurred_date',range.start).lte('occurred_date',range.end).order('occurred_date',{ascending:true}).order('occurred_time',{ascending:true});
 if(error)throw error;
 const violations=(data||[]).map(x=>({id:x.id,criterionCode:t(x.criterion_code),criterionName:t(x.criterion_name),criterionGroup:t(x.criterion_group),points:Math.max(0,Number(x.points||0)),occurredDate:x.occurred_date,occurredTime:t(x.occurred_time).slice(0,5),location:t(x.location),note:t(x.note),createdByName:t(x.created_by_name),createdAt:x.created_at}));
 const totalPoints=violations.reduce((sum,x)=>sum+x.points,0);
 return {baseScore:100,totalPoints,count:violations.length,score:Math.max(0,100-totalPoints),violations};
}
async function refreshUnlockedChecklistScore(form){
 const breakdown=await checklistBreakdown(form.employee_code,form.period_month),liveStatuses=['draft','waiting_self','waiting_review','reviewed'],isLive=liveStatuses.includes(form.status);
 const currentScore=Number(form.checklist_score||0),reviewScore=Number(form.checklist_review_score==null?currentScore:form.checklist_review_score),scoreChanged=Math.abs(currentScore-breakdown.score)>0.001,reviewChanged=form.status==='reviewed'&&Math.abs(reviewScore-breakdown.score)>0.001;
 if(isLive&&(scoreChanged||reviewChanged)){
  const calculated={...form,checklist_score:breakdown.score};if(form.status==='reviewed')calculated.checklist_review_score=breakdown.score;
  const summary=scoreSummary(calculated),stamp=new Date().toISOString(),patch={checklist_score:breakdown.score,self_total_score:summary.selfTotalScore,review_total_score:summary.reviewTotalScore,updated_at:stamp};
  if(form.status==='reviewed'){patch.checklist_review_score=breakdown.score;patch.final_score=summary.finalScore;patch.score_calculated_at=stamp;}
  let update=db.from('checklist_monthly_forms').update(patch).eq('id',form.id).in('status',liveStatuses);if(form.updated_at)update=update.eq('updated_at',form.updated_at);
  const saved=await update.select('*').maybeSingle();if(saved.error)throw saved.error;
  if(saved.data)form=saved.data;else{const latest=await db.from('checklist_monthly_forms').select('*').eq('id',form.id).maybeSingle();if(latest.error)throw latest.error;if(latest.data)form=latest.data;}
 }
 return {...form,checklist_breakdown:form.status==='locked'?{...breakdown,score:Number(form.checklist_score||0),locked:true}:breakdown};
}
async function formHistories(formIds){
 const ids=[...new Set((formIds||[]).map(t).filter(Boolean))];if(!ids.length)return new Map();
 const got=await db.from('checklist_monthly_form_history').select('*').in('form_id',ids).order('changed_at',{ascending:true});if(got.error)throw got.error;
 const map=new Map();(got.data||[]).forEach(x=>{if(!map.has(x.form_id))map.set(x.form_id,[]);map.get(x.form_id).push(x);});return map;
}
async function marketingTemplateFoundation(period,templateId){
 const end=periodBounds(period).end,templateKey=marketingMonthlyTemplateKey(templateId);
 if(!templateKey)fail('Mẫu này không thuộc phạm vi KPI tháng Marketing.',409,'CHECKLIST_MARKETING_KPI_TEMPLATE_FORBIDDEN');
 const [templates,versions]=await Promise.all([
  readAllRows('checklist_templates',['template_key','updated_at','id']),
  readAllRows('checklist_template_versions',['template_key','created_at','id'])
 ]);
 const template=templates.find(row=>t(row.template_key).toLowerCase()===templateKey)||null;
 const templateVersions=versions.filter(row=>t(row.template_key).toLowerCase()===templateKey)
  .sort((a,b)=>t(b.effective_date).localeCompare(t(a.effective_date))||t(b.created_at).localeCompare(t(a.created_at)));
 const eligible=templateVersions.filter(row=>t(row.effective_date)&&t(row.effective_date)<=end);
 const currentVersion=t(template&&template.current_version);
 const current=templateVersions.find(row=>currentVersion&&t(row.version_no)===currentVersion)||null;
 const version=eligible[0]||current||templateVersions[0]||null;
 if(!template||!version)fail('Mẫu Marketing chưa có dữ liệu nền để cập nhật cho kỳ này.',409,'CHECKLIST_MARKETING_KPI_TEMPLATE_VERSION_MISSING');
 const sourceType=eligible[0]?'admin_template':current?'admin_current_version_fallback':'admin_latest_version_fallback';
 return {template,templateVersion:t(version.version_no),definition:cloneJson(version.definition||{}),sourceType,sourcePeriod:''};
}
async function previousMarketingKpiSource(period,templateId){
 const prev=previousPeriod(period),templateKey=marketingMonthlyTemplateKey(templateId);
 let config=null;
 const configRead=await db.from('checklist_monthly_kpi_configs').select('template_version,definition_snapshot').eq('period_month',prev).eq('department','Marketing').eq('template_id',templateId).maybeSingle();
 if(configRead.error)marketingConfigDbError(configRead.error);else config=configRead.data||null;
 if(config&&config.definition_snapshot&&Object.keys(config.definition_snapshot).length)return {templateVersion:t(config.template_version),definition:cloneJson(config.definition_snapshot),sourceType:'previous_config',sourcePeriod:prev};
 const formRead=await db.from('checklist_monthly_forms').select('template_version,template_snapshot').eq('period_month',prev).eq('template_id',templateKey).limit(200);
 if(formRead.error)throw formRead.error;
 const form=(formRead.data||[]).find(row=>marketingDepartment(row.template_snapshot?.template?.department||'Marketing'))||(formRead.data||[])[0];
 if(form){const definition=templateDefinition(form.template_snapshot||{});if(Object.keys(definition).length)return {templateVersion:t(form.template_version),definition:cloneJson(definition),sourceType:'previous_form',sourcePeriod:prev};}
 return null;
}
async function resolveMarketingMonthlyKpiSource(period,templateId){
 const templateKey=marketingMonthlyTemplateKey(templateId);
 let config=null;
 const configRead=await db.from('checklist_monthly_kpi_configs').select('*').eq('period_month',period).eq('department','Marketing').eq('template_id',templateId).maybeSingle();
 if(configRead.error)marketingConfigDbError(configRead.error);else config=configRead.data||null;
 const formsRead=await db.from('checklist_monthly_forms').select('id,period_month,department,template_id,template_version,template_snapshot,status,self_answers,self_saved_at,self_submitted_at,updated_at').eq('period_month',period).eq('template_id',templateKey).limit(500);
 if(formsRead.error)throw formsRead.error;
 const forms=(formsRead.data||[]).filter(row=>marketingDepartment(row.department));
 const versions=[...new Set(forms.map(row=>t(row.template_version)).filter(Boolean))];
 if(versions.length>1)fail('Các phiếu cùng mẫu đang dùng nhiều phiên bản khác nhau. Cần Admin kiểm tra trước khi cập nhật.',409,'CHECKLIST_MARKETING_KPI_VERSION_MISMATCH');
 if(config&&config.definition_snapshot&&Object.keys(config.definition_snapshot).length){
  return {config,forms,templateVersion:t(config.template_version),definition:cloneJson(config.definition_snapshot),sourceType:t(config.source_type)||'monthly_override',sourcePeriod:t(config.source_period_month)};
 }
 if(forms.length){
  return {config:null,forms,templateVersion:versions[0],definition:cloneJson(templateDefinition(forms[0].template_snapshot||{})),sourceType:'monthly_form_snapshot',sourcePeriod:''};
 }
 const foundation=await marketingTemplateFoundation(period,templateId),previous=await previousMarketingKpiSource(period,templateId);
 if(previous&&previous.templateVersion===foundation.templateVersion)return {config:null,forms:[],...previous};
 return {config:null,forms:[],...foundation};
}
async function getMarketingMonthlyKpiConfig(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const period=month(input.month||input.period),templateId=t(input.templateId).toLowerCase(),permission=await marketingKpiPermission(session,input.department||'Marketing');
 if(!isMarketingMonthlyTemplate(templateId))fail('Mẫu này không thuộc phạm vi KPI tháng Marketing.',409,'CHECKLIST_MARKETING_KPI_TEMPLATE_FORBIDDEN');
 const source=await resolveMarketingMonthlyKpiSource(period,templateId),forms=source.forms||[],definition=source.definition||{},rows=monthlyRows({template_snapshot:{version:{definition}}});
 if(!rows.length)fail('Mẫu Marketing chưa có tiêu chí để cập nhật.',409,'CHECKLIST_MARKETING_KPI_ROWS_EMPTY');
 const totalWeight=Math.round(rows.reduce((sum,row)=>sum+numeric(row.weight),0)*100)/100,hasSelfData=forms.some(form=>Boolean(form.self_saved_at||form.self_submitted_at)||(form.self_answers&&typeof form.self_answers==='object'&&Object.keys(form.self_answers).length));
 const window=marketingKpiWindowState(period),canEdit=permission.canEdit&&!hasSelfData,canException=false;
 return {period,department:'Marketing',templateId,templateVersion:source.templateVersion,rows,totalWeight,revision:Number(source.config?.revision||0),sourceType:source.sourceType,sourcePeriod:source.sourcePeriod,updatedAt:source.config?.updated_at||'',updatedByName:source.config?.updated_by_name||'',window,hasSelfData,hasMonthlyForms:forms.length>0,canEdit,canException,lockedReason:hasSelfData?'Đã có nhân sự bắt đầu tự đánh giá nên tiêu chí tháng không thể thay đổi.':'',permission:{role:permission.role,presetCode:permission.presetCode},definition};
}
async function saveMarketingMonthlyKpiConfig(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const period=month(input.month||input.period),templateId=t(input.templateId).toLowerCase(),permission=await marketingKpiPermission(session,input.department||'Marketing');
 if(!isMarketingMonthlyTemplate(templateId))fail('Mẫu này không thuộc phạm vi KPI tháng Marketing.',409,'CHECKLIST_MARKETING_KPI_TEMPLATE_FORBIDDEN');
 const exception=false;
 const current=await resolveMarketingMonthlyKpiSource(period,templateId),hasSelfData=(current.forms||[]).some(form=>Boolean(form.self_saved_at||form.self_submitted_at)||(form.self_answers&&typeof form.self_answers==='object'&&Object.keys(form.self_answers).length));
 if(hasSelfData)fail('Đã có nhân viên bắt đầu tự đánh giá nên không thể thay đổi tiêu chí kỳ này.',409,'CHECKLIST_MARKETING_KPI_SELF_STARTED');
 const rows=normalizeMarketingKpiRows(input.rows),total=Math.round(rows.reduce((sum,row)=>sum+row.weight,0)*100)/100;
 if(Math.abs(total-100)>0.001)fail('Tổng tỷ trọng toàn phiếu phải đúng 100%. Hiện tại '+total+'%.',409,'CHECKLIST_MARKETING_KPI_WEIGHT_TOTAL_INVALID');
 const definition=applyMarketingRowsToDefinition(current.definition||{},rows),a=actor(session);
 const saved=await db.rpc('phf_save_marketing_monthly_kpi',{p_period_month:period,p_department:'Marketing',p_template_id:templateId,p_template_version:current.templateVersion,p_definition:definition,p_expected_revision:Number(input.expectedRevision||0),p_is_exception:false,p_reason:'',p_actor_id:a.id,p_actor_code:a.employeeCode,p_actor_name:a.name});
 if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MARKETING_KPI_STALE/i.test(message))fail('Cấu hình KPI vừa được cập nhật ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_MARKETING_KPI_STALE');if(/CHECKLIST_MARKETING_KPI_SELF_STARTED/i.test(message))fail('Đã có nhân viên bắt đầu tự đánh giá nên không thể thay đổi tiêu chí kỳ này.',409,'CHECKLIST_MARKETING_KPI_SELF_STARTED');marketingConfigDbError(saved.error);}
 const result=saved.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể lưu KPI tháng Marketing.',409,t(result.code)||'CHECKLIST_MARKETING_KPI_SAVE_BLOCKED');
 return {saved:true,...await getMarketingMonthlyKpiConfig(session,{period,templateId,department:'Marketing'})};
}
async function listMonthly(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const m=month(input.month||new Date().toISOString().slice(0,7));
 try{await processMonthlySelfOverdue(session,{month:m,manual:false});}catch(autoError){console.warn('[PHF Checklist] auto overdue skipped',autoError&&autoError.message||autoError);}
 const {data:period}=await db.from('checklist_monthly_periods').select('*').eq('period_month',m).maybeSingle();
 const {data,error}=await db.from('checklist_monthly_forms').select('*').eq('period_month',m).order('employee_name');if(error)throw error;
 const forms=data||[],range=periodBounds(m),codes=[...new Set(forms.filter(x=>['draft','waiting_self','waiting_review'].includes(x.status)).map(x=>t(x.employee_code).toUpperCase()).filter(Boolean))],points={};
 if(codes.length){const v=await db.from('checklist_violation_records').select('employee_code,points').in('employee_code',codes).eq('is_test',false).eq('record_status','official').gte('occurred_date',range.start).lte('occurred_date',range.end);if(v.error)throw v.error;(v.data||[]).forEach(x=>{const c=t(x.employee_code).toUpperCase();points[c]=(points[c]||0)+Math.max(0,Number(x.points||0));});}
 const assignments=(await readAllRows('checklist_employee_assignments',['employee_key','updated_at','id'])).filter(x=>t(x.employee_status)!=='Đã nghỉ việc'),byCode=new Map(assignments.map(x=>[t(x.employee_code).toUpperCase(),x])),candidateMap=new Map();
 assignments.forEach(x=>{const code=t(x.employee_code).toUpperCase(),id=t(x.employee_id);if(code||id)candidateMap.set(code||id,{id,code,name:t(x.employee_name)});const mc=t(x.manager_code).toUpperCase(),mi=t(x.manager_id);if(mc||mi)candidateMap.set(mc||mi,{id:mi,code:mc,name:t(x.manager_name)});});
 const histories=await formHistories(forms.map(x=>x.id));
 return {period:period||null,reviewerCandidates:[...candidateMap.values()].filter(x=>x.name).sort((a,b)=>a.name.localeCompare(b.name,'vi')),forms:forms.map(x=>{const current=byCode.get(t(x.employee_code).toUpperCase())||{},score=x.status==='locked'?Number(x.checklist_score||0):Math.max(0,100-(points[t(x.employee_code).toUpperCase()]||0)),live=x.status==='reviewed'?{checklist_review_score:score}:{};return withScoreSummary({...x,...live,history:histories.get(x.id)||[],checklist_score:score,current_reviewer_id:t(current.manager_id),current_reviewer_code:t(current.manager_code).toUpperCase(),current_reviewer_name:t(current.manager_name),reviewer_outdated:Boolean((t(current.manager_id)||t(current.manager_code))&&t(current.manager_id)!==t(x.reviewer_id)&&t(current.manager_code).toUpperCase()!==t(x.reviewer_code).toUpperCase())});})};
}
async function createMonthly(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const m=month(input.month),a=actor(session),{start,end}=periodBounds(m),scorePolicySnapshot=monthlyScorePolicySnapshot(await resolveMonthlyScorePolicyAt(m),m);
 const assignmentState=await assignmentSnapshotsAt(end),people=assignmentState.snapshots.filter(p=>t(p.employee_status)==='Đang làm việc'&&t(p.template_id));
 const {data:violations,error:ve}=await db.from('checklist_violation_records').select('employee_code,points').eq('is_test',false).eq('record_status','official').gte('occurred_date',start).lte('occurred_date',end);if(ve)throw ve;
 const points={};(violations||[]).forEach(x=>{const c=t(x.employee_code).toUpperCase();points[c]=(points[c]||0)+Number(x.points||0);});
 const keys=new Set(people.map(x=>t(x.template_id).toLowerCase()).filter(Boolean));
 const [allTemplates,allVersions]=await Promise.all([readAllRows('checklist_templates',['template_key','updated_at','id']),readAllRows('checklist_template_versions',['template_key','created_at','id'])]);
 const templates=allTemplates.filter(x=>keys.has(t(x.template_key).toLowerCase())),versions=allVersions.filter(x=>keys.has(t(x.template_key).toLowerCase()));
 const prevPeriod=previousPeriod(m),marketingTemplateKeys=[...keys].filter(isMarketingMonthlyTemplate),marketingConfigIds=marketingTemplateKeys.map(marketingMonthlyTemplateId).filter(Boolean),previousMarketingDefinitions=new Map(),currentMarketingDefinitions=new Map();
 if(marketingTemplateKeys.length){
  const [currentConfigResult,configResult,formResult]=await Promise.all([
   db.from('checklist_monthly_kpi_configs').select('period_month,department,template_id,template_version,definition_snapshot').eq('period_month',m).eq('department','Marketing').in('template_id',marketingConfigIds),
   db.from('checklist_monthly_kpi_configs').select('period_month,department,template_id,template_version,definition_snapshot').eq('period_month',prevPeriod).eq('department','Marketing').in('template_id',marketingConfigIds),
   db.from('checklist_monthly_forms').select('department,template_id,template_version,template_snapshot').eq('period_month',prevPeriod).in('template_id',marketingTemplateKeys).limit(500)
  ]);
  if(currentConfigResult.error&&!['42P01','PGRST204','PGRST205'].includes(String(currentConfigResult.error.code))&&!/schema cache|checklist_monthly_kpi_configs/i.test(String(currentConfigResult.error.message||'')))throw currentConfigResult.error;
  (currentConfigResult.data||[]).forEach(row=>{const key=marketingMonthlyTemplateKey(row.template_id);if(key)currentMarketingDefinitions.set(key,{templateVersion:t(row.template_version),definition:row.definition_snapshot||{},sourceType:'current_config',sourcePeriod:m});});
  if(configResult.error&&!['42P01','PGRST204','PGRST205'].includes(String(configResult.error.code))&&!/schema cache|checklist_monthly_kpi_configs/i.test(String(configResult.error.message||'')))throw configResult.error;
  if(formResult.error)throw formResult.error;
  (formResult.data||[]).filter(row=>marketingDepartment(row.department)).forEach(row=>{
   const key=t(row.template_id).toLowerCase();
   if(!previousMarketingDefinitions.has(key))previousMarketingDefinitions.set(key,{templateVersion:t(row.template_version),definition:templateDefinition(row.template_snapshot||{}),sourceType:'previous_form',sourcePeriod:prevPeriod});
  });
  (configResult.data||[]).forEach(row=>{
   const key=marketingMonthlyTemplateKey(row.template_id);
   if(key)previousMarketingDefinitions.set(key,{templateVersion:t(row.template_version),definition:row.definition_snapshot||{},sourceType:'previous_config',sourcePeriod:prevPeriod});
  });
 }
 const missing=[];
 const rows=people.map(p=>{
  const code=t(p.employee_code).toUpperCase(),templateKey=t(p.template_id).toLowerCase(),tm=templates.find(x=>t(x.template_key).toLowerCase()===templateKey)||null;
  const eligibleVersions=versions.filter(x=>t(x.template_key).toLowerCase()===templateKey&&t(x.effective_date)<=end).sort((a,b)=>t(b.effective_date).localeCompare(t(a.effective_date))||t(b.created_at).localeCompare(t(a.created_at)));
  const requestedVersion=t(p.template_version),tv=requestedVersion?eligibleVersions.find(x=>t(x.version_no)===requestedVersion)||null:(eligibleVersions[0]||null),version=t(tv&&tv.version_no);
  if(!tm||!tv){missing.push({employeeCode:code,employeeName:t(p.employee_name),templateId:templateKey,templateVersion:requestedVersion||'(theo ngày hiệu lực)'});}
  let snapshotVersion=tv||{};
  const currentConfigured=currentMarketingDefinitions.get(templateKey),inherited=previousMarketingDefinitions.get(templateKey),selected=currentConfigured&&currentConfigured.templateVersion===version?currentConfigured:(inherited&&inherited.templateVersion===version?inherited:null);
  if(selected&&selected.definition&&Object.keys(selected.definition).length){
   snapshotVersion={...(tv||{}),definition:cloneJson(selected.definition),monthly_source:{type:selected.sourceType,periodMonth:selected.sourcePeriod}};
  }
  return {period_month:m,employee_id:t(p.employee_id),employee_code:code,employee_name:t(p.employee_name),department:t(p.department),title:t(p.title),branch:t(p.branch),reviewer_id:t(p.manager_id),reviewer_code:t(p.manager_code),reviewer_name:t(p.manager_name),template_id:templateKey,template_version:version,template_snapshot:{template:tm||{},version:snapshotVersion},score_policy_snapshot:scorePolicySnapshot,checklist_score:Math.max(0,100-(points[code]||0)),status:'draft'};
 });
 if(missing.length){const first=missing[0];fail('Không thể tạo kỳ vì '+first.employeeCode+' – '+first.employeeName+' đang tham chiếu mẫu '+first.templateId+' phiên bản '+first.templateVersion+' không tồn tại hoặc chưa có hiệu lực đến '+end+'.',409,'CHECKLIST_MONTHLY_TEMPLATE_SNAPSHOT_MISSING');}
 const sourceRevision={...assignmentState.revision,template_count:allTemplates.length,template_max:latestStamp(allTemplates,['updated_at','created_at']),template_version_count:allVersions.length,template_version_max:latestStamp(allVersions,['created_at'])};
 const rpc=await db.rpc('phf_create_checklist_monthly',{p_period_month:m,p_score_policy:scorePolicySnapshot,p_forms:rows,p_source_revision:sourceRevision,p_actor_id:a.id,p_actor_name:a.name});
 if(rpc.error){const message=String(rpc.error.message||'');if(/CHECKLIST_SOURCE_SNAPSHOT_STALE/i.test(message))fail('Phân công hoặc thư viện mẫu vừa thay đổi trong lúc tạo kỳ. Vui lòng tải lại và tạo lại để tránh dùng dữ liệu cũ.',409,'CHECKLIST_SOURCE_SNAPSHOT_STALE');if(/phf_create_checklist_monthly/i.test(message))fail('Chưa chạy SQL ổn định Production cho khởi tạo phiếu tháng.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw rpc.error;}
 const outcome=rpc.data||{};if(outcome.ok!==true)fail(t(outcome.message)||'Không thể khởi tạo kỳ đánh giá.',409,t(outcome.code)||'CHECKLIST_MONTHLY_CREATE_BLOCKED');
 const result=await listMonthly(session,{month:m});return {created:Number(outcome.created||0),skippedExisting:Number(outcome.skipped||0),missingReviewer:(result.forms||[]).filter(x=>!t(x.reviewer_code)&&!t(x.reviewer_id)).length,...result};
}
async function openMonthly(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const m=month(input.month),a=actor(session);const {data,error}=await db.rpc('open_checklist_monthly_period',{p_period_month:m,p_actor_id:a.id,p_actor_name:a.name});if(error)throw error;const result=data||{};if(result.ok!==true)fail(t(result.message)||'Chưa thể mở kỳ đánh giá.',409,t(result.code)||'CHECKLIST_MONTHLY_OPEN_BLOCKED');return {...result,...await listMonthly(session,{month:m})};}
async function lockMonthly(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const m=month(input.month),reason=t(input.reason),a=actor(session);if(reason.length<10)fail('Lý do khóa kỳ cần tối thiểu 10 ký tự.');const {data,error}=await db.rpc('lock_checklist_monthly_period',{p_period_month:m,p_reason:reason,p_actor_id:a.id,p_actor_name:a.name,p_force:input.force===true});if(error)throw error;const result=data||{};if(result.ok!==true)fail(t(result.message)||'Chưa thể khóa kỳ.',409,t(result.code)||'CHECKLIST_MONTHLY_LOCK_BLOCKED');return {...result,...await listMonthly(session,{month:m})};}
async function openMonthlyException(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const id=t(input.formId),reason=t(input.reason),a=actor(session);if(!id)fail('Thiếu mã phiếu cần mở ngoại lệ.');if(reason.length<10)fail('Lý do mở ngoại lệ cần tối thiểu 10 ký tự.');const formCheck=await db.from('checklist_monthly_forms').select('period_month').eq('id',id).maybeSingle();if(formCheck.error)throw formCheck.error;if(!formCheck.data)fail('Không tìm thấy phiếu.',404,'CHECKLIST_MONTHLY_FORM_NOT_FOUND');const policy=(await getMonthlyOverduePolicy(session)).policy;if(formCheck.data.period_month>=policy.effectiveFromPeriod&&policy.adminAfterLock==='disabled')fail('Cấu hình kỳ này không cho phép mở ngoại lệ sau khóa.',409,'CHECKLIST_MONTHLY_EXCEPTION_DISABLED');const {data,error}=await db.rpc('open_checklist_monthly_admin_exception',{p_form_id:id,p_reason:reason,p_actor_id:a.id,p_actor_name:a.name});if(error)throw error;const result=data||{};if(result.ok!==true)fail(t(result.message)||'Chưa thể mở ngoại lệ.',409,t(result.code)||'CHECKLIST_MONTHLY_EXCEPTION_BLOCKED');return {...result,...await listMonthly(session,{month:input.month})};}
async function openMonthlyPilot(session,input={}){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);const m=month(input.month),code=t(input.employeeCode).toUpperCase(),a=actor(session);if(!code)fail('Vui lòng chọn nhân viên mở thử.');const {data,error}=await db.rpc('open_checklist_monthly_pilot',{p_period_month:m,p_employee_code:code,p_actor_id:a.id,p_actor_name:a.name});if(error)throw error;const result=data||{};if(result.ok!==true)fail(t(result.message)||'Chưa thể mở thử phiếu.',409,t(result.code)||'CHECKLIST_MONTHLY_PILOT_BLOCKED');return {...result,...await listMonthly(session,{month:m})};}
async function myMonthlyForm(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const a=actor(session);if(!a.employeeCode&&!a.employeeId)fail('Tài khoản chưa liên kết mã nhân viên.',403,'CHECKLIST_MONTHLY_IDENTITY_REQUIRED');
 let q=db.from('checklist_monthly_forms').select('*').in('status',['waiting_self','waiting_review','reviewed','locked']).order('period_month',{ascending:false}).limit(12);
 q=a.employeeCode?q.eq('employee_code',a.employeeCode):q.eq('employee_id',a.employeeId);if(input.month)q=q.eq('period_month',month(input.month));
 const found=await q;if(found.error)throw found.error;const forms=found.data||[];if(!forms.length)return {form:null,period:null};
 /* Phiếu đã gửi/đã thẩm định/đã khóa hoặc pilot có thể chọn ngay, không cần
    chờ đọc toàn bộ danh sách kỳ. Đây là nhánh phổ biến sau khi hệ thống vận hành. */
 let form=forms.find(f=>['waiting_review','reviewed','locked'].includes(f.status)||f.pilot_opened_at)||null,period=null;
 if(!form){
  const ids=[...new Set(forms.map(x=>x.period_id).filter(Boolean))];
  const pq=await db.from('checklist_monthly_periods').select('*').in('id',ids);if(pq.error)throw pq.error;
  const periods=pq.data||[];
  form=forms.find(f=>{const p=periods.find(x=>x.id===f.period_id);return p&&['open','locked'].includes(p.status);})||null;
  period=form?periods.find(x=>x.id===form.period_id)||null:null;
 }
 if(!form)return {form:null,period:null};
 /* Ba nguồn sau độc lập: kỳ, lịch sử và refresh điểm Checklist. Chạy song song
    để tránh cộng tuần tự độ trễ Supabase. */
 const periodPromise=period?Promise.resolve({data:period,error:null}):db.from('checklist_monthly_periods').select('*').eq('id',form.period_id).maybeSingle();
 const historyPromise=formHistories([form.id]);
 const refreshPromise=refreshUnlockedChecklistScore(form);
 const [periodResult,histories,refreshed]=await Promise.all([periodPromise,historyPromise,refreshPromise]);
 if(periodResult.error)throw periodResult.error;
 return {form:refreshed?withScoreSummary({...refreshed,history:histories.get(refreshed.id)||[]}):null,period:periodResult.data||null};
}
function monthlyRows(form){const d=form?.template_snapshot?.version?.definition||{},rows=Array.isArray(d.totalRows)?d.totalRows:[];return rows.map((r,i)=>Array.isArray(r)?{code:t(r[1])||'ROW-'+(i+1),source:t(r[7]),name:t(r[2]),target:r[3],unit:t(r[4]),weight:numeric(r[5])}:{code:t(r.code)||'ROW-'+(i+1),source:t(r.source),name:t(r.content||r.name),target:r.target,unit:t(r.unit),weight:numeric(r.weight)});}
function manualRows(form){return monthlyRows(form).filter(r=>!isAutomaticSource(r.source,r.name));}
function scoreSummary(form){
 const rows=monthlyRows(form),self=form.self_answers||{},review=form.review_answers||{};let selfTotal=0,reviewTotal=0;
 rows.forEach(r=>{if(isAutomaticSource(r.source,r.name)){selfTotal+=numeric(form.checklist_score)*r.weight/100;reviewTotal+=numeric(form.checklist_review_score==null?form.checklist_score:form.checklist_review_score)*r.weight/100;}else{selfTotal+=numeric(self[r.code]?.value);reviewTotal+=numeric(review[r.code]?.value);}});
 selfTotal=round2(selfTotal);reviewTotal=round2(reviewTotal);const policy=monthlyScorePolicySnapshot(form.score_policy_snapshot,form.period_month),denominator=policy.selfWeight+policy.reviewWeight,finalScore=denominator>0?round2((selfTotal*policy.selfWeight+reviewTotal*policy.reviewWeight)/denominator):0;return {selfTotalScore:selfTotal,reviewTotalScore:reviewTotal,finalScore,policy};
}
function withScoreSummary(form){const s=scoreSummary(form),live=['draft','waiting_self','waiting_review','reviewed'].includes(form.status);return {...form,score_policy_snapshot:form.score_policy_snapshot||s.policy,self_total_score:live?s.selfTotalScore:(form.self_total_score==null?s.selfTotalScore:Number(form.self_total_score)),review_total_score:live?s.reviewTotalScore:(form.review_total_score==null?s.reviewTotalScore:Number(form.review_total_score)),final_score:form.status==='reviewed'?s.finalScore:(form.final_score==null&&form.status==='locked'?s.finalScore:(form.final_score==null?null:Number(form.final_score))),score_summary:s};}
async function saveMyMonthly(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');const a=actor(session),id=t(input.formId);if(!id)fail('Thiếu mã phiếu đánh giá.');
 let q=db.from('checklist_monthly_forms').select('*').eq('id',id);q=a.employeeCode?q.eq('employee_code',a.employeeCode):q.eq('employee_id',a.employeeId||'__none__');const got=await q.maybeSingle();if(got.error)throw got.error;let form=got.data;if(!form)fail('Bạn không có quyền cập nhật phiếu này.',403,'CHECKLIST_MONTHLY_FORM_FORBIDDEN');assertFresh(form,input.expectedUpdatedAt,'CHECKLIST_MONTHLY_SELF_STALE');if(form.status!=='waiting_self')fail('Phiếu không còn ở bước tự đánh giá.',409,'CHECKLIST_MONTHLY_NOT_WAITING_SELF');
 const periodCheck=await db.from('checklist_monthly_periods').select('status').eq('id',form.period_id).maybeSingle();if(periodCheck.error)throw periodCheck.error;if(!form.pilot_opened_at&&!(periodCheck.data&&['open','locked'].includes(periodCheck.data.status)))fail('Phiếu chưa được mở cho tài khoản này.',403,'CHECKLIST_MONTHLY_NOT_OPEN');const breakdown=await checklistBreakdown(form.employee_code,form.period_month);form={...form,checklist_score:breakdown.score,checklist_breakdown:breakdown};const rows=manualRows(form),allowed=new Set(rows.map(r=>r.code)),answers=input.answers&&typeof input.answers==='object'&&!Array.isArray(input.answers)?input.answers:{},clean={};
 Object.keys(answers).slice(0,200).forEach(k=>{if(!allowed.has(t(k)))return;const x=answers[k]||{},v=t(x.value);clean[t(k).slice(0,80)]={value:v.slice(0,100),note:t(x.note).slice(0,1000)};});
 const submit=input.submit===true,missing=rows.filter(r=>!t(clean[r.code]?.value)),invalid=rows.filter(r=>{const n=Number(clean[r.code]?.value);return t(clean[r.code]?.value)&&(!Number.isFinite(n)||n<0);}),over=rows.filter(r=>t(clean[r.code]?.value)&&Number(clean[r.code].value)>r.weight);
 if(invalid.length)fail('Điểm tự đánh giá không hợp lệ tại '+invalid[0].code+' – '+invalid[0].name+'.',409,'CHECKLIST_MONTHLY_SELF_INVALID');if(over.length)fail(over[0].code+' – '+over[0].name+' tối đa '+over[0].weight+' điểm theo trọng số.',409,'CHECKLIST_MONTHLY_SELF_OVER_WEIGHT');if(submit&&missing.length)fail('Còn '+missing.length+' chỉ tiêu chưa nhập điểm. Thiếu: '+missing[0].code+' – '+missing[0].name+'.',409,'CHECKLIST_MONTHLY_SELF_INCOMPLETE');
 const summary=scoreSummary({...form,self_answers:clean}),now=new Date().toISOString(),patch={self_answers:clean,self_note:t(input.note).slice(0,3000),self_total_score:summary.selfTotalScore,self_saved_at:now,updated_at:now};if(submit){patch.status='waiting_review';patch.self_submitted_at=now;}
 const saved=await db.rpc('phf_save_checklist_monthly_self',{p_form_id:form.id,p_patch:patch,p_expected_updated_at:form.updated_at,p_expected_checklist_score:Number(form.checklist_score||0)});if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MONTHLY_SELF_STALE/i.test(message))fail('Phiếu đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_MONTHLY_SELF_STALE');if(/CHECKLIST_MONTHLY_SELF_SCORE_CHANGED/i.test(message))fail('Điểm Checklist vừa thay đổi do có ghi nhận lỗi khác. Vui lòng tải lại phiếu trước khi lưu.',409,'CHECKLIST_MONTHLY_SELF_SCORE_CHANGED');if(/phf_save_checklist_monthly_self/i.test(message))fail('Chưa chạy SQL ổn định Production cho phiếu tự đánh giá.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw saved.error;}const result=saved.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể lưu phiếu.',409,t(result.code)||'CHECKLIST_MONTHLY_SELF_BLOCKED');return {saved:true,submitted:submit,form:withScoreSummary({...result.form,checklist_breakdown:breakdown})};
}
async function monthlyReviewAccessContext(session){
 const a=actor(session);if(!a.employeeCode&&!a.employeeId)fail('Tài khoản chưa liên kết mã nhân viên.',403,'CHECKLIST_MONTHLY_IDENTITY_REQUIRED');
 const access=await getChecklistMonthlyReviewAccess(session),assistantSelfReview=access.grant?.presetCode==='TRO_LY_GD';
 return {a,access,assistantSelfReview,allowedIds:new Set((access.people||[]).map(x=>t(x.employeeId)).filter(Boolean)),allowedCodes:new Set((access.people||[]).map(x=>t(x.employeeCode).toUpperCase()).filter(Boolean))};
}
function monthlyReviewVisible(session,context,form){
 if(form.admin_exception_open&&form.status==='waiting_review')return false;
 if(session?.role==='admin')return true;
 const {a,assistantSelfReview,allowedIds,allowedCodes}=context,isOwn=(a.employeeId&&t(form.employee_id)===a.employeeId)||(a.employeeCode&&t(form.employee_code).toUpperCase()===a.employeeCode);
 if(isOwn&&!assistantSelfReview)return false;
 return allowedIds.has(t(form.employee_id))||allowedCodes.has(t(form.employee_code).toUpperCase());
}
const MONTHLY_REVIEW_SUMMARY_FIELDS='id,period_id,period_month,employee_id,employee_code,employee_name,department,title,branch,reviewer_id,reviewer_code,reviewer_name,status,checklist_score,checklist_review_score,self_total_score,review_total_score,final_score,self_submitted_at,review_submitted_at,reviewed_by,reviewed_by_code,reviewed_by_name,updated_at,admin_exception_open,pilot_opened_at';
async function monthlyReviewWindows(periodMonths){
 const periods=[...new Set((periodMonths||[]).map(month).filter(Boolean))];
 if(!periods.length)return new Map();
 const policyRequest=db.from('checklist_system_settings').select('setting_value').eq('setting_key',MONTHLY_CYCLE_SETTING_KEY).maybeSingle();
 const overrideRequest=db.from('checklist_monthly_period_overrides').select('period_month,self_start_day,self_end_day,review_start_day,review_end_day,lock_day,lock_time,reason').in('period_month',periods);
 const [policyResult,overrideResult]=await Promise.all([policyRequest,overrideRequest]);
 if(policyResult.error)monthlyCycleDbError(policyResult.error,'tải cấu hình chu kỳ thẩm định');
 if(overrideResult.error&&String(overrideResult.error.code)!=='42P01')monthlyCycleDbError(overrideResult.error,'tải ngoại lệ chu kỳ thẩm định');
 const policy=parseMonthlyCyclePolicy(policyResult.data&&policyResult.data.setting_value),overrides=new Map((overrideResult.data||[]).map(row=>[month(row.period_month),row])),windows=new Map();
 periods.forEach(period=>windows.set(period,resolveMonthlyCycleWindowSync(period,policy,overrides.get(period)||null)));
 return windows;
}
function resolveMonthlyCycleWindowSync(periodMonth,policy,override){
 const pick=(key,base)=>override&&override[key]!=null?override[key]:base;
 return {periodMonth:month(periodMonth),selfOpenAt:periodDateTime(periodMonth,pick('self_start_day',policy.selfStartDay),'00:00'),selfDueAt:periodDateTime(periodMonth,pick('self_end_day',policy.selfEndDay),'23:59'),reviewOpenAt:periodDateTime(periodMonth,pick('review_start_day',policy.reviewStartDay),'00:00'),reviewDueAt:periodDateTime(periodMonth,pick('review_end_day',policy.reviewEndDay),'23:59'),lockAt:periodDateTime(periodMonth,pick('lock_day',policy.lockDay),pick('lock_time',policy.lockTime)),isOverride:Boolean(override),overrideReason:t(override&&override.reason)};
}
async function myMonthlyReviewSummaries(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 let query=db.from('checklist_monthly_forms').select(MONTHLY_REVIEW_SUMMARY_FIELDS).in('status',['draft','waiting_self','waiting_review','reviewed','locked']).order('period_month',{ascending:false}).order('self_submitted_at',{ascending:true}).limit(500);
 if(input.month)query=query.eq('period_month',month(input.month));
 /* Quyền và danh sách phiếu là hai nguồn độc lập. Đọc song song để tránh cộng
    nối tiếp thời gian của Supabase; dữ liệu chỉ được trả sau khi lọc lại bằng
    capability/scope ở server. */
 const [context,result]=await Promise.all([monthlyReviewAccessContext(session),query]);
 if(result.error)throw result.error;if(session?.role!=='admin'&&!context.access.canReview)return {forms:[],summaryMode:true};
 const unique=new Map((result.data||[]).filter(form=>monthlyReviewVisible(session,context,form)).map(x=>[x.id,x])),rawForms=[...unique.values()];
 /* Cấu hình chu kỳ và toàn bộ ngoại lệ tháng được đọc theo lô, song song.
    Trước đây mỗi tháng phát sinh hai lượt Supabase nối tiếp. */
 const windows=await monthlyReviewWindows(rawForms.map(form=>form.period_month));
 const forms=rawForms.map(form=>{const window=windows.get(month(form.period_month))||resolveMonthlyCycleWindowSync(form.period_month,defaultMonthlyCyclePolicy(),null);return {...form,view_only_current_manager:false,review_window:reviewWindowState(window,form),is_summary:true};});
 return {forms,summaryMode:true};
}
async function myMonthlyReviewDetail(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');const id=t(input.formId);if(!id)fail('Thiếu mã phiếu cần xem.',400,'CHECKLIST_MONTHLY_REVIEW_ID_REQUIRED');
 const context=await monthlyReviewAccessContext(session);if(session?.role!=='admin'&&!context.access.canReview)fail('Không có quyền xem phiếu thẩm định.',403,'CHECKLIST_MONTHLY_REVIEW_FORBIDDEN');
 const got=await db.from('checklist_monthly_forms').select('*').eq('id',id).maybeSingle();if(got.error)throw got.error;if(!got.data)fail('Không tìm thấy phiếu cần xem.',404,'CHECKLIST_MONTHLY_REVIEW_NOT_FOUND');
 if(!monthlyReviewVisible(session,context,got.data))fail('Phiếu không còn thuộc phạm vi được cấp.',403,'CHECKLIST_MONTHLY_REVIEW_SCOPE_REVOKED');
 const refreshed=await refreshUnlockedChecklistScore(got.data),histories=await formHistories([id]),window=await resolveMonthlyCycleWindow(refreshed.period_month);
 return {form:withScoreSummary({...refreshed,history:histories.get(id)||[],view_only_current_manager:false,review_window:reviewWindowState(window,refreshed),is_summary:false})};
}
async function myMonthlyReviews(session,input={}){return input&&input.summary===true?myMonthlyReviewSummaries(session,input):myMonthlyReviewSummaries(session,input);}
async function saveMonthlyReview(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');const a=actor(session),id=t(input.formId);if(!id)fail('Thiếu mã phiếu thẩm định.');
 const got=await db.from('checklist_monthly_forms').select('*').eq('id',id).maybeSingle();if(got.error)throw got.error;let form=got.data;if(!form)fail('Không tìm thấy phiếu cần thẩm định.',404,'CHECKLIST_MONTHLY_REVIEW_NOT_FOUND');assertFresh(form,input.expectedUpdatedAt,'CHECKLIST_MONTHLY_REVIEW_STALE');
 const assigned=(a.employeeCode&&t(form.reviewer_code).toUpperCase()===a.employeeCode)||(a.employeeId&&t(form.reviewer_id)===a.employeeId),adminOverride=session?.role==='admin'&&!assigned,overrideReason=t(input.overrideReason).slice(0,2000);
 const adminException=Boolean(form.admin_exception_open);
 if(adminException&&session?.role!=='admin')fail('Phiếu đang được Admin xử lý ngoại lệ sau khóa.',403,'CHECKLIST_MONTHLY_ADMIN_EXCEPTION_ONLY');
 if(session?.role!=='admin'){
  const access=await getChecklistMonthlyReviewAccess(session),isOwn=(a.employeeId&&t(form.employee_id)===a.employeeId)||(a.employeeCode&&t(form.employee_code).toUpperCase()===a.employeeCode),assistantSelfReview=access.grant?.presetCode==='TRO_LY_GD',allowed=(access.people||[]).some(person=>(t(form.employee_id)&&t(person.employeeId)===t(form.employee_id))||(t(form.employee_code)&&t(person.employeeCode).toUpperCase()===t(form.employee_code).toUpperCase()));
  if(isOwn&&!assistantSelfReview)fail('Không được tự thẩm định phiếu của chính mình.',403,'CHECKLIST_MONTHLY_SELF_REVIEW_FORBIDDEN');
  if(!access.canReview||!allowed)fail('Quyền thẩm định đã thay đổi hoặc nhân viên không còn thuộc phạm vi Admin cấp.',403,'CHECKLIST_MONTHLY_REVIEW_SCOPE_REVOKED');
 }
 if(adminOverride&&overrideReason.length<10)fail('Admin thẩm định thay cần ghi lý do tối thiểu 10 ký tự.',409,'CHECKLIST_MONTHLY_ADMIN_REVIEW_REASON_REQUIRED');
 if(form.status!=='waiting_review')fail('Phiếu không còn ở bước chờ thẩm định.',409,'CHECKLIST_MONTHLY_NOT_WAITING_REVIEW');const reviewWindow=reviewWindowState(await resolveMonthlyCycleWindow(form.period_month),form);if(!reviewWindow.canReview)fail(reviewWindow.label+'. Thời gian: '+reviewWindow.reviewOpenAt+' đến '+reviewWindow.reviewDueAt+'.',409,'CHECKLIST_MONTHLY_REVIEW_WINDOW_CLOSED');
 const breakdown=await checklistBreakdown(form.employee_code,form.period_month);form={...form,checklist_score:breakdown.score,checklist_breakdown:breakdown};const rows=monthlyRows(form),allowed=new Set(rows.map(r=>r.code)),answers=input.answers&&typeof input.answers==='object'&&!Array.isArray(input.answers)?input.answers:{},clean={};
 Object.keys(answers).slice(0,200).forEach(k=>{if(!allowed.has(t(k)))return;const x=answers[k]||{},v=t(x.value);clean[t(k).slice(0,80)]={value:v.slice(0,100),note:t(x.note).slice(0,1000)};});
 const checklistScore=Number(input.checklistScore),reason=t(input.checklistReason).slice(0,2000),submit=input.submit===true;if(!Number.isFinite(checklistScore)||checklistScore<0||checklistScore>100)fail('Điểm Checklist thẩm định phải từ 0 đến 100.',409,'CHECKLIST_MONTHLY_REVIEW_SCORE_INVALID');if(Math.abs(checklistScore-Number(form.checklist_score||0))>0.001&&reason.length<10)fail('Khi điều chỉnh điểm Checklist, lý do cần tối thiểu 10 ký tự.',409,'CHECKLIST_MONTHLY_REVIEW_REASON_REQUIRED');
 const manual=manualRows(form),missing=manual.filter(r=>!t(clean[r.code]?.value)),invalid=manual.filter(r=>{const n=Number(clean[r.code]?.value);return t(clean[r.code]?.value)&&(!Number.isFinite(n)||n<0);}),over=manual.filter(r=>t(clean[r.code]?.value)&&Number(clean[r.code].value)>r.weight);
 if(invalid.length)fail('Điểm thẩm định không hợp lệ tại '+invalid[0].code+' – '+invalid[0].name+'.',409,'CHECKLIST_MONTHLY_REVIEW_INVALID');if(over.length)fail(over[0].code+' – '+over[0].name+' tối đa '+over[0].weight+' điểm theo trọng số.',409,'CHECKLIST_MONTHLY_REVIEW_OVER_WEIGHT');if(submit&&missing.length)fail('Còn '+missing.length+' chỉ tiêu chưa có điểm thẩm định. Thiếu: '+missing[0].code+' – '+missing[0].name+'.',409,'CHECKLIST_MONTHLY_REVIEW_INCOMPLETE');
 const summary=scoreSummary({...form,review_answers:clean,checklist_review_score:checklistScore}),now=new Date().toISOString(),patch={review_answers:clean,review_note:t(input.note).slice(0,3000),checklist_review_score:checklistScore,checklist_review_reason:reason,review_total_score:summary.reviewTotalScore,review_saved_at:now,reviewed_by:a.id,reviewed_by_code:a.employeeCode,reviewed_by_name:a.name,reviewed_as_override:adminOverride||adminException,review_override_reason:(adminOverride||adminException)?overrideReason:'',updated_at:now};if(submit){patch.status=adminException?'locked':'reviewed';patch.review_submitted_at=now;patch.self_total_score=summary.selfTotalScore;patch.final_score=summary.finalScore;patch.score_calculated_at=now;if(adminException)patch.admin_exception_open=false;}
 const saved=await db.rpc('phf_save_checklist_monthly_review',{p_form_id:form.id,p_patch:patch,p_expected_updated_at:form.updated_at,p_expected_checklist_score:Number(form.checklist_score||0)});
 if(saved.error){const message=String(saved.error.message||'');if(/CHECKLIST_MONTHLY_REVIEW_STALE/i.test(message))fail('Phiếu đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_MONTHLY_REVIEW_STALE');if(/CHECKLIST_MONTHLY_REVIEW_SCORE_CHANGED/i.test(message))fail('Điểm Checklist vừa thay đổi do có ghi nhận lỗi khác. Vui lòng tải lại phiếu trước khi hoàn tất thẩm định.',409,'CHECKLIST_MONTHLY_REVIEW_SCORE_CHANGED');if(/phf_save_checklist_monthly_review/i.test(message))fail('Chưa chạy SQL ổn định Production cho thẩm định phiếu tháng.',503,'CHECKLIST_MONTHLY_STABILITY_SQL_MISSING');throw saved.error;}
 const result=saved.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể lưu thẩm định.',409,t(result.code)||'CHECKLIST_MONTHLY_REVIEW_BLOCKED');
 return {saved:true,submitted:submit,adminOverride,form:withScoreSummary({...result.form,checklist_breakdown:form.checklist_breakdown})};
}
async function changeMonthlyReviewer(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');admin(session);
 const id=t(input.formId),reviewerId=t(input.reviewerId),reviewerCode=t(input.reviewerCode).toUpperCase(),reviewerName=t(input.reviewerName),reason=t(input.reason);
 if(!id)fail('Thiếu mã phiếu cần đổi người thẩm định.');if(!reviewerId&&!reviewerCode)fail('Vui lòng chọn người thẩm định mới.');if(!reviewerName)fail('Người thẩm định mới chưa có họ tên.');if(reason.length<10)fail('Lý do thay đổi cần tối thiểu 10 ký tự.');
 const got=await db.from('checklist_monthly_forms').select('*').eq('id',id).maybeSingle();if(got.error)throw got.error;const form=got.data;if(!form)fail('Không tìm thấy phiếu cần cập nhật.',404,'CHECKLIST_MONTHLY_FORM_NOT_FOUND');
 if(!['draft','waiting_self','waiting_review'].includes(form.status))fail('Chỉ được đổi người thẩm định trước khi hoàn tất thẩm định.',409,'CHECKLIST_MONTHLY_REVIEWER_LOCKED');
 if(t(form.reviewer_id)===reviewerId&&t(form.reviewer_code).toUpperCase()===reviewerCode)return {changed:false,form,message:'Phiếu đã dùng đúng người thẩm định này.'};
 const people=await db.from('checklist_employee_assignments').select('employee_id,employee_code,employee_name,manager_id,manager_code,manager_name').limit(1000);if(people.error)throw people.error;
 const canonical=(people.data||[]).map(x=>[{id:t(x.employee_id),code:t(x.employee_code).toUpperCase(),name:t(x.employee_name)},{id:t(x.manager_id),code:t(x.manager_code).toUpperCase(),name:t(x.manager_name)}]).flat().find(x=>(reviewerId&&x.id===reviewerId)||(reviewerCode&&x.code===reviewerCode));
 if(!canonical||!canonical.name)fail('Người thẩm định mới không còn tồn tại trong dữ liệu nhân sự.',409,'CHECKLIST_MONTHLY_REVIEWER_NOT_FOUND');
 const a=actor(session),rpc=await db.rpc('change_checklist_monthly_reviewer',{p_form_id:id,p_reviewer_id:canonical.id,p_reviewer_code:canonical.code,p_reviewer_name:canonical.name,p_reason:reason,p_actor_id:a.id,p_actor_code:a.employeeCode,p_actor_name:a.name});if(rpc.error)throw rpc.error;
 const result=rpc.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể đổi người thẩm định.',409,t(result.code)||'CHECKLIST_MONTHLY_REVIEWER_CHANGE_BLOCKED');
 const saved=await db.from('checklist_monthly_forms').select('*').eq('id',id).single();if(saved.error)throw saved.error;
 return {changed:true,form:saved.data,before:result.before,after:result.after};
}
function exportStatus(value){
 const aliases={all:'',draft:'draft',self:'waiting_self',review:'waiting_review',reviewed:'reviewed',locked:'locked',waiting_self:'waiting_self',waiting_review:'waiting_review'};
 return Object.prototype.hasOwnProperty.call(aliases,t(value))?aliases[t(value)]:'';
}
async function exportMonthlyData(session,input={}){
 if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const m=month(input.month),access=await getChecklistExportAccess(session),allowedCodes=new Set((access.people||[]).map(x=>t(x.employeeCode).toUpperCase()).filter(Boolean));
 if(access.role!=='admin'&&!allowedCodes.size)return {month:m,forms:[],criteria:[],scope:{role:access.role,grant:access.grant||null,count:0},filters:{status:'',branch:'',query:''},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};
 let query=db.from('checklist_monthly_forms').select('*').eq('period_month',m).order('employee_name',{ascending:true}).limit(1000);
 if(access.role!=='admin')query=query.in('employee_code',[...allowedCodes]);
 const result=await query;if(result.error)throw result.error;
 const status=exportStatus(input.status),branch=t(input.branch),search=normalizedSource(input.query),range=periodBounds(m);
 const scopedForms=(result.data||[]).filter(form=>{
  if(status&&form.status!==status)return false;
  if(branch&&normalizeMatch(branch)!==normalizeMatch(form.branch))return false;
  if(search&&!normalizedSource([form.employee_name,form.employee_code,form.department,form.title,form.branch,form.reviewer_name,form.template_id,form.template_version].join(' ')).includes(search))return false;
  return true;
 });
 const activeCodes=[...new Set(scopedForms.filter(x=>x.status!=='locked').map(x=>t(x.employee_code).toUpperCase()).filter(Boolean))],points={};
 if(activeCodes.length){
  const violations=await db.from('checklist_violation_records').select('employee_code,points').in('employee_code',activeCodes).eq('is_test',false).eq('record_status','official').gte('occurred_date',range.start).lte('occurred_date',range.end);
  if(violations.error)throw violations.error;
  (violations.data||[]).forEach(x=>{const code=t(x.employee_code).toUpperCase();points[code]=(points[code]||0)+Math.max(0,Number(x.points||0));});
 }
 const filtered=scopedForms.map(form=>withScoreSummary({...form,checklist_score:form.status==='locked'?Number(form.checklist_score||0):Math.max(0,100-(points[t(form.employee_code).toUpperCase()]||0)),checklist_review_score:form.status==='reviewed'?Math.max(0,100-(points[t(form.employee_code).toUpperCase()]||0)):form.checklist_review_score}));
 const histories=await formHistories(filtered.map(x=>x.id)),criteria=[];
 const publicForms=filtered.map(form=>{
  const rows=monthlyRows(form),self=form.self_answers||{},review=form.review_answers||{},history=histories.get(form.id)||[];
  rows.forEach(row=>{const automatic=isAutomaticSource(row.source,row.name),selfAnswer=self[row.code]||{},reviewAnswer=review[row.code]||{};criteria.push({formId:form.id,periodMonth:form.period_month,employeeCode:form.employee_code,employeeName:form.employee_name,department:form.department,title:form.title,branch:form.branch,criterionCode:row.code,criterionName:row.name,target:row.target,unit:row.unit,weight:row.weight,source:row.source,selfScore:automatic?Number(form.checklist_score||0):numeric(selfAnswer.value),reviewScore:automatic?Number(form.checklist_review_score==null?form.checklist_score:form.checklist_review_score):numeric(reviewAnswer.value),selfNote:t(selfAnswer.note),reviewNote:automatic?t(form.checklist_review_reason):t(reviewAnswer.note)});});
  const exceptionEvents=history.filter(x=>['open_admin_exception','complete_admin_exception'].includes(x.action));
  const lastException=exceptionEvents.length?exceptionEvents[exceptionEvents.length-1]:null;
  const openedException=exceptionEvents.find(x=>x.action==='open_admin_exception')||null;
  const completedException=exceptionEvents.slice().reverse().find(x=>x.action==='complete_admin_exception')||null;
  return {id:form.id,periodMonth:form.period_month,employeeCode:form.employee_code,employeeName:form.employee_name,department:form.department,title:form.title,branch:form.branch,templateId:form.template_id,templateVersion:form.template_version,reviewerCode:form.reviewer_code,reviewerName:form.reviewer_name,checklistScore:Number(form.checklist_score||0),checklistReviewScore:Number(form.checklist_review_score==null?form.checklist_score:form.checklist_review_score),selfTotalScore:Number(form.self_total_score||0),reviewTotalScore:Number(form.review_total_score||0),finalScore:form.final_score==null?null:Number(form.final_score),status:form.status,selfSubmittedAt:form.self_submitted_at||'',reviewedByName:form.reviewed_by_name||'',reviewSubmittedAt:form.review_submitted_at||'',reviewedAsOverride:form.reviewed_as_override===true,reviewOverrideReason:t(form.review_override_reason),adminException:exceptionEvents.length>0||form.admin_exception_open===true,exceptionReason:t(lastException&&lastException.reason),exceptionOpenedBy:t(openedException&&openedException.changed_by_name),exceptionCompletedAt:t(completedException&&completedException.changed_at),historyCount:history.length};
 });
 return {month:m,forms:publicForms,criteria,scope:{role:access.role,grant:access.grant||null,count:(access.people||[]).length},filters:{status,branch,query:t(input.query)},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};
}
function normalizeMatch(value){return t(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
module.exports={getMarketingMonthlyKpiConfig,saveMarketingMonthlyKpiConfig,listMonthly,createMonthly,openMonthly,lockMonthly,openMonthlyException,openMonthlyPilot,myMonthlyForm,saveMyMonthly,myMonthlyReviews,myMonthlyReviewSummaries,myMonthlyReviewDetail,saveMonthlyReview,changeMonthlyReviewer,exportMonthlyData,getMonthlyOverduePolicy,saveMonthlyOverduePolicy,processMonthlySelfOverdue,getChecklistMonthlyScorePolicy,saveChecklistMonthlyScorePolicy,getMonthlyCyclePolicy,saveMonthlyCyclePolicy,saveMonthlyCycleOverride,syncMonthlyCycle,resolveMonthlyCycleWindow,reconcileMissingMonthlyReviewers};
