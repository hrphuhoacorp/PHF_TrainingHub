'use strict';

// PHF HR — SYSTEM V1 · Tình trạng hệ thống. Vercel-side aggregator + heartbeat emitter.
//
// The Admin browser calls ONE endpoint (GET /api/data?systemHealth=1, Admin-only,
// server-enforced). This helper fans out to the safe signals that already exist,
// each bounded + timed out + isolated (Promise.allSettled), and composes 6
// operational lines + an overall status. A failing dependency degrades ITS line
// only — it never hangs the page and is never silently reported as HEALTHY.
//
// Nothing sensitive crosses back to the browser: only { status, title, small
// reason codes, timestamps, small integers }.

const { checkSupabaseHealth } = require('./production-hardening');

let BUILD = {};
try { BUILD = require('../../build-info.json') || {}; } catch (_e) { BUILD = {}; }

const BASE = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const HEALTH_ENABLED = String(process.env.PHF_SYSTEM_HEALTH_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';

const S = { HEALTHY: 'HEALTHY', WARNING: 'WARNING', ERROR: 'ERROR', UNKNOWN: 'UNKNOWN' };
const STATUS_TEXT = {
  HEALTHY: 'Hoạt động bình thường',
  WARNING: 'Cần chú ý',
  ERROR: 'Đang có lỗi',
  UNKNOWN: 'Chưa xác minh',
};

// ---- bounded fetch --------------------------------------------------------
async function apiGet(pathname, timeoutMs) {
  if (!BASE || !TOKEN) { const e = new Error('BRIDGE_NOT_CONFIGURED'); e.code = 'BRIDGE_NOT_CONFIGURED'; throw e; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 3500);
  try {
    const r = await fetch(BASE + pathname, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  } finally {
    clearTimeout(t);
  }
}

// ---- pure classifiers (unit-tested) ------------------------------------
function worst(statuses) {
  // ERROR > WARNING > HEALTHY ; UNKNOWN never escalates past WARNING.
  if (statuses.includes(S.ERROR)) return S.ERROR;
  if (statuses.includes(S.WARNING)) return S.WARNING;
  const known = statuses.filter((x) => x !== S.UNKNOWN);
  if (!known.length) return S.UNKNOWN;
  if (statuses.includes(S.UNKNOWN)) return S.WARNING;
  return S.HEALTHY;
}

function classifyCron(hb, now) {
  // */5 job. hb = { lastRunAt, lastOk, ageSeconds } | null
  if (!hb || !hb.lastRunAt) return { status: S.UNKNOWN, reason: 'NO_HEARTBEAT' };
  const age = Number.isFinite(hb.ageSeconds) ? hb.ageSeconds
    : Math.max(0, Math.floor((now - new Date(hb.lastRunAt).getTime()) / 1000));
  if (hb.lastOk === false) return { status: S.ERROR, reason: 'LAST_RUN_FAILED', ageSeconds: age };
  if (age <= 15 * 60) return { status: S.HEALTHY, ageSeconds: age };
  if (age <= 60 * 60) return { status: S.WARNING, reason: 'STALE_15M', ageSeconds: age };
  return { status: S.ERROR, reason: 'STALE_60M', ageSeconds: age };
}

function classifyWeekly(hb, fallbackLatestAt, now) {
  // Weekly job (Mon). Prefer heartbeat; fall back to latest WEEKLY_REPORT enqueue.
  // NEVER stale merely because today is not Monday — window is 8 days.
  const ref = (hb && hb.lastRunAt) || fallbackLatestAt || null;
  if (!ref) return { status: S.UNKNOWN, reason: 'NEVER_SEEN' };
  if (hb && hb.lastOk === false) return { status: S.ERROR, reason: 'LAST_RUN_FAILED', lastAt: ref };
  const days = (now - new Date(ref).getTime()) / 86400000;
  if (days <= 8) return { status: S.HEALTHY, lastAt: ref };
  if (days <= 10) return { status: S.WARNING, reason: 'MISSED_WINDOW', lastAt: ref };
  return { status: S.ERROR, reason: 'MISSED_MONDAY', lastAt: ref };
}

function classifyMail(mail, mailHb, now) {
  if (!mail || mail.error) return { status: S.UNKNOWN, reason: 'OUTBOX_UNREADABLE' };
  const providerConfigured = mailHb && mailHb.summary ? mailHb.summary.providerConfigured : undefined;
  const base = {
    pending: mail.pending, claimed: mail.claimed, failed: mail.failed,
    sent24h: mail.sent24h, latestSentAt: mail.latestSentAt,
    oldestOpenAgeSeconds: mail.oldestOpenAgeSeconds,
  };
  if (providerConfigured === false) return { status: S.ERROR, reason: 'PROVIDER_DISABLED', ...base };
  const openAge = Number.isFinite(mail.oldestOpenAgeSeconds) ? mail.oldestOpenAgeSeconds : null;
  if (openAge != null && openAge > 60 * 60) return { status: S.ERROR, reason: 'BACKLOG_STUCK', ...base };
  if (mail.failed > 0) return { status: S.WARNING, reason: 'RECENT_FAILURES', ...base };
  if (openAge != null && openAge > 15 * 60) return { status: S.WARNING, reason: 'BACKLOG_AGING', ...base };
  return { status: S.HEALTHY, ...base };
}

// ---- the aggregator ---------------------------------------------------
async function getSystemHealth() {
  const now = Date.now();
  const [supaR, procR, deepR] = await Promise.allSettled([
    checkSupabaseHealth({ timeoutMs: 4000 }),
    apiGet('/healthz', 3000),
    HEALTH_ENABLED
      ? apiGet('/v1/system:health', 3800)
      : Promise.reject(Object.assign(new Error('DISABLED'), { code: 'BRIDGE_DISABLED' })),
  ]);

  // --- Web / Supabase MAIN ---
  let web;
  let dbMain;
  if (supaR.status === 'fulfilled') {
    const h = supaR.value;
    web = h.ok ? { status: S.HEALTHY } : { status: S.WARNING, reason: h.code || 'CHECKLIST_NOT_READY' };
    dbMain = h.ok
      ? { status: S.HEALTHY }
      : (h.code === 'ENV_NOT_CONFIGURED'
        ? { status: S.UNKNOWN, reason: h.code }
        : { status: S.ERROR, reason: h.code || 'SUPABASE_UNAVAILABLE' });
  } else {
    web = { status: S.ERROR, reason: 'HEALTH_PROBE_FAILED' };
    dbMain = { status: S.ERROR, reason: 'SUPABASE_UNAVAILABLE' };
  }

  // --- Company API process ---
  let api;
  if (procR.status === 'fulfilled' && procR.value.status === 200) {
    api = { status: S.HEALTHY, uptimeSeconds: Number(procR.value.json && procR.value.json.uptimeSeconds) || null };
  } else if (procR.status === 'fulfilled') {
    api = { status: S.ERROR, reason: 'HTTP_' + procR.value.status };
  } else {
    api = { status: S.ERROR, reason: procR.reason && procR.reason.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE' };
  }

  // --- deep snapshot (Company PG + heartbeats + mail aggregate) ---
  let deep = null;
  if (deepR.status === 'fulfilled' && deepR.value.status === 200 && deepR.value.json && deepR.value.json.ok) {
    deep = deepR.value.json.data;
  }

  // Company PG
  let dbCompany;
  if (!HEALTH_ENABLED) dbCompany = { status: S.UNKNOWN, reason: 'DEEP_PROBE_DISABLED' };
  else if (!deep) dbCompany = { status: S.UNKNOWN, reason: 'DEEP_PROBE_UNAVAILABLE' };
  else if (deep.db && deep.db.ok) dbCompany = { status: deep.db.latencyMs > 3000 ? S.WARNING : S.HEALTHY, latencyMs: deep.db.latencyMs };
  else dbCompany = { status: S.ERROR, reason: (deep.db && deep.db.reason) || 'DB_ERROR' };

  // Company API line = process, degraded if the deep DB probe says ERROR
  const apiLine = { ...api };
  if (api.status === S.HEALTHY && dbCompany.status === S.ERROR) { apiLine.status = S.WARNING; apiLine.reason = 'DB_DEGRADED'; }

  // Background jobs
  const hbList = deep && Array.isArray(deep.heartbeats) ? deep.heartbeats : [];
  const hb = (j) => hbList.find((x) => x.job === j) || null;
  let jobs;
  if (!HEALTH_ENABLED || !deep) {
    jobs = { status: S.UNKNOWN, reason: 'NO_HEARTBEAT_SOURCE' };
  } else {
    const rec = classifyCron(hb('task-recurrence'), now);
    const mailCron = classifyCron(hb('task-mail'), now);
    const weekly = classifyWeekly(hb('task-weekly-report'), null, now);
    jobs = {
      status: worst([rec.status, mailCron.status, weekly.status === S.UNKNOWN ? S.HEALTHY : weekly.status]),
      recurrence: rec,
      mailDrainer: mailCron,
      weeklyReport: weekly,
    };
  }

  // Mail
  const mailAgg = deep && deep.mail && !deep.mail.error ? deep.mail : null;
  const mail = (!HEALTH_ENABLED || !deep)
    ? { status: S.UNKNOWN, reason: 'OUTBOX_UNREADABLE' }
    : classifyMail(mailAgg, hb('task-mail'), now);

  // Backup — V1: no app-readable trustworthy signal (audit sections H / O).
  const backup = { status: S.UNKNOWN, reason: 'NO_AUTOMATED_SIGNAL' };

  const lines = {
    web: { key: 'web', title: 'Hệ thống PHF HR', ...web },
    api: { key: 'api', title: 'API công ty', ...apiLine },
    database: {
      key: 'database', title: 'Cơ sở dữ liệu',
      status: worst([dbMain.status, dbCompany.status]),
      supabaseMain: dbMain, companyPostgres: dbCompany,
    },
    jobs: { key: 'jobs', title: 'Tác vụ nền', ...jobs },
    mail: { key: 'mail', title: 'Email hệ thống', ...mail },
    backup: { key: 'backup', title: 'Sao lưu', ...backup },
  };

  const overall = worst(Object.values(lines).map((l) => l.status));

  return {
    checkedAt: new Date(now).toISOString(),
    version: BUILD.version || null,
    builtAt: BUILD.builtAt || null,
    overall: { status: overall, label: STATUS_TEXT[overall] },
    statusText: STATUS_TEXT,
    lines,
  };
}

// ---- heartbeat emitter (FAIL-OPEN — never throws, never blocks a job) ----
async function emitCronHeartbeat(job, ok, summary) {
  if (!HEALTH_ENABLED || !BASE || !TOKEN) return { ok: false, skipped: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(BASE + '/v1/system:heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ job, ok: ok === true, summary: summary || null }),
        signal: ctrl.signal,
      });
      return { ok: r.ok };
    } finally { clearTimeout(t); }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[PHF System Health] heartbeat failed (job NOT affected):', job, err && err.message);
    return { ok: false, error: err && err.message };
  }
}

module.exports = {
  getSystemHealth,
  emitCronHeartbeat,
  // exported for tests:
  worst,
  classifyCron,
  classifyWeekly,
  classifyMail,
  STATUS_TEXT,
  S,
  SYSTEM_HEALTH_ENABLED: HEALTH_ENABLED,
};
