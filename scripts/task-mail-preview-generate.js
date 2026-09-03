'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 — OFFLINE template preview generator.
 *
 * Renders the 8 transactional templates with SYNTHETIC demo data only (no real
 * employees, no emails, no secrets, no DB, no network, no BREVO_API_KEY) and
 * writes standalone HTML files to tmp/task-mail-preview/ (gitignored) for
 * visual review. Also writes an index.html linking all 8.
 *
 * Run: node scripts/task-mail-preview-generate.js
 */

const fs = require('fs');
const path = require('path');
const { renderTaskMail } = require('../api/_lib/task-mail-templates');

const OUT_DIR = path.resolve(__dirname, '..', 'tmp', 'task-mail-preview');

// ---- synthetic demo data (fake codes/names; no PII) ----------------------
const SHORT_TITLE = 'Kiểm kê kho vật tư chi nhánh Quận 7';
const LONG_TITLE = 'Rà soát và đối chiếu toàn bộ chứng từ nhập – xuất – tồn kho tháng 08/2026 của chi nhánh Quận 7, Quận Bình Thạnh và kho tổng, báo cáo chênh lệch trước 17:00';
const SHORT_CONTENT = 'Đếm thực tế, đối chiếu với phần mềm, lập biên bản chênh lệch (nếu có) và gửi Trưởng bộ phận.';
const LONG_CONTENT = [
  'Bước 1: In danh sách tồn kho hệ thống tại thời điểm 08:00.',
  'Bước 2: Đếm thực tế theo từng khu vực kệ (A1–A9, B1–B6), có 2 người ký xác nhận.',
  'Bước 3: Nhập số đếm vào biểu mẫu KK-2026-08, đối chiếu tự động.',
  'Bước 4: Với mỗi dòng chênh lệch > 2%, ghi chú nguyên nhân và đính kèm ảnh.',
  'Bước 5: Tổng hợp, ký biên bản, gửi Trưởng bộ phận và Kế toán kho trước 17:00 cùng ngày.',
].join('\n');

const D_START = '2026-09-04T01:00:00.000Z';   // 08:00 04/09/2026 (VN)
const D_DEADLINE = '2026-09-06T10:00:00.000Z'; // 17:00 06/09/2026 (VN)
const D_DONE_ONTIME = '2026-09-06T08:30:00.000Z';
const D_DONE_LATE = '2026-09-08T02:15:00.000Z'; // ~2 ngày 7 giờ trễ
const D_DEADLINE_OLD = '2026-09-12T10:00:00.000Z';

const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CODE = 'CV-2609-0042';
const LONG_CODE = 'CV-LG-1780735757518';

// SYNTHETIC display names — the drainer injects the real ones from People
// Master at send time; here we hand them in directly so the preview shows what
// a recipient actually sees (fullName, with the code as fallback).
function basePayload(over) {
  return Object.assign({
    task_id: TASK_ID, task_code: CODE, title: SHORT_TITLE, content: SHORT_CONTENT,
    assigner_employee_code: 'PHF002', assigner_name: 'Nguyễn Văn An',
    primary_employee_code: 'PHF041', primary_name: 'Lê Thị Bình',
    start_at: D_START, deadline: D_DEADLINE,
  }, over || {});
}

// [templateKey, "variant label", payload]
const CASES = [
  ['TASK_NEW', 'Điển hình', basePayload()],
  ['TASK_NEW', 'Tiêu đề + nội dung dài (kiểm tra xuống dòng)', basePayload({ task_code: LONG_CODE, title: LONG_TITLE, content: LONG_CONTENT })],

  ['PROPOSAL_NEW', 'Điển hình', basePayload({ creator_employee_code: 'PHF010', creator_name: 'Phạm Minh Cường', recipient_employee_code: 'PHF002', content: SHORT_CONTENT })],
  ['PROPOSAL_NEW', 'Tiêu đề dài, chưa có hạn', basePayload({ task_code: '', title: LONG_TITLE, deadline: '', creator_employee_code: 'PHF010', creator_name: 'Phạm Minh Cường', recipient_employee_code: 'PHF002', content: LONG_CONTENT })],

  ['TASK_DEADLINE_EARLIER', 'Rút ngắn 6 ngày', basePayload({ old_deadline: D_DEADLINE_OLD, new_deadline: D_DEADLINE, actor_employee_code: 'PHF002', actor_name: 'Nguyễn Văn An' })],

  ['TASK_TRANSFERRED', 'Điển hình', basePayload({ primary_employee_code: 'PHF076', primary_name: 'Đỗ Thị Em', from_employee_code: 'PHF041', from_name: 'Lê Thị Bình', actor_employee_code: 'PHF002', actor_name: 'Nguyễn Văn An' })],

  ['TASK_COMPLETED', 'Đúng hạn', basePayload({ completed_at: D_DONE_ONTIME })],

  ['TASK_COMPLETED_LATE', 'Trễ ~2 ngày 7 giờ', basePayload({ completed_at: D_DONE_LATE })],

  ['TASK_CANCELLED', 'Có người hủy + thời điểm + lý do', basePayload({ actor_employee_code: 'PHF002', actor_name: 'Trần Văn Vinh', cancelled_at: D_DONE_ONTIME, reason: 'Khách hàng hoãn đợt kiểm kê sang tháng sau.' })],
  ['TASK_CANCELLED', 'Không có lý do', basePayload({ actor_employee_code: 'PHF002', actor_name: 'Trần Văn Vinh', cancelled_at: D_DONE_ONTIME })],

  ['TASK_REOPENED', 'Điển hình', basePayload({ actor_employee_code: 'PHF002', actor_name: 'Nguyễn Thị Ngọc', reopened_at: D_DONE_LATE })],
];

function pageWrap(title, bodyInner) {
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{margin:0;background:#e5e7eb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
    '.pv-meta{max-width:600px;margin:0 auto;padding:18px 12px 4px;color:#374151;font-size:13px}' +
    '.pv-meta code{background:#fff;padding:1px 6px;border-radius:4px}</style></head><body>' +
    bodyInner + '</body></html>';
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // group cases by templateKey so we emit exactly 8 files
  const byKey = new Map();
  for (const [key, label, payload] of CASES) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ label, payload });
  }

  const order = ['TASK_NEW', 'PROPOSAL_NEW', 'TASK_DEADLINE_EARLIER', 'TASK_TRANSFERRED', 'TASK_COMPLETED', 'TASK_COMPLETED_LATE', 'TASK_CANCELLED', 'TASK_REOPENED'];
  const written = [];

  for (const key of order) {
    const variants = byKey.get(key) || [];
    let inner = '';
    let firstSubject = '';
    for (const v of variants) {
      const r = renderTaskMail({ templateKey: key, payload: v.payload });
      if (!r) throw new Error('renderTaskMail returned null for ' + key);
      if (!firstSubject) firstSubject = r.subject;
      inner +=
        '<div class="pv-meta"><strong>' + key + '</strong> — ' + v.label + '<br>' +
        'Subject: <code>' + r.subject.replace(/</g, '&lt;') + '</code></div>' +
        r.html;
    }
    const file = key.toLowerCase().replace(/_/g, '-') + '.html';
    fs.writeFileSync(path.join(OUT_DIR, file), pageWrap('PHF Task mail — ' + key, inner), 'utf8');
    written.push({ key, file, subject: firstSubject });
  }

  // ---- Increment 2: Weekly Report preview (synthetic canonical data) ----
  const { buildWeeklyReportData, renderWeeklyReport } = require('../api/_lib/task-weekly-report');
  const nowMs = Date.UTC(2026, 8, 14, 3, 0, 0); // Mon 14/09/2026 10:00 ICT
  const iso = (y, mo, d, h) => new Date(Date.UTC(y, mo, d, (h || 0) - 7)).toISOString(); // ICT wall -> UTC
  const orgIndex = new Map([
    ['PHF041', { department: 'Bộ phận bán hàng', fullName: 'Nguyễn Văn A' }],
    ['PHF076', { department: 'Bộ phận bán hàng', fullName: 'Trần Thị B' }],
    ['PHF010', { department: 'Kho vận', fullName: 'Lê Văn C' }],
    ['PHF028', { department: 'Kho vận', fullName: 'Phạm Thị D' }],
    ['PHF002', { department: 'Hành chính - Nhân sự', fullName: 'Vũ Văn E' }],
  ]);
  const T = (o) => Object.assign({
    task_id: 'x', task_code: 'CV-2609-0000', title: 'Việc', status: 'in_progress',
    primary_employee_code: 'PHF041', deadline: null, completed_at: null, on_time: null,
    created_at: iso(2026, 7, 20, 9), published_at: iso(2026, 7, 20, 10), last_progress_at: iso(2026, 8, 12, 9),
    progress_percent: 30,
  }, o);
  const weeklyTasks = [
    T({ task_code: 'CV-2609-0101', title: 'Kiểm kê kho Quận 7', status: 'completed', completed_at: iso(2026, 8, 10, 15), deadline: iso(2026, 8, 12, 17), on_time: true, primary_employee_code: 'PHF010' }),
    T({ task_code: 'CV-2609-0102', title: 'Đối chiếu công nợ tháng 8', status: 'completed', completed_at: iso(2026, 8, 11, 18), deadline: iso(2026, 8, 9, 17), on_time: false, primary_employee_code: 'PHF002' }),
    T({ task_code: 'CV-2609-0103', title: 'Chuẩn hoá quy trình đặt hàng nhà cung cấp và cập nhật biểu mẫu KH-08 cho toàn bộ chi nhánh khu vực phía Nam', status: 'in_progress', deadline: iso(2026, 8, 2, 17), last_progress_at: iso(2026, 7, 25, 9), primary_employee_code: 'PHF041' }),
    T({ task_code: 'CV-2609-0104', title: 'Xử lý khiếu nại khách hàng lô hàng 0812', status: 'in_progress', deadline: iso(2026, 8, 30, 17), last_progress_at: iso(2026, 8, 13, 9), primary_employee_code: 'PHF076' }),
    T({ task_code: 'CV-2609-0105', title: 'Tổng hợp báo cáo doanh số tuần', status: 'in_progress', deadline: iso(2026, 8, 16, 17), last_progress_at: iso(2026, 7, 30, 9), primary_employee_code: 'PHF041' }),
    T({ task_code: 'CV-2609-0106', title: 'Bảo trì xe nâng kho A', status: 'in_progress', deadline: iso(2026, 8, 5, 17), last_progress_at: null, primary_employee_code: 'PHF028' }),
    T({ task_code: 'CV-2609-0107', title: 'Cập nhật sổ tay nhân viên mới', status: 'in_progress', deadline: iso(2026, 8, 25, 17), last_progress_at: iso(2026, 8, 13, 9), primary_employee_code: 'PHF002' }),
    T({ task_code: 'CV-2609-0108', title: 'Nhập liệu tồn kho đầu kỳ', status: 'completed', completed_at: iso(2026, 8, 8, 12), deadline: iso(2026, 8, 8, 17), on_time: true, primary_employee_code: 'PHF010' }),
    T({ task_code: 'CV-2609-0109', title: 'Dọn dẹp khu vực đóng gói', status: 'cancelled', deadline: iso(2026, 8, 7, 17), primary_employee_code: 'PHF028' }),
    T({ task_code: 'CV-2609-0110', title: 'Việc chưa gán bộ phận', status: 'in_progress', deadline: iso(2026, 8, 3, 17), last_progress_at: iso(2026, 7, 20, 9), primary_employee_code: 'PHF999' }),
  ];
  const weeklyData = buildWeeklyReportData(weeklyTasks, orgIndex, nowMs);
  const weeklyRendered = renderWeeklyReport(weeklyData);
  fs.writeFileSync(path.join(OUT_DIR, 'weekly-report.html'), pageWrap('PHF Task — ' + weeklyRendered.subject,
    '<div class="pv-meta"><strong>WEEKLY_REPORT</strong> — synthetic canonical data (10 tasks, 3 bộ phận)<br>' +
    'Subject: <code>' + weeklyRendered.subject.replace(/</g, '&lt;') + '</code><br>' +
    'NOT_SUPPORTED: <code>' + (weeklyData.notSupported || []).join(' | ').replace(/</g, '&lt;') + '</code></div>' +
    weeklyRendered.html), 'utf8');
  written.push({ key: 'WEEKLY_REPORT', file: 'weekly-report.html', subject: weeklyRendered.subject });

  // index
  const idx = pageWrap('PHF Task Mail V1 — previews',
    '<div class="pv-meta"><h2 style="margin:8px 0">PHF Task Mail V1 — template previews</h2>' +
    '<p>Synthetic demo data only. No real employee/email/secret. Generated ' + new Date().toISOString() + '.</p>' +
    '<ol style="line-height:2">' +
    written.map((w) => '<li><a href="./' + w.file + '">' + w.key + '</a> — <code>' + w.subject.replace(/</g, '&lt;') + '</code></li>').join('') +
    '</ol></div>');
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), idx, 'utf8');

  console.log('Wrote ' + (written.length + 1) + ' files to ' + OUT_DIR);
  written.forEach((w) => console.log('  ' + w.file + '  ::  ' + w.subject));
  console.log('  index.html');
}

main();
