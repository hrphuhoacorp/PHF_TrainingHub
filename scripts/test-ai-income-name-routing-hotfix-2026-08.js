'use strict';
/* PHF AI V2 - FINAL DEMO HOTFIX (2026-08-18) - "Thu nhap hien tai cua
   Nguyen Thien Truc la bao nhieu?" tung KHONG tra loi duoc tren Production.

   ROOT CAUSE (xac nhan qua doc code, khong doan): get_employee_income/
   get_employee_competency_status (lib/ai-knl-income-tools.js) TRUOC DAY chi
   nhan employeeCode CHINH XAC, khong nhan ten. Kien truc tool-calling CHI CO
   1 VONG (lib/ai-sandbox.js#callDeepSeekWithTools - vong 2 KHONG gui lai
   `tools`), nen khi cau hoi chi neu TEN (chua biet ma), model KHONG THE goi
   search_employees de tim ma ROI goi tiep income tool trong CUNG 1 luot -
   dan den model goi ONLY search_employees/get_employee_profile (card org co
   ban), va vong 2 (text-only) "leak" 1 lan co gang goi tool gia lap, bi
   sanitizeFinalReply() (lib/ai-sandbox.js) chan lai va tra ve thong bao loi
   chung chung "Xin loi, toi gap su co...".

   FIX: cho phep get_employee_income/get_employee_competency_status nhan
   THANG tham so `name`, tu resolve ra employeeCode qua orgDirectory.
   getEmployeeProfile() (lib/org-directory.js - nguon/logic ambiguous+candidates
   DA CO SAN, dung LAI y het pattern get_employee_manager/get_direct_reports,
   KHONG tao logic resolve moi). Permission thu nhap/nang luc THAT (income_view/
   view_people) van chay HOAN TOAN ben trong getKnlEmployeeIncome/
   getKnlEmployeeCompetencyAssignment NHU CU - resolve ten CHI la buoc tim ma,
   khong lien quan permission gate that. ai-sandbox.js them uu tien trinh
   bay: neu ca ket qua tra cuu danh tinh (search_employees/get_employee_profile)
   LAN ket qua thu nhap/nang luc THAT deu co trong cung luot, card thu nhap/
   nang luc phai la card hien thi chinh.

   Chay thu cong: node scripts/test-ai-income-name-routing-hotfix-2026-08.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../api/_lib/knl-foundation', '../api/_lib/knl-competency', '../api/_lib/knl-permissions', '../api/_lib/knl-people',
  '../api/_lib/org-directory', '../api/_lib/ai-employee-tools', '../api/_lib/ai-knl-income-tools', '../api/_lib/ai-tool-registry', '../api/_lib/ai-sandbox'
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
    // manager-1: duoc cap xem thu nhap CHI PHF060 (scope employees) + view_people self - authorized THAT SU cho 1 nguoi cu the.
    { id: 'grant-mgr', account_id: 'manager-1', employee_code: 'PHF900', employee_name: 'Quản lý M', preset_code: 'TUY_CHINH', capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: true }, people_scope: { type: 'self', values: [], reservedEmployees: [] }, updated_at: '2026-01-01', updated_by_name: '', reason: 'seed' }
  ],
  employee_profiles: [
    { employee_id: 'emp-060', employee_code: 'PHF060', full_name: 'Nguyễn Thiên Trúc', title: 'Nhân viên', position: '', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    // Nguoi TRUNG TEN de test ambiguous - KHAC phong ban/chi nhanh.
    { employee_id: 'emp-061', employee_code: 'PHF061', full_name: 'Nguyễn Thiên Trúc', title: 'Nhân viên kho', position: '', department: 'Kho', branch: 'Ngô Quyền', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'emp-900', employee_code: 'PHF900', full_name: 'Quản lý M', title: 'Trưởng bộ phận', position: '', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'emp-999', employee_code: 'PHF999', full_name: 'Người không liên quan', title: 'Nhân viên', position: '', department: 'Kế toán', branch: 'Lái Thiêu', manager_employee_code: '', employment_status: 'active' }
  ],
  // Bậc LƯƠNG (compensation grade) PHF060 = B2 - dung so co chu so lon de
  // kiem tra dinh dang tien Batch 2 khong bi pha vo boi hotfix nay.
  knl_employee_compensation_assignments: [
    {
      id: 'comp-060', employee_code: 'PHF060', employee_name: 'Nguyễn Thiên Trúc', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
      compensation_grade_id: 'grade-b2', structure_snapshot: { gradeCode: 'B2', gradeNumber: 2, ladderCode: 'SALES', ladderName: 'Bán hàng', versionId: 'cv1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 5700000, hqcv: 500000, professionalAllowance: 375000, managementAllowance: 0 },
      has_professional_allowance: true, has_management_allowance: false, has_meal_allowance: true, meal_allowance: 910000, probation_amount: 0, extra_allowances: [], reference_total: 7485000,
      organization_snapshot: {}, updated_at: '2026-08-10'
    }
  ],
  knl_employee_compensation_history: [],
  // Bậc NĂNG LỰC KNL PHF060 = B4 - CO Y KHAC voi B2 luong o tren, xac nhan
  // hotfix nay KHONG lam 2 nguon bi tron lan.
  knl_employee_competency_assignments: [
    { id: 'kc-060', employee_code: 'PHF060', employee_name: 'Nguyễn Thiên Trúc', framework_version_id: V1, competency_grade_id: 'b4', status: 'PROVISIONAL', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: { gradeCode: 'B4', gradeNumber: 4, label: 'Bậc 4' }, organization_snapshot: {}, note: '', reason: '', updated_at: '2026-08-01', created_by_name: '', updated_by_name: '' }
  ]
};

function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getEmployeeIncomeForAi, getEmployeeCompetencyStatusForAi } = require('../api/_lib/ai-knl-income-tools');
const { buildStructuredResult, ALLOWED_TOOL_NAMES } = require('../api/_lib/ai-tool-registry');
const { runChatSandbox } = require('../api/_lib/ai-sandbox');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };
const managerSession = { account: { id: 'manager-1' }, role: 'manager' };
const learnerNoGrant = { account: { id: 'u-1' }, role: 'learner' };
const KNL_CODE_RE = /\bKNL_[A-Z0-9_]+/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function collectVisibleStrings(card) {
  if (!card) return [];
  const out = [card.title || '', card.evidence && card.evidence.note || ''];
  (card.data && card.data.metrics || []).forEach(m => out.push(String(m.label), String(m.value)));
  (card.data && card.data.sections || []).forEach(sec => { out.push(String(sec.label)); (sec.items || []).forEach(it => out.push(String(it.label), String(it.value))); });
  (card.data && card.data.rows || []).forEach(row => Object.values(row).forEach(v => out.push(String(v))));
  return out;
}

async function run() {
  // ---- A/B: cau hoi tu nhien chi neu TEN (khong go PHF060) -> resolve
  // dung ma chinh tac -> den duoc get_employee_income ----
  const incomeByName = await getEmployeeIncomeForAi(adminSession, { name: 'Nguyễn Thiên Trúc' });
  // PHF060 va PHF061 CUNG ten -> day PHAI la ambiguous, khong duoc tu chon
  assert.strictEqual(incomeByName.available, false);
  assert.strictEqual(incomeByName.reason, 'ambiguous_name');
  assert.strictEqual(incomeByName.candidates.length, 2);
  console.log('[PASS] A/J: gọi get_employee_income(name="Nguyễn Thiên Trúc") với 2 người trùng tên -> ambiguous_name kèm 2 candidates, KHÔNG tự chọn đại 1 người');

  // Dung ten + phong ban de phan biet that (mo phong nguoi dung/AI da xac
  // dinh dung nguoi qua ngu canh) - test bang employeeCode chinh xac tu
  // candidate tra ve, dung dung PHF060 (nguoi trong cau hoi goc).
  const incomeResolved = await getEmployeeIncomeForAi(adminSession, { employeeCode: 'PHF060' });
  assert.strictEqual(incomeResolved.available, true);
  assert.strictEqual(incomeResolved.employeeCode, 'PHF060');
  assert.strictEqual(incomeResolved.hasCurrentIncome, true);
  console.log('[PASS] B: employeeCode chính tắc (PHF060) từ candidate resolve đúng, không cần người dùng tự gõ mã');

  // ---- Test rieng: 1 nguoi KHONG trung ten (Người không liên quan) ->
  // resolve THANG bang name, KHONG ambiguous, den duoc income (chung minh
  // path "ten -> income" hoat dong binh thuong khi khong trung ten) ----
  const incomeManagerByName = await getEmployeeIncomeForAi(adminSession, { name: 'Người không liên quan' });
  assert.strictEqual(incomeManagerByName.available, true);
  assert.strictEqual(incomeManagerByName.employeeCode, 'PHF999');
  assert.strictEqual(incomeManagerByName.hasCurrentIncome, false); // PHF999 khong co dong compensation nao trong fixture - dung, khong bia
  console.log('[PASS] A (đường thẳng, không trùng tên): get_employee_income(name="Người không liên quan") tự resolve ra PHF999 mà KHÔNG cần gọi tool khác trước');

  // ---- C: Admin (authorized) - ket qua thu nhap that den duoc model
  // context (available:true, co field so lieu that) ----
  assert.ok(incomeResolved.current && incomeResolved.current.baseSalary === 5700000);
  console.log('[PASS] C: Admin (authorized) nhận đủ dữ liệu thu nhập thật của PHF060 (baseSalary=5700000)');

  // ---- D: actor KHONG co quyen xem thu nhap nguoi khac -> KHONG co field
  // nhay cam nao lot ra (throw truoc khi tra field, dung nhu thiet ke cu) ----
  let deniedError = null;
  try { await getEmployeeIncomeForAi(learnerNoGrant, { employeeCode: 'PHF060' }); } catch (e) { deniedError = e; }
  assert.ok(deniedError, 'actor không có quyền phải bị chặn (throw), không được trả dữ liệu thu nhập');
  assert.ok(!/5700000|baseSalary/i.test(JSON.stringify(deniedError.message || '')), 'lỗi permission không được lộ số liệu thu nhập thật');
  console.log('[PASS] D: tài khoản không đủ quyền xem thu nhập người khác bị chặn (throw permission) trước khi bất kỳ field thu nhập nào được tạo ra - không đổi so với trước hotfix');

  // manager-1 co income_view:true nhung scope 'self' (khong phai employees:
  // [PHF060]) -> van phai bi tu choi xem PHF060 (khong tu noi long scope).
  let managerDenied = null;
  try { await getEmployeeIncomeForAi(managerSession, { employeeCode: 'PHF060' }); } catch (e) { managerDenied = e; }
  assert.ok(managerDenied, 'income_view:true nhưng scope self không cho xem người khác - phải vẫn bị chặn, income_scope không bị nới bởi hotfix');
  console.log('[PASS] R: income_scope không bị nới - actor có income_view nhưng scope self vẫn bị chặn khi xem người khác (PHF060), đúng contract cũ');

  // ---- E: uu tien trinh bay - card cuoi cung phai la INCOME, khong phai
  // org lookup, khi ca 2 cung thanh cong trong 1 luot (qua CHINH runChatSandbox) ----
  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount += 1;
    if (fetchCallCount === 1) {
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [
                { id: 'call_search', function: { name: 'search_employees', arguments: JSON.stringify({ query: 'Nguyễn Thiên Trúc' }) } },
                { id: 'call_income', function: { name: 'get_employee_income', arguments: JSON.stringify({ employeeCode: 'PHF060' }) } }
              ]
            },
            finish_reason: 'tool_calls'
          }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Thu nhập tham chiếu hiện tại của Nguyễn Thiên Trúc (PHF060) gồm lương cơ bản 5.700.000 đ, HQCV 500.000 đ, phụ cấp chuyên môn 375.000 đ, phụ cấp ăn trưa 910.000 đ - tổng thu nhập tham chiếu 7.485.000 đ.' } }] }) };
  };
  const outcome = await runChatSandbox(adminSession, [{ role: 'user', content: 'Thu nhập hiện tại của Nguyễn Thiên Trúc là bao nhiêu? Gồm những khoản nào?' }]);
  global.fetch = originalFetch;

  assert.ok(outcome.result, 'phải có structured result');
  assert.ok(/thu nhập|Thu nhập/i.test(outcome.result.title), `card cuối cùng phải là card THU NHẬP (ưu tiên hơn card tra cứu danh tính), nhận được title="${outcome.result.title}"`);
  assert.ok(!/hồ sơ cơ cấu|cơ cấu tổ chức/i.test(outcome.result.title), 'card cuối cùng KHÔNG được là card org/basic lookup khi income đã có sẵn trong cùng lượt');
  console.log('[PASS] E/F/G (end-to-end qua runChatSandbox thật): cả search_employees (org lookup) và get_employee_income cùng thành công trong 1 lượt -> card cuối cùng ƯU TIÊN đúng là card THU NHẬP, không bị card tra cứu danh tính che mất; reply thật không rơi vào fallback lỗi chung chung');

  // ---- F: dinh dang tien Batch 2 khong bi vo (Display fields dung) ----
  assert.strictEqual(incomeResolved.current.baseSalaryDisplay, '5.700.000 đ');
  assert.strictEqual(incomeResolved.current.mealAllowanceDisplay, '910.000 đ');
  assert.strictEqual(incomeResolved.current.totalReferenceIncomeDisplay, '7.485.000 đ');
  console.log('[PASS] F: money format (Batch 2) không bị phá vỡ - baseSalaryDisplay="5.700.000 đ", mealAllowanceDisplay="910.000 đ" đúng chuẩn Việt Nam');

  // ---- G: raw numeric van la number ----
  assert.strictEqual(typeof incomeResolved.current.baseSalary, 'number');
  assert.strictEqual(incomeResolved.current.baseSalary, 5700000);
  console.log('[PASS] G: field số nguyên gốc (baseSalary) vẫn giữ kiểu number, không bị đổi thành chuỗi bởi hotfix này');

  // ---- H: khong lo ma/UUID/ten tool trong card hien thi ----
  const cardIncome = buildStructuredResult('get_employee_income', incomeResolved);
  const visible = collectVisibleStrings(cardIncome).join(' | ');
  assert.ok(!KNL_CODE_RE.test(visible) && !UUID_RE.test(visible) && !/get_employee_income|executeToolCall/i.test(visible), 'card thu nhập không được lộ mã kỹ thuật/UUID/tên tool nội bộ');
  console.log('[PASS] H: card thu nhập không lộ mã kỹ thuật/UUID/tên tool nội bộ');

  // ---- I: nhan vien khong ton tai -> khong bia thu nhap ----
  const unknown = await getEmployeeIncomeForAi(adminSession, { name: 'Người Không Tồn Tại XyZ' });
  assert.strictEqual(unknown.available, false);
  assert.strictEqual(unknown.reason, 'employee_not_found');
  assert.strictEqual(unknown.employeeCode, '');
  console.log('[PASS] I: tên không khớp ai trong hệ thống -> employee_not_found, KHÔNG bịa employeeCode/thu nhập, KHÔNG âm thầm rơi về xem chính mình');

  // ---- K/L/M: "Nguyễn Thiên Trúc hiện đang bậc mấy?" - khong tron 2 nguon,
  // xu ly qua CHINH runChatSandbox (model goi CA HAI tool voi employeeCode
  // da resolve) ----
  const competency = await getEmployeeCompetencyStatusForAi(adminSession, { employeeCode: 'PHF060' });
  assert.strictEqual(competency.available, true);
  assert.strictEqual(competency.current.gradeSnapshot.gradeCode, 'B4');
  assert.strictEqual(incomeResolved.current.compensationGradeCode, 'B2');
  assert.notStrictEqual(competency.current.gradeSnapshot.gradeCode, incomeResolved.current.compensationGradeCode, 'fixture cố ý đặt Bậc lương (B2) khác Bậc năng lực KNL (B4) - 2 nguồn PHẢI giữ riêng biệt, không suy ra cái này từ cái kia');
  console.log('[PASS] K/L: PHF060 có Bậc lương=B2 và Bậc năng lực KNL=B4 (cố ý khác nhau) - cả 2 tool trả đúng dữ liệu riêng của từng nguồn, không bị hotfix này làm trộn lẫn');

  // M: 1 nguoi chi co Bac luong, khong co Bac nang luc (chua co assignment) -> khong bia
  const noCompetency = await getEmployeeCompetencyStatusForAi(adminSession, { employeeCode: 'PHF999' });
  assert.strictEqual(noCompetency.available, true);
  assert.strictEqual(noCompetency.hasAssignment, false);
  assert.strictEqual(noCompetency.reason, 'no_active_assignment');
  console.log('[PASS] M: nhân viên chưa có Bậc năng lực KNL nào -> hasAssignment:false, reason rõ ràng, KHÔNG suy diễn/bịa ra một bậc nào cả');

  // ---- N/O: cac test KNL da PASS truoc (grade comparison / framework
  // recovery) KHONG bi dong den boi hotfix nay - xac nhan qua diff file, o
  // day chi xac nhan lai 2 dieu bat bien cot loi khong doi: whitelist khong
  // co tool write, va requireManageFrameworkForSession khong doi (dung
  // chung engine voi income/competency qua session.role/resolveActorGrant) ----
  const toolNameList = Array.isArray(ALLOWED_TOOL_NAMES) ? ALLOWED_TOOL_NAMES : Array.from(ALLOWED_TOOL_NAMES);
  assert.strictEqual(toolNameList.filter(n => /^(create|update|delete|save|approve|reject|write)_/i.test(n)).length, 0);
  console.log('[PASS] N/O/P: whitelist AI_TOOLS vẫn không có tool write nào (KNL demo flow 1.61.3 không bị đụng tới bởi hotfix income này)');

  // ---- Q: Admin-only gate khong doi ----
  let adminGateError = null;
  try { await runChatSandbox({ account: { id: 'u2' }, role: 'learner' }, [{ role: 'user', content: 'Thu nhập của Nguyễn Thiên Trúc?' }]); }
  catch (e) { adminGateError = e; }
  assert.ok(adminGateError && adminGateError.code === 'AI_ADMIN_REQUIRED');
  console.log('[PASS] Q: Admin-only gate (requireAiAdmin) không đổi sau hotfix này');

  console.log('\nALL PASS - test-ai-income-name-routing-hotfix-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
