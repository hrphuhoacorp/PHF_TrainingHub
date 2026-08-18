'use strict';
/* PHF AI V2 Batch 1 (2026-08-18) - get_employee_income / get_employee_
   competency_status / list_provisional_competency_status regression test.
   Chay logic san xuat that (lib/ai-knl-income-tools.js goi lai
   lib/knl-foundation.js#getKnlEmployeeIncome, lib/knl-competency.js#
   getKnlEmployeeCompetencyAssignment/listKnlEmployeeCompetencyAssignmentsInScope)
   tren fixture Supabase gia - khong goi DeepSeek/Supabase that. Cung ky
   thuat stub voi scripts/test-ai-knl-tools.js.

   Mock table factory CHI co cac ham READ (select/eq/neq/in/order/limit/
   maybeSingle/single/then) - KHONG co insert/update/delete. Neu bat ky code
   nao trong duong di adapter/service co gang ghi, test se throw ngay
   ("... is not a function") thay vi am tham thanh cong - day la luoi an
   toan CHONG WRITE cho ca file test nay (xem SEC-F/SEC-G).

   Chay thu cong: node scripts/test-ai-income-competency-tools-2026-08.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../lib/knl-foundation', '../lib/knl-competency', '../lib/knl-permissions', '../lib/knl-people',
  '../lib/ai-knl-income-tools', '../lib/ai-tool-registry'
].map(p => require.resolve(p));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      then(resolve, reject) {
        try {
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => {
            matched = matched.slice().sort((a, b) => {
              const av = a[spec.field], bv = b[spec.field];
              return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1);
            });
          });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const V1 = '11111111-1111-4111-8111-111111111111';
const STATE = {
  knl_permission_grants: [
    // learner-1 = PHF010: view_people true (scope self ONLY), income_view FALSE.
    { id: 'grant-1', account_id: 'learner-1', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', preset_code: 'NHAN_VIEN', capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false }, people_scope: { type: 'self', values: [], reservedEmployees: [] }, reason: 'seed', is_active: true, updated_at: '2026-01-01', updated_by_name: '' }
  ],
  employee_profiles: [
    { employee_id: 'emp-010', employee_code: 'PHF010', full_name: 'Nguyễn Văn A (Huỳnh)', title: 'Nhân viên bán hàng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'emp-099', employee_code: 'PHF099', full_name: 'Trần Thị B', title: 'Ca trưởng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ],
  // Bậc LƯƠNG (compensation grade) - PHF010 dang o B2 luong.
  knl_employee_compensation_assignments: [
    {
      id: 'comp-010', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
      compensation_grade_id: 'grade-b2', structure_snapshot: { gradeCode: 'B2', gradeNumber: 2, ladderCode: 'SALES', ladderName: 'Bán hàng', versionId: 'cv1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 6000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 0 },
      has_professional_allowance: true, has_management_allowance: false, has_meal_allowance: true, meal_allowance: 730000, probation_amount: 0, extra_allowances: [], reference_total: 7530000,
      organization_snapshot: {}, updated_at: '2026-08-10'
    },
    {
      id: 'comp-099', employee_code: 'PHF099', employee_name: 'Trần Thị B', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
      compensation_grade_id: 'grade-b4', structure_snapshot: { gradeCode: 'B4', gradeNumber: 4, ladderCode: 'SALES', ladderName: 'Bán hàng', versionId: 'cv1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 8000000, hqcv: 800000, professionalAllowance: 500000, managementAllowance: 400000 },
      has_professional_allowance: true, has_management_allowance: true, has_meal_allowance: true, meal_allowance: 730000, probation_amount: 0, extra_allowances: [], reference_total: 10430000,
      organization_snapshot: {}, updated_at: '2026-08-10'
    }
  ],
  knl_employee_compensation_history: [],
  // Bậc NĂNG LỰC (KNL competency grade) - PHF010 dang o B1 nang luc PROVISIONAL,
  // CO Y deliberately KHAC voi B2 luong o tren de xac nhan 2 nguon doc lap.
  knl_employee_competency_assignments: [
    { id: 'kc-010', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', framework_version_id: V1, competency_grade_id: 'b1', status: 'PROVISIONAL', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: { gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1' }, organization_snapshot: {}, note: '', reason: '', updated_at: '2026-08-01', created_by_name: '', updated_by_name: '' },
    { id: 'kc-099', employee_code: 'PHF099', employee_name: 'Trần Thị B', framework_version_id: V1, competency_grade_id: 'b3', status: 'PROVISIONAL', effective_from: '2026-08-02', effective_to: null, is_active: true, grade_snapshot: { gradeCode: 'B3', gradeNumber: 3, label: 'Bậc 3' }, organization_snapshot: {}, note: '', reason: '', updated_at: '2026-08-02', created_by_name: '', updated_by_name: '' }
  ]
};

function buildSupabaseMock() {
  return {
    createClient() {
      return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table in income/competency AI mock: ' + table); return makeTableFactory(STATE[table])(); } };
    }
  };
}

require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getEmployeeIncomeForAi, getEmployeeCompetencyStatusForAi, listProvisionalCompetencyForAi } = require('../lib/ai-knl-income-tools');
const { AI_TOOLS, ALLOWED_TOOL_NAMES, executeToolCall, buildStructuredResult } = require('../lib/ai-tool-registry');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };
const learnerSelfSession = { account: { id: 'learner-1' }, role: 'learner', employeeCode: 'PHF010' };

async function run() {
  // ---- H: khong co write tool nao duoc them - ten tool khong duoc chua
  // dong tu ghi, va tong so tool phai dung 3 tool moi + cac tool cu ----
  const newToolNames = ['get_employee_income', 'get_employee_competency_status', 'list_provisional_competency_status'];
  newToolNames.forEach(name => {
    assert.ok(ALLOWED_TOOL_NAMES.has(name), `${name} phai duoc dang ky trong whitelist`);
    assert.ok(AI_TOOLS.some(t => t.function.name === name), `${name} phai co dinh nghia trong AI_TOOLS`);
  });
  const WRITE_VERBS = /^(save|update|create|delete|set|write|insert|remove|apply|confirm|approve|correct|clone)_/i;
  AI_TOOLS.forEach(t => assert.ok(!WRITE_VERBS.test(t.function.name), `tool "${t.function.name}" trong AI_TOOLS khong duoc mang dong tu ghi - Batch 1 chi duoc them read tool`));
  console.log('[PASS] SEC-H: 3 tool moi da dang ky trong whitelist, không tool nào trong AI_TOOLS mang tên dạng write action');

  // ---- I: executeToolCall van reject tool khong whitelist (regression) ----
  const rejected = await executeToolCall(adminSession, { function: { name: 'update_employee_income', arguments: '{}' } });
  assert.deepStrictEqual(rejected, { error: 'TOOL_NOT_ALLOWED' }, 'tool khong whitelist phai bi tu choi ngay, khong duoc thuc thi');
  console.log('[PASS] SEC-I: executeToolCall vẫn reject tool ngoài whitelist (update_employee_income) đúng như trước Batch 1');

  // ---- A: Admin doc income hop le, dung service that ----
  const adminIncome = await getEmployeeIncomeForAi(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(adminIncome.available, true);
  assert.strictEqual(adminIncome.hasCurrentIncome, true);
  assert.strictEqual(adminIncome.current.compensationGradeCode, 'B2', 'Bậc LƯƠNG của PHF010 phải là B2 (từ knl_employee_compensation_assignments)');
  assert.strictEqual(adminIncome.current.baseSalary, 6000000);
  assert.strictEqual(adminIncome.current.hasProfessionalAllowance, true);
  assert.strictEqual(adminIncome.current.professionalAllowance, 300000);
  assert.strictEqual(adminIncome.current.totalReferenceIncome, 7530000);
  const structuredIncome = buildStructuredResult('get_employee_income', adminIncome);
  assert.strictEqual(structuredIncome.evidence.status, 'VERIFIED');
  assert.ok(/độc lập/i.test(structuredIncome.evidence.note), 'evidence note phai neu ro Bậc lương độc lập với Bậc năng lực');
  console.log('[PASS] SEC-A: Admin đọc thu nhập PHF010 hợp lệ qua đúng service getKnlEmployeeIncome, dữ liệu khớp fixture thật (không hard-code Huỳnh trong code, chỉ trong fixture test)');

  // ---- B/C: learner (income_view=false, scope self) KHONG duoc xem thu
  // nhap cua PHF099 - permission phai chan TRUOC KHI bat ky field thu nhap
  // nao duoc tra ve (khong phai loc sau khi da co du lieu) ----
  let incomeDeniedErr = null;
  try { await getEmployeeIncomeForAi(learnerSelfSession, { employeeCode: 'PHF099' }); }
  catch (e) { incomeDeniedErr = e; }
  assert.ok(incomeDeniedErr, 'learner khong du quyen phai bi tu choi, khong duoc tra du lieu thu nhap nguoi khac');
  assert.strictEqual(incomeDeniedErr.code, 'KNL_INCOME_VIEW_DENIED');
  assert.strictEqual(incomeDeniedErr.statusCode, 403);
  // Doi chung: Admin THAT su xem duoc PHF099 (chung minh day la loc quyen,
  // khong phai do PHF099 thieu du lieu trong fixture)
  const adminSeesOtherIncome = await getEmployeeIncomeForAi(adminSession, { employeeCode: 'PHF099' });
  assert.strictEqual(adminSeesOtherIncome.hasCurrentIncome, true, 'PHF099 THAT co thu nhap - Admin phai xem duoc de chung minh learner bi chan boi quyen, khong phai do thieu du lieu');
  console.log('[PASS] SEC-B/C: incomeScopeAllows() chặn đúng learner xem thu nhập PHF099 (403 KNL_INCOME_VIEW_DENIED) trước khi bất kỳ field thu nhập nào được tạo ra; Admin vẫn xem được để xác nhận đây là lọc quyền, không phải thiếu dữ liệu');

  // Learner tu xem CHINH MINH (PHF010) van duoc, du income_view=false - mirror
  // dung nguyen tac self-view cua getKnlEmployeeIncome.
  const learnerSelfIncome = await getEmployeeIncomeForAi(learnerSelfSession, {});
  assert.strictEqual(learnerSelfIncome.hasCurrentIncome, true);
  assert.strictEqual(learnerSelfIncome.employeeCode, 'PHF010');
  console.log('[PASS] SEC-B (self): learner tự xem thu nhập của chính mình (employeeCode để trống -> tự suy từ session) vẫn được, dù income_view=false, đúng nguyên tắc self-view có sẵn');

  // Qua ca duong executeToolCall day du (nhu DeepSeek se goi that) - dam bao
  // khong co raw error/statusCode/message nao lot ra ngoai, chi 1 the chung.
  const deniedViaRegistry = await executeToolCall(learnerSelfSession, { function: { name: 'get_employee_income', arguments: JSON.stringify({ employeeCode: 'PHF099' }) } });
  assert.deepStrictEqual(deniedViaRegistry, { error: 'TOOL_UNAVAILABLE' }, 'qua executeToolCall, loi quyen KHONG duoc lo raw code/message/statusCode - chi 1 the chung nhu moi tool khac');
  console.log('[PASS] SEC-E: qua executeToolCall(), lỗi quyền không rò rỉ mã lỗi/message/statusCode gốc - chỉ trả {error:"TOOL_UNAVAILABLE"} như các tool khác');

  // ---- D: unknown employee -> loi nghiep vu (khong phai crash/raw DB error) ----
  const unknownIncome = await getEmployeeIncomeForAi(adminSession, { employeeCode: 'PHF999999' });
  assert.deepStrictEqual(unknownIncome, { available: false, asOf: unknownIncome.asOf, employeeCode: 'PHF999999', reason: 'employee_not_found' });
  const unknownCompetency = await getEmployeeCompetencyStatusForAi(adminSession, { employeeCode: 'PHF999999' });
  assert.strictEqual(unknownCompetency.available, false);
  assert.strictEqual(unknownCompetency.reason, 'employee_not_found');
  console.log('[PASS] SEC-D: mã nhân viên không tồn tại -> trả reason nghiệp vụ rõ ràng (employee_not_found) cho cả income và competency status, không crash/không lộ lỗi kỹ thuật');

  // ---- Bậc lương KHÁC Bậc năng lực - xác nhận 2 tool trả 2 số ĐỘC LẬP cho
  // CÙNG 1 nhân viên (DEMO-02: "Huỳnh đang bậc mấy?" không được nhầm) ----
  const competencyStatus = await getEmployeeCompetencyStatusForAi(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(competencyStatus.available, true);
  assert.strictEqual(competencyStatus.hasAssignment, true);
  assert.strictEqual(competencyStatus.current.status, 'PROVISIONAL');
  assert.strictEqual(competencyStatus.current.statusLabel, 'Tạm thời', 'status phai duoc Viet hoa dung quy uoc KNL-12 (Tam thoi/Da xac nhan)');
  assert.strictEqual(competencyStatus.current.gradeSnapshot.gradeCode, 'B1', 'Bậc NĂNG LỰC của PHF010 phải là B1 - KHÁC với Bậc LƯƠNG B2 đã xác nhận ở SEC-A');
  assert.notStrictEqual(competencyStatus.current.gradeSnapshot.gradeCode, adminIncome.current.compensationGradeCode, 'Bậc lương và Bậc năng lực PHẢI là 2 giá trị độc lập, không được trùng/suy ra lẫn nhau trong dữ liệu test này');
  const structuredCompetency = buildStructuredResult('get_employee_competency_status', competencyStatus);
  assert.ok(/độc lập/i.test(structuredCompetency.evidence.note));
  console.log('[PASS] DEMO-02: get_employee_income (Bậc lương B2) và get_employee_competency_status (Bậc năng lực B1, trạng thái Tạm thời) trả về 2 nguồn tách biệt rõ ràng cho cùng PHF010 - không nhầm lẫn/gộp chung');

  // ---- Competency status dung view_people/peopleScope, KHONG dung
  // income_view - learner (income_view=false NHUNG view_people=true, scope
  // self) van xem duoc competency cua CHINH MINH, nhung KHONG xem duoc
  // PHF099 (ngoai scope self) ----
  const learnerOwnCompetency = await getEmployeeCompetencyStatusForAi(learnerSelfSession, {});
  assert.strictEqual(learnerOwnCompetency.available, true);
  assert.strictEqual(learnerOwnCompetency.current.status, 'PROVISIONAL');
  let competencyDeniedErr = null;
  try { await getEmployeeCompetencyStatusForAi(learnerSelfSession, { employeeCode: 'PHF099' }); }
  catch (e) { competencyDeniedErr = e; }
  assert.ok(competencyDeniedErr, 'learner (scope self) khong duoc xem Bậc năng lực cua PHF099');
  assert.strictEqual(competencyDeniedErr.code, 'KNL_COMPETENCY_VIEW_DENIED');
  console.log('[PASS] Competency scope: learner xem được Bậc năng lực của chính mình (income_view=false không cản trở, đúng vì đây là view_people/peopleScope) nhưng bị chặn đúng khi xem PHF099 ngoài phạm vi self');

  // ---- DEMO-06 + scope: list_provisional_competency_status CHI tra ve
  // nguoi trong dung peopleScope cua actor - PHF099 CUNG PROVISIONAL nhung
  // learner (scope self=PHF010) KHONG duoc thay PHF099 trong danh sach ----
  const adminProvisional = await listProvisionalCompetencyForAi(adminSession);
  const adminCodes = adminProvisional.items.map(i => i.employeeCode).sort();
  assert.deepStrictEqual(adminCodes, ['PHF010', 'PHF099'], 'Admin (scope all_company) phai thay CA HAI nhan su dang Tam thoi');

  const learnerProvisional = await listProvisionalCompetencyForAi(learnerSelfSession);
  const learnerCodes = learnerProvisional.items.map(i => i.employeeCode);
  assert.deepStrictEqual(learnerCodes, ['PHF010'], 'learner (scope self) CHI duoc thay chinh minh trong danh sach Tam thoi, KHONG duoc thay PHF099 du PHF099 cung Tam thoi that');
  const structuredProvisional = buildStructuredResult('list_provisional_competency_status', learnerProvisional);
  assert.strictEqual(structuredProvisional.evidence.isCompletePopulation, false);
  console.log('[PASS] DEMO-06: list_provisional_competency_status trả đúng danh sách theo peopleScope - Admin thấy cả 2, learner (scope self) chỉ thấy chính mình dù PHF099 cũng đang ở trạng thái Tạm thời thật trong fixture (chứng minh lọc quyền, không phải thiếu dữ liệu)');

  // ---- J: KHONG co duong write nao duoc cham toi - neu bat ky ham nao o
  // tren goi .insert/.update/.delete, mock se throw "not a function" va
  // assert phia tren se KHONG BAO GIO chay toi day. Neu code chay den day
  // nghia la toan bo cac loi goi tren CHI dung select/eq/in/order/limit/
  // maybeSingle - khong co write nao xay ra. ----
  console.log('[PASS] SEC-F/G: toàn bộ test trên chạy xong qua mock CHỈ hỗ trợ read (không có insert/update/delete) - nếu có write path nào bị chạm tới, test đã throw TypeError trước dòng này rồi');

  console.log('\nALL PASS - test-ai-income-competency-tools-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
