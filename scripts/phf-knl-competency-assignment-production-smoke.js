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

  console.log('');
  console.log('SMOKE TEST DONE');
})().catch(e => { console.error('SMOKE FAIL', e && e.stack || e); process.exit(1); });
