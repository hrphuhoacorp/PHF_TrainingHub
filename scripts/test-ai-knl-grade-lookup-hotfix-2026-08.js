'use strict';
/* PHF AI V2 - HOTFIX (2026-08-18) - "B3 khac B2 o dau?" khong tra loi duoc.
   Root cause: get_knl_grade_requirements/get_knl_framework resolve bo KNL
   qua frameworkCode HOAC employeeCode(self) HOAC title/department - khi cau
   hoi KHONG neu ten bo KNL va tai khoan dang hoi (Admin qua admin_recovery)
   KHONG co employeeCode/assignment de tu suy, ca 3 duong deu that bai ->
   tra ve available:false reason:'not_found' CUT, khong co gi de model hoi
   lai -> AI "khong tra loi duoc". Fix GENERIC (khong hard-code B2/B3): khi
   khong resolve duoc, tra kem availableFrameworks (code+name, du lieu dinh
   nghia da duoc phep doc qua listKnlFrameworks() - KHONG mo quyen moi) de
   vong tra loi thu 2 co the hoi lai nguoi dung ro rang.

   Chay thu cong: node scripts/test-ai-knl-grade-lookup-hotfix-2026-08.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../lib/knl-permissions', '../lib/knl-frameworks', '../lib/knl-foundation', '../lib/knl-assignments',
  '../lib/knl-surveys', '../lib/knl-people', '../lib/ai-knl-framework-tools', '../lib/ai-tool-registry'
].map(p => require.resolve(p));

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
const queriedTables = [];
function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], singleMode = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit() { return q; },
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
  knl_permission_grants: [],
  knl_frameworks: [
    { id: 'fw-sales', code: 'SALES', name: 'Bán hàng', description: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'fw-ops', code: 'OPS', name: 'Vận hành kho', description: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'fw-legacy', code: 'SALES_OLD', name: 'Bán hàng (legacy)', description: '', status: 'inactive', created_at: '2025-01-01', updated_at: '2025-01-01' }
  ],
  knl_framework_versions: [
    { id: V1, framework_id: 'fw-sales', version_number: 1, name: 'Bán hàng v1', description: '', status: 'published', is_locked: true, locked_reason: '', based_on_version_id: '', published_at: '2026-01-01', lifecycle_status: 'ACTIVE', effective_from: '', effective_to: '', activated_at: '', updated_at: '2026-01-01' }
  ],
  knl_competency_groups: [{ id: 'g1', version_id: V1, name: 'Kỹ năng bán hàng', description: '', sort_order: 1, is_active: true }],
  knl_competency_items: [{ id: 'i1', version_id: V1, group_id: 'g1', name: 'Tư vấn khách hàng', description: '', sort_order: 1, is_active: true }],
  knl_structure_columns: [
    { id: 'c1', version_id: V1, column_type: 'level', label: 'M1', level_number: 1, sort_order: 1, is_active: true },
    { id: 'c2', version_id: V1, column_type: 'level', label: 'M2', level_number: 2, sort_order: 2, is_active: true }
  ],
  knl_item_level_contents: [{ id: 'lc1', item_id: 'i1', column_id: 'c1', content: 'Tư vấn cơ bản' }, { id: 'lc2', item_id: 'i1', column_id: 'c2', content: 'Tư vấn nâng cao' }],
  knl_grade_definitions: [
    { id: 'grade-b1', version_id: V1, grade_code: 'B1', grade_number: 1, label: 'Bậc 1', sort_order: 1 },
    { id: 'grade-b2', version_id: V1, grade_code: 'B2', grade_number: 2, label: 'Bậc 2', sort_order: 2 },
    { id: 'grade-b3', version_id: V1, grade_code: 'B3', grade_number: 3, label: 'Bậc 3', sort_order: 3 },
    { id: 'grade-b4', version_id: V1, grade_code: 'B4', grade_number: 4, label: 'Bậc 4', sort_order: 4 }
  ],
  knl_grade_requirements: [
    { version_id: V1, item_id: 'i1', grade_id: 'grade-b1', required_column_id: 'c1', required_level_number: 1 },
    { version_id: V1, item_id: 'i1', grade_id: 'grade-b2', required_column_id: 'c1', required_level_number: 1 },
    { version_id: V1, item_id: 'i1', grade_id: 'grade-b3', required_column_id: 'c2', required_level_number: 2 },
    { version_id: V1, item_id: 'i1', grade_id: 'grade-b4', required_column_id: 'c2', required_level_number: 2 }
  ],
  knl_framework_assignments: [],
  employee_profiles: []
};

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          queriedTables.push(table);
          if (!(table in STATE)) throw new Error('Unexpected table: ' + table);
          return makeTableFactory(STATE[table])();
        }
      };
    }
  };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getKnlGradeRequirementsForAi, getKnlFrameworkForAi } = require('../lib/ai-knl-framework-tools');
const { buildStructuredResult, ALLOWED_TOOL_NAMES } = require('../lib/ai-tool-registry');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' }; // KHONG co employeeCode - dung mo phong tai khoan Admin/demo that
const learnerNoGrant = { account: { id: 'u-1' }, role: 'learner' };

async function run() {
  // ---- 1. Cau hoi khong neu ten bo KNL, tai khoan khong co employeeCode:
  // truoc fix se "cut" o day - gio phai tra ve availableFrameworks ----
  const r1 = await getKnlGradeRequirementsForAi(adminSession, { gradeCode: 'B2' });
  assert.strictEqual(r1.available, false);
  assert.strictEqual(r1.reason, 'not_found');
  assert.ok(Array.isArray(r1.availableFrameworks) && r1.availableFrameworks.length >= 2, 'phải trả kèm danh sách bộ KNL đang active để model hỏi lại');
  assert.ok(r1.availableFrameworks.some(f => f.code === 'SALES'), 'phải có bộ KNL active thật (SALES)');
  assert.ok(!r1.availableFrameworks.some(f => f.code === 'SALES_OLD'), 'KHÔNG được gợi ý bộ KNL đã inactive');
  console.log('[PASS] Câu hỏi không nêu tên bộ KNL + tài khoản không tự suy được -> trả kèm availableFrameworks (không còn "cụt")');

  // ---- 2. Card UI (buildStructuredResult) phai hien thi danh sach nay cho
  // model thay trong evidence/section ----
  const card1 = buildStructuredResult('get_knl_grade_requirements', r1);
  assert.ok(card1.evidence.note.includes('Bán hàng'), 'evidence phải liệt kê tên bộ KNL để model hỏi lại người dùng');
  assert.strictEqual(card1.data.sections[0].label, 'Các bộ KNL hiện có');
  console.log('[PASS] Structured card not_found chứa evidence + section liệt kê tên bộ KNL hiện có');

  // ---- 3. Cung tinh huong cho get_knl_framework (dung chung logic resolve) ----
  const rFw = await getKnlFrameworkForAi(adminSession, {});
  assert.strictEqual(rFw.available, false);
  assert.ok(Array.isArray(rFw.availableFrameworks) && rFw.availableFrameworks.length >= 2);
  console.log('[PASS] get_knl_framework cũng trả kèm availableFrameworks khi không tự resolve được (cùng root cause)');

  // ---- 4. Khi CO frameworkCode ro rang: "B3 khac B2 o dau" resolve DUNG,
  // tra ve ca 2 bac - CHUNG MINH generic, khong hard-code rieng B2/B3 ----
  const b2 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Bán hàng', gradeCode: 'B2' });
  const b3 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Bán hàng', gradeCode: 'B3' });
  assert.strictEqual(b2.available, true); assert.strictEqual(b2.grade.gradeCode, 'B2'); assert.ok(b2.requirementCount > 0);
  assert.strictEqual(b3.available, true); assert.strictEqual(b3.grade.gradeCode, 'B3'); assert.ok(b3.requirementCount > 0);
  console.log('[PASS] Có frameworkCode -> resolve đúng B2 và B3 (dữ liệu khác nhau, chứng minh tool hoạt động đúng khi có đủ điều kiện)');

  // ---- 5. Generic cho cac cap bac khac (KHONG hard-code B2/B3) ----
  const b1 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'SALES', gradeCode: 'B1' });
  const b4 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'SALES', gradeCode: 'B4' });
  assert.strictEqual(b1.available, true); assert.strictEqual(b1.grade.gradeCode, 'B1');
  assert.strictEqual(b4.available, true); assert.strictEqual(b4.grade.gradeCode, 'B4');
  console.log('[PASS] Generic cho B1/B4 (không riêng B2/B3) - đúng yêu cầu không hard-code theo demo query cụ thể');

  // ---- 6. KHONG co tool ghi (write) nao duoc dung trong luong nay ----
  const toolNameList = Array.isArray(ALLOWED_TOOL_NAMES) ? ALLOWED_TOOL_NAMES : Array.from(ALLOWED_TOOL_NAMES);
  const writeVerbTools = toolNameList.filter(n => /^(create|update|delete|save|approve|reject|write)_/i.test(n));
  assert.strictEqual(writeVerbTools.length, 0, 'KHÔNG được có tool write nào trong whitelist');
  console.log('[PASS] Whitelist tool AI vẫn không có tool ghi/write nào (Admin-only, read-only giữ nguyên)');

  // ---- 7. KHONG dung du lieu ca nhan (employee_profiles) trong toan bo
  // luong tra cuu dinh nghia bo KNL/bac - chi doc bang catalog/dinh nghia ----
  assert.ok(!queriedTables.includes('employee_profiles'), 'get_knl_grade_requirements/get_knl_framework KHÔNG được đọc employee_profiles khi tra cứu định nghĩa bậc/bộ KNL chung');
  console.log('[PASS] Không truy vấn employee_profiles/dữ liệu cá nhân trong luồng tra cứu định nghĩa bậc (đúng phạm vi knowledge-read)');

  // ---- 8. Admin gate khong doi: tai khoan khong co grant van bi chan dung
  // nhu truoc (requireManageFrameworkForSession) ----
  await assert.rejects(
    () => getKnlGradeRequirementsForAi(learnerNoGrant, { frameworkCode: 'Bán hàng', gradeCode: 'B2' }),
    err => err && err.code === 'KNL_MANAGE_FRAMEWORK_REQUIRED',
    'tài khoản không có quyền quản lý cấu trúc KNL vẫn phải bị chặn - hotfix KHÔNG nới quyền'
  );
  console.log('[PASS] Permission gate (requireManageFrameworkForSession) không đổi - hotfix không nới quyền, không mở role mới');

  console.log('\nALL PASS - test-ai-knl-grade-lookup-hotfix-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
