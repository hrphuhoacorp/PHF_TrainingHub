'use strict';

/*
 * PHF TASK — MAIL CONTRACT V1 — focused offline test (no DB, no network).
 *
 * Covers, without infrastructure: every MAIL=YES/NO decision + self-assignment
 * exception (transfer excluded), recurrence daily/weekly=NO / monthly=YES, the
 * outbox dedupe-key shape + retry-safety, the Brevo provider fail-safe, the
 * drainer's disabled-flag + skip-reason behaviour, the static wiring that
 * guarantees non-listed events (progress / comment / collaborator / overdue /
 * cancel-request) never enqueue mail, and the 8 finalized templates (exact
 * subject prefixes, single "MỞ PHF TASK" CTA + absolute link, footer, header,
 * HTML escaping, Vietnamese text, no JS/SVG/remote assets, no fabricated codes,
 * TASK_COMPLETED vs TASK_COMPLETED_LATE distinction, long-content wrapping).
 *
 * Run: node scripts/test-task-mail-contract-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC = path.join(ROOT, 'services', 'phf-hr-api', 'lib');
const API = path.join(ROOT, 'api', '_lib');

const contract = require(path.join(SVC, 'task-mail-contract'));
const emit = require(path.join(SVC, 'task-mail-emit'));
const provider = require(path.join(API, 'task-mail-provider'));
const templates = require(path.join(API, 'task-mail-templates'));

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

(async function run() {
  // =====================================================================
  // A. CONTRACT DECISIONS
  // =====================================================================
  const P = 'PHF010', A = 'PHF002';

  // 1 new task -> primary
  {
    const d = contract.decideNewTask({ primaryEmployeeCode: P, assigner: { employeeCode: A } });
    pass(d.send && d.templateKey === 'TASK_NEW' && d.recipientEmployeeCode === P, '1  new task -> primary assignee mail');
  }
  // 2 self-assigned -> no
  {
    const d = contract.decideNewTask({ primaryEmployeeCode: P, assigner: { employeeCode: 'phf010' } });
    pass(!d.send && d.reason === 'self_assigned', '2  self-assigned task -> NO mail (case-insensitive)');
  }
  // account-only assigner is never the primary
  {
    const d = contract.decideNewTask({ primaryEmployeeCode: P, assigner: { accountId: 'acc-1' } });
    pass(d.send, '2b account-only assigner != employee primary -> mail');
  }
  // 3 proposal created -> recipient
  {
    const d = contract.decideNewProposal({ recipientEmployeeCode: P, creator: { employeeCode: A } });
    pass(d.send && d.templateKey === 'PROPOSAL_NEW' && d.recipientEmployeeCode === P, '3  proposal created -> recipient mail');
  }
  {
    const d = contract.decideNewProposal({ recipientEmployeeCode: P, creator: { employeeCode: P } });
    pass(!d.send && d.reason === 'creator_is_recipient', '3b proposal creator == recipient -> NO mail');
  }
  // 4 proposal accepted -> new task mail (decideNewTask reused)
  {
    const d = contract.decideNewTask({ primaryEmployeeCode: P, assigner: { employeeCode: A } });
    pass(d.send && d.templateKey === 'TASK_NEW', '4  proposal accepted -> NEW TASK mail to new primary');
  }
  // 5 deadline earlier -> mail
  {
    const d = contract.decideDeadlineChange({ oldDeadline: '2026-09-10T00:00:00Z', newDeadline: '2026-09-05T00:00:00Z', primaryEmployeeCode: P });
    pass(d.send && d.templateKey === 'TASK_DEADLINE_EARLIER' && d.recipientEmployeeCode === P, '5  deadline earlier -> primary mail');
  }
  // 6 deadline later -> no
  {
    const d = contract.decideDeadlineChange({ oldDeadline: '2026-09-10T00:00:00Z', newDeadline: '2026-09-20T00:00:00Z', primaryEmployeeCode: P });
    pass(!d.send && d.reason === 'deadline_not_earlier', '6  deadline later -> NO mail');
  }
  {
    const d = contract.decideDeadlineChange({ oldDeadline: '2026-09-10T00:00:00Z', newDeadline: '2026-09-10T00:00:00Z', primaryEmployeeCode: P });
    pass(!d.send, '6b deadline unchanged -> NO mail');
  }
  // 7 primary transfer -> new assignee only
  {
    const d = contract.decideTransfer({ newPrimaryEmployeeCode: 'PHF041', actor: { employeeCode: A } });
    pass(d.send && d.recipientEmployeeCode === 'PHF041' && d.templateKey === 'TASK_TRANSFERRED', '7  transfer -> NEW primary only');
  }
  {
    // Approved contract: NO self-suppression for transfer. Even a self-transfer
    // mails the new primary.
    const d = contract.decideTransfer({ newPrimaryEmployeeCode: A, actor: { employeeCode: A } });
    pass(d.send && d.recipientEmployeeCode === A && d.templateKey === 'TASK_TRANSFERRED', '7b transfer to self -> STILL mails new primary (no self-suppression)');
  }
  {
    const d = contract.decideTransfer({ newPrimaryEmployeeCode: '' });
    pass(!d.send && d.reason === 'no_new_primary', '7c transfer with no target -> no mail');
  }
  // 8 completion on time -> assigner
  {
    const d = contract.decideCompletion({ assignerEmployeeCode: A, onTime: true, actor: { employeeCode: P } });
    pass(d.send && d.recipientEmployeeCode === A && d.templateKey === 'TASK_COMPLETED', '8  completion on time -> assigner mail');
  }
  // 9 completion late -> assigner + late template
  {
    const d = contract.decideCompletion({ assignerEmployeeCode: A, onTime: false, actor: { employeeCode: P } });
    pass(d.send && d.recipientEmployeeCode === A && d.templateKey === 'TASK_COMPLETED_LATE', '9  completion late -> assigner + LATE template');
  }
  {
    const d = contract.decideCompletion({ assignerEmployeeCode: A, onTime: true, actor: { employeeCode: A } });
    pass(!d.send, '9b assigner completes own task -> NO mail');
  }
  // 14 direct cancel -> primary
  {
    const d = contract.decideDirectCancel({ primaryEmployeeCode: P, actor: { employeeCode: A } });
    pass(d.send && d.recipientEmployeeCode === P && d.templateKey === 'TASK_CANCELLED', '14 direct cancel -> primary mail');
  }
  // 15 reopen -> primary
  {
    const d = contract.decideReopen({ primaryEmployeeCode: P, actor: { employeeCode: A } });
    pass(d.send && d.recipientEmployeeCode === P && d.templateKey === 'TASK_REOPENED', '15 reopen/restore -> primary mail');
  }
  // 17 daily recurrence -> no
  {
    const d = contract.decideRecurrenceOccurrence({ frequency: 'daily', primaryEmployeeCode: P, creator: { employeeCode: A } });
    pass(!d.send && d.reason === 'frequency_daily', '17 daily recurrence future occurrence -> NO mail');
  }
  // 18 weekly recurrence -> no
  {
    const d = contract.decideRecurrenceOccurrence({ frequency: 'weekly', primaryEmployeeCode: P, creator: { employeeCode: A } });
    pass(!d.send && d.reason === 'frequency_weekly', '18 weekly recurrence future occurrence -> NO mail');
  }
  // 19 monthly recurrence -> mail
  {
    const d = contract.decideRecurrenceOccurrence({ frequency: 'monthly', primaryEmployeeCode: P, creator: { employeeCode: A } });
    pass(d.send && d.recipientEmployeeCode === P && d.templateKey === 'TASK_NEW', '19 monthly recurrence future occurrence -> primary mail');
  }
  {
    const d = contract.decideRecurrenceOccurrence({ frequency: 'monthly', primaryEmployeeCode: P, creator: { employeeCode: P } });
    pass(!d.send, '19b monthly recurrence, primary == creator -> NO mail (self exception)');
  }

  // =====================================================================
  // B. OUTBOX ENQUEUE — flag/schema gate, dedupe key, retry-safety
  // =====================================================================
  function fakeClient(opts) {
    const o = opts || {};
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql: String(sql), params });
        if (/information_schema\.tables/.test(sql)) return { rows: [{ n: o.schema === false ? 0 : 1 }] };
        if (/SAVEPOINT|RELEASE|ROLLBACK TO/.test(sql)) return { rows: [] };
        if (/INSERT INTO task\.mail_outbox/.test(sql)) {
          if (o.insertThrows) throw new Error('boom');
          return { rowCount: o.conflict ? 0 : 1, rows: o.conflict ? [] : [{ id: 'new-id' }] };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  // flag off -> no-op
  {
    delete process.env.PHF_TASK_MAIL_OUTBOX_ENABLED;
    emit._resetSchemaCache();
    const c = fakeClient();
    const r = await emit.enqueueMail({ client: c, templateKey: 'TASK_NEW', recipientEmployeeCode: P, eventCode: 'X' });
    pass(r.enqueued === 0 && r.skipped === 'flag', '21 enqueue is a no-op when PHF_TASK_MAIL_OUTBOX_ENABLED != true');
    pass(!c.calls.some((x) => /INSERT INTO task\.mail_outbox/.test(x.sql)), '21b no INSERT attempted when flag off');
  }

  process.env.PHF_TASK_MAIL_OUTBOX_ENABLED = 'true';

  // schema missing -> no-op
  {
    emit._resetSchemaCache();
    const c = fakeClient({ schema: false });
    const r = await emit.enqueueMail({ client: c, templateKey: 'TASK_NEW', recipientEmployeeCode: P, eventCode: 'X' });
    pass(r.enqueued === 0 && r.skipped === 'schema', '21c enqueue is a no-op before the mail V1 migration');
  }

  // happy path -> dedupe key shape evt:<id>|<RECIPIENT>
  {
    emit._resetSchemaCache();
    const c = fakeClient();
    const r = await emit.enqueueMail({
      client: c, templateKey: 'TASK_NEW', recipientEmployeeCode: 'phf010',
      eventCode: 'TASK_PUBLISHED', businessEventId: 'evt-123', taskId: 't-1', payload: { a: 1 },
    });
    const ins = c.calls.find((x) => /INSERT INTO task\.mail_outbox/.test(x.sql));
    pass(r.enqueued === 1, '24 enqueue inserts one row on the happy path');
    pass(ins.params[6] === 'evt:evt-123|PHF010', '20 dedupe_key = evt:<business_event_id>|<RECIPIENT> (upper-cased)');
    pass(/ON CONFLICT DO NOTHING/.test(ins.sql), '20b INSERT is ON CONFLICT DO NOTHING (retry/duplicate safe)');
  }
  // no event id -> fallback key
  {
    emit._resetSchemaCache();
    const c = fakeClient();
    await emit.enqueueMail({ client: c, templateKey: 'TASK_CANCELLED', recipientEmployeeCode: P, eventCode: 'X', taskId: 't-9' });
    const ins = c.calls.find((x) => /INSERT INTO task\.mail_outbox/.test(x.sql));
    pass(ins.params[6] === 'TASK_CANCELLED|t-9|PHF010', '20c fallback dedupe_key = <template>|<task>|<recipient> when no event id');
  }
  // conflict -> enqueued 0, no throw (retry produces one delivery only)
  {
    emit._resetSchemaCache();
    const c = fakeClient({ conflict: true });
    const r = await emit.enqueueMail({ client: c, templateKey: 'TASK_NEW', recipientEmployeeCode: P, eventCode: 'X', businessEventId: 'e1' });
    pass(r.enqueued === 0, '24b duplicate event retry -> ON CONFLICT, 0 new rows (one delivery only)');
  }
  // safeEnqueueMail swallows a SQL error, never throws into the lifecycle path
  {
    emit._resetSchemaCache();
    const c = fakeClient({ insertThrows: true });
    let threw = false;
    let r;
    try { r = await emit.safeEnqueueMail(c, { templateKey: 'TASK_NEW', recipientEmployeeCode: P, eventCode: 'X', businessEventId: 'e2' }); }
    catch (_e) { threw = true; }
    pass(!threw && r && r.skipped === 'error', '23 safeEnqueueMail swallows a SQL error (business write never rolled back)');
    pass(c.calls.some((x) => /ROLLBACK TO SAVEPOINT/.test(x.sql)), '23b failed enqueue rolls back only its SAVEPOINT');
  }

  // =====================================================================
  // C. TEMPLATES
  // =====================================================================
  const ALL8 = ['TASK_NEW', 'PROPOSAL_NEW', 'TASK_DEADLINE_EARLIER', 'TASK_TRANSFERRED',
    'TASK_COMPLETED', 'TASK_COMPLETED_LATE', 'TASK_CANCELLED', 'TASK_REOPENED'];
  pass(contract.ALL_TEMPLATE_KEYS.slice().sort().join() === ALL8.slice().sort().join(),
    'templates: exactly the 8 contract template keys');

  const BASE_PL = {
    task_code: 'CV-2609-0001', title: 'Kiểm kê kho Quận 7', content: 'Đếm và đối chiếu.',
    task_id: '11111111-1111-1111-1111-111111111111',
    assigner_employee_code: A, primary_employee_code: P, creator_employee_code: A,
    recipient_employee_code: P, from_employee_code: 'PHF041',
    start_at: '2026-09-04T01:00:00Z', deadline: '2026-09-06T10:00:00Z',
    old_deadline: '2026-09-12T10:00:00Z', new_deadline: '2026-09-06T10:00:00Z',
    completed_at: '2026-09-08T02:15:00Z', actor_name: 'Trần Văn Vinh',
    reason: 'Khách hàng hoãn.',
  };

  // exact subject prefixes per finalized contract
  const SUBJECT_RE = {
    TASK_NEW: /^\[CV-2609-0001\] Công việc mới: /,
    PROPOSAL_NEW: /^\[CV-2609-0001\] Đề xuất mới: /,
    TASK_DEADLINE_EARLIER: /^\[CV-2609-0001\] Deadline được rút ngắn: /,
    TASK_TRANSFERRED: /^\[CV-2609-0001\] Chuyển giao công việc: /,
    TASK_COMPLETED: /^\[CV-2609-0001\] Hoàn thành: /,
    TASK_COMPLETED_LATE: /^\[CV-2609-0001\] Hoàn thành trễ: /,
    TASK_CANCELLED: /^\[CV-2609-0001\] Đã hủy công việc: /,
    TASK_REOPENED: /^\[CV-2609-0001\] Mở lại công việc: /,
  };

  for (const key of ALL8) {
    const out = templates.renderTaskMail({ templateKey: key, payload: BASE_PL });
    pass(out && out.subject && /<div|<table/i.test(out.html), 'template ' + key + ' renders without exception (subject + html)');
    pass(SUBJECT_RE[key].test(out.subject), 'template ' + key + ' subject prefix: ' + SUBJECT_RE[key]);
    pass(out.html.includes('MỞ PHF TASK') && /href="https:\/\/[^"]+\/task\?task=/.test(out.html),
      'template ' + key + ' has exactly the "MỞ PHF TASK" CTA with an absolute deep link');
    pass((out.html.match(/MỞ PHF TASK/g) || []).length === 1, 'template ' + key + ' has exactly ONE primary CTA');
    pass(out.html.includes('Email được gửi tự động từ hệ thống PHF Task.'), 'template ' + key + ' has the approved footer');
    pass(out.html.includes('PHF TASK'), 'template ' + key + ' has the PHF TASK header');
    pass(out.html.includes('CV-2609-0001') && !/PHF-\d|CV-LG-/.test(out.html),
      'template ' + key + ' uses the current task code, no fabricated PHF-* / legacy code');
    pass(/[àáảãạăâđêôơưèéẻẽẹìíỉĩịòóỏõọùúủũụ]/i.test(out.html), 'template ' + key + ' contains Vietnamese text');
  }

  // HTML escaping — dynamic values with markup/quotes must be escaped in HTML
  {
    const xss = templates.renderTaskMail({ templateKey: 'TASK_NEW', payload: Object.assign({}, BASE_PL, {
      title: '<script>alert(1)</script> "x" & y',
      content: 'line1 <img src=x onerror=alert(2)> end',
      task_code: 'CV-<x>',
    }) });
    pass(!/<script>alert\(1\)<\/script>/.test(xss.html) && xss.html.includes('&lt;script&gt;'),
      'template escaping: <script> in title -> &lt;script&gt; (inert)');
    pass(!/<img src=x onerror=/.test(xss.html) && xss.html.includes('&lt;img src=x onerror=alert(2)&gt;'),
      'template escaping: <img onerror> in content -> escaped text');
    pass(xss.html.includes('&quot;x&quot; &amp; y'), 'template escaping: quotes (&quot;) and & (&amp;) escaped in HTML');
  }

  // TASK_COMPLETED vs TASK_COMPLETED_LATE — must be distinct
  {
    const ok = templates.renderTaskMail({ templateKey: 'TASK_COMPLETED', payload: BASE_PL });
    const late = templates.renderTaskMail({ templateKey: 'TASK_COMPLETED_LATE', payload: BASE_PL });
    pass(/Hoàn thành trễ/.test(late.subject) && !/trễ/i.test(ok.subject),
      '11 subjects: LATE says "Hoàn thành trễ", on-time does not');
    pass(/HOÀN THÀNH TRỄ/.test(late.html) && !/HOÀN THÀNH TRỄ/.test(ok.html)
      && /Công việc đã hoàn thành/.test(ok.html),
      '11 heading: LATE = "HOÀN THÀNH TRỄ", on-time = "Công việc đã hoàn thành"');
    // BASE_PL: deadline 06/09 10:00Z -> done 08/09 02:15Z = 1 ngày 16 giờ 15 phút
    pass(late.html !== ok.html && /Mức trễ/.test(late.html) && /Trễ 1 ngày 16 giờ/.test(late.html),
      '11 LATE derives + shows "Mức trễ" (late-by) from deadline/completed_at');
    pass(!/Mức trễ/.test(ok.html) && !/Trễ \d/.test(ok.html), 'on-time completion never shows a late figure');
  }
  // late-by derivation is safe when data is missing / not actually late
  pass(templates.fmtLateBy('2026-09-06T10:00:00Z', '2026-09-06T09:00:00Z') === '',
    'fmtLateBy: completed before deadline -> empty (never negative)');
  pass(templates.fmtLateBy('bad', 'also bad') === '', 'fmtLateBy: unparseable -> empty');

  // long content / title must not break the renderer
  {
    const bigTitle = 'A '.repeat(400) + 'kết thúc';
    const bigContent = ('Dòng nội dung rất dài không có dấu cách ngắt' + 'x'.repeat(300) + '\n').repeat(20);
    const out = templates.renderTaskMail({ templateKey: 'TASK_NEW', payload: Object.assign({}, BASE_PL, { title: bigTitle, content: bigContent }) });
    pass(out && out.html.length > 1000 && out.subject.length > 50, 'template: very long title/content renders without throwing');
    pass(/word-break:break-word|word-break: break-word/.test(out.html), 'template: content block wraps long unbroken strings (word-break)');
  }

  pass(templates.renderTaskMail({ templateKey: 'NOPE', payload: {} }) === null, 'template: unknown key -> null (drainer marks skipped)');
  pass(templates.renderTaskMail({ templateKey: 'TASK_NEW', payload: {} }) !== null, 'template: empty payload still renders (safe fallbacks)');

  // email-safety: no JS, no SVG, no remote fonts/assets in any rendered template
  for (const key of ALL8) {
    const h = templates.renderTaskMail({ templateKey: key, payload: BASE_PL }).html;
    pass(!/<script|onclick=|onerror=|javascript:/i.test(h), 'template ' + key + ': no JS / event handlers');
    pass(!/<svg|<iframe|<object|<embed/i.test(h), 'template ' + key + ': no SVG/iframe/object');
    pass(!/@import|fonts\.googleapis|fonts\.gstatic|<link/i.test(h), 'template ' + key + ': no remote fonts / <link>');
    pass(!/src="https?:\/\//i.test(h), 'template ' + key + ': no remote asset src');
  }

  // =====================================================================
  // D. PROVIDER FAIL-SAFE
  // =====================================================================
  {
    const save = process.env.BREVO_API_KEY; delete process.env.BREVO_API_KEY;
    pass(provider.isProviderConfigured() === false, 'provider: not configured without BREVO_API_KEY');
    let threw = false; let r;
    try { r = await provider.sendTransactionalEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }); }
    catch (_e) { threw = true; }
    pass(!threw && r.ok === false && r.error === 'provider_not_configured', '23c provider never throws; missing key -> { ok:false }');
    if (save !== undefined) process.env.BREVO_API_KEY = save;
  }

  // =====================================================================
  // E. DRAINER — disabled by default, skip reasons
  // =====================================================================
  {
    delete require.cache[require.resolve(path.join(API, 'task-mail-drain'))];
    delete process.env.PHF_TASK_MAIL_V1_ENABLED;
    const drain = require(path.join(API, 'task-mail-drain'));
    const s = await drain.runMailDrain({});
    pass(s.enabled === false && s.claimed === 0, '26 drainer is inert unless PHF_TASK_MAIL_V1_ENABLED === true (PROD-safe default)');
  }

  // =====================================================================
  // F. STATIC WIRING — non-listed events never enqueue; listed ones do
  // =====================================================================
  const twSrc = stripComments(fs.readFileSync(path.join(SVC, 'task-write.js'), 'utf8'));
  pass(/require\('\.\/task-mail-emit'\)/.test(twSrc) && /require\('\.\/task-mail-contract'\)/.test(twSrc), 'wiring: task-write.js imports the mail contract + emit');
  for (const fn of ['decideNewTask', 'decideNewProposal', 'decideDeadlineChange', 'decideTransfer', 'decideCompletion', 'decideDirectCancel', 'decideReopen']) {
    pass(twSrc.includes('mailContract.' + fn + '('), 'wiring: task-write.js calls mailContract.' + fn);
  }
  // non-listed lifecycle writes must NOT enqueue mail
  function fnBody(src, name) {
    const i = src.indexOf('async function ' + name + '(');
    if (i < 0) return '';
    return src.slice(i, i + 2600);
  }
  for (const fn of ['updateTaskProgress', 'addTaskComment', 'addTaskRelated', 'removeTaskRelated']) {
    pass(!/enqueueTaskMail\(/.test(fnBody(twSrc, fn)), 'contract: ' + fn + ' (progress/comment/collaborator) does NOT enqueue mail');
  }
  const trSrc = stripComments(fs.readFileSync(path.join(SVC, 'task-recurrence.js'), 'utf8'));
  pass(/decideRecurrenceOccurrence\(/.test(trSrc) && /mailDecision\.send/.test(trSrc), 'wiring: recurrence enqueues only when the contract says send (monthly)');
  const crSrc = stripComments(fs.readFileSync(path.join(SVC, 'task-cancel-request.js'), 'utf8'));
  pass(!/task-mail-emit|enqueueMail|task-mail-contract/.test(crSrc), 'contract 13: cancel-request + its decision do NOT enqueue mail');

  const migration = fs.readFileSync(path.join(ROOT, 'migrations', 'phf_hr_task_mail_v1.sql'), 'utf8');
  pass(/create table task\.mail_outbox/.test(migration) && /task_mail_outbox_dedupe_uq/.test(migration) && /task_mail_outbox_event_recipient_uq/.test(migration), 'migration: mail_outbox + both duplicate-send unique indexes present');
  pass(!/create table task\.mail_settings/i.test(migration) && !/create table task\.mail_recipients/i.test(migration),
    'migration: transactional-first scope — does NOT create mail_settings / mail_recipients (deferred to Weekly Report increment)');

  const cron = fs.readFileSync(path.join(ROOT, 'api', 'checklist-monthly-cron.js'), 'utf8');
  pass(/__phf_cron.*task-mail|task-mail.*__phf_cron/.test(cron) && /TASK_MAIL_CRON_SECRET/.test(cron), 'wiring: task-mail cron route + its own Bearer secret');
  const vj = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  pass(/api\/task-mail-cron/.test(vj), 'wiring: vercel.json rewrites /api/task-mail-cron');

  console.log('\n' + passed + ' checks passed.');
})().catch((e) => { console.error('\nFAIL:', e && e.stack || e); process.exit(1); });
