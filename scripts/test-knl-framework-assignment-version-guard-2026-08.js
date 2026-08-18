'use strict';
/* Framework Assignment version-status blocker fix (post-KNL-13). Confirmed
 * via prior read-only audit: saveKnlFrameworkAssignment let Admin create an
 * assignment pointing at a framework version that was not published+locked
 * (PHF042 accidental-save incident, 2026-08-18) — Survey already enforces
 * this exact invariant (listPublishedVersions, lib/knl-surveys.js) but
 * Framework Assignment never did. This test covers both layers:
 * - SERVICE (authoritative): lib/knl-assignments.js#saveKnlFrameworkAssignment
 *   must reject any version where status!=='published' or is_locked!==true,
 *   with error code KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED, without changing
 *   any other existing validation/upsert/history semantics.
 * - UI (prevention only): assets/js/knl/phf-knl-app.js must only offer
 *   published+locked versions in the Phiên bản dropdown shared by the 3
 *   Framework Assignment modes (employee/position/bulk) — Competency Grade
 *   Assignment's own version dropdown is untouched/out of scope.
 * No migration, no schema change — pure application-level guard. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

/* =================== PART 1: SERVICE (backend, authoritative) =================== */
(async () => {
  let uuidSeq = 1000; /* start high to never collide with the hardcoded V_* fixture ids below (…001-…005, …099) */
  const uuid = () => ('00000000-0000-4000-8000-' + String(uuidSeq++).padStart(12, '0'));
  const V_PUBLISHED_LOCKED = '00000000-0000-4000-8000-000000000001';
  const V_DRAFT_UNLOCKED = '00000000-0000-4000-8000-000000000002';
  const V_DRAFT_LOCKED = '00000000-0000-4000-8000-000000000003';
  const V_PUBLISHED_UNLOCKED = '00000000-0000-4000-8000-000000000004';
  const V_INACTIVE_LOCKED = '00000000-0000-4000-8000-000000000005';
  const V_NOT_FOUND = '00000000-0000-4000-8000-000000000099';

  const dbState = {
    versions: [
      { id: V_PUBLISHED_LOCKED, framework_id: 'f1', status: 'published', is_locked: true },
      { id: V_DRAFT_UNLOCKED, framework_id: 'f1', status: 'draft', is_locked: false },
      { id: V_DRAFT_LOCKED, framework_id: 'f1', status: 'draft', is_locked: true },
      { id: V_PUBLISHED_UNLOCKED, framework_id: 'f1', status: 'published', is_locked: false },
      { id: V_INACTIVE_LOCKED, framework_id: 'f1', status: 'inactive', is_locked: true }
    ],
    assignments: []
  };

  class Query {
    constructor(table) { this.table = table; this.mode = 'select'; this.payload = null; this.filters = []; }
    select() { return this; } eq(key, value) { this.filters.push([key, value]); return this; } order() { return this; }
    insert(payload) { this.mode = 'insert'; this.payload = payload; return this; }
    update(payload) { this.mode = 'update'; this.payload = payload; return this; }
    rows() { const source = this.table === 'knl_framework_versions' ? dbState.versions : (this.table === 'knl_framework_assignments' ? dbState.assignments : []); return source.filter(row => this.filters.every(([k, v]) => row[k] === v)); }
    execute() {
      if (this.mode === 'select') return { data: this.rows(), error: null };
      if (this.mode === 'insert') { const row = { ...this.payload, id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; dbState.assignments.push(row); return { data: row, error: null }; }
      const rows = this.rows(); rows.forEach(row => Object.assign(row, this.payload)); return { data: rows, error: null };
    }
    maybeSingle() { const out = this.execute(); if (Array.isArray(out.data)) out.data = out.data[0] || null; return Promise.resolve(out); }
    single() { const out = this.execute(); if (Array.isArray(out.data)) out.data = out.data[0] || null; return Promise.resolve(out); }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }
  const mockDb = { from(table) { return new Query(table); } };

  process.env.SUPABASE_URL = 'https://unit.test'; process.env.SUPABASE_SECRET_KEY = 'unit-secret';
  const supabasePath = require.resolve('@supabase/supabase-js'), peoplePath = require.resolve('../lib/knl-people'), servicePath = require.resolve('../lib/knl-assignments');
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { createClient: () => mockDb } };
  require.cache[peoplePath] = {
    id: peoplePath, filename: peoplePath, loaded: true, exports: {
      listKnlAssignmentTargets: async () => ({ people: [{ employeeCode: 'E1', employeeName: 'Employee One', title: 'NV', position: '', department: 'Sales', branch: 'A' }], positions: [], organizationConflict: null }),
      resolveKnlAssignmentTarget: async (type, ref) => {
        if (type === 'employee' && ref === 'E1') return { targetType: 'employee', targetRef: 'E1', employeeCode: 'E1', positionRef: null, snapshot: { employeeCode: 'E1', employeeName: 'Employee One' } };
        const e = new Error('employee missing'); e.code = 'KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND'; throw e;
      }
    }
  };
  delete require.cache[servicePath]; const service = require('../lib/knl-assignments');
  const admin = { role: 'admin', sub: 'admin', account: { id: 'admin', name: 'Admin' } };

  // 1. published + locked -> ACCEPT
  const ok = await service.saveKnlFrameworkAssignment(admin, { versionId: V_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Gán hợp lệ theo phiên bản published+locked' });
  check(ok.assignment && ok.assignment.versionId === V_PUBLISHED_LOCKED, '1. SERVICE: published+locked -> ACCEPT, assignment tạo thành công');
  check(dbState.assignments.length === 1, '1b. Đúng 1 row được tạo');

  // 2. draft + unlocked -> REJECT
  let err2 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_UNLOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Thử gán version draft chưa khóa' }); } catch (e) { err2 = e; }
  check(err2 && err2.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', '2. SERVICE: draft+unlocked -> REJECT KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED');

  // 3. draft + locked -> REJECT
  let err3 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_LOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Thử gán version draft đã khóa' }); } catch (e) { err3 = e; }
  check(err3 && err3.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', '3. SERVICE: draft+locked -> REJECT (chưa published dù đã khóa)');

  // 4. published + unlocked -> REJECT
  let err4 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_PUBLISHED_UNLOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Thử gán version published nhưng chưa khóa' }); } catch (e) { err4 = e; }
  check(err4 && err4.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', '4. SERVICE: published+unlocked -> REJECT (chưa is_locked=true)');

  // 5. inactive + locked -> REJECT
  let err5 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_INACTIVE_LOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Thử gán version đã ngưng áp dụng' }); } catch (e) { err5 = e; }
  check(err5 && err5.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', '5. SERVICE: inactive+locked -> REJECT (không phải published)');
  check(dbState.assignments.length === 1, '5b. Không có row rác nào được tạo từ 4 lần reject trên (2,3,4,5)');

  // 6. version not found -> hành vi cũ không regression
  let err6 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_NOT_FOUND, targetType: 'employee', targetRef: 'E1', reason: 'Version không tồn tại' }); } catch (e) { err6 = e; }
  check(err6 && err6.code === 'KNL_ASSIGNMENT_VERSION_NOT_FOUND', '6. SERVICE: version không tồn tại vẫn đúng KNL_ASSIGNMENT_VERSION_NOT_FOUND (không bị guard mới che mất)');

  // 7. employee validation cũ không regression (version hợp lệ nhưng employee sai)
  let err7 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'BAD', reason: 'Employee không tồn tại' }); } catch (e) { err7 = e; }
  check(err7 && err7.code === 'KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND', '7. SERVICE: version hợp lệ nhưng employee sai vẫn đúng lỗi employee (guard mới không che validation cũ)');

  // 8. history/upsert semantics cũ không đổi — gọi lại đúng target+version -> UPDATE, không tạo dòng mới
  const again = await service.saveKnlFrameworkAssignment(admin, { versionId: V_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', reason: 'Cập nhật lại lý do cho cùng assignment' });
  check(dbState.assignments.length === 1 && again.assignment.assignmentKey === ok.assignment.assignmentKey, '8. SERVICE: upsert idempotent giữ nguyên — gọi lại cùng version+target UPDATE, không tạo dòng mới');

  /* =================== DEACTIVATION EDGE CASE =================== *
   * Guard phải phân biệt CREATE/REACTIVATE/UPDATE-active (luôn cần version
   * eligible) với DEACTIVATE 1 row ĐÃ TỒN TẠI (luôn phải cho phép dù version
   * hiện không còn eligible) — đúng path rollback PHF042 2026-08-18. */

  // D1. CREATE active + published+locked (baseline cho các case sau) -> PASS
  const V2_PUBLISHED_LOCKED = uuid(); dbState.versions.push({ id: V2_PUBLISHED_LOCKED, framework_id: 'f1', status: 'published', is_locked: true });
  const createActive = await service.saveKnlFrameworkAssignment(admin, { versionId: V2_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'active', reason: 'Tạo assignment active mới cho edge-case test' });
  check(createActive.assignment.status === 'active', 'D1. CREATE active + published+locked -> PASS');
  const countAfterD1 = dbState.assignments.length;

  // D2. CREATE active + draft (target/version chưa từng tồn tại) -> REJECT
  let errD2 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'active', reason: 'Tạo assignment active vào version draft' }); } catch (e) { errD2 = e; }
  check(errD2 && errD2.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', 'D2. CREATE active + draft -> REJECT');

  // D3. CREATE active + inactive -> REJECT
  let errD3 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_INACTIVE_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'active', reason: 'Tạo assignment active vào version inactive' }); } catch (e) { errD3 = e; }
  check(errD3 && errD3.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', 'D3. CREATE active + inactive -> REJECT');
  check(dbState.assignments.length === countAfterD1, 'D3b. Không có row rác nào được tạo từ 2 lần reject D2/D3');

  // Chuẩn bị 1 "legacy row" — mô phỏng dữ liệu tạo TRƯỚC KHI có guard này (đúng
  // thực tế PHF042: đã insert thẳng vào dbState, KHÔNG qua service, vì với
  // guard mới service sẽ không bao giờ tự tạo được state này nữa).
  const legacyAssignmentKey = 'knla:' + crypto.createHash('sha256').update([V_DRAFT_UNLOCKED, 'employee', 'E1'].join('|')).digest('hex');
  dbState.assignments.push({ id: uuid(), assignment_key: legacyAssignmentKey, version_id: V_DRAFT_UNLOCKED, target_type: 'employee', target_ref: 'E1', employee_code: 'E1', position_ref: null, organization_snapshot: {}, is_primary: false, status: 'inactive', reason: 'legacy PHF042-style row (pre-guard)', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

  // D4. REACTIVATE inactive->active với version không eligible (legacy row) -> REJECT
  let errD4 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_UNLOCKED, targetType: 'employee', targetRef: 'E1', status: 'active', reason: 'Thử kích hoạt lại assignment cũ trỏ version draft' }); } catch (e) { errD4 = e; }
  check(errD4 && errD4.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', 'D4. REACTIVATE inactive->active với version không eligible -> REJECT');
  check(dbState.assignments.find(r => r.assignment_key === legacyAssignmentKey).status === 'inactive', 'D4b. Reject không làm thay đổi trạng thái row cũ (vẫn inactive nguyên vẹn)');

  // D5. Existing active assignment -> incoming inactive, version SAU ĐÓ trở thành inactive -> PASS
  const v2Row = dbState.versions.find(v => v.id === V2_PUBLISHED_LOCKED); v2Row.status = 'inactive';
  const deactivateD5 = await service.saveKnlFrameworkAssignment(admin, { versionId: V2_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'inactive', reason: 'Ngừng áp dụng vì version đã bị retire' });
  check(deactivateD5.assignment.status === 'inactive', 'D5. Existing active assignment -> incoming inactive, version đã inactive -> PASS (deactivate hợp lệ)');
  check(deactivateD5.assignment.assignmentKey === createActive.assignment.assignmentKey, 'D5b. assignment_key giữ nguyên qua deactivate (không tạo assignment mới)');

  // D6. Existing active assignment -> incoming inactive, version SAU ĐÓ chuyển về draft/unlocked -> PASS
  const V3_PUBLISHED_LOCKED = uuid(); dbState.versions.push({ id: V3_PUBLISHED_LOCKED, framework_id: 'f1', status: 'published', is_locked: true });
  const createForD6 = await service.saveKnlFrameworkAssignment(admin, { versionId: V3_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'active', reason: 'Tạo assignment active cho test D6' });
  const v3Row = dbState.versions.find(v => v.id === V3_PUBLISHED_LOCKED); v3Row.status = 'draft'; v3Row.is_locked = false;
  const countBeforeD6Deactivate = dbState.assignments.length;
  const deactivateD6 = await service.saveKnlFrameworkAssignment(admin, { versionId: V3_PUBLISHED_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'inactive', reason: 'Ngừng áp dụng vì version bị chuyển về draft' });
  check(deactivateD6.assignment.status === 'inactive', 'D6. Existing active assignment -> incoming inactive, version draft/unlocked -> PASS (deactivate hợp lệ)');
  check(deactivateD6.assignment.assignmentKey === createForD6.assignment.assignmentKey, '9. History/update semantics không đổi — deactivate D5/D6 luôn là UPDATE đúng assignment_key, không phát sinh row mới');
  check(dbState.assignments.length === countBeforeD6Deactivate, '9b. Deactivate không tăng số dòng assignment (UPDATE, không INSERT)');

  // D7. New/non-existing assignment với incoming inactive + invalid version -> REJECT
  let errD7 = null; try { await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_LOCKED, targetType: 'employee', targetRef: 'E1', status: 'inactive', reason: 'Thử tạo mới 1 row inactive trỏ version draft' }); } catch (e) { errD7 = e; }
  check(errD7 && errD7.code === 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED', 'D7. New/non-existing assignment, incoming inactive + invalid version -> REJECT (không cho "tạo mới bằng inactive" để né guard)');

  // D10 (contract PHF042 thật): legacy row đang ACTIVE trên version draft/unlocked vẫn PHẢI deactivate được
  const legacyRow = dbState.assignments.find(r => r.assignment_key === legacyAssignmentKey); legacyRow.status = 'active';
  const rollbackD10 = await service.saveKnlFrameworkAssignment(admin, { versionId: V_DRAFT_UNLOCKED, targetType: 'employee', targetRef: 'E1', status: 'inactive', reason: 'Rollback: gán nhầm khi test local (2026-08-18), ngừng áp dụng ngay sau phát hiện.' });
  check(rollbackD10.assignment.status === 'inactive' && rollbackD10.assignment.assignmentKey === legacyAssignmentKey, '10. Contract PHF042: deactivate legacy row ACTIVE trên version draft/unlocked vẫn PASS, giữ đúng assignment_key (đúng path rollback thật đã dùng 2026-08-18)');

  console.log('\n--- SERVICE part:', passed, 'checks passed so far ---\n');

  /* =================== PART 2: UI (prevention only) =================== */
  const rawCode = fs.readFileSync(path.join(root, 'assets/js/knl/phf-knl-app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/css/phf-knl.css'), 'utf8');
  const EXPORT_MARKER = /\}\)\(\);\s*$/;
  if (!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
  const code = rawCode.replace(EXPORT_MARKER,
    'window.__assignmentState=assignmentState;' +
    'window.__bulkAssignState=bulkAssignState;' +
    'window.__renderAssignmentBody=renderAssignmentBody;' +
    '\n})();');

  function installQueueFetch(window) {
    const queue = [];
    window.fetch = (url, opts) => {
      const body = JSON.parse(opts.body);
      return new Promise((resolve, reject) => {
        queue.push({
          action: body.action, body,
          resolve: (respBody) => resolve({ ok: true, json: async () => Object.assign({ ok: true }, respBody) }),
          reject: (message, code) => reject(Object.assign(new Error(message), { code }))
        });
      });
    };
    return queue;
  }
  function makeDom() {
    const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="root"><div data-knl-body></div></div></body></html>', { url: 'http://localhost/admin/knl/gan-ap-dung', runScripts: 'outside-only' });
    const { window } = dom;
    window.phfGetSessionRole = () => 'admin';
    window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
    window.eval(code);
    return dom;
  }
  function fixtureFrameworksMixedEligibility() {
    return [{
      id: 'fw1', code: 'KNL01', name: 'Khung Bán hàng', status: 'active', versions: [
        { id: 'v-eligible', versionNumber: 1, status: 'published', isLocked: true },
        { id: 'v-draft', versionNumber: 2, status: 'draft', isLocked: false },
        { id: 'v-published-unlocked', versionNumber: 3, status: 'published', isLocked: false },
        { id: 'v-inactive', versionNumber: 4, status: 'inactive', isLocked: true }
      ]
    }];
  }
  function mountAssignmentPage(window, assignmentsFixture) {
    const rootEl = window.document.getElementById('root');
    window.__assignmentState.subTab = 'gan-cho-nhan-su';
    window.__assignmentState.targets = { people: [{ employeeCode: 'E1', employeeName: 'Nhân viên Một', title: 'Nhân viên' }], positions: [{ positionRef: 'pos1', position: 'Nhân viên', department: 'Bộ phận bán hàng', branch: 'Phú Lợi' }], organizationConflict: null };
    window.__assignmentState.frameworks = fixtureFrameworksMixedEligibility();
    window.__assignmentState.assignments = assignmentsFixture || [];
    window.__assignmentState.loading = false;
    window.__renderAssignmentBody(rootEl);
    return rootEl;
  }
  function versionOptionValues(root) {
    return [...root.querySelectorAll('[data-knl-assign-version] option')].map(o => o.value).filter(Boolean);
  }

  // 9-12: chỉ published+locked selectable, draft/inactive/published-unlocked không assignable — mode mặc định (employee)
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    const values = versionOptionValues(root);
    check(values.length === 1 && values[0] === 'v-eligible', '9. UI: chỉ version published+locked xuất hiện trong dropdown Phiên bản (chế độ Nhân sự cụ thể)');
    check(!values.includes('v-draft'), '10. UI: version draft KHÔNG assignable (không có trong dropdown)');
    check(!values.includes('v-inactive'), '11. UI: version inactive KHÔNG assignable');
    check(!values.includes('v-published-unlocked'), '12. UI: version published nhưng chưa khóa KHÔNG assignable');
  }

  // 13-15: single/position/bulk đều dùng chung 1 guard (cùng danh sách version)
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const typeSelect = root.querySelector('[data-knl-target-type]'), fwSelect = root.querySelector('[data-knl-assign-framework]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    const employeeModeValues = versionOptionValues(root);
    typeSelect.value = 'position'; typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    const positionModeValues = versionOptionValues(root);
    typeSelect.value = 'bulk'; typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    const bulkModeValues = versionOptionValues(root);
    check(JSON.stringify(employeeModeValues) === JSON.stringify(['v-eligible']), '13. UI: chế độ Nhân sự cụ thể dùng đúng guard (1 version hợp lệ)');
    check(JSON.stringify(positionModeValues) === JSON.stringify(['v-eligible']), '14. UI: chế độ Vị trí tổ chức dùng CHUNG guard (cùng danh sách, không viết filter riêng)');
    check(JSON.stringify(bulkModeValues) === JSON.stringify(['v-eligible']), '15. UI: chế độ Nhiều nhân sự dùng CHUNG guard (cùng danh sách)');
  }

  // 16: bulk map lỗi backend sang tiếng Việt, không leak code
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const typeSelect = root.querySelector('[data-knl-target-type]');
    typeSelect.value = 'bulk'; typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    const row = root.querySelector('[data-knl-bulk-person-row][data-code="E1"]'); row.querySelector('input').checked = true; row.querySelector('input').dispatchEvent(new window.Event('change', { bubbles: true }));
    const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v-eligible';
    root.querySelector('[data-knl-assign-reason]').value = 'Gán hàng loạt kiểm tra lỗi version';
    root.querySelector('[data-knl-assignment-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    root.querySelector('[data-knl-bulk-confirm]').click();
    window.document.querySelector('[data-modal-confirm]').click();
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1, '16a. Bulk gửi đúng 1 request cho E1');
    queue[0].reject('Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng.', 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED');
    await new Promise(r => setTimeout(r, 10));
    // sau reject, batch chỉ có 1 row nên xong ngay -> gọi thêm 1 request refresh listKnlFrameworkAssignments
    check(queue.length === 2 && queue[1].action === 'listKnlFrameworkAssignments', '16b. Sau batch tự refresh danh sách (không API mới)');
    queue[1].resolve({ assignments: [] });
    await new Promise(r => setTimeout(r, 10));
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng'), '16c. Bulk hiển thị đúng thông điệp Việt hóa cho KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED');
    check(!html.includes('KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED'), '16d. Bulk KHÔNG leak mã lỗi kỹ thuật lên UI');
  }

  // 17: single/position không leak technical code khi backend reject
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v-eligible';
    root.querySelector('[name="employeeRef"]').value = 'E1';
    root.querySelector('[data-knl-assign-reason]').value = 'Gán đơn kiểm tra lỗi version';
    root.querySelector('[data-knl-assignment-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1, '17a. Flow đơn gửi đúng 1 request');
    queue[0].reject('Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng.', 'KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED');
    await new Promise(r => setTimeout(r, 10));
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng'), '17b. Flow đơn (Nhân sự cụ thể) hiển thị đúng thông điệp Việt hóa');
    check(!html.includes('KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED'), '17c. Flow đơn KHÔNG leak mã lỗi kỹ thuật lên UI');
  }

  // 18: assignment lịch sử/inactive cũ (kể cả trỏ version không còn eligible) vẫn render được ở "Đang áp dụng"
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const historicalRow = { id: 'hist1', targetType: 'employee', employeeCode: 'PHF042', frameworkCode: 'KNL01', frameworkName: 'Khung Bán hàng', versionNumber: 2, versionId: 'v-draft', isPrimary: false, status: 'inactive', organizationSnapshot: { employeeName: 'Nguyễn Hoàng Khang' } };
    const root = mountAssignmentPage(window, [historicalRow]);
    window.__assignmentState.subTab = 'dang-ap-dung';
    window.__renderAssignmentBody(root);
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('PHF042') && html.includes('Nguyễn Hoàng Khang'), '18. Assignment lịch sử trỏ version không còn eligible (draft) vẫn render đầy đủ ở "Đang áp dụng" — guard mới chỉ chặn WRITE, không ẩn READ');
  }

  // 19: không có native alert/confirm/prompt mới nào được thêm vào các vùng vừa sửa
  {
    const guardBlock = (rawCode.match(/function assignmentEligibleVersionOptionsForFramework[\s\S]*?\n\}/) || [''])[0];
    check(guardBlock.length > 0, '19a. (sanity) tìm thấy assignmentEligibleVersionOptionsForFramework trong source');
    check(!/\balert\(|\bconfirm\(|window\.prompt\(/.test(guardBlock), '19b. assignmentEligibleVersionOptionsForFramework không dùng native alert/confirm/prompt');
    check(!/\balert\(|\bconfirm\(|window\.prompt\(/.test(rawCode.match(/function mapBulkAssignError[\s\S]*?\n\}/)[0]), '19c. mapBulkAssignError (đã thêm map KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED) không dùng native popup');
  }

  console.log('\nKNL Framework Assignment Version Guard:', passed, 'checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
