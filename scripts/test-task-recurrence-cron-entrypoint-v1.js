'use strict';

/*
 * PHF Task — RECURRENCE V1 cron entrypoint test.
 *
 * 1.66.8: the endpoint was consolidated into the shared cron function
 * api/checklist-monthly-cron.js; the public route /api/task-recurrence-cron is
 * kept by a vercel.json rewrite that appends ?__phf_cron=task-recurrence. This
 * test drives the combined handler through that exact rewritten route.
 *
 * MOCK ONLY. api/_lib/task-recurrence-actions.js AND api/_lib/checklist-monthly.js
 * are replaced via require.cache before loading the handler. No DB, no
 * phf-hr-api, no network, no engine.
 *
 * Proves:
 *   A. env secret missing            -> 401, runTaskRecurrence NOT called
 *   B. wrong Bearer                   -> 401, runTaskRecurrence NOT called
 *   C. unsupported method (PUT)       -> 405, runTaskRecurrence NOT called
 *   D. correct Bearer (GET and POST)  -> delegates to runTaskRecurrence(session,{}),
 *                                        200 { ok:true, result }
 *   E. combined handler: recurrence branch is a thin delegate — never
 *      generateDue / bridgeRunRecurrence / recurrence engine / pg client;
 *      exactly the two action-layer local requires; both secrets distinct
 *   E2. the checklist-monthly route on the same function still works via
 *       syncMonthlyCycle + CHECKLIST_CRON_SECRET (unweakened)
 *   E3/E4. cross-secret isolation — neither secret opens the other route
 *   F. runTaskRecurrence throws (statusCode 409) -> NOT a fake success:
 *      body.ok === false, status propagated
 *   G. the synthesised session resolves to actorType='admin' through the REAL
 *      api/_lib/task-employee-scope.js resolveActorContext (admin short-circuit,
 *      no DB)
 *   H. secret never appears in the response body
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 1.66.8: api/task-recurrence-cron.js was consolidated into the shared cron
// function api/checklist-monthly-cron.js (Vercel Hobby 12-function budget).
// The public route /api/task-recurrence-cron is preserved by a vercel.json
// rewrite that appends ?__phf_cron=task-recurrence — this test drives the
// combined handler through exactly that rewritten route.
const handlerPath = require.resolve(path.join(ROOT, 'api', 'checklist-monthly-cron'));
const actionsPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-recurrence-actions'));
const checklistMonthlyPath = require.resolve(path.join(ROOT, 'api', '_lib', 'checklist-monthly'));
const scopePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-employee-scope'));
const RECURRENCE_ROUTE_URL = '/api/checklist-monthly-cron?__phf_cron=task-recurrence';

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

const SECRET = 'test-only-not-a-real-secret';

function loadHandler(runImpl) {
  delete require.cache[handlerPath];
  delete require.cache[actionsPath];
  delete require.cache[checklistMonthlyPath];
  const calls = [];
  const checklistCalls = [];
  require.cache[actionsPath] = {
    id: actionsPath, filename: actionsPath, loaded: true,
    exports: {
      runTaskRecurrence: async (session, options) => {
        calls.push({ session, options });
        return runImpl(session, options);
      }
    }
  };
  // the shared cron file also requires ./_lib/checklist-monthly at module top —
  // stub it so this test never pulls the Checklist stack / DB.
  require.cache[checklistMonthlyPath] = {
    id: checklistMonthlyPath, filename: checklistMonthlyPath, loaded: true,
    exports: { syncMonthlyCycle: async (s, o) => { checklistCalls.push({ s, o }); return { synced: true }; } }
  };
  const handler = require(handlerPath);
  return { handler, calls, checklistCalls };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s; }
  };
}

async function invoke(handler, { method = 'POST', bearer, url = RECURRENCE_ROUTE_URL } = {}) {
  const req = { method, headers: {}, url };
  if (bearer !== undefined) req.headers.authorization = 'Bearer ' + bearer;
  const res = mockRes();
  await handler(req, res);
  let json;
  try { json = JSON.parse(res.body); } catch (_e) { json = null; }
  return { res, json };
}

(async () => {
  // ---- A. env secret missing -> 401 ----
  {
    delete process.env.TASK_RECURRENCE_CRON_SECRET;
    const { handler, calls } = loadHandler(() => ({ ok: 1 }));
    const { res, json } = await invoke(handler, { bearer: 'anything' });
    check('A env-secret-missing -> 401', res.statusCode === 401, res.statusCode);
    check('A runTaskRecurrence not called', calls.length === 0);
    check('A body ok:false', json && json.ok === false);
  }

  process.env.TASK_RECURRENCE_CRON_SECRET = SECRET;

  // ---- B. wrong Bearer -> 401 ----
  {
    const { handler, calls } = loadHandler(() => ({ ok: 1 }));
    const { res } = await invoke(handler, { bearer: 'wrong-secret' });
    check('B wrong-bearer -> 401', res.statusCode === 401, res.statusCode);
    check('B runTaskRecurrence not called', calls.length === 0);
  }

  // ---- B2. missing Authorization header entirely -> 401 ----
  {
    const { handler, calls } = loadHandler(() => ({ ok: 1 }));
    const { res } = await invoke(handler, { bearer: undefined });
    check('B2 no-auth-header -> 401', res.statusCode === 401, res.statusCode);
    check('B2 runTaskRecurrence not called', calls.length === 0);
  }

  // ---- C. unsupported method -> 405 ----
  {
    const { handler, calls } = loadHandler(() => ({ ok: 1 }));
    const { res } = await invoke(handler, { method: 'PUT', bearer: SECRET });
    check('C PUT -> 405', res.statusCode === 405, res.statusCode);
    check('C runTaskRecurrence not called', calls.length === 0);
  }

  // ---- D. correct Bearer, POST -> delegates ----
  {
    const fakeResult = { generated: 3, rulesConsidered: 5, occurrences: [] };
    const { handler, calls } = loadHandler(() => fakeResult);
    const { res, json } = await invoke(handler, { method: 'POST', bearer: SECRET });
    check('D POST -> 200', res.statusCode === 200, res.statusCode);
    check('D runTaskRecurrence called exactly once', calls.length === 1, calls.length);
    check('D delegated with empty options {}', calls[0] && JSON.stringify(calls[0].options) === '{}', calls[0] && calls[0].options);
    check('D body ok:true', json && json.ok === true);
    check('D body carries result verbatim', json && JSON.stringify(json.result) === JSON.stringify(fakeResult), json && json.result);
    check('D Content-Type json', res.headers['content-type'] === 'application/json; charset=utf-8');
    check('D Cache-Control no-store', res.headers['cache-control'] === 'no-store');
  }

  // ---- D2. correct Bearer, GET -> delegates ----
  {
    const { handler, calls } = loadHandler(() => ({ generated: 0 }));
    const { res, json } = await invoke(handler, { method: 'GET', bearer: SECRET });
    check('D2 GET -> 200', res.statusCode === 200, res.statusCode);
    check('D2 runTaskRecurrence called', calls.length === 1);
    check('D2 body ok:true', json && json.ok === true);
  }

  // ---- E. shared-cron handler source: recurrence path stays a thin delegate,
  //         no direct engine / bridge / pg calls ----
  {
    const src = fs.readFileSync(handlerPath, 'utf8');
    const codeSrc = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
    check('E calls runTaskRecurrence', /runTaskRecurrence\s*\(/.test(codeSrc));
    check('E no generateDue', !/generateDue/.test(codeSrc));
    check('E no bridgeRunRecurrence', !/bridgeRunRecurrence/.test(codeSrc));
    check('E no task-recurrence-bridge require', !/task-recurrence-bridge/.test(codeSrc));
    check('E no recurrence engine require', !/require\(['"][^'"]*task-recurrence(-datemath)?['"]\)/.test(codeSrc));
    check('E no pg client', !/require\(['"]pg['"]\)/.test(codeSrc) && !/new\s+Client\s*\(/.test(codeSrc) && !/new\s+Pool\s*\(/.test(codeSrc));
    check('E no /v1/task/recurrence:run string', !/v1\/task\/recurrence:run/.test(codeSrc));
    // the shared cron file legitimately has exactly two local requires:
    // the recurrence action layer + the checklist-monthly action layer.
    const localRequires = (codeSrc.match(/require\(['"]\.[^'"]+['"]\)/g) || []).sort();
    check('E local requires are exactly the two action layers',
      localRequires.length === 2
        && /task-recurrence-actions/.test(localRequires.join())
        && /checklist-monthly/.test(localRequires.join()),
      localRequires);
    check('E recurrence branch reads TASK_RECURRENCE_CRON_SECRET', /TASK_RECURRENCE_CRON_SECRET/.test(codeSrc));
    check('E checklist branch still reads CHECKLIST_CRON_SECRET (unweakened)', /CHECKLIST_CRON_SECRET/.test(codeSrc));
    check('E the two secrets are never the same identifier',
      !/TASK_RECURRENCE_CRON_SECRET\s*\|\|\s*CHECKLIST_CRON_SECRET/.test(codeSrc)
      && !/CHECKLIST_CRON_SECRET\s*\|\|\s*TASK_RECURRENCE_CRON_SECRET/.test(codeSrc));
  }

  // ---- E2. checklist-monthly route on the SAME function is untouched ----
  {
    process.env.CHECKLIST_CRON_SECRET = 'checklist-only-not-a-real-secret';
    process.env.TASK_RECURRENCE_CRON_SECRET = SECRET;
    const { handler, calls, checklistCalls } = loadHandler(() => ({ generated: 9 }));
    // hit the checklist route (no __phf_cron marker) with the CHECKLIST secret
    const req = { method: 'POST', headers: { authorization: 'Bearer checklist-only-not-a-real-secret' }, url: '/api/checklist-monthly-cron' };
    const res = mockRes();
    await handler(req, res);
    const json = JSON.parse(res.body);
    check('E2 checklist route -> 200 via syncMonthlyCycle', res.statusCode === 200 && json.ok === true, res.statusCode);
    check('E2 syncMonthlyCycle called, runTaskRecurrence NOT', checklistCalls.length === 1 && calls.length === 0);
    check('E2 checklist route rejects the TASK secret', true); // covered by E3
  }

  // ---- E3. cross-secret isolation: task secret must NOT open checklist route ----
  {
    process.env.CHECKLIST_CRON_SECRET = 'checklist-only-not-a-real-secret';
    process.env.TASK_RECURRENCE_CRON_SECRET = SECRET;
    const { handler, calls, checklistCalls } = loadHandler(() => ({ generated: 1 }));
    const req = { method: 'POST', headers: { authorization: 'Bearer ' + SECRET }, url: '/api/checklist-monthly-cron' };
    const res = mockRes();
    await handler(req, res);
    check('E3 checklist route + task secret -> 401', res.statusCode === 401, res.statusCode);
    check('E3 neither action invoked', checklistCalls.length === 0 && calls.length === 0);
  }

  // ---- E4. reverse isolation: checklist secret must NOT open recurrence route ----
  {
    process.env.CHECKLIST_CRON_SECRET = 'checklist-only-not-a-real-secret';
    process.env.TASK_RECURRENCE_CRON_SECRET = SECRET;
    const { handler, calls } = loadHandler(() => ({ generated: 1 }));
    const { res } = await invoke(handler, { method: 'POST', bearer: 'checklist-only-not-a-real-secret' });
    check('E4 recurrence route + checklist secret -> 401', res.statusCode === 401, res.statusCode);
    check('E4 runTaskRecurrence not called', calls.length === 0);
  }

  // ---- F. runTaskRecurrence throws -> no fake success ----
  {
    const { handler } = loadHandler(() => {
      const e = new Error('Không resolve được danh sách nhân sự đang làm việc.');
      e.statusCode = 409; e.code = 'RECURRENCE_ACTIVE_SET_EMPTY';
      throw e;
    });
    const { res, json } = await invoke(handler, { method: 'POST', bearer: SECRET });
    check('F error not swallowed to success', json && json.ok === false, json);
    check('F statusCode propagated (409)', res.statusCode === 409, res.statusCode);
    check('F error code surfaced', json && json.code === 'RECURRENCE_ACTIVE_SET_EMPTY');
  }

  // ---- F2. error with no statusCode -> 500 ----
  {
    const { handler } = loadHandler(() => { throw new Error('boom'); });
    const { res, json } = await invoke(handler, { method: 'POST', bearer: SECRET });
    check('F2 bare error -> 500', res.statusCode === 500, res.statusCode);
    check('F2 ok:false', json && json.ok === false);
  }

  // ---- G. synthesised session resolves to actorType='admin' (REAL resolver) ----
  {
    delete require.cache[actionsPath];
    delete require.cache[scopePath];
    const { resolveActorContext } = require(scopePath);
    // must mirror the recurrence-branch literal in api/checklist-monthly-cron.js
    const session = {
      role: 'admin',
      sub: 'system-task-recurrence-cron',
      account: { id: 'system-task-recurrence-cron', role: 'admin', name: 'PHF Task Recurrence Scheduler', employeeCode: 'SYSTEM' }
    };
    const ctx = await resolveActorContext(session);
    check('G resolveActorContext -> actorType admin', ctx && ctx.actorType === 'admin', ctx && ctx.actorType);
    check('G accountId non-empty', ctx && !!ctx.accountId, ctx && ctx.accountId);
    // and confirm the handler source embeds the same admin account.role
    const src = fs.readFileSync(handlerPath, 'utf8');
    check('G handler embeds account.role admin', /account\s*:\s*\{[\s\S]*role\s*:\s*'admin'/.test(src));
  }

  // ---- H. secret never leaks into any response body ----
  {
    process.env.TASK_RECURRENCE_CRON_SECRET = SECRET;
    const { handler } = loadHandler(() => ({ generated: 1 }));
    const bodies = [];
    for (const m of [{ method: 'PUT', bearer: SECRET }, { bearer: 'x' }, { method: 'POST', bearer: SECRET }]) {
      const { res } = await invoke(handler, m);
      bodies.push(res.body || '');
    }
    check('H secret absent from every response body', bodies.every((b) => !b.includes(SECRET)), bodies);
  }

  console.log('\n' + (FAIL === 0 ? 'ALL PASS' : 'FAIL') + '  (' + PASS + ' passed, ' + FAIL + ' failed)');
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
