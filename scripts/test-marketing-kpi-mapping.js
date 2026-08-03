'use strict';
/*
 * Regression Test
 * Marketing KPI Module
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * Integration test cho module KPI tháng Marketing (từ bản 1.38.52 trở đi — mapping
 * 'tbp-mkt-1.0'/'nv-media-1.0' <-> template_key 'tbp-marketing'/'nv-marketing').
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ (chặn @supabase/supabase-js bằng Module._load),
 * KHÔNG kết nối Supabase thật, KHÔNG đổi bất kỳ dòng nghiệp vụ nào trong lib/.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu (không có trong "scripts" của package.json,
 * không được server.js/api/*.js require) — chỉ chạy khi có người chủ động gọi thủ công:
 *   node scripts/test-marketing-kpi-mapping.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

// ---------- 1. Dữ liệu mock trong bộ nhớ (giả lập toàn bộ Supabase) ----------
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function isoNow() { return new Date().toISOString(); }
let rid = 0;
function nextId(prefix) { rid += 1; return prefix + '-' + rid; }

const TBP_MKT_DEF = { totalRows: [
  ['1', 'TBP-C1', 'Quản lý kế hoạch tháng', 'Đạt kế hoạch', '%', 60, '', 'Nhập đánh giá'],
  ['2', 'TBP-C2', 'Quản lý nhân sự nhóm', 'Đạt', '%', 40, '', 'Nhập đánh giá']
] };
const NV_MEDIA_DEF = { totalRows: [
  ['1', 'NV-C1', 'Bài viết mạng xã hội theo kế hoạch tháng', '160', 'bài', 60, '', 'Nhập đánh giá'],
  ['2', 'NV-C2', 'Campaign theo kế hoạch tháng', '3', 'campaign', 40, '', 'Nhập đánh giá']
] };
const KT_TH_DEF = { totalRows: [
  ['1', 'KT-C1', 'Việc kế toán định kỳ', '10', 'lần', 100, '', 'Nhập đánh giá']
] };

const store = {
  checklist_templates: [
    { id: 't-tbp-mkt', template_key: 'tbp-marketing', current_version: 'TBP-MKT-1.0', updated_at: '2026-01-01T00:00:00Z' },
    { id: 't-nv-mkt', template_key: 'nv-marketing', current_version: 'NV-MEDIA-1.0', updated_at: '2026-01-01T00:00:00Z' },
    { id: 't-ketoan', template_key: 'ke-toan-tong-hop', current_version: 'KT-TH-1.0', updated_at: '2026-01-01T00:00:00Z' }
  ],
  checklist_template_versions: [
    { id: 'v-tbp-mkt', template_key: 'tbp-marketing', version_no: 'TBP-MKT-1.0', effective_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', definition: clone(TBP_MKT_DEF) },
    { id: 'v-nv-mkt', template_key: 'nv-marketing', version_no: 'NV-MEDIA-1.0', effective_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', definition: clone(NV_MEDIA_DEF) },
    { id: 'v-ketoan', template_key: 'ke-toan-tong-hop', version_no: 'KT-TH-1.0', effective_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', definition: clone(KT_TH_DEF) }
  ],
  checklist_monthly_forms: [
    // Kỳ 2026-08: NV Marketing CHƯA tự đánh giá -> phải được phép cập nhật snapshot.
    {
      id: 'f-nv-0808', period_month: '2026-08', department: 'Marketing', employee_code: 'NV-MEDIA-01',
      template_id: 'nv-marketing', template_version: 'NV-MEDIA-1.0',
      template_snapshot: { template: { department: 'Marketing' }, version: { version_no: 'NV-MEDIA-1.0', definition: clone(NV_MEDIA_DEF) } },
      self_saved_at: null, self_submitted_at: null, self_answers: {}, updated_at: '2026-08-01T00:00:00Z'
    },
    // Kỳ 2026-09: NV Marketing ĐÃ tự đánh giá -> phải bị chặn, không được cập nhật.
    {
      id: 'f-nv-0809', period_month: '2026-09', department: 'Marketing', employee_code: 'NV-MEDIA-02',
      template_id: 'nv-marketing', template_version: 'NV-MEDIA-1.0',
      template_snapshot: { template: { department: 'Marketing' }, version: { version_no: 'NV-MEDIA-1.0', definition: clone(NV_MEDIA_DEF) } },
      self_saved_at: '2026-09-05T00:00:00Z', self_submitted_at: null, self_answers: { 'nv-c1': { value: '150' } }, updated_at: '2026-09-05T00:00:00Z'
    },
    // Mẫu KHÔNG liên quan Marketing, dùng để kiểm tra "không ảnh hưởng template khác".
    {
      id: 'f-kt-0808', period_month: '2026-08', department: 'Kế toán', employee_code: 'KT-01',
      template_id: 'ke-toan-tong-hop', template_version: 'KT-TH-1.0',
      template_snapshot: { template: { department: 'Kế toán' }, version: { version_no: 'KT-TH-1.0', definition: clone(KT_TH_DEF) } },
      self_saved_at: null, self_submitted_at: null, self_answers: {}, updated_at: '2026-08-01T00:00:00Z'
    }
  ],
  checklist_monthly_kpi_configs: [],
  checklist_monthly_kpi_config_history: [],
  checklist_monthly_form_history: []
};

// Chụp lại snapshot ban đầu của mẫu Kế toán (không liên quan Marketing) để đối chiếu sau cùng.
const ketoanBefore = clone({
  templates: store.checklist_templates.filter(x => x.template_key === 'ke-toan-tong-hop'),
  versions: store.checklist_template_versions.filter(x => x.template_key === 'ke-toan-tong-hop'),
  forms: store.checklist_monthly_forms.filter(x => x.template_id === 'ke-toan-tong-hop')
});

// ---------- 2. Fake Supabase query builder (chỉ hỗ trợ đúng chuỗi lệnh module đang dùng) ----------
class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this._limit = null;
    this._single = null; // 'maybe' | 'strict'
  }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { this.filters.push(row => vals.includes(row[col])); return this; }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  range() { return this; } // readAllRows dùng range để phân trang; dữ liệu mock luôn < 1 trang.
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  _rows() {
    let rows = clone(store[this.table] || []);
    this.filters.forEach(f => { rows = rows.filter(f); });
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
  then(resolve, reject) {
    try {
      const rows = this._rows();
      if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
      if (this._single === 'strict') {
        if (!rows.length) return Promise.resolve({ data: null, error: { message: 'No rows found', code: 'PGRST116' } }).then(resolve, reject);
        return Promise.resolve({ data: rows[0], error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    } catch (e) {
      return Promise.resolve({ data: null, error: { message: e.message } }).then(resolve, reject);
    }
  }
}

// ---------- 3. Fake RPC phf_save_marketing_monthly_kpi (mô phỏng đúng logic SQL 1.38.52) ----------
const MARKETING_KEY_MAP = { 'tbp-mkt-1.0': 'tbp-marketing', 'nv-media-1.0': 'nv-marketing' };
let rpcCallCount = 0;
async function fakeRpc(name, p) {
  if (name !== 'phf_save_marketing_monthly_kpi') return { data: null, error: { message: 'RPC không được mock: ' + name } };
  rpcCallCount += 1;
  const vTemplate = String(p.p_template_id || '').trim().toLowerCase();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.p_period_month || ''))) return { data: { ok: false, code: 'CHECKLIST_MARKETING_KPI_PERIOD_INVALID' }, error: null };
  if (String(p.p_department || '').trim().toLowerCase() !== 'marketing') return { data: { ok: false, code: 'CHECKLIST_MARKETING_KPI_DEPARTMENT_FORBIDDEN' }, error: null };
  const vTemplateKey = MARKETING_KEY_MAP[vTemplate];
  if (!vTemplateKey) return { data: { ok: false, code: 'CHECKLIST_MARKETING_KPI_TEMPLATE_FORBIDDEN' }, error: null };

  const matchingForms = store.checklist_monthly_forms.filter(f =>
    f.period_month === p.p_period_month &&
    String(f.department || '').toLowerCase() === 'marketing' &&
    String(f.template_id || '').toLowerCase() === vTemplateKey
  );
  const selfStarted = matchingForms.some(f => f.self_saved_at || f.self_submitted_at || (f.self_answers && Object.keys(f.self_answers).length));
  if (selfStarted) return { data: null, error: { message: 'CHECKLIST_MARKETING_KPI_SELF_STARTED' } };

  let config = store.checklist_monthly_kpi_configs.find(c => c.period_month === p.p_period_month && c.department === 'Marketing' && c.template_id === vTemplate);
  let revision;
  if (config) {
    if (Number(p.p_expected_revision || 0) !== config.revision) return { data: null, error: { message: 'CHECKLIST_MARKETING_KPI_STALE' } };
    revision = config.revision + 1;
    config.template_version = p.p_template_version;
    config.definition_snapshot = p.p_definition;
    config.revision = revision;
    config.updated_at = isoNow();
  } else {
    if (Number(p.p_expected_revision || 0) !== 0) return { data: null, error: { message: 'CHECKLIST_MARKETING_KPI_STALE' } };
    config = {
      id: nextId('cfg'), period_month: p.p_period_month, department: 'Marketing', template_id: vTemplate,
      template_version: p.p_template_version, definition_snapshot: p.p_definition, revision: 1, updated_at: isoNow()
    };
    store.checklist_monthly_kpi_configs.push(config);
    revision = 1;
  }

  let updated = 0;
  store.checklist_monthly_forms.forEach(f => {
    if (f.period_month === p.p_period_month &&
        String(f.department || '').toLowerCase() === 'marketing' &&
        String(f.template_id || '').toLowerCase() === vTemplateKey &&
        String(f.template_version || '') === String(p.p_template_version || '')) {
      f.template_snapshot = f.template_snapshot || {};
      f.template_snapshot.version = f.template_snapshot.version || {};
      f.template_snapshot.version.definition = clone(p.p_definition);
      f.updated_at = isoNow();
      updated += 1;
    }
  });

  return { data: { ok: true, revision, updatedForms: updated, totalWeight: 100, configId: config.id }, error: null };
}

// ---------- 4. Chặn @supabase/supabase-js trước khi require module thật ----------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return {
      createClient: function () {
        return {
          from(table) { return new FakeQuery(table); },
          rpc(name, params) { return fakeRpc(name, params); }
        };
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const monthlyLib = require(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'));
Module._load = originalLoad; // khôi phục ngay sau khi nạp xong, tránh ảnh hưởng phần khác.

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin', email: 'admin@test.local' }, sub: 'admin-1' };

// ---------- 5. Bộ chạy test tối giản ----------
const results = [];
function record(name, fn) {
  return fn().then(
    () => { results.push({ name, pass: true }); console.log('✓ PASS -', name); },
    (err) => { results.push({ name, pass: false, error: err }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
  );
}

async function main() {
  console.log('=== Integration test: Marketing Monthly KPI (mock data, không đụng Supabase thật) ===\n');

  await record('Mapping tbp-mkt-1.0 -> tbp-marketing (kỳ chưa có config/form, buộc đi qua marketingTemplateFoundation)', async () => {
    const cfg = await monthlyLib.getMarketingMonthlyKpiConfig(ADMIN_SESSION, { month: '2026-07', templateId: 'tbp-mkt-1.0' });
    assert.strictEqual(cfg.templateVersion, 'TBP-MKT-1.0');
    const codes = cfg.rows.map(r => r.code);
    assert.ok(codes.includes('TBP-C1') && codes.includes('TBP-C2'), 'Phải trả đúng tiêu chí của tbp-marketing, không lẫn mẫu khác. Codes nhận được: ' + codes.join(','));
  });

  await record('Mapping nv-media-1.0 -> nv-marketing (kỳ chưa có config/form, buộc đi qua marketingTemplateFoundation)', async () => {
    const cfg = await monthlyLib.getMarketingMonthlyKpiConfig(ADMIN_SESSION, { month: '2026-07', templateId: 'nv-media-1.0' });
    assert.strictEqual(cfg.templateVersion, 'NV-MEDIA-1.0');
    const codes = cfg.rows.map(r => r.code);
    assert.ok(codes.includes('NV-C1') && codes.includes('NV-C2'), 'Phải trả đúng tiêu chí của nv-marketing, không lẫn mẫu khác. Codes nhận được: ' + codes.join(','));
  });

  await record('Snapshot kỳ được cập nhật + phiếu CHƯA tự đánh giá được cập nhật (kỳ 2026-08)', async () => {
    const before = await monthlyLib.getMarketingMonthlyKpiConfig(ADMIN_SESSION, { month: '2026-08', templateId: 'nv-media-1.0' });
    assert.strictEqual(before.hasSelfData, false, 'Tiền điều kiện sai: kỳ 2026-08 phải chưa có ai tự đánh giá.');
    const saved = await monthlyLib.saveMarketingMonthlyKpiConfig(ADMIN_SESSION, {
      month: '2026-08', templateId: 'nv-media-1.0', expectedRevision: before.revision,
      rows: [
        { code: 'NV-C1', name: 'Bài viết mạng xã hội theo kế hoạch tháng', target: '200', weight: 60 },
        { code: 'NV-C2', name: 'Campaign theo kế hoạch tháng', target: '5', weight: 40 }
      ]
    });
    assert.strictEqual(saved.saved, true);
    // 1. checklist_monthly_kpi_configs phải có snapshot mới cho đúng kỳ/mẫu.
    const cfgRow = store.checklist_monthly_kpi_configs.find(c => c.period_month === '2026-08' && c.template_id === 'nv-media-1.0');
    assert.ok(cfgRow, 'Thiếu dòng cấu hình KPI tháng vừa lưu.');
    const savedTargets = cfgRow.definition_snapshot.totalRows.map(r => r[3]);
    assert.deepStrictEqual(savedTargets, [200, 5], 'Snapshot cấu hình chưa phản ánh mục tiêu mới.');
    // 2. Phiếu NV-MEDIA-01 (chưa tự đánh giá) phải được cập nhật đúng mục tiêu mới.
    const form = store.checklist_monthly_forms.find(f => f.id === 'f-nv-0808');
    const formTargets = form.template_snapshot.version.definition.totalRows.map(r => r[3]);
    assert.deepStrictEqual(formTargets, [200, 5], 'Phiếu NV-MEDIA-01 (chưa tự đánh giá) phải được cập nhật mục tiêu mới nhưng lại giữ giá trị cũ.');
  });

  await record('Phiếu ĐÃ tự đánh giá không bị cập nhật (kỳ 2026-09, phải bị chặn và không gọi RPC)', async () => {
    const formBefore = clone(store.checklist_monthly_forms.find(f => f.id === 'f-nv-0809'));
    const rpcCountBefore = rpcCallCount;
    let blockedCode = null;
    try {
      await monthlyLib.saveMarketingMonthlyKpiConfig(ADMIN_SESSION, {
        month: '2026-09', templateId: 'nv-media-1.0', expectedRevision: 0,
        rows: [
          { code: 'NV-C1', name: 'Bài viết mạng xã hội theo kế hoạch tháng', target: '999', weight: 60 },
          { code: 'NV-C2', name: 'Campaign theo kế hoạch tháng', target: '999', weight: 40 }
        ]
      });
    } catch (e) { blockedCode = e.code; }
    assert.strictEqual(blockedCode, 'CHECKLIST_MARKETING_KPI_SELF_STARTED', 'Phải bị chặn đúng mã lỗi CHECKLIST_MARKETING_KPI_SELF_STARTED.');
    assert.strictEqual(rpcCallCount, rpcCountBefore, 'Không được gọi RPC ghi dữ liệu khi đã có nhân sự tự đánh giá.');
    const formAfter = store.checklist_monthly_forms.find(f => f.id === 'f-nv-0809');
    assert.deepStrictEqual(formAfter, formBefore, 'Phiếu đã tự đánh giá bị thay đổi dữ liệu — SAI nghiệp vụ.');
  });

  await record('Không ảnh hưởng mẫu/kỳ Kế toán (mẫu không liên quan Marketing)', async () => {
    const ketoanAfter = {
      templates: store.checklist_templates.filter(x => x.template_key === 'ke-toan-tong-hop'),
      versions: store.checklist_template_versions.filter(x => x.template_key === 'ke-toan-tong-hop'),
      forms: store.checklist_monthly_forms.filter(x => x.template_id === 'ke-toan-tong-hop')
    };
    assert.deepStrictEqual(ketoanAfter, ketoanBefore, 'Mẫu Kế toán bị thay đổi ngoài ý muốn khi thao tác trên mẫu Marketing.');
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nDữ liệu test chỉ tồn tại trong bộ nhớ tiến trình Node (mock Supabase) — không có ghi nào');
  console.log('xuống database thật nên KHÔNG cần rollback. Đây là regression test chính thức, giữ lại');
  console.log('để kiểm tra lại module KPI Marketing khi cần (chạy thủ công, không tự động):');
  console.log('  node scripts/test-marketing-kpi-mapping.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
