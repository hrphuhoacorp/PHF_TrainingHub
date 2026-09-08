'use strict';

// PHF HR — SYSTEM V1 · Nhật ký hệ thống. Vercel-side emit helper + read proxy.
//
// The web app (Supabase MAIN) has no Company-PG connection; it reaches the
// central audit store (Company PG `audit.entries`) through phf-hr-api's
// /v1/audit bridge, exactly like the Task/Notice bridges.
//
// CROSS-DATASTORE RULE (explicit, no pretend atomicity): the business write
// (login / account mutation) commits in Supabase MAIN; the audit write commits
// in Company PG via HTTP. They are NOT one transaction. `auditEmit` is
// FAIL-OPEN — it never throws, and a failed/disabled audit write only produces
// a server-side console warning. A valid login or account action must never be
// blocked because audit storage is unavailable.
//
// The browser NEVER supplies actor / role / ip / user-agent / request-id —
// they are derived here from the authenticated session + the raw request.

const BASE = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const ENABLED = String(process.env.PHF_AUDIT_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';

function clientIp(req) {
  const xff = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  if (xff) return xff.slice(0, 64);
  const ra = String((req && req.socket && req.socket.remoteAddress) || '').trim();
  return ra ? ra.slice(0, 64) : '';
}
function requestId(req) {
  const h = (req && req.headers) || {};
  return String(h['x-vercel-id'] || h['x-request-id'] || h['x-amzn-trace-id'] || '').slice(0, 80);
}
function actorFromSession(session) {
  if (!session) return {};
  const a = session.account || session;
  return {
    actor_account_id: String(a.id || a.accountId || session.sub || '') || null,
    actor_employee_code: String(a.employeeCode || a.employee_code || session.employeeCode || '') || null,
    actor_name: String(a.name || a.fullName || a.email || '') || null,
  };
}

// Build the entry from server-trusted sources only. `ctx` carries the business
// facts (module/action/object/result/before/after/metadata); identity + request
// metadata are overlaid here and CANNOT be overridden by ctx.
function buildEntry(req, session, ctx) {
  ctx = ctx || {};
  return {
    module: ctx.module,
    action: ctx.action,
    result: ctx.result || 'success',
    source_system: 'web',
    object_type: ctx.object_type || null,
    object_id: ctx.object_id != null ? String(ctx.object_id) : null,
    object_label: ctx.object_label || null,
    before: ctx.before != null ? ctx.before : null,
    after: ctx.after != null ? ctx.after : null,
    metadata: ctx.metadata != null ? ctx.metadata : null,
    request_id: requestId(req) || null,
    ip: clientIp(req) || null,
    user_agent: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 512) || null,
    ...actorFromSession(session),
    // explicit actor override (e.g. login-failure: no session yet, but we know
    // the attempted email / resolved account). ctx.actor wins over session.
    ...(ctx.actor || {}),
  };
}

async function post(verb, payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 4000);
  try {
    const r = await fetch(BASE + '/v1/audit:' + verb, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const e = new Error(j.message || ('phf-hr-api /v1/audit:' + verb + ' HTTP ' + r.status));
      e.code = j.code || 'AUDIT_BRIDGE_UPSTREAM';
      e.statusCode = r.status;
      throw e;
    }
    return j.data;
  } finally {
    clearTimeout(t);
  }
}

// FAIL-OPEN. Returns {ok:bool}. Never throws.
async function auditEmit(req, session, ctx) {
  if (!ENABLED || !BASE || !TOKEN) return { ok: false, skipped: true };
  try {
    await post('emit', { entry: buildEntry(req, session, ctx) });
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[PHF Audit] emit failed (business action NOT affected):', ctx && ctx.action, err && err.message);
    return { ok: false, error: err && err.message };
  }
}

// READ paths — used only by the Admin-only api/audit.js. These DO throw so the
// admin sees a real error rather than a silently empty screen.
async function auditList(filters) {
  if (!ENABLED || !BASE || !TOKEN) {
    const e = new Error('Nhật ký hệ thống chưa được bật (PHF_AUDIT_BRIDGE_ENABLED).');
    e.code = 'AUDIT_BRIDGE_DISABLED'; e.statusCode = 503; throw e;
  }
  return post('list', { filters: filters || {} }, 8000);
}
async function auditDetail(id) {
  if (!ENABLED || !BASE || !TOKEN) {
    const e = new Error('Nhật ký hệ thống chưa được bật.');
    e.code = 'AUDIT_BRIDGE_DISABLED'; e.statusCode = 503; throw e;
  }
  return post('detail', { id }, 8000);
}

module.exports = { auditEmit, auditList, auditDetail, AUDIT_ENABLED: ENABLED, buildEntry, clientIp, requestId };
