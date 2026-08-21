'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const hasEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = hasEnv ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {auth:{persistSession:false,autoRefreshToken:false}}) : null;
const TEMPLATE_TABLE='checklist_templates';
const VERSION_TABLE='checklist_template_versions';

function text(v){return String(v==null?'':v).trim();}
function date(v){const s=text(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)){const e=new Error('Ngày hiệu lực mẫu Checklist không hợp lệ.');e.statusCode=400;e.code='CHECKLIST_TEMPLATE_DATE_INVALID';throw e;}return s;}
function schemaMissing(error){return error && (error.code==='42P01'||/does not exist|schema cache/i.test(String(error.message||'')));}
function ensureAdmin(session){if(!session||session.role!=='admin'){const e=new Error('Chỉ Admin được cập nhật thư viện mẫu Checklist.');e.statusCode=403;e.code='CHECKLIST_TEMPLATE_ADMIN_REQUIRED';throw e;}}
function cleanDefinition(value){
  const source=value&&typeof value==='object'?value:{};
  return {
    groups:Array.isArray(source.groups)?source.groups:[],
    totalRows:Array.isArray(source.totalRows)?source.totalRows:[],
    templateType:text(source.templateType)||'checklist_detail'
  };
}
function failValidation(message,code){const e=new Error(message);e.statusCode=400;e.code=code;throw e;}
/*
 * Workstream A1 (2026-08-14) — nhận diện dòng "nguồn tự động từ Checklist"
 * (source.type==='checklist_total') bằng field tường minh trước, KHÔNG dò chuỗi tên.
 * Chấp nhận cả row dạng object mới lẫn row dạng mảng cũ có gắn source={type:...} ở
 * phần tử thứ 8 (index 7) — builder mới ghi vào đó, không phá độ dài mảng cũ.
 */
function rowSourceType(row){
  if(Array.isArray(row)){const s=row[7];return s&&typeof s==='object'?text(s.type):'';}
  if(row&&typeof row.source==='object'&&row.source)return text(row.source.type);
  return text(row&&row.sourceType);
}
function isChecklistTotalRow(row){return rowSourceType(row)==='checklist_total';}
/*
 * "Connection gate" — nếu definition khai báo templateType='checklist_detail' hoặc có
 * groups (tức mẫu có tiêu chí được ghi nhận qua checklist_violation_records, xem
 * checklistBreakdown() trong lib/checklist-monthly.js), thì Bảng tổng điểm BẮT BUỘC có
 * ít nhất 1 dòng source.type='checklist_total' để checklist_score cộng vào Total/Final.
 * Đây chính là gate chặn tái diễn bug: "checklist_score tính đúng nhưng không nối vào
 * Total/Final" đã xảy ra ở 6 mẫu (TBP Marketing, NV Media Marketing, 4 mẫu Kế toán).
 */
function requiresChecklistTotalRow(definition){
  const groups=definition&&Array.isArray(definition.groups)?definition.groups:[];
  return text(definition&&definition.templateType)==='checklist_detail'||groups.length>0;
}
function validateScoredDefinition(definition){
  const rows=definition&&Array.isArray(definition.totalRows)?definition.totalRows:[];
  if(!rows.length)failValidation('Mẫu phải có ít nhất một tiêu chí áp dụng.','CHECKLIST_TEMPLATE_CRITERIA_REQUIRED');
  let totalWeight=0;
  rows.forEach((row,index)=>{
    const target=Number(Array.isArray(row)?row[3]:row&&row.target),weight=Number(Array.isArray(row)?row[5]:row&&row.weight),label=Array.isArray(row)?text(row[1]):text(row&&row.code);
    if(!Number.isFinite(target)||target<=0)failValidation('Mục tiêu tiêu chí '+(label||('dòng '+(index+1)))+' phải là số lớn hơn 0.','CHECKLIST_TEMPLATE_TARGET_INVALID');
    if(!Number.isFinite(weight)||weight<=0)failValidation('Trọng số tiêu chí '+(label||('dòng '+(index+1)))+' phải lớn hơn 0. Tiêu chí không áp dụng phải bỏ khỏi mẫu.','CHECKLIST_TEMPLATE_WEIGHT_INVALID');
    totalWeight+=weight;
  });
  if(Math.abs(totalWeight-100)>0.001)failValidation('Tổng trọng số mẫu phải bằng 100% (hiện tại '+(Math.round(totalWeight*100)/100)+'%).','CHECKLIST_TEMPLATE_TOTAL_WEIGHT_INVALID');
  if(requiresChecklistTotalRow(definition)&&!rows.some(isChecklistTotalRow))failValidation('Mẫu có nhóm tiêu chí Checklist nhưng Bảng tổng điểm chưa có dòng nhận điểm Checklist (source.type=checklist_total). Vui lòng thêm dòng Tuân thủ Checklist trước khi lưu.','CHECKLIST_TEMPLATE_CHECKLIST_TOTAL_ROW_MISSING');
  return {totalWeight};
}
function normalizeTemplate(row){
  const key=text(row.templateKey||row.template_key||row.id).toLowerCase();
  const code=text(row.code).toUpperCase();
  if(!key||!code){const e=new Error('Thiếu mã hoặc khóa mẫu Checklist.');e.statusCode=400;e.code='CHECKLIST_TEMPLATE_KEY_REQUIRED';throw e;}
  return {
    template_key:key,
    code,
    name:text(row.name),
    group_name:text(row.groupName||row.group_name),
    template_type:text(row.templateType||row.template_type)||'checklist_detail',
    has_checklist:Boolean(row.hasChecklist!==undefined?row.hasChecklist:row.has_checklist),
    source:text(row.source),
    note:text(row.note),
    status:text(row.status)||'active',
    current_version:text(row.version||row.currentVersion||row.current_version),
    effective_date:date(row.effectiveDate||row.effective_date),
    updated_at:new Date().toISOString(),
    expected_updated_at:text(row.expectedUpdatedAt||row.expected_updated_at)||null,
    expected_absent:row.expectedAbsent===true||row.expected_absent===true
  };
}
function normalizeVersion(row){
  const key=text(row.templateKey||row.template_key||row.id).toLowerCase();
  const version=text(row.version||row.version_no);
  if(!key||!version){const e=new Error('Thiếu khóa mẫu hoặc phiên bản.');e.statusCode=400;e.code='CHECKLIST_TEMPLATE_VERSION_REQUIRED';throw e;}
  return {
    template_key:key,
    version_no:version,
    effective_date:date(row.effectiveDate||row.effective_date),
    reason:text(row.reason)||'Đồng bộ thư viện mẫu Checklist',
    source_version:text(row.sourceVersion||row.source_version),
    change_type:text(row.changeType||row.change_type)||'sync',
    definition:cleanDefinition(row.definition),
    created_at:new Date().toISOString()
  };
}
function publicTemplate(t,versions){
  const all=(versions||[]).filter(v=>v.template_key===t.template_key).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const current=all.find(v=>v.version_no===t.current_version)||all[0]||null;
  return {
    templateKey:t.template_key,code:t.code||'',name:t.name||'',groupName:t.group_name||'',templateType:t.template_type||'checklist_detail',hasChecklist:Boolean(t.has_checklist),source:t.source||'',note:t.note||'',status:t.status||'active',version:t.current_version||'',effectiveDate:t.effective_date||'',definition:current&&current.definition?current.definition:{groups:[],totalRows:[],templateType:t.template_type||'checklist_detail'},reason:current&&current.reason||'',sourceVersion:current&&current.source_version||'',changeType:current&&current.change_type||'',updatedAt:t.updated_at||'',versions:all.map(v=>({version:v.version_no,effectiveDate:v.effective_date||'',reason:v.reason||'',sourceVersion:v.source_version||'',changeType:v.change_type||'',createdAt:v.created_at||'',definition:v.definition||{groups:[],totalRows:[],templateType:t.template_type||'checklist_detail'}}))
  };
}
async function listChecklistTemplates(options={}){
  if(!supabase)return {templates:[],ready:false,error:'SUPABASE_NOT_CONFIGURED'};
  const compact=options&&options.compact===true;
  if(!compact){
    const [{data:templates,error:te},{data:versions,error:ve}]=await Promise.all([
      supabase.from(TEMPLATE_TABLE).select('*').order('name',{ascending:true}),
      supabase.from(VERSION_TABLE).select('*').order('created_at',{ascending:false})
    ]);
    if(te||ve){const error=te||ve;if(schemaMissing(error))return {templates:[],ready:false,error:'CHECKLIST_TEMPLATE_SCHEMA_MISSING'};throw error;}
    return {templates:(templates||[]).map(t=>publicTemplate(t,versions||[])),ready:true,error:''};
  }
  /* Workspace Ghi nhận lỗi chỉ cần phiên bản đang áp dụng để dựng tiêu chí.
     Không tải toàn bộ lịch sử definition của mọi phiên bản ở bootstrap. */
  const parentResult=await supabase.from(TEMPLATE_TABLE)
    .select('template_key,code,name,group_name,template_type,has_checklist,source,note,status,current_version,effective_date,updated_at')
    .order('name',{ascending:true});
  if(parentResult.error){if(schemaMissing(parentResult.error))return {templates:[],ready:false,error:'CHECKLIST_TEMPLATE_SCHEMA_MISSING'};throw parentResult.error;}
  const parents=parentResult.data||[],keys=parents.map(x=>text(x.template_key)).filter(Boolean),versionNos=parents.map(x=>text(x.current_version)).filter(Boolean);
  let currentVersions=[];
  if(keys.length&&versionNos.length){
    const versionResult=await supabase.from(VERSION_TABLE)
      .select('template_key,version_no,effective_date,reason,source_version,change_type,definition,created_at')
      .in('template_key',keys).in('version_no',[...new Set(versionNos)]);
    if(versionResult.error){if(schemaMissing(versionResult.error))return {templates:[],ready:false,error:'CHECKLIST_TEMPLATE_SCHEMA_MISSING'};throw versionResult.error;}
    currentVersions=(versionResult.data||[]).filter(v=>parents.some(t=>t.template_key===v.template_key&&t.current_version===v.version_no));
  }
  return {templates:parents.map(t=>publicTemplate(t,currentVersions)),ready:true,error:'',compact:true};
}
async function saveOne(session,row){
  ensureAdmin(session);
  if(!supabase){const e=new Error('Supabase chưa được cấu hình.');e.statusCode=503;e.code='SUPABASE_NOT_CONFIGURED';throw e;}
  const template=normalizeTemplate(row),version=normalizeVersion({...row,templateKey:template.template_key});
  validateScoredDefinition(version.definition);
  const actorId=text(session.account?.id||session.sub),actorName=text(session.account?.name||session.account?.email||session.email);
  template.created_by=actorId;template.created_by_name=actorName;
  version.created_by=actorId;version.created_by_name=actorName;
  const saved=await supabase.rpc('phf_save_checklist_template',{p_template:template,p_version:version,p_actor_id:actorId,p_actor_name:actorName});
  if(saved.error){
    if(/CHECKLIST_TEMPLATE_STALE/i.test(String(saved.error.message||''))){const e=new Error('Mẫu đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi lưu tiếp.');e.statusCode=409;e.code='CHECKLIST_TEMPLATE_STALE';throw e;}
    /*
     * Residual B (2026-08-14) — phf_save_checklist_template (SQL fix:
     * scripts/PHF_CHECKLIST_TEMPLATE_VERSION_IMMUTABLE_FIX_1.54.0.sql) không
     * còn "on conflict ... do update" ghi đè âm thầm definition của một
     * version_no đã tồn tại. Nếu payload gửi lên KHÁC nội dung với bản đã lưu
     * cho đúng (template_key, version_no), RPC từ chối bằng mã này thay vì
     * ghi đè lịch sử — bắt buộc người lưu chọn version_no mới. Payload giống
     * hệt bản đã lưu (double-click/retry) là no-op an toàn ở tầng SQL, không
     * rơi vào nhánh lỗi này.
     */
    if(/CHECKLIST_TEMPLATE_VERSION_IMMUTABLE/i.test(String(saved.error.message||''))){const e=new Error('Phiên bản "'+version.version_no+'" của mẫu này đã tồn tại với nội dung khác. Phiên bản đã lưu không được sửa lại — vui lòng đặt một version_no mới (ví dụ thêm hậu tố -r2) rồi lưu lại.');e.statusCode=409;e.code='CHECKLIST_TEMPLATE_VERSION_IMMUTABLE';throw e;}
    if(schemaMissing(saved.error)||/phf_save_checklist_template/i.test(String(saved.error.message||''))){const e=new Error('Chưa chạy SQL ổn định Production cho thư viện mẫu Checklist.');e.statusCode=503;e.code='CHECKLIST_TEMPLATE_STABILITY_SQL_MISSING';throw e;}
    throw saved.error;
  }
  const [parentResult,versionResult]=await Promise.all([
    supabase.from(TEMPLATE_TABLE).select('*').eq('template_key',template.template_key).single(),
    supabase.from(VERSION_TABLE).select('*').eq('template_key',template.template_key).order('created_at',{ascending:false})
  ]);
  if(parentResult.error)throw parentResult.error;if(versionResult.error)throw versionResult.error;
  return publicTemplate(parentResult.data,versionResult.data||[]);
}
async function saveChecklistTemplate(session,row){return {template:await saveOne(session,row)};}
function uniqueCodes(rows){
  const used=new Set();
  return rows.map((row,index)=>{
    const copy={...row};
    let code=text(copy.code).toUpperCase().replace(/[^A-Z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    if(!code)code=text(copy.templateKey||copy.template_key||`MAU-${index+1}`).toUpperCase().replace(/[^A-Z0-9-]/g,'-');
    let candidate=code.slice(0,40)||`MAU-${index+1}`;
    if(used.has(candidate)){
      const suffix='-'+text(copy.templateKey||copy.template_key||index+1).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(-8);
      candidate=(candidate.slice(0,Math.max(1,40-suffix.length))+suffix).slice(0,40);
      let n=2;
      while(used.has(candidate)){
        const more='-'+n++;
        candidate=(candidate.slice(0,Math.max(1,40-more.length))+more).slice(0,40);
      }
    }
    used.add(candidate);
    copy.code=candidate;
    return copy;
  });
}
async function saveChecklistTemplateLibrary(session,rows){
  ensureAdmin(session);
  if(!supabase){const e=new Error('Supabase chưa được cấu hình.');e.statusCode=503;e.code='SUPABASE_NOT_CONFIGURED';throw e;}
  const source=uniqueCodes(Array.isArray(rows)?rows:[]),saved=[],failures=[];
  for(const row of source){
    try{saved.push(await saveOne(session,row));}
    catch(error){failures.push({templateKey:text(row.templateKey||row.template_key||row.id),code:text(row.code),message:error.message||'Không thể lưu mẫu.',codeName:error.code||'CHECKLIST_TEMPLATE_SAVE_FAILED'});}
  }
  const snapshot=await listChecklistTemplates();
  return {saved:saved.length,failed:failures.length,failures,templates:snapshot.templates||saved};
}
module.exports={listChecklistTemplates,saveChecklistTemplate,saveChecklistTemplateLibrary,validateScoredDefinition,isChecklistTotalRow,requiresChecklistTotalRow,rowSourceType};
