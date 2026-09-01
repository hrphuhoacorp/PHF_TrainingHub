'use strict';
/*
 * SYNCED COPY of api/_lib/task-recurrence.js — DO NOT EDIT HERE.
 *
 * phf-hr-api must not require() from api/_lib (deployment isolation). This is
 * a byte-for-byte copy of the pure date-math engine below the header.
 * scripts/test-task-recurrence-datemath-parity-v1.js asserts the two files
 * are identical (modulo this header) and produce identical output on a shared
 * fixture set. Update api/_lib/task-recurrence.js, then re-copy.
 *
 * source sha256 (body, excluding this header): see the parity test.
 */

const WEEKDAY_CODES = Object.freeze(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
// getUTCDay(): 0=CN,1=T2,...,6=T7 — map sang WEEKDAY_CODES index.
const JS_DAY_TO_CODE = Object.freeze(['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);

function isValidDateKey(dateKey) {
  return typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}
function parseDateKey(dateKey) {
  if (!isValidDateKey(dateKey)) throw new Error('Ngày không hợp lệ (yêu cầu YYYY-MM-DD): ' + dateKey);
  const [y, m, d] = dateKey.split('-').map(Number);
  return { year: y, month: m, day: d };
}
function daysInMonth(year, month) {
  // month: 1-12. new Date(Date.UTC(year, month, 0)) = ngày cuối của "month".
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function formatDateKey(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
function dateKeyToUtcMs(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  return Date.UTC(year, month - 1, day);
}
function addDaysToDateKey(dateKey, days) {
  const ms = dateKeyToUtcMs(dateKey) + days * 86400000;
  const d = new Date(ms);
  return formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function weekdayCodeOfDateKey(dateKey) {
  const ms = dateKeyToUtcMs(dateKey);
  return JS_DAY_TO_CODE[new Date(ms).getUTCDay()];
}
function compareDateKey(a, b) { return dateKeyToUtcMs(a) - dateKeyToUtcMs(b); }

// ---------------------------------------------------------------------------
// Mục 14/15 — fallback ngày trong tháng/năm không tồn tại.
// ---------------------------------------------------------------------------
function resolveMonthlyDateKey(year, month, dayOfMonthOrEndOfMonth) {
  const lastDay = daysInMonth(year, month);
  if (dayOfMonthOrEndOfMonth === 'end_of_month') return formatDateKey(year, month, lastDay);
  const day = Number(dayOfMonthOrEndOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Ngày trong tháng không hợp lệ: ' + dayOfMonthOrEndOfMonth);
  // Ngày không tồn tại (vd 31 ở tháng 4) → dời về ngày cuối tháng thực tế.
  // KHÔNG tự suy "chọn 30 nghĩa là cuối tháng" — end_of_month phải là lựa
  // chọn RIÊNG, tách bạch khỏi "ngày cố định=30" (mục 14).
  return formatDateKey(year, month, Math.min(day, lastDay));
}
function resolveYearlyDateKey(year, month, day) {
  if (month === 2 && day === 29 && !isLeapYear(year)) return formatDateKey(year, 2, 28);
  const lastDay = daysInMonth(year, month);
  return formatDateKey(year, month, Math.min(day, lastDay));
}

// ---------------------------------------------------------------------------
// Mục 12 — duration preservation. start/deadline là ISO datetime (UTC) đầy đủ.
// ---------------------------------------------------------------------------
function computeDurationMs(startIso, deadlineIso) {
  const startMs = new Date(startIso).getTime();
  const deadlineMs = new Date(deadlineIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(deadlineMs)) throw new Error('start/deadline không hợp lệ.');
  if (deadlineMs < startMs) throw new Error('Deadline không được trước Bắt đầu.');
  return deadlineMs - startMs;
}
function applyDurationFromDateKeyAndTime(dateKey, hour, minute, durationMs) {
  const { year, month, day } = parseDateKey(dateKey);
  const startMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  return { startIso: new Date(startMs).toISOString(), deadlineIso: new Date(startMs + durationMs).toISOString() };
}

// ---------------------------------------------------------------------------
// Mục 13 — kiểu lặp. rule = {
//   frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
//   weekdays: ['T2','T4','T6', ...]   // bắt buộc nếu frequency='daily' (theo mục 13, "Hàng ngày: cho chọn các thứ T2→CN tùy ý")
//   monthlyMode: 'fixed_day' | 'end_of_month',  // bắt buộc nếu frequency='monthly'
//   dayOfMonth: 1..31,                // bắt buộc nếu monthlyMode='fixed_day'
//   yearMonth: 1..12, yearDay: 1..31, // bắt buộc nếu frequency='yearly'
//   startHour, startMinute,           // giờ sinh phiếu = giờ bắt đầu (mục 12)
//   durationMs                        // deadline - start, giữ nguyên mỗi kỳ
// }
// ---------------------------------------------------------------------------
function validateRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('Recurrence rule không hợp lệ.');
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)) throw new Error('frequency không hợp lệ.');
  if (rule.frequency === 'daily') {
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.some(w => !WEEKDAY_CODES.includes(w))) {
      throw new Error('Hàng ngày cần chọn ít nhất 1 thứ trong tuần hợp lệ.');
    }
  }
  if (rule.frequency === 'monthly') {
    if (!['fixed_day', 'end_of_month'].includes(rule.monthlyMode)) throw new Error('monthlyMode không hợp lệ.');
    if (rule.monthlyMode === 'fixed_day' && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) {
      throw new Error('dayOfMonth không hợp lệ.');
    }
  }
  if (rule.frequency === 'yearly') {
    if (!Number.isInteger(rule.yearMonth) || rule.yearMonth < 1 || rule.yearMonth > 12) throw new Error('yearMonth không hợp lệ.');
    if (!Number.isInteger(rule.yearDay) || rule.yearDay < 1 || rule.yearDay > 31) throw new Error('yearDay không hợp lệ.');
  }
}

// Kỳ tiếp theo SAU dateKey (không bao gồm chính dateKey), theo rule.
function nextOccurrenceDateKey(rule, afterDateKey) {
  validateRule(rule);
  if (rule.frequency === 'weekly') {
    return addDaysToDateKey(afterDateKey, 7);
  }
  if (rule.frequency === 'daily') {
    let cursor = addDaysToDateKey(afterDateKey, 1);
    for (let i = 0; i < 8; i++) {
      if (rule.weekdays.includes(weekdayCodeOfDateKey(cursor))) return cursor;
      cursor = addDaysToDateKey(cursor, 1);
    }
    throw new Error('Không tìm được thứ hợp lệ trong 8 ngày kế tiếp — kiểm tra lại weekdays.');
  }
  if (rule.frequency === 'monthly') {
    const { year, month } = parseDateKey(afterDateKey);
    let y = year, m = month + 1;
    if (m > 12) { m = 1; y += 1; }
    return resolveMonthlyDateKey(y, m, rule.monthlyMode === 'end_of_month' ? 'end_of_month' : rule.dayOfMonth);
  }
  if (rule.frequency === 'yearly') {
    const { year } = parseDateKey(afterDateKey);
    return resolveYearlyDateKey(year + 1, rule.yearMonth, rule.yearDay);
  }
  throw new Error('frequency không hỗ trợ: ' + rule.frequency);
}

// Kỳ ĐẦU TIÊN (>= anchorDateKey), dùng khi tạo lịch mới.
function firstOccurrenceDateKey(rule, anchorDateKey) {
  validateRule(rule);
  if (rule.frequency === 'weekly') return anchorDateKey;
  if (rule.frequency === 'daily') {
    let cursor = anchorDateKey;
    for (let i = 0; i < 8; i++) {
      if (rule.weekdays.includes(weekdayCodeOfDateKey(cursor))) return cursor;
      cursor = addDaysToDateKey(cursor, 1);
    }
    throw new Error('Không tìm được thứ hợp lệ trong 8 ngày kể từ anchor.');
  }
  if (rule.frequency === 'monthly') {
    const { year, month } = parseDateKey(anchorDateKey);
    const candidate = resolveMonthlyDateKey(year, month, rule.monthlyMode === 'end_of_month' ? 'end_of_month' : rule.dayOfMonth);
    return compareDateKey(candidate, anchorDateKey) >= 0 ? candidate : nextOccurrenceDateKey(rule, candidate);
  }
  if (rule.frequency === 'yearly') {
    const { year } = parseDateKey(anchorDateKey);
    const candidate = resolveYearlyDateKey(year, rule.yearMonth, rule.yearDay);
    return compareDateKey(candidate, anchorDateKey) >= 0 ? candidate : resolveYearlyDateKey(year + 1, rule.yearMonth, rule.yearDay);
  }
  throw new Error('frequency không hỗ trợ: ' + rule.frequency);
}

// ---------------------------------------------------------------------------
// Mục 16 — điều kiện kết thúc. endCondition = {
//   type: 'never' | 'on_date' | 'after_count',
//   endDateKey, maxOccurrences
// }
// ---------------------------------------------------------------------------
function isOccurrenceAllowedByEndCondition(endCondition, occurrenceDateKey, occurrenceIndexOneBased) {
  const cond = endCondition || { type: 'never' };
  if (cond.type === 'never') return true;
  if (cond.type === 'on_date') return compareDateKey(occurrenceDateKey, cond.endDateKey) <= 0;
  if (cond.type === 'after_count') return occurrenceIndexOneBased <= Number(cond.maxOccurrences);
  throw new Error('endCondition.type không hợp lệ: ' + cond.type);
}

// ---------------------------------------------------------------------------
// Mục 18 — bỏ qua 1 kỳ. skippedDateKeys: Set<string> các kỳ bị bỏ qua (đã
// lưu actor/time/reason ở tầng DB — file này chỉ nhận danh sách để loại trừ).
// Mục 17 — pause: nếu occurrence rơi vào khoảng [pauseFrom, pauseTo) thì bỏ
// qua NHƯNG không tính là "kỳ lẽ ra phải sinh cho catch-up" (mục 19: pause
// do user chủ động KHÔNG được catch-up).
// ---------------------------------------------------------------------------
function isDateKeyPaused(dateKey, pauseWindows) {
  return (pauseWindows || []).some(w => {
    const afterStart = compareDateKey(dateKey, w.fromDateKey) >= 0;
    const beforeEnd = !w.toDateKey || compareDateKey(dateKey, w.toDateKey) < 0;
    return afterStart && beforeEnd;
  });
}

/*
 * generateOccurrencePlan — tính TOÀN BỘ kỳ cần sinh trong khoảng
 * [scanFromDateKey, scanUntilDateKeyInclusive], phục vụ cả sinh kỳ hiện tại
 * lẫn quét bù sau sự cố (mục 19). Đây là hàm DUY NHẤT caller cần gọi.
 *
 * KHÔNG sinh quá occurrenceIndex đã đạt endCondition. KHÔNG sinh kỳ đã có
 * trong existingOccurrenceDateKeys (chống trùng — caller truyền vào các kỳ
 * đã tồn tại thật trong DB, thường query theo schedule_id).
 *
 * Trả về mảng { dateKey, occurrenceIndex, isCatchup, start, deadline }.
 * isCatchup = true nếu dateKey < scanFromDateKey gốc thật (tức là kỳ lẽ ra
 * đã phải sinh trước "bây giờ" nhưng chưa sinh — do outage, KHÔNG áp dụng
 * nếu nguyên nhân là pause chủ động, caller phải lọc pauseWindows TRƯỚC khi
 * gọi hàm này bằng cách không đưa các kỳ đó vào phạm vi scan, hoặc dùng
 * isDateKeyPaused để loại trừ ngay tại đây — xem test "pause no catch-up").
 */
function generateOccurrencePlan(options) {
  const {
    rule, anchorDateKey, endCondition, scanUntilDateKeyInclusive,
    existingOccurrenceDateKeys, skippedDateKeys, pauseWindows,
    startHour, startMinute, durationMs, nowDateKeyForCatchup
  } = options;
  validateRule(rule);
  const existing = new Set(existingOccurrenceDateKeys || []);
  const skipped = new Set(skippedDateKeys || []);
  const plan = [];
  let cursor = firstOccurrenceDateKey(rule, anchorDateKey);
  let index = 1;
  const guardMaxIterations = 100000;
  let iterations = 0;
  while (compareDateKey(cursor, scanUntilDateKeyInclusive) <= 0) {
    if (++iterations > guardMaxIterations) throw new Error('generateOccurrencePlan: vượt giới hạn vòng lặp an toàn.');
    if (!isOccurrenceAllowedByEndCondition(endCondition, cursor, index)) break;
    const paused = isDateKeyPaused(cursor, pauseWindows);
    const skippedThis = skipped.has(cursor);
    if (!paused && !skippedThis && !existing.has(cursor)) {
      const { startIso, deadlineIso } = applyDurationFromDateKeyAndTime(cursor, startHour, startMinute, durationMs);
      plan.push({
        dateKey: cursor,
        occurrenceIndex: index,
        isCatchup: !!nowDateKeyForCatchup && compareDateKey(cursor, nowDateKeyForCatchup) < 0,
        start: startIso,
        deadline: deadlineIso
      });
    }
    cursor = nextOccurrenceDateKey(rule, cursor);
    index += 1;
  }
  return plan;
}

module.exports = {
  WEEKDAY_CODES,
  isValidDateKey,
  parseDateKey,
  formatDateKey,
  daysInMonth,
  isLeapYear,
  addDaysToDateKey,
  weekdayCodeOfDateKey,
  compareDateKey,
  resolveMonthlyDateKey,
  resolveYearlyDateKey,
  computeDurationMs,
  applyDurationFromDateKeyAndTime,
  validateRule,
  nextOccurrenceDateKey,
  firstOccurrenceDateKey,
  isOccurrenceAllowedByEndCondition,
  isDateKeyPaused,
  generateOccurrencePlan
};
