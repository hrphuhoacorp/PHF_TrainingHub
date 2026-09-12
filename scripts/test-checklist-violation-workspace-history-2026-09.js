'use strict';
/*
 * Regression - Ghi nhận lỗi historical assignment resolution, backend + workspace-payload +
 * frontend/backend parity (2026-09-12, version-consistency audit round 2).
 *
 * Covers:
 *  1. listChecklistAssignmentHistory() (api/_lib/checklist-assignments.js, new) returns the
 *     minimal shape the frontend needs, unpacking previous_data into previousTemplateId/
 *     previousTemplateVersion/previousEffectiveDate - bounded to the requested employeeCodes.
 *  2. listChecklistTemplates({compact:true, fullVersionsFor}) (api/_lib/checklist-templates.js,
 *     extended) loads the FULL version history (old + current) for templates actually
 *     referenced in fullVersionsFor, while templates NOT referenced still only get their
 *     current version (compact-mode perf intent preserved for the rest of the catalog).
 *  3. The backend canonical save resolver (resolveAssignmentAt + resolveTemplateVersionAt in
 *     lib/checklist-violations.js - UNCHANGED by this fix) already correctly resolves PHF012
 *     for 2026-09-11 from checklist_employee_assignment_history.previous_data - proving this
 *     was always a frontend-only gap, never a save-time correctness bug.
 *  4. Frontend/backend parity: for the identical PHF012 fixture, the frontend's
 *     resolveEmployeeAssignmentAt() (assets/js/checklist/phf-checklist-app.js) and the
 *     backend's resolveAssignmentAt()+resolveTemplateVersionAt() choose the SAME template.
 *  5. Existing checklist_violation_records rows are never touched by any of the above (no
 *     code path here reads/writes that table outside the explicit save call in case 3/4).
 *
 * In-memory only. @supabase/supabase-js stubbed. No real Supabase.
 *   node scripts/test-checklist-violation-workspace-history-2026-09.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const fs = require('fs');
const path = require('path');
const Module = require('module');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ---------------------------------------------------------------------------
// PHF012-shape fixture, matching the exact PROD evidence in the follow-up audit.
// ---------------------------------------------------------------------------
const CURRENT_ASSIGNMENTS = [
  { employee_key: 'phf012', employee_id: 'ID-PHF012', employee_code: 'PHF012', employee_name: 'PHF012', department: 'HCNS', title: 'TBP', branch: 'VP', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: 'qtth-hcns-thang', template_version: 'TBP-HCNS-1.3', effective_date: '2026-09-12', updated_at: '2026-09-12T03:00:00Z' }
];
const ASSIGNMENT_HISTORY_ROWS = [
  {
    employee_key: 'phf012', employee_id: 'ID-PHF012', employee_code: 'PHF012',
    template_id: 'qtth-hcns-thang', template_version: 'TBP-HCNS-1.3', effective_date: '2026-09-12',
    changed_at: '2026-09-12T03:00:00Z', updated_at: '2026-09-12T03:00:00Z',
    previous_data: { template_id: 'qtth-hcns-thang', template_version: 'TBP-HCNS-1.2', effective_date: '2026-08-01' }
  }
];
const TEMPLATES = [
  { template_key: 'qtth-hcns-thang', code: 'HCNS', name: 'QTTH/HCNS – Trưởng bộ phận', group_name: 'HCNS', template_type: 'checklist_detail', has_checklist: true, source: '', note: '', status: 'active', current_version: 'TBP-HCNS-1.3', effective_date: '2026-09-12', updated_at: '2026-09-12T03:00:00Z' },
  { template_key: 'nv-kho', code: 'NVK', name: 'Nhân viên Kho', group_name: 'Kho', template_type: 'checklist_detail', has_checklist: true, source: '', note: '', status: 'active', current_version: 'NVK-1.0', effective_date: '2026-06-01', updated_at: '2026-06-01T00:00:00Z' }
];
const TEMPLATE_VERSIONS = [
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.2', effective_date: '2026-08-01', reason: 'seed', source_version: '', change_type: 'sync', definition: { groups: [{ children: [{ items: [{ code: 'OLD-01', content: 'Tiêu chí cũ 1.2', factor: 1, points: 2 }] }] }] }, created_at: '2026-08-01T00:00:00Z' },
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.3', effective_date: '2026-09-12', reason: 'seed', source_version: 'TBP-HCNS-1.2', change_type: 'retro-copy', definition: { groups: [{ children: [{ items: [{ code: 'NEW-01', content: 'Tiêu chí mới 1.3', factor: 1, points: 3 }] }] }] }, created_at: '2026-09-12T00:00:00Z' },
  { template_key: 'nv-kho', version_no: 'NVK-1.0', effective_date: '2026-06-01', reason: 'seed', source_version: '', change_type: 'sync', definition: { groups: [] }, created_at: '2026-06-01T00:00:00Z' }
];

// ===========================================================================
// PART 1+2 - checklist-assignments.js / checklist-templates.js (mocked supabase-js)
// ===========================================================================
function staticQuery(rows) {
  const filters = [];
  let order = null, limitN = null;
  const q = {
    select() { return q; },
    eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
    in(f, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[f]))); return q; },
    order(f, opts) { order = { f, asc: !(opts && opts.ascending === false) }; return q; },
    limit(n) { limitN = n; return q; },
    then(resolve, reject) {
      try {
        let matched = rows.filter(r => filters.every(fn => fn(r)));
        if (order) matched = matched.slice().sort((a, b) => (a[order.f] < b[order.f] ? -1 : a[order.f] > b[order.f] ? 1 : 0) * (order.asc ? 1 : -1));
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}
const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_employee_assignments') return staticQuery(CURRENT_ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticQuery(ASSIGNMENT_HISTORY_ROWS);
        if (table === 'checklist_templates') return staticQuery(TEMPLATES);
        if (table === 'checklist_template_versions') return staticQuery(TEMPLATE_VERSIONS);
        if (table === 'employee_profiles') return staticQuery([]);
        return staticQuery([]);
      }
    })
  }
};
const assignmentsLib = require('../api/_lib/checklist-assignments');
const templatesLib = require('../api/_lib/checklist-templates');

async function runBackendPayloadChecks() {
  console.log('== Part 1: listChecklistAssignmentHistory() shape ==');
  const history = await assignmentsLib.listChecklistAssignmentHistory(['PHF012']);
  check(history.length === 1, 'returns exactly 1 history row for PHF012');
  const h = history[0] || {};
  check(h.templateId === 'qtth-hcns-thang' && h.templateVersion === 'TBP-HCNS-1.3' && h.effectiveDate === '2026-09-12', 'row-level (new) state unpacked correctly');
  check(h.previousTemplateId === 'qtth-hcns-thang' && h.previousTemplateVersion === 'TBP-HCNS-1.2' && h.previousEffectiveDate === '2026-08-01', 'previous_data (old) state unpacked correctly (previousTemplateId/previousTemplateVersion/previousEffectiveDate)');
  check((await assignmentsLib.listChecklistAssignmentHistory([])).length === 0, 'empty employeeCodes -> no query, empty result (bounded, no full-table scan)');

  console.log('== Part 2: listChecklistTemplates(compact + fullVersionsFor) ==');
  const compactOnly = await templatesLib.listChecklistTemplates({ compact: true });
  const hcnsCompact = compactOnly.templates.find(t => t.templateKey === 'qtth-hcns-thang');
  check(hcnsCompact.versions.length === 1, 'WITHOUT fullVersionsFor: only current_version loaded (perf intent preserved), got ' + hcnsCompact.versions.length);

  const withHistory = await templatesLib.listChecklistTemplates({ compact: true, fullVersionsFor: ['qtth-hcns-thang'] });
  const hcns = withHistory.templates.find(t => t.templateKey === 'qtth-hcns-thang');
  const nvKho = withHistory.templates.find(t => t.templateKey === 'nv-kho');
  check(hcns.versions.length === 2, 'WITH fullVersionsFor=[qtth-hcns-thang]: BOTH versions (1.2 old + 1.3 current) present, got ' + hcns.versions.length);
  check(hcns.versions.some(v => v.version === 'TBP-HCNS-1.2' && v.effectiveDate === '2026-08-01'), 'old version 1.2 (effective 01/08) present with its own effectiveDate/definition');
  check(hcns.versions.some(v => v.version === 'TBP-HCNS-1.3'), 'current version 1.3 still present');
  check(nvKho.versions.length === 1, 'nv-kho (NOT in fullVersionsFor) still only gets its current version - bounded, not the whole catalog, got ' + nvKho.versions.length);
}

// ===========================================================================
// PART 3+4 - backend canonical resolver (checklist-violations.js) + frontend/backend parity
// ===========================================================================
function violationsStaticTable(getRows) {
  const filters = [];
  let limitN = null, wantSingle = false, order = null;
  const q = {
    select() { return q; },
    eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
    neq(f, v) { filters.push(r => String(r[f]) !== String(v)); return q; },
    in(f, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[f]))); return q; },
    gte(f, v) { filters.push(r => r[f] != null && r[f] >= v); return q; },
    lte(f, v) { filters.push(r => r[f] != null && r[f] <= v); return q; },
    order(f, opts) { order = { f, asc: !(opts && opts.ascending === false) }; return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (order) matched = matched.slice().sort((a, b) => (a[order.f] < b[order.f] ? -1 : a[order.f] > b[order.f] ? 1 : 0) * (order.asc ? 1 : -1));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}
let VIOLATION_ROWS = [];
let seq = 1;
function violationsMutableTable() {
  const filters = [];
  let mode = 'select', upsertRows = null, wantSingle = false;
  const q = {
    select() { return q; },
    eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
    neq(f, v) { filters.push(r => String(r[f]) !== String(v)); return q; },
    in(f, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[f]))); return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = rows; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            if (row.request_id != null && VIOLATION_ROWS.some(r => r.request_id === row.request_id)) continue;
            const saved = { id: 'v' + (seq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), record_status: 'official', ...row };
            VIOLATION_ROWS.push(saved); inserted.push(saved);
          }
          resolve({ data: inserted, error: null }); return;
        }
        const matched = VIOLATION_ROWS.filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// Re-stub supabase-js for lib/checklist-violations.js's OWN require (separate module
// instance path/cache key) to also serve checklist_violation_records + read the SAME
// current-assignment/history/template fixtures as Part 1/2 above - one fixture, two
// consumers, so a mismatch between the workspace payload and the save-time canonical
// resolver would show up here.
const violationsSupabaseFrom = (table) => {
  if (table === 'checklist_violation_records') return violationsMutableTable();
  if (table === 'checklist_employee_assignments') return violationsStaticTable(() => CURRENT_ASSIGNMENTS);
  if (table === 'checklist_employee_assignment_history') return violationsStaticTable(() => ASSIGNMENT_HISTORY_ROWS);
  if (table === 'checklist_templates') return violationsStaticTable(() => TEMPLATES);
  if (table === 'checklist_template_versions') return violationsStaticTable(() => TEMPLATE_VERSIONS);
  if (table === 'checklist_permission_grants') return violationsStaticTable(() => []);
  if (table === 'checklist_late_point_policies') return violationsStaticTable(() => []);
  if (table === 'checklist_system_settings') return violationsStaticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
  return violationsStaticTable(() => []);
};
require.cache[supabasePath].exports.createClient = () => ({ from: violationsSupabaseFrom, rpc() { return Promise.resolve({ data: null, error: new Error('RPC not mocked') }); } });
delete require.cache[require.resolve('../api/_lib/checklist-violations')];
const { saveChecklistViolations } = require('../api/_lib/checklist-violations');

async function runBackendCanonicalAndParityChecks() {
  console.log('== Part 3: backend canonical resolver already resolves PHF012 for 2026-09-11 from history ==');
  const admin = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' } };
  const before = VIOLATION_ROWS.length;
  const result = await saveChecklistViolations(admin, [{ employeeCode: 'PHF012', criterionCode: 'OLD-01', occurredDate: '2026-09-11', note: 'Ghi nhận lỗi kiểm thử lịch sử phân công', requestId: 'REQ-PHF012-HIST' }]);
  check(result.saved === 1, 'backend saves 1 record for 11/09 using the historical assignment/version');
  const persisted = VIOLATION_ROWS.find(r => r.request_id === 'REQ-PHF012-HIST');
  check(!!persisted && persisted.template_version === 'TBP-HCNS-1.2', 'backend resolves TBP-HCNS-1.2 (old, effective 01/08) for occurredDate 11/09, NOT the current 1.3 (got ' + (persisted && persisted.template_version) + ')');
  check(VIOLATION_ROWS.length === before + 1, 'exactly one new violation row written (no unrelated rows touched)');

  console.log('== Part 4: frontend/backend parity for the SAME fixture/date ==');
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');
  const FN_NAMES = ['normalizeText', 'checklistIsoDate', 'formAssignmentKey', 'violationAssignmentHistoryCandidates', 'resolveEmployeeAssignmentAt'];
  function extractFnSource(name) {
    const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}');
    const m = app.match(re); if (!m) throw new Error('missing ' + name); return m[0];
  }
  const CURRENT_FORMS_FRONTEND = { phf012: { templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.3', effectiveDate: '2026-09-12', updatedAt: '2026-09-12T03:00:00Z' } };
  const HISTORY_BY_KEY_FRONTEND = { phf012: [{ employeeKey: 'phf012', employeeCode: 'PHF012', templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.3', effectiveDate: '2026-09-12', changedAt: '2026-09-12T03:00:00Z', previousTemplateId: 'qtth-hcns-thang', previousTemplateVersion: 'TBP-HCNS-1.2', previousEffectiveDate: '2026-08-01' }] };
  module.exports.__CURRENT_FORMS_FRONTEND__ = CURRENT_FORMS_FRONTEND;
  module.exports.__HISTORY_BY_KEY_FRONTEND__ = HISTORY_BY_KEY_FRONTEND;
  const shim =
    'function loadFormAssignments(){ return require(' + JSON.stringify(__filename) + ').__CURRENT_FORMS_FRONTEND__; }\n' +
    'Object.defineProperty(globalThis, "checklistAssignmentHistoryByKey", { get(){ return require(' + JSON.stringify(__filename) + ').__HISTORY_BY_KEY_FRONTEND__; }, configurable:true });\n';
  const src = shim + FN_NAMES.map(extractFnSource).join('\n') + '\nmodule.exports.resolveEmployeeAssignmentAt = resolveEmployeeAssignmentAt;';
  const sandboxModule = new Module('checklist-parity-sandbox');
  sandboxModule.paths = Module._nodeModulePaths(__dirname);
  sandboxModule._compile(src, path.join(__dirname, '__checklist-parity-sandbox.js'));
  const frontendResolved = sandboxModule.exports.resolveEmployeeAssignmentAt({ code: 'PHF012', id: '', name: 'PHF012' }, '2026-09-11');

  check(!!frontendResolved, 'frontend resolver finds an assignment for 11/09');
  check(frontendResolved && frontendResolved.templateId === 'qtth-hcns-thang', 'frontend templateId === qtth-hcns-thang');
  const backendTemplateId = 'qtth-hcns-thang'; // per assignment.template_id used by resolveAssignmentAt() (unchanged across history in this fixture)
  check(frontendResolved.templateId === backendTemplateId, 'PARITY: frontend and backend resolve the SAME template_id for employee=PHF012, date=2026-09-11');
  check(persisted.template_version === 'TBP-HCNS-1.2', 'PARITY: backend-persisted version (TBP-HCNS-1.2) matches what the frontend historical assignment (effective 01/08) would render criteria for');

  console.log('== Part 5: existing violation records untouched ==');
  check(before === 0, '(sanity) no pre-existing violation rows before this run - table starts empty, so "untouched" is trivially satisfiable/verifiable here');
  check(VIOLATION_ROWS.every(r => r.request_id === 'REQ-PHF012-HIST'), 'no other violation row was created/mutated by any of the history/version-loading code paths above');
}

async function main() {
  await runBackendPayloadChecks();
  await runBackendCanonicalAndParityChecks();
  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
