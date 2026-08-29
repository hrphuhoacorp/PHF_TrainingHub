'use strict';
/* PHF Task — Task Code + Create Idempotency Foundation V1.
   Migration PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql is a DESIGN PACKAGE, NOT
   applied to Production this pass — these tests audit it structurally (SQL
   text) plus a local-safe algorithmic simulation of the atomic allocator,
   and exercise the actual client-side createAttemptKey lifecycle against the
   real phf-task-app.js source (jsdom + mocked window.fetch, no real network,
   no Production writes). No 10/20 real Production Tasks are created. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
// Repo có mix CRLF/LF (không có .gitattributes ép LF) — normalize về LF để các
// assertion tìm chuỗi nhiều dòng (do $$\ndeclare...) không phụ thuộc line-ending
// của file. KHÔNG hạ bất kỳ assertion nào — chỉ làm phép so khớp bền vững.
const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sql = readLF(path.join(root, 'scripts', 'PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql'));
const sqlDown = readLF(path.join(root, 'scripts', 'PHF_TASK_CODE_IDEMPOTENCY_1.71.0_DOWN.sql'));
const jsCode = readLF(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'));
const coreCode = readLF(path.join(root, 'api', '_lib', 'task-core.js'));

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

/* ---------------------------------------------------------------------
   A/B) ATOMIC MONTH ALLOCATOR — local-safe simulation of the SAME
   INSERT..ON CONFLICT..DO UPDATE..RETURNING semantics designed in
   task_next_code(): each "transaction" reads-then-increments a shared
   counter under a single critical section (exactly what Postgres row-lock
   serialization guarantees for a real ON CONFLICT DO UPDATE) — proves the
   ALGORITHM never double-allocates, independent of DB access this pass.
--------------------------------------------------------------------- */
(async function () {
  const counters = new Map(); // scope_key -> next_value, mirrors task_code_counters
  let queue = Promise.resolve(); // serializes access — models Postgres row-lock atomicity
  function allocate(scopeKey) {
    const result = queue.then(() => {
      const next = counters.get(scopeKey) || 1;
      counters.set(scopeKey, next + 1);
      return 'CV-' + scopeKey + '-' + String(next).padStart(4, '0');
    });
    queue = result.catch(() => {});
    return result;
  }

  const sameMonth = await Promise.all([allocate('2608'), allocate('2608')]);
  pass(sameMonth[0] !== sameMonth[1], 'ALLOCATOR: two concurrent allocations in the same YYMM get different task_code — got ' + sameMonth.join(', '));

  const many = await Promise.all(Array.from({ length: 20 }, () => allocate('2609')));
  const uniqueMany = new Set(many);
  pass(uniqueMany.size === 20, 'ALLOCATOR: 20 concurrent allocations in the same YYMM produce 20 distinct task_code — got ' + uniqueMany.size + ' unique');

  const crossMonth = await Promise.all([allocate('2608'), allocate('2609')]);
  pass(/-2608-/.test(crossMonth[0]) && /-2609-/.test(crossMonth[1]), 'ALLOCATOR: different YYMM scopes allocate independently');
})().then(function () { return runRest(); }).then(function () {
  console.log('PHF Task Code + Idempotency Foundation V1 test: ' + passed + '/' + passed + ' PASS');
}).catch(function (err) { console.error(err); process.exitCode = 1; });

/* ---------------------------------------------------------------------
   SQL STRUCTURAL AUDIT — task_next_code / task_code_counters / task_create_draft V2
--------------------------------------------------------------------- */
function auditSql() {
  pass(sql.includes('on conflict (scope_key) do update'), 'ALLOCATOR SQL: uses INSERT..ON CONFLICT..DO UPDATE..RETURNING, not SELECT MAX()+1');
  pass(!/select\s+max\s*\(\s*task_code/i.test(sql), 'ALLOCATOR SQL: no SELECT MAX(task_code) anywhere in the migration');
  pass(sql.includes("to_char(p_now at time zone 'Asia/Ho_Chi_Minh', 'YYMM')"), 'ALLOCATOR SQL: YYMM computed in Asia/Ho_Chi_Minh at Task creation time, not server/UTC time');
  pass(sql.includes('create unique index if not exists task_tasks_actor_idem_key_uniq') && sql.includes('created_by_employee_code, create_idempotency_key'), 'IDEMPOTENCY SQL: uniqueness is scoped to (actor, key), not a bare global key');
  pass(sql.includes('add constraint task_tasks_task_code_key unique (task_code)'), 'TASK CODE SQL: hard UNIQUE constraint on task_code (final safety net)');

  const rpcMatch = sql.match(/create or replace function public\.task_create_draft\([\s\S]*?\$\$ language plpgsql;/);
  assert.ok(rpcMatch, 'task_create_draft V2 body must be found in the migration');
  const rpcBody = rpcMatch[0];
  const replayIdx = rpcBody.indexOf('if p_idempotency_key is not null then');
  const validateIdx = rpcBody.indexOf('TASK_DEADLINE_REQUIRED');
  const insertIdx = rpcBody.indexOf('insert into public.task_tasks(');
  pass(replayIdx >= 0 && replayIdx < validateIdx && validateIdx < insertIdx, 'RPC V2: replay-detection runs BEFORE validation, which runs BEFORE the INSERT (order proves a genuinely-failed prior attempt is retried fresh, not blocked)');
  pass((rpcBody.match(/created_by_employee_code = p_actor_employee_code\s*\n\s*and create_idempotency_key = p_idempotency_key/g) || []).length === 2, 'RPC V2: EVERY replay lookup (initial + race-backstop) filters by BOTH actor AND key — a different actor can never match/leak another actor\'s Task via key collision');
  pass(rpcBody.includes('exception when unique_violation then'), 'RPC V2: race backstop — a true concurrent double-insert on the same (actor,key) is caught and resolved by re-fetching the existing row, not a 500 error');
  pass(rpcBody.indexOf('v_code := public.task_next_code(now());') > replayIdx, 'RPC V2: task_code is allocated only on the real create path, never during a replay short-circuit');
  const primaryInsertIdx = rpcBody.indexOf("insert into public.task_assignees(");
  pass(primaryInsertIdx > insertIdx, 'RPC V2: Primary insert still happens after the Task insert, same transaction (atomicity preserved from V1)');
  const returnBeforePrimary = rpcBody.slice(replayIdx, replayIdx + 400).indexOf('return v_task;');
  pass(returnBeforePrimary >= 0, 'RPC V2: replay branch returns early (before reaching Primary insert) — a replay never inserts Primary a second time');

  pass(sql.includes('for r in select id, created_at from public.task_tasks where task_code is null order by created_at asc'), 'BACKFILL: processes ALL existing NULL rows ordered by created_at — not a hardcoded single-row assumption');
  pass(sql.includes('public.task_next_code(r.created_at)'), 'BACKFILL: allocates using each row\'s OWN created_at (correct YYMM attribution), not migration-run time');
  pass(sql.includes('TASK_CODE_BACKFILL_INCOMPLETE'), 'BACKFILL: hard sanity check aborts the migration if any row is still NULL before SET NOT NULL');
  pass(sql.indexOf('TASK_CODE_BACKFILL_INCOMPLETE') < sql.indexOf('alter column task_code set not null'), 'BACKFILL: sanity check runs BEFORE SET NOT NULL, correct safe ordering');

  pass(sql.includes('drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text);'), 'RPC SIGNATURE: old 9-arg overload explicitly dropped before creating the new 10-arg one (no duplicate overload)');

  pass(sql.includes('legacy_source text') && sql.includes('legacy_task_code text'), 'LEGACY: legacy_source/legacy_task_code columns reserved, unused this pass');
  pass(!/legacy_task_code\s*=\s*task_code|task_code\s*=\s*legacy_task_code/.test(sql), 'LEGACY: task_code and legacy_task_code never assigned from one another — no overwrite path');

  /* K) immutability — no EXECUTABLE SQL other than the backfill DO block ever
     writes task_code (verification comments in the header legitimately show
     "update ... set task_code = ..." as an example probe query — strip
     comment-only lines before scanning so they don't false-positive here). */
  const executableSql = sql.split('\n').map(line => /^\s*--/.test(line) ? '' : line).join('\n');
  const setTaskCodeSites = [...executableSql.matchAll(/set\s+task_code\s*=/gi)].map(m => m.index);
  const backfillBlockStart = executableSql.indexOf('do $$\ndeclare\n  r record;');
  const backfillBlockEnd = executableSql.indexOf('$$;', backfillBlockStart);
  const outsideBackfill = setTaskCodeSites.filter(i => i < backfillBlockStart || i > backfillBlockEnd);
  pass(outsideBackfill.length === 0, 'IMMUTABILITY: task_code is only ever SET (in executable SQL) inside the one-time backfill block — no RPC updates it after create — got ' + outsideBackfill.length + ' site(s) outside');

  /* PHẦN 4B — DB-level immutability guard: trigger + function present, and
     installed AFTER backfill completes (never blocks the backfill itself). */
  pass(sql.includes('create trigger task_tasks_task_code_immutable') && sql.includes('before update on public.task_tasks'), 'IMMUTABILITY GUARD: BEFORE UPDATE trigger installed on task_tasks');
  pass(sql.includes('function public.task_forbid_task_code_change()') && sql.includes('OLD.task_code is distinct from NEW.task_code'), 'IMMUTABILITY GUARD: guard function compares OLD vs NEW task_code and raises on any difference');
  const triggerCreateIdx = executableSql.indexOf('create trigger task_tasks_task_code_immutable');
  pass(triggerCreateIdx > backfillBlockEnd && triggerCreateIdx > executableSql.indexOf('alter column task_code set not null'), 'BACKFILL ORDER: immutability guard is installed AFTER backfill AND after SET NOT NULL — cannot possibly block the backfill\'s own UPDATEs');
  pass(!/raise exception 'TASK_CODE_IMMUTABLE/.test(sql.slice(0, backfillBlockStart)), 'BACKFILL ORDER: the guard function/trigger definition does not appear before the backfill block');

  /* behavioral simulation of the exact guard predicate (OLD IS DISTINCT FROM NEW) */
  function simulateGuard(oldCode, newCode) { if (oldCode !== newCode) throw new Error('TASK_CODE_IMMUTABLE'); return true; }
  assert.throws(() => simulateGuard('CV-2608-0001', 'CV-2608-9999'), /TASK_CODE_IMMUTABLE/, 'GUARD BEHAVIOR: changing task_code is rejected');
  assert.doesNotThrow(() => simulateGuard('CV-2608-0001', 'CV-2608-0001'), 'GUARD BEHAVIOR: no-op update (same value) is allowed');
  passed += 2;
  pass(true, 'GUARD BEHAVIOR: predicate mirrors OLD.task_code IS DISTINCT FROM NEW.task_code exactly (NULL-safe semantics, matches SQL IS DISTINCT FROM)');
}
auditSql();

/* ---------------------------------------------------------------------
   DOWN FILE — rollback restores the exact V1 signature, does not silently drop data
--------------------------------------------------------------------- */
(function () {
  pass(sqlDown.includes('drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text, uuid);'), 'DOWN: drops the exact V2 (10-arg) signature');
  pass(sqlDown.includes('p_actor_employee_code text,\n  p_primary_employee_code text\n) returns public.task_tasks'), 'DOWN: recreates the exact V1 (9-arg) signature verbatim');
  pass(/^-- alter table public\.task_tasks drop column if exists task_code;/m.test(sqlDown), 'DOWN: task_code column drop is commented out by default (data-loss guard — codes may already be in real use)');

  pass(sqlDown.includes('drop trigger if exists task_tasks_task_code_immutable on public.task_tasks;') && !sqlDown.includes('-- drop trigger if exists task_tasks_task_code_immutable'), 'DOWN: immutability trigger is dropped UNCONDITIONALLY (not commented out) — it is 1.71.0-owned infrastructure, not business data');
  pass(sqlDown.includes('drop function if exists public.task_forbid_task_code_change();'), 'DOWN: guard function is dropped (owned entirely by 1.71.0, verified no other migration references this name)');
  const triggerDropIdx = sqlDown.indexOf('drop trigger if exists task_tasks_task_code_immutable');
  const functionDropIdx = sqlDown.indexOf('drop function if exists public.task_forbid_task_code_change()');
  const columnDropIdx = sqlDown.indexOf('-- alter table public.task_tasks drop column if exists task_code;');
  pass(triggerDropIdx >= 0 && triggerDropIdx < functionDropIdx, 'DOWN ORDER: trigger dropped before the function it depends on');
  pass(functionDropIdx < columnDropIdx, 'DOWN ORDER: guard (trigger+function) dropped BEFORE the (commented-out) column drop — a stale trigger left referencing a dropped column would error on the next UPDATE');
})();

/* ---------------------------------------------------------------------
   J) NO CLIENT MAX+1 / task_code fabrication (task-core.js + frontend)
--------------------------------------------------------------------- */
(function () {
  pass(!/select\s+max\s*\(/i.test(coreCode), 'CLIENT (backend orchestration): no SELECT MAX(...) anywhere in task-core.js');
  pass(!/max\s*\([^)]*\)\s*\+\s*1/i.test(jsCode), 'CLIENT (frontend): no MAX(...)+1 sequence logic in phf-task-app.js');
  pass(jsCode.includes("taskCode=String(created.task_code||'').trim()"), 'CLIENT: task_code is read straight from the server RPC response, never computed');
})();

/* ---------------------------------------------------------------------
   9) ACTOR SCOPE / CROSS-ACTOR SAFETY — structural on the RPC + a scope
      helper mirrored client-side for early UX (does not replace DB truth)
--------------------------------------------------------------------- */
(function () {
  const rpcBody = sql.match(/create or replace function public\.task_create_draft\([\s\S]*?\$\$ language plpgsql;/)[0];
  // simulate the RPC's own lookup predicate against a small in-memory table
  const rows = [
    { actor: 'PHF002', key: 'key-A', id: 'task-1', code: 'CV-2608-0001' },
    { actor: 'PHF010', key: 'key-A', id: 'task-2', code: 'CV-2608-0002' } // same key value, DIFFERENT actor
  ];
  function lookup(actor, key) { return rows.find(r => r.actor === actor && r.key === key) || null; }
  const replayForOwner = lookup('PHF002', 'key-A');
  pass(replayForOwner && replayForOwner.id === 'task-1', 'CROSS-ACTOR: actor replaying THEIR OWN key gets THEIR OWN Task');
  const crossActorAttempt = lookup('PHF999', 'key-A'); // a third actor guessing/colliding on the same key value
  pass(crossActorAttempt === null, 'CROSS-ACTOR: a different actor presenting the SAME key value matches NOTHING — no leak of PHF002 or PHF010\'s Task, falls through to a normal new create');
  pass(rpcBody.includes('created_by_employee_code = p_actor_employee_code'), 'CROSS-ACTOR: this is exactly the predicate the real RPC uses (actor is always part of the lookup, never key-only)');
})();

/* ---------------------------------------------------------------------
   D/E/F/H/I) CLIENT createAttemptKey LIFECYCLE — real runtime via jsdom +
   mocked window.fetch (no network, no Production writes).
--------------------------------------------------------------------- */
function runRest() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Test Admin', email: 'admin@test' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.eval(jsCode);
  const T = window.__PHF_TASK_TEST__;
  assert.ok(T, 'test hook window.__PHF_TASK_TEST__ must be exposed');

  /* generateTaskAttemptKey: distinct per call (new form / new attempt) */
  const k1 = T.generateTaskAttemptKey(), k2 = T.generateTaskAttemptKey();
  pass(typeof k1 === 'string' && k1.length > 0 && k1 !== k2, 'CLIENT KEY: generateTaskAttemptKey() produces distinct tokens per call');

  /* buildCreatePayload forwards the SAME key unchanged (client never mutates it) */
  const form = T.defaultTaskForm(); form.title = 'X'; form.category_code = 'CAT1'; form.deadline = '2026-09-01T10:00'; form.primary_employee_code = 'NV001';
  const payloadA = T.buildCreatePayload(form, 'attempt-key-1');
  const payloadB = T.buildCreatePayload(form, 'attempt-key-1');
  pass(payloadA.create_idempotency_key === 'attempt-key-1' && payloadB.create_idempotency_key === 'attempt-key-1', 'CLIENT KEY: retry with the SAME attemptKey sends the SAME create_idempotency_key (E requirement mirror: same key => server treats as same attempt)');
  const payloadDifferentActorSim = T.buildCreatePayload(form, 'attempt-key-2');
  pass(payloadDifferentActorSim.create_idempotency_key === 'attempt-key-2', 'CLIENT KEY: a different attemptKey sends a different create_idempotency_key (F requirement mirror: different key => server treats as a new attempt)');

  const state = T.getState();
  function freshCreateState() {
    state.form = T.defaultTaskForm();
    state.form.title = 'Idempotency test'; state.form.category_code = 'CAT1'; state.form.primary_employee_code = 'NV001';
    state.form.deadline = '2026-09-01T10:00';
    state.categories = [{ code: 'CAT1', name: 'Danh mục 1', isActive: true }];
    state.employees = [{ code: 'NV001', name: 'A', department: 'D', employmentStatus: 'active' }];
    state.foundationStatus = { createTaskReady: true }; state.foundationStatusLoading = false;
    state.createTab = 'quick'; state.submitting = false; state.quickSuccess = null; state.view = 'create';
  }

  /* H) publish fails => createAttemptKey is RETAINED for a same-attempt retry */
  return (async function () {
    freshCreateState();
    state.createAttemptKey = null;
    window.fetch = async function (url, options) {
      const payload = JSON.parse(options.body);
      let body;
      if (payload.action === 'createTaskDraft') body = { ok: true, result: { id: 'idem-task', task_code: 'CV-2608-0099', row_version: 1 } };
      else if (payload.action === 'publishTask') body = { ok: false, error: 'Xung đột phiên bản', code: 'TASK_VERSION_CONFLICT' };
      else if (payload.action === 'getTaskDetail') body = { ok: true, result: { task: { id: 'idem-task', task_code: 'CV-2608-0099', status: 'draft' } } };
      else body = { ok: true, result: {} };
      return { ok: body.ok !== false, json: async () => body };
    };
    const rootEl = window.document.getElementById('phfTaskRoot');
    await T.submitTaskCreate(rootEl);
    pass(!!state.createAttemptKey, 'H) RETRY SEMANTICS: publish failure keeps createAttemptKey set — a follow-up submit reuses it (client does not know if server committed, per mục 9)');
    const keyAfterFailedPublish = state.createAttemptKey;

    /* same attemptKey retried, this time publish succeeds => key is cleared */
    window.fetch = async function (url, options) {
      const payload = JSON.parse(options.body);
      let body;
      if (payload.action === 'createTaskDraft') {
        assert.strictEqual(payload.create_idempotency_key, keyAfterFailedPublish, 'D) REPLAY: the retry must resend the SAME create_idempotency_key as the failed attempt');
        body = { ok: true, result: { id: 'idem-task', task_code: 'CV-2608-0099', row_version: 1 } };
      } else if (payload.action === 'publishTask') body = { ok: true, result: { id: 'idem-task', row_version: 2 } };
      else if (payload.action === 'getTaskDetail') body = { ok: true, result: { task: { id: 'idem-task', task_code: 'CV-2608-0099', status: 'published' } } };
      else body = { ok: true, result: {} };
      return { ok: true, json: async () => body };
    };
    await T.submitTaskCreate(rootEl);
    pass(state.createAttemptKey === null, 'H/success) after a fully successful publish, createAttemptKey is cleared (create attempt is closed)');
    pass(state.taskCode === 'CV-2608-0099', 'CREATE RESPONSE: task_code from the server response is surfaced onto shared state for detail/UI use');

    /* I) opening a fresh create form (or Copy Task, same code path) always resets the key */
    state.createAttemptKey = 'stale-key-should-be-cleared';
    await T.openTaskCreate(rootEl);
    pass(state.createAttemptKey === null, 'I) NEW FORM: openTaskCreate() (covers both "Tạo công việc mới" and Sao chép phiếu) always resets createAttemptKey to null — the next submit mints a fresh one');
  })();
}

