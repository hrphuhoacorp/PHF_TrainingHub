'use strict';
/*
 * T08 Transition Import (2026-08-19) — item T/U: "Cả năm" và "Theo kỳ" phải
 * tự động hiển thị dòng TRANSITION_IMPORT giống hệt các nguồn khác (không
 * source-branching). Cùng mock convention với scripts/test-checklist-annual-
 * result-report-2026-08.js.
 *
 * Chạy: node scripts/test-checklist-transition-import-report-compat-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = ['../api/_lib/checklist-permissions', '../api/_lib/checklist-scope', '../api/_lib/checklist-reports'].map(p => require.resolve(p));

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function makeTableFactory(tableName, rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      lte(field, value) { filters.push(r => String(r[field]) <= String(value)); return q; },
      gte(field, value) { filters.push(r => String(r[field]) >= String(value)); return q; },
      lt(field, value) { filters.push(r => String(r[field]) < String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      or(expr) {
        const clauses = String(expr || '').split(',');
        filters.push(r => clauses.some(clause => {
          const m = clause.match(/^([a-z_]+)\.(eq|is|gte)\.(.*)$/i);
          if (!m) return false;
          const [, field, op, val] = m;
          if (op === 'is' && val === 'null') return r[field] == null || r[field] === '';
          if (op === 'eq') return String(r[field]) === String(val);
          if (op === 'gte') return String(r[field]) >= String(val);
          return false;
        }));
        return q;
      },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      then(resolve, reject) {
        try {
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => { const av = a[spec.field], bv = b[spec.field]; return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1); }); });
          if (limitN != null) matched = matched.slice(0, limitN);
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = {
  employee_profiles: [
    { employee_id: 'e1', employee_code: 'PHF040', full_name: 'Nguyễn Văn Bốn Mươi', title: 'NV', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ],
  checklist_employee_assignments: [
    { employee_id: 'e1', employee_code: 'PHF040', employee_name: 'Nguyễn Văn Bốn Mươi', department: 'Bán hàng', title: 'NV', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2026-01-01' }
  ],
  checklist_monthly_forms: [],
  checklist_violation_records: [],
  checklist_permission_grants: [],
  checklist_monthly_results: [
    { employee_code: 'PHF040', period_month: '2026-08', result_state: 'SCORED', score: 91.5, source: 'TRANSITION_IMPORT' }
  ]
};
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } } };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getChecklistAnnualResultReport, getChecklistScorePeriodReport } = require('../api/_lib/checklist-reports');
const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };

let passes = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { passes++; console.log('PASS: ' + msg); } }

(async () => {
  // ---- T. Cả năm chấp nhận TRANSITION_IMPORT giống hệt các nguồn khác ----
  const annual = await getChecklistAnnualResultReport(adminSession, { year: '2026' });
  const p040 = annual.employees.find(e => e.employeeCode === 'PHF040');
  check(!!p040, 'T: PHF040 xuất hiện trong Cả năm');
  check(p040.periods['2026-08'].resultState === 'SCORED' && p040.periods['2026-08'].score === 91.5, 'T: Cả năm hiển thị đúng điểm TRANSITION_IMPORT (91.5) giống hệt nguồn khác, không branching');
  check(JSON.stringify(annual).indexOf('TRANSITION_IMPORT') === -1, 'T: response Cả năm không lộ giá trị source ra ngoài (không select cột source)');

  // ---- U. Theo kỳ chấp nhận TRANSITION_IMPORT giống hệt các nguồn khác ----
  const period = await getChecklistScorePeriodReport(adminSession, { fromMonth: '2026-08', toMonth: '2026-08' });
  const p040b = period.employees.find(e => e.employeeCode === 'PHF040');
  check(!!p040b, 'U: PHF040 xuất hiện trong Theo kỳ');
  const cell = p040b.periods['2026-08'];
  check(cell.resultState === 'SCORED' && cell.finalScore === 91.5, 'U: Theo kỳ hiển thị đúng Điểm cuối TRANSITION_IMPORT (91.5) giống hệt nguồn khác, không branching');
  check(cell.hasForm === false, 'U: không có checklist_monthly_forms cho dòng này - Điểm cuối vẫn tới từ monthly_result, không giả lập form');
  check(JSON.stringify(period).indexOf('TRANSITION_IMPORT') === -1, 'U: response Theo kỳ không lộ giá trị source ra ngoài (không select cột source)');

  console.log('\n' + passes + ' assertions passed.');
})();
