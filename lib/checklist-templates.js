'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const hasEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = hasEnv ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {auth:{persistSession:false,autoRefreshToken:false}}) : null;
const TEMPLATE_TABLE='checklist_templates';
const VERSION_TABLE='checklist_template_versions';

function text(v){return String(v==null?'':v).trim();}
function date(v){const s=text(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:new Date().toISOString().slice(0,10);}
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
    updated_at:new Date().toISOString()
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
async function listChecklistTemplates(){
  if(!supabase)return {templates:[],ready:false,error:'SUPABASE_NOT_CONFIGURED'};
  const [{data:templates,error:te},{data:versions,error:ve}]=await Promise.all([
    supabase.from(TEMPLATE_TABLE).select('*').order('name',{ascending:true}),
    supabase.from(VERSION_TABLE).select('*').order('created_at',{ascending:false})
  ]);
  if(te||ve){const error=te||ve;if(schemaMissing(error))return {templates:[],ready:false,error:'CHECKLIST_TEMPLATE_SCHEMA_MISSING'};throw error;}
  return {templates:(templates||[]).map(t=>publicTemplate(t,versions||[])),ready:true,error:''};
}
async function saveOne(session,row){
  ensureAdmin(session);
  if(!supabase){const e=new Error('Supabase chưa được cấu hình.');e.statusCode=503;e.code='SUPABASE_NOT_CONFIGURED';throw e;}
  const template=normalizeTemplate(row),version=normalizeVersion({...row,templateKey:template.template_key});
  const actorId=text(session.account?.id||session.sub),actorName=text(session.account?.name||session.account?.email||session.email);
  template.created_by=actorId;template.created_by_name=actorName;
  version.created_by=actorId;version.created_by_name=actorName;
  let result=await supabase.from(TEMPLATE_TABLE).upsert(template,{onConflict:'template_key'}).select('*').single();
  if(result.error){if(schemaMissing(result.error)){const e=new Error('Chưa cài cấu trúc database thư viện mẫu Checklist 1.7.90.');e.statusCode=503;e.code='CHECKLIST_TEMPLATE_SCHEMA_MISSING';throw e;}throw result.error;}
  const vr=await supabase.from(VERSION_TABLE).upsert(version,{onConflict:'template_key,version_no'}).select('*').single();
  if(vr.error)throw vr.error;
  return publicTemplate(result.data,[vr.data]);
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
  const source=uniqueCodes(Array.isArray(rows)?rows:[]);
  const actorId=text(session.account?.id||session.sub),actorName=text(session.account?.name||session.account?.email||session.email);
  const normalized=[];
  const failures=[];
  for(const row of source){
    try{
      const template=normalizeTemplate(row),version=normalizeVersion({...row,templateKey:template.template_key});
      template.created_by=actorId;template.created_by_name=actorName;
      version.created_by=actorId;version.created_by_name=actorName;
      normalized.push({template,version});
    }catch(error){
      failures.push({templateKey:text(row.templateKey||row.template_key||row.id),code:text(row.code),message:error.message||'Dữ liệu mẫu không hợp lệ.',codeName:error.code||'CHECKLIST_TEMPLATE_INVALID'});
    }
  }
  const saved=[];
  if(normalized.length){
    const parents=normalized.map(x=>x.template);
    const parentResult=await supabase.from(TEMPLATE_TABLE).upsert(parents,{onConflict:'template_key'}).select('*');
    if(parentResult.error){
      if(schemaMissing(parentResult.error)){const e=new Error('Chưa cài cấu trúc database thư viện mẫu Checklist 1.7.90.');e.statusCode=503;e.code='CHECKLIST_TEMPLATE_SCHEMA_MISSING';throw e;}
      const e=new Error(parentResult.error.message||'Không thể lưu danh mục mẫu hiện hành.');e.statusCode=500;e.code=parentResult.error.code||'CHECKLIST_TEMPLATE_PARENT_UPSERT_FAILED';throw e;
    }
    const parentMap=new Map((parentResult.data||[]).map(x=>[x.template_key,x]));
    for(const item of normalized){
      try{
        const vr=await supabase.from(VERSION_TABLE).upsert(item.version,{onConflict:'template_key,version_no'}).select('*').single();
        if(vr.error)throw vr.error;
        const parent=parentMap.get(item.template.template_key)||item.template;
        saved.push(publicTemplate(parent,[vr.data]));
      }catch(error){
        failures.push({templateKey:item.template.template_key,code:item.template.code,message:error.message||'Không thể lưu phiên bản mẫu.',codeName:error.code||'CHECKLIST_TEMPLATE_VERSION_UPSERT_FAILED'});
      }
    }
  }
  const snapshot=await listChecklistTemplates();
  return {saved:saved.length,failed:failures.length,failures,templates:snapshot.templates||saved};
}
module.exports={listChecklistTemplates,saveChecklistTemplate,saveChecklistTemplateLibrary};
