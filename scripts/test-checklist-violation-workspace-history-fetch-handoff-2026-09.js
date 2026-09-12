'use strict';
/*
 * Regression - GET /api/data?checklistWorkspace=1 -> fetchViolationWorkspaceSnapshot() ->
 * window.__phfLocalData -> resolveEmployeeAssignmentAt() SEAM (2026-09-12, version-
 * consistency audit round 4).
 *
 * Round 3's tests (test-checklist-violation-historical-assignment-resolution-2026-09.js /
 * test-checklist-violation-workspace-history-2026-09.js) proved resolveEmployeeAssignmentAt()
 * and hydrateChecklistAssignmentHistory() work correctly IN ISOLATION - but they hand-built
 * the `data` object and called those functions directly, skipping the one real function that
 * turns a network response into that `data` object: fetchViolationWorkspaceSnapshot(). PROD
 * showed the isolated pieces were fine but the real browser still failed, because that glue
 * function (written in PR #74, before checklistAssignmentHistory existed) never copied
 * data.checklistAssignmentHistory onto window.__phfLocalData before hydrating.
 *
 * This test drives the REAL app through a REAL jsdom DOM and a mocked `window.fetch` that
 * returns the EXACT api/data.js JSON shape (checklistWorkspace=1 compact payload, including
 * checklistAssignmentHistory) - same convention as
 * scripts/test-checklist-apply-timing-real-dom-click-v1.js. It never constructs
 * checklistAssignmentHistoryByKey directly. fetchViolationWorkspaceSnapshot() runs exactly as
 * shipped, reached only through the PUBLIC window.phfRenderChecklist() entry point and a real
 * employee-selection DOM click. resolveEmployeeAssignmentAt() is private to the IIFE by
 * design (not part of window.phf*), so this test exposes that one already-executed function
 * on window (one appended line, in this test's in-memory copy of the source only - see
 * EXPOSE_MARKER below) purely to call it afterward with the state the real fetch produced -
 * it is the real function, in the real closure, never re-implemented or extracted/recompiled.
 *
 *   node scripts/test-checklist-violation-workspace-history-fetch-handoff-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const rawCode = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
// resolveEmployeeAssignmentAt() is private to the top-level IIFE (by design - it is not part
// of the app's public window.phf* surface). To call the REAL function (not a re-implementation,
// not an extracted-and-recompiled fragment) after driving it through the REAL fetch/hydrate
// pipeline below, this appends ONE line exposing it on window immediately before the IIFE's
// closing `})();` - the exact same closure, same execution, same state as production; nothing
// about the function's behavior is altered. This exposure exists ONLY in this test's in-memory
// copy of the source string, never in the shipped file.
const trailingCloseRe = /\}\)\(\);\s*$/;
if (!trailingCloseRe.test(rawCode)) {
  throw new Error('phf-checklist-app.js no longer ends with the expected `})();` - update this test\'s debug-hook injection point.');
}
const code = rawCode.replace(trailingCloseRe, '\nwindow.__phfChecklistTestHooks={resolveEmployeeAssignmentAt:resolveEmployeeAssignmentAt};\n})();\n');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

// PHF012-shape fixture, exactly as independently verified on PROD MAIN in this audit round:
// current assignment effective 12/09 (TBP-HCNS-1.5), history row whose previous_data carries
// the 01/08-effective TBP-HCNS-1.2 assignment.
const PHF012_PEOPLE_ROW = {
  employeeId: 'ID-PHF012', employeeCode: 'PHF012', employeeName: 'PHF012 Test',
  department: 'HCNS', title: 'TBP', branch: 'VP',
  managerId: '', managerCode: '', managerName: '', employeeStatus: 'Đang làm việc',
  templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12'
};
const CHECKLIST_ASSIGNMENT_HISTORY = [{
  employeeKey: 'phf012', employeeId: 'ID-PHF012', employeeCode: 'PHF012',
  templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12',
  changedAt: '2026-09-12T03:00:00Z',
  previousTemplateId: 'qtth-hcns-thang', previousTemplateVersion: 'TBP-HCNS-1.2', previousEffectiveDate: '2026-08-01'
}];
const CHECKLIST_TEMPLATES = [{
  templateKey: 'qtth-hcns-thang', code: 'HCNS', name: 'QTTH/HCNS – Trưởng bộ phận', groupName: 'HCNS',
  templateType: 'checklist_detail', hasChecklist: true, source: '', note: '', status: 'active',
  version: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12', updatedAt: '2026-09-12T10:00:00Z',
  versions: [
    { version: 'TBP-HCNS-1.2', effectiveDate: '2026-08-01', createdAt: '2026-08-01T00:00:00Z', definition: { groups: [{ name: 'Nhóm', children: [{ name: 'Nhóm con', items: [['OLD-01', 'Tiêu chí cũ 1.2', 1]] }] }] } },
    { version: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12', createdAt: '2026-09-12T10:00:00Z', definition: { groups: [{ name: 'Nhóm', children: [{ name: 'Nhóm con', items: [['NEW-01', 'Tiêu chí mới 1.5', 1]] }] }] } }
  ],
  definition: { groups: [{ name: 'Nhóm', children: [{ name: 'Nhóm con', items: [['NEW-01', 'Tiêu chí mới 1.5', 1]] }] }] }
}];

async function buildDom() {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/ghi-nhan-loi', runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  /* checklistEmployees() (the admin combobox source when roleWorkspaceState.data.people is
     empty - admin never calls loadRoleWorkspace()) builds its rows from
     window.__phfLocalData.hubAccounts, populated by the GENERAL /api/data bootstrap that
     already ran before the Admin ever opens Ghi nhận lỗi - a separate, unrelated fetch from
     the one under test here. Pre-seeding it simulates that pre-existing state; it is NOT
     part of the checklistWorkspace=1 seam being verified. */
  window.__phfLocalData = { hubAccounts: [{ id: PHF012_PEOPLE_ROW.employeeId, employeeId: PHF012_PEOPLE_ROW.employeeId, employeeCode: PHF012_PEOPLE_ROW.employeeCode, name: PHF012_PEOPLE_ROW.employeeName, status: 'active', accountType: 'employee' }] };
  window.eval(code);
  return dom;
}

function makeFetch(calls) {
  return async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET' && u.indexOf('checklistWorkspace=1') >= 0) {
      calls.push('GET checklistWorkspace=1');
      // Exact shape of api/data.js's checklistWorkspaceMode response.
      return response({
        ok: true, checklistWorkspace: true,
        employees: [{ id: PHF012_PEOPLE_ROW.employeeId, employeeId: PHF012_PEOPLE_ROW.employeeId, code: PHF012_PEOPLE_ROW.employeeCode, employeeCode: PHF012_PEOPLE_ROW.employeeCode, name: PHF012_PEOPLE_ROW.employeeName, employeeName: PHF012_PEOPLE_ROW.employeeName, department: PHF012_PEOPLE_ROW.department, title: PHF012_PEOPLE_ROW.title, branch: PHF012_PEOPLE_ROW.branch, employeeStatus: PHF012_PEOPLE_ROW.employeeStatus, templateId: PHF012_PEOPLE_ROW.templateId, templateVersion: PHF012_PEOPLE_ROW.templateVersion, effectiveDate: PHF012_PEOPLE_ROW.effectiveDate }],
        checklistWorkspaceCompact: true,
        checklistAssignmentsReady: true, checklistAssignmentsError: '',
        checklistAssignmentHistory: CHECKLIST_ASSIGNMENT_HISTORY,
        checklistTemplates: CHECKLIST_TEMPLATES, checklistTemplatesReady: true, checklistTemplatesError: '',
        checklistViolationMode: 'production', checklistViolationModeReady: true, checklistViolationModeError: '',
        generatedAt: new Date().toISOString()
      });
    }
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
    if (u.indexOf('checklistRoleWorkspace=1') >= 0 || body.action === 'getChecklistRoleWorkspace') {
      calls.push('POST getChecklistRoleWorkspace');
      return response({
        ok: true, role: 'admin', identity: { id: 'admin-1', employeeCode: 'PHF000' }, grant: null,
        ownAssignment: null,
        people: [PHF012_PEOPLE_ROW],
        generatedAt: new Date().toISOString()
      });
    }
    calls.push('OTHER ' + method + ' ' + u + (body.action ? (' action=' + body.action) : ''));
    return response({ ok: true });
  };
}

async function run() {
  const calls = [];
  const dom = await buildDom();
  const { window } = dom;
  window.fetch = makeFetch(calls);

  await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi');
  await tick(50);
  await tick(50);
  await tick(50);

  check(calls.some(c => c === 'GET checklistWorkspace=1'), 'real GET /api/data?checklistWorkspace=1 was actually issued by the app');

  console.log('== window.__phfLocalData survives the fetch->state handoff (the actual fixed line) ==');
  const localData = window.__phfLocalData || {};
  check(Array.isArray(localData.checklistAssignmentHistory), 'window.__phfLocalData.checklistAssignmentHistory is an array after the real fetch (was undefined before this fix)');
  check((localData.checklistAssignmentHistory || []).length === 1, 'contains exactly the 1 API-returned history row');
  const historyRow = (localData.checklistAssignmentHistory || [])[0] || {};
  check(historyRow.previousTemplateId === 'qtth-hcns-thang' && historyRow.previousTemplateVersion === 'TBP-HCNS-1.2' && historyRow.previousEffectiveDate === '2026-08-01',
    'the row content is exactly the API-returned PHF012 history (previousTemplateId/previousTemplateVersion/previousEffectiveDate)');

  const root = window.document.getElementById('phfChecklistRoot');
  check(!!root, 'phfChecklistRoot mounted');

  // Real employee selection via the REAL combobox option button (rendered unconditionally in
  // the DOM, just visually hidden until focused - clicking it directly is exactly what the
  // real delegated click handler (data-phfck-employee-option) listens for).
  const employeeOption = root.querySelector('[data-phfck-employee-option="' + PHF012_PEOPLE_ROW.employeeId + '"]');
  check(!!employeeOption, 'real employee combobox option for PHF012 is present in the rendered DOM');
  if (employeeOption) employeeOption.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(50);
  await tick(50);

  const dateInput = root.querySelector('[data-phfck-quick-date]');
  check(!!dateInput, 'real quick-mode date input is present after selecting the employee');

  console.log('== 2026-09-10 (before current assignment 12/09, on/after historical assignment 01/08) ==');
  if (dateInput) {
    dateInput.value = '2026-09-10';
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  await tick(50);
  const html10 = root.innerHTML;
  check(html10.indexOf('Không tìm thấy phân công') === -1, '10/09: does NOT show "Không tìm thấy phân công Checklist có hiệu lực" (the exact PROD regression symptom)');

  console.log('== 2026-09-12 (current assignment cutover) ==');
  if (dateInput) {
    dateInput.value = '2026-09-12';
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  await tick(50);
  const html12 = root.innerHTML;
  check(html12.indexOf('Không tìm thấy phân công') === -1, '12/09: does NOT show "Không tìm thấy phân công Checklist có hiệu lực"');

  console.log('== resolveEmployeeAssignmentAt() - the REAL resolver, fed by the REAL fetch above, not a hand-built checklistAssignmentHistoryByKey ==');
  const resolveEmployeeAssignmentAt = window.__phfChecklistTestHooks && window.__phfChecklistTestHooks.resolveEmployeeAssignmentAt;
  check(typeof resolveEmployeeAssignmentAt === 'function', 'resolveEmployeeAssignmentAt() hook is reachable');
  if (resolveEmployeeAssignmentAt) {
    const person = { code: PHF012_PEOPLE_ROW.employeeCode, id: PHF012_PEOPLE_ROW.employeeId, name: PHF012_PEOPLE_ROW.employeeName };
    const r10 = resolveEmployeeAssignmentAt(person, '2026-09-10');
    check(!!r10, '10/09: resolveEmployeeAssignmentAt finds a historical assignment (not null)');
    check(!!r10 && r10.templateId === 'qtth-hcns-thang', '10/09: templateId = qtth-hcns-thang');
    check(!!r10 && r10.templateVersion === 'TBP-HCNS-1.2', '10/09: templateVersion = TBP-HCNS-1.2 (got ' + (r10 && r10.templateVersion) + ')');
    check(!!r10 && r10.effectiveDate === '2026-08-01', '10/09: effectiveDate = 2026-08-01 (got ' + (r10 && r10.effectiveDate) + ')');

    const r12 = resolveEmployeeAssignmentAt(person, '2026-09-12');
    check(!!r12, '12/09: resolveEmployeeAssignmentAt finds the current assignment');
    check(!!r12 && r12.templateId === 'qtth-hcns-thang', '12/09: templateId = qtth-hcns-thang');
    check(!!r12 && r12.templateVersion === 'TBP-HCNS-1.5', '12/09: templateVersion = TBP-HCNS-1.5 (got ' + (r12 && r12.templateVersion) + ')');
    check(!!r12 && r12.effectiveDate === '2026-09-12', '12/09: effectiveDate = 2026-09-12 (got ' + (r12 && r12.effectiveDate) + ')');
  }

  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
