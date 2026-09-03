'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 — the 8 transactional email templates (Vietnamese).
 *
 * renderTaskMail({ templateKey, payload }) -> { subject, html } | null
 *
 * ONE consistent PHF-brand shell for every transactional template:
 *   - header  — the canonical PHUHOA FRESH logo (assets/logo/phf-logo.png,
 *               reused verbatim, never redrawn) on a clean white bar + "PHF TASK"
 *   - a per-event heading, tinted only lightly by situation colour
 *   - the TASK TITLE, prominent
 *   - one concise message line
 *   - (change events) a "before -> after" highlight strip
 *   - a field grid — action / status info FIRST, secondary metadata after
 *   - a "Nội dung công việc / đề xuất" block
 *   - exactly one primary CTA: "MỞ PHF TASK"  (absolute deep link)
 *   - footer: sent automatically / do not reply
 *
 * Email-safe: table layout, inline CSS, no JS, no SVG, no remote fonts. The only
 * remote asset is the brand logo, served from the SAME app base as the deep
 * link (TASK_MAIL_BASE_URL) — no hardcoded production host. All dynamic values
 * are HTML-escaped; dates render in Asia/Ho_Chi_Minh. The task code shown is
 * always the CURRENT code from the payload snapshot (CV-xxxx / CV-LG-xxxx) —
 * never a fabricated legacy PHF-* code.
 *
 * Font: the exact PHF Task production stack (assets/css/phf-task.css
 * --phft-font-family). Inter is not loaded remotely — email clients fall back
 * through the same system stack the app itself uses.
 *
 * templateKey values come from services/phf-hr-api/lib/task-mail-contract.js
 * TEMPLATE_KEYS and are stored verbatim on task.mail_outbox.template_key.
 * This module makes NO business decision — it only renders an already-decided row.
 *
 * Person fields render as `<x>_name || <x>_employee_code` — the drainer injects
 * `<x>_name` (canonical People Master display name) before calling this module;
 * when it is absent (account-only actor, unsynced profile) the bare code shows.
 */

const BASE_URL = String(process.env.TASK_MAIL_BASE_URL || 'https://hr.phuhoafresh.info.vn').trim().replace(/\/$/, '');
const LOGO_URL = BASE_URL + '/assets/logo/phf-logo.png';
const FOOTER_LINE_1 = 'Email được gửi tự động từ hệ thống PHF Task.';
const FOOTER_LINE_2 = 'Không trả lời email này.';
const CTA_TEXT = 'MỞ PHF TASK';

// The exact PHF Task production font stack (assets/css/phf-task.css:9).
const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif';

// PHF brand — one identity for all 8 mails. Situation colour is a light accent
// on the heading only, never a per-mail palette.
const BRAND_GREEN = '#0e5b43';   // logo / wordmark green
const CTA_GREEN = '#0f7a43';     // approved CTA fill (--phft-green family)
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e2ebe5';
const PAGE_BG = '#f4f6f5';

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(String(v));
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch (_e) {
    return d.toISOString();
  }
}

// "Trễ N ngày M giờ" from deadline -> completed_at, only when BOTH parse and
// completed_at is actually after deadline. Never negative, never fabricated.
function fmtLateBy(deadline, completedAt) {
  const dl = Date.parse(deadline);
  const done = Date.parse(completedAt);
  if (!Number.isFinite(dl) || !Number.isFinite(done) || done <= dl) return '';
  let mins = Math.floor((done - dl) / 60000);
  const days = Math.floor(mins / 1440); mins -= days * 1440;
  const hours = Math.floor(mins / 60); mins -= hours * 60;
  const parts = [];
  if (days) parts.push(days + ' ngày');
  if (hours) parts.push(hours + ' giờ');
  if (!days && !hours) parts.push((mins || 1) + ' phút');
  return 'Trễ ' + parts.join(' ');
}

function deepLink(taskId) {
  return taskId ? (BASE_URL + '/task?task=' + encodeURIComponent(taskId)) : (BASE_URL + '/task');
}

// person(payload, 'assigner') -> display name, falling back to the raw code.
function person(p, key) {
  const name = String((p && p[key + '_name']) || '').trim();
  if (name) return name;
  return String((p && p[key + '_employee_code']) || '').trim();
}

function fieldRows(pairs) {
  return pairs
    .filter((p) => p && p[1] != null && String(p[1]).trim() !== '')
    .map((p) => (
      '<tr>' +
        '<td style="padding:8px 16px 8px 0;color:' + MUTED + ';font-size:13px;line-height:1.45;white-space:nowrap;vertical-align:top;">' + esc(p[0]) + '</td>' +
        '<td style="padding:8px 0;color:' + INK + ';font-size:13px;line-height:1.45;font-weight:600;vertical-align:top;">' +
          (p[2] === 'strong'
            ? '<span style="display:inline-block;background:#e7f5ec;color:#0b6a3a;font-weight:700;padding:2px 9px;border-radius:6px;">' + esc(p[1]) + '</span>'
            : esc(p[1])) +
        '</td>' +
      '</tr>'
    ))
    .join('');
}

// "before -> after" strip for the change events (deadline earlier, transfer).
function changeStrip(label, before, after) {
  const b = String(before == null ? '' : before).trim();
  const a = String(after == null ? '' : after).trim();
  if (!b && !a) return '';
  return (
    '<div style="margin-top:16px;border:1px solid ' + LINE + ';border-radius:9px;background:#f7faf8;padding:12px 14px;">' +
      '<div style="font-size:11px;font-weight:700;color:' + MUTED + ';text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">' + esc(label) + '</div>' +
      '<div style="font-size:14px;color:' + INK + ';line-height:1.5;">' +
        '<span style="color:' + MUTED + ';text-decoration:line-through;">' + esc(b || '—') + '</span>' +
        '<span style="color:#9aa4a0;padding:0 10px;">&#8594;</span>' +
        '<span style="font-weight:700;">' + esc(a || '—') + '</span>' +
      '</div>' +
    '</div>'
  );
}

function contentBlock(label, content) {
  const c = String(content == null ? '' : content).trim();
  if (!c) return '';
  return (
    '<div style="margin-top:18px;">' +
      '<div style="font-size:12px;font-weight:700;color:' + MUTED + ';text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">' + esc(label) + '</div>' +
      '<div style="font-size:13px;color:#374151;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;">' + esc(c) + '</div>' +
    '</div>'
  );
}

function statusChip(label) {
  if (!label) return '';
  return '<span style="display:inline-block;margin-top:8px;background:#fdf1e2;color:#8a4b06;font-size:11px;font-weight:700;letter-spacing:0.3px;padding:3px 10px;border-radius:999px;">' + esc(label) + '</span>';
}

function shell({ heading, headingColor, chip, title, message, strip, rows, extra, taskId }) {
  return (
'<!-- PHF Task transactional mail -->' +
'<div style="background:' + PAGE_BG + ';margin:0;padding:24px 12px;font-family:' + FONT_STACK + ';">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ' + LINE + ';">' +
      '<tr><td style="background:#ffffff;padding:18px 24px;border-bottom:1px solid ' + LINE + ';">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' +
          '<td style="vertical-align:middle;padding-right:12px;">' +
            '<img src="' + esc(LOGO_URL) + '" alt="PHUHOA FRESH" width="132" style="display:block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;">' +
          '</td>' +
          '<td style="vertical-align:middle;border-left:1px solid ' + LINE + ';padding-left:12px;">' +
            '<span style="color:' + BRAND_GREEN + ';font-size:13px;font-weight:800;letter-spacing:2px;">PHF TASK</span>' +
          '</td>' +
        '</tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 24px 8px;">' +
        '<div style="font-size:15px;font-weight:800;color:' + (headingColor || BRAND_GREEN) + ';letter-spacing:0.2px;">' + esc(heading) + '</div>' +
        (chip ? statusChip(chip) : '') +
        '<div style="font-size:19px;font-weight:700;color:' + INK + ';line-height:1.35;margin:8px 0 0;word-break:break-word;">' + esc(title) + '</div>' +
        (message ? '<p style="margin:10px 0 0;font-size:13px;color:#4b5563;line-height:1.55;">' + esc(message) + '</p>' : '') +
        (strip || '') +
      '</td></tr>' +
      '<tr><td style="padding:8px 24px 0;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border-top:1px solid #e5e7eb;margin-top:12px;">' + rows + '</table>' +
        (extra || '') +
      '</td></tr>' +
      '<tr><td style="padding:22px 24px 4px;">' +
        '<a href="' + esc(deepLink(taskId)) + '" style="display:inline-block;background:' + CTA_GREEN + ';color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.5px;padding:12px 24px;border-radius:8px;">' + CTA_TEXT + '</a>' +
      '</td></tr>' +
      '<tr><td style="padding:16px 24px 20px;">' +
        '<div style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;line-height:1.6;">' +
          esc(FOOTER_LINE_1) + '<br>' + esc(FOOTER_LINE_2) +
        '</div>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table>' +
'</div>'
  );
}

function codePrefix(code) { return code ? ('[' + code + '] ') : ''; }
function titleOr(p, fallback) { return String(p.title || '').trim() || fallback; }

const RENDERERS = {
  // 1 — NEW TASK. Người giao + Hạn hoàn thành lead; mã công việc after.
  TASK_NEW(p) {
    return {
      subject: codePrefix(p.task_code) + 'Công việc mới: ' + titleOr(p, 'công việc mới'),
      html: shell({
        heading: 'Bạn có công việc mới',
        title: titleOr(p, 'Công việc mới'),
        message: 'Bạn vừa được giao một công việc mới trên PHF Task.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người giao', person(p, 'assigner')],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Bắt đầu', fmtDateTime(p.start_at)],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 2 — NEW PROPOSAL.
  PROPOSAL_NEW(p) {
    return {
      subject: codePrefix(p.task_code) + 'Đề xuất mới: ' + titleOr(p, 'đề xuất mới'),
      html: shell({
        heading: 'Bạn có đề xuất mới',
        headingColor: '#6d28d9',
        title: titleOr(p, 'Đề xuất mới'),
        message: 'Bạn nhận được một đề xuất công việc trên PHF Task. Vui lòng mở để xem và phản hồi.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người đề xuất', person(p, 'creator')],
          ['Hạn đề xuất', fmtDateTime(p.deadline)],
          ['Mã đề xuất', p.task_code],
        ]),
        extra: contentBlock('Nội dung đề xuất', p.content),
      }),
    };
  },
  // 3 — DEADLINE EARLIER. "Hạn cũ -> Hạn mới" is the headline change.
  TASK_DEADLINE_EARLIER(p) {
    return {
      subject: codePrefix(p.task_code) + 'Deadline được rút ngắn: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Deadline được rút ngắn',
        headingColor: '#b45309',
        title: titleOr(p, 'Công việc'),
        message: 'Hạn hoàn thành của công việc này đã được điều chỉnh sớm hơn. Vui lòng xem lại kế hoạch thực hiện.',
        taskId: p.task_id,
        strip: changeStrip('Hạn hoàn thành', fmtDateTime(p.old_deadline), fmtDateTime(p.new_deadline)),
        rows: fieldRows([
          ['Người thay đổi', person(p, 'actor')],
          ['Người phụ trách', person(p, 'primary')],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 4 — TRANSFERRED. "Người cũ -> Người mới" is the headline change.
  TASK_TRANSFERRED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Chuyển giao công việc: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Bạn được chuyển giao công việc',
        headingColor: '#0e7490',
        title: titleOr(p, 'Công việc'),
        message: 'Bạn vừa được chuyển làm người phụ trách chính của công việc này.',
        taskId: p.task_id,
        strip: changeStrip('Người thực hiện', person(p, 'from'), person(p, 'primary')),
        rows: fieldRows([
          ['Người chuyển', person(p, 'actor')],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 5 — COMPLETED on time.
  TASK_COMPLETED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Hoàn thành: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Công việc đã hoàn thành',
        headingColor: '#0f7a43',
        title: titleOr(p, 'Công việc'),
        message: 'Công việc bạn giao đã được báo hoàn thành.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người hoàn thành', person(p, 'primary')],
          ['Thời điểm hoàn thành', fmtDateTime(p.completed_at)],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 6 — COMPLETED late. Clear, not alarmist: amber heading + a small chip.
  TASK_COMPLETED_LATE(p) {
    const lateBy = fmtLateBy(p.deadline, p.completed_at);
    return {
      subject: codePrefix(p.task_code) + 'Hoàn thành trễ: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Công việc đã hoàn thành',
        headingColor: '#b45309',
        chip: 'Hoàn thành trễ',
        title: titleOr(p, 'Công việc'),
        message: 'Công việc bạn giao đã được báo hoàn thành, sau hạn.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người hoàn thành', person(p, 'primary')],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Thời điểm hoàn thành', fmtDateTime(p.completed_at)],
          ['Mức trễ', lateBy, 'strong'],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 7 — CANCELLED. "Lý do hủy" only when the payload carries a real reason.
  TASK_CANCELLED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Đã hủy công việc: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Công việc đã được hủy',
        headingColor: '#b91c1c',
        title: titleOr(p, 'Công việc'),
        message: 'Công việc bạn đang phụ trách đã được hủy.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người hủy', person(p, 'actor')],
          ['Thời điểm hủy', fmtDateTime(p.cancelled_at)],
          ['Lý do hủy', p.reason],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 8 — REOPENED. Uses the CURRENT deadline.
  TASK_REOPENED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Mở lại công việc: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Công việc đã được mở lại',
        headingColor: '#1d4ed8',
        title: titleOr(p, 'Công việc'),
        message: 'Một công việc đã hoàn thành hoặc đã hủy trước đó nay được mở lại và bạn vẫn là người phụ trách.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người mở lại', person(p, 'actor')],
          ['Thời điểm mở lại', fmtDateTime(p.reopened_at)],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Mã công việc', p.task_code],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
};

function renderTaskMail({ templateKey, payload } = {}) {
  const fn = RENDERERS[String(templateKey || '').trim()];
  if (!fn) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = fn(p);
  if (!out || !out.subject || !out.html) return null;
  return out;
}

module.exports = { renderTaskMail, TEMPLATE_RENDERERS: Object.keys(RENDERERS), BASE_URL, LOGO_URL, fmtLateBy };
