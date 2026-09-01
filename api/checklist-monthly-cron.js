'use strict';

// PHF — SHARED CRON Vercel function (Hobby 12-function budget).
//
// Hosts TWO unrelated cron entrypoints in ONE serverless function to stay under
// the Vercel Hobby serverless-functions-per-deployment limit. Public URLs are
// unchanged; only the physical function file is shared. Each route keeps its
// OWN Bearer secret, its OWN system session, and its OWN error contract —
// nothing is merged except the file.
//
//   GET/POST /api/checklist-monthly-cron       secret: CHECKLIST_CRON_SECRET
//        -> syncMonthlyCycle(session, { month, automatic:true })
//
//   GET/POST /api/task-recurrence-cron         secret: TASK_RECURRENCE_CRON_SECRET
//        (vercel.json rewrites -> this file with ?__phf_cron=task-recurrence)
//        -> runTaskRecurrence(session, {})   [api/_lib/task-recurrence-actions.js —
//           People active-set resolution, RECURRENCE_ACTIVE_SET_EMPTY fail-closed,
//           the recurrence bridge and the Company PostgreSQL engine are untouched]
//
// Dispatch is by route marker only (query flag from the rewrite, or the literal
// path when hit directly). No business logic here.

const { syncMonthlyCycle } = require('./_lib/checklist-monthly');
const { runTaskRecurrence } = require('./_lib/task-recurrence-actions');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isTaskRecurrenceRoute(req) {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.searchParams.get('__phf_cron') === 'task-recurrence') return true;
    if (u.pathname === '/api/task-recurrence-cron') return true;
    return false;
  } catch (_e) {
    return false;
  }
}

// ---- /api/checklist-monthly-cron — unchanged from the former standalone file ----
async function handleChecklistMonthlyCron(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { ok: false, message: 'Method not allowed' });
  const expected = String(process.env.CHECKLIST_CRON_SECRET || '').trim();
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || auth !== expected) return send(res, 401, { ok: false, message: 'Cron secret không hợp lệ.' });
  try {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date()).replace('/', '-');
    const session = { role: 'admin', sub: 'system-checklist-cron', account: { id: 'system-checklist-cron', name: 'PHF Checklist Scheduler', employeeCode: 'SYSTEM' } };
    const result = await syncMonthlyCycle(session, { month, automatic: true });
    return send(res, 200, { ok: true, month, ...result });
  } catch (error) {
    console.error('[PHF Checklist cron]', error);
    return send(res, 500, { ok: false, message: (error && error.message) || 'Không thể đồng bộ kỳ tự động.' });
  }
}

// ---- /api/task-recurrence-cron — unchanged from the former standalone file ----
async function handleTaskRecurrenceCron(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { ok: false, message: 'Method not allowed' });
  const expected = String(process.env.TASK_RECURRENCE_CRON_SECRET || '').trim();
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || provided !== expected) return send(res, 401, { ok: false, message: 'Cron secret không hợp lệ.' });
  try {
    // Must resolve to actorType='admin' via api/_lib/task-employee-scope.js
    // resolveActorContext: account.role === 'admin' + a non-empty account.id.
    const session = {
      role: 'admin',
      sub: 'system-task-recurrence-cron',
      account: {
        id: 'system-task-recurrence-cron',
        role: 'admin',
        name: 'PHF Task Recurrence Scheduler',
        employeeCode: 'SYSTEM'
      }
    };
    const result = await runTaskRecurrence(session, {});
    return send(res, 200, { ok: true, result });
  } catch (error) {
    console.error('[PHF Task recurrence cron]', (error && error.code) || '', (error && error.message) || error);
    const status = Number.isInteger(error && error.statusCode)
      ? error.statusCode
      : (Number.isInteger(error && error.status) ? error.status : 500);
    return send(res, status, {
      ok: false,
      code: (error && error.code) || undefined,
      message: (error && error.message) || 'Không thể chạy sinh phiếu lịch lặp.'
    });
  }
}

module.exports = async function handler(req, res) {
  return isTaskRecurrenceRoute(req)
    ? handleTaskRecurrenceCron(req, res)
    : handleChecklistMonthlyCron(req, res);
};
