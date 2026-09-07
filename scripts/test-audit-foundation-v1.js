'use strict';
/*
 * PHF SYSTEM V1 — Nhật ký hệ thống (Audit Log) FOUNDATION V1 — OFFLINE checks.
 * No DB, no network. Migration applied to throwaway by the deployer
 * (scripts/deployer-apply-audit-v1-throwaway.sh); its append-only proof runs there.
 *
 *   node scripts/test-audit-foundation-v1.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  PASS', m); };

console.log('== MIGRATION — central store + append-only + least-privilege grants ==');
{
  const mig = rd('migrations/phf_hr_audit_v1.sql');
  ok(/\\set ON_ERROR_STOP on/.test(mig) && /BEGIN;/.test(mig) && /COMMIT;/.test(mig), 'transactional + ON_ERROR_STOP');
  ok(/SET ROLE phf_hr_owner/.test(mig) && /ROLE_NOT_ACTIVE/.test(mig), 'runs as phf_hr_owner with a role guard');
  ok(/CREATE SCHEMA IF NOT EXISTS audit/.test(mig), 'creates schema audit');
  ok(/CREATE TABLE audit\.entries/.test(mig), 'creates audit.entries');
  ['occurred_at','actor_account_id','actor_employee_code','actor_name','module','action',
   'object_type','object_id','object_label','result','source_system','request_id','ip',
   'user_agent','before_json','after_json','metadata_json'].forEach((col) => {
    ok(new RegExp('\\b' + col + '\\b').test(mig), 'column ' + col + ' present');
  });
  ok(!/REFERENCES\s+(task|notice|competition|public)\./i.test(mig), 'NO FK to business objects (rows survive deletes)');
  ok(/audit\.block_mutation/.test(mig) && /APPEND_ONLY/.test(mig), 'append-only trigger function');
  ok(/BEFORE UPDATE ON audit\.entries[\s\S]{0,120}block_mutation/.test(mig), 'UPDATE blocked');
  ok(/BEFORE DELETE ON audit\.entries[\s\S]{0,120}block_mutation/.test(mig), 'DELETE blocked');
  ok(/BEFORE TRUNCATE ON audit\.entries[\s\S]{0,140}block_mutation/.test(mig), 'TRUNCATE blocked');
  ok(/GRANT\s+SELECT,\s*INSERT\s+ON audit\.entries\s+TO phf_hr_app/.test(mig), 'phf_hr_app: SELECT + INSERT only');
  ok(!/GRANT\s+(UPDATE|DELETE|ALL)\s+ON audit\.entries\s+TO phf_hr_app/i.test(mig), 'phf_hr_app is NOT granted UPDATE/DELETE/ALL');
  ok(/REVOKE ALL ON SCHEMA audit FROM PUBLIC/.test(mig) && /REVOKE ALL ON audit\.entries FROM PUBLIC/.test(mig), 'nothing to PUBLIC');
  ok(/audit_entries_occurred_id_idx.*occurred_at DESC, id DESC/.test(mig), 'keyset index (occurred_at DESC, id DESC)');
  ok(/audit_entries_actor_idx/.test(mig) && /audit_entries_module_idx/.test(mig) && /audit_entries_action_idx/.test(mig), 'actor/module/action indexes');
  ok(/pg_column_size\(before_json\)\s*<=\s*16384/.test(mig), 'DB backstop CHECK bounds before_json size');
  ok(/audit_entries_no_destructive|DROP SCHEMA IF EXISTS audit CASCADE/.test(mig + rd('migrations/phf_hr_audit_v1_DOWN.sql')), 'DOWN drops only the audit schema');
}

console.log('\n== EMIT HELPER — bounded payload + PII scrub (services/phf-hr-api/lib/audit-service.js) ==');
{
  const svc = require('../services/phf-hr-api/lib/audit-service');
  const S = 'ZZSEKRET';
  const b = svc.boundJson({
    password: S + '_pw', tempPassword: S + '_tmp', temporaryPassword: S + '_tmp2', passwordHash: S + '_h', password_salt: S + '_salt',
    credential: S + '_cred', id_token: S + '_gtok', access_token: S + '_atok', cookie: S + '_ck', authorization: 'Bearer ' + S,
    apiKey: S + '_api', service_token: S + '_st', sessionId: S + '_sid', jwt: S + '_jwt',
    nested: { deeper: { passwordHash: S + '_deep', ok: 1 } }, keep: 'visible',
  });
  ok(JSON.stringify(b).indexOf(S) === -1, 'NO secret sentinel value appears anywhere in the projection');
  ok(b.keep === 'visible' && b.nested.deeper.ok === 1, 'non-secret data is kept');
  ok(b.password === '[redacted]' && b.nested.deeper.passwordHash === '[redacted]', 'secret keys kept but value redacted, at depth');
  ok(b._truncated === true, 'redaction marks the projection _truncated');
  // long string -> truncated + marked
  const long = svc.boundJson({ note: 'x'.repeat(5000) });
  ok(long.note.length <= 600 && long._truncated === true, 'long string truncated + _truncated marker');
  // oversized object -> explicit marker, never silent cut
  const huge = svc.boundJson({ blob: Array.from({ length: 200 }, () => 'y'.repeat(500)) });
  ok(huge && huge._truncated === true, 'oversized projection -> _truncated (no silent cut)');
  ok(svc.boundJson(null) === null, 'null stays null');
  // action allowlist
  ['AUTH_LOGIN_SUCCESS','AUTH_LOGIN_FAILURE','AUTH_LOGOUT','ACCOUNT_CREATE','ACCOUNT_UPDATE',
   'ACCOUNT_ACCESS_LOCK','ACCOUNT_ACCESS_UNLOCK','ACCOUNT_ROLE_CHANGE','ACCOUNT_PASSWORD_RESET',
   'ACCOUNT_DELETE','EMPLOYEE_INACTIVE_AUTO_LOCK'].forEach((a) => ok(svc.ACTIONS.has(a), 'allowlist has ' + a));
  ok(!svc.ACTIONS.has('TASK_PUBLISHED') && !svc.ACTIONS.has('ARBITRARY'), 'allowlist rejects out-of-scope / arbitrary actions');
  ok(svc.MODULES.has('auth') && svc.MODULES.has('account') && !svc.MODULES.has('task'), 'module set is auth/account/system only');
}

console.log('\n== EMIT HELPER — browser can NEVER supply actor / ip / ua / request-id ==');
{
  const { buildEntry } = require('../api/_lib/audit-emit');
  const req = {
    headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1', 'user-agent': 'RealUA/1.0', 'x-vercel-id': 'vercel-abc' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  const session = { account: { id: 'ACC-REAL', employeeCode: 'PHF001', name: 'Real Admin', email: 'a@b.c' } };
  // ctx tries to spoof identity + request metadata at the TOP level
  const entry = buildEntry(req, session, {
    module: 'account', action: 'ACCOUNT_UPDATE',
    actor_account_id: 'HACKER', actor_name: 'HACKER', ip: '6.6.6.6', user_agent: 'FakeUA', request_id: 'FAKE',
    object_id: 'x', before: { a: 1 },
  });
  ok(entry.actor_account_id === 'ACC-REAL', 'actor_account_id comes from the session, not ctx top-level');
  ok(entry.actor_name === 'Real Admin', 'actor_name comes from the session');
  ok(entry.actor_employee_code === 'PHF001', 'actor_employee_code comes from the session');
  ok(entry.ip === '9.9.9.9', 'ip comes from x-forwarded-for, not ctx');
  ok(entry.user_agent === 'RealUA/1.0', 'user_agent comes from the request header, not ctx');
  ok(entry.request_id === 'vercel-abc', 'request_id comes from the request header, not ctx');
  ok(entry.source_system === 'web', 'source_system forced to web on this path');
  // the sanctioned no-session override (login failure) — ctx.actor is allowed
  const failEntry = buildEntry(req, null, {
    module: 'auth', action: 'AUTH_LOGIN_FAILURE', result: 'failure',
    actor: { actor_name: 'attempted@email.com' }, metadata: { reason: 'LOGIN_INVALID' },
  });
  ok(failEntry.actor_name === 'attempted@email.com' && !failEntry.actor_account_id, 'login-failure: explicit ctx.actor override, still no account id');
}

console.log('\n== FAIL-OPEN — a disabled/broken audit never fails the business action ==');
{
  const { auditEmit, AUDIT_ENABLED } = require('../api/_lib/audit-emit');
  ok(AUDIT_ENABLED === false, 'PHF_AUDIT_BRIDGE_ENABLED defaults OFF');
  return auditEmit({ headers: {}, socket: {} }, null, { module: 'auth', action: 'AUTH_LOGOUT' })
    .then((r) => {
      ok(r && r.ok === false && r.skipped === true, 'auditEmit with bridge OFF resolves {ok:false,skipped:true} — never throws');
      continueSync();
    });
}

function continueSync() {
  console.log('\n== WIRING — auth events, safe fields only ==');
  {
    const login = rd('api/auth/login.js');
    ok(/auditEmit\(req, null, \{[\s\S]{0,200}AUTH_LOGIN_FAILURE/.test(login), 'login.js emits AUTH_LOGIN_FAILURE');
    ok(/AUTH_LOGIN_SUCCESS/.test(login), 'login.js emits AUTH_LOGIN_SUCCESS');
    login.match(/auditEmit\([\s\S]*?\}\);/g).forEach((call) => {
      ok(!/body\.password|\bpassword\s*:/.test(call), 'login.js audit call carries no password: ' + call.slice(0, 60).replace(/\s+/g, ' '));
    });
    const glogin = rd('api/auth/google/login.js');
    ok(/AUTH_LOGIN_SUCCESS/.test(glogin) && /AUTH_LOGIN_FAILURE/.test(glogin), 'google/login.js emits success + failure');
    glogin.match(/auditEmit\([\s\S]*?\}\);/g).forEach((call) => {
      ok(!/body\.credential|credential\s*:|\btoken\b/.test(call), 'google/login.js audit call carries no raw credential/token');
    });
    const logout = rd('api/auth/logout.js');
    ok(/AUTH_LOGOUT/.test(logout) && /readSession\(req\)/.test(logout), 'logout.js emits AUTH_LOGOUT with the pre-clear session actor');
  }

  console.log('\n== WIRING — account events (server-side mutation points, not localStorage) ==');
  {
    const acc = rd('api/auth/accounts.js');
    ok(/emitAccountAudit\(req, session, 'create'/.test(acc), 'create -> ACCOUNT_CREATE');
    ok(/const before = await getAccountById\(body\.accountId\);[\s\S]{0,120}emitAccountAudit\(req, session, 'update', before, user\)/.test(acc), 'update -> before/after captured, ACCOUNT_UPDATE/ROLE/ACCESS derived');
    ok(/emitAccountAudit\(req, session, 'delete', user, null\)/.test(acc), 'delete -> ACCOUNT_DELETE with retained snapshot');
    ok(/emitAccountAudit\(req, session, 'reset-password'/.test(acc), 'reset -> ACCOUNT_PASSWORD_RESET');
    ok(/temp password issued \(value never logged\)/.test(acc), 'reset-password: temp password value is explicitly not logged');
    ok(/ACCOUNT_ROLE_CHANGE/.test(acc) && /ACCOUNT_ACCESS_LOCK/.test(acc) && /ACCOUNT_ACCESS_UNLOCK/.test(acc), 'distinct role / lock / unlock events');
    ok(/function acctSnap/.test(acc) && !/passwordHash|password_salt|tempPassword/.test(acc.match(/function acctSnap[\s\S]{0,300}/)[0]), 'acctSnap projection excludes secret fields');
    const data = rd('api/data.js');
    ok(/EMPLOYEE_INACTIVE_AUTO_LOCK/.test(data) && /out\.accountLock\.locked>0/.test(data), 'employee inactive -> EMPLOYEE_INACTIVE_AUTO_LOCK emitted from api/data.js');
    const em = rd('api/_lib/employee-master.js');
    ok(/return\{locked,accounts\}/.test(em), 'lockAccountsForDepartedEmployee returns locked account list for the audit row');
  }

  console.log('\n== READ SURFACE — Admin-only, read-only, no write verb ==');
  {
    const data = rd('api/data.js');
    ok(/req\.query\?\.audit[\s\S]{0,200}AUDIT_ADMIN_REQUIRED/.test(data), 'audit read mode is gated by session.role === admin');
    ok(/if \(req\.method === 'GET'\)[\s\S]*req\.query\?\.audit/.test(data), 'audit read mode lives only in the GET handler (no POST write path)');
    ok(!/audit=1[\s\S]{0,400}(INSERT|UPDATE|DELETE|write)/i.test(data.match(/req\.query\?\.audit[\s\S]{0,500}/)[0] || ''), 'audit read mode issues no write');
    const server = rd('services/phf-hr-api/server.js');
    ok(/\/v1\/audit:emit['" ]|\/v1\/audit:list|\/v1\/audit:detail/.test(server), 'bridge exposes emit / list / detail only');
    ok(!/\/v1\/audit:(update|delete|edit|truncate)/.test(server), 'bridge exposes NO update/delete/edit/truncate verb');
    ok(/AUDIT_BRIDGE_ENABLED/.test(server) && /PHF_AUDIT_BRIDGE_ENABLED/.test(server), 'bridge is flag-gated (default OFF -> 503)');
    ok(/authCheck\(req\)[\s\S]{0,200}\/v1\/audit/.test(server) || /path === '\/v1\/audit:emit'[\s\S]{0,200}authCheck/.test(server), 'bridge requires the service Bearer token');
    const svcFile = rd('services/phf-hr-api/lib/audit-service.js');
    ok(!/(UPDATE|DELETE\s+FROM|TRUNCATE)\s+audit\./i.test(svcFile) && !/client\.query\(\s*[`'"]\s*(UPDATE|DELETE|TRUNCATE)\b/i.test(svcFile), 'audit-service.js issues no UPDATE/DELETE/TRUNCATE SQL against the log');
    ok(/withTaskReadTransaction/.test(svcFile) && /BEGIN READ ONLY/.test(rd('services/phf-hr-api/lib/db.js')), 'reads run in a READ ONLY transaction');
    ok(/f\.cursor && \/\^\\d\+\\\|\\d\+\$\//.test(svcFile) && /ORDER BY occurred_at DESC, id DESC LIMIT/.test(svcFile), 'keyset pagination by (occurred_at, id), bounded LIMIT');
  }

  console.log('\n== UI — route + renderer, Admin-only, no edit/delete controls ==');
  {
    const router = rd('assets/js/phf-url-router.js');
    ok(/'\/admin\/he-thong\/nhat-ky':Object\.freeze\(\{area:'admin',screen:'audit-log',roles:\['admin'\]\}\)/.test(router), 'route registered admin-only');
    ok(/path==='\/admin\/he-thong\/nhat-ky'\)\{[\s\S]{0,500}requireRoles\(\['admin'\]\)/.test(router), 'guard requires admin');
    ok(/phfRenderAuditLog/.test(router), 'guard dispatches window.phfRenderAuditLog');
    ok(rd('index.html').indexOf('/^\\/admin\\/he-thong(?:\\/|$)/') !== -1, 'index.html shellFor recognizes /admin/he-thong as the HR shell');
    const ui = rd('assets/js/phf-audit-log.js');
    ok(/window\.phfRenderAuditLog/.test(ui) && /role\(\)!=='admin'/.test(ui), 'renderer is admin-guarded');
    ok(/\/api\/data\?'\+p\.join|audit=1/.test(ui), 'renderer reads /api/data?audit=1');
    ok(!/method:\s*['"]POST['"]/.test(ui), 'audit UI issues only GET reads (no POST/write)');
    ok(!/>\s*(Xóa|Sửa|Chỉnh sửa|Duyệt|Khôi phục)\s*</.test(ui), 'no edit/delete/approve buttons in the audit UI');
    ok(/Nhật ký trung tâm được ghi nhận từ ngày triển khai/.test(ui), 'UI is honest about no backfill');
    ok(/Thời gian[\s\S]{0,120}Người dùng[\s\S]{0,120}Module[\s\S]{0,120}Hành động[\s\S]{0,120}Đối tượng[\s\S]{0,120}Kết quả[\s\S]{0,120}IP/.test(ui), 'locked column set present');
    ok(/phf-hr-home\.js/ && /soon:true,icon:'chart'/.test(rd('assets/js/phf-hr-home.js')), 'Home card stays "Sắp triển khai" until local verification (spec §12)');
  }

  console.log('\n== NO BACKFILL ==');
  {
    const svcFile = rd('services/phf-hr-api/lib/audit-service.js');
    ok(!/task\.events|notice_audit_logs|submission_history|employee_master_history|localStorage/i.test(svcFile), 'audit-service imports/copies NO historical source');
  }

  console.log('\nSYSTEM V1 AUDIT FOUNDATION offline checks: ' + pass + ' PASS');
}
