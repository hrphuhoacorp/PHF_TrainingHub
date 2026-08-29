'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const lib = require('../api/_lib/knl-competency');

const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
require('../api/_lib/env-identity-guard').logSupabaseIdentityOnce('(scripts/phf-knl-competency-assignment-production-smoke.js)');

/* Session PHẢI khớp đúng shape thật trả về từ lib/auth.js readSession():
 * session.employeeId = internal linked-employee id (vd "emp-phf041"/"hv-xxxx",
 * KHÁC employeeCode), session.account.employeeCode = mã hiển thị ("PHF041").
 * Dùng account thật từ user_accounts, KHÔNG tự chế employeeId = code (đó chính
 * là lỗi từng che giấu bug self-view 2026-08-11 — session.employeeId trùng
 * employeeCode chỉ vì test tự gán sai, không phản ánh session thật). */
async function realSession(employeeCode, roleOverride) {
  const { data, error } = await db.from('user_accounts').select('id,employee_id,employee_code,name,role').eq('employee_code', employeeCode).single();
  if (error) throw error;
  return { role: roleOverride || data.role, employeeId: data.employee_id, account: { id: data.id, employeeCode: data.employee_code, name: data.name } };
}

(async () => {
  const self = await realSession('PHF041');
  console.log('   (session thật PHF041: employeeId=' + self.employeeId + ' <> account.employeeCode=' + self.account.employeeCode + ')');
  const selfResult = await lib.getKnlEmployeeCompetencyAssignment(self, {});
  console.log('1. Self-view PHF041:', JSON.stringify({ employeeCode: selfResult.employeeCode, status: selfResult.current?.status, gradeCode: selfResult.current?.gradeSnapshot?.gradeCode, frameworkCode: selfResult.current?.gradeSnapshot?.frameworkCode }));

  const admin = { role: 'admin', employeeId: 'admin-account', account: { id: 'acct-admin', employeeCode: '', name: 'Admin' } };
  const adminViewResult = await lib.getKnlEmployeeCompetencyAssignment(admin, { employeeCode: 'PHF051' });
  console.log('2. Admin view PHF051:', JSON.stringify({ employeeCode: adminViewResult.employeeCode, status: adminViewResult.current?.status, gradeCode: adminViewResult.current?.gradeSnapshot?.gradeCode }));

  try {
    await lib.getKnlEmployeeCompetencyAssignment(self, { employeeCode: 'PHF028' });
    console.log('3. Non-authorized view PHF028 by PHF041: UNEXPECTED SUCCESS (should have been denied)');
  } catch (e) {
    console.log('3. Non-authorized view PHF028 by PHF041: DENIED as expected —', e.code, '-', e.message);
  }

  const hist = await lib.listKnlEmployeeCompetencyHistory(self, {});
  console.log('4. Self history PHF041 periods count:', hist.periods.length);

  try {
    await lib.setKnlEmployeeCompetencyAssignment(self, { employeeCode: 'PHF041', frameworkVersionId: 'x', competencyGradeId: 'x', status: 'PROVISIONAL', effectiveFrom: '2026-08-01', note: 'test', reason: 'test' });
    console.log('5. Non-admin write: UNEXPECTED SUCCESS (should have been denied)');
  } catch (e) {
    console.log('5. Non-admin write: DENIED as expected —', e.code, '-', e.message);
  }

  // getKnlEmployeeCompetencyStandard — self, có assignment (PHF041, Sales B3, framework có B1-B5)
  const standardSelf = await lib.getKnlEmployeeCompetencyStandard(self, {});
  console.log('6. Standard self PHF041:', JSON.stringify({ hasAssignment: standardSelf.hasAssignment, framework: standardSelf.framework?.code, currentGrade: standardSelf.currentGrade?.code, nextGrade: standardSelf.nextGrade?.code, isMaxGrade: standardSelf.isMaxGrade, currentItemCount: standardSelf.currentStandard?.groups?.reduce((n, g) => n + g.items.length, 0), nextItemCount: standardSelf.nextStandard?.groups?.reduce((n, g) => n + g.items.length, 0) }));

  // Standard — self, KHÔNG có assignment (PHF002 Giám đốc, đã biết không có assignment thật trên Production)
  const noAssignSelf = await realSession('PHF002');
  const standardNoAssign = await lib.getKnlEmployeeCompetencyStandard(noAssignSelf, {});
  console.log('7. Standard self PHF002 (không có assignment):', JSON.stringify({ hasAssignment: standardNoAssign.hasAssignment, currentGrade: standardNoAssign.currentGrade, framework: standardNoAssign.framework }));

  // Standard — client cố truyền frameworkVersionId/gradeId khác -> phải bị lờ đi
  const hijackAttempt = await lib.getKnlEmployeeCompetencyStandard(self, { frameworkVersionId: '00000000-0000-4000-8000-000000000000', competencyGradeId: '00000000-0000-4000-8000-000000000000' });
  console.log('8. Hijack attempt (frameworkVersionId/gradeId giả) bị lờ đi:', JSON.stringify({ currentGrade: hijackAttempt.currentGrade?.code, framework: hijackAttempt.framework?.code }), hijackAttempt.currentGrade?.code === 'B3' ? '— OK, vẫn trả đúng assignment thật' : '— MISMATCH!');

  // Standard — non-authorized xem người khác
  try {
    await lib.getKnlEmployeeCompetencyStandard(self, { employeeCode: 'PHF028' });
    console.log('9. Standard non-authorized view PHF028 by PHF041: UNEXPECTED SUCCESS (should have been denied)');
  } catch (e) {
    console.log('9. Standard non-authorized view PHF028 by PHF041: DENIED as expected —', e.code, '-', e.message);
  }

  // Standard — admin (authorized qua full-company grant) xem người khác
  const standardAdminView = await lib.getKnlEmployeeCompetencyStandard(admin, { employeeCode: 'PHF051' });
  console.log('10. Standard admin view PHF051:', JSON.stringify({ hasAssignment: standardAdminView.hasAssignment, currentGrade: standardAdminView.currentGrade?.code, isMaxGrade: standardAdminView.isMaxGrade }));

  // 11. Regression guard cho đúng bug đã fix 2026-08-11: PHF012 self-view (session.employeeId
  // = internal id KHÁC account.employeeCode) phải trả đúng B3, không được hasAssignment=false.
  const phf012 = await realSession('PHF012');
  const phf012Result = await lib.getKnlEmployeeCompetencyStandard(phf012, {});
  const phf012Ok = phf012Result.hasAssignment === true && phf012Result.currentGrade?.code === 'B3' && phf012Result.framework?.code === 'KNL_TP_HCNS_PHF_1063C7';
  console.log('11. REGRESSION GUARD — PHF012 self-view (employeeId=' + phf012.employeeId + ' <> employeeCode=PHF012):', JSON.stringify({ hasAssignment: phf012Result.hasAssignment, currentGrade: phf012Result.currentGrade?.code, framework: phf012Result.framework?.code }), phf012Ok ? '— OK' : '— FAIL, bug tái diễn!');
  if (!phf012Ok) process.exitCode = 1;

  // 12. allGrades — PHF012 (current B3, framework có B1-B5) phải trả đủ chuỗi B1..B5, không chỉ forward
  const phf012Standard = await lib.getKnlEmployeeCompetencyStandard(phf012, {});
  const allGradesOk = Array.isArray(phf012Standard.allGrades) && phf012Standard.allGrades.map(g => g.code).join(',') === 'B1,B2,B3,B4,B5';
  console.log('12. allGrades PHF012 (current B3):', JSON.stringify(phf012Standard.allGrades.map(g => g.code)), allGradesOk ? '— OK' : '— MISMATCH!');

  // 13. getKnlEmployeeCompetencyGradeStandard — self lấy đúng B5 (bậc xa hơn), tự resolve version từ assignment
  const g5 = await lib.getKnlEmployeeCompetencyGradeStandard(phf012, { gradeCode: 'B5' });
  console.log('13. Grade standard B5 cho PHF012:', JSON.stringify({ grade: g5.grade, itemCount: g5.standard.groups.reduce((n, g) => n + g.items.length, 0) }));

  // 14. Bậc không thuộc version của nhân sự -> từ chối, không invent
  try {
    await lib.getKnlEmployeeCompetencyGradeStandard(phf012, { gradeCode: 'B99' });
    console.log('14. B99 UNEXPECTED SUCCESS (should have been rejected)');
  } catch (e) {
    console.log('14. B99 correctly rejected —', e.code, '-', e.message);
  }

  // 15. Non-authorized xem "bậc xa hơn" của người khác vẫn bị chặn đúng permission
  try {
    await lib.getKnlEmployeeCompetencyGradeStandard(self, { employeeCode: 'PHF028', gradeCode: 'B4' });
    console.log('15. Non-authorized grade-standard view PHF028 by PHF041: UNEXPECTED SUCCESS');
  } catch (e) {
    console.log('15. Non-authorized grade-standard view PHF028 by PHF041: DENIED as expected —', e.code, '-', e.message);
  }

  // 16. History period actor field mới (updatedByName/createdByName) — không invent, đọc thẳng từ DB
  const phf012History = await lib.listKnlEmployeeCompetencyHistory(phf012, {});
  console.log('16. History PHF012 actor field:', JSON.stringify(phf012History.periods.map(p => ({ status: p.status, updatedByName: p.updatedByName }))));

  console.log('');
  console.log('SMOKE TEST DONE');
})().catch(e => { console.error('SMOKE FAIL', e && e.stack || e); process.exit(1); });
