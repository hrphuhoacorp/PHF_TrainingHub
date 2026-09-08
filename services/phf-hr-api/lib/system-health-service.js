'use strict';

// PHF HR — SYSTEM V1 · Tình trạng hệ thống (System Health) — bounded, server-side.
//
// This module NEVER returns infrastructure secrets. Every function here runs
// inside phf-hr-api (never the browser) and returns only a reduced operational
// snapshot: booleans, small integer counters, timestamps, coarse reason codes.
//
// NOT touched: any Task / Notice / Competition / Checklist / KNL / QTTH / Audit
// business logic. The only new storage is system.cron_heartbeat (one row/job).

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');
const logger = require('./logger');

const HEARTBEAT_JOBS = ['task-recurrence', 'task-mail', 'task-weekly-report'];

// ---- deep DB probe -------------------------------------------------------
// SELECT 1 inside a READ ONLY transaction with a short statement_timeout.
// Returns { ok, latencyMs, reason } — never the DSN / host / user / SQL.
async function probeDatabase(config, options) {
  const timeoutMs = Math.min(Math.max(Number((options && options.timeoutMs) || 3000), 500), 5000);
  const started = Date.now();
  try {
    const value = await withTaskReadTransaction(config, async (client) => {
      const r = await client.query('SELECT 1 AS ok');
      return r.rows[0] && r.rows[0].ok;
    }, { timeoutMs });
    const latencyMs = Date.now() - started;
    if (value !== 1) return { ok: false, latencyMs, reason: 'DB_UNEXPECTED' };
    return { ok: true, latencyMs, reason: null };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = String((err && err.message) || '');
    let reason = 'DB_ERROR';
    if (/statement timeout/i.test(msg) || /canceling statement/i.test(msg)) reason = 'DB_TIMEOUT';
    else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|terminating connection|Connection terminated/i.test(msg)) reason = 'DB_UNAVAILABLE';
    logger.warn('system_health_db_probe_failed', { reason });
    return { ok: false, latencyMs, reason };
  }
}

// ---- heartbeat read ----------------------------------------------------
async function readHeartbeats(config) {
  return withTaskReadTransaction(config, async (client) => {
    const r = await client.query(
      `SELECT job, last_run_at, last_ok, last_summary, updated_at
         FROM system.cron_heartbeat
        WHERE job = ANY($1::text[])`,
      [HEARTBEAT_JOBS]
    );
    const byJob = {};
    for (const row of r.rows) {
      byJob[row.job] = {
        job: row.job,
        lastRunAt: row.last_run_at,
        lastOk: row.last_ok === true,
        ageSeconds: row.last_run_at ? Math.max(0, Math.floor((Date.now() - new Date(row.last_run_at).getTime()) / 1000)) : null,
        summary: sanitizeSummary(row.last_summary),
      };
    }
    return HEARTBEAT_JOBS.map((j) => byJob[j] || { job: j, lastRunAt: null, lastOk: null, ageSeconds: null, summary: null });
  }, { timeoutMs: 4000 });
}

// ---- heartbeat write (fail-open at the caller) -------------------------
// Only these counter-ish keys survive; anything else (recipient, body, token,
// payload, secret) is dropped even if a caller passes it by mistake.
const SUMMARY_ALLOW = new Set([
  'claimed', 'sent', 'skipped', 'failed', 'pending',
  'generated', 'alreadyClaimed', 'rulesScanned', 'occurrences',
  'enabled', 'bridgeEnabled', 'providerConfigured',
  'recipients', 'enqueued', 'periodStart', 'httpStatus', 'code', 'durationMs',
]);
function sanitizeSummary(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!SUMMARY_ALLOW.has(k)) continue;
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 40);
  }
  return Object.keys(out).length ? out : null;
}

async function writeHeartbeat(config, job, ok, summary) {
  if (!HEARTBEAT_JOBS.includes(String(job))) {
    const e = new Error('SYSTEM_HEALTH_JOB_INVALID: ' + job);
    e.code = 'SYSTEM_HEALTH_JOB_INVALID';
    throw e;
  }
  const clean = sanitizeSummary(summary);
  return withTaskWriteTransaction(config, async (client) => {
    const r = await client.query(
      `INSERT INTO system.cron_heartbeat (job, last_run_at, last_ok, last_summary, updated_at)
         VALUES ($1, now(), $2, $3, now())
       ON CONFLICT (job) DO UPDATE
         SET last_run_at = now(), last_ok = EXCLUDED.last_ok,
             last_summary = EXCLUDED.last_summary, updated_at = now()
       RETURNING job, last_run_at`,
      [String(job), ok === true, clean == null ? null : JSON.stringify(clean)]
    );
    return { job: r.rows[0].job, lastRunAt: r.rows[0].last_run_at };
  });
}

// ---- bounded mail-outbox aggregate ------------------------------------
// Counts + timestamps only. NEVER a recipient / subject / body / dedupe key /
// payload. Cheap (indexed partial scans + one MAX).
async function mailOutboxAggregate(config) {
  return withTaskReadTransaction(config, async (client) => {
    const r = await client.query(`
      SELECT
        count(*) FILTER (WHERE status = 'pending')                                          AS pending,
        count(*) FILTER (WHERE status = 'claimed')                                          AS claimed,
        count(*) FILTER (WHERE status = 'failed')                                           AS failed,
        count(*) FILTER (WHERE status = 'sent' AND sent_at >= now() - interval '24 hours')  AS sent_24h,
        max(sent_at) FILTER (WHERE status = 'sent')                                         AS latest_sent_at,
        min(created_at) FILTER (WHERE status IN ('pending', 'claimed'))                     AS oldest_open_at
      FROM task.mail_outbox`);
    const row = r.rows[0] || {};
    const oldestOpenAgeSeconds = row.oldest_open_at
      ? Math.max(0, Math.floor((Date.now() - new Date(row.oldest_open_at).getTime()) / 1000))
      : null;
    return {
      pending: Number(row.pending || 0),
      claimed: Number(row.claimed || 0),
      failed: Number(row.failed || 0),
      sent24h: Number(row.sent_24h || 0),
      latestSentAt: row.latest_sent_at || null,
      oldestOpenAgeSeconds,
    };
  }, { timeoutMs: 4000 });
}

// ---- the composed phf-hr-api snapshot --------------------------------
async function getServiceHealth(config, meta) {
  const [db, heartbeats, mail] = await Promise.all([
    probeDatabase(config).catch(() => ({ ok: false, latencyMs: null, reason: 'DB_ERROR' })),
    readHeartbeats(config).catch(() => null),
    mailOutboxAggregate(config).catch(() => null),
  ]);
  return {
    api: {
      status: 'ok', // reaching this code proves the phf-hr-api process is serving
      uptimeSeconds: meta && Number.isFinite(meta.uptimeSeconds) ? meta.uptimeSeconds : null,
      startedAt: (meta && meta.startedAt) || null,
    },
    db,
    heartbeats: heartbeats || { error: 'HEARTBEAT_READ_FAILED' },
    mail: mail || { error: 'MAIL_AGGREGATE_FAILED' },
  };
}

module.exports = {
  HEARTBEAT_JOBS,
  probeDatabase,
  readHeartbeats,
  writeHeartbeat,
  mailOutboxAggregate,
  getServiceHealth,
  sanitizeSummary,
};
