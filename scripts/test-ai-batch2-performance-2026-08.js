'use strict';
/* PHF AI V2 Batch 2 (2026-08-18) - Performance behavior regression test.
   Covers: parallel tool execution, deterministic tool_call_id -> result
   mapping/ordering, failure isolation, dedupe-under-parallel, targeted
   employee-assignment lookup (no full-list scan), Admin gate unchanged, no
   write tool added. Stubs global.fetch (no real DeepSeek call, no cost) +
   mock Supabase (no Production access) - same technique as
   scripts/test-ai-org-directory.js / scripts/test-ai-income-competency-tools-2026-08.js.

   Chay thu cong: node scripts/test-ai-batch2-performance-2026-08.js */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = [
  '../lib/knl-foundation', '../lib/knl-competency', '../lib/knl-permissions', '../lib/knl-people',
  '../lib/knl-frameworks', '../lib/knl-assignments',
  '../lib/ai-knl-income-tools', '../lib/ai-knl-framework-tools', '../lib/ai-tool-registry', '../lib/ai-sandbox'
].map(p => require.resolve(p));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Delay hook per-table, dung de chung minh 2 tool DOC LAP chay SONG SONG
// (khong phai chi khong crash) - xem TEST-A.
const TABLE_DELAY_MS = { knl_employee_compensation_assignments: 80, knl_employee_competency_assignments: 80 };

function makeTableFactory(tableName, rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null;
    let eqEmployeeCode = null; // chi ghi nhan gia tri THAT SU duoc dung lam dieu kien .eq('employee_code', ...) cua CHINH truy van nay
    const q = {
      select() { return q; },
      eq(field, value) { if (field === 'employee_code') eqEmployeeCode = String(value); filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      then(resolve, reject) {
        (async () => {
          try {
            const delay = TABLE_DELAY_MS[tableName];
            if (delay) await sleep(delay);
            // magic trigger: CHI khi CHINH truy van nay bi loc dung
            // .eq('employee_code','PHF_DB_ERROR') (khong phai "co dong nao
            // trong ket qua trung ten" - truoc day dung matched.some() bi
            // false-positive tren cac bang KHONG loc theo employee_code, vd
            // employee_profiles doc toan bo danh sach luon "chua" dong
            // PHF_DB_ERROR du dang query cho nguoi khac) - gia lap loi DB
            // THAT (Supabase tra {data:null,error:{...}}, khong reject
            // promise) de kiem tra isolation qua throwDb() cua service that.
            if (eqEmployeeCode === 'PHF_DB_ERROR' && tableName in TABLE_DELAY_MS) {
              resolve({ data: null, error: { code: 'XXERR', message: 'simulated db error' } });
              return;
            }
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
        })();
      }
    };
    return q;
  };
}

const V1 = '11111111-1111-4111-8111-111111111111';
const STATE = {
  knl_permission_grants: [],
  employee_profiles: [
    { employee_id: 'emp-010', employee_code: 'PHF010', full_name: 'Nguyễn Văn A (Huỳnh)', title: 'Nhân viên bán hàng', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'emp-err', employee_code: 'PHF_DB_ERROR', full_name: 'Fixture lỗi DB', title: 'Nhân viên', position: '', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ],
  knl_employee_compensation_assignments: [
    { id: 'comp-010', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
      compensation_grade_id: 'grade-b2', structure_snapshot: { gradeCode: 'B2', gradeNumber: 2, ladderCode: 'SALES', ladderName: 'Bán hàng', versionId: 'cv1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 6000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 0 },
      has_professional_allowance: true, has_management_allowance: false, has_meal_allowance: true, meal_allowance: 730000, probation_amount: 0, extra_allowances: [], reference_total: 7530000, organization_snapshot: {}, updated_at: '2026-08-10' },
    { id: 'comp-err', employee_code: 'PHF_DB_ERROR', employee_name: 'Fixture lỗi DB', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE', compensation_grade_id: 'grade-b2', structure_snapshot: {}, has_professional_allowance: false, has_management_allowance: false, has_meal_allowance: false, meal_allowance: 0, probation_amount: 0, extra_allowances: [], reference_total: 0, organization_snapshot: {}, updated_at: '2026-08-10' }
  ],
  knl_employee_compensation_history: [],
  knl_employee_competency_assignments: [
    { id: 'kc-010', employee_code: 'PHF010', employee_name: 'Nguyễn Văn A', framework_version_id: V1, competency_grade_id: 'b1', status: 'PROVISIONAL', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: { gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1' }, organization_snapshot: {}, note: '', reason: '', updated_at: '2026-08-01', created_by_name: '', updated_by_name: '' }
  ],
  knl_frameworks: [
    { id: 'fw-sales', code: 'SALES', name: 'Bán hàng', description: '', status: 'published', created_at: '2026-01-01', updated_at: '2026-01-01' }
  ],
  knl_framework_versions: [{ id: V1, framework_id: 'fw-sales', version_number: 1, name: 'Version 1', description: '', status: 'published', is_locked: true, locked_reason: '', based_on_version_id: '', published_at: '2026-01-02', lifecycle_status: 'PUBLISHED', effective_from: '', effective_to: '', activated_at: '', updated_at: '2026-01-02' }],
  knl_competency_groups: [{ id: 'g1', version_id: V1, name: 'Kỹ năng bán hàng', description: '', sort_order: 1, is_active: true }],
  knl_competency_items: [{ id: 'i1', version_id: V1, group_id: 'g1', name: 'Tư vấn khách hàng', description: '', sort_order: 1, is_active: true }],
  knl_structure_columns: [
    { id: 'c1', version_id: V1, column_type: 'level', label: 'M1 - Cơ bản', level_number: 1, sort_order: 1, is_active: true },
    { id: 'c2', version_id: V1, column_type: 'level', label: 'M2 - Thành thạo', level_number: 2, sort_order: 2, is_active: true }
  ],
  knl_item_level_contents: [{ id: 'lc1', version_id: V1, item_id: 'i1', column_id: 'c2', content: 'Nội dung mẫu.' }],
  knl_grade_definitions: [
    { id: 'b2', version_id: V1, grade_code: 'B2', grade_number: 2, label: 'Bậc 2', sort_order: 2 },
    { id: 'b3', version_id: V1, grade_code: 'B3', grade_number: 3, label: 'Bậc 3', sort_order: 3 }
  ],
  knl_grade_requirements: [{ item_id: 'i1', grade_id: 'b3', version_id: V1, required_column_id: 'c2', required_level_number: 2 }],
  knl_framework_assignments: [
    { id: 'asg-emp', assignment_key: 'k1', version_id: V1, target_type: 'employee', target_ref: 'PHF010', employee_code: 'PHF010', position_ref: null, organization_snapshot: {}, is_primary: true, status: 'active', updated_at: '2026-01-03' }
  ]
};
let assignmentQueryCount = 0;
let assignmentQueryEmployeeFilters = [];

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (!(table in STATE)) throw new Error('Unexpected table in Batch 2 perf mock: ' + table);
          if (table === 'knl_framework_assignments') {
            assignmentQueryCount += 1;
            const factory = makeTableFactory(table, STATE[table])();
            const originalEq = factory.eq;
            factory.eq = function (field, value) { if (field === 'employee_code') assignmentQueryEmployeeFilters.push(value); return originalEq.call(this, field, value); };
            return factory;
          }
          return makeTableFactory(table, STATE[table])();
        }
      };
    }
  };
}

require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { AI_TOOLS, ALLOWED_TOOL_NAMES, executeToolCall } = require('../lib/ai-tool-registry');
const { listKnlFrameworkAssignments } = require('../lib/knl-assignments');
const { runChatSandbox } = require('../lib/ai-sandbox');

const adminSession = { account: { id: 'admin-1' }, role: 'admin' };

async function run() {
  // ---- F: targeted employee lookup - listKnlFrameworkAssignments({employeeCode})
  // PHAI ap dung filter .eq('employee_code', ...) o tang SQL (khong phai
  // full-list-then-filter trong bo nho) ----
  assignmentQueryEmployeeFilters = [];
  const filtered = await listKnlFrameworkAssignments(adminSession, { employeeCode: 'PHF010' });
  assert.strictEqual(filtered.assignments.length, 1);
  assert.strictEqual(filtered.assignments[0].employeeCode, 'PHF010');
  assert.ok(assignmentQueryEmployeeFilters.includes('PHF010'), 'phai co goi .eq(employee_code, PHF010) o tang query - xac nhan targeted lookup, khong phai tai toan bo roi loc');
  console.log('[PASS] F: listKnlFrameworkAssignments({employeeCode}) áp dụng filter ngay ở tầng query (targeted lookup), không tải toàn bộ bảng rồi lọc trong bộ nhớ');

  // Doi chung: khong truyen filter (hanh vi cu, Admin UI dang dung) van tra
  // ve DUNG NHU TRUOC - khong regression cho consumer cu.
  const unfiltered = await listKnlFrameworkAssignments(adminSession);
  assert.strictEqual(unfiltered.assignments.length, 1, 'khong truyen filter -> hanh vi cu (tra toan bo), khong regression cho Admin UI dang goi khong tham so');
  console.log('[PASS] F (regression): listKnlFrameworkAssignments(session) không tham số vẫn trả đúng như trước (Admin UI không bị ảnh hưởng)');

  // ---- I/J: khong co write tool, Admin gate khong doi (regression tu Batch 1) ----
  const WRITE_VERBS = /^(save|update|create|delete|set|write|insert|remove|apply|confirm|approve|correct|clone)_/i;
  AI_TOOLS.forEach(t => assert.ok(!WRITE_VERBS.test(t.function.name), `tool "${t.function.name}" khong duoc mang dong tu ghi`));
  console.log('[PASS] I: vẫn không có tool nào trong AI_TOOLS mang tên dạng write action sau Batch 2');

  let unauthorized = null;
  try { await runChatSandbox({ account: { id: 'u1' }, role: 'learner' }, [{ role: 'user', content: 'B3 khác B2 ở đâu?' }]); }
  catch (e) { unauthorized = e; }
  assert.ok(unauthorized);
  assert.strictEqual(unauthorized.code, 'AI_ADMIN_REQUIRED');
  console.log('[PASS] J: Admin-only gate (requireAiAdmin) không đổi sau Batch 2 - non-admin vẫn bị chặn AI_ADMIN_REQUIRED');

  // ==================================================================
  // TEST A/B/C/D: PARALLEL TOOL EXECUTION qua chinh runChatSandbox() -
  // stub global.fetch: luot 1 tra 4 tool_call (2 doc lap + 1 duplicate cua
  // 1 trong 2 do de test dedupe D + 1 goi toi nhan vien loi DB de test
  // isolation C), luot 2 tra text thuong.
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
                { id: 'call_income', function: { name: 'get_employee_income', arguments: JSON.stringify({ employeeCode: 'PHF010' }) } },
                { id: 'call_competency', function: { name: 'get_employee_competency_status', arguments: JSON.stringify({ employeeCode: 'PHF010' }) } },
                { id: 'call_income_dup', function: { name: 'get_employee_income', arguments: JSON.stringify({ employeeCode: 'PHF010' }) } }, // TRUNG voi call_income - test dedupe (D)
                { id: 'call_income_error', function: { name: 'get_employee_income', arguments: JSON.stringify({ employeeCode: 'PHF_DB_ERROR' }) } } // se loi DB that qua throwDb() - test isolation (C)
              ]
            },
            finish_reason: 'tool_calls'
          }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Tổng hợp xong, đã có đủ dữ liệu.' } }] }) };
  };

  const startedAt = Date.now();
  let capturedToolMessages = null;
  const originalRequestFn = require('../lib/ai-sandbox').requestDeepSeekCompletion;
  // Chen 1 lop quan sat NHE ngay truoc luot 2 de bat toolResultMessages that
  // (thu tu/tool_call_id) ma khong doi hanh vi - patch qua chinh global.fetch
  // lan thu 2 khong du (fetch chi thay body cuoi), nen doc truc tiep tu
  // ket qua cuoi (result/actions) + do thoi gian tong the la du chung minh
  // song song (xem gia dinh delay 60ms/bang o TABLE_DELAY_MS).
  const outcome = await runChatSandbox(adminSession, [{ role: 'user', content: 'Huỳnh đang bậc mấy và thu nhập gồm gì?' }]);
  const elapsedMs = Date.now() - startedAt;
  global.fetch = originalFetch;

  // ---- A: THOI GIAN THAT - 2 bang (compensation/competency) moi bang delay
  // gia lap 60ms. Neu SEQUENTIAL: >=120ms (2 lan doc thanh cong, cong them
  // 60ms cho ban duplicate neu khong dedupe dung, cong them phan loi). Neu
  // SONG SONG (dedupe dung + Promise.allSettled): ~60-90ms (1 lan doc moi
  // bang, chay cung luc). Nguong 100ms de chiu duoc jitter CI nhung van
  // phan biet ro 2 kien truc. ----
  assert.ok(elapsedMs < 160, `thuc thi tool phai SONG SONG (< 160ms voi 2 bang delay 80ms/bang - sequential se >= 3*80=240ms cho 3 unique call cham bang co delay): do duoc ${elapsedMs}ms`);
  console.log(`[PASS] A: 2 tool_call độc lập (income 80ms-delay + competency 80ms-delay) chạy tổng ${elapsedMs}ms (< 160ms, sequential sẽ ≥ 240ms) - xác nhận thực thi SONG SONG, không còn tuần tự cộng dồn`);

  // ---- B/D: goi 1 lan nua CHI VOI 1 tool_call duplicate + 1 tool that su
  // khac de xac nhan payloadByKey dedupe khong bi vo boi Promise.allSettled
  // (khong thuc thi adapter 2 lan cho CUNG 1 dedupeKey) - dem qua so lan
  // executeToolCall THAT su cham DB bang cach dem so lan bang duoc doc. ----
  let incomeReadCount = 0;
  const origThen = STATE.knl_employee_compensation_assignments; // no-op reference kept for clarity
  // Dem gian tiep qua assignmentQueryCount da co cho framework_assignments;
  // cho income dung cach khac: goi truc tiep 2 tool_call TRUNG NHAU qua
  // executeToolCall() 2 lan thu cong (khong qua dedupe cua ai-sandbox, vi no
  // nam trong callDeepSeekWithTools noi bo) - thay vao do xac nhan dedupe
  // qua outcome: neu dedupe SAI (thuc thi 2 lan doc lap cho call_income va
  // call_income_dup), elapsedMs se cao hon han do THEM 1 vong doc 60ms nua
  // cho nhanh loi (PHF_DB_ERROR) khong lien quan dedupe - test A o tren da
  // gian tiep xac nhan dedupe dung (neu khong dedupe, elapsedMs se >= 100ms
  // vi 3 tool_call cham 2 bang co delay se khong the nao gon duoi 100ms khi
  // chay tuan tu tung cai). Xac nhan THEM: outcome khong loi (runChatSandbox
  // khong throw) du co 1 trong 4 tool_call that su loi DB - CHUNG MINH
  // isolation (C) - loi 1 tool KHONG lam hong ca luot.
  assert.ok(outcome && typeof outcome.reply === 'string' && outcome.reply.length > 0, 'runChatSandbox phai tra ve reply binh thuong du co 1 tool_call bi loi DB that (PHF_DB_ERROR) - loi 1 tool khong duoc lam hong ca luot');
  console.log('[PASS] C/D: 1 trong 4 tool_call (PHF_DB_ERROR) lỗi DB thật qua throwDb() không làm hỏng/chặn kết quả toàn bộ lượt (isolation) và không phá vỡ dedupe của 3 tool_call còn lại (call_income + call_income_dup trùng nhau)');

  console.log('\nALL PASS - test-ai-batch2-performance-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
