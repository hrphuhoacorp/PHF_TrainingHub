'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { getChecklistReportAccess } = require('./checklist-permissions');
const { calculateMonthlyScore } = require('./checklist-score-engine');
const { classifyViolationWorkflowStatus, resolveViolationPermission, permissionEmployees } = require('./checklist-violations');
const { operationTimingPolicy } = require('./checklist-tasks');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;

function t(value){return String(value==null?'':value).trim();}
function fail(message,statusCode=400,code='CHECKLIST_REPORT_INVALID'){const error=new Error(message);error.statusCode=statusCode;error.code=code;throw error;}
function month(value){const result=t(value);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result))fail('Kỳ báo cáo không hợp lệ.',400,'CHECKLIST_REPORT_PERIOD_INVALID');return result;}
function shiftMonth(value,delta){const parts=month(value).split('-').map(Number),cursor=new Date(Date.UTC(parts[0],parts[1]-1+Number(delta||0),1));return String(cursor.getUTCFullYear()).padStart(4,'0')+'-'+String(cursor.getUTCMonth()+1).padStart(2,'0');}
function periodBounds(value){const start=month(value)+'-01',next=shiftMonth(value,1)+'-01';return {start,next};}
function number(value,fallback=0){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
function round(value){return Math.round(number(value)*100)/100;}
function average(values){const valid=(values||[]).map(Number).filter(Number.isFinite);return valid.length?round(valid.reduce((sum,item)=>sum+item,0)/valid.length):0;}
function actor(session){return {name:t(session?.account?.name||session?.account?.email||session?.email),employeeCode:t(session?.employeeCode||session?.account?.employeeCode).toUpperCase()};}
function publicGrant(grant){return grant?{presetCode:grant.presetCode||'',viewScope:grant.viewScope||{type:'none',values:[]},employeeCode:grant.employeeCode||'',employeeName:grant.employeeName||''}:null;}

async function readRepeatPolicy(period){
  const fallback={effectiveFromPeriod:'2026-08',monthlyWarningCount:2,trainingOccurrenceCount:3,trainingWindowMonths:3,source:'default'};
  try{
    const result=await db.from('checklist_repeat_violation_policies').select('*').eq('is_active',true).lte('effective_from_period',period).order('effective_from_period',{ascending:false}).limit(1).maybeSingle();
    if(result.error)throw result.error;
    const row=result.data;if(!row)return fallback;
    return {effectiveFromPeriod:t(row.effective_from_period)||fallback.effectiveFromPeriod,monthlyWarningCount:Math.max(2,Math.round(number(row.monthly_warning_count,fallback.monthlyWarningCount))),trainingOccurrenceCount:Math.max(2,Math.round(number(row.training_occurrence_count,fallback.trainingOccurrenceCount))),trainingWindowMonths:Math.min(12,Math.max(1,Math.round(number(row.training_window_months,fallback.trainingWindowMonths)))),source:'database'};
  }catch(error){console.warn('[PHF Checklist] Báo cáo chưa đọc được ngưỡng lỗi lặp:',error&&error.message||error);return fallback;}
}

function historyMap(rows){const result=new Map();for(const row of rows||[]){if(!result.has(row.form_id))result.set(row.form_id,[]);result.get(row.form_id).push(row);}return result;}
function pointMap(rows){const result={};for(const row of rows||[]){const code=t(row.employee_code).toUpperCase();if(code)result[code]=(result[code]||0)+Math.max(0,number(row.points));}return result;}
function normalizedSource(value){return t(value).toLocaleLowerCase('vi-VN');}
function automaticCriterion(source,name=''){const s=normalizedSource(source),n=normalizedSource(name);return s==='checklist'||s==='hệ thống'||s==='he thong'||n.includes('tuân thủ tiêu chuẩn công việc')||n.includes('tuan thu tieu chuan cong viec');}
function reportRows(form){const definition=form&&form.template_snapshot&&form.template_snapshot.version&&form.template_snapshot.version.definition||{},rows=Array.isArray(definition.totalRows)?definition.totalRows:[];return rows.map((row,index)=>Array.isArray(row)?{code:t(row[1])||'ROW-'+(index+1),name:t(row[2]),source:t(row[7]),target:number(String(row[3]==null?'':row[3]).replace('%','').replace(',','.')),weight:number(String(row[5]==null?'':row[5]).replace('%','').replace(',','.'))}:{code:t(row.code)||'ROW-'+(index+1),name:t(row.content||row.name),source:t(row.source),target:number(String(row.target==null?'':row.target).replace('%','').replace(',','.')),weight:number(String(row.weight==null?'':row.weight).replace('%','').replace(',','.'))});}
function reportScoreSummary(form,checklistScore){const rows=reportRows(form),self=form.self_answers||{},review=form.review_answers||{},selfActual={},reviewActual={},reviewChecklist=number(form.checklist_review_score,checklistScore);for(const row of rows){const automatic=automaticCriterion(row.source,row.name);selfActual[row.code]=automatic?number(checklistScore):number(self[row.code]&&self[row.code].value);reviewActual[row.code]=automatic?reviewChecklist:number(review[row.code]&&review[row.code].value);}return calculateMonthlyScore({criteria:rows,selfActualByCode:selfActual,reviewActualByCode:reviewActual});}
function repeatSuggestions(rows,policy,selectedPeriod,peopleByCode){
  const groups=new Map();
  for(const row of rows||[]){
    const employeeCode=t(row.employee_code).toUpperCase(),criterionCode=t(row.criterion_code).toUpperCase();if(!employeeCode||!criterionCode)continue;
    const key=employeeCode+'|'+criterionCode;
    if(!groups.has(key))groups.set(key,{employeeCode,employeeName:t(row.employee_name),criterionCode,criterionName:t(row.criterion_name),monthlyCount:0,windowCount:0,activeMonths:new Set(),latestDate:'',totalPoints:0});
    const item=groups.get(key),occurred=t(row.occurred_date),occurredPeriod=occurred.slice(0,7);item.windowCount+=1;if(occurredPeriod===selectedPeriod)item.monthlyCount+=1;item.activeMonths.add(occurredPeriod);if(!item.latestDate||occurred>item.latestDate)item.latestDate=occurred;item.totalPoints+=number(row.points);
  }
  const suggestions=[];
  for(const item of groups.values()){
    const warning=item.monthlyCount>=policy.monthlyWarningCount,trainingSuggested=item.windowCount>=policy.trainingOccurrenceCount;if(!warning&&!trainingSuggested)continue;
    const person=peopleByCode.get(item.employeeCode)||{};
    suggestions.push({employeeCode:item.employeeCode,employeeName:item.employeeName||person.employeeName||'',department:person.department||'',branch:person.branch||'',criterionCode:item.criterionCode,criterionName:item.criterionName,monthlyCount:item.monthlyCount,windowCount:item.windowCount,activeMonths:item.activeMonths.size,latestDate:item.latestDate,totalPoints:round(item.totalPoints),warning,trainingSuggested,suggestion:trainingSuggested?'Gợi ý Admin xem xét nhắc lại nghiệp vụ hoặc đào tạo.':'Cảnh báo lỗi lặp trong kỳ để quản lý theo dõi.'});
  }
  return suggestions.sort((a,b)=>Number(b.trainingSuggested)-Number(a.trainingSuggested)||b.windowCount-a.windowCount||b.monthlyCount-a.monthlyCount||a.employeeName.localeCompare(b.employeeName,'vi')).slice(0,200);
}

async function getChecklistMonthlyReport(session,input={}){
  if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
  const access=await getChecklistReportAccess(session),periodRead=await db.from('checklist_monthly_periods').select('period_month,status').order('period_month',{ascending:false}).limit(24);if(periodRead.error)throw periodRead.error;
  const periods=(periodRead.data||[]).map(row=>({month:t(row.period_month),status:t(row.status)})).filter(row=>/^\d{4}-\d{2}$/.test(row.month));
  const selectedMonth=input.month?month(input.month):(periods[0]?.month||new Date().toISOString().slice(0,7));
  if(!periods.some(row=>row.month===selectedMonth))periods.unshift({month:selectedMonth,status:''});
  const allowedCodes=new Set((access.people||[]).map(row=>t(row.employeeCode).toUpperCase()).filter(Boolean)),isAdmin=access.role==='admin';
  if(!isAdmin&&!allowedCodes.size)return {month:selectedMonth,periods,forms:[],violations:[],trend:[],repeatSuggestions:[],repeatPolicy:await readRepeatPolicy(selectedMonth),scope:{role:access.role,grant:publicGrant(access.grant),count:0,canExport:access.canExport===true},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};

  let formsQuery=db.from('checklist_monthly_forms').select('*').eq('period_month',selectedMonth).order('employee_name',{ascending:true}).limit(1000);if(!isAdmin)formsQuery=formsQuery.in('employee_code',[...allowedCodes]);
  const currentBounds=periodBounds(selectedMonth),violationsQuery=(()=>{let q=db.from('checklist_violation_records').select('id,employee_code,employee_name,criterion_code,criterion_name,criterion_group,points,occurred_date').eq('is_test',false).eq('record_status','official').gte('occurred_date',currentBounds.start).lt('occurred_date',currentBounds.next).order('occurred_date',{ascending:true}).limit(5000);if(!isAdmin)q=q.in('employee_code',[...allowedCodes]);return q;})();
  const trendMonths=[shiftMonth(selectedMonth,-2),shiftMonth(selectedMonth,-1),selectedMonth];let trendQuery=db.from('checklist_monthly_forms').select('period_month,employee_code,department,branch,final_score,status').in('period_month',trendMonths).limit(3000);if(!isAdmin)trendQuery=trendQuery.in('employee_code',[...allowedCodes]);
  const [formsRead,violationsRead,trendRead]=await Promise.all([formsQuery,violationsQuery,trendQuery]);if(formsRead.error)throw formsRead.error;if(violationsRead.error)throw violationsRead.error;if(trendRead.error)throw trendRead.error;
  const rawForms=formsRead.data||[],formIds=rawForms.map(row=>row.id).filter(Boolean);let histories=[];if(formIds.length){const read=await db.from('checklist_monthly_form_history').select('form_id,action,after_data,reason,changed_by_name,changed_at').in('form_id',formIds).order('changed_at',{ascending:true}).limit(5000);if(read.error)throw read.error;histories=read.data||[];}
  const historiesByForm=historyMap(histories),pointsByEmployee=pointMap(violationsRead.data||[]);
  const forms=rawForms.map(form=>{
    const code=t(form.employee_code).toUpperCase(),history=historiesByForm.get(form.id)||[],overdueEvent=history.slice().reverse().find(row=>row.action==='apply_self_overdue_policy'),exceptionEvents=history.filter(row=>['open_admin_exception','complete_admin_exception'].includes(row.action)),lastException=exceptionEvents.length?exceptionEvents[exceptionEvents.length-1]:null,locked=['reviewed','locked'].includes(form.status),checklistScore=locked?number(form.checklist_score):Math.max(0,100-(pointsByEmployee[code]||0)),dynamic=locked?null:reportScoreSummary(form,checklistScore);
    return {id:form.id,periodMonth:t(form.period_month),employeeCode:code,employeeName:t(form.employee_name),department:t(form.department),title:t(form.title),branch:t(form.branch),reviewerCode:t(form.reviewer_code).toUpperCase(),reviewerName:t(form.reviewer_name),templateId:t(form.template_id),templateVersion:t(form.template_version),checklistScore:round(checklistScore),checklistReviewScore:round(form.checklist_review_score==null?checklistScore:form.checklist_review_score),selfTotalScore:dynamic?dynamic.selfTotalScore:round(form.self_total_score),reviewTotalScore:dynamic?dynamic.reviewTotalScore:round(form.review_total_score),finalScore:form.final_score==null?null:round(form.final_score),formulaVersion:t(form.score_formula_version)||(dynamic&&dynamic.formulaVersion)||'',status:t(form.status),selfSubmittedAt:form.self_submitted_at||'',reviewSubmittedAt:form.review_submitted_at||'',reviewedAsOverride:form.reviewed_as_override===true,reviewOverrideReason:t(form.review_override_reason),overdueApplied:Boolean(overdueEvent),overdueMode:t(overdueEvent&&overdueEvent.after_data&&overdueEvent.after_data.policyMode),overdueSource:t(overdueEvent&&overdueEvent.after_data&&overdueEvent.after_data.scoreSource),adminException:Boolean(exceptionEvents.length||form.admin_exception_open===true),exceptionOpen:form.admin_exception_open===true,exceptionReason:t(lastException&&lastException.reason),historyCount:history.length};
  });
  const formByCode=new Map(forms.map(row=>[row.employeeCode,row]));
  const violations=(violationsRead.data||[]).map(row=>{const code=t(row.employee_code).toUpperCase(),form=formByCode.get(code)||{},person=(access.people||[]).find(item=>t(item.employeeCode).toUpperCase()===code)||{};return {id:row.id,periodMonth:selectedMonth,employeeCode:code,employeeName:t(row.employee_name)||form.employeeName||person.employeeName||'',department:form.department||person.department||'',branch:form.branch||person.branch||'',criterionCode:t(row.criterion_code),criterionName:t(row.criterion_name),group:t(row.criterion_group)||t(row.criterion_name)||'Khác',points:round(row.points),occurredDate:t(row.occurred_date)};});
  const trendForms=(trendRead.data||[]).map(row=>({periodMonth:t(row.period_month),employeeCode:t(row.employee_code).toUpperCase(),department:t(row.department),branch:t(row.branch),finalScore:row.final_score==null?null:round(row.final_score),status:t(row.status)}));
  const trend=trendMonths.map(period=>{const rows=trendForms.filter(row=>row.periodMonth===period),done=rows.filter(row=>row.finalScore!=null&&['reviewed','locked'].includes(row.status));return {month:period,total:rows.length,completed:done.length,average:average(done.map(row=>row.finalScore))};});
  const repeatPolicy=await readRepeatPolicy(selectedMonth),windowStart=shiftMonth(selectedMonth,-(repeatPolicy.trainingWindowMonths-1)),windowBounds={start:windowStart+'-01',next:shiftMonth(selectedMonth,1)+'-01'};let repeatRows=[];
  if(selectedMonth>=repeatPolicy.effectiveFromPeriod){let repeatQuery=db.from('checklist_violation_records').select('employee_code,employee_name,criterion_code,criterion_name,occurred_date,points').eq('is_test',false).eq('record_status','official').gte('occurred_date',windowBounds.start).lt('occurred_date',windowBounds.next).order('occurred_date',{ascending:true}).limit(10000);if(!isAdmin)repeatQuery=repeatQuery.in('employee_code',[...allowedCodes]);const repeatRead=await repeatQuery;if(repeatRead.error)throw repeatRead.error;repeatRows=repeatRead.data||[];}
  const peopleByCode=new Map((access.people||[]).map(row=>[t(row.employeeCode).toUpperCase(),row]));
  return {month:selectedMonth,periods,forms,violations,trend,trendForms,repeatSuggestions:repeatSuggestions(repeatRows,repeatPolicy,selectedMonth,peopleByCode),repeatPolicy,scope:{role:access.role,grant:publicGrant(access.grant),count:(access.people||[]).length,canExport:access.canExport===true},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};
}

/**
 * "Tình trạng xử lý ghi nhận lỗi" - nguồn chuẩn DUY NHẤT cho cả Báo cáo và
 * Tổng quan (một hàm, một object kết quả; Tổng quan KHÔNG được tự suy ra số
 * liệu này từ task engine cá nhân - xem assets/js/checklist/phf-checklist-app.js
 * quanh reportWorkflowUiState). Scope dùng đúng viewScope của capability
 * view_violations qua resolveViolationPermission()/permissionEmployees()
 * trong lib/checklist-violations.js - CÙNG nguồn quyền mà
 * listChecklistViolations() (Nhật ký lỗi) dùng, để bấm KPI ở đây luôn ra
 * đúng số bản ghi ở Nhật ký lỗi. KHÔNG dùng reviewScope/
 * getChecklistMonthlyReviewAccess ở đây: reviewScope (vd. Trưởng ca =
 * direct_reports) có thể hẹp hơn viewScope, gây lệch số khi đối chiếu với
 * Nhật ký lỗi.
 *
 * Mapping nhóm KPI -> field/status thật:
 * - Tổng ghi nhận: checklist_violation_records trong kỳ, is_test=false,
 *   record_status IN (official, cancelled) - loại nháp vì "Nháp chưa trừ
 *   điểm" (chưa là ghi nhận chính thức).
 * - Đã chính thức: record_status = 'official'.
 * - Đã hủy: record_status = 'cancelled'.
 * - Chờ nhân viên phản hồi: trong số bản ghi 'official', task liên kết
 *   (checklist_violation_tasks.status) IN (waiting_employee,
 *   waiting_employee_result).
 * - Đang giải trình (Ý kiến chờ phản hồi): task.status IN (waiting_reviewer,
 *   waiting_admin) - nhân viên đã gửi giải trình, đang chờ người ghi
 *   lỗi/Admin xử lý. waitingAdmin bên dưới là tập con tách riêng chỉ để phục
 *   vụ card "Báo Admin" - không phải bucket workflowStatus mới, không đổi
 *   classifyViolationWorkflowStatus.
 * - Quá hạn phản hồi: task.due_at < hiện tại và task.status chưa
 *   completed/cancelled (không loại trừ hai nhóm trên - một task có thể vừa
 *   "chờ nhân viên" vừa "quá hạn").
 * - Sắp quá hạn (dueSoon): task chưa quá hạn, còn trong hạn cảnh báo theo
 *   operationTimingPolicy() (lib/checklist-tasks.js) - employeeResponseDays
 *   khi đang chờ nhân viên, reviewerResponseDays khi đang giải trình/chờ
 *   Admin. Không hardcode số ngày - đọc trực tiếp cấu hình đang áp dụng.
 *   task.status chưa completed/cancelled.
 * - Việc đang mở (open): bản ghi official mà task còn "chờ nhân viên" hoặc
 *   "đang giải trình" hoặc "quá hạn" (loại các trường hợp task đã
 *   completed/cancelled hoặc không có task).
 */
async function getChecklistViolationWorkflowSummary(session,input={}){
  if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
  const permission=await resolveViolationPermission(session,'view');
  const generatedAt=new Date().toISOString();
  if(!permission.canView)return {canView:false,month:'',summary:null,scope:null,generatedAt};

  const scopeIsAll=permission.scopeType==='all_company';
  const employees=scopeIsAll?[]:await permissionEmployees(permission);
  const allowedCodes=scopeIsAll?[]:[...new Set(employees.map(row=>t(row.employee_code).toUpperCase()).filter(Boolean))];
  const selectedMonth=input.month?month(input.month):new Date().toISOString().slice(0,7);
  const emptySummary={total:0,official:0,cancelled:0,waitingEmployee:0,inExplanation:0,waitingAdmin:0,overdue:0,dueSoon:0,open:0};
  if(!scopeIsAll&&!allowedCodes.length){
    return {canView:true,month:selectedMonth,summary:emptySummary,scope:{scopeType:permission.scopeType,count:0},generatedAt};
  }

  const bounds=periodBounds(selectedMonth);
  let recordsQuery=db.from('checklist_violation_records')
    .select('id,record_status')
    .eq('is_test',false)
    .in('record_status',['official','cancelled'])
    .gte('occurred_date',bounds.start).lt('occurred_date',bounds.next)
    .limit(5000);
  if(!scopeIsAll)recordsQuery=recordsQuery.in('employee_code',allowedCodes);
  const {data:records,error:recordsError}=await recordsQuery;
  if(recordsError)throw recordsError;

  const officialIds=(records||[]).filter(row=>row.record_status==='official').map(row=>row.id);
  let tasks=[];
  let timingPolicy=null;
  if(officialIds.length){
    const [taskRead,policyRead]=await Promise.all([
      db.from('checklist_violation_tasks').select('violation_id,status,due_at').in('violation_id',officialIds).limit(5000),
      operationTimingPolicy()
    ]);
    if(taskRead.error)throw taskRead.error;
    tasks=taskRead.data||[];
    timingPolicy=policyRead;
  }
  const taskByViolation=new Map(tasks.map(row=>[row.violation_id,row]));
  const now=Date.now();
  let waitingEmployee=0,inExplanation=0,waitingAdmin=0,overdue=0,dueSoon=0,open=0;
  for(const id of officialIds){
    const task=taskByViolation.get(id);
    if(!task)continue;
    const c=classifyViolationWorkflowStatus('official',task,now,timingPolicy);
    if(c.waitingEmployee)waitingEmployee++;
    if(c.inExplanation)inExplanation++;
    if(c.waitingAdmin)waitingAdmin++;
    if(c.overdue)overdue++;
    if(c.dueSoon)dueSoon++;
    if(c.open)open++;
  }

  const total=(records||[]).length,official=officialIds.length,cancelled=total-official;
  return {
    canView:true,
    month:selectedMonth,
    summary:{total,official,cancelled,waitingEmployee,inExplanation,waitingAdmin,overdue,dueSoon,open},
    scope:{scopeType:permission.scopeType,scopeValues:permission.scopeValues||[],count:scopeIsAll?null:allowedCodes.length},
    generatedAt
  };
}

/*
 * Dashboard "Điểm Checklist" · chế độ HIỆN TẠI.
 * Khác getChecklistMonthlyReport() (bắt đầu từ checklist_monthly_forms - chỉ
 * ra người ĐÃ có phiếu): hàm này bắt đầu từ checklist_employee_assignments
 * hiện hành (qua getChecklistReportAccess() - CÙNG quyền/scope với "Báo cáo",
 * không tạo permission mới) nên bao gồm cả nhân viên CHƯA có phiếu tháng và
 * nhân viên điểm 100 chưa có lỗi. Điểm dùng đúng công thức đã có ở mọi nơi
 * khác trong Checklist (100 - tổng points của violation record_status=
 * 'official', is_test=false, trong kỳ) - KHÔNG tạo engine điểm mới.
 * Ngưỡng "dưới ngưỡng" dùng lại đúng mốc <70 mà reportUiState.scoreBand
 * ('low') đã dùng cho chế độ Theo kỳ, để hai chế độ nhất quán với nhau.
 */
async function getChecklistCurrentScoreReport(session,input={}){
  if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
  const access=await getChecklistReportAccess(session);
  const selectedMonth=input.month?month(input.month):new Date().toISOString().slice(0,7);
  const people=access.people||[];
  const emptyResult={month:selectedMonth,employees:[],summary:{total:0,averageScore:0,belowThresholdCount:0,cleanCount:0},scope:{role:access.role,grant:publicGrant(access.grant),count:0},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};
  if(!people.length)return emptyResult;

  const bounds=periodBounds(selectedMonth),codes=[...new Set(people.map(p=>t(p.employeeCode).toUpperCase()).filter(Boolean))];
  const violationsQuery=db.from('checklist_violation_records').select('employee_code,points,occurred_date').eq('is_test',false).eq('record_status','official').gte('occurred_date',bounds.start).lt('occurred_date',bounds.next).in('employee_code',codes).limit(5000);
  const formsQuery=db.from('checklist_monthly_forms').select('employee_code,status').eq('period_month',selectedMonth).in('employee_code',codes).limit(1000);
  const [violationsRead,formsRead]=await Promise.all([violationsQuery,formsQuery]);
  if(violationsRead.error)throw violationsRead.error;if(formsRead.error)throw formsRead.error;

  const pointsByCode={},countByCode={},lastByCode={};
  (violationsRead.data||[]).forEach(row=>{const code=t(row.employee_code).toUpperCase();pointsByCode[code]=(pointsByCode[code]||0)+Math.max(0,number(row.points));countByCode[code]=(countByCode[code]||0)+1;const occurred=t(row.occurred_date);if(occurred&&(!lastByCode[code]||occurred>lastByCode[code]))lastByCode[code]=occurred;});
  const formByCode=new Map((formsRead.data||[]).map(row=>[t(row.employee_code).toUpperCase(),row]));

  const deptFilter=t(input.department),branchFilter=t(input.branch),managerFilter=t(input.managerCode).toUpperCase(),q=normalizedSource(input.query);
  const employees=people.filter(p=>{
    if(deptFilter&&normalizedSource(p.department)!==normalizedSource(deptFilter))return false;
    if(branchFilter&&normalizedSource(p.branch)!==normalizedSource(branchFilter))return false;
    if(managerFilter&&t(p.managerCode).toUpperCase()!==managerFilter)return false;
    if(q&&!normalizedSource([p.employeeName,p.employeeCode,p.department,p.branch,p.title,p.managerName].join(' ')).includes(q))return false;
    return true;
  }).map(p=>{
    const code=t(p.employeeCode).toUpperCase(),points=pointsByCode[code]||0,form=formByCode.get(code)||null;
    return {employeeCode:code,employeeName:p.employeeName,department:p.department,branch:p.branch,title:p.title,managerCode:p.managerCode,managerName:p.managerName,currentScore:round(Math.max(0,100-points)),violationCount:countByCode[code]||0,totalPointsDeducted:round(points),lastViolationDate:lastByCode[code]||'',monthlyFormStatus:form?t(form.status):'',hasMonthlyForm:Boolean(form)};
  }).sort((a,b)=>a.employeeName.localeCompare(b.employeeName,'vi'));

  return {month:selectedMonth,employees,summary:{total:employees.length,averageScore:average(employees.map(e=>e.currentScore)),belowThresholdCount:employees.filter(e=>e.currentScore<70).length,cleanCount:employees.filter(e=>e.violationCount===0).length},scope:{role:access.role,grant:publicGrant(access.grant),count:people.length},generatedAt:new Date().toISOString(),generatedBy:actor(session).name};
}

module.exports={getChecklistMonthlyReport,reportScoreSummary,getChecklistViolationWorkflowSummary,getChecklistCurrentScoreReport};
