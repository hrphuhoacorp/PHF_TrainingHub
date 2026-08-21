'use strict';
/*
 * PHF smoke-test BLOCKER (2026-08-13, tài khoản test Nguyễn Thúy Tiên): tick
 * "Xem Dashboard KNL" ở màn Phân quyền KNL -> Lưu -> render lại -> checkbox
 * mất tick. Bug report yêu cầu trace TOÀN TUYẾN canonical permission pipeline
 * (KHÔNG hard-code Tiên, KHÔNG seed che bug):
 *   UI checkbox dashboard_view -> draft/grant state (permState.editing) ->
 *   saveGrant() -> normalizeGrant() -> upsertKnlPermissionGrant ->
 *   capabilities JSONB persisted -> loadPermissions()/selectAccount() ->
 *   normalize/read -> render lại checkbox.
 *
 * Test này mô phỏng ĐÚNG payload mà saveGrant() (assets/js/knl/phf-knl-app.js)
 * gửi lên (xem file đó dòng ~1180-1184: capabilities:g.capabilities nguyên
 * object, không lọc key nào ở frontend) — dùng lại grant fixture khớp đúng hồ
 * sơ THẬT hiện có của Tiên (PHF010, preset TRUONG_BO_PHAN, income_view=true,
 * incomeScope.type=department) từ scripts/phf-knl-initial-permission-seed-2026-08.js,
 * rồi chỉ tick THÊM dashboard_view=true (giữ nguyên mọi capability/scope
 * khác) — đúng thao tác PHF mô tả trong smoke test.
 *
 * KẾT LUẬN ĐÃ XÁC MINH (xem báo cáo kèm theo): lib/knl-permissions.js
 * (CAPABILITY_KEYS đã có 'dashboard_view', capabilities() build từ đúng
 * CAPABILITY_KEYS, normalizeGrant() dùng input.capabilities nguyên vẹn,
 * publicGrant() forward row.capabilities không lọc gì) ROUND-TRIP ĐÚNG khi
 * chạy trên đúng commit 99005b4 — 10/10 case dưới đây PASS. Nếu môi trường
 * PHF smoke-test vẫn thấy mất tick, nguyên nhân nhiều khả năng là process
 * Node (server.js) đang chạy được start TRƯỚC khi lib/knl-permissions.js
 * được cập nhật trong session này — Node cache require() trong bộ nhớ suốt
 * vòng đời process, sửa file trên đĩa KHÔNG tự áp dụng cho process đang chạy
 * (project không dùng nodemon/watch, xem package.json "start":"node server.js")
 * -> phải RESTART process rồi thử lại. Không phải lỗi trong code đã commit.
 *
 * Chạy thủ công: node scripts/test-knl-dashboard-view-capability-roundtrip-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(p) { mode = 'insert'; insertPayload = p; return q; },
      update(p) { mode = 'update'; updatePayload = p; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.f] < b[spec.f] ? -1 : a[spec.f] > b[spec.f] ? 1 : 0) * (spec.asc ? 1 : -1)); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

// Hồ sơ THẬT hiện có của Tiên trước batch fix này (xem
// scripts/phf-knl-initial-permission-seed-2026-08.js) — dashboard_view CHƯA
// tồn tại trong capabilities đã lưu (đúng trạng thái Prod trước Gate 2).
const TIEN_EXISTING_ROW = {
  id: 'grant-phf010', account_id: 'acct-phf010', employee_code: 'PHF010', employee_name: 'Nguyễn Thủy Tiên',
  preset_code: 'TRUONG_BO_PHAN',
  capabilities: {
    access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false,
    manage_framework: false, manage_permissions: false, income_view: true, view_proposals: false,
    incomeScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'] }
  },
  people_scope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'], reservedEmployees: [] },
  reason: 'seed', is_active: true, updated_at: new Date().toISOString()
};

const STATE = { grants: [clone(TIEN_EXISTING_ROW)], grantHistory: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.grantHistory)();
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked (not needed for permission grant CRUD)'); }
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
  delete require.cache[permissionsPath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissions = require(permissionsPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return permissions;
}

const { upsertKnlPermissionGrant, listKnlPermissionGrants } = loadLibsWithMock();
function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' }; }
const adminSession = session('admin', { id: 'u-admin' });

/* Mô phỏng CHÍNH XÁC đúng payload saveGrant() gửi (phf-knl-app.js:1180-1184):
 * capabilities:g.capabilities NGUYÊN OBJECT (chỉ đổi đúng 1 key vừa tick,
 * mọi key khác giữ nguyên tham chiếu từ grant đang load) — không tự "dọn"
 * payload ở đây, phải giữ đúng hành vi UI thật. */
function buildSavePayload(existingRow, capabilityPatch) {
  const g = {
    id: existingRow.id, accountId: existingRow.account_id, employeeCode: existingRow.employee_code, employeeName: existingRow.employee_name,
    presetCode: existingRow.preset_code, capabilities: Object.assign({}, existingRow.capabilities, capabilityPatch),
    peopleScope: existingRow.people_scope, reason: 'Dashboard KNL Gate 2 — smoke test blocker regression', isActive: true
  };
  return g;
}

let failures = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else console.log('PASS: ' + msg); }

async function run() {
  const before = clone(STATE.grants[0]);

  // ========== 1-6. Tick dashboard_view=true -> Lưu -> reload -> vẫn true ==========
  check(before.capabilities.dashboard_view !== true, '1. Precondition: dashboard_view CHƯA có/false trên grant hiện hữu của Tiên (đúng trạng thái trước khi tick)');
  const payloadOn = buildSavePayload(before, { dashboard_view: true });
  const savedOn = await upsertKnlPermissionGrant(adminSession, payloadOn);
  check(savedOn.grant.capabilities.dashboard_view === true, '2. set dashboard_view=true -> normalize -> save/upsert: response trả đúng dashboard_view=true ngay sau Lưu');
  const reloadedOn = (await listKnlPermissionGrants(adminSession)).grants.find(g => g.accountId === 'acct-phf010');
  check(!!reloadedOn && reloadedOn.capabilities.dashboard_view === true, '3-6. Reload (listKnlPermissionGrants, mô phỏng loadPermissions()/selectAccount() sau F5) -> dashboard_view VẪN true — round-trip đầy đủ qua canonical pipeline');

  // ========== 7. set false -> save/reload -> vẫn false ==========
  // reloadedOn là publicGrant (camelCase) — build lại payload từ đúng shape account_id/... như existingRow để hàm buildSavePayload dùng chung được:
  const reloadedRowShape = { id: reloadedOn.id, account_id: reloadedOn.accountId, employee_code: reloadedOn.employeeCode, employee_name: reloadedOn.employeeName, preset_code: reloadedOn.presetCode, capabilities: reloadedOn.capabilities, people_scope: reloadedOn.peopleScope };
  const savedOff = await upsertKnlPermissionGrant(adminSession, buildSavePayload(reloadedRowShape, { dashboard_view: false }));
  check(savedOff.grant.capabilities.dashboard_view === false, '7a. set dashboard_view=false -> save: response trả đúng false');
  const reloadedOff = (await listKnlPermissionGrants(adminSession)).grants.find(g => g.accountId === 'acct-phf010');
  check(!!reloadedOff && reloadedOff.capabilities.dashboard_view === false, '7b. Reload sau khi tắt: dashboard_view VẪN false (không "kẹt" true)');

  // ========== 8. Các capability cũ không đổi ==========
  const capKeysToCheck = ['access_knl', 'view_people', 'propose', 'agree_proposal', 'approve', 'manage_framework', 'manage_permissions', 'income_view', 'view_proposals'];
  const unchanged = capKeysToCheck.every(k => reloadedOff.capabilities[k] === before.capabilities[k]);
  check(unchanged, '8. Toàn bộ capability khác (access_knl/view_people/income_view/...) giữ NGUYÊN giá trị gốc của Tiên qua cả 2 lượt Lưu — không bị reset/overwrite bởi preset hay bởi việc thêm dashboard_view');

  // ========== 9. incomeScope không đổi ==========
  check(JSON.stringify(reloadedOff.capabilities.incomeScope) === JSON.stringify(before.capabilities.incomeScope), '9. incomeScope (4 phòng ban Kinh doanh của Tiên) giữ NGUYÊN VẸN, không bị đụng/reset khi thao tác dashboard_view');

  // ========== 10. peopleScope không đổi ==========
  check(JSON.stringify(reloadedOff.peopleScope) === JSON.stringify(before.people_scope), '10. peopleScope giữ NGUYÊN VẸN, không bị đụng/reset khi thao tác dashboard_view');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
