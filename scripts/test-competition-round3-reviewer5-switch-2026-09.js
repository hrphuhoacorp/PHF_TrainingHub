'use strict';
/* PHF HR — Chương trình thi đua · ROUND 3 FINAL POLISH — Chờ duyệt level control.
 *
 * Targeted regression for the ONE remaining gap found during the Production
 * go-live source reconciliation: the multi-level ("Reviewer 5đ") review
 * control was still a raw <select data-comp-level-select> — read by the
 * operator as a technical control rather than a reviewing action. The
 * single-level ("Reviewer 2đ") static badge (data-comp-fixed-level) was
 * already correct and is untouched; this file proves it stays that way
 * while the multi-level control becomes a segmented switch.
 *
 * Mounts the REAL renderer — same harness as
 * scripts/test-competition-c3-ui-2026-09.js — against a mocked /api/data.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const appCode = fs.readFileSync('assets/js/competition/phf-competition-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-competition.css', 'utf8');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');
check(!/<select[^>]*data-comp-level-select/.test(appCode), 'the raw <select> level picker is gone from renderReviewQueue');

function makeFetchMock(handlers) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts) => {
      const body = JSON.parse(opts.body || '{}');
      calls.push(body);
      const h = handlers[body.action];
      if (!h) return { ok: true, json: async () => ({ ok: true, result: {} }) };
      const out = typeof h === 'function' ? h(body) : h;
      if (out && out.__reject) return { ok: false, status: out.status || 400, json: async () => ({ ok: false, code: out.code, message: out.message }) };
      return { ok: true, json: async () => ({ ok: true, result: out }) };
    },
  };
}
function mount(path, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfHrRoot"></div></body></html>',
    { url: 'http://localhost' + path, runScripts: 'outside-only' });
  const w = dom.window;
  w.phfGetSessionRole = () => opts.role || 'manager';
  w.phfNavigate = opts.navigate || (() => {});
  w.phfToast = opts.toast || (() => {});
  const mock = makeFetchMock(opts.handlers || {});
  w.fetch = mock.fetch;
  w.eval(appCode);
  return { window: w, root: w.document.getElementById('phfHrRoot'), calls: mock.calls };
}
function flush(ms) { return new Promise((resolve) => setTimeout(resolve, ms || 5)); }
async function render(m, path) { await m.window.phfRenderCompetition(path); await flush(); }

const CAMPAIGN = { id: 'c1', code: 'X', title: 'Câu hỏi & Cách trả lời Khách hàng', description: '', status: 'reviewing',
  minRequiredContributions: 5, submissionDeadline: null, reviewDeadline: null, publicationState: 'internal',
  levelsFrozen: true, finalizedAt: null, formSchema: [] };
function bootstrapWith(overrides) {
  return Object.assign({
    viewer: { accountId: 'acc-rev', employeeCode: 'REV1', displayName: 'Reviewer', isCompetitionAdmin: false, reviewerMaxLevel: 1 },
    activeCampaign: CAMPAIGN,
    myRequirement: null,
    capabilities: { canSubmit: true, canReview: true, canAdmin: false, viewParticipationProgress: false },
  }, overrides || {});
}

(async () => {
  console.log('\n== Reviewer 2đ — static indicator, unaffected by the switch redesign ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }],
        items: [{ submissionRef: 'sub-1', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q1', answer: 'A1' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: null, assignmentId: 'a1', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 1, overdue: 0 },
      competitionReviewSubmission: (b) => ({ ok: true, submissionId: b.submission_id, levelOrder: b.level_order }),
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    check(item.querySelector('select') == null && item.querySelector('[data-comp-level-switch]') == null, 'single-level reviewer still gets no picker of any kind');
    const badge = item.querySelector('[data-comp-fixed-level]');
    check(badge != null && /2 điểm/.test(badge.textContent) && /Hợp lệ/.test(badge.textContent), 'static badge unchanged: real level name + score');
    item.querySelector('[data-comp-review-act="approve"]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    const sent = m.calls.find((c) => c.action === 'competitionReviewSubmission');
    check(sent && sent.level_order === 1, 'approve still sends the correct level_order (1) from the static badge');
  }

  console.log('\n== Reviewer 5đ — segmented switch replaces the raw <select> ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-rev5', employeeCode: 'REV5', displayName: 'Reviewer 5', isCompetitionAdmin: false, reviewerMaxLevel: 2 } }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }, { levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5 }],
        items: [{ submissionRef: 'sub-2', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q2', answer: 'A2' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: null, assignmentId: 'a2', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 1, overdue: 0 },
      competitionReviewSubmission: (b) => ({ ok: true, submissionId: b.submission_id, levelOrder: b.level_order }),
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    check(item.querySelector('select') == null, 'no raw <select> for the multi-level reviewer');
    const switchEl = item.querySelector('[data-comp-level-switch]');
    check(switchEl != null, 'segmented switch renders for the multi-level reviewer');
    const opts = Array.from(switchEl.querySelectorAll('[data-comp-level-opt]'));
    check(opts.length === 2, 'both 2đ and 5đ are choosable');
    check(opts.filter((o) => o.classList.contains('is-selected')).length === 1, 'exactly one level selected at a time');
    opts[1].dispatchEvent(new m.window.Event('click', { bubbles: true }));
    check(opts[1].classList.contains('is-selected') && !opts[0].classList.contains('is-selected'), 'clicking 5đ moves the selection there');
    item.querySelector('[data-comp-review-act="approve"]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    const sent = m.calls.find((c) => c.action === 'competitionReviewSubmission');
    check(sent && sent.level_order === 2, 'approve sends the EXPLICITLY selected level_order (2 / 5đ), not a default');
  }

  console.log('\n== Upgrade path — already-approved level disabled in the switch ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-rev5', employeeCode: 'REV5', displayName: 'Reviewer 5', isCompetitionAdmin: false, reviewerMaxLevel: 2 } }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }, { levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5 }],
        items: [{ submissionRef: 'sub-3', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q3', answer: 'A3' }, reviewStatus: 'submitted', currentLevelOrder: 1, submittedAt: null, assignmentId: 'a3', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 0, overdue: 0 },
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    const opts = Array.from(item.querySelectorAll('[data-comp-level-opt]'));
    check(opts[0].disabled === true, 'already-approved level (1) is disabled — cannot "downgrade"');
    check(opts[1].disabled === false && opts[1].classList.contains('is-selected'), 'the only higher level (2) is enabled and pre-selected');
    check(item.querySelector('[data-comp-review-act="upgrade"]') != null, '"Nâng mức" action still shown for an already-approved submission');
  }

  console.log('\nALL PASS (' + passed + ' checks)');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
