'use strict';

/*
 * PHF HR — Competition Performance V1 · P1 before/after evidence harness.
 *
 * READ-ONLY against the disposable throwaway phf_hr_e2e (tunnel 127.0.0.1:
 * <PHF_HR_DB_PORT>). Measures the 3 P1 changes:
 *   FEED  — unbounded full fetch + full payload  vs  keyset page + projection
 *   QUEUE — unbounded fetch + eager queue×300 similarity  vs  keyset page, 0 similarity
 *   LEADERBOARD — recompute-every-open  vs  signature-gated in-process cache
 *
 * NODE_PATH=<main>/services/phf-hr-api/node_modules node scripts/perf-competition-p1-evidence-2026-09.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { Client } = require('pg');
const svc = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-service'));
const lb = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-leaderboard'));
const sim = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-similarity'));

const ENV_PATH = process.env.PHF_HR_E2E_DB_ENV || path.join(ROOT, 'e2e', 'phf-hr-e2e-db.env');
const kv = {};
fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) kv[m[1]] = m[2].trim();
});
const config = {
  PHF_HR_DB_HOST: kv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: Number(kv.PHF_HR_DB_PORT || 15432),
  PHF_HR_DB_NAME: kv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: kv.PHF_HR_DB_RUNTIME_USER,
  PHF_HR_DB_RUNTIME_PASSWORD: kv.PHF_HR_DB_RUNTIME_PASSWORD, SERVICE_TOKEN: 'x'.repeat(40),
};
const ADMIN = { accountId: 'PERF-ADM', employeeCode: 'PERF-ADM', displayName: 'Perf Admin', systemRole: 'admin' };
const call = (action, params) => svc.dispatch(config, ADMIN, action, params || {});
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
async function timed(fn) { const t = process.hrtime.bigint(); const v = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, v }; }
const round = (n) => Math.round(n * 10) / 10;

let admin;
async function q(sql, params) {
  await admin.query('BEGIN'); await admin.query('SET LOCAL ROLE phf_hr_app');
  try { const r = await admin.query(sql, params || []); await admin.query('COMMIT'); return r; }
  catch (e) { await admin.query('ROLLBACK').catch(() => {}); throw e; }
}

async function pickCampaigns() {
  const r = await q(
    `SELECT s.campaign_id,
            count(*) FILTER (WHERE s.status IN ('approved','finalized')) AS feed_n,
            count(*) FILTER (WHERE s.status IN ('submitted','needs_revision')) AS queue_n
       FROM competition.submissions s
       JOIN competition.campaigns c ON c.id = s.campaign_id
      GROUP BY s.campaign_id`);
  const feed = r.rows.slice().sort((a, b) => b.feed_n - a.feed_n)[0];
  const queue = r.rows.slice().sort((a, b) => b.queue_n - a.queue_n)[0];
  return { feedCampaign: feed.campaign_id, feedN: Number(feed.feed_n), queueCampaign: queue.campaign_id, queueN: Number(queue.queue_n) };
}

async function feedEvidence(campaignId) {
  // BEFORE — the old getFeed: no LIMIT, full s.payload, correlated reaction subqueries.
  const before = await timed(() => q(
    `SELECT s.id, s.payload, s.current_level_order, s.current_score, s.submitted_at, s.status,
            al.name AS level_name, pa.alias, s.author_display_name_snapshot,
            ( SELECT count(*) FROM competition.reactions r WHERE r.submission_id = s.id AND r.is_active ) AS reaction_total
       FROM competition.submissions s
       LEFT JOIN competition.approval_levels al ON al.campaign_id = s.campaign_id AND al.level_order = s.current_level_order
       LEFT JOIN competition.participant_aliases pa ON pa.campaign_id = s.campaign_id AND pa.account_id = s.author_account_id
      WHERE s.campaign_id = $1 AND s.status IN ('approved','finalized')
      ORDER BY COALESCE(s.approved_at, s.submitted_at) DESC`, [campaignId]));
  // AFTER — new getFeed default page + projection.
  const after = await timed(() => call('competition.feed.get', { campaignId }));
  // page through and verify no dupes / no gaps vs the full ordered set
  const fullIds = before.v.rows.map((x) => x.id);
  let cur = after.v.nextCursor, seen = after.v.posts.map((p) => p.submissionId), pages = 1;
  while (cur) { const nx = await call('competition.feed.get', { campaignId, cursor: cur }); seen = seen.concat(nx.posts.map((p) => p.submissionId)); cur = nx.nextCursor; pages++; }
  const dupes = seen.length - new Set(seen).size;
  const orderMatch = JSON.stringify(seen) === JSON.stringify(fullIds);
  return {
    beforeRows: before.v.rowCount, beforeBytes: bytes(before.v.rows), beforeMs: round(before.ms),
    afterFirstPageRows: after.v.posts.length, afterFirstPageBytes: bytes(after.v), afterMs: round(after.ms),
    pagesToDrain: pages, totalRowsPaged: seen.length, duplicateRows: dupes, fullOrderPreserved: orderMatch,
  };
}

async function queueEvidence(campaignId) {
  // BEFORE — unbounded queue fetch (admin sees every submitted/needs_revision row, full payload)
  // admin queue visibility = submitted/needs_revision + all 'approved'
  const before = await timed(() => q(
    `SELECT s.id, s.payload, s.status, s.current_level_order, s.submitted_at, s.last_review_note
       FROM competition.submissions s
       JOIN competition.campaigns c ON c.id = s.campaign_id
      WHERE s.campaign_id = $1 AND s.status IN ('submitted','needs_revision','approved')
      ORDER BY s.submitted_at ASC NULLS LAST`, [campaignId]));
  // BEFORE — eager attachQueueSimilarityFlags cost: one 300-candidate pool fetch,
  // then rankCandidates for EVERY queue item.
  const pool = (await q(
    `SELECT id, payload->>'customer_question' AS question, payload->>'answer' AS answer
       FROM competition.submissions
      WHERE campaign_id = $1 AND status = ANY(ARRAY['submitted','needs_revision','approved','finalized'])
      ORDER BY submitted_at DESC NULLS LAST LIMIT 300`, [campaignId])).rows
    .map((x) => ({ id: x.id, question: x.question || '', answer: x.answer || '' }));
  const eager = await timed(async () => {
    let comparisons = 0;
    for (const it of before.v.rows) {
      const others = pool.filter((c) => c.id !== it.id);
      comparisons += others.length;
      sim.rankCandidates((it.payload && it.payload.customer_question) || '', (it.payload && it.payload.answer) || '', others, 3);
    }
    return comparisons;
  });
  // AFTER — new queue: keyset page, no similarity work at all
  const after = await timed(() => call('competition.review.queue', { campaignId, limit: 20 }));
  let cur = after.v.nextCursor, seen = after.v.items.map((i) => i.submissionRef), pages = 1;
  while (cur) { const nx = await call('competition.review.queue', { campaignId, cursor: cur, limit: 20 }); seen = seen.concat(nx.items.map((i) => i.submissionRef)); cur = nx.nextCursor; pages++; }
  const dupes = seen.length - new Set(seen).size;
  const fullIds = before.v.rows.map((x) => x.id);
  return {
    beforeQueueRows: before.v.rowCount, beforeQueueBytes: bytes(before.v.rows), beforeQueueMs: round(before.ms),
    beforeEagerSimilarityComparisons: eager.v, beforeEagerSimilarityMs: round(eager.ms),
    afterFirstPageRows: after.v.items.length, afterFirstPageBytes: bytes(after.v), afterMs: round(after.ms),
    afterSimilarityComparisonsOnLoad: 0,
    pagesToDrain: pages, totalRowsPaged: seen.length, duplicateRows: dupes,
    fullSetCovered: seen.length === fullIds.length && new Set(seen).size === new Set(fullIds).size,
  };
}

async function leaderboardEvidence(campaignId) {
  lb._leaderboardCache.clear();
  const miss = await timed(() => call('competition.leaderboard.get', { campaignId }));
  const hit = await timed(() => call('competition.leaderboard.get', { campaignId }));
  const rowsEqual = JSON.stringify(miss.v.rows) === JSON.stringify(hit.v.rows);
  const sig = async () => {
    await admin.query('BEGIN'); await admin.query('SET LOCAL ROLE phf_hr_app');
    const r = await lb.leaderboardSignature(admin, campaignId);
    await admin.query('COMMIT'); return r;
  };
  const sigBefore = await sig();
  // invalidation proof: touch one submission row as postgres (throwaway only,
  // bypass the append-only guard) — updated_at trigger fires, signature moves.
  const oneId = (await q(`SELECT id FROM competition.submissions WHERE campaign_id=$1 LIMIT 1`, [campaignId])).rows[0].id;
  const container = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
  execFileSync('ssh', ['claude-phf', `docker exec -i ${container} psql -U postgres -d ${config.PHF_HR_DB_NAME} -v ON_ERROR_STOP=1`],
    { input: `SET session_replication_role=replica; UPDATE competition.submissions SET updated_at = now() + interval '2 ms' WHERE id='${oneId}'; RESET session_replication_role;`, stdio: ['pipe', 'ignore', 'inherit'] });
  const sigAfter = await sig();
  const reMiss = await timed(() => call('competition.leaderboard.get', { campaignId }));
  const hit2 = await timed(() => call('competition.leaderboard.get', { campaignId }));
  return {
    missMs: round(miss.ms), hitMs: round(hit.ms), speedup: round(miss.ms / Math.max(hit.ms, 0.01)),
    cachedRowsIdentical: rowsEqual, leaderboardRowCount: miss.v.rows.length,
    signatureChangedAfterSubmissionTouch: sigBefore !== sigAfter,
    recomputeAfterInvalidationMs: round(reMiss.ms), postInvalidationHitMs: round(hit2.ms),
  };
}

// Adopt the biggest orphan submission set (load-test rows whose campaigns row
// was cascade-removed) under a throwaway campaigns row so the real service
// path can be measured at scale, then detach it again.
async function withScaleCampaign(fn) {
  const orphan = (await q(
    `SELECT s.campaign_id, count(*) n
       FROM competition.submissions s
       LEFT JOIN competition.campaigns c ON c.id = s.campaign_id
      WHERE c.id IS NULL
      GROUP BY s.campaign_id ORDER BY n DESC LIMIT 1`)).rows[0];
  if (!orphan) return null;
  const cid = orphan.campaign_id;
  const container = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
  const exec = (sql) => execFileSync('ssh', ['claude-phf', `docker exec -i ${container} psql -U postgres -d ${config.PHF_HR_DB_NAME} -v ON_ERROR_STOP=1`], { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
  exec(`SET session_replication_role=replica;
    INSERT INTO competition.campaigns (id, code, title, status, form_schema, publication_state)
    VALUES ('${cid}', 'PERF-SCALE-TMP', 'Perf scale temp', 'accepting', '[]'::jsonb, 'internal')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO competition.approval_levels (campaign_id, level_order, name, score)
    VALUES ('${cid}',1,'2 diem',2),('${cid}',2,'5 diem',5) ON CONFLICT DO NOTHING;
    RESET session_replication_role;`);
  try { return await fn(cid, Number(orphan.n)); }
  finally {
    exec(`SET session_replication_role=replica;
      DELETE FROM competition.approval_levels WHERE campaign_id='${cid}';
      DELETE FROM competition.campaigns WHERE id='${cid}';
      RESET session_replication_role;`);
  }
}

(async () => {
  admin = new Client({
    host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME,
    user: 'postgres', password: process.env.PGPASSWORD || undefined,
  });
  // postgres superuser via trust? fall back to runtime user for reads if needed
  try { await admin.connect(); }
  catch (e) {
    admin = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
    await admin.connect();
  }
  const picks = await pickCampaigns();
  console.log('CAMPAIGNS', JSON.stringify(picks));
  console.log('\nFEED', JSON.stringify(await feedEvidence(picks.feedCampaign), null, 2));
  console.log('\nQUEUE', JSON.stringify(await queueEvidence(picks.queueCampaign), null, 2));
  console.log('\nLEADERBOARD', JSON.stringify(await leaderboardEvidence(picks.queueCampaign), null, 2));
  const scale = await withScaleCampaign(async (cid, n) => {
    console.log('\n=== SCALE CAMPAIGN ' + cid + ' (' + n + ' submissions) ===');
    console.log('\nFEED@scale', JSON.stringify(await feedEvidence(cid), null, 2));
    console.log('\nQUEUE@scale', JSON.stringify(await queueEvidence(cid), null, 2));
    console.log('\nLEADERBOARD@scale', JSON.stringify(await leaderboardEvidence(cid), null, 2));
  });
  if (scale === null) console.log('\n(no orphan submission set available for scale test)');
  await admin.end();
})().catch((e) => { console.error(e); process.exit(1); });
