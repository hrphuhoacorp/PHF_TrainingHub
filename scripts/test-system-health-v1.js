'use strict';
/*
 * PHF SYSTEM V1 — TÌNH TRẠNG HỆ THỐNG — OFFLINE checks (no DB, no network).
 * Pure-function classifiers + aggregator composition (mocked deps) + static
 * contract assertions (migration, admin gate, health-payload trim, route,
 * renderer read-only, heartbeat wiring, summary redaction).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
let PASS = 0;
function ok(c, name) { if (c) { PASS++; console.log('  PASS ' + name); } else { throw new assert.AssertionError({ message: name }); } }

// ---------------------------------------------------------------------------
console.log('== MIGRATION — system.cron_heartbeat, least privilege ==');
{
  const mig = rd('migrations/phf_hr_system_health_v1.sql');
  ok(/CREATE SCHEMA IF NOT EXISTS system/.test(mig), 'creates schema system');
  ok(/CREATE TABLE system\.cron_heartbeat/.test(mig), 'creates system.cron_heartbeat');
  ok(/job\s+text PRIMARY KEY/.test(mig) && /CHECK \(job IN \('task-recurrence', 'task-mail', 'task-weekly-report'\)\)/.test(mig), 'job PK + closed CHECK set');
  ok(/pg_column_size\(last_summary\)\s*<=\s*8192/.test(mig), 'summary size backstop');
  ok(/REVOKE ALL ON SCHEMA system FROM PUBLIC/.test(mig) && /REVOKE ALL ON system\.cron_heartbeat FROM PUBLIC/.test(mig), 'nothing to PUBLIC');
  ok(/GRANT\s+SELECT, INSERT, UPDATE ON system\.cron_heartbeat TO phf_hr_app/.test(mig), 'phf_hr_app: SELECT+INSERT+UPDATE only');
  ok(!/DELETE ON system\.cron_heartbeat/.test(mig), 'no DELETE grant');
  ok(fs.existsSync(path.join(REPO, 'migrations/phf_hr_system_health_v1_DOWN.sql')), 'DOWN migration present');
  const down = rd('migrations/phf_hr_system_health_v1_DOWN.sql');
  ok(/DROP TABLE IF EXISTS system\.cron_heartbeat/.test(down) && /DROP SCHEMA IF EXISTS system RESTRICT/.test(down), 'DOWN drops table + schema (RESTRICT)');
}

// ---------------------------------------------------------------------------
console.log('\n== phf-hr-api service — bounded, no secrets ==');
{
  const svc = rd('services/phf-hr-api/lib/system-health-service.js');
  ok(/SELECT 1 AS ok/.test(svc), 'deep probe = SELECT 1');
  ok(/withTaskReadTransaction/.test(svc) && !/withTaskWriteTransaction\(config, async \(client\) => \{[\s\S]*SELECT 1/.test(svc), 'deep probe runs read-only');
  ok(/DB_TIMEOUT/.test(svc) && /DB_UNAVAILABLE/.test(svc) && /DB_ERROR/.test(svc), 'coarse DB reason codes only');
  ok(!/PHF_HR_DB_HOST|PHF_HR_DB_RUNTIME_PASSWORD|process\.env\.SUPABASE|BREVO|SERVICE_TOKEN/.test(svc), 'service never references host/pw/secret env');
  ok(/SUMMARY_ALLOW = new Set/.test(svc), 'heartbeat summary is an allowlist');
  const svcMod = require(path.join(REPO, 'services/phf-hr-api/lib/system-health-service.js'));
  const dirty = svcMod.sanitizeSummary({ sent: 3, failed: 0, providerConfigured: true, recipientEmail: 'a@b.c', token: 'x', body: 'secret', password: 'p', huge: 'y'.repeat(999) });
  ok(JSON.stringify(dirty) === JSON.stringify({ sent: 3, failed: 0, providerConfigured: true }), 'sanitizeSummary keeps only safe counters');
  ok(svcMod.sanitizeSummary({ recipients: 5 }).recipients === 5, 'sanitizeSummary keeps recipients count (an integer, not an address)');
  ok(svcMod.sanitizeSummary({ nothingUseful: 1 }) === null, 'sanitizeSummary -> null when nothing safe');
}

// ---------------------------------------------------------------------------
console.log('\n== phf-hr-api route — flag-gated, Bearer, no query verb ==');
{
  const server = rd('services/phf-hr-api/server.js');
  ok(/PHF_SYSTEM_HEALTH_BRIDGE_ENABLED/.test(server) && /SYSTEM_HEALTH_BRIDGE_ENABLED\s*=/.test(server), 'flag gated (default OFF)');
  ok(/path === '\/v1\/system:health'/.test(server) && /path === '\/v1\/system:heartbeat'/.test(server), 'exactly two verbs: :health (GET) + :heartbeat (POST)');
  ok(!/\/v1\/system:(query|list|delete|update|exec)/.test(server), 'no unrestricted query/list/delete/update verb');
  ok(/if \(!SYSTEM_HEALTH_BRIDGE_ENABLED\) \{\s*return sendJson\(res, 503, \{ ok: false, code: 'SYSTEM_HEALTH_BRIDGE_DISABLED'/.test(server), 'fail-closed 503 when flag off');
  ok(/path === '\/v1\/system:health'\)\s*\{\s*const auth = authCheck\(req\);/.test(server), ':health requires the service Bearer token');
}

// ---------------------------------------------------------------------------
console.log('\n== Vercel aggregator — classifiers ==');
{
  const A = require(path.join(REPO, 'api/_lib/system-health.js'));
  const { S } = A;
  // worst()
  ok(A.worst([S.HEALTHY, S.HEALTHY]) === S.HEALTHY, 'worst all healthy -> HEALTHY');
  ok(A.worst([S.HEALTHY, S.WARNING]) === S.WARNING, 'worst healthy+warning -> WARNING');
  ok(A.worst([S.WARNING, S.ERROR]) === S.ERROR, 'worst warning+error -> ERROR');
  ok(A.worst([S.HEALTHY, S.UNKNOWN]) === S.WARNING, 'worst healthy+unknown -> WARNING (not ERROR)');
  ok(A.worst([S.UNKNOWN, S.UNKNOWN]) === S.UNKNOWN, 'worst all unknown -> UNKNOWN');
  ok(A.worst([S.ERROR, S.UNKNOWN]) === S.ERROR, 'worst error+unknown -> ERROR');
  // classifyCron (*/5)
  const now = Date.now();
  ok(A.classifyCron(null, now).status === S.UNKNOWN, 'cron: no heartbeat -> UNKNOWN');
  ok(A.classifyCron({ lastRunAt: new Date(now - 3 * 60000), lastOk: true }, now).status === S.HEALTHY, 'cron: 3 min ago ok -> HEALTHY');
  ok(A.classifyCron({ lastRunAt: new Date(now - 30 * 60000), lastOk: true }, now).status === S.WARNING, 'cron: 30 min ago -> WARNING');
  ok(A.classifyCron({ lastRunAt: new Date(now - 120 * 60000), lastOk: true }, now).status === S.ERROR, 'cron: 2 h ago -> ERROR');
  ok(A.classifyCron({ lastRunAt: new Date(now - 60000), lastOk: false }, now).status === S.ERROR, 'cron: last run failed -> ERROR');
  // classifyWeekly
  ok(A.classifyWeekly(null, null, now).status === S.UNKNOWN, 'weekly: never seen -> UNKNOWN');
  ok(A.classifyWeekly({ lastRunAt: new Date(now - 2 * 86400000), lastOk: true }, null, now).status === S.HEALTHY, 'weekly: 2 days ago -> HEALTHY (not stale on a non-Monday)');
  ok(A.classifyWeekly({ lastRunAt: new Date(now - 9 * 86400000), lastOk: true }, null, now).status === S.WARNING, 'weekly: 9 days -> WARNING');
  ok(A.classifyWeekly({ lastRunAt: new Date(now - 12 * 86400000), lastOk: true }, null, now).status === S.ERROR, 'weekly: 12 days -> ERROR');
  ok(A.classifyWeekly(null, new Date(now - 3 * 86400000), now).status === S.HEALTHY, 'weekly: falls back to WEEKLY_REPORT enqueue timestamp');
  // classifyMail
  ok(A.classifyMail(null, null, now).status === S.UNKNOWN, 'mail: unreadable -> UNKNOWN');
  ok(A.classifyMail({ pending: 0, claimed: 0, failed: 0, oldestOpenAgeSeconds: null }, null, now).status === S.HEALTHY, 'mail: clean -> HEALTHY');
  ok(A.classifyMail({ pending: 2, failed: 0, oldestOpenAgeSeconds: 1800 }, null, now).status === S.WARNING, 'mail: 30-min backlog -> WARNING');
  ok(A.classifyMail({ pending: 1, failed: 0, oldestOpenAgeSeconds: 4000 }, null, now).status === S.ERROR, 'mail: >60-min backlog -> ERROR');
  ok(A.classifyMail({ pending: 0, failed: 3, oldestOpenAgeSeconds: null }, null, now).status === S.WARNING, 'mail: recent failures -> WARNING');
  ok(A.classifyMail({ pending: 0, failed: 0 }, { summary: { providerConfigured: false } }, now).status === S.ERROR, 'mail: provider disabled -> ERROR');
}

// ---------------------------------------------------------------------------
console.log('\n== Admin API gate + no-secret DTO ==');
{
  const data = rd('api/data.js');
  ok(/req\.query\?\.systemHealth \|\| ''\) === '1'/.test(data), '?systemHealth=1 branch exists');
  ok(/systemHealth[\s\S]{0,200}session\.role\|\|''\)\.toLowerCase\(\)!=='admin'[\s\S]{0,120}SYSTEM_HEALTH_ADMIN_REQUIRED/.test(data), 'admin-only, server-enforced (403 SYSTEM_HEALTH_ADMIN_REQUIRED)');
  ok(/getSystemHealth\(\)/.test(data) && !/systemHealth[\s\S]{0,400}process\.env/.test(data), 'delegates to aggregator; no env in the branch');
  const agg = rd('api/_lib/system-health.js');
  ok(!/host:|password|DSN|connectionString|Authorization': *[^B]/.test(agg.replace(/Authorization': 'Bearer/g, '')), 'aggregator DTO builders carry no DSN/host/password');
}

// ---------------------------------------------------------------------------
console.log('\n== Public /api/health trimmed ==');
{
  const h = rd('api/health.js');
  ok(!/service:\s*'PHF Training Hub',build\b/.test(h) && !/,\s*build,\s*time:/.test(h), 'full build-info no longer spread into the response');
  ok(!/accountCount/.test(h), 'accountCount removed');
  ok(/version:\s*build && build\.version/.test(h) && /builtAt:\s*build && build\.builtAt/.test(h), 'only coarse version + builtAt exposed');
  ok(/ok:\s*health\.ok/.test(h), 'ok boolean preserved (smoke test contract)');
}

// ---------------------------------------------------------------------------
console.log('\n== Heartbeat wiring in the existing cron entrypoint ==');
{
  const cron = rd('api/checklist-monthly-cron.js');
  ok(/require\('\.\/_lib\/system-health'\)/.test(cron) && /emitCronHeartbeat/.test(cron), 'cron file imports emitCronHeartbeat');
  ok(/emitCronHeartbeat\('task-recurrence', true/.test(cron) && /emitCronHeartbeat\('task-recurrence', false/.test(cron), 'recurrence: ok + fail heartbeat');
  ok(/emitCronHeartbeat\('task-mail', true/.test(cron) && /emitCronHeartbeat\('task-mail', false/.test(cron), 'mail drainer: ok + fail heartbeat');
  ok(/emitCronHeartbeat\('task-weekly-report', true/.test(cron) && /emitCronHeartbeat\('task-weekly-report', false/.test(cron), 'weekly report: ok + fail heartbeat');
  const agg = rd('api/_lib/system-health.js');
  ok(/async function emitCronHeartbeat[\s\S]{0,400}return \{ ok: false, skipped: true \}/.test(agg), 'emitCronHeartbeat no-ops when disabled');
  ok(/catch \(err\) \{[\s\S]{0,200}console\.warn\('\[PHF System Health\] heartbeat failed[\s\S]{0,120}return \{ ok: false/.test(agg), 'emitCronHeartbeat is fail-open (never throws)');
  // the business calls must not be gated on the heartbeat result
  ok(!/if \(.*emitCronHeartbeat/.test(cron), 'heartbeat result never branches cron flow');
}

// ---------------------------------------------------------------------------
console.log('\n== Route + renderer — Admin-only, read-only ==');
{
  const router = rd('assets/js/phf-url-router.js');
  ok(/'\/admin\/he-thong\/tinh-trang':Object\.freeze\(\{area:'admin',screen:'system-health',roles:\['admin'\]\}\)/.test(router), 'route registered admin-only');
  ok(/path==='\/admin\/he-thong\/tinh-trang'\)\{[\s\S]{0,400}requireRoles\(\['admin'\]\)/.test(router), 'guard requires admin');
  ok(/phfRenderSystemHealth/.test(router), 'dispatches window.phfRenderSystemHealth');
  ok(/system:\['\/admin\/he-thong\/nhat-ky','\/admin\/he-thong\/tinh-trang'\]/.test(router), 'PHF_ROUTE_MAP.system updated');
  const ui = rd('assets/js/phf-system-health.js');
  ok(/role\(\)!=='admin'/.test(ui), 'renderer is admin-guarded');
  ok(/\/api\/data\?systemHealth=1/.test(ui), 'renderer reads /api/data?systemHealth=1');
  ok(!/method:\s*['"]POST['"]/.test(ui) && !/method:\s*['"]PUT['"]/.test(ui) && !/method:\s*['"]DELETE['"]/.test(ui), 'renderer issues only GET');
  ok(!/>\s*(Khởi động lại|Restart|Gửi thử|Gửi email thử|Xóa|Sửa|Dừng)\s*</.test(ui), 'no restart / test-mail / mutation controls');
  ok(/Kiểm tra lại/.test(ui) && /không theo dõi liên tục/.test(ui), '"Kiểm tra lại" + honest "not continuous" footer');
  ok(!/Sự cố.*gần đây|incident/i.test(ui), 'no "recent incidents" section in V1');
  ok(/index\.html/ && /phf-system-health\.js/.test(rd('index.html')), 'renderer script tag in index.html');

  // 6 structural cards ALWAYS render — fixed LINES list, missing line -> UNKNOWN
  ok(/var LINES=\[[\s\S]{0,260}\['backup','Sao lưu'\]/.test(ui), 'renderer has a fixed 6-line LINES list');
  ok(/LINES\.map\(function\(pair\)\{[\s\S]{0,400}l=\{status:'UNKNOWN'/.test(ui), 'a DTO line the response did not carry falls back to an UNKNOWN card');
  ok(!/if\(state\.error\)\{cards=/.test(ui) && !/state\.loading&&!d\)\{cards=/.test(ui), 'no code path that collapses the grid to a single card');
  ok(/<h2>Tình trạng hệ thống<\/h2><\/div>'/.test(ui), 'hero renders only the title (subtitle <p> removed)');
  ok(!/phf-sh-hero"[^]*?<p>/.test(ui.slice(ui.indexOf('phf-sh-hero'), ui.indexOf('phf-sh-hero') + 200)), 'no <p> subtitle inside the hero markup');
  ok(/state\.reqSeq/.test(ui) && /var seq=\+\+state\.reqSeq/.test(ui) && /if\(seq!==state\.reqSeq\)return/.test(ui), 'refresh has a stale-response (reqSeq) guard');
  ok(!/location\.reload|window\.location/.test(ui), 'refresh does not reload the page');
}

// ---------------------------------------------------------------------------
console.log('\n== Aggregator composition — Supabase-reachable is DB-healthy ==');
{
  const agg = rd('api/_lib/system-health.js');
  ok(/connOk\s*=\s*h\.accounts === 'ready' \|\| h\.storage === 'supabase'/.test(agg), 'Supabase MAIN "accounts ready" => DB connectivity proven');
  ok(/if \(h\.ok \|\| connOk\) dbMain = \{ status: S\.HEALTHY \}/.test(agg), 'checklist-RPC-missing does NOT read as a DB connectivity ERROR');
  ok(/else dbMain = \{ status: S\.ERROR/.test(agg), 'a genuine Supabase outage still => ERROR');
}

// ---------------------------------------------------------------------------
console.log('\n== Local dev-server parity ==');
{
  const server = rd('server.js');
  ok(/searchParams\.get\('systemHealth'\) === '1'/.test(server), 'local server.js mirrors the ?systemHealth=1 branch');
  ok(/SYSTEM_HEALTH_ADMIN_REQUIRED/.test(server), 'local branch is admin-only too');
  ok(!/build: readBuildInfoFresh\(\),/.test(server), 'local /api/health no longer dumps full build-info');
  ok(!/accountCount/.test(rd('api/health.js')), 'no accountCount in api/health.js response');
  ok(!/health\.ok \? 200 : 503, \{\s*\.\.\.health,/.test(server), 'local /api/health does not spread the raw health object (accountCount/checklist internals)');
}

// ---------------------------------------------------------------------------
console.log('\n== Home copy cleanup ==');
{
  const home = rd('assets/js/phf-hr-home.js');
  ok(!/desc:'Ai được phép sử dụng PHF HR\?'/.test(home), 'removed "Ai được phép sử dụng PHF HR?"');
  ok(!/desc:'Ai đã làm gì trên hệ thống\?'/.test(home), 'removed "Ai đã làm gì trên hệ thống?"');
  ok(!/desc:'Hệ thống hiện đang khỏe hay gặp lỗi\?'/.test(home), 'removed "Hệ thống hiện đang khỏe hay gặp lỗi?"');
  ok(/title:'Quản trị tài khoản',badge:'Admin'/.test(home) && /title:'Nhật ký hệ thống',badge:'Admin',href:'\/admin\/he-thong\/nhat-ky'/.test(home), 'card titles + routes + badges unchanged');
  ok(/title:'Tình trạng hệ thống',soon:true/.test(home), 'Tình trạng hệ thống stays "Sắp triển khai" until local gates pass');
}

console.log('\nSYSTEM V1 SYSTEM HEALTH offline checks: ' + PASS + ' PASS');
