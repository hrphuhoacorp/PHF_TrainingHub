'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { requireManageFrameworkForSession } = require('./knl-permissions');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth:{persistSession:false,autoRefreshToken:false} }) : null;
const TABLES = Object.freeze({ group:'knl_competency_groups', item:'knl_competency_items', column:'knl_structure_columns' });
const COLUMN_TYPES = new Set(['item','description','level']);

function text(value){ return String(value == null ? '' : value).trim(); }
function fail(message,statusCode=400,code='KNL_STRUCTURE_INVALID'){ const error=new Error(message);error.statusCode=statusCode;error.code=code;throw error; }
function ensureDb(){ if(!db) fail('Supabase chưa được cấu hình cho KNL.',503,'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error){
  if(!error)return;
  const code=text(error.code),message=text(error.message);
  if(code==='PGRST205'||code==='42P01'||/Could not find the table|relation .* does not exist/i.test(message)) fail('Schema KNL Batch 1 chưa được cài đặt. Hãy chạy scripts/PHF_KNL_FRAMEWORK_VERSION_DYNAMIC_1.47.0.sql.',503,'KNL_BATCH1_SCHEMA_MISSING');
  if(code==='55000'||/KNL_VERSION_IMMUTABLE/.test(message)) fail('Version đã khóa hoặc không còn là Draft; hãy tạo version mới để chỉnh sửa.',409,'KNL_VERSION_IMMUTABLE');
  throw error;
}
function actor(session){ return { id:text(session?.account?.id||session?.sub)||null,name:text(session?.account?.name||session?.account?.email||session?.email)||null }; }
function auditFields(session,isCreate){ const a=actor(session),now=new Date().toISOString();return isCreate?{created_by:a.id,created_by_name:a.name,updated_by:a.id,updated_by_name:a.name,updated_at:now}:{updated_by:a.id,updated_by_name:a.name,updated_at:now}; }
function requireUuid(value,label='ID'){ const v=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))fail(label+' không hợp lệ.',400,'KNL_ID_INVALID');return v; }
function normalizeCode(value){ const code=text(value).toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(code))fail('Mã bộ KNL chỉ gồm A-Z, 0-9, gạch dưới/gạch ngang và dài 2-50 ký tự.',400,'KNL_FRAMEWORK_CODE_INVALID');return code; }
function normalizeOrder(ids){ if(!Array.isArray(ids)||!ids.length)fail('Danh sách sắp xếp không được rỗng.',400,'KNL_REORDER_EMPTY');const clean=ids.map(id=>requireUuid(id));if(new Set(clean).size!==clean.length)fail('Danh sách sắp xếp có ID trùng.',400,'KNL_REORDER_DUPLICATE');return clean; }
function publicFramework(row,versions=[]){ return {id:row.id,code:row.code,name:row.name,description:row.description||'',status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,versions}; }
function publicVersion(row){ return {id:row.id,frameworkId:row.framework_id,versionNumber:row.version_number,name:row.name,description:row.description||'',status:row.status,isLocked:row.is_locked===true,lockedReason:row.locked_reason||'',basedOnVersionId:row.based_on_version_id||'',publishedAt:row.published_at||'',lifecycleStatus:row.lifecycle_status||'DRAFT',effectiveFrom:row.effective_from||'',effectiveTo:row.effective_to||'',activatedAt:row.activated_at||'',updatedAt:row.updated_at}; }
function publicGroup(row){ return {id:row.id,versionId:row.version_id,name:row.name,description:row.description||'',sortOrder:row.sort_order,isActive:row.is_active!==false}; }
function publicItem(row){ return {id:row.id,versionId:row.version_id,groupId:row.group_id,name:row.name,description:row.description||'',sortOrder:row.sort_order,isActive:row.is_active!==false}; }
function publicColumn(row){ return {id:row.id,versionId:row.version_id,type:row.column_type,label:row.label,levelNumber:row.level_number,sortOrder:row.sort_order,isActive:row.is_active!==false}; }

async function authorize(session){ ensureDb();return requireManageFrameworkForSession(session); }

async function listKnlFrameworks(session){
  await authorize(session);
  const [{data:frameworks,error:fError},{data:versions,error:vError}]=await Promise.all([
    db.from('knl_frameworks').select('*').order('updated_at',{ascending:false}),
    db.from('knl_framework_versions').select('*').order('version_number',{ascending:false})
  ]);
  throwDb(fError);throwDb(vError);
  return {frameworks:(frameworks||[]).map(row=>publicFramework(row,(versions||[]).filter(v=>v.framework_id===row.id).map(publicVersion)))};
}

async function getKnlFrameworkVersion(session,input={}){
  await authorize(session);const versionId=requireUuid(input.versionId||input.version_id,'Version ID');
  const results=await Promise.all([
    db.from('knl_framework_versions').select('*').eq('id',versionId).single(),
    db.from('knl_competency_groups').select('*').eq('version_id',versionId).order('sort_order'),
    db.from('knl_competency_items').select('*').eq('version_id',versionId).order('sort_order'),
    db.from('knl_structure_columns').select('*').eq('version_id',versionId).order('sort_order'),
    db.from('knl_item_level_contents').select('*').eq('version_id',versionId)
  ]);
  results.forEach(result=>throwDb(result.error));
  const version=results[0].data;
  const {data:framework,error}=await db.from('knl_frameworks').select('*').eq('id',version.framework_id).single();throwDb(error);
  return {framework:publicFramework(framework),version:publicVersion(version),groups:(results[1].data||[]).map(publicGroup),items:(results[2].data||[]).map(publicItem),columns:(results[3].data||[]).map(publicColumn),levelContents:(results[4].data||[]).map(row=>({id:row.id,itemId:row.item_id,columnId:row.column_id,content:row.content||''}))};
}

async function createKnlFramework(session,input={}){
  await authorize(session);const a=actor(session);const code=normalizeCode(input.code),name=text(input.name);if(!name)fail('Tên bộ KNL là bắt buộc.');
  const levelCount=Number(input.levelCount||input.level_count||4);if(!Number.isInteger(levelCount)||levelCount<1||levelCount>20)fail('Số mức phải từ 1 đến 20.',400,'KNL_LEVEL_COUNT_INVALID');
  const {data:framework,error:fError}=await db.from('knl_frameworks').insert({code,name,description:text(input.description)||null,status:'draft',...auditFields(session,true)}).select('*').single();throwDb(fError);
  const {data:version,error:vError}=await db.from('knl_framework_versions').insert({framework_id:framework.id,version_number:1,name:text(input.versionName)||'Version 1',description:null,status:'draft',...auditFields(session,true)}).select('*').single();
  if(vError){ await db.from('knl_frameworks').delete().eq('id',framework.id);throwDb(vError); }
  const columns=[{version_id:version.id,column_type:'item',label:'HẠNG MỤC',level_number:null,sort_order:1,is_active:true,...auditFields(session,true)}];
  if(input.includeDescription!==false)columns.push({version_id:version.id,column_type:'description',label:'MÔ TẢ',level_number:null,sort_order:columns.length+1,is_active:true,...auditFields(session,true)});
  for(let n=1;n<=levelCount;n++)columns.push({version_id:version.id,column_type:'level',label:'MỨC ĐỘ '+n,level_number:n,sort_order:columns.length+1,is_active:true,...auditFields(session,true)});
  const {error:cError}=await db.from('knl_structure_columns').insert(columns);if(cError){await db.from('knl_framework_versions').delete().eq('id',version.id);await db.from('knl_frameworks').delete().eq('id',framework.id);throwDb(cError);}
  return {framework:publicFramework(framework,[publicVersion(version)]),version:publicVersion(version)};
}

async function saveKnlFramework(session,input={}){
  await authorize(session);const id=requireUuid(input.id);const name=text(input.name);if(!name)fail('Tên bộ KNL là bắt buộc.');
  const row={name,description:text(input.description)||null,...auditFields(session,false)};
  if(input.status&&['draft','published','inactive'].includes(input.status))row.status=input.status;
  const {data,error}=await db.from('knl_frameworks').update(row).eq('id',id).select('*').single();throwDb(error);return {framework:publicFramework(data)};
}

async function cloneKnlVersion(session,input={}){ await authorize(session);const a=actor(session);const {data,error}=await db.rpc('knl_clone_version',{p_source_version_id:requireUuid(input.versionId),p_name:text(input.name)||null,p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return {version:publicVersion(data)}; }
async function publishKnlVersion(session,input={}){ await authorize(session);const a=actor(session);const {data,error}=await db.rpc('knl_publish_version',{p_version_id:requireUuid(input.versionId),p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return {version:publicVersion(data)}; }

async function nextOrder(table,filters){ let query=db.from(table).select('sort_order');Object.entries(filters).forEach(([key,value])=>{query=query.eq(key,value);});const {data,error}=await query.order('sort_order',{ascending:false}).limit(1);throwDb(error);return data&&data[0]?Number(data[0].sort_order)+1:1; }

async function saveKnlGroup(session,input={}){
  await authorize(session);const name=text(input.name);if(!name)fail('Tên nhóm năng lực là bắt buộc.');const versionId=requireUuid(input.versionId,'Version ID');
  if(input.id){const {data,error}=await db.from(TABLES.group).update({name,description:text(input.description)||null,...auditFields(session,false)}).eq('id',requireUuid(input.id)).eq('version_id',versionId).select('*').single();throwDb(error);return {group:publicGroup(data)};}
  const sortOrder=await nextOrder(TABLES.group,{version_id:versionId});const {data,error}=await db.from(TABLES.group).insert({version_id:versionId,name,description:text(input.description)||null,sort_order:sortOrder,is_active:true,...auditFields(session,true)}).select('*').single();throwDb(error);return {group:publicGroup(data)};
}

async function saveKnlItem(session,input={}){
  await authorize(session);const name=text(input.name);if(!name)fail('Tên hạng mục là bắt buộc.');const versionId=requireUuid(input.versionId,'Version ID'),groupId=requireUuid(input.groupId,'Group ID');
  if(input.id){const {data,error}=await db.from(TABLES.item).update({name,description:text(input.description)||null,...auditFields(session,false)}).eq('id',requireUuid(input.id)).eq('version_id',versionId).eq('group_id',groupId).select('*').single();throwDb(error);return {item:publicItem(data)};}
  const sortOrder=await nextOrder(TABLES.item,{group_id:groupId});const {data,error}=await db.from(TABLES.item).insert({version_id:versionId,group_id:groupId,name,description:text(input.description)||null,sort_order:sortOrder,is_active:true,...auditFields(session,true)}).select('*').single();throwDb(error);return {item:publicItem(data)};
}

async function saveKnlColumn(session,input={}){
  await authorize(session);const versionId=requireUuid(input.versionId,'Version ID'),type=text(input.type);if(!COLUMN_TYPES.has(type))fail('Loại cột không hợp lệ.');const label=text(input.label);if(!label)fail('Nhãn cột là bắt buộc.');
  const levelNumber=type==='level'?Number(input.levelNumber):null;if(type==='level'&&(!Number.isInteger(levelNumber)||levelNumber<1))fail('Số mức phải là số nguyên dương.');
  if(input.id){const {data,error}=await db.from(TABLES.column).update({column_type:type,label,level_number:levelNumber,...auditFields(session,false)}).eq('id',requireUuid(input.id)).eq('version_id',versionId).select('*').single();throwDb(error);return {column:publicColumn(data)};}
  const sortOrder=await nextOrder(TABLES.column,{version_id:versionId});const {data,error}=await db.from(TABLES.column).insert({version_id:versionId,column_type:type,label,level_number:levelNumber,sort_order:sortOrder,is_active:true,...auditFields(session,true)}).select('*').single();throwDb(error);return {column:publicColumn(data)};
}

async function deleteKnlStructure(session,input={}){ await authorize(session);const entity=text(input.entity);if(!TABLES[entity])fail('Loại cấu trúc không hợp lệ.');const {error}=await db.from(TABLES[entity]).delete().eq('id',requireUuid(input.id));throwDb(error);return {deleted:true}; }
async function disableKnlStructure(session,input={}){ await authorize(session);const entity=text(input.entity);if(!TABLES[entity])fail('Loại cấu trúc không hợp lệ.');const {data,error}=await db.from(TABLES[entity]).update({is_active:false,...auditFields(session,false)}).eq('id',requireUuid(input.id)).select('id').single();throwDb(error);return {disabledId:data.id}; }
async function reorderKnlStructure(session,input={}){ await authorize(session);const entity=text(input.entity);if(!TABLES[entity])fail('Loại cấu trúc không hợp lệ.');const a=actor(session);const {data,error}=await db.rpc('knl_reorder_structure',{p_entity:entity,p_parent_id:requireUuid(input.parentId),p_ordered_ids:normalizeOrder(input.orderedIds),p_actor_id:a.id,p_actor_name:a.name});throwDb(error);return {reordered:Number(data||0)}; }

async function saveKnlLevelContent(session,input={}){
  await authorize(session);const versionId=requireUuid(input.versionId),itemId=requireUuid(input.itemId),columnId=requireUuid(input.columnId);const row={version_id:versionId,item_id:itemId,column_id:columnId,content:text(input.content),...auditFields(session,true)};
  const {data,error}=await db.from('knl_item_level_contents').upsert(row,{onConflict:'item_id,column_id'}).select('*').single();throwDb(error);return {levelContent:{id:data.id,itemId:data.item_id,columnId:data.column_id,content:data.content||''}};
}

module.exports={COLUMN_TYPES,normalizeCode,normalizeOrder,listKnlFrameworks,getKnlFrameworkVersion,createKnlFramework,saveKnlFramework,cloneKnlVersion,publishKnlVersion,saveKnlGroup,saveKnlItem,saveKnlColumn,deleteKnlStructure,disableKnlStructure,reorderKnlStructure,saveKnlLevelContent};
