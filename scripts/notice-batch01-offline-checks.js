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
check('2  manifest lists 24 stable Vercel actions (+ noticeOrgScopes + noticeReportIndex)', NOTICE_ACTION_MANIFEST.length === 24 && NOTICE_ACTION_MANIFEST.indexOf('noticeOrgScopes') >= 0 && NOTICE_ACTION_MANIFEST.indexOf('noticeReportIndex') >= 0, String(NOTICE_ACTION_MANIFEST.length));
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
  // PHF SYSTEM V1 (locked spec I): Home card + nav renamed "Thông báo Quản trị",
  // subtitle drops "Quy trình", card carries an "Đang hoạt động" status badge.
  // Route / permission / Notice module all unchanged — Home presentation only.
  const noticeNavWired = home.includes("label:'Thông báo Quản trị',href:p+'/thong-bao'") ? 1 : 0;
  const noticeCardWired = /title:'Thông báo Quản trị',desc:'Quy định • Chính sách • Hướng dẫn',badge:'Đang hoạt động',href:p\+'\/thong-bao'/.test(home) ? 1 : 0;
  check('20 Home: "Thông báo Quản trị" card + nav wired to /thong-bao (renamed, badge added, none extra)',
    noticeNavWired === 1 && noticeCardWired === 1
      && !/title:'Thông báo',desc:/.test(home) && !home.includes('• Quy trình • Hướng dẫn'),
    'nav=' + noticeNavWired + ' card=' + noticeCardWired);

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
  check('25 shell: layout = grid (one consistent nav width var) + minmax(0,1fr) fluid main',
    /\.phf-notice-layout\{display:grid;grid-template-columns:var\(--nt-nav-w\) minmax\(0,1fr\)/.test(css)
    && /--nt-nav-w:\s*\d+px/.test(css));
  check('26 shell: sticky sidebar rail below header (top:76px; height:calc(100vh - 76px))',
    /\.phf-notice-nav\{[\s\S]*?position:sticky;top:76px;height:calc\(100vh - 76px\)/.test(css));
  check('27 theme: PHF green primary, NOT QTTH orange',
    /--nt-green:#1B7B45/.test(css) && !/--qt-orange|#E1500A/.test(css) && !/E1500A/i.test(js));
  check('28 header (V2): deep-green bar, module identity LEFT next to the logo with a divider (not floating/centered), subtitle "PHF HR" + real session user block',
    /\.phf-notice-top\{[\s\S]{0,220}background:var\(--nt-green-header\)/.test(css)
    && /\.phf-notice-brand\{[\s\S]{0,180}border-left:1px solid rgba\(255,255,255/.test(css)
    && !/\.phf-notice-brand\{[^}]*transform:translate\(-50%,-50%\)/.test(css)
    && /<b>Thông báo Quản Trị<\/b><small>PHF HR<\/small>/.test(js)
    && /phfGetAuthenticatedUser|phfGetCurrentUser/.test(js));
  check('29 sidebar 3 groups; QUẢN TRỊ split: "Quản lý danh mục" = canManage, "Cài đặt quyền" = Admin only (canManagePermissions)',
    /title:'Thông báo'/.test(js) && /key:'feed',label:'Tất cả thông báo'/.test(js)
    && /if\(manage\)\{[\s\S]*?title:'Theo dõi'[\s\S]*?label:'Báo cáo tiếp nhận'/.test(js)
    && /if\(manage\)admin\.push\(\{key:'danh-muc',label:'Quản lý danh mục'/.test(js)
    && /if\(canPerm\)admin\.push\(\{key:'quyen',label:'Cài đặt quyền'/.test(js)
    && /var canPerm=!!\(caps\.canManagePermissions\|\|\(boot&&boot\.viewer&&boot\.viewer\.isAdmin\)\)/.test(js));
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
  check('41 sidebar: category config is "Quản lý danh mục" in the QUẢN TRỊ group; reader category items are nav (route /thong-bao/loai/<slug>), not the config screen',
    /label:'Quản lý danh mục',icon:ICON\.tag,href:p\+'\/thong-bao\/danh-muc'/.test(js2)
    && /key:'cat:'\+c\.slug[\s\S]*?href:p\+'\/thong-bao\/loai\/'\+encodeURIComponent\(c\.slug\)/.test(js2)
    && /cats=\(STATE\.categories\|\|\[\]\)\.filter\(function\(c\)\{return c\.isActive!==false;\}\)/.test(js2));
  check('42 wizard field order: Tiêu đề -> Danh mục -> Mức ưu tiên -> Ghim -> Áp dụng -> Nội dung (rich editor); Từ khóa on the "Tệp & liên kết" step (§7)',
    js2.indexOf('Tiêu đề *') < js2.indexOf('Danh mục *')
    && js2.indexOf('Danh mục *') < js2.indexOf('Mức ưu tiên')
    && js2.indexOf('Mức ưu tiên') < js2.indexOf('data-f-pin')
    && js2.indexOf('data-f-pin') < js2.indexOf('data-rte-mount')
    && js2.indexOf('data-rte-mount') < js2.indexOf('data-f-kw')
    && /step===ATT_STEP[\s\S]*?data-f-kw/.test(js2));
  check('43 attachments collected in the create flow (pendingAtts) + uploaded before publish, fail -> stays draft',
    /model\.pendingAtts/.test(js2) && /for\(var k=0;k<model\.pendingAtts\.length/.test(js2) && /Bài đã lưu ở dạng NHÁP/.test(js2));
  check('44 duplicate warning is non-blocking (runDupCheck renders a panel, publish path never gated on it)',
    /function runDupCheck\(\)/.test(js2) && /Có thể trùng nội dung/.test(js2) && !/if\([^)]*dup[^)]*\)\s*return;/i.test(js2));
  check('45 edit re-ack checkbox uses the locked wording; default unchecked',
    /Nội dung thay đổi quan trọng — yêu cầu mọi người xác nhận lại/.test(js2));
  check('46 feed card shows "Đã cập nhật" when edited; detail identity band shows the last-updater name + time (V2 §4 SENDER)',
    /Đã cập nhật '\+fmtDate\(n\.updatedAt\)/.test(js2) && /Cập nhật gần nhất<\/span><span class="v">'\+esc\(updName\)[\s\S]{0,60}fmtDateTime\(n\.lastUpdatedAt\)/.test(js2));

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
  check('50 permission sticky header: opaque th bg + high z-index + sticks BELOW the 76px module header; opaque rows so data never bleeds through; in-shell wrapper not a scroll container',
    /\.phf-notice-table td\{background:#fff;\}/.test(css2)
    && /\.phf-notice-table th\{background:#[0-9A-Fa-f]{6}[^}]*position:sticky;top:76px;z-index:20/.test(css2)
    && /\.phf-notice-scroll \.phf-notice-table th\{top:0;\}/.test(css2)
    && !/\.phf-notice-tablewrap\{[^}]*overflow/.test(css2));
  check('51 still NO zoom-specific CSS (no @media min-resolution / zoom / device-pixel-ratio)',
    !/@media[^{]*(zoom|resolution|device-pixel-ratio)/.test(css2));
  check('52 permission screen renders the table in a non-scroll wrapper (page scroll + sticky th)',
    /data-nt-ptable/.test(js2) && /phf-notice-tablewrap" data-nt-ptable/.test(js2) && !/phf-notice-scroll" data-nt-ptable/.test(js2));

  // ── Operator UI/UX + performance batch ────────────────────────────
  const actionsSrc2 = read('api/_lib/notice-actions.js');
  const svc3 = read('services/phf-hr-api/lib/notice-service.js');
  const authSrc = read('api/_lib/auth.js');
  check('53 PERF: SPA caches STATE.boot + STATE.categories across navigations (no forced re-fetch per nav)',
    /boot=STATE\.boot\|\|\(STATE\.boot=await call\('noticeBootstrap'/.test(js2)
    && /await loadCategories\(\);/.test(js2)
    && /if\(STATE\.categories&&!force\)return STATE\.categories/.test(js2));
  check('54 PERF: notice.detail resolves isContentManager ONCE; resolveDueReplacements throttled (no writeTx per read)',
    /resolve manage authority ONCE[\s\S]*?const canManage = await isContentManager/.test(svc3)
    && !/canManage: await isContentManager\(config, actor\) \}/.test(svc3)
    && /const anyDue = await readTx\(config,[\s\S]*?DUE_REPLACEMENT_PROBE[\s\S]*?if \(!anyDue\) return;/.test(svc3));
  check('55 PERF: instrument script exists + counts browser POST + bridge round-trips for the SPA flow',
    fs.existsSync(path.join(REPO, 'scripts/notice-perf-instrument-dev.js'))
    && /counters\.bridgeCalls\+\+/.test(read('scripts/notice-perf-instrument-dev.js'))
    && /transcribed from (?:assets\/js\/notice\/)?phf-notice-app\.js/.test(read('scripts/notice-perf-instrument-dev.js')));
  check('56 ATTACHMENT DISPLAY: feed card compact counts; detail "Tệp & liên kết đính kèm" section only when non-empty; backend splits file/link counts',
    /attachmentFileCount\?'<span class="dot"><\/span><span class="phf-notice-att-chip">📎 '/.test(js2)
    && /attachmentLinkCount\?'<span class="dot"><\/span><span class="phf-notice-att-chip">🔗 '/.test(js2)
    && /Tệp & liên kết đính kèm/.test(js2)
    && /var attList=atts\.length\?/.test(js2)
    && /count\(\*\) FILTER \(WHERE kind = 'file'\)::int AS files/.test(svc3));
  check('57 STATUS FILTER: primary feed tabs are effective-status only (no category chips), default "active", still derived',
    /var FEED_FILTER=\{q:'',type:'',status:'active'/.test(js2)
    && /\['active','Đang hiệu lực'\],\['upcoming','Sắp hiệu lực'\],\['expired','Hết hiệu lực'\],\['','Tất cả'\]/.test(js2)
    && !/function typeChips\(\)/.test(js2)
    && !svc2.ACTIONS.some((a) => /setStatus|setEffective|forceExpire/i.test(a)));
  check('58 CẦN TIẾP NHẬN: bootstrap returns inbox.pendingCount; feed mode:"inbox" filters outstanding (re)acks; no ack deletion',
    /inbox: \{ pendingCount: boot\.inboxPending \}/.test(svc3)
    && /const inboxMode = mode === 'inbox'/.test(svc3)
    && /if \(inboxMode\) \{\s*\n\s*filtered = filtered\.filter\(\(n\) => n\.requireAcknowledgement/.test(svc3)
    && /\/thong-bao\/can-tiep-nhan/.test(js2)
    && !/DELETE FROM notice\.notice_acknowledgements/i.test(svc3));
  check('59 ADMIN DEFAULT ACCESS: roster flags isSystemAdmin; UI renders a locked pill + banner, never an OFF toggle for admins',
    /listAdminEmployeeCodes/.test(actionsSrc2)
    && /const isSystemAdmin = adminCodes\.has\(String\(r\.employeeCode/.test(actionsSrc2)
    && /canManage = grant \|\| isSystemAdmin/.test(actionsSrc2)
    && /Toàn quyền \(Admin hệ thống\)/.test(js2)
    && /Admin hệ thống <b>luôn có toàn quyền/.test(js2));
  check('60 ADMIN OVERRIDE server-authoritative; dev-allow confers NO business role (§F)',
    /function isAdmin\(actor\) \{ return actor\.systemRole === 'admin'; \}/.test(svc3)
    && /if \(isAdmin\(actor\)\) return true;\n  if \(!actor\.employeeCode\) return false;/.test(svc3)
    && /let canManage = admin;/.test(svc3)
    && !/actor\._devOperator = true/.test(svc3)
    && !/actor\._devOperator\) return true/.test(svc3));
  const adminFnBody = (authSrc.match(/async function listAdminEmployeeCodes\(\)\s*\{([\s\S]*?)\n\}/) || [, ''])[1];
  check('61 listAdminEmployeeCodes is read-only (no writes / no link repair)',
    /\.eq\('role', 'admin'\)/.test(adminFnBody)
    && !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|ensureLearnerEmployeeLink\(/i.test(adminFnBody));

  // ── Operator final patch: sidebar collapse · attachment-in-wizard · rich text · preview · bell · pin ──
  const svc4 = svc3;
  const cssF = read('assets/css/phf-notice.css');
  check('62 SIDEBAR §1: "Thông báo" is a collapsible parent (chevron, default open); THEO DÕI / QUẢN TRỊ stay flat',
    /title:'Thông báo',key:'thong-bao',collapsible:true/.test(js2)
    && /var NAV_GROUP_OPEN=\{'thong-bao':true\}/.test(js2)
    && /data-nt-group="'\+esc\(g\.key\)/.test(js2)
    && /phf-notice-nav-chev/.test(js2)
    && /function wireNavGroups\(slot\)/.test(js2)
    && !/title:'Theo dõi'[^}]*collapsible/.test(js2));
  check('63 ATTACHMENT §2: collected IN the wizard ("Tệp & liên kết" step in BOTH create+edit), staged for create / live for edit; detail has NO upload control',
    /var STEPS=\['Nội dung','Tệp & liên kết','Thiết lập','Xem trước'\]/.test(js2)
    && /step===ATT_STEP/.test(js2)
    && /model\.existingAtts/.test(js2)
    && /noticeAttachmentAdd',\{notice_id:d\.id/.test(js2)
    && !/data-nt-att-file/.test(js2) && !/data-nt-att-addlink/.test(js2)
    && /Detail is READ-ONLY for attachments/.test(js2));
  check('64 RICH TEXT §3: controlled WYSIWYG (B/I/U/H2/H3/lists/align/link/undo/redo/clear) — NO font-family / free size / colour; paste sanitised; server allowlist-sanitises',
    /function noticeRichEditor\(/.test(js2)
    && /data-cmd="bold"[\s\S]*data-cmd="italic"[\s\S]*data-cmd="underline"[\s\S]*data-block="h2"[\s\S]*data-block="h3"[\s\S]*insertUnorderedList[\s\S]*insertOrderedList[\s\S]*justifyLeft[\s\S]*justifyCenter[\s\S]*justifyRight[\s\S]*data-link[\s\S]*data-cmd="undo"[\s\S]*data-cmd="redo"[\s\S]*data-clear/.test(js2)
    && !/fontName|fontSize|foreColor|font-family/i.test(js2)
    && /addEventListener\('paste'/.test(js2)
    && /function sanitizeNoticeHtml\(/.test(svc4)
    && /RT_DROP_WHOLE = \{ script: 1, style: 1/.test(svc4)
    && /function resolveNoticeBody\(/.test(svc4));
  check('65 RICH TEXT: server sanitizer strips script/style/on*/img/iframe/span/font; keeps only p,h2,h3,ul,ol,li,strong,em,u,s,a + text-align; a href scheme-checked; headings get ids',
    /const RT_BLOCK = \{ p: 1, h2: 1, h3: 1, ul: 1, ol: 1, li: 1, blockquote: 1 \}/.test(svc4)
    && /const RT_INLINE = \{ strong: 1, em: 1, u: 1, s: 1, a: 1, br: 1 \}/.test(svc4)
    && /function rtHref\(raw\)/.test(svc4) && /https\?:/.test(svc4)
    && /assign stable ids to headings/.test(svc4));
  check('66 SEARCH not regressed: content_text still feeds FTS — DERIVED from the sanitised HTML when rich, or the "## " text path otherwise; TOC still from h2/h3',
    /function noticeHtmlToText\(html\)/.test(svc4)
    && /return \{ html, text: textFromHtml \}/.test(svc4)
    && /return \{ html: htmlFromText\(text\), text \}/.test(svc4)
    && /tocFromHtml/.test(svc4));
  check('67 PREVIEW §4: wizard "Xem trước" shows title/category/priority/pin/scope/rich body/attachments; does NOT create a published notice',
    /Xem trước — gần đúng bản nhân viên/.test(js2)
    && /model\.contentHtml\|\|'<p class="hint">\(chưa có nội dung\)/.test(js2)
    && /<dt>Ghim<\/dt>/.test(js2)
    && /Xem trước KHÔNG tạo bài đã công bố/.test(js2));
  check('68 BELL §5: header bell LEFT of the user block; badge from bootstrap (no polling); panel = bounded noticeFeed mode:"bell"; click -> detail; no new identity',
    /phf-notice-top-right[\s\S]*?data-nt-bell[\s\S]*?data-nt-user/.test(js2)
    && /function openBellPanel\(ctx\)/.test(js2)
    && /call\('noticeFeed',\{mode:'bell'\}\)/.test(js2)
    && /bell: \{ unreadCount: boot\.bellUnread/.test(svc4)
    && /const bellMode = mode === 'bell'/.test(svc4)
    && !/setInterval/.test(js2));
  check('69 BELL semantics: badge = viewer\'s "chưa đọc"; panel flags Cần xác nhận / Cần xác nhận lại / Chưa xem; Hỏa tốc via the normal prio badge, no blinking/animation',
    /STATE\.boot&&STATE\.boot\.bell&&STATE\.boot\.bell\.unreadCount/.test(js2)
    && /Cần xác nhận lại<\/span>/.test(js2) && /phf-notice-bell-tag new">Chưa xem/.test(js2)
    && !/blink|@keyframes[^{]*bell|animation:[^;]*bell/i.test(cssF));
  check('70 PIN §6: "📌 Ghim" toggle in CREATE + EDIT near "Mức ưu tiên"; create sends pinned; update accepts pinned; pin-only edit cuts NO revision',
    /data-f-pin[\s\S]{0,160}Ghim thông báo lên đầu bảng tin/.test(js2)
    && /pinned:!!model\.pinned/.test(js2)
    && /pinned: bool\(p\.pinned\)/.test(read('api/_lib/notice-actions.js'))
    && /const pinnedOnCreate = boolish\(params && params\.pinned\)/.test(svc4)
    && /A pin-only change is NOT a content edit/.test(svc4)
    && /const reackOnly = !contentChanged && requireReack && b\.status === 'published'/.test(svc4));
  check('71 PIN: urgent does NOT auto-pin and pin does NOT auto-raise priority (no cross-write in the service)',
    /Ghim KHÔNG tự thành "Hỏa tốc"/.test(js2)
    && !/priority[^;\n]*=[^;\n]*pinned/i.test(svc4) && !/is_pinned[^;\n]*=[^;\n]*priority/i.test(svc4));
  check('72 ZOOM §8: structural breakpoints (1200 / 900 / 640) like Checklist/QTTH; no zoom-specific hacks; shell stays fluid',
    /@media \(max-width:1200px\)\{[\s\S]*?\.phf-notice-layout\{grid-template-columns:200px/.test(cssF)
    && /@media \(max-width:640px\)/.test(cssF)
    && !/@media[^{]*(zoom|resolution|device-pixel-ratio)/.test(cssF));

  // ── Final functional correction batch (permission model · wizard visibility · image) ──
  check('73 PERMISSION §D: "Cài đặt quyền" (roster read + set + history) is system-Admin ONLY at the service layer',
    /'notice\.permissions\.list': async \(config, actor\) => \{\s*\n\s*requireAdmin\(actor\);/.test(svc4)
    && /'notice\.permissions\.history': async \(config, actor, params\) => \{\s*\n\s*requireAdmin\(actor\);/.test(svc4)
    && /'notice\.permissions\.set': async \(config, actor, params\) => \{\s*\n\s*requireAdmin\(actor\);/.test(svc4));
  check('74 PERMISSION: the Vercel roster composite also fails fast for non-Admin (NOTICE_ADMIN_REQUIRED before touching People Master)',
    /async function permissionRoster\(session\) \{[\s\S]{0,320}?if \(String\(actor\.systemRole \|\| ''\) !== 'admin'\)[\s\S]{0,120}?NOTICE_ADMIN_REQUIRED/.test(actionsSrc2));
  check('75 PERMISSION §E: bootstrap exposes capabilities.canManagePermissions (= Admin); FE sidebar shows "Cài đặt quyền" only if canPerm; route + screen both guard it',
    /canManagePermissions: admin/.test(svc4)
    && /if\(canPerm\)admin\.push\(\{key:'quyen'/.test(js2)
    && /scr\.key==='quyen'\)\{ if\(!\(boot\.capabilities\.canManagePermissions\|\|\(boot\.viewer&&boot\.viewer\.isAdmin\)\)\)/.test(js2)
    && /async function renderPermission\(ctx\)\{\s*\n\s*if\(!\(ctx\.boot\.capabilities\.canManagePermissions/.test(js2));
  check('76 MENU PROJECTION §E: Admin = 5 items incl Cài đặt quyền; content-manager = 4 (no Cài đặt quyền); viewer = inbox + feed + categories only',
    /var admin=\[\];\s*\n\s*if\(manage\)admin\.push\(\{key:'danh-muc'/.test(js2)
    && /if\(admin\.length\)groups\.push\(\{title:'Quản trị',items:admin\}\)/.test(js2)
    && /if\(canPerm\)admin\.push\(\{key:'quyen',label:'Cài đặt quyền'/.test(js2)
    && (js2.match(/label:'Cài đặt quyền'/g) || []).length === 1);
  check('77 WIZARD VISIBILITY §B: a visible numbered stepper (① Nội dung ▸ ② Tệp & liên kết ▸ ③ Thiết lập ▸ ④ Xem trước), "Bước n/4", completed steps click back',
    /class="phf-notice-step /.test(js2)
    && /data-step="'\+n\+'"/.test(js2)
    && /Bước '\+step\+'\/'\+STEPS\.length/.test(js2)
    && /ov\.querySelectorAll\('\[data-step\]'\)\.forEach/.test(js2)
    && !/\.phf-notice-steps span\{flex:1;height:4px/.test(cssF));
  check('78 WIZARD §B: modal is a flex column with a STICKY footer (body scrolls, [Quay lại]/[Tiếp tục] always visible)',
    /\.phf-notice-ov-panel\{[^}]*display:flex;flex-direction:column;max-height:88vh/.test(cssF)
    && /\.phf-notice-ov-body\{[^}]*flex:1 1 auto;min-height:0/.test(cssF)
    && /\.phf-notice-ov-foot\{[^}]*flex:0 0 auto/.test(cssF)
    && /\.phf-notice-steps\{[^}]*flex:0 0 auto/.test(cssF));
  check('79 IMAGE §G: rich-text inline <img> is DROPPED by both client + server sanitizer; a paste containing an image toasts the user toward the "Tệp & liên kết" step; NO base64 image in canonical HTML',
    !/RTE_OK_TAGS[^;]*IMG/.test(js2)
    && !/'img'|RT_BLOCK[^;]*img|RT_INLINE[^;]*img/i.test(svc4)
    && /<img\[ >\]\/i\.test\(html\)/.test(js2)
    && /bước "Tệp & liên kết" để đính kèm ảnh/.test(js2));
  check('80 DEV vs BUSINESS §F: bootstrap devOperator flag kept (label only) but no longer implies canManage; dispatch no longer sets actor._devOperator',
    /devOperator: !!\(dg\.locked && dg\.operator && !admin\)/.test(svc4)
    && /dev-allow only lets the caller PAST the lock/.test(svc4)
    && /let canManage = admin;/.test(svc4));

  // ── FINAL UI/UX PASS ──────────────────────────────────────────────
  check('81 DESIGN TOKENS §B: PHF font stack (Arial/Helvetica Neue), workspace = very light cool grey (not pure white), card white, modal surface = cream/ivory',
    /font-family:Arial,"Helvetica Neue",Helvetica,system-ui,-apple-system,sans-serif;/.test(cssF)
    && /--nt-workspace:#F3F4F6/.test(cssF) && /--nt-cream:#FBFAF6/.test(cssF)
    && /\.phf-notice\{[\s\S]*?background:var\(--nt-workspace\)/.test(cssF)
    && /\.phf-notice-ov-panel\{background:var\(--nt-cream/.test(cssF)
    && /\.phf-notice-ov\{[\s\S]{0,400}--nt-cream:#FBFAF6/.test(cssF)
    && /\.phf-notice-card\{background:var\(--nt-surface\)/.test(cssF));
  check('82 CATEGORY IDENTITY §H: deterministic per-slug colour (4 seeded pinned + hash fallback) carried sidebar dot -> feed chip -> detail chip; distinct from status hues',
    /var CAT_PALETTE=\[/.test(js2) && /var CAT_NAMED=\{guide:0,process:1,policy:2,regulation:3\}/.test(js2)
    && /var CAT_HASH_BASE=4;/.test(js2)
    && /function catMeta\(slug\)/.test(js2) && /function catHash\(v\)/.test(js2)
    && /function typeBadge\(slug,name\)/.test(js2)
    && (js2.match(/\+typeBadge\(n\.noticeType,n\.categoryName\)/g) || []).length >= 2
    && /\+typeBadge\(n\.noticeType,n\.categoryName\)\+stBadge\(st\)/.test(js2)
    && /phf-notice-nav-dot/.test(js2) && /phf-notice-nav-dot/.test(cssF));
  check('83 EFFECTIVE STATUS §I: glyphs ● / ◷ / ○ on the status badge + the primary status tabs; consistent feed/detail/filter; green / amber / neutral',
    /function stGlyph\(st\)\{return st==='active'\?'●':st==='upcoming'\?'◷':st==='expired'\?'○'/.test(js2)
    && /function stBadge\(st,extra\)/.test(js2)
    && /\['active','Đang hiệu lực'\],\['upcoming','Sắp hiệu lực'\],\['expired','Hết hiệu lực'\],\['','Tất cả'\]/.test(js2)
    && /phf-notice-st-glyph/.test(cssF)
    && /\.phf-notice-badge\.st-active \.phf-notice-st-glyph\{color:var\(--nt-green\)/.test(cssF));
  check('84 SIDEBAR HIERARCHY §G: category items nested under "Tất cả thông báo" (is-child indent + connector), "Tất cả thông báo" reads as parent (is-parent), collapse chevron intact',
    /thongBao\.push\(\{key:'cat:'\+c\.slug,label:c\.name,child:true,dot:catMeta\(c\.slug\)\.color/.test(js2)
    && /it\.child\?'is-child ':''/.test(js2) && /it\.key==='feed'\?'is-parent ':''/.test(js2)
    && /\.phf-notice-nav-items button\.is-child\{[\s\S]*?padding-left:30px/.test(cssF)
    && /\.phf-notice-nav-items button\.is-child::after\{/.test(cssF)
    && /button\.phf-notice-nav-title\.is-collapsible/.test(cssF));
  check('85 HOME CHIP §L: "Về Trang chủ PHF HR" is a bordered navigation chip (semibold, PHF green accent, hover), not plain text',
    /phf-notice-nav-back phf-notice-home-chip/.test(js2)
    && /\.phf-notice-home-chip\{border:1px solid var\(--nt-line-strong\)!important;background:#fff!important/.test(cssF)
    && /\.phf-notice-home-chip:hover\{/.test(cssF));
  check('86 DETAIL ACTION HIERARCHY §K: Chỉnh sửa = primary, Ghim = secondary, "⋯ Thêm" menu for Báo cáo / Lịch sử / Xóa; Xóa is-danger, not equal weight to Chỉnh sửa',
    /class="phf-notice-btn is-primary is-small" data-nt-edit/.test(js2)
    && /data-nt-more-menu/.test(js2)
    && /<button class="is-danger" data-nt-del>Xóa thông báo<\/button>/.test(js2)
    && /\.phf-notice-more-menu button\.is-danger\{color:#A5342A/.test(cssF)
    && /moreMenu\.hidden=!moreMenu\.hidden/.test(js2));
  check('87 CATEGORY MODAL §H/§D: "+ Thêm danh mục" opens a styled modal (cream surface, white input, sticky footer, error inline) — NOT window.prompt()',
    !/prompt\('Tên danh mục mới/.test(js2)
    && /phf-notice-cat-modal/.test(js2)
    && /call\('noticeCategoriesUpsert',\{name:v\}\)/.test(js2));
  check('88 SCOPE PICKER §M: "Áp dụng" uses a checkbox picker of distinct dept/branch from People Master (noticeOrgScopes, read-only, same loadOrgRows source); free-text is only a fallback; semantics unchanged (label + denominator, not an ACL)',
    /async function orgScopes\(session\)/.test(actionsSrc2)
    && /const rows = await loadOrgRows\(\);/.test(actionsSrc2)
    && /if \(action === 'noticeOrgScopes'\)/.test(actionsSrc2)
    && /function scopePickerHtml\(\)/.test(js2)
    && /call\('noticeOrgScopes',\{\}\)/.test(js2)
    && /data-scope-opt=/.test(js2)
    && /o\.failed\|\|/.test(js2)
    && /phf-notice-scope-picker/.test(cssF));

  check('89 MODAL OPAQUE — ROOT CAUSE §D: .phf-notice-ov (body-appended, outside .phf-notice) re-declares the full --nt-* token set + font so every var() inside the overlay resolves; panel/head/body/steps/foot all get an opaque cream background WITH a literal fallback; scrim opacity untouched (.44)',
    /\.phf-notice-ov\{[\s\S]{0,600}--nt-green:#1B7B45;[\s\S]{0,500}--nt-cream:#FBFAF6;[\s\S]{0,300}font-family:Arial/.test(cssF)
    && /\.phf-notice-ov-panel\{background:var\(--nt-cream,#FBFAF6\)/.test(cssF)
    && /\.phf-notice-ov-head\{[^}]*background:var\(--nt-cream,#FBFAF6\)/.test(cssF)
    && /\.phf-notice-ov-body\{[^}]*background:var\(--nt-cream,#FBFAF6\)/.test(cssF)
    && /\.phf-notice-ov-foot\{[^}]*background:var\(--nt-cream,#FBFAF6\)/.test(cssF)
    && /\.phf-notice-steps\{[^}]*background:var\(--nt-cream,#FBFAF6\)/.test(cssF)
    && /background:rgba\(20,26,34,\.44\)/.test(cssF)
    && /\.phf-notice-ov-body \.phf-notice-scroll\{max-height:none/.test(cssF));
  check('90 MODAL SUB-SURFACES stay white on the cream body (summary / preview / rich editor / report KPI / scroll / tablewrap = background:#fff inside .phf-notice-ov-body)',
    /\.phf-notice-ov-body \.phf-notice-summary,\.phf-notice-ov-body \.phf-notice-preview-body,\.phf-notice-ov-body \.phf-notice-rte\{background:#fff;\}/.test(cssF)
    && /\.phf-notice-ov-body \.phf-notice-kpi,\.phf-notice-ov-body \.phf-notice-scroll,\.phf-notice-ov-body \.phf-notice-tablewrap\{background:#fff;\}/.test(cssF));

  // ─────────────────────────────────────────────────────────────────────────
  // UI/UX REFACTOR (1.70.4_notice_uiux_refactor) — one design language, 6 screens.
  // Nghiệp vụ / quyền / schema KHÔNG đổi.
  // ─────────────────────────────────────────────────────────────────────────
  check('91 REFACTOR shared token scale: --nt-fs-hero/h1/h2/h3/base/sm/xs + --nt-lh + --nt-radius(/sm/xs) + --nt-shadow-card/pop/sticky declared on BOTH .phf-notice and .phf-notice-ov (modals resolve them)',
    /\.phf-notice\{[\s\S]{0,1200}--nt-fs-hero:[\s\S]{0,600}--nt-shadow-sticky:/.test(cssF)
    && /\.phf-notice-ov\{[\s\S]{0,700}--nt-fs-hero:[\s\S]{0,600}--nt-shadow-sticky:/.test(cssF)
    && /\.phf-notice,\.phf-notice-ov\{font-size:var\(--nt-fs-base\);line-height:var\(--nt-lh\)/.test(cssF));
  check('92 REFACTOR detail hierarchy §1: header band + two-column grid (reading column + sticky rail with Mục lục + facts); collapses <980px',
    /class="phf-notice-detail has-rail"/.test(js2)
    && /<header class="phf-notice-detail-hd">/.test(js2)
    && /<div class="phf-notice-detail-grid">[\s\S]{0,400}phf-notice-detail-main[\s\S]{0,400}phf-notice-detail-rail/.test(js2)
    && /\.phf-notice-detail-rail\{position:sticky/.test(cssF)
    && /\.phf-notice-detail-main \.phf-notice-body\{max-width:70ch/.test(cssF)
    && /@media \(max-width:1200px\)\{[\s\S]{0,300}\.phf-notice-detail-grid\{grid-template-columns:1fr/.test(cssF));
  check('93 REFACTOR §4 SENDER identity — người đăng vs người cập nhật, EXISTING audit fields only (createdByName / updatedByName || latest revision), no schema; shown in the detail identity band',
    /var updName=n\.updatedByName\|\|\(\(n\.revisions&&n\.revisions\[0\]&&n\.revisions\[0\]\.createdByName\)\)\|\|''/.test(js2)
    && /phf-notice-detail-identity[\s\S]{0,160}Người đăng<\/span>[\s\S]{0,120}esc\(n\.createdByName/.test(js2)
    && /var showUpd=n\.edited&&updName&&updName!==n\.createdByName/.test(js2)
    && /updatedByName: r\.updated_by_name \|\| ''/.test(read('services/phf-hr-api/lib/notice-service.js'))
    && /createdByName: r\.created_by_name \|\| '',[\r\n\s]*priority:/.test(read('services/phf-hr-api/lib/notice-service.js')));
  check('94 REFACTOR §3 attachment card component: coloured file-type icon + name + type·size + explicit "Tải xuống" CTA (link = "Mở liên kết"); NOT the old full-width .phf-notice-att-item bar',
    /function attCardsHtml\(atts\)\{/.test(js2)
    && /phf-notice-att-grid/.test(js2) && /phf-notice-att-card/.test(js2)
    && /ICON\.download\+' Tải xuống<\/a>/.test(js2)
    && /phf-notice-att-cta" href="'\+esc\(a\.linkUrl\)[\s\S]{0,90}Mở liên kết/.test(js2)
    && /\.phf-notice-att-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(230px,1fr\)\)/.test(cssF)
    && /\.phf-notice-att-ficon\.f-pdf\{background:#B3261E/.test(cssF));
  check('95 REFACTOR §4 Báo cáo tiếp nhận index scales to 100+: toolbar (search + Danh mục + Hiệu lực) + result count + real .phf-notice-table with clickable rows -> per-notice report modal (not a one-line list)',
    /async function renderReportIndex\(ctx\)\{[\s\S]*?setWork\(ctx/.test(js2)
    && /data-nt-rq[\s\S]{0,400}data-nt-rcat[\s\S]{0,200}data-nt-rstatus/.test(js2)
    && /class="phf-notice-table is-clickable phf-notice-rindex">/.test(js2)
    && /host\.querySelectorAll\('\[data-nt-r\]'\)\.forEach\(function\(tr\)\{tr\.onclick=function\(\)\{openReport/.test(js2)
    && !/phf-notice-rlist">[\s\S]{0,80}<button type="button" data-nt-r/.test(js2)
    && /\.phf-notice-table\.is-clickable tbody tr\{cursor:pointer/.test(cssF));
  check('96 REFACTOR §7 report/audit modal: each group is a bordered .phf-notice-rgroup with a STICKY head; table thead sticks BELOW it so the sticky row never covers a data row; groups stay separate; drill-down quick-filters',
    /function reportGroup\(title,rows\)\{/.test(js2)
    && /\+reportGroup\('Nhóm áp dụng chính',prim\)/.test(js2)
    && /class="phf-notice-rgroup"><div class="phf-notice-rgroup-head">/.test(js2)
    && /QF=\[\['all','Tất cả'\],\['notviewed','Chưa xem'\],\['viewednack','Đã xem, chưa xác nhận'\],\['acked','Đã xác nhận'\]\]/.test(js2)
    && /class="phf-notice-quickfilters" data-nt-qf>'\+QF\.map/.test(js2)
    && /\.phf-notice-ov-body \.phf-notice-rgroup-head\{position:sticky;top:0;z-index:30/.test(cssF)
    && /\.phf-notice-ov-body \.phf-notice-rgroup \.phf-notice-table th\{position:sticky;top:3[68]px;z-index:20/.test(cssF));
  check('97 REFACTOR §6 typography: font stack unchanged (Arial,"Helvetica Neue",Helvetica,system-ui,-apple-system); screen H1 + card title + body all keyed to tokens, no per-screen px',
    /\.phf-notice\{[\s\S]{0,1000}font-family:Arial,"Helvetica Neue",Helvetica,system-ui,-apple-system,sans-serif/.test(cssF)
    && /\.phf-notice-head h1\{font-size:var\(--nt-fs-hero\)/.test(cssF)
    && /\.phf-notice-card h3\{font-size:var\(--nt-fs-h2\)/.test(cssF));
  check('98 REFACTOR: ad-hoc per-screen inline styles removed — wizard preview title / cat-modal width / permission banner+hint / step-2 hints now use utility classes',
    /class="phf-notice-preview-title"/.test(js2)
    && /phf-notice-cat-modal is-narrow/.test(js2)
    && /class="phf-notice-warn info is-flush"/.test(js2)
    && !/style="max-width:440px"/.test(js2)
    && !/<h1 style="font-size:20px/.test(js2));
  check('99 REFACTOR: business / permission / schema / workflow UNCHANGED — no new action, no writeTx added, no migration file, dispatch/permission model identical',
    !svc2.ACTIONS.some((a) => /setStatus|forceExpire|delete.*all|purge/i.test(a))
    && !fs.existsSync(path.join(REPO, 'migrations/phf_hr_notice_v1_3_uiux.sql'))
    && /requireAdmin/.test(svcSrc) && /notice\.permissions\.set/.test(svcSrc));

  // ─────────────────────────────────────────────────────────────────────────
  // STRONG UI/UX REFACTOR V2 — visual baseline reset. Business/perm/schema UNCHANGED.
  // ─────────────────────────────────────────────────────────────────────────
  check('100 V2 header: deep PHF green bar (--nt-green-header / gradient), confident module identity, high white contrast',
    /--nt-green-deep:#0B3F24/.test(cssF) && /--nt-green-header:#0D4E2C/.test(cssF)
    && /\.phf-notice-top\{[\s\S]{0,260}background-image:linear-gradient\(180deg,#12613A/.test(cssF));
  check('101 V2 sidebar: one width var, strong active state (deep-green fill, white text), same in Admin/Manager/Viewer',
    /\.phf-notice-nav-items button\.is-active\{background:var\(--nt-green-deep\);color:#fff/.test(cssF)
    && /--nt-nav-w:236px/.test(cssF));
  check('102 V2 feed: enterprise news list (single bordered list, priority strip, de-noised badges, sender shown) — not a ticket grid',
    /\.phf-notice-feed\{[\s\S]{0,140}border:1px solid var\(--nt-line\);border-radius:var\(--nt-radius\);overflow:hidden/.test(cssF)
    && /\.phf-notice-card::before\{content:"";position:absolute;left:0/.test(cssF)
    && /\.phf-notice-card\.is-urgent::before\{background:var\(--nt-red\)/.test(cssF)
    && /\.phf-notice-badge\.type\{background:transparent/.test(cssF)
    && /var sender=n\.createdByName\?'<span class="phf-notice-sender">'\+esc\(n\.createdByName\)/.test(js2)
    && /createdByName: r\.created_by_name \|\| '',/.test(read('services/phf-hr-api/lib/notice-service.js')));
  check('103 V2 Cần tiếp nhận: actionable inbox — compact "N thông báo cần bạn tiếp nhận" summary + why-line + "Đọc & xác nhận" CTA',
    /class="phf-notice-inbox-summary"><b data-nt-pending>'\+pending\+'<\/b><span>thông báo cần bạn tiếp nhận/.test(js2)
    && /phf-notice-inbox-why">'\+\(reackNeeded\?'Nội dung đã đổi/.test(js2)
    && /Đọc &amp; xác nhận →/.test(js2)
    && /\.phf-notice-feed\.is-inbox \.phf-notice-card::before\{background:var\(--nt-amber\)/.test(cssF));
  check('104 V2 detail: identity band (title + sender/updated/effective/scope) over a ~71/29 grid; rail = cards (Thông tin liên quan / Tệp đính kèm / Trạng thái tiếp nhận); NO default TOC for short notices',
    /class="phf-notice-detail-hd">[\s\S]{0,700}<h1>'\+esc\(n\.title\)\+'<\/h1>'[\s\S]{0,40}\+identity/.test(js2)
    && /var identity='<div class="phf-notice-detail-identity">'/.test(js2)
    && /\.phf-notice-detail-grid\{display:grid;grid-template-columns:minmax\(0,70fr\) minmax\(320px,30fr\)/.test(cssF)
    && /\.phf-notice-detail\.has-rail\{max-width:min\(100%,1520px\)/.test(cssF)
    && /var showToc=\(n\.toc\|\|\[\]\)\.length>=3&&String\(n\.contentText\|\|''\)\.length>1500/.test(js2)
    && /phf-notice-railcard"><h4>Thông tin liên quan<\/h4>/.test(js2)
    && /phf-notice-railcard"><h4>Tệp đính kèm<\/h4>/.test(js2)
    && /phf-notice-rail-ack[\s\S]{0,60}Trạng thái tiếp nhận của bạn/.test(js2)
    && /@media \(max-width:1200px\)\{[\s\S]{0,400}\.phf-notice-detail-grid\{grid-template-columns:1fr/.test(cssF));
  check('105 V2 report index: summary cards (Tổng / Đang yêu cầu XN / Chưa hoàn tất / Tỷ lệ) + toolbar w/ sort + progress-bar acceptance table + "Chưa xác nhận" + row drill-down; counts from ONE bulk read-only aggregate',
    /phf-notice-report-cards" data-nt-rcards/.test(js2)
    && /Đang yêu cầu xác nhận<\/span>/.test(js2) && /Chưa hoàn tất tiếp nhận<\/span>/.test(js2) && /Tỷ lệ hoàn tất/.test(js2)
    && /data-nt-rsort/.test(js2) && /Tiếp nhận thấp nhất/.test(js2)
    && /function progressCell\(acked,total\)\{/.test(js2)
    && /<th class="c-prog">Tiếp nhận<\/th><th class="c-pend num">Chưa XN<\/th>/.test(js2)
    && /var ix=await call\('noticeReportIndex',\{\}\)/.test(js2)
    && /'notice\.report\.index': async \(config, actor, params\) => \{/.test(read('services/phf-hr-api/lib/notice-service.js'))
    && /READ-ONLY aggregate over EXISTING notice_views/.test(read('services/phf-hr-api/lib/notice-service.js'))
    && /async function reportIndex\(session\)/.test(read('api/_lib/notice-actions.js')));
  check('106 V2 attachment: one compact file card component reused in Detail + Editor (icon / name / type·size / CTA); no full-width bar',
    /function attCardsHtml\(atts\)\{/.test(js2)
    && /\.phf-notice-att-card\{border-radius:var\(--nt-radius-sm\)/.test(cssF)
    && /\.phf-notice-detail-rail \.phf-notice-att-grid\{grid-template-columns:1fr/.test(cssF)
    && !/phf-notice-att-item/.test(js2));
  check('107 V2 business / permission / schema / workflow UNCHANGED — dispatch model identical, no migration file, notice.report.index is manage-gated read-only',
    !svc2.ACTIONS.some((a) => /setStatus|forceExpire|purge|deleteAll/i.test(a))
    && !fs.existsSync(path.join(REPO, 'migrations/phf_hr_notice_v1_3_uiux.sql'))
    && !fs.existsSync(path.join(REPO, 'migrations/phf_hr_notice_v2.sql'))
    && /'notice\.report\.index': async \(config, actor, params\) => \{[\r\n\s]*await requireManage\(config, actor\);/.test(read('services/phf-hr-api/lib/notice-service.js')));

  check('108 V3 polish: unified filter/control language + warm palette tokens + audience filter is a styled control (not a raw input)',
    /class="phf-notice-scopefilter">'\+ICON\.tag\+'<input type="text" data-nt-scope/.test(js2)
    && /--nt-workspace:#F2F1EC/.test(cssF) && /--nt-green-pale:#F1F7F2/.test(cssF)
    && /\.phf-notice-scopefilter\{display:inline-flex[\s\S]{0,120}\}/.test(cssF)
    && /\.phf-notice-toolbar \.phf-notice-search input,\s*\.phf-notice-toolbar select,\s*\.phf-notice-scopefilter,\s*\.phf-notice-toolbar \.phf-notice-check\{height:38px/.test(cssF));
  check('109 V3 polish: sidebar ivory + detail document-header (pale-green surface + PHF-green top accent) + rail facts as icon·label·value divider rows',
    /\.phf-notice-nav\{background:var\(--nt-ivory\)/.test(cssF)
    && /\.phf-notice-detail\{border:1px solid var\(--nt-ivory-line\);border-top:3px solid var\(--nt-green\)/.test(cssF)
    && /\.phf-notice-detail-hd\{background:var\(--nt-green-pale\)/.test(cssF)
    && /var factRow=function\(icon,k,v\)\{return '<div><dt>'\+ICON\[icon\]\+'<span>'\+k\+'<\/span><\/dt><dd>'\+v\+'<\/dd><\/div>';\}/.test(js2)
    && /\.phf-notice-detail-facts>div\{display:flex[\s\S]{0,120}border-bottom:1px solid #F0EEE9/.test(cssF)
    && /function cleanExcerpt\(s\)\{/.test(js2));

  check('110 Batch A: AI-mascot not over Notice modals + sidebar not hard-capped + report rgroup sticky clip released',
    /body:has\(\.phf-notice-ov\) \.phf-ai-floating\{display:none/.test(cssF)
    && /\.phf-notice-nav\{[\s\S]{0,40}height:auto;[\s\S]{0,40}max-height:calc\(100vh - 76px\);[\s\S]{0,60}overflow-y:auto/.test(cssF)
    && /\.phf-notice-ov-body \.phf-notice-rgroup\{overflow:visible;\}/.test(cssF)
    && /\.phf-notice-ov-body \.phf-notice-rgroup \.phf-notice-table th\{position:sticky;top:38px/.test(cssF));
  check('111 Batch A: excerpt marker strip is position-agnostic + Detail list recovery + deterministic category palette (system slugs reserved)',
    /\.replace\(\/#\{1,6\}\\s\+\/g,''\)/.test(js2)
    && /function enhanceBodyLists\(body\)\{/.test(js2)
    && /enhanceBodyLists\(i\.querySelector\('\[data-nt-body\]'\)\)/.test(js2)
    && /var CAT_NAMED=\{guide:0,process:1,policy:2,regulation:3\};\s*var CAT_HASH_BASE=4;/.test(js2)
    && /CAT_HASH_BASE\+\(catHash\(slug\)%\(CAT_PALETTE\.length-CAT_HASH_BASE\)\)/.test(js2)
    && (js2.match(/var CAT_PALETTE=\[([\s\S]*?)\];/)[1].match(/\['#/g) || []).length >= 10);

  check('112 Commercial fix: single focus language (no double ring) + canonical Detail breakpoint 1200 + AI safe-area + ack panel column composition + toast repositioned',
    /\.phf-notice-scopefilter:focus-within\{[\s\S]{0,120}outline:none!important;[\s\S]{0,120}box-shadow:0 0 0 3px rgba\(27,123,69,\.18\)!important/.test(cssF)
    && /@media \(min-width:1201px\)\{\s*\.phf-notice-detail-grid\{grid-template-columns:minmax\(0,70fr\) minmax\(320px,30fr\);\}/.test(cssF)
    && !/@media \(max-width:1040px\)\{/.test(cssF) && !/@media \(max-width:980px\)\{[\s\S]{0,200}phf-notice-detail-grid/.test(cssF)
    && /@media \(min-width:761px\)\{[\s\S]{0,80}\.phf-notice-work\{padding-bottom:120px;\}/.test(cssF)
    && /<span class="ack-copy"><span class="ack-primary">Tôi đã đọc và nắm thông tin<\/span><span class="ack-note">/.test(js2)
    && /\.phf-notice-rail-ack \.ack-copy\{display:flex;flex-direction:column/.test(cssF)
    && /el\.className='phf-notice-toast';el\.style\.cssText='position:fixed;top:88px/.test(js2));
  check('113 Commercial fix: priority chip is context-independent (one .phf-notice-badge.prio-* definition wins everywhere) + Report Index fixed column rhythm',
    /\.phf-notice-badge\.prio-urgent\{\s*background:var\(--nt-red\)!important;color:#fff!important/.test(cssF)
    && /\.phf-notice-badge\.st-active,\s*\.phf-notice-badge\.st-upcoming,[\s\S]{0,80}background:#EFEEE9!important/.test(cssF)
    && /\.phf-notice-rindex\{table-layout:fixed/.test(cssF)
    && /\.phf-notice-rindex \.c-eff\{width:116px;white-space:nowrap;\}/.test(cssF)
    && /<th class="c-title">Thông báo<\/th><th class="c-prog">Tiếp nhận<\/th><th class="c-pend num">Chưa XN<\/th><th class="c-cat">Danh mục<\/th><th class="c-scope">Áp dụng<\/th><th class="c-eff">Hiệu lực<\/th>/.test(js2)
    && /class="phf-notice-pend"/.test(js2));

  console.log(`\n==== NOTICE Batch 01 OFFLINE checks: ${PASS} PASS / ${FAIL} FAIL ====`);
  process.exit(FAIL ? 1 : 0);
})();
