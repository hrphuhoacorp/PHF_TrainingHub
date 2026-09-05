'use strict';
/* PHF HR — Chương trình thi đua · Batch C3 (UI DEV WIRING) offline regression.
 *
 * Mounts the REAL renderer (assets/js/competition/phf-competition-app.js) in
 * jsdom against a mocked `/api/data` POST endpoint keyed by `action` (same
 * shape api/data.js / server.js actually return: {ok:true, result:...} or
 * {ok:false, code, message}). No network, no DB — but exercises the exact
 * request/response contract Batch C1/C2 built.
 *
 * Supersedes scripts/test-competition-batch-a2-2026-09.js (that test assumed
 * synchronous, static-empty-state rendering — C3 made the module async and
 * data-driven by design). The A1-visual-baseline and anonymity-by-construction
 * assertions from A2 are carried forward here.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const appCode = fs.readFileSync('assets/js/competition/phf-competition-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-competition.css', 'utf8');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

/* ---- static discipline checks (no DOM needed) ------------------------- */
check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');
check(/max-width:1560px/.test(css) && /height:34px!important/.test(css), 'A1 shell/logo baseline preserved');
check(!/localStorage|sessionStorage|indexedDB/.test(appCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')), 'app.js keeps no client Competition datastore');
check(/credentials:'same-origin'/.test(appCode), "fetch uses credentials:'same-origin' (session cookie, same as Task's taskApi)");
check(!/\bactor\s*:/.test(appCode.replace(/\/\*[\s\S]*?\*\//g, '')) , 'app.js never constructs/sends an actor object (identity is server-resolved)');
check(!/SYN-|SYN2-/.test(appCode), 'app.js contains no synthetic/SYN identities');

/* ---- mock transport ---------------------------------------------------- */
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

const LEVELS = [{ id: 'lv1', campaignId: 'c1', levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 },
  { id: 'lv2', campaignId: 'c1', levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5, slaHours: 72 }];
const CAMPAIGN = { id: 'c1', code: 'X', title: '[C3] Câu hỏi & trả lời KH', description: 'mô tả', status: 'accepting',
  minRequiredContributions: 3, submissionDeadline: '2026-10-01T00:00:00Z', reviewDeadline: '2026-10-05T00:00:00Z',
  publicationState: 'internal', levelsFrozen: true, finalizedAt: null, formSchema: [
    { key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true },
    { key: 'answer', label: 'Câu trả lời', type: 'textarea', required: true }] };
function bootstrapWith(overrides) {
  return Object.assign({
    viewer: { accountId: 'acc-1', employeeCode: 'NV001', displayName: 'Nguyễn Văn A', isCompetitionAdmin: true, reviewerMaxLevel: null },
    activeCampaign: CAMPAIGN,
    myRequirement: { period: '2026-09', validCount: 1, requiredCount: 3, missingCount: 2, completionState: 'not_met' },
    capabilities: { canSubmit: true, canReview: true, canAdmin: true, viewParticipationProgress: false },
  }, overrides || {});
}

(async () => {
  console.log('\n== BOOTSTRAP + ERROR HANDLING ==');
  {
    const m = mount('/admin/thi-dua', { handlers: { competitionBootstrap: { __reject: true, code: 'COMPETITION_BRIDGE_DISABLED', status: 500, message: 'chưa bật' } } });
    await render(m, '/admin/thi-dua');
    check(m.root.querySelector('[data-comp-error]'), 'bootstrap failure renders an honest error state, not fake content');
    check(/chưa được bật kết nối dữ liệu/.test(m.root.textContent), 'error message surfaces a real, code-specific message (not a generic fake-success fallback)');
    check(!!m.root.querySelector('[data-comp-retry]'), 'error state offers a retry action');
  }

  console.log('\n== TỔNG QUAN (real campaign + own progress) ==');
  {
    const m = mount('/admin/thi-dua', { handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListLevels: LEVELS,
    } });
    await render(m, '/admin/thi-dua');
    check(m.root.textContent.includes(CAMPAIGN.title), 'overview shows the real campaign title from the server');
    const cells = Array.from(m.root.querySelectorAll('.phf-comp-prog-cell b')).map((x) => x.textContent.trim());
    check(cells.join(',') === '1,3,2', 'participation numbers come straight from the server response (1/3, missing 2) — not fabricated');
    check(m.root.textContent.includes('Đưa vào khung chuẩn') && m.root.textContent.includes('5 điểm'), 'level chips render real configured levels/scores (2 and 5)');
  }
  {
    const m = mount('/admin/thi-dua', { handlers: { competitionBootstrap: bootstrapWith({ activeCampaign: null, myRequirement: null }) } });
    await render(m, '/admin/thi-dua');
    check(/Chưa có chương trình nào đang diễn ra/.test(m.root.textContent), 'no active campaign -> honest empty state, no fake campaign');
    check(m.root.querySelectorAll('.phf-comp-prog-cell b').length === 3 && Array.from(m.root.querySelectorAll('.phf-comp-prog-cell b')).every((x) => x.textContent.trim() === '—'), 'no progress data -> "—", never a fabricated number');
  }

  console.log('\n== BẢNG TIN + REACTION ==');
  {
    const m = mount('/hv/thi-dua/bang-tin', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-1', employeeCode: 'NV001', displayName: 'A', isCompetitionAdmin: false, reviewerMaxLevel: null }, capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetFeed: { campaignStatus: 'accepting', published: false, posts: [] },
    } });
    await render(m, '/hv/thi-dua/bang-tin');
    check(m.root.querySelector('[data-comp-feed] .phf-comp-empty') != null || /chưa có hoạt động/i.test(m.root.textContent), 'empty feed -> honest empty state (no seeded posts)');
  }
  {
    const posts = [{ submissionId: 's1', anonAlias: 'Táo Tư Vấn', authorName: null, payload: { customer_question: 'Khách hỏi gì đó' }, approvalLevel: 1, approvalLevelName: 'Hợp lệ', currentScore: 2, reactionTotal: 3, viewerReacted: false, submittedAt: '2026-09-01T00:00:00Z', status: 'approved' }];
    const m = mount('/hv/thi-dua/bang-tin', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetFeed: { campaignStatus: 'accepting', published: false, posts },
      competitionSetReaction: (b) => ({ submissionId: b.submission_id, reactionTotal: 4, viewerReacted: true }),
    } });
    await render(m, '/hv/thi-dua/bang-tin');
    check(m.root.textContent.includes('Táo Tư Vấn'), 'pre-publish feed shows alias');
    check(!m.root.textContent.match(/authorName|"acc-1"/), 'no raw identity leaked into the DOM');
    const reactBtn = m.root.querySelector('[data-comp-react]');
    check(reactBtn && reactBtn.querySelector('[data-rx-count]').textContent === '3', 'reaction count starts from the server total (3), not a guess');
    reactBtn.dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(reactBtn.querySelector('[data-rx-count]').textContent === '4', 'reaction click posts to the server and renders the AUTHORITATIVE total back (4), not an optimistic guess');
    check(m.calls.some((c) => c.action === 'competitionSetReaction' && c.submission_id === 's1' && c.on === true), 'reaction posts submission_id + on:true, no client actor');
  }

  console.log('\n== BÀI CỦA TÔI ==');
  {
    const m = mount('/hv/thi-dua/bai-cua-toi', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListMySubmissions: [{ id: 'sub-1', campaignId: 'c1', status: 'needs_revision', payload: { customer_question: 'q' }, currentLevelOrder: null, currentScore: null, lastReviewNote: 'Thiếu chi tiết', submittedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
    } });
    await render(m, '/hv/thi-dua/bai-cua-toi');
    check(m.root.textContent.includes('Thiếu chi tiết'), 'shows the real reviewer note from the server');
    check(m.root.querySelector('[data-s="needs_revision"]') != null, 'renders the real submission status');
  }

  console.log('\n== GỬI NỘI DUNG (draft/edit/submit) ==');
  {
    const m = mount('/hv/thi-dua/gui', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListMySubmissions: [],
      competitionCreateSubmissionDraft: (b) => ({ id: 'new-sub', campaignId: b.campaign_id, status: 'draft', payload: b.payload, currentLevelOrder: null, currentScore: null }),
      competitionSubmitSubmission: (b) => ({ submission: { id: b.submission_id, status: 'submitted' }, alias: 'Cam Chốt Đơn', assignment: null }),
    } });
    await render(m, '/hv/thi-dua/gui');
    const q = m.root.querySelector('[data-comp-field="customer_question"]');
    const a = m.root.querySelector('[data-comp-field="answer"]');
    check(q && a, 'form fields render from the campaign form_schema');
    q.value = 'Khách hỏi về đổi trả'; a.value = 'Hướng dẫn quy trình đổi trả';
    let navigatedTo = null;
    m.window.phfNavigate = (p) => { navigatedTo = p; };
    m.root.querySelector('[data-comp-submit]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush();
    check(m.calls.some((c) => c.action === 'competitionCreateSubmissionDraft'), 'submit with no existing draft creates one first');
    check(m.calls.some((c) => c.action === 'competitionSubmitSubmission' && c.submission_id === 'new-sub'), 'then submits the newly created draft');
    check(navigatedTo === '/hv/thi-dua/bai-cua-toi', 'navigates to "Bài của tôi" after a real successful submit');
  }
  {
    const m = mount('/hv/thi-dua/gui', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith(), competitionListMySubmissions: [],
    } });
    await render(m, '/hv/thi-dua/gui');
    let calledSubmit = false;
    m.calls.length = 0;
    m.root.querySelector('[data-comp-submit]').dispatchEvent(new m.window.Event('click', { bubbles: true }));
    await flush();
    check(!m.calls.some((c) => c.action === 'competitionSubmitSubmission'), 'required-field validation blocks submit client-side before any network call (still enforced server-side too)');
  }

  console.log('\n== BẢNG XẾP HẠNG & KẾT QUẢ ==');
  {
    const m = mount('/hv/thi-dua/ket-qua', { role: 'learner', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-1', employeeCode: 'NV001', displayName: 'Nguyễn Văn A', isCompetitionAdmin: false, reviewerMaxLevel: null } }),
      competitionGetLeaderboard: { identityMode: 'participant', published: false,
        you: { rank: 2, totalScore: 2, isYou: true, displayName: 'Nguyễn Văn A' },
        rows: [{ rank: 1, totalScore: 5, isYou: false, displayName: null, alias: 'Cam Chốt Đơn' },
          { rank: 2, totalScore: 2, isYou: true, displayName: 'Nguyễn Văn A', alias: null }] },
    } });
    await render(m, '/hv/thi-dua/ket-qua');
    check(m.root.textContent.includes('Nguyễn Văn A'), 'own row shows real identity');
    check(m.root.textContent.includes('Cam Chốt Đơn'), 'competitor row shows alias');
    check(!m.root.querySelector('.phf-comp-table').textContent.match(/approvedCount|Bài đã duyệt/), 'participant view has no competitor approved-count (no x/5) column');
  }
  {
    const m = mount('/admin/thi-dua/ket-qua', { handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionGetLeaderboard: { identityMode: 'admin', published: false, you: null,
        rows: [{ rank: 1, totalScore: 5, isYou: false, displayName: 'Trần Thị B', approvedCount: 2 }] },
    } });
    await render(m, '/admin/thi-dua/ket-qua');
    check(m.root.textContent.includes('Trần Thị B') && m.root.textContent.includes('Bài đã duyệt'), 'admin leaderboard view shows full identity + approved count');
  }

  console.log('\n== CHỜ DUYỆT (anonymous queue + review actions + own productivity) ==');
  {
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', handlers: {
      competitionBootstrap: bootstrapWith({ viewer: { accountId: 'acc-rev', employeeCode: 'REV1', displayName: 'Reviewer', isCompetitionAdmin: false, reviewerMaxLevel: 1 }, capabilities: { canSubmit: true, canReview: true, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetReviewQueue: { eligibleLevels: [{ levelOrder: 1, name: 'Hợp lệ', score: 2 }],
        items: [{ submissionRef: 'sub-anon-1', campaignId: 'c1', campaignTitle: 'X', payload: { customer_question: 'Khách hỏi Y' }, reviewStatus: 'submitted', currentLevelOrder: null, submittedAt: '2026-09-01T00:00:00Z', assignmentId: 'a1', tier: 'primary_l1', dueAt: null }] },
      competitionGetReviewerProductivity: { assigned: 3, processed: 1, pending: 2, overdue: 0 },
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    check(!m.root.textContent.match(/NV\d{3}|acc-1|department|Bán hàng/i), 'review queue DOM carries no author identity strings');
    check(m.root.textContent.includes('Khách hỏi Y'), 'review queue shows the real (content-only) payload');
    check(m.root.textContent.includes('3') && m.root.textContent.includes('Đang chờ'), "reviewer's OWN productivity numbers render (assigned 3 / pending 2)");
    const approveBtn = m.root.querySelector('[data-comp-review-act="approve"]');
    check(approveBtn != null, 'approve action available');
  }
  {
    let navigatedTo = null;
    const m = mount('/ql/thi-dua/cho-duyet', { role: 'manager', navigate: (p) => { navigatedTo = p; }, handlers: {
      competitionBootstrap: bootstrapWith({ capabilities: { canSubmit: true, canReview: false, canAdmin: false, viewParticipationProgress: false } }),
      competitionGetReviewQueue: { __reject: true, code: 'SHOULD_NOT_BE_CALLED', message: 'unauthorized fetch attempted' },
    } });
    await render(m, '/ql/thi-dua/cho-duyet');
    check(navigatedTo === '/ql/thi-dua', 'no reviewer authority -> deep link redirected to module home BEFORE rendering the screen (server-authoritative deep-link guard)');
    check(!m.calls.some((c) => c.action === 'competitionGetReviewQueue'), 'unauthorized screen never fetches admin/reviewer data at all');
  }

  console.log('\n== QUẢN LÝ CHƯƠNG TRÌNH (admin) ==');
  {
    const m = mount('/admin/thi-dua/quan-ly', { handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListCampaigns: { campaigns: [CAMPAIGN], isCompetitionAdmin: true },
    } });
    await render(m, '/admin/thi-dua/quan-ly');
    check(m.root.querySelector('[data-comp-status="reviewing"]') != null, 'accepting campaign offers "chuyển sang xét duyệt" (matches real status)');
    check(m.root.querySelector('[data-comp-status="accepting"]') == null, 'does not offer an invalid transition for the current status');
  }

  console.log('\n== CÀI ĐẶT XÉT DUYỆT (admin) ==');
  {
    const m = mount('/admin/thi-dua/xet-duyet', { handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListCampaigns: { campaigns: [CAMPAIGN] },
      competitionListLevels: LEVELS,
      competitionListReviewerGrants: [{ id: 'g1', accountId: 'acc-r1', employeeCode: 'REV1', displayName: 'Reviewer 1', maxLevelOrder: 1, isActive: true }],
      competitionListAdminGrants: [],
      competitionListCapabilityGrants: [],
    } });
    await render(m, '/admin/thi-dua/xet-duyet');
    check(m.root.textContent.includes('REV1'), 'shows real reviewer grants from the server');
    check(m.root.querySelector('.phf-comp-freeze') != null, 'levels_frozen=true shows the freeze notice (matches campaign state)');
    check(m.root.querySelector('[data-comp-add-reviewer]') != null && m.root.querySelector('[data-comp-add-admin]') != null && m.root.querySelector('[data-comp-add-cap]') != null, 'reviewer / admin / capability grant forms all present');
  }

  console.log('\n== CHỐT CHƯƠNG TRÌNH (admin) ==');
  {
    const reviewingCampaign = Object.assign({}, CAMPAIGN, { status: 'reviewing' });
    const m = mount('/admin/thi-dua/chot', { handlers: {
      competitionBootstrap: bootstrapWith({ activeCampaign: reviewingCampaign }),
      competitionListCampaigns: { campaigns: [reviewingCampaign] },
      competitionGetReviewQueue: { eligibleLevels: [], items: [{ submissionRef: 'x' }] },
      competitionGetLeaderboard: { identityMode: 'admin', rows: [] },
      competitionListAwards: [],
      competitionGetAutoAwardCandidate: { candidate: null, tie: [], topN: [] },
    } });
    await render(m, '/admin/thi-dua/chot');
    check(m.root.textContent.includes('1'), 'outstanding-review count reflects the real queue length');
    check(m.root.querySelector('[data-comp-finalize-subs]') && !m.root.querySelector('[data-comp-finalize-subs]').disabled, 'finalize action enabled for a reviewing campaign');
    check(m.root.querySelector('[data-comp-publish]').disabled, 'publish stays disabled until the campaign is actually finalized (no fake-success shortcut)');
  }

  console.log('\n=== ROUTES SMOKE (all still render) ===');
  for (const p of ['/admin/thi-dua', '/admin/thi-dua/bang-tin', '/admin/thi-dua/bai-cua-toi', '/admin/thi-dua/gui', '/admin/thi-dua/ket-qua', '/admin/thi-dua/cho-duyet', '/admin/thi-dua/quan-ly', '/admin/thi-dua/xet-duyet', '/admin/thi-dua/chot']) {
    const m = mount(p, { handlers: {
      competitionBootstrap: bootstrapWith(),
      competitionListLevels: LEVELS, competitionListCampaigns: { campaigns: [CAMPAIGN] },
      competitionGetFeed: { posts: [] }, competitionListMySubmissions: [],
      competitionGetLeaderboard: { identityMode: 'admin', rows: [] },
      competitionGetReviewQueue: { eligibleLevels: [], items: [] }, competitionGetReviewerProductivity: {},
      competitionListReviewerGrants: [], competitionListAdminGrants: [], competitionListCapabilityGrants: [],
      competitionListAwards: [], competitionGetAutoAwardCandidate: { candidate: null },
    } });
    await render(m, p);
    check(m.root.querySelector('.phf-comp-shell') != null, 'renders shell: ' + p);
    check(!/undefined<\/|>NaN</.test(m.root.innerHTML), 'no undefined/NaN leak: ' + p);
  }

  console.log('\nALL PASS (' + passed + ' checks)');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
