'use strict';
/*
 * getKnlEmployeeCompetencyStandard (lib/knl-competency.js) — regression test,
 * in-memory mock (không chạm Production). Validate: self-view PASS không cần
 * assignment nào khác, no-assignment trả trạng thái rõ, next-grade xác định
 * bằng sort_order (không giả định B_n cố định), isMaxGrade detect đúng khi
 * hết grade kế tiếp, client KHÔNG thể ép frameworkVersionId/gradeId tùy ý
 * (server luôn tự resolve từ assignment active), và permission gate giống hệt
 * getKnlEmployeeCompetencyAssignment (self luôn được, người khác qua
 * view_people/peopleScope).
 *
 * Chạy: node scripts/test-knl-competency-standard-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const competencyPath = require.resolve('../api/_lib/knl-competency');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const peoplePath = require.resolve('../api/_lib/knl-people');
const scopePath = require.resolve('../api/_lib/knl-scope');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => ((a[spec.field] < b[spec.field] ? -1 : a[spec.field] > b[spec.field] ? 1 : 0) * (spec.asc ? 1 : -1))); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = { grants: [], grantHistory: [], employees: [], competency: [], frameworks: [], versions: [], grades: [], groups: [], items: [], columns: [], levelContents: [], requirements: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          const map = {
            knl_permission_grants: STATE.grants, knl_permission_grant_history: STATE.grantHistory,
            employee_profiles: STATE.employees, knl_employee_competency_assignments: STATE.competency,
            knl_frameworks: STATE.frameworks, knl_framework_versions: STATE.versions,
            knl_grade_definitions: STATE.grades, knl_competency_groups: STATE.groups,
            knl_competency_items: STATE.items, knl_structure_columns: STATE.columns,
            knl_item_level_contents: STATE.levelContents, knl_grade_requirements: STATE.requirements
          };
          if (!(table in map)) throw new Error('Unexpected table in KNL competency-standard mock: ' + table);
          return makeTableFactory(map[table])();
        },
        rpc() { return Promise.resolve({ data: null, error: null }); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '@supabase/supabase-js') return supabasePath; return originalResolve.call(this, request, ...rest); };
  const originalCache = require.cache[supabasePath];
  [competencyPath, permissionsPath, peoplePath, scopePath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const lib = require(competencyPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return lib;
}

const { getKnlEmployeeCompetencyStandard, getKnlEmployeeCompetencyGradeStandard } = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = require(permissionsPath);

STATE.employees.push(
  { employee_code: 'EMP1', full_name: 'Nguyễn Văn A', title: 'Nhân viên', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'EMP2', full_name: 'Trần Thị B', title: 'Nhân viên', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'EMP3', full_name: 'Lê Văn C', title: 'Nhân viên', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'MGR1', full_name: 'Phạm Thị D', title: 'Quản lý', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
);
STATE.frameworks.push({ id: 'fw-1', code: 'KNL_TEST', name: 'Khung năng lực test' });
STATE.versions.push({ id: 'v-1', framework_id: 'fw-1', version_number: 1 });
STATE.grades.push(
  { id: 'g-b1', version_id: 'v-1', grade_code: 'B1', grade_number: 1, sort_order: 1, label: 'Bậc 1' },
  { id: 'g-b2', version_id: 'v-1', grade_code: 'B2', grade_number: 2, sort_order: 2, label: 'Bậc 2' },
  { id: 'g-b3', version_id: 'v-1', grade_code: 'B3', grade_number: 3, sort_order: 3, label: 'Bậc 3' }
);
STATE.groups.push({ id: 'grp-1', version_id: 'v-1', name: 'Nhóm Kỹ năng', sort_order: 1 });
STATE.items.push({ id: 'item-1', version_id: 'v-1', group_id: 'grp-1', name: 'Kỹ năng X', sort_order: 1 });
STATE.columns.push(
  { id: 'col-1', version_id: 'v-1', label: 'Mức 1' },
  { id: 'col-2', version_id: 'v-1', label: 'Mức 2' },
  { id: 'col-3', version_id: 'v-1', label: 'Mức 3' }
);
STATE.requirements.push(
  { version_id: 'v-1', item_id: 'item-1', grade_id: 'g-b1', required_column_id: 'col-1', required_level_number: 1 },
  { version_id: 'v-1', item_id: 'item-1', grade_id: 'g-b2', required_column_id: 'col-2', required_level_number: 2 },
  { version_id: 'v-1', item_id: 'item-1', grade_id: 'g-b3', required_column_id: 'col-3', required_level_number: 3 }
);
STATE.levelContents.push(
  { version_id: 'v-1', item_id: 'item-1', column_id: 'col-1', content: 'Nội dung yêu cầu mức 1' },
  { version_id: 'v-1', item_id: 'item-1', column_id: 'col-2', content: 'Nội dung yêu cầu mức 2' },
  { version_id: 'v-1', item_id: 'item-1', column_id: 'col-3', content: 'Nội dung yêu cầu mức 3' }
);
STATE.competency.push(
  { id: 'ca-1', employee_code: 'EMP1', employee_name: 'Nguyễn Văn A', framework_version_id: 'v-1', competency_grade_id: 'g-b1', status: 'PROVISIONAL', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: {}, organization_snapshot: {}, note: 'baseline', reason: 'baseline', updated_at: '2026-08-11T00:00:00Z' },
  { id: 'ca-2', employee_code: 'EMP2', employee_name: 'Trần Thị B', framework_version_id: 'v-1', competency_grade_id: 'g-b3', status: 'CONFIRMED', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: {}, organization_snapshot: {}, note: 'baseline', reason: 'baseline', updated_at: '2026-08-11T00:00:00Z' }
);

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' }; }
async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Batch test fixture' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

async function run() {
  await grant('acct-mgr1', 'MGR1', 'Phạm Thị D', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] });
  await grant('acct-emp3', 'EMP3', 'Lê Văn C', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] });

  // 1. Self có assignment, KHÔNG phải bậc cao nhất -> current/next đúng, isMaxGrade=false
  let result = await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp1', employeeCode: 'EMP1' }));
  check(result.hasAssignment === true, '1a. Self (EMP1) có assignment -> hasAssignment=true');
  check(result.currentGrade && result.currentGrade.code === 'B1', '1b. currentGrade = B1 (đúng grade đang gán)');
  check(result.isMaxGrade === false && result.nextGrade && result.nextGrade.code === 'B2', '1c. nextGrade = B2 (sort_order kế tiếp), isMaxGrade=false');
  check(result.currentStandard && result.currentStandard.groups[0].items[0].content === 'Nội dung yêu cầu mức 1', '1d. currentStandard trả đúng nội dung yêu cầu mức 1 (join item/column/content thật)');
  check(result.nextStandard && result.nextStandard.groups[0].items[0].content === 'Nội dung yêu cầu mức 2', '1e. nextStandard trả đúng nội dung yêu cầu mức 2');
  check(result.framework && result.framework.code === 'KNL_TEST', '1f. framework resolve đúng từ assignment (không cần client truyền)');

  // Client cố truyền frameworkVersionId/gradeId khác -> bị lờ đi, server vẫn tự resolve từ assignment
  let hijack = await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp1', employeeCode: 'EMP1' }), { frameworkVersionId: 'v-other', competencyGradeId: 'g-other' });
  check(hijack.currentGrade.code === 'B1' && hijack.framework.code === 'KNL_TEST', '2. Client truyền frameworkVersionId/gradeId tùy ý bị lờ đi — server luôn tự resolve từ assignment active, không đọc field đó');

  // 3. Self có assignment, ĐANG ở bậc cao nhất -> isMaxGrade=true, nextGrade/nextStandard=null
  result = await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp2', employeeCode: 'EMP2' }));
  check(result.isMaxGrade === true && result.nextGrade === null && result.nextStandard === null, '3. Self (EMP2, B3 = bậc cao nhất của version test) -> isMaxGrade=true, nextGrade/nextStandard=null');
  check(result.assignment.status === 'CONFIRMED', '3b. assignment.status trả đúng CONFIRMED cho EMP2 (không lẫn PROVISIONAL)');
  check(Array.isArray(result.allGrades) && result.allGrades.length === 3 && result.allGrades.map(g=>g.code).join(',')==='B1,B2,B3', '3c. allGrades trả đầy đủ chuỗi bậc thật của version (B1,B2,B3), không chỉ forward từ current');

  // 4. Self KHÔNG có assignment -> trạng thái rõ ràng, không lỗi
  result = await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp3', employeeCode: 'EMP3' }));
  check(result.hasAssignment === false && result.assignment === null && result.currentGrade === null && result.currentStandard === null, '4. Self (EMP3, chưa có assignment) -> hasAssignment=false, mọi field liên quan = null (UI hiển thị "Chưa được thiết lập Khung năng lực")');

  // 5. Unauthorized: người không có view_people xem người khác -> bị chặn
  let threw = null;
  try { await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp3', employeeCode: 'EMP3' }), { employeeCode: 'EMP1' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_VIEW_DENIED', '5. EMP3 (self-scope, không view_people người khác) bị chặn xem tiêu chuẩn KNL của EMP1');

  // 6. Authorized qua peopleScope (view_people + all_company) -> xem được người khác
  result = await getKnlEmployeeCompetencyStandard(session('manager', { id: 'acct-mgr1', employeeCode: 'MGR1' }), { employeeCode: 'EMP1' });
  check(result.hasAssignment === true && result.employeeCode === 'EMP1', '6. MGR1 (view_people, scope all_company) xem được tiêu chuẩn KNL của EMP1');

  // 7. "Xem thêm bậc" — EMP1 (current B1, next B2) phải có đúng 1 further grade B3
  result = await getKnlEmployeeCompetencyStandard(session('learner', { id: 'acct-emp1', employeeCode: 'EMP1' }));
  check(Array.isArray(result.allGrades) && result.allGrades.map(g=>g.code).join(',')==='B1,B2,B3', '7a. EMP1 (current B1, next B2) -> allGrades = [B1,B2,B3] đúng thứ tự sort_order, đủ cả bậc trước lẫn sau');

  // 8. getKnlEmployeeCompetencyGradeStandard: EMP1 lấy đúng standard của B3 (grade xa hơn), tự resolve version từ assignment
  let g3 = await getKnlEmployeeCompetencyGradeStandard(session('learner', { id: 'acct-emp1', employeeCode: 'EMP1' }), { gradeCode: 'B3' });
  check(g3.grade.code === 'B3' && g3.standard.groups[0].items[0].content === 'Nội dung yêu cầu mức 3', '8. getKnlEmployeeCompetencyGradeStandard trả đúng standard B3 cho EMP1 (tự resolve version từ assignment, không nhận version từ client)');

  // 9. Bậc không thuộc version của nhân sự -> từ chối rõ ràng, không invent
  threw = null;
  try { await getKnlEmployeeCompetencyGradeStandard(session('learner', { id: 'acct-emp1', employeeCode: 'EMP1' }), { gradeCode: 'B99' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_GRADE_NOT_FOUND', '9. gradeCode không tồn tại trong version của nhân sự -> KNL_COMPETENCY_GRADE_NOT_FOUND, không invent');

  // 10. Nhân sự chưa có assignment -> getKnlEmployeeCompetencyGradeStandard từ chối rõ ràng
  threw = null;
  try { await getKnlEmployeeCompetencyGradeStandard(session('learner', { id: 'acct-emp3', employeeCode: 'EMP3' }), { gradeCode: 'B1' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_NO_ASSIGNMENT', '10. EMP3 (chưa có assignment) gọi getKnlEmployeeCompetencyGradeStandard -> KNL_COMPETENCY_NO_ASSIGNMENT');

  // 11. Permission "Xem thêm bậc" cho người khác vẫn qua đúng view_people/peopleScope — không invent scope mới
  threw = null;
  try { await getKnlEmployeeCompetencyGradeStandard(session('learner', { id: 'acct-emp3', employeeCode: 'EMP3' }), { employeeCode: 'EMP1', gradeCode: 'B3' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_VIEW_DENIED', '11a. EMP3 (self-scope) bị chặn xem grade B3 của EMP1');
  let g3ByMgr = await getKnlEmployeeCompetencyGradeStandard(session('manager', { id: 'acct-mgr1', employeeCode: 'MGR1' }), { employeeCode: 'EMP1', gradeCode: 'B3' });
  check(g3ByMgr.grade.code === 'B3', '11b. MGR1 (view_people, all_company) xem được grade B3 của EMP1');

  if (failures) { console.error('\n' + failures + ' check(s) failed.'); process.exit(1); }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
