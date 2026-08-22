(function(){
'use strict';

/* PHF Task — Batch 2C: Dashboard + Create Draft + Detail.
   Backend/session vẫn là authority cho identity, permission và People scope.
   Domain hoàn toàn riêng (class prefix .phft-), không tham chiếu CSS/JS
   Checklist/KNL/Classroom. */

function esc(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function roleHome(){
  var r='learner';
  try{ r = window.phfGetSessionRole ? window.phfGetSessionRole() : 'learner'; }catch(e){}
  return r==='admin' ? '/admin' : (r==='manager' ? '/ql' : '/hv');
}
function isTaskAdminUi(){return roleHome()==='/admin';}
function taskHomePath(){ return roleHome() + '/task'; }
function taskCreatePath(){return taskHomePath()+'/tao';}
function taskAdminPeoplePath(){return '/admin/task/nhan-su';}
function taskDetailPath(taskId){return taskHomePath()+'/chi-tiet?task_id='+encodeURIComponent(String(taskId||'').trim());}
function navigateTask(path,replace){if(typeof window.phfNavigate==='function')return window.phfNavigate(path,replace===true);}
function parseTaskRoute(routeKey){
  var url;try{url=new URL(String(routeKey||location.href),location.origin);}catch(e){url=new URL(location.href);}
  var path=String(url.pathname||'').replace(/\/$/,'');
  if(path===taskCreatePath())return{view:'create'};
  if(path===taskAdminPeoplePath()&&isTaskAdminUi())return{view:'admin-people'};
  if(path===taskHomePath()+'/chi-tiet')return{view:'detail',taskId:String(url.searchParams.get('task_id')||'').trim()};
  return{view:'dashboard'};
}
function goHub(){ if(typeof window.phfNavigate==='function') window.phfNavigate(roleHome() + '/home'); }
function currentUser(){ try{ return (window.phfGetCurrentUser&&window.phfGetCurrentUser())||(window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||{}; }catch(e){ return {}; } }
function currentUserName(){ var u=currentUser(); return String(u.fullName||u.full_name||u.name||u.displayName||u.display_name||u.email||'Người dùng').trim(); }
function currentUserTitle(){
  var u=currentUser();
  var title=String(u.title||u.position||u.roleName||u.role_name||'').trim();
  if(title) return title;
  var role='';
  try{ role=String(window.phfGetSessionRole ? window.phfGetSessionRole() : (u.role||'')).trim().toLowerCase(); }
  catch(e){ role=String(u.role||'').trim().toLowerCase(); }
  return role==='admin' ? 'Admin' : 'Tài khoản PHF';
}

var TASK_API_URL='/api/data';
var TASK_LINK_SIDES=['input_reference','output_result','coordination'];
var TASK_TIME_ZONE='Asia/Ho_Chi_Minh';

function padTaskDatePart(value){return String(value).padStart(2,'0');}
function taskLocalDateTimeParts(value){
  var match=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(!match)return null;
  var parts={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5]),second:Number(match[6]||0)};
  var probe=new Date(Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second));
  if(probe.getUTCFullYear()!==parts.year||probe.getUTCMonth()!==parts.month-1||probe.getUTCDate()!==parts.day||probe.getUTCHours()!==parts.hour||probe.getUTCMinutes()!==parts.minute||probe.getUTCSeconds()!==parts.second)return null;
  return parts;
}
function taskTimeZoneParts(date){
  var values={};
  new Intl.DateTimeFormat('en-CA',{timeZone:TASK_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).forEach(function(part){if(part.type!=='literal')values[part.type]=Number(part.value);});
  return values;
}
function taskTimeZoneOffsetMs(date){
  var parts=taskTimeZoneParts(date);
  return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-date.getTime();
}
function taskDateTimeInputValue(value){
  var date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  var parts=taskTimeZoneParts(date);
  return parts.year+'-'+padTaskDatePart(parts.month)+'-'+padTaskDatePart(parts.day)+'T'+padTaskDatePart(parts.hour)+':'+padTaskDatePart(parts.minute);
}
function serializeTaskLocalDateTime(value){
  if(!String(value||'').trim())return null;
  var parts=taskLocalDateTimeParts(value);if(!parts)return null;
  var wallClockUtc=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
  var firstOffset=taskTimeZoneOffsetMs(new Date(wallClockUtc));
  var instant=new Date(wallClockUtc-firstOffset);
  var correctedOffset=taskTimeZoneOffsetMs(instant);
  if(correctedOffset!==firstOffset)instant=new Date(wallClockUtc-correctedOffset);
  var expected=parts.year+'-'+padTaskDatePart(parts.month)+'-'+padTaskDatePart(parts.day)+'T'+padTaskDatePart(parts.hour)+':'+padTaskDatePart(parts.minute);
  return taskDateTimeInputValue(instant)===expected?instant.toISOString():null;
}
function formatTaskDateTime(value){
  if(!value)return '—';
  var date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('vi-VN',{timeZone:TASK_TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}

function defaultTaskForm(){
  return {flow_type:'giao_viec',title:'',content:'',category_code:'',priority:'thuong',start_at:'',deadline:'',primary_employee_code:'',related_employee_codes:[],links:[]};
}
function cloneTaskForm(form){
  var source=form||{}, out=defaultTaskForm();
  Object.keys(out).forEach(function(key){if(source[key]!==undefined)out[key]=source[key];});
  out.related_employee_codes=Array.isArray(source.related_employee_codes)?source.related_employee_codes.slice():[];
  out.links=Array.isArray(source.links)?source.links.map(function(link){return {side:link.side||'input_reference',url:String(link.url||''),label:String(link.label||'')};}):[];
  return out;
}
function employeeCode(value){return String(value||'').trim().toUpperCase();}
function normalizeRelatedCodes(primary,codes){
  var primaryCode=employeeCode(primary), seen={};
  return (Array.isArray(codes)?codes:[]).map(employeeCode).filter(function(code){if(!code||code===primaryCode||seen[code])return false;seen[code]=true;return true;});
}
function validHttpUrl(value){
  try{var url=new URL(String(value||'').trim());return url.protocol==='http:'||url.protocol==='https:';}catch(e){return false;}
}
function normalizeLinks(links){
  return (Array.isArray(links)?links:[]).map(function(link){return {side:String(link&&link.side||'input_reference').trim(),url:String(link&&link.url||'').trim(),label:String(link&&link.label||'').trim()};}).filter(function(link){return link.url||link.label;});
}
function validateTaskForm(input){
  var form=cloneTaskForm(input), errors={};
  form.flow_type=String(form.flow_type||'').trim();
  form.title=String(form.title||'').trim();
  form.content=String(form.content||'').trim();
  form.category_code=employeeCode(form.category_code);
  form.priority=String(form.priority||'').trim();
  form.start_at=String(form.start_at||'').trim();
  form.deadline=String(form.deadline||'').trim();
  form.primary_employee_code=employeeCode(form.primary_employee_code);
  form.related_employee_codes=normalizeRelatedCodes(form.primary_employee_code,form.related_employee_codes);
  form.links=normalizeLinks(form.links);
  if(['giao_viec','de_xuat'].indexOf(form.flow_type)<0)errors.flow_type='Chọn loại công việc hợp lệ.';
  if(!form.title)errors.title='Nhập tiêu đề công việc.';
  if(!form.category_code)errors.category_code='Chọn danh mục công việc.';
  if(['thuong','quan_trong','khan_cap'].indexOf(form.priority)<0)errors.priority='Chọn mức độ ưu tiên hợp lệ.';
  var startIso=form.start_at?serializeTaskLocalDateTime(form.start_at):null;
  var deadlineIso=form.deadline?serializeTaskLocalDateTime(form.deadline):null;
  if(form.start_at&&!startIso)errors.start_at='Ngày bắt đầu không hợp lệ.';
  if(!form.deadline)errors.deadline='Chọn deadline.';
  else if(!deadlineIso)errors.deadline='Deadline không hợp lệ.';
  if(startIso&&deadlineIso&&Date.parse(startIso)>Date.parse(deadlineIso))errors.deadline='Deadline phải bằng hoặc sau ngày bắt đầu.';
  if(!form.primary_employee_code)errors.primary_employee_code='Chọn người thực hiện chính.';
  form.links.forEach(function(link,index){
    if(TASK_LINK_SIDES.indexOf(link.side)<0)errors['link_'+index]='Chọn loại link hợp lệ.';
    else if(!validHttpUrl(link.url))errors['link_'+index]='URL phải bắt đầu bằng http:// hoặc https://.';
  });
  return {valid:Object.keys(errors).length===0,errors:errors,form:form};
}
function buildCreatePayload(form){
  return {action:'createTaskDraft',flow_type:form.flow_type,title:form.title,content:form.content,category_code:form.category_code,priority:form.priority,start_at:form.start_at?serializeTaskLocalDateTime(form.start_at):null,deadline:serializeTaskLocalDateTime(form.deadline),primary_employee_code:form.primary_employee_code};
}
function taskApiErrorMessage(error){
  var code=String(error&&error.code||'');
  if(code==='TASK_CAPABILITY_DENIED')return 'Bạn chưa được cấp quyền thực hiện thao tác này.';
  if(['TASK_ASSIGN_SCOPE_DENIED','TASK_ASSIGN_DENIED','TASK_RELATED_TARGET_DENIED','TASK_TRANSFER_TARGET_DENIED'].indexOf(code)>=0)return 'Nhân sự đã chọn nằm ngoài phạm vi giao việc của bạn.';
  if(code==='TASK_NOT_FOUND')return 'Không tìm thấy công việc hoặc bạn không còn quyền xem.';
  if(code==='TASK_VERSION_CONFLICT')return 'Công việc đã thay đổi ở nơi khác. Vui lòng tải lại.';
  if(['TASK_START_INVALID','TASK_DEADLINE_INVALID','TASK_DATE_ORDER_INVALID'].indexOf(code)>=0)return 'Ngày bắt đầu hoặc deadline không hợp lệ.';
  return String(error&&error.message||'Không thể xử lý yêu cầu PHF Task.');
}
async function taskApi(payload){
  var response=await fetch(TASK_API_URL,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
  var json={};try{json=await response.json();}catch(e){}
  if(!response.ok||json.ok===false){var error=new Error(json.error||json.message||'Không thể xử lý yêu cầu PHF Task.');error.code=json.code||'';error.status=response.status;throw error;}
  return json;
}
function taskResult(response){return response&&Object.prototype.hasOwnProperty.call(response,'result')?response.result:response;}
async function persistTaskSupplements(taskId,related,links,apiCall,onPhase){
  var failures=[], call=apiCall||taskApi;
  if(related.length&&onPhase)onPhase('related');
  for(var i=0;i<related.length;i++){
    try{await call({action:'addTaskRelated',task_id:taskId,target_employee_code:related[i]});}
    catch(error){failures.push({kind:'related',item:related[i],message:taskApiErrorMessage(error),code:error&&error.code||''});}
  }
  if(links.length&&onPhase)onPhase('links');
  for(var j=0;j<links.length;j++){
    try{await call({action:'addTaskLink',task_id:taskId,side:links[j].side,url:links[j].url,label:links[j].label||''});}
    catch(error){failures.push({kind:'link',item:links[j],message:taskApiErrorMessage(error),code:error&&error.code||''});}
  }
  return failures;
}
async function runCreateTaskFlow(input,apiCall,onPhase){
  var checked=validateTaskForm(input), call=apiCall||taskApi;
  if(!checked.valid){var invalid=new Error('Vui lòng kiểm tra lại các trường bắt buộc.');invalid.code='TASK_FORM_INVALID';invalid.fieldErrors=checked.errors;throw invalid;}
  if(onPhase)onPhase('creating');
  var createResponse=await call(buildCreatePayload(checked.form));
  var created=taskResult(createResponse)||{}, taskId=String(created.id||created.task_id||'').trim();
  if(!taskId){var missing=new Error('Backend chưa trả task_id sau khi tạo nháp.');missing.code='TASK_CREATE_RESPONSE_INVALID';throw missing;}
  var rowVersion=created.row_version==null?null:created.row_version;
  var failures=await persistTaskSupplements(taskId,checked.form.related_employee_codes,checked.form.links,call,onPhase);
  if(onPhase)onPhase('detail');
  try{
    var detailResponse=await call({action:'getTaskDetail',task_id:taskId});
    return {taskId:taskId,rowVersion:rowVersion,detail:taskResult(detailResponse)||{},partialErrors:failures,form:checked.form};
  }catch(error){
    error.createdTaskId=taskId;error.createdRowVersion=rowVersion;error.partialErrors=failures;throw error;
  }
}
async function retryTaskSupplements(taskId,failures,apiCall,onPhase){
  var related=[],links=[];
  (failures||[]).forEach(function(failure){if(failure.kind==='related')related.push(failure.item);else if(failure.kind==='link')links.push(failure.item);});
  var remaining=await persistTaskSupplements(taskId,normalizeRelatedCodes('',related),normalizeLinks(links),apiCall||taskApi,onPhase);
  if(onPhase)onPhase('detail');
  try{
    var detailResponse=await (apiCall||taskApi)({action:'getTaskDetail',task_id:taskId});
    return {taskId:taskId,detail:taskResult(detailResponse)||{},partialErrors:remaining};
  }catch(error){error.partialErrors=remaining;throw error;}
}
function normalizeEmployee(row){
  var code=employeeCode(row&&((row.employeeCode||row.employee_code||row.code))), name=String(row&&(row.fullName||row.full_name||row.name)||code).trim();
  return {code:code,name:name,department:String(row&&(row.department||row.department_name)||'').trim(),title:String(row&&(row.title||row.position)||'').trim(),branch:String(row&&row.branch||'').trim(),employmentStatus:String(row&&(row.employmentStatus||row.employment_status)||'').trim().toLowerCase()};
}
function taskAssignableEmployeeRows(rows){
  var seen={};
  return (Array.isArray(rows)?rows:[]).map(normalizeEmployee).filter(function(row){if(!row.code||row.employmentStatus!=='active'||seen[row.code])return false;seen[row.code]=true;return true;}).sort(function(a,b){return a.name.localeCompare(b.name,'vi');});
}
async function loadTaskAssignableEmployees(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskAssignableEmployees'}), result=taskResult(response)||{};
  return taskAssignableEmployeeRows(result.employees);
}
function normalizeTaskCategory(row){
  return {code:employeeCode(row&&(row.categoryCode||row.category_code||row.code)),name:String(row&&(row.displayName||row.display_name||row.name)||'').trim(),isActive:row&&(row.isActive===true||row.is_active===true)};
}
function taskActiveCategoryRows(rows){
  var seen={};
  return (Array.isArray(rows)?rows:[]).map(normalizeTaskCategory).filter(function(row){if(!row.code||!row.name||!row.isActive||seen[row.code])return false;seen[row.code]=true;return true;}).sort(function(a,b){return a.name.localeCompare(b.name,'vi');});
}
async function loadTaskCategories(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskCategories'}), result=taskResult(response)||{};
  return taskActiveCategoryRows(result.categories);
}
async function loadTaskAdminPeople(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskAdminPeople'}), result=taskResult(response)||{};
  return {identityReady:result.identity_ready===true,identityStatus:String(result.identity_status||''),identityMessage:String(result.identity_message||''),permissionSchemaReady:result.permission_schema_ready!==false,permissionSchemaError:String(result.permission_schema_error||''),permissionSchemaMessage:String(result.permission_schema_message||''),people:Array.isArray(result.people)?result.people:[],summary:result.summary||{total:0,active:0,inactive:0,with_account:0}};
}
function buildTaskPermissionAssignmentPayload(editor){
  return {action:'saveTaskPermissionAssignment',employee_code:employeeCode(editor&&editor.employeeCode),preset_code:employeeCode(editor&&editor.basePresetCode),reason:String(editor&&editor.reason||'').trim()};
}
async function saveTaskBasePreset(editor,apiCall){
  var call=apiCall||taskApi;
  await call(buildTaskPermissionAssignmentPayload(editor));
  return loadTaskAdminPeople(call);
}
function buildTaskPermissionExtendPayload(editor){
  var scopeType=String(editor&&editor.scopeType||'').trim(),values=scopeType==='employees'?(editor&&Array.isArray(editor.employeeCodes)?editor.employeeCodes.map(employeeCode).filter(Boolean):[]):[];
  return {action:'createTaskPermissionGrant',grantee_employee_code:employeeCode(editor&&editor.employeeCode),grant_type:'extend',people_scope:{type:scopeType,values:values},capabilities:{},reason:String(editor&&editor.reason||'').trim()};
}
async function saveTaskPermissionExtend(editor,apiCall){
  var call=apiCall||taskApi;
  await call(buildTaskPermissionExtendPayload(editor));
  return loadTaskAdminPeople(call);
}
async function revokeTaskPermissionExtend(grantId,reason,apiCall){
  var call=apiCall||taskApi;
  await call({action:'revokeTaskPermissionGrant',grant_id:String(grantId||''),reason:String(reason||'').trim()});
  return loadTaskAdminPeople(call);
}
function choosePrimary(form,code){var next=cloneTaskForm(form);next.primary_employee_code=employeeCode(code);next.related_employee_codes=normalizeRelatedCodes(next.primary_employee_code,next.related_employee_codes);return next;}
function toggleRelated(form,code){
  var next=cloneTaskForm(form), target=employeeCode(code);
  if(!target||target===employeeCode(next.primary_employee_code))return next;
  var list=normalizeRelatedCodes(next.primary_employee_code,next.related_employee_codes), index=list.indexOf(target);
  if(index>=0)list.splice(index,1);else list.push(target);
  next.related_employee_codes=list;return next;
}
var taskUiState={view:'dashboard',form:defaultTaskForm(),formErrors:{},submitError:'',submitPhase:'',submitting:false,categories:[],categoriesLoading:false,categoriesError:'',employees:[],employeesLoading:false,employeesError:'',primaryQuery:'',relatedQuery:'',taskId:'',rowVersion:null,detail:null,detailLoading:false,detailError:'',partialErrors:[],adminPeople:null,adminPeopleLoading:false,adminPeopleError:'',permissionEditor:null,permissionSaving:false,permissionError:''};

function taskToast(message){
  if(typeof window.phfToast==='function'){ window.phfToast('info','Sắp triển khai',message,3200,'phf-task-soon'); return; }
  try{ window.alert(message); }catch(e){}
}
function taskNotice(type,title,message){
  if(typeof window.phfToast==='function'){window.phfToast(type,title,message,4800,'phf-task-'+type);return;}
  try{window.alert(title+'\n'+message);}catch(e){}
}

/* Sidebar: Phase 1A chỉ 'dashboard' có nội dung thật — các mục còn lại hiển
   thị để đúng design direction nhưng disabled, KHÔNG route giả (click chỉ
   toast, KHÔNG đổi URL/nội dung). */
var NAV_ITEMS = [
  { key:'dashboard', label:'Trang chủ', desc:'Tổng quan công việc', enabled:true },
  { key:'people-permissions', label:'Nhân sự & phân quyền', desc:'Vai trò và phạm vi Task', enabled:true, adminOnly:true },
  { key:'cong-viec', label:'Công việc', desc:'Danh sách & xử lý', enabled:false },
  { key:'lich', label:'Lịch', desc:'Lịch công việc', enabled:false },
  { key:'timeline', label:'Timeline', desc:'Dòng thời gian', enabled:false },
  { key:'bao-cao', label:'Báo cáo', desc:'Hiệu suất & kết quả', enabled:false },
  { key:'de-xuat', label:'Đề xuất', desc:'Đề xuất công việc', enabled:false }
];

function shellFrame(bodyHtml){
  var activeNav=taskUiState.view==='admin-people'?'people-permissions':'dashboard';
  var navHtml = NAV_ITEMS.filter(function(item){return !item.adminOnly||isTaskAdminUi();}).map(function(item){
    return '<button type="button" class="phft-nav-item'+(item.key===activeNav?' active':'')+(item.enabled?'':' is-soon')+'" data-task-nav="'+item.key+'"'+(item.enabled?'':' aria-disabled="true"')+'>' +
      '<span><b>'+esc(item.label)+'</b><small>'+esc(item.desc)+'</small></span>' +
      (item.enabled?'':'<em class="phft-soon-badge">Sắp triển khai</em>') +
    '</button>';
  }).join('');
  return '' +
    '<header class="phft-topbar">' +
      '<div class="phft-top-left"><button type="button" class="phft-back" data-task-back><span aria-hidden="true">←</span><span>PHF HR / Home</span></button></div>' +
      '<div class="phft-brand-lockup"><strong>PHF TASK</strong><small>Quản lý công việc &amp; Theo dõi tiến độ</small></div>' +
      '<div class="phft-top-actions"><span class="phft-user-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span class="phft-user-copy"><b>'+esc(currentUserName())+'</b><small>'+esc(currentUserTitle())+'</small></span></div>' +
    '</header>' +
    '<div class="phft-layout">' +
      '<aside class="phft-sidebar"><nav class="phft-nav">'+navHtml+'</nav></aside>' +
      '<main class="phft-main">'+bodyHtml+'</main>' +
    '</div>';
}

function kpiCardHtml(label){
  return '<article class="phft-kpi"><strong>0</strong><span>'+esc(label)+'</span></article>';
}
function emptyBlockHtml(title, message){
  return '<section class="phft-panel"><header><h3>'+esc(title)+'</h3></header><div class="phft-empty">'+esc(message)+'</div></section>';
}

function dashboardHtml(){
  var kpis = ['Tổng công việc','Đang thực hiện','Hoàn thành','Quá hạn','Đến hạn hôm nay'].map(kpiCardHtml).join('');
  return '' +
    '<div class="phft-page-head">' +
      '<div><small>PHF TASK</small><h1>Dashboard</h1></div>' +
      '<button type="button" class="phft-btn-primary" data-task-create>+ Tạo công việc mới</button>' +
    '</div>' +
    '<section class="phft-kpi-row">'+kpis+'</section>' +
    '<div class="phft-grid">' +
      emptyBlockHtml('Công việc đến hạn', 'Chưa có công việc nào đến hạn.') +
      emptyBlockHtml('Lịch công việc', 'Chưa có dữ liệu lịch công việc.') +
      emptyBlockHtml('Tóm tắt trạng thái', 'Chưa có công việc nào để tổng hợp trạng thái.') +
      emptyBlockHtml('Hiệu suất tuần', 'Chưa có dữ liệu hiệu suất trong tuần.') +
      emptyBlockHtml('Việc tôi giao', 'Bạn chưa giao công việc nào.') +
      emptyBlockHtml('Hoạt động gần đây', 'Chưa có hoạt động nào được ghi nhận.') +
    '</div>';
}

function taskPermissionFlag(value){return '<span class="phft-permission-flag '+(value?'is-on':'is-off')+'">'+(value?'Có':'—')+'</span>';}
function taskPermissionCapsHtml(caps){caps=caps||{};return '<span>'+TASK_CAPABILITY_LABELS.view+' '+(caps.view===true?'✓':'—')+'</span><span>'+TASK_CAPABILITY_LABELS.assign+' '+(caps.assign===true?'✓':'—')+'</span><span>'+TASK_CAPABILITY_LABELS.update+' '+(caps.update===true?'✓':'—')+'</span><span>'+TASK_CAPABILITY_LABELS.manage+' '+(caps.manage===true?'✓':'—')+'</span>';}
function taskGrantCapabilityText(caps){
  var labels=[],source=caps||{};['view','assign','update','manage'].forEach(function(key){if(typeof source[key]==='boolean')labels.push(TASK_CAPABILITY_LABELS[key]+': '+(source[key]?'bật':'tắt'));});
  return labels.length?labels.join(' · '):'Không đổi capability';
}
function taskActiveGrantsHtml(person){
  var grants=Array.isArray(person&&person.active_grants)?person.active_grants:[];
  if(!grants.length)return '<div class="phft-inline-empty">Chưa có grant đang hiệu lực.</div>';
  return '<div class="phft-grant-list">'+grants.map(function(grant){
    var values=grant.people_scope&&Array.isArray(grant.people_scope.values)?grant.people_scope.values:[],scopeText=String(grant.people_scope_label||'—')+(values.length?' · '+values.join(', '):'');
    return '<article><div><b>'+esc(taskEnumLabel(TASK_GRANT_TYPE_LABELS,grant.grant_type))+' · '+esc(scopeText)+'</b><small>'+esc(taskGrantCapabilityText(grant.capabilities))+'</small><small>Lý do: '+esc(grant.reason||'—')+'</small></div>'+(grant.can_revoke?'<button type="button" class="phft-btn-danger" data-task-permission-revoke="'+esc(grant.id)+'"'+(taskUiState.permissionSaving?' disabled':'')+'>Thu hồi</button>':'<span class="phft-readonly-badge">Chỉ đọc</span>')+'</article>';
  }).join('')+'</div>';
}
function taskPermissionTargetOptions(person,selected){
  var selectedSet=new Set((selected||[]).map(employeeCode));
  var people=taskUiState.adminPeople&&Array.isArray(taskUiState.adminPeople.people)?taskUiState.adminPeople.people:[];
  return people.filter(function(row){return row.employment_status==='active'&&employeeCode(row.employee_code)!==employeeCode(person.employee_code);}).map(function(row){var value=employeeCode(row.employee_code);return '<option value="'+esc(value)+'"'+(selectedSet.has(value)?' selected':'')+'>'+esc(row.full_name||value)+' · '+esc(value)+'</option>';}).join('');
}
function taskPermissionEditorHtml(){
  var editor=taskUiState.permissionEditor;if(!editor)return '';
  var people=taskUiState.adminPeople&&Array.isArray(taskUiState.adminPeople.people)?taskUiState.adminPeople.people:[];
  var person=people.find(function(row){return employeeCode(row.employee_code)===employeeCode(editor.employeeCode);});
  if(!person)return '';
  var policy=person.permission_adjustment||{},types=Array.isArray(policy.supported_scope_types)?policy.supported_scope_types:[];
  var scopeType=types.includes(editor.scopeType)?editor.scopeType:(types[0]||'');
  var scopeOptions=types.map(function(type){return '<option value="'+esc(type)+'"'+(type===scopeType?' selected':'')+'>'+(type==='all_company'?'Toàn công ty':'Chọn nhân sự cụ thể')+'</option>';}).join('');
  var presets=[['GIAM_DOC','Giám đốc'],['TRO_LY_GD','Trợ lý GĐ'],['TRUONG_BO_PHAN','Trưởng bộ phận'],['TRUONG_CA','Trưởng ca'],['NHAN_VIEN','Nhân viên']];
  var selectedPreset=employeeCode(editor.basePresetCode||person.task_preset_code||'NHAN_VIEN');
  var presetOptions=presets.map(function(item){return '<option value="'+item[0]+'"'+(item[0]===selectedPreset?' selected':'')+'>'+item[1]+'</option>';}).join('');
  var baseBlock=policy.can_set_base_preset===true?'<section class="phft-permission-create"><h3>Task preset chính thức</h3><p>Preset này quyết định base role và base scope; không thay đổi chức danh hay cơ cấu People Master.</p><label><span>Base Task preset</span><select data-task-base-preset>'+presetOptions+'</select></label></section>':'<div class="phft-inline-empty">Nhân sự đã nghỉ vẫn giữ lịch sử nhưng không nhận Task preset mới.</div>';
  var extendBlock=policy.can_create_extend===true?'<section class="phft-permission-create"><h3>Ngoại lệ Extend</h3><p>Extend chỉ mở rộng scope trên preset nền. Restrict và delegation chưa mở trong UI V1.</p><label><span>Phạm vi mở rộng</span><select data-task-permission-scope-type>'+scopeOptions+'</select></label>'+(scopeType==='employees'?'<label><span>Nhân sự được mở rộng</span><select multiple size="7" data-task-permission-targets>'+taskPermissionTargetOptions(person,editor.employeeCodes)+'</select><small>Giữ Ctrl/Cmd để chọn nhiều người.</small></label>':'<div class="phft-alert is-warning"><div><b>Mở rộng toàn công ty</b><small>Grant này cho phép scope Task phủ toàn bộ People Master đang hoạt động.</small></div></div>')+'</section>':'<div class="phft-inline-empty">Preset nền đã có phạm vi toàn công ty hoặc nhân sự không còn active; không có Extend mới để tạo.</div>';
  return '<div class="phft-modal-backdrop"><section class="phft-permission-modal" role="dialog" aria-modal="true" aria-label="Điều chỉnh quyền Task"><header><div><small>PHF TASK / BASE + EXCEPTION</small><h2>Điều chỉnh quyền · '+esc(person.full_name||person.employee_code)+'</h2><p>'+esc(person.employee_code)+' · '+esc(person.task_role_label||'—')+'</p></div><button type="button" class="phft-icon-btn" data-task-permission-close aria-label="Đóng">×</button></header><div class="phft-permission-current"><div><b>Quyền nền</b><small>'+esc(person.base_scope_label||'—')+'</small><div>'+taskPermissionCapsHtml(person.base_capabilities||{})+'</div></div><div><b>Quyền hiệu lực</b><small>'+esc(person.effective_scope_label||'—')+'</small><div>'+taskPermissionCapsHtml(person.capabilities||{})+'</div></div></div>'+baseBlock+'<section><h3>Grant ngoại lệ đang hiệu lực</h3>'+taskActiveGrantsHtml(person)+'</section>'+extendBlock+'<label class="phft-permission-reason"><span>Lý do thao tác</span><textarea rows="3" data-task-permission-reason placeholder="Bắt buộc cho lưu preset, Extend hoặc thu hồi">'+esc(editor.reason||'')+'</textarea></label>'+(taskUiState.permissionError?'<div class="phft-alert is-error"><div><b>Chưa lưu được quyền.</b><small>'+esc(taskUiState.permissionError)+'</small></div></div>':'')+'<footer><button type="button" class="phft-btn-secondary" data-task-permission-close'+(taskUiState.permissionSaving?' disabled':'')+'>Đóng</button>'+(policy.can_create_extend===true?'<button type="button" class="phft-btn-secondary" data-task-permission-save'+(taskUiState.permissionSaving?' disabled':'')+'>Lưu Extend</button>':'')+(policy.can_set_base_preset===true?'<button type="button" class="phft-btn-primary" data-task-base-preset-save'+(taskUiState.permissionSaving?' disabled':'')+'>'+(taskUiState.permissionSaving?'Đang lưu…':'Lưu Task preset')+'</button>':'')+'</footer></section></div>';
}
function adminPeopleTableHtml(people){
  if(!people.length)return '<div class="phft-empty">People Master chưa có nhân sự để hiển thị.</div>';
  return '<div class="phft-admin-people-tablebox"><table class="phft-admin-people-table"><thead><tr><th>Nhân sự</th><th>Phòng ban / Chức danh</th><th>Làm việc</th><th>Tài khoản</th><th>Vai trò Task</th><th>Phạm vi quyền</th><th>Xem</th><th>Giao việc</th><th>Cập nhật</th><th>Quản trị</th><th>Thao tác</th></tr></thead><tbody>'+people.map(function(person){
    var caps=person.capabilities||{},inactive=person.employment_status==='inactive';
    var policy=person.permission_adjustment||{},grants=Array.isArray(person.active_grants)?person.active_grants:[],canOpen=policy.can_set_base_preset===true||grants.length>0;
    var presetLabel=person.task_preset_source==='unavailable'?'Chưa khả dụng':taskEnumLabel(TASK_PRESET_LABELS,person.task_preset_code||'NHAN_VIEN');
    var presetSourceLabel=taskEnumLabel(TASK_PRESET_SOURCE_LABELS,person.task_preset_source||'default');
    return '<tr'+(inactive?' class="is-inactive"':'')+'><td><b>'+esc(person.full_name||person.employee_code||'—')+'</b><small>'+esc(person.employee_code||'—')+'</small></td><td><b>'+esc(person.department||'—')+'</b><small>'+esc(person.title||person.position||'—')+(person.branch?' · '+esc(person.branch):'')+'</small></td><td><span class="phft-people-status '+(inactive?'is-inactive':'is-active')+'">'+esc(person.employment_status_label||'—')+'</span><small>'+(person.can_receive_new_tasks?'Có thể nhận Task mới':'Không nhận Task mới')+'</small></td><td><span class="phft-people-status account-'+esc(person.account_status||'missing')+'">'+esc(person.account_status_label||'—')+'</span></td><td><b>'+esc(person.task_role_label||'—')+'</b><small>'+esc(presetLabel)+' · '+esc(presetSourceLabel)+'</small></td><td><b>'+esc(person.base_scope_label||'—')+'</b><small>Hiệu lực: '+esc(person.effective_scope_label||person.base_scope_label||'—')+(person.has_active_grant?' · '+Number(person.active_grant_count||0)+' grant đang hiệu lực':' · Không có grant active')+'</small></td><td>'+taskPermissionFlag(caps.view===true)+'</td><td>'+taskPermissionFlag(caps.assign===true)+'</td><td>'+taskPermissionFlag(caps.update===true)+'</td><td>'+taskPermissionFlag(caps.manage===true)+'</td><td>'+(canOpen?'<button type="button" class="phft-btn-secondary phft-permission-open" data-task-permission-open="'+esc(person.employee_code)+'">Điều chỉnh quyền</button>':'<span class="phft-readonly-badge">Chỉ đọc lịch sử</span>')+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function adminPeopleHtml(){
  var data=taskUiState.adminPeople||{},summary=data.summary||{};
  var head='<div class="phft-page-head"><div><small>PHF TASK / CÀI ĐẶT</small><h1>Nhân sự & phân quyền</h1></div><button type="button" class="phft-btn-secondary" data-task-admin-people-reload>Tải lại</button></div>';
  if(taskUiState.adminPeopleLoading)return head+'<section class="phft-form-card"><div class="phft-loading">Đang đọc People Master, tài khoản và quyền PHF Task…</div></section>';
  if(taskUiState.adminPeopleError)return head+'<div class="phft-alert is-error"><div><b>Chưa tải được Nhân sự & phân quyền.</b><small>'+esc(taskUiState.adminPeopleError)+'</small></div><button type="button" class="phft-btn-secondary" data-task-admin-people-reload>Thử lại</button></div>';
  var permissionWarning=data.permissionSchemaReady===false?'<div class="phft-alert is-error"><div><b>Schema phân quyền Task chưa sẵn sàng.</b><small>'+esc(data.permissionSchemaMessage||data.permissionSchemaError||'Cần áp dụng migration Foundation Correction đúng môi trường trước khi chỉnh quyền.')+'</small></div></div>':'';
  return head+permissionWarning+'<section class="phft-admin-summary"><article><b>'+Number(summary.total||0)+'</b><span>Tổng nhân sự</span></article><article><b>'+Number(summary.active||0)+'</b><span>Đang làm</span></article><article><b>'+Number(summary.inactive||0)+'</b><span>Nghỉ việc</span></article><article><b>'+Number(summary.with_account||0)+'</b><span>Có tài khoản</span></article></section><section class="phft-form-card phft-admin-people-card"><header><h2>Quyền hiệu lực hiện tại</h2><p>People Master cung cấp cơ cấu; Task preset cung cấp base role; grant là ngoại lệ chồng lên sau cùng.</p></header>'+adminPeopleTableHtml(data.people||[])+'</section>'+taskPermissionEditorHtml();
}

function taskFieldError(name){
  var message=taskUiState.formErrors[name];
  return message?'<small class="phft-field-error">'+esc(message)+'</small>':'';
}
function taskCategoryOptionsHtml(){
  var prefix='<option value="">'+(taskUiState.categoriesLoading?'Đang tải danh mục…':(taskUiState.categoriesError?'Không tải được danh mục':'Chọn danh mục công việc'))+'</option>';
  return prefix+taskUiState.categories.map(function(row){return '<option value="'+esc(row.code)+'"'+(taskUiState.form.category_code===row.code?' selected':'')+'>'+esc(row.name)+'</option>';}).join('');
}
function taskPhaseLabel(){
  return {creating:'Đang tạo bản nháp…',related:'Đang lưu người liên quan…',links:'Đang lưu tài liệu…',detail:'Đang tải chi tiết từ hệ thống…'}[taskUiState.submitPhase]||'Đang xử lý…';
}
function employeeLabel(code){
  var target=employeeCode(code), row=taskUiState.employees.find(function(item){return item.code===target;});
  return row?(row.name+' · '+row.code):target;
}
function matchedEmployees(kind){
  var query=String(kind==='primary'?taskUiState.primaryQuery:taskUiState.relatedQuery).trim().toLocaleLowerCase('vi');
  var primary=employeeCode(taskUiState.form.primary_employee_code);
  return taskUiState.employees.filter(function(row){
    if(kind==='related'&&row.code===primary)return false;
    if(!query)return true;
    return [row.code,row.name,row.department,row.title,row.branch].join(' ').toLocaleLowerCase('vi').indexOf(query)>=0;
  }).slice(0,50);
}
function employeeResultsHtml(kind){
  if(taskUiState.employeesLoading)return '<div class="phft-picker-empty">Đang tải danh sách nhân sự…</div>';
  if(taskUiState.employeesError)return '<div class="phft-picker-empty is-error">'+esc(taskUiState.employeesError)+'</div>';
  var rows=matchedEmployees(kind), primary=employeeCode(taskUiState.form.primary_employee_code), related=normalizeRelatedCodes(primary,taskUiState.form.related_employee_codes);
  if(!rows.length)return '<div class="phft-picker-empty">Không tìm thấy nhân sự phù hợp.</div>';
  return rows.map(function(row){
    var selected=kind==='primary'?row.code===primary:related.indexOf(row.code)>=0;
    return '<button type="button" class="phft-person-option'+(selected?' is-selected':'')+'" data-task-pick-'+kind+'="'+esc(row.code)+'">'+
      '<span><b>'+esc(row.name)+'</b><small>'+esc(row.code+(row.department?' · '+row.department:''))+'</small></span><em>'+(selected?'Đã chọn':'Chọn')+'</em></button>';
  }).join('');
}
function selectedRelatedHtml(){
  var rows=normalizeRelatedCodes(taskUiState.form.primary_employee_code,taskUiState.form.related_employee_codes);
  if(!rows.length)return '<span class="phft-chip-empty">Chưa chọn người liên quan.</span>';
  return rows.map(function(code){return '<span class="phft-chip">'+esc(employeeLabel(code))+'<button type="button" aria-label="Bỏ người liên quan" data-task-remove-related="'+esc(code)+'">×</button></span>';}).join('');
}
function linkRowsHtml(){
  if(!taskUiState.form.links.length)return '<div class="phft-inline-empty">Chưa có tài liệu liên kết.</div>';
  return taskUiState.form.links.map(function(link,index){
    return '<div class="phft-link-row">'+
      '<select data-task-link-field="side" data-task-link-index="'+index+'" aria-label="Loại tài liệu"><option value="input_reference"'+(link.side==='input_reference'?' selected':'')+'>Tài liệu đầu vào</option><option value="output_result"'+(link.side==='output_result'?' selected':'')+'>Kết quả đầu ra</option><option value="coordination"'+(link.side==='coordination'?' selected':'')+'>Phối hợp</option></select>'+
      '<input type="url" data-task-link-field="url" data-task-link-index="'+index+'" value="'+esc(link.url)+'" placeholder="https://…" aria-label="URL tài liệu">'+
      '<input type="text" data-task-link-field="label" data-task-link-index="'+index+'" value="'+esc(link.label)+'" placeholder="Nhãn (không bắt buộc)" aria-label="Nhãn tài liệu">'+
      '<button type="button" class="phft-icon-btn" data-task-remove-link="'+index+'" aria-label="Xóa tài liệu">×</button>'+
      taskFieldError('link_'+index)+'</div>';
  }).join('');
}
function createTaskHtml(){
  return '<div class="phft-page-head"><div><small>PHF TASK / TẠO MỚI</small><h1>Tạo công việc</h1></div><button type="button" class="phft-btn-secondary" data-task-cancel-create>Quay lại</button></div>'+
    '<form class="phft-form" data-task-create-form novalidate>'+
      (taskUiState.submitError?'<div class="phft-alert is-error">'+esc(taskUiState.submitError)+'</div>':'')+
      '<section class="phft-form-card"><header><h2>Thông tin công việc</h2><p>Tạo bản nháp trước khi thêm người liên quan và tài liệu.</p></header><div class="phft-form-grid">'+
        '<label><span>Loại công việc *</span><select data-task-field="flow_type"><option value="giao_viec"'+(taskUiState.form.flow_type==='giao_viec'?' selected':'')+'>Giao việc</option><option value="de_xuat"'+(taskUiState.form.flow_type==='de_xuat'?' selected':'')+'>Đề xuất</option></select>'+taskFieldError('flow_type')+'</label>'+
        '<label><span>Danh mục công việc *</span><select data-task-field="category_code"'+((taskUiState.categoriesLoading||taskUiState.categoriesError)?' disabled':'')+'>'+taskCategoryOptionsHtml()+'</select>'+taskFieldError('category_code')+(taskUiState.categoriesError?'<small class="phft-field-error">'+esc(taskUiState.categoriesError)+'</small>':'')+'</label>'+
        '<label class="phft-span-2"><span>Tiêu đề *</span><input data-task-field="title" value="'+esc(taskUiState.form.title)+'" placeholder="Nhập tiêu đề công việc">'+taskFieldError('title')+'</label>'+
        '<label class="phft-span-2"><span>Nội dung</span><textarea data-task-field="content" rows="4" placeholder="Mô tả yêu cầu và kết quả mong đợi">'+esc(taskUiState.form.content)+'</textarea></label>'+
        '<label><span>Ưu tiên *</span><select data-task-field="priority"><option value="thuong"'+(taskUiState.form.priority==='thuong'?' selected':'')+'>Thường</option><option value="quan_trong"'+(taskUiState.form.priority==='quan_trong'?' selected':'')+'>Quan trọng</option><option value="khan_cap"'+(taskUiState.form.priority==='khan_cap'?' selected':'')+'>Khẩn cấp</option></select>'+taskFieldError('priority')+'</label>'+
        '<label><span>Ngày bắt đầu</span><input type="datetime-local" data-task-field="start_at" value="'+esc(taskUiState.form.start_at)+'">'+taskFieldError('start_at')+'</label>'+
        '<label><span>Deadline *</span><input type="datetime-local" data-task-field="deadline" value="'+esc(taskUiState.form.deadline)+'">'+taskFieldError('deadline')+'</label>'+
      '</div></section>'+
      '<section class="phft-form-card"><header><h2>Người thực hiện</h2><p>Người chính được lưu cùng bản nháp.</p></header><div class="phft-people-grid">'+
        '<div><label class="phft-picker-label"><span>Người thực hiện chính *</span><input data-task-search="primary" value="'+esc(taskUiState.primaryQuery)+'" placeholder="Tìm theo tên hoặc mã nhân viên"></label><div class="phft-picker-results" data-task-results="primary">'+employeeResultsHtml('primary')+'</div><div class="phft-selected-primary">'+(taskUiState.form.primary_employee_code?'Đã chọn: <b>'+esc(employeeLabel(taskUiState.form.primary_employee_code))+'</b>':'Chưa chọn người thực hiện chính.')+'</div>'+taskFieldError('primary_employee_code')+'</div>'+
        // Người liên quan (Related) = OUT OF V1 / HOLD (business decision) —
        // KHÔNG hiển thị picker này trong UI. Hàm toggleRelated/selectedRelatedHtml/
        // normalizeRelatedCodes/persistTaskSupplements() giữ nguyên (dormant,
        // an toàn hơn xóa) — form.related_employee_codes luôn rỗng vì không còn
        // đường nào cho user điền vào, nên addTaskRelated không bao giờ được gọi
        // từ luồng tạo Task nữa.
      '</div></section>'+
      '<section class="phft-form-card"><header class="phft-card-action"><div><h2>Tài liệu liên kết</h2><p>URL phải dùng http:// hoặc https://; nhãn là tùy chọn.</p></div><button type="button" class="phft-btn-secondary" data-task-add-link>+ Thêm link</button></header><div class="phft-link-list">'+linkRowsHtml()+'</div></section>'+
      '<footer class="phft-form-actions"><span class="phft-submit-phase" data-task-phase>'+(taskUiState.submitting?esc(taskPhaseLabel()):'')+'</span><button type="button" class="phft-btn-secondary" data-task-cancel-create'+(taskUiState.submitting?' disabled':'')+'>Hủy</button><button type="submit" class="phft-btn-primary"'+(taskUiState.submitting?' disabled':'')+'>'+(taskUiState.submitting?'Đang lưu…':'Tạo bản nháp')+'</button></footer>'+
    '</form>';
}
function detailPersonName(value){
  if(!value)return '—';
  if(typeof value==='string')return employeeLabel(value);
  var row=normalizeEmployee(value);
  return row.code?(row.name+' · '+row.code):String(value.name||value.full_name||'—');
}
function detailValue(value){return value===null||value===undefined||value===''?'—':String(value);}
// Presentation-only mapping (Phase 1.5 mục 8) — KHÔNG đổi enum/API value,
// chỉ dịch nhãn hiển thị. Giá trị lạ/chưa map vẫn fallback về chính nó.
var TASK_STATUS_LABELS={draft:'Nháp',published:'Đã phát hành',in_progress:'Đang thực hiện',completed:'Hoàn thành',cancelled:'Đã hủy'};
var TASK_FLOW_TYPE_LABELS={giao_viec:'Giao việc',de_xuat:'Đề xuất'};
var TASK_PRIORITY_LABELS={thuong:'Thường',quan_trong:'Quan trọng',khan_cap:'Khẩn cấp'};
var TASK_LINK_SIDE_LABELS={input_reference:'Tài liệu đầu vào',output_result:'Kết quả đầu ra',coordination:'Phối hợp'};
var TASK_CAPABILITY_LABELS={view:'Xem',assign:'Giao việc',update:'Cập nhật',manage:'Quản trị'};
var TASK_GRANT_TYPE_LABELS={extend:'Mở rộng',restrict:'Giới hạn',delegation:'Ủy nhiệm'};
var TASK_PRESET_LABELS={giam_doc:'Giám đốc',tro_ly_gd:'Trợ lý GĐ',truong_bo_phan:'Trưởng bộ phận',truong_ca:'Trưởng ca',nhan_vien:'Nhân viên',admin_system:'Admin hệ thống'};
var TASK_PRESET_SOURCE_LABELS={assignment:'Đã gán preset',admin_system:'Tài khoản Admin',default:'Mặc định (chưa gán)',unavailable:'Chưa khả dụng'};
function taskEnumLabel(map,value){var key=String(value||'').toLowerCase();return map[key]||detailValue(value);}
function detailLinksHtml(links){
  var safe=(Array.isArray(links)?links:[]).filter(function(link){return validHttpUrl(link&&link.url);});
  if(!safe.length)return '<div class="phft-inline-empty">Chưa có tài liệu liên kết.</div>';
  return '<ul class="phft-detail-links">'+safe.map(function(link){return '<li><span>'+esc(taskEnumLabel(TASK_LINK_SIDE_LABELS,link.side))+'</span><a href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.label||link.url)+'</a></li>';}).join('')+'</ul>';
}
function detailContentHtml(detail,partialErrors){
  var source=detail||{}, task=source.task||{}, category=source.category||{}, primary=source.primary||task.primary_employee_code||null;
  var related=Array.isArray(source.related)?source.related:[], links=Array.isArray(source.links)?source.links:[];
  var warning=(partialErrors||[]).length?'<div class="phft-alert is-warning"><div><b>Đã tạo nháp, nhưng một số người liên quan/tài liệu chưa lưu thành công.</b><small>Bản nháp bên dưới là trạng thái thật đã tải lại từ hệ thống.</small></div><button type="button" class="phft-btn-secondary" data-task-retry-supplements>Thử lưu lại</button></div>':'';
  return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>'+esc(detailValue(task.title))+'</h1></div><button type="button" class="phft-btn-secondary" data-task-detail-back>Về Dashboard</button></div>'+warning+
    '<section class="phft-detail-card"><header><div><span class="phft-status">'+esc(taskEnumLabel(TASK_STATUS_LABELS,task.status))+'</span><h2>'+esc(detailValue(task.title))+'</h2><p>'+esc(detailValue(task.content))+'</p></div><span class="phft-task-id">'+esc(detailValue(task.id||task.task_id||taskUiState.taskId))+'</span></header><dl class="phft-detail-grid">'+
      '<div><dt>Loại</dt><dd>'+esc(taskEnumLabel(TASK_FLOW_TYPE_LABELS,task.flow_type))+'</dd></div><div><dt>Danh mục</dt><dd>'+esc(detailValue(category.display_name||task.category_display_name||task.category_code))+'</dd></div><div><dt>Ưu tiên</dt><dd>'+esc(taskEnumLabel(TASK_PRIORITY_LABELS,task.priority))+'</dd></div><div><dt>Tiến độ</dt><dd>'+esc(detailValue(task.progress_percent))+'%</dd></div><div><dt>Bắt đầu</dt><dd>'+esc(formatTaskDateTime(task.start_at))+'</dd></div><div><dt>Deadline</dt><dd>'+esc(formatTaskDateTime(task.deadline))+'</dd></div><div><dt>Người chính</dt><dd>'+esc(detailPersonName(primary))+'</dd></div><div><dt>Phiên bản dòng</dt><dd>'+esc(detailValue(task.row_version))+'</dd></div></dl></section>'+
    '<div class="phft-detail-columns"><section class="phft-form-card"><header><h2>Người liên quan</h2></header>'+(related.length?'<ul class="phft-person-list">'+related.map(function(row){return '<li>'+esc(detailPersonName(row))+'</li>';}).join('')+'</ul>':'<div class="phft-inline-empty">Chưa có người liên quan.</div>')+'</section><section class="phft-form-card"><header><h2>Tài liệu</h2></header>'+detailLinksHtml(links)+'</section></div>'+
    '<section class="phft-form-card"><header><h2>Thao tác vòng đời</h2><p>Sẽ được mở ở Batch 2D.</p></header><div class="phft-disabled-actions"><button type="button" disabled>Bắt đầu</button><button type="button" disabled>Cập nhật tiến độ</button><button type="button" disabled>Hoàn thành</button></div></section>';
}
function detailLoadingHtml(taskId){return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>Đang tải công việc</h1></div></div><section class="phft-form-card"><div class="phft-loading">Đang tải trạng thái thật từ hệ thống cho '+esc(taskId||'công việc')+'…</div></section>';}
function detailErrorHtml(taskId,message){return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>Chưa tải được chi tiết</h1></div><button type="button" class="phft-btn-secondary" data-task-detail-back>Về Dashboard</button></div><div class="phft-alert is-error"><div><b>Bản nháp đã có mã '+esc(taskId||'—')+', nhưng chưa tải lại được dữ liệu.</b><small>'+esc(message||'Vui lòng thử tải lại.')+'</small></div><button type="button" class="phft-btn-secondary" data-task-reload-detail>Thử lại</button></div>';}
function taskViewHtml(){
  if(taskUiState.view==='admin-people')return adminPeopleHtml();
  if(taskUiState.view==='create')return createTaskHtml();
  if(taskUiState.view==='detail'){
    if(taskUiState.detailLoading)return detailLoadingHtml(taskUiState.taskId);
    if(taskUiState.detailError)return detailErrorHtml(taskUiState.taskId,taskUiState.detailError);
    return detailContentHtml(taskUiState.detail,taskUiState.partialErrors);
  }
  return dashboardHtml();
}
function renderTaskRoot(root){root.innerHTML='<div class="phf-task-root-shell">'+shellFrame(taskViewHtml())+'</div>';bindShell(root);}
function updatePickerResults(root,kind){var target=root.querySelector('[data-task-results="'+kind+'"]');if(target)target.innerHTML=employeeResultsHtml(kind);}
async function openTaskCreate(root){
  taskUiState.view='create';taskUiState.form=defaultTaskForm();taskUiState.formErrors={};taskUiState.submitError='';taskUiState.submitPhase='';taskUiState.submitting=false;taskUiState.primaryQuery='';taskUiState.relatedQuery='';taskUiState.categories=[];taskUiState.categoriesError='';taskUiState.categoriesLoading=true;taskUiState.employees=[];taskUiState.employeesError='';taskUiState.employeesLoading=true;
  renderTaskRoot(root);
  await Promise.all([
    loadTaskAssignableEmployees().then(function(rows){taskUiState.employees=rows;if(!rows.length)taskUiState.employeesError='Không có nhân sự Đang làm trong phạm vi giao việc của bạn.';}).catch(function(error){taskUiState.employeesError='Không tải được danh sách nhân sự: '+taskApiErrorMessage(error);}).then(function(){taskUiState.employeesLoading=false;}),
    loadTaskCategories().then(function(rows){taskUiState.categories=rows;if(!rows.length)taskUiState.categoriesError='Chưa có danh mục công việc đang hoạt động.';}).catch(function(error){taskUiState.categoriesError='Không tải được danh mục công việc: '+taskApiErrorMessage(error);}).then(function(){taskUiState.categoriesLoading=false;})
  ]);
  if(taskUiState.view==='create')renderTaskRoot(root);
}
async function openTaskAdminPeople(root){
  if(!isTaskAdminUi())return;
  taskUiState.view='admin-people';taskUiState.adminPeopleLoading=true;taskUiState.adminPeopleError='';taskUiState.permissionEditor=null;taskUiState.permissionError='';renderTaskRoot(root);
  try{taskUiState.adminPeople=await loadTaskAdminPeople();}
  catch(error){taskUiState.adminPeople=null;taskUiState.adminPeopleError=taskApiErrorMessage(error);}
  taskUiState.adminPeopleLoading=false;if(taskUiState.view==='admin-people')renderTaskRoot(root);
}
function openTaskPermissionEditor(root,employeeCodeValue){
  var people=taskUiState.adminPeople&&Array.isArray(taskUiState.adminPeople.people)?taskUiState.adminPeople.people:[];
  var person=people.find(function(row){return employeeCode(row.employee_code)===employeeCode(employeeCodeValue);});if(!person)return;
  var policy=person.permission_adjustment||{},types=Array.isArray(policy.supported_scope_types)?policy.supported_scope_types:[];
  taskUiState.permissionEditor={employeeCode:employeeCode(person.employee_code),basePresetCode:employeeCode(person.task_preset_code||'NHAN_VIEN'),scopeType:types[0]||'',employeeCodes:[],reason:''};taskUiState.permissionError='';taskUiState.permissionSaving=false;renderTaskRoot(root);
}
function validateTaskBasePresetEditor(editor){
  if(!editor||!String(editor.reason||'').trim())return 'Bắt buộc nhập lý do thay đổi Task preset.';
  if(['GIAM_DOC','TRO_LY_GD','TRUONG_BO_PHAN','TRUONG_CA','NHAN_VIEN'].indexOf(employeeCode(editor.basePresetCode))<0)return 'Task preset chưa hợp lệ.';
  return '';
}
function validateTaskPermissionEditor(editor){
  if(!editor||!String(editor.reason||'').trim())return 'Bắt buộc nhập lý do điều chỉnh quyền.';
  if(editor.scopeType==='employees'&&(!Array.isArray(editor.employeeCodes)||!editor.employeeCodes.length))return 'Cần chọn ít nhất một nhân sự để mở rộng phạm vi.';
  if(!['employees','all_company'].includes(editor.scopeType))return 'Phạm vi Extend chưa hợp lệ.';
  return '';
}
async function saveTaskPermissionFromEditor(root){
  if(taskUiState.permissionSaving)return;
  var validation=validateTaskPermissionEditor(taskUiState.permissionEditor);if(validation){taskUiState.permissionError=validation;renderTaskRoot(root);return;}
  taskUiState.permissionSaving=true;taskUiState.permissionError='';renderTaskRoot(root);
  try{taskUiState.adminPeople=await saveTaskPermissionExtend(taskUiState.permissionEditor);taskUiState.permissionEditor=null;taskNotice('success','Đã lưu Extend','Quyền hiệu lực đã được tải lại từ backend.');}
  catch(error){taskUiState.permissionError=taskApiErrorMessage(error);}
  taskUiState.permissionSaving=false;renderTaskRoot(root);
}
async function saveTaskBasePresetFromEditor(root){
  if(taskUiState.permissionSaving)return;
  var validation=validateTaskBasePresetEditor(taskUiState.permissionEditor);if(validation){taskUiState.permissionError=validation;renderTaskRoot(root);return;}
  taskUiState.permissionSaving=true;taskUiState.permissionError='';renderTaskRoot(root);
  try{taskUiState.adminPeople=await saveTaskBasePreset(taskUiState.permissionEditor);taskUiState.permissionEditor=null;taskNotice('success','Đã lưu Task preset','Quyền hiệu lực đã được tải lại từ backend.');}
  catch(error){taskUiState.permissionError=taskApiErrorMessage(error);}
  taskUiState.permissionSaving=false;renderTaskRoot(root);
}
async function revokeTaskPermissionFromEditor(root,grantId){
  if(taskUiState.permissionSaving)return;
  var reason=String(taskUiState.permissionEditor&&taskUiState.permissionEditor.reason||'').trim();if(!reason){taskUiState.permissionError='Bắt buộc nhập lý do trước khi thu hồi grant.';renderTaskRoot(root);return;}
  taskUiState.permissionSaving=true;taskUiState.permissionError='';renderTaskRoot(root);
  try{taskUiState.adminPeople=await revokeTaskPermissionExtend(grantId,reason);taskUiState.permissionEditor=null;taskNotice('success','Đã thu hồi Extend','Quyền hiệu lực đã được tải lại từ backend.');}
  catch(error){taskUiState.permissionError=taskApiErrorMessage(error);}
  taskUiState.permissionSaving=false;renderTaskRoot(root);
}
function setTaskPhase(root,phase){taskUiState.submitPhase=phase;var target=root.querySelector('[data-task-phase]');if(target)target.textContent=taskPhaseLabel();}
async function submitTaskCreate(root){
  if(taskUiState.submitting)return;
  var checked=validateTaskForm(taskUiState.form);
  if(!checked.valid){taskUiState.formErrors=checked.errors;taskUiState.submitError='Vui lòng kiểm tra lại các trường bắt buộc.';renderTaskRoot(root);return;}
  taskUiState.formErrors={};taskUiState.submitError='';taskUiState.submitting=true;taskUiState.submitPhase='creating';renderTaskRoot(root);
  try{
    var result=await runCreateTaskFlow(checked.form,taskApi,function(phase){setTaskPhase(root,phase);});
    taskUiState.view='detail';taskUiState.taskId=result.taskId;taskUiState.rowVersion=result.rowVersion;taskUiState.detail=result.detail;taskUiState.detailError='';taskUiState.detailLoading=false;taskUiState.partialErrors=result.partialErrors;taskUiState.form=result.form;
    taskUiState.submitting=false;taskUiState.submitPhase='';
    navigateTask(taskDetailPath(result.taskId));
    if(result.partialErrors.length)taskNotice('warning','Tạo nháp chưa hoàn tất','Đã tạo nháp, nhưng một số người liên quan/tài liệu chưa lưu thành công.');
    else taskNotice('success','Đã tạo bản nháp','Chi tiết đã được tải lại từ hệ thống.');
  }catch(error){
    if(error.code==='TASK_FORM_INVALID')taskUiState.formErrors=error.fieldErrors||{};
    if(error.createdTaskId){taskUiState.view='detail';taskUiState.taskId=error.createdTaskId;taskUiState.rowVersion=error.createdRowVersion;taskUiState.detail=null;taskUiState.detailError=taskApiErrorMessage(error);taskUiState.partialErrors=error.partialErrors||[];taskNotice('warning','Đã tạo bản nháp','Không tải lại được chi tiết. Vui lòng thử lại.');navigateTask(taskDetailPath(error.createdTaskId));}
    else{taskUiState.view='create';taskUiState.submitError=taskApiErrorMessage(error);taskNotice('error','Chưa tạo được bản nháp',taskUiState.submitError);}
    taskUiState.submitting=false;taskUiState.submitPhase='';
    renderTaskRoot(root);
  }
}
async function reloadTaskDetail(root){
  if(!taskUiState.taskId)return;
  taskUiState.view='detail';taskUiState.detailLoading=true;taskUiState.detailError='';renderTaskRoot(root);
  try{var response=await taskApi({action:'getTaskDetail',task_id:taskUiState.taskId});taskUiState.detail=taskResult(response)||{};taskUiState.detailLoading=false;renderTaskRoot(root);}
  catch(error){taskUiState.detailLoading=false;taskUiState.detailError=taskApiErrorMessage(error);renderTaskRoot(root);}
}
async function retrySupplementsFromDetail(root){
  if(!taskUiState.partialErrors.length||taskUiState.submitting)return;
  taskUiState.submitting=true;
  try{
    var result=await retryTaskSupplements(taskUiState.taskId,taskUiState.partialErrors,taskApi,function(phase){taskUiState.submitPhase=phase;});
    taskUiState.detail=result.detail;taskUiState.partialErrors=result.partialErrors;taskUiState.detailError='';renderTaskRoot(root);
    if(result.partialErrors.length)taskNotice('warning','Vẫn còn mục chưa lưu','Đã tải lại trạng thái thật; một số mục vẫn chưa lưu thành công.');
    else taskNotice('success','Đã lưu bổ sung','Người liên quan và tài liệu đã được tải lại từ hệ thống.');
  }catch(error){taskNotice('error','Chưa thể tải lại chi tiết',taskApiErrorMessage(error));taskUiState.partialErrors=error.partialErrors||taskUiState.partialErrors;taskUiState.detailError=taskApiErrorMessage(error);taskUiState.submitting=false;taskUiState.submitPhase='';renderTaskRoot(root);}
  finally{taskUiState.submitting=false;taskUiState.submitPhase='';}
}

function bindShell(root){
  root.onclick=function(event){
    var target=event.target.closest('button');if(!target)return;
    if(target.matches('[data-task-back]')){goHub();return;}
    if(target.matches('[data-task-nav].is-soon')){taskToast('Mục này sẽ được triển khai ở phase tiếp theo.');return;}
    if(target.matches('[data-task-nav="people-permissions"]')){navigateTask(taskAdminPeoplePath());return;}
    if(target.matches('[data-task-nav="dashboard"]')){navigateTask(taskHomePath());return;}
    if(target.matches('[data-task-create]')){navigateTask(taskCreatePath());return;}
    if(target.matches('[data-task-cancel-create],[data-task-detail-back]')){navigateTask(taskHomePath());return;}
    if(target.matches('[data-task-pick-primary]')){taskUiState.form=choosePrimary(taskUiState.form,target.getAttribute('data-task-pick-primary'));taskUiState.formErrors.primary_employee_code='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-pick-related]')){taskUiState.form=toggleRelated(taskUiState.form,target.getAttribute('data-task-pick-related'));renderTaskRoot(root);return;}
    if(target.matches('[data-task-remove-related]')){taskUiState.form=toggleRelated(taskUiState.form,target.getAttribute('data-task-remove-related'));renderTaskRoot(root);return;}
    if(target.matches('[data-task-add-link]')){taskUiState.form.links.push({side:'input_reference',url:'',label:''});renderTaskRoot(root);return;}
    if(target.matches('[data-task-remove-link]')){taskUiState.form.links.splice(Number(target.getAttribute('data-task-remove-link')),1);renderTaskRoot(root);return;}
    if(target.matches('[data-task-reload-detail]')){reloadTaskDetail(root);return;}
    if(target.matches('[data-task-retry-supplements]')){retrySupplementsFromDetail(root);return;}
    if(target.matches('[data-task-admin-people-reload]')){openTaskAdminPeople(root);return;}
    if(target.matches('[data-task-permission-open]')){openTaskPermissionEditor(root,target.getAttribute('data-task-permission-open'));return;}
    if(target.matches('[data-task-permission-close]')){if(!taskUiState.permissionSaving){taskUiState.permissionEditor=null;taskUiState.permissionError='';renderTaskRoot(root);}return;}
    if(target.matches('[data-task-permission-save]')){saveTaskPermissionFromEditor(root);return;}
    if(target.matches('[data-task-base-preset-save]')){saveTaskBasePresetFromEditor(root);return;}
    if(target.matches('[data-task-permission-revoke]')){revokeTaskPermissionFromEditor(root,target.getAttribute('data-task-permission-revoke'));return;}
  };
  root.oninput=function(event){
    if(event.target.matches('[data-task-permission-reason]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.reason=event.target.value;taskUiState.permissionError='';return;}
    if(event.target.matches('[data-task-base-preset]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.basePresetCode=event.target.value;taskUiState.permissionError='';return;}
    if(event.target.matches('[data-task-permission-scope-type]')){if(taskUiState.permissionEditor){taskUiState.permissionEditor.scopeType=event.target.value;taskUiState.permissionEditor.employeeCodes=[];}taskUiState.permissionError='';renderTaskRoot(root);return;}
    if(event.target.matches('[data-task-permission-targets]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.employeeCodes=Array.from(event.target.selectedOptions||[]).map(function(option){return employeeCode(option.value);}).filter(Boolean);taskUiState.permissionError='';return;}
    var field=event.target.getAttribute('data-task-field');
    if(field){taskUiState.form[field]=event.target.value;delete taskUiState.formErrors[field];return;}
    var search=event.target.getAttribute('data-task-search');
    if(search){taskUiState[search+'Query']=event.target.value;updatePickerResults(root,search);return;}
    var linkField=event.target.getAttribute('data-task-link-field');
    if(linkField){var index=Number(event.target.getAttribute('data-task-link-index'));if(taskUiState.form.links[index]){taskUiState.form.links[index][linkField]=event.target.value;delete taskUiState.formErrors['link_'+index];}}
  };
  root.onchange=root.oninput;
  root.onsubmit=function(event){if(event.target.matches('[data-task-create-form]')){event.preventDefault();submitTaskCreate(root);}};
}

async function applyTaskRoute(root,routeKey){
  var route=parseTaskRoute(routeKey);
  if(route.view==='create'){await openTaskCreate(root);return true;}
  if(route.view==='admin-people'){await openTaskAdminPeople(root);return true;}
  if(route.view==='detail'){
    if(!route.taskId){navigateTask(taskHomePath(),true);return false;}
    if(taskUiState.view==='detail'&&taskUiState.taskId===route.taskId&&taskUiState.detail&&!taskUiState.detailError){renderTaskRoot(root);return true;}
    taskUiState.view='detail';taskUiState.taskId=route.taskId;taskUiState.detail=null;taskUiState.detailError='';taskUiState.partialErrors=[];
    await reloadTaskDetail(root);return true;
  }
  taskUiState.view='dashboard';renderTaskRoot(root);return true;
}

window.phfRenderTask = async function(path){
  if(window.PHFAppShell) window.PHFAppShell.activateTask(path);
  var root = document.getElementById('phfTaskRoot');
  if(!root) return false;
  document.title = 'PHF Task';
  await applyTaskRoute(root,path);
  try{ root.scrollTop = 0; window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
  return true;
};
window.phfTaskHomePath = taskHomePath;
if(window.__PHF_TASK_TEST_MODE__){
  window.__PHF_TASK_TEST__={TASK_TIME_ZONE:TASK_TIME_ZONE,currentUserTitle:currentUserTitle,taskHomePath:taskHomePath,taskCreatePath:taskCreatePath,taskAdminPeoplePath:taskAdminPeoplePath,taskDetailPath:taskDetailPath,parseTaskRoute:parseTaskRoute,applyTaskRoute:applyTaskRoute,defaultTaskForm:defaultTaskForm,cloneTaskForm:cloneTaskForm,validateTaskForm:validateTaskForm,buildCreatePayload:buildCreatePayload,taskDateTimeInputValue:taskDateTimeInputValue,serializeTaskLocalDateTime:serializeTaskLocalDateTime,formatTaskDateTime:formatTaskDateTime,normalizeRelatedCodes:normalizeRelatedCodes,normalizeLinks:normalizeLinks,validHttpUrl:validHttpUrl,normalizeEmployee:normalizeEmployee,taskAssignableEmployeeRows:taskAssignableEmployeeRows,loadTaskAssignableEmployees:loadTaskAssignableEmployees,normalizeTaskCategory:normalizeTaskCategory,taskActiveCategoryRows:taskActiveCategoryRows,loadTaskCategories:loadTaskCategories,loadTaskAdminPeople:loadTaskAdminPeople,buildTaskPermissionAssignmentPayload:buildTaskPermissionAssignmentPayload,saveTaskBasePreset:saveTaskBasePreset,validateTaskBasePresetEditor:validateTaskBasePresetEditor,buildTaskPermissionExtendPayload:buildTaskPermissionExtendPayload,saveTaskPermissionExtend:saveTaskPermissionExtend,revokeTaskPermissionExtend:revokeTaskPermissionExtend,taskPermissionEditorHtml:taskPermissionEditorHtml,validateTaskPermissionEditor:validateTaskPermissionEditor,adminPeopleHtml:adminPeopleHtml,adminPeopleTableHtml:adminPeopleTableHtml,shellFrame:shellFrame,choosePrimary:choosePrimary,toggleRelated:toggleRelated,persistTaskSupplements:persistTaskSupplements,runCreateTaskFlow:runCreateTaskFlow,retryTaskSupplements:retryTaskSupplements,createTaskHtml:createTaskHtml,detailContentHtml:detailContentHtml,detailLoadingHtml:detailLoadingHtml,detailErrorHtml:detailErrorHtml,getState:function(){return taskUiState;}};
}
})();
