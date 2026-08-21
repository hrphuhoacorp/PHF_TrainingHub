'use strict';

require('dotenv').config();
const assert=require('assert');
const {listKnlIncomeTargets,getKnlEmployeeIncome,incomeScopeAllows}=require('../api/_lib/knl-foundation');

(async()=>{
  const own=await getKnlEmployeeIncome({role:'employee',sub:'PHF091',account:{id:'PHF091',employeeCode:'PHF091',name:'Phan Thị Cẩm Tiên'}},{});
  assert.strictEqual(own.employeeCode,'PHF091');assert.strictEqual(own.current.employmentType,'PROBATION');
  assert.strictEqual(own.current.probationAmount,6800000);assert.strictEqual(own.current.gradeId,'');assert.strictEqual(own.current.totalReferenceIncome,6800000);
  const admin=await getKnlEmployeeIncome({role:'admin',sub:'foundation-admin-verify',account:{id:'foundation-admin-verify',employeeCode:'ADMIN',name:'Foundation Admin Verify'}},{employeeCode:'PHF092'});
  assert.strictEqual(admin.employeeCode,'PHF092');assert.strictEqual(admin.current.employmentType,'PROBATION');assert.strictEqual(admin.current.probationAmount,6800000);
  const picker=await listKnlIncomeTargets({role:'admin',sub:'foundation-admin-verify',account:{id:'foundation-admin-verify',name:'Foundation Admin Verify'}});
  assert.strictEqual(picker.canSelectOthers,true);assert(picker.people.some(person=>person.employeeCode==='PHF091'));assert(picker.people.some(person=>person.employeeCode==='PHF092'));
  const scoped={source:'grant',capabilities:{income_view:true},row:{capabilities:{incomeScope:{type:'employees',values:['PHF091']}}}};
  assert.strictEqual(incomeScopeAllows(scoped,'PHF091'),true);assert.strictEqual(incomeScopeAllows(scoped,'PHF092'),false);
  assert.strictEqual(incomeScopeAllows({source:'grant',capabilities:{income_view:false},row:{capabilities:{incomeScope:{type:'all_company',values:[]}}}},'PHF091'),false);
  assert.strictEqual(incomeScopeAllows({source:'admin_recovery'},'PHF092'),true);
  console.log('PASS Production income access: own PHF091, Admin picker/profile PHF092, income_view fail-closed and employee incomeScope allow/deny.');
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
