'use strict';

/*
 * PHF Task — MAIL V1 Increment 2 — WEEKLY REPORT V1 generator (Vercel).
 *
 * Deterministic, rule-based BGĐ weekly digest. NO generative AI, NO vague
 * "đánh giá tự động" — every number and every signal is traceable to a rule
 * over canonical Reporting-V2 data (api/_lib/task-reporting-v2.js -> read
 * bridge -> phf-hr-api -> PostgreSQL task.*). No Supabase as Task datastore,
 * no browser/HTML/SVG scraping, no legacy Google Sheet.
 *
 * The generator NEVER calls Brevo. It renders ONE report snapshot and enqueues
 * one task.mail_outbox row per enabled recipient (dedupe_key
 * weekly:<periodStart>:<email>, ON CONFLICT DO NOTHING) — the existing drainer
 * + Brevo provider deliver it later. Same outbox, no second architecture.
 *
 * Double-gated OFF by default:
 *   - env  PHF_TASK_WEEKLY_REPORT_ENABLED === 'true'
 *   - db   task.mail_settings.weekly_report_enabled === true
 * Both must be true before anything is enqueued.
 */

const reportingV2 = require('./task-reporting-v2');
const {
  isMailBridgeEnabled,
  bridgeGetMailSettings,
  bridgeEnqueueWeeklyReport,
} = require('./task-mail-bridge');

const ICT_OFFSET_MS = 7 * 3600 * 1000; // Asia/Ho_Chi_Minh, fixed UTC+7, no DST
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const STALE_DAYS = 7;
const TOP_TASKS_MAX = 5;
const ATTENTION_MAX = 5;
const BASE_URL = String(process.env.TASK_MAIL_BASE_URL || 'https://hr.phuhoafresh.info.vn').trim().replace(/\/$/, '');
const FOOTER_TEXT = 'Email được gửi tự động từ hệ thống PHF Task.';

function isWeeklyReportEnvEnabled() {
  return String(process.env.PHF_TASK_WEEKLY_REPORT_ENABLED || '').trim().toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// PERIOD MATH — previous Monday 00:00 -> Sunday 23:59:59.999, Asia/Ho_Chi_Minh.
// ---------------------------------------------------------------------------
function ictParts(ms) {
  const d = new Date(ms + ICT_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; // dow: 0=Sun..6=Sat
}
function ictMidnightMs(y, m, d) {
  return Date.UTC(y, m, d) - ICT_OFFSET_MS; // UTC ms of ICT local 00:00 on that date
}
function fmtDMY(ms) {
  const p = ictParts(ms);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return pad(p.d) + '/' + pad(p.m + 1) + '/' + p.y;
}
function isoDateKey(ms) {
  const p = ictParts(ms);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return p.y + '-' + pad(p.m + 1) + '-' + pad(p.d);
}

// computeWeeklyPeriod(nowMs) -> { startMs, endMs, startKey, endKey, label, prev }
function computeWeeklyPeriod(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const p = ictParts(now);
  // Monday of the CURRENT ICT week (Mon=1): days since Monday
  const sinceMon = (p.dow + 6) % 7;
  const thisMonMs = ictMidnightMs(p.y, p.m, p.d) - sinceMon * DAY_MS;
  const startMs = thisMonMs - WEEK_MS;              // previous Monday 00:00 ICT
  const endMs = thisMonMs - 1;                       // previous Sunday 23:59:59.999 ICT
  const prevStartMs = startMs - WEEK_MS;
  const prevEndMs = startMs - 1;
  return {
    startMs, endMs,
    startKey: isoDateKey(startMs),
    endKey: isoDateKey(endMs),
    label: fmtDMY(startMs) + ' - ' + fmtDMY(endMs),
    prev: { startMs: prevStartMs, endMs: prevEndMs, label: fmtDMY(prevStartMs) + ' - ' + fmtDMY(prevEndMs) },
  };
}

// ---------------------------------------------------------------------------
// DETERMINISTIC AGGREGATION
// ---------------------------------------------------------------------------
function ms(v) { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
function isOpen(t) { return t.status === 'published' || t.status === 'in_progress'; }
function isCompleted(t) { return t.status === 'completed'; }
function inWindow(v, w) { const x = ms(v); return x != null && x >= w.startMs && x <= w.endMs; }
function activityInWindow(t, w) {
  return inWindow(t.created_at, w) || inWindow(t.published_at, w) || inWindow(t.last_progress_at, w) || inWindow(t.completed_at, w);
}
function overdueAt(t, atMs) { return isOpen(t) && ms(t.deadline) != null && ms(t.deadline) < atMs; }
function staleDays(t, atMs) {
  const last = ms(t.last_progress_at) || ms(t.published_at) || ms(t.created_at);
  if (last == null) return null;
  return Math.floor((atMs - last) / DAY_MS);
}
function isStale(t, atMs) {
  const sd = staleDays(t, atMs);
  return sd == null || sd >= STALE_DAYS;
}

function windowCounts(tasks, w) {
  let activity = 0, completed = 0, completedLate = 0;
  for (const t of tasks) {
    if (activityInWindow(t, w)) activity += 1;
    if (inWindow(t.completed_at, w) && isCompleted(t)) {
      completed += 1;
      if (t.on_time === false) completedLate += 1;
    }
  }
  return { activity, completed, completedLate };
}

function deltaStr(cur, prev) {
  const d = cur - prev;
  if (d > 0) return '↑' + d;
  if (d < 0) return '↓' + Math.abs(d);
  return '=';
}

/*
 * buildWeeklyReportData(tasks, orgIndex, nowMs) -> pure report model.
 * orgIndex: Map<employee_code, { department, fullName }>  (from reporting-v2)
 */
function buildWeeklyReportData(tasks, orgIndex, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const period = computeWeeklyPeriod(now);
  const list = Array.isArray(tasks) ? tasks : [];

  const deptOf = (t) => {
    const p = t.primary_employee_code && orgIndex && orgIndex.get ? orgIndex.get(t.primary_employee_code) : null;
    return (p && p.department) ? p.department : reportingV2.UNASSIGNED_DEPARTMENT_LABEL;
  };

  const cur = windowCounts(list, period);
  const prv = windowCounts(list, period.prev);

  const openTasks = list.filter(isOpen);
  const overdueNow = openTasks.filter((t) => overdueAt(t, now));
  const overdueCarried = openTasks.filter((t) => ms(t.deadline) != null && ms(t.deadline) < period.startMs);
  const overdue7d = openTasks.filter((t) => ms(t.deadline) != null && ms(t.deadline) < now - STALE_DAYS * DAY_MS);
  const dueNext7 = openTasks.filter((t) => { const dl = ms(t.deadline); return dl != null && dl >= now && dl <= now + STALE_DAYS * DAY_MS; });
  const dueNext7Stale = dueNext7.filter((t) => isStale(t, now));

  // A. KPI
  const kpi = {
    activity: { value: cur.activity, delta: deltaStr(cur.activity, prv.activity), comparable: true },
    completed: { value: cur.completed, delta: deltaStr(cur.completed, prv.completed), comparable: true },
    completedLate: { value: cur.completedLate, delta: deltaStr(cur.completedLate, prv.completedLate), comparable: true },
    inProgress: { value: openTasks.filter((t) => !overdueAt(t, now)).length, delta: null, comparable: false }, // current snapshot
    overdue: { value: overdueNow.length, delta: null, comparable: false }, // current snapshot
  };

  // B. attention signals — deterministic, max 5, only if the rule fires
  const signals = [];
  if (overdueNow.length) signals.push('Hiện có ' + overdueNow.length + ' công việc đang quá hạn.');
  if (overdueCarried.length) signals.push(overdueCarried.length + ' công việc quá hạn từ trước đầu tuần báo cáo (' + fmtDMY(period.startMs) + ').');
  if (overdue7d.length) signals.push(overdue7d.length + ' công việc đã quá hạn trên 7 ngày.');
  if (overdueNow.length) {
    const byDept = new Map();
    overdueNow.forEach((t) => { const k = deptOf(t); byDept.set(k, (byDept.get(k) || 0) + 1); });
    const top = [...byDept.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'vi'))[0];
    if (top && top[1] > 0) signals.push('Bộ phận nhiều việc quá hạn nhất: ' + top[0] + ' (' + top[1] + ').');
  }
  if (dueNext7Stale.length) signals.push(dueNext7Stale.length + ' công việc đến hạn trong 7 ngày tới nhưng ≥7 ngày chưa cập nhật.');
  const attention = signals.slice(0, ATTENTION_MAX);

  // C. top attention tasks — deterministic ranking
  //   tier 0: overdue + no recent activity   (rank by overdue days desc)
  //   tier 1: overdue                         (rank by overdue days desc)
  //   tier 2: due within 7 days + stale       (rank by nearest deadline asc)
  function candidate(t) {
    const dl = ms(t.deadline);
    if (dl == null) return null;
    const overdueDays = dl < now ? Math.floor((now - dl) / DAY_MS) : 0;
    const stale = isStale(t, now);
    const sd = staleDays(t, now);
    if (dl < now) {
      return {
        t, tier: stale ? 0 : 1, sortKey: -overdueDays, overdueDays, staleDays: sd,
        reason: 'Quá hạn ' + overdueDays + ' ngày' + (stale && sd != null ? ' · ' + sd + ' ngày chưa cập nhật' : ''),
      };
    }
    if (dl <= now + STALE_DAYS * DAY_MS && stale) {
      const dueInDays = Math.ceil((dl - now) / DAY_MS);
      return {
        t, tier: 2, sortKey: dueInDays, overdueDays: 0, staleDays: sd,
        reason: 'Đến hạn trong ' + dueInDays + ' ngày' + (sd != null ? ' · ' + sd + ' ngày chưa cập nhật' : ' · chưa có cập nhật'),
      };
    }
    return null;
  }
  const topTasks = openTasks
    .map(candidate)
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier || a.sortKey - b.sortKey || String(a.t.task_code).localeCompare(String(b.t.task_code)))
    .slice(0, TOP_TASKS_MAX)
    .map((c) => ({
      task_code: c.t.task_code || '', title: c.t.title || '',
      primary_employee_code: c.t.primary_employee_code || '',
      deadline: c.t.deadline || '', reason: c.reason,
    }));

  // D. by department
  const deptMap = new Map();
  for (const t of list) {
    const k = deptOf(t);
    if (!deptMap.has(k)) deptMap.set(k, { department: k, inProgress: 0, overdue: 0, completed: 0 });
    const row = deptMap.get(k);
    if (isOpen(t)) row.inProgress += 1;
    if (overdueAt(t, now)) row.overdue += 1;
    if (inWindow(t.completed_at, period) && isCompleted(t)) row.completed += 1;
  }
  const departments = [...deptMap.values()]
    .filter((r) => r.inProgress || r.overdue || r.completed)
    .sort((a, b) => b.overdue - a.overdue || b.inProgress - a.inProgress || String(a.department).localeCompare(String(b.department), 'vi'));

  // E. next week
  const nextWeek = [
    dueNext7.length + ' công việc đến hạn trong 7 ngày tới.',
    overdueCarried.length + ' công việc quá hạn chuyển tiếp (hạn đã qua, chưa hoàn thành).',
  ];
  if (dueNext7Stale.length) nextWeek.push(dueNext7Stale.length + ' trong số đó ≥7 ngày chưa cập nhật.');

  return {
    period,
    generatedAtMs: now,
    kpi,
    attention,
    topTasks,
    departments,
    nextWeek: nextWeek.slice(0, ATTENTION_MAX),
    totals: { tasksConsidered: list.length, open: openTasks.length },
    // explicit list of signals the current data model cannot reliably support
    notSupported: [
      'Xu hướng quá hạn theo bộ phận so với tuần trước (không có ảnh chụp trạng thái lịch sử theo bộ phận trong nguồn Reporting V2).',
      '"Đang thực hiện" và "Quá hạn" của tuần trước (population là ảnh chụp trạng thái hiện tại, không tái dựng được trạng thái quá khứ) — hiển thị số hiện tại, không so sánh.',
    ],
  };
}

// ---------------------------------------------------------------------------
// RENDER — email-safe HTML, same PHF Task family as transactional mail.
// ---------------------------------------------------------------------------
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDeadline(v) {
  const x = ms(v);
  if (x == null) return '—';
  return fmtDMY(x);
}

function kpiRow(label, cell) {
  const delta = cell.comparable
    ? '<span style="font-size:12px;color:#6b7280;">' + esc(cell.delta) + ' vs tuần trước</span>'
    : '<span style="font-size:12px;color:#9ca3af;">hiện tại</span>';
  return (
    '<tr>' +
      '<td style="padding:7px 12px 7px 0;font-size:13px;color:#374151;">' + esc(label) + '</td>' +
      '<td style="padding:7px 12px 7px 0;font-size:15px;font-weight:800;color:#111827;text-align:right;white-space:nowrap;">' + esc(String(cell.value)) + '</td>' +
      '<td style="padding:7px 0;text-align:right;white-space:nowrap;">' + delta + '</td>' +
    '</tr>'
  );
}

function sectionTitle(letter, text) {
  return '<div style="margin:22px 0 8px;font-size:12px;font-weight:800;letter-spacing:0.6px;color:#0f172a;text-transform:uppercase;">' + esc(letter + '. ' + text) + '</div>';
}
function bullets(lines) {
  if (!lines.length) return '<p style="margin:0;font-size:13px;color:#6b7280;">Không có tín hiệu nào theo quy tắc hiện tại.</p>';
  return '<ul style="margin:0;padding-left:18px;">' + lines.map((l) => '<li style="font-size:13px;color:#374151;line-height:1.7;">' + esc(l) + '</li>').join('') + '</ul>';
}

function renderWeeklyReport(data) {
  const d = data || {};
  const period = d.period || computeWeeklyPeriod(Date.now());
  const subject = 'Báo cáo công việc tuần ' + period.label;

  const kpiTable =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border-top:1px solid #e5e7eb;">' +
    kpiRow('Công việc có hoạt động trong tuần', d.kpi.activity) +
    kpiRow('Hoàn thành', d.kpi.completed) +
    kpiRow('Hoàn thành trễ', d.kpi.completedLate) +
    kpiRow('Đang thực hiện', d.kpi.inProgress) +
    kpiRow('Quá hạn', d.kpi.overdue) +
    '</table>';

  const topTasksHtml = (d.topTasks && d.topTasks.length)
    ? d.topTasks.map((t) => (
        '<tr>' +
          '<td style="padding:8px 10px 8px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">' + esc(t.task_code) + '</td>' +
          '<td style="padding:8px 0;font-size:13px;color:#111827;vertical-align:top;">' +
            '<b>' + esc(t.title) + '</b>' +
            '<div style="font-size:12px;color:#6b7280;margin-top:2px;">' +
              'Phụ trách: ' + esc(t.primary_employee_code || '—') + ' · Hạn: ' + esc(fmtDeadline(t.deadline)) +
            '</div>' +
            '<div style="font-size:12px;color:#b91c1c;margin-top:2px;">' + esc(t.reason) + '</div>' +
          '</td>' +
        '</tr>'
      )).join('')
    : '<tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">Không có công việc nào cần chú ý ngay theo quy tắc hiện tại.</td></tr>';

  const deptRows = (d.departments && d.departments.length)
    ? d.departments.map((r) => (
        '<tr>' +
          '<td style="padding:6px 10px 6px 0;font-size:13px;color:#111827;">' + esc(r.department) + '</td>' +
          '<td style="padding:6px 10px;font-size:13px;color:#111827;text-align:right;">' + esc(String(r.inProgress)) + '</td>' +
          '<td style="padding:6px 10px;font-size:13px;color:' + (r.overdue ? '#b91c1c' : '#111827') + ';text-align:right;font-weight:' + (r.overdue ? '700' : '400') + ';">' + esc(String(r.overdue)) + '</td>' +
          '<td style="padding:6px 0 6px 10px;font-size:13px;color:#111827;text-align:right;">' + esc(String(r.completed)) + '</td>' +
        '</tr>'
      )).join('')
    : '<tr><td colspan="4" style="padding:6px 0;font-size:13px;color:#6b7280;">Chưa có dữ liệu theo bộ phận.</td></tr>';

  const html =
'<div style="background:#f3f4f6;margin:0;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">' +
    '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">' +
      '<tr><td style="background:#0f172a;padding:16px 24px;">' +
        '<div style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:2.5px;">PHF TASK</div>' +
        '<div style="color:#cbd5e1;font-size:13px;font-weight:700;margin-top:6px;letter-spacing:0.4px;">BÁO CÁO CÔNG VIỆC TUẦN</div>' +
        '<div style="color:#94a3b8;font-size:12px;margin-top:2px;">' + esc(period.label) + '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:20px 24px 24px;">' +
        sectionTitle('A', 'Tình hình tuần qua') + kpiTable +
        sectionTitle('B', 'Điểm cần chú ý') + bullets(d.attention || []) +
        sectionTitle('C', 'Công việc cần nhìn ngay') +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border-top:1px solid #e5e7eb;">' + topTasksHtml + '</table>' +
        sectionTitle('D', 'Theo bộ phận') +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">' +
          '<tr>' +
            '<th style="padding:6px 10px 6px 0;font-size:11px;color:#6b7280;text-align:left;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Bộ phận</th>' +
            '<th style="padding:6px 10px;font-size:11px;color:#6b7280;text-align:right;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Đang làm</th>' +
            '<th style="padding:6px 10px;font-size:11px;color:#6b7280;text-align:right;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Quá hạn</th>' +
            '<th style="padding:6px 0 6px 10px;font-size:11px;color:#6b7280;text-align:right;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Hoàn thành</th>' +
          '</tr>' + deptRows +
        '</table>' +
        sectionTitle('E', 'Tuần tới cần theo dõi') + bullets(d.nextWeek || []) +
        '<div style="margin-top:24px;">' +
          '<a href="' + esc(BASE_URL + '/task') + '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:0.4px;padding:11px 22px;border-radius:8px;">MỞ PHF TASK — XEM BÁO CÁO CHI TIẾT</a>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:14px 24px 20px;background:#f9fafb;border-top:1px solid #e5e7eb;">' +
        '<div style="font-size:11px;color:#9ca3af;line-height:1.5;">' + esc(FOOTER_TEXT) +
        ' · Kỳ báo cáo: ' + esc(period.label) + ' (Asia/Ho_Chi_Minh). Mọi con số và tín hiệu đều tính theo quy tắc cố định từ dữ liệu công việc.</div>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table>' +
'</div>';

  return { subject, html };
}

// ---------------------------------------------------------------------------
// GENERATOR — read canonical data, render, enqueue (never sends).
// ---------------------------------------------------------------------------
function systemAdminSession() {
  return {
    role: 'admin',
    sub: 'system-task-weekly-report',
    account: { id: 'system-task-weekly-report', role: 'admin', name: 'PHF Task Weekly Report', employeeCode: 'SYSTEM' },
  };
}

async function runWeeklyReport(options = {}) {
  const now = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const period = computeWeeklyPeriod(now);
  const summary = {
    envEnabled: isWeeklyReportEnvEnabled(),
    bridgeEnabled: isMailBridgeEnabled(),
    period: { label: period.label, startKey: period.startKey },
    weeklySettingEnabled: false, recipients: 0, enqueued: 0, skippedExisting: 0,
  };
  if (!summary.envEnabled) { summary.note = 'PHF_TASK_WEEKLY_REPORT_ENABLED != true'; return summary; }
  if (!summary.bridgeEnabled) { summary.note = 'PHF_TASK_WRITE_BRIDGE_ENABLED != true'; return summary; }

  let settings;
  try { settings = await bridgeGetMailSettings(); }
  catch (err) { summary.note = 'mail-settings read failed: ' + (err && err.message); return summary; }
  summary.weeklySettingEnabled = !!(settings && settings.weeklyReportEnabled);
  if (!settings || settings.schemaReady === false) { summary.note = 'mail settings schema not applied'; return summary; }
  if (!summary.weeklySettingEnabled) { summary.note = 'task.mail_settings.weekly_report_enabled = false'; return summary; }

  const enabledRecipients = (settings.recipients || []).filter((r) => r.isEnabled && r.email);
  summary.recipients = enabledRecipients.length;
  if (!enabledRecipients.length) { summary.note = 'no enabled recipients'; return summary; }

  // canonical data — same entry the Overview UI uses; a system-admin session
  // resolves to all_company scope (see task-overview-query-descriptor-builder).
  const ctx = await reportingV2.resolveOverviewContext(systemAdminSession(), {});
  const orgIndex = await reportingV2.orgIndexByCode();
  const data = buildWeeklyReportData(ctx.tasks || [], orgIndex, now);
  const rendered = renderWeeklyReport(data);

  const res = await bridgeEnqueueWeeklyReport({
    periodKey: period.startKey,
    periodLabel: period.label,
    subject: rendered.subject,
    html: rendered.html,
    recipients: enabledRecipients.map((r) => ({ email: r.email, label: r.label || '' })),
  });
  summary.enqueued = (res && res.inserted) || 0;
  summary.skippedExisting = (res && res.skippedExisting) || 0;
  summary.tasksConsidered = data.totals.tasksConsidered;
  return summary;
}

// Admin preview — renders HTML from live data, NEVER enqueues, NEVER sends.
async function previewWeeklyReport(options = {}) {
  const now = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const ctx = await reportingV2.resolveOverviewContext(systemAdminSession(), {});
  const orgIndex = await reportingV2.orgIndexByCode();
  const data = buildWeeklyReportData(ctx.tasks || [], orgIndex, now);
  const rendered = renderWeeklyReport(data);
  return { subject: rendered.subject, html: rendered.html, period: data.period, notSupported: data.notSupported };
}

module.exports = {
  isWeeklyReportEnvEnabled,
  computeWeeklyPeriod,
  buildWeeklyReportData,
  renderWeeklyReport,
  runWeeklyReport,
  previewWeeklyReport,
  STALE_DAYS,
};
