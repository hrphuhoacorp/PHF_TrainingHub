'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 — provider abstraction (Brevo-compatible).
 *
 * ONE responsibility: given a fully-rendered message { to, subject, html },
 * hand it to the transactional email provider and return a normalised result
 *   { ok: true, providerMessageId }  |  { ok: false, error, permanent }
 *
 * FAIL SAFE — this module NEVER throws. A missing API key, a network error, a
 * 4xx/5xx from Brevo — all become { ok: false }. The drainer records that on
 * the outbox row (attempt_count/last_error) and moves on; the business event
 * is long committed and untouched.
 *
 * Env (Vercel):
 *   BREVO_API_KEY        required to actually send; absent -> { ok:false, error:'no_api_key' }
 *   BREVO_SENDER_EMAIL   required; the verified sender identity
 *   BREVO_SENDER_NAME    optional display name (default 'PHF Task')
 *
 * No secret is ever logged or returned. Brevo transactional endpoint:
 *   POST https://api.brevo.com/v3/smtp/email   header: api-key: <BREVO_API_KEY>
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10000;

function providerConfig() {
  return {
    apiKey: String(process.env.BREVO_API_KEY || '').trim(),
    senderEmail: String(process.env.BREVO_SENDER_EMAIL || '').trim(),
    senderName: String(process.env.BREVO_SENDER_NAME || 'PHF Task').trim() || 'PHF Task',
  };
}

// isConfigured — the drainer checks this before claiming a batch so it does not
// burn outbox attempts when the provider simply is not set up yet.
function isProviderConfigured() {
  const c = providerConfig();
  return Boolean(c.apiKey && c.senderEmail);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * sendTransactionalEmail({ to, subject, html }) -> Promise<result>
 * `to` is a single email string (V1 transactional mail is 1 recipient/row).
 */
async function sendTransactionalEmail(message) {
  const c = providerConfig();
  const to = String((message && message.to) || '').trim();
  const subject = String((message && message.subject) || '').trim();
  const html = String((message && message.html) || '');

  if (!c.apiKey || !c.senderEmail) {
    return { ok: false, error: 'provider_not_configured', permanent: false };
  }
  if (!EMAIL_RE.test(to)) {
    return { ok: false, error: 'recipient_email_invalid', permanent: true };
  }
  if (!subject || !html) {
    return { ok: false, error: 'message_incomplete', permanent: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': c.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: c.senderEmail, name: c.senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: controller.signal,
    });
    let body = null;
    try { body = await resp.json(); } catch (_e) { /* body may be empty on 2xx */ }
    if (resp.ok) {
      return { ok: true, providerMessageId: (body && (body.messageId || body.messageIds)) || null };
    }
    // 4xx (except 429) = permanent for this message; 429/5xx = retryable.
    const permanent = resp.status >= 400 && resp.status < 500 && resp.status !== 429;
    const code = (body && (body.code || body.message)) || ('http_' + resp.status);
    return { ok: false, error: String(code).slice(0, 500), permanent };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, error: 'provider_timeout', permanent: false };
    return { ok: false, error: 'provider_unreachable:' + (err && err.message ? err.message.slice(0, 200) : ''), permanent: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isProviderConfigured, sendTransactionalEmail, providerConfig };
