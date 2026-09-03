'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 — the drainer (runs on Vercel, cron-triggered).
 *
 * Vercel is the ONLY tier with both a People-Master (Supabase) read path AND a
 * network route to Brevo, so delivery lives here — phf-hr-api only owns the
 * transactional outbox state.
 *
 * PER RUN:
 *   0. gate on PHF_TASK_MAIL_V1_ENABLED === 'true' AND provider configured
 *   1. claim a bounded batch  (phf-hr-api leases the rows: attempt_count++,
 *      status='claimed'; duplicate-safe, SKIP LOCKED)
 *   2. for each row: resolve recipient email + active flag from People Master
 *        - inactive employee / no valid email  -> mark 'skipped' (+reason), no send
 *        - template missing                     -> mark 'skipped'
 *   3. render + send via the provider (never throws)
 *        - ok                 -> mark 'sent'
 *        - permanent failure  -> mark 'skipped'  (won't retry a doomed message)
 *        - transient failure  -> mark 'failed'   (re-claimed next run, capped)
 *
 * A missing email / inactive employee / Brevo failure is ALWAYS just a ledger
 * status — the business event committed long ago and is never touched.
 */

const { renderTaskMail } = require('./task-mail-templates');
const { isProviderConfigured, sendTransactionalEmail } = require('./task-mail-provider');
const {
  isMailBridgeEnabled,
  bridgeClaimMailOutbox,
  bridgeMarkMailOutboxBatch,
} = require('./task-mail-bridge');

function isMailV1Enabled() {
  return String(process.env.PHF_TASK_MAIL_V1_ENABLED || '').trim().toLowerCase() === 'true';
}

const DEFAULT_BATCH = 25;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

/*
 * resolveRecipients — one People-Master read for the whole batch, via the
 * canonical merge helper (work_email -> personal_email -> account email;
 * employment_status 'active'; full_name). Returns
 * Map<EMPLOYEE_CODE, { email, active, name }>. Callers use `email`/`active`
 * for the recipient gate and `name` to humanise the rendered payload.
 */
async function resolveRecipients(codes) {
  const out = new Map();
  const want = codes.map(up).filter(Boolean);
  if (!want.length) return out;
  let contacts = {};
  try {
    const { resolveEmployeeContacts } = require('./employee-master');
    contacts = await resolveEmployeeContacts(want);
  } catch (_e) { contacts = {}; }
  for (const code of want) {
    const c = contacts[code] || { email: '', active: false, name: '' };
    const email = String(c.email || '').trim().toLowerCase();
    out.set(code, { email: EMAIL_RE.test(email) ? email : '', active: !!c.active, name: String(c.name || '').trim() });
  }
  return out;
}

// Payload keys that carry a bare employee code the templates want to render as
// a human name. For each `<x>_employee_code` present in a claimed row's payload
// the drainer injects `<x>_name` (canonical display name, or '' -> the template
// falls back to the code). Purely presentational — no business decision, no
// change to who the mail goes to.
const NAME_PAYLOAD_KEYS = Object.freeze([
  'assigner', 'primary', 'creator', 'recipient', 'from', 'actor',
]);

function collectPayloadPersonCodes(rows) {
  const set = new Set();
  for (const r of rows) {
    const p = (r && r.payload) || {};
    for (const k of NAME_PAYLOAD_KEYS) {
      const c = up(p[k + '_employee_code']);
      if (c) set.add(c);
    }
  }
  return set;
}

function enrichPayloadNames(payload, contactMap) {
  for (const k of NAME_PAYLOAD_KEYS) {
    const code = up(payload[k + '_employee_code']);
    if (!code) continue;
    const hit = contactMap.get(code);
    payload[k + '_name'] = (hit && hit.name) || '';
  }
  return payload;
}

async function runMailDrain(options = {}) {
  const summary = {
    enabled: isMailV1Enabled(),
    bridgeEnabled: isMailBridgeEnabled(),
    providerConfigured: isProviderConfigured(),
    claimed: 0, sent: 0, skipped: 0, failed: 0, details: [],
  };
  if (!summary.enabled) { summary.note = 'PHF_TASK_MAIL_V1_ENABLED != true'; return summary; }
  if (!summary.bridgeEnabled) { summary.note = 'PHF_TASK_WRITE_BRIDGE_ENABLED != true'; return summary; }
  if (!summary.providerConfigured) { summary.note = 'Brevo provider not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL)'; return summary; }

  const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_BATCH;
  const claim = await bridgeClaimMailOutbox(limit);
  const rows = (claim && claim.claimed) || [];
  summary.claimed = rows.length;
  if (!rows.length) return summary;

  // WEEKLY_REPORT rows carry their address in payload.to and are NOT People
  // Master employees — resolve emails only for the transactional rows. One
  // People-Master read covers BOTH the recipient gate and the display-name
  // enrichment of every person code referenced in a payload.
  const transactionalRows = rows.filter((r) => r.template_key !== 'WEEKLY_REPORT');
  const lookupCodes = new Set(transactionalRows.map((r) => up(r.recipient_employee_code)));
  for (const c of collectPayloadPersonCodes(transactionalRows)) lookupCodes.add(c);
  const recipientMap = await resolveRecipients([...lookupCodes]);
  const marks = [];

  for (const r of rows) {
    // ---- Increment 2: weekly report — pre-rendered snapshot, send verbatim ----
    if (r.template_key === 'WEEKLY_REPORT') {
      const to = String((r.payload && r.payload.to) || '').trim().toLowerCase();
      const subject = String((r.payload && r.payload.subject) || '');
      const html = String((r.payload && r.payload.html) || '');
      if (!EMAIL_RE.test(to) || !subject || !html) {
        marks.push({ id: r.id, outcome: 'skipped', reason: 'weekly_payload_incomplete' });
        summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'weekly_payload_incomplete' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const wr = await sendTransactionalEmail({ to, subject, html });
      if (wr.ok) {
        marks.push({ id: r.id, outcome: 'sent' });
        summary.sent += 1; summary.details.push({ id: r.id, outcome: 'sent', kind: 'weekly' });
      } else if (wr.permanent) {
        marks.push({ id: r.id, outcome: 'skipped', reason: 'permanent:' + wr.error });
        summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'permanent', kind: 'weekly' });
      } else {
        marks.push({ id: r.id, outcome: 'failed', reason: wr.error });
        summary.failed += 1; summary.details.push({ id: r.id, outcome: 'failed', reason: wr.error, kind: 'weekly' });
      }
      continue;
    }

    const code = up(r.recipient_employee_code);
    const rec = recipientMap.get(code) || { email: '', active: false };

    if (!rec.active) {
      marks.push({ id: r.id, outcome: 'skipped', reason: 'inactive_employee:' + code });
      summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'inactive_employee' });
      continue;
    }
    if (!rec.email) {
      marks.push({ id: r.id, outcome: 'skipped', reason: 'no_valid_email:' + code });
      summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'no_valid_email' });
      continue;
    }

    const payload = enrichPayloadNames(
      Object.assign({}, r.payload || {}, { task_id: r.task_id }),
      recipientMap
    );
    const rendered = renderTaskMail({ templateKey: r.template_key, payload });
    if (!rendered) {
      marks.push({ id: r.id, outcome: 'skipped', reason: 'template_missing:' + r.template_key });
      summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'template_missing' });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await sendTransactionalEmail({ to: rec.email, subject: rendered.subject, html: rendered.html });
    if (result.ok) {
      marks.push({ id: r.id, outcome: 'sent' });
      summary.sent += 1; summary.details.push({ id: r.id, outcome: 'sent' });
    } else if (result.permanent) {
      marks.push({ id: r.id, outcome: 'skipped', reason: 'permanent:' + result.error });
      summary.skipped += 1; summary.details.push({ id: r.id, outcome: 'skipped', reason: 'permanent' });
    } else {
      marks.push({ id: r.id, outcome: 'failed', reason: result.error });
      summary.failed += 1; summary.details.push({ id: r.id, outcome: 'failed', reason: result.error });
    }
  }

  if (marks.length) {
    try { await bridgeMarkMailOutboxBatch(marks); }
    catch (err) {
      // Marks failed to persist — the leased rows will re-claim after the stale
      // lease window; sent mail may re-send ONCE at worst. Log & surface.
      summary.markError = (err && err.message) || 'mark_batch_failed';
    }
  }
  return summary;
}

module.exports = { runMailDrain, isMailV1Enabled, resolveRecipients };
