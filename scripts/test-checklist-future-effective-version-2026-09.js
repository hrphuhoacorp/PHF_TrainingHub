'use strict';
/*
 * Regression — Daily Violation Criteria Version Consistency (2026-09-12).
 *
 * Proves the CANONICAL save-time resolver in lib/checklist-violations.js
 * (resolveAssignmentAt -> resolveTemplateVersionAt) picks the template version
 * by occurredDate vs checklist_template_versions.effective_date - NOT by
 * checklist_employee_assignments.template_version (a legacy/display pin that
 * can be stale, as PROD showed for PHF012: current_version already 1.5 while
 * the assignment row was still pinned at 1.3).
 *
 * Case A/B from the audit:
 *   - occurredDate BEFORE the new version's effective_date -> old version/criteria.
 *   - occurredDate ON/AFTER the new version's effective_date -> new version/criteria.
 *   - This holds even while assignment.template_version is still pinned at the
 *     OLD version (i.e. before any activation/repoint runs) - proving saved
 *     violations were never at risk from the stale-assignment display bug.
 *
 * Also proves the existing hard-reject stays intact: a client-submitted
 * template/version that does not match the canonical one is rejected
 * (409 CHECKLIST_TEMPLATE_VERSION_MISMATCH), never silently accepted.
 *
 * In-memory only. @supabase/supabase-js stubbed. No real Supabase.
 *   node scripts/test-checklist-future-effective-version-2026-09.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../api/_lib/checklist-violations');

function staticTable(getRows) {
  const filters = [];
  let limitN = null, wantSingle = false, order = null;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    order(field, opts) { order = { field, asc: !(opts && opts.ascending === false) }; return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (order) matched = matched.slice().sort((a, b) => {
          const x = a[order.field], y = b[order.field];
          return (x < y ? -1 : x > y ? 1 : 0) * (order.asc ? 1 : -1);
        });
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
function violationsTable() {
  const filters = [];
  let mode = 'select', upsertRows = null, wantSingle = false;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = rows; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && VIOLATION_ROWS.some(r => r.request_id === row.request_id);
            if (conflicts) continue;
            const saved = { id: 'v' + (seq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), record_status: 'official', ...row };
            VIOLATION_ROWS.push(saved);
            inserted.push(saved);
          }
          resolve({ data: inserted, error: null });
          return;
        }
        const matched = VIOLATION_ROWS.filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// PHF012-shape: assignment still pinned at the OLD version 'v1', exactly like the
// real PROD row (assignment_version=TBP-HCNS-1.3 while current_version was already 1.5).
// Widening activateTemplateVersion's repoint scope (Fix 2) is a separate, additive
// improvement - this test intentionally does NOT repoint the assignment, to prove the
// canonical resolver never needed it to be correct.
const ASSIGNMENTS = [
  { employee_id: 'ID-PHF012', employee_code: 'PHF012', employee_name: 'NV 012', department: 'HCNS', title: 'TBP', branch: 'VP', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: 'tpl-hcns', template_version: 'v1', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' }
];
const TEMPLATES = [
  { template_key: 'tpl-hcns', name: 'QTTH/HCNS – Trưởng bộ phận', status: 'active', template_type: 'checklist_detail', has_checklist: true }
];
// v2 effective 2026-10-01 (future relative to the 30/09 case) - mirrors Case B
// ("Apply next period") from the audit: nothing before that date may see v2 criteria.
const TEMPLATE_VERSIONS = [
  { template_key: 'tpl-hcns', version_no: 'v1', effective_date: '2026-07-01', created_at: '2026-07-01T00:00:00Z',
    definition: { groups: [{ children: [{ items: [ { code: 'OLD-01', content: 'Tiêu chí cũ', factor: 1, points: 2 } ] }] }] } },
  { template_key: 'tpl-hcns', version_no: 'v2', effective_date: '2026-10-01', created_at: '2026-09-12T00:00:00Z',
    definition: { groups: [{ children: [{ items: [ { code: 'NEW-01', content: 'Tiêu chí mới', factor: 1, points: 3 } ] }] }] } }
];
const GRANTS = [];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return violationsTable();
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticTable(() => []);
        if (table === 'checklist_templates') return staticTable(() => TEMPLATES);
        if (table === 'checklist_template_versions') return staticTable(() => TEMPLATE_VERSIONS);
        if (table === 'checklist_late_point_policies') return staticTable(() => []);
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_system_settings') return staticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
        return staticTable(() => []);
      },
      rpc() { return Promise.resolve({ data: null, error: new Error('RPC not mocked in this test') }); }
    })
  }
};

const { saveChecklistViolations } = require(violationsPath);
const admin = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' } };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function row(overrides) {
  return Object.assign({ employeeCode: 'PHF012', criterionCode: 'OLD-01', note: 'Ghi nhận lỗi kiểm thử future-effective' }, overrides);
}
// saveChecklistViolations() chỉ đọc lại {id,request_id,duplicate_fingerprint} sau upsert
// (xem checklist-violations.js:1498-1524) nên savedRows không mang template_version - đọc
// thẳng bảng mutable của mock (đúng dữ liệu THẬT SỰ đã ghi, bao gồm mọi cột canonical) thay
// vì suy đoán qua giá trị trả về hẹp của API.
function persistedRow(requestId) { return VIOLATION_ROWS.find(r => r.request_id === requestId); }

async function run() {
  console.log('== Case A/B: date-effective resolution independent of stale assignment.template_version ==');

  // 30/09 (before v2's 01/10 effective_date) -> must resolve OLD version/criteria,
  // even though assignment.template_version is a stale 'v1' pin (irrelevant here on purpose).
  const before = await saveChecklistViolations(admin, [row({ occurredDate: '2026-09-30', criterionCode: 'OLD-01', requestId: 'REQ-BEFORE' })]);
  check(before.saved === 1, 'occurredDate 30/09: 1 record saved');
  check(persistedRow('REQ-BEFORE').template_version === 'v1', 'occurredDate 30/09: resolves OLD version v1 (got ' + (persistedRow('REQ-BEFORE') || {}).template_version + ')');

  // 01/10 (on v2's effective_date) -> must resolve NEW version/criteria, WITHOUT
  // assignment.template_version ever being repointed to v2 in this test's fixture.
  const after = await saveChecklistViolations(admin, [row({ occurredDate: '2026-10-01', criterionCode: 'NEW-01', requestId: 'REQ-AFTER' })]);
  check(after.saved === 1, 'occurredDate 01/10: 1 record saved');
  check(persistedRow('REQ-AFTER').template_version === 'v2', 'occurredDate 01/10: resolves NEW version v2 despite assignment still pinned at v1 (got ' + (persistedRow('REQ-AFTER') || {}).template_version + ')');

  // Old criterion no longer exists in v2 -> submitting it for an on/after-effective date
  // must fail with CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE, not silently score it.
  let threwOldCriterion = null;
  try { await saveChecklistViolations(admin, [row({ occurredDate: '2026-10-02', criterionCode: 'OLD-01', requestId: 'REQ-OLD-CRIT-AFTER' })]); }
  catch (e) { threwOldCriterion = e; }
  check(threwOldCriterion && threwOldCriterion.code === 'CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE', 'old criterion after cutover -> CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE (got ' + (threwOldCriterion && threwOldCriterion.code) + ')');

  console.log('== Server hard-reject remains: stale/tampered client version is rejected, never silently saved ==');
  let threwMismatch = null;
  try {
    await saveChecklistViolations(admin, [row({
      occurredDate: '2026-10-05', criterionCode: 'NEW-01', requestId: 'REQ-MISMATCH',
      templateId: 'tpl-hcns', templateVersion: 'v1' // stale client UI still showing the old version
    })]);
  } catch (e) { threwMismatch = e; }
  check(threwMismatch && threwMismatch.code === 'CHECKLIST_TEMPLATE_VERSION_MISMATCH', 'client-submitted stale version v1 for a 01/10+ date -> 409 CHECKLIST_TEMPLATE_VERSION_MISMATCH (got ' + (threwMismatch && threwMismatch.code) + ')');
  check(VIOLATION_ROWS.filter(r => r.request_id === 'REQ-MISMATCH').length === 0, 'mismatch attempt wrote nothing');

  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
