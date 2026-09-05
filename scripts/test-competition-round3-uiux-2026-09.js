'use strict';
/* PHF HR — Chương trình thi đua · ROUND 3 FINAL UI/UX POLISH — targeted regression.
 *
 * Batch scope: Bảng tin hierarchy, thả tim polish, Gửi bài dự thi copy, and the
 * Chờ duyệt control chấm 2đ/5đ redesign (static badge for a single eligible
 * level vs a segmented switch for multiple eligible levels — no more raw
 * <select>). This file asserts ONLY the new UI contracts; the pre-existing
 * C3 / C3.1 suites already re-verify everything else (anonymity, capability
 * gating, server-authoritative actions) untouched by this batch.
 *
 * Mounts the REAL renderer against a mocked /api/data POST endpoint — same
 * harness pattern as scripts/test-competition-c3-ui-2026-09.js.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const appCode = fs.readFileSync('assets/js/competition/phf-competition-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-competition.css', 'utf8');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');
check(!/<select[^>]*data-comp-level-select/.test(appCode), 'review-level picker is no longer a raw <select> (Round 3 removed it)');

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

const CAMPAIGN = { id: 'c1', code: 'X', title: 'Câu hỏi & trả lời KH', description: '', status: 'reviewing',
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
  console.log('\n== BẢNG TIN — question/answer hierarchy + 5-điểm accent ==');
  {
    const posts = [
      { submissionId: 's1', anonAlias: 'Táo Tư Vấn', authorName: null,
        payload: { customer_question: 'Khách hỏi về đổi trả', answer: 'Hướng dẫn quy trình đổi trả trong 7 ngày' },
        approvalLevel: 1, approvalLevelName: 'Hợp lệ', currentScore: 2, reactionTotal: 0, viewerReacted: false,
        submittedAt: '2026-09-01T00:00:00Z', status: 'approved' },
      { submissionId: 's2', anonAlias: 'Cam Chốt Đơn', authorName: null,
        payload: { customer_question: 'Khách hỏi về bảo hành', answer: 'Hướng dẫn quy trình bảo hành đầy đủ' },
        approvalLevel: 2, approvalLevelName: 'Đưa vào khung chuẩn', currentScore: 5, reactionTotal: 2, viewerReacted: true,
        submittedAt: '2026-09-01T00:00:00Z', status: 'approved' },
    ];
    const m = mount('/ql/thi-dua/bang-tin', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetFeed: { campaignStatus: 'reviewing', published: false, posts },
    } });
    await render(m, '/ql/thi-dua/bang-tin');
    const postEls = m.root.querySelectorAll('[data-comp-post]');
    check(postEls.length === 2, 'both feed posts render');
    const p1 = postEls[0], p2 = postEls[1];
    check(p1.querySelector('.phf-comp-post-q p').textContent === 'Khách hỏi về đổi trả', 'question renders in its own emphasized block');
    check(p1.querySelector('.phf-comp-post-a p').textContent === 'Hướng dẫn quy trình đổi trả trong 7 ngày', 'answer renders in its own inset block, separate from the question');
    check(!p1.classList.contains('is-high-level'), 'base-level (2đ) post carries no high-level accent — stays clean/normal');
    check(p2.classList.contains('is-high-level'), 'higher-level (5đ) post gets the gentle gold accent');
    check(/Giá trị cao/.test(p2.querySelector('.phf-comp-post-kind').textContent), 'higher-level post is framed as "Giá trị cao" without losing the real configured level name');
    check(p2.querySelector('.phf-comp-post-kind').textContent.includes('Đưa vào khung chuẩn'), 'the REAL configured level name is still shown, never replaced by a fabricated label');
  }

  console.log('\n== THẢ TIM — count/label contract unchanged by the visual polish ==');
  {
    const posts = [{ submissionId: 's1', anonAlias: 'Táo Tư Vấn', authorName: null, payload: { customer_question: 'Q' }, approvalLevel: 1, approvalLevelName: 'Hợp lệ', currentScore: 2, reactionTotal: 3, viewerReacted: false, submittedAt: '2026-09-01T00:00:00Z', status: 'approved' }];
    const m = mount('/hv/thi-dua/bang-tin', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetFeed: { campaignStatus: 'reviewing', published: false, posts },
      competitionSetReaction: (b) => ({ submissionId: b.submission_id, reactionTotal: 4, viewerReacted: true }),
    } });
    await render(m, '/hv/thi-dua/bang-tin');
    const btn = m.root.querySelector('[data-comp-react]');
    check(btn.querySelector('[data-rx-count]').textContent === '3', 'reaction count still starts from the authoritative server total');
    check(btn.querySelector('.rx-label').textContent === 'Thả tim', 'inactive label text unchanged');
    btn.dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    check(btn.querySelector('.rx-label').textContent === 'Đã thả tim', 'active label text unchanged');
    check(btn.querySelector('[data-rx-count]').textContent === '4', 'count still renders the authoritative total, not an optimistic guess');
    check(m.calls.some((c) => c.action === 'competitionSetReaction' && c.submission_id === 's1' && c.on === true), 'reaction still posts submission_id + on:true (contract unchanged)');
  }

  console.log('\n== GỬI BÀI DỰ THI — heading/action copy + draft/submit contract unchanged ==');
  {
    const campaign = Object.assign({}, CAMPAIGN, { status: 'accepting', formSchema: [
      { key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true },
      { key: 'answer', label: 'Câu trả lời', type: 'textarea', required: true } ] });
    const m = mount('/hv/thi-dua/gui', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ activeCampaign: campaign, capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionListMySubmissions: [],
      competitionCreateSubmissionDraft: (b) => ({ id: 'new-sub', campaignId: b.campaign_id, status: 'draft', payload: b.payload, currentLevelOrder: null, currentScore: null }),
      competitionSubmitSubmission: (b) => ({ submission: { id: b.submission_id, status: 'submitted' }, alias: 'Cam Chốt Đơn', assignment: null }),
    } });
    await render(m, '/hv/thi-dua/gui');
    check(/Gửi bài dự thi/.test(m.root.querySelector('.phf-comp-section h2').textContent), 'screen heading reads "Gửi bài dự thi"');
    check(m.root.textContent.includes(campaign.title), 'campaign context still shown, without duplicating it into the heading');
    const submitBtn = m.root.querySelector('[data-comp-submit]');
    check(submitBtn.textContent.trim() === 'Gửi bài dự thi', 'primary action button now reads "Gửi bài dự thi"');
    check(m.root.querySelector('[data-comp-save-draft]').textContent.trim() === 'Lưu nháp', '"Lưu nháp" secondary action unchanged');
    const q = m.root.querySelector('[data-comp-field="customer_question"]');
    const a = m.root.querySelector('[data-comp-field="answer"]');
    q.value = 'Khách hỏi về đổi trả'; a.value = 'Hướng dẫn quy trình đổi trả';
    m.root.querySelector('[data-comp-submit]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    check(m.calls.some((c) => c.action === 'competitionCreateSubmissionDraft'), 'submit-with-no-draft still creates the draft first (contract unchanged)');
    check(m.calls.some((c) => c.action === 'competitionSubmitSubmission' && c.submission_id === 'new-sub'), 'then still submits the newly created draft (contract unchanged)');
  }

  console.log('\n== CHỜ DUYỆT — Reviewer 2đ: static level indicator, no picker ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }],
        items: [{ submissionRef: 'sub-1', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q1' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: null, assignmentId: 'a1', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 1, overdue: 0 },
      competitionReviewSubmission: (b) => ({ ok: true, submissionId: b.submission_id, levelOrder: b.level_order }),
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    check(item.querySelector('select') == null, 'reviewer with a single eligible level gets NO <select> and NO segmented switch');
    check(item.querySelector('[data-comp-level-switch]') == null, 'single-level reviewer sees no level-choice control at all');
    const badge = item.querySelector('[data-comp-level-fixed]');
    check(badge != null, 'single-level reviewer sees a static compact level indicator');
    check(/2 điểm/.test(badge.textContent) && /Hợp lệ/.test(badge.textContent), 'static indicator shows the real level name + score ("2 điểm · Hợp lệ")');
    item.querySelector('[data-comp-review-act="approve"]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    const sent = m.calls.find((c) => c.action === 'competitionReviewSubmission');
    check(sent && sent.level_order === 1, 'approve action still sends the correct level_order (1) to the server even with no picker UI');
  }

  console.log('\n== CHỜ DUYỆT — Reviewer 5đ: segmented switch, both levels choosable ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-rev5', employeeCode: 'REV5', displayName: 'Reviewer 5', isCompetitionAdmin: false, reviewerMaxLevel: 2 } }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }, { levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5 }],
        items: [{ submissionRef: 'sub-2', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q2' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: null, assignmentId: 'a2', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 1, overdue: 0 },
      competitionReviewSubmission: (b) => ({ ok: true, submissionId: b.submission_id, levelOrder: b.level_order }),
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    check(item.querySelector('select') == null, 'reviewer-5đ control is a segmented switch, never a raw <select>');
    const switchEl = item.querySelector('[data-comp-level-switch]');
    check(switchEl != null, 'multi-level reviewer sees the segmented switch');
    const opts = Array.from(switchEl.querySelectorAll('[data-comp-level-opt]'));
    check(opts.length === 2, 'both eligible levels (2đ and 5đ) are choosable');
    check(opts.filter((o) => o.classList.contains('is-selected')).length === 1, 'exactly one level is selected at a time');
    check(opts[0].getAttribute('data-comp-level-opt') === '1' && opts[1].getAttribute('data-comp-level-opt') === '2', 'levels render in order (2đ then 5đ)');
    // pick the 5đ level explicitly, then approve
    opts[1].dispatchEvent(new m.window.Event('click', { bubbles: true }));
    check(opts[1].classList.contains('is-selected') && !opts[0].classList.contains('is-selected'), 'clicking a level moves the single selection there');
    item.querySelector('[data-comp-review-act="approve"]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush(15);
    const sent = m.calls.find((c) => c.action === 'competitionReviewSubmission');
    check(sent && sent.level_order === 2, 'approve action sends the EXPLICITLY SELECTED level_order (2 / 5đ), not a default');
  }

  console.log('\n== CHỜ DUYỆT — upgrade path: already-approved levels disabled in the switch ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-rev5', employeeCode: 'REV5', displayName: 'Reviewer 5', isCompetitionAdmin: false, reviewerMaxLevel: 2 } }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }, { levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5 }],
        items: [{ submissionRef: 'sub-3', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Q3' }, reviewStatus: 'submitted', currentLevelOrder: 1, submittedAt: null, assignmentId: 'a3', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 1, processed: 0, pending: 0, overdue: 0 },
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    const item = m.root.querySelector('[data-comp-review-item]');
    const opts = Array.from(item.querySelectorAll('[data-comp-level-opt]'));
    check(opts[0].disabled === true, 'the already-approved level (1) is disabled in the switch — cannot "downgrade"');
    check(opts[1].disabled === false && opts[1].classList.contains('is-selected'), 'the only higher level (2) is enabled and pre-selected for the upgrade action');
    check(item.querySelector('[data-comp-review-act="upgrade"]') != null, '"Nâng mức" action shown for an already-approved submission');
  }

  console.log('\nALL PASS (' + passed + ' checks)');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
