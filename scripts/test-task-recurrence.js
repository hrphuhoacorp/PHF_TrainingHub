'use strict';

/*
 * PHF Task — công việc lặp — test suite chính thức cho engine tính toán
 * thuần túy api/_lib/task-recurrence.js.
 *
 * MOCK TEST — KHÔNG PHẢI OFFICIAL DATA VERIFICATION. Không có DB, không có
 * Supabase, không network — toàn bộ là pure function trên input/output xác
 * định. Verify NGHIỆP VỤ NGÀY-THÁNG (không phải hành vi ghi dữ liệu thật).
 *
 * Các mục "runtime contract" (inactive Primary dừng sinh, inactive Related
 * bị loại khỏi kỳ mới, sửa lịch chỉ áp dụng tương lai, sửa instance không
 * ảnh hưởng lịch gốc, creator nghỉ việc không giết lịch) KHÔNG kiểm được ở
 * đây vì đó là hành vi tầng tích hợp DB (chưa tồn tại — xem migration
 * package CHƯA APPLY). Test file này chỉ cover phần date-math + chống trùng
 * + catch-up mà engine chịu trách nhiệm trực tiếp.
 */

const assert = require('assert');
const {
  resolveMonthlyDateKey, resolveYearlyDateKey, nextOccurrenceDateKey,
  firstOccurrenceDateKey, computeDurationMs, applyDurationFromDateKeyAndTime,
  isOccurrenceAllowedByEndCondition, isDateKeyPaused, generateOccurrencePlan,
  weekdayCodeOfDateKey
} = require('../api/_lib/task-recurrence');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

// ROLE label kept short: mỗi block dưới đây ánh xạ đúng 1 bullet trong mục 31.

// daily weekdays
{
  const rule = { frequency: 'daily', weekdays: ['T2', 'T4', 'T6'] };
  pass(weekdayCodeOfDateKey('2026-08-24') === 'T2', 'sanity: 24/08/2026 là Thứ Hai');
  pass(nextOccurrenceDateKey(rule, '2026-08-24') === '2026-08-26', 'daily weekdays: sau T2 (24/08) là T4 (26/08), bỏ qua T3');
  pass(nextOccurrenceDateKey(rule, '2026-08-26') === '2026-08-28', 'daily weekdays: sau T4 (26/08) là T6 (28/08)');
  pass(nextOccurrenceDateKey(rule, '2026-08-28') === '2026-08-31', 'daily weekdays: sau T6 (28/08) vòng qua tuần sau tới T2 (31/08)');
}

// monthly day 31 fallback + end-of-month
{
  pass(resolveMonthlyDateKey(2026, 4, 31) === '2026-04-30', 'monthly fallback: ngày 31 ở tháng 4 (30 ngày) → dời về 30/04');
  pass(resolveMonthlyDateKey(2026, 2, 31) === '2026-02-28', 'monthly fallback: ngày 31 ở tháng 2/2026 (không nhuận) → 28/02');
  pass(resolveMonthlyDateKey(2024, 2, 31) === '2024-02-29', 'monthly fallback: ngày 31 ở tháng 2/2024 (nhuận) → 29/02');
  pass(resolveMonthlyDateKey(2026, 1, 15) === '2026-01-15', 'monthly: ngày tồn tại giữ nguyên');
  pass(resolveMonthlyDateKey(2026, 4, 'end_of_month') === '2026-04-30', 'end-of-month: luôn dùng ngày cuối tháng thực tế (không tự đoán "30=cuối tháng")');
  pass(resolveMonthlyDateKey(2024, 2, 'end_of_month') === '2024-02-29', 'end-of-month: tháng 2 năm nhuận → 29/02');
  const ruleFixed31 = { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: 31 };
  pass(nextOccurrenceDateKey(ruleFixed31, '2026-01-31') === '2026-02-28', 'monthly fixed_day=31: kỳ sau Tháng 1 là Tháng 2 → fallback 28/02 (2026 không nhuận)');
  pass(nextOccurrenceDateKey(ruleFixed31, '2026-02-28') === '2026-03-31', 'monthly fixed_day=31: kỳ sau Tháng 2 là Tháng 3 (31 ngày) → đúng 31/03, không bị "dính" fallback tháng trước');
}

// yearly 29/02
{
  pass(resolveYearlyDateKey(2026, 2, 29) === '2026-02-28', 'yearly: 29/02 ở năm không nhuận (2026) → 28/02');
  pass(resolveYearlyDateKey(2024, 2, 29) === '2024-02-29', 'yearly: 29/02 ở năm nhuận (2024) → giữ đúng 29/02');
  const ruleYearly = { frequency: 'yearly', yearMonth: 2, yearDay: 29 };
  pass(nextOccurrenceDateKey(ruleYearly, '2024-02-29') === '2025-02-28', 'yearly 29/02: kỳ sau năm nhuận 2024 là 2025 (không nhuận) → 28/02');
  pass(nextOccurrenceDateKey(ruleYearly, '2025-02-28') === '2026-02-28', 'yearly 29/02: 2026 vẫn không nhuận → 28/02 (không tự "nhớ" đã lùi)');
  pass(nextOccurrenceDateKey(ruleYearly, '2027-02-28') === '2028-02-29', 'yearly 29/02: quay lại năm nhuận (2028) → đúng 29/02, không kẹt ở 28');
}

// duration preservation
{
  const durationMs = computeDurationMs('2026-08-22T01:00:00.000Z', '2026-08-23T03:00:00.000Z'); // 08:00->10:00 VN time, 26h
  pass(durationMs === 26 * 3600 * 1000, 'duration: Start 08:00 ngày 22, Deadline 10:00 ngày 23 (giờ VN) = 26 giờ');
  const applied = applyDurationFromDateKeyAndTime('2026-09-01', 1, 0, durationMs); // 08:00 VN = 01:00 UTC
  pass(new Date(applied.deadlineIso).getTime() - new Date(applied.startIso).getTime() === durationMs, 'duration preservation: kỳ sau vẫn giữ đúng 26 giờ giữa start/deadline');
  assert.throws(() => computeDurationMs('2026-08-23T00:00:00.000Z', '2026-08-22T00:00:00.000Z'), 'duration: deadline trước start phải reject');
  pass(true, 'duration: deadline < start bị chặn đúng');
}

// previous incomplete does not block next — cấu trúc thuần túy: nextOccurrenceDateKey
// không nhận bất kỳ tham số nào về trạng thái hoàn thành của kỳ trước, nên
// về mặt thiết kế API không có cách nào để "kỳ trước chưa xong" ảnh hưởng
// tới việc tính kỳ sau — xác nhận bằng cách gọi 2 lần liên tiếp cho cùng rule.
{
  const rule = { frequency: 'weekly' };
  const next1 = nextOccurrenceDateKey(rule, '2026-08-24');
  const next2 = nextOccurrenceDateKey(rule, '2026-08-24');
  pass(next1 === next2 && next1 === '2026-08-31', 'previous incomplete không chặn kỳ sau: hàm tính kỳ tiếp theo không phụ thuộc trạng thái hoàn thành, luôn ra cùng 1 kết quả');
}

// pause no catch-up / outage catch-up / no duplicate occurrence
{
  const rule = { frequency: 'daily', weekdays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] };
  const plan = generateOccurrencePlan({
    rule,
    anchorDateKey: '2026-08-17',
    endCondition: { type: 'never' },
    scanUntilDateKeyInclusive: '2026-08-24',
    existingOccurrenceDateKeys: ['2026-08-17', '2026-08-18'], // đã sinh trước đó
    skippedDateKeys: [],
    pauseWindows: [{ fromDateKey: '2026-08-20', toDateKey: '2026-08-22' }], // user pause 20-21/08
    startHour: 1, startMinute: 0, durationMs: 8 * 3600 * 1000,
    nowDateKeyForCatchup: '2026-08-23' // giả lập "bây giờ" — hệ thống outage tới hôm nay mới chạy lại
  });
  const dateKeys = plan.map(p => p.dateKey);
  pass(!dateKeys.includes('2026-08-17') && !dateKeys.includes('2026-08-18'), 'no duplicate occurrence: kỳ đã tồn tại (existingOccurrenceDateKeys) không được sinh lại');
  pass(!dateKeys.includes('2026-08-20') && !dateKeys.includes('2026-08-21'), 'pause no catch-up: kỳ rơi vào pauseWindows bị loại hoàn toàn, không xuất hiện trong plan (không sinh bù)');
  pass(dateKeys.includes('2026-08-19'), 'outage catch-up: kỳ 19/08 (trước pause, chưa sinh, trước "now") có trong plan để sinh bù');
  const catchupFlags = plan.filter(p => compareOrEqual(p.dateKey, '2026-08-19')).map(p => p.isCatchup);
  const p19 = plan.find(p => p.dateKey === '2026-08-19');
  pass(p19 && p19.isCatchup === true, 'outage catch-up: kỳ 19/08 được đánh dấu isCatchup=true vì trước nowDateKeyForCatchup');
  const p24 = plan.find(p => p.dateKey === '2026-08-24');
  pass(p24 && p24.isCatchup === false, 'outage catch-up: kỳ 24/08 (>= now) KHÔNG bị đánh dấu catchup — đây là kỳ hiện tại, không phải bù');
  function compareOrEqual(a, b) { return a === b; }
}

// idempotency thêm: gọi generateOccurrencePlan 2 lần với existingOccurrenceDateKeys
// đã cập nhật đúng kết quả lần 1 → lần 2 phải trả về plan rỗng (không sinh trùng).
{
  const rule = { frequency: 'weekly' };
  const firstPlan = generateOccurrencePlan({
    rule, anchorDateKey: '2026-08-24', endCondition: { type: 'never' },
    scanUntilDateKeyInclusive: '2026-08-24', existingOccurrenceDateKeys: [], skippedDateKeys: [], pauseWindows: [],
    startHour: 1, startMinute: 0, durationMs: 3600000
  });
  pass(firstPlan.length === 1 && firstPlan[0].dateKey === '2026-08-24', 'idempotency setup: lần đầu sinh đúng 1 kỳ');
  const secondPlan = generateOccurrencePlan({
    rule, anchorDateKey: '2026-08-24', endCondition: { type: 'never' },
    scanUntilDateKeyInclusive: '2026-08-24', existingOccurrenceDateKeys: [firstPlan[0].dateKey], skippedDateKeys: [], pauseWindows: [],
    startHour: 1, startMinute: 0, durationMs: 3600000
  });
  pass(secondPlan.length === 0, 'idempotency: gọi lại với occurrence đã tồn tại → plan rỗng, không sinh trùng (UNIQUE schedule_id+occurrence_key ở DB là lớp bảo vệ thứ 2)');
}

// skip occurrence (mục 18)
{
  const rule = { frequency: 'weekly' };
  const plan = generateOccurrencePlan({
    rule, anchorDateKey: '2026-08-10', endCondition: { type: 'never' },
    scanUntilDateKeyInclusive: '2026-08-24', existingOccurrenceDateKeys: [], skippedDateKeys: ['2026-08-17'], pauseWindows: [],
    startHour: 1, startMinute: 0, durationMs: 3600000
  });
  const dateKeys = plan.map(p => p.dateKey);
  pass(dateKeys.includes('2026-08-10') && dateKeys.includes('2026-08-24') && !dateKeys.includes('2026-08-17'), 'skip occurrence: chỉ đúng 1 kỳ (17/08) bị loại, các kỳ khác trong lịch không bị ảnh hưởng');
}

// end after N
{
  pass(isOccurrenceAllowedByEndCondition({ type: 'after_count', maxOccurrences: 3 }, '2026-08-24', 3) === true, 'end after N: kỳ thứ 3/3 vẫn được phép');
  pass(isOccurrenceAllowedByEndCondition({ type: 'after_count', maxOccurrences: 3 }, '2026-08-31', 4) === false, 'end after N: kỳ thứ 4/3 bị chặn — không tự tạo trước N phiếu, chỉ dùng để dừng scheduler đúng lúc');
}

// end date
{
  pass(isOccurrenceAllowedByEndCondition({ type: 'on_date', endDateKey: '2026-08-24' }, '2026-08-24', 1) === true, 'end date: đúng ngày kết thúc vẫn được phép (inclusive)');
  pass(isOccurrenceAllowedByEndCondition({ type: 'on_date', endDateKey: '2026-08-24' }, '2026-08-25', 2) === false, 'end date: sau ngày kết thúc bị chặn');
}

// firstOccurrenceDateKey — anchor rơi đúng ngày lặp vs không đúng ngày
{
  const ruleMonthly = { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: 15 };
  pass(firstOccurrenceDateKey(ruleMonthly, '2026-08-01') === '2026-08-15', 'first occurrence: anchor trước ngày 15 trong tháng → kỳ đầu là 15/08 cùng tháng');
  pass(firstOccurrenceDateKey(ruleMonthly, '2026-08-20') === '2026-09-15', 'first occurrence: anchor sau ngày 15 → kỳ đầu nhảy sang tháng sau');
}

console.log('PHF Task Recurrence engine mock test: ' + passed + '/' + passed + ' PASS');
