'use strict';

// PHF HR — SYSTEM V1 · Nhật ký hệ thống (Audit Log) FOUNDATION V1.
//
// ONE central append-only store: audit.entries (Company PG phf_hr). This module
// is the ONLY write path. Callers pass an explicit, whitelisted context object —
// nothing is read from the HTTP request here; the bridge route in server.js
// extracts ip / user-agent / request-id server-side and hands them in.
//
// FOUNDATION V1 wires AUTH + ACCOUNT events only. No Task/Notice/Competition/
// Checklist integration here. No historical backfill.

const { withTaskWriteTransaction, withTaskReadTransaction } = require('./db');
const logger = require('./logger');

const MODULES = new Set(['auth', 'account', 'system']);
const RESULTS = new Set(['success', 'failure', 'blocked']);
const SOURCE_SYSTEMS = new Set(['web', 'phf-hr-api', 'cron', 'backfill']);

// AUTH + ACCOUNT + the auto-lock cascade. A closed allowlist — an unknown
// action is rejected so the log never fills with ad-hoc strings.
const ACTIONS = new Set([
  'AUTH_LOGIN_SUCCESS', 'AUTH_LOGIN_FAILURE', 'AUTH_LOGOUT',
  'ACCOUNT_CREATE', 'ACCOUNT_UPDATE', 'ACCOUNT_ACCESS_LOCK', 'ACCOUNT_ACCESS_UNLOCK',
  'ACCOUNT_ROLE_CHANGE', 'ACCOUNT_PASSWORD_RESET', 'ACCOUNT_DELETE',
  'EMPLOYEE_INACTIVE_AUTO_LOCK',
]);

// Keys that must NEVER land in before/after/metadata JSON, at any depth.
const SECRET_KEY_RE = /pass(word)?|pwd|salt|hash|credential|token|secret|cookie|authorization|api[-_]?key|session|jwt|bearer/i;

const MAX_JSON_CHARS = 6000;   // per before_json / after_json (DB backstop is 16 KB)
const MAX_META_CHARS = 3000;
const MAX_STR = 600;           // any single string value inside the projection
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

// Deep, defensive projection: strips secret-ish keys, truncates long strings,
// bounds depth / breadth / total size. Marks any truncation with _truncated.
function boundJson(value, maxChars) {
  if (value == null) return null;
  let truncated = false;
  function walk(v, depth) {
    if (v == null) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (v.length > MAX_STR) { truncated = true; return v.slice(0, MAX_STR); }
      return v;
    }
    if (depth >= MAX_DEPTH) { truncated = true; return '[depth-limit]'; }
    if (Array.isArray(v)) {
      const out = v.slice(0, MAX_KEYS).map((x) => walk(x, depth + 1));
      if (v.length > MAX_KEYS) truncated = true;
      return out;
    }
    if (typeof v === 'object') {
      const out = {};
      let i = 0;
      for (const k of Object.keys(v)) {
        if (SECRET_KEY_RE.test(k)) { out[k] = '[redacted]'; truncated = true; continue; }
        if (i++ >= MAX_KEYS) { truncated = true; break; }
        out[k] = walk(v[k], depth + 1);
      }
      return out;
    }
    return String(v);
  }
  let projected = walk(value, 0);
  let json = JSON.stringify(projected);
  if (json.length > (maxChars || MAX_JSON_CHARS)) {
    projected = { _truncated: true, _note: 'projection exceeded size limit' };
    truncated = true;
  } else if (truncated && projected && typeof projected === 'object' && !Array.isArray(projected)) {
    projected._truncated = true;
  }
  return projected;
}

function normContext(ctx) {
  ctx = ctx || {};
  const module = String(ctx.module || '').trim();
  const action = String(ctx.action || '').trim();
  if (!MODULES.has(module)) { const e = new Error('AUDIT_MODULE_INVALID: ' + module); e.code = 'AUDIT_MODULE_INVALID'; throw e; }
  if (!ACTIONS.has(action)) { const e = new Error('AUDIT_ACTION_INVALID: ' + action); e.code = 'AUDIT_ACTION_INVALID'; throw e; }
  const result = RESULTS.has(ctx.result) ? ctx.result : 'success';
  const source = SOURCE_SYSTEMS.has(ctx.source_system) ? ctx.source_system : 'web';
  return {
    occurred_at: ctx.occurred_at ? new Date(ctx.occurred_at) : new Date(),
    actor_account_id: ctx.actor_account_id ? clip(ctx.actor_account_id, 128) : null,
    actor_employee_code: ctx.actor_employee_code ? clip(String(ctx.actor_employee_code).toUpperCase(), 32) : null,
    actor_name: ctx.actor_name ? clip(ctx.actor_name, 200) : null,
    module, action,
    object_type: ctx.object_type ? clip(ctx.object_type, 64) : null,
    object_id: ctx.object_id ? clip(ctx.object_id, 128) : null,
    object_label: ctx.object_label ? clip(ctx.object_label, 200) : null,
    result, source_system: source,
    request_id: ctx.request_id ? clip(ctx.request_id, 80) : null,
    ip: ctx.ip ? clip(ctx.ip, 64) : null,
    user_agent: ctx.user_agent ? clip(ctx.user_agent, 512) : null,
    before_json: boundJson(ctx.before, MAX_JSON_CHARS),
    after_json: boundJson(ctx.after, MAX_JSON_CHARS),
    metadata_json: boundJson(ctx.metadata, MAX_META_CHARS),
  };
}

const INSERT_SQL = `
  INSERT INTO audit.entries
    (occurred_at, actor_account_id, actor_employee_code, actor_name, module, action,
     object_type, object_id, object_label, result, source_system,
     request_id, ip, user_agent, before_json, after_json, metadata_json)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  RETURNING id, occurred_at`;

async function emitAudit(config, ctx) {
  const r = normContext(ctx);
  return withTaskWriteTransaction(config, async (client) => {
    const res = await client.query(INSERT_SQL, [
      r.occurred_at, r.actor_account_id, r.actor_employee_code, r.actor_name, r.module, r.action,
      r.object_type, r.object_id, r.object_label, r.result, r.source_system,
      r.request_id, r.ip, r.user_agent,
      r.before_json == null ? null : JSON.stringify(r.before_json),
      r.after_json == null ? null : JSON.stringify(r.after_json),
      r.metadata_json == null ? null : JSON.stringify(r.metadata_json),
    ]);
    return { id: String(res.rows[0].id), occurredAt: res.rows[0].occurred_at };
  });
}

// ---- READ (Admin-only; the route enforces the service token, the Vercel
// proxy enforces requireSession(['admin'])) --------------------------------
const LIST_COLS = `id, occurred_at, actor_account_id, actor_employee_code, actor_name,
  module, action, object_type, object_id, object_label, result, source_system`;

function buildWhere(f, params) {
  const w = [];
  if (f.from)   { params.push(new Date(f.from));  w.push(`occurred_at >= $${params.length}`); }
  if (f.to)     { params.push(new Date(f.to));    w.push(`occurred_at <= $${params.length}`); }
  if (f.module) { params.push(String(f.module));  w.push(`module = $${params.length}`); }
  if (f.action) { params.push(String(f.action));  w.push(`action = $${params.length}`); }
  if (f.result) { params.push(String(f.result));  w.push(`result = $${params.length}`); }
  if (f.user) {
    params.push(String(f.user).toUpperCase()); const a = params.length;
    params.push('%' + String(f.user).toLowerCase() + '%'); const b = params.length;
    w.push(`(actor_employee_code = $${a} OR actor_account_id = $${a} OR lower(actor_name) LIKE $${b})`);
  }
  if (f.q) {
    params.push('%' + String(f.q).toLowerCase().slice(0, 80) + '%'); const p = params.length;
    w.push(`(lower(coalesce(object_label,'')) LIKE $${p} OR lower(coalesce(object_id,'')) LIKE $${p} OR lower(coalesce(actor_name,'')) LIKE $${p})`);
  }
  // keyset anchor
  if (f.cursor && /^\d+\|\d+$/.test(String(f.cursor))) {
    const [ts, id] = String(f.cursor).split('|');
    params.push(new Date(Number(ts))); const tp = params.length;
    params.push(Number(id)); const ip = params.length;
    w.push(`(occurred_at < $${tp} OR (occurred_at = $${tp} AND id < $${ip}))`);
  }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}

async function listAudit(config, filters) {
  const f = filters || {};
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const params = [];
  const where = buildWhere(f, params);
  params.push(limit + 1);
  const sql = `SELECT ${LIST_COLS} FROM audit.entries ${where}
              ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`;
  return withTaskReadTransaction(config, async (client) => {
    const res = await client.query(sql, params);
    const rows = res.rows;
    let nextCursor = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      nextCursor = new Date(last.occurred_at).getTime() + '|' + last.id;
    }
    // NB: pass a 1-arg arrow — `rows.map(mapRow)` would hand mapRow the array
    // index as its 2nd arg (`withDetail`), leaking the detail projection shape
    // for every row after the first.
    return { entries: rows.map((r) => mapRow(r)), nextCursor };
  });
}

async function getAuditDetail(config, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) { const e = new Error('AUDIT_ID_INVALID'); e.code = 'AUDIT_ID_INVALID'; throw e; }
  return withTaskReadTransaction(config, async (client) => {
    const res = await client.query(`SELECT * FROM audit.entries WHERE id = $1`, [n]);
    if (!res.rows.length) { const e = new Error('AUDIT_NOT_FOUND'); e.code = 'AUDIT_NOT_FOUND'; e.statusCode = 404; throw e; }
    return { entry: mapRow(res.rows[0], true) };
  });
}

function mapRow(r, withDetail) {
  const base = {
    id: String(r.id),
    occurredAt: r.occurred_at,
    actorAccountId: r.actor_account_id || '',
    actorEmployeeCode: r.actor_employee_code || '',
    actorName: r.actor_name || '',
    module: r.module,
    action: r.action,
    objectType: r.object_type || '',
    objectId: r.object_id || '',
    objectLabel: r.object_label || '',
    result: r.result,
    sourceSystem: r.source_system,
  };
  if (withDetail) {
    base.requestId = r.request_id || '';
    base.ip = r.ip || '';
    base.userAgent = r.user_agent || '';
    base.before = r.before_json || null;
    base.after = r.after_json || null;
    base.metadata = r.metadata_json || null;
  }
  return base;
}

module.exports = { emitAudit, listAudit, getAuditDetail, boundJson, ACTIONS, MODULES };
