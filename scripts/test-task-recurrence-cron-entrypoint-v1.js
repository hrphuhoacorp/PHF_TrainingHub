'use strict';

/*
 * PHF Task — RECURRENCE V1 cron entrypoint (api/task-recurrence-cron.js) test.
 *
 * MOCK ONLY. api/_lib/task-recurrence-actions.js is replaced via require.cache
 * before loading the handler. No DB, no phf-hr-api, no network, no engine.
 *
 * Proves:
 *   A. env secret missing            -> 401, runTaskRecurrence NOT called
 *   B. wrong Bearer                   -> 401, runTaskRecurrence NOT called
 *   C. unsupported method (PUT)       -> 405, runTaskRecurrence NOT called
 *   D. correct Bearer (GET and POST)  -> delegates to runTaskRecurrence(session,{}),
 *                                        200 { ok:true, result }
 *   E. handler source calls ONLY runTaskRecurrence — never generateDue,
 *      bridgeRunRecurrence, task-recurrence-bridge, or a pg client
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
const handlerPath = require.resolve(path.join(ROOT, 'api', 'task-recurrence-cron'));
const actionsPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-recurrence-actions'));
const scopePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-employee-scope'));

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

const SECRET = 'test-only-not-a-real-secret';

function loadHandler(runImpl) {
  delete require.cache[handlerPath];
  delete require.cache[actionsPath];
  const calls = [];
  require.cache[actionsPath] = {
    id: actionsPath, filename: actionsPath, loaded: true,
    exports: {
      runTaskRecurrence: async (session, options) => {
        calls.push({ session, options });
        return runImpl(session, options);
      }
    }
  };
  const handler = require(handlerPath);
  return { handler, calls };
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

async function invoke(handler, { method = 'POST', bearer } = {}) {
  const req = { method, headers: {} };
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

  // ---- E. handler source: no direct engine / bridge / pg calls ----
  {
    const src = fs.readFileSync(handlerPath, 'utf8');
    const codeSrc = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
    check('E calls runTaskRecurrence', /runTaskRecurrence\s*\(/.test(codeSrc));
    check('E no generateDue', !/generateDue/.test(codeSrc));
    check('E no bridgeRunRecurrence', !/bridgeRunRecurrence/.test(codeSrc));
    check('E no task-recurrence-bridge require', !/task-recurrence-bridge/.test(codeSrc));
    check('E no task-recurrence engine require', !/require\(['"][^'"]*task-recurrence['"]\)/.test(codeSrc));
    check('E no pg client', !/require\(['"]pg['"]\)/.test(codeSrc) && !/new\s+Client\s*\(/.test(codeSrc) && !/new\s+Pool\s*\(/.test(codeSrc));
    check('E no /v1/task/recurrence:run string', !/v1\/task\/recurrence:run/.test(codeSrc));
    const localRequires = (codeSrc.match(/require\(['"]\.[^'"]+['"]\)/g) || []);
    check('E only local require is ./_lib/task-recurrence-actions',
      localRequires.length === 1 && /task-recurrence-actions/.test(localRequires[0]), localRequires);
    check('E reads TASK_RECURRENCE_CRON_SECRET', /TASK_RECURRENCE_CRON_SECRET/.test(codeSrc));
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
    // must mirror the literal in api/task-recurrence-cron.js
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
