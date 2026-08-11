'use strict';
require('dotenv').config();
const lib = require('../lib/knl-competency');

(async () => {
  const self = { employeeId: 'PHF041', role: 'employee' };
  const selfResult = await lib.getKnlEmployeeCompetencyAssignment(self, {});
  console.log('1. Self-view PHF041:', JSON.stringify({ employeeCode: selfResult.employeeCode, status: selfResult.current?.status, gradeCode: selfResult.current?.gradeSnapshot?.gradeCode, frameworkCode: selfResult.current?.gradeSnapshot?.frameworkCode }));

  const admin = { employeeId: 'ADMIN', role: 'admin' };
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
  const noAssignSelf = { employeeId: 'PHF002', role: 'employee' };
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

  console.log('');
  console.log('SMOKE TEST DONE');
})().catch(e => { console.error('SMOKE FAIL', e && e.stack || e); process.exit(1); });
