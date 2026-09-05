'use strict';
/* PHF HR — Chương trình thi đua · FINAL PROD UI POLISH — targeted regression.
 *
 * Bugfix/visual-only batch: removes the hardcoded "DEV · dữ liệu thật trên
 * phf_hr_e2e" badge, restructures the sidebar into grouped light-depth
 * wrappers, adds Vietnamese labels for campaign status (accepting/reviewing)
 * and award status (proposed/confirmed/superseded/revoked) that previously
 * leaked the raw enum value, and lightly increases spacing. No business rule
 * changed — this file asserts exactly that: the same capability gating as
 * before, the same actions/contracts, only presentation differs.
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
check(!/DEV\s*·\s*dữ liệu thật trên phf_hr_e2e/.test(appCode), 'the hardcoded DEV/phf_hr_e2e badge string is gone from the source');
check(!/phf-comp-top-tag/.test(appCode), 'no remaining reference to the removed top-tag badge element');
check(!/\.phf-comp-top-tag/.test(css), 'no remaining CSS rules for the removed badge class');

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
  w.phfGetSessionRole = () => opts.role || 'admin';
  w.phfNavigate = opts.navigate || (() => {});
  w.phfToast = opts.toast || (() => {});
  const mock = makeFetchMock(opts.handlers || {});
  w.fetch = mock.fetch;
  w.eval(appCode);
  return { window: w, root: w.document.getElementById('phfHrRoot'), calls: mock.calls };
}
function flush(ms) { return new Promise((resolve) => setTimeout(resolve, ms || 5)); }
async function render(m, path) { await m.window.phfRenderCompetition(path); await flush(); }

const CAMPAIGN = { id: 'c1', code: 'X', title: 'Câu hỏi & Cách trả lời Khách hàng', description: '', status: 'accepting',
  minRequiredContributions: 5, submissionDeadline: null, reviewDeadline: null, publicationState: 'internal',
  levelsFrozen: true, finalizedAt: null, formSchema: [] };
function bootstrapWith(overrides) {
  return Object.assign({
    viewer: { accountId: 'acc-1', employeeCode: 'NV001', displayName: 'Nguyễn Văn A', isCompetitionAdmin: true, reviewerMaxLevel: null },
    activeCampaign: CAMPAIGN,
    myRequirement: { period: '2026-09', validCount: 1, requiredCount: 5, missingCount: 4, completionState: 'not_met' },
    capabilities: { canSubmit: true, canReview: true, canAdmin: true, viewParticipationProgress: false },
  }, overrides || {});
}

(async () => {
  console.log('\n== DEV BADGE — gone from the live-rendered header ==');
  {
    const m = mount('/admin/thi-dua', { handlers: { competitionBootstrap: bootstrapWith() } });
    await render(m, '/admin/thi-dua');
    check(!/phf_hr_e2e/.test(m.root.innerHTML), 'no phf_hr_e2e text anywhere in the rendered shell');
    check(!/\bDEV\b/.test(m.root.querySelector('.phf-comp-top').textContent), 'no "DEV" text in the top header bar');
  }

  console.log('\n== CAMPAIGN STATUS — Vietnamese, not the raw enum ==');
  {
    // "Thể lệ chương trình" (Tổng quan) renders statusLabel(campaign.status) —
    // campaign.status='accepting' must show "Đang nhận bài", never "accepting".
    const m = mount('/admin/thi-dua', { handlers: { competitionBootstrap: bootstrapWith(), competitionListLevels: [] } });
    await render(m, '/admin/thi-dua');
    check(m.root.textContent.includes('Đang nhận bài'), 'campaign status "accepting" renders as "Đang nhận bài"');
    check(!/\baccepting\b/.test(m.root.textContent), 'raw enum "accepting" never appears in the rendered text');
  }
  {
    const reviewingCampaign = Object.assign({}, CAMPAIGN, { status: 'reviewing' });
    const m = mount('/admin/thi-dua/quan-ly', { handlers: {
      competitionBootstrap: bootstrapWith({ activeCampaign: reviewingCampaign }),
      competitionListCampaigns: { campaigns: [reviewingCampaign] },
    } });
    await render(m, '/admin/thi-dua/quan-ly');
    check(m.root.textContent.includes('Đang xét duyệt'), 'campaign status "reviewing" renders as "Đang xét duyệt" on the admin campaign screen');
    check(!/\breviewing\b/.test(m.root.textContent), 'raw enum "reviewing" never appears in the rendered text');
  }

  console.log('\n== AWARD STATUS — Vietnamese, not the raw enum ==');
  {
    const finalizedCampaign = Object.assign({}, CAMPAIGN, { status: 'finalized' });
    const m = mount('/admin/thi-dua/chot', { handlers: {
      competitionBootstrap: bootstrapWith({ activeCampaign: finalizedCampaign }),
      competitionListCampaigns: { campaigns: [finalizedCampaign] },
      competitionGetReviewQueue: { items: [] },
      competitionGetLeaderboard: { rows: [] },
      competitionListAwards: [{ id: 'aw1', awardType: 'auto', recipientDisplayName: 'Nguyễn Văn A', amountVnd: 500000, status: 'proposed' }],
    } });
    await render(m, '/admin/thi-dua/chot');
    check(m.root.textContent.includes('Đã đề xuất'), 'award status "proposed" renders as "Đã đề xuất"');
    check(!/data-th="Trạng thái">proposed</.test(m.root.innerHTML), 'raw enum "proposed" never appears in the award status cell');
  }

  console.log('\n== SIDEBAR — grouped light-depth wrapper, permission visibility unchanged ==');
  {
    const m = mount('/admin/thi-dua', { handlers: { competitionBootstrap: bootstrapWith() } });
    await render(m, '/admin/thi-dua');
    const wraps = m.root.querySelectorAll('.phf-comp-nav-group-wrap');
    check(wraps.length === 3, 'admin (canReview+canAdmin) sees 3 grouped sections: Tham gia, Xét duyệt, Quản trị');
    const groupNames = Array.from(m.root.querySelectorAll('.phf-comp-nav-group')).map((s) => s.textContent.trim());
    check(groupNames.includes('Tham gia') && groupNames.includes('Xét duyệt') && groupNames.includes('Quản trị'), 'all three group titles render correctly');
    // every group's <a> items live inside its own .phf-comp-nav-group-items box
    wraps.forEach((w) => check(w.querySelector('.phf-comp-nav-group-items a') != null, 'each group wrapper contains its nav links nested inside .phf-comp-nav-group-items'));
    check(m.root.querySelectorAll('.phf-comp-nav a').length === 9, 'all 9 menu items still present (5 participant + 1 review + 3 admin) despite the DOM restructure');
  }
  {
    // participant-only (no review/admin capability) must NOT see the extra groups —
    // proves the restructure did not change WHICH items render, only their wrapping.
    const m = mount('/hv/thi-dua', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-2', employeeCode: 'NV002', displayName: 'B', isCompetitionAdmin: false, reviewerMaxLevel: null }, capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
    } });
    await render(m, '/hv/thi-dua');
    check(m.root.querySelectorAll('.phf-comp-nav-group-wrap').length === 1, 'participant with no grants sees exactly ONE group (Tham gia)');
    check(m.root.querySelectorAll('.phf-comp-nav a').length === 5, 'participant sees only the 5 participation items — no reviewer/admin leak from the restructure');
  }

  console.log('\nALL PASS (' + passed + ' checks)');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
