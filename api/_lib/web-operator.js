'use strict';
const {requireSession,getAccountById}=require('./auth');
const {requireChecklistWebOperator,isChecklistWebOperator}=require('./checklist-permissions');
async function requireWebOperatorSession(req){const session=await requireSession(req,['manager','admin']);await requireChecklistWebOperator(session);return session;}
async function assertAccountMutationAllowed(session,input={},targetId=''){
 if(session.role==='admin')return;
 const role=String(input.role||'').trim().toLowerCase(),type=String(input.accountType||input.account_type||'').trim().toLowerCase();
 if(role==='admin'||type==='system_admin'){const e=new Error('Trợ lý điều hành không được tạo hoặc nâng tài khoản thành Admin hệ thống.');e.statusCode=403;e.code='ADMIN_ACCOUNT_PROTECTED';throw e;}
 if(targetId){const target=await getAccountById(targetId);if(!target){const e=new Error('Không tìm thấy tài khoản cần xử lý.');e.statusCode=404;e.code='ACCOUNT_NOT_FOUND';throw e;}
  if(String(target.role||'').toLowerCase()==='admin'||String(target.accountType||target.metadata?.accountType||'').toLowerCase()==='system_admin'){const e=new Error('Trợ lý điều hành không được sửa tài khoản Admin hệ thống.');e.statusCode=403;e.code='ADMIN_ACCOUNT_PROTECTED';throw e;}
  const ts={role:target.role,sub:target.id,account:target,employeeCode:target.employeeCode,employeeId:target.employeeId,email:target.email};if(await isChecklistWebOperator(ts)){const e=new Error('Chỉ Admin hệ thống được sửa tài khoản Trợ lý Giám đốc – Điều hành web.');e.statusCode=403;e.code='ASSISTANT_ACCOUNT_PROTECTED';throw e;}
 }
}
module.exports={requireWebOperatorSession,assertAccountMutationAllowed};
