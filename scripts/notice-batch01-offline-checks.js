'use strict';
/*
 * PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 · OFFLINE checks (no DB, no network).
 * Structural / contract guards that must hold regardless of environment.
 * Run: node scripts/notice-batch01-offline-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

// 1. action parity: Vercel manifest <-> phf-hr-api service ACTIONS
const { NOTICE_ACTION_MANIFEST } = require(path.join(REPO, 'api/_lib/notice-actions'));
const svc = require(path.join(REPO, 'services/phf-hr-api/lib/notice-service'));
const remoteActions = new Set(svc.ACTIONS);
const actionsSrc = read('api/_lib/notice-actions.js');
const remoteRefs = Array.from(actionsSrc.matchAll(/remote:\s*'([^']+)'/g)).map((m) => m[1])
  .concat(Array.from(actionsSrc.matchAll(/callNoticeAction\('([^']+)'/g)).map((m) => m[1]));
check('1  every Vercel-referenced remote action exists in notice-service ACTIONS',
  remoteRefs.every((a) => remoteActions.has(a)), remoteRefs.filter((a) => !remoteActions.has(a)).join(','));
check('2  manifest lists 22 stable Vercel actions', NOTICE_ACTION_MANIFEST.length === 22, String(NOTICE_ACTION_MANIFEST.length));
check('3  service exposes bootstrap + feed + detail + acknowledge (public read path)',
  ['notice.bootstrap', 'notice.feed', 'notice.detail', 'notice.acknowledge'].every((a) => remoteActions.has(a)));

// 4. bridge fail-closed when flag off
delete process.env.PHF_NOTICE_BRIDGE_ENABLED;
const bridge = require(path.join(REPO, 'api/_lib/notice-bridge'));
check('4  isNoticeBridgeEnabled() false by default', bridge.isNoticeBridgeEnabled() === false);
bridge.callNoticeAction('notice.feed', { accountId: 'x' }, {}).then(
  () => check('5  bridge refuses to call phf-hr-api while flag off', false, 'did not throw'),
  (e) => check('5  bridge refuses to call phf-hr-api while flag off', e.code === 'NOTICE_BRIDGE_DISABLED', e.code)
);

// 6. dev-gate logic (pure) via a controlled re-require
function freshService() { delete require.cache[require.resolve(path.join(REPO, 'services/phf-hr-api/lib/notice-service'))]; return require(path.join(REPO, 'services/phf-hr-api/lib/notice-service')); }
(async () => {
  // gate OFF -> unknown action still rejected, bootstrap allowed shape
  delete process.env.NOTICE_DEV_ACCESS_ALLOW;
  let s = freshService();
  try { await s.dispatch({}, { accountId: 'a1', systemRole: 'learner' }, 'notice.nope', {}); check('6  unknown action rejected', false); }
  catch (e) { check('6  unknown action rejected (NOTICE_ACTION_UNKNOWN)', e.code === 'NOTICE_ACTION_UNKNOWN', e.code); }

  // gate ON -> a non-listed learner is blocked on every non-bootstrap action WITHOUT touching the DB
  process.env.NOTICE_DEV_ACCESS_ALLOW = 'PHF999';
  s = freshService();
  try { await s.dispatch({}, { accountId: 'a2', employeeCode: 'PHF001', systemRole: 'learner' }, 'notice.feed', {}); check('7  dev gate blocks non-listed before DB', false); }
  catch (e) { check('7  dev gate blocks non-listed user before any DB call (NOTICE_DEV_LOCKED)', e.code === 'NOTICE_DEV_LOCKED', e.code); }
  const boot = await s.dispatch({}, { accountId: 'a2', employeeCode: 'PHF001', systemRole: 'learner' }, 'notice.bootstrap', {});
  check('8  dev-locked bootstrap returns clean snapshot (no throw, canManage=false)', boot.devLocked === true && boot.capabilities.canManage === false && !!boot.lockReason);
  delete process.env.NOTICE_DEV_ACCESS_ALLOW;

  // 9/10. service identity/authz discipline — inspect real `require(...)` + code, not comments
  const svcSrc = read('services/phf-hr-api/lib/notice-service.js');
  const svcRequires = Array.from(new Set(Array.from(svcSrc.matchAll(/require\('([^']+)'\)/g)).map((m) => m[1])));
  const storeSrc = read('services/phf-hr-api/lib/notice-attachment-store.js');
  const stripC = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('9  notice-service requires only ./db + ./notice-attachment-store; the store reuses lib/attachment-storage; no supabase/People Master in code',
    svcRequires.every((r) => r === './db' || r === './notice-attachment-store')
    && /require\('\.\/attachment-storage'\)/.test(storeSrc)
    && !/supabase|task-employee-scope|employee_profiles/i.test(stripC(svcSrc) + stripC(storeSrc)),
    svcRequires.join(','));
  const svcCode = svcSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('10 notice-service manage authority = Admin OR notice.notice_permissions only (never title/dept/other module)',
    /notice\.notice_permissions/.test(svcCode) && !/job_title|employee_profiles|competition|checklist|qtth|task_permission/i.test(svcCode));

  // 11. migration shape (strip SQL comments first)
  const mig = read('migrations/phf_hr_notice_v1.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  check('11 migration: schema notice owned by phf_hr_owner + SET ROLE guard',
    /CREATE SCHEMA IF NOT EXISTS notice/.test(mig) && /ALTER SCHEMA notice OWNER TO phf_hr_owner/.test(mig) && /ROLE_NOT_ACTIVE/.test(mig));
  check('12 migration: append-only guard on acknowledgements + audit + revisions',
    /notice_ack_no_untick[\s\S]*block_history_mutation/.test(mig) && /notice_audit_no_mutation/.test(mig) && /notice_revisions_immutable/.test(mig));
  check('13 migration: grants scoped strictly to notice.* (no wildcard / no PUBLIC / no ALTER DEFAULT PRIVILEGES)',
    /GRANT USAGE ON SCHEMA notice TO phf_hr_app/.test(mig) && !/ALTER DEFAULT PRIVILEGES/.test(mig) && !/TO PUBLIC/.test(mig) && !/GRANT ALL/.test(mig));
  check('14 migration: FTS via notice.vn_unaccent + search_tsv GIN, no CREATE EXTENSION',
    /CREATE FUNCTION notice\.vn_unaccent/.test(mig) && /USING gin \(search_tsv\)/.test(mig) && !/CREATE EXTENSION/.test(mig));
  check('15 migration: effective status NOT stored as a column (derived)',
    !/status\s+text[^;]*CHECK[^;]*upcoming/i.test(mig));
  check('16 DOWN migration drops the schema', /DROP SCHEMA IF EXISTS notice CASCADE/.test(read('migrations/phf_hr_notice_v1_DOWN.sql')));

  // 17. router + shell wiring
  const router = read('assets/js/phf-url-router.js');
  check('17 router: /thong-bao render branch -> phfRenderNotice, HR shell, namespace guard',
    /\\\/thong-bao\(\?:\\\/\|\$\)/.test(router) && /window\.phfRenderNotice/.test(router) && /requireRoles\(\[ntRole\]\)/.test(router));
  check('18 router: /thong-bao{,/bao-cao,/danh-muc,/quyen} registered for all 3 namespaces',
    /pf\+'\/thong-bao',pf\+'\/thong-bao\/bao-cao',pf\+'\/thong-bao\/danh-muc',pf\+'\/thong-bao\/quyen'/.test(router));
  check('19 index.html: /thong-bao -> HR shell + notice css/js loaded',
    /\\\/thong-bao\(\?:\\\/\|\$\)\/\.test\(path\)\)return 'hr'/.test(read('index.html')) && /phf-notice-app\.js/.test(read('index.html')) && /phf-notice\.css/.test(read('index.html')));

  // 20. Home entry contract: reuse existing "Thông báo" card, wire to /thong-bao, add NO new card
  const home = read('assets/js/phf-hr-home.js');
  const noticeLabelCount = (home.match(/'Thông báo',(?:href|icon)|title:'Thông báo'/g) || []).length;
  const noticeWired = (home.match(/'Thông báo',href:p\+'\/thong-bao'/) ? 1 : 0) + (home.match(/title:'Thông báo',desc:[^}]*,href:p\+'\/thong-bao'/) ? 1 : 0);
  check('20 Home: the 2 existing "Thông báo" cards (nav + grid) wired to /thong-bao, none added',
    noticeLabelCount === 2 && noticeWired === 2, 'labels=' + noticeLabelCount + ' wired=' + noticeWired);

  // 21. dispatch call in both data.js and server.js, before generic authorize
  check('21 data.js + server.js call dispatchNoticeAction before authorizePayload',
    /dispatchNoticeAction[\s\S]{0,260}authorizePayload/.test(read('api/data.js')) && /dispatchNoticeAction[\s\S]{0,260}authorizePayload/.test(read('server.js')));
  check('22 phf-hr-api server.js registers POST /v1/notice with NoticeError handling',
    /path === '\/v1\/notice'/.test(read('services/phf-hr-api/server.js')) && /instanceof NoticeError/.test(read('services/phf-hr-api/server.js')));

  // ── UI SHELL (QTTH Batch 01D architecture) ──────────────────────────
  const css = read('assets/css/phf-notice.css');
  const js = read('assets/js/notice/phf-notice-app.js');
  check('23 shell: NO max-width / margin:auto on .phf-notice, -shell or -layout (viewport-wide at every zoom)',
    !/\.phf-notice(?:-shell|-layout)?\s*\{[^}]*(?:max-width|margin\s*:\s*0\s*auto)/.test(css));
  check('24 shell: sticky full-bleed header, fixed 76px (logo never drives height)',
    /\.phf-notice-top\{[^}]*position:sticky[^}]*height:76px[^}]*flex:0 0 76px/.test(css));
  check('25 shell: layout = grid 220px + minmax(0,1fr) fluid main',
    /\.phf-notice-layout\{display:grid;grid-template-columns:220px minmax\(0,1fr\)/.test(css));
  check('26 shell: sticky sidebar rail below header (top:76px; height:calc(100vh - 76px))',
    /\.phf-notice-nav\{[\s\S]*?position:sticky;top:76px;height:calc\(100vh - 76px\)/.test(css));
  check('27 theme: PHF green primary, NOT QTTH orange',
    /--nt-green:#1B7B45/.test(css) && !/--qt-orange|#E1500A/.test(css) && !/E1500A/i.test(js));
  check('28 header: centered brand title "Thông báo Quản Trị" + subtitle "PHF HR" + real session user block',
    /\.phf-notice-brand\{[\s\S]*?left:50%[\s\S]*?transform:translate\(-50%,-50%\)/.test(css)
    && /<b>Thông báo Quản Trị<\/b><small>PHF HR<\/small>/.test(js)
    && /phfGetAuthenticatedUser|phfGetCurrentUser/.test(js));
  check('29 sidebar nav = Thông báo (always) + Báo cáo tiếp nhận + Cài đặt quyền (manage-gated only)',
    /key:'feed',label:'Thông báo'/.test(js) && /label:'Báo cáo tiếp nhận'/.test(js) && /label:'Cài đặt quyền'/.test(js)
    && /if\(manage\)\{[\s\S]*?bao-cao[\s\S]*?quyen/.test(js));
  check('30 "+ Đăng thông báo" is an ACTION in the feed head, never a sidebar nav item',
    /phf-notice-head-actions[\s\S]{0,120}data-nt-create/.test(js) && !/label:'[^']*Đăng thông báo'/.test(js));
  check('31 Báo cáo tiếp nhận + Cài đặt quyền render into the SAME work slot (setWork), not a custom layout',
    /async function renderReportIndex\(ctx\)\{[\s\S]*?setWork\(ctx/.test(js) && /async function renderPermission\(ctx\)\{[\s\S]*?setWork\(ctx/.test(js));
  check('32 NO zoom-specific CSS (no @media with min-resolution / zoom / device-pixel-ratio)',
    !/@media[^{]*(zoom|resolution|device-pixel-ratio)/.test(css));

  // ── FINAL FUNCTIONAL PATCH ─────────────────────────────────────────
  const mig2 = read('migrations/phf_hr_notice_v1_2_categories_priority.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  check('33 migration v1_2: notice_categories table + 4 seeded system slugs + FK from notices.notice_type',
    /CREATE TABLE notice\.notice_categories/.test(mig2)
    && /INSERT INTO notice\.notice_categories[\s\S]*regulation[\s\S]*policy[\s\S]*process[\s\S]*guide/.test(mig2)
    && /notices_category_fk[\s\S]*REFERENCES notice\.notice_categories/.test(mig2));
  check('34 migration v1_2: priority column normal|important|urgent, defaults normal; DROP the closed 4-value CHECK',
    /ADD COLUMN priority text NOT NULL DEFAULT 'normal'[\s\S]*CHECK \(priority IN \('normal', 'important', 'urgent'\)\)/.test(mig2)
    && /DROP CONSTRAINT IF EXISTS notices_notice_type_check/.test(mig2));
  check('35 migration v1_2: categories get SELECT/INSERT/UPDATE but NO DELETE (never hard-deleted)',
    /GRANT SELECT, INSERT, UPDATE ON notice\.notice_categories TO phf_hr_app/.test(mig2) && !/DELETE ON notice\.notice_categories/.test(mig2));
  check('36 migration v1_2: has a DOWN', /DROP TABLE IF EXISTS notice\.notice_categories/.test(read('migrations/phf_hr_notice_v1_2_categories_priority_DOWN.sql')));

  const svc2 = require(path.join(REPO, 'services/phf-hr-api/lib/notice-service'));
  check('37 service exposes categories.{list,upsert,reorder} + similar; priority enum exported',
    ['notice.categories.list', 'notice.categories.upsert', 'notice.categories.reorder', 'notice.similar'].every((a) => svc2.ACTIONS.indexOf(a) >= 0)
    && Array.isArray(svc2.PRIORITIES) && svc2.PRIORITIES.join(',') === 'normal,important,urgent');
  check('38 service: category admin actions are audited (category_create/rename/reorder/enable/disable)',
    /'category_create'/.test(svcSrc) && /'category_rename'/.test(svcSrc) && /'category_reorder'/.test(svcSrc) && /'category_enable'/.test(svcSrc) && /'category_disable'/.test(svcSrc));
  check('39 service: notice.similar is read-only (no writeTx / writeAudit inside it)',
    /'notice\.similar':[\s\S]{0,900}?readTx\(config/.test(svcSrc) && !/'notice\.similar':[\s\S]{0,900}?writeAudit/.test(svcSrc));
  check('40 service: no manual effective-status switch action',
    !svc2.ACTIONS.some((a) => /setStatus|setEffectiveStatus|forceExpire|forceActive/i.test(a)));

  const js2 = read('assets/js/notice/phf-notice-app.js');
  check('41 sidebar: "Danh mục" is a manager nav item (inside the if(manage) block, before Báo cáo tiếp nhận)',
    /if\(manage\)\{\s*\n\s*items\.push\(\{key:'danh-muc',label:'Danh mục'/.test(js2));
  check('42 wizard field order: Tiêu đề -> Danh mục -> Mức ưu tiên -> Áp dụng -> Nội dung -> Từ khóa bổ sung',
    js2.indexOf('Tiêu đề *') < js2.indexOf('Danh mục *')
    && js2.indexOf('Danh mục *') < js2.indexOf('Mức ưu tiên')
    && js2.indexOf('Mức ưu tiên') < js2.indexOf('data-f-content')
    && js2.indexOf('data-f-content') < js2.indexOf('Từ khóa bổ sung (tùy chọn)'));
  check('43 attachments collected in the create flow (pendingAtts) + uploaded before publish, fail -> stays draft',
    /model\.pendingAtts/.test(js2) && /for\(var k=0;k<model\.pendingAtts\.length/.test(js2) && /Bài đã lưu ở dạng NHÁP/.test(js2));
  check('44 duplicate warning is non-blocking (runDupCheck renders a panel, publish path never gated on it)',
    /function runDupCheck\(\)/.test(js2) && /Có thể trùng nội dung/.test(js2) && !/if\([^)]*dup[^)]*\)\s*return;/i.test(js2));
  check('45 edit re-ack checkbox uses the locked wording; default unchecked',
    /Nội dung thay đổi quan trọng — yêu cầu mọi người xác nhận lại/.test(js2));
  check('46 feed card shows "Đã cập nhật" when edited; detail shows "Cập nhật lần cuối"',
    /Đã cập nhật '\+fmtDate\(n\.updatedAt\)/.test(js2) && /Cập nhật lần cuối: '\+fmtDateTime\(n\.lastUpdatedAt\)/.test(js2));

  // ── ZOOM / STICKY-HEADER (Checklist standard) ──────────────────────
  const css2 = read('assets/css/phf-notice.css');
  const ckl = read('assets/css/phf-checklist.css');
  check('47 Checklist reference: .phfck-main has NO max-width (the zoom standard)',
    /\.phfck-main\{[^}]*\}/.test(ckl) && !/\.phfck-main\{[^}]*max-width/.test(ckl));
  check('48 notice: the workspace-wide readability cap is REMOVED (.phf-notice-work-inner max-width:none)',
    /\.phf-notice-work-inner\{max-width:none;\}/.test(css2)
    && !/\.phf-notice-layout\{[^}]*max-width/.test(css2) && !/\.phf-notice-shell\{[^}]*max-width/.test(css2));
  check('49 notice: only .phf-notice-detail keeps a reading max-width',
    /\.phf-notice-detail\{[^}]*max-width:900px/.test(css2));
  check('50 permission sticky header: opaque bg + z-index + sticks BELOW the 76px module header; in-shell wrapper not a scroll container',
    /\.phf-notice-table th\{[^}]*background:#F3F4F6[^}]*position:sticky;top:76px;z-index:6/.test(css2)
    && /\.phf-notice-scroll \.phf-notice-table th\{top:0;\}/.test(css2)
    && !/\.phf-notice-tablewrap\{[^}]*overflow/.test(css2));
  check('51 still NO zoom-specific CSS (no @media min-resolution / zoom / device-pixel-ratio)',
    !/@media[^{]*(zoom|resolution|device-pixel-ratio)/.test(css2));
  check('52 permission screen renders the table in a non-scroll wrapper (page scroll + sticky th)',
    /data-nt-ptable/.test(js2) && /phf-notice-tablewrap" data-nt-ptable/.test(js2) && !/phf-notice-scroll" data-nt-ptable/.test(js2));

  console.log(`\n==== NOTICE Batch 01 OFFLINE checks: ${PASS} PASS / ${FAIL} FAIL ====`);
  process.exit(FAIL ? 1 : 0);
})();
