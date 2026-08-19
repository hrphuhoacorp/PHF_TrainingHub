'use strict';
/*
 * T08 Transition Import (2026-08-19) — Route-level test qua ĐÚNG module.exports
 * handler của api/data.js (route THẬT phục vụ Production, xem bài học lỗi
 * 1.61.5 - server.js và api/data.js là 2 bản dispatch riêng biệt, phải test
 * qua handler thật, không chỉ gọi thẳng service). Cùng kỹ thuật với
 * scripts/test-checklist-annual-result-api-route-2026-08.js.
 *
 * Chạy: node scripts/test-checklist-transition-import-route-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('@supabase/supabase-js');
const authPath = require.resolve('../lib/auth');
const apiDataPath = require.resolve('../api/data');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function makeTableFactory(tableName, rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, insertPayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      insert(payload) { insertPayload = Array.isArray(payload) ? payload : [payload]; return q; },
      then(resolve, reject) {
        try {
          if (insertPayload) {
            for (const row of insertPayload) {
              const dup = rows.some(r => r.employee_code === row.employee_code && r.period_month === row.period_month);
              if (dup) { resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }); return; }
            }
            insertPayload.forEach(row => rows.push({ id: 'row-' + (rows.length + 1), ...row }));
            resolve({ data: clone(insertPayload.map((row, i) => ({ id: 'row-inserted-' + i, employee_code: row.employee_code, period_month: row.period_month, result_state: row.result_state, score: row.score, source: row.source }))), error: null });
            return;
          }
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
    { employee_code: 'PHF040', full_name: 'Nguyễn Văn Bốn Mươi', employment_status: 'active', branch: 'Phú Lợi' },
    { employee_code: 'PHF010', full_name: 'Lê Văn Lái Thiêu', employment_status: 'active', branch: 'Lái Thiêu' }
  ],
  checklist_monthly_results: []
};
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } }
};

const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };
const managerSession = { account: { id: 'mgr-1', name: 'Manager' }, role: 'manager' };
let currentSession = adminSession; // mutable - api/data.js destructures requireSession ONCE at require time, nên phải đổi qua biến trạng thái thay vì gán lại hàm sau khi require.
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireSession: async () => currentSession,
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
  // ---- W. authenticated Admin route works — preview ----
  {
    const { req, res } = fakeReqRes({ action: 'previewChecklistTransitionImport', rows: [{ employeeCode: 'PHF040', rawValue: '88' }] });
    await handler(req, res);
    check(res._status === 200, 'preview qua api/data.js trả 200, thực tế=' + res._status);
    check(res._body && res._body.ok === true, 'preview response ok=true');
    check(res._body && res._body.rows && res._body.rows[0].status === 'READY', 'W: preview qua route THẬT trả đúng READY cho Phú Lợi');
  }

  // ---- LT/NQ guard hoạt động qua route thật ----
  {
    const { req, res } = fakeReqRes({ action: 'previewChecklistTransitionImport', rows: [{ employeeCode: 'PHF010', rawValue: '88' }] });
    await handler(req, res);
    check(res._body.rows[0].status === 'SKIP_LT_NQ_LIVE', 'LT/NQ guard áp dụng đúng qua route THẬT (không chỉ service/unit)');
  }

  // ---- confirm qua route thật, rồi verify Cả năm/Theo kỳ đọc được (item T/U) - xem test riêng report-compat ----
  {
    const { req, res } = fakeReqRes({ action: 'confirmChecklistTransitionImport', rows: [{ employeeCode: 'PHF040', rawValue: '88' }] });
    await handler(req, res);
    check(res._status === 200 && res._body.ok === true, 'confirm qua route THẬT trả 200/ok=true');
    check(res._body.source === 'TRANSITION_IMPORT', 'confirm qua route THẬT ghi đúng source=TRANSITION_IMPORT');
    check(STATE.checklist_monthly_results.some(r => r.employee_code === 'PHF040' && r.period_month === '2026-08' && r.source === 'TRANSITION_IMPORT'), 'dòng đã ghi đúng employee_code/period_month/source trong mock DB');
  }

  // ---- source cannot be spoofed through the route (payload.source ignored) ----
  {
    const { req, res } = fakeReqRes({ action: 'previewChecklistTransitionImport', rows: [{ employeeCode: 'PHF040', rawValue: '50' }], source: 'SYSTEM_LIVE' });
    await handler(req, res);
    // PHF040 giờ đã có TRANSITION_IMPORT (bước trên) - nếu source bị spoof thành SYSTEM_LIVE thì sẽ ra CONFLICT_SYSTEM_LIVE SAI; nếu source đúng bị ép TRANSITION_IMPORT thì phải ra DUPLICATE.
    check(res._body.rows[0].status === 'DUPLICATE', 'P: payload.source do client gửi (SYSTEM_LIVE) bị bỏ qua qua route THẬT - vẫn phân loại đúng theo TRANSITION_IMPORT (DUPLICATE), thực tế=' + res._body.rows[0].status);
  }

  // ---- X. non-Admin denied before data access, qua route thật ----
  {
    currentSession = managerSession;
    const { req, res } = fakeReqRes({ action: 'previewChecklistTransitionImport', rows: [{ employeeCode: 'PHF040', rawValue: '80' }] });
    await handler(req, res);
    check(res._status === 403, 'X: manager (non-admin) bị chặn ở route THẬT trước khi chạm data, status=' + res._status);
    check(res._body.code === 'CHECKLIST_MONTHLY_RESULT_ADMIN_REQUIRED', 'X: đúng mã lỗi ADMIN_REQUIRED');
    currentSession = adminSession;
  }

  // ---- V. server.js/api/data.js route parity (2 action mới) ----
  {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const apiDataSrc = fs.readFileSync(path.join(__dirname, '../api/data.js'), 'utf8');
    ['previewChecklistTransitionImport', 'confirmChecklistTransitionImport'].forEach(action => {
      const inServer = serverSrc.includes("action==='" + action + "'");
      const inApiData = apiDataSrc.includes("action==='" + action + "'");
      check(inServer, 'V: ' + action + ' có đăng ký trong server.js');
      check(inApiData, 'V: ' + action + ' có đăng ký trong api/data.js (route Production thật)');
    });
  }

  console.log('\n' + passes + ' assertions passed.');
})();
