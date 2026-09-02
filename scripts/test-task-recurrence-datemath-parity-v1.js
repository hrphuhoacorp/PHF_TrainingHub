'use strict';

/*
 * PHF Task Recurrence — pure date-math PARITY between
 *   api/_lib/task-recurrence.js                          (canonical)
 *   services/phf-hr-api/lib/task-recurrence-datemath.js  (synced copy)
 *
 * phf-hr-api cannot require() api/_lib (deployment isolation). This proves
 * the copy is behaviourally identical so the generation engine can trust it.
 * NO network, NO DB.
 *
 *   node scripts/test-task-recurrence-datemath-parity-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'api/_lib/task-recurrence.js'));
const B = require(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence-datemath.js'));

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed++; console.log('  PASS  ' + m); }

// 1. Source body identical (strip each file's own leading block comment + 'use strict').
function body(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return src.slice(src.indexOf('const WEEKDAY_CODES')).replace(/\s+$/, '');
}
const bodyA = body('api/_lib/task-recurrence.js');
const bodyB = body('services/phf-hr-api/lib/task-recurrence-datemath.js');
pass(crypto.createHash('sha256').update(bodyA).digest('hex') === crypto.createHash('sha256').update(bodyB).digest('hex'),
  'source body sha256 identical (' + crypto.createHash('sha256').update(bodyA).digest('hex').slice(0, 12) + ')');

// 2. Same exported surface.
pass(JSON.stringify(Object.keys(A).sort()) === JSON.stringify(Object.keys(B).sort()), 'same module.exports keys');

// 3. Behavioural parity over a fixture matrix.
const weeklyRule = { frequency: 'weekly' };
const monthlyFixed = { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: 31 };
const monthly15 = { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: 15 };

const cases = [];
['2026-01-05', '2026-02-27', '2026-12-31', '2027-02-28'].forEach(d => {
  cases.push(['nextOccurrenceDateKey weekly ' + d, () => A.nextOccurrenceDateKey(weeklyRule, d), () => B.nextOccurrenceDateKey(weeklyRule, d)]);
  cases.push(['nextOccurrenceDateKey monthly31 ' + d, () => A.nextOccurrenceDateKey(monthlyFixed, d), () => B.nextOccurrenceDateKey(monthlyFixed, d)]);
  cases.push(['firstOccurrenceDateKey monthly15 ' + d, () => A.firstOccurrenceDateKey(monthly15, d), () => B.firstOccurrenceDateKey(monthly15, d)]);
  cases.push(['weekdayCodeOfDateKey ' + d, () => A.weekdayCodeOfDateKey(d), () => B.weekdayCodeOfDateKey(d)]);
});
[[2026, 2], [2028, 2], [2026, 4], [2027, 2], [2026, 12]].forEach(([y, m]) => {
  cases.push(['resolveMonthlyDateKey 31 ' + y + '-' + m, () => A.resolveMonthlyDateKey(y, m, 31), () => B.resolveMonthlyDateKey(y, m, 31)]);
  cases.push(['daysInMonth ' + y + '-' + m, () => A.daysInMonth(y, m), () => B.daysInMonth(y, m)]);
});
// generateOccurrencePlan parity
const planOpts = (mod) => ({
  rule: monthlyFixed, anchorDateKey: '2026-01-31',
  endCondition: { type: 'never' }, scanUntilDateKeyInclusive: '2026-06-30',
  existingOccurrenceDateKeys: [], skippedDateKeys: [], pauseWindows: [],
  startHour: 9, startMinute: 0, durationMs: 3 * 86400000, nowDateKeyForCatchup: '2026-06-15',
});
cases.push(['generateOccurrencePlan monthly31 Jan..Jun', () => A.generateOccurrencePlan(planOpts(A)), () => B.generateOccurrencePlan(planOpts(B))]);

for (const [name, fa, fb] of cases) {
  pass(JSON.stringify(fa()) === JSON.stringify(fb()), 'parity: ' + name + ' -> ' + JSON.stringify(fa()));
}

// 4. Contract month-end examples (explicit).
pass(B.resolveMonthlyDateKey(2026, 2, 31) === '2026-02-28', 'contract: 31 -> Feb 28 (2026 non-leap)');
pass(B.resolveMonthlyDateKey(2028, 2, 31) === '2028-02-29', 'contract: 31 -> Feb 29 (2028 leap)');
pass(B.resolveMonthlyDateKey(2026, 4, 31) === '2026-04-30', 'contract: 31 -> Apr 30');
pass(B.resolveMonthlyDateKey(2026, 5, 31) === '2026-05-31', 'contract: 31 -> May 31 again');

console.log('\nALL ' + passed + ' ASSERTIONS PASSED');
