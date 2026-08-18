'use strict';
/* PHF AI V2 - DEMO POLISH (2026-08-18) - 2 residual truoc demo doi tac:
   (1) An technical frameworkCode (dang "KNL_...") khoi UI nguoi dung - chi
       o data.sections cua the "not_found" recovery (lib/ai-tool-registry.js).
       frameworkCode van con NGUYEN trong result.availableFrameworks (JSON
       tra ve cho model) de model goi lai dung o vong sau - CHI an khoi PHAN
       HIEN THI (card render ra HTML qua assets/js/ai/phf-ai-engine.js#renderSummary
       - item.label/item.value duoc render THANG ra <span>/<b>, KHONG qua
       loc nao khac o client, nen server PHAI tu loc truoc khi tra ve).
   (2) The "so sanh 2 bac" - truoc day khi model goi get_knl_grade_requirements
       2 lan trong CUNG 1 luot (vd B2 roi B3), ai-sandbox.js chi giu lai the
       CUA LAN GOI DAU (if (!structuredResult)) nen UI chi thay "Yeu cau bac
       B2", KHONG thay B3 - dung buildGradeComparisonResult() (lib/ai-tool-registry.js)
       gop lai THANH 1 the so sanh khi phat hien >=2 ket qua that (available,
       co grade) CUNG 1 version trong CUNG 1 luot.

   Chay thu cong: node scripts/test-ai-knl-grade-comparison-polish-2026-08.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../lib/knl-permissions', '../lib/knl-frameworks', '../lib/knl-foundation', '../lib/knl-assignments',
  '../lib/knl-surveys', '../lib/knl-people', '../lib/ai-knl-framework-tools', '../lib/ai-tool-registry', '../lib/ai-sandbox'
].map(p => require.resolve(p));

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
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

// Framework/code CO Y DINH giong dang that (KNL_..._HEX) de kiem tra dung
// bi lo ra UI - dung dung ten demo doi tac neu trong yeu cau.
const V_SALES = '11111111-1111-4111-8111-111111111111';
const V_OPS = '22222222-2222-4222-8222-222222222222';
const STATE = {
  knl_permission_grants: [],
  knl_frameworks: [
    { id: 'fw-sales', code: 'KNL_NVBH_ONLINE_16D459', name: 'Nhân viên bán hàng Online', description: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'fw-ops', code: 'KNL_TRUONGKHO_9F21AA', name: 'Trưởng Kho', description: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' }
  ],
  knl_framework_versions: [
    { id: V_SALES, framework_id: 'fw-sales', version_number: 1, name: 'v1', description: '', status: 'published', is_locked: true, locked_reason: '', based_on_version_id: '', published_at: '2026-01-01', lifecycle_status: 'ACTIVE', effective_from: '', effective_to: '', activated_at: '', updated_at: '2026-01-01' },
    { id: V_OPS, framework_id: 'fw-ops', version_number: 1, name: 'v1', description: '', status: 'published', is_locked: true, locked_reason: '', based_on_version_id: '', published_at: '2026-01-01', lifecycle_status: 'ACTIVE', effective_from: '', effective_to: '', activated_at: '', updated_at: '2026-01-01' }
  ],
  knl_competency_groups: [
    { id: 'g1', version_id: V_SALES, name: 'Tinh thần & thái độ', description: '', sort_order: 1, is_active: true },
    { id: 'g2', version_id: V_SALES, name: 'Kiến thức', description: '', sort_order: 2, is_active: true },
    { id: 'g3', version_id: V_SALES, name: 'Kỹ năng', description: '', sort_order: 3, is_active: true },
    { id: 'go1', version_id: V_OPS, name: 'Vận hành', description: '', sort_order: 1, is_active: true }
  ],
  knl_competency_items: [
    { id: 'i1', version_id: V_SALES, group_id: 'g1', name: 'Chủ động hỗ trợ khách', description: '', sort_order: 1, is_active: true },
    { id: 'i2', version_id: V_SALES, group_id: 'g2', name: 'Hiểu sản phẩm', description: '', sort_order: 1, is_active: true },
    { id: 'i3', version_id: V_SALES, group_id: 'g3', name: 'Xử lý khiếu nại', description: '', sort_order: 1, is_active: true },
    { id: 'io1', version_id: V_OPS, group_id: 'go1', name: 'Quản lý tồn kho', description: '', sort_order: 1, is_active: true }
  ],
  knl_structure_columns: [
    { id: 'c1', version_id: V_SALES, column_type: 'level', label: 'M1', level_number: 1, sort_order: 1, is_active: true },
    { id: 'c2', version_id: V_SALES, column_type: 'level', label: 'M2', level_number: 2, sort_order: 2, is_active: true },
    { id: 'oc1', version_id: V_OPS, column_type: 'level', label: 'M1', level_number: 1, sort_order: 1, is_active: true },
    { id: 'oc2', version_id: V_OPS, column_type: 'level', label: 'M2', level_number: 2, sort_order: 2, is_active: true }
  ],
  knl_item_level_contents: [],
  knl_grade_definitions: [
    { id: 'grade-b1', version_id: V_SALES, grade_code: 'B1', grade_number: 1, label: 'Bậc 1', sort_order: 1 },
    { id: 'grade-b2', version_id: V_SALES, grade_code: 'B2', grade_number: 2, label: 'Bậc 2', sort_order: 2 },
    { id: 'grade-b3', version_id: V_SALES, grade_code: 'B3', grade_number: 3, label: 'Bậc 3', sort_order: 3 },
    { id: 'grade-ob1', version_id: V_OPS, grade_code: 'B1', grade_number: 1, label: 'Bậc 1', sort_order: 1 },
    { id: 'grade-ob4', version_id: V_OPS, grade_code: 'B4', grade_number: 4, label: 'Bậc 4', sort_order: 4 }
  ],
  knl_grade_requirements: [
    // i1: B2 doi hoi M1, B3 doi hoi M2 -> KHAC NHAU that su
    { version_id: V_SALES, item_id: 'i1', grade_id: 'grade-b2', required_column_id: 'c1', required_level_number: 1 },
    { version_id: V_SALES, item_id: 'i1', grade_id: 'grade-b3', required_column_id: 'c2', required_level_number: 2 },
    // i2: B2 va B3 CUNG doi hoi M1 -> GIONG NHAU that su, khong duoc tuyen bo khac
    { version_id: V_SALES, item_id: 'i2', grade_id: 'grade-b2', required_column_id: 'c1', required_level_number: 1 },
    { version_id: V_SALES, item_id: 'i2', grade_id: 'grade-b3', required_column_id: 'c1', required_level_number: 1 },
    // i3: CHI B3 co yeu cau, B2 KHONG co -> khac nhau ve su hien dien (that,
    // khong bia)
    { version_id: V_SALES, item_id: 'i3', grade_id: 'grade-b3', required_column_id: 'c2', required_level_number: 2 },
    // OPS: B1/B4 generic (khong lien quan SALES/B2/B3)
    { version_id: V_OPS, item_id: 'io1', grade_id: 'grade-ob1', required_column_id: 'oc1', required_level_number: 1 },
    { version_id: V_OPS, item_id: 'io1', grade_id: 'grade-ob4', required_column_id: 'oc2', required_level_number: 2 }
  ],
  knl_framework_assignments: [],
  employee_profiles: []
};

function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getKnlGradeRequirementsForAi } = require('../lib/ai-knl-framework-tools');
const { buildStructuredResult, buildGradeComparisonResult, ALLOWED_TOOL_NAMES } = require('../lib/ai-tool-registry');
const { runChatSandbox } = require('../lib/ai-sandbox');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };
const learnerNoGrant = { account: { id: 'u-1' }, role: 'learner' };
const KNL_CODE_RE = /KNL_[A-Z0-9_]+/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function collectVisibleStrings(card) {
  const out = [card.title || '', card.evidence && card.evidence.note || ''];
  (card.data && card.data.metrics || []).forEach(m => out.push(String(m.label), String(m.value)));
  (card.data && card.data.sections || []).forEach(sec => {
    out.push(String(sec.label));
    (sec.items || []).forEach(it => out.push(String(it.label), String(it.value)));
  });
  return out;
}

async function run() {
  // ---- 1. Recovery framework list: frameworkCode KHONG bien mat khoi
  // du lieu tra ve cho model (van resolve dung o vong sau) ----
  const r1 = await getKnlGradeRequirementsForAi(adminSession, { gradeCode: 'B2' });
  assert.strictEqual(r1.available, false);
  assert.ok(r1.availableFrameworks.some(f => f.code === 'KNL_NVBH_ONLINE_16D459'), 'frameworkCode kỹ thuật vẫn phải còn trong JSON trả cho model để resolve lại đúng ở vòng sau');
  console.log('[PASS] 1: frameworkCode kỹ thuật vẫn tồn tại trong result.availableFrameworks (internal, cho model dùng lại)');

  // ---- 2. User-facing framework list: card KHONG duoc chua "KNL_..." ----
  const card1 = buildStructuredResult('get_knl_grade_requirements', r1);
  const visible1 = collectVisibleStrings(card1).join(' | ');
  assert.ok(!KNL_CODE_RE.test(visible1), `card hiển thị không được chứa mã kỹ thuật dạng KNL_...: "${visible1}"`);
  assert.ok(visible1.includes('Nhân viên bán hàng Online') && visible1.includes('Trưởng Kho'), 'card phải hiển thị TÊN bộ KNL (không phải mã) để người dùng chọn');
  console.log('[PASS] 2: card recovery chỉ hiển thị TÊN bộ KNL, không lộ frameworkCode kỹ thuật (KNL_...)');

  // ---- 3. Explicit framework theo dung ten demo van resolve dung ----
  const b2 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B2' });
  const b3 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B3' });
  assert.strictEqual(b2.available, true); assert.strictEqual(b2.framework.name, 'Nhân viên bán hàng Online');
  assert.strictEqual(b3.available, true); assert.strictEqual(b3.grade.gradeCode, 'B3');
  console.log('[PASS] 3: frameworkCode = "Nhân viên bán hàng Online" (tên demo thật) vẫn resolve đúng bộ KNL');

  // ---- 4/5. So sanh B2/B3: ket qua chua CA HAI bac, title the hien ca hai ----
  const cmp = buildGradeComparisonResult([b2, b3]);
  assert.ok(cmp, 'buildGradeComparisonResult phải trả về card khi có >=2 kết quả grade hợp lệ cùng version');
  assert.strictEqual(cmp.title, 'So sánh B2 và B3 — Nhân viên bán hàng Online');
  const visibleCmp = collectVisibleStrings(cmp).join(' | ');
  assert.ok(visibleCmp.includes('B2') && visibleCmp.includes('B3'), 'card so sánh phải thể hiện rõ cả B2 và B3');
  assert.ok(!KNL_CODE_RE.test(visibleCmp) && !UUID_RE.test(visibleCmp), 'card so sánh không được lộ frameworkCode/UUID kỹ thuật');
  console.log('[PASS] 4/5: card so sánh chứa cả B2 và B3, title đúng dạng "So sánh B2 và B3 — <tên bộ KNL>", không lộ mã/UUID kỹ thuật');

  // ---- 9. i2 (B2=M1, B3=M1) giống nhau -> KHONG duoc tinh la khac biet ----
  const i2Row = [].concat(...cmp.data.sections.map(s => s.items)).find(it => visibleRowMatches(it, 'Hiểu sản phẩm'));
  assert.ok(i2Row, 'phải có dòng "Hiểu sản phẩm" trong card so sánh');
  assert.ok(i2Row.value.includes('B2: M1') && i2Row.value.includes('B3: M1'), `"Hiểu sản phẩm" B2/B3 cùng M1 - dữ liệu hiển thị phải đúng, nhận được "${i2Row.value}"`);
  console.log('[PASS] 9: hạng mục "Hiểu sản phẩm" B2=M1/B3=M1 (giống nhau thật) hiển thị đúng dữ liệu thật, không bị đếm nhầm là khác biệt');

  // ---- 10. i1 (B2=M1,B3=M2) khac nhau that -> hien dung du lieu tung ben ----
  const i1Row = [].concat(...cmp.data.sections.map(s => s.items)).find(it => visibleRowMatches(it, 'Chủ động hỗ trợ khách'));
  assert.ok(i1Row.value.includes('B2: M1') && i1Row.value.includes('B3: M2'), `"Chủ động hỗ trợ khách" phải hiện đúng B2=M1/B3=M2 khác nhau thật, nhận được "${i1Row.value}"`);
  console.log('[PASS] 10: hạng mục "Chủ động hỗ trợ khách" B2=M1 khác B3=M2 (khác nhau thật) hiển thị đúng dữ liệu mỗi bên');

  // i3: chi B3 co yeu cau -> B2 hien "Không yêu cầu" (THAT, khong bia)
  const i3Row = [].concat(...cmp.data.sections.map(s => s.items)).find(it => visibleRowMatches(it, 'Xử lý khiếu nại'));
  assert.ok(i3Row.value.includes('B2: Không yêu cầu') && i3Row.value.includes('B3: M2'), `"Xử lý khiếu nại" chỉ B3 có yêu cầu thật - B2 phải hiện "Không yêu cầu" (không suy diễn), nhận được "${i3Row.value}"`);
  console.log('[PASS] (data integrity) hạng mục chỉ 1 bậc có yêu cầu (i3) hiển thị "Không yêu cầu" cho bậc còn lại - đúng dữ liệu thật, không suy diễn B3=B2+1');

  // diffCount đúng = 2 (i1 khác, i3 khác vì thiếu 1 bên) - i2 KHÔNG tính
  const diffMetric = cmp.data.metrics.find(m => m.label === 'Số hạng mục khác nhau');
  assert.strictEqual(diffMetric.value, 2, `Số hạng mục khác nhau phải = 2 (i1 + i3), nhận được ${diffMetric.value}`);
  console.log('[PASS] Metric "Số hạng mục khác nhau" tính đúng = 2 (chỉ đếm hạng mục THẬT SỰ khác, không đếm "Hiểu sản phẩm" giống nhau)');

  // ---- 6. Generic - B1/B4 (Bo KNL khac, khong lien quan B2/B3) chung minh
  // khong hard-code rieng B2/B3 ----
  const ob1 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Trưởng Kho', gradeCode: 'B1' });
  const ob4 = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Trưởng Kho', gradeCode: 'B4' });
  const cmpGeneric = buildGradeComparisonResult([ob1, ob4]);
  assert.ok(cmpGeneric, 'phải hoạt động generic cho cặp bậc B1/B4, không chỉ B2/B3');
  assert.strictEqual(cmpGeneric.title, 'So sánh B1 và B4 — Trưởng Kho');
  console.log('[PASS] 6: buildGradeComparisonResult hoạt động generic cho cặp B1/B4 (bộ KNL khác) - không hard-code riêng B2/B3');

  // ---- 7. Single-grade: chi 1 ket qua -> KHONG tao card so sanh, giu
  // nguyen behavior cu ----
  const single = buildGradeComparisonResult([b2]);
  assert.strictEqual(single, null, 'chỉ có 1 kết quả grade -> KHÔNG được tạo card so sánh (regression single-grade)');
  const singleCard = buildStructuredResult('get_knl_grade_requirements', b2);
  assert.strictEqual(singleCard.title, 'Yêu cầu bậc B2 - Bộ KNL Nhân viên bán hàng Online');
  console.log('[PASS] 7: chỉ hỏi 1 bậc -> buildGradeComparisonResult trả null, card đơn bậc cũ (buildStructuredResult) không đổi');

  // ---- 8. Missing grade: khong bia du lieu ----
  const missing = await getKnlGradeRequirementsForAi(adminSession, { frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B9' });
  assert.strictEqual(missing.available, false);
  assert.strictEqual(missing.reason, 'grade_not_found');
  const cmpWithMissing = buildGradeComparisonResult([b2, missing]);
  assert.strictEqual(cmpWithMissing, null, 'kết quả grade không tồn tại (available:false) không được lọt vào card so sánh - không bịa');
  console.log('[PASS] 8: bậc không tồn tại (grade_not_found) không được đưa vào so sánh, không bịa dữ liệu');

  // ---- 12/13. Khong tool write, permission gate khong doi ----
  const toolNameList = Array.isArray(ALLOWED_TOOL_NAMES) ? ALLOWED_TOOL_NAMES : Array.from(ALLOWED_TOOL_NAMES);
  assert.strictEqual(toolNameList.filter(n => /^(create|update|delete|save|approve|reject|write)_/i.test(n)).length, 0);
  await assert.rejects(
    () => getKnlGradeRequirementsForAi(learnerNoGrant, { frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B2' }),
    err => err && err.code === 'KNL_MANAGE_FRAMEWORK_REQUIRED'
  );
  console.log('[PASS] 12/13: không có tool write mới, permission gate (requireManageFrameworkForSession) không đổi');

  // ==================================================================
  // 11 + end-to-end: qua CHINH runChatSandbox() (nhu model that goi 2 lan
  // get_knl_grade_requirements trong CUNG 1 luot) - xac nhan card cuoi cung
  // tra ve cho UI la card SO SANH (khong phai chi B2), va KHONG lo ma/UUID
  // ky thuat trong toan bo outcome.result.
  // ==================================================================
  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount += 1;
    if (fetchCallCount === 1) {
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [
                { id: 'call_b2', function: { name: 'get_knl_grade_requirements', arguments: JSON.stringify({ frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B2' }) } },
                { id: 'call_b3', function: { name: 'get_knl_grade_requirements', arguments: JSON.stringify({ frameworkCode: 'Nhân viên bán hàng Online', gradeCode: 'B3' }) } }
              ]
            },
            finish_reason: 'tool_calls'
          }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'B2 và B3 khác nhau ở hạng mục Chủ động hỗ trợ khách và Xử lý khiếu nại.' } }] }) };
  };
  const outcome = await runChatSandbox(adminSession, [{ role: 'user', content: 'Trong Bộ KNL Nhân viên bán hàng Online, B3 khác B2 ở đâu?' }]);
  global.fetch = originalFetch;

  assert.ok(outcome.result, 'phải có structured result trả về');
  assert.ok(outcome.result.title.includes('B2') && outcome.result.title.includes('B3'), `title kết quả cuối cùng phải thể hiện cả B2 và B3 qua đúng luồng runChatSandbox thật, nhận được "${outcome.result.title}"`);
  const visibleOutcome = collectVisibleStrings(outcome.result).join(' | ');
  assert.ok(!KNL_CODE_RE.test(visibleOutcome) && !UUID_RE.test(visibleOutcome), 'end-to-end qua runChatSandbox: card cuối cùng không được lộ mã/UUID kỹ thuật');
  console.log('[PASS] 11 (end-to-end qua runChatSandbox thật): model gọi get_knl_grade_requirements 2 lần (B2, B3) trong 1 lượt -> card CUỐI CÙNG là card SO SÁNH (không chỉ B2), không lộ mã/UUID kỹ thuật trong bất kỳ chuỗi hiển thị nào');

  console.log('\nALL PASS - test-ai-knl-grade-comparison-polish-2026-08.js');
}

function visibleRowMatches(item, itemName) {
  return String(item.label || '').includes(itemName);
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
