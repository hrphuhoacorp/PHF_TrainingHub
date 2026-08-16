'use strict';
/*
 * PHF Checklist — Đi trễ FINAL ACTIVATION (2026-08-16): "-1 điểm tạm tính" phía nhân viên.
 * Cover:
 *   J1. pendingLateProvisional() (lib/checklist-monthly.js) — nguồn AN TOÀN cho employee view:
 *       chỉ đọc checklist_late_bcc_import_rows đúng employee_code, linked_violation_id IS NULL,
 *       row_status != 'not_applied', trong đúng period_month — KHÔNG BAO GIỜ lộ
 *       suggested_points/standard_points/frequency_reference_snapshot/admin_decision.
 *   J2. myMonthlyForm() wiring — pending_late_events gắn vào response, KHÔNG cộng vào
 *       checklist_score/totalPoints (2 số đó độc lập, tính từ checklist_breakdown như cũ).
 *   J3. Sau khi "Approve" (linked_violation_id được set) -> dòng tự biến mất khỏi pending list.
 *   J4/K. Frontend roleMonthlyChecklistBreakdownHtml()/pendingLateProvisionalHtml() — hiển thị
 *       đúng "-1 tạm tính" + note, KHÔNG hiển thị suggestedPoints/số liệu nội bộ nào khác, KHÔNG
 *       cộng vào số điểm hiển thị (base/deduct/score).
 * Chạy: node scripts/test-checklist-late-employee-provisional-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const supabasePath = require.resolve('@supabase/supabase-js');

function staticTable(getRows) {
  const filters = [];
  const nullFilters = [];
  let limitN = null;
  const q = {
    select(cols) { q.__selectedCols = cols; return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    is(field, value) { if (value === null) nullFilters.push(r => r[field] == null); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    order() { return q; },
    limit(n) { limitN = n; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)) && nullFilters.every(fn => fn(r)));
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

const IMPORT_ROWS = [
  // PHF060: 1 dòng đang chờ (chưa linked) trong tháng 08, 1 dòng đã not_applied (không phải pending).
  { id: 'r1', employee_code: 'PHF060', occurred_date: '2026-08-05', row_status: 'pending_approval', linked_violation_id: null, suggested_points: 6, standard_points: 3, admin_decision: null, frequency_reference_snapshot: { businessStatus: 'rejected', standardRejectedPoints: 6 } },
  { id: 'r2', employee_code: 'PHF060', occurred_date: '2026-08-06', row_status: 'not_applied', linked_violation_id: null, suggested_points: 3, standard_points: 3, admin_decision: 'not_applied' },
  // PHF061: 1 dòng ĐÃ approve (linked_violation_id có giá trị) -> KHÔNG còn pending.
  { id: 'r3', employee_code: 'PHF061', occurred_date: '2026-08-07', row_status: 'applied', linked_violation_id: 'v-official-1', suggested_points: 6, standard_points: 3 },
  // PHF060 nhưng khác tháng (07) -> không thuộc kỳ 08 đang xét.
  { id: 'r4', employee_code: 'PHF060', occurred_date: '2026-07-20', row_status: 'pending_approval', linked_violation_id: null, suggested_points: 6, standard_points: 3 }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_late_bcc_import_rows') return staticTable(() => IMPORT_ROWS);
        return staticTable(() => []);
      }
    })
  }
};

const monthly = require('../lib/checklist-monthly');

let failures = 0, passes = 0;
async function checkAsync(label, fn) { try { await fn(); passes++; console.log('PASS: ' + label); } catch (e) { failures++; console.error('FAIL: ' + label + ' :: ' + (e && e.message || e)); } }
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; console.log('PASS: ' + message); } }

(async () => {
  await checkAsync('J1a. PHF060 tháng 2026-08: hasPending=true, đúng 1 item (r2 not_applied bị loại, r4 khác tháng bị loại)', async () => {
    const r = await monthly.pendingLateProvisional('PHF060', '2026-08');
    assert.strictEqual(r.hasPending, true);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].occurredDate, '2026-08-05');
  });
  await checkAsync('J1b. PHF061 tháng 2026-08: hasPending=false (dòng duy nhất đã linked_violation_id -> đã Approve, không còn pending)', async () => {
    const r = await monthly.pendingLateProvisional('PHF061', '2026-08');
    assert.strictEqual(r.hasPending, false);
    assert.strictEqual(r.items.length, 0);
  });
  await checkAsync('J1c. Nhân viên không có mã (rỗng) -> hasPending=false, không throw, không query bừa', async () => {
    const r = await monthly.pendingLateProvisional('', '2026-08');
    assert.strictEqual(r.hasPending, false);
  });
  check((() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function pendingLateProvisional'), src.indexOf('async function refreshUnlockedChecklistScore'));
    return /\.select\('occurred_date,row_status'\)/.test(fnSrc);
  })(), 'J1d. Grep-guard: pendingLateProvisional() CHỈ select occurred_date,row_status — KHÔNG select suggested_points/standard_points/frequency_reference_snapshot/admin_decision/recorders_snapshot (không lộ dữ liệu nội bộ Admin)');
  check((() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'), 'utf8');
    return /const pendingLatePromise=pendingLateProvisional\(form\.employee_code,form\.period_month\)/.test(src);
  })(), 'J2a. Grep-guard: myMonthlyForm() lấy employeeCode từ form.employee_code (identity đã resolve qua actor(session)), KHÔNG tin input.employeeCode nào từ client');
  check((() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'), 'utf8');
    return /pending_late_events:pendingLate/.test(src);
  })(), 'J2b. Grep-guard: myMonthlyForm() gắn pending_late_events vào response form');
  check((() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'), 'utf8');
    // checklistBreakdown (điểm chính thức) và pendingLateProvisional (tạm tính) phải là 2 hàm
    // hoàn toàn tách biệt — không có dòng nào cộng points của pending vào totalPoints/score.
    const start = src.indexOf('async function checklistBreakdown');
    const end = src.indexOf('\n}', start);
    const breakdownFn = src.slice(start, end + 2);
    return !/pendingLate/i.test(breakdownFn);
  })(), 'J2c. Grep-guard: checklistBreakdown() (tính điểm chính thức) hoàn toàn KHÔNG tham chiếu pendingLateProvisional — không có đường nào cộng -1 vào điểm thật');

  // =========================================================================
  // J4/K — Frontend: roleMonthlyChecklistBreakdownHtml()/pendingLateProvisionalHtml()
  // =========================================================================
  const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-app.js'), 'utf8');
  function extractFn(src, name) {
    const marker = 'function ' + name + '(';
    const start = src.indexOf(marker);
    assert.ok(start > -1, 'không tìm thấy function ' + name);
    const closeMarker = '\n  }';
    const end = src.indexOf(closeMarker, start);
    return src.slice(start, end + closeMarker.length);
  }
  function runFn(names) {
    const sandbox = { console };
    vm.createContext(sandbox);
    const helpers = 'function esc(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});}'
      + '\nfunction checklistNotificationFocusViolationIds(){return [];}'
      + '\nfunction currentRouteKey(){return "";}';
    const src = helpers + '\n' + names.map(n => extractFn(APP_SRC, n)).join('\n');
    vm.runInContext(src + '\n' + names.map(n => 'this.__' + n + ' = ' + n + ';').join('\n'), sandbox);
    return sandbox;
  }

  await checkAsync('J4a. pendingLateProvisionalHtml(): render đúng "−1" + note cố định cho từng pending item, không render số liệu nào khác', async () => {
    const sandbox = runFn(['pendingLateProvisionalHtml']);
    const form = { pending_late_events: { hasPending: true, items: [{ occurredDate: '2026-08-05', note: 'Điểm tạm tính. Điểm chính thức sẽ được xác định sau khi đối soát và phê duyệt.' }] } };
    const html = sandbox.__pendingLateProvisionalHtml(form);
    assert.ok(html.includes('−1'));
    assert.ok(html.includes('tạm tính'));
    assert.ok(html.includes('Điểm chính thức sẽ được xác định sau khi đối soát và phê duyệt'));
    assert.ok(!/\d{2,}/.test(html.replace(/2026-08-05|08\/2026|2026/g, '')), 'không được lộ số liệu nội bộ (suggestedPoints/quota) nào khác ngoài -1 và ngày');
  });
  await checkAsync('J4b. pendingLateProvisionalHtml(): không có pending_late_events -> chuỗi rỗng (không render gì)', async () => {
    const sandbox = runFn(['pendingLateProvisionalHtml']);
    assert.strictEqual(sandbox.__pendingLateProvisionalHtml({}), '');
    assert.strictEqual(sandbox.__pendingLateProvisionalHtml({ pending_late_events: { hasPending: false, items: [] } }), '');
  });
  check((() => {
    const rowFnSrc = extractFn(APP_SRC, 'roleMonthlyChecklistBreakdownHtml');
    return rowFnSrc.includes('pendingLateProvisionalHtml(form)');
  })(), 'J4c. Grep-guard: roleMonthlyChecklistBreakdownHtml() gọi pendingLateProvisionalHtml(form) — đã wiring vào UI thật');
  check((() => {
    const rowFnSrc = extractFn(APP_SRC, 'roleMonthlyChecklistBreakdownHtml');
    // base/deduct/score CHỈ tính từ b.baseScore/b.totalPoints/form.checklist_score — KHÔNG có
    // biến pendingItems nào cộng vào deduct/score.
    const scoreLine = rowFnSrc.slice(0, rowFnSrc.indexOf('var pendingItems'));
    return /deduct=Number\(b\.totalPoints\|\|0\)/.test(scoreLine) && !/pendingItems/.test(scoreLine);
  })(), 'K1. Grep-guard: deduct/score tính TRƯỚC khi biết pendingItems tồn tại — không có đường nào để -1 cộng vào điểm hiển thị');

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
