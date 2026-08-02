'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession:false, autoRefreshToken:false }
    })
  : null;

const TABLE = 'checklist_permission_grants';
const HISTORY_TABLE = 'checklist_permission_grant_history';
const SCOPE_TYPES = new Set(['none','all_company','direct_reports','department','branch','department_branch','employees']);
const CAPABILITY_KEYS = ['view_monthly','view_violations','view_reports','export_data','review_monthly','record_violation'];
const PRESETS = Object.freeze({
  TRO_LY_GD: {
    name:'Trợ lý Giám đốc – Điều hành web',
    capabilities:{view_monthly:true,view_violations:true,view_reports:true,export_data:true,review_monthly:true,record_violation:true},
    viewScope:{type:'all_company',values:[]},
    reviewScope:{type:'all_company',values:[]},
    recordScope:{type:'all_company',values:[]},
    exportScope:{type:'all_company',values:[]}
  },
  TRUONG_BO_PHAN: {
    name:'Trưởng bộ phận',
    capabilities:{view_monthly:true,view_violations:true,view_reports:true,export_data:true,review_monthly:true,record_violation:true},
    viewScope:{type:'department',values:[]},
    reviewScope:{type:'department',values:[]},
    recordScope:{type:'department',values:[]},
    exportScope:{type:'department',values:[]}
  },
  TRUONG_CA_BH: {
    name:'Trưởng ca bán hàng',
    capabilities:{view_monthly:true,view_violations:true,view_reports:true,export_data:true,review_monthly:true,record_violation:true},
    viewScope:{type:'department_branch',values:['Bán hàng','Phú Lợi','Ngô Quyền','Lái Thiêu']},
    reviewScope:{type:'direct_reports',values:[]},
    recordScope:{type:'department_branch',values:['Bán hàng','Phú Lợi','Ngô Quyền','Lái Thiêu']},
    exportScope:{type:'department_branch',values:['Bán hàng','Phú Lợi','Ngô Quyền','Lái Thiêu']}
  },
  QUAN_LY_TRUC_TIEP: {
    name:'Quản lý trực tiếp',
    capabilities:{view_monthly:true,view_violations:true,view_reports:true,export_data:false,review_monthly:true,record_violation:false},
    viewScope:{type:'direct_reports',values:[]},
    reviewScope:{type:'direct_reports',values:[]},
    recordScope:{type:'none',values:[]},
    exportScope:{type:'none',values:[]}
  },
  CHI_XEM_BAO_CAO: {
    name:'Chỉ xem báo cáo',
    capabilities:{view_monthly:false,view_violations:false,view_reports:true,export_data:false,review_monthly:false,record_violation:false},
    viewScope:{type:'direct_reports',values:[]},
    reviewScope:{type:'none',values:[]},
    recordScope:{type:'none',values:[]},
    exportScope:{type:'none',values:[]}
  },
  TUY_CHINH: {
    name:'Tùy chỉnh nâng cao',
    capabilities:{view_monthly:false,view_violations:false,view_reports:false,export_data:false,review_monthly:false,record_violation:false},
    viewScope:{type:'none',values:[]},
    reviewScope:{type:'none',values:[]},
    recordScope:{type:'none',values:[]},
    exportScope:{type:'none',values:[]}
  }
});

function text(value){ return String(value == null ? '' : value).trim(); }
function fail(message,statusCode=400,code='CHECKLIST_PERMISSION_INVALID'){ const error=new Error(message);error.statusCode=statusCode;error.code=code;throw error; }
function requireAdmin(session){ if(!session || session.role!=='admin') fail('Chỉ Admin Checklist được cấu hình phân quyền.',403,'CHECKLIST_PERMISSION_ADMIN_ONLY'); }
async function activeGrantForSession(session){
  if(!session)return null;
  if(text(session.role).toLowerCase()==='admin')return {preset_code:'ADMIN_SYSTEM'};
  ensureDb();
  const a=actor(session),today=new Date().toISOString().slice(0,10),filters=[];
  if(a.id)filters.push('account_id.eq.'+a.id);
  if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
  if(!filters.length)return null;
  const {data,error}=await supabase.from(TABLE).select('*').eq('is_active',true).lte('effective_from',today).or('effective_to.is.null,effective_to.gte.'+today).or(filters.join(',')).order('effective_from',{ascending:false}).order('updated_at',{ascending:false}).limit(20);
  if(error)throw error;
  return currentGrantRows(data||[])[0]||null;
}
async function isChecklistWebOperator(session){
  if(text(session?.role).toLowerCase()==='admin')return true;
  const grant=await activeGrantForSession(session);
  return text(grant?.preset_code).toUpperCase()==='TRO_LY_GD';
}
async function requireChecklistWebOperator(session){
  if(await isChecklistWebOperator(session))return session;
  fail('Tài khoản chưa được cấp quyền Trợ lý Giám đốc – Điều hành web.',403,'WEB_OPERATOR_REQUIRED');
}
async function requirePermissionOperator(session,inputs=[]){
  if(text(session?.role).toLowerCase()==='admin')return;
  await requireChecklistWebOperator(session);
  const rows=Array.isArray(inputs)?inputs:[inputs];
  if(rows.some(row=>text(row?.presetCode||row?.preset_code).toUpperCase()==='TRO_LY_GD'))
    fail('Chỉ Admin hệ thống được cấp hoặc thay đổi quyền Trợ lý Giám đốc.',403,'ASSISTANT_PRESET_ADMIN_ONLY');
}
function actor(session){
  return {
    id:text(session?.account?.id || session?.sub),
    name:text(session?.account?.name || session?.account?.email || session?.email),
    employeeCode:text(session?.employeeCode || session?.account?.employeeCode).toUpperCase(),
    role:text(session?.role).toLowerCase()
  };
}
function ensureDb(){ if(!supabase) fail('Supabase chưa được cấu hình để lưu phân quyền Checklist.',503,'SUPABASE_NOT_CONFIGURED'); }
function isoDate(value,required=false){
  const result=text(value);
  if(!result && !required)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(result))fail('Ngày hiệu lực phân quyền không hợp lệ.',400,'CHECKLIST_PERMISSION_DATE_INVALID');
  return result;
}
function scope(value, fallback='none'){
  const source=value && typeof value==='object' ? value : {};
  const type=text(source.type || fallback).toLowerCase();
  if(!SCOPE_TYPES.has(type))fail('Phạm vi phân quyền không hợp lệ: '+type,400,'CHECKLIST_PERMISSION_SCOPE_INVALID');
  const values=Array.isArray(source.values) ? [...new Set(source.values.map(text).filter(Boolean))].slice(0,100) : [];
  return {type,values};
}
function capabilities(value,presetCode){
  const preset=PRESETS[presetCode] || PRESETS.QUAN_LY_TRUC_TIEP;
  const source=value && typeof value==='object' ? value : preset.capabilities;
  const result={};
  CAPABILITY_KEYS.forEach(key=>{result[key]=source[key]===true;});
  return result;
}
function normalizeGrant(input={}){
  const presetCode=text(input.presetCode || input.preset_code || 'QUAN_LY_TRUC_TIEP').toUpperCase();
  if(!PRESETS[presetCode])fail('Nhóm quyền không tồn tại.',400,'CHECKLIST_PERMISSION_PRESET_INVALID');
  const employeeCode=text(input.employeeCode || input.employee_code).toUpperCase();
  const accountId=text(input.accountId || input.account_id);
  if(!employeeCode && !accountId)fail('Phải chọn đúng tài khoản hoặc Mã nhân viên.',400,'CHECKLIST_PERMISSION_IDENTITY_REQUIRED');
  const preset=PRESETS[presetCode] || {};
  const start=isoDate(input.effectiveFrom || input.effective_from,true);
  const end=isoDate(input.effectiveTo || input.effective_to,false);
  if(end && end<start)fail('Ngày kết thúc quyền phải từ ngày hiệu lực trở đi.',400,'CHECKLIST_PERMISSION_DATE_RANGE_INVALID');
  const reason=text(input.reason);
  if(reason.length<5)fail('Lý do cấp hoặc thay đổi quyền cần tối thiểu 5 ký tự.',400,'CHECKLIST_PERMISSION_REASON_REQUIRED');
  const normalizedCapabilities=capabilities(input.capabilities,presetCode);
  const viewScope=scope(input.viewScope || input.view_scope,preset.viewScope?.type);
  const reviewScope=normalizedCapabilities.review_monthly ? scope(input.reviewScope || input.review_scope,preset.reviewScope?.type) : {type:'none',values:[]};
  const recordScope=normalizedCapabilities.record_violation ? scope(input.recordScope || input.record_scope,preset.recordScope?.type) : {type:'none',values:[]};
  const exportScope=normalizedCapabilities.export_data ? scope(input.exportScope || input.export_scope,preset.exportScope?.type) : {type:'none',values:[]};
  const requiresValues=value=>['department','branch','department_branch','employees'].includes(value.type) && !value.values.length;
  if(normalizedCapabilities.review_monthly && reviewScope.type==='none')fail('Đã bật thẩm định nhưng chưa chọn phạm vi thẩm định.',400,'CHECKLIST_PERMISSION_REVIEW_SCOPE_REQUIRED');
  if(normalizedCapabilities.record_violation && recordScope.type==='none')fail('Đã bật ghi nhận lỗi nhưng chưa chọn phạm vi ghi lỗi.',400,'CHECKLIST_PERMISSION_RECORD_SCOPE_REQUIRED');
  if(normalizedCapabilities.export_data && exportScope.type==='none')fail('Đã bật xuất dữ liệu nhưng chưa chọn phạm vi xuất.',400,'CHECKLIST_PERMISSION_EXPORT_SCOPE_REQUIRED');
  if(requiresValues(viewScope))fail('Phạm vi xem đã chọn cần có chi tiết.',400,'CHECKLIST_PERMISSION_VIEW_VALUES_REQUIRED');
  if(normalizedCapabilities.review_monthly && requiresValues(reviewScope))fail('Phạm vi thẩm định đã chọn cần có chi tiết.',400,'CHECKLIST_PERMISSION_REVIEW_VALUES_REQUIRED');
  if(normalizedCapabilities.record_violation && requiresValues(recordScope))fail('Phạm vi ghi lỗi đã chọn cần có chi tiết.',400,'CHECKLIST_PERMISSION_RECORD_VALUES_REQUIRED');
  if(normalizedCapabilities.export_data && requiresValues(exportScope))fail('Phạm vi xuất dữ liệu đã chọn cần có chi tiết.',400,'CHECKLIST_PERMISSION_EXPORT_VALUES_REQUIRED');
  return {
    id:text(input.id) || null,
    account_id:accountId || null,
    employee_code:employeeCode || null,
    employee_name:text(input.employeeName || input.employee_name) || null,
    preset_code:presetCode,
    capabilities:normalizedCapabilities,
    view_scope:viewScope,
    review_scope:reviewScope,
    record_scope:recordScope,
    export_scope:exportScope,
    effective_from:start,
    effective_to:end,
    reason,
    is_active:input.isActive !== false && input.is_active !== false,
    expected_updated_at:text(input.expectedUpdatedAt || input.expected_updated_at) || null,
    expected_absent:input.expectedAbsent===true || input.expected_absent===true
  };
}
function publicGrant(row={}){
  return {
    id:row.id || '',
    accountId:row.account_id || '',
    employeeCode:row.employee_code || '',
    employeeName:row.employee_name || '',
    presetCode:row.preset_code || '',
    capabilities:row.capabilities || {},
    viewScope:row.view_scope || {type:'none',values:[]},
    reviewScope:row.review_scope || {type:'none',values:[]},
    recordScope:row.record_scope || {type:'none',values:[]},
    exportScope:row.export_scope || {type:'none',values:[]},
    effectiveFrom:row.effective_from || '',
    effectiveTo:row.effective_to || '',
    reason:row.reason || '',
    isActive:row.is_active===true,
    updatedAt:row.updated_at || '',
    updatedByName:row.updated_by_name || ''
  };
}
function normalizeMatch(value){
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
}
function currentGrantRows(rows=[]){
  const today=new Date().toISOString().slice(0,10);
  return rows.filter(row=>row.is_active===true && text(row.effective_from)<=today && (!row.effective_to || text(row.effective_to)>=today)).sort((a,b)=>text(b.effective_from).localeCompare(text(a.effective_from))||text(b.updated_at).localeCompare(text(a.updated_at)));
}
function subjectMatchesScope(subject,scopeValue,identity){
  const selected=scope(scopeValue);
  if(selected.type==='all_company')return true;
  if(selected.type==='none')return false;
  if(selected.type==='direct_reports'){
    return (identity.id && text(subject.manager_id)===identity.id) ||
      (identity.employeeCode && text(subject.manager_code).toUpperCase()===identity.employeeCode);
  }
  const values=selected.values.map(normalizeMatch);
  if(selected.type==='employees')return values.includes(normalizeMatch(subject.employee_code)) || values.includes(normalizeMatch(subject.employee_id));
  if(selected.type==='department')return values.includes(normalizeMatch(subject.department));
  if(selected.type==='branch')return values.includes(normalizeMatch(subject.branch));
  if(selected.type==='department_branch'){
    const department=normalizeMatch(subject.department),branch=normalizeMatch(subject.branch);
    const taggedDepartments=selected.values.filter(v=>/^department::/i.test(v)).map(v=>normalizeMatch(v.replace(/^department::/i,'')));
    const taggedBranches=selected.values.filter(v=>/^branch::/i.test(v)).map(v=>normalizeMatch(v.replace(/^branch::/i,'')));
    if(taggedDepartments.length||taggedBranches.length){
      return (!taggedDepartments.length||taggedDepartments.includes(department))&&(!taggedBranches.length||taggedBranches.includes(branch));
    }
    const departmentValues=values.filter(v=>/ban hang|kho|marketing|hcns|qtth|ke toan|goi qua|thu mua|online|cskh/.test(v));
    const branchValues=values.filter(v=>!departmentValues.includes(v));
    if(!values.length)return false;
    return (!departmentValues.length||departmentValues.includes(department))&&(!branchValues.length||branchValues.includes(branch));
  }
  return false;
}
function publicAssignment(row={},canReview=false){
  return {
    employeeId:row.employee_id || '',
    employeeCode:row.employee_code || '',
    employeeName:row.employee_name || '',
    department:row.department || '',
    title:row.title || '',
    branch:row.branch || '',
    managerId:row.manager_id || '',
    managerCode:row.manager_code || '',
    managerName:row.manager_name || '',
    employeeStatus:row.employee_status || '',
    templateId:row.template_id || '',
    templateVersion:row.template_version || '',
    effectiveDate:row.effective_date || '',
    canReview:canReview===true
  };
}
async function getChecklistMonthlyReviewAccess(session){
  ensureDb();
  const a=actor(session),today=new Date().toISOString().slice(0,10);
  const assignmentsRequest=supabase.from('checklist_employee_assignments').select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,template_id,template_version,effective_date').neq('employee_status','Đã nghỉ việc').order('employee_name',{ascending:true}).limit(1000);
  if(a.role==='admin'){
    const {data,error}=await assignmentsRequest;if(error)throw error;
    return {role:'admin',identity:a,canReview:true,grant:null,people:(data||[]).map(row=>publicAssignment(row,true))};
  }
  if(!a.id&&!a.employeeCode)return {role:'learner',identity:a,canReview:false,grant:null,people:[]};
  const filters=[];if(a.id)filters.push('account_id.eq.'+a.id);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
  const grantRequest=supabase.from(TABLE).select('id,account_id,employee_code,employee_name,preset_code,capabilities,view_scope,review_scope,record_scope,export_scope,effective_from,effective_to,reason,is_active,updated_at,updated_by_name').eq('is_active',true).lte('effective_from',today).or('effective_to.is.null,effective_to.gte.'+today).or(filters.join(',')).order('effective_from',{ascending:false}).order('updated_at',{ascending:false}).limit(20);
  const [assignmentResult,grantResult]=await Promise.all([assignmentsRequest,grantRequest]);
  if(assignmentResult.error)throw assignmentResult.error;if(grantResult.error)throw grantResult.error;
  const reviewGrant=currentGrantRows(grantResult.data||[]).find(row=>row.capabilities?.review_monthly===true)||null;
  if(!reviewGrant)return {role:'manager',identity:a,canReview:false,grant:null,people:[]};
  const people=(assignmentResult.data||[]).filter(row=>subjectMatchesScope(row,reviewGrant.review_scope,a));
  return {role:'manager',identity:a,canReview:true,grant:publicGrant(reviewGrant),people:people.map(row=>publicAssignment(row,true))};
}
async function getChecklistRoleWorkspace(session){
  ensureDb();
  const a=actor(session),today=new Date().toISOString().slice(0,10);
  if(!a.id&&!a.employeeCode)fail('Tài khoản chưa liên kết định danh Checklist.',409,'CHECKLIST_IDENTITY_NOT_LINKED');
  const assignmentsRequest=supabase.from('checklist_employee_assignments').select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,template_id,template_version,effective_date').neq('employee_status','Đã nghỉ việc').order('employee_name',{ascending:true}).limit(1000);
  const filters=[];if(a.id)filters.push('account_id.eq.'+a.id);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
  let grantRequest=Promise.resolve({data:[],error:null});
  if(a.role!=='admin'&&filters.length){
    grantRequest=supabase.from(TABLE).select('id,account_id,employee_code,employee_name,preset_code,capabilities,view_scope,review_scope,record_scope,export_scope,effective_from,effective_to,reason,is_active,updated_at,updated_by_name').eq('is_active',true).lte('effective_from',today).or('effective_to.is.null,effective_to.gte.'+today).or(filters.join(',')).order('effective_from',{ascending:false}).order('updated_at',{ascending:false}).limit(20);
  }
  /* Phân công và quyền là hai nguồn độc lập. Đọc đồng thời để thời gian phản hồi
     bằng truy vấn chậm hơn, thay vì cộng nối tiếp hai lượt Supabase. */
  const [assignmentResult,grantResult]=await Promise.all([assignmentsRequest,grantRequest]);
  const {data:assignments,error:assignmentError}=assignmentResult;
  if(assignmentError)throw assignmentError;
  const all=assignments || [];
  const own=all.find(row=>(a.id&&text(row.employee_id)===a.id)||(a.employeeCode&&text(row.employee_code).toUpperCase()===a.employeeCode)) || null;
  if(a.role==='admin')return {role:'admin',identity:a,grant:null,ownAssignment:own?publicAssignment(own,false):null,people:all.map(row=>publicAssignment(row,true)),generatedAt:new Date().toISOString()};
  if(!filters.length)return {role:'learner',identity:a,grant:null,ownAssignment:own?publicAssignment(own,false):null,people:own?[publicAssignment(own,false)]:[],generatedAt:new Date().toISOString()};
  const {data:grantRows,error:grantError}=grantResult;if(grantError)throw grantError;
  const active=currentGrantRows(grantRows || []);
  const viewGrant=active.find(row=>row.capabilities?.view_monthly===true||row.capabilities?.view_reports===true||row.capabilities?.view_violations===true) || active[0] || null;
  if(!viewGrant)return {role:'learner',identity:a,grant:null,ownAssignment:own?publicAssignment(own,false):null,people:own?[publicAssignment(own,false)]:[],generatedAt:new Date().toISOString()};
  /* Quyền Nhân viên là quyền nền: dù có thêm quyền mở rộng, người dùng vẫn
     luôn được thấy dữ liệu của chính mình. Phạm vi mở rộng chỉ cộng thêm người
     khác, không được làm mất quyền cá nhân. */
  const visibleByScope=all.filter(row=>subjectMatchesScope(row,viewGrant.view_scope,a));
  const visibleMap=new Map();
  if(own)visibleMap.set(text(own.employee_id)||text(own.employee_code).toUpperCase(),own);
  visibleByScope.forEach(row=>visibleMap.set(text(row.employee_id)||text(row.employee_code).toUpperCase(),row));
  const visible=[...visibleMap.values()];
  const reviewGrant=active.find(row=>row.capabilities?.review_monthly===true) || null;
  const exportGrant=active.find(row=>row.capabilities?.export_data===true) || null;
  const recordGrant=active.find(row=>row.capabilities?.record_violation===true) || null;
  return {
    role:'manager',
    identity:a,
    grant:publicGrant(viewGrant),
    canExport:Boolean(exportGrant),
    exportScope:exportGrant?exportGrant.export_scope:{type:'none',values:[]},
    canRecordViolation:Boolean(recordGrant),
    recordScope:recordGrant?(recordGrant.record_scope?.type?recordGrant.record_scope:{type:'none',values:[]}):{type:'none',values:[]},
    ownAssignment:own?publicAssignment(own,false):null,
    people:visible.map(row=>publicAssignment(row,!!reviewGrant&&subjectMatchesScope(row,reviewGrant.review_scope,a))),
    generatedAt:new Date().toISOString()
  };
}
async function getChecklistReportAccess(session){
  ensureDb();
  const a=actor(session),today=new Date().toISOString().slice(0,10);
  const assignmentsRequest=supabase.from('checklist_employee_assignments').select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,template_id,template_version,effective_date').neq('employee_status','Đã nghỉ việc').order('employee_name',{ascending:true}).limit(1000);
  if(a.role==='admin'){
    const {data,error}=await assignmentsRequest;if(error)throw error;
    return {role:'admin',identity:a,grant:null,canExport:true,people:(data||[]).map(row=>publicAssignment(row,true))};
  }
  if(!a.id&&!a.employeeCode)fail('Tài khoản chưa liên kết định danh Checklist.',409,'CHECKLIST_IDENTITY_NOT_LINKED');
  const filters=[];if(a.id)filters.push('account_id.eq.'+a.id);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
  const grantRequest=supabase.from(TABLE).select('id,account_id,employee_code,employee_name,preset_code,capabilities,view_scope,review_scope,record_scope,export_scope,effective_from,effective_to,reason,is_active,updated_at,updated_by_name').eq('is_active',true).lte('effective_from',today).or('effective_to.is.null,effective_to.gte.'+today).or(filters.join(',')).order('effective_from',{ascending:false}).order('updated_at',{ascending:false}).limit(20);
  const [assignmentResult,grantResult]=await Promise.all([assignmentsRequest,grantRequest]);
  if(assignmentResult.error)throw assignmentResult.error;if(grantResult.error)throw grantResult.error;
  const active=currentGrantRows(grantResult.data||[]),reportGrant=active.find(row=>row.capabilities?.view_reports===true);
  if(!reportGrant)fail('Tài khoản chưa được cấp quyền xem Báo cáo Checklist.',403,'CHECKLIST_REPORT_FORBIDDEN');
  const visible=(assignmentResult.data||[]).filter(row=>subjectMatchesScope(row,reportGrant.view_scope,a));
  const exportGrant=active.find(row=>row.capabilities?.export_data===true);
  return {role:'manager',identity:a,grant:publicGrant(reportGrant),canExport:Boolean(exportGrant),people:visible.map(row=>publicAssignment(row,false))};
}
async function getChecklistExportAccess(session){
  ensureDb();
  const a=actor(session),today=new Date().toISOString().slice(0,10);
  const assignmentsRequest=supabase.from('checklist_employee_assignments').select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,template_id,template_version,effective_date').neq('employee_status','Đã nghỉ việc').order('employee_name',{ascending:true}).limit(1000);
  if(a.role==='admin'){
    const {data,error}=await assignmentsRequest;if(error)throw error;
    return {role:'admin',identity:a,grant:null,people:(data||[]).map(row=>publicAssignment(row,true))};
  }
  if(!a.id&&!a.employeeCode)fail('Tài khoản chưa liên kết định danh Checklist.',409,'CHECKLIST_IDENTITY_NOT_LINKED');
  const filters=[];if(a.id)filters.push('account_id.eq.'+a.id);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
  const grantRequest=supabase.from(TABLE).select('id,account_id,employee_code,employee_name,preset_code,capabilities,view_scope,review_scope,record_scope,export_scope,effective_from,effective_to,reason,is_active,updated_at,updated_by_name').eq('is_active',true).lte('effective_from',today).or('effective_to.is.null,effective_to.gte.'+today).or(filters.join(',')).order('effective_from',{ascending:false}).order('updated_at',{ascending:false}).limit(20);
  const [assignmentResult,grantResult]=await Promise.all([assignmentsRequest,grantRequest]);
  if(assignmentResult.error)throw assignmentResult.error;if(grantResult.error)throw grantResult.error;
  const exportGrant=currentGrantRows(grantResult.data||[]).find(row=>row.capabilities?.export_data===true);
  if(!exportGrant)fail('Tài khoản chưa được cấp quyền xuất dữ liệu Checklist.',403,'CHECKLIST_EXPORT_FORBIDDEN');
  const people=(assignmentResult.data||[]).filter(row=>subjectMatchesScope(row,exportGrant.export_scope,a));
  return {role:'manager',identity:a,grant:publicGrant(exportGrant),people:people.map(row=>publicAssignment(row,false))};
}
async function audit(session,grantId,action,beforeData,afterData,reason){
  const a=actor(session);
  const {error}=await supabase.from(HISTORY_TABLE).insert({
    grant_id:grantId,
    action,
    before_data:beforeData || {},
    after_data:afterData || {},
    reason:text(reason),
    changed_by:a.id || null,
    changed_by_name:a.name || null
  });
  if(error)throw error;
}
async function listChecklistPermissionGrants(session,{includeInactive=false}={}){
  ensureDb();
  const a=actor(session),operator=await isChecklistWebOperator(session);
  let query=supabase.from(TABLE).select('*').order('employee_name',{ascending:true}).order('updated_at',{ascending:false});
  if(!operator){
    const filters=[];if(a.id)filters.push('account_id.eq.'+a.id);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);
    if(!filters.length)return {grants:[],presets:[],scopeTypes:[...SCOPE_TYPES]};
    query=query.or(filters.join(',')).eq('is_active',true);
  }else if(!includeInactive)query=query.eq('is_active',true);
  const {data,error}=await query.limit(1000);if(error)throw error;
  return {
    grants:(data || []).map(publicGrant),
    presets:Object.entries(PRESETS).map(([code,p])=>({code,name:p.name,capabilities:p.capabilities,viewScope:p.viewScope,reviewScope:p.reviewScope,recordScope:p.recordScope,exportScope:p.exportScope})),
    scopeTypes:[...SCOPE_TYPES]
  };
}
async function saveChecklistPermissionGrants(session,inputs=[]){
  await requirePermissionOperator(session,inputs);ensureDb();
  const rows=(Array.isArray(inputs)?inputs:[]).map(normalizeGrant);
  if(!rows.length)fail('Không có phân quyền nào để lưu.',400,'CHECKLIST_PERMISSION_EMPTY');
  if(rows.length>200)fail('Mỗi lần chỉ được cập nhật tối đa 200 phân quyền.',400,'CHECKLIST_PERMISSION_LIMIT');
  const seen=new Set();for(const row of rows){const key=(row.account_id||row.employee_code)+'|'+row.effective_from;if(seen.has(key))fail('File có dòng phân quyền trùng tài khoản và ngày hiệu lực.',400,'CHECKLIST_PERMISSION_DUPLICATE');seen.add(key);}
  const a=actor(session),rpc=await supabase.rpc('phf_save_checklist_permission_grants',{p_grants:rows,p_actor_id:a.id||'',p_actor_name:a.name||''});
  if(rpc.error){const message=String(rpc.error.message||'');if(/CHECKLIST_PERMISSION_STALE/i.test(message))fail('Phân quyền đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi lưu.',409,'CHECKLIST_PERMISSION_STALE');if(/CHECKLIST_PERMISSION_OVERLAP/i.test(message))fail('Khoảng thời gian phân quyền bị chồng với một quyền đang có. Vui lòng kết thúc quyền cũ trước.',409,'CHECKLIST_PERMISSION_OVERLAP');if(/phf_save_checklist_permission_grants/i.test(message))fail('Chưa chạy SQL ổn định Production cho phân quyền Checklist.',503,'CHECKLIST_PERMISSION_STABILITY_SQL_MISSING');throw rpc.error;}
  const result=rpc.data||{},grants=Array.isArray(result.grants)?result.grants.map(publicGrant):[];return {saved:grants.length,grants};
}
async function disableChecklistPermissionGrant(session,input={}){
  await requireChecklistWebOperator(session);ensureDb();
  const id=text(input.id),reason=text(input.reason);if(!id)fail('Thiếu phân quyền cần ngừng.',400,'CHECKLIST_PERMISSION_ID_REQUIRED');if(reason.length<5)fail('Lý do ngừng quyền cần tối thiểu 5 ký tự.',400,'CHECKLIST_PERMISSION_REASON_REQUIRED');
  const expectedUpdatedAt=text(input.expectedUpdatedAt||input.expected_updated_at);if(!expectedUpdatedAt)fail('Thiếu phiên bản phân quyền. Vui lòng tải lại trước khi ngừng quyền.',409,'CHECKLIST_PERMISSION_STALE');
  if(text(session?.role).toLowerCase()!=='admin'){const current=await supabase.from(TABLE).select('preset_code').eq('id',id).single();if(current.error)throw current.error;if(text(current.data?.preset_code).toUpperCase()==='TRO_LY_GD')fail('Chỉ Admin hệ thống được ngừng quyền Trợ lý Giám đốc.',403,'ASSISTANT_PRESET_ADMIN_ONLY');}
  const a=actor(session),rpc=await supabase.rpc('phf_disable_checklist_permission_grant',{p_grant_id:id,p_reason:reason,p_actor_id:a.id||'',p_actor_name:a.name||'',p_expected_updated_at:expectedUpdatedAt});
  if(rpc.error){const message=String(rpc.error.message||'');if(/CHECKLIST_PERMISSION_STALE/i.test(message))fail('Phân quyền đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi ngừng.',409,'CHECKLIST_PERMISSION_STALE');if(/phf_disable_checklist_permission_grant/i.test(message))fail('Chưa chạy SQL ổn định Production cho phân quyền Checklist.',503,'CHECKLIST_PERMISSION_STABILITY_SQL_MISSING');throw rpc.error;}
  const result=rpc.data||{};if(result.ok!==true)fail(text(result.message)||'Không thể ngừng phân quyền.',409,text(result.code)||'CHECKLIST_PERMISSION_DISABLE_BLOCKED');return {grant:publicGrant(result.grant||{})};
}


module.exports={
  PRESETS,
  CAPABILITY_KEYS,
  listChecklistPermissionGrants,
  saveChecklistPermissionGrants,
  disableChecklistPermissionGrant,
  getChecklistRoleWorkspace,
  getChecklistMonthlyReviewAccess,
  getChecklistReportAccess,
  getChecklistExportAccess,
  activeGrantForSession,
  isChecklistWebOperator,
  requireChecklistWebOperator
};
