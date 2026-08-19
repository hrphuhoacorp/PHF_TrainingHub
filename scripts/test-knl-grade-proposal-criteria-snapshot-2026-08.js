'use strict';
/*
 * KNL "Đề xuất nâng bậc" — Phase 2: Đánh giá theo tiêu chí (Assessment V1) +
 * snapshot bất biến. Regression cho:
 *   - bridge compensation grade_code -> competency knl_grade_definitions
 *     (resolveCompetencyStandardForGradeCode, lib/knl-competency.js)
 *   - BLOCK tạo/gửi proposal khi thiếu framework / grade không mapping /
 *     grade không có requirements
 *   - validate assessment (đủ/đúng tiêu chí, Đạt/Chưa đạt, note bắt buộc
 *     khi Chưa đạt)
 *   - snapshot immutable sau khi propose (agree/approve/reject không sửa
 *     được, sửa framework sau không ảnh hưởng proposal cũ)
 *   - self-proposal / manager-proposes-subordinate vẫn đi qua đúng luồng
 *     criteria
 *   - permission gate (requirePropose) vẫn đứng TRƯỚC bước resolve criteria
 *   - không leak enum/kỹ thuật thô trong thông điệp lỗi trả về client
 *
 * In-memory only — không chạm Production/Supabase thật. Chạy thủ công:
 *   node scripts/test-knl-grade-proposal-criteria-snapshot-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../lib/knl-permissions');
const peoplePath = require.resolve('../lib/knl-people');
const scopePath = require.resolve('../lib/knl-scope');
const proposalsPath = require.resolve('../lib/knl-grade-proposals');
const competencyPath = require.resolve('../lib/knl-competency');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2); }
function applyFilters(rows, filters) { return rows.filter(r => filters.every(fn => fn(r))); }

function makeTableFactory(rows, opts = {}) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null, mode = 'select', insertPayload = null, updatePayload = null, headMode = false;
    const q = {
      select(_cols, selOpts) { if (selOpts && selOpts.head) headMode = true; return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      gt(field, value) { filters.push(r => Number(r[field]) > Number(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      or(expr) {
        const clauses = String(expr || '').split(',').map(s => s.trim()).filter(Boolean).map(clause => {
          const [field, op, value] = clause.split('.');
          return r => op === 'eq' ? String(r[field]) === String(value) : true;
        });
        filters.push(r => clauses.some(fn => fn(r)));
        return q;
      },
      order(field, o) { orderSpecs.push({ field, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            if (opts.beforeInsert) { const err = opts.beforeInsert(list, rows); if (err) { resolve({ data: null, error: err }); return; } }
            const inserted = list.map(obj => {
              const row = Object.assign({ id: uid('gen'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_active: true }, obj);
              rows.push(row);
              return row;
            });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null });
            return;
          }
          if (mode === 'update') {
            const matched = applyFilters(rows, filters);
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null });
            return;
          }
          let matched = applyFilters(rows, filters);
          if (headMode) { resolve({ data: null, count: matched.length, error: null }); return; }
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
  grants: [], history: [], employees: [],
  ladders: [], versions: [], grades: [], assignments: [],
  proposals: [], steps: [], accounts: [],
  frameworks: [], frameworkVersions: [], competencyAssignments: [],
  gradeDefinitions: [], gradeRequirements: [], competencyGroups: [], competencyItems: [], structureColumns: [], itemLevelContents: [],
  gradeMap: []
};

// Tái hiện unique(framework_version_id, compensation_grade_id) của
// 1.63.0 — mock-level, dùng để CHỨNG MINH THIẾT KẾ đúng (không thay thế xác
// nhận Postgres thật, migration 1.63.0 chưa apply DEV/Production ở batch này).
function gradeMapUniquenessGuard(list, existingRows) {
  for (const obj of list) {
    if (existingRows.some(r => r.framework_version_id === obj.framework_version_id && r.compensation_grade_id === obj.compensation_grade_id)) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "knl_compensation_competency_grade_map_framework_version_id_compensation_grade_id_key"' };
    }
  }
  return null;
}
function proposalUniquenessGuard(list, existingRows) {
  for (const obj of list) {
    if (obj.status === 'pending' && existingRows.some(r => r.subject_employee_code === obj.subject_employee_code && r.status === 'pending')) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "knl_grade_promotion_proposal_active_uq"' };
    }
  }
  return null;
}
function snakeRow(obj) { const row = {}; Object.keys(obj || {}).forEach(k => { if (obj[k] !== undefined) row[k] = obj[k]; }); return row; }

/* Mock 2 RPC atomic — knl_grade_promotion_propose() giờ ghi thêm
 * criteria_snapshot (đúng migration 1.62.0), knl_grade_promotion_transition()
 * KHÔNG ĐỔI (UPDATE liệt kê tường minh từng cột, không có criteria_snapshot —
 * đây chính là cơ chế đảm bảo immutable, mock tái hiện ĐÚNG behavior đó bằng
 * cách KHÔNG BAO GIỜ đọc p_patch.criteria_snapshot dù có gửi lên). */
async function mockGradePromotionRpc(name, params) {
  if (name === 'knl_grade_promotion_propose') {
    const p = params.p_proposal, steps = params.p_steps || [];
    const dupErr = proposalUniquenessGuard([{ status: 'pending', subject_employee_code: p.subject_employee_code }], STATE.proposals);
    if (dupErr) return { data: null, error: dupErr };
    const now = new Date().toISOString();
    const proposalRow = snakeRow({
      id: uid('proposal'), subject_employee_code: p.subject_employee_code, subject_employee_name: p.subject_employee_name,
      created_by: p.created_by || null, created_by_name: p.created_by_name || null, created_at: now,
      compensation_ladder_id: p.compensation_ladder_id, compensation_version_id: p.compensation_version_id,
      current_grade_id: p.current_grade_id, current_grade_code: p.current_grade_code, current_grade_number: p.current_grade_number,
      proposed_grade_id: p.proposed_grade_id, proposed_grade_code: p.proposed_grade_code, proposed_grade_number: p.proposed_grade_number,
      reason: p.reason, status: 'pending', selected_first_approver_employee_code: p.selected_first_approver_employee_code || null,
      routing_snapshot: p.routing_snapshot || [], current_step_index: p.current_step_index || 0, updated_at: now,
      criteria_snapshot: p.criteria_snapshot || {}
    });
    const stepRows = steps.map(s => snakeRow({
      id: uid('step'), proposal_id: proposalRow.id, step_index: s.step_index, actor_id: s.actor_id || null, actor_employee_code: s.actor_employee_code || null,
      actor_name: s.actor_name || null, action: s.action, suggested_grade_id: s.suggested_grade_id || null, suggested_grade_code: s.suggested_grade_code || null,
      suggested_grade_number: s.suggested_grade_number || null, reason: s.reason || null, acted_at: now
    }));
    STATE.proposals.push(proposalRow);
    stepRows.forEach(r => STATE.steps.push(r));
    return { data: clone(proposalRow), error: null };
  }
  if (name === 'knl_grade_promotion_transition') {
    const row = STATE.proposals.find(r => r.id === params.p_proposal_id);
    if (!row) return { data: null, error: { message: 'PROPOSAL_NOT_FOUND' } };
    if (row.status !== params.p_expected_status) return { data: null, error: { message: 'PROPOSAL_STATE_CHANGED' } };
    if (params.p_expected_step_index != null && row.current_step_index !== params.p_expected_step_index) return { data: null, error: { message: 'PROPOSAL_STATE_CHANGED' } };
    const now = new Date().toISOString();
    const patch = params.p_patch || {};
    // ĐÚNG behavior RPC thật (1.51.0 UPDATE liệt kê tường minh cột) —
    // criteria_snapshot KHÔNG nằm trong danh sách cột được patch dù p_patch
    // chứa gì đi nữa.
    const allowedPatchKeys = ['status', 'current_step_index', 'routing_snapshot', 'final_decided_grade_id', 'final_decided_grade_code', 'final_decided_grade_number', 'final_decided_by', 'final_decided_by_name', 'final_decided_at', 'rejected_reason', 'rejected_by', 'rejected_by_name', 'rejected_at', 'withdrawn_reason', 'withdrawn_by', 'withdrawn_by_name', 'withdrawn_at'];
    const safePatch = {};
    allowedPatchKeys.forEach(k => { if (patch[k] !== undefined) safePatch[k] = patch[k]; });
    Object.assign(row, snakeRow(safePatch), { updated_at: now });
    const stepRows = (params.p_steps || []).map(s => snakeRow({
      id: uid('step'), proposal_id: row.id, step_index: s.step_index, actor_id: s.actor_id || null, actor_employee_code: s.actor_employee_code || null,
      actor_name: s.actor_name || null, action: s.action, suggested_grade_id: s.suggested_grade_id || null, suggested_grade_code: s.suggested_grade_code || null,
      suggested_grade_number: s.suggested_grade_number || null, reason: s.reason || null,
      reassigned_from_employee_code: s.reassigned_from_employee_code || null, reassigned_to_employee_code: s.reassigned_to_employee_code || null, acted_at: now
    }));
    stepRows.forEach(r => STATE.steps.push(r));
    return { data: clone(row), error: null };
  }
  throw new Error('Unexpected RPC in KNL Grade Proposal Criteria mock: ' + name);
}

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.history)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_compensation_ladders') return makeTableFactory(STATE.ladders)();
          if (table === 'knl_compensation_versions') return makeTableFactory(STATE.versions)();
          if (table === 'knl_compensation_grades') return makeTableFactory(STATE.grades)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_grade_promotion_proposals') return makeTableFactory(STATE.proposals, { beforeInsert: proposalUniquenessGuard })();
          if (table === 'knl_grade_promotion_proposal_steps') return makeTableFactory(STATE.steps)();
          if (table === 'user_accounts') return makeTableFactory(STATE.accounts)();
          if (table === 'knl_frameworks') return makeTableFactory(STATE.frameworks)();
          if (table === 'knl_framework_versions') return makeTableFactory(STATE.frameworkVersions)();
          if (table === 'knl_employee_competency_assignments') return makeTableFactory(STATE.competencyAssignments)();
          if (table === 'knl_grade_definitions') return makeTableFactory(STATE.gradeDefinitions)();
          if (table === 'knl_grade_requirements') return makeTableFactory(STATE.gradeRequirements)();
          if (table === 'knl_competency_groups') return makeTableFactory(STATE.competencyGroups)();
          if (table === 'knl_competency_items') return makeTableFactory(STATE.competencyItems)();
          if (table === 'knl_structure_columns') return makeTableFactory(STATE.structureColumns)();
          if (table === 'knl_item_level_contents') return makeTableFactory(STATE.itemLevelContents)();
          if (table === 'knl_compensation_competency_grade_map') return makeTableFactory(STATE.gradeMap, { beforeInsert: gradeMapUniquenessGuard })();
          throw new Error('Unexpected table in KNL Grade Proposal Criteria mock: ' + table);
        },
        rpc(name, params) { return mockGradePromotionRpc(name, params); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  const originalCache = require.cache[supabasePath];
  [supabasePath, permissionsPath, peoplePath, scopePath, proposalsPath, competencyPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissionsLib = require(permissionsPath);
  const peopleLib = require(peoplePath);
  const proposalsLib = require(proposalsPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { permissionsLib, peopleLib, proposalsLib };
}

const loaded = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = loaded.permissionsLib;
const {
  createGradePromotionProposal: createProposal,
  processGradePromotionProposalStep: processStep,
  withdrawGradePromotionProposal: withdrawProposal,
  getGradePromotionProposalDetail: getDetail,
  getGradePromotionCriteriaStandard: getCriteriaStandard
} = loaded.proposalsLib;

// ---------------------------------------------------------------------------
// Fixture — Organization Master tối thiểu + Compensation ladder B1..B4 +
// Competency framework, nối qua EXPLICIT MAPPING (knl_compensation_competency_
// grade_map) — KHÔNG so grade_code string (2 hệ độc lập, đúng constraint
// thật: compensation "NSGQ-B1", competency "B1" — 2 format loại trừ nhau).
// Mapping có cho B1/B2/B4 (grade-B2 -> gdef-B2 dùng cho valid mapping), KHÔNG
// map cho B3 (test grade_not_mapped dù competency KHÔNG có definition cho
// B3), B4 map nhưng requirements rỗng (test no_requirements).
// ---------------------------------------------------------------------------
STATE.employees.push(
  { employee_code: 'GD1', full_name: 'Giám Đốc Test', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'TBPKHO1', full_name: 'TBP Kho', title: 'Trưởng bộ phận Kho', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' },
  { employee_code: 'NVKHO1', full_name: 'NV Kho 1', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'NVKHO2', full_name: 'NV Kho 2 (không framework)', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' }
);

STATE.ladders.push({ id: 'ladder-1', code: 'NSGQ', name: 'Ngạch nhân sự gián quản' });
STATE.versions.push({ id: 'version-1', ladder_id: 'ladder-1', version_number: 1, status: 'ACTIVE', effective_period: '2026-07' });
['B1', 'B2', 'B3', 'B4'].forEach((c, i) => STATE.grades.push({ id: 'grade-' + c, version_id: 'version-1', ladder_id: 'ladder-1', grade_code: 'NSGQ-' + c, grade_number: i + 1 }));

// status:'ACTIVE' BẮT BUỘC — loadCurrentGrade() lọc .eq('status','ACTIVE').
STATE.assignments.push(
  { employee_code: 'NVKHO1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1', status: 'ACTIVE' },
  { employee_code: 'NVKHO2', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1', status: 'ACTIVE' }
);

STATE.frameworks.push({ id: 'fw-1', code: 'FW-KHO', name: 'Khung năng lực Kho' });
STATE.frameworkVersions.push({ id: 'fv-1', framework_id: 'fw-1', version_number: 1 });
// NVKHO1 có framework active; NVKHO2 KHÔNG có (test no_framework_assignment).
STATE.competencyAssignments.push({ employee_code: 'NVKHO1', framework_version_id: 'fv-1', is_active: true });

// competency grade_code PHẢI đúng constraint thật '^B[1-9][0-9]*$' (bare,
// KHÔNG tiền tố) — khác hẳn compensation grade_code 'NSGQ-Bx' (có tiền tố).
// KHÔNG có definition cho B3 (grade-B3 compensation cũng không có mapping).
STATE.gradeDefinitions.push(
  { id: 'gdef-B1', version_id: 'fv-1', grade_code: 'B1', grade_number: 1, sort_order: 1, label: 'Bậc 1' },
  { id: 'gdef-B2', version_id: 'fv-1', grade_code: 'B2', grade_number: 2, sort_order: 2, label: 'Bậc 2' },
  { id: 'gdef-B4', version_id: 'fv-1', grade_code: 'B4', grade_number: 4, sort_order: 4, label: 'Bậc 4' }
);
// Explicit mapping (framework_version_id, compensation_grade_id) -> competency_grade_id
// — nguồn DUY NHẤT xác định "bậc lương X ứng với bậc năng lực nào". KHÔNG map
// grade-B3 (test grade_not_mapped: dù compensation grade tồn tại, thiếu dòng
// mapping vẫn BLOCK).
STATE.gradeMap.push(
  { id: 'map-B1', framework_version_id: 'fv-1', compensation_grade_id: 'grade-B1', competency_grade_id: 'gdef-B1' },
  { id: 'map-B2', framework_version_id: 'fv-1', compensation_grade_id: 'grade-B2', competency_grade_id: 'gdef-B2' },
  { id: 'map-B4', framework_version_id: 'fv-1', compensation_grade_id: 'grade-B4', competency_grade_id: 'gdef-B4' }
);

// Framework THỨ 2 (fv-2) + compensation grade riêng (grade-B5) — dùng để test
// "mapping trỏ sang bậc năng lực của framework KHÁC bị từ chối". Trong
// Postgres thật, composite FK (competency_grade_id,framework_version_id) ->
// knl_grade_definitions(id,version_id) sẽ CHẶN NGAY LÚC INSERT nếu cố gán
// framework_version_id=fv-1 nhưng competency_grade_id thuộc fv-2 — không thể
// tạo được dòng "hỏng" này qua DB thật. Ở đây ta CỐ Ý bơm thẳng 1 dòng như
// vậy vào mock (bỏ qua composite FK mock không enforce) để chứng minh
// resolver TỰ CÓ defense-in-depth thứ 2 (lọc .eq('version_id', fv.id) khi
// đọc knl_grade_definitions) — không chỉ dựa vào DB constraint.
STATE.frameworks.push({ id: 'fw-2', code: 'FW-OTHER', name: 'Framework Khác' });
STATE.frameworkVersions.push({ id: 'fv-2', framework_id: 'fw-2', version_number: 1 });
STATE.gradeDefinitions.push({ id: 'gdef2-B1', version_id: 'fv-2', grade_code: 'B1', grade_number: 1, sort_order: 1, label: 'Bậc 1 (framework khác)' });
STATE.grades.push({ id: 'grade-B5', version_id: 'version-1', ladder_id: 'ladder-1', grade_code: 'NSGQ-B5', grade_number: 5 });
STATE.gradeMap.push({ id: 'map-crossfw-bad', framework_version_id: 'fv-1', compensation_grade_id: 'grade-B5', competency_grade_id: 'gdef2-B1' });
STATE.competencyGroups.push({ id: 'grp-1', version_id: 'fv-1', name: 'Kỹ năng chuyên môn', sort_order: 1 });
STATE.competencyItems.push(
  { id: 'item-1', group_id: 'grp-1', version_id: 'fv-1', name: 'Vận hành máy đóng gói', sort_order: 1 },
  { id: 'item-2', group_id: 'grp-1', version_id: 'fv-1', name: 'Kiểm soát chất lượng', sort_order: 2 }
);
STATE.structureColumns.push({ id: 'col-1', version_id: 'fv-1', label: 'Thành thạo' });
STATE.itemLevelContents.push(
  { item_id: 'item-1', column_id: 'col-1', version_id: 'fv-1', content: 'Vận hành độc lập, không cần giám sát.' },
  { item_id: 'item-2', column_id: 'col-1', version_id: 'fv-1', content: 'Phát hiện lỗi sản phẩm theo checklist QC.' }
);
// requirements CHỈ gắn cho B2 (đề xuất B1->B2 hợp lệ, có tiêu chí) — B4 CÓ
// definition nhưng KHÔNG có requirement nào (test no_requirements).
STATE.gradeRequirements.push(
  { version_id: 'fv-1', item_id: 'item-1', grade_id: 'gdef-B2', required_column_id: 'col-1', required_level_number: 1 },
  { version_id: 'fv-1', item_id: 'item-2', grade_id: 'gdef-B2', required_column_id: 'col-1', required_level_number: 1 }
);

function session(role, opts) {
  opts = opts || {};
  return { role, account: { id: opts.id || '', name: opts.name || '', employeeCode: opts.employeeCode || '' }, employeeId: 'hv-test-' + (opts.id || ''), sub: opts.id || '' };
}
async function grant(accountId, employeeCode, capabilities, peopleScope) {
  if (!STATE.accounts.some(a => a.id === accountId)) STATE.accounts.push({ id: accountId, employee_code: employeeCode });
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, presetCode: 'CUSTOM', capabilities, peopleScope, reason: 'Thiết lập test criteria snapshot' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }
async function expectFail(promise, code, message) {
  let threw = null;
  try { await promise; } catch (e) { threw = e; }
  check(!!threw && threw.code === code, message + ' (expected code ' + code + ', got ' + (threw ? threw.code : 'no throw') + (threw ? ': ' + threw.message : '') + ')');
  return threw;
}
const RAW_TECHNICAL_LEAK_PATTERN = /pgrst|postgres|null_value_not_allowed|23505|42p01|column|relation|jsonb|undefined|NaN|\[object Object\]/i;

async function run() {
  await grant('acc-tbpkho', 'TBPKHO1', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'department', values: ['Kho'] });
  // GD1 là manager thật của TBPKHO1 trong Organization Master (org chart) —
  // dùng làm tầng agree TRUNG GIAN thật sự (khác VINH1 trước đây không tồn
  // tại trong org chart nào, khiến chain thực tế bỏ qua và test sai giả định
  // "mid-tier agree" — bug đã fix, xem trace CASE IMMUTABLE-1 lần chạy đầu).
  await grant('acc-gd', 'GD1', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'all_company', values: [] });
  await grant('acc-nvkho1', 'NVKHO1', { access_knl: true, view_people: true, propose: true }, { type: 'self', values: [] });
  await grant('acc-noaccess', 'TBPKHO1', { access_knl: true, view_people: true, propose: false }, { type: 'department', values: ['Kho'] });

  const validAssessment = [
    { itemId: 'item-1', result: 'met', note: '' },
    { itemId: 'item-2', result: 'not_met', note: 'Còn để lẫn lô hàng lỗi, cần huấn luyện lại.' }
  ];

  // ================= READ: getGradePromotionCriteriaStandard =================
  // proposedGradeId là compensation_grade_id (grade-Bx) — resolver giờ nối
  // sang competency qua explicit mapping (knl_compensation_competency_grade_
  // map), KHÔNG so grade_code string.
  let std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B2' });
  check(std.mapped === true && std.groups.length === 1 && std.groups[0].items.length === 2, 'CASE READ-1. Valid mapping NVKHO1, compensation grade-B2 (qua explicit mapping) trả đúng 1 nhóm/2 tiêu chí');
  check(std.groups[0].items[0].content === 'Vận hành độc lập, không cần giám sát.', 'CASE READ-2. Nội dung tiêu chí (content) resolve đúng theo required_column_id');

  std = await getCriteriaStandard(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { employeeCode: 'NVKHO2', proposedGradeId: 'grade-B2' });
  check(std.mapped === false && std.reason === 'no_framework_assignment', 'CASE READ-3. NVKHO2 không có framework active -> mapped=false, reason=no_framework_assignment');

  std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B3' });
  check(std.mapped === false && std.reason === 'grade_not_mapped', 'CASE READ-4. compensation grade-B3 KHÔNG có dòng mapping tường minh nào -> mapped=false, reason=grade_not_mapped (dù grade-B3 compensation tồn tại thật)');

  std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B4' });
  check(std.mapped === false && std.reason === 'no_requirements', 'CASE READ-5. grade-B4 CÓ mapping (map-B4) nhưng competency grade B4 KHÔNG có requirement nào -> mapped=false, reason=no_requirements');

  // ================= MAP INTEGRITY: cross-framework mapping bị resolver tự chặn =================
  std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B5' });
  check(std.mapped === false && std.reason === 'grade_not_mapped', 'CASE MAP-CROSSFW-1. Dòng mapping "hỏng" (framework_version_id=fv-1 nhưng competency_grade_id thuộc fv-2 — bất khả thi qua composite FK thật, mock cố ý bơm để test) bị resolver TỰ CHẶN qua filter version_id -> vẫn grade_not_mapped, không lộ tiêu chí sai framework');

  // ================= MAP INTEGRITY: duplicate mapping bị unique constraint chặn (mock-level, thiết kế — chưa verify Postgres thật vì 1.63.0 chưa apply) =================
  const gradeMapTable = makeTableFactory(STATE.gradeMap, { beforeInsert: gradeMapUniquenessGuard })();
  const dupInsertResult = await gradeMapTable.insert({ id: 'map-B2-dup-attempt', framework_version_id: 'fv-1', compensation_grade_id: 'grade-B2', competency_grade_id: 'gdef-B4' });
  check(!!dupInsertResult.error && dupInsertResult.error.code === '23505', 'CASE MAP-DUP-1. Insert mapping thứ 2 cho CÙNG (fv-1, grade-B2) đã có map-B2 -> unique constraint chặn (23505), không cho 1 bậc lương map 2 bậc năng lực trong cùng framework version');

  // ================= MAP INTEGRITY: resolve ĐÚNG chỉ nhờ có dòng mapping tường minh, không phải trùng tên chuỗi =================
  // Xoá tạm map-B2 (compensation "NSGQ-B2" <-> competency "B2" — 2 chuỗi
  // KHÁC NHAU hoàn toàn, không có logic string nào tự suy ra được) -> resolver
  // PHẢI mất khả năng resolve, chứng minh việc resolve trước đó (CASE READ-1)
  // là NHỜ dòng mapping, không phải nhờ trùng số "2".
  const removedMapB2Index = STATE.gradeMap.findIndex(r => r.id === 'map-B2');
  const removedMapB2 = STATE.gradeMap.splice(removedMapB2Index, 1)[0];
  std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B2' });
  check(std.mapped === false && std.reason === 'grade_not_mapped', 'CASE MAP-DEPENDENCY-1. Xoá dòng mapping map-B2 -> compensation "NSGQ-B2" không còn resolve được competency "B2" dù 2 chuỗi trông "giống nhau" (cùng số 2) — chứng minh resolve KHÔNG dựa vào string/number, CHỈ dựa vào dòng mapping');
  STATE.gradeMap.push(removedMapB2); // khôi phục cho các case dùng grade-B2 phía sau
  std = await getCriteriaStandard(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', proposedGradeId: 'grade-B2' });
  check(std.mapped === true, 'CASE MAP-DEPENDENCY-2. Khôi phục lại map-B2 -> resolve lại được ngay — xác nhận toàn bộ hành vi chỉ phụ thuộc sự tồn tại của dòng mapping tường minh');

  // ================= BLOCK tạo/gửi proposal khi mapping fail =================
  await expectFail(createProposal(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { employeeCode: 'NVKHO2', reason: 'Test thiếu framework', proposedGradeId: 'grade-B2', assessment: validAssessment }), 'KNL_PROPOSAL_CRITERIA_NO_FRAMEWORK_ASSIGNMENT', 'CASE BLOCK-1. Subject không có framework active -> BLOCK tạo proposal (không cho proposal rỗng lọt xuống DB)');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test grade không mapping', proposedGradeId: 'grade-B3', assessment: validAssessment }), 'KNL_PROPOSAL_CRITERIA_GRADE_NOT_MAPPED', 'CASE BLOCK-2. Bậc đề xuất B3 không khớp competency grade nào -> BLOCK');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test bậc rỗng requirements', proposedGradeId: 'grade-B4', assessment: validAssessment }), 'KNL_PROPOSAL_CRITERIA_NO_REQUIREMENTS', 'CASE BLOCK-3. Bậc B4 có definition nhưng rỗng requirements -> BLOCK');

  // ================= VALIDATE assessment =================
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test thiếu đánh giá', proposedGradeId: 'grade-B2', assessment: [{ itemId: 'item-1', result: 'met', note: '' }] }), 'KNL_PROPOSAL_CRITERIA_INCOMPLETE', 'CASE VALIDATE-1. Thiếu đánh giá 1/2 tiêu chí -> KNL_PROPOSAL_CRITERIA_INCOMPLETE');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test result rác', proposedGradeId: 'grade-B2', assessment: [{ itemId: 'item-1', result: 'yes', note: '' }, { itemId: 'item-2', result: 'met', note: '' }] }), 'KNL_PROPOSAL_CRITERIA_RESULT_INVALID', 'CASE VALIDATE-2. result không phải met/not_met -> KNL_PROPOSAL_CRITERIA_RESULT_INVALID');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test thiếu note khi chưa đạt', proposedGradeId: 'grade-B2', assessment: [{ itemId: 'item-1', result: 'met', note: '' }, { itemId: 'item-2', result: 'not_met', note: '' }] }), 'KNL_PROPOSAL_CRITERIA_NOTE_REQUIRED', 'CASE VALIDATE-3. Chưa đạt nhưng note rỗng -> KNL_PROPOSAL_CRITERIA_NOTE_REQUIRED');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test note quá ngắn', proposedGradeId: 'grade-B2', assessment: [{ itemId: 'item-1', result: 'met', note: '' }, { itemId: 'item-2', result: 'not_met', note: 'ok' }] }), 'KNL_PROPOSAL_CRITERIA_NOTE_REQUIRED', 'CASE VALIDATE-4. Note "ok" (2 ký tự) < tối thiểu 3 -> vẫn bị chặn');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test itemId lạ', proposedGradeId: 'grade-B2', assessment: [{ itemId: 'item-1', result: 'met', note: '' }, { itemId: 'item-2', result: 'met', note: '' }, { itemId: 'item-999-la', result: 'met', note: '' }] }), 'KNL_PROPOSAL_CRITERIA_INCOMPLETE', 'CASE VALIDATE-5. Gửi thừa itemId không thuộc standard -> vẫn coi là INCOMPLETE (byId.size lệch allItemIds.size), không âm thầm chấp nhận');

  // ================= VALID MAPPING — manager proposes subordinate =================
  const created = (await createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'TBP Kho đề xuất nâng bậc cho NV Kho, đủ căn cứ', proposedGradeId: 'grade-B2', assessment: validAssessment })).proposal;
  check(created.status === 'pending', 'CASE VALID-1. Manager tạo proposal cho subordinate với assessment đầy đủ -> tạo thành công');

  let detail = await getDetail(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: created.id });
  // gradeCode trong snapshot là mã BẬC NĂNG LỰC ('B2', từ knl_grade_definitions
  // qua mapping) — KHÁC mã bậc LƯƠNG đề xuất ('NSGQ-B2', proposal.proposedGradeCode)
  // — đúng bản chất "2 hệ độc lập", không phải cùng 1 giá trị.
  check(!!detail.criteriaSnapshot && detail.criteriaSnapshot.gradeCode === 'B2', 'CASE VALID-2. Detail trả criteriaSnapshot đúng gradeCode (bậc năng lực B2, qua mapping từ compensation grade-B2 — không phải chuỗi "NSGQ-B2")');
  check(detail.criteriaSnapshot.groups[0].items.find(it => it.id === 'item-1').result === 'met', 'CASE VALID-3. Snapshot lưu đúng result item-1=met');
  check(detail.criteriaSnapshot.groups[0].items.find(it => it.id === 'item-2').note === 'Còn để lẫn lô hàng lỗi, cần huấn luyện lại.', 'CASE VALID-4. Snapshot lưu đúng note item-2');
  check(!('proposal' in detail.criteriaSnapshot), 'CASE VALID-5. criteriaSnapshot KHÔNG lồng field proposal/technical thừa nào');
  const proposalRowJson = JSON.stringify(STATE.proposals.find(p => p.id === created.id));
  check(!/base_salary|hqcv|professional_allowance|management_allowance/i.test(proposalRowJson), 'CASE VALID-6. Snapshot KHÔNG chứa field tiền lương nào (đúng constraint đã chốt)');

  // ================= IMMUTABLE sau khi submit =================
  const snapshotBeforeAgree = clone(STATE.proposals.find(p => p.id === created.id).criteria_snapshot);
  await processStep(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { proposalId: created.id, action: 'agree', suggestedGradeId: 'grade-B2', note: 'Đồng ý' });
  let snapshotAfterAgree = STATE.proposals.find(p => p.id === created.id).criteria_snapshot;
  check(JSON.stringify(snapshotAfterAgree) === JSON.stringify(snapshotBeforeAgree), 'CASE IMMUTABLE-1. Sau agree() ở tầng trung gian, criteria_snapshot BẤT BIẾN 100%');

  await processStep(session('admin', { id: 'u-admin' }), { proposalId: created.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  let afterApprove = STATE.proposals.find(p => p.id === created.id);
  check(afterApprove.status === 'approved' && JSON.stringify(afterApprove.criteria_snapshot) === JSON.stringify(snapshotBeforeAgree), 'CASE IMMUTABLE-2. Sau approve() (Admin, tier cuối), criteria_snapshot VẪN BẤT BIẾN — agree/approve chỉ xem, không sửa được bảng tiêu chí');

  // Sửa "framework" sau khi proposal đã tồn tại (mô phỏng Admin sửa nội dung
  // tiêu chí/level content sau này) -> snapshot cũ trên proposal ĐÃ APPROVED
  // không được phép đổi theo.
  const originalContent = STATE.itemLevelContents.find(c => c.item_id === 'item-1' && c.column_id === 'col-1').content;
  STATE.itemLevelContents.find(c => c.item_id === 'item-1' && c.column_id === 'col-1').content = 'NỘI DUNG ĐÃ SỬA SAU KHI PROPOSAL CŨ ĐÃ APPROVED';
  detail = await getDetail(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: created.id });
  check(detail.criteriaSnapshot.groups[0].items.find(it => it.id === 'item-1').content === 'Vận hành độc lập, không cần giám sát.', 'CASE IMMUTABLE-3. Sửa framework SAU KHI proposal đã approved KHÔNG làm đổi nội dung snapshot cũ (snapshot đọc từ DB, không re-build từ framework sống)');
  STATE.itemLevelContents.find(c => c.item_id === 'item-1' && c.column_id === 'col-1').content = originalContent; // khôi phục cho case sau

  // ================= REJECT cũng KHÔNG sửa được snapshot =================
  const forReject = (await createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test reject không sửa snapshot', proposedGradeId: 'grade-B2', assessment: validAssessment })).proposal;
  const snapshotBeforeReject = clone(STATE.proposals.find(p => p.id === forReject.id).criteria_snapshot);
  await processStep(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { proposalId: forReject.id, action: 'reject', reason: 'Chưa đủ điều kiện, cần thêm thời gian.' });
  const snapshotAfterReject = STATE.proposals.find(p => p.id === forReject.id).criteria_snapshot;
  check(JSON.stringify(snapshotAfterReject) === JSON.stringify(snapshotBeforeReject), 'CASE IMMUTABLE-4. reject() cũng KHÔNG sửa criteria_snapshot');

  // ================= SELF PROPOSAL =================
  const selfCreated = (await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'NV Kho tự đề xuất, có căn cứ đầy đủ', proposedGradeId: 'grade-B2', assessment: validAssessment })).proposal;
  check(selfCreated.status === 'pending', 'CASE SELF-1. Self-proposal với assessment đầy đủ -> tạo thành công (route đi thẳng Admin, không liên quan tới criteria)');
  const selfDetail = await getDetail(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { proposalId: selfCreated.id });
  check(!!selfDetail.criteriaSnapshot && selfDetail.criteriaSnapshot.groups.length === 1, 'CASE SELF-2. Self-proposal vẫn có criteriaSnapshot đầy đủ ở detail');
  await withdrawProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { proposalId: selfCreated.id, reason: 'Dọn state cho case sau' });

  // ================= PERMISSION REGRESSION =================
  // requirePropose() PHẢI đứng TRƯỚC bước resolve criteria — account không có
  // propose thì bị chặn ngay ở permission gate, KHÔNG lộ ra bất kỳ thông tin
  // nào về criteria/mapping (không leak "grade_not_mapped" cho người không có quyền).
  const permErr = await expectFail(createProposal(session('manager', { id: 'acc-noaccess', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Không có quyền propose', proposedGradeId: 'grade-B2', assessment: validAssessment }), 'KNL_PROPOSE_DENIED', 'CASE PERM-1. Account propose:false bị chặn ở permission gate TRƯỚC khi chạm tới criteria (không đổi thứ tự enforcement cũ)');
  check(permErr.statusCode === 403, 'CASE PERM-2. Lỗi permission trả đúng 403 (không lẫn với lỗi criteria 409/400)');

  // ================= NO RAW TECHNICAL/ENUM LEAK =================
  const allErrorMessages = [];
  for (const args of [
    [session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { employeeCode: 'NVKHO2', reason: 'leak-check-1', proposedGradeId: 'grade-B2', assessment: validAssessment }],
    [session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'leak-check-2', proposedGradeId: 'grade-B3', assessment: validAssessment }],
    [session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'leak-check-3', proposedGradeId: 'grade-B4', assessment: validAssessment }]
  ]) {
    try { await createProposal(args[0], args[1]); } catch (e) { allErrorMessages.push(e.message); }
  }
  check(allErrorMessages.length === 3, 'CASE LEAK-0. Đủ 3 lỗi mapping được thu thập để kiểm tra leak');
  check(allErrorMessages.every(m => !RAW_TECHNICAL_LEAK_PATTERN.test(m)), 'CASE LEAK-1. Không có thông điệp lỗi nào leak enum/kỹ thuật thô (postgres/pgrst/jsonb/column/relation/undefined/...) — toàn bộ là câu tiếng Việt nghiệp vụ');
  check(allErrorMessages.every(m => m.length > 10 && /[a-zA-ZÀ-ỹ]/.test(m)), 'CASE LEAK-2. Mọi thông điệp lỗi đều là câu có nghĩa, không rỗng/không phải mã lỗi thô');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
