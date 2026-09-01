'use strict';

// PHF Task — RECURRENCE V1 cron-safe entrypoint (MAIN PHF HR app).
//
// A VPS OS cron job cannot call services/phf-hr-api POST /v1/task/recurrence:run
// directly — phf_hr has no org/People data, so the ACTIVE employee set must be
// resolved in the MAIN app first (api/_lib/task-recurrence-actions.js). This
// endpoint is the thin HTTP shell around that action, mirroring the existing
// cron pattern in api/checklist-monthly-cron.js:
//   - GET or POST only
//   - own Bearer secret from env (TASK_RECURRENCE_CRON_SECRET)
//   - synthesises a system-admin session, then delegates to the SAME
//     runTaskRecurrence() the Admin UI uses — People active-set resolution,
//     RECURRENCE_ACTIVE_SET_EMPTY fail-closed, the recurrence bridge and the
//     Company PostgreSQL engine are all untouched and unbypassed
//   - never logs or echoes the secret
//
// No DB access, no schema, no migration, no engine change here.

const { runTaskRecurrence } = require('./_lib/task-recurrence-actions');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return send(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const expected = String(process.env.TASK_RECURRENCE_CRON_SECRET || '').trim();
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || provided !== expected) {
    return send(res, 401, { ok: false, message: 'Cron secret không hợp lệ.' });
  }

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
};
