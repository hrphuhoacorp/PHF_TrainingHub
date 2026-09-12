'use strict';
/*
 * Regression - frontend/backend parity for the same-day template-version tie-break
 * (2026-09-12). Same PHF012-shape fixture (qtth-hcns-thang: 1.2 eff 2026-08-01; 1.3/1.4/1.5
 * ALL eff 2026-09-12, created_at strictly increasing) run through BOTH:
 *   - the REAL frontend assignmentTemplateMeta() (extracted from
 *     assets/js/checklist/phf-checklist-app.js), and
 *   - the REAL backend canonical resolver (resolveAssignmentAt + resolveTemplateVersionAt in
 *     api/_lib/checklist-violations.js, via saveChecklistViolations()) - UNCHANGED by this fix.
 * Both must resolve TBP-HCNS-1.5 for occurredDate 2026-09-12.
 *
 *   node scripts/test-checklist-template-version-same-day-tiebreak-parity-2026-09.js
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

const CURRENT_ASSIGNMENTS = [
  { employee_key: 'phf012', employee_id: 'ID-PHF012', employee_code: 'PHF012', employee_name: 'PHF012', department: 'HCNS', title: 'TBP', branch: 'VP', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: 'qtth-hcns-thang', template_version: 'TBP-HCNS-1.5', effective_date: '2026-09-12', updated_at: '2026-09-12T10:00:00Z' }
];
const TEMPLATES = [
  { template_key: 'qtth-hcns-thang', code: 'HCNS', name: 'QTTH/HCNS – Trưởng bộ phận', group_name: 'HCNS', template_type: 'checklist_detail', has_checklist: true, source: '', note: '', status: 'active', current_version: 'TBP-HCNS-1.5', effective_date: '2026-09-12', updated_at: '2026-09-12T10:00:00Z' }
];
// Same-day tie: 1.3/1.4/1.5 all effective 2026-09-12, strictly increasing created_at.
const TEMPLATE_VERSIONS = [
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.2', effective_date: '2026-08-01', reason: 'seed', source_version: '', change_type: 'sync', definition: { groups: [{ children: [{ items: [{ code: 'OLD-01', content: 'Tiêu chí 1.2', factor: 1, points: 2 }] }] }] }, created_at: '2026-08-01T00:00:00Z' },
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.3', effective_date: '2026-09-12', reason: 'seed', source_version: 'TBP-HCNS-1.2', change_type: 'retro-copy', definition: { groups: [{ children: [{ items: [{ code: 'V13-01', content: 'Tiêu chí 1.3', factor: 1, points: 2 }] }] }] }, created_at: '2026-09-12T08:00:00Z' },
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.4', effective_date: '2026-09-12', reason: 'seed', source_version: 'TBP-HCNS-1.3', change_type: 'retro-copy', definition: { groups: [{ children: [{ items: [{ code: 'V14-01', content: 'Tiêu chí 1.4', factor: 1, points: 2 }] }] }] }, created_at: '2026-09-12T09:00:00Z' },
  { template_key: 'qtth-hcns-thang', version_no: 'TBP-HCNS-1.5', effective_date: '2026-09-12', reason: 'seed', source_version: 'TBP-HCNS-1.4', change_type: 'retro-copy', definition: { groups: [{ children: [{ items: [{ code: 'V15-01', content: 'Tiêu chí 1.5', factor: 1, points: 3 }] }] }] }, created_at: '2026-09-12T10:00:00Z' }
];

// ---------------------------------------------------------------------------
// Backend: real saveChecklistViolations() -> resolveAssignmentAt() + resolveTemplateVersionAt()
// ---------------------------------------------------------------------------
function staticTable(getRows) {
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
const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return violationsMutableTable();
        if (table === 'checklist_employee_assignments') return staticTable(() => CURRENT_ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticTable(() => []);
        if (table === 'checklist_templates') return staticTable(() => TEMPLATES);
        if (table === 'checklist_template_versions') return staticTable(() => TEMPLATE_VERSIONS);
        if (table === 'checklist_permission_grants') return staticTable(() => []);
        if (table === 'checklist_late_point_policies') return staticTable(() => []);
        if (table === 'checklist_system_settings') return staticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
        return staticTable(() => []);
      },
      rpc() { return Promise.resolve({ data: null, error: new Error('RPC not mocked') }); }
    })
  }
};
const { saveChecklistViolations } = require('../api/_lib/checklist-violations');

// ---------------------------------------------------------------------------
// Frontend: real assignmentTemplateMeta() extracted from phf-checklist-app.js
// ---------------------------------------------------------------------------
const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const app = fs.readFileSync(appPath, 'utf8');
function extractFnSource(name) {
  const startRe = new RegExp('function ' + name + '\\([^)]*\\)\\{');
  const sm = app.match(startRe);
  if (!sm) throw new Error('missing ' + name);
  let i = sm.index + sm[0].length, depth = 1;
  while (depth > 0 && i < app.length) { const ch = app[i]; if (ch === '{') depth++; else if (ch === '}') depth--; i++; }
  return app.slice(sm.index, i);
}
const FN_NAMES = ['normalizeText', 'checklistIsoDate', 'normalizeLegacyTemplateId', 'templateById', 'checklistTemplateDatabaseRow', 'checklistTemplateStatus', 'checklistTemplateStatusLabel', 'checklistTemplateCanAssign', 'checklistTemplateVersions', 'assignmentTemplateMeta'];
const FRONTEND_ROW = {
  version: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12', status: 'active', name: 'QTTH/HCNS – Trưởng bộ phận',
  // Same array shape/order as backend publicTemplate() delivers (created_at DESC).
  versions: TEMPLATE_VERSIONS.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(v => ({ version: v.version_no, effectiveDate: v.effective_date, createdAt: v.created_at, definition: v.definition }))
};
const shim =
  'var checklistTemplateDbState = { byId: { "qtth-hcns-thang": ' + JSON.stringify(FRONTEND_ROW) + ' } };\n' +
  'function ensureChecklistTemplatesHydrated(){}\n' +
  'function templateCatalog(){ return []; }\n';
const src = shim + FN_NAMES.map(extractFnSource).join('\n') + '\nmodule.exports = { assignmentTemplateMeta };';
const sandboxModule = new Module('checklist-tiebreak-parity-sandbox');
sandboxModule.paths = Module._nodeModulePaths(path.dirname(appPath));
sandboxModule._compile(src, path.join(path.dirname(appPath), '__checklist-tiebreak-parity-sandbox.js'));
const { assignmentTemplateMeta } = sandboxModule.exports;

async function run() {
  console.log('== Frontend/backend parity: same-day tie (1.3/1.4/1.5 all eff 2026-09-12) ==');

  const frontendMeta = assignmentTemplateMeta('qtth-hcns-thang', '2026-09-12');
  check(frontendMeta.version === 'TBP-HCNS-1.5', 'frontend assignmentTemplateMeta resolves TBP-HCNS-1.5 for 12/09 (got ' + frontendMeta.version + ')');

  const admin = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' } };
  const result = await saveChecklistViolations(admin, [{ employeeCode: 'PHF012', criterionCode: 'V15-01', occurredDate: '2026-09-12', note: 'Ghi nhận lỗi kiểm thử same-day tie-break', requestId: 'REQ-TIEBREAK-1209' }]);
  check(result.saved === 1, 'backend saves 1 record for 12/09');
  const persisted = VIOLATION_ROWS.find(r => r.request_id === 'REQ-TIEBREAK-1209');
  check(!!persisted && persisted.template_version === 'TBP-HCNS-1.5', 'backend resolveTemplateVersionAt resolves TBP-HCNS-1.5 for 12/09 (got ' + (persisted && persisted.template_version) + ')');

  check(frontendMeta.version === (persisted && persisted.template_version), 'PARITY: frontend and backend resolve the SAME version (' + frontendMeta.version + ') for the identical same-day-tie fixture/date');

  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
