'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 — the 8 transactional email templates (Vietnamese).
 *
 * renderTaskMail({ templateKey, payload }) -> { subject, html } | null
 *
 * ONE consistent layout for every transactional template:
 *   - header  "PHF TASK"
 *   - a per-event main heading
 *   - the TASK TITLE, prominent
 *   - one concise message line
 *   - a field grid — action / status info FIRST, secondary metadata after
 *   - (new task / proposal only) a "Nội dung công việc" block
 *   - exactly one primary CTA: "MỞ PHF TASK"  (absolute deep link)
 *   - footer: "Email được gửi tự động từ hệ thống PHF Task."
 *
 * Email-safe: table layout, inline CSS, no JS, no SVG, no remote fonts. All
 * dynamic values are HTML-escaped; dates render in Asia/Ho_Chi_Minh. The task
 * code shown is always the CURRENT code from the payload snapshot (CV-xxxx /
 * CV-LG-xxxx) — never a fabricated legacy PHF-* code.
 *
 * templateKey values come from services/phf-hr-api/lib/task-mail-contract.js
 * TEMPLATE_KEYS and are stored verbatim on task.mail_outbox.template_key.
 * This module makes NO business decision — it only renders an already-decided row.
 */

const BASE_URL = String(process.env.TASK_MAIL_BASE_URL || 'https://hr.phuhoafresh.info.vn').trim().replace(/\/$/, '');
const FOOTER_TEXT = 'Email được gửi tự động từ hệ thống PHF Task.';
const CTA_TEXT = 'MỞ PHF TASK';

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

// "trễ N ngày M giờ" from deadline -> completed_at, only when BOTH parse and
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

function fieldRows(pairs) {
  return pairs
    .filter((p) => p && p[1] != null && String(p[1]).trim() !== '')
    .map((p) => (
      '<tr>' +
        '<td style="padding:7px 14px 7px 0;color:#6b7280;font-size:13px;line-height:1.4;white-space:nowrap;vertical-align:top;">' + esc(p[0]) + '</td>' +
        '<td style="padding:7px 0;color:#111827;font-size:13px;line-height:1.4;font-weight:600;vertical-align:top;">' +
          (p[2] === 'strong'
            ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;padding:2px 8px;border-radius:6px;">' + esc(p[1]) + '</span>'
            : esc(p[1])) +
        '</td>' +
      '</tr>'
    ))
    .join('');
}

function contentBlock(label, content) {
  const c = String(content == null ? '' : content).trim();
  if (!c) return '';
  return (
    '<div style="margin-top:18px;">' +
      '<div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">' + esc(label) + '</div>' +
      '<div style="font-size:13px;color:#374151;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;">' + esc(c) + '</div>' +
    '</div>'
  );
}

function shell({ heading, headingColor, title, message, rows, extra, taskId }) {
  return (
'<!-- PHF Task transactional mail -->' +
'<div style="background:#f3f4f6;margin:0;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">' +
      '<tr><td style="background:#0f172a;padding:14px 24px;">' +
        '<span style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:2.5px;">PHF TASK</span>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 24px 8px;">' +
        '<div style="font-size:15px;font-weight:800;color:' + (headingColor || '#0f172a') + ';letter-spacing:0.2px;">' + esc(heading) + '</div>' +
        '<div style="font-size:19px;font-weight:800;color:#111827;line-height:1.35;margin:8px 0 0;word-break:break-word;">' + esc(title) + '</div>' +
        (message ? '<p style="margin:10px 0 0;font-size:13px;color:#4b5563;line-height:1.55;">' + esc(message) + '</p>' : '') +
      '</td></tr>' +
      '<tr><td style="padding:8px 24px 0;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border-top:1px solid #e5e7eb;margin-top:12px;">' + rows + '</table>' +
        (extra || '') +
      '</td></tr>' +
      '<tr><td style="padding:22px 24px 4px;">' +
        '<a href="' + esc(deepLink(taskId)) + '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:0.5px;padding:11px 22px;border-radius:8px;">' + CTA_TEXT + '</a>' +
      '</td></tr>' +
      '<tr><td style="padding:16px 24px 20px;">' +
        '<div style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;line-height:1.5;">' + esc(FOOTER_TEXT) + '</div>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table>' +
'</div>'
  );
}

function codePrefix(code) { return code ? ('[' + code + '] ') : ''; }
function titleOr(p, fallback) { return String(p.title || '').trim() || fallback; }

const RENDERERS = {
  // 1
  TASK_NEW(p) {
    return {
      subject: codePrefix(p.task_code) + 'Công việc mới: ' + titleOr(p, 'công việc mới'),
      html: shell({
        heading: 'Bạn có công việc mới',
        title: titleOr(p, 'Công việc mới'),
        message: 'Bạn vừa được giao một công việc mới trên PHF Task.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Mã công việc', p.task_code],
          ['Người giao', p.assigner_employee_code],
          ['Người nhận', p.primary_employee_code],
          ['Bắt đầu', fmtDateTime(p.start_at)],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
        ]),
        extra: contentBlock('Nội dung công việc', p.content),
      }),
    };
  },
  // 2
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
          ['Mã đề xuất', p.task_code],
          ['Người đề xuất', p.creator_employee_code],
          ['Người nhận đề xuất', p.recipient_employee_code],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
        ]),
        extra: contentBlock('Nội dung đề xuất', p.content),
      }),
    };
  },
  // 3
  TASK_DEADLINE_EARLIER(p) {
    return {
      subject: codePrefix(p.task_code) + 'Deadline được rút ngắn: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Deadline được rút ngắn',
        headingColor: '#b45309',
        title: titleOr(p, 'Công việc'),
        message: 'Hạn hoàn thành của công việc này đã được điều chỉnh sớm hơn. Vui lòng xem lại kế hoạch thực hiện.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Hạn mới', fmtDateTime(p.new_deadline), 'strong'],
          ['Hạn cũ', fmtDateTime(p.old_deadline)],
          ['Mã công việc', p.task_code],
          ['Người phụ trách', p.primary_employee_code],
        ]),
      }),
    };
  },
  // 4
  TASK_TRANSFERRED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Chuyển giao công việc: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Bạn được chuyển giao công việc',
        headingColor: '#0e7490',
        title: titleOr(p, 'Công việc'),
        message: 'Bạn vừa được chuyển làm người phụ trách chính của công việc này.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người phụ trách mới', p.primary_employee_code],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Mã công việc', p.task_code],
          ['Người giao', p.assigner_employee_code],
        ]),
      }),
    };
  },
  // 5
  TASK_COMPLETED(p) {
    return {
      subject: codePrefix(p.task_code) + 'Hoàn thành: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'Công việc đã hoàn thành',
        headingColor: '#15803d',
        title: titleOr(p, 'Công việc'),
        message: 'Công việc bạn giao đã được báo hoàn thành.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Người hoàn thành', p.primary_employee_code],
          ['Thời điểm hoàn thành', fmtDateTime(p.completed_at)],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Mã công việc', p.task_code],
        ]),
      }),
    };
  },
  // 6
  TASK_COMPLETED_LATE(p) {
    const lateBy = fmtLateBy(p.deadline, p.completed_at);
    return {
      subject: codePrefix(p.task_code) + 'Hoàn thành trễ: ' + titleOr(p, 'công việc'),
      html: shell({
        heading: 'HOÀN THÀNH TRỄ',
        headingColor: '#b91c1c',
        title: titleOr(p, 'Công việc'),
        message: 'Công việc bạn giao đã được báo hoàn thành, nhưng sau hạn.',
        taskId: p.task_id,
        rows: fieldRows([
          ['Mức trễ', lateBy, 'strong'],
          ['Người hoàn thành', p.primary_employee_code],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Thời điểm hoàn thành', fmtDateTime(p.completed_at)],
          ['Mã công việc', p.task_code],
        ]),
      }),
    };
  },
  // 7
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
          ['Mã công việc', p.task_code],
          ['Người thực hiện', p.actor_name],
          ['Người giao', p.assigner_employee_code],
          ['Lý do', p.reason],
        ]),
      }),
    };
  },
  // 8
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
          ['Mã công việc', p.task_code],
          ['Hạn hoàn thành', fmtDateTime(p.deadline)],
          ['Người thực hiện', p.actor_name],
          ['Người giao', p.assigner_employee_code],
        ]),
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

module.exports = { renderTaskMail, TEMPLATE_RENDERERS: Object.keys(RENDERERS), BASE_URL, fmtLateBy };
