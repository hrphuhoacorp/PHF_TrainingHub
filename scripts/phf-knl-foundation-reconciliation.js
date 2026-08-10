'use strict';

require('dotenv').config();
const path=require('path');
const {createClient}=require('@supabase/supabase-js');
const manifest=require('./data/PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json');

function text(value){return String(value==null?'':value).trim();}
function employeeCode(value){return text(value).toUpperCase();}
function normalizedName(value){return text(value).normalize('NFKC').toLocaleLowerCase('vi-VN').replace(/\s+/g,' ');}
function inactive(row){const value=normalizedName(row.employee_status||row.status);return value.includes('nghỉ')||value==='inactive'||value==='terminated';}

function reconcile(source,organizationRows){
  const byCode=new Map();
  for(const row of organizationRows||[]){
    const code=employeeCode(row.employee_code||row.employeeCode);
    if(!code)continue;
    const rows=byCode.get(code)||[];rows.push(row);byCode.set(code,rows);
  }
  const groups={WILL_ASSIGN:[],SKIP_INACTIVE:[],SKIP_NOT_FOUND:[],NEEDS_REVIEW:[]};
  for(const candidate of source.employees||[]){
    const code=employeeCode(candidate.employeeCode),matches=byCode.get(code)||[];
    const base={employeeCode:code,employeeName:candidate.employeeName,employmentType:candidate.employmentType,sourceGradeCode:candidate.sourceGradeCode,mappedGradeCode:candidate.mappedGradeCode,sourceRow:candidate.sourceRow};
    if(matches.length===0){groups.SKIP_NOT_FOUND.push({...base,classification:'SKIP_NOT_FOUND',reason:'employee_code not found in current organization'});continue;}
    if(matches.length>1){groups.NEEDS_REVIEW.push({...base,classification:'NEEDS_REVIEW',reason:'duplicate employee_code in current organization',matchCount:matches.length});continue;}
    const current=matches[0];
    if(inactive(current)){groups.SKIP_INACTIVE.push({...base,classification:'SKIP_INACTIVE',currentName:current.employee_name||current.employeeName||'',reason:'current organization marks employee inactive/terminated'});continue;}
    if(normalizedName(candidate.employeeName)!==normalizedName(current.employee_name||current.employeeName)){
      groups.NEEDS_REVIEW.push({...base,classification:'NEEDS_REVIEW',currentName:current.employee_name||current.employeeName||'',reason:'significant name mismatch for the same employee_code'});continue;
    }
    if(candidate.mappingValid!==true){groups.NEEDS_REVIEW.push({...base,classification:'NEEDS_REVIEW',reason:'mapped grade is missing from reviewed standard ladder'});continue;}
    groups.WILL_ASSIGN.push({...base,classification:'WILL_ASSIGN',currentName:current.employee_name||current.employeeName||'',hasProfessionalAllowance:candidate.hasProfessionalAllowance===true,hasManagementAllowance:candidate.hasManagementAllowance===true,hasMealAllowance:candidate.hasMealAllowance===true,mealAllowance:Number(candidate.mealAllowance||0),probationAmount:Number(candidate.probationAmount||0),organizationSnapshot:{employeeCode:code,employeeName:current.employee_name||current.employeeName||'',department:current.department||'',branch:current.branch||'',title:current.title||'',position:current.position||''}});
  }
  return{manifestVersion:source.manifestVersion,sourcePeriod:source.sourcePeriod,effectivePeriod:source.effectivePeriod,counts:Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,rows.length])),groups};
}

async function main(){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw new Error('Supabase Production env is required for read-only reconciliation.');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from('checklist_employee_assignments').select('employee_code,employee_name,employee_status,department,branch,title,position').order('employee_code');
  if(error)throw error;
  const result=reconcile(manifest,data||[]);
  console.log(JSON.stringify(result,null,2));
  if(process.argv.includes('--require-clean')&&result.counts.NEEDS_REVIEW)process.exitCode=2;
}

if(require.main===module)main().catch(error=>{console.error(error);process.exit(1);});
module.exports={reconcile,normalizedName,inactive,manifestPath:path.join(__dirname,'data','PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json')};
