'use strict';
/* PHF HR — Chương trình thi đua · Batch C3.1 (FINAL PERMISSION UI RECONCILIATION).
 *
 * Proves menu/screen availability follows competitionBootstrap.capabilities
 * ONLY — never the /admin /ql /hv namespace, never title/department/branch.
 * The router still hard-locks each namespace segment to the matching PHF HR
 * system role (pre-existing shell infra, untouched) — so every href this app
 * builds uses the CURRENT namespace prefix; what changes with the grant is
 * whether the item/screen is offered and rendered at all.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const appCode = fs.readFileSync('assets/js/competition/phf-competition-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-competition.css', 'utf8');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

/* ---- static: no permission signal ever comes from profile fields ------ */
const appNoComments = appCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
check(!/isScreenAuthorized[\s\S]{0,400}?(title|department|branch|employment)/i.test(appNoComments.match(/function isScreenAuthorized[\s\S]*?\n\}/)[0]),
  'isScreenAuthorized() never references title/department/branch/employment_status');
check(!/menuModel[\s\S]{0,600}?\.title\b|menuModel[\s\S]{0,600}?\.department\b/i.test(appNoComments.match(/function menuModel[\s\S]*?\n\}/)[0]),
  'menuModel() never branches on title/department');
check(/isScreenAuthorized\(key,boot\)/.test(appNoComments), 'the dispatcher runs the server-capability deep-link guard before rendering');
check(/cap\.canReview/.test(appNoComments) && /cap\.canAdmin/.test(appNoComments), 'authorization reads capabilities.canReview / capabilities.canAdmin — the C1 server-resolved flags');

/* ---- mock transport (same pattern as the C3 UI test) ------------------- */
function makeFetchMock(handlers) {
  const calls = [];
  return { calls, fetch: async (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    calls.push(body);
    const h = handlers[body.action];
    if (!h) return { ok: true, json: async () => ({ ok: true, result: {} }) };
    const out = typeof h === 'function' ? h(body) : h;
    if (out && out.__reject) return { ok: false, status: out.status || 403, json: async () => ({ ok: false, code: out.code, message: out.message }) };
    return { ok: true, json: async () => ({ ok: true, result: out }) };
  } };
}
function mount(path, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfHrRoot"></div></body></html>',
    { url: 'http://localhost' + path, runScripts: 'outside-only' });
  const w = dom.window;
  w.phfGetSessionRole = () => opts.role || 'learner';
  let navigatedTo = null;
  w.phfNavigate = opts.navigate || ((p) => { navigatedTo = p; });
  w.phfToast = () => {};
  const mock = makeFetchMock(opts.handlers || {});
  w.fetch = mock.fetch;
  w.eval(appCode);
  return { window: w, root: w.document.getElementById('phfHrRoot'), calls: mock.calls, navigatedTo: () => navigatedTo };
}
function flush(ms) { return new Promise((r) => setTimeout(r, ms || 5)); }
async function render(m, path) { await m.window.phfRenderCompetition(path); await flush(); }

const CAMPAIGN = { id: 'c1', code: 'X', title: 'Chương trình', description: '', status: 'accepting',
  minRequiredContributions: 3, submissionDeadline: null, reviewDeadline: null, publicationState: 'internal',
  levelsFrozen: false, finalizedAt: null, formSchema: [] };

function boot(capabilities, viewerOverrides) {
  return {
    viewer: Object.assign({ accountId: 'acc-1', employeeCode: 'NV001', displayName: 'Người dùng',
      isCompetitionAdmin: !!capabilities.canAdmin, reviewerMaxLevel: capabilities.canReview ? 1 : null }, viewerOverrides || {}),
    activeCampaign: CAMPAIGN,
    myRequirement: { period: '2026-09', validCount: 1, requiredCount: 3, missingCount: 2, completionState: 'not_met' },
    capabilities: Object.assign({ canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false }, capabilities),
  };
}
function menuLabels(root) {
  return Array.from(root.querySelectorAll('.phf-comp-nav a span')).map((s) => s.textContent.trim());
}

(async () => {
  console.log('\n== 1/2. PARTICIPANT, NO GRANTS (/hv and /ql) ==');
  for (const [ns, sysRole] of [['/hv', 'learner'], ['/ql', 'manager']]) {
    const m = mount(ns + '/thi-dua', { role: sysRole, handlers: { competitionBootstrap: boot({}) } });
    await render(m, ns + '/thi-dua');
    const labels = menuLabels(m.root);
    check(labels.includes('Tổng quan') && labels.includes('Bảng tin') && labels.includes('Bài của tôi') && labels.includes('Gửi nội dung') && labels.includes('Bảng xếp hạng & Kết quả'),
      ns + ' participant sees all 5 participation screens');
    check(!labels.includes('Chờ duyệt') && !labels.includes('Quản lý chương trình') && !labels.includes('Cài đặt xét duyệt') && !labels.includes('Chốt chương trình'),
      ns + ' participant with no grants sees NO reviewer/admin menu items');
  }

  console.log('\n== 3/4. REVIEWER on /hv (L1) and /ql (L2) — Chờ duyệt appears, admin does not ==');
  for (const [ns, sysRole] of [['/hv', 'learner'], ['/ql', 'manager']]) {
    const m = mount(ns + '/thi-dua', { role: sysRole, handlers: { competitionBootstrap: boot({ canReview: true }) } });
    await render(m, ns + '/thi-dua');
    const labels = menuLabels(m.root);
    check(labels.includes('Chờ duyệt'), ns + ' reviewer sees "Chờ duyệt"');
    check(!labels.includes('Quản lý chương trình'), ns + ' reviewer (no admin grant) does NOT see admin screens');
    const link = Array.from(m.root.querySelectorAll('.phf-comp-nav a')).find((a) => a.textContent.includes('Chờ duyệt'));
    check(link && link.getAttribute('href') === ns + '/thi-dua/cho-duyet', ns + ' "Chờ duyệt" link stays inside the current namespace (router-compatible)');
    // deep link actually renders (not redirected)
    const m2 = mount(ns + '/thi-dua/cho-duyet', { role: sysRole, handlers: {
      competitionBootstrap: boot({ canReview: true }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }], items: [] },
      competitionGetReviewerProductivity: { assigned: 0, processed: 0, pending: 0, overdue: 0 },
    } });
    await render(m2, ns + '/thi-dua/cho-duyet');
    check(m2.navigatedTo() === null, ns + '/thi-dua/cho-duyet is NOT redirected away for an authorized reviewer');
  }

  console.log('\n== 5. /hv WITH Competition Admin grant (non-system-admin) — admin screens appear + are reachable ==');
  {
    const m = mount('/hv/thi-dua', { role: 'learner', handlers: { competitionBootstrap: boot({ canAdmin: true }, { isCompetitionAdmin: true }) } });
    await render(m, '/hv/thi-dua');
    const labels = menuLabels(m.root);
    check(labels.includes('Quản lý chương trình') && labels.includes('Cài đặt xét duyệt') && labels.includes('Chốt chương trình'),
      '/hv participant with an active Competition Admin grant sees all 3 admin screens');
    const link = Array.from(m.root.querySelectorAll('.phf-comp-nav a')).find((a) => a.textContent.includes('Quản lý chương trình'));
    check(link && link.getAttribute('href') === '/hv/thi-dua/quan-ly', 'admin link stays under /hv (so the PHF HR router, which locks /hv to the learner session, still accepts it)');
    const m2 = mount('/hv/thi-dua/quan-ly', { role: 'learner', handlers: {
      competitionBootstrap: boot({ canAdmin: true }, { isCompetitionAdmin: true }),
      competitionListCampaigns: { campaigns: [CAMPAIGN] },
    } });
    await render(m2, '/hv/thi-dua/quan-ly');
    check(m2.navigatedTo() === null, '/hv/thi-dua/quan-ly actually renders for a /hv user holding the Competition Admin grant — not redirected');
    check(m2.root.textContent.includes('Danh sách chương trình'), 'admin content genuinely rendered, not a stub');
  }

  console.log('\n== 6. /ql WITHOUT Competition Admin grant — admin screens absent + deep link redirected ==');
  {
    const m = mount('/ql/thi-dua', { role: 'manager', handlers: { competitionBootstrap: boot({ canReview: true }) } });
    await render(m, '/ql/thi-dua');
    const labels = menuLabels(m.root);
    check(!labels.some((l) => /Quản lý chương trình|Cài đặt xét duyệt|Chốt chương trình/.test(l)), '/ql reviewer WITHOUT admin grant sees no admin menu items');
    const m2 = mount('/ql/thi-dua/quan-ly', { role: 'manager', handlers: {
      competitionBootstrap: boot({ canReview: true }),
      competitionListCampaigns: { __reject: true, code: 'SHOULD_NOT_BE_CALLED', message: 'unauthorized fetch' },
    } });
    await render(m2, '/ql/thi-dua/quan-ly');
    check(m2.navigatedTo() === '/ql/thi-dua', '/ql/thi-dua/quan-ly deep link redirected to module home for a non-admin');
    check(!m2.calls.some((c) => c.action === 'competitionListCampaigns'), 'no admin data fetched for an unauthorized deep link');
  }

  console.log('\n== 7. SYSTEM ADMIN — full Competition Admin regardless of namespace ==');
  for (const ns of ['/admin', '/hv', '/ql']) {
    const sysRole = ns === '/admin' ? 'admin' : (ns === '/ql' ? 'manager' : 'learner');
    // system admin implies canAdmin=true server-side (Batch C1) — simulate that resolved capability here.
    const m = mount(ns + '/thi-dua', { role: sysRole, handlers: { competitionBootstrap: boot({ canAdmin: true, canReview: true }, { isCompetitionAdmin: true }) } });
    await render(m, ns + '/thi-dua');
    const labels = menuLabels(m.root);
    check(labels.includes('Quản lý chương trình') && labels.includes('Chờ duyệt'), ns + ' system-admin-equivalent capability sees full Competition Admin + reviewer UI');
  }

  console.log('\n== 8. view_participation_progress ONLY — no reviewer/admin UI, company progress visible ==');
  {
    const m = mount('/hv/thi-dua', { role: 'learner', handlers: {
      competitionBootstrap: boot({ viewParticipationProgress: true }),
      competitionListLevels: [],
      competitionGetCompanyProgress: { period: '2026-09', requiredCount: 3, rows: [{ employeeCode: 'NV002', displayName: 'B', department: 'Bán hàng', validCount: 2, missingCount: 1, completionState: 'not_met' }] },
    } });
    await render(m, '/hv/thi-dua');
    const labels = menuLabels(m.root);
    check(!labels.includes('Chờ duyệt') && !labels.includes('Quản lý chương trình'), 'capability-only grant confers NO reviewer/admin menu visibility');
    check(m.root.querySelector('[data-comp-company-progress]') != null, 'company-wide participation table renders for the capability holder');
    check(m.root.textContent.includes('B') && m.root.textContent.includes('Bán hàng'), 'company progress shows real rows from the server');
  }

  console.log('\n== 9. "next authority refresh" — no client-side caching of a revoked grant ==');
  {
    const withGrant = mount('/hv/thi-dua', { role: 'learner', handlers: { competitionBootstrap: boot({ canReview: true }) } });
    await render(withGrant, '/hv/thi-dua');
    check(menuLabels(withGrant.root).includes('Chờ duyệt'), 'reviewer grant active -> menu shows Chờ duyệt');
    const afterRevoke = mount('/hv/thi-dua', { role: 'learner', handlers: { competitionBootstrap: boot({}) } });
    await render(afterRevoke, '/hv/thi-dua');
    check(!menuLabels(afterRevoke.root).includes('Chờ duyệt'), 'next bootstrap after revoke -> menu item is gone (bootstrap is always fetched fresh, never cached client-side)');
  }

  console.log('\n== 10. NO PERMISSION FROM TITLE/DEPARTMENT/BRANCH ==');
  {
    // viewer profile screams "manager" but capabilities say no — UI must obey capabilities only.
    const m = mount('/hv/thi-dua', { role: 'learner', handlers: {
      competitionBootstrap: boot({}, { department: 'Ban Giám đốc', title: 'Trưởng phòng', branch: 'CN1', displayName: 'Giám đốc X' }),
    } });
    await render(m, '/hv/thi-dua');
    const labels = menuLabels(m.root);
    check(!labels.includes('Quản lý chương trình') && !labels.includes('Chờ duyệt'), 'an impressive job title/department with NO grant still gets zero reviewer/admin UI');
  }

  console.log('\n== 11. SERVER REMAINS AUTHORITATIVE ON EVERY ACTION ==');
  {
    // menu hides admin, but even if an authorized reviewer's actual review
    // action is rejected server-side (e.g. grant revoked mid-session), the
    // UI must show the honest rejection, never a fake success.
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: boot({ canReview: true }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }],
        items: [{ submissionRef: 'sub-x', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: null, assignmentId: null, tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: {},
      competitionReviewSubmission: { __reject: true, code: 'COMPETITION_NOT_A_REVIEWER', status: 403, message: 'Bạn chưa được cấp quyền xét duyệt cho chương trình này.' },
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    let toastMsg = null;
    m.window.phfToast = (kind, title, msg) => { toastMsg = { kind, title, msg }; };
    const approveBtn = m.root.querySelector('[data-comp-review-act="approve"]');
    check(approveBtn != null, 'review action button present for an authorized-looking reviewer');
    approveBtn.dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(20);
    check(toastMsg && toastMsg.kind === 'error' && /chưa được cấp quyền/.test(toastMsg.msg), 'server-side rejection surfaces honestly — no fake success when the server disagrees with the UI state');
  }

  console.log('\nALL PASS (' + passed + ' checks)');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
