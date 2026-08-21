'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'scripts','PHF_KNL_ASSIGNMENT_SOURCE_MANIFEST_1.48.0.sql'),'utf8');
const ui=fs.readFileSync(path.join(root,'assets','js','knl','phf-knl-app.js'),'utf8');
const router=fs.readFileSync(path.join(root,'assets','js','phf-url-router.js'),'utf8');
const manifest=require('../assets/data/knl-source-manifest-2026-08-09.json');
let passed=0;
function check(value,message){assert.ok(value,message);passed++;console.log('PASS',message);}

['knl_source_manifests','knl_framework_assignments','knl_framework_assignment_history'].forEach(table=>check(new RegExp('create table if not exists public\\.'+table+'\\s*\\(','i').test(sql),'Migration additive tạo '+table));
check(/add column if not exists source_key/i.test(sql)&&/source_key_uq/i.test(sql),'Stable source key/index được thêm additive vào cấu trúc Batch 1');
check(/unique\(version_id,target_type,target_ref\)/i.test(sql),'Assignment unique theo version + target, vẫn cho một người nhiều framework');
check(/target_type in \('employee','position'\)/i.test(sql)&&/employee_code=target_ref/i.test(sql)&&/position_ref=target_ref/i.test(sql),'Assignment tách employee_code và position_ref');
check(/knl_seed_source_candidate/i.test(sql)&&/SOURCE_HASH_CHANGED_REVIEW_REQUIRED/i.test(sql),'Seed RPC atomic/idempotent và fail conflict khi source hash đổi');
check(/enable row level security/i.test(sql)&&/revoke all on public\.knl_source_manifests/i.test(sql),'RLS/revoke fail-closed cho bảng Batch 2');
check(!/(insert|update|delete)\s+(into\s+|from\s+)?public\.checklist_/i.test(sql),'Migration không ghi ngược Checklist');
check(!/create table[^;]*(survey|assessment)/i.test(sql),'Batch 2 không tạo Survey/Assessment');
const sidebarBlock=(ui.match(/var SIDEBAR_ITEMS\s*=\s*\[([\s\S]*?)\];/)||[])[1]||'';
check(!sidebarBlock.includes("key:'gan-ap-dung'")&&ui.includes('data-knl-domain-tab="gan-ap-dung"'),'Gán & áp dụng là tab nội bộ Bộ KNL, không phải domain menu trái');
check(router.includes("'/admin/knl/gan-ap-dung'")&&ui.includes("activeTab==='gan-ap-dung'?'bo-knl':activeTab"),'Deeplink Gán & áp dụng giữ compatibility và active domain Bộ KNL');

const ready=manifest.candidates.filter(row=>row.candidateStatus==='READY');
const review=manifest.candidates.filter(row=>row.candidateStatus==='NEEDS_REVIEW');
const excluded=manifest.candidates.filter(row=>row.candidateStatus==='EXCLUDED');
const totals=ready.reduce((sum,row)=>({frameworks:sum.frameworks+1,versions:sum.versions+1,groups:sum.groups+row.counts.groups,items:sum.items+row.counts.items,contents:sum.contents+row.counts.contents}),{frameworks:0,versions:0,groups:0,items:0,contents:0});
check(JSON.stringify(totals)===JSON.stringify({frameworks:11,versions:11,groups:33,items:132,contents:632}),'Manifest chuẩn bị đúng 11 framework / 11 version / 33 group / 132 item / 632 content');
check(ready.some(row=>row.levelCount===4)&&ready.some(row=>row.levelCount===5),'Source giữ đúng engine mức động 4 và 5');
check(review.length===21&&review.every(row=>row.groups.length>0&&row.counts.groups>0),'21 source NEEDS_REVIEW (regular/v2/legacy naming ambiguity) vẫn có đầy đủ payload cấu trúc — candidateStatus không còn quyết định mẫu có xuất hiện trong thư viện hay không (batch Thư viện Bộ KNL đầy đủ)');
check(excluded.length===3&&['CV CUNG ỨNG','NV VẬN TẢI','CHUỖI GIÁ TRỊ HÀNG SX'].every(name=>excluded.some(row=>row.sourceSheet===name)),'Ba residual/out-of-scope bị EXCLUDED');
const forbidden=/lương|thu nhập|bậc lương|thử việc|compensation|85%/i;
const seededContent=ready.flatMap(row=>[row.guidance||'',...row.groups.flatMap(group=>group.items).flatMap(item=>[item.name,item.description,...item.levels])]).join('\n');
check(!forbidden.test(seededContent),'Payload seed không chứa từ khóa/nội dung pay-grade, probation hoặc compensation');
check(seededContent.includes('Kinh nghiệm làm việc trong lĩnh vực liên quan')&&seededContent.includes('Chuyên môn, trình độ học vấn'),'Giữ nguyên kinh nghiệm/trình độ theo source PHF');
check((ready.find(row=>row.sourceFile==='PDF Bán hàng')?.guidance||'').includes('Hiểu biết về khách hàng'),'Giữ guidance/kiểm chứng chi tiết của PDF Bán hàng trong source metadata');
const specPath='C:/Users/thang/Downloads/PHF_KNL_IMPLEMENTATION_SPEC_2026-08-09.md';
if(fs.existsSync(specPath)){const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(specPath,'utf8').replace(/^\uFEFF/,'')).digest('hex');check(sourceHash===manifest.sourceSpecSha256,'Manifest khớp SHA-256 của spec đã chốt');}

let uuidSeq=20;const uuid=()=>('00000000-0000-4000-8000-'+String(uuidSeq++).padStart(12,'0'));
const versionA='00000000-0000-4000-8000-000000000001',versionB='00000000-0000-4000-8000-000000000002';
const dbState={versions:[{id:versionA,framework_id:'f1',status:'published',is_locked:true},{id:versionB,framework_id:'f2',status:'published',is_locked:true}],assignments:[],seeded:new Map(),domain:{frameworks:0,versions:0,groups:0,items:0,contents:0},checklistWrites:0};
class Query{
  constructor(table){this.table=table;this.mode='select';this.payload=null;this.filters=[];}
  select(){return this;}eq(key,value){this.filters.push([key,value]);return this;}order(){return this;}
  insert(payload){this.mode='insert';this.payload=payload;return this;}update(payload){this.mode='update';this.payload=payload;return this;}
  rows(){const rows=this.table==='knl_framework_versions'?dbState.versions:(this.table==='knl_framework_assignments'?dbState.assignments:[]);return rows.filter(row=>this.filters.every(([key,value])=>row[key]===value));}
  execute(){if(this.mode==='select')return{data:this.rows(),error:null};if(this.mode==='insert'){const row={...this.payload,id:uuid(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};dbState.assignments.push(row);return{data:row,error:null};}const rows=this.rows();rows.forEach(row=>Object.assign(row,this.payload));return{data:rows,error:null};}
  maybeSingle(){const out=this.execute();if(Array.isArray(out.data))out.data=out.data[0]||null;return Promise.resolve(out);}single(){const out=this.execute();if(Array.isArray(out.data))out.data=out.data[0]||null;return Promise.resolve(out);}then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);}
}
const mockDb={from(table){return new Query(table);},rpc(name,args){assert.equal(name,'knl_seed_source_candidate');const c=args.p_candidate,prior=dbState.seeded.get(c.manifestKey);if(c.candidateStatus!=='READY')return Promise.resolve({data:{manifestKey:c.manifestKey,status:'SKIPPED'},error:null});if(prior)return Promise.resolve({data:{manifestKey:c.manifestKey,status:'UNCHANGED'},error:null});dbState.seeded.set(c.manifestKey,true);dbState.domain.frameworks++;dbState.domain.versions++;dbState.domain.groups+=c.counts.groups;dbState.domain.items+=c.counts.items;dbState.domain.contents+=c.counts.contents;return Promise.resolve({data:{manifestKey:c.manifestKey,status:'SEEDED'},error:null});}};
process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SECRET_KEY='unit-secret';
const supabasePath=require.resolve('@supabase/supabase-js'),peoplePath=require.resolve('../api/_lib/knl-people'),servicePath=require.resolve('../api/_lib/knl-assignments');
require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{createClient:()=>mockDb}};
require.cache[peoplePath]={id:peoplePath,filename:peoplePath,loaded:true,exports:{listKnlAssignmentTargets:async()=>({people:[{employeeCode:'E1',employeeName:'Employee One',title:'Nhân viên',position:'',department:'Sales',branch:'A'}],positions:[],organizationConflict:{code:'KNL_ORG_POSITION_UNAVAILABLE',message:'position missing'}}),resolveKnlAssignmentTarget:async(type,ref)=>{if(type==='position'){const e=new Error('position missing');e.code='KNL_ORG_POSITION_UNAVAILABLE';throw e;}if(type!=='employee'||ref!=='E1'){const e=new Error('employee missing');e.code='KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND';throw e;}return{targetType:'employee',targetRef:'E1',employeeCode:'E1',positionRef:null,snapshot:{employeeCode:'E1',employeeName:'Employee One',title:'Nhân viên',position:'',department:'Sales',branch:'A'}};}}};
delete require.cache[servicePath];const service=require('../api/_lib/knl-assignments');const admin={role:'admin',sub:'admin',account:{id:'admin',name:'Admin'}};

(async()=>{
  const first=await service.seedKnlSourceManifest(admin),snapshot={...dbState.domain};const second=await service.seedKnlSourceManifest(admin);
  check(first.summary.SEEDED===11&&!first.summary.SKIPPED&&dbState.seeded.size===11,'lib/knl-assignments.js#seedKnlSourceManifest (đường RPC hàng loạt cũ) vẫn chỉ gọi 11 READY như thiết kế ban đầu — 21 NEEDS_REVIEW nay được nạp qua scripts/phf-knl-library-seed-needs-review-1.50.9.js (đường CRUD hạt mịn sẵn có, không qua RPC này, không cần migration)');
  check(second.summary.UNCHANGED===11&&JSON.stringify(dbState.domain)===JSON.stringify(snapshot),'Seed lần 2 không tăng framework/version/group/item/content');
  check(dbState.assignments.length===0,'Seed lần 1/lần 2 không tự tạo hoặc duplicate assignment');
  await service.saveKnlFrameworkAssignment(admin,{versionId:versionA,targetType:'employee',targetRef:'E1',reason:'Gán khung A'});
  await service.saveKnlFrameworkAssignment(admin,{versionId:versionB,targetType:'employee',targetRef:'E1',reason:'Gán khung B'});
  check(dbState.assignments.length===2&&new Set(dbState.assignments.map(row=>row.version_id)).size===2,'Một employee_code được gán nhiều framework version');
  await service.saveKnlFrameworkAssignment(admin,{versionId:versionA,targetType:'employee',targetRef:'E1',reason:'Cập nhật khung A'});
  check(dbState.assignments.length===2,'Gán lại cùng version + employee idempotent, không duplicate assignment');
  let invalidEmployee=false;try{await service.saveKnlFrameworkAssignment(admin,{versionId:versionA,targetType:'employee',targetRef:'BAD',reason:'Invalid employee'});}catch(error){invalidEmployee=error.code==='KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND';}check(invalidEmployee,'Invalid employee bị reject');
  let invalidPosition=false;try{await service.saveKnlFrameworkAssignment(admin,{versionId:versionA,targetType:'position',targetRef:'free-text',reason:'Invalid position'});}catch(error){invalidPosition=error.code==='KNL_ORG_POSITION_UNAVAILABLE';}check(invalidPosition,'Position trống ở source báo conflict, không suy title/free text');
  let managerDenied=false;try{await service.seedKnlSourceManifest({role:'manager',account:{id:'m1'}});}catch(error){managerDenied=error.code==='KNL_ADMIN_REQUIRED';}check(managerDenied,'TBP/NV không được seed hoặc chỉnh assignment');
  check(dbState.checklistWrites===0&&!/\.from\(['"]checklist_employee_assignments['"]\)\.(insert|update|upsert|delete)/.test(fs.readFileSync(path.join(root,'api','_lib', 'knl-people.js'),'utf8')),'Organization adapter read-only, không ghi Checklist');
  console.log('\nKNL Batch 2:',passed,'checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
