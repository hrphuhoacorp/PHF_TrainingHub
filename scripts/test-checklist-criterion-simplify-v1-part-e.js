'use strict';
/*
 * Regression — Checklist Criterion Simplify V1 — Part E (monthly snapshot source-of-truth
 * fix) + Part F (existing-form snapshot preservation).
 *
 * Root cause fixed: buildMonthlyCreationState() (api/_lib/checklist-monthly.js) used to
 * resolve a NEW form's template version from the EMPLOYEE ASSIGNMENT's frozen
 * template_version pin — set once, at "Gán mẫu Checklist" time, and never touched again by
 * Criterion Admin (ce.../cePublish) or the Bảng tổng điểm auto-activate flow, both of which
 * only ever promote checklist_templates.current_version. So a NEW monthly form created after
 * an admin criteria/scorecard edit could silently snapshot the OLD, stale pinned version even
 * though the template's current_version had already moved on — contradicting the locked
 * product rule that a new period always reflects what's currently applied.
 *
 * Fix: buildMonthlyCreationState() now resolves version PRIMARILY from the matched
 * template's own current_version (looked up within eligibleVersions, still bounded by
 * effective_date <= period end), falling back to the assignment-pinned version, then to the
 * latest eligible version — exactly mirroring the missing[] failure-reporting shape.
 *
 * Covers spec items 9, 10, 11, 12 (backend half) from the task spec's Part H:
 *  9. New monthly form creation: assignment pinned OLD, template current_version NEWER ->
 *     new snapshot uses the NEW version's definition (the acceptance example: assignment
 *     'KTT 2.0', current_version 'KTT 2.3' -> new form's template_snapshot.version.version_no
 *     must be 'KTT 2.3').
 *  10. Existing monthly form with an OLD snapshot: source template updated AFTERWARD ->
 *      existing form's template_snapshot remains byte-for-byte unchanged after a subsequent
 *      sync/reconcile call.
 *  11. Sync/reconcile run twice (once before, once after a template change) never silently
 *      overwrites the FIRST-created form.
 *  12. (backend half) createMonthly()/syncMonthlyCycle() structurally cannot invoke any
 *      retroactive-apply RPC — checklist-monthly.js only requires the pure
 *      checklist-template-retroactive helpers (diffDefinitions/classifyFormForApply), never
 *      checklist-template-retroactive-service.js (where retroactiveApply/
 *      resnapshotMonthlyDraftTemplate/activateTemplateVersion actually live).
 *
 * Same offline convention as scripts/test-checklist-monthly-cycle-snapshot-immutable.js: real
 * api/_lib/checklist-monthly.js loaded with @supabase/supabase-js stubbed in-memory. Zero
 * network/DB I/O; nothing here ever touches PROD or SANDBOX.
 *
 *   node scripts/test-checklist-criterion-simplify-v1-part-e.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function nextId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }
function nowIso() { return new Date().toISOString(); }

const TEMPLATE_KEY = 'ktt-test';
const ASSIGNMENT = {
  employee_key: 'e50', employee_id: 'id-e50', employee_code: 'E50', employee_name: 'NV Năm Mươi',
  department: 'KTT', title: 'Kế toán trưởng', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý',
  employee_status: 'Đang làm việc', template_id: TEMPLATE_KEY,
  template_version: 'KTT 2.0', // pinned at "Gán mẫu Checklist" time — deliberately STALE
  effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z'
};
const DEF_2_0 = { templateType: 'score_summary', groups: [], totalRows: [{ code: 'C1', content: 'Doanh số', target: 10, weight: 100, unit: '' }] };
const DEF_2_3 = { templateType: 'score_summary', groups: [], totalRows: [{ code: 'C1', content: 'Doanh số (đã cập nhật)', target: 12, weight: 100, unit: '' }] };

function freshStore() {
  return {
    checklist_templates: [{ template_key: TEMPLATE_KEY, id: 'tpl-1', updated_at: '2020-01-01T00:00:00Z', current_version: 'KTT 2.3' }],
    checklist_template_versions: [
      { template_key: TEMPLATE_KEY, version_no: 'KTT 2.0', id: 'ver-20', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z', definition: DEF_2_0 },
      { template_key: TEMPLATE_KEY, version_no: 'KTT 2.3', id: 'ver-23', effective_date: '2020-02-01', created_at: '2020-02-01T00:00:00Z', definition: DEF_2_3 }
    ],
    checklist_employee_assignments: [clone(ASSIGNMENT)],
    checklist_employee_assignment_history: [],
    checklist_monthly_periods: [],
    checklist_monthly_forms: [],
    checklist_monthly_form_history: [],
    checklist_violation_records: [],
    checklist_monthly_score_policies: [],
    checklist_system_settings: [],
    checklist_monthly_period_overrides: [],
    checklist_monthly_kpi_configs: []
  };
}

function makeFakeQuery(store) {
  return class FakeQuery {
    constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; this._patch = null; this._order = []; }
    select(_fields, opts) { if (opts && opts.count) this._count = true; return this; }
    eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
    neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
    in(col, arr) { const set = new Set((arr || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
    gte(col, val) { this.filters.push(row => String(row[col] || '') >= String(val)); return this; }
    lte(col, val) { this.filters.push(row => String(row[col] || '') <= String(val)); return this; }
    order(col, opts) { this._order.push({ col, asc: !(opts && opts.ascending === false) }); return this; }
    limit(n) { this._limit = n; return this; }
    range(a, b) { this._range = [a, b]; return this; }
    maybeSingle() { this._single = 'maybe'; return this; }
    single() { this._single = 'strict'; return this; }
    update(patch) { this._patch = patch; return this; }
    then(resolve, reject) {
      const table = store[this.table] || (store[this.table] = []);
      const matchedRefs = table.filter(row => this.filters.every(f => f(row)));
      if (this._patch) matchedRefs.forEach(row => Object.assign(row, this._patch));
      let rows = clone(matchedRefs);
      this._order.forEach(o => { rows.sort((a, b) => { const x = a[o.col], y = b[o.col]; return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1); }); });
      if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
      else if (this._limit != null) rows = rows.slice(0, this._limit);
      let payload;
      if (this._single === 'maybe') payload = { data: rows[0] || null, error: null };
      else if (this._single === 'strict') payload = rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } };
      else payload = { data: rows, error: null };
      if (this._count) payload.count = matchedRefs.length;
      return Promise.resolve(payload).then(resolve, reject);
    }
  };
}
function makeFakeRpc(store) {
  return async function fakeRpc(name, p) {
    if (name === 'phf_create_checklist_monthly') {
      const periods = store.checklist_monthly_periods;
      let period = periods.find(x => x.period_month === p.p_period_month);
      if (!period) {
        period = { id: nextId('period'), period_month: p.p_period_month, status: 'draft', created_by: p.p_actor_id, created_by_name: p.p_actor_name, score_policy_snapshot: p.p_score_policy || {}, cycle_policy_snapshot: null, source_period_month: null, auto_created: false, synced_at: null, self_open_at: null, self_due_at: null, review_open_at: null, review_due_at: null, scheduled_lock_at: null, updated_at: nowIso() };
        periods.push(period);
      } else if (period.status !== 'draft') {
        return { data: { ok: false, code: 'CHECKLIST_MONTHLY_NOT_DRAFT', message: 'Kỳ đánh giá đã mở hoặc đã khóa.' }, error: null };
      }
      let created = 0, skipped = 0;
      const forms = store.checklist_monthly_forms;
      // Faithful re-implementation of the RPC's own idempotency guarantee: an employee who
      // ALREADY has a form for this period is SKIPPED, never re-created/overwritten — this
      // is the safety net the Part E fix must never route around.
      (p.p_forms || []).forEach(item => {
        const code = String(item.employee_code || '').toUpperCase();
        const exists = forms.find(f => f.period_month === p.p_period_month && f.employee_code === code);
        if (exists) { skipped++; return; }
        forms.push({
          id: nextId('form'), period_id: period.id, period_month: p.p_period_month,
          employee_id: item.employee_id || '', employee_code: code, employee_name: item.employee_name || '',
          department: item.department || '', title: item.title || '', branch: item.branch || '',
          reviewer_id: item.reviewer_id || '', reviewer_code: item.reviewer_code || '', reviewer_name: item.reviewer_name || '',
          template_id: item.template_id || '', template_version: item.template_version || '',
          template_snapshot: clone(item.template_snapshot || {}),
          score_policy_snapshot: item.score_policy_snapshot || period.score_policy_snapshot || {},
          checklist_score: item.checklist_score == null ? 100 : item.checklist_score,
          status: item.status || 'draft', updated_at: nowIso()
        });
        created++;
      });
      return { data: { ok: true, periodId: period.id, created, skipped }, error: null };
    }
    return { data: null, error: { message: 'RPC không được mock trong test này: ' + name } };
  };
}
function loadMonthlyLib(store) {
  const originalLoad = Module._load;
  const FakeQuery = makeFakeQuery(store);
  const fakeRpc = makeFakeRpc(store);
  Module._load = function (request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return { createClient: () => ({ from: table => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
    }
    return originalLoad.apply(this, arguments);
  };
  const modulePath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
  delete require.cache[modulePath];
  const lib = require(modulePath);
  Module._load = originalLoad;
  return lib;
}

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };
const PERIOD = '2020-03'; // arbitrary period safely within both versions' effective_date

let failures = 0, passed = 0;
async function rec(name, fn) {
  try { await fn(); console.log('✓ PASS -', name); passed++; }
  catch (err) { failures++; console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n   ') : err)); }
}

async function main() {
  // -------------------------------------------------------------------
  // ITEM 9 — new form creation uses the template's CURRENT version, not the stale
  // assignment pin. Exact acceptance example from the task spec.
  // -------------------------------------------------------------------
  await rec('ITEM 9 — assignment pinned to KTT 2.0, template current_version KTT 2.3 -> new form snapshot uses KTT 2.3', async () => {
    const store = freshStore();
    const lib = loadMonthlyLib(store);
    assert.strictEqual(store.checklist_employee_assignments[0].template_version, 'KTT 2.0', 'sanity: assignment really is pinned to the OLD version');
    assert.strictEqual(store.checklist_templates[0].current_version, 'KTT 2.3', 'sanity: template current_version really is the NEWER one');
    const result = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(result.created, 1, 'exactly one new form created');
    const form = store.checklist_monthly_forms.find(f => f.employee_code === 'E50' && f.period_month === PERIOD);
    assert.ok(form, 'the new form exists');
    assert.strictEqual(form.template_version, 'KTT 2.3', 'form.template_version reflects the CURRENT template version, not the stale assignment pin (KTT 2.0)');
    assert.strictEqual(form.template_snapshot.version.version_no, 'KTT 2.3', 'template_snapshot.version.version_no === "KTT 2.3" — the exact acceptance criterion from the task spec');
    assert.deepStrictEqual(form.template_snapshot.version.definition, DEF_2_3, 'the snapshot carries the NEW definition content (updated criteria), not the stale one');
  });

  // -------------------------------------------------------------------
  // ITEM 9b — sanity control: when the assignment pin already matches current_version
  // (the common/no-bug case), behavior is unchanged.
  // -------------------------------------------------------------------
  await rec('ITEM 9b — control: assignment pin already equals current_version -> unchanged, still resolves correctly', async () => {
    const store = freshStore();
    store.checklist_employee_assignments[0].template_version = 'KTT 2.3';
    const lib = loadMonthlyLib(store);
    const result = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(result.created, 1);
    const form = store.checklist_monthly_forms.find(f => f.employee_code === 'E50');
    assert.strictEqual(form.template_version, 'KTT 2.3');
  });

  // -------------------------------------------------------------------
  // ITEM 9c — fallback: current_version not yet effective for this period (effective_date
  // > period end) -> falls back to the assignment-pinned version (never fabricates).
  // -------------------------------------------------------------------
  await rec('ITEM 9c — current_version not yet effective for this period -> falls back to assignment-pinned eligible version', async () => {
    const store = freshStore();
    store.checklist_template_versions.find(v => v.version_no === 'KTT 2.3').effective_date = '2099-01-01'; // far future, not eligible
    const lib = loadMonthlyLib(store);
    const result = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(result.created, 1);
    const form = store.checklist_monthly_forms.find(f => f.employee_code === 'E50');
    assert.strictEqual(form.template_version, 'KTT 2.0', 'current_version (KTT 2.3) is not yet eligible for this period -> falls back to the assignment-pinned version (KTT 2.0), never fabricates a version');
  });

  // -------------------------------------------------------------------
  // ITEM 10 + 11 — existing form snapshot is frozen and untouched by a later sync, even
  // after the source template changes again.
  // -------------------------------------------------------------------
  await rec('ITEM 10/11 — existing form template_snapshot is byte-for-byte unchanged after a subsequent sync, even after the template changes again', async () => {
    const store = freshStore();
    const lib = loadMonthlyLib(store);
    const firstRun = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(firstRun.created, 1, 'first sync creates the form');
    const formAfterFirstRun = store.checklist_monthly_forms.find(f => f.employee_code === 'E50' && f.period_month === PERIOD);
    const snapshotBefore = clone(formAfterFirstRun.template_snapshot);
    assert.strictEqual(snapshotBefore.version.version_no, 'KTT 2.3');

    // Template changes AGAIN after the form already exists (e.g. another Criterion Admin
    // edit or scorecard save promotes current_version further) — this must NEVER reach back
    // into the already-created form.
    store.checklist_template_versions.push({ template_key: TEMPLATE_KEY, version_no: 'KTT 2.4', id: 'ver-24', effective_date: '2020-02-15', created_at: '2020-02-15T00:00:00Z', definition: { templateType: 'score_summary', groups: [], totalRows: [{ code: 'C1', content: 'Doanh số (2.4)', target: 15, weight: 100, unit: '' }] } });
    store.checklist_templates[0].current_version = 'KTT 2.4';

    const secondRun = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(secondRun.created, 0, 'second sync creates NOTHING new — the RPC idempotency guard (skippedExisting) already covers this employee/period');
    assert.strictEqual(secondRun.skippedExisting, 1, 'the existing form for E50/2020-03 is correctly reported as skipped, not silently dropped');

    const formAfterSecondRun = store.checklist_monthly_forms.find(f => f.employee_code === 'E50' && f.period_month === PERIOD);
    assert.strictEqual(store.checklist_monthly_forms.filter(f => f.employee_code === 'E50' && f.period_month === PERIOD).length, 1, 'still exactly ONE form for this employee/period — no duplicate row');
    assert.deepStrictEqual(formAfterSecondRun.template_snapshot, snapshotBefore, 'template_snapshot is byte-for-byte unchanged — still pinned at KTT 2.3, NOT silently upgraded to KTT 2.4');
    assert.strictEqual(formAfterSecondRun.template_version, 'KTT 2.3', 'template_version column also unchanged');
  });

  // -------------------------------------------------------------------
  // ITEM 11b — a brand NEW employee joining in between the two syncs still correctly
  // gets the LATEST current_version at the time of the second sync (Part E fix keeps
  // working for genuinely new rows, only the FIRST-created form is frozen).
  // -------------------------------------------------------------------
  await rec('ITEM 11b — a second sync still creates a correct NEW form for a newly-assigned employee, using the version current at THAT time', async () => {
    const store = freshStore();
    const lib = loadMonthlyLib(store);
    await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    store.checklist_templates[0].current_version = 'KTT 2.3'; // already true from freshStore(), kept explicit for clarity
    store.checklist_employee_assignments.push({ ...clone(ASSIGNMENT), employee_key: 'e51', employee_id: 'id-e51', employee_code: 'E51', employee_name: 'NV Năm Mốt', template_version: 'KTT 2.0' });
    const secondRun = await lib.createMonthly(ADMIN_SESSION, { month: PERIOD });
    assert.strictEqual(secondRun.created, 1, 'exactly one new form for the newly-assigned employee');
    assert.strictEqual(secondRun.skippedExisting, 1, 'the pre-existing E50 form is still correctly skipped');
    const newForm = store.checklist_monthly_forms.find(f => f.employee_code === 'E51');
    assert.strictEqual(newForm.template_version, 'KTT 2.3', 'the new employee correctly gets the current version, unaffected by the frozen E50 form');
  });

  // -------------------------------------------------------------------
  // ITEM 12 (backend half) — structural proof: checklist-monthly.js cannot invoke any
  // retroactive-apply RPC (it never even requires the module where those live).
  // -------------------------------------------------------------------
  await rec('ITEM 12 (backend) — checklist-monthly.js does not require checklist-template-retroactive-service.js (where retroactiveApply/activateTemplateVersion/resnapshot live)', () => {
    const monthlySource = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'), 'utf8');
    assert.ok(!/checklist-template-retroactive-service/.test(monthlySource), 'checklist-monthly.js never requires the retroactive-service module — createMonthly()/syncMonthlyCycle() cannot call retroactiveApply/activateTemplateVersion/resnapshotMonthlyDraftTemplate even indirectly');
    assert.ok(/require\(['"]\.\/checklist-template-retroactive['"]\)/.test(monthlySource), 'it only requires the PURE diff/classify helper module (checklist-template-retroactive.js, no RPC calls, no side effects)');
  });

  console.log('\n=== Kết quả ===');
  console.log(passed + '/' + (passed + failures) + ' bước PASS.');
  console.log('Toàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  if (failures) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
