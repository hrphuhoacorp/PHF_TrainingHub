'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { getChecklistReportAccess } = require('./checklist-permissions');

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
function reportRows(form){const definition=form&&form.template_snapshot&&form.template_snapshot.version&&form.template_snapshot.version.definition||{},rows=Array.isArray(definition.totalRows)?definition.totalRows:[];return rows.map((row,index)=>Array.isArray(row)?{code:t(row[1])||'ROW-'+(index+1),name:t(row[2]),source:t(row[7]),weight:number(String(row[5]==null?'':row[5]).replace('%','').replace(',','.'))}:{code:t(row.code)||'ROW-'+(index+1),name:t(row.content||row.name),source:t(row.source),weight:number(String(row.weight==null?'':row.weight).replace('%','').replace(',','.'))});}
function reportScoreSummary(form,checklistScore){const rows=reportRows(form),self=form.self_answers||{},review=form.review_answers||{};let selfTotal=0,reviewTotal=0;const reviewChecklist=number(form.checklist_review_score,checklistScore);for(const row of rows){if(automaticCriterion(row.source,row.name)){selfTotal+=number(checklistScore)*row.weight/100;reviewTotal+=reviewChecklist*row.weight/100;}else{selfTotal+=number(self[row.code]&&self[row.code].value);reviewTotal+=number(review[row.code]&&review[row.code].value);}}return {selfTotalScore:round(selfTotal),reviewTotalScore:round(reviewTotal)};}
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
    return {id:form.id,periodMonth:t(form.period_month),employeeCode:code,employeeName:t(form.employee_name),department:t(form.department),title:t(form.title),branch:t(form.branch),reviewerCode:t(form.reviewer_code).toUpperCase(),reviewerName:t(form.reviewer_name),templateId:t(form.template_id),templateVersion:t(form.template_version),checklistScore:round(checklistScore),checklistReviewScore:round(form.checklist_review_score==null?checklistScore:form.checklist_review_score),selfTotalScore:dynamic?dynamic.selfTotalScore:round(form.self_total_score),reviewTotalScore:dynamic?dynamic.reviewTotalScore:round(form.review_total_score),finalScore:form.final_score==null?null:round(form.final_score),status:t(form.status),selfSubmittedAt:form.self_submitted_at||'',reviewSubmittedAt:form.review_submitted_at||'',reviewedAsOverride:form.reviewed_as_override===true,reviewOverrideReason:t(form.review_override_reason),overdueApplied:Boolean(overdueEvent),overdueMode:t(overdueEvent&&overdueEvent.after_data&&overdueEvent.after_data.policyMode),adminException:Boolean(exceptionEvents.length||form.admin_exception_open===true),exceptionOpen:form.admin_exception_open===true,exceptionReason:t(lastException&&lastException.reason),historyCount:history.length};
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

module.exports={getChecklistMonthlyReport};
