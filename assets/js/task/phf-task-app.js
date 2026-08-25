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
function taskSettingsPath(){return '/admin/task/cai-dat';}
function taskDetailPath(taskId){return taskHomePath()+'/chi-tiet?task_id='+encodeURIComponent(String(taskId||'').trim());}
/* Workspace/Menu/View Scope V1 — "Tôi nhận"/"Tôi giao"/"Đề xuất" là GÓC NHÌN
   (relation) trên CÙNG 1 nguồn Task, không phải loại Task riêng — mỗi path
   dưới đây chỉ chọn relation cho listTasks(), KHÔNG có business engine
   riêng cho từng path (mục 13 Bước 2). */
// V5 mục 1, 11 — "Nhân sự tôi quản lý" là 1 relation/route RIÊNG (không còn
// là filter bên trong "Tôi nhận" như V3/V4). Route đăng ký ĐẦY ĐỦ ở cả
// phf-task-app.js (dưới đây, tự động qua parseTaskRoute) VÀ
// assets/js/phf-url-router.js (ROUTE_REGISTRY + PHF_ROUTE_MAP cho cả 3
// namespace admin/ql/hv) — thiếu 1 trong 2 nơi sẽ tái hiện đúng bug cũ
// "route tồn tại trong task app nhưng router fail-closed về /xx/task".
var TASK_LIST_RELATION_PATHS={received:'/nhan',assigned:'/giao',managed:'/nhan-su-toi-quan-ly',proposal_sent:'/de-xuat/toi-gui',proposal_received:'/de-xuat/toi-nhan-xu-ly'};
function taskListPath(relation){return taskHomePath()+(TASK_LIST_RELATION_PATHS[relation]||TASK_LIST_RELATION_PATHS.received);}
function taskCalendarPath(){return taskHomePath()+'/lich';}
function navigateTask(path,replace){if(typeof window.phfNavigate==='function')return window.phfNavigate(path,replace===true);}
function parseTaskRoute(routeKey){
  var url;try{url=new URL(String(routeKey||location.href),location.origin);}catch(e){url=new URL(location.href);}
  var path=String(url.pathname||'').replace(/\/$/,'');
  if(path===taskCreatePath())return{view:'create'};
  if(path===taskAdminPeoplePath()&&isTaskAdminUi())return{view:'admin-people'};
  if(path===taskSettingsPath()&&isTaskAdminUi())return{view:'settings'};
  if(path===taskHomePath()+'/chi-tiet')return{view:'detail',taskId:String(url.searchParams.get('task_id')||'').trim()};
  if(path===taskCalendarPath())return{view:'calendar'};
  var relationMatch=Object.keys(TASK_LIST_RELATION_PATHS).find(function(relation){return path===taskHomePath()+TASK_LIST_RELATION_PATHS[relation];});
  if(relationMatch)return{view:'list',relation:relationMatch};
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
/* 24H DATE/TIME CONTROL (Create Hardening V1 mục 2) — native <input
   type="datetime-local"> can render AM/PM (SA/CH) under some Windows/browser
   locales; PHF Task must NEVER show 12h. Reusable 3-part control (Date +
   Hour 00-23 + Minute 00-59) that composes/reads the SAME canonical
   'YYYY-MM-DDTHH:MM' string already used by taskDateTimeInputValue/
   serializeTaskLocalDateTime — no other internal contract changes. */
function taskDateTimeInputValueParts(value){
  var m=String(value||'').trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if(!m)return {date:'',hour:'',minute:''};
  return {date:m[1],hour:m[2],minute:m[3]};
}
function combineTaskDateTimeParts(dateStr,hourStr,minuteStr){
  var d=String(dateStr||'').trim();
  var h=String(hourStr||'').trim(), mnt=String(minuteStr||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||h===''||mnt==='')return '';
  var hNum=Number(h), mNum=Number(mnt);
  if(!Number.isInteger(hNum)||hNum<0||hNum>23)return '';
  if(!Number.isInteger(mNum)||mNum<0||mNum>59)return '';
  return d+'T'+padTaskDatePart(hNum)+':'+padTaskDatePart(mNum);
}
function taskDateTimeDisplayVN(value){
  var parts=taskDateTimeInputValueParts(value);
  if(!parts.date)return 'Chưa chọn';
  var m=parts.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return 'Chưa chọn';
  return m[3]+'/'+m[2]+'/'+m[1]+' '+parts.hour+':'+parts.minute;
}
function formatTaskDateTime(value){
  if(!value)return '—';
  var date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('vi-VN',{timeZone:TASK_TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}

function defaultTaskForm(){
  return {flow_type:'giao_viec',title:'',content:'',category_code:'',priority:'thuong',start_at:'',deadline:'',primary_employee_code:'',related_employee_codes:[],links:[]};
}
function quickTaskFormDefaults(){var form=defaultTaskForm();form.start_at=taskDateTimeInputValue(new Date());return form;}
/* CANONICAL MODE DEFAULTS (Create Modes Foundation V1 mục 8) — Tạo nhanh ép
   flow_type/priority/start_at/related tại tầng canonical NGAY LÚC SUBMIT, chứ
   không tin vào field UI/hidden có thể đã stale. start_at cố ý resolve ở đây
   (gọi ngay trước validate/build ở submitTaskCreate) để tránh bug "mở form
   lúc 08:00, bấm Giao lúc 10:00 vẫn lấy start=08:00" (mục 13). */
function applyModeCanonicalOverrides(form,mode){
  var next=cloneTaskForm(form);
  if(mode==='quick'){
    next.flow_type='giao_viec';
    next.priority='thuong';
    next.start_at=taskDateTimeInputValue(new Date());
    next.related_employee_codes=[];
  }
  return next;
}
/* FULL → QUICK safety (mục 6/12/13) — Quick không có chỗ hiển thị các thiết
   lập chỉ-Full; nếu đang có dữ liệu chỉ-Full thật sự, KHÔNG được âm thầm mất
   khi chuyển mode — phải liệt kê rõ và chờ user xác nhận bỏ. */
function fullToQuickBlockingReasons(form,touched,expandedSections){
  var reasons=[];
  if((form.related_employee_codes||[]).length)reasons.push('Người liên quan (CC) đã chọn ('+form.related_employee_codes.length+' người)');
  if(form.flow_type==='de_xuat')reasons.push('Loại phiếu đang là Đề xuất');
  if(form.priority&&form.priority!=='thuong')reasons.push('Ưu tiên khác Thường');
  if(touched&&touched.start)reasons.push('Đã tùy chỉnh thời gian Bắt đầu');
  if(expandedSections&&expandedSections.recurrence)reasons.push('Đang mở thiết lập Công việc lặp');
  return reasons;
}
function taskDateTimeInputValueFromVnParts(parts){return parts.year+'-'+padTaskDatePart(parts.month)+'-'+padTaskDatePart(parts.day)+'T'+padTaskDatePart(parts.hour)+':'+padTaskDatePart(parts.minute);}
function quickDeadlineInputValue(kind){
  var now=new Date();
  if(kind==='plus2h')return taskDateTimeInputValue(new Date(now.getTime()+2*60*60*1000));
  var p=taskTimeZoneParts(now);
  if(kind==='eod')return taskDateTimeInputValueFromVnParts({year:p.year,month:p.month,day:p.day,hour:23,minute:59});
  if(kind==='tomorrow9'){
    var vnMidnightUtcMs=Date.UTC(p.year,p.month-1,p.day,0,0,0)-taskTimeZoneOffsetMs(new Date(Date.UTC(p.year,p.month-1,p.day,0,0,0)));
    return taskDateTimeInputValue(new Date(vnMidnightUtcMs+24*60*60*1000+9*60*60*1000));
  }
  return '';
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
/* COPY TASK — chỉ đọc snapshot Task nguồn, KHÔNG write. Copy: title/category/
   priority/content/primary/related/link phù hợp. KHÔNG copy: status/progress/
   lịch sử/event/audit/kết quả/completed_at/published_at/row_version/recurrence
   config (Tạo phiếu V1 mục 12) — model form hiện tại vốn không có các trường
   đó nên tự động không copy nhầm. Start mới = hiện tại; deadline giữ duration
   cũ nếu source có đủ start+deadline hợp lệ. */
function buildCopyFormFromDetail(detail){
  var source=detail||{}, task=source.task||{};
  var primary=source.primary||null;
  var primaryCode=primary?employeeCode(typeof primary==='string'?primary:(primary.employee_code||primary.employeeCode)):'';
  var relatedCodes=(Array.isArray(source.related)?source.related:[]).map(function(row){return employeeCode(typeof row==='string'?row:(row.employee_code||row.employeeCode));}).filter(Boolean);
  var links=(Array.isArray(source.links)?source.links:[]).map(function(link){return {side:String(link&&link.side||'input_reference'),url:String(link&&link.url||''),label:String(link&&link.label||'')};});
  var startAt=new Date();
  var oldStart=task.start_at?new Date(task.start_at):null;
  var oldDeadline=task.deadline?new Date(task.deadline):null;
  var durationMs=(oldStart&&oldDeadline&&!isNaN(oldStart.getTime())&&!isNaN(oldDeadline.getTime())&&oldDeadline.getTime()>oldStart.getTime())?(oldDeadline.getTime()-oldStart.getTime()):null;
  var deadlineAt=durationMs!=null?new Date(startAt.getTime()+durationMs):null;
  return {
    flow_type:task.flow_type==='de_xuat'?'de_xuat':'giao_viec',
    title:String(task.title||''),
    content:String(task.content||''),
    category_code:employeeCode(task.category_code),
    priority:['thuong','quan_trong','khan_cap'].indexOf(task.priority)>=0?task.priority:'thuong',
    start_at:taskDateTimeInputValue(startAt),
    deadline:deadlineAt?taskDateTimeInputValue(deadlineAt):'',
    primary_employee_code:primaryCode,
    related_employee_codes:relatedCodes,
    links:links
  };
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
/* CREATE ATTEMPT KEY (Create Hardening V1 mục 9) — sinh 1 lần lúc submit đầu
   tiên, KHÔNG lúc mở form. Retry cùng attempt (lỗi trước khi biết server đã
   commit hay chưa) tái dùng ĐÚNG key này — không sinh key mới chỉ vì
   timeout/lỗi. Chỉ clear khi thành công thật sự (Task đã publish); mở form
   mới/Sao chép phiếu (đều đi qua openTaskCreate) sinh key mới. Không phải
   business dedup — chỉ chống đúng 1 submit bị gửi lại (double-click/network
   retry). window.crypto.randomUUID() khi có; fallback RFC4122-v4-ish khi
   không có (môi trường cũ/test) — vẫn đủ entropy cho một correlation token,
   không phải bí mật bảo mật.
*/
function generateTaskAttemptKey(){
  try{ if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID(); }catch(e){}
  var bytes=[];for(var i=0;i<16;i++)bytes.push(Math.floor(Math.random()*256));
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  var hex=bytes.map(function(b){return b.toString(16).padStart(2,'0');});
  return hex.slice(0,4).join('')+'-'+hex.slice(4,6).join('')+'-'+hex.slice(6,8).join('')+'-'+hex.slice(8,10).join('')+'-'+hex.slice(10,16).join('');
}
function buildCreatePayload(form,attemptKey){
  return {action:'createTaskDraft',flow_type:form.flow_type,title:form.title,content:form.content,category_code:form.category_code,priority:form.priority,start_at:form.start_at?serializeTaskLocalDateTime(form.start_at):null,deadline:serializeTaskLocalDateTime(form.deadline),primary_employee_code:form.primary_employee_code,create_idempotency_key:attemptKey||null};
}
function taskApiErrorMessage(error){
  var code=String(error&&error.code||'');
  if(code==='TASK_CAPABILITY_DENIED')return 'Bạn chưa được cấp quyền thực hiện thao tác này.';
  if(['TASK_ASSIGN_SCOPE_DENIED','TASK_ASSIGN_DENIED','TASK_RELATED_TARGET_DENIED','TASK_TRANSFER_TARGET_DENIED'].indexOf(code)>=0)return 'Nhân sự đã chọn nằm ngoài phạm vi giao việc của bạn.';
  if(code==='TASK_NOT_FOUND')return 'Không tìm thấy công việc hoặc bạn không còn quyền xem.';
  if(code==='TASK_VERSION_CONFLICT')return 'Công việc đã thay đổi ở nơi khác. Vui lòng tải lại.';
  if(['TASK_START_INVALID','TASK_DEADLINE_INVALID','TASK_DATE_ORDER_INVALID'].indexOf(code)>=0)return 'Ngày bắt đầu hoặc deadline không hợp lệ.';
  if(code==='TASK_DB_ERROR'&&/column/i.test(String(error&&error.message||'')))return 'Chưa sẵn sàng ghi Danh mục trên môi trường này — thiếu cột audit trên task_categories, cần migration bổ sung trước khi dùng chức năng này.';
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
async function runCreateTaskFlow(input,apiCall,onPhase,attemptKey){
  var checked=validateTaskForm(input), call=apiCall||taskApi;
  if(!checked.valid){var invalid=new Error('Vui lòng kiểm tra lại các trường bắt buộc.');invalid.code='TASK_FORM_INVALID';invalid.fieldErrors=checked.errors;throw invalid;}
  if(onPhase)onPhase('creating');
  var createResponse=await call(buildCreatePayload(checked.form,attemptKey));
  var created=taskResult(createResponse)||{}, taskId=String(created.id||created.task_id||'').trim(), taskCode=String(created.task_code||'').trim();
  if(!taskId){var missing=new Error('Backend chưa trả task_id sau khi tạo nháp.');missing.code='TASK_CREATE_RESPONSE_INVALID';throw missing;}
  var rowVersion=created.row_version==null?null:created.row_version;
  var failures=await persistTaskSupplements(taskId,checked.form.related_employee_codes,checked.form.links,call,onPhase);
  if(onPhase)onPhase('publishing');
  var published=true, publishError='';
  try{
    var publishResponse=await call({action:'publishTask',task_id:taskId,expected_row_version:rowVersion});
    var publishedTask=taskResult(publishResponse)||{};
    if(publishedTask.row_version!=null)rowVersion=publishedTask.row_version;
  }catch(error){published=false;publishError=taskApiErrorMessage(error);}
  if(onPhase)onPhase('detail');
  try{
    var detailResponse=await call({action:'getTaskDetail',task_id:taskId});
    return {taskId:taskId,taskCode:taskCode,rowVersion:rowVersion,detail:taskResult(detailResponse)||{},partialErrors:failures,form:checked.form,published:published,publishError:publishError};
  }catch(error){
    error.createdTaskId=taskId;error.createdTaskCode=taskCode;error.createdRowVersion=rowVersion;error.partialErrors=failures;error.published=published;error.publishError=publishError;throw error;
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
  return {code:code,name:name,department:String(row&&(row.department||row.department_name)||'').trim(),title:String(row&&(row.title||row.position)||'').trim(),branch:String(row&&row.branch||'').trim(),employmentStatus:String(row&&(row.employmentStatus||row.employment_status)||'').trim().toLowerCase(),taskActorType:String(row&&row.taskActorType||'nhan_vien').trim().toLowerCase()};
}
function taskAssignableEmployeeRows(rows){
  var seen={};
  return (Array.isArray(rows)?rows:[]).map(normalizeEmployee).filter(function(row){if(!row.code||row.employmentStatus!=='active'||seen[row.code])return false;seen[row.code]=true;return true;}).sort(function(a,b){return a.name.localeCompare(b.name,'vi');});
}
var TASK_MANAGER_LEVEL_ACTOR_TYPES={truong_bo_phan:true,truong_ca:true};
async function loadTaskAssignableEmployees(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskAssignableEmployees'}), result=taskResult(response)||{};
  return {rows:taskAssignableEmployeeRows(result.employees),requesterActorType:String(result.requester_actor_type||'nhan_vien').trim().toLowerCase()};
}
function normalizeTaskCategory(row){
  var sortOrderRaw=row&&(row.sortOrder!=null?row.sortOrder:row.sort_order);
  return {code:employeeCode(row&&(row.categoryCode||row.category_code||row.code)),name:String(row&&(row.displayName||row.display_name||row.name)||'').trim(),isActive:row&&(row.isActive===true||row.is_active===true),sortOrder:Number.isFinite(sortOrderRaw)?sortOrderRaw:null};
}
function taskActiveCategoryRows(rows){
  var seen={};
  return (Array.isArray(rows)?rows:[]).map(normalizeTaskCategory).filter(function(row){if(!row.code||!row.name||!row.isActive||seen[row.code])return false;seen[row.code]=true;return true;}).sort(function(a,b){
    if(a.sortOrder!=null&&b.sortOrder!=null&&a.sortOrder!==b.sortOrder)return a.sortOrder-b.sortOrder;
    if(a.sortOrder!=null&&b.sortOrder==null)return -1;
    if(a.sortOrder==null&&b.sortOrder!=null)return 1;
    return a.name.localeCompare(b.name,'vi');
  });
}
async function loadTaskCategories(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskCategories'}), result=taskResult(response)||{};
  return taskActiveCategoryRows(result.categories);
}
async function loadTaskFoundationStatus(apiCall){
  var response=await (apiCall||taskApi)({action:'checkTaskFoundationStatus'}), result=taskResult(response)||{};
  return {
    categorySchemaReady:result.category_schema_ready===true,
    createTaskReady:result.create_task_ready===true,
    createTaskRpcReady:result.create_task_rpc_ready===true,
    addRelatedRpcReady:result.add_related_rpc_ready===true,
    addLinkRpcReady:result.add_link_rpc_ready===true,
    deleteCategoryRpcReady:result.delete_category_rpc_ready===true,
    crossDepartmentSnapshotReady:result.cross_department_snapshot_ready===true,
    taskNotificationSchemaReady:result.task_notification_schema_ready===true
  };
}
function normalizeAdminTaskCategory(row){
  return {code:employeeCode(row&&(row.categoryCode||row.category_code||row.code)),name:String(row&&(row.displayName||row.display_name||row.name)||'').trim(),isActive:row&&(row.isActive===true||row.is_active===true),isUsed:row&&(row.isUsed===true||row.is_used===true),sortOrder:Number.isFinite(row&&(row.sortOrder!=null?row.sortOrder:row.sort_order))?(row.sortOrder!=null?row.sortOrder:row.sort_order):null};
}
async function loadAdminTaskCategories(apiCall){
  var response=await (apiCall||taskApi)({action:'listAdminTaskCategories'}), result=taskResult(response)||{};
  return (Array.isArray(result.categories)?result.categories:[]).map(normalizeAdminTaskCategory).filter(function(row){return row.code;});
}
// REFERENCE_CATEGORY_NAMES — danh mục tham khảo từ hệ cũ (Tạo phiếu V1 mục
// 5). CHỈ hiển thị để tham khảo, KHÔNG tự tạo/seed — Admin chủ động bấm
// "Thêm danh mục" nếu muốn dùng đúng tên nào.
var REFERENCE_CATEGORY_NAMES=['Báo cáo','Tài chính','Kho vận','Nhân sự','Kinh doanh','Công việc tổng thể','Thu mua','Chăm sóc khách hàng','Dự án','Phát sinh khác','Đào tạo','Sửa chữa','Thanh toán'];
async function loadTaskAdminPeople(apiCall){
  var response=await (apiCall||taskApi)({action:'listTaskAdminPeople'}), result=taskResult(response)||{};
  return {identityReady:result.identity_ready===true,identityStatus:String(result.identity_status||''),identityMessage:String(result.identity_message||''),permissionSchemaReady:result.permission_schema_ready!==false,permissionSchemaError:String(result.permission_schema_error||''),permissionSchemaMessage:String(result.permission_schema_message||''),checklistReferenceReady:result.checklist_reference_ready!==false,people:Array.isArray(result.people)?result.people:[],summary:result.summary||{total:0,active:0,inactive:0,with_account:0}};
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
function defaultPeopleFilters(){return {role:'',department:'',employmentStatus:'',accountStatus:'',permissionSource:'',checklistStatus:'',search:''};}
function defaultExpandedSections(){return {content:false,related:false,links:false,recurrence:false};}
var TASK_LIST_PAGE_SIZE=50;
function defaultTaskListState(){return {relation:'received',statusFilter:'all',scope:'',search:'',loading:false,loadingMore:false,error:'',tasks:[],viewScopeType:'self',requesterActorType:'nhan_vien',offset:0,hasMore:false};}
var taskUiState={view:'dashboard',list:defaultTaskListState(),calendar:defaultTaskCalendarState(),navGroupExpanded:{},hasManagedScope:false,demoDetailTaskId:'',demoWorkspaceNote:'',demoWorkspaceLinkLabel:'',demoWorkspaceLinkUrl:'',demoAssignerFeedback:'',demoReworkOpen:false,demoReworkReason:'',demoCancelOpen:false,demoCancelReason:'',demoCancelRequestOpen:false,demoCancelRequestReason:'',createTab:'quick',quickSuccess:null,modeSwitchWarning:null,advancedTouched:{start:false},createAttemptKey:null,taskCode:'',form:defaultTaskForm(),formErrors:{},submitError:'',submitPhase:'',submitting:false,categories:[],categoriesLoading:false,categoriesError:'',employees:[],employeesLoading:false,employeesError:'',requesterActorType:'nhan_vien',primaryPickerOpen:true,expandedSections:defaultExpandedSections(),primaryQuery:'',relatedQuery:'',primaryDept:'',relatedDept:'',taskId:'',rowVersion:null,detail:null,detailLoading:false,detailError:'',partialErrors:[],lifecycleMode:'',lifecyclePercent:0,lifecycleDirty:false,lifecycleResultText:'',lifecycleReason:'',lifecycleSaving:false,lifecycleError:'',lifecycleErrorCode:'',lifecycleErrorScope:'',adminPeople:null,adminPeopleLoading:false,adminPeopleError:'',peopleFilters:defaultPeopleFilters(),permissionEditor:null,permissionSaving:false,permissionError:'',settingsCategories:[],settingsLoading:false,settingsError:'',settingsSaving:false,newCategoryName:'',newCategoryError:'',editingCategoryCode:'',editingCategoryName:'',foundationStatus:null,foundationStatusLoading:false};

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
/* Business Owner CHỐT (2026-08-22, checkpoint "Việc của tôi"): gom 4 góc
   nhìn liên quan trực tiếp tới người đăng nhập vào 1 menu cha DUY NHẤT —
   "Việc của tôi" KHÔNG phải loại Task mới, chỉ là nhóm điều hướng cho 4
   authorized view đã có trên CÙNG 1 nguồn Task (không duplicate dữ liệu). */
// V5 mục 2 — "Nhân sự tôi quản lý" chỉ render cho actor thực sự có managed
// scope (managerOnly:true, lọc bởi taskManagerScopeAvailable() bên dưới,
// KHÔNG dùng title/role heuristic). Nhân viên thường KHÔNG thấy child này.
function taskManagerScopeAvailable(){
  if(isTaskDemoModeOn())return window.PHF_TASK_UI_DEMO_MANAGER_SCOPE===true;
  // Production hook — canonical Task scope/managedEmployeeCodes thật sẽ set
  // taskUiState.hasManagedScope sau khi hydrate session capability. KHÔNG tự
  // suy đoán qua title/role — mặc định false (fail-closed) nếu chưa hydrate.
  return taskUiState.hasManagedScope===true;
}
var NAV_ITEMS = [
  { key:'dashboard', label:'Trang chủ', desc:'Tổng quan công việc', enabled:true },
  { key:'viec-cua-toi', label:'Việc của tôi', desc:'Phiếu liên quan trực tiếp tới bạn', enabled:true, children:[
    { key:'toi-nhan', label:'Tôi nhận', relation:'received' },
    { key:'toi-giao', label:'Tôi giao', relation:'assigned' },
    { key:'nhan-su-toi-quan-ly', label:'Nhân sự tôi quản lý', relation:'managed', managerOnly:true },
    { key:'de-xuat-toi-gui', label:'Đề xuất tôi gửi', relation:'proposal_sent' },
    { key:'de-xuat-toi-nhan', label:'Đề xuất tôi nhận xử lý', relation:'proposal_received' }
  ]},
  { key:'lich', label:'Lịch', desc:'Lịch công việc', enabled:true },
  { key:'timeline', label:'Timeline', desc:'Dòng thời gian', enabled:false },
  { key:'bao-cao', label:'Báo cáo', desc:'Hiệu suất & kết quả', enabled:false },
  { key:'people-permissions', label:'Nhân sự & phân quyền', desc:'Vai trò và phạm vi Task', enabled:true, adminOnly:true },
  { key:'settings', label:'Cài đặt', desc:'Danh mục công việc', enabled:true, adminOnly:true }
];
var TASK_NAV_KEY_BY_RELATION={received:'toi-nhan',assigned:'toi-giao',managed:'nhan-su-toi-quan-ly',proposal_sent:'de-xuat-toi-gui',proposal_received:'de-xuat-toi-nhan'};
var TASK_RELATION_BY_NAV_KEY={'toi-nhan':'received','toi-giao':'assigned','nhan-su-toi-quan-ly':'managed','de-xuat-toi-gui':'proposal_sent','de-xuat-toi-nhan':'proposal_received'};
function findNavParentKey(childKey){
  var parent=NAV_ITEMS.find(function(item){return item.children&&item.children.some(function(c){return c.key===childKey;});});
  return parent?parent.key:'';
}
function taskNavVisibleChildren(item){
  return (item.children||[]).filter(function(child){return !child.managerOnly||taskManagerScopeAvailable();});
}

function navGroupExpanded(groupKey,activeNav){
  // Đang ở 1 child của group này → LUÔN expanded (F5/deep-link phải giữ
  // đúng trạng thái expanded+active, không phụ thuộc toggle thủ công trước đó).
  if(findNavParentKey(activeNav)===groupKey)return true;
  if(Object.prototype.hasOwnProperty.call(taskUiState.navGroupExpanded,groupKey))return !!taskUiState.navGroupExpanded[groupKey];
  return true; // mặc định mở — chỉ 1 group hiện có, không cần thu gọn sẵn
}
function navItemHtml(item,activeNav){
  if(item.children){
    var visibleChildren=taskNavVisibleChildren(item);
    var expanded=navGroupExpanded(item.key,activeNav);
    var isActiveGroup=visibleChildren.some(function(c){return c.key===activeNav;});
    var header='<button type="button" class="phft-nav-item phft-nav-group-toggle'+(isActiveGroup?' active':'')+'" data-task-nav-group="'+item.key+'" aria-expanded="'+(expanded?'true':'false')+'">' +
      '<span><b>'+esc(item.label)+'</b><small>'+esc(item.desc)+'</small></span>' +
      '<span class="phft-nav-chevron" aria-hidden="true">'+(expanded?'▾':'▸')+'</span>' +
    '</button>';
    var childrenHtml=expanded?('<div class="phft-nav-children">'+visibleChildren.map(function(child){
      return '<button type="button" class="phft-nav-item phft-nav-child'+(child.key===activeNav?' active':'')+'" data-task-nav="'+child.key+'"><span><b>'+esc(child.label)+'</b></span></button>';
    }).join('')+'</div>'):'';
    return header+childrenHtml;
  }
  return '<button type="button" class="phft-nav-item'+(item.key===activeNav?' active':'')+(item.enabled?'':' is-soon')+'" data-task-nav="'+item.key+'"'+(item.enabled?'':' aria-disabled="true"')+'>' +
    '<span><b>'+esc(item.label)+'</b><small>'+esc(item.desc)+'</small></span>' +
    (item.enabled?'':'<em class="phft-soon-badge">Sắp triển khai</em>') +
  '</button>';
}
function shellFrame(bodyHtml){
  var activeNav=taskUiState.view==='admin-people'?'people-permissions':(taskUiState.view==='settings'?'settings':(taskUiState.view==='calendar'?'lich':(taskUiState.view==='list'?(TASK_NAV_KEY_BY_RELATION[taskUiState.list.relation]||'toi-nhan'):'dashboard')));
  var navHtml = NAV_ITEMS.filter(function(item){return !item.adminOnly||isTaskAdminUi();}).map(function(item){return navItemHtml(item,activeNav);}).join('');
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

/* ---------------------------------------------------------------------
   TASK LIST — "Tôi nhận" / "Tôi giao" / "Đề xuất — Tôi gửi" / "Đề xuất —
   Tôi nhận xử lý". MỘT hàm render + MỘT loader dùng chung cho cả 4 relation
   (mục 13 Bước 2: một nguồn Task → nhiều authorized view, KHÔNG có business
   engine riêng cho từng góc nhìn). Authorization (ai được xem gì) hoàn toàn
   do server (listTasks action, api/_lib/task-core.js) quyết định — màn này
   CHỈ hiển thị + filter/search TRÊN tập dữ liệu server đã trả về, KHÔNG tự
   suy thêm quyền xem ở client (mục 8: filter không phải security boundary).
--------------------------------------------------------------------- */
// V5 mục 1, 3 — "Nhân sự tôi quản lý" tách khỏi "Tôi nhận" thành header/relation
// riêng. "Tôi nhận" quay lại đúng nghĩa cá nhân (subtitle không còn nhắc quản
// lý/scope filter — xem taskListHeaderFor()).
var TASK_LIST_HEADER={
  received:{title:'Tôi nhận',subtitle:'Công việc bạn trực tiếp nhận'},
  assigned:{title:'Tôi giao',subtitle:'Các công việc bạn đã giao'},
  managed:{title:'Nhân sự tôi quản lý',subtitle:'Công việc của nhân sự thuộc phạm vi bạn quản lý — bạn xem với vai trò quản lý, không phải người nhận'},
  proposal_sent:{title:'Đề xuất — Tôi gửi',subtitle:'Đề xuất bạn đã gửi'},
  proposal_received:{title:'Đề xuất — Tôi nhận xử lý',subtitle:'Đề xuất gửi tới bạn'}
};
var TASK_STATUS_TAB_LABELS={all:'Tất cả',in_progress:'Đang làm',overdue:'Quá hạn',completed:'Hoàn thành'};
// V5 mục 6 — "Nhân sự tôi quản lý" cần đủ 5 status bucket (mutually exclusive)
// để Tổng luôn reconcile đúng bằng tổng 5 bucket con (không chỉ 3 bucket cũ
// như Tôi nhận/Tôi giao — 2 relation đó KHÔNG đổi, giữ nguyên 4 tab cũ).
var TASK_STATUS_TAB_LABELS_MANAGED={all:'Tất cả',in_progress:'Đang thực hiện',overdue:'Quá hạn',completed:'Hoàn thành',rework:'Cần xử lý lại',cancelled:'Đã hủy'};
function taskStatusTabLabelsForRelation(relation){return relation==='managed'?TASK_STATUS_TAB_LABELS_MANAGED:TASK_STATUS_TAB_LABELS;}
var TASK_STATUS_DISPLAY_LABELS={draft:'Nháp',published:'Mới giao',in_progress:'Đang làm',completed:'Hoàn thành',cancelled:'Đã hủy'};
// V5 mục 5 — trong "Nhân sự tôi quản lý", "Liên phòng ban" là ATTRIBUTE
// FILTER duy nhất còn lại (KHÔNG còn "Của tôi"/"Nhân sự tôi quản lý" — 2 lựa
// chọn đó đã trở thành 2 relation/route RIÊNG, không phải filter value nữa).
var TASK_CROSS_DEPT_FILTER_LABELS={'':'Tất cả',cross_department:'Liên phòng ban'};
function taskListRowStatusLabel(row){
  // V3 mục 5-9 — "Cần xử lý lại" là 1 NHÃN PRESENTATION đè lên trên trạng
  // thái hoàn thành cũ, KHÔNG đổi row.status (mốc hoàn thành/completed vẫn
  // giữ nguyên trong history — Task state và Score state tách biệt, mục 9).
  if(row.rework_state==='requested')return row.status==='in_progress'?'Đang xử lý lại':'Cần xử lý lại';
  if(row.status==='published'||row.status==='in_progress'){
    if(row.deadline&&new Date(row.deadline).getTime()<Date.now())return 'Quá hạn';
    return 'Đang làm';
  }
  return TASK_STATUS_DISPLAY_LABELS[row.status]||row.status;
}
function taskListCrossDeptTagHtml(row){
  if(row.is_cross_department!==true)return '';
  return '<span class="phft-cross-dept-tag">Liên phòng ban'+(row.source_department&&row.target_department?': '+esc(row.source_department)+' → '+esc(row.target_department):'')+'</span>';
}
// V3 mục 12 — "Liên phòng ban" KHÔNG phải kho Task riêng, chỉ là tag/filter
// trên is_cross_department (đã có từ trước). "Nhân sự tôi quản lý" cũng vậy:
// scope_kind='managed' chỉ là 1 thuộc tính presentation-only trên fixture,
// KHÔNG phải bucket dữ liệu riêng (mục 10-13).
function taskListManagedTagHtml(row){
  if(row.scope_kind!=='managed')return '';
  return '<span class="phft-managed-tag" title="Công việc của nhân sự bạn quản lý">Nhân sự quản lý</span>';
}
// V4 mục 5B, 10 — Task completed đang có yêu cầu Admin hủy (status CHƯA đổi
// ngay) cần 1 tín hiệu nhỏ trên list để không ai hiểu nhầm đây vẫn là 1 Task
// hoàn thành bình thường.
function taskListCancelRequestTagHtml(row){
  if(row.cancel_request_state!=='pending')return '';
  return '<span class="phft-cancel-pending-tag" title="Đã gửi yêu cầu Admin hủy phiếu, đang chờ xử lý">Chờ Admin xử lý yêu cầu hủy</span>';
}
// V3 mục 15-17 — terminology Đề xuất KHÔNG được mượn wording Giao việc.
// V5 mục 9 — "Nhân sự tôi quản lý" cần cột riêng "Nhân viên thực hiện" (không
// dùng "Người nhận" — tránh gợi ý manager là recipient).
function taskListCounterpartyLabel(relation){
  if(relation==='proposal_sent')return 'Người xử lý đề xuất';
  if(relation==='proposal_received')return 'Người gửi đề xuất';
  if(relation==='managed')return 'Nhân viên thực hiện';
  return relation==='received'?'Người giao':'Người nhận';
}
// PHF_TASK_UI_DEMO_V1 — tag "Lặp"/"Có tài liệu" chỉ render khi field demo-only
// (repeat/links) có mặt — field này KHÔNG tồn tại trong response listTasks()
// thật nên KHÔNG ảnh hưởng gì khi chạy với dữ liệu thật (luôn undefined).
function taskListDemoTagsHtml(row){
  var tags='';
  if(row.repeat)tags+='<span class="phft-repeat-tag" title="Công việc lặp định kỳ">Lặp</span>';
  if(Array.isArray(row.links)&&row.links.length)tags+='<span class="phft-link-tag" title="Có tài liệu/link đính kèm">Có tài liệu</span>';
  return tags;
}
function taskListRowHtml(row,relation){
  var isManaged=relation==='managed';
  var counterparty=(relation==='received'||relation==='proposal_received')?row.created_by:row.primary;
  // V5 mục 9-11 — trong chính màn "Nhân sự tôi quản lý", tag/note "Nhân sự
  // quản lý" là dư thừa (cả màn đã là managed) — chỉ còn hiện tag đó nếu 1
  // row managed lọt vào chỗ khác (không nên xảy ra sau khi tách source, giữ
  // guard này để an toàn/không im lặng nếu có bug). Thêm cột riêng "Người
  // giao" cho relation=managed đúng row semantics mục 9.
  var managedTag=isManaged?'':taskListManagedTagHtml(row);
  var managedRecipientNote=(!isManaged&&row.scope_kind==='managed')?'<small class="phft-managed-recipient-note">Người thực hiện: '+esc(row.primary?row.primary.full_name:'—')+'</small>':'';
  var creatorCell=isManaged?('<td>'+esc(row.created_by?row.created_by.full_name:'—')+'<small>'+esc(row.created_by?row.created_by.department:'')+'</small></td>'):'';
  return '<tr data-task-list-row="'+esc(row.task_id)+'">' +
    '<td class="phft-list-code">'+esc(row.task_code||'—')+(row.self_task?' <span class="phft-self-task-tag">Tự giao</span>':'')+'</td>' +
    '<td>'+esc(row.title)+taskListCrossDeptTagHtml(row)+managedTag+taskListCancelRequestTagHtml(row)+taskListDemoTagsHtml(row)+'</td>' +
    '<td>'+esc(counterparty?counterparty.full_name:'—')+'<small>'+esc(counterparty?counterparty.department:'')+'</small>'+managedRecipientNote+'</td>' +
    creatorCell +
    '<td>'+esc(row.category_code||'—')+'</td>' +
    '<td>'+esc(formatTaskDateTime(row.deadline))+'</td>' +
    '<td>'+esc(row.priority||'—')+'</td>' +
    '<td>'+esc(taskListRowStatusLabel(row))+(typeof row.progress_percent==='number'?' · '+row.progress_percent+'%':'')+'</td>' +
  '</tr>';
}
function taskListTableHtml(){
  var relation=taskUiState.list.relation, rows=taskUiState.list.tasks||[];
  if(taskUiState.list.loading)return '<div class="phft-empty">Đang tải danh sách công việc…</div>';
  if(taskUiState.list.error)return '<div class="phft-alert is-error"><div><b>Không tải được danh sách.</b><small>'+esc(taskUiState.list.error)+'</small></div></div>';
  if(!rows.length)return '<div class="phft-empty">Không có công việc nào phù hợp.</div>';
  // V5 mục 9 — relation=managed cần thêm cột "Người giao" (bên cạnh "Nhân
  // viên thực hiện") vì viewer không phải 1 trong 2 phía của Task.
  var extraHeader=relation==='managed'?'<th>Người giao</th>':'';
  return '<div class="phft-table-scroll"><table class="phft-list-table"><thead><tr>' +
    '<th>Mã phiếu</th><th>Tiêu đề</th><th>'+esc(taskListCounterpartyLabel(relation))+'</th>'+extraHeader+'<th>Danh mục</th><th>Deadline</th><th>Ưu tiên</th><th>Trạng thái</th>' +
  '</tr></thead><tbody>'+rows.map(function(row){return taskListRowHtml(row,relation);}).join('')+'</tbody></table></div>';
}
// V5 mục 5, 8 — "Liên phòng ban" là ATTRIBUTE FILTER (không phải status),
// chỉ còn áp dụng trong relation='managed'. KHÔNG còn "Của tôi"/"Nhân sự
// tôi quản lý" trong filter này nữa — 2 lựa chọn đó nay là 2 relation/route
// riêng (mục 1-3), không phải scope value bên trong "Tôi nhận".
function taskListManagerScopeFilterHtml(){
  if(taskUiState.list.relation!=='managed')return '';
  var current=taskUiState.list.scope||'';
  return '<select class="phft-select" data-task-list-scope>'+Object.keys(TASK_CROSS_DEPT_FILTER_LABELS).map(function(value){
    return '<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(TASK_CROSS_DEPT_FILTER_LABELS[value])+'</option>';
  }).join('')+'</select>';
}
// V5 mục 6-7 — SUMMARY RECONCILIATION: mỗi row rơi vào ĐÚNG 1 bucket, không
// hơn không kém, nên Tổng LUÔN bằng tổng các bucket con cho CÙNG 1 dataset
// (mục 6: "Tổng = Đang thực hiện + Quá hạn + Hoàn thành + Cần xử lý lại +
// Đã hủy"). "Liên phòng ban" KHÔNG tham gia phép cộng này — nó là attribute
// filter áp dụng TRƯỚC khi đếm (rows đã được demoFilterTasks/backend lọc
// theo scope=cross_department từ trước khi hàm này chạy), không phải 1
// status riêng (mục 7).
function taskListSummaryCounts(){
  var rows=taskUiState.list.tasks||[], now=Date.now();
  var isManaged=taskUiState.list.relation==='managed';
  var counts={total:rows.length,in_progress:0,overdue:0,completed:0};
  if(isManaged){counts.rework=0;counts.cancelled=0;}
  rows.forEach(function(row){
    if(isManaged&&row.status==='cancelled'){counts.cancelled++;return;}
    if(isManaged&&row.rework_state==='requested'){counts.rework++;return;}
    if(row.status==='completed'){counts.completed++;return;}
    if((row.status==='published'||row.status==='in_progress')){
      if(row.deadline&&new Date(row.deadline).getTime()<now)counts.overdue++;else counts.in_progress++;
    }
  });
  return counts;
}
function taskListHeaderFor(){
  return TASK_LIST_HEADER[taskUiState.list.relation]||TASK_LIST_HEADER.received;
}
function taskListKpiTilesHtml(counts,relation){
  var tiles=[['total','Tổng công việc'],['in_progress',relation==='managed'?'Đang thực hiện':'Đang làm'],['overdue','Quá hạn'],['completed','Hoàn thành']];
  if(relation==='managed')tiles=tiles.concat([['rework','Cần xử lý lại'],['cancelled','Đã hủy']]);
  return tiles.map(function(t){return '<article class="phft-kpi"><strong>'+(counts[t[0]]||0)+'</strong><span>'+esc(t[1])+'</span></article>';}).join('');
}
function taskListHtml(){
  var relation=taskUiState.list.relation;
  var header=taskListHeaderFor();
  var counts=taskListSummaryCounts();
  var statusLabels=taskStatusTabLabelsForRelation(relation);
  var tabs=Object.keys(statusLabels).map(function(key){
    return '<button type="button" class="phft-tab'+(taskUiState.list.statusFilter===key?' is-active':'')+'" data-task-list-status="'+key+'">'+esc(statusLabels[key])+'</button>';
  }).join('');
  return '' +
    '<div class="phft-page-head">' +
      '<div><small>PHF TASK</small><h1>'+esc(header.title)+'</h1><p class="phft-page-subtitle">'+esc(header.subtitle)+'</p></div>' +
      '<button type="button" class="phft-btn-primary" data-task-create>+ Tạo công việc mới</button>' +
    '</div>' +
    '<section class="phft-kpi-row'+(relation==='managed'?' is-managed':'')+'">'+taskListKpiTilesHtml(counts,relation)+'</section>' +
    '<section class="phft-panel">' +
      '<div class="phft-list-toolbar">' +
        '<div class="phft-tabbar phft-tabbar-inline">'+tabs+'</div>' +
        taskListManagerScopeFilterHtml() +
        '<input type="search" class="phft-input" placeholder="Tìm theo mã phiếu hoặc tiêu đề (VD: CV-2608-0003)" value="'+esc(taskUiState.list.search)+'" data-task-list-search>' +
      '</div>' +
      taskListTableHtml() +
      (taskUiState.list.hasMore?'<div class="phft-list-load-more"><button type="button" class="phft-btn-secondary" data-task-list-load-more'+(taskUiState.list.loadingMore?' disabled':'')+'>'+(taskUiState.list.loadingMore?'Đang tải…':'Xem thêm')+'</button></div>':'') +
    '</section>' +
    demoTaskDetailModalHtml();
}
// PHF_TASK_UI_DEMO_V1 — công tắc DUY NHẤT đọc từ phf-task-ui-demo-fixtures.js.
// KHÔNG có nhánh nào khác trong file này tạo dữ liệu giả — mọi write path
// (taskApi/submitTaskCreate/...) hoàn toàn không đổi, không có cách nào demo
// fixture lọt vào request ghi thật.
function isTaskDemoModeOn(){return window.PHF_TASK_UI_DEMO_V1===true;}
function demoFilterTasks(rows,list){
  var now=Date.now();
  return (rows||[]).filter(function(row){
    // V5 mục 6 — thống nhất với taskListSummaryCounts(): 'completed' KHÔNG
    // gồm Task đang "Cần xử lý lại" (rework_state='requested') — 2 bucket
    // loại trừ nhau, để statusFilter và KPI/summary luôn khớp nhau.
    if(list.statusFilter==='cancelled'&&row.status!=='cancelled')return false;
    if(list.statusFilter==='rework'&&row.rework_state!=='requested')return false;
    if(list.statusFilter==='completed'&&!(row.status==='completed'&&row.rework_state!=='requested'))return false;
    if(list.statusFilter==='in_progress'&&!((row.status==='published'||row.status==='in_progress')&&(!row.deadline||new Date(row.deadline).getTime()>=now)))return false;
    if(list.statusFilter==='overdue'&&!((row.status==='published'||row.status==='in_progress')&&row.deadline&&new Date(row.deadline).getTime()<now))return false;
    // V5 mục 5, 7 — "Liên phòng ban" là ATTRIBUTE FILTER duy nhất còn lại
    // trong list.scope (chỉ áp dụng khi relation='managed' — xem
    // taskListManagerScopeFilterHtml()); KHÔNG còn 'mine'/'managed' scope
    // value nữa (2 relation riêng đã thay thế, xem loadTaskList()).
    if(list.scope==='cross_department'&&row.is_cross_department!==true)return false;
    if(list.search){
      var q=list.search.trim().toLowerCase();
      if(q&&(row.task_code||'').toLowerCase().indexOf(q)<0&&(row.title||'').toLowerCase().indexOf(q)<0)return false;
    }
    return true;
  });
}
// V5 mục 1, 3, 4 — "managed" KHÔNG phải bucket fixture riêng: nó là tập con
// LỌC RA từ CÙNG mảng fixtures.received (scope_kind='managed'), và "received"
// giờ PHẢI loại trừ đúng tập con đó để quay lại đúng nghĩa cá nhân (mục 3).
// KHÔNG duplicate dữ liệu (mục 1) — vẫn 1 nguồn Task JS object duy nhất.
function demoSourceForRelation(relation){
  var fixtures=window.PHF_TASK_UI_DEMO_FIXTURES||{};
  var receivedBucket=fixtures.received||[];
  if(relation==='managed'){
    // Draft KHÔNG nằm trong managed workspace (mục 6: chưa publish/giao
    // chính thức) — fixture demo hiện không có draft, giữ guard để honest.
    return receivedBucket.filter(function(row){return row.scope_kind==='managed'&&row.status!=='draft';});
  }
  if(relation==='received'){
    return receivedBucket.filter(function(row){return row.scope_kind!=='managed';});
  }
  return fixtures[relation]||[];
}
async function loadTaskList(root){
  // Pagination foundation (mục 11): server-side offset/limit qua listTasks(),
  // KHÔNG fetch hết rồi paginate client-side. Đổi tab/scope/search luôn reset
  // về trang đầu (offset=0) — chỉ "Xem thêm" mới tăng offset và NỐI tiếp danh
  // sách hiện có (append), không thay filter đang chọn.
  var list=taskUiState.list;
  list.loading=true;list.error='';list.offset=0;
  renderTaskRoot(root);
  if(isTaskDemoModeOn()){
    // PHF_TASK_UI_DEMO_V1 — KHÔNG gọi taskApi()/API thật ở đây, chỉ đọc
    // window.PHF_TASK_UI_DEMO_FIXTURES cục bộ và lọc trong JS. Không network,
    // không write, không thể vô tình gửi fixture vào API thật.
    list.tasks=demoFilterTasks(demoSourceForRelation(list.relation),list);
    list.viewScopeType=list.relation==='managed'?'employees':'self';
    list.requesterActorType='truong_bo_phan';
    list.hasMore=false;
    list.loading=false;
    if(taskUiState.view==='list')renderTaskRoot(root);
    return;
  }
  try{
    var response=await taskApi({action:'listTasks',relation:list.relation,status_filter:list.statusFilter,scope:list.scope||undefined,search:list.search||undefined,limit:TASK_LIST_PAGE_SIZE,offset:0});
    var result=taskResult(response)||{};
    list.tasks=Array.isArray(result.tasks)?result.tasks:[];
    list.viewScopeType=result.viewScopeType||'self';
    list.requesterActorType=result.requesterActorType||'nhan_vien';
    list.hasMore=result.hasMore===true;
  }catch(error){
    list.error=taskApiErrorMessage(error);
    list.tasks=[];list.hasMore=false;
  }
  list.loading=false;
  if(taskUiState.view==='list')renderTaskRoot(root);
}
async function loadMoreTaskList(root){
  if(isTaskDemoModeOn())return; // demo luôn hasMore=false, không có trang tiếp theo để tải
  var list=taskUiState.list;
  if(list.loadingMore||!list.hasMore)return;
  list.loadingMore=true;
  renderTaskRoot(root);
  try{
    var nextOffset=list.tasks.length;
    var response=await taskApi({action:'listTasks',relation:list.relation,status_filter:list.statusFilter,scope:list.scope||undefined,search:list.search||undefined,limit:TASK_LIST_PAGE_SIZE,offset:nextOffset});
    var result=taskResult(response)||{};
    var nextRows=Array.isArray(result.tasks)?result.tasks:[];
    list.tasks=list.tasks.concat(nextRows);
    list.offset=nextOffset;
    list.hasMore=result.hasMore===true;
  }catch(error){
    list.error=taskApiErrorMessage(error);
  }
  list.loadingMore=false;
  if(taskUiState.view==='list')renderTaskRoot(root);
}
/* ---------------------------------------------------------------------
   CALENDAR FOUNDATION V1 — thêm 1 VIEW khác cho CÙNG nguồn Task
   (listTasks(), CÙNG relation/scope contract với "Tôi nhận"/"Tôi giao"/
   "Nhân sự tôi quản lý") — KHÔNG có bảng/nguồn dữ liệu calendar riêng,
   KHÔNG có permission engine thứ hai. Chỉ MONTH view triển khai đầy đủ;
   Week/Day/List là nút placeholder kiến trúc (click chỉ toast, không đổi
   view — KHÔNG giả vờ hoạt động).

   BACKEND GAP ĐÃ XÁC NHẬN, KHÔNG tự sửa (ngoài phạm vi file được phép sửa
   của gate này — xem PHF_TASK_CALENDAR_V1_REPORT/BACKEND_CHANGE_REQUIRED):
   listTasks() (api/_lib/task-core.js, hàm map kết quả ~dòng 1531-1556)
   KHÔNG trả field start_at dù cột này luôn được set khi tạo Task (form tạo
   bắt buộc start_at). Vì vậy Calendar V1 CHỈ vẽ mốc DEADLINE (DUE) lên
   lịch — KHÔNG vẽ mốc START. Task không có deadline bị loại khỏi lịch,
   KHÔNG tự bịa ngày (mục 5D).

   Overdue dùng ĐÚNG 1 công thức đã sống ở Task List (taskListRowStatusLabel/
   taskListSummaryCounts): status active (published/in_progress) && deadline
   && deadline < now — để Lịch và Tôi nhận/Tôi giao KHÔNG BAO GIỜ lệch nhau
   về việc 1 Task có quá hạn hay không (mục 12).
--------------------------------------------------------------------- */
function defaultTaskCalendarState(){
  var today=new Date();
  return {
    view:'month', // chỉ 'month' triển khai đầy đủ ở gate này (mục 3)
    cursorYear:today.getFullYear(), cursorMonth:today.getMonth(), // cursorMonth 0-based
    relation:'received', statusFilter:'all', categoryFilter:'', highlightVariant:'',
    expandedDay:'', quickTaskId:'',
    loading:false, error:'', tasks:[]
  };
}
var TASK_CAL_SOON_DAYS=3;
function taskCalPad2(n){return String(n).padStart(2,'0');}
// Key ngày lịch LUÔN theo Asia/Ho_Chi_Minh (taskTimeZoneParts) — nhất quán
// với mọi hiển thị ngày giờ khác trong file này (mục "24H DATE/TIME
// CONTROL" phía trên) — KHÔNG dùng giờ trình duyệt cho field từ server.
function taskCalendarDateKey(value){
  if(!value)return '';
  var d=new Date(value); if(isNaN(d.getTime()))return '';
  var p=taskTimeZoneParts(d);
  return p.year+'-'+taskCalPad2(p.month)+'-'+taskCalPad2(p.day);
}
function taskCalendarTimeLabel(value){
  if(!value)return '';
  var d=new Date(value); if(isNaN(d.getTime()))return '';
  var p=taskTimeZoneParts(d);
  return taskCalPad2(p.hour)+':'+taskCalPad2(p.minute);
}
// Overdue — Y HỆT công thức taskListRowStatusLabel()/taskListSummaryCounts()
// (mục 12: Lịch và Task List không được lệch nhau).
function taskCalendarIsOverdue(row){
  return (row.status==='published'||row.status==='in_progress')&&!!row.deadline&&new Date(row.deadline).getTime()<Date.now();
}
function taskCalendarVariant(row,todayKey){
  if(row.status==='completed')return 'completed';
  if(row.status==='cancelled')return 'cancelled';
  if(taskCalendarIsOverdue(row))return 'overdue';
  if(row.status!=='published'&&row.status!=='in_progress')return 'other';
  var dayKey=taskCalendarDateKey(row.deadline);
  if(dayKey&&dayKey===todayKey)return 'due_today';
  if(row.deadline){
    var diffDays=(new Date(row.deadline).getTime()-Date.now())/86400000;
    if(diffDays>0&&diffDays<=TASK_CAL_SOON_DAYS)return 'due_soon';
  }
  return row.status==='published'?'not_started':'active';
}
var TASK_CAL_VARIANT_LABELS={overdue:'Quá hạn',due_today:'Hôm nay',due_soon:'Sắp tới hạn',completed:'Hoàn thành',cancelled:'Đã hủy',not_started:'Chưa bắt đầu',active:'Đang làm',other:'—'};
function taskCalendarStatusMatches(row,filter){
  if(filter==='all')return true;
  if(filter==='completed')return row.status==='completed';
  if(filter==='overdue')return taskCalendarIsOverdue(row);
  if(filter==='in_progress')return (row.status==='published'||row.status==='in_progress')&&!taskCalendarIsOverdue(row);
  return true;
}
// UI filter TRÊN tập đã authorized (đã tải từ listTasks với đúng
// relation/scope) — KHÔNG mở rộng quyền xem, chỉ ẩn/hiện trong tập đã được
// phép thấy (mục 9: "UI filter không phải security boundary").
function taskCalendarFilteredTasks(){
  var cal=taskUiState.calendar;
  return (cal.tasks||[]).filter(function(row){
    if(!taskCalendarStatusMatches(row,cal.statusFilter))return false;
    if(cal.categoryFilter&&row.category_code!==cal.categoryFilter)return false;
    return true;
  });
}
function taskCalendarSummaryCounts(rows,todayKey){
  var counts={overdue:0,today:0,soon:0,not_started:0};
  (rows||[]).forEach(function(row){
    var v=taskCalendarVariant(row,todayKey);
    if(v==='overdue')counts.overdue++;
    else if(v==='due_today')counts.today++;
    else if(v==='due_soon')counts.soon++;
    else if(v==='not_started')counts.not_started++;
  });
  return counts;
}
async function loadTaskCalendar(root){
  var cal=taskUiState.calendar;
  cal.loading=true;cal.error='';
  renderTaskRoot(root);
  try{
    // "Nhân sự tôi quản lý" ở listTasks() thật là relation='received' +
    // scope='managed' (xem resolveEffectiveTaskScope()/listTasks() mục 12
    // trong task-core.js) — KHÔNG có relation='managed' riêng ở backend.
    var relation=cal.relation==='managed'?'received':cal.relation;
    var scope=cal.relation==='managed'?'managed':undefined;
    var response=await taskApi({action:'listTasks',relation:relation,status_filter:'all',scope:scope,limit:200,offset:0});
    var result=taskResult(response)||{};
    cal.tasks=Array.isArray(result.tasks)?result.tasks:[];
  }catch(error){
    cal.error=taskApiErrorMessage(error);
    cal.tasks=[];
  }
  cal.loading=false;
  if(taskUiState.view==='calendar')renderTaskRoot(root);
}
async function openTaskCalendar(root){
  taskUiState.view='calendar';
  renderTaskRoot(root);
  if(!taskUiState.categories.length&&!taskUiState.categoriesLoading){
    taskUiState.categoriesLoading=true;
    loadTaskCategories().then(function(rows){taskUiState.categories=rows;}).catch(function(){}).then(function(){
      taskUiState.categoriesLoading=false;
      if(taskUiState.view==='calendar')renderTaskRoot(root);
    });
  }
  await loadTaskCalendar(root);
}
function taskCalendarMonthTitle(){
  var cal=taskUiState.calendar;
  return 'Tháng '+taskCalPad2(cal.cursorMonth+1)+'/'+cal.cursorYear;
}
function taskCalendarViewSwitcherHtml(){
  var views=[['month','Tháng'],['week','Tuần'],['day','Ngày'],['list','Danh sách']];
  return '<div class="phft-cal-view-switch" role="group" aria-label="Chế độ xem lịch">'+views.map(function(v){
    var implemented=v[0]==='month';
    return '<button type="button" class="'+(taskUiState.calendar.view===v[0]?'is-active':'')+(implemented?'':' is-soon')+'" data-task-cal-view="'+v[0]+'">'+v[1]+(implemented?'':' · sắp có')+'</button>';
  }).join('')+'</div>';
}
function taskCalendarSummaryHtml(rows,todayKey){
  var counts=taskCalendarSummaryCounts(rows,todayKey);
  var cal=taskUiState.calendar;
  var tiles=[['overdue','Quá hạn'],['today','Hôm nay'],['soon','Sắp tới hạn'],['not_started','Chưa bắt đầu']];
  return '<section class="phft-cal-summary">'+tiles.map(function(t){
    return '<button type="button" class="phft-cal-summary-tile is-'+t[0]+(cal.highlightVariant===t[0]?' is-selected':'')+'" data-task-cal-summary="'+t[0]+'"><strong>'+(counts[t[0]]||0)+'</strong><span>'+t[1]+'</span></button>';
  }).join('')+'</section>';
}
function taskCalendarFiltersHtml(){
  var cal=taskUiState.calendar;
  var relationOptions=[['received','Tôi nhận'],['assigned','Tôi giao']].concat(taskManagerScopeAvailable()?[['managed','Nhân sự tôi quản lý']]:[]);
  var statusOptions=[['all','Tất cả'],['in_progress','Đang làm'],['overdue','Quá hạn'],['completed','Hoàn thành']];
  return '<div class="phft-cal-filters">'+
    '<select class="phft-select" data-task-cal-relation>'+relationOptions.map(function(o){return '<option value="'+o[0]+'"'+(cal.relation===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'+
    '<select class="phft-select" data-task-cal-status>'+statusOptions.map(function(o){return '<option value="'+o[0]+'"'+(cal.statusFilter===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'+
    '<select class="phft-select" data-task-cal-category><option value="">Tất cả danh mục</option>'+(taskUiState.categories||[]).map(function(c){return '<option value="'+esc(c.code)+'"'+(cal.categoryFilter===c.code?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select>'+
  '</div>';
}
function taskCalendarChipHtml(row,todayKey){
  var cal=taskUiState.calendar;
  var variant=taskCalendarVariant(row,todayKey);
  var dimmed=cal.highlightVariant&&cal.highlightVariant!==variant?' is-dimmed':'';
  var time=taskCalendarTimeLabel(row.deadline);
  var title=String(row.title||'').trim();
  return '<button type="button" class="phft-cal-event is-'+variant+dimmed+'" data-task-cal-open="'+esc(row.task_id)+'" title="'+esc((row.task_code||'')+' · '+title)+'">'+(time?'<time>'+esc(time)+'</time>':'')+'<span>'+esc(title)+'</span></button>';
}
function taskCalendarMonthGridHtml(rows){
  var cal=taskUiState.calendar;
  var year=cal.cursorYear, month=cal.cursorMonth;
  var first=new Date(year,month,1);
  var start=new Date(first); start.setDate(1-((first.getDay()+6)%7)); // Thứ 2 đầu tuần
  var todayKey=taskCalendarDateKey(new Date());
  var byDay={};
  rows.forEach(function(row){
    var key=taskCalendarDateKey(row.deadline);
    if(!key)return; // không deadline -> không tự bịa ngày, loại khỏi lịch (mục 5D)
    (byDay[key]=byDay[key]||[]).push(row);
  });
  Object.keys(byDay).forEach(function(key){byDay[key].sort(function(a,b){return new Date(a.deadline)-new Date(b.deadline);});});
  var html='<div class="phft-cal-weekdays"><span>Thứ 2</span><span>Thứ 3</span><span>Thứ 4</span><span>Thứ 5</span><span>Thứ 6</span><span>Thứ 7</span><span>Chủ nhật</span></div><div class="phft-cal-grid">';
  for(var i=0;i<42;i++){
    var d=new Date(start); d.setDate(start.getDate()+i);
    var key=d.getFullYear()+'-'+taskCalPad2(d.getMonth()+1)+'-'+taskCalPad2(d.getDate());
    var outside=d.getMonth()!==month;
    var dayTasks=byDay[key]||[];
    var expanded=cal.expandedDay===key;
    var visible=expanded?dayTasks:dayTasks.slice(0,3);
    html+='<article class="phft-cal-day'+(outside?' is-outside':'')+(key===todayKey?' is-today':'')+'">'+
      '<header><b>'+d.getDate()+'</b>'+(key===todayKey?'<small>Hôm nay</small>':'')+'</header>'+
      '<div class="phft-cal-events">'+visible.map(function(row){return taskCalendarChipHtml(row,todayKey);}).join('')+
      (dayTasks.length>3&&!expanded?'<button type="button" class="phft-cal-more" data-task-cal-expand-day="'+key+'">+ '+(dayTasks.length-3)+' khác</button>':'')+
      (expanded&&dayTasks.length>3?'<button type="button" class="phft-cal-more" data-task-cal-collapse-day="'+key+'">Thu gọn</button>':'')+
      '</div></article>';
  }
  return html+'</div>';
}
function taskCalendarQuickPanelHtml(){
  var cal=taskUiState.calendar;
  if(!cal.quickTaskId)return '';
  var row=(cal.tasks||[]).find(function(r){return r.task_id===cal.quickTaskId;});
  if(!row)return '';
  var variant=taskCalendarVariant(row,taskCalendarDateKey(new Date()));
  return '<div class="phft-modal-backdrop" data-task-cal-quick-backdrop><section class="phft-cal-quick-panel" role="dialog" aria-modal="true" aria-label="Xem nhanh công việc"><header><div><small>'+esc(row.task_code||'')+'</small><h3>'+esc(row.title||'')+'</h3></div><button type="button" class="phft-icon-btn" data-task-cal-quick-close aria-label="Đóng">×</button></header>'+
    '<dl class="phft-cal-quick-grid">'+
      '<div><dt>Trạng thái</dt><dd><span class="phft-cal-tag is-'+variant+'">'+esc(TASK_CAL_VARIANT_LABELS[variant]||taskEnumLabel(TASK_STATUS_LABELS,row.status))+'</span></dd></div>'+
      '<div><dt>Deadline</dt><dd>'+esc(formatTaskDateTime(row.deadline))+'</dd></div>'+
      '<div><dt>Người thực hiện</dt><dd>'+esc(row.primary?row.primary.full_name:'—')+'</dd></div>'+
      '<div><dt>Người giao</dt><dd>'+esc(row.created_by?row.created_by.full_name:'—')+'</dd></div>'+
      '<div><dt>Ưu tiên</dt><dd>'+esc(taskEnumLabel(TASK_PRIORITY_LABELS,row.priority))+'</dd></div>'+
      '<div><dt>Tiến độ</dt><dd>'+esc(detailValue(row.progress_percent))+'%</dd></div>'+
    '</dl>'+
    '<footer><button type="button" class="phft-btn-secondary" data-task-cal-quick-close>Đóng</button><button type="button" class="phft-btn-primary" data-task-cal-open-detail="'+esc(row.task_id)+'">Mở phiếu</button></footer>'+
  '</section></div>';
}
function taskCalendarHtml(){
  var cal=taskUiState.calendar;
  var rows=taskCalendarFilteredTasks();
  var todayKey=taskCalendarDateKey(new Date());
  var body;
  if(cal.loading)body='<div class="phft-loading">Đang tải công việc…</div>';
  else if(cal.error)body='<div class="phft-alert is-error"><div><b>Không tải được lịch công việc.</b><small>'+esc(cal.error)+'</small></div></div>';
  else body=taskCalendarMonthGridHtml(rows);
  return '<div class="phft-page-head"><div><small>PHF TASK / LỊCH</small><h1>Lịch công việc</h1><p class="phft-page-subtitle">Một góc nhìn khác của cùng dữ liệu Task theo deadline — không phải nguồn dữ liệu riêng.</p></div></div>'+
    '<section class="phft-panel">'+
      '<div class="phft-cal-toolbar">'+
        '<div class="phft-cal-nav"><button type="button" class="phft-icon-btn" data-task-cal-prev aria-label="Tháng trước">‹</button><button type="button" class="phft-btn-secondary" data-task-cal-today>Hôm nay</button><button type="button" class="phft-icon-btn" data-task-cal-next aria-label="Tháng sau">›</button><strong class="phft-cal-title">'+esc(taskCalendarMonthTitle())+'</strong></div>'+
        taskCalendarViewSwitcherHtml()+
      '</div>'+
      taskCalendarFiltersHtml()+
      (cal.loading||cal.error?'':taskCalendarSummaryHtml(rows,todayKey))+
      '<div class="phft-cal-body">'+body+'</div>'+
    '</section>'+taskCalendarQuickPanelHtml();
}
// PHF_TASK_UI_DEMO_V1 — tìm 1 task demo theo id trong cả 4 nhóm fixture
// (không phụ thuộc relation đang xem, vì modal detail có thể mở từ bất kỳ màn nào).
function findDemoTaskById(taskId){
  var buckets=window.PHF_TASK_UI_DEMO_FIXTURES||{};
  var all=[].concat(buckets.received||[],buckets.assigned||[],buckets.proposal_sent||[],buckets.proposal_received||[]);
  return all.find(function(row){return row.task_id===taskId;})||null;
}
// PHF_TASK_UI_DEMO_V1 — "Xử lý công việc" WORKSPACE DEMO (V2, 2026-08-22).
// Chỉ render khi relation đang xem === 'received' (đúng phạm vi turn này:
// "Tôi nhận" workspace). Mọi mutation ở đây ghi thẳng vào object fixture
// đang nằm trong window.PHF_TASK_UI_DEMO_FIXTURES (findDemoTaskById trả về
// reference, không phải copy) — KHÔNG gọi taskApi()/fetch, KHÔNG ghi DB,
// KHÔNG persist qua localStorage. Refresh trang là mất toàn bộ update demo —
// chấp nhận được theo yêu cầu Business Owner (mục 14).
// V3 mục 4 — SHARED ACTIVITY STREAM: 1 mảng history duy nhất cho mọi loại
// event (system/recipient update/assigner feedback) — KHÔNG tách thành 2
// timeline riêng cho "Tôi nhận" và "Tôi giao". Presentation phân biệt bằng
// việc có/không có nội dung text kèm theo (system event thường không có
// text; recipient update/assigner feedback luôn có text) — không cần thêm
// màu mè theo kind.
function taskWorkspaceHistoryItemHtml(h){
  var when='<small>'+esc(formatTaskDateTime(h.at))+'</small>';
  var cls=h.text?' class="phft-history-note"':'';
  return '<li'+cls+'><b>'+esc(h.action)+'</b> — '+esc(h.actor)+' '+when+(h.text?'<p>'+esc(h.text)+'</p>':'')+'</li>';
}
function demoWorkspaceActorName(){return (window.PHF_TASK_UI_DEMO_ACTOR&&window.PHF_TASK_UI_DEMO_ACTOR.full_name)||'Bạn';}
// V3 mục 7-9 — SLA phản hồi 2 ngày làm việc: CHỈ presentation, KHÔNG có
// engine tính real-time đứng sau. addWorkingDays() chỉ dùng để hiển thị hạn
// phản hồi (ngày giờ) cho dễ đọc; việc "đã chốt điểm hay chưa" luôn lấy từ
// field TĨNH row.sla_state trong fixture, không tự suy ra từ Date.now().
function addWorkingDays(date,days){
  var d=new Date(date.getTime());
  var added=0;
  while(added<days){
    d.setDate(d.getDate()+1);
    var dow=d.getDay();
    if(dow!==0&&dow!==6)added++;
  }
  return d;
}
function taskSlaBadgeHtml(row){
  if(!row.completed_at)return '';
  var dueLabel=formatTaskDateTime(addWorkingDays(new Date(row.completed_at),2).toISOString());
  if(row.sla_state==='locked'){
    return '<div class="phft-sla-badge is-locked">Đã chốt điểm cho lần hoàn thành này (hạn phản hồi: '+esc(dueLabel)+')'+
      (row.rework_state==='requested'?' — có yêu cầu xử lý lại sau thời hạn (phản hồi sau thời hạn); điểm của lần hoàn thành này không tự động hồi tố.':'')+
    '</div>';
  }
  return '<div class="phft-sla-badge">Còn hạn phản hồi trong 2 ngày làm việc (hạn: '+esc(dueLabel)+')</div>';
}
// V3 mục 8 — chỉ 1 note tĩnh, KHÔNG xây period-lock engine.
function taskPeriodCutoffNoteHtml(row){
  if(!row.near_period_cutoff)return '';
  return '<div class="phft-workspace-hint is-cutoff">Task hoàn thành sát thời điểm khóa kỳ — trường hợp ngoại lệ, cần Admin xử lý thủ công.</div>';
}
function demoWorkspaceSetStatus(root,nextStatus){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  var now=new Date().toISOString(), actor=demoWorkspaceActorName();
  if(nextStatus==='completed'){
    // V3 mục 5-6 — "Hoàn thành" là 1 MỐC, không phải khóa vĩnh viễn: nếu
    // đang ở trạng thái "Cần xử lý lại" (rework_state==='requested'), bấm
    // Hoàn thành lần nữa là 1 completion event MỚI (completion_count tăng),
    // KHÔNG bị chặn bởi status cũ đã 'completed'.
    var isRework=row.rework_state==='requested';
    if(row.status==='completed'&&!isRework)return;
    row.status='completed';row.progress_status='hoan_thanh';row.progress_percent=100;
    row.completion_count=(row.completion_count||(isRework?1:0))+1;
    row.completed_at=now;
    row.rework_state=null;row.rework_reason='';
    row.sla_state='within_sla';
    var label=row.completion_count>1?('Hoàn thành lần '+row.completion_count+' (demo)'):'Hoàn thành (demo)';
    row.history=(row.history||[]).concat([{action:label,actor:actor,at:now,kind:'status'}]);
  }else if(nextStatus==='in_progress'){
    if(row.status==='in_progress')return;
    if(row.status==='completed'&&row.rework_state!=='requested')return;
    row.status='in_progress';row.progress_status='dang_lam';
    row.history=(row.history||[]).concat([{action:row.rework_state==='requested'?'Bắt đầu xử lý lại (demo)':'Bắt đầu thực hiện (demo)',actor:actor,at:now,kind:'status'}]);
  }else return;
  renderTaskRoot(root);
}
function demoWorkspaceAddNote(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  var text=(taskUiState.demoWorkspaceNote||'').trim();
  if(!text)return;
  row.history=(row.history||[]).concat([{action:'Cập nhật tiến độ (demo)',actor:demoWorkspaceActorName(),at:new Date().toISOString(),kind:'note',text:text}]);
  taskUiState.demoWorkspaceNote='';
  renderTaskRoot(root);
}
function demoWorkspaceAddEvidence(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  var url=(taskUiState.demoWorkspaceLinkUrl||'').trim();
  if(!url)return;
  var label=(taskUiState.demoWorkspaceLinkLabel||'').trim()||'Tài liệu';
  row.links=(row.links||[]).concat([{label:label,url:url}]);
  row.history=(row.history||[]).concat([{action:'Thêm tài liệu (demo)',actor:demoWorkspaceActorName(),at:new Date().toISOString(),kind:'note',text:label+' — '+url}]);
  taskUiState.demoWorkspaceLinkLabel='';taskUiState.demoWorkspaceLinkUrl='';
  renderTaskRoot(root);
}
// V3 mục 3 — "Theo dõi & phản hồi": người giao gửi phản hồi/yêu cầu bổ sung,
// append vào CÙNG shared activity stream (không tạo timeline riêng, mục 4).
function demoAssignerSendFeedback(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  var text=(taskUiState.demoAssignerFeedback||'').trim();
  if(!text)return;
  row.history=(row.history||[]).concat([{action:'Phản hồi từ người giao (demo)',actor:demoWorkspaceActorName(),at:new Date().toISOString(),kind:'assigner_feedback',text:text}]);
  taskUiState.demoAssignerFeedback='';
  renderTaskRoot(root);
}
function demoReworkToggle(root){
  taskUiState.demoReworkOpen=!taskUiState.demoReworkOpen;
  renderTaskRoot(root);
}
// V3 mục 6 — "Yêu cầu xử lý lại" (KHÔNG dùng "Đánh dấu chưa hoàn thành"):
// bắt buộc nhập lý do; giữ nguyên completed_at/history mốc hoàn thành trước
// đó, KHÔNG xóa/ghi đè — chỉ thêm presentation layer "Cần xử lý lại" (mục 9:
// Task state tách khỏi Score state — sla_state/score đã chốt của lần hoàn
// thành trước KHÔNG bị đổi bởi hành động này, kể cả khi đã locked).
function demoReworkConfirm(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  var reason=(taskUiState.demoReworkReason||'').trim();
  if(!reason)return;
  row.rework_state='requested';row.rework_reason=reason;row.rework_requested_at=new Date().toISOString();
  row.history=(row.history||[]).concat([{action:'Yêu cầu xử lý lại (demo)',actor:demoWorkspaceActorName(),at:new Date().toISOString(),kind:'assigner_feedback',text:reason}]);
  taskUiState.demoReworkReason='';taskUiState.demoReworkOpen=false;
  renderTaskRoot(root);
}
// V4 mục 5-6 — HỦY PHIẾU: chỉ CREATOR mới có action này (render trong
// taskAssignerWatchCardHtml, gate bởi relation='assigned' — self-only lock
// đảm bảo created_by luôn là actor, mục 3). Task chưa hoàn thành: hủy trực
// tiếp (bất kể quá hạn), status='cancelled', KHÔNG hard delete. Task đã
// hoàn thành: KHÔNG có nút hủy trực tiếp — chỉ "Gửi yêu cầu Admin hủy
// phiếu", status Task giữ nguyên, chỉ set cancel_request_state='pending'.
function demoCancelToggle(root){
  taskUiState.demoCancelOpen=!taskUiState.demoCancelOpen;
  renderTaskRoot(root);
}
function demoCancelConfirm(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  if(row.status==='completed'||row.status==='cancelled')return; // guard: completed đi qua demoCancelRequestConfirm, không có "hủy lại" phiếu đã hủy
  var reason=(taskUiState.demoCancelReason||'').trim();
  if(!reason)return;
  var actor=demoWorkspaceActorName(), now=new Date().toISOString();
  row.status='cancelled';row.cancel_reason=reason;row.cancelled_at=now;row.cancelled_by=actor;
  row.history=(row.history||[]).concat([{action:'Hủy phiếu (demo)',actor:actor,at:now,kind:'status',text:reason}]);
  taskUiState.demoCancelReason='';taskUiState.demoCancelOpen=false;
  renderTaskRoot(root);
}
function demoCancelRequestToggle(root){
  taskUiState.demoCancelRequestOpen=!taskUiState.demoCancelRequestOpen;
  renderTaskRoot(root);
}
function demoCancelRequestConfirm(root){
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return;
  if(row.status!=='completed')return; // guard: chỉ áp dụng cho Task đã hoàn thành
  if(row.cancel_request_state==='pending')return; // guard: không gửi trùng yêu cầu
  var reason=(taskUiState.demoCancelRequestReason||'').trim();
  if(!reason)return;
  var actor=demoWorkspaceActorName(), now=new Date().toISOString();
  row.cancel_request_state='pending';row.cancel_request_reason=reason;row.cancel_request_by=actor;row.cancel_request_at=now;
  // KHÔNG đổi row.status — mốc hoàn thành/điểm đã chốt (nếu có) giữ nguyên
  // (mục 7, 9: Task state/Score state tiếp tục độc lập với cancel request).
  row.history=(row.history||[]).concat([{action:'Đã gửi yêu cầu Admin hủy phiếu (demo)',actor:actor,at:now,kind:'assigner_feedback',text:reason}]);
  taskUiState.demoCancelRequestReason='';taskUiState.demoCancelRequestOpen=false;
  renderTaskRoot(root);
}
function resetDemoWorkspaceDraft(){
  taskUiState.demoWorkspaceNote='';taskUiState.demoWorkspaceLinkLabel='';taskUiState.demoWorkspaceLinkUrl='';
  taskUiState.demoAssignerFeedback='';taskUiState.demoReworkOpen=false;taskUiState.demoReworkReason='';
  taskUiState.demoCancelOpen=false;taskUiState.demoCancelReason='';taskUiState.demoCancelRequestOpen=false;taskUiState.demoCancelRequestReason='';
}
// V3 mục 2 — "Tôi nhận" giữ nguyên workspace V2: field gốc read-only, chỉ
// tương tác trong "Xử lý công việc". Chỉ render khi actor đang mở đúng là
// RECIPIENT thật (không phải Manager Scope — xem taskManagerViewCardHtml).
function taskWorkspaceCardHtml(row){
  // V4 mục 5A — Task đã bị người giao hủy: recipient KHÔNG còn thao tác xử
  // lý nào nữa (không tự hủy được Task do người khác giao — mục 5).
  if(row.status==='cancelled'){
    return '<section class="phft-workspace-card">' +
      '<div class="phft-workspace-head"><h3>Xử lý công việc</h3><span class="phft-demo-chip">Demo</span></div>' +
      '<div class="phft-workspace-hint is-cancelled">Phiếu đã bị hủy — lý do: '+esc(row.cancel_reason||'')+' ('+esc(formatTaskDateTime(row.cancelled_at))+'). Không còn thao tác xử lý.</div>' +
    '</section>';
  }
  var reworkRequested=row.rework_state==='requested';
  var isCompletedFinal=row.status==='completed'&&!reworkRequested;
  var isInProgress=row.status==='in_progress';
  var evidenceListHtml=(row.links||[]).length?'<ul class="phft-detail-links">'+row.links.map(function(l){return '<li><span>'+esc(l.label||'Link')+'</span><a href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+esc(l.url)+'</a></li>';}).join('')+'</ul>':'<div class="phft-inline-empty">Chưa có tài liệu/minh chứng.</div>';
  var reworkBannerHtml=reworkRequested?'<div class="phft-workspace-hint is-rework">Người giao yêu cầu xử lý lại — lý do: '+esc(row.rework_reason||'')+'</div>':'';
  var progressBtnLabel=reworkRequested?'Bắt đầu xử lý lại':'Đang thực hiện';
  var completeBtnLabel=reworkRequested?'✓ Hoàn thành xử lý lại':'✓ Hoàn thành công việc';
  return '<section class="phft-workspace-card">' +
    '<div class="phft-workspace-head"><h3>Xử lý công việc</h3><span class="phft-demo-chip" title="Khu vực demo — chỉ đổi trạng thái tạm thời trên trình duyệt, không ghi hệ thống">Demo</span></div>' +
    '<div class="phft-workspace-status">' +
      '<span class="phft-status">'+esc(taskListRowStatusLabel(row))+'</span>' +
      (isCompletedFinal?'<span class="phft-workspace-hint">Công việc đã hoàn thành.</span>':
        '<div class="phft-workspace-status-actions"><button type="button" class="phft-btn-secondary" data-task-demo-status="in_progress"'+(isInProgress?' disabled':'')+'>'+esc(progressBtnLabel)+'</button></div>') +
    '</div>' +
    taskPeriodCutoffNoteHtml(row) +
    reworkBannerHtml +
    '<div class="phft-workspace-block">' +
      '<label class="phft-workspace-label" for="phftWorkspaceNote">Cập nhật tiến độ / Ghi chú</label>' +
      '<textarea id="phftWorkspaceNote" rows="3" placeholder="Nhập cập nhật về tiến độ, kết quả hoặc vấn đề đang gặp..." data-task-demo-note-input>'+esc(taskUiState.demoWorkspaceNote||'')+'</textarea>' +
      '<div class="phft-workspace-actions"><button type="button" class="phft-btn-secondary" data-task-demo-add-note>Thêm cập nhật</button></div>' +
    '</div>' +
    '<div class="phft-workspace-block">' +
      '<span class="phft-workspace-label">Tài liệu / Minh chứng</span>' +
      evidenceListHtml +
      '<div class="phft-workspace-evidence-row">' +
        '<input type="text" placeholder="Tên tài liệu" value="'+esc(taskUiState.demoWorkspaceLinkLabel||'')+'" data-task-demo-evidence-label>' +
        '<input type="text" placeholder="Link (URL)" value="'+esc(taskUiState.demoWorkspaceLinkUrl||'')+'" data-task-demo-evidence-url>' +
        '<button type="button" class="phft-btn-secondary" data-task-demo-add-evidence>Thêm tài liệu (demo)</button>' +
      '</div>' +
    '</div>' +
    (isCompletedFinal?'':'<div class="phft-workspace-complete"><button type="button" class="phft-btn-primary" data-task-demo-status="completed">'+esc(completeBtnLabel)+'</button></div>') +
  '</section>';
}
// V3 mục 3-4 — "Tôi giao" → "Theo dõi & phản hồi": xem tiến độ/evidence của
// Primary qua CÙNG shared activity stream bên dưới modal, gửi phản hồi, và
// (nếu đã hoàn thành) yêu cầu xử lý lại. KHÔNG có nút sửa field gốc/hoàn
// thành thay Primary — người giao không phải recipient (mục 1).
// V4 mục 5-6 — khối "Hủy phiếu" trong Theo dõi & phản hồi (chỉ creator).
// 3 nhánh loại trừ nhau theo đúng business lock mục 5:
//  - status='cancelled'      -> chỉ hiện thông tin đã hủy (read-only).
//  - status='completed'      -> KHÔNG có nút hủy trực tiếp, chỉ
//    "Gửi yêu cầu Admin hủy phiếu" (hoặc trạng thái đang chờ nếu đã gửi).
//  - còn lại (chưa hoàn thành, kể cả đã quá hạn) -> "Hủy phiếu" trực tiếp.
function taskCancelSectionHtml(row){
  if(row.status==='cancelled'){
    return '<div class="phft-workspace-block"><span class="phft-workspace-label">Hủy phiếu</span>' +
      '<div class="phft-workspace-hint is-cancelled">Đã hủy — lý do: '+esc(row.cancel_reason||'')+' ('+esc(formatTaskDateTime(row.cancelled_at))+')</div>' +
    '</div>';
  }
  if(row.status==='completed'){
    if(row.cancel_request_state==='pending'){
      return '<div class="phft-workspace-block"><span class="phft-workspace-label">Hủy phiếu</span>' +
        '<div class="phft-workspace-hint">Đã gửi yêu cầu Admin hủy phiếu — đang chờ Admin xử lý.</div>' +
      '</div>';
    }
    return '<div class="phft-workspace-block">' +
      '<span class="phft-workspace-label">Hủy phiếu</span>' +
      '<p class="phft-workspace-hint">Task đã hoàn thành — không thể hủy trực tiếp. Gửi yêu cầu để Admin xem xét hủy.</p>' +
      '<button type="button" class="phft-btn-danger" data-task-demo-cancel-request-toggle>Gửi yêu cầu Admin hủy phiếu</button>' +
      (taskUiState.demoCancelRequestOpen?(
        '<div class="phft-workspace-rework-form">' +
          '<label class="phft-workspace-label" for="phftCancelRequestReason">Lý do đề nghị hủy</label>' +
          '<textarea id="phftCancelRequestReason" rows="2" placeholder="Nhập lý do đề nghị Admin hủy phiếu..." data-task-demo-cancel-request-reason>'+esc(taskUiState.demoCancelRequestReason||'')+'</textarea>' +
          '<div class="phft-workspace-actions"><button type="button" class="phft-btn-primary" data-task-demo-cancel-request-confirm>Gửi yêu cầu</button></div>' +
        '</div>'
      ):'') +
    '</div>';
  }
  return '<div class="phft-workspace-block">' +
    '<span class="phft-workspace-label">Hủy phiếu</span>' +
    '<button type="button" class="phft-btn-danger" data-task-demo-cancel-toggle>Hủy phiếu</button>' +
    (taskUiState.demoCancelOpen?(
      '<div class="phft-workspace-rework-form">' +
        '<label class="phft-workspace-label" for="phftCancelReason">Lý do hủy phiếu</label>' +
        '<textarea id="phftCancelReason" rows="2" placeholder="Nhập lý do hủy phiếu..." data-task-demo-cancel-reason>'+esc(taskUiState.demoCancelReason||'')+'</textarea>' +
        '<div class="phft-workspace-actions"><button type="button" class="phft-btn-primary" data-task-demo-cancel-confirm>Xác nhận hủy phiếu</button></div>' +
      '</div>'
    ):'') +
  '</div>';
}
function taskAssignerWatchCardHtml(row){
  var isCancelled=row.status==='cancelled';
  var isCompleted=row.status==='completed';
  var reworkRequested=row.rework_state==='requested';
  var completedAtHtml=(!isCancelled&&row.completed_at)?'<span class="phft-workspace-hint">Hoàn thành lúc: '+esc(formatTaskDateTime(row.completed_at))+(row.completion_count>1?' (lần '+row.completion_count+')':'')+'</span>':'';
  var reworkBannerHtml=(!isCancelled&&reworkRequested)?'<div class="phft-workspace-hint is-rework">Đã yêu cầu xử lý lại — lý do: '+esc(row.rework_reason||'')+'</div>':'';
  var reworkActionHtml='';
  if(!isCancelled&&isCompleted&&!reworkRequested){
    reworkActionHtml='<div class="phft-workspace-block">' +
      '<span class="phft-workspace-label">Yêu cầu xử lý lại</span>' +
      '<button type="button" class="phft-btn-secondary" data-task-demo-rework-toggle>Yêu cầu xử lý lại</button>' +
      (taskUiState.demoReworkOpen?(
        '<div class="phft-workspace-rework-form">' +
          '<label class="phft-workspace-label" for="phftReworkReason">Lý do yêu cầu xử lý lại</label>' +
          '<textarea id="phftReworkReason" rows="2" placeholder="Nhập lý do cần xử lý lại..." data-task-demo-rework-reason>'+esc(taskUiState.demoReworkReason||'')+'</textarea>' +
          '<div class="phft-workspace-actions"><button type="button" class="phft-btn-primary" data-task-demo-rework-confirm>Xác nhận yêu cầu xử lý lại</button></div>' +
        '</div>'
      ):'') +
    '</div>';
  }
  var feedbackBlockHtml=isCancelled?'':(
    '<div class="phft-workspace-block">' +
      '<label class="phft-workspace-label" for="phftAssignerFeedback">Phản hồi / Yêu cầu bổ sung</label>' +
      '<textarea id="phftAssignerFeedback" rows="3" placeholder="Nhập phản hồi hoặc nội dung cần người thực hiện bổ sung..." data-task-demo-assigner-feedback-input>'+esc(taskUiState.demoAssignerFeedback||'')+'</textarea>' +
      '<div class="phft-workspace-actions"><button type="button" class="phft-btn-secondary" data-task-demo-send-feedback>Gửi phản hồi</button></div>' +
    '</div>'
  );
  return '<section class="phft-workspace-card">' +
    '<div class="phft-workspace-head"><h3>Theo dõi &amp; phản hồi</h3><span class="phft-demo-chip" title="Khu vực demo — chỉ đổi trạng thái tạm thời trên trình duyệt, không ghi hệ thống">Demo</span></div>' +
    '<div class="phft-workspace-status"><span class="phft-status">'+esc(taskListRowStatusLabel(row))+'</span>'+completedAtHtml+'</div>' +
    (isCancelled?'':(taskSlaBadgeHtml(row)+taskPeriodCutoffNoteHtml(row))) +
    reworkBannerHtml +
    feedbackBlockHtml +
    reworkActionHtml +
    taskCancelSectionHtml(row) +
  '</section>';
}
// V3 mục 13 — MANAGER DETAIL MODE: TBP xem Task của nhân sự mình quản lý
// (không phải recipient/creator) chỉ ở dạng READ-ONLY — không render bất kỳ
// action nào của recipient (hoàn thành/cập nhật) hay creator (full-edit),
// chỉ vì actor có quyền VIEW (mục 1, 14: VIEW SCOPE ≠ ACTION AUTHORITY).
function taskManagerViewCardHtml(row){
  // V5 mục 10 — nếu liên phòng ban, hiện rõ "Phòng giao → Phòng nhận" ngay
  // trong role banner (tái dùng taskListCrossDeptTagHtml, không tạo markup
  // liên phòng ban riêng cho manager view).
  var crossDeptHtml=row.is_cross_department===true?('<p class="phft-workspace-hint">'+taskListCrossDeptTagHtml(row)+'</p>'):'';
  return '<section class="phft-workspace-card is-manager-view">' +
    '<div class="phft-workspace-head"><h3>Vai trò của bạn với công việc này</h3><span class="phft-demo-chip">Demo</span></div>' +
    '<div class="phft-role-banner">Bạn đang xem với vai trò: <b>Quản lý của người thực hiện</b> — '+esc(row.primary?row.primary.full_name:'—')+(row.primary&&row.primary.department?' ('+esc(row.primary.department)+')':'')+'</div>' +
    crossDeptHtml +
    '<p class="phft-workspace-hint">Bạn có thể theo dõi tiến độ, tài liệu và lịch sử xử lý ở các mục bên dưới. Đây không phải công việc bạn trực tiếp nhận hoặc giao — nên khu vực này không có thao tác cập nhật/hoàn thành.</p>' +
  '</section>';
}
// V4 mục 6-7 — "Yêu cầu hủy phiếu đã hoàn thành": presentation DEMO ONLY, tái
// dùng section/modal pattern sẵn có, KHÔNG xây menu Admin mới/table riêng.
// Hiện với bất kỳ ai mở được Task này (permission thật của "ai được xem yêu
// cầu hủy" chưa chốt — xem OPEN BUSINESS QUESTION) — mục đích duy nhất turn
// này là để Business Owner nhìn đủ concept. KHÔNG có nút Duyệt/Từ chối (mục
// 6: "KHÔNG fake Admin duyệt thật nếu chưa có lifecycle").
function taskCancelRequestInfoHtml(row){
  if(row.cancel_request_state!=='pending')return '';
  return '<section class="phft-cancel-request-banner">' +
    '<h3>Yêu cầu hủy phiếu đã hoàn thành</h3>' +
    '<p><b>Người yêu cầu:</b> '+esc(row.cancel_request_by||'—')+'</p>' +
    '<p><b>Lý do:</b> '+esc(row.cancel_request_reason||'—')+'</p>' +
    '<p><b>Thời gian:</b> '+esc(formatTaskDateTime(row.cancel_request_at))+'</p>' +
    '<p><b>Mã phiếu:</b> '+esc(row.task_code||'—')+'</p>' +
    '<p><b>Trạng thái yêu cầu:</b> <span class="phft-cancel-pending-tag">Chờ Admin xử lý</span></p>' +
    (row.sla_state==='locked'?'<p class="phft-workspace-hint">Điểm lần hoàn thành trước đã được chốt — yêu cầu hủy không tự động rollback điểm.</p>':'') +
  '</section>';
}
function demoTaskDetailModalHtml(){
  if(!taskUiState.demoDetailTaskId)return '';
  var row=findDemoTaskById(taskUiState.demoDetailTaskId);
  if(!row)return '';
  var isProposal=row.flow_type==='de_xuat';
  var relatedHtml=(row.related||[]).length?'<ul class="phft-person-list">'+row.related.map(function(p){return '<li>'+esc(p.full_name)+' · '+esc(p.department||'')+'</li>';}).join('')+'</ul>':'<div class="phft-inline-empty">Không có người liên quan.</div>';
  var linksHtml=(row.links||[]).length?'<ul class="phft-detail-links">'+row.links.map(function(l){return '<li><span>'+esc(l.label||'Link')+'</span><a href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+esc(l.url)+'</a></li>';}).join('')+'</ul>':'<div class="phft-inline-empty">Không có link/tài liệu.</div>';
  var systemTags=''+
    (row.self_task?'<span class="phft-self-task-tag">Tự giao</span> ':'')+
    taskListCrossDeptTagHtml(row)+
    (row.repeat?' <span class="phft-repeat-tag">Lặp — kỳ '+esc(row.repeat.index)+'/'+esc(row.repeat.total)+' ('+esc(row.repeat.type==='month'?'hàng tháng':'hàng ngày')+')</span>':'');
  var historyHtml=(row.history||[]).length?'<ul class="phft-person-list">'+row.history.map(taskWorkspaceHistoryItemHtml).join('')+'</ul>':'<div class="phft-inline-empty">Chưa có lịch sử.</div>';
  // V5 mục 1-4, 10 — chọn ĐÚNG 1 trong 3 khối theo RELATION (nay đã tách
  // hẳn thành route riêng, không cần suy đoán quan hệ actor/primary nữa —
  // 'received' giờ LUÔN LÀ recipient thật (managed rows đã bị loại khỏi
  // nguồn từ demoSourceForRelation()), 'managed' LUÔN LÀ manager view):
  //  - relation='received'                                                  -> Recipient workspace (V2).
  //  - relation='managed'                                                   -> Manager Detail Mode (mục 10, dùng lại taskManagerViewCardHtml V3/V4).
  //  - relation='assigned' (self-only lock: created_by luôn là actor)       -> Assigner "Theo dõi & phản hồi".
  //  - 2 relation Đề xuất                                                   -> không mở bất kỳ workspace nào turn này (mục 16).
  var relationNow=taskUiState.list.relation;
  var workspaceHtml='';
  if(relationNow==='received')workspaceHtml=taskWorkspaceCardHtml(row);
  else if(relationNow==='managed')workspaceHtml=taskManagerViewCardHtml(row);
  else if(relationNow==='assigned')workspaceHtml=taskAssignerWatchCardHtml(row);
  // V3 mục 15-17 — PROPOSAL TERMINOLOGY SAFETY: không mượn wording Giao việc
  // ("Người nhận chính"/"Nội dung công việc"/mốc Bắt đầu-Hạn hoàn thành) cho
  // Đề xuất. Chưa có business lock về mô hình thời gian của Đề xuất (gửi/hạn
  // phản hồi) nên ẩn hẳn 2 ô ngày đó thay vì tự đặt tên/semantics mới — xem
  // OPEN BUSINESS QUESTION trong báo cáo.
  // V5 mục 10 — "Nhân viên thực hiện" thay "Người nhận chính" khi xem qua
  // Manager Detail Mode, tránh gợi ý manager là recipient (mục 4, 10).
  var primaryLabel=isProposal?'Người xử lý đề xuất':(relationNow==='managed'?'Nhân viên thực hiện':'Người nhận chính');
  var detailGridHtml='<div class="phft-detail-grid">' +
      '<div><dt>Người giao</dt><dd>'+esc(row.created_by?row.created_by.full_name:'—')+'</dd></div>' +
      '<div><dt>'+esc(primaryLabel)+'</dt><dd>'+esc(row.primary?row.primary.full_name:'—')+'</dd></div>' +
      '<div><dt>Danh mục</dt><dd>'+esc(row.category_code||'—')+'</dd></div>' +
      '<div><dt>Ưu tiên</dt><dd>'+esc(row.priority||'—')+'</dd></div>' +
      (isProposal?'':(
        '<div><dt>Bắt đầu</dt><dd>'+esc(formatTaskDateTime(row.start_at||row.deadline))+'</dd></div>' +
        '<div><dt>Hạn hoàn thành</dt><dd>'+esc(formatTaskDateTime(row.deadline))+'</dd></div>'
      )) +
    '</div>';
  return '<div class="phft-modal-backdrop" data-task-demo-detail-backdrop>' +
    '<section class="phft-permission-modal" role="dialog" aria-modal="true" aria-label="Chi tiết công việc (demo)">' +
      '<header><div><small>PHF TASK / DEMO — '+(isProposal?'CHI TIẾT ĐỀ XUẤT':'CHI TIẾT')+'</small><h2>'+esc(row.task_code)+' · '+esc(row.title)+'</h2><p>Trạng thái: '+esc(taskListRowStatusLabel(row))+'</p></div>' +
      '<button type="button" class="phft-icon-btn" data-task-demo-detail-close aria-label="Đóng">×</button></header>' +
      taskCancelRequestInfoHtml(row) +
      detailGridHtml +
      '<section><h3>Người liên quan</h3>'+relatedHtml+'</section>' +
      '<section><h3>'+(isProposal?'Nội dung đề xuất':'Nội dung công việc')+'</h3><p>'+esc(row.content||'—')+'</p>'+(row.note?'<p><b>Ghi chú:</b> '+esc(row.note)+'</p>':'')+'</section>' +
      '<section><h3>Link/tài liệu</h3>'+linksHtml+'</section>' +
      workspaceHtml +
      '<section><h3>Thông tin hệ thống</h3><p>'+(systemTags||'—')+'</p></section>' +
      '<section><h3>Lịch sử hoạt động</h3>'+historyHtml+'</section>' +
      '<footer><button type="button" class="phft-btn-secondary" data-task-demo-detail-close>Đóng</button></footer>' +
    '</section>' +
  '</div>';
}
async function openTaskList(root,relation){
  taskUiState.view='list';
  taskUiState.list=Object.assign(defaultTaskListState(),{relation:relation});
  await loadTaskList(root);
}
var taskListSearchDebounceTimer=null;
function loadTaskListDebounced(root){
  if(taskListSearchDebounceTimer)clearTimeout(taskListSearchDebounceTimer);
  taskListSearchDebounceTimer=setTimeout(function(){taskListSearchDebounceTimer=null;loadTaskList(root);},400);
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
var CHECKLIST_MAPPING_BADGE_LABELS={khop:'Khớp',chua_gan:'Chưa gán',de_xuat:'Đề xuất gán',conflict:'Conflict',can_duyet:'Cần duyệt',unavailable:'Chưa khả dụng'};
function checklistMappingCellHtml(person){
  var status=String(person.checklist_mapping_status||'unavailable');
  var label=person.checklist_mapping_status_label||CHECKLIST_MAPPING_BADGE_LABELS[status]||'Chưa khả dụng';
  var detail=person.checklist_role_label?esc(person.checklist_role_label):'';
  var proposed=person.checklist_proposed_preset?'<small>Đề xuất: '+esc(taskEnumLabel(TASK_PRESET_LABELS,person.checklist_proposed_preset))+'</small>':'';
  var note=person.checklist_mapping_note?'<small class="phft-checklist-note">'+esc(person.checklist_mapping_note)+'</small>':'';
  return '<span class="phft-checklist-badge is-'+esc(status)+'">'+esc(label)+'</span>'+(detail?'<small>'+detail+'</small>':'')+proposed+note;
}
function adminPeopleDistinctDepartments(people){
  var set={};(people||[]).forEach(function(p){var d=String(p.department||'').trim();if(d)set[d]=true;});
  return Object.keys(set).sort(function(a,b){return a.localeCompare(b,'vi');});
}
function filterAdminPeople(people,filters){
  var f=filters||{},search=String(f.search||'').trim().toLocaleLowerCase('vi');
  return (people||[]).filter(function(p){
    if(f.role&&String(p.task_actor_type||'')!==f.role)return false;
    if(f.department&&String(p.department||'')!==f.department)return false;
    if(f.employmentStatus&&String(p.employment_status||'')!==f.employmentStatus)return false;
    if(f.accountStatus&&String(p.account_status||'')!==f.accountStatus)return false;
    if(f.permissionSource){
      if(f.permissionSource==='grant'){if(!p.has_active_grant)return false;}
      else if(String(p.task_preset_source||'')!==f.permissionSource)return false;
    }
    if(f.checklistStatus&&String(p.checklist_mapping_status||'')!==f.checklistStatus)return false;
    if(search){
      var hay=[p.full_name,p.employee_code].join(' ').toLocaleLowerCase('vi');
      if(hay.indexOf(search)<0)return false;
    }
    return true;
  });
}
function adminPeopleFiltersHtml(allPeople){
  var f=taskUiState.peopleFilters||defaultPeopleFilters();
  var departments=adminPeopleDistinctDepartments(allPeople);
  function opt(value,label,current){return '<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';}
  var roleOptions='<option value="">Tất cả vai trò</option>'+
    opt('nhan_vien','Nhân viên',f.role)+opt('truong_ca','Trưởng ca',f.role)+opt('truong_bo_phan','Trưởng bộ phận',f.role)+
    opt('tro_ly_gd','Trợ lý Giám đốc',f.role)+opt('giam_doc','Giám đốc',f.role)+opt('admin','Admin',f.role);
  var deptOptions='<option value="">Tất cả phòng ban</option>'+departments.map(function(d){return opt(d,d,f.department);}).join('');
  var employmentOptions='<option value="">Tất cả</option>'+opt('active','Đang làm',f.employmentStatus)+opt('inactive','Nghỉ việc',f.employmentStatus);
  var accountOptions='<option value="">Tất cả</option>'+opt('active','Hoạt động',f.accountStatus)+opt('locked','Đã khóa',f.accountStatus)+opt('inactive','Ngừng sử dụng',f.accountStatus)+opt('missing','Chưa có tài khoản',f.accountStatus);
  var sourceOptions='<option value="">Tất cả</option>'+opt('default','Mặc định',f.permissionSource)+opt('assignment','Đã gán preset',f.permissionSource)+opt('grant','Có grant/ngoại lệ',f.permissionSource);
  var checklistOptions='<option value="">Tất cả</option>'+opt('khop','Khớp',f.checklistStatus)+opt('chua_gan','Chưa gán',f.checklistStatus)+opt('de_xuat','Đề xuất gán',f.checklistStatus)+opt('conflict','Conflict',f.checklistStatus)+opt('can_duyet','Cần duyệt',f.checklistStatus);
  return '<section class="phft-people-filters">'+
    '<label><span>Vai trò Task</span><select data-task-people-filter="role">'+roleOptions+'</select></label>'+
    '<label><span>Phòng ban</span><select data-task-people-filter="department">'+deptOptions+'</select></label>'+
    '<label><span>Trạng thái làm việc</span><select data-task-people-filter="employmentStatus">'+employmentOptions+'</select></label>'+
    '<label><span>Trạng thái tài khoản</span><select data-task-people-filter="accountStatus">'+accountOptions+'</select></label>'+
    '<label><span>Nguồn quyền</span><select data-task-people-filter="permissionSource">'+sourceOptions+'</select></label>'+
    '<label><span>Mapping Checklist</span><select data-task-people-filter="checklistStatus">'+checklistOptions+'</select></label>'+
    '<label class="phft-people-filter-search"><span>Tìm kiếm</span><input type="text" data-task-people-filter="search" value="'+esc(f.search||'')+'" placeholder="Họ tên hoặc mã nhân viên"></label>'+
    '<button type="button" class="phft-btn-secondary" data-task-people-filter-clear">Xóa bộ lọc</button>'+
  '</section>';
}
function adminPeopleTableHtml(people){
  if(!people.length)return '<div class="phft-empty">Không có nhân sự khớp bộ lọc hiện tại.</div>';
  return '<div class="phft-admin-people-tablebox"><table class="phft-admin-people-table"><thead><tr><th>Nhân sự</th><th>Phòng ban / Chức danh</th><th>Làm việc</th><th>Tài khoản</th><th>Vai trò Task</th><th>Phạm vi quyền</th><th>Mapping Checklist</th><th>Xem</th><th>Giao việc</th><th>Cập nhật</th><th>Quản trị</th><th>Thao tác</th></tr></thead><tbody>'+people.map(function(person){
    var caps=person.capabilities||{},inactive=person.employment_status==='inactive';
    var policy=person.permission_adjustment||{},grants=Array.isArray(person.active_grants)?person.active_grants:[],canOpen=policy.can_set_base_preset===true||grants.length>0;
    var presetLabel=person.task_preset_source==='unavailable'?'Chưa khả dụng':taskEnumLabel(TASK_PRESET_LABELS,person.task_preset_code||'NHAN_VIEN');
    var presetSourceLabel=taskEnumLabel(TASK_PRESET_SOURCE_LABELS,person.task_preset_source||'default');
    return '<tr'+(inactive?' class="is-inactive"':'')+'><td><b>'+esc(person.full_name||person.employee_code||'—')+'</b><small>'+esc(person.employee_code||'—')+'</small></td><td><b>'+esc(person.department||'—')+'</b><small>'+esc(person.title||person.position||'—')+(person.branch?' · '+esc(person.branch):'')+'</small></td><td><span class="phft-people-status '+(inactive?'is-inactive':'is-active')+'">'+esc(person.employment_status_label||'—')+'</span><small>'+(person.can_receive_new_tasks?'Có thể nhận Task mới':'Không nhận Task mới')+'</small></td><td><span class="phft-people-status account-'+esc(person.account_status||'missing')+'">'+esc(person.account_status_label||'—')+'</span></td><td><b>'+esc(person.task_role_label||'—')+'</b><small>'+esc(presetLabel)+' · '+esc(presetSourceLabel)+'</small></td><td><b>'+esc(person.base_scope_label||'—')+'</b><small>Hiệu lực: '+esc(person.effective_scope_label||person.base_scope_label||'—')+(person.has_active_grant?' · '+Number(person.active_grant_count||0)+' grant đang hiệu lực':' · Không có grant active')+'</small></td><td>'+checklistMappingCellHtml(person)+'</td><td>'+taskPermissionFlag(caps.view===true)+'</td><td>'+taskPermissionFlag(caps.assign===true)+'</td><td>'+taskPermissionFlag(caps.update===true)+'</td><td>'+taskPermissionFlag(caps.manage===true)+'</td><td>'+(canOpen?'<button type="button" class="phft-btn-secondary phft-permission-open" data-task-permission-open="'+esc(person.employee_code)+'">Điều chỉnh quyền</button>':'<span class="phft-readonly-badge">Chỉ đọc lịch sử</span>')+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function adminPeopleHtml(){
  var data=taskUiState.adminPeople||{},summary=data.summary||{};
  var head='<div class="phft-page-head"><div><small>PHF TASK / CÀI ĐẶT</small><h1>Nhân sự & phân quyền</h1></div><button type="button" class="phft-btn-secondary" data-task-admin-people-reload>Tải lại</button></div>';
  if(taskUiState.adminPeopleLoading)return head+'<section class="phft-form-card"><div class="phft-loading">Đang đọc People Master, tài khoản và quyền PHF Task…</div></section>';
  if(taskUiState.adminPeopleError)return head+'<div class="phft-alert is-error"><div><b>Chưa tải được Nhân sự & phân quyền.</b><small>'+esc(taskUiState.adminPeopleError)+'</small></div><button type="button" class="phft-btn-secondary" data-task-admin-people-reload>Thử lại</button></div>';
  var permissionWarning=data.permissionSchemaReady===false?'<div class="phft-alert is-error"><div><b>Schema phân quyền Task chưa sẵn sàng.</b><small>'+esc(data.permissionSchemaMessage||data.permissionSchemaError||'Cần áp dụng migration Foundation Correction đúng môi trường trước khi chỉnh quyền.')+'</small></div></div>':'';
  var checklistWarning=data.checklistReferenceReady===false?'<div class="phft-alert is-warning"><div><b>Không đọc được dữ liệu tham chiếu Checklist.</b><small>Cột Mapping Checklist hiển thị "Chưa khả dụng" cho tới khi đọc lại được — không ảnh hưởng quyền Task hiện hành.</small></div></div>':'';
  var allPeople=data.people||[];
  var filteredPeople=filterAdminPeople(allPeople,taskUiState.peopleFilters);
  return head+permissionWarning+checklistWarning+'<section class="phft-admin-summary"><article><b>'+Number(summary.total||0)+'</b><span>Tổng nhân sự</span></article><article><b>'+Number(summary.active||0)+'</b><span>Đang làm</span></article><article><b>'+Number(summary.inactive||0)+'</b><span>Nghỉ việc</span></article><article><b>'+Number(summary.with_account||0)+'</b><span>Có tài khoản</span></article><article><b>'+Number(summary.checklist_khop||0)+'</b><span>Checklist: Khớp</span></article><article><b>'+Number(summary.checklist_de_xuat||0)+'</b><span>Checklist: Đề xuất gán</span></article><article><b>'+Number(summary.checklist_can_duyet||0)+'</b><span>Checklist: Cần duyệt</span></article><article><b>'+Number(summary.checklist_conflict||0)+'</b><span>Checklist: Conflict</span></article></section><section class="phft-form-card phft-admin-people-card"><header><h2>Quyền hiệu lực hiện tại</h2><p>People Master cung cấp cơ cấu; Task preset cung cấp base role; grant là ngoại lệ chồng lên sau cùng. Mapping Checklist chỉ là tham khảo/đề xuất, không tự động ghi quyền.</p></header>'+adminPeopleFiltersHtml(allPeople)+'<p class="phft-people-filter-count" data-task-people-count>Hiển thị '+filteredPeople.length+'/'+allPeople.length+' nhân sự.</p>'+'<div data-task-people-table>'+adminPeopleTableHtml(filteredPeople)+'</div></section>'+taskPermissionEditorHtml();
}

function taskSettingsCategoryRowHtml(row,writesReady){
  var isEditing=taskUiState.editingCategoryCode===row.code;
  var disabled=taskUiState.settingsSaving||!writesReady;
  var statusBadge='<span class="phft-people-status '+(row.isActive?'is-active':'is-inactive')+'">'+(row.isActive?'Đang dùng':'Ngừng sử dụng')+'</span>';
  var usedBadge=row.isUsed===true?'<small>Đã dùng cho Task — không thể xóa</small>':(row.isUsed===false?'<small>Chưa dùng</small>':'');
  var nameCell=isEditing
    ? '<input type="text" data-task-category-rename-input value="'+esc(taskUiState.editingCategoryName)+'">'
    : '<b>'+esc(row.name)+'</b>'+usedBadge;
  var deleteBtn=row.isUsed===false?'<button type="button" class="phft-btn-danger" data-task-category-delete="'+esc(row.code)+'"'+(disabled?' disabled':'')+'>Xóa</button>':'';
  var actions=isEditing
    ? '<button type="button" class="phft-btn-secondary" data-task-category-rename-save="'+esc(row.code)+'"'+(disabled?' disabled':'')+'>Lưu</button><button type="button" class="phft-btn-secondary" data-task-category-rename-cancel>Hủy</button>'
    : '<button type="button" class="phft-btn-secondary" data-task-category-rename-start="'+esc(row.code)+'"'+(disabled?' disabled':'')+'>Đổi tên</button><button type="button" class="phft-btn-secondary" data-task-category-toggle="'+esc(row.code)+'" data-task-category-toggle-to="'+(row.isActive?'0':'1')+'"'+(disabled?' disabled':'')+'>'+(row.isActive?'Ngừng sử dụng':'Kích hoạt lại')+'</button>'+deleteBtn;
  return '<tr><td>'+nameCell+'</td><td><code>'+esc(row.code)+'</code></td><td>'+statusBadge+'</td><td class="phft-category-actions">'+actions+'</td></tr>';
}
function taskSettingsCategoriesHtml(){
  var rows=taskUiState.settingsCategories||[];
  var writesReady=!!(taskUiState.foundationStatus&&taskUiState.foundationStatus.categorySchemaReady===true);
  var schemaWarning=(!taskUiState.foundationStatusLoading&&!writesReady)?'<div class="phft-alert is-warning"><div><b>Ghi Danh mục chưa sẵn sàng trên môi trường này.</b><small>Thiếu cột audit trên task_categories — xem trước được danh sách, nhưng Thêm/Đổi tên/Xóa/Ngừng sử dụng đang tạm khóa cho tới khi migration nền tảng được áp dụng.</small></div></div>':'';
  var existingNames={};rows.forEach(function(r){existingNames[r.name.trim().toLocaleLowerCase('vi')]=true;});
  var referenceSuggestions=REFERENCE_CATEGORY_NAMES.filter(function(name){return !existingNames[name.trim().toLocaleLowerCase('vi')];});
  var body='';
  if(taskUiState.settingsLoading)body='<div class="phft-loading">Đang tải danh mục…</div>';
  else if(taskUiState.settingsError)body='<div class="phft-alert is-error"><div><b>Chưa tải được danh mục.</b><small>'+esc(taskUiState.settingsError)+'</small></div><button type="button" class="phft-btn-secondary" data-task-settings-reload>Thử lại</button></div>';
  else{
    body='<table class="phft-admin-people-table phft-category-table"><thead><tr><th>Tên danh mục</th><th>Mã</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(row){return taskSettingsCategoryRowHtml(row,writesReady);}).join(''):'<tr><td colspan="4"><div class="phft-inline-empty">Chưa có danh mục nào. Bấm "Thêm danh mục" bên dưới để tạo mới.</div></td></tr>')+
      '</tbody></table>';
  }
  var addForm='<div class="phft-form-card phft-category-add"><h3>Thêm danh mục</h3>'+
    '<div class="phft-category-add-row"><input type="text" data-task-new-category-name value="'+esc(taskUiState.newCategoryName)+'" placeholder="Tên danh mục mới"'+(writesReady?'':' disabled')+'>'+
    '<button type="button" class="phft-btn-primary" data-task-category-create'+((taskUiState.settingsSaving||!writesReady)?' disabled':'')+'>Thêm danh mục</button></div>'+
    (taskUiState.newCategoryError?'<small class="phft-field-error">'+esc(taskUiState.newCategoryError)+'</small>':'')+
    (referenceSuggestions.length?'<p class="phft-category-suggestions"><b>Danh mục tham khảo từ hệ cũ (chưa tạo):</b> '+referenceSuggestions.map(function(n){return '<button type="button" class="phft-chip is-suggestion" data-task-category-suggest="'+esc(n)+'"'+(writesReady?'':' disabled')+'>'+esc(n)+'</button>';}).join(' ')+'</p>':'')+
    '</div>';
  return schemaWarning+'<section class="phft-form-card phft-admin-people-card"><header><h2>Danh mục công việc</h2><p>Bắt buộc khi tạo phiếu. Danh mục đã dùng không xóa được — chỉ Ngừng sử dụng; phiếu lịch sử vẫn giữ tên cũ.</p></header>'+body+'</section>'+addForm;
}
function taskSettingsHtml(){
  var head='<div class="phft-page-head"><div><small>PHF TASK / CÀI ĐẶT</small><h1>Cài đặt</h1></div><button type="button" class="phft-btn-secondary" data-task-settings-reload>Tải lại</button></div>';
  return head+taskSettingsCategoriesHtml();
}
function taskFieldError(name){
  var message=taskUiState.formErrors[name];
  return message?'<small class="phft-field-error">'+esc(message)+'</small>':'';
}
function taskDateTimeFieldHtml(fieldKey,label,required){
  var parts=taskDateTimeInputValueParts(taskUiState.form[fieldKey]);
  return '<div class="phft-datetime-field" data-task-dt-field="'+esc(fieldKey)+'">'+
    '<span>'+esc(label)+(required?' *':'')+'</span>'+
    '<div class="phft-datetime-inputs">'+
      '<input type="date" data-task-dt-part="date" data-task-dt-field="'+esc(fieldKey)+'" value="'+esc(parts.date)+'" aria-label="'+esc(label)+' — ngày">'+
      '<input type="number" min="0" max="23" step="1" inputmode="numeric" placeholder="HH" data-task-dt-part="hour" data-task-dt-field="'+esc(fieldKey)+'" value="'+esc(parts.hour)+'" aria-label="'+esc(label)+' — giờ (00-23)">'+
      '<span class="phft-dt-colon">:</span>'+
      '<input type="number" min="0" max="59" step="1" inputmode="numeric" placeholder="mm" data-task-dt-part="minute" data-task-dt-field="'+esc(fieldKey)+'" value="'+esc(parts.minute)+'" aria-label="'+esc(label)+' — phút (00-59)">'+
    '</div>'+
    '<small class="phft-datetime-display" data-task-dt-display="'+esc(fieldKey)+'">'+esc(taskDateTimeDisplayVN(taskUiState.form[fieldKey]))+' (24h)</small>'+
  '</div>';
}
function taskCategoryOptionsHtml(){
  var prefix='<option value="">'+(taskUiState.categoriesLoading?'Đang tải danh mục…':(taskUiState.categoriesError?'Không tải được danh mục':'Chọn danh mục công việc'))+'</option>';
  return prefix+taskUiState.categories.map(function(row){return '<option value="'+esc(row.code)+'"'+(taskUiState.form.category_code===row.code?' selected':'')+'>'+esc(row.name)+'</option>';}).join('');
}
function taskPhaseLabel(){
  return {creating:'Đang tạo bản nháp…',related:'Đang lưu người liên quan…',links:'Đang lưu tài liệu…',publishing:'Đang giao việc…',detail:'Đang tải chi tiết từ hệ thống…'}[taskUiState.submitPhase]||'Đang xử lý…';
}
function employeeLabel(code){
  var target=employeeCode(code), row=taskUiState.employees.find(function(item){return item.code===target;});
  return row?(row.name+' · '+row.code):target;
}
/* Employee picker department filter — chuẩn hóa dùng chung cho Primary/Related
   (Tạo phiếu V1 mục 6): search Họ tên/Mã NV + filter Phòng ban ("Tất cả phòng
   ban"), sau khi chọn Phòng ban thì search chỉ tìm trong nhóm đó. */
function taskDistinctDepartments(rows){
  var set={};(rows||[]).forEach(function(row){var d=String(row&&row.department||'').trim();if(d)set[d]=true;});
  return Object.keys(set).sort(function(a,b){return a.localeCompare(b,'vi');});
}
function taskDepartmentFilterHtml(kind){
  var value=kind==='primary'?taskUiState.primaryDept:taskUiState.relatedDept;
  var depts=taskDistinctDepartments(taskUiState.employees);
  return '<select class="phft-people-dept-filter" data-task-people-dept="'+kind+'" aria-label="Lọc theo phòng ban"><option value="">Tất cả phòng ban</option>'+
    depts.map(function(d){return '<option value="'+esc(d)+'"'+(d===value?' selected':'')+'>'+esc(d)+'</option>';}).join('')+'</select>';
}
function matchedEmployees(kind){
  var query=String(kind==='primary'?taskUiState.primaryQuery:taskUiState.relatedQuery).trim().toLocaleLowerCase('vi');
  var dept=String(kind==='primary'?taskUiState.primaryDept:taskUiState.relatedDept||'').trim();
  var primary=employeeCode(taskUiState.form.primary_employee_code);
  return taskUiState.employees.filter(function(row){
    if(kind==='related'&&row.code===primary)return false;
    if(dept&&row.department!==dept)return false;
    if(!query)return true;
    return [row.code,row.name,row.department,row.title,row.branch].join(' ').toLocaleLowerCase('vi').indexOf(query)>=0;
  }).slice(0,50);
}
/* SEARCH-FIRST picker standard (Create Hardening V1 mục 1) — "Tất cả phòng
   ban" + search rỗng KHÔNG render danh sách (100+ nhân sự không phù hợp show
   hết ngay khi mở). Chỉ render khi user gõ từ khóa HOẶC chọn 1 phòng ban cụ
   thể. Áp dụng chung Primary + Related qua cùng hàm này. */
function taskPickerShouldShowResults(kind){
  var query=String(kind==='primary'?taskUiState.primaryQuery:taskUiState.relatedQuery||'').trim();
  var dept=String(kind==='primary'?taskUiState.primaryDept:taskUiState.relatedDept||'').trim();
  return !!query||!!dept;
}
function employeeResultsHtml(kind){
  if(taskUiState.employeesLoading)return '<div class="phft-picker-empty">Đang tải danh sách nhân sự…</div>';
  if(taskUiState.employeesError)return '<div class="phft-picker-empty is-error">'+esc(taskUiState.employeesError)+'</div>';
  if(!taskPickerShouldShowResults(kind))return '<div class="phft-picker-empty">Nhập tên/mã nhân viên hoặc chọn phòng ban để hiện danh sách.</div>';
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
function taskPrimaryEmployeeRow(){
  var codeVal=employeeCode(taskUiState.form.primary_employee_code);
  if(!codeVal)return null;
  return taskUiState.employees.find(function(row){return row.code===codeVal;})||null;
}
function taskPrimaryPickerHtml(){
  var selectedCode=employeeCode(taskUiState.form.primary_employee_code);
  if(selectedCode&&!taskUiState.primaryPickerOpen){
    var row=taskPrimaryEmployeeRow();
    var label=row?(row.name+' · '+row.code+(row.department?' · '+row.department:'')):employeeLabel(selectedCode);
    return '<div class="phft-primary-chip"><span class="phft-chip is-primary">'+esc(label)+'</span><button type="button" class="phft-btn-secondary" data-task-change-primary>Thay đổi</button></div>';
  }
  return '<div class="phft-picker-filterbar">'+taskDepartmentFilterHtml('primary')+'<label class="phft-picker-label"><span>Tìm người thực hiện chính</span><input data-task-search="primary" value="'+esc(taskUiState.primaryQuery)+'" placeholder="Tìm theo tên hoặc mã nhân viên" autofocus></label></div><div class="phft-picker-results" data-task-results="primary">'+employeeResultsHtml('primary')+'</div>';
}
function taskPeerManagerWarningHtml(){
  var row=taskPrimaryEmployeeRow();
  if(!row)return '';
  var iAmManagerLevel=!!TASK_MANAGER_LEVEL_ACTOR_TYPES[taskUiState.requesterActorType];
  var theyAreManagerLevel=!!TASK_MANAGER_LEVEL_ACTOR_TYPES[row.taskActorType];
  if(!iAmManagerLevel||!theyAreManagerLevel)return '';
  return '<div class="phft-alert is-warning"><div><b>Người nhận là quản lý ngang cấp.</b><small>'+esc(row.name)+' hiện cũng giữ vai trò quản lý Task. Bạn vẫn có thể giao việc bình thường — cân nhắc dùng "Đề xuất" nếu phù hợp hơn với tình huống này.</small></div></div>';
}
/* Cross-department Task V1 — ZERO-INPUT preview (mục 2/17): KHÔNG có
   checkbox/field cho user tự khai — hệ thống tự so department(actor) vs
   department(Primary hiện đang chọn). Đây CHỈ là preview lúc tạo phiếu —
   Primary có thể còn đổi trước publish (mục 14); snapshot thật + quyết định
   cuối cùng nằm ở server lúc publish (task-core.js
   applyCrossDepartmentPublishSideEffects), KHÔNG phải giá trị hiển thị ở
   đây. Nếu thiếu department 1 trong 2 bên: không hiện gì (mục 13 — không
   đoán). Microcopy về "được thông báo" CHỈ hiện khi notification schema
   1.72.0 thật sự đã apply (foundationStatus.taskNotificationSchemaReady) —
   không fake capability (mục 17). */
function taskCrossDepartmentNoticeHtml(){
  var row=taskPrimaryEmployeeRow();
  if(!row)return '';
  var me=currentUser(), myCode=employeeCode(me&&(me.employeeCode||me.employee_code));
  var myRow=myCode?taskUiState.employees.find(function(r){return r.code===myCode;}):null;
  if(!myRow||!myRow.department||!row.department||myRow.department===row.department)return '';
  var notificationReady=!!(taskUiState.foundationStatus&&taskUiState.foundationStatus.taskNotificationSchemaReady);
  var microcopy=notificationReady
    ?'Quản lý phòng nhận sẽ được xem công việc này và được thông báo khi công việc được giao. Không cần phê duyệt — công việc có hiệu lực ngay.'
    :'Quản lý phòng nhận sẽ được xem công việc này. Không cần phê duyệt — công việc có hiệu lực ngay. (Thông báo tự động cho quản lý phòng nhận chưa được kích hoạt trên môi trường này.)';
  return '<div class="phft-alert is-info"><div><b class="phft-cross-dept-tag">Liên phòng ban</b><small class="phft-cross-dept-direction">'+esc(myRow.department)+' → '+esc(row.department)+'</small><small>'+esc(microcopy)+'</small></div></div>';
}
function taskFlowSubmitLabel(){
  if(taskUiState.submitting)return 'Đang lưu…';
  return taskUiState.form.flow_type==='de_xuat'?'Gửi đề xuất':'Tạo/Giao công việc';
}
function taskRecurrenceSectionHtml(){
  var open=!!taskUiState.expandedSections.recurrence;
  var disabledForDeXuat=taskUiState.form.flow_type==='de_xuat';
  return '<section class="phft-form-card"><header class="phft-card-action"><div><h2>Công việc lặp</h2><p>'+(disabledForDeXuat?'Chưa áp dụng cho Đề xuất — chỉ dùng cho Giao việc.':'Thiết lập lịch lặp — sẽ khả dụng khi engine sinh phiếu tự động được triển khai.')+'</p></div>'+
    (disabledForDeXuat?'':'<button type="button" class="phft-btn-secondary" data-task-toggle-section="recurrence">'+(open?'Ẩn':'+ Thiết lập lịch lặp')+'</button>')+
    '</header>'+
    (open&&!disabledForDeXuat?'<div class="phft-alert is-warning"><div><b>Sắp triển khai.</b><small>Thiết kế lịch lặp (hàng ngày/tuần/tháng/năm, tạm dừng, kết thúc, sinh bù) đã sẵn sàng ở tầng logic và test — chưa mở nhập liệu thật cho tới khi có migration + scheduler chính thức. Xem báo cáo Tạo phiếu V1 để biết chi tiết migration package.</small></div></div>':'')+
  '</section>';
}
function taskFoundationBlockedNoticeHtml(){
  if(taskUiState.foundationStatusLoading)return '';
  if(taskUiState.foundationStatus&&taskUiState.foundationStatus.createTaskReady===true)return '';
  return '<div class="phft-alert is-warning"><div><b>Nền tảng tạo phiếu chưa được kích hoạt.</b><small>Danh mục/RPC tạo Task chưa sẵn sàng trên môi trường này — không thể lưu thật. Liên hệ Admin kỹ thuật để áp dụng migration nền tảng trước khi tạo phiếu.</small></div></div>';
}
function taskProposalHonestyNoticeHtml(){
  if(taskUiState.form.flow_type!=='de_xuat')return '';
  return '<div class="phft-alert is-info"><div><b>Đề xuất hiện chỉ lưu như một nhãn.</b><small>Chưa có quy trình Chấp nhận/Từ chối thật — người nhận sẽ không thấy luồng duyệt riêng cho Đề xuất ở phiên bản này.</small></div></div>';
}
function taskCreateTabsHtml(){
  var tab=taskUiState.createTab==='full'?'full':'quick';
  return '<div class="phft-tabbar" role="tablist">'+
    '<button type="button" role="tab" class="phft-tab'+(tab==='quick'?' is-active':'')+'" aria-selected="'+(tab==='quick'?'true':'false')+'" data-task-create-tab="quick">Tạo phiếu nhanh</button>'+
    '<button type="button" role="tab" class="phft-tab'+(tab==='full'?' is-active':'')+'" aria-selected="'+(tab==='full'?'true':'false')+'" data-task-create-tab="full">Tạo phiếu đầy đủ</button>'+
  '</div>'+
  '<p class="phft-mode-microcopy">'+(tab==='quick'
    ?'Giao việc thông thường cho một người.'
    :'Có tất cả thông tin của Tạo nhanh và thêm CC, lặp, Đề xuất và thiết lập nâng cao.')+'</p>';
}
function modeSwitchWarningHtml(){
  var w=taskUiState.modeSwitchWarning;if(!w)return '';
  return '<div class="phft-alert is-warning"><div><b>Tạo nhanh không hỗ trợ các thiết lập sau — nếu chuyển, các thiết lập này sẽ bị bỏ:</b><small>'+esc(w.reasons.join('; '))+'</small></div><div class="phft-alert-actions"><button type="button" class="phft-btn-danger" data-task-mode-switch-confirm>Bỏ thiết lập và chuyển Tạo nhanh</button><button type="button" class="phft-btn-secondary" data-task-mode-switch-cancel>Ở lại Tạo đầy đủ</button></div></div>';
}
function quickSuccessBannerHtml(){
  var s=taskUiState.quickSuccess;if(!s)return '';
  var codeLine=s.taskCode?' · Mã phiếu: '+esc(s.taskCode):'';
  return '<div class="phft-alert is-success"><div><b>Đã giao công việc thành công.</b><small>'+esc(s.title||'')+codeLine+'</small></div><div class="phft-alert-actions"><button type="button" class="phft-btn-secondary" data-task-view-created="'+esc(s.taskId)+'">Xem công việc vừa tạo</button><button type="button" class="phft-btn-secondary" data-task-dismiss-quick-success>Tạo công việc khác</button></div></div>';
}
function quickDeadlineActionsHtml(){
  return '<div class="phft-quick-deadline-actions">'+
    '<button type="button" class="phft-chip-btn" data-task-quick-deadline="eod">Cuối ngày hôm nay</button>'+
    '<button type="button" class="phft-chip-btn" data-task-quick-deadline="tomorrow9">Ngày mai 9h</button>'+
    '<button type="button" class="phft-chip-btn" data-task-quick-deadline="plus2h">+2 giờ</button>'+
  '</div>';
}
function createTaskQuickFormHtml(){
  var foundationReady=!!(taskUiState.foundationStatus&&taskUiState.foundationStatus.createTaskReady===true);
  var submitBlocked=!taskUiState.foundationStatusLoading&&!foundationReady;
  return quickSuccessBannerHtml()+
    '<form class="phft-form phft-form-quick" data-task-create-form novalidate>'+
      (taskUiState.submitError?'<div class="phft-alert is-error">'+esc(taskUiState.submitError)+'</div>':'')+
      '<section class="phft-form-card"><header><h2>Giao việc nhanh</h2><p>Bắt đầu = ngay lúc bấm "Giao việc". Ưu tiên = Thường.</p></header><div class="phft-form-grid">'+
        '<label class="phft-span-2"><span>Tiêu đề *</span><input data-task-field="title" value="'+esc(taskUiState.form.title)+'" placeholder="Nhập tiêu đề công việc">'+taskFieldError('title')+'</label>'+
        '<label><span>Danh mục *</span><select data-task-field="category_code"'+((taskUiState.categoriesLoading||taskUiState.categoriesError)?' disabled':'')+'>'+taskCategoryOptionsHtml()+'</select>'+taskFieldError('category_code')+'</label>'+
        '<div class="phft-span-2">'+taskDateTimeFieldHtml('deadline','Hạn hoàn thành',true)+taskFieldError('deadline')+quickDeadlineActionsHtml()+'</div>'+
        '<label class="phft-span-2"><span>Nội dung công việc</span><textarea data-task-field="content" rows="3" placeholder="Mô tả yêu cầu và kết quả mong đợi">'+esc(taskUiState.form.content)+'</textarea></label>'+
      '</div></section>'+
      '<section class="phft-form-card"><header><h2>Người thực hiện chính *</h2><p>Chỉ 01 người chịu trách nhiệm chính, chỉ chọn nhân sự đang làm.</p></header>'+
        taskPrimaryPickerHtml()+taskFieldError('primary_employee_code')+taskPeerManagerWarningHtml()+taskCrossDepartmentNoticeHtml()+
      '</section>'+
      '<section class="phft-form-card"><header><h2>Tài liệu / Link</h2><p>URL phải dùng http:// hoặc https://; nhãn là tùy chọn.</p></header>'+
        '<div class="phft-link-list">'+linkRowsHtml()+'</div>'+
        '<button type="button" class="phft-btn-secondary" data-task-add-link>+ Thêm link</button>'+
      '</section>'+
      '<p class="phft-quick-upsell">Cần CC, công việc lặp hoặc thiết lập thêm? <button type="button" class="phft-linklike" data-task-create-tab="full">Chuyển sang Tạo đầy đủ</button></p>'+
      '<footer class="phft-form-actions"><span class="phft-submit-phase" data-task-phase>'+(taskUiState.submitting?esc(taskPhaseLabel()):'')+'</span><button type="submit" class="phft-btn-primary"'+((taskUiState.submitting||submitBlocked)?' disabled title="Nền tảng tạo phiếu chưa được kích hoạt."':'')+'>'+(taskUiState.submitting?'Đang lưu…':'Giao việc')+'</button></footer>'+
    '</form>';
}
function createTaskFullFormHtml(){
  var contentOpen=!!taskUiState.expandedSections.content;
  var relatedOpen=!!taskUiState.expandedSections.related;
  var linksOpen=!!taskUiState.expandedSections.links;
  var foundationReady=!!(taskUiState.foundationStatus&&taskUiState.foundationStatus.createTaskReady===true);
  var submitBlocked=!taskUiState.foundationStatusLoading&&!foundationReady;
  return '<form class="phft-form" data-task-create-form novalidate>'+
      (taskUiState.submitError?'<div class="phft-alert is-error">'+esc(taskUiState.submitError)+'</div>':'')+
      taskProposalHonestyNoticeHtml()+
      '<section class="phft-form-card"><header><h2>Thông tin công việc</h2><p>Card gọn — thao tác nhanh. Ngày giờ theo 24h, múi giờ Việt Nam.</p></header><div class="phft-form-grid">'+
        '<label><span>Loại phiếu *</span><select data-task-field="flow_type"><option value="giao_viec"'+(taskUiState.form.flow_type==='giao_viec'?' selected':'')+'>Giao việc</option><option value="de_xuat"'+(taskUiState.form.flow_type==='de_xuat'?' selected':'')+'>Đề xuất</option></select>'+taskFieldError('flow_type')+'</label>'+
        '<label><span>Danh mục công việc *</span><select data-task-field="category_code"'+((taskUiState.categoriesLoading||taskUiState.categoriesError)?' disabled':'')+'>'+taskCategoryOptionsHtml()+'</select>'+taskFieldError('category_code')+(taskUiState.categoriesError?'<small class="phft-field-error">'+esc(taskUiState.categoriesError)+'</small>':'')+'</label>'+
        '<label class="phft-span-2"><span>Tiêu đề *</span><input data-task-field="title" value="'+esc(taskUiState.form.title)+'" placeholder="Nhập tiêu đề công việc">'+taskFieldError('title')+'</label>'+
        '<label><span>Ưu tiên</span><select data-task-field="priority"><option value="thuong"'+(taskUiState.form.priority==='thuong'?' selected':'')+'>Thường</option><option value="quan_trong"'+(taskUiState.form.priority==='quan_trong'?' selected':'')+'>Quan trọng</option><option value="khan_cap"'+(taskUiState.form.priority==='khan_cap'?' selected':'')+'>Khẩn cấp</option></select>'+taskFieldError('priority')+'</label>'+
        '<div>'+taskDateTimeFieldHtml('start_at','Bắt đầu',true)+taskFieldError('start_at')+'</div>'+
        '<div>'+taskDateTimeFieldHtml('deadline','Hạn hoàn thành',true)+taskFieldError('deadline')+'</div>'+
      '</div></section>'+
      '<section class="phft-form-card"><header><h2>'+(taskUiState.form.flow_type==='de_xuat'?'Người nhận đề xuất *':'Người thực hiện chính *')+'</h2><p>Chỉ 01 người chịu trách nhiệm chính, chỉ chọn nhân sự đang làm.</p></header><div class="phft-people-grid">'+
        '<div>'+taskPrimaryPickerHtml()+taskFieldError('primary_employee_code')+taskPeerManagerWarningHtml()+taskCrossDepartmentNoticeHtml()+'</div>'+
      '</div></section>'+
      '<section class="phft-form-card"><header class="phft-card-action"><div><h2>Nội dung</h2><p>Mô tả yêu cầu và kết quả mong đợi.</p></div>'+(contentOpen?'':'<button type="button" class="phft-btn-secondary" data-task-toggle-section="content">+ Thêm nội dung</button>')+'</header>'+
        (contentOpen?'<textarea data-task-field="content" rows="4" placeholder="Mô tả yêu cầu và kết quả mong đợi">'+esc(taskUiState.form.content)+'</textarea>':'')+
      '</section>'+
      '<section class="phft-form-card"><header class="phft-card-action"><div><h2>Người liên quan (CC)</h2><p>Được xem/theo dõi Task — không chịu trách nhiệm chính, không tính KPI/trễ hạn.</p></div>'+(relatedOpen?'':'<button type="button" class="phft-btn-secondary" data-task-toggle-section="related">+ Người liên quan</button>')+'</header>'+
        (relatedOpen?'<div class="phft-picker-filterbar">'+taskDepartmentFilterHtml('related')+'<div class="phft-picker-label"><span>Tìm người liên quan (CC)</span><input data-task-search="related" value="'+esc(taskUiState.relatedQuery)+'" placeholder="Tìm và chọn nhiều người"></div></div><div class="phft-picker-results" data-task-results="related">'+employeeResultsHtml('related')+'</div><div class="phft-chip-row">'+selectedRelatedHtml()+'</div>':'')+
      '</section>'+
      taskRecurrenceSectionHtml()+
      '<section class="phft-form-card"><header class="phft-card-action"><div><h2>Tài liệu liên kết</h2><p>URL phải dùng http:// hoặc https://; nhãn là tùy chọn.</p></div>'+(linksOpen?'<button type="button" class="phft-btn-secondary" data-task-add-link>+ Thêm link</button>':'<button type="button" class="phft-btn-secondary" data-task-toggle-section="links">+ Tài liệu</button>')+'</header>'+(linksOpen?'<div class="phft-link-list">'+linkRowsHtml()+'</div>':'')+'</section>'+
      '<footer class="phft-form-actions"><span class="phft-submit-phase" data-task-phase>'+(taskUiState.submitting?esc(taskPhaseLabel()):'')+'</span><button type="button" class="phft-btn-secondary" data-task-cancel-create'+(taskUiState.submitting?' disabled':'')+'>Hủy</button><button type="submit" class="phft-btn-primary"'+((taskUiState.submitting||submitBlocked)?' disabled title="Nền tảng tạo phiếu chưa được kích hoạt."':'')+'>'+esc(taskFlowSubmitLabel())+'</button></footer>'+
    '</form>';
}
function createTaskHtml(){
  var tab=taskUiState.createTab==='full'?'full':'quick';
  return '<div class="phft-page-head"><div><small>PHF TASK / TẠO MỚI</small><h1>Tạo công việc</h1></div><button type="button" class="phft-btn-secondary" data-task-cancel-create>Quay lại</button></div>'+
    taskFoundationBlockedNoticeHtml()+
    taskCreateTabsHtml()+
    modeSwitchWarningHtml()+
    (tab==='quick'?createTaskQuickFormHtml():createTaskFullFormHtml());
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
function taskCodeLineHtml(taskCode){
  var codeVal=String(taskCode||'').trim();
  if(!codeVal)return '<div class="phft-task-code is-pending">Mã phiếu: đang cấp… (tải lại trang chi tiết nếu vẫn trống)</div>';
  return '<div class="phft-task-code">Mã phiếu: <b>'+esc(codeVal)+'</b><button type="button" class="phft-linklike" data-task-copy-code="'+esc(codeVal)+'">Copy</button></div>';
}
/* Cross-department tag ở Task Detail — đọc SNAPSHOT thật từ server
   (task.is_cross_department/source_department/target_department, ghi lúc
   publish, bất biến sau đó — mục 4) — KHÔNG tự tính lại theo dữ liệu tổ
   chức hiện tại. Task cũ trước migration 1.72.0 hoặc Task chưa publish sẽ
   không có field này — ẩn hoàn toàn, không hiện gì (graceful, không fake). */
function taskCrossDepartmentDetailHtml(task){
  if(task.is_cross_department!==true)return '';
  var sourceDept=String(task.source_department||'').trim(), targetDept=String(task.target_department||'').trim();
  if(!sourceDept||!targetDept)return '';
  return '<div class="phft-task-code phft-cross-dept-detail"><b class="phft-cross-dept-tag">Liên phòng ban</b><span>'+esc(sourceDept)+' → '+esc(targetDept)+'</span></div>';
}
var TASK_PROGRESS_STATUS_LABELS={chua_bat_dau:'Chưa bắt đầu',dang_thuc_hien:'Đang thực hiện',hoan_thanh:'Hoàn thành'};
function clampTaskPercent(value){
  var n=Math.round(Number(value));
  if(!isFinite(n))n=0;
  if(n<0)n=0; if(n>100)n=100;
  return n;
}
// Backend RPC (task_update_progress, scripts/PHF_TASK_CORE_RPC_1.67.0.sql) lưu
// progress_percent và progress_status như 2 field độc lập, KHÔNG cross-check
// giữa chúng — an toàn để derive progress_status từ percent phía client (đỡ
// người dùng phải chọn 2 lần cho cùng 1 ý nghĩa). 100% progress_status KHÔNG
// đồng nghĩa task.status='completed' — completed CHỈ xảy ra qua completeTask().
function taskProgressStatusForPercent(percent){
  var p=clampTaskPercent(percent);
  if(p<=0)return 'chua_bat_dau';
  if(p>=100)return 'hoan_thanh';
  return 'dang_thuc_hien';
}
function taskProgressPercentForDisplay(task){
  return taskUiState.lifecycleDirty?clampTaskPercent(taskUiState.lifecyclePercent):clampTaskPercent(task.progress_percent);
}
function taskLifecycleErrorHtml(scope){
  if(!taskUiState.lifecycleError||taskUiState.lifecycleErrorScope!==scope)return '';
  var reloadBtn=taskUiState.lifecycleErrorCode==='TASK_VERSION_CONFLICT'?'<button type="button" class="phft-btn-secondary" data-task-lifecycle-reload>Tải lại</button>':'';
  return '<div class="phft-alert is-error"><div><b>Chưa thực hiện được thao tác.</b><small>'+esc(taskUiState.lifecycleError)+'</small></div>'+reloadBtn+'</div>';
}
function taskProgressControlHtml(task){
  var percent=taskProgressPercentForDisplay(task);
  var statusLabel=TASK_PROGRESS_STATUS_LABELS[taskProgressStatusForPercent(percent)];
  var saving=taskUiState.lifecycleSaving;
  var quick=[0,25,50,75,100].map(function(v){return '<button type="button" class="phft-chip-btn'+(percent===v?' is-active':'')+'" data-task-progress-quick="'+v+'"'+(saving?' disabled':'')+'>'+v+'%</button>';}).join('');
  return '<div class="phft-progress-control"><div class="phft-progress-current"><b>Tiến độ hiện tại: '+percent+'%</b><span>'+esc(statusLabel)+'</span></div>'+
    '<div class="phft-progress-input-row"><input type="range" min="0" max="100" step="5" data-task-progress-range value="'+percent+'"'+(saving?' disabled':'')+'><input type="number" min="0" max="100" data-task-progress-number value="'+percent+'"'+(saving?' disabled':'')+'><span class="phft-progress-percent-suffix">%</span></div>'+
    '<div class="phft-quick-percent-row">'+quick+'</div>'+taskLifecycleErrorHtml('progress')+
    '<div class="phft-form-actions"><button type="button" class="phft-btn-primary" data-task-progress-save'+(saving?' disabled':'')+'>'+(saving?'Đang lưu…':'Lưu tiến độ')+'</button></div></div>';
}
function taskLifecycleSectionHtml(task){
  var status=String(task.status||''), saving=taskUiState.lifecycleSaving, mode=taskUiState.lifecycleMode;
  var isActive=status==='published'||status==='in_progress';
  var progressBlock=isActive?taskProgressControlHtml(task):'';
  var actionsRow='<div class="phft-lifecycle-actions">'+
    (isActive?'<button type="button" class="phft-btn-primary" data-task-lifecycle-open="complete"'+(saving?' disabled':'')+'>Hoàn thành</button><button type="button" class="phft-btn-secondary" data-task-lifecycle-open="cancel"'+(saving?' disabled':'')+'>Hủy công việc</button>':'')+
    (status==='completed'?'<button type="button" class="phft-btn-secondary" data-task-lifecycle-open="reopen"'+(saving?' disabled':'')+'>Mở lại công việc</button>':'')+
    (!isActive&&status!=='completed'?'<div class="phft-inline-empty">Không còn thao tác vòng đời khả dụng cho trạng thái này.</div>':'')+
  '</div>';
  var formHtml='';
  if(mode==='complete'){
    formHtml='<div class="phft-lifecycle-form"><label><span>Kết quả thực hiện *</span><textarea rows="3" data-task-lifecycle-field="resultText" placeholder="Bắt buộc nhập kết quả trước khi hoàn thành">'+esc(taskUiState.lifecycleResultText)+'</textarea></label>'+taskLifecycleErrorHtml('complete')+
      '<div class="phft-form-actions"><button type="button" class="phft-btn-secondary" data-task-lifecycle-close'+(saving?' disabled':'')+'>Hủy</button><button type="button" class="phft-btn-primary" data-task-lifecycle-submit="complete"'+(saving?' disabled':'')+'>'+(saving?'Đang lưu…':'Xác nhận hoàn thành')+'</button></div></div>';
  } else if(mode==='reopen'){
    formHtml='<div class="phft-lifecycle-form"><label><span>Lý do mở lại *</span><textarea rows="3" data-task-lifecycle-field="reason" placeholder="Bắt buộc nhập lý do mở lại">'+esc(taskUiState.lifecycleReason)+'</textarea></label>'+taskLifecycleErrorHtml('reopen')+
      '<div class="phft-form-actions"><button type="button" class="phft-btn-secondary" data-task-lifecycle-close'+(saving?' disabled':'')+'>Hủy</button><button type="button" class="phft-btn-primary" data-task-lifecycle-submit="reopen"'+(saving?' disabled':'')+'>'+(saving?'Đang lưu…':'Xác nhận mở lại')+'</button></div></div>';
  } else if(mode==='cancel'){
    formHtml='<div class="phft-lifecycle-form"><label><span>Lý do hủy *</span><textarea rows="3" data-task-lifecycle-field="reason" placeholder="Bắt buộc nhập lý do hủy">'+esc(taskUiState.lifecycleReason)+'</textarea></label>'+taskLifecycleErrorHtml('cancel')+
      '<div class="phft-form-actions"><button type="button" class="phft-btn-secondary" data-task-lifecycle-close'+(saving?' disabled':'')+'>Đóng</button><button type="button" class="phft-btn-primary" data-task-lifecycle-submit="cancel"'+(saving?' disabled':'')+'>'+(saving?'Đang lưu…':'Xác nhận hủy')+'</button></div></div>';
  }
  return '<section class="phft-form-card"><header><h2>Thao tác vòng đời</h2><p>Trạng thái hiện tại: '+esc(taskEnumLabel(TASK_STATUS_LABELS,status))+'</p></header>'+progressBlock+actionsRow+formHtml+'</section>';
}
function openTaskLifecycleForm(root,mode){
  if(taskUiState.lifecycleSaving)return;
  taskUiState.lifecycleMode=mode;taskUiState.lifecycleError='';taskUiState.lifecycleErrorCode='';taskUiState.lifecycleErrorScope='';
  if(mode==='complete')taskUiState.lifecycleResultText='';
  else taskUiState.lifecycleReason='';
  renderTaskRoot(root);
}
function resetTaskLifecycleForm(){
  taskUiState.lifecycleMode='';taskUiState.lifecyclePercent=0;taskUiState.lifecycleDirty=false;
  taskUiState.lifecycleResultText='';taskUiState.lifecycleReason='';taskUiState.lifecycleError='';taskUiState.lifecycleErrorCode='';taskUiState.lifecycleErrorScope='';
}
async function submitTaskProgressInline(root,task){
  if(taskUiState.lifecycleSaving)return;
  var taskId=task.id||task.task_id||taskUiState.taskId;
  var rowVersion=task.row_version;
  if(rowVersion==null){taskUiState.lifecycleErrorScope='progress';taskUiState.lifecycleError='Chưa xác định được phiên bản dữ liệu — vui lòng tải lại chi tiết.';taskUiState.lifecycleErrorCode='';renderTaskRoot(root);return;}
  var percent=taskProgressPercentForDisplay(task);
  var progressStatus=taskProgressStatusForPercent(percent);
  taskUiState.lifecycleSaving=true;taskUiState.lifecycleError='';taskUiState.lifecycleErrorCode='';taskUiState.lifecycleErrorScope='';renderTaskRoot(root);
  try{
    await taskApi({action:'updateTaskProgress',task_id:taskId,expected_row_version:rowVersion,progress_percent:percent,progress_status:progressStatus});
    taskUiState.lifecycleDirty=false;taskUiState.lifecycleSaving=false;
    await reloadTaskDetail(root);
    taskNotice('success','Đã cập nhật tiến độ','Tiến độ công việc đã được lưu.');
  }catch(error){
    taskUiState.lifecycleSaving=false;
    taskUiState.lifecycleErrorScope='progress';
    taskUiState.lifecycleErrorCode=String(error&&error.code||'');
    taskUiState.lifecycleError=taskUiState.lifecycleErrorCode==='TASK_VERSION_CONFLICT'?'Công việc đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.':taskApiErrorMessage(error);
    renderTaskRoot(root);
  }
}
async function submitTaskLifecycleAction(root,mode){
  if(taskUiState.lifecycleSaving)return;
  var task=(taskUiState.detail&&taskUiState.detail.task)||{};
  var taskId=task.id||task.task_id||taskUiState.taskId;
  var rowVersion=task.row_version;
  if(rowVersion==null){taskUiState.lifecycleErrorScope=mode;taskUiState.lifecycleError='Chưa xác định được phiên bản dữ liệu — vui lòng tải lại chi tiết.';taskUiState.lifecycleErrorCode='';renderTaskRoot(root);return;}
  var payload;
  if(mode==='complete'){
    var resultText=String(taskUiState.lifecycleResultText||'').trim();
    if(!resultText){taskUiState.lifecycleErrorScope='complete';taskUiState.lifecycleError='Bắt buộc nhập kết quả thực hiện.';taskUiState.lifecycleErrorCode='';renderTaskRoot(root);return;}
    payload={action:'completeTask',task_id:taskId,expected_row_version:rowVersion,result_text:resultText};
  } else if(mode==='reopen'){
    var reopenReason=String(taskUiState.lifecycleReason||'').trim();
    if(!reopenReason){taskUiState.lifecycleErrorScope='reopen';taskUiState.lifecycleError='Bắt buộc nhập lý do mở lại.';taskUiState.lifecycleErrorCode='';renderTaskRoot(root);return;}
    payload={action:'reopenTask',task_id:taskId,expected_row_version:rowVersion,reason:reopenReason};
  } else if(mode==='cancel'){
    var cancelReason=String(taskUiState.lifecycleReason||'').trim();
    if(!cancelReason){taskUiState.lifecycleErrorScope='cancel';taskUiState.lifecycleError='Bắt buộc nhập lý do hủy.';taskUiState.lifecycleErrorCode='';renderTaskRoot(root);return;}
    payload={action:'cancelTask',task_id:taskId,expected_row_version:rowVersion,reason:cancelReason};
  } else return;

  taskUiState.lifecycleSaving=true;taskUiState.lifecycleError='';taskUiState.lifecycleErrorCode='';taskUiState.lifecycleErrorScope='';renderTaskRoot(root);
  try{
    await taskApi(payload);
    resetTaskLifecycleForm();
    taskUiState.lifecycleSaving=false;
    await reloadTaskDetail(root);
    taskNotice('success','Đã cập nhật','Trạng thái công việc đã được cập nhật.');
  }catch(error){
    taskUiState.lifecycleSaving=false;
    taskUiState.lifecycleErrorScope=mode;
    taskUiState.lifecycleErrorCode=String(error&&error.code||'');
    taskUiState.lifecycleError=taskUiState.lifecycleErrorCode==='TASK_VERSION_CONFLICT'?'Công việc đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.':taskApiErrorMessage(error);
    renderTaskRoot(root);
  }
}
function detailContentHtml(detail,partialErrors){
  var source=detail||{}, task=source.task||{}, category=source.category||{}, primary=source.primary||task.primary_employee_code||null;
  var related=Array.isArray(source.related)?source.related:[], links=Array.isArray(source.links)?source.links:[];
  var taskCode=task.task_code||taskUiState.taskCode||'';
  var warning=(partialErrors||[]).length?'<div class="phft-alert is-warning"><div><b>Đã tạo nháp, nhưng một số người liên quan/tài liệu chưa lưu thành công.</b><small>Bản nháp bên dưới là trạng thái thật đã tải lại từ hệ thống.</small></div><button type="button" class="phft-btn-secondary" data-task-retry-supplements>Thử lưu lại</button></div>':'';
  return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>'+esc(detailValue(task.title))+'</h1></div><div class="phft-page-head-actions"><button type="button" class="phft-btn-secondary" data-task-copy>Sao chép phiếu</button><button type="button" class="phft-btn-secondary" data-task-detail-back>Về Dashboard</button></div></div>'+warning+
    '<section class="phft-detail-card"><header><div><span class="phft-status">'+esc(taskEnumLabel(TASK_STATUS_LABELS,task.status))+'</span><h2>'+esc(detailValue(task.title))+'</h2>'+taskCodeLineHtml(taskCode)+taskCrossDepartmentDetailHtml(task)+'<p>'+esc(detailValue(task.content))+'</p></div><span class="phft-task-id">'+esc(detailValue(task.id||task.task_id||taskUiState.taskId))+'</span></header><dl class="phft-detail-grid">'+
      '<div><dt>Loại</dt><dd>'+esc(taskEnumLabel(TASK_FLOW_TYPE_LABELS,task.flow_type))+'</dd></div><div><dt>Danh mục</dt><dd>'+esc(detailValue(category.display_name||task.category_display_name||task.category_code))+'</dd></div><div><dt>Ưu tiên</dt><dd>'+esc(taskEnumLabel(TASK_PRIORITY_LABELS,task.priority))+'</dd></div><div><dt>Tiến độ</dt><dd>'+esc(detailValue(task.progress_percent))+'%</dd></div><div><dt>Bắt đầu</dt><dd>'+esc(formatTaskDateTime(task.start_at))+'</dd></div><div><dt>Deadline</dt><dd>'+esc(formatTaskDateTime(task.deadline))+'</dd></div><div><dt>Người chính</dt><dd>'+esc(detailPersonName(primary))+'</dd></div><div><dt>Phiên bản dòng</dt><dd>'+esc(detailValue(task.row_version))+'</dd></div></dl></section>'+
    '<div class="phft-detail-columns"><section class="phft-form-card"><header><h2>Người liên quan</h2></header>'+(related.length?'<ul class="phft-person-list">'+related.map(function(row){return '<li>'+esc(detailPersonName(row))+'</li>';}).join('')+'</ul>':'<div class="phft-inline-empty">Chưa có người liên quan.</div>')+'</section><section class="phft-form-card"><header><h2>Tài liệu</h2></header>'+detailLinksHtml(links)+'</section></div>'+
    taskLifecycleSectionHtml(task);
}
function detailLoadingHtml(taskId){return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>Đang tải công việc</h1></div></div><section class="phft-form-card"><div class="phft-loading">Đang tải trạng thái thật từ hệ thống cho '+esc(taskId||'công việc')+'…</div></section>';}
function detailErrorHtml(taskId,message){return '<div class="phft-page-head"><div><small>PHF TASK / CHI TIẾT</small><h1>Chưa tải được chi tiết</h1></div><button type="button" class="phft-btn-secondary" data-task-detail-back>Về Dashboard</button></div><div class="phft-alert is-error"><div><b>Bản nháp đã có mã '+esc(taskId||'—')+', nhưng chưa tải lại được dữ liệu.</b><small>'+esc(message||'Vui lòng thử tải lại.')+'</small></div><button type="button" class="phft-btn-secondary" data-task-reload-detail>Thử lại</button></div>';}
function taskViewHtml(){
  if(taskUiState.view==='calendar')return taskCalendarHtml();
  if(taskUiState.view==='admin-people')return adminPeopleHtml();
  if(taskUiState.view==='settings')return taskSettingsHtml();
  if(taskUiState.view==='create')return createTaskHtml();
  if(taskUiState.view==='detail'){
    if(taskUiState.detailLoading)return detailLoadingHtml(taskUiState.taskId);
    if(taskUiState.detailError)return detailErrorHtml(taskUiState.taskId,taskUiState.detailError);
    return detailContentHtml(taskUiState.detail,taskUiState.partialErrors);
  }
  if(taskUiState.view==='list')return taskListHtml();
  return dashboardHtml();
}
function renderTaskRoot(root){root.innerHTML='<div class="phf-task-root-shell">'+shellFrame(taskViewHtml())+'</div>';bindShell(root);}
function updatePickerResults(root,kind){var target=root.querySelector('[data-task-results="'+kind+'"]');if(target)target.innerHTML=employeeResultsHtml(kind);}
function updateAdminPeopleTable(root){
  var data=taskUiState.adminPeople||{},allPeople=data.people||[];
  var filtered=filterAdminPeople(allPeople,taskUiState.peopleFilters);
  var tableTarget=root.querySelector('[data-task-people-table]');
  if(tableTarget)tableTarget.innerHTML=adminPeopleTableHtml(filtered);
  var countTarget=root.querySelector('[data-task-people-count]');
  if(countTarget)countTarget.textContent='Hiển thị '+filtered.length+'/'+allPeople.length+' nhân sự.';
}
function sanitizeCreateFormAfterLoad(){
  var form=taskUiState.form;
  if(form.category_code&&!taskUiState.categories.some(function(row){return row.code===form.category_code;}))form.category_code='';
  if(form.primary_employee_code&&!taskUiState.employees.some(function(row){return row.code===form.primary_employee_code;})){form.primary_employee_code='';taskUiState.primaryPickerOpen=true;}
  form.related_employee_codes=(form.related_employee_codes||[]).filter(function(code){return taskUiState.employees.some(function(row){return row.code===code;});});
}
async function openTaskCreate(root,options){
  options=options||{};
  var prefill=options.prefillForm?cloneTaskForm(options.prefillForm):defaultTaskForm();
  taskUiState.view='create';taskUiState.createTab=options.tab==='full'?'full':'quick';taskUiState.quickSuccess=null;taskUiState.modeSwitchWarning=null;taskUiState.advancedTouched={start:false};taskUiState.createAttemptKey=null;taskUiState.form=prefill;taskUiState.formErrors={};taskUiState.submitError='';taskUiState.submitPhase='';taskUiState.submitting=false;taskUiState.primaryQuery='';taskUiState.relatedQuery='';taskUiState.primaryDept='';taskUiState.relatedDept='';taskUiState.categories=[];taskUiState.categoriesError='';taskUiState.categoriesLoading=true;taskUiState.employees=[];taskUiState.employeesError='';taskUiState.employeesLoading=true;taskUiState.requesterActorType='nhan_vien';taskUiState.primaryPickerOpen=!prefill.primary_employee_code;taskUiState.expandedSections=options.prefillForm?{content:!!prefill.content,related:!!(prefill.related_employee_codes&&prefill.related_employee_codes.length),links:!!(prefill.links&&prefill.links.length),recurrence:false}:defaultExpandedSections();taskUiState.foundationStatus=null;taskUiState.foundationStatusLoading=true;
  if(!taskUiState.form.start_at)taskUiState.form.start_at=taskDateTimeInputValue(new Date());
  renderTaskRoot(root);
  await Promise.all([
    loadTaskAssignableEmployees().then(function(result){taskUiState.employees=result.rows;taskUiState.requesterActorType=result.requesterActorType;if(!result.rows.length)taskUiState.employeesError='Không có nhân sự Đang làm trong phạm vi giao việc của bạn.';}).catch(function(error){taskUiState.employeesError='Không tải được danh sách nhân sự: '+taskApiErrorMessage(error);}).then(function(){taskUiState.employeesLoading=false;}),
    loadTaskCategories().then(function(rows){taskUiState.categories=rows;if(!rows.length)taskUiState.categoriesError='Chưa có danh mục công việc đang hoạt động.';}).catch(function(error){taskUiState.categoriesError='Không tải được danh mục công việc: '+taskApiErrorMessage(error);}).then(function(){taskUiState.categoriesLoading=false;}),
    loadTaskFoundationStatus().then(function(status){taskUiState.foundationStatus=status;}).catch(function(){taskUiState.foundationStatus={createTaskReady:false};}).then(function(){taskUiState.foundationStatusLoading=false;})
  ]);
  if(options.prefillForm)sanitizeCreateFormAfterLoad();
  if(taskUiState.view==='create')renderTaskRoot(root);
}
function startCopyTaskFromDetail(root){
  if(!taskUiState.detail)return;
  var prefill=buildCopyFormFromDetail(taskUiState.detail);
  openTaskCreate(root,{tab:'full',prefillForm:prefill}).then(function(){
    taskUiState.skipNextCreateRouteReload=true;
    navigateTask(taskCreatePath());
  });
}
async function openTaskAdminPeople(root){
  if(!isTaskAdminUi())return;
  taskUiState.view='admin-people';taskUiState.adminPeopleLoading=true;taskUiState.adminPeopleError='';taskUiState.permissionEditor=null;taskUiState.permissionError='';renderTaskRoot(root);
  try{taskUiState.adminPeople=await loadTaskAdminPeople();}
  catch(error){taskUiState.adminPeople=null;taskUiState.adminPeopleError=taskApiErrorMessage(error);}
  taskUiState.adminPeopleLoading=false;if(taskUiState.view==='admin-people')renderTaskRoot(root);
}
async function openTaskSettings(root){
  if(!isTaskAdminUi())return;
  taskUiState.view='settings';taskUiState.settingsLoading=true;taskUiState.settingsError='';taskUiState.newCategoryName='';taskUiState.newCategoryError='';taskUiState.editingCategoryCode='';taskUiState.foundationStatus=null;taskUiState.foundationStatusLoading=true;renderTaskRoot(root);
  try{taskUiState.settingsCategories=await loadAdminTaskCategories();}
  catch(error){taskUiState.settingsCategories=[];taskUiState.settingsError=taskApiErrorMessage(error);}
  try{taskUiState.foundationStatus=await loadTaskFoundationStatus();}
  catch(error){taskUiState.foundationStatus={categorySchemaReady:false};}
  taskUiState.settingsLoading=false;taskUiState.foundationStatusLoading=false;if(taskUiState.view==='settings')renderTaskRoot(root);
}
async function reloadTaskSettingsCategories(root){
  taskUiState.settingsLoading=true;taskUiState.settingsError='';renderTaskRoot(root);
  try{taskUiState.settingsCategories=await loadAdminTaskCategories();}
  catch(error){taskUiState.settingsCategories=[];taskUiState.settingsError=taskApiErrorMessage(error);}
  taskUiState.settingsLoading=false;if(taskUiState.view==='settings')renderTaskRoot(root);
}
function generateCategoryCodeFromName(name){
  var ascii=String(name||'').trim().toLocaleUpperCase('vi')
    .replace(/[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g,'A').replace(/[ÈÉẸẺẼÊỀẾỆỂỄ]/g,'E').replace(/[ÌÍỊỈĨ]/g,'I')
    .replace(/[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g,'O').replace(/[ÙÚỤỦŨƯỪỨỰỬỮ]/g,'U').replace(/[ỲÝỴỶỸ]/g,'Y').replace(/Đ/g,'D')
    .replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return ascii.slice(0,40)||('DM_'+Date.now());
}
async function createTaskCategoryFromEditor(root){
  var name=String(taskUiState.newCategoryName||'').trim();
  if(!name){taskUiState.newCategoryError='Nhập tên danh mục.';renderTaskRoot(root);return;}
  var existing=(taskUiState.settingsCategories||[]).some(function(r){return r.name.trim().toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi');});
  if(existing){taskUiState.newCategoryError='Tên danh mục đã tồn tại.';renderTaskRoot(root);return;}
  taskUiState.settingsSaving=true;taskUiState.newCategoryError='';renderTaskRoot(root);
  try{
    await taskApi({action:'createTaskCategory',category_code:generateCategoryCodeFromName(name),display_name:name});
    taskUiState.newCategoryName='';
    taskUiState.settingsCategories=await loadAdminTaskCategories();
    taskNotice('success','Đã thêm danh mục','Danh mục "'+name+'" đã được tạo.');
  }catch(error){taskUiState.newCategoryError=taskApiErrorMessage(error);}
  taskUiState.settingsSaving=false;if(taskUiState.view==='settings')renderTaskRoot(root);
}
async function renameTaskCategoryFromEditor(root,categoryCode){
  var name=String(taskUiState.editingCategoryName||'').trim();
  if(!name)return;
  taskUiState.settingsSaving=true;renderTaskRoot(root);
  try{
    await taskApi({action:'renameTaskCategory',category_code:categoryCode,display_name:name});
    taskUiState.editingCategoryCode='';
    taskUiState.settingsCategories=await loadAdminTaskCategories();
    taskNotice('success','Đã đổi tên danh mục','');
  }catch(error){taskNotice('error','Chưa đổi được tên danh mục',taskApiErrorMessage(error));}
  taskUiState.settingsSaving=false;if(taskUiState.view==='settings')renderTaskRoot(root);
}
async function deleteTaskCategoryFromEditor(root,categoryCode){
  taskUiState.settingsSaving=true;renderTaskRoot(root);
  try{
    await taskApi({action:'deleteTaskCategory',category_code:categoryCode});
    taskUiState.settingsCategories=await loadAdminTaskCategories();
    taskNotice('success','Đã xóa danh mục','');
  }catch(error){taskNotice('error','Chưa xóa được danh mục',taskApiErrorMessage(error));}
  taskUiState.settingsSaving=false;if(taskUiState.view==='settings')renderTaskRoot(root);
}
async function toggleTaskCategoryFromEditor(root,categoryCode,nextActive){
  taskUiState.settingsSaving=true;renderTaskRoot(root);
  try{
    await taskApi({action:'setTaskCategoryActive',category_code:categoryCode,is_active:nextActive});
    taskUiState.settingsCategories=await loadAdminTaskCategories();
    taskNotice('success',nextActive?'Đã kích hoạt lại danh mục':'Đã ngừng sử dụng danh mục','');
  }catch(error){taskNotice('error','Chưa cập nhật được trạng thái danh mục',taskApiErrorMessage(error));}
  taskUiState.settingsSaving=false;if(taskUiState.view==='settings')renderTaskRoot(root);
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
  if(!taskUiState.foundationStatus||taskUiState.foundationStatus.createTaskReady!==true){taskUiState.submitError='Nền tảng tạo phiếu chưa được kích hoạt.';renderTaskRoot(root);return;}
  var effectiveForm=applyModeCanonicalOverrides(taskUiState.form,taskUiState.createTab);
  var checked=validateTaskForm(effectiveForm);
  if(!checked.valid){taskUiState.formErrors=checked.errors;taskUiState.submitError='Vui lòng kiểm tra lại các trường bắt buộc.';renderTaskRoot(root);return;}
  var wasQuick=taskUiState.createTab==='quick';
  if(!taskUiState.createAttemptKey)taskUiState.createAttemptKey=generateTaskAttemptKey();
  taskUiState.formErrors={};taskUiState.submitError='';taskUiState.submitting=true;taskUiState.submitPhase='creating';taskUiState.quickSuccess=null;renderTaskRoot(root);
  try{
    var result=await runCreateTaskFlow(checked.form,taskApi,function(phase){setTaskPhase(root,phase);},taskUiState.createAttemptKey);
    taskUiState.submitting=false;taskUiState.submitPhase='';
    if(!result.published){
      // publish CHƯA xác nhận — giữ nguyên createAttemptKey để retry (nếu có)
      // trúng replay-detection ở task_create_draft, không tạo Task thứ 2.
      taskUiState.view='detail';taskUiState.taskId=result.taskId;taskUiState.taskCode=result.taskCode;taskUiState.rowVersion=result.rowVersion;taskUiState.detail=result.detail;taskUiState.detailError='';taskUiState.detailLoading=false;taskUiState.partialErrors=result.partialErrors;taskUiState.form=result.form;
      navigateTask(taskDetailPath(result.taskId));
      taskNotice('warning','Đã tạo bản nháp — CHƯA giao việc',(result.publishError||'Publish thất bại.')+' Công việc vẫn ở trạng thái nháp, chưa được xem là "Đã giao việc thành công".');
      renderTaskRoot(root);
      return;
    }
    // Từ đây Task đã publish thành công thật — create attempt đã hoàn tất,
    // clear key để lần bấm "Giao việc" tiếp theo là 1 thao tác submit MỚI.
    taskUiState.createAttemptKey=null;
    if(result.partialErrors.length){
      taskUiState.view='detail';taskUiState.taskId=result.taskId;taskUiState.taskCode=result.taskCode;taskUiState.rowVersion=result.rowVersion;taskUiState.detail=result.detail;taskUiState.detailError='';taskUiState.detailLoading=false;taskUiState.partialErrors=result.partialErrors;taskUiState.form=result.form;
      navigateTask(taskDetailPath(result.taskId));
      taskNotice('warning','Đã giao việc, nhưng chưa lưu hết bổ sung','Người liên quan/tài liệu có mục chưa lưu thành công — vào chi tiết để thử lưu lại.');
      renderTaskRoot(root);
      return;
    }
    if(wasQuick){
      taskUiState.quickSuccess={taskId:result.taskId,taskCode:result.taskCode,title:checked.form.title};
      taskUiState.form=quickTaskFormDefaults();taskUiState.primaryPickerOpen=true;taskUiState.primaryQuery='';taskUiState.primaryDept='';
      renderTaskRoot(root);
      return;
    }
    taskUiState.view='detail';taskUiState.taskId=result.taskId;taskUiState.taskCode=result.taskCode;taskUiState.rowVersion=result.rowVersion;taskUiState.detail=result.detail;taskUiState.detailError='';taskUiState.detailLoading=false;taskUiState.partialErrors=[];taskUiState.form=result.form;
    navigateTask(taskDetailPath(result.taskId));
    taskNotice('success','Đã giao công việc thành công.','');
    renderTaskRoot(root);
  }catch(error){
    if(error.code==='TASK_FORM_INVALID')taskUiState.formErrors=error.fieldErrors||{};
    if(error.createdTaskId){taskUiState.view='detail';taskUiState.taskId=error.createdTaskId;taskUiState.taskCode=error.createdTaskCode||'';taskUiState.rowVersion=error.createdRowVersion;taskUiState.detail=null;taskUiState.detailError=taskApiErrorMessage(error);taskUiState.partialErrors=error.partialErrors||[];taskNotice('warning','Đã tạo bản nháp','Không tải lại được chi tiết. Vui lòng thử lại.');navigateTask(taskDetailPath(error.createdTaskId));}
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
    // PHF_TASK_UI_DEMO_V1 — click backdrop (không phải nội dung modal) đóng demo detail.
    if(event.target.matches('[data-task-demo-detail-backdrop]')){taskUiState.demoDetailTaskId='';resetDemoWorkspaceDraft();renderTaskRoot(root);return;}
    if(event.target.matches('[data-task-cal-quick-backdrop]')){taskUiState.calendar.quickTaskId='';renderTaskRoot(root);return;}
    var listRow=event.target.closest('[data-task-list-row]');
    if(listRow){
      var rowTaskId=listRow.getAttribute('data-task-list-row');
      if(isTaskDemoModeOn()&&rowTaskId.indexOf('demo-')===0){taskUiState.demoDetailTaskId=rowTaskId;resetDemoWorkspaceDraft();renderTaskRoot(root);return;}
      navigateTask(taskDetailPath(rowTaskId));return;
    }
    var target=event.target.closest('button');if(!target)return;
    if(target.matches('[data-task-demo-detail-close]')){taskUiState.demoDetailTaskId='';resetDemoWorkspaceDraft();renderTaskRoot(root);return;}
    if(target.matches('[data-task-demo-status]')){demoWorkspaceSetStatus(root,target.getAttribute('data-task-demo-status'));return;}
    if(target.matches('[data-task-demo-add-note]')){demoWorkspaceAddNote(root);return;}
    if(target.matches('[data-task-demo-add-evidence]')){demoWorkspaceAddEvidence(root);return;}
    if(target.matches('[data-task-demo-send-feedback]')){demoAssignerSendFeedback(root);return;}
    if(target.matches('[data-task-demo-rework-toggle]')){demoReworkToggle(root);return;}
    if(target.matches('[data-task-demo-rework-confirm]')){demoReworkConfirm(root);return;}
    if(target.matches('[data-task-demo-cancel-toggle]')){demoCancelToggle(root);return;}
    if(target.matches('[data-task-demo-cancel-confirm]')){demoCancelConfirm(root);return;}
    if(target.matches('[data-task-demo-cancel-request-toggle]')){demoCancelRequestToggle(root);return;}
    if(target.matches('[data-task-demo-cancel-request-confirm]')){demoCancelRequestConfirm(root);return;}
    if(target.matches('[data-task-list-status]')){taskUiState.list.statusFilter=target.getAttribute('data-task-list-status');loadTaskList(root);return;}
    if(target.matches('[data-task-list-load-more]')){loadMoreTaskList(root);return;}
    if(target.matches('[data-task-back]')){goHub();return;}
    if(target.matches('[data-task-nav].is-soon')){taskToast('Mục này sẽ được triển khai ở phase tiếp theo.');return;}
    if(target.matches('[data-task-nav="people-permissions"]')){navigateTask(taskAdminPeoplePath());return;}
    if(target.matches('[data-task-nav="settings"]')){navigateTask(taskSettingsPath());return;}
    if(target.matches('[data-task-nav="dashboard"]')){navigateTask(taskHomePath());return;}
    if(target.matches('[data-task-nav="lich"]')){navigateTask(taskCalendarPath());return;}
    if(target.matches('[data-task-nav-group]')){
      var groupKey=target.getAttribute('data-task-nav-group');
      taskUiState.navGroupExpanded[groupKey]=!navGroupExpanded(groupKey,taskUiState.view==='list'?(TASK_NAV_KEY_BY_RELATION[taskUiState.list.relation]||''):'');
      renderTaskRoot(root);return;
    }
    var relationForNav=TASK_RELATION_BY_NAV_KEY[target.getAttribute('data-task-nav')];
    if(relationForNav){navigateTask(taskListPath(relationForNav));return;}
    if(target.matches('[data-task-create]')){navigateTask(taskCreatePath());return;}
    if(target.matches('[data-task-cancel-create],[data-task-detail-back]')){navigateTask(taskHomePath());return;}
    if(target.matches('[data-task-create-tab]')){
      var nextTab=target.getAttribute('data-task-create-tab');
      if(nextTab==='quick'&&taskUiState.createTab==='full'){
        var reasons=fullToQuickBlockingReasons(taskUiState.form,taskUiState.advancedTouched,taskUiState.expandedSections);
        if(reasons.length){taskUiState.modeSwitchWarning={to:'quick',reasons:reasons};renderTaskRoot(root);return;}
      }
      taskUiState.createTab=nextTab;taskUiState.modeSwitchWarning=null;renderTaskRoot(root);return;
    }
    if(target.matches('[data-task-mode-switch-confirm]')){
      taskUiState.form.related_employee_codes=[];taskUiState.form.flow_type='giao_viec';taskUiState.form.priority='thuong';
      taskUiState.expandedSections.recurrence=false;taskUiState.advancedTouched.start=false;
      taskUiState.modeSwitchWarning=null;taskUiState.createTab='quick';renderTaskRoot(root);return;
    }
    if(target.matches('[data-task-mode-switch-cancel]')){taskUiState.modeSwitchWarning=null;renderTaskRoot(root);return;}
    if(target.matches('[data-task-quick-deadline]')){taskUiState.form.deadline=quickDeadlineInputValue(target.getAttribute('data-task-quick-deadline'));delete taskUiState.formErrors.deadline;renderTaskRoot(root);return;}
    if(target.matches('[data-task-view-created]')){navigateTask(taskDetailPath(target.getAttribute('data-task-view-created')));return;}
    if(target.matches('[data-task-dismiss-quick-success]')){taskUiState.quickSuccess=null;renderTaskRoot(root);return;}
    if(target.matches('[data-task-copy]')){startCopyTaskFromDetail(root);return;}
    if(target.matches('[data-task-copy-code]')){
      var codeToCopy=target.getAttribute('data-task-copy-code');
      try{
        if(window.navigator&&window.navigator.clipboard&&window.navigator.clipboard.writeText)window.navigator.clipboard.writeText(codeToCopy).then(function(){taskNotice('success','Đã copy mã phiếu',codeToCopy);}).catch(function(){});
      }catch(e){}
      return;
    }
    if(target.matches('[data-task-pick-primary]')){taskUiState.form=choosePrimary(taskUiState.form,target.getAttribute('data-task-pick-primary'));taskUiState.formErrors.primary_employee_code='';taskUiState.primaryPickerOpen=false;taskUiState.primaryQuery='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-change-primary]')){taskUiState.primaryPickerOpen=true;renderTaskRoot(root);return;}
    if(target.matches('[data-task-toggle-section]')){var sectionKey=target.getAttribute('data-task-toggle-section');taskUiState.expandedSections[sectionKey]=!taskUiState.expandedSections[sectionKey];renderTaskRoot(root);return;}
    if(target.matches('[data-task-pick-related]')){taskUiState.form=toggleRelated(taskUiState.form,target.getAttribute('data-task-pick-related'));renderTaskRoot(root);return;}
    if(target.matches('[data-task-remove-related]')){taskUiState.form=toggleRelated(taskUiState.form,target.getAttribute('data-task-remove-related'));renderTaskRoot(root);return;}
    if(target.matches('[data-task-add-link]')){taskUiState.form.links.push({side:'input_reference',url:'',label:''});renderTaskRoot(root);return;}
    if(target.matches('[data-task-remove-link]')){taskUiState.form.links.splice(Number(target.getAttribute('data-task-remove-link')),1);renderTaskRoot(root);return;}
    if(target.matches('[data-task-reload-detail]')){reloadTaskDetail(root);return;}
    if(target.matches('[data-task-retry-supplements]')){retrySupplementsFromDetail(root);return;}
    if(target.matches('[data-task-lifecycle-open]')){openTaskLifecycleForm(root,target.getAttribute('data-task-lifecycle-open'));return;}
    if(target.matches('[data-task-lifecycle-close]')){if(!taskUiState.lifecycleSaving){resetTaskLifecycleForm();renderTaskRoot(root);}return;}
    if(target.matches('[data-task-lifecycle-submit]')){submitTaskLifecycleAction(root,target.getAttribute('data-task-lifecycle-submit'));return;}
    if(target.matches('[data-task-lifecycle-reload]')){resetTaskLifecycleForm();reloadTaskDetail(root);return;}
    if(target.matches('[data-task-progress-quick]')){if(taskUiState.lifecycleSaving)return;taskUiState.lifecyclePercent=Number(target.getAttribute('data-task-progress-quick'));taskUiState.lifecycleDirty=true;taskUiState.lifecycleError='';taskUiState.lifecycleErrorScope='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-progress-save]')){submitTaskProgressInline(root,(taskUiState.detail&&taskUiState.detail.task)||{});return;}
    if(target.matches('[data-task-admin-people-reload]')){openTaskAdminPeople(root);return;}
    if(target.matches('[data-task-permission-open]')){openTaskPermissionEditor(root,target.getAttribute('data-task-permission-open'));return;}
    if(target.matches('[data-task-permission-close]')){if(!taskUiState.permissionSaving){taskUiState.permissionEditor=null;taskUiState.permissionError='';renderTaskRoot(root);}return;}
    if(target.matches('[data-task-permission-save]')){saveTaskPermissionFromEditor(root);return;}
    if(target.matches('[data-task-base-preset-save]')){saveTaskBasePresetFromEditor(root);return;}
    if(target.matches('[data-task-permission-revoke]')){revokeTaskPermissionFromEditor(root,target.getAttribute('data-task-permission-revoke'));return;}
    if(target.matches('[data-task-people-filter-clear]')){taskUiState.peopleFilters=defaultPeopleFilters();renderTaskRoot(root);return;}
    if(target.matches('[data-task-settings-reload]')){reloadTaskSettingsCategories(root);return;}
    if(target.matches('[data-task-category-create]')){createTaskCategoryFromEditor(root);return;}
    if(target.matches('[data-task-category-suggest]')){taskUiState.newCategoryName=target.getAttribute('data-task-category-suggest');taskUiState.newCategoryError='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-category-rename-start]')){var startCode=target.getAttribute('data-task-category-rename-start');var startRow=(taskUiState.settingsCategories||[]).find(function(r){return r.code===startCode;});taskUiState.editingCategoryCode=startCode;taskUiState.editingCategoryName=startRow?startRow.name:'';renderTaskRoot(root);return;}
    if(target.matches('[data-task-category-rename-cancel]')){taskUiState.editingCategoryCode='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-category-rename-save]')){renameTaskCategoryFromEditor(root,target.getAttribute('data-task-category-rename-save'));return;}
    if(target.matches('[data-task-category-toggle]')){toggleTaskCategoryFromEditor(root,target.getAttribute('data-task-category-toggle'),target.getAttribute('data-task-category-toggle-to')==='1');return;}
    if(target.matches('[data-task-category-delete]')){deleteTaskCategoryFromEditor(root,target.getAttribute('data-task-category-delete'));return;}
    if(target.matches('[data-task-cal-prev]')){var calP=taskUiState.calendar;calP.cursorMonth--;if(calP.cursorMonth<0){calP.cursorMonth=11;calP.cursorYear--;}calP.expandedDay='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-next]')){var calN=taskUiState.calendar;calN.cursorMonth++;if(calN.cursorMonth>11){calN.cursorMonth=0;calN.cursorYear++;}calN.expandedDay='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-today]')){var calT=taskUiState.calendar,today=new Date();calT.cursorYear=today.getFullYear();calT.cursorMonth=today.getMonth();calT.expandedDay='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-view]')){
      var calV=target.getAttribute('data-task-cal-view');
      if(calV!=='month'){taskToast('Chế độ xem này sẽ được triển khai ở gate sau — hiện chỉ hỗ trợ Tháng.');return;}
      taskUiState.calendar.view='month';renderTaskRoot(root);return;
    }
    if(target.matches('[data-task-cal-summary]')){
      var calS=target.getAttribute('data-task-cal-summary'),cal=taskUiState.calendar;
      cal.highlightVariant=cal.highlightVariant===calS?'':calS;renderTaskRoot(root);return;
    }
    if(target.matches('[data-task-cal-expand-day]')){taskUiState.calendar.expandedDay=target.getAttribute('data-task-cal-expand-day');renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-collapse-day]')){taskUiState.calendar.expandedDay='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-open]')){taskUiState.calendar.quickTaskId=target.getAttribute('data-task-cal-open');renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-quick-close]')){taskUiState.calendar.quickTaskId='';renderTaskRoot(root);return;}
    if(target.matches('[data-task-cal-open-detail]')){
      var calOpenId=target.getAttribute('data-task-cal-open-detail');
      taskUiState.calendar.quickTaskId='';
      navigateTask(taskDetailPath(calOpenId));return;
    }
  };
  root.oninput=function(event){
    // PHF_TASK_UI_DEMO_V1 — theo pattern chung của file: chỉ mutate state,
    // KHÔNG renderTaskRoot() trên mỗi keystroke (tránh mất vị trí con trỏ).
    if(event.target.matches('[data-task-demo-note-input]')){taskUiState.demoWorkspaceNote=event.target.value;return;}
    if(event.target.matches('[data-task-demo-evidence-label]')){taskUiState.demoWorkspaceLinkLabel=event.target.value;return;}
    if(event.target.matches('[data-task-demo-evidence-url]')){taskUiState.demoWorkspaceLinkUrl=event.target.value;return;}
    if(event.target.matches('[data-task-demo-assigner-feedback-input]')){taskUiState.demoAssignerFeedback=event.target.value;return;}
    if(event.target.matches('[data-task-demo-rework-reason]')){taskUiState.demoReworkReason=event.target.value;return;}
    if(event.target.matches('[data-task-demo-cancel-reason]')){taskUiState.demoCancelReason=event.target.value;return;}
    if(event.target.matches('[data-task-demo-cancel-request-reason]')){taskUiState.demoCancelRequestReason=event.target.value;return;}
    if(event.target.matches('[data-task-cal-relation]')){taskUiState.calendar.relation=event.target.value;taskUiState.calendar.expandedDay='';taskUiState.calendar.quickTaskId='';loadTaskCalendar(root);return;}
    if(event.target.matches('[data-task-cal-status]')){taskUiState.calendar.statusFilter=event.target.value;renderTaskRoot(root);return;}
    if(event.target.matches('[data-task-cal-category]')){taskUiState.calendar.categoryFilter=event.target.value;renderTaskRoot(root);return;}
    if(event.target.matches('[data-task-list-search]')){taskUiState.list.search=event.target.value;loadTaskListDebounced(root);return;}
    if(event.target.matches('[data-task-list-scope]')){taskUiState.list.scope=event.target.value;loadTaskList(root);return;}
    var peopleFilterField=event.target.getAttribute('data-task-people-filter');
    if(peopleFilterField){
      taskUiState.peopleFilters[peopleFilterField]=event.target.value;
      if(peopleFilterField==='search'&&event.type==='input'){updateAdminPeopleTable(root);return;}
      renderTaskRoot(root);return;
    }
    if(event.target.matches('[data-task-new-category-name]')){taskUiState.newCategoryName=event.target.value;taskUiState.newCategoryError='';return;}
    if(event.target.matches('[data-task-category-rename-input]')){taskUiState.editingCategoryName=event.target.value;return;}
    if(event.target.matches('[data-task-permission-reason]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.reason=event.target.value;taskUiState.permissionError='';return;}
    if(event.target.matches('[data-task-base-preset]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.basePresetCode=event.target.value;taskUiState.permissionError='';return;}
    if(event.target.matches('[data-task-permission-scope-type]')){if(taskUiState.permissionEditor){taskUiState.permissionEditor.scopeType=event.target.value;taskUiState.permissionEditor.employeeCodes=[];}taskUiState.permissionError='';renderTaskRoot(root);return;}
    if(event.target.matches('[data-task-permission-targets]')){if(taskUiState.permissionEditor)taskUiState.permissionEditor.employeeCodes=Array.from(event.target.selectedOptions||[]).map(function(option){return employeeCode(option.value);}).filter(Boolean);taskUiState.permissionError='';return;}
    var dtPart=event.target.getAttribute('data-task-dt-part'),dtField=event.target.getAttribute('data-task-dt-field');
    if(dtPart&&dtField){
      var dtContainer=event.target.closest('[data-task-dt-field="'+dtField+'"]');
      if(!dtContainer)return;
      var dateEl=dtContainer.querySelector('[data-task-dt-part="date"]'),hourEl=dtContainer.querySelector('[data-task-dt-part="hour"]'),minuteEl=dtContainer.querySelector('[data-task-dt-part="minute"]');
      var combined=combineTaskDateTimeParts(dateEl?dateEl.value:'',hourEl?hourEl.value:'',minuteEl?minuteEl.value:'');
      if(dtField==='start_at')taskUiState.advancedTouched.start=true;
      taskUiState.form[dtField]=combined;
      delete taskUiState.formErrors[dtField];
      var dtDisplay=dtContainer.querySelector('[data-task-dt-display="'+dtField+'"]');
      if(dtDisplay)dtDisplay.textContent=taskDateTimeDisplayVN(combined)+' (24h)';
      return;
    }
    var field=event.target.getAttribute('data-task-field');
    if(field){if(field==='start_at')taskUiState.advancedTouched.start=true;taskUiState.form[field]=event.target.value;delete taskUiState.formErrors[field];return;}
    var search=event.target.getAttribute('data-task-search');
    if(search){taskUiState[search+'Query']=event.target.value;updatePickerResults(root,search);return;}
    var deptKind=event.target.getAttribute('data-task-people-dept');
    if(deptKind){taskUiState[deptKind+'Dept']=event.target.value;updatePickerResults(root,deptKind);return;}
    var linkField=event.target.getAttribute('data-task-link-field');
    if(linkField){var index=Number(event.target.getAttribute('data-task-link-index'));if(taskUiState.form.links[index]){taskUiState.form.links[index][linkField]=event.target.value;delete taskUiState.formErrors['link_'+index];}}
    if(event.target.matches('[data-task-progress-range],[data-task-progress-number]')){
      taskUiState.lifecyclePercent=clampTaskPercent(event.target.value);taskUiState.lifecycleDirty=true;
      taskUiState.lifecycleError='';taskUiState.lifecycleErrorScope='';
      renderTaskRoot(root);return;
    }
    var lifecycleField=event.target.getAttribute('data-task-lifecycle-field');
    if(lifecycleField){
      if(lifecycleField==='resultText')taskUiState.lifecycleResultText=event.target.value;
      else if(lifecycleField==='reason')taskUiState.lifecycleReason=event.target.value;
      taskUiState.lifecycleError='';taskUiState.lifecycleErrorCode='';taskUiState.lifecycleErrorScope='';
      return;
    }
  };
  root.onchange=root.oninput;
  root.onsubmit=function(event){if(event.target.matches('[data-task-create-form]')){event.preventDefault();submitTaskCreate(root);}};
}
// PHF_TASK_UI_DEMO_V1 — ESC đóng demo detail modal. Bind DUY NHẤT 1 lần ở
// module scope (không phải trong bindShell, tránh nhân bản listener mỗi lần
// renderTaskRoot() chạy lại bindShell()).
document.addEventListener('keydown',function(event){
  if(event.key!=='Escape'||!taskUiState.demoDetailTaskId)return;
  taskUiState.demoDetailTaskId='';
  resetDemoWorkspaceDraft();
  var root=document.getElementById('phfTaskRoot');
  if(root)renderTaskRoot(root);
});

async function applyTaskRoute(root,routeKey){
  var route=parseTaskRoute(routeKey);
  if(route.view==='create'){
    if(taskUiState.skipNextCreateRouteReload){taskUiState.skipNextCreateRouteReload=false;renderTaskRoot(root);return true;}
    await openTaskCreate(root);return true;
  }
  if(route.view==='calendar'){await openTaskCalendar(root);return true;}
  if(route.view==='admin-people'){await openTaskAdminPeople(root);return true;}
  if(route.view==='settings'){await openTaskSettings(root);return true;}
  if(route.view==='detail'){
    if(!route.taskId){navigateTask(taskHomePath(),true);return false;}
    if(taskUiState.view==='detail'&&taskUiState.taskId===route.taskId&&taskUiState.detail&&!taskUiState.detailError){renderTaskRoot(root);return true;}
    taskUiState.view='detail';taskUiState.taskId=route.taskId;taskUiState.detail=null;taskUiState.detailError='';taskUiState.partialErrors=[];resetTaskLifecycleForm();
    await reloadTaskDetail(root);return true;
  }
  if(route.view==='list'){await openTaskList(root,route.relation);return true;}
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
  window.__PHF_TASK_TEST__={TASK_TIME_ZONE:TASK_TIME_ZONE,currentUserTitle:currentUserTitle,taskHomePath:taskHomePath,taskCreatePath:taskCreatePath,taskAdminPeoplePath:taskAdminPeoplePath,taskDetailPath:taskDetailPath,parseTaskRoute:parseTaskRoute,applyTaskRoute:applyTaskRoute,defaultTaskForm:defaultTaskForm,cloneTaskForm:cloneTaskForm,validateTaskForm:validateTaskForm,buildCreatePayload:buildCreatePayload,taskDateTimeInputValue:taskDateTimeInputValue,serializeTaskLocalDateTime:serializeTaskLocalDateTime,formatTaskDateTime:formatTaskDateTime,normalizeRelatedCodes:normalizeRelatedCodes,normalizeLinks:normalizeLinks,validHttpUrl:validHttpUrl,normalizeEmployee:normalizeEmployee,taskAssignableEmployeeRows:taskAssignableEmployeeRows,loadTaskAssignableEmployees:loadTaskAssignableEmployees,normalizeTaskCategory:normalizeTaskCategory,taskActiveCategoryRows:taskActiveCategoryRows,loadTaskCategories:loadTaskCategories,loadTaskAdminPeople:loadTaskAdminPeople,buildTaskPermissionAssignmentPayload:buildTaskPermissionAssignmentPayload,saveTaskBasePreset:saveTaskBasePreset,validateTaskBasePresetEditor:validateTaskBasePresetEditor,buildTaskPermissionExtendPayload:buildTaskPermissionExtendPayload,saveTaskPermissionExtend:saveTaskPermissionExtend,revokeTaskPermissionExtend:revokeTaskPermissionExtend,taskPermissionEditorHtml:taskPermissionEditorHtml,validateTaskPermissionEditor:validateTaskPermissionEditor,adminPeopleHtml:adminPeopleHtml,adminPeopleTableHtml:adminPeopleTableHtml,shellFrame:shellFrame,choosePrimary:choosePrimary,toggleRelated:toggleRelated,persistTaskSupplements:persistTaskSupplements,runCreateTaskFlow:runCreateTaskFlow,retryTaskSupplements:retryTaskSupplements,createTaskHtml:createTaskHtml,createTaskQuickFormHtml:createTaskQuickFormHtml,createTaskFullFormHtml:createTaskFullFormHtml,taskCreateTabsHtml:taskCreateTabsHtml,detailContentHtml:detailContentHtml,detailLoadingHtml:detailLoadingHtml,detailErrorHtml:detailErrorHtml,taskLifecycleSectionHtml:taskLifecycleSectionHtml,openTaskLifecycleForm:openTaskLifecycleForm,resetTaskLifecycleForm:resetTaskLifecycleForm,submitTaskLifecycleAction:submitTaskLifecycleAction,taskProgressControlHtml:taskProgressControlHtml,submitTaskProgressInline:submitTaskProgressInline,taskProgressStatusForPercent:taskProgressStatusForPercent,clampTaskPercent:clampTaskPercent,taskCalendarPath:taskCalendarPath,defaultTaskCalendarState:defaultTaskCalendarState,taskCalendarDateKey:taskCalendarDateKey,taskCalendarIsOverdue:taskCalendarIsOverdue,taskCalendarVariant:taskCalendarVariant,taskCalendarFilteredTasks:taskCalendarFilteredTasks,taskCalendarSummaryCounts:taskCalendarSummaryCounts,taskCalendarMonthGridHtml:taskCalendarMonthGridHtml,taskCalendarHtml:taskCalendarHtml,openTaskCalendar:openTaskCalendar,loadTaskCalendar:loadTaskCalendar,quickTaskFormDefaults:quickTaskFormDefaults,quickDeadlineInputValue:quickDeadlineInputValue,buildCopyFormFromDetail:buildCopyFormFromDetail,sanitizeCreateFormAfterLoad:sanitizeCreateFormAfterLoad,taskDistinctDepartments:taskDistinctDepartments,taskDepartmentFilterHtml:taskDepartmentFilterHtml,matchedEmployees:matchedEmployees,openTaskCreate:openTaskCreate,startCopyTaskFromDetail:startCopyTaskFromDetail,submitTaskCreate:submitTaskCreate,employeeCode:employeeCode,applyModeCanonicalOverrides:applyModeCanonicalOverrides,fullToQuickBlockingReasons:fullToQuickBlockingReasons,taskDateTimeInputValueParts:taskDateTimeInputValueParts,combineTaskDateTimeParts:combineTaskDateTimeParts,taskDateTimeDisplayVN:taskDateTimeDisplayVN,taskDateTimeFieldHtml:taskDateTimeFieldHtml,taskPickerShouldShowResults:taskPickerShouldShowResults,employeeResultsHtml:employeeResultsHtml,generateTaskAttemptKey:generateTaskAttemptKey,taskCodeLineHtml:taskCodeLineHtml,detailContentHtml:detailContentHtml,taskCrossDepartmentNoticeHtml:taskCrossDepartmentNoticeHtml,taskCrossDepartmentDetailHtml:taskCrossDepartmentDetailHtml,taskPeerManagerWarningHtml:taskPeerManagerWarningHtml,taskListPath:taskListPath,defaultTaskListState:defaultTaskListState,taskListHtml:taskListHtml,taskListTableHtml:taskListTableHtml,taskListRowHtml:taskListRowHtml,taskListRowStatusLabel:taskListRowStatusLabel,taskListSummaryCounts:taskListSummaryCounts,taskListManagerScopeFilterHtml:taskListManagerScopeFilterHtml,taskListCrossDeptTagHtml:taskListCrossDeptTagHtml,openTaskList:openTaskList,loadTaskList:loadTaskList,loadMoreTaskList:loadMoreTaskList,NAV_ITEMS:NAV_ITEMS,TASK_NAV_KEY_BY_RELATION:TASK_NAV_KEY_BY_RELATION,TASK_RELATION_BY_NAV_KEY:TASK_RELATION_BY_NAV_KEY,findNavParentKey:findNavParentKey,navGroupExpanded:navGroupExpanded,navItemHtml:navItemHtml,getState:function(){return taskUiState;},bindShell:bindShell,findDemoTaskById:findDemoTaskById,demoTaskDetailModalHtml:demoTaskDetailModalHtml,taskWorkspaceCardHtml:taskWorkspaceCardHtml,taskAssignerWatchCardHtml:taskAssignerWatchCardHtml,taskManagerViewCardHtml:taskManagerViewCardHtml,taskSlaBadgeHtml:taskSlaBadgeHtml,taskPeriodCutoffNoteHtml:taskPeriodCutoffNoteHtml,addWorkingDays:addWorkingDays,demoWorkspaceSetStatus:demoWorkspaceSetStatus,demoWorkspaceAddNote:demoWorkspaceAddNote,demoWorkspaceAddEvidence:demoWorkspaceAddEvidence,demoAssignerSendFeedback:demoAssignerSendFeedback,demoReworkToggle:demoReworkToggle,demoReworkConfirm:demoReworkConfirm,resetDemoWorkspaceDraft:resetDemoWorkspaceDraft,taskListHeaderFor:taskListHeaderFor,taskListManagedTagHtml:taskListManagedTagHtml,taskListCounterpartyLabel:taskListCounterpartyLabel,taskListCancelRequestTagHtml:taskListCancelRequestTagHtml,taskCancelSectionHtml:taskCancelSectionHtml,taskCancelRequestInfoHtml:taskCancelRequestInfoHtml,demoCancelToggle:demoCancelToggle,demoCancelConfirm:demoCancelConfirm,demoCancelRequestToggle:demoCancelRequestToggle,demoCancelRequestConfirm:demoCancelRequestConfirm,taskManagerScopeAvailable:taskManagerScopeAvailable,taskNavVisibleChildren:taskNavVisibleChildren,taskStatusTabLabelsForRelation:taskStatusTabLabelsForRelation,taskListKpiTilesHtml:taskListKpiTilesHtml,demoSourceForRelation:demoSourceForRelation,TASK_STATUS_TAB_LABELS_MANAGED:TASK_STATUS_TAB_LABELS_MANAGED,TASK_CROSS_DEPT_FILTER_LABELS:TASK_CROSS_DEPT_FILTER_LABELS};
}
})();
