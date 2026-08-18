'use strict';
/* PHF AI V2 Batch 2 (2026-08-18) - Money display format regression test.
   Bug: so tien tra ve tu get_employee_income doi khi hien thi khong co dau
   phan cach hang nghin (vd "17000" thay vi "17.000"). Fix o TANG PRESENTATION
   (lib/ai-knl-income-tools.js#formatVnd + field "...Display" moi,
   lib/ai-tool-registry.js#buildStructuredResult dung field Display thay vi
   round2() cho card) - KHONG doi kieu du lieu goc trong lib/knl-foundation.js
   (nguon that van la number nguyen, xem SEC-A cua
   scripts/test-ai-income-competency-tools-2026-08.js van PASS khong doi).

   Chay thu cong: node scripts/test-ai-money-format-2026-08.js */
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

const STATE = {
  knl_permission_grants: [],
  employee_profiles: [
    { employee_id: 'emp-010', employee_code: 'PHF010', full_name: 'Nguyễn Văn A (Huỳnh)', title: 'Nhân viên bán hàng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ],
  knl_employee_compensation_assignments: [
    {
      id: 'comp-010', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
      compensation_grade_id: 'grade-b2',
      // So co chu so lon deliberately (17000/17000000-style) de kiem tra
      // dung DAU CHAM phan cach hang nghin, khong phai dau phay/khong dau.
      structure_snapshot: { gradeCode: 'B2', gradeNumber: 2, ladderCode: 'SALES', ladderName: 'Bán hàng', versionId: 'cv1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 17000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 0 },
      has_professional_allowance: true, has_management_allowance: false, has_meal_allowance: true, meal_allowance: 17000, probation_amount: 170000, extra_allowances: [{ label: 'Phụ cấp xăng xe', amount: 1700000 }], reference_total: 19187000,
      organization_snapshot: {}, updated_at: '2026-08-10'
    }
  ],
  knl_employee_compensation_history: []
};

function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getEmployeeIncomeForAi } = require('../lib/ai-knl-income-tools');
const { buildStructuredResult } = require('../lib/ai-tool-registry');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };

function hasNakedDigitRun(str) {
  // "day so >=5 chu so KHONG co dau cham/phay xen giua" - vd "17000000" la
  // 1 chuoi lien tuc 8 chu so, se khop; "17.000.000" thi KHONG khop vi bi
  // dau cham chia nho.
  return /\d{5,}/.test(str);
}

async function run() {
  const income = await getEmployeeIncomeForAi(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(income.hasCurrentIncome, true);
  const c = income.current;

  // ---- Raw numeric fields GIU NGUYEN (khong doi kieu du lieu nguon) ----
  assert.strictEqual(c.baseSalary, 17000000);
  assert.strictEqual(c.mealAllowance, 17000);
  assert.strictEqual(c.probationAmount, 170000);
  assert.strictEqual(c.extraAllowances[0].amount, 1700000);
  assert.strictEqual(c.totalReferenceIncome, 19187000);
  console.log('[PASS] Raw numeric source giữ nguyên kiểu number, không đổi giá trị/kiểu dữ liệu gốc (baseSalary=17000000 number, không phải chuỗi)');

  // ---- Display fields dung dau CHAM phan cach hang nghin kieu Viet Nam ----
  assert.strictEqual(c.baseSalaryDisplay, '17.000.000 đ', `baseSalaryDisplay phải là "17.000.000 đ", nhận được "${c.baseSalaryDisplay}"`);
  assert.strictEqual(c.mealAllowanceDisplay, '17.000 đ', `mealAllowanceDisplay phải là "17.000 đ" (17000 -> 17.000), nhận được "${c.mealAllowanceDisplay}"`);
  assert.strictEqual(c.probationAmountDisplay, '170.000 đ');
  assert.strictEqual(c.extraAllowances[0].amountDisplay, '1.700.000 đ');
  assert.strictEqual(c.totalReferenceIncomeDisplay, '19.187.000 đ');
  console.log('[PASS] Các field *Display (baseSalaryDisplay/mealAllowanceDisplay/probationAmountDisplay/extraAllowances[].amountDisplay/totalReferenceIncomeDisplay) đúng chuẩn Việt Nam: 17000 -> "17.000 đ", 17000000 -> "17.000.000 đ"');

  // ---- 17000 va 17000000 KHONG duoc xuat hien "tron" (khong dau phan
  // cach) trong bat ky field Display nao - day chinh la bug goc user bao ----
  const allDisplayValues = [c.baseSalaryDisplay, c.hqcvDisplay, c.professionalAllowanceDisplay, c.mealAllowanceDisplay, c.probationAmountDisplay, c.totalReferenceIncomeDisplay, c.extraAllowances[0].amountDisplay];
  allDisplayValues.forEach(v => assert.ok(!hasNakedDigitRun(v), `"${v}" không được chứa dãy ≥5 chữ số liền không dấu phân cách (bug gốc: 17000 hiển thị "17000")`));
  console.log('[PASS] Không có field Display nào hiển thị dạng "17000"/"17000000" trần (không dấu phân cách) - đúng yêu cầu chống bug hiển thị');

  // ---- Field KHONG phai tien KHONG bi format (compensationGradeNumber la
  // so thu tu 1 chu so, khong duoc bien thanh chuoi/them dau cham) ----
  assert.strictEqual(c.compensationGradeNumber, 2);
  assert.strictEqual(typeof c.compensationGradeNumber, 'number');
  assert.strictEqual(c.compensationGradeCode, 'B2', 'mã bậc (B2) không được format như tiền');
  console.log('[PASS] Mã bậc/số bậc (compensationGradeCode/compensationGradeNumber) KHÔNG bị format tiền tệ - chỉ money field mới có "...Display"');

  // ---- Structured card (UI) dung DUNG field Display, khong con round2() so
  // thuan cho tien - mo phong dung field renderer frontend se doc
  // (data.metrics[].value / data.sections[].items[].value) ----
  const card = buildStructuredResult('get_employee_income', income);
  const baseSalaryMetric = card.data.metrics.find(m => m.label === 'Lương cơ bản');
  assert.strictEqual(baseSalaryMetric.value, '17.000.000 đ', `card metric "Lương cơ bản" phải là chuỗi đã format, nhận được ${JSON.stringify(baseSalaryMetric.value)}`);
  const mealItem = card.data.sections[0].items.find(it => it.label === 'Phụ cấp ăn trưa');
  assert.strictEqual(mealItem.value, '17.000 đ');
  const gasItem = card.data.sections[0].items.find(it => it.label === 'Phụ cấp xăng xe');
  assert.strictEqual(gasItem.value, '1.700.000 đ');
  [...card.data.metrics, ...card.data.sections[0].items].forEach(entry => {
    if (typeof entry.value === 'string') assert.ok(!hasNakedDigitRun(entry.value), `card field "${entry.label}"="${entry.value}" không được chứa dãy số trần không dấu phân cách`);
  });
  console.log('[PASS] Structured card get_employee_income (UI) dùng đúng field Display đã format - không còn số tiền trần "17000"/"17000000" trong bất kỳ metric/section item nào');

  console.log('\nALL PASS - test-ai-money-format-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
