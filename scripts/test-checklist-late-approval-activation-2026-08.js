'use strict';
/*
 * PHF Checklist — Đi trễ FINAL ACTIVATION (2026-08-16): LATE_APPROVAL_ENABLED/
 * LATE_APPROVAL_UI_ENABLED chuyển true ở LOCAL. File này verify RUNTIME thật của
 * approveLateEvents() bằng Supabase mock IN-MEMORY (KHÔNG chạm network — môi trường chỉ có 1
 * project cấu hình và đó là Production, nên KHÔNG BAO GIỜ được gọi hàm thật không mock ở đây).
 * Cover test matrix batch "FINAL ACTIVATION PASS":
 *   A. Flag ON — service thật (đã require với LATE_APPROVAL_ENABLED=true) không còn reject NOT_ACTIVATED.
 *   B. Role — chỉ Admin được approve; Trợ lý/Quản lý gọi thẳng bị chặn.
 *   C. Single approve — 1 dòng sạch -> official đúng 1 lần, đúng điểm.
 *   D. Bulk — nhiều dòng sạch + dòng không an toàn (conflict/over-quota) lẫn trong decisions[]
 *      -> server tự loại RIÊNG dòng không an toàn, không chặn cả batch.
 *   E. Re-approve — cùng event -> không tạo duplicate, idempotent.
 *   F. Override — appliedPoints khác suggested thiếu reason -> reject; có reason -> PASS.
 *   G. Over-quota (case C thứ 5+) — bắt buộc appliedPoints + reason tường minh, không có công
 *      thức mặc định; bulk luôn loại trừ dòng này.
 *   H. Conflict — không tự suy diễn Duyệt/Không duyệt; PHẢI dùng ĐÚNG REJECTED_BANDS khi kết
 *      luận Không duyệt (runtime verify band-fix, không chỉ source-grep).
 *   I. Monthly — trước approve: 0 official; sau approve: đúng 1 official/employee/event.
 * Chạy: node scripts/test-checklist-late-approval-activation-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');

/* ============================== Mutable in-memory table mock ============================== */
function mutableTable(store, idPrefix) {
  let seq = 1;
  function newId() { return idPrefix + '-' + (seq++); }
  return function fromTable() {
    const filters = [];
    let mode = 'select', payload = null, wantSingle = false, upsertOpts = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
      lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { wantSingle = true; return q; },
      single() { wantSingle = true; return q; },
      insert(rows) { mode = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return q; },
      upsert(rows, opts) { mode = 'upsert'; payload = Array.isArray(rows) ? rows : [rows]; upsertOpts = opts || {}; return q; },
      update(patch) { mode = 'update'; payload = patch; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const inserted = payload.map(row => {
              const saved = { id: newId(), ...row };
              store.push(saved);
              return saved;
            });
            resolve({ data: inserted, error: null });
            return;
          }
          if (mode === 'upsert') {
            const conflictKey = (upsertOpts && upsertOpts.onConflict) || 'id';
            const inserted = [];
            payload.forEach(row => {
              const exists = store.some(r => String(r[conflictKey]) === String(row[conflictKey]));
              if (exists) return; // ignoreDuplicates
              const saved = { id: newId(), ...row };
              store.push(saved);
              inserted.push(saved);
            });
            resolve({ data: inserted, error: null });
            return;
          }
          if (mode === 'update') {
            const matched = store.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, payload));
            resolve({ data: matched, error: null });
            return;
          }
          let matched = store.filter(r => filters.every(fn => fn(r)));
          if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
          resolve({ data: matched, error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const IMPORT_ROWS = [];
const VIOLATIONS = [];
const importRowsFrom = mutableTable(IMPORT_ROWS, 'row');
const violationsFrom = mutableTable(VIOLATIONS, 'v');

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_late_bcc_import_rows') return importRowsFrom();
        if (table === 'checklist_violation_records') return violationsFrom();
        // Bàn nào khác (manager observation, v.v.) không dùng trong batch approve — trả rỗng an toàn.
        return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, then(resolve) { resolve({ data: [], error: null }); } };
      }
    })
  }
};

const service = require('../api/_lib/checklist-late-reconciliation-service');
const recon = require('../api/_lib/checklist-late-reconciliation');

let failures = 0, passes = 0;
async function checkAsync(label, fn) { try { await fn(); passes++; console.log('PASS: ' + label); } catch (e) { failures++; console.error('FAIL: ' + label + ' :: ' + (e && e.message || e)); } }

const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' } };
const troLySession = { role: 'manager', account: { id: 'act-troly', name: 'Trợ lý' }, employeeCode: 'TROLY01' };
const managerSession = { role: 'manager', account: { id: 'act-tbp', name: 'Trưởng BP' }, employeeCode: 'TBP01' };
const learnerSession = { role: 'learner', account: { id: 'emp-1', name: 'NV' }, employeeCode: 'PHF050' };

function seedRow(row) {
  const saved = { id: 'seed-' + row.import_row_key, admin_applied_points: null, linked_violation_id: null, late_event_id: null, admin_decision: null, admin_decision_reason: null, ...row };
  IMPORT_ROWS.push(saved);
  return saved;
}

// Row 1 — Không duyệt sạch (case B), REJECTED_BANDS 1-15 = 6đ.
seedRow({ import_row_key: 'key-1', employee_code: 'PHF050', employee_name_raw: 'Nguyễn Văn A', occurred_date: '2026-08-05', shift: 'sáng', checkin_time: '08:10', minutes_late: 10, source: 'BCC', bcc_transaction_id: 'TX-1', match_status: 'matched', manager_decision_suggested: 'rejected', standard_points: 3, suggested_points: 6, row_status: 'pending_approval', frequency_reference_snapshot: { businessStatus: 'rejected', standardRejectedPoints: 6 } });
// Row 2 — Duyệt trong hạn mức (case C, lần 1/4), sạch.
seedRow({ import_row_key: 'key-2', employee_code: 'PHF051', employee_name_raw: 'Trần Thị B', occurred_date: '2026-08-06', shift: 'sáng', checkin_time: '08:05', minutes_late: 5, source: 'BCC', bcc_transaction_id: 'TX-2', match_status: 'matched', manager_decision_suggested: 'approved', standard_points: 3, suggested_points: 0, row_status: 'pending_approval', frequency_reference_snapshot: { businessStatus: 'approved', approvedQuota: { occurrenceNumber: 1, limit: 4, overQuota: false } } });
// Row 3 — Cần đối chiếu (conflict).
seedRow({ import_row_key: 'key-3', employee_code: 'PHF052', employee_name_raw: 'Lê Văn C', occurred_date: '2026-08-07', shift: 'sáng', checkin_time: '08:12', minutes_late: 12, source: 'BCC', bcc_transaction_id: 'TX-3', match_status: 'conflict_needs_review', manager_decision_suggested: 'conflict', standard_points: 3, suggested_points: 0, row_status: 'needs_review', frequency_reference_snapshot: { businessStatus: 'conflict_needs_review', standardRejectedPoints: 6 } });
// Row 4 — Duyệt vượt quota (lần 5/4).
seedRow({ import_row_key: 'key-4', employee_code: 'PHF053', employee_name_raw: 'Phạm Thị D', occurred_date: '2026-08-08', shift: 'sáng', checkin_time: '08:20', minutes_late: 20, source: 'BCC', bcc_transaction_id: 'TX-4', match_status: 'matched', manager_decision_suggested: 'approved', standard_points: 6, suggested_points: 0, row_status: 'needs_review', frequency_reference_snapshot: { businessStatus: 'approved_over_quota', approvedQuota: { occurrenceNumber: 5, limit: 4, overQuota: true } } });
// Row 5 — Không duyệt sạch, dùng cho test override (khác appliedPoints so với suggested).
seedRow({ import_row_key: 'key-5', employee_code: 'PHF054', employee_name_raw: 'Hoàng Văn E', occurred_date: '2026-08-09', shift: 'sáng', checkin_time: '08:07', minutes_late: 7, source: 'BCC', bcc_transaction_id: 'TX-5', match_status: 'matched', manager_decision_suggested: 'rejected', standard_points: 3, suggested_points: 6, row_status: 'pending_approval', frequency_reference_snapshot: { businessStatus: 'rejected', standardRejectedPoints: 6 } });
// Row 6/7 — 2 dòng SẠCH khác, dành riêng cho test PREFLIGHT (mục 3 — bulk partial-write residual).
seedRow({ import_row_key: 'key-6', employee_code: 'PHF055', employee_name_raw: 'Vũ Thị F', occurred_date: '2026-08-10', shift: 'sáng', checkin_time: '08:09', minutes_late: 9, source: 'BCC', bcc_transaction_id: 'TX-6', match_status: 'matched', manager_decision_suggested: 'rejected', standard_points: 3, suggested_points: 6, row_status: 'pending_approval', frequency_reference_snapshot: { businessStatus: 'rejected', standardRejectedPoints: 6 } });
seedRow({ import_row_key: 'key-7', employee_code: 'PHF056', employee_name_raw: 'Đặng Văn G', occurred_date: '2026-08-11', shift: 'sáng', checkin_time: '08:11', minutes_late: 11, source: 'BCC', bcc_transaction_id: 'TX-7', match_status: 'matched', manager_decision_suggested: 'rejected', standard_points: 3, suggested_points: 6, row_status: 'pending_approval', frequency_reference_snapshot: { businessStatus: 'rejected', standardRejectedPoints: 6 } });

(async () => {
  // =========================================================================
  // A) Flag ON — service thật (require với LATE_APPROVAL_ENABLED=true) không còn NOT_ACTIVATED.
  // =========================================================================
  await checkAsync('A1. LATE_APPROVAL_ENABLED=true — approveLateEvents không còn reject CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED cho session Admin hợp lệ', async () => {
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[0].id, adminDecision: 'apply_no_permission_points' }]);
    assert.ok(r.results[0].applied === true);
  });

  // =========================================================================
  // B) Role — chỉ Admin.
  // =========================================================================
  await checkAsync('B1. Trợ lý (role=manager) gọi thẳng approveLateEvents -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.approveLateEvents(troLySession, [{ importRowId: IMPORT_ROWS[1].id, adminDecision: 'accept_exempt' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('B2. Quản lý/cấp trên (role=manager, preset khác) gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.approveLateEvents(managerSession, [{ importRowId: IMPORT_ROWS[1].id, adminDecision: 'accept_exempt' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('B3/K. Employee (role=learner) gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY (không thể tự approve cho chính mình)', async () => {
    await assert.rejects(
      () => service.approveLateEvents(learnerSession, [{ importRowId: IMPORT_ROWS[0].id, adminDecision: 'accept_exempt' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });

  // =========================================================================
  // C) Single approve — row1 đã approve ở A1 — verify official đúng 1 lần, đúng điểm (6đ).
  // =========================================================================
  await checkAsync('C1. Row1 (Không duyệt sạch, 10 phút) -> official points=6 (REJECTED_BANDS 1-15), record_status=official, is_test=false, đúng 1 bản ghi', async () => {
    const matches = VIOLATIONS.filter(v => v.import_row_key === 'key-1');
    assert.strictEqual(matches.length, 1, 'phải đúng 1 official record cho event này');
    assert.strictEqual(matches[0].points, 6);
    assert.strictEqual(matches[0].record_status, 'official');
    assert.strictEqual(matches[0].is_test, false);
    assert.strictEqual(matches[0].employee_code, 'PHF050');
  });
  await checkAsync('C2. Staging row1 chuyển row_status=applied, linked_violation_id lưu đúng, admin_applied_points=6, audit metadata đủ (by/reason/at)', async () => {
    const row = IMPORT_ROWS.find(r => r.import_row_key === 'key-1');
    assert.strictEqual(row.row_status, 'applied');
    assert.ok(row.linked_violation_id);
    assert.strictEqual(Number(row.admin_applied_points), 6);
    assert.strictEqual(row.admin_decision_by, 'admin-1');
    assert.ok(row.admin_decision_at);
  });

  // =========================================================================
  // D) Bulk — row2 (sạch) + row3 (conflict) + row4 (over-quota) trong CÙNG batch bulk:true.
  // =========================================================================
  await checkAsync('D1. Bulk approve [row2 sạch, row3 conflict, row4 over-quota]: row2 applied, row3/row4 skipped (KHÔNG official, KHÔNG chặn cả batch)', async () => {
    // Lưu ý phát hiện được ở đây: adminDecision phải KHỚP suggestedPoints (apply_no_permission_points,
    // đúng suggestedPoints=0) để đi qua nhánh "không cần reason" — accept_exempt LUÔN cần reason
    // (hành động override tường minh) dù điểm trùng 0, đây là hành vi ĐÃ CÓ SẴN (không phải bug mới).
    const decisions = [
      { importRowId: IMPORT_ROWS[1].id, adminDecision: 'apply_no_permission_points', bulk: true },
      { importRowId: IMPORT_ROWS[2].id, adminDecision: 'apply_no_permission_points', bulk: true },
      { importRowId: IMPORT_ROWS[3].id, adminDecision: 'apply_no_permission_points', bulk: true }
    ];
    const r = await service.approveLateEvents(adminSession, decisions);
    const byId = Object.fromEntries(r.results.map(x => [x.importRowId, x]));
    assert.strictEqual(byId[IMPORT_ROWS[1].id].applied, true, 'row2 sạch phải được áp dụng');
    assert.strictEqual(byId[IMPORT_ROWS[2].id].applied, false, 'row3 conflict phải bị loại riêng, không throw cả batch');
    assert.strictEqual(byId[IMPORT_ROWS[2].id].skipped, true);
    assert.strictEqual(byId[IMPORT_ROWS[3].id].applied, false, 'row4 over-quota phải bị loại riêng');
    assert.strictEqual(byId[IMPORT_ROWS[3].id].skipped, true);
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-3').length, 0, 'row3 KHÔNG được tạo official (chưa Admin tự resolve)');
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-4').length, 0, 'row4 KHÔNG được tạo official (chưa Admin tự nhập điểm)');
  });

  // =========================================================================
  // E) Re-approve — cùng event (row1, đã approve ở C) -> idempotent, không tạo duplicate.
  // =========================================================================
  await checkAsync('E1. Re-approve row1 (cùng event, đã có linked_violation_id) -> KHÔNG tạo thêm official record mới, trả về ĐÚNG bản ghi cũ', async () => {
    const beforeCount = VIOLATIONS.filter(v => v.import_row_key === 'key-1').length;
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[0].id, adminDecision: 'apply_no_permission_points' }]);
    const afterCount = VIOLATIONS.filter(v => v.import_row_key === 'key-1').length;
    assert.strictEqual(beforeCount, 1);
    assert.strictEqual(afterCount, 1, 're-approve không được tạo thêm bản ghi');
    assert.strictEqual(r.results[0].applied, true);
    assert.strictEqual(r.results[0].record.id, VIOLATIONS.find(v => v.import_row_key === 'key-1').id);
  });

  // =========================================================================
  // F) Override — row5: appliedPoints khác suggested (6) -> reason bắt buộc.
  // =========================================================================
  await checkAsync('F1. Row5 override appliedPoints=20 (khác suggested=6) KHÔNG có reason -> reject CHECKLIST_LATE_RECON_REASON_REQUIRED', async () => {
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[4].id, adminDecision: 'apply_no_permission_points', appliedPoints: 20 }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_REASON_REQUIRED'); return true; }
    );
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-5').length, 0, 'KHÔNG được tạo official khi thiếu reason bắt buộc');
  });
  await checkAsync('F2. Row5 override appliedPoints=20 CÓ reason hợp lệ -> PASS, official points=20 (đúng điểm Admin nhập, không phải suggested)', async () => {
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[4].id, adminDecision: 'apply_no_permission_points', appliedPoints: 20, reason: 'Có bằng chứng bổ sung xác nhận mức phạt cao hơn' }]);
    assert.strictEqual(r.results[0].applied, true);
    assert.strictEqual(r.results[0].record.points, 20);
    assert.strictEqual(r.results[0].record.late_adjustment_reason, 'Có bằng chứng bổ sung xác nhận mức phạt cao hơn');
  });

  // =========================================================================
  // G) Over-quota (row4) — bắt buộc appliedPoints + reason tường minh, không công thức mặc định.
  // =========================================================================
  await checkAsync('G1. Row4 (vượt quota) approve KHÔNG có appliedPoints -> reject CHECKLIST_LATE_RECON_QUOTA_POINTS_REQUIRED', async () => {
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[3].id, adminDecision: 'apply_no_permission_points' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_QUOTA_POINTS_REQUIRED'); return true; }
    );
  });
  await checkAsync('G2. Row4 CÓ appliedPoints nhưng KHÔNG có reason -> reject CHECKLIST_LATE_RECON_QUOTA_REASON_REQUIRED', async () => {
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[3].id, adminDecision: 'apply_no_permission_points', appliedPoints: 12 }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_QUOTA_REASON_REQUIRED'); return true; }
    );
  });
  await checkAsync('G3. Row4 CÓ đủ appliedPoints + reason -> PASS, official points đúng số Admin nhập (không có công thức tự động)', async () => {
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[3].id, adminDecision: 'apply_no_permission_points', appliedPoints: 12, reason: 'Đã vượt quota Duyệt, Admin xem xét thực tế và quyết định mức này' }]);
    assert.strictEqual(r.results[0].applied, true);
    assert.strictEqual(r.results[0].record.points, 12);
  });
  await checkAsync('G4. Bulk luôn loại row4 dù decision có appliedPoints/reason đầy đủ (bulk path chặn TRƯỚC khi xét tới case cụ thể)', async () => {
    // Row4 đã applied ở G3 nên linked_violation_id đã có — dùng lại chính isEligibleForBulkApprove
    // qua 1 dòng over-quota MỚI để verify hành vi bulk (không phụ thuộc đã approve hay chưa).
    const suggestionLike = { matchStatus: 'matched', businessStatus: 'approved_over_quota', suggestedPoints: null };
    assert.strictEqual(recon.isEligibleForBulkApprove(suggestionLike, { businessStatus: 'approved_over_quota' }, { appliedPoints: 12 }), false);
  });

  // =========================================================================
  // H) Conflict (row3) — không tự suy diễn; PHẢI dùng REJECTED_BANDS khi kết luận Không duyệt.
  // =========================================================================
  await checkAsync('H1. Row3 conflict, KHÔNG có reason -> reject CHECKLIST_LATE_RECON_CONFLICT_REASON_REQUIRED', async () => {
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[2].id, adminDecision: 'apply_no_permission_points' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_CONFLICT_REASON_REQUIRED'); return true; }
    );
  });
  await checkAsync('H2. Row3 conflict, CÓ reason nhưng KHÔNG chọn resolvedManagerDecision -> reject CHECKLIST_LATE_RECON_CONFLICT_RESOLUTION_REQUIRED (không tự suy diễn)', async () => {
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[2].id, adminDecision: 'apply_no_permission_points', reason: 'Admin đã xem lại 2 ghi nhận mâu thuẫn' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_CONFLICT_RESOLUTION_REQUIRED'); return true; }
    );
  });
  await checkAsync('H3. Row3 conflict kết luận Không duyệt (12 phút, băng 1-15) -> RUNTIME THẬT dùng REJECTED_BANDS (6đ), KHÔNG dùng nhầm LATE_BANDS/standard_points (3đ) — verify bug-fix bằng dữ liệu chạy thật, không chỉ source-grep', async () => {
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[2].id, adminDecision: 'apply_no_permission_points', resolvedManagerDecision: 'rejected', reason: 'Admin xem lại, kết luận nhân viên không xin phép' }]);
    assert.strictEqual(r.results[0].applied, true);
    assert.strictEqual(r.results[0].record.points, 6, 'PHẢI = REJECTED_BANDS band 1-15 phút (6) — KHÔNG được là 3 (LATE_BANDS, bug cũ)');
    assert.strictEqual(r.results[0].record.manager_decision, 'rejected');
  });

  // =========================================================================
  // I) Monthly — đếm trực tiếp trên bảng official mock (checklistBreakdown() không đổi code,
  //    đã audit riêng — ở đây verify đúng 1 official/event, không có bản nháp/staging lẫn vào).
  // =========================================================================
  await checkAsync('I1. Tổng số official record được tạo trong toàn bộ test = đúng số event đã approve thật (1+1+1+1+1 = 5: key-1,key-2,key-5,key-4,key-3 — KHÔNG đếm re-approve E1 vì không tạo thêm)', async () => {
    const keys = new Set(VIOLATIONS.map(v => v.import_row_key));
    assert.strictEqual(keys.size, 5);
    assert.strictEqual(VIOLATIONS.length, 5, 'mỗi key chỉ đúng 1 record — không có duplicate từ re-approve/bulk-retry');
  });
  await checkAsync('I2. Trước khi approve, KHÔNG có official record nào cho event chưa xử lý (staging row luôn tách biệt khỏi VIOLATION_TABLE cho tới khi Approve) — xác nhận bằng import_row_key chưa từng approve trong test này', async () => {
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-never-approved').length, 0);
  });

  // =========================================================================
  // PREFLIGHT (mục 3 — residual "bulk approval partial-write" đã audit trước release): 1 dòng
  // malformed (thiếu reason) nằm GIỮA batch cùng 2 dòng hoàn toàn sạch (key-6 trước, key-7 sau)
  // -> TOÀN BỘ request phải bị reject, 0 official write cho CẢ 2 dòng sạch (không phải chỉ dòng
  // lỗi bị chặn còn dòng sạch trước đó đã lỡ ghi rồi).
  // =========================================================================
  await checkAsync('PREFLIGHT-1. Batch [key-6 sạch, key-X malformed (thiếu reason, override khác suggested), key-7 sạch] -> reject NGUYÊN request TRƯỚC khi ghi, 0 official write cho key-6 VÀ key-7', async () => {
    const beforeCount = VIOLATIONS.length;
    const decisions = [
      { importRowId: IMPORT_ROWS[5].id, adminDecision: 'apply_no_permission_points' }, // key-6, sạch, hợp lệ
      { importRowId: IMPORT_ROWS[6].id, adminDecision: 'apply_no_permission_points', appliedPoints: 99 }, // key-7 nhưng THIẾU reason dù appliedPoints khác suggested -> malformed
    ];
    await assert.rejects(
      () => service.approveLateEvents(adminSession, decisions),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_REASON_REQUIRED'); return true; }
    );
    const afterCount = VIOLATIONS.length;
    assert.strictEqual(afterCount, beforeCount, 'preflight phải reject TRƯỚC khi ghi — số official record không được tăng dù key-6 (đứng trước trong mảng) hợp lệ');
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-6').length, 0, 'key-6 (đứng TRƯỚC dòng lỗi trong batch) KHÔNG được có official write nào — đây chính là "partial write" cần loại bỏ');
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-7').length, 0, 'key-7 (dòng malformed) dĩ nhiên cũng không có official write');
    const row6 = IMPORT_ROWS.find(r => r.import_row_key === 'key-6');
    assert.strictEqual(row6.row_status, 'pending_approval', 'staging row6 phải giữ nguyên trạng thái ban đầu — preflight không đụng DB trước khi validate xong toàn bộ batch');
  });
  await checkAsync('PREFLIGHT-2. Sau khi batch trên bị reject, key-6 vẫn approve được BÌNH THƯỜNG ở lượt gọi riêng (preflight không làm hỏng dữ liệu/khoá nhầm dòng sạch)', async () => {
    const r = await service.approveLateEvents(adminSession, [{ importRowId: IMPORT_ROWS[5].id, adminDecision: 'apply_no_permission_points' }]);
    assert.strictEqual(r.results[0].applied, true);
    assert.strictEqual(r.results[0].record.points, 6);
    assert.strictEqual(VIOLATIONS.filter(v => v.import_row_key === 'key-6').length, 1);
  });
  await checkAsync('PREFLIGHT-3. importRowId trống/thiếu trong 1 decision giữa batch -> reject NGUYÊN request ngay từ bước đọc rows, không ghi gì', async () => {
    const beforeCount = VIOLATIONS.length;
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [
        { importRowId: IMPORT_ROWS[6].id, adminDecision: 'apply_no_permission_points', reason: 'Lý do hợp lệ đủ 5 ký tự' },
        { importRowId: '', adminDecision: 'apply_no_permission_points' }
      ]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ROW_ID_REQUIRED'); return true; }
    );
    assert.strictEqual(VIOLATIONS.length, beforeCount, 'không được ghi gì kể cả dòng key-7 hợp lệ đứng đầu batch');
  });

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
