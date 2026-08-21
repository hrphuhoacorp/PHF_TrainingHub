'use strict';
/*
 * Regression Test
 * Checklist Monthly — syncMonthlyCycle() không được ghi đè cycle_policy_snapshot/window
 * của một kỳ ĐÃ TỒN TẠI bằng global config hiện hành (Fix P1 #2).
 * In-memory only — No Production Database — Safe for future verification.
 *
 * Bối cảnh: Codex audit xác nhận syncMonthlyCycle() (lib/checklist-monthly.js) trước đây
 * luôn lấy CURRENT global cycle policy và ghi đè cycle_policy_snapshot + window
 * (self_open_at/self_due_at/review_open_at/review_due_at/scheduled_lock_at) của MỌI kỳ,
 * kể cả kỳ đã tồn tại từ trước. Batch này chỉ sửa syncMonthlyCycle() để snapshot của một
 * kỳ đã tồn tại được "chụp" một lần và giữ nguyên qua các lần sync sau, trong khi kỳ mới
 * vẫn nhận đúng global config tại thời điểm tạo, và override tường minh theo kỳ vẫn hoạt động.
 *
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ (chặn @supabase/supabase-js bằng
 * Module._load), KHÔNG kết nối Supabase thật, KHÔNG đổi logic nghiệp vụ nào khác.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-cycle-snapshot-immutable.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function nextId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }
function nowIso() { return new Date().toISOString(); }

const MONTHLY_CYCLE_SETTING_KEY = 'monthly_cycle_policy';

// ---------- 1. Chính sách toàn cục A / B / C dùng xuyên suốt test ----------
const POLICY_A = { autoCreateEnabled: true, sourceMode: 'previous_period', createDay: 1, createTime: '00:05', selfStartDay: 1, selfEndDay: 3, reviewStartDay: 1, reviewEndDay: 4, lockDay: 4, lockTime: '23:59', effectiveFromPeriod: '2026-08', updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'Admin A', reason: 'Cấu hình A ban đầu' };
const POLICY_B = { ...POLICY_A, selfStartDay: 5, selfEndDay: 7, reviewStartDay: 5, reviewEndDay: 8, lockDay: 9, lockTime: '18:00', updatedAt: '2026-02-01T00:00:00Z', updatedBy: 'Admin B', reason: 'Cấu hình B chuẩn bị kỳ sau' };
const POLICY_C_GLOBAL = { ...POLICY_A, selfStartDay: 20, selfEndDay: 22, reviewStartDay: 20, reviewEndDay: 23, lockDay: 25, lockTime: '10:00', updatedAt: '2026-03-01T00:00:00Z', updatedBy: 'Admin C', reason: 'Cấu hình C dùng để kiểm tra không bị bò vào kỳ đã có override' };

// ---------- 2. Dữ liệu nền dùng chung: 1 nhân sự, 1 mẫu, hiệu lực rất sớm để hợp lệ mọi kỳ test ----------
const ASSIGNMENT_NV001 = { employee_key: 'nv001', employee_id: 'id-nv001', employee_code: 'NV001', employee_name: 'Nhân Viên Một', department: 'Kinh doanh', title: 'NV', branch: 'CN1', manager_id: 'MGR-1-ID', manager_code: 'MGR1', manager_name: 'Quản Lý Một', employee_status: 'Đang làm việc', template_id: 'sale-1.0', template_version: 'v1', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' };
const TEMPLATE = { template_key: 'sale-1.0', id: 'tmpl-1', updated_at: '2020-01-01T00:00:00Z', current_version: 'v1' };
const TEMPLATE_VERSION = { template_key: 'sale-1.0', version_no: 'v1', id: 'ver-1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z', definition: { totalRows: [{ code: 'C1', source: 'manual', content: 'Tiêu chí 1', target: 10, unit: 'lần', weight: 100 }] } };

function freshStore() {
  return {
    checklist_system_settings: [{ setting_key: MONTHLY_CYCLE_SETTING_KEY, setting_value: JSON.stringify(POLICY_A), updated_at: '2026-01-01T00:00:00Z', updated_by: 'Admin A' }],
    checklist_monthly_period_overrides: [],
    checklist_monthly_periods: [],
    checklist_monthly_forms: [],
    checklist_monthly_form_history: [],
    checklist_employee_assignments: [clone(ASSIGNMENT_NV001)],
    checklist_employee_assignment_history: [],
    checklist_templates: [clone(TEMPLATE)],
    checklist_template_versions: [clone(TEMPLATE_VERSION)],
    checklist_violation_records: [],
    checklist_monthly_score_policies: []
  };
}
function setGlobalPolicy(store, policy) {
  // getMonthlyCyclePolicy() ghi đè policy.updatedAt/updatedBy bằng metadata của dòng
  // checklist_system_settings (không phải giá trị trong JSON) — dùng đúng policy.updatedAt/updatedBy
  // ở đây để test so khớp JSON tất định, không phụ thuộc đồng hồ thật lúc chạy test.
  const row = store.checklist_system_settings.find(x => x.setting_key === MONTHLY_CYCLE_SETTING_KEY);
  row.setting_value = JSON.stringify(policy);
  row.updated_at = policy.updatedAt || nowIso();
  row.updated_by = policy.updatedBy || 'Admin';
}

// ---------- 3. Fake Supabase query builder (đủ cho các bảng syncMonthlyCycle/createMonthly cần) ----------
function makeFakeQuery(store) {
  return class FakeQuery {
    constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; this._patch = null; this._count = false; }
    select(_fields, opts) { if (opts && opts.count) this._count = true; return this; }
    eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
    neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
    in(col, arr) { const set = new Set((arr || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
    gte(col, val) { this.filters.push(row => String(row[col]) >= String(val)); return this; }
    lte(col, val) { this.filters.push(row => String(row[col]) <= String(val)); return this; }
    order() { return this; }
    limit(n) { this._limit = n; return this; }
    range() { return this; }
    maybeSingle() { this._single = 'maybe'; return this; }
    single() { this._single = 'strict'; return this; }
    update(patch) { this._patch = patch; return this; }
    then(resolve, reject) {
      const table = store[this.table] || (store[this.table] = []);
      const matchedRefs = table.filter(row => this.filters.every(f => f(row)));
      if (this._patch) matchedRefs.forEach(row => Object.assign(row, this._patch));
      let rows = clone(matchedRefs);
      if (this._limit != null) rows = rows.slice(0, this._limit);
      let payload;
      if (this._single === 'maybe') payload = { data: rows[0] || null, error: null };
      else if (this._single === 'strict') payload = rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } };
      else payload = { data: rows, error: null };
      if (this._count) payload.count = matchedRefs.length;
      return Promise.resolve(payload).then(resolve, reject);
    }
  };
}

// ---------- 4. Fake RPC (chỉ mô phỏng đủ hành vi cần cho test này) ----------
function makeFakeRpc(store) {
  return async function fakeRpc(name, p) {
    if (name === 'phf_create_checklist_monthly') {
      const periods = store.checklist_monthly_periods;
      let period = periods.find(x => x.period_month === p.p_period_month);
      if (!period) {
        period = { id: nextId('period'), period_month: p.p_period_month, status: 'draft', created_by: p.p_actor_id, created_by_name: p.p_actor_name, score_policy_snapshot: p.p_score_policy || {}, cycle_policy_snapshot: null, source_period_month: null, auto_created: false, synced_at: null, self_open_at: null, self_due_at: null, review_open_at: null, review_due_at: null, scheduled_lock_at: null, updated_at: nowIso() };
        periods.push(period);
      } else if (period.status !== 'draft') {
        return { data: { ok: false, code: 'CHECKLIST_MONTHLY_NOT_DRAFT', message: 'Kỳ đánh giá đã mở hoặc đã khóa; không thể bổ sung phiếu tự động.' }, error: null };
      } else if (!period.score_policy_snapshot || !Object.keys(period.score_policy_snapshot).length) {
        period.score_policy_snapshot = p.p_score_policy || {};
      }
      let created = 0, skipped = 0;
      const forms = store.checklist_monthly_forms;
      (p.p_forms || []).forEach(item => {
        const code = String(item.employee_code || '').toUpperCase();
        const exists = forms.find(f => f.period_month === p.p_period_month && f.employee_code === code);
        if (exists) { skipped++; return; }
        forms.push({ id: nextId('form'), period_id: period.id, period_month: p.p_period_month, employee_id: item.employee_id || '', employee_code: code, employee_name: item.employee_name || '', department: item.department || '', title: item.title || '', branch: item.branch || '', reviewer_id: item.reviewer_id || '', reviewer_code: item.reviewer_code || '', reviewer_name: item.reviewer_name || '', template_id: item.template_id || '', template_version: item.template_version || '', template_snapshot: item.template_snapshot || {}, score_policy_snapshot: item.score_policy_snapshot || period.score_policy_snapshot || {}, checklist_score: item.checklist_score == null ? 100 : item.checklist_score, status: item.status || 'draft', updated_at: nowIso() });
        created++;
      });
      return { data: { ok: true, periodId: period.id, created, skipped }, error: null };
    }
    if (name === 'open_checklist_monthly_period') {
      const period = store.checklist_monthly_periods.find(x => x.period_month === p.p_period_month);
      if (!period) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_PERIOD_NOT_FOUND', message: 'Không tìm thấy kỳ.' }, error: null };
      if (period.status !== 'draft') return { data: { ok: false, code: 'CHECKLIST_MONTHLY_ALREADY_OPEN', message: 'Kỳ đã mở.' }, error: null };
      const forms = store.checklist_monthly_forms.filter(f => f.period_month === p.p_period_month);
      if (forms.some(f => !f.reviewer_id && !f.reviewer_code)) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_MISSING_REVIEWER', message: 'Chưa có người thẩm định.' }, error: null };
      period.status = 'open'; period.updated_at = nowIso();
      forms.forEach(f => { if (f.status === 'draft') { f.status = 'waiting_self'; f.updated_at = nowIso(); } });
      return { data: { ok: true }, error: null };
    }
    if (name === 'lock_checklist_monthly_period') {
      const period = store.checklist_monthly_periods.find(x => x.period_month === p.p_period_month);
      if (!period) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_PERIOD_NOT_FOUND', message: 'Không tìm thấy kỳ.' }, error: null };
      period.status = 'locked'; period.updated_at = nowIso();
      return { data: { ok: true }, error: null };
    }
    if (name === 'change_checklist_monthly_reviewer') {
      const form = store.checklist_monthly_forms.find(f => f.id === p.p_form_id);
      if (!form) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_FORM_NOT_FOUND' }, error: null };
      form.reviewer_id = p.p_reviewer_id; form.reviewer_code = p.p_reviewer_code; form.reviewer_name = p.p_reviewer_name;
      return { data: { ok: true }, error: null };
    }
    if (name === 'phf_apply_monthly_overdue_batch') {
      return { data: { processed: Array.isArray(p.p_rows) ? p.p_rows.length : 0 }, error: null };
    }
    return { data: null, error: { message: 'RPC không được mock trong test này: ' + name } };
  };
}

// ---------- 5. Nạp module thật với Supabase giả ----------
function loadMonthlyLib(store) {
  const originalLoad = Module._load;
  const FakeQuery = makeFakeQuery(store);
  const fakeRpc = makeFakeRpc(store);
  Module._load = function (request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
    }
    return originalLoad.apply(this, arguments);
  };
  // Mỗi kịch bản test cần một bản sao module riêng (module cache dùng chung sẽ trỏ vào
  // client Supabase giả của lần require ĐẦU TIÊN) — xoá cache trước khi require lại.
  const modulePath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
  delete require.cache[modulePath];
  const lib = require(modulePath);
  Module._load = originalLoad;
  return lib;
}

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

// ---------- 6. Bộ chạy test ----------
const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: syncMonthlyCycle() không ghi đè snapshot/window của kỳ đã tồn tại (mock, không đụng Supabase thật) ===\n');

  // ===== CASE 1 + CASE 4 (tạo kỳ mới + chuyển trạng thái đúng theo snapshot vừa chụp) =====
  // Dùng kỳ 2020-01 để self_open_at tính ra chắc chắn nằm trong quá khứ so với đồng hồ thật,
  // qua đó xác nhận mở kỳ tự động dùng đúng effectiveWindow vừa thiết lập tại thời điểm tạo.
  const storeCase14 = freshStore();
  const libCase14 = loadMonthlyLib(storeCase14);
  const expectedWindowA_2020_01 = await libCase14.resolveMonthlyCycleWindow('2020-01', POLICY_A, null);
  const syncResult1 = await libCase14.syncMonthlyCycle(ADMIN_SESSION, { month: '2020-01', automatic: false });

  await record('CASE 1 — kỳ mới nhận đúng cycle_policy_snapshot = global config A tại thời điểm tạo', () => {
    const period = storeCase14.checklist_monthly_periods.find(x => x.period_month === '2020-01');
    assert.ok(period, 'Kỳ 2020-01 phải được tạo.');
    assert.strictEqual(JSON.stringify(period.cycle_policy_snapshot), JSON.stringify(POLICY_A));
    assert.strictEqual(period.self_open_at, expectedWindowA_2020_01.selfOpenAt);
    assert.strictEqual(period.self_due_at, expectedWindowA_2020_01.selfDueAt);
    assert.strictEqual(period.review_open_at, expectedWindowA_2020_01.reviewOpenAt);
    assert.strictEqual(period.review_due_at, expectedWindowA_2020_01.reviewDueAt);
    assert.strictEqual(period.scheduled_lock_at, expectedWindowA_2020_01.lockAt);
  });

  await record('CASE 4 — trạng thái kỳ tự chuyển sang open đúng theo window vừa chụp (self_open_at đã qua)', () => {
    assert.strictEqual(syncResult1.opened, true, 'Kỳ 2020-01 có self_open_at trong quá khứ nên phải tự mở.');
    const period = storeCase14.checklist_monthly_periods.find(x => x.period_month === '2020-01');
    assert.strictEqual(period.status, 'open');
  });

  // ===== CASE 2 + CASE 3 (đổi global config A -> B sau khi kỳ đã tồn tại; kỳ mới nhận B, kỳ cũ giữ A) =====
  const storeCase23 = freshStore();
  const libCase23 = loadMonthlyLib(storeCase23);
  // Dùng kỳ 2026-08 (tương lai xa so với self_open_at mặc định) để kỳ giữ nguyên trạng thái draft,
  // tách bạch khỏi kịch bản mở/khoá kỳ ở CASE 4.
  await libCase23.syncMonthlyCycle(ADMIN_SESSION, { month: '2026-08', automatic: false });
  const periodAfterCreate = clone(storeCase23.checklist_monthly_periods.find(x => x.period_month === '2026-08'));

  setGlobalPolicy(storeCase23, POLICY_B);
  const expectedWindowA_2026_08 = await libCase23.resolveMonthlyCycleWindow('2026-08', POLICY_A, null);
  const syncResult2 = await libCase23.syncMonthlyCycle(ADMIN_SESSION, { month: '2026-08', automatic: false });

  await record('CASE 2 — sau khi global config đổi A -> B, snapshot/window của kỳ đã tồn tại KHÔNG đổi', () => {
    const period = storeCase23.checklist_monthly_periods.find(x => x.period_month === '2026-08');
    assert.strictEqual(JSON.stringify(period.cycle_policy_snapshot), JSON.stringify(POLICY_A), 'cycle_policy_snapshot phải giữ nguyên A, không được thành B.');
    assert.strictEqual(period.self_open_at, expectedWindowA_2026_08.selfOpenAt);
    assert.strictEqual(period.self_due_at, expectedWindowA_2026_08.selfDueAt);
    assert.strictEqual(period.review_open_at, expectedWindowA_2026_08.reviewOpenAt);
    assert.strictEqual(period.review_due_at, expectedWindowA_2026_08.reviewDueAt);
    assert.strictEqual(period.scheduled_lock_at, expectedWindowA_2026_08.lockAt);
    // Đối chiếu thêm với giá trị đã lưu trước khi đổi config — phải giống hệt, không lệch dù chỉ 1 field.
    assert.strictEqual(period.self_open_at, periodAfterCreate.self_open_at);
    assert.strictEqual(period.scheduled_lock_at, periodAfterCreate.scheduled_lock_at);
    assert.strictEqual(syncResult2.policy.selfStartDay, POLICY_A.selfStartDay, 'Kết quả trả về cho kỳ này cũng phải phản ánh chính sách A đã chụp, không phải B.');
  });

  await record('CASE 3 — kỳ MỚI tạo sau khi global đã đổi thành B thì nhận đúng B; kỳ cũ (2026-08) không bị ảnh hưởng', async () => {
    const expectedWindowB_2026_09 = await libCase23.resolveMonthlyCycleWindow('2026-09', POLICY_B, null);
    await libCase23.syncMonthlyCycle(ADMIN_SESSION, { month: '2026-09', automatic: false });
    const period09 = storeCase23.checklist_monthly_periods.find(x => x.period_month === '2026-09');
    assert.ok(period09, 'Kỳ 2026-09 phải được tạo.');
    assert.strictEqual(JSON.stringify(period09.cycle_policy_snapshot), JSON.stringify(POLICY_B));
    assert.strictEqual(period09.self_open_at, expectedWindowB_2026_09.selfOpenAt);
    const period08 = storeCase23.checklist_monthly_periods.find(x => x.period_month === '2026-08');
    assert.strictEqual(JSON.stringify(period08.cycle_policy_snapshot), JSON.stringify(POLICY_A), 'Tạo kỳ mới không được làm thay đổi snapshot của kỳ 2026-08 đã có.');
  });

  // ===== CASE 5 (override tường minh theo kỳ vẫn hoạt động, không bị sync ghi đè bằng global) =====
  const storeCase5 = freshStore();
  const libCase5 = loadMonthlyLib(storeCase5);
  await libCase5.syncMonthlyCycle(ADMIN_SESSION, { month: '2026-10', automatic: false }); // snapshot = A (global hiện tại)
  // Admin đặt ngoại lệ tường minh cho riêng kỳ 2026-10: dời ngày khoá sang 15, các field khác không override.
  storeCase5.checklist_monthly_period_overrides.push({ period_month: '2026-10', self_start_day: null, self_end_day: null, review_start_day: null, review_end_day: null, lock_day: 15, lock_time: '20:00', reason: 'Admin gia hạn kỳ 10 vì sự kiện nội bộ', updated_at: nowIso(), updated_by: 'admin-1', updated_by_code: 'ADMIN', updated_by_name: 'Test Admin' });
  setGlobalPolicy(storeCase5, POLICY_C_GLOBAL); // global đổi tiếp sang C sau khi đã có override
  const syncResult5 = await libCase5.syncMonthlyCycle(ADMIN_SESSION, { month: '2026-10', automatic: false });

  await record('CASE 5 — override tường minh theo kỳ vẫn có hiệu lực; field không override giữ theo snapshot A, không rơi về global C', () => {
    const period = storeCase5.checklist_monthly_periods.find(x => x.period_month === '2026-10');
    assert.strictEqual(JSON.stringify(period.cycle_policy_snapshot), JSON.stringify(POLICY_A), 'cycle_policy_snapshot của kỳ không được đổi chỉ vì có override hay vì global đổi sang C.');
    const lockAtDay = Number(period.scheduled_lock_at.slice(8, 10));
    assert.strictEqual(lockAtDay, 15, 'lock_day phải theo override tường minh (15), không phải A (4) hay C (25).');
    assert.ok(period.scheduled_lock_at.includes('T20:00:00'), 'lock_time phải theo override (20:00).');
    const selfOpenDay = Number(period.self_open_at.slice(8, 10));
    assert.strictEqual(selfOpenDay, POLICY_A.selfStartDay, 'Field KHÔNG override (self_start_day) phải theo snapshot A đã chụp, không phải global C (20).');
    assert.ok(syncResult5.window.overrideReason.includes('Admin gia hạn'), 'Kết quả trả về phải phản ánh override đang áp dụng.');
  });

  // ===== CASE 7 (kỳ lịch sử có snapshot thiếu field mới hơn -> dùng fallback mặc định cứng, không lấy global) =====
  const storeCase7 = freshStore();
  const libCase7 = loadMonthlyLib(storeCase7);
  const legacySnapshot = { autoCreateEnabled: true, sourceMode: 'previous_period', createDay: 1, createTime: '00:05', selfStartDay: 1, selfEndDay: 3, lockDay: 4, lockTime: '23:59', effectiveFromPeriod: '2020-01' }; // thiếu reviewStartDay/reviewEndDay (field bổ sung về sau)
  storeCase7.checklist_monthly_periods.push({ id: 'period-legacy', period_month: '2020-06', status: 'draft', created_by: 'legacy', created_by_name: 'Legacy Seed', score_policy_snapshot: { selfWeight: 1, reviewWeight: 2, effectiveFromPeriod: '2020-01' }, cycle_policy_snapshot: legacySnapshot, source_period_month: null, auto_created: false, synced_at: '2020-06-01T00:00:00Z', self_open_at: '2020-07-01T00:00:00+07:00', self_due_at: '2020-07-03T23:59:00+07:00', review_open_at: '2020-07-01T00:00:00+07:00', review_due_at: '2020-07-04T23:59:00+07:00', scheduled_lock_at: '2020-07-04T23:59:00+07:00', updated_at: '2020-06-01T00:00:00Z' });
  storeCase7.checklist_employee_assignments = []; // không cần tạo phiếu mới, chỉ kiểm tra hành vi snapshot
  setGlobalPolicy(storeCase7, POLICY_C_GLOBAL);
  const syncResult7 = await libCase7.syncMonthlyCycle(ADMIN_SESSION, { month: '2020-06', automatic: false });

  await record('CASE 7 — snapshot cũ thiếu field mới -> dùng mặc định cứng cho field thiếu, KHÔNG lấy global C để lấp', () => {
    const period = storeCase7.checklist_monthly_periods.find(x => x.period_month === '2020-06');
    // reviewStartDay/reviewEndDay không có trong legacySnapshot -> parseMonthlyCyclePolicy phải lấy default cứng (1/4),
    // không phải POLICY_C_GLOBAL.reviewStartDay/reviewEndDay (20/23).
    const reviewOpenDay = Number(period.review_open_at.slice(8, 10)), reviewDueDay = Number(period.review_due_at.slice(8, 10));
    assert.strictEqual(reviewOpenDay, 1, 'reviewStartDay thiếu trong snapshot cũ phải fallback về mặc định cứng (1), không phải global C (20).');
    assert.strictEqual(reviewDueDay, 4, 'reviewEndDay thiếu trong snapshot cũ phải fallback về mặc định cứng (4), không phải global C (23).');
    // Field có sẵn trong snapshot cũ (lockDay=4) phải được tôn trọng nguyên vẹn.
    const lockDay = Number(period.scheduled_lock_at.slice(8, 10));
    assert.strictEqual(lockDay, 4, 'lockDay đã có sẵn trong snapshot cũ phải giữ nguyên (4), không đổi thành global C (25).');
    assert.strictEqual(syncResult7.policy.selfStartDay, 1);
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-monthly-cycle-snapshot-immutable.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
