'use strict';
/*
 * Regression — B4: QUÁ HẠN ≠ KHÓA (in-memory + source-scan; no Production DB).
 *
 * Locked rule: deadline (từ snapshot của kỳ) chỉ để xác định đúng hạn/trễ, KHÔNG tự
 * khóa thao tác. Kỳ chưa Admin khóa -> quá hạn vẫn Tự đánh giá / Thẩm định được, có
 * dấu vết trễ (ai/lúc nào/trễ bao lâu) từ dữ liệu hiện hữu. Kỳ đã khóa -> chặn.
 * KHÔNG đổi công thức điểm, permission contract, RPC/schema. Điểm Checklist vẫn là
 * giá trị hệ thống, nhân viên không nhập/sửa.
 *
 *   node scripts/test-checklist-monthly-b4-overdue-not-lock.js
 */
const fs = require('fs');
const path = require('path');
const { lateDelta, reviewWindowState } = require('../api/_lib/checklist-monthly');

let failed = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); failed++; } else console.log('PASS: ' + m); };

const lib = fs.readFileSync(path.resolve(__dirname, '..', 'api/_lib/checklist-monthly.js'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');

// ---------- 1. lateDelta ----------
ok(lateDelta('2026-08-04T23:59:00+07:00', '2026-08-04T10:00:00+07:00').late === false, '1. Trong hạn -> late=false');
const d = lateDelta('2026-08-04T23:59:59+07:00', '2026-08-07T08:00:00+07:00');
ok(d.late === true && d.lateDays === 3, '1b. Trễ 3 ngày -> late=true, lateDays=3 (got ' + d.lateDays + ')');
ok(lateDelta('', '2026-08-07').late === false, '1c. Không có mốc hạn -> không coi là trễ');

// ---------- 2. reviewWindowState: quá hạn KHÔNG khóa khi kỳ chưa khóa ----------
const past = { reviewOpenAt: '2026-08-01T00:00:00+07:00', reviewDueAt: '2026-08-04T23:59:00+07:00' };
const wOpenOverdue = reviewWindowState(past, { status: 'waiting_review', self_submitted_at: '2026-08-02T09:00:00+07:00' }, 'open');
ok(wOpenOverdue.canReview === true, '2. waiting_review + quá hạn + kỳ open -> canReview=true (vẫn thẩm định được)');
ok(wOpenOverdue.late === true && wOpenOverdue.lateDays >= 1, '2b. Đánh dấu trễ + số ngày trễ');
ok(wOpenOverdue.state === 'overdue', '2c. state=overdue (để UI hiển thị)');

const wLocked = reviewWindowState(past, { status: 'waiting_review', self_submitted_at: '2026-08-02T09:00:00+07:00' }, 'locked');
ok(wLocked.canReview === false && wLocked.periodLocked === true, '3. Kỳ đã khóa -> canReview=false, periodLocked=true');

const wNotOpen = reviewWindowState({ reviewOpenAt: '2999-01-01T00:00:00+07:00', reviewDueAt: '2999-01-04T00:00:00+07:00' }, { status: 'waiting_review', self_submitted_at: '2026-08-02' }, 'open');
ok(wNotOpen.canReview === false && wNotOpen.state === 'not_open', '3b. Chưa tới giờ mở -> canReview=false');

const wSelfPending = reviewWindowState(past, { status: 'waiting_self', self_submitted_at: null }, 'open');
ok(wSelfPending.canReview === false && wSelfPending.state === 'waiting_self', '3c. NV chưa gửi tự đánh giá -> canReview=false, state=waiting_self');

const wReviewedLate = reviewWindowState(past, { status: 'reviewed', review_submitted_at: '2026-08-09T08:00:00+07:00' }, 'open');
ok(wReviewedLate.state === 'completed' && wReviewedLate.late === true && wReviewedLate.lateDays >= 1, '3d. Phiếu đã thẩm định trễ -> suy ra late + lateDays từ review_submitted_at vs review_due_at');

// ---------- 4. Server: bỏ khóa cứng theo thời hạn, thêm khóa theo kỳ ----------
ok(!/CHECKLIST_MONTHLY_SELF_WINDOW_CLOSED/.test(lib), '4. Đã bỏ CHECKLIST_MONTHLY_SELF_WINDOW_CLOSED (không chặn tự đánh giá vì quá hạn)');
ok(!/CHECKLIST_MONTHLY_REVIEW_WINDOW_CLOSED/.test(lib), '4b. Đã bỏ CHECKLIST_MONTHLY_REVIEW_WINDOW_CLOSED');
ok((lib.match(/CHECKLIST_MONTHLY_PERIOD_LOCKED/g) || []).length >= 2, '4c. Có chặn CHECKLIST_MONTHLY_PERIOD_LOCKED ở cả tự đánh giá và thẩm định');
ok(/if\(reviewWindow\.state==='not_open'\)fail/.test(lib) && /if\(reviewWindow\.state==='waiting_self'\)fail/.test(lib), '4d. saveMonthlyReview vẫn chặn: chưa tới giờ mở / NV chưa gửi tự đánh giá');
ok(/if\(!access\.canReview\|\|!allowed\)fail\('Quyền thẩm định đã thay đổi/.test(lib), '4e. saveMonthlyReview GIỮ NGUYÊN kiểm tra phạm vi thẩm định hiện tại (permission contract không đổi)');

// ---------- 5. Không tự khóa kỳ theo lịch (khóa là thao tác Admin thủ công) ----------
ok(!/Hệ thống tự khóa kỳ theo lịch cấu hình/.test(lib), '5. Bỏ auto-lock trong syncMonthlyCycle');
ok(/KHÔNG tự khóa kỳ theo lịch/.test(lib), '5b. Ghi chú rõ: khóa kỳ là thao tác thủ công của Admin');
ok(/function lock_checklist_monthly_period|lockMonthly/.test(lib), '5c. Hàm khóa kỳ thủ công (lockMonthly) vẫn còn cho Admin');

// ---------- 6. Điểm Checklist = giá trị hệ thống, nhân viên không nhập/sửa ----------
ok(/const rows=allRows\.filter\(r=>!isAutomaticSource\(r\.source,r\.name\)\),allowed=new Set\(rows\.map\(r=>r\.code\)\)/.test(lib), '6. saveMyMonthly chỉ nhận đáp án của tiêu chí KHÔNG tự động (loại bỏ mã Checklist tự động)');
ok(/patch=\{self_answers:clean,self_note[\s\S]{0,120}checklist_score:breakdown\.score/.test(lib), '6b. checklist_score luôn = breakdown.score (server tính), không lấy từ client');
ok(/is-system-locked/.test(app) && /🔒 Điểm hệ thống/.test(app) && /Tự động từ lỗi Checklist/.test(app), '6c. UI: ô Điểm Checklist ở Tự đánh giá hiển thị rõ là điểm hệ thống (primary value + "Điểm hệ thống" + "Tự động từ lỗi Checklist"), không có input');
ok(/data-phfck-self-value/.test(app) && !/automatic\?'<input[^>]*data-phfck-self-value/.test(app), '6d. UI: tiêu chí tự động KHÔNG render input cho nhân viên');

// ---------- 7. Công thức điểm không đổi ----------
ok(/checklist-score-engine/.test(lib) && !/SCORE_FORMULA_VERSION\s*=/.test(lib), '7. Không định nghĩa lại formula version trong lib này (vẫn import từ checklist-score-engine)');

// ---------- 8. UI: quá hạn vẫn thao tác được, phần khác không bị khóa theo ----------
ok(/canEdit:statusAllowed&&!periodLocked/.test(lib), '8. selfEditWindow.canEdit chỉ phụ thuộc trạng thái phiếu + kỳ chưa khóa (không phụ thuộc now<=due)');
ok(/phfck-notice is-late/.test(app), '8b. UI có banner "quá hạn · vẫn hoàn tất được"');
ok(/Kỳ đánh giá đã được khóa/.test(app), '8c. UI: chỉ khi KỲ bị khóa mới chuyển phiếu sang chỉ đọc');
ok(/nộp trễ '\+sl\.lateDays|nộp trễ \?/.test(app) || /nộp trễ/.test(app), '8d. UI: toast/nhãn nêu rõ "nộp trễ N ngày"');
ok(/thẩm định trễ|Thẩm định \(trễ\)|Đã thẩm định trễ/.test(app), '8e. UI Thẩm định: nhãn "trễ" hiển thị, nút vẫn bấm được');

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nALL PASS (B4 — quá hạn ≠ khóa; deadline chỉ để đo trễ; điểm Checklist hệ thống; không đổi formula/permission/RPC/schema)');
