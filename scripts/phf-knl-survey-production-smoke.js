'use strict';

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');
const {subjectMatchesScope}=require('../api/_lib/knl-scope');
const {getKnlSurveyResults}=require('../api/_lib/knl-surveys');

const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
const publishable=String(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
assert(url&&secret&&publishable,'Missing Supabase Production environment.');
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const TEST_PREFIX='[SMOKE 1.49.0]';
const runId=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+Math.random().toString(16).slice(2,8);
const created={campaignId:'',cloneVersionId:'',sourceVersionIds:[],assignmentIds:[],frameworkIds:[],permissionGrantId:''};
function check(error,label){if(error){error.message=label+': '+error.message;throw error;}}
function code(error){return String(error?.code||'');}
async function openApi(){const response=await fetch(url+'/rest/v1/',{headers:{apikey:secret,Authorization:'Bearer '+secret}});assert.strictEqual(response.status,200,'OpenAPI unavailable');return response.json();}
async function expectDbError(promise,codes,label){const {error}=await promise;assert(error,label+' unexpectedly succeeded');assert(codes.includes(code(error)),label+' wrong code '+code(error)+' '+error.message);}

async function verifyReadOnly(){
  const spec=await openApi();
  const tables=['knl_survey_campaigns','knl_survey_campaign_versions','knl_survey_campaign_targets','knl_survey_tickets','knl_survey_responses','knl_survey_submission_history','knl_survey_audit'];
  const rpcs=['knl_save_survey_campaign','knl_open_survey_campaign','knl_close_survey_campaign','knl_save_survey_ticket'];
  tables.forEach(name=>assert(spec.paths['/'+name]&&spec.definitions[name],'Missing table '+name));
  rpcs.forEach(name=>assert(spec.paths['/rpc/'+name],'Missing RPC '+name));
  const ticket=spec.definitions.knl_survey_tickets.properties,response=spec.definitions.knl_survey_responses.properties;
  assert(/knl_survey_campaigns/.test(ticket.campaign_id.description||''),'Ticket campaign FK missing');
  assert(/knl_framework_versions/.test(ticket.version_id.description||''),'Ticket version FK missing');
  assert(/knl_competency_items/.test(response.item_id.description||''),'Response item FK missing');
  assert(/knl_structure_columns/.test(response.selected_column_id.description||''),'Response level FK missing');
  const publicDb=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
  const denied=await publicDb.from('knl_survey_campaigns').select('id').limit(1);
  assert(denied.error,'RLS/revoke fail-closed check unexpectedly allowed public read');
  for(const table of tables){const result=await db.from(table).select('*',{head:true,count:'exact'});check(result.error,'service-role read '+table);}
  console.log('PASS read-only schema: 7 tables, FK metadata, 4 RPC, service-role access, public RLS/revoke denied.');
}

async function findFixture(){
  const [{data:assignments,error:ae},{data:versions,error:ve},{data:frameworks,error:fe},{data:people,error:pe}]=await Promise.all([
    db.from('knl_framework_assignments').select('version_id,employee_code').eq('target_type','employee').eq('status','active'),
    db.from('knl_framework_versions').select('id,framework_id,version_number,name,status,is_locked').eq('status','published').eq('is_locked',true),
    db.from('knl_frameworks').select('id,code,name'),
    db.from('checklist_employee_assignments').select('employee_code,employee_name,department,branch,title,position,employee_status')
  ]);check(ae,'assignments');check(ve,'versions');check(fe,'frameworks');check(pe,'people');
  const versionMap=new Map((versions||[]).map(v=>[v.id,v])),frameworkMap=new Map((frameworks||[]).map(f=>[f.id,f]));
  const byEmployee=new Map();for(const a of assignments||[]){const v=versionMap.get(a.version_id);if(!v)continue;const list=byEmployee.get(a.employee_code)||[];if(!list.some(x=>x.framework_id===v.framework_id))list.push(v);byEmployee.set(a.employee_code,list);}
  for(const [employeeCode,list] of byEmployee){if(list.length<2)continue;const person=(people||[]).find(p=>p.employee_code===employeeCode&&p.employee_status!=='Đã nghỉ việc');if(!person)continue;return{person,versions:list.slice(0,2).map(v=>({...v,framework:frameworkMap.get(v.framework_id)}))};}
  const person=(people||[]).find(p=>p.employee_status!=='Đã nghỉ việc'&&(byEmployee.get(p.employee_code)||[]).length)|| (people||[]).find(p=>p.employee_status!=='Đã nghỉ việc');assert(person,'No active organization person for smoke');
  const selected=[...(byEmployee.get(person.employee_code)||[])];for(const v of versions||[]){if(selected.length>=2)break;if(!selected.some(x=>x.framework_id===v.framework_id))selected.push(v);}let manualCampaign=false;
  if(selected.length<2){manualCampaign=true;const suffix=runId.replace(/[^A-Za-z0-9]/g,'').slice(-12).toUpperCase();for(const letter of ['A','B']){const audit={created_by:'smoke-'+runId,created_by_name:'Survey Production Smoke',updated_by:'smoke-'+runId,updated_by_name:'Survey Production Smoke'};const fwResult=await db.from('knl_frameworks').insert({code:'SMOKE1490_'+letter+'_'+suffix,name:TEST_PREFIX+' Framework '+letter,description:'Disposable smoke framework',status:'draft',...audit}).select('*').single();check(fwResult.error,'temporary framework');created.frameworkIds.push(fwResult.data.id);const vResult=await db.from('knl_framework_versions').insert({framework_id:fwResult.data.id,version_number:1,name:'Smoke version 1',status:'draft',is_locked:false,...audit}).select('*').single();check(vResult.error,'temporary version');const gResult=await db.from('knl_competency_groups').insert({version_id:vResult.data.id,name:'Nhóm smoke',sort_order:1,is_active:true,...audit}).select('*').single();check(gResult.error,'temporary group');const iResult=await db.from('knl_competency_items').insert({version_id:vResult.data.id,group_id:gResult.data.id,name:'Hạng mục smoke '+letter,description:'Chỉ dùng cho Production smoke',sort_order:1,is_active:true,...audit}).select('*').single();check(iResult.error,'temporary item');const cResult=await db.from('knl_structure_columns').insert([{version_id:vResult.data.id,column_type:'item',label:'HẠNG MỤC',sort_order:1,is_active:true,...audit},{version_id:vResult.data.id,column_type:'description',label:'MÔ TẢ',sort_order:2,is_active:true,...audit},{version_id:vResult.data.id,column_type:'level',label:'MỨC ĐỘ 1',level_number:1,sort_order:3,is_active:true,...audit},{version_id:vResult.data.id,column_type:'level',label:'MỨC ĐỘ 2',level_number:2,sort_order:4,is_active:true,...audit}]).select('*');check(cResult.error,'temporary columns');const levels=cResult.data.filter(c=>c.column_type==='level');const lcResult=await db.from('knl_item_level_contents').insert(levels.map(c=>({version_id:vResult.data.id,item_id:iResult.data.id,column_id:c.id,content:'Mô tả mức '+c.level_number+' smoke',...audit})));check(lcResult.error,'temporary level contents');selected.push({...vResult.data,framework:fwResult.data});}}
  for(const v of selected.slice(0,2)){if((assignments||[]).some(a=>a.employee_code===person.employee_code&&a.version_id===v.id))continue;const {data,error}=await db.from('knl_framework_assignments').insert({assignment_key:'survey-smoke:'+runId+':'+person.employee_code+':'+v.id,target_type:'employee',target_ref:person.employee_code,employee_code:person.employee_code,position_ref:null,version_id:v.id,organization_snapshot:{employeeCode:person.employee_code,employeeName:person.employee_name,department:person.department,branch:person.branch,title:person.title,position:person.position},is_primary:false,status:'active',reason:TEST_PREFIX+' temporary second-framework fixture',created_by:'smoke-'+runId,created_by_name:'Survey Production Smoke',updated_by:'smoke-'+runId,updated_by_name:'Survey Production Smoke'}).select('id').single();check(error,'temporary assignment');created.assignmentIds.push(data.id);}
  return{person,manualCampaign,versions:selected.slice(0,2).map(v=>({...v,framework:v.framework||frameworkMap.get(v.framework_id)}))};
}

async function structure(versionId){
  const [{data:items,error:ie},{data:levels,error:le}]=await Promise.all([
    db.from('knl_competency_items').select('id,sort_order').eq('version_id',versionId).eq('is_active',true).order('sort_order'),
    db.from('knl_structure_columns').select('id,level_number').eq('version_id',versionId).eq('column_type','level').eq('is_active',true).order('level_number')
  ]);check(ie,'items');check(le,'levels');assert(items.length&&levels.length,'Version has no active items/levels');return{items,levels};
}
function answers(shape,special,comment){return shape.items.map((item,index)=>({itemId:item.id,selectedColumnId:shape.levels[index%shape.levels.length].id,selectedLevelNumber:shape.levels[index%shape.levels.length].level_number,suitability:index===0?special:'SUITABLE',comment:index===0?comment:''}));}
async function saveTicket(ticket,employeeCode,responses,submit,generalFeedback){return db.rpc('knl_save_survey_ticket',{p_ticket_id:ticket.id,p_employee_code:employeeCode,p_responses:responses,p_general_feedback:generalFeedback,p_submit:submit,p_actor_id:'smoke-'+runId,p_actor_name:'Survey Production Smoke'});}

async function cleanup(){
  const errors=[];
  async function del(table,query){const result=await query;if(result.error)errors.push(table+': '+result.error.message);}
  async function deleteVersionTrees(versionIds,label){if(!versionIds.length)return;for(const table of ['knl_item_level_contents','knl_competency_items','knl_competency_groups','knl_structure_columns'])await del(label+' '+table,db.from(table).delete().in('version_id',versionIds));await del(label+' versions',db.from('knl_framework_versions').delete().in('id',versionIds).eq('status','draft').eq('is_locked',false));}
  if(created.campaignId){
    const {data:tickets}=await db.from('knl_survey_tickets').select('id').eq('campaign_id',created.campaignId);const ids=(tickets||[]).map(t=>t.id);
    if(ids.length){await del('history',db.from('knl_survey_submission_history').delete().in('ticket_id',ids));await del('responses',db.from('knl_survey_responses').delete().in('ticket_id',ids));await del('tickets',db.from('knl_survey_tickets').delete().in('id',ids));}
    await del('audit',db.from('knl_survey_audit').delete().eq('entity_id',created.campaignId));
    await del('campaign',db.from('knl_survey_campaigns').delete().eq('id',created.campaignId));
  }
  if(created.cloneVersionId){await deleteVersionTrees([created.cloneVersionId],'clone');await del('clone audit',db.from('knl_structure_audit').delete().eq('version_id',created.cloneVersionId).eq('changed_by','smoke-'+runId));}
  if(created.assignmentIds.length){await del('temporary assignments',db.from('knl_framework_assignments').delete().in('id',created.assignmentIds));await del('temporary assignment history',db.from('knl_framework_assignment_history').delete().in('assignment_id',created.assignmentIds));}
  if(created.permissionGrantId){await del('temporary permission history',db.from('knl_permission_grant_history').delete().eq('grant_id',created.permissionGrantId));await del('temporary permission grant',db.from('knl_permission_grants').delete().eq('id',created.permissionGrantId));}
  if(created.frameworkIds.length){const versions=await db.from('knl_framework_versions').select('id').in('framework_id',created.frameworkIds);if(versions.error)errors.push('temporary version lookup: '+versions.error.message);else await deleteVersionTrees((versions.data||[]).map(v=>v.id),'temporary');await del('temporary frameworks',db.from('knl_frameworks').delete().in('id',created.frameworkIds).eq('status','draft'));await del('temporary structure audit',db.from('knl_structure_audit').delete().eq('changed_by','smoke-'+runId));}
  if(errors.length)throw new Error('SMOKE CLEANUP FAILED: '+errors.join(' | '));
}

async function smoke(){
  const fixture=await findFixture(),person=fixture.person,versionIds=fixture.versions.map(v=>v.id);created.sourceVersionIds=versionIds;
  console.log('Fixture:',person.employee_code,'with',fixture.versions.map(v=>v.framework.code+' v'+v.version_number).join(', '));
  const startsAt=new Date(Date.now()-60000).toISOString(),endsAt=new Date(Date.now()+30*60000).toISOString();
  let campaignId;if(fixture.manualCampaign){const c=await db.from('knl_survey_campaigns').insert({name:TEST_PREFIX+' '+runId,description:'Disposable Production integration smoke',starts_at:startsAt,ends_at:endsAt,created_by:'smoke-'+runId,created_by_name:'Survey Production Smoke',updated_by:'smoke-'+runId,updated_by_name:'Survey Production Smoke'}).select('id').single();check(c.error,'manual smoke campaign');campaignId=c.data.id;created.campaignId=campaignId;const cv=await db.from('knl_survey_campaign_versions').insert(fixture.versions.map(v=>({campaign_id:campaignId,version_id:v.id,framework_id:v.framework_id,framework_code:v.framework.code,framework_name:v.framework.name,version_number:v.version_number,version_name:v.name})));check(cv.error,'manual campaign versions');const ct=await db.from('knl_survey_campaign_targets').insert({campaign_id:campaignId,employee_code:person.employee_code,employee_name:person.employee_name,organization_snapshot:{employeeCode:person.employee_code,employeeName:person.employee_name,department:person.department,branch:person.branch,title:person.title,position:person.position,status:person.employee_status}});check(ct.error,'manual campaign target');}else{const saved=await db.rpc('knl_save_survey_campaign',{p_campaign:{name:TEST_PREFIX+' '+runId,description:'Disposable Production integration smoke',startsAt,endsAt},p_version_ids:versionIds,p_targets:[{employeeCode:person.employee_code,employeeName:person.employee_name,organizationSnapshot:{employeeCode:person.employee_code,employeeName:person.employee_name,department:person.department,branch:person.branch,title:person.title,position:person.position,status:person.employee_status}}],p_actor_id:'smoke-'+runId,p_actor_name:'Survey Production Smoke'});check(saved.error,'save campaign');campaignId=saved.data;created.campaignId=campaignId;}
  const firstOpen=await db.rpc('knl_open_survey_campaign',{p_campaign_id:campaignId,p_actor_id:'smoke-'+runId,p_actor_name:'Survey Production Smoke'});check(firstOpen.error,'open campaign');assert.strictEqual(Number(firstOpen.data),2,'1 employee + 2 KNL must create 2 tickets');
  const retry=await db.rpc('knl_open_survey_campaign',{p_campaign_id:campaignId,p_actor_id:'smoke-'+runId,p_actor_name:'Survey Production Smoke'});check(retry.error,'open retry');assert.strictEqual(Number(retry.data),0,'Open retry must be idempotent');
  const {data:tickets,error:te}=await db.from('knl_survey_tickets').select('*').eq('campaign_id',campaignId).order('version_id');check(te,'tickets');assert.strictEqual(tickets.length,2,'Duplicate guard failed');
  await expectDbError(db.from('knl_survey_campaign_versions').insert({campaign_id:campaignId,version_id:'00000000-0000-4000-8000-000000000099',framework_id:fixture.versions[0].framework_id,framework_code:'INVALID',framework_name:'INVALID',version_number:999,version_name:'INVALID'}),['23503'],'FK invalid version');
  await expectDbError(db.from('knl_framework_versions').delete().eq('id',versionIds[0]),['23503','55000'],'surveyed version delete guard');
  await expectDbError(saveTicket(tickets[0],'WRONG-'+person.employee_code,[],false,''),['42501'],'own-only');
  const shapes=await Promise.all(tickets.map(t=>structure(t.version_id)));
  const invalid=answers(shapes[0],'UNCLEAR','');await expectDbError(saveTicket(tickets[0],person.employee_code,invalid,true,''),['22023'],'UNCLEAR comment required');
  const partial=[answers(shapes[0],'SUITABLE','')[0]];const draft=await saveTicket(tickets[0],person.employee_code,partial,false,'draft');check(draft.error,'draft');assert.strictEqual(draft.data.status,'IN_PROGRESS');
  const submit1=await saveTicket(tickets[0],person.employee_code,answers(shapes[0],'UNCLEAR','Nội dung smoke: cần làm rõ.'),true,'Smoke general feedback');check(submit1.error,'submit 1');assert.strictEqual(Number(submit1.data.revision),1);
  const submit2=await saveTicket(tickets[1],person.employee_code,answers(shapes[1],'UNSUITABLE','Nội dung smoke: chưa phù hợp.'),true,'');check(submit2.error,'submit 2');
  const resubmit=await saveTicket(tickets[0],person.employee_code,answers(shapes[0],'UNCLEAR','Nội dung smoke đã chỉnh sửa.'),true,'Smoke feedback revision 2');check(resubmit.error,'resubmit');assert.strictEqual(Number(resubmit.data.revision),2);
  const {data:history,error:he}=await db.from('knl_survey_submission_history').select('ticket_id,revision,action').in('ticket_id',tickets.map(t=>t.id)).order('revision');check(he,'history');assert.strictEqual(history.length,3);assert(history.some(h=>h.action==='RESUBMIT'&&h.revision===2),'Resubmit history missing');
  const adminSession={role:'admin',sub:'smoke-admin',account:{id:'smoke-admin',name:'Survey Smoke Admin',employeeCode:'SMOKE-ADMIN'}};const results=await getKnlSurveyResults(adminSession,{campaignId});assert.strictEqual(results.progress.total,2);assert.strictEqual(results.progress.submitted,2);assert(results.quality.some(q=>q.unclearPct>0)&&results.quality.some(q=>q.unsuitablePct>0),'Result aggregation missing suitability');
  const tempAccount='survey-smoke-scope-'+runId;const grant=await db.from('knl_permission_grants').insert({account_id:tempAccount,employee_code:'SMOKE-SCOPE',employee_name:'Survey Smoke Scope',preset_code:'CUSTOM',capabilities:{access_knl:true,view_people:true,propose:false,agree_proposal:false,approve:false,manage_framework:false,manage_permissions:false,income_view:false},people_scope:{type:'employees',values:[person.employee_code],reservedEmployees:[]},reason:TEST_PREFIX+' temporary people_scope verification',is_active:true,created_by:'smoke-'+runId,created_by_name:'Survey Production Smoke',updated_by:'smoke-'+runId,updated_by_name:'Survey Production Smoke'}).select('id').single();check(grant.error,'temporary people_scope grant');created.permissionGrantId=grant.data.id;const managerSession={role:'manager',sub:tempAccount,account:{id:tempAccount,employeeCode:'SMOKE-SCOPE'}};const scopedResults=await getKnlSurveyResults(managerSession,{campaignId});assert.strictEqual(scopedResults.progress.total,2,'people_scope positive access failed');const denyUpdate=await db.from('knl_permission_grants').update({people_scope:{type:'employees',values:['SMOKE-NOT-IN-CAMPAIGN'],reservedEmployees:[]}}).eq('id',created.permissionGrantId);check(denyUpdate.error,'people_scope deny update');const deniedResults=await getKnlSurveyResults(managerSession,{campaignId});assert.strictEqual(deniedResults.progress.total,0,'people_scope API bypass was not denied');
  const clone=await db.rpc('knl_clone_version',{p_source_version_id:versionIds[0],p_name:TEST_PREFIX+' Draft '+runId,p_actor_id:'smoke-'+runId,p_actor_name:'Survey Production Smoke'});check(clone.error,'clone');created.cloneVersionId=clone.data.id;assert.strictEqual(clone.data.status,'draft');assert.strictEqual(clone.data.based_on_version_id,versionIds[0]);
  const past=new Date(Date.now()-1000).toISOString();check((await db.from('knl_survey_campaigns').update({ends_at:past}).eq('id',campaignId)).error,'set deadline');await expectDbError(saveTicket(tickets[0],person.employee_code,answers(shapes[0],'SUITABLE',''),false,''),['55000'],'deadline lock');
  console.log('PASS smoke: multi-version, 1 NV = 2 tickets, idempotency/index, FK/delete guards, draft/submit/resubmit/history, validation, own-only, Admin/scope, results, clone Draft, deadline lock.');
}

(async()=>{const mode=process.argv[2]||'--verify';try{await verifyReadOnly();if(mode==='--smoke')await smoke();else assert.strictEqual(mode,'--verify','Use --verify or --smoke');}finally{if(mode==='--smoke'){await cleanup();console.log('PASS cleanup: Survey campaign/tickets/responses/history/audit and cloned Draft removed.');}}})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
