'use strict';
/* PHF AI Sandbox - Batch 2 KNL Intelligence regression test.
   Chay logic san xuat that (lib/ai-knl-framework-tools.js goi lai
   lib/knl-frameworks.js, lib/knl-foundation.js, lib/knl-assignments.js,
   lib/knl-surveys.js, lib/knl-permissions.js) tren fixture Supabase gia -
   khong goi DeepSeek/Supabase that. Cung ky thuat stub voi
   scripts/test-knl-permissions-scope.js (patch require.cache cho
   @supabase/supabase-js truoc khi require cac lib KNL).

   Chay thu cong: node scripts/test-ai-knl-tools.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../lib/knl-frameworks', '../lib/knl-foundation', '../lib/knl-assignments',
  '../lib/knl-surveys', '../lib/knl-permissions', '../lib/knl-people',
  '../lib/ai-knl-framework-tools', '../lib/ai-tool-registry'
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
  knl_frameworks: [
    { id: 'fw-sales', code: 'SALES', name: 'Bán hàng', description: '', status: 'published', created_at: '2026-01-01', updated_at: '2026-01-01' },
    // Framework legacy CUNG TEN (KNL cleanup: v1 bi danh dau inactive nhung
    // van giu display name giong ban chinh) - updated_at co tinh COV MOI HON
    // ban active de xac nhan filter status, KHONG PHAI thu tu updated_at, la
    // thu quyet dinh ket qua (xem test T2b duoi).
    { id: 'fw-sales-legacy', code: 'SALES_LEGACY_V1', name: 'Bán hàng', description: '', status: 'inactive', created_at: '2025-01-01', updated_at: '2026-06-01' }
  ],
  knl_framework_versions: [{ id: V1, framework_id: 'fw-sales', version_number: 1, name: 'Version 1', description: '', status: 'published', is_locked: true, locked_reason: '', based_on_version_id: '', published_at: '2026-01-02', lifecycle_status: 'PUBLISHED', effective_from: '', effective_to: '', activated_at: '', updated_at: '2026-01-02' }],
  knl_competency_groups: [
    { id: 'g1', version_id: V1, name: 'Kỹ năng bán hàng', description: '', sort_order: 1, is_active: true },
    { id: 'g2', version_id: V1, name: 'Thái độ', description: '', sort_order: 2, is_active: true }
  ],
  knl_competency_items: [
    { id: 'i1', version_id: V1, group_id: 'g1', name: 'Tư vấn khách hàng', description: 'Khả năng tư vấn đúng nhu cầu', sort_order: 1, is_active: true },
    { id: 'i2', version_id: V1, group_id: 'g1', name: 'Xử lý từ chối', description: '', sort_order: 2, is_active: true },
    { id: 'i3', version_id: V1, group_id: 'g2', name: 'Tinh thần trách nhiệm', description: '', sort_order: 1, is_active: true }
  ],
  knl_structure_columns: [
    { id: 'c1', version_id: V1, column_type: 'level', label: 'M1 - Cơ bản', level_number: 1, sort_order: 1, is_active: true },
    { id: 'c2', version_id: V1, column_type: 'level', label: 'M2 - Thành thạo', level_number: 2, sort_order: 2, is_active: true },
    { id: 'c3', version_id: V1, column_type: 'level', label: 'M3 - Xuất sắc', level_number: 3, sort_order: 3, is_active: true }
  ],
  knl_item_level_contents: [
    { id: 'lc1', version_id: V1, item_id: 'i1', column_id: 'c2', content: 'Tư vấn đúng nhu cầu khách hàng, chốt được đơn hàng cơ bản.' },
    { id: 'lc2', version_id: V1, item_id: 'i2', column_id: 'c2', content: 'Xử lý được từ chối thường gặp, giữ được thiện cảm khách hàng.' },
    { id: 'lc3', version_id: V1, item_id: 'i3', column_id: 'c3', content: 'Chủ động nhận việc khó, không cần nhắc nhở.' }
  ],
  knl_grade_definitions: [
    { id: 'b1', version_id: V1, grade_code: 'B1', grade_number: 1, label: 'Bậc 1 - Thử việc', sort_order: 1 },
    { id: 'b2', version_id: V1, grade_code: 'B2', grade_number: 2, label: 'Bậc 2 - Chính thức', sort_order: 2 },
    { id: 'b3', version_id: V1, grade_code: 'B3', grade_number: 3, label: 'Bậc 3 - Thành thạo', sort_order: 3 }
  ],
  knl_grade_requirements: [
    { item_id: 'i1', grade_id: 'b3', version_id: V1, required_column_id: 'c2', required_level_number: 2 },
    { item_id: 'i2', grade_id: 'b3', version_id: V1, required_column_id: 'c2', required_level_number: 2 },
    { item_id: 'i3', grade_id: 'b3', version_id: V1, required_column_id: 'c3', required_level_number: 3 }
  ],
  knl_framework_assignments: [
    { id: 'asg-emp', assignment_key: 'k1', version_id: V1, target_type: 'employee', target_ref: 'PHF010', employee_code: 'PHF010', position_ref: null, organization_snapshot: { employeeCode: 'PHF010' }, is_primary: true, status: 'active', updated_at: '2026-01-03' },
    { id: 'asg-pos', assignment_key: 'k2', version_id: V1, target_type: 'position', target_ref: 'pos-castruong', employee_code: null, position_ref: 'pos-castruong', organization_snapshot: { title: 'Ca trưởng', department: 'Bán hàng', branch: 'Phú Lợi' }, is_primary: true, status: 'active', updated_at: '2026-01-03' }
  ],
  knl_survey_campaigns: [
    { id: 'camp1', name: 'Đợt khảo sát 1', description: '', status: 'CLOSED', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-10T00:00:00Z', opened_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-10T00:00:00Z', created_at: '2026-01-01', updated_at: '2026-01-10' }
  ],
  knl_survey_tickets: [
    { id: '22222222-2222-4222-8222-222222222222', campaign_id: 'camp1', version_id: V1, employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', organization_snapshot: { department: 'Bán hàng', branch: 'Phú Lợi', employee_code: 'PHF010' }, framework_snapshot: { frameworkName: 'Bán hàng', versionNumber: 1 }, status: 'SUBMITTED', general_feedback: '', revision: 1, submitted_at: '2026-01-05T00:00:00Z', last_submitted_at: '2026-01-05T00:00:00Z', created_at: '2026-01-02', updated_at: '2026-01-05' },
    { id: '33333333-3333-4333-8333-333333333333', campaign_id: 'camp1', version_id: V1, employee_code: 'PHF099', employee_name: 'Trần Thị B', organization_snapshot: { department: 'Bán hàng', branch: 'Phú Lợi', employee_code: 'PHF099' }, framework_snapshot: { frameworkName: 'Bán hàng', versionNumber: 1 }, status: 'SUBMITTED', general_feedback: '', revision: 1, submitted_at: '2026-01-06T00:00:00Z', last_submitted_at: '2026-01-06T00:00:00Z', created_at: '2026-01-02', updated_at: '2026-01-06' }
  ],
  knl_survey_responses: [
    { id: 'r1', ticket_id: '22222222-2222-4222-8222-222222222222', item_id: 'i1', selected_column_id: 'c1', selected_level_number: 1, suitability: 'SUITABLE', comment: '' },
    { id: 'r2', ticket_id: '22222222-2222-4222-8222-222222222222', item_id: 'i2', selected_column_id: 'c1', selected_level_number: 1, suitability: 'UNCLEAR', comment: 'cần luyện thêm' },
    { id: 'r3', ticket_id: '22222222-2222-4222-8222-222222222222', item_id: 'i3', selected_column_id: 'c2', selected_level_number: 2, suitability: 'SUITABLE', comment: '' }
  ],
  knl_survey_submission_history: [],
  knl_permission_grants: [
    { id: 'grant-1', account_id: 'learner-1', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', preset_code: 'NHAN_VIEN', capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false }, people_scope: { type: 'self', values: [], reservedEmployees: [] }, reason: 'seed', is_active: true, updated_at: '2026-01-01', updated_by_name: '' }
  ],
  employee_profiles: [
    { employee_id: 'emp-010', employee_code: 'PHF010', full_name: 'Nguyễn Văn A', title: 'Nhân viên bán hàng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'emp-099', employee_code: 'PHF099', full_name: 'Trần Thị B', title: 'Ca trưởng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ]
};

function buildSupabaseMock() {
  return {
    createClient() {
      return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table in KNL AI mock: ' + table); return makeTableFactory(STATE[table])(); } };
    }
  };
}

require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getKnlFrameworkForAi, getKnlGradeRequirementsForAi, getEmployeeKnlAssignmentForAi, getEmployeeKnlAssessmentForAi } = require('../lib/ai-knl-framework-tools');
const { buildStructuredResult } = require('../lib/ai-tool-registry');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };
const learnerSelfSession = { account: { id: 'learner-1' }, role: 'learner', employeeCode: 'PHF010' };

async function run() {
  // ---- T1: framework theo frameworkCode (Admin) ----
  const fw = await getKnlFrameworkForAi(adminSession, { frameworkCode: 'Bán hàng' });
  assert.strictEqual(fw.available, true, 'framework phai available');
  assert.strictEqual(fw.framework.code, 'SALES');
  assert.strictEqual(fw.groups.length, 2, 'phai co 2 nhom nang luc');
  const totalItems = fw.groups.reduce((n, g) => n + g.items.length, 0);
  assert.strictEqual(totalItems, 3, 'phai co 3 hang muc');
  assert.strictEqual(fw.levels.length, 3, 'phai co 3 muc nang luc M1-M3');
  const structuredFw = buildStructuredResult('get_knl_framework', fw);
  assert.strictEqual(structuredFw.evidence.status, 'VERIFIED');
  console.log('[PASS] T1: get_knl_framework theo frameworkCode tra dung cau truc that (2 nhom/3 hang muc/3 muc)');

  // ---- T1b (KNL library cleanup regression) - framework INACTIVE cung ten
  // ("Bán hàng") KHONG duoc bi chon nham du updated_at cua no MOI HON ban
  // active - xac nhan findFrameworkByCode loc dung status, khong dua vao
  // thu tu sap xep ngau nhien ----
  const fwSameName = await getKnlFrameworkForAi(adminSession, { frameworkCode: 'Bán hàng' });
  assert.strictEqual(fwSameName.version.id, fw.version.id, 'phai van resolve dung framework ACTIVE (fw-sales), khong duoc trung ban inactive cung ten (fw-sales-legacy)');
  console.log('[PASS] T1b: framework inactive cùng tên hiển thị KHÔNG được AI chọn nhầm (dù updated_at mới hơn) - đúng bản active');

  // ---- T2: "Ca trưởng dùng Bộ KNL nào?" - resolve qua position assignment,
  // KHONG tao framework rieng - phai RA DUNG version voi T1 ----
  const fwByTitle = await getKnlFrameworkForAi(adminSession, { title: 'Ca trưởng', department: 'Bán hàng' });
  assert.strictEqual(fwByTitle.available, true);
  assert.strictEqual(fwByTitle.resolvedBy, 'positionAssignment');
  assert.strictEqual(fwByTitle.framework.code, 'SALES', 'Ca truong phai dung CHUNG framework Ban hang, khong phai framework rieng');
  assert.strictEqual(fwByTitle.version.id, fw.version.id, 'phai cung version voi tra cuu truc tiep theo frameworkCode');
  console.log('[PASS] T2: "Ca trưởng dùng Bộ KNL nào" resolve đúng qua position assignment, dùng CHUNG framework Bán hàng (không tự tạo framework riêng)');

  // ---- T3: grade requirements ----
  const gradeList = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Bán hàng' });
  assert.strictEqual(gradeList.available, true);
  assert.strictEqual(gradeList.grades.length, 3, 'phai co 3 bac B1-B3');
  assert.ok(!gradeList.grade, 'khong truyen gradeCode thi khong co chi tiet 1 bac');

  const b3 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Bán hàng', gradeCode: 'B3' });
  assert.strictEqual(b3.available, true);
  assert.strictEqual(b3.grade.gradeCode, 'B3');
  assert.strictEqual(b3.requirementCount, 3);
  const item1Req = b3.requirements.find(r => r.itemName === 'Tư vấn khách hàng');
  assert.strictEqual(item1Req.requiredLevelLabel, 'M2 - Thành thạo');
  assert.ok(item1Req.requiredLevelContent.includes('Tư vấn đúng nhu cầu'));
  const structuredB3 = buildStructuredResult('get_knl_grade_requirements', b3);
  assert.strictEqual(structuredB3.evidence.status, 'VERIFIED');
  console.log('[PASS] T3: get_knl_grade_requirements trả đúng yêu cầu bậc B3 theo từng hạng mục (label + nội dung mức)');

  // ---- T4: employee assignment ----
  const assignment = await getEmployeeKnlAssignmentForAi(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(assignment.found, true);
  assert.strictEqual(assignment.framework.code, 'SALES');
  assert.strictEqual(assignment.matchKind, 'employee');
  console.log('[PASS] T4: get_employee_knl_assignment trả đúng bộ KNL đang áp dụng cho PHF010 (gán trực tiếp theo mã)');

  // ---- T5: self-reported assessment (Admin xem PHF010) ----
  const assess = await getEmployeeKnlAssessmentForAi(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(assess.assessmentAvailable, true);
  assert.strictEqual(assess.isSelfReported, true, 'PHAI danh dau isSelfReported - khong duoc coi la danh gia chinh thuc');
  assert.strictEqual(assess.itemCount, 3);
  const item2 = assess.items.find(i => i.itemName === 'Xử lý từ chối');
  assert.strictEqual(item2.suitability, 'UNCLEAR');
  const structuredAssess = buildStructuredResult('get_employee_knl_assessment', assess);
  assert.ok(/TỰ ĐÁNH GIÁ/.test(structuredAssess.evidence.note), 'evidence note phai neu ro day la tu danh gia, khong phai chinh thuc');
  console.log('[PASS] T5: get_employee_knl_assessment trả đúng dữ liệu tự đánh giá gần nhất, đánh dấu rõ isSelfReported');

  // ---- T6 (gián tiếp): assessment không tồn tại -> KHÔNG bịa, INCOMPLETE ----
  const noAssess = await getEmployeeKnlAssessmentForAi(adminSession, { employeeCode: 'PHF404' });
  assert.strictEqual(noAssess.assessmentAvailable, false);
  const structuredNoAssess = buildStructuredResult('get_employee_knl_assessment', noAssess);
  assert.strictEqual(structuredNoAssess.evidence.status, 'INCOMPLETE');
  console.log('[PASS] T6: nhân viên chưa có phiếu tự đánh giá nào -> assessmentAvailable:false, evidence INCOMPLETE (không bịa)');

  // ---- T7: search_training_lessons (kiểm qua module riêng, không đụng DB) ----
  const { searchTrainingLessonsByKeyword } = require('../lib/ai-training-tools');
  const lessonResult = await searchTrainingLessonsByKeyword(null, { keyword: 'chào mừng' });
  assert.ok(Array.isArray(lessonResult.matches));
  console.log('[PASS] T7: search_training_lessons chạy được, trả về danh sách khớp từ khoá (gợi ý AI, không phải mapping chính thức - xem SYSTEM_PROMPT)');

  // ---- T8 PRIVACY: learner (scope=self, PHF010) hỏi assessment của PHF099
  // (ngoài phạm vi) -> KHÔNG được thấy dữ liệu, dù PHF099 CÓ phiếu SUBMITTED
  // thật trong fixture (kiểm tra đúng bị lọc bởi scope, không phải vì
  // thiếu dữ liệu) ----
  const deniedAssess = await getEmployeeKnlAssessmentForAi(learnerSelfSession, { employeeCode: 'PHF099' });
  assert.strictEqual(deniedAssess.assessmentAvailable, false, 'ngoai pham vi quyen PHAI tra ve false, khong duoc lo du lieu');
  assert.strictEqual(deniedAssess.reason, 'no_submitted_ticket_in_scope');
  // Doi chung: admin xem DUOC PHF099 (de chac chan day la loc theo QUYEN,
  // khong phai do fixture PHF099 khong co du lieu)
  const adminSeesOther = await getEmployeeKnlAssessmentForAi(adminSession, { employeeCode: 'PHF099' });
  assert.strictEqual(adminSeesOther.assessmentAvailable, true, 'PHF099 THAT co phieu SUBMITTED - Admin phai thay duoc de chung minh learner bi loc dung boi scope, khong phai do thieu du lieu');
  console.log('[PASS] T8: learner ngoài phạm vi quyền hỏi assessment của người khác -> bị lọc đúng theo scope (assessmentAvailable:false), trong khi Admin (đủ quyền) vẫn thấy được đúng dữ liệu thật của PHF099 -> xác nhận đây là lọc quyền, không phải thiếu dữ liệu');

  // ---- Permission regression: learner (không có manage_framework) gọi
  // get_knl_framework/get_employee_knl_assignment cho CHÍNH mình vẫn bị
  // chặn đúng theo quyền hiện có của KNL (Admin-only cho
  // listKnlFrameworkAssignments) - KHÔNG bị nới lỏng qua đường AI ----
  let deniedErr = null;
  try { await getKnlFrameworkForAi(learnerSelfSession, {}); }
  catch (e) { deniedErr = e; }
  assert.ok(deniedErr, 'learner khong duoc phep doc framework qua AI - phai throw, khong duoc tra du lieu');
  assert.strictEqual(deniedErr.code, 'KNL_ADMIN_REQUIRED');
  console.log('[PASS] PERM: learner (không có quyền quản lý cấu trúc KNL) gọi get_knl_framework qua AI bị từ chối đúng (KNL_ADMIN_REQUIRED) - không nới quyền qua đường AI');

  console.log('\nALL PASS - test-ai-knl-tools.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
