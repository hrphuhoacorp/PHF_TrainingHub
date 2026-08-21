'use strict';
/*
 * HOTFIX regression (2026-08-18) — Production báo lỗi "Thiếu thông tin học
 * viên cần lưu." khi mở tab "Cả năm". Root cause: api/data.js (Vercel
 * serverless handler THẬT phục vụ /api/data trên Production) là bản sao
 * TÁCH RIÊNG của dispatch trong server.js (dùng cho `npm start` local) - action
 * getChecklistAnnualResultReport chỉ được đăng ký ở server.js, KHÔNG ở
 * api/data.js, nên request rơi xuống nhánh legacy saveData()/validatePayload()
 * cuối route (yêu cầu payload.employee - dành cho lưu tiến độ học viên, không
 * liên quan report). scripts/test-checklist-annual-result-report-2026-08.js
 * gọi THẲNG getChecklistAnnualResultReport() nên không bao giờ đi qua
 * api/data.js và không bắt được lớp lỗi này - test này gọi qua ĐÚNG
 * module.exports handler của api/data.js để bắt được lớp lỗi wiring đó.
 *
 * Chạy: node scripts/test-checklist-annual-result-api-route-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('@supabase/supabase-js');
const authPath = require.resolve('../api/_lib/auth');
const apiDataPath = require.resolve('../api/data');

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
    { employee_id: 'e1', employee_code: 'PHF001', full_name: 'Nguyễn Văn A', title: 'NV', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
  ],
  checklist_employee_assignments: [
    { employee_id: 'e1', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', department: 'Bán hàng', title: 'NV', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2026-01-01' }
  ],
  checklist_monthly_results: [
    { employee_code: 'PHF001', period_month: '2026-01', result_state: 'SCORED', score: 90, source: 'BASELINE_IMPORT' }
  ]
};
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } }
};

// admin session - bỏ qua toàn bộ cookie/JWT thật (không liên quan tới lớp lỗi
// đang test: bug nằm ở SAU khi đã xác thực, tại bước dispatch action).
const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireSession: async () => adminSession,
    authorizePayload: (session, payload) => payload,
    listHubAccountSummaries: async () => []
  }
};

delete require.cache[apiDataPath];
const handler = require('../api/data');

let passes = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { passes++; console.log('PASS: ' + msg); } }

function fakeReqRes(bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyStr)) }, query: {}, body: bodyStr };
  const res = { _status: null, _body: null, setHeader() { return this; }, status(code) { this._status = code; return this; }, json(body) { this._body = body; return this; } };
  return { req, res };
}

(async () => {
  // ---- Reproduce exact Production failure mode: authenticated Admin, action=getChecklistAnnualResultReport,
  // year=2026, NO payload.employee (report request has no employee/student identity - it never should need one).
  const { req, res } = fakeReqRes({ action: 'getChecklistAnnualResultReport', year: '2026' });
  await handler(req, res);

  check(res._status === 200, 'Admin gọi getChecklistAnnualResultReport qua api/data.js (route THẬT của Production) trả 200, thực tế=' + res._status);
  check(res._body && res._body.ok === true, 'Response ok=true (không rơi vào nhánh legacy saveData/validatePayload)');
  check(res._body && res._body.code !== 'EMPLOYEE_REQUIRED', 'Không bị chặn bởi EMPLOYEE_REQUIRED (lỗi Production gốc: "Thiếu thông tin học viên cần lưu.")');
  check(res._body && typeof res._body.message !== 'string' || (res._body.message || '').indexOf('học viên') === -1, 'Response không chứa thông báo "...học viên..." của nhánh legacy saveData');
  check(Array.isArray(res._body && res._body.employees), 'Response có mảng employees đúng shape getChecklistAnnualResultReport (không phải shape saveData)');
  check(res._body && res._body.employees.length === 1 && res._body.employees[0].employeeCode === 'PHF001', 'Dữ liệu report đúng nhân sự seed (PHF001)');

  // ---- Systemic guard: mọi action getChecklist*Report/getChecklistAnnualResultReport đăng ký ở
  // server.js PHẢI cũng được đăng ký ở api/data.js (route THẬT Production) - tránh tái diễn đúng lớp
  // lỗi wiring desync này cho action tương lai (server.js và api/data.js là 2 bản sao dispatch riêng biệt).
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const apiDataSrc = fs.readFileSync(path.join(__dirname, '../api/data.js'), 'utf8');
  const reportActionRe = /payload\.action\s*===\s*'(getChecklist(?:Monthly|Current|ScorePeriod|AnnualResult|Violation)[A-Za-z]*Report[A-Za-z]*|getChecklistViolationWorkflowSummary)'/g;
  const serverActions = new Set([...serverSrc.matchAll(reportActionRe)].map(m => m[1]));
  const apiDataActions = new Set([...apiDataSrc.matchAll(reportActionRe)].map(m => m[1]));
  check(serverActions.has('getChecklistAnnualResultReport'), 'server.js có đăng ký getChecklistAnnualResultReport (sanity check regex)');
  const missingInApiData = [...serverActions].filter(a => !apiDataActions.has(a));
  check(missingInApiData.length === 0, 'Mọi action report ở server.js đều có mặt ở api/data.js (route Production thật) - thiếu: ' + JSON.stringify(missingInApiData));

  console.log('\n' + passes + ' assertions passed.');
})();
