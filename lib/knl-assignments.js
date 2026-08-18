'use strict';

require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const manifest=require('../assets/data/knl-source-manifest-2026-08-09.json');
const {listKnlAssignmentTargets:readAssignmentTargets,resolveKnlAssignmentTarget}=require('./knl-people');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
function text(value){return String(value==null?'':value).trim();}
function fail(message,statusCode=400,code='KNL_ASSIGNMENT_INVALID'){const error=new Error(message);error.statusCode=statusCode;error.code=code;throw error;}
function ensureDb(){if(!db)fail('Supabase chưa được cấu hình cho KNL Batch 2.',503,'SUPABASE_NOT_CONFIGURED');}
function requireAdmin(session){if(text(session?.role).toLowerCase()!=='admin')fail('Chỉ Admin được nạp source và quản trị assignment KNL.',403,'KNL_ADMIN_REQUIRED');}
function actor(session){return{id:text(session?.account?.id||session?.sub)||null,name:text(session?.account?.name||session?.account?.email||session?.email)||null};}
function throwDb(error){if(!error)return;const code=text(error.code),message=text(error.message);if(code==='PGRST205'||code==='42P01'||/Could not find the table|relation .* does not exist/i.test(message))fail('Schema KNL Batch 2 chưa được cài đặt. Hãy chạy scripts/PHF_KNL_ASSIGNMENT_SOURCE_MANIFEST_1.48.0.sql.',503,'KNL_BATCH2_SCHEMA_MISSING');throw error;}
function totals(candidates){return candidates.reduce((sum,row)=>({frameworks:sum.frameworks+(row.candidateStatus==='READY'?1:0),versions:sum.versions+(row.candidateStatus==='READY'?1:0),groups:sum.groups+Number(row.counts?.groups||0),items:sum.items+Number(row.counts?.items||0),contents:sum.contents+Number(row.counts?.contents||0)}),{frameworks:0,versions:0,groups:0,items:0,contents:0});}
function seedPreview(){const ready=manifest.candidates.filter(row=>row.candidateStatus==='READY'),review=manifest.candidates.filter(row=>row.candidateStatus==='NEEDS_REVIEW'),excluded=manifest.candidates.filter(row=>row.candidateStatus==='EXCLUDED');return{manifestVersion:manifest.manifestVersion,specDate:manifest.specDate,sourceSpecSha256:manifest.sourceSpecSha256,totals:totals(ready),ready:ready.map(row=>({manifestKey:row.manifestKey,sourceFile:row.sourceFile,sourceSheet:row.sourceSheet,sourcePosition:row.sourcePosition,levelCount:row.levelCount,counts:row.counts})),needsReview:review.map(row=>({manifestKey:row.manifestKey,sourceFile:row.sourceFile,sourceSheet:row.sourceSheet,sourcePosition:row.sourcePosition,reason:row.decisionReason})),excluded:excluded.map(row=>({manifestKey:row.manifestKey,sourceSheet:row.sourceSheet,reason:row.decisionReason}))};}

async function previewKnlSourceSeed(session){requireAdmin(session);return seedPreview();}
async function seedKnlSourceManifest(session){
  requireAdmin(session);ensureDb();const a=actor(session),results=[];
  const readyCandidates=manifest.candidates.filter(candidate=>candidate.candidateStatus==='READY');
  for(const candidate of readyCandidates){const {data,error}=await db.rpc('knl_seed_source_candidate',{p_candidate:candidate,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);results.push(data);}
  const counts=results.reduce((sum,row)=>{const status=text(row?.status);sum[status]=(sum[status]||0)+1;return sum;},{});
  return{manifestVersion:manifest.manifestVersion,summary:counts,results};
}
async function listKnlSourceManifests(session){requireAdmin(session);ensureDb();const {data,error}=await db.from('knl_source_manifests').select('*').order('source_file').order('source_sheet');throwDb(error);return{manifests:(data||[]).map(row=>({id:row.id,manifestKey:row.manifest_key,sourceFile:row.source_file,sourceSheet:row.source_sheet,sourcePosition:row.source_position||'',candidateStatus:row.candidate_status,importStatus:row.import_status,decisionReason:row.decision_reason,levelCount:row.level_count,frameworkId:row.framework_id||'',versionId:row.version_id||'',resultSummary:row.result_summary||{}}))};}
async function listKnlAssignmentTargets(session){requireAdmin(session);return readAssignmentTargets();}
/* PHF AI V2 Batch 2 (2026-08-18) - filters.employeeCode (TUY CHON, mac dinh
 * khong truyen = HANH VI CU 100%, moi UI Admin dang goi khong tham so van
 * chay dung nhu truoc). Khi CO employeeCode: chi SELECT dung cac dong
 * employee_code=... o tang SQL thay vi tai toan bo bang assignment roi loc
 * trong bo nho - dung cho lib/ai-knl-framework-tools.js#findVersionIdByAssignment
 * (tra cuu 1 nhan vien cu the, KHONG can toan bo danh sach). versions/
 * frameworks van doc toan bo (2 bang nho, can de join code/name) - KHONG
 * doi logic join/permission, chi bot doc bang assignment lon hon. */
async function listKnlFrameworkAssignments(session,filters={}){requireAdmin(session);ensureDb();const employeeCode=text(filters.employeeCode).toUpperCase();let assignmentQuery=db.from('knl_framework_assignments').select('*').order('updated_at',{ascending:false});if(employeeCode)assignmentQuery=assignmentQuery.eq('employee_code',employeeCode);const [{data:assignments,error:aError},{data:versions,error:vError},{data:frameworks,error:fError}]=await Promise.all([assignmentQuery,db.from('knl_framework_versions').select('id,framework_id,version_number,name,status'),db.from('knl_frameworks').select('id,code,name,status')]);throwDb(aError);throwDb(vError);throwDb(fError);return{assignments:(assignments||[]).map(row=>{const version=(versions||[]).find(v=>v.id===row.version_id)||{},framework=(frameworks||[]).find(f=>f.id===version.framework_id)||{};return{id:row.id,assignmentKey:row.assignment_key,versionId:row.version_id,frameworkCode:framework.code||'',frameworkName:framework.name||'',versionNumber:version.version_number||0,versionName:version.name||'',targetType:row.target_type,targetRef:row.target_ref,employeeCode:row.employee_code||'',positionRef:row.position_ref||'',organizationSnapshot:row.organization_snapshot||{},isPrimary:row.is_primary===true,status:row.status,reason:row.reason,updatedAt:row.updated_at};})};}
async function saveKnlFrameworkAssignment(session,input={}){
  requireAdmin(session);ensureDb();const versionId=text(input.versionId);if(!/^[0-9a-f-]{36}$/i.test(versionId))fail('Version KNL không hợp lệ.',400,'KNL_ASSIGNMENT_VERSION_INVALID');const reason=text(input.reason);if(reason.length<5)fail('Lý do gán cần tối thiểu 5 ký tự.',400,'KNL_ASSIGNMENT_REASON_REQUIRED');
  const {data:version,error:vError}=await db.from('knl_framework_versions').select('id,framework_id,status,is_locked').eq('id',versionId).maybeSingle();throwDb(vError);if(!version)fail('Version KNL không tồn tại.',404,'KNL_ASSIGNMENT_VERSION_NOT_FOUND');
  const resolved=await resolveKnlAssignmentTarget(text(input.targetType),input.targetRef);const a=actor(session);const assignmentKey='knla:'+crypto.createHash('sha256').update([versionId,resolved.targetType,resolved.targetRef].join('|')).digest('hex');
  const incomingStatus=input.status==='inactive'?'inactive':'active';
  const {data:existing,error:eError}=await db.from('knl_framework_assignments').select('id').eq('assignment_key',assignmentKey).maybeSingle();throwDb(eError);
  /* Chỉ version đã published + is_locked=true mới bất biến (đúng invariant
   * Survey đang dùng ở listPublishedVersions, lib/knl-surveys.js) — draft có
   * thể bị sửa nội dung bất cứ lúc nào nên KHÔNG được dùng làm căn cứ tạo/duy
   * trì assignment ACTIVE (create/reactivate/update-active). Từng bị lọt qua
   * UI 1 lần (PHF042 accidental save 2026-08-18), residual đã audit
   * KNL-06/KNL-13. NGOẠI LỆ DUY NHẤT: deactivate 1 row ĐÃ TỒN TẠI (existing
   * khác null) sang inactive — thao tác dọn dẹp hợp lệ, đúng path rollback
   * PHF042 — không được để guard này chặn dù version hiện không còn eligible.
   * KHÔNG áp dụng ngoại lệ cho việc TẠO MỚI 1 row inactive (existing=null):
   * đó vẫn là ghi assignment tới version không hợp lệ, phải chặn như thường. */
  const requireEligibleVersion=!(existing&&incomingStatus==='inactive');
  if(requireEligibleVersion&&(version.status!=='published'||version.is_locked!==true))fail('Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng.',409,'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED');
  const row={assignment_key:assignmentKey,version_id:versionId,target_type:resolved.targetType,target_ref:resolved.targetRef,employee_code:resolved.employeeCode,position_ref:resolved.positionRef,organization_snapshot:resolved.snapshot,is_primary:input.isPrimary===true,status:incomingStatus,valid_from:text(input.validFrom)||new Date().toISOString().slice(0,10),valid_to:text(input.validTo)||null,reason,updated_by:a.id,updated_by_name:a.name,updated_at:new Date().toISOString()};
  const write=existing?db.from('knl_framework_assignments').update(row).eq('id',existing.id):db.from('knl_framework_assignments').insert({...row,created_by:a.id,created_by_name:a.name});
  const {data,error}=await write.select('*').single();throwDb(error);return{assignment:{id:data.id,assignmentKey:data.assignment_key,versionId:data.version_id,targetType:data.target_type,targetRef:data.target_ref,employeeCode:data.employee_code||'',positionRef:data.position_ref||'',organizationSnapshot:data.organization_snapshot||{},isPrimary:data.is_primary===true,status:data.status,reason:data.reason}};
}

module.exports={manifest,seedPreview,previewKnlSourceSeed,seedKnlSourceManifest,listKnlSourceManifests,listKnlAssignmentTargets,listKnlFrameworkAssignments,saveKnlFrameworkAssignment};
