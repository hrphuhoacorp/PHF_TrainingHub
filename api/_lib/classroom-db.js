'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', '..', 'data.json');
const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const allowLocalData = String(process.env.PHF_ALLOW_LOCAL_DATA || '').trim().toLowerCase() === 'true';
let supabase = null;
if (hasSupabaseEnv) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
}

function id(prefix) {
  return `${prefix}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`}`;
}
function now() { return new Date().toISOString(); }
function text(v) { return String(v == null ? '' : v).trim(); }
function nullable(v) { const s = text(v); return s || null; }
function numberOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v, fallback = false) { return v === undefined || v === null ? fallback : Boolean(v); }
function assertStorage() {
  if (supabase || allowLocalData) return;
  const e = new Error('Classroom chưa được cấu hình kết nối dữ liệu.'); e.code='CLASSROOM_STORAGE_NOT_CONFIGURED'; e.statusCode=503; throw e;
}
function missingTable(error) {
  return /classroom_|relation .* does not exist|schema cache|could not find the table|PGRST205/i.test(String(error?.message || error || ''));
}
function schemaError(error) {
  if (!missingTable(error)) return error;
  const raw=String(error?.message||error||'');
  const attendance=/classroom_attendance/i.test(raw);
  const e = new Error(attendance
    ? 'Database chưa có bảng điểm danh Classroom. Vui lòng chạy file scripts/phf_supabase_classroom_1_8_attendance.sql.'
    : 'Database chưa có bảng PHF Classroom. Vui lòng chạy file scripts/phf_supabase_classroom_1_0.sql.');
  e.code=attendance?'CLASSROOM_ATTENDANCE_SCHEMA_REQUIRED':'CLASSROOM_SCHEMA_REQUIRED'; e.statusCode=503; return e;
}
function classroomDbError(error, operation) {
  const source = schemaError(error);
  if (source !== error) return source;
  const message = String(error?.message || error || '');
  const details = String(error?.details || '');
  const hint = String(error?.hint || '');
  const all = `${message} ${details} ${hint}`;
  const mapped = new Error('Chưa thể lưu dữ liệu lớp đào tạo. Vui lòng kiểm tra lại thông tin và thử lại.');
  mapped.statusCode = 400;
  mapped.code = 'CLASSROOM_SAVE_INVALID';
  if (/capacity|classroom_classes_capacity_check/i.test(all)) {
    mapped.message = 'Số lượng tối đa phải để trống hoặc lớn hơn 0.';
    mapped.code = 'CLASS_CAPACITY_INVALID';
  } else if (/class_code|duplicate key|unique constraint/i.test(all)) {
    mapped.message = 'Mã lớp đã tồn tại. Vui lòng dùng mã lớp khác.';
    mapped.code = 'CLASS_CODE_EXISTS';
    mapped.statusCode = 409;
  } else if (/employee_id is not null or account_id is not null|classroom_enrollments.*check/i.test(all)) {
    mapped.message = 'Có học viên chưa liên kết đúng tài khoản Training Hub. Vui lòng chọn lại học viên.';
    mapped.code = 'CLASSROOM_LEARNER_LINK_INVALID';
  } else if (/classroom_assignments.*check|assignment_role/i.test(all)) {
    mapped.message = 'Người phụ trách chưa liên kết đúng tài khoản hoặc vai trò chưa hợp lệ. Vui lòng chọn lại.';
    mapped.code = 'CLASSROOM_ASSIGNMENT_INVALID';
  } else if (/invalid input syntax for type timestamp|date\/time field value out of range|start_at|end_at|session_date|start_time|end_time/i.test(all)) {
    mapped.message = 'Ngày hoặc giờ học chưa hợp lệ. Vui lòng kiểm tra lại lịch đào tạo.';
    mapped.code = 'CLASSROOM_SCHEDULE_INVALID';
  }
  mapped.operation = operation || '';
  return mapped;
}
function readLocal() {
  const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE,'utf8')) : {};
  data.classroomClasses = Array.isArray(data.classroomClasses) ? data.classroomClasses : [];
  data.classroomSessions = Array.isArray(data.classroomSessions) ? data.classroomSessions : [];
  data.classroomEnrollments = Array.isArray(data.classroomEnrollments) ? data.classroomEnrollments : [];
  data.classroomAssignments = Array.isArray(data.classroomAssignments) ? data.classroomAssignments : [];
  data.classroomHistory = Array.isArray(data.classroomHistory) ? data.classroomHistory : [];
  data.classroomAttendance = Array.isArray(data.classroomAttendance) ? data.classroomAttendance : [];
  return data;
}
function writeLocal(data) {
  const tmp = `${DATA_FILE}.classroom-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data,null,2),'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function mapClass(row) {
  if (!row) return null;
  return {
    id: row.id,
    classCode: row.class_code ?? row.classCode ?? '',
    className: row.class_name ?? row.className ?? '',
    classType: row.class_type ?? row.classType ?? 'single',
    deliveryMode: row.delivery_mode ?? row.deliveryMode ?? 'offline',
    trainingPurpose: row.training_purpose ?? row.trainingPurpose ?? '',
    description: row.description || '',
    departmentId: row.department_id ?? row.departmentId ?? '',
    positionId: row.position_id ?? row.positionId ?? '',
    branchId: row.branch_id ?? row.branchId ?? '',
    startAt: row.start_at ?? row.startAt ?? '',
    endAt: row.end_at ?? row.endAt ?? '',
    registrationDeadline: row.registration_deadline ?? row.registrationDeadline ?? '',
    capacity: row.capacity ?? null,
    status: row.status || 'draft',
    completionRule: row.completion_rule ?? row.completionRule ?? 'manual_confirmation',
    minimumAttendanceRate: Number(row.minimum_attendance_rate ?? row.minimumAttendanceRate ?? 0),
    minimumScore: Number(row.minimum_score ?? row.minimumScore ?? 0),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByEmail: row.created_by_email ?? row.createdByEmail ?? '',
    publishedBy: row.published_by ?? row.publishedBy ?? '',
    publishedAt: row.published_at ?? row.publishedAt ?? '',
    cancelledBy: row.cancelled_by ?? row.cancelledBy ?? '',
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? '',
    cancelReason: row.cancel_reason ?? row.cancelReason ?? '',
    isArchived: bool(row.is_archived ?? row.isArchived, false),
    version: Number(row.version || 1),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    sessions: [], enrollments: [], assignments: []
  };
}
function mapSession(row) {
  return { id:row.id, classId:row.class_id ?? row.classId, sessionNumber:Number(row.session_number ?? row.sessionNumber ?? 1), sessionName:row.session_name ?? row.sessionName ?? '', sessionDate:row.session_date ?? row.sessionDate ?? '', startTime:row.start_time ?? row.startTime ?? '', endTime:row.end_time ?? row.endTime ?? '', deliveryMode:row.delivery_mode ?? row.deliveryMode ?? 'offline', location:row.location || '', contentSummary:row.content_summary ?? row.contentSummary ?? '', attendanceRequired:bool(row.attendance_required ?? row.attendanceRequired,true), status:row.status||'scheduled', createdAt:row.created_at ?? row.createdAt ?? '', updatedAt:row.updated_at ?? row.updatedAt ?? '' };
}
function mapEnrollment(row) {
  return { id:row.id, classId:row.class_id ?? row.classId, employeeId:row.employee_id ?? row.employeeId ?? '', accountId:row.account_id ?? row.accountId ?? '', status:row.status||'enrolled', required:bool(row.required,true), enrollmentSource:row.enrollment_source ?? row.enrollmentSource ?? 'admin', departmentSnapshot:row.department_snapshot ?? row.departmentSnapshot ?? '', positionSnapshot:row.position_snapshot ?? row.positionSnapshot ?? '', branchSnapshot:row.branch_snapshot ?? row.branchSnapshot ?? '', enrolledAt:row.enrolled_at ?? row.enrolledAt ?? '', completedAt:row.completed_at ?? row.completedAt ?? '', createdBy:row.created_by ?? row.createdBy ?? '', createdAt:row.created_at ?? row.createdAt ?? '', updatedAt:row.updated_at ?? row.updatedAt ?? '' };
}
function mapAssignment(row) {
  return { id:row.id, classId:row.class_id ?? row.classId, sessionId:row.session_id ?? row.sessionId ?? '', employeeId:row.employee_id ?? row.employeeId ?? '', accountId:row.account_id ?? row.accountId ?? '', assignmentRole:row.assignment_role ?? row.assignmentRole ?? 'owner', status:row.status||'active', assignedBy:row.assigned_by ?? row.assignedBy ?? '', assignedAt:row.assigned_at ?? row.assignedAt ?? '', createdAt:row.created_at ?? row.createdAt ?? '', updatedAt:row.updated_at ?? row.updatedAt ?? '' };
}

function mapAttendance(row) {
  return { id:row.id, classId:row.class_id ?? row.classId ?? '', sessionId:row.session_id ?? row.sessionId ?? '', enrollmentId:row.enrollment_id ?? row.enrollmentId ?? '', employeeId:row.employee_id ?? row.employeeId ?? '', accountId:row.account_id ?? row.accountId ?? '', status:row.status||'unmarked', note:row.note||'', checkedBy:row.checked_by ?? row.checkedBy ?? '', checkedAt:row.checked_at ?? row.checkedAt ?? '', createdAt:row.created_at ?? row.createdAt ?? '', updatedAt:row.updated_at ?? row.updatedAt ?? '' };
}
function samePerson(session, row) {
  const eid=learnerEmployeeId(session), aid=learnerAccountId(session);
  return Boolean((eid && row.employeeId===eid) || (aid && row.accountId===aid));
}
function canManageAttendance(session, cls, sessionId) {
  const r=text(session?.role).toLowerCase();
  if(r==='admin') return true;
  if(r!=='manager') return false;
  const eid=learnerEmployeeId(session), aid=learnerAccountId(session);
  return (cls.assignments||[]).some(x => (!x.sessionId || x.sessionId===sessionId) && ['owner','attendance_officer','coordinator'].includes(text(x.assignmentRole)) && ((eid&&x.employeeId===eid)||(aid&&x.accountId===aid)));
}
async function attendanceContext(session, sessionId) {
  const classes=await listClasses(session), cls=classes.find(c=>(c.sessions||[]).some(x=>x.id===text(sessionId)));
  if(!cls){const e=new Error('Không tìm thấy buổi học hoặc tài khoản không có quyền truy cập.');e.code='CLASSROOM_SESSION_NOT_FOUND';e.statusCode=404;throw e;}
  const ses=(cls.sessions||[]).find(x=>x.id===text(sessionId));
  return {cls,ses};
}
function vnDateKey(value) {
  const d=value instanceof Date?value:new Date(value||Date.now());
  const shifted=new Date(d.getTime()+7*60*60*1000);
  return shifted.toISOString().slice(0,10);
}
function addDateDays(dateKey, days) {
  const d=new Date(`${dateKey}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
function attendanceDeadline(sessionDate) { return addDateDays(text(sessionDate),1); }
function attendanceExpired(sessionDate) { return vnDateKey()>attendanceDeadline(sessionDate); }
async function attendanceHistory(classId, sessionId) {
  let rows=[];
  if(supabase){
    const {data,error}=await supabase.from('classroom_class_history').select('*').eq('class_id',classId).in('action',['attendance_draft','attendance_finalized','attendance_admin_updated']).order('performed_at',{ascending:false});
    if(error&&!missingTable(error))throw error;rows=data||[];
  } else rows=(readLocal().classroomHistory||[]).slice().sort((a,b)=>text(b.performedAt||b.performed_at).localeCompare(text(a.performedAt||a.performed_at)));
  return rows.filter(x=>text((x.new_values??x.newValues)?.sessionId)===sessionId || text((x.old_values??x.oldValues)?.sessionId)===sessionId).map(x=>{
    const ov=x.old_values??x.oldValues??{}, nv=x.new_values??x.newValues??{};
    return {id:text(x.id),action:text(x.action),performedBy:text(x.performed_by??x.performedBy),performedAt:text(x.performed_at??x.performedAt),reason:text(nv.reason),state:text(nv.state),changes:Array.isArray(nv.changes)?nv.changes:[],oldState:text(ov.state)};
  });
}
async function attendanceWorkflow(classId, sessionId) {
  const rows=await attendanceHistory(classId,sessionId), row=rows[0];
  if(!row)return {state:'not_started',finalizedAt:'',performedBy:'',reason:''};
  return {state:row.state||(/finalized|admin_updated/.test(row.action)?'finalized':'draft'),finalizedAt:text((row.action==='attendance_draft'?'':row.performedAt)),performedBy:row.performedBy,reason:row.reason};
}
async function writeAttendanceHistory(cls, sessionId, action, session, previous, extra) {
  const stamp=now(), next={sessionId,state:action==='attendance_draft'?'draft':'finalized',finalizedAt:action==='attendance_draft'?'':(previous.finalizedAt||stamp),reason:text(extra?.reason),changes:Array.isArray(extra?.changes)?extra.changes:[]};
  if(supabase){const {error}=await supabase.from('classroom_class_history').insert({id:id('history'),class_id:cls.id,action,old_values:{sessionId,...previous},new_values:next,performed_by:actorKey(session),performed_at:stamp});if(error)throw classroomDbError(error,'classroom_attendance:history');}
  else {const d=readLocal();d.classroomHistory.push({id:id('history'),classId:cls.id,action,oldValues:{sessionId,...previous},newValues:next,performedBy:actorKey(session),performedAt:stamp});writeLocal(d);}
}
async function listAttendance(session, sessionId) {
  assertStorage();
  const {cls,ses}=await attendanceContext(session,sessionId);
  let rows=[];
  if(supabase){const {data,error}=await supabase.from('classroom_attendance').select('*').eq('session_id',sessionId);if(error)throw schemaError(error);rows=(data||[]).map(mapAttendance);}
  else rows=readLocal().classroomAttendance.map(mapAttendance).filter(x=>x.sessionId===sessionId);
  const r=text(session?.role).toLowerCase(), isAdmin=r==='admin', expired=attendanceExpired(ses.sessionDate), baseManage=canManageAttendance(session,cls,sessionId), workflow=await attendanceWorkflow(cls.id,sessionId);
  if(r==='learner') rows=rows.filter(x=>samePerson(session,x));
  const history=await attendanceHistory(cls.id,sessionId);
  return {classroomClass:cls,session:ses,attendance:rows,attendanceHistory:history,workflowState:workflow.state,finalizedAt:workflow.finalizedAt,deadlineDate:attendanceDeadline(ses.sessionDate),isExpired:expired,isAdmin,canManage:baseManage&&(!expired||isAdmin),requiresAdminReason:isAdmin&&expired};
}
async function saveAttendance(session, payload) {
  assertStorage();
  const sessionId=text(payload?.sessionId), items=Array.isArray(payload?.attendance)?payload.attendance:[], requestedAction=text(payload?.action)||'draft', reason=text(payload?.reason);
  const {cls,ses}=await attendanceContext(session,sessionId);const isAdmin=text(session?.role).toLowerCase()==='admin', expired=attendanceExpired(ses.sessionDate);
  if(!canManageAttendance(session,cls,sessionId)){const e=new Error('Tài khoản không có quyền điểm danh buổi học này.');e.code='CLASSROOM_ATTENDANCE_FORBIDDEN';e.statusCode=403;throw e;}
  if(expired&&!isAdmin){const e=new Error('Sổ điểm danh đã khóa sau ngày N+1. Chỉ Admin được phép chỉnh sửa.');e.code='CLASSROOM_ATTENDANCE_LOCKED';e.statusCode=403;throw e;}
  if(expired&&isAdmin&&!reason){const e=new Error('Admin cần nhập lý do khi chỉnh sửa sổ điểm danh đã khóa.');e.code='CLASSROOM_ATTENDANCE_REASON_REQUIRED';e.statusCode=400;throw e;}
  if(!['draft','finalize','update'].includes(requestedAction)){const e=new Error('Thao tác điểm danh không hợp lệ.');e.code='CLASSROOM_ATTENDANCE_ACTION_INVALID';e.statusCode=400;throw e;}
  const allowed=new Set(['present','absent','excused','late','unmarked']), enrollments=cls.enrollments||[], actor=actorKey(session), stamp=now();
  const rows=items.map(item=>{
    const enrollment=enrollments.find(x=>x.id===text(item.enrollmentId) || (item.employeeId&&x.employeeId===text(item.employeeId)) || (item.accountId&&x.accountId===text(item.accountId)));
    if(!enrollment){const e=new Error('Có học viên không thuộc lớp đào tạo này.');e.code='CLASSROOM_ATTENDANCE_LEARNER_INVALID';e.statusCode=400;throw e;}
    const status=allowed.has(text(item.status))?text(item.status):'unmarked';
    return {id:text(item.id)||id('attendance'),class_id:cls.id,session_id:sessionId,enrollment_id:enrollment.id,employee_id:nullable(enrollment.employeeId),account_id:nullable(enrollment.accountId),status,note:text(item.note),checked_by:actor,checked_at:stamp,created_at:text(item.createdAt)||stamp,updated_at:stamp};
  });
  if(requestedAction==='finalize'){
    const byEnrollment=new Map(rows.map(x=>[x.enrollment_id,x.status]));
    const missing=enrollments.filter(x=>!byEnrollment.has(x.id)||byEnrollment.get(x.id)==='unmarked');
    if(missing.length){const e=new Error(`Chưa thể chốt điểm danh. Còn ${missing.length} học viên chưa hoàn tất trạng thái.`);e.code='CLASSROOM_ATTENDANCE_INCOMPLETE';e.statusCode=400;throw e;}
  }
  let previousRows=[];
  if(supabase){const {data,error}=await supabase.from('classroom_attendance').select('*').eq('session_id',sessionId);if(error)throw schemaError(error);previousRows=(data||[]).map(mapAttendance);}
  else previousRows=readLocal().classroomAttendance.map(mapAttendance).filter(x=>x.sessionId===sessionId);
  if(supabase){
    const {error:del}=await supabase.from('classroom_attendance').delete().eq('session_id',sessionId);if(del)throw classroomDbError(del,'classroom_attendance:delete');
    if(rows.length){const {error}=await supabase.from('classroom_attendance').insert(rows);if(error)throw classroomDbError(error,'classroom_attendance:insert');}
  } else {
    const d=readLocal();d.classroomAttendance=d.classroomAttendance.filter(x=>(x.sessionId||x.session_id)!==sessionId).concat(rows.map(x=>({...mapAttendance(x),...x})));writeLocal(d);
  }
  const previous=await attendanceWorkflow(cls.id,sessionId), historyAction=requestedAction==='draft'?'attendance_draft':(requestedAction==='update'?'attendance_admin_updated':'attendance_finalized');
  const oldMap=new Map(previousRows.map(x=>[x.enrollmentId,x])), changes=rows.map(x=>{const old=oldMap.get(x.enrollment_id)||{};return {enrollmentId:x.enrollment_id,employeeId:x.employee_id||'',accountId:x.account_id||'',oldStatus:text(old.status)||'unmarked',newStatus:x.status,oldNote:text(old.note),newNote:text(x.note)};}).filter(x=>x.oldStatus!==x.newStatus||x.oldNote!==x.newNote);
  await writeAttendanceHistory(cls,sessionId,historyAction,session,previous,{reason,changes});
  return listAttendance(session,sessionId);
}

function actorKey(session) { return text(session?.account?.id || session?.sub || session?.account?.email || session?.email); }
function actorEmail(session) { return text(session?.account?.email || session?.email); }
function learnerEmployeeId(session) { return text(session?.employeeId || session?.account?.employeeId); }
function learnerAccountId(session) { return text(session?.account?.id || session?.sub); }
function normalizeInput(input, existing) {
  const row = existing || {};
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const enrollments = Array.isArray(input.enrollments) ? input.enrollments : [];
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  return {
    classCode:text(input.classCode || row.classCode), className:text(input.className || row.className), classType:['single','multi'].includes(input.classType)?input.classType:(row.classType||'single'), deliveryMode:['offline','online','hybrid'].includes(input.deliveryMode)?input.deliveryMode:(row.deliveryMode||'offline'), trainingPurpose:text(input.trainingPurpose || row.trainingPurpose), description:text(input.description ?? row.description), departmentId:text(input.departmentId ?? row.departmentId), positionId:text(input.positionId ?? row.positionId), branchId:text(input.branchId ?? row.branchId), startAt:text(input.startAt ?? row.startAt), endAt:text(input.endAt ?? row.endAt), registrationDeadline:text(input.registrationDeadline ?? row.registrationDeadline), capacity:numberOrNull(input.capacity), status:text(input.status || row.status || 'draft'), completionRule:text(input.completionRule || row.completionRule || 'manual_confirmation'), minimumAttendanceRate:Number(input.minimumAttendanceRate ?? row.minimumAttendanceRate ?? 0), minimumScore:Number(input.minimumScore ?? row.minimumScore ?? 0), sessions, enrollments, assignments
  };
}
function validateClass(input, publish=false) {
  if (!input.classCode) { const e=new Error('Vui lòng nhập mã lớp.');e.code='CLASS_CODE_REQUIRED';e.statusCode=400;throw e; }
  if (!input.className) { const e=new Error('Vui lòng nhập tên lớp đào tạo.');e.code='CLASS_NAME_REQUIRED';e.statusCode=400;throw e; }
  if (!input.trainingPurpose) { const e=new Error('Vui lòng chọn mục đích đào tạo.');e.code='TRAINING_PURPOSE_REQUIRED';e.statusCode=400;throw e; }
  if (!['single','multi'].includes(input.classType)) { const e=new Error('Loại lớp không hợp lệ.');e.code='CLASS_TYPE_INVALID';e.statusCode=400;throw e; }
  if (publish) {
    if (!input.startAt || !input.endAt) { const e=new Error('Lớp cần có thời gian bắt đầu và kết thúc trước khi phát hành.');e.code='CLASS_SCHEDULE_REQUIRED';e.statusCode=400;throw e; }
    if (!input.sessions.length) { const e=new Error('Lớp cần có ít nhất một buổi học trước khi phát hành.');e.code='CLASS_SESSION_REQUIRED';e.statusCode=400;throw e; }
    if (input.sessions.some(x=>!text(x.sessionDate)||!text(x.startTime)||!text(x.endTime))) { const e=new Error('Mỗi buổi học phải có đủ ngày, giờ bắt đầu và giờ kết thúc.');e.code='CLASS_SESSION_SCHEDULE_REQUIRED';e.statusCode=400;throw e; }
    if (!input.enrollments.length) { const e=new Error('Lớp cần có ít nhất một học viên trước khi phát hành.');e.code='CLASS_LEARNER_REQUIRED';e.statusCode=400;throw e; }
    if (!input.assignments.some(x=>text(x.assignmentRole)==='owner')) { const e=new Error('Vui lòng chọn người phụ trách chính trước khi phát hành.');e.code='CLASS_OWNER_REQUIRED';e.statusCode=400;throw e; }
    if (input.capacity && input.enrollments.length > input.capacity) { const e=new Error('Số học viên đã chọn vượt quá số lượng tối đa của lớp.');e.code='CLASS_CAPACITY_EXCEEDED';e.statusCode=400;throw e; }
    if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) { const e=new Error('Thời gian kết thúc phải sau thời gian bắt đầu.');e.code='CLASS_TIME_INVALID';e.statusCode=400;throw e; }
  }
}
function publicForSession(cls, session) {
  const r = text(session?.role).toLowerCase();
  if (r === 'admin') return true;
  if (cls.status === 'draft') return false;
  if (r === 'manager') return true;
  const eid=learnerEmployeeId(session), aid=learnerAccountId(session);
  return cls.enrollments.some(x => (eid && x.employeeId===eid) || (aid && x.accountId===aid));
}
function attach(classes, sessions, enrollments, assignments) {
  const byId=new Map(classes.map(c=>[c.id,c]));
  sessions.forEach(x=>{const c=byId.get(x.classId);if(c)c.sessions.push(x);});
  enrollments.forEach(x=>{const c=byId.get(x.classId);if(c)c.enrollments.push(x);});
  assignments.forEach(x=>{const c=byId.get(x.classId);if(c)c.assignments.push(x);});
  classes.forEach(c=>c.sessions.sort((a,b)=>a.sessionNumber-b.sessionNumber));
  return classes;
}
async function listLocal(session) {
  const d=readLocal();
  const classes=attach(d.classroomClasses.map(mapClass),d.classroomSessions.map(mapSession),d.classroomEnrollments.map(mapEnrollment),d.classroomAssignments.map(mapAssignment));
  return classes.filter(c=>!c.isArchived && publicForSession(c,session));
}
async function listSupabase(session) {
  const [a,b,c,d]=await Promise.all([
    supabase.from('classroom_classes').select('*').eq('is_archived',false).order('created_at',{ascending:false}),
    supabase.from('classroom_sessions').select('*').order('session_number',{ascending:true}),
    supabase.from('classroom_enrollments').select('*'),
    supabase.from('classroom_assignments').select('*')
  ]);
  const err=a.error||b.error||c.error||d.error;if(err)throw schemaError(err);
  return attach((a.data||[]).map(mapClass),(b.data||[]).map(mapSession),(c.data||[]).map(mapEnrollment),(d.data||[]).map(mapAssignment)).filter(c=>publicForSession(c,session));
}
async function listClasses(session) { assertStorage(); return supabase?listSupabase(session):listLocal(session); }
async function getClass(session,classId) { const rows=await listClasses(session); const row=rows.find(c=>c.id===text(classId)); if(!row){const e=new Error('Không tìm thấy lớp hoặc tài khoản không có quyền xem lớp này.');e.code='CLASS_NOT_FOUND';e.statusCode=404;throw e;} return row; }
async function ensureCodeUnique(code, excludeId='') {
  const key=text(code).toLowerCase();
  if (supabase) { let q=supabase.from('classroom_classes').select('id').ilike('class_code',key); if(excludeId)q=q.neq('id',excludeId); const {data,error}=await q.limit(1);if(error)throw schemaError(error);if(data?.length){const e=new Error('Mã lớp đã tồn tại.');e.code='CLASS_CODE_EXISTS';e.statusCode=409;throw e;} }
  else { const d=readLocal();if(d.classroomClasses.some(x=>text(x.classCode||x.class_code).toLowerCase()===key && x.id!==excludeId)){const e=new Error('Mã lớp đã tồn tại.');e.code='CLASS_CODE_EXISTS';e.statusCode=409;throw e;} }
}
function toDbClass(input, session, existing, publish) {
  const stamp=now(), actor=actorKey(session);
  return { id:existing?.id||id('class'), class_code:input.classCode, class_name:input.className, class_type:input.classType, delivery_mode:input.deliveryMode, training_purpose:input.trainingPurpose, description:input.description, department_id:nullable(input.departmentId), position_id:nullable(input.positionId), branch_id:nullable(input.branchId), start_at:nullable(input.startAt), end_at:nullable(input.endAt), registration_deadline:nullable(input.registrationDeadline), capacity:input.capacity, status:publish?'published':(existing?.status||'draft'), completion_rule:input.completionRule, minimum_attendance_rate:input.minimumAttendanceRate, minimum_score:input.minimumScore, created_by:existing?.createdBy||actor, created_by_email:existing?.createdByEmail||actorEmail(session), published_by:publish?actor:(existing?.publishedBy||null), published_at:publish?(existing?.publishedAt||stamp):(existing?.publishedAt||null), cancelled_by:existing?.cancelledBy||null, cancelled_at:existing?.cancelledAt||null, cancel_reason:existing?.cancelReason||null, is_archived:false, version:Number(existing?.version||0)+1, created_at:existing?.createdAt||stamp, updated_at:stamp };
}
function childRows(classId,input,session) {
  const stamp=now(), actor=actorKey(session);
  return {
    sessions:input.sessions.map((x,i)=>({id:text(x.id)||id('session'),class_id:classId,session_number:i+1,session_name:text(x.sessionName)||`Buổi học ${i+1}`,session_date:nullable(x.sessionDate),start_time:nullable(x.startTime),end_time:nullable(x.endTime),delivery_mode:['offline','online','hybrid'].includes(x.deliveryMode)?x.deliveryMode:'offline',location:text(x.location),content_summary:text(x.contentSummary),attendance_required:bool(x.attendanceRequired,true),status:text(x.status)||'scheduled',created_at:stamp,updated_at:stamp})),
    enrollments:input.enrollments.map(x=>({id:text(x.id)||id('enrollment'),class_id:classId,employee_id:nullable(x.employeeId),account_id:nullable(x.accountId),status:text(x.status)||'enrolled',required:bool(x.required,true),enrollment_source:text(x.enrollmentSource)||'admin',department_snapshot:text(x.departmentSnapshot),position_snapshot:text(x.positionSnapshot),branch_snapshot:text(x.branchSnapshot),enrolled_at:text(x.enrolledAt)||stamp,completed_at:nullable(x.completedAt),created_by:actor,created_at:stamp,updated_at:stamp})),
    assignments:input.assignments.map(x=>({id:text(x.id)||id('assignment'),class_id:classId,session_id:nullable(x.sessionId),employee_id:nullable(x.employeeId),account_id:nullable(x.accountId),assignment_role:text(x.assignmentRole)||'owner',status:text(x.status)||'active',assigned_by:actor,assigned_at:text(x.assignedAt)||stamp,created_at:stamp,updated_at:stamp}))
  };
}
async function saveLocal(session, payload, publish) {
  const d=readLocal(), existing=payload.id?d.classroomClasses.map(mapClass).find(x=>x.id===payload.id):null;
  const input=normalizeInput(payload,existing);validateClass(input,publish);await ensureCodeUnique(input.classCode,existing?.id||'');
  const db=toDbClass(input,session,existing,publish), children=childRows(db.id,input,session);
  const idx=d.classroomClasses.findIndex(x=>x.id===db.id);const localClass={...mapClass(db),...db};if(idx>=0)d.classroomClasses[idx]=localClass;else d.classroomClasses.push(localClass);
  d.classroomSessions=d.classroomSessions.filter(x=>(x.classId||x.class_id)!==db.id).concat(children.sessions.map(x=>({...mapSession(x),...x})));
  d.classroomEnrollments=d.classroomEnrollments.filter(x=>(x.classId||x.class_id)!==db.id).concat(children.enrollments.map(x=>({...mapEnrollment(x),...x})));
  d.classroomAssignments=d.classroomAssignments.filter(x=>(x.classId||x.class_id)!==db.id).concat(children.assignments.map(x=>({...mapAssignment(x),...x})));
  d.classroomHistory.push({id:id('history'),classId:db.id,action:publish?'published':(existing?'updated':'created'),performedBy:actorKey(session),performedAt:now()});writeLocal(d);return getClass(session,db.id);
}
async function saveSupabase(session,payload,publish) {
  let existing=null;if(payload.id){const {data,error}=await supabase.from('classroom_classes').select('*').eq('id',payload.id).maybeSingle();if(error)throw schemaError(error);existing=mapClass(data);}
  const input=normalizeInput(payload,existing);validateClass(input,publish);await ensureCodeUnique(input.classCode,existing?.id||'');
  const db=toDbClass(input,session,existing,publish), children=childRows(db.id,input,session);
  const {error:ce}=await supabase.from('classroom_classes').upsert(db,{onConflict:'id'});if(ce)throw classroomDbError(ce,'classroom_classes');
  // Đồng bộ dữ liệu con theo ID thay vì xóa toàn bộ. Việc này giữ nguyên khóa session/enrollment
  // để dữ liệu điểm danh đã phát sinh không bị xóa theo foreign key cascade khi sửa lớp.
  for(const [table,rows] of [['classroom_sessions',children.sessions],['classroom_enrollments',children.enrollments],['classroom_assignments',children.assignments]]){
    const {data:oldRows,error:readError}=await supabase.from(table).select('id').eq('class_id',db.id);if(readError)throw classroomDbError(readError,table+':read');
    const keepIds=new Set(rows.map(x=>x.id));
    const removeIds=(oldRows||[]).map(x=>x.id).filter(x=>!keepIds.has(x));
    if(removeIds.length){const {error:deleteError}=await supabase.from(table).delete().in('id',removeIds);if(deleteError)throw classroomDbError(deleteError,table+':delete');}
    if(rows.length){const {error:upsertError}=await supabase.from(table).upsert(rows,{onConflict:'id'});if(upsertError)throw classroomDbError(upsertError,table+':upsert');}
  }
  const {error:he}=await supabase.from('classroom_class_history').insert({id:id('history'),class_id:db.id,action:publish?'published':(existing?'updated':'created'),old_values:existing||{},new_values:input,performed_by:actorKey(session),performed_at:now()});if(he&&!missingTable(he))console.warn('[PHF Classroom] history write failed',he.message||he);
  return getClass(session,db.id);
}
async function saveClass(session,payload,{publish=false}={}) { assertStorage(); if(text(session?.role).toLowerCase()!=='admin'){const e=new Error('Chỉ Admin được tạo, sửa hoặc phát hành lớp.');e.code='CLASSROOM_ADMIN_REQUIRED';e.statusCode=403;throw e;} return supabase?saveSupabase(session,payload,publish):saveLocal(session,payload,publish); }

module.exports={listClasses,getClass,saveClass,listAttendance,saveAttendance};
