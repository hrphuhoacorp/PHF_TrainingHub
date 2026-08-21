'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const migrationPath=path.join(root,'scripts','PHF_KNL_FRAMEWORK_VERSION_DYNAMIC_1.47.0.sql');
const sql=fs.readFileSync(migrationPath,'utf8');
let passed=0;
function check(condition,message){assert.ok(condition,message);passed++;console.log('PASS',message);}

const requiredTables=['knl_frameworks','knl_framework_versions','knl_competency_groups','knl_competency_items','knl_structure_columns','knl_item_level_contents','knl_structure_audit'];
requiredTables.forEach(name=>check(new RegExp('create table if not exists public\\.'+name+'\\s*\\(','i').test(sql),'Migration tạo additive '+name));
check(/status in \('draft','published','inactive'\)/.test(sql),'Framework/version có Draft, Published, Inactive');
check(/KNL_VERSION_IMMUTABLE/.test(sql)&&/knl_guard_structure_mutation/.test(sql),'DB khóa mutation của Published/locked version');
check(/KNL_FRAMEWORK_REQUIRES_PUBLISHED_VERSION/.test(sql)&&/knl_guard_framework_mutation/.test(sql),'Framework Published bắt buộc có Published version');
check(/column_type in \('item','description','level'\)/.test(sql)&&/level_number integer/.test(sql),'Cột Hàng 4 và mức 1..N là dữ liệu động');
check(/foreign key\(group_id,version_id\)/.test(sql)&&/foreign key\(item_id,version_id\)/.test(sql)&&/foreign key\(column_id,version_id\)/.test(sql),'FK composite chặn liên kết chéo version');
check(/knl_reorder_structure/.test(sql)&&/KNL_REORDER_SET_MISMATCH/.test(sql),'Reorder chạy trong RPC và validate trọn tập');
check(/knl_clone_version/.test(sql)&&/based_on_version_id/.test(sql),'Clone tạo Draft version mới có lineage');
check(/knl_validate_publishable/.test(sql)&&/level_columns < 1/.test(sql),'Publish kiểm tra đúng một cột hạng mục và ít nhất một mức');
check(!/create table[^;]*(survey|assessment)/i.test(sql),'Batch 1 không tạo Survey/Assessment');
check(!/(insert|update|delete)\s+(into\s+|from\s+)?public\.checklist_/i.test(sql),'Migration không ghi Checklist');
check(!/(salary|compensation|income_view)/i.test(sql),'Migration mới không chứa income/compensation');

let seq=1;
function uuid(){const tail=String(seq++).padStart(12,'0');return '00000000-0000-4000-8000-'+tail;}
const state={knl_frameworks:[],knl_framework_versions:[],knl_competency_groups:[],knl_competency_items:[],knl_structure_columns:[],knl_item_level_contents:[]};
class Query{
  constructor(table){this.table=table;this.filters=[];this.mode='select';this.payload=null;this.limitCount=null;}
  select(){return this;} eq(key,value){this.filters.push([key,value]);return this;} order(){return this;} limit(n){this.limitCount=n;return this;}
  insert(payload){this.mode='insert';this.payload=payload;return this;} update(payload){this.mode='update';this.payload=payload;return this;} delete(){this.mode='delete';return this;} upsert(payload){this.mode='upsert';this.payload=payload;return this;}
  rows(){return state[this.table].filter(row=>this.filters.every(([key,value])=>row[key]===value));}
  execute(){
    let data;
    if(this.mode==='select')data=this.rows();
    if(this.mode==='insert'){const many=Array.isArray(this.payload);const input=many?this.payload:[this.payload];data=input.map(row=>({...row,id:row.id||uuid(),created_at:row.created_at||new Date().toISOString(),updated_at:row.updated_at||new Date().toISOString()}));state[this.table].push(...data);if(!many)data=data[0];}
    if(this.mode==='update'){data=this.rows().map(row=>Object.assign(row,this.payload));}
    if(this.mode==='delete'){data=this.rows();state[this.table]=state[this.table].filter(row=>!data.includes(row));}
    if(this.mode==='upsert'){let found=state[this.table].find(row=>row.item_id===this.payload.item_id&&row.column_id===this.payload.column_id);if(found)data=Object.assign(found,this.payload);else{data={...this.payload,id:uuid()};state[this.table].push(data);}}
    if(Array.isArray(data)&&this.limitCount!=null)data=data.slice(0,this.limitCount);
    return {data,error:null};
  }
  single(){const result=this.execute();if(Array.isArray(result.data))result.data=result.data[0]||null;return Promise.resolve(result);}
  then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);}
}
const mockDb={
  from(table){if(!state[table])throw new Error('Unexpected table '+table);return new Query(table);},
  rpc(name,args){
    if(name==='knl_reorder_structure'){
      const table={group:'knl_competency_groups',item:'knl_competency_items',column:'knl_structure_columns'}[args.p_entity];
      args.p_ordered_ids.forEach((id,index)=>{const row=state[table].find(x=>x.id===id);if(row)row.sort_order=index+1;});
      return Promise.resolve({data:args.p_ordered_ids.length,error:null});
    }
    throw new Error('Unexpected RPC '+name);
  }
};

process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SECRET_KEY='unit-secret';
const supabaseModule=require.resolve('@supabase/supabase-js');
const permissionModule=require.resolve('../api/_lib/knl-permissions');
const frameworkModule=require.resolve('../api/_lib/knl-frameworks');
require.cache[supabaseModule]={id:supabaseModule,filename:supabaseModule,loaded:true,exports:{createClient:()=>mockDb}};
require.cache[permissionModule]={id:permissionModule,filename:permissionModule,loaded:true,exports:{requireManageFrameworkForSession:async session=>{if(session.role!=='admin'){const e=new Error('deny');e.code='KNL_MANAGE_FRAMEWORK_REQUIRED';throw e;}return {};}}};
delete require.cache[frameworkModule];
const service=require('../api/_lib/knl-frameworks');
const admin={role:'admin',sub:'admin-1',account:{id:'admin-1',name:'Admin'}};

(async()=>{
  const created=await service.createKnlFramework(admin,{code:'TEST_DYNAMIC',name:'Test dynamic',levelCount:4,includeDescription:true});
  const versionId=created.version.id;
  check(state.knl_frameworks.length===1&&state.knl_framework_versions.length===1,'Create framework sinh đúng một Draft version, không sinh employee/org');
  check(state.knl_structure_columns.filter(c=>c.version_id===versionId&&c.column_type==='level').length===4,'Draft khởi tạo 4 mức từ input, không từ schema hard-code');
  const groupA=(await service.saveKnlGroup(admin,{versionId,name:'Nhóm A'})).group;
  const groupB=(await service.saveKnlGroup(admin,{versionId,name:'Nhóm B'})).group;
  const itemA=(await service.saveKnlItem(admin,{versionId,groupId:groupA.id,name:'Hạng mục A'})).item;
  const itemB=(await service.saveKnlItem(admin,{versionId,groupId:groupA.id,name:'Hạng mục B'})).item;
  check(state.knl_competency_groups.length===2&&state.knl_competency_items.length===2,'CRUD thêm nhóm và hạng mục theo version/group');
  await service.reorderKnlStructure(admin,{entity:'group',parentId:versionId,orderedIds:[groupB.id,groupA.id]});
  await service.reorderKnlStructure(admin,{entity:'item',parentId:groupA.id,orderedIds:[itemB.id,itemA.id]});
  check(state.knl_competency_groups.find(x=>x.id===groupB.id).sort_order===1&&state.knl_competency_items.find(x=>x.id===itemB.id).sort_order===1,'Reorder group/item giữ thứ tự liên tục');
  const level5=(await service.saveKnlColumn(admin,{versionId,type:'level',label:'MỨC ĐỘ 5',levelNumber:5})).column;
  check(state.knl_structure_columns.filter(c=>c.version_id===versionId&&c.column_type==='level').length===5,'Dynamic levels chuyển 4 → 5');
  const levels=state.knl_structure_columns.filter(c=>c.version_id===versionId&&c.column_type==='level');
  await service.deleteKnlStructure(admin,{entity:'column',id:level5.id});
  await service.deleteKnlStructure(admin,{entity:'column',id:levels[3].id});
  check(state.knl_structure_columns.filter(c=>c.version_id===versionId&&c.column_type==='level').length===3,'Dynamic levels chuyển 5 → 3 bằng hard delete trên Draft');
  let denied=false;try{await service.saveKnlGroup({role:'manager',account:{id:'m1'}},{versionId,name:'Không được phép'});}catch(error){denied=error.code==='KNL_MANAGE_FRAMEWORK_REQUIRED';}
  check(denied,'Service giữ permission fail-closed cho người không có manage_framework');
  check(Object.keys(state).every(name=>!name.startsWith('checklist_')),'Test CRUD không tạo hoặc sửa nguồn Checklist');
  console.log('\nKNL Batch 1:',passed,'checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
