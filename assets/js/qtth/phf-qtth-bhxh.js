/* PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) · Truth Data · BHXH (chi phí BHXH doanh nghiệp)
 *
 * Renders window.phfQtthRenderBhxh(slot, boot) — called by phf-qtth-payroll.js's
 * entry dispatcher for key 'truth-data/bhxh' (same delegate-to-sibling-file
 * pattern accounting uses).
 *
 * LOCKED business contracts (Operator):
 *   - employer_cost_source (cột nguồn "TK 642 (21.5%)") hiển thị NGUYÊN VĂN.
 *     Màn hình này KHÔNG tự tính lại bất kỳ số nào.
 *   - Sai lệch kỳ báo cáo (nội dung file vs kỳ đã chọn) KHÔNG tự động chặn —
 *     hiển thị cảnh báo rõ ràng, Admin phải xác nhận TƯỜNG MINH trước khi
 *     "Xác nhận nhập dữ liệu" được mở khóa.
 *   - Dòng thiếu/lỗi mã nhân viên KHÔNG BAO GIỜ bị ẩn — luôn hiển thị trong
 *     hàng đợi "Chưa đối chiếu nhân sự", số tiền vẫn hiển thị trong đối chiếu.
 *   - phòng ban / CN theo nguồn BHXH chỉ mang tính tham khảo — màn hình này
 *     không ghi đè hồ sơ tổ chức QTTH theo tháng.
 */
(function () {
  'use strict';

  function S() { return window.__qtthShared || {}; }
  function esc(v) { return (S().esc ? S().esc : function (x) { return String(x == null ? '' : x); })(v); }
  function call(a, f) { return S().call(a, f); }
  function toast(k, t, m) { try { S().toast(k, t, m); } catch (e) {} }
  function go(p) { return S().go ? S().go(p) : (location.href = p); }
  function qbase() { return (S().prefix ? S().prefix() : '/admin') + '/qtth'; }
  function curPeriod() { return S().currentPeriod ? S().currentPeriod() : new Date().toISOString().slice(0, 7); }

  function fmtN(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }
  function fmtDT(v) { if (!v) return '—'; try { return new Date(v).toLocaleString('vi-VN'); } catch (e) { return esc(v); } }
  function pill(txt, kind) { return '<span class="phf-qtth-pill ' + (kind || 'is-off') + '">' + esc(txt) + '</span>'; }

  /* ================================ STATE ================================ */
  var BS = {
    period: '',
    status: null,
    needsReview: null,   // { rows: [...] }
    matched: null,       // { rows: [...] }
    recon: null,         // reconciliation read model
    wizard: null,         // { step, file:{name,base64,size}, report, ackChoice }
    mapOpen: null,        // normalizedId currently being resolved inline
    mapMode: 'employee_code', // 'employee_code' | 'local_identity' — active tab in the inline resolve form
  };
  var MAX_UPLOAD_BYTES = 1024 * 1024;

  async function renderBhxh(slot) {
    BS.period = BS.period || curPeriod();
    slot.innerHTML = '<section class="phf-qtth-card"><p class="phf-qtth-muted">Đang tải dữ liệu BHXH…</p></section>';
    try {
      BS.status = await call('qtthBhxhStatus', { period_month: BS.period });
      var hasCurrent = !!(BS.status && BS.status.current);
      BS.needsReview = hasCurrent ? await call('qtthBhxhListNormalized', { period_month: BS.period, classification: 'NEEDS_REVIEW' }) : { rows: [] };
      BS.matched = hasCurrent ? await call('qtthBhxhListNormalized', { period_month: BS.period, classification: 'MATCHED' }) : { rows: [] };
      BS.recon = null;
      if (hasCurrent) {
        try { BS.recon = await call('qtthBhxhReconciliation', { period_month: BS.period }); }
        catch (e) { BS.recon = { _error: (e && e.message) || 'Không tải được đối chiếu.' }; }
      }
      paintBhxh(slot);
    } catch (err) {
      slot.innerHTML = '<section class="phf-qtth-card phf-qtth-denied"><h2>Không tải được BHXH</h2>'
        + '<p>' + esc(err.message) + '</p>'
        + '<button type="button" class="phf-qtth-btn" data-retry>Thử lại</button></section>';
      var r = slot.querySelector('[data-retry]'); if (r) r.onclick = function () { renderBhxh(slot); };
    }
  }

  function paintBhxh(slot) {
    var st = BS.status || {};
    var cur = st.current || null;
    slot.innerHTML =
      '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head">'
      + '<div><h2>BHXH — Chi phí BHXH doanh nghiệp</h2>'
      + '<p class="phf-qtth-muted"><button type="button" class="phf-qtth-link" data-back>← Truth Data</button> · '
      + 'Company PostgreSQL · Nguồn thứ 2 cho Chi phí nhân sự (cùng Bảng lương)</p></div>'
      + '<div class="phf-qtth-head-actions">'
      + '<label class="phf-qtth-field"><span>Kỳ BHXH</span><input type="month" value="' + esc(BS.period) + '" data-period></label>'
      + '<button type="button" class="phf-qtth-btn" data-import>Nhập BHXH</button>'
      + '</div>'
      + '</div>'
      + effectiveVersionHtml(st, cur)
      + versionHistoryHtml(st)
      + '</section>'
      + reconciliationHtml(BS.recon)
      + needsReviewHtml(BS.needsReview)
      + matchedTableHtml(BS.matched)
      + '<p class="phf-qtth-muted phf-qtth-count">phòng ban / CN theo nguồn BHXH chỉ mang tính tham khảo — không thay đổi hồ sơ tổ chức QTTH theo tháng.</p>'
      + '<div class="phf-qtth-drawer-host" data-drawer-host hidden></div>'
      + '<div class="phf-qtth-modal-host" data-wizard-host hidden></div>';

    slot.querySelector('[data-back]').onclick = function () { go(qbase() + '/truth-data'); };
    slot.querySelector('[data-period]').onchange = function (e) {
      var v = String(e.target.value || '').trim();
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) { toast('error', 'Kỳ không hợp lệ', 'Định dạng YYYY-MM.'); return; }
      BS.period = v; BS.wizard = null; renderBhxh(slot);
    };
    slot.querySelector('[data-import]').onclick = function () { BS.wizard = { step: 1 }; renderWizard(slot); };
    slot.querySelectorAll('[data-map-open]').forEach(function (b) {
      b.onclick = function () { BS.mapOpen = b.getAttribute('data-map-open'); BS.mapMode = 'employee_code'; paintBhxh(slot); };
    });
    slot.querySelectorAll('[data-map-cancel]').forEach(function (b) {
      b.onclick = function () { BS.mapOpen = null; paintBhxh(slot); };
    });
    slot.querySelectorAll('[data-map-mode]').forEach(function (b) {
      b.onclick = function () { BS.mapMode = b.getAttribute('data-map-mode'); paintBhxh(slot); };
    });
    slot.querySelectorAll('[data-map-submit]').forEach(function (b) {
      b.onclick = function () { runMapIdentity(slot, b.getAttribute('data-map-submit')); };
    });
  }

  function effectiveVersionHtml(st, cur) {
    if (!st.exists || !cur) {
      return '<div class="phf-qtth-warn"><span>⚠ Kỳ ' + esc(st.periodMonth || BS.period)
        + ' chưa có phiên bản BHXH nào được xác nhận. Bấm “Nhập BHXH” để bắt đầu.</span></div>';
    }
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Phiên bản hiệu lực</b><span>V' + esc(cur.version) + '</span></div>'
      + '<div><b>Người nhập</b><span>' + esc(cur.uploadedBy || '—') + '</span></div>'
      + '<div><b>Thời điểm xác nhận</b><span>' + esc(fmtDT(cur.confirmedAt || cur.uploadedAt)) + '</span></div>'
      + '<div><b>Số dòng nguồn</b><span>' + esc(cur.rowCount) + '</span></div>'
      + '<div><b>Tổng TK642 (nguồn)</b><span class="c-final">' + fmtN(cur.sourceTotalEmployerCost) + ' đ</span></div>'
      + '<div><b>Chưa đối chiếu nhân sự</b><span>' + esc(cur.needsReviewCount || 0) + ' dòng · ' + fmtN(cur.needsReviewAmount) + ' đ</span></div>'
      + '<div><b>Kỳ báo cáo</b><span>' + (cur.periodMismatch
        ? (cur.periodMismatchAck ? pill('Khác nội dung file — đã xác nhận', 'is-warn') : pill('Khác nội dung file — CHƯA xác nhận', 'is-off'))
        : pill('Khớp nội dung file', 'is-on')) + '</span></div>'
      + '</div>';
  }

  function versionHistoryHtml(st) {
    var vs = (st && st.versions) || [];
    if (!vs.length) return '';
    var lbl = { previewed: 'Nháp (chưa xác nhận)', confirmed: 'Đã xác nhận', superseded: 'Đã thay thế' };
    return '<details class="phf-qtth-td-vh"' + (vs.length <= 3 ? ' open' : '') + '>'
      + '<summary>Lịch sử phiên bản (' + vs.length + ')</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:860px">'
      + '<thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Tên file</th><th>Số dòng</th>'
      + '<th>Tổng TK642 (nguồn)</th><th>Chưa đối chiếu</th><th>Kỳ báo cáo</th><th>Người nhập</th><th>Thời điểm</th></tr></thead><tbody>'
      + vs.map(function (v) {
        return '<tr' + (v.isCurrent ? ' class="is-selected"' : '') + '>'
          + '<td class="c-code">V' + esc(v.version) + (v.isCurrent ? ' ' + pill('hiệu lực', 'is-on') : '') + '</td>'
          + '<td>' + esc(lbl[v.status] || v.status) + '</td>'
          + '<td>' + esc(v.fileName) + '</td>'
          + '<td>' + esc(v.rowCount) + '</td>'
          + '<td class="c-num">' + fmtN(v.sourceTotalEmployerCost) + '</td>'
          + '<td>' + esc(v.needsReviewCount || 0) + ' · ' + fmtN(v.needsReviewAmount) + '</td>'
          + '<td>' + (v.periodMismatch ? (v.periodMismatchAck ? 'Khác — đã xác nhận' : 'Khác — CHƯA xác nhận') : 'Khớp') + '</td>'
          + '<td>' + esc(v.uploadedBy || '—') + '</td>'
          + '<td>' + esc(fmtDT(v.confirmedAt || v.uploadedAt)) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></details>';
  }

  function reconciliationHtml(recon) {
    if (!recon) return '';
    if (recon._error) {
      return '<section class="phf-qtth-card"><h2>Đối chiếu BHXH</h2><p class="phf-qtth-warn-inline">⚠ ' + esc(recon._error) + '</p></section>';
    }
    if (!recon.exists) {
      return '<section class="phf-qtth-card"><h2>Đối chiếu BHXH</h2><p class="phf-qtth-empty">Kỳ này chưa có phiên bản hiệu lực.</p></section>';
    }
    var st = recon.reconciled
      ? pill('Đã khớp với tổng nguồn', 'is-on')
      : pill('Chưa khớp — xem chi tiết bên dưới', 'is-off');
    return '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head"><div><h2>Đối chiếu BHXH</h2>'
      + '<p class="phf-qtth-muted">Luôn tính theo phiên bản HIỆN ĐANG HIỆU LỰC (V' + esc(recon.version) + ') — không dùng phiên bản cũ.</p>'
      + '</div><div>' + st + '</div></div>'
      + '<div class="phf-qtth-td-effective">'
      + '<div><b>Tổng TK642 theo nguồn</b><span class="c-final">' + fmtN(recon.sourceTotal) + ' đ</span></div>'
      + '<div><b>Đã khớp danh tính</b><span>' + fmtN(recon.matchedAmount) + ' đ</span></div>'
      + '<div><b>Chưa đối chiếu nhân sự</b><span>' + fmtN(recon.needsReviewAmount) + ' đ (' + esc(recon.needsReviewCount) + ' dòng)</span></div>'
      + '</div>'
      + '<p class="phf-qtth-muted phf-qtth-count">Số tiền chờ xác định danh tính KHÔNG bị trừ khỏi tổng nguồn — vẫn hiển thị đầy đủ cho tới khi Admin xác định.</p>'
      + '</section>';
  }

  function needsReviewHtml(nr) {
    var rows = (nr && nr.rows) || [];
    if (!rows.length) {
      return '<section class="phf-qtth-card"><h2>Chưa đối chiếu nhân sự</h2>'
        + '<p class="phf-qtth-empty">Không có dòng nào chưa đối chiếu nhân sự.</p></section>';
    }
    return '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head"><div><h2>Chưa đối chiếu nhân sự (' + rows.length + ')</h2>'
      + '<p class="phf-qtth-muted">Chưa xác định được nhân sự hệ thống cho dòng nguồn này — KHÔNG phải lỗi, KHÔNG bị loại bỏ, số tiền vẫn được giữ và hiển thị.</p></div></div>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table">'
      + '<thead><tr><th>Dòng nguồn</th><th>Mã đọc được</th><th>Họ và tên (nguồn)</th><th>Phòng ban (nguồn, tham khảo)</th>'
      + '<th>TK642 (nguồn)</th><th>Lý do</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        var mapOpen = BS.mapOpen === String(r.normalizedId);
        return '<tr class="is-warn-row">'
          + '<td>' + esc(r.sourceRowIndex) + '</td>'
          + '<td class="c-code">' + esc(r.employeeCode || '(trống)') + '</td>'
          + '<td class="c-name">' + esc(r.fullNameSource || '—') + '</td>'
          + '<td>' + esc(r.sourceDepartment || '—') + '</td>'
          + '<td class="c-num">' + fmtN(r.employerCostSource) + '</td>'
          + '<td>' + esc(reviewReasonLabel(r.reviewReason)) + '</td>'
          + '<td class="c-act">'
          + (mapOpen
            ? mapFormHtml(r)
            : '<button type="button" class="phf-qtth-link" data-map-open="' + esc(r.normalizedId) + '">Đối chiếu nhân sự</button>')
          + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></section>';
  }
  function reviewReasonLabel(r) {
    if (r === 'MISSING_EMPLOYEE_CODE') return 'Nguồn không có mã nhân viên';
    if (r === 'INVALID_EMPLOYEE_CODE_FORMAT') return 'Mã nhân viên chưa xác định được';
    if (r === 'EMPLOYEE_CODE_NOT_IN_QTTH_ROSTER') return 'Mã nhân viên không có trong danh sách Phân quyền QTTH';
    return r || '—';
  }
  function mapFormHtml(r) {
    var mode = BS.mapMode || 'employee_code';
    return '<div class="phf-qtth-map-form" style="flex-direction:column;align-items:flex-start;gap:6px">'
      + '<div class="phf-qtth-map-tabs">'
      + '<button type="button" class="phf-qtth-toggle' + (mode === 'employee_code' ? ' is-on' : '') + '" data-map-mode="employee_code">Gán nhân sự hệ thống</button>'
      + '<button type="button" class="phf-qtth-toggle' + (mode === 'local_identity' ? ' is-on' : '') + '" data-map-mode="local_identity">Xác nhận nhân sự không có tài khoản</button>'
      + '</div>'
      + (mode === 'employee_code'
        ? '<input type="text" placeholder="Mã NV (VD: PHF012)" data-map-code="' + esc(r.normalizedId) + '" style="text-transform:uppercase;width:140px">'
        : '<input type="text" placeholder="Họ và tên xác nhận" value="' + esc(r.fullNameSource || '') + '" data-map-name="' + esc(r.normalizedId) + '" style="width:200px">')
      + '<input type="text" placeholder="' + (mode === 'local_identity' ? 'Lý do (bắt buộc — VD: đã nghỉ việc, chưa từng có tài khoản)' : 'Ghi chú (tuỳ chọn)') + '" data-map-note="' + esc(r.normalizedId) + '" style="width:280px">'
      + '<div>'
      + '<button type="button" class="phf-qtth-btn" data-map-submit="' + esc(r.normalizedId) + '">' + (mode === 'local_identity' ? 'Xác nhận nhân sự không có tài khoản' : 'Gán nhân sự hệ thống') + '</button>'
      + ' <button type="button" class="phf-qtth-btn ghost" data-map-cancel>Hủy</button>'
      + '</div>'
      + '</div>';
  }

  async function runMapIdentity(slot, normalizedId) {
    var mode = BS.mapMode || 'employee_code';
    var noteInput = slot.querySelector('[data-map-note="' + normalizedId + '"]');
    var note = (noteInput && noteInput.value) || '';
    if (mode === 'employee_code') {
      var codeInput = slot.querySelector('[data-map-code="' + normalizedId + '"]');
      var code = String((codeInput && codeInput.value) || '').trim().toUpperCase();
      if (!/^PHF[0-9]{3,6}$/i.test(code)) { toast('error', 'Mã nhân viên không hợp lệ', 'Định dạng PHFxxx.'); return; }
      try {
        await call('qtthBhxhMapIdentity', { normalized_id: Number(normalizedId), mode: 'employee_code', employee_code: code, note: note });
        toast('success', 'Đã gán danh tính', code);
        BS.mapOpen = null; await renderBhxh(slot);
      } catch (err) { toast('error', 'Gán không thành công', err.message); }
      return;
    }
    var nameInput = slot.querySelector('[data-map-name="' + normalizedId + '"]');
    var displayName = String((nameInput && nameInput.value) || '').trim();
    if (!displayName) { toast('error', 'Thiếu họ tên', 'Cần xác nhận họ và tên.'); return; }
    if (!note.trim()) { toast('error', 'Thiếu lý do', 'Cần ghi lý do (VD: đã nghỉ việc, chưa từng có tài khoản hệ thống).'); return; }
    try {
      await call('qtthBhxhMapIdentity', { normalized_id: Number(normalizedId), mode: 'local_identity', display_name: displayName, note: note });
      toast('success', 'Đã xác nhận nhân sự hợp lệ (không tài khoản)', displayName);
      BS.mapOpen = null; await renderBhxh(slot);
    } catch (err) { toast('error', 'Xác nhận không thành công', err.message); }
  }

  function matchedTableHtml(m) {
    var rows = (m && m.rows) || [];
    if (!rows.length) {
      return '<section class="phf-qtth-card"><h2>Dữ liệu BHXH đã chuẩn hóa</h2>'
        + '<p class="phf-qtth-empty">Chưa có phiên bản hiệu lực cho kỳ này.</p></section>';
    }
    return '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head"><div><h2>Dữ liệu BHXH đã chuẩn hóa</h2>'
      + '<p class="phf-qtth-muted">' + rows.length + ' nhân sự đã khớp danh tính · TK642 hiển thị nguyên văn từ nguồn.</p></div></div>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table">'
      + '<thead><tr><th>Mã NV / Danh tính</th><th>Họ và tên (nguồn)</th><th>Phòng ban theo Phân quyền QTTH</th><th>Phòng ban (nguồn BHXH, tham khảo)</th>'
      + '<th>Mức lương đóng BHXH</th><th>TK642 (nguồn — chi phí BHXH DN)</th><th>Trạng thái danh tính</th></tr></thead><tbody>'
      + rows.map(function (r) {
        var statusBadges = [];
        if (r.identityKind === 'local_identity') statusBadges.push(pill('Nhân sự không tài khoản', 'is-warn'));
        if (r.identityAutoResolved) statusBadges.push(pill('Tự nhớ từ kỳ trước', 'is-on'));
        else if (r.employeeCodeResolved) statusBadges.push(pill('Đã gán thủ công', 'is-warn'));
        if (r.employeeInactiveWarning) statusBadges.push(pill('⚠ Nhân sự đã nghỉ — vẫn phát sinh chi phí', 'is-off'));
        var qtthDept = [r.qtthUnitName, r.qtthGroupName].filter(Boolean).join(' / ');
        var deptMismatch = qtthDept && r.sourceDepartment && qtthDept.indexOf(r.sourceDepartment) === -1 && r.sourceDepartment.indexOf(qtthDept) === -1;
        return '<tr' + (r.employeeInactiveWarning ? ' class="is-warn-row"' : '') + '>'
          + '<td class="c-code">' + esc(r.employeeCode || (r.identityKind === 'local_identity' ? '(không tài khoản)' : '—')) + '</td>'
          + '<td class="c-name">' + esc(r.fullNameSource || '—') + '</td>'
          + '<td>' + (qtthDept ? esc(qtthDept) : '<span class="phf-qtth-muted">Chưa phân loại ở Phân quyền QTTH</span>') + '</td>'
          + '<td>' + esc(r.sourceDepartment || '—') + (deptMismatch ? ' <span class="phf-qtth-warndot" title="Khác phòng ban theo Phân quyền QTTH — chỉ để tham khảo, không dùng làm số liệu báo cáo">?</span>' : '') + '</td>'
          + '<td class="c-num">' + fmtN(r.baseSalaryBhxh) + '</td>'
          + '<td class="c-num c-final">' + fmtN(r.employerCostSource) + '</td>'
          + '<td>' + (statusBadges.length ? statusBadges.join(' ') : '—') + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<p class="phf-qtth-muted phf-qtth-count">TK642 (21.5%) là số nguyên văn từ file nguồn — KHÔNG được tính lại, KHÔNG suy luận từ TK334 hay cột phần đóng của người lao động. '
      + 'Phòng ban báo cáo lấy từ Phân quyền QTTH theo Mã NV; phòng ban trong file BHXH chỉ để tham khảo/cảnh báo khi khác nhau, không phải số liệu báo cáo.</p>'
      + '</section>';
  }

  /* ------------------------------- WIZARD ------------------------------ */
  var STEP_LABELS = ['Chọn kỳ', 'Tải file', 'Kiểm tra', 'Xác nhận kỳ báo cáo', 'Xem trước', 'Xác nhận'];

  function renderWizard(slot) {
    var host = slot.querySelector('[data-wizard-host]'); if (!host) return;
    host.hidden = false;
    var w = BS.wizard;
    var needsAckStep = !!(w.report && w.report.periodMismatch && w.report.periodMismatch.mismatch);
    var visibleSteps = STEP_LABELS.filter(function (_, i) { return i !== 3 || needsAckStep; });
    var stepIndex = w.step - 1;

    host.innerHTML =
      '<div class="phf-qtth-drawer-backdrop" data-wz-close></div>'
      + '<div class="phf-qtth-modal">'
      + '<header><strong>Nhập BHXH — kỳ ' + esc(BS.period) + '</strong>'
      + '<button type="button" data-wz-close aria-label="Đóng">×</button></header>'
      + '<ol class="phf-qtth-steps">'
      + visibleSteps.map(function (lbl, i) {
        var realIdx = STEP_LABELS.indexOf(lbl);
        var cls = realIdx < stepIndex ? 'is-done' : (realIdx === stepIndex ? 'is-now' : '');
        return '<li class="' + cls + '"><span>' + (i + 1) + '</span>' + esc(lbl) + '</li>';
      }).join('')
      + '</ol>'
      + '<div class="phf-qtth-modal-body" data-wz-body></div>'
      + '</div>';
    host.querySelectorAll('[data-wz-close]').forEach(function (b) {
      b.onclick = function () { BS.wizard = null; host.hidden = true; host.innerHTML = ''; };
    });
    paintWizardStep(slot);
  }

  function paintWizardStep(slot) {
    var host = slot.querySelector('[data-wizard-host]');
    var body = host.querySelector('[data-wz-body]');
    var w = BS.wizard;
    var needsAckStep = !!(w.report && w.report.periodMismatch && w.report.periodMismatch.mismatch);

    if (w.step === 1) {
      body.innerHTML = '<p>Chọn kỳ báo cáo BHXH cần nhập (theo lựa chọn của Admin — có thể khác nội dung file, hệ thống sẽ cảnh báo nếu vậy).</p>'
        + '<label class="phf-qtth-field"><span>Kỳ BHXH</span><input type="month" value="' + esc(BS.period) + '" data-wz-period></label>'
        + wizardNav({ next: 'Tiếp tục' });
      body.querySelector('[data-wz-period]').onchange = function (e) {
        var v = String(e.target.value || '').trim();
        if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) BS.period = v;
        renderWizard(slot);
      };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 2; renderWizard(slot); };
      return;
    }

    if (w.step === 2) {
      body.innerHTML = '<p>Chọn file BHXH <b>.xlsx</b> (sheet TỔNG_BHXH, giới hạn 1 MB).</p>'
        + '<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-wz-file>'
        + '<div data-wz-fileinfo class="phf-qtth-muted" style="margin-top:8px"></div>'
        + wizardNav({ back: 1, next: 'Kiểm tra file', nextDisabled: !w.file });
      var info = body.querySelector('[data-wz-fileinfo]');
      if (w.file) info.textContent = w.file.name + ' · ' + (w.file.size / 1024).toFixed(1) + ' KB';
      body.querySelector('[data-wz-file]').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        if (!/\.xlsx$/i.test(f.name)) { toast('error', 'Sai định dạng', 'Chỉ nhận file .xlsx.'); return; }
        if (f.size > MAX_UPLOAD_BYTES) { toast('error', 'File quá lớn', 'Tối đa 1 MB.'); return; }
        var rd = new FileReader();
        rd.onload = function () {
          var b64 = String(rd.result || '').split(',')[1] || '';
          w.file = { name: f.name, size: f.size, base64: b64 };
          w.report = null;
          renderWizard(slot);
        };
        rd.onerror = function () { toast('error', 'Không đọc được file', ''); };
        rd.readAsDataURL(f);
      };
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 1; renderWizard(slot); };
      var nx = body.querySelector('[data-wz-next]');
      if (nx) nx.onclick = function () { runValidate(slot); };
      return;
    }

    if (w.step === 3) {
      var r = w.report;
      body.innerHTML = validateReportHtml(r)
        + wizardNav({ back: 2, next: needsAckStep ? 'Sang xác nhận kỳ báo cáo' : 'Xem trước dữ liệu' });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 2; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = needsAckStep ? 4 : 5; renderWizard(slot); };
      return;
    }

    if (w.step === 4) {
      var pm = w.report.periodMismatch || {};
      body.innerHTML = '<div class="phf-qtth-warn"><span>⚠ Nội dung file cho thấy kỳ khác với kỳ đã chọn. Đây KHÔNG tự động bị chặn — '
        + 'nhưng Admin PHẢI xác nhận rõ ràng kỳ báo cáo dự định trước khi có thể xác nhận nhập liệu.</span></div>'
        + '<div class="phf-qtth-td-effective">'
        + '<div><b>Kỳ đã chọn</b><span>' + esc(pm.selectedPeriod) + '</span></div>'
        + '<div><b>Bằng chứng trong nội dung file</b><span>' + esc(pm.sourcePeriodLabel || '—') + ' (' + esc(pm.sourcePeriodMonth || '—') + ')</span></div>'
        + '<div><b>Tên file đã tải lên</b><span>' + esc(pm.filenameEvidence) + '</span></div>'
        + '</div>'
        + '<label class="phf-qtth-check"><input type="checkbox" data-wz-ack> Tôi xác nhận kỳ báo cáo dự định cho lần nhập này là <b>' + esc(BS.period) + '</b> (không phải hệ thống tự chọn).</label>'
        + wizardNav({ back: 3, next: 'Xem trước dữ liệu', nextDisabled: true });
      var ackBox = body.querySelector('[data-wz-ack]'), nx4 = body.querySelector('[data-wz-next]');
      ackBox.onchange = function () { nx4.disabled = !ackBox.checked; };
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 3; renderWizard(slot); };
      nx4.onclick = function () { runAcknowledgePeriod(slot); };
      return;
    }

    if (w.step === 5) {
      body.innerHTML = previewHtml(w.report)
        + wizardNav({ back: needsAckStep ? 4 : 3, next: 'Xác nhận nhập dữ liệu' });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = needsAckStep ? 4 : 3; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 6; renderWizard(slot); };
      return;
    }

    if (w.step === 6) {
      var vr = w.report.versionDiff || {};
      body.innerHTML = '<p>Xác nhận đưa phiên bản <b>V' + esc(w.report.version) + '</b> thành dữ liệu BHXH hiệu lực cho kỳ ' + esc(BS.period) + '.</p>'
        + '<ul class="phf-qtth-recon">'
        + '<li><b>NEW</b><span>' + (vr.added || []).length + ' dòng</span></li>'
        + '<li><b>CHANGED</b><span>' + (vr.changed || []).length + ' dòng</span></li>'
        + '<li><b>UNCHANGED</b><span>' + (vr.unchanged || []).length + ' dòng</span></li>'
        + '<li><b>MISSING</b><span>' + (vr.missing || []).length + ' dòng (giữ lịch sử, không xóa)</span></li>'
        + '</ul>'
        + '<p class="phf-qtth-muted">Tổng TK642 (nguồn): <b>' + fmtN(w.report.employerCost && w.report.employerCost.sourceTotal) + ' đ</b> — giữ nguyên, không tính lại.</p>'
        + wizardNav({ back: 5, next: 'Xác nhận nhập dữ liệu', primary: true });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 5; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { runConfirm(slot); };
      return;
    }
  }

  function wizardNav(o) {
    return '<div class="phf-qtth-modal-nav">'
      + (o.back ? '<button type="button" class="phf-qtth-btn ghost" data-wz-back>Quay lại</button>' : '<span></span>')
      + (o.next ? '<button type="button" class="phf-qtth-btn" data-wz-next' + (o.nextDisabled ? ' disabled' : '') + '>' + esc(o.next) + '</button>' : '')
      + '</div>';
  }
  function chipList(arr) {
    if (!arr || !arr.length) return '<p class="phf-qtth-muted">—</p>';
    return '<p>' + arr.map(function (x) { return '<span class="phf-qtth-chip">' + esc(x) + '</span>'; }).join(' ') + '</p>';
  }

  async function runValidate(slot) {
    var w = BS.wizard;
    var body = slot.querySelector('[data-wz-body]');
    var nx = body.querySelector('[data-wz-next]'); if (nx) nx.disabled = true;
    body.insertAdjacentHTML('beforeend', '<p class="phf-qtth-muted" data-wz-loading>Đang tải lên &amp; kiểm tra…</p>');
    try {
      w.report = await call('qtthBhxhValidatePreview', {
        period_month: BS.period, file_name: w.file.name, file_base64: w.file.base64
      });
      w.step = 3;
      renderWizard(slot);
    } catch (err) {
      var l = body.querySelector('[data-wz-loading]'); if (l) l.remove();
      if (nx) nx.disabled = false;
      toast('error', 'Kiểm tra không thành công', err.message);
    }
  }

  async function runAcknowledgePeriod(slot) {
    var w = BS.wizard;
    var body = slot.querySelector('[data-wz-body]');
    var nx = body.querySelector('[data-wz-next]'); if (nx) nx.disabled = true;
    try {
      await call('qtthBhxhAcknowledgePeriod', { file_id: w.report.fileId, acknowledged_period_month: BS.period });
      w.step = 5;
      renderWizard(slot);
    } catch (err) {
      if (nx) nx.disabled = false;
      toast('error', 'Xác nhận kỳ báo cáo không thành công', err.message);
    }
  }

  async function runConfirm(slot) {
    var w = BS.wizard;
    var body = slot.querySelector('[data-wz-body]');
    var nx = body.querySelector('[data-wz-next]'); if (nx) nx.disabled = true;
    try {
      var res = await call('qtthBhxhConfirm', { file_id: w.report.fileId });
      toast('success', 'Đã nhập dữ liệu BHXH',
        'Kỳ ' + BS.period + ' · V' + w.report.version
        + (res && res.deltaCounts ? ' · +' + res.deltaCounts.added + ' / ~' + res.deltaCounts.changed + ' / -' + res.deltaCounts.removedMissing : ''));
      BS.wizard = null;
      var host = slot.querySelector('[data-wizard-host]'); if (host) { host.hidden = true; host.innerHTML = ''; }
      renderBhxh(slot);
    } catch (err) {
      if (nx) nx.disabled = false;
      toast('error', 'Xác nhận không thành công', err.message);
    }
  }

  function validateReportHtml(r) {
    var t = r.totals || {};
    var ec = r.employerCost || {};
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Số dòng nguồn</b><span>' + esc(t.rows || 0) + '</span></div>'
      + '<div><b>Đã khớp danh tính</b><span>' + esc(t.matched || 0) + '</span></div>'
      + '<div><b>Chưa đối chiếu</b><span>' + esc(t.needsReview || 0) + '</span></div>'
      + '<div><b>Tổng TK642 (nguồn, nguyên văn)</b><span class="c-final">' + fmtN(ec.sourceTotal) + ' đ</span></div>'
      + '<div><b>Tổng tính từ các dòng đã đọc</b><span>' + fmtN(ec.computedTotal) + ' đ</span></div>'
      + '<div><b>Đối chiếu</b><span>' + (ec.reconciled ? 'Khớp' : 'Chưa khớp — xem chi tiết sau khi nhập') + '</span></div>'
      + '<div><b>File</b><span>' + esc(r.fileName) + ' · ' + esc((r.byteSize / 1024).toFixed(1)) + ' KB</span></div>'
      + '</div>'
      + (r.periodMismatch && r.periodMismatch.mismatch
        ? '<p class="phf-qtth-warn-inline">⚠ Kỳ đã chọn (' + esc(r.periodMismatch.selectedPeriod) + ') khác với nội dung file ('
          + esc(r.periodMismatch.sourcePeriodLabel || '—') + '). Bước tiếp theo yêu cầu xác nhận tường minh.</p>'
        : '<p class="phf-qtth-muted">Kỳ đã chọn khớp với nội dung file.</p>')
      + ((t.unknownEmployeeCodes || []).length
        ? '<h3>Mã NV không có trong People Master</h3>' + chipList(t.unknownEmployeeCodes) : '')
      + ((t.duplicateInFile || []).length
        ? '<h3>Mã NV trùng trong file</h3><ul class="phf-qtth-hist">'
          + t.duplicateInFile.map(function (d) { return '<li>' + esc(d.employeeCode) + ' — dòng ' + esc((d.rows || []).join(', ')) + '</li>'; }).join('') + '</ul>' : '');
  }

  function previewHtml(r) {
    var vd = r.versionDiff || {};
    var changed = vd.changed || [];
    return '<p>' + (vd.isFirstVersion
      ? 'Đây là phiên bản đầu tiên (V1) của kỳ ' + esc(BS.period) + '.'
      : 'So với phiên bản hiệu lực V' + esc(vd.previousVersion) + ':') + '</p>'
      + '<ul class="phf-qtth-recon">'
      + '<li><b>NEW</b><span>' + (vd.added || []).length + '</span></li>'
      + '<li><b>CHANGED</b><span>' + changed.length + '</span></li>'
      + '<li><b>UNCHANGED</b><span>' + (vd.unchanged || []).length + '</span></li>'
      + '<li><b>MISSING</b><span>' + (vd.missing || []).length + '</span></li>'
      + '</ul>'
      + (changed.length
        ? '<h3>Thay đổi theo từng dòng</h3><div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:620px"><thead><tr><th>Mã NV / dòng</th><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>'
          + changed.slice(0, 200).map(function (c) {
            return (c.changes || []).map(function (ch) {
              return '<tr><td class="c-code">' + esc(c.employeeCode || ('dòng ' + c.sourceRowIndex)) + '</td><td><code>' + esc(ch.field)
                + '</code></td><td class="c-num">' + fmtN(ch.before) + '</td><td class="c-num">' + fmtN(ch.after) + '</td></tr>';
            }).join('');
          }).join('')
          + '</tbody></table></div>'
        : '')
      + ((vd.missing || []).length
        ? '<h3>Vắng mặt so với phiên bản trước (không xóa — ghi nhận trạng thái)</h3>'
          + chipList(vd.missing.map(function (m) { return m.employeeCode || ('dòng ' + m.sourceRowIndex); })) : '');
  }

  /* =============================== ENTRY ================================ */
  window.phfQtthRenderBhxh = async function (slot, boot) {
    await renderBhxh(slot);
  };

  // offline render-check hooks (pure HTML builders — no DOM, no network)
  window.__qtthBhxhTestHooks = { esc: esc, fmtN: fmtN, reviewReasonLabel: reviewReasonLabel };
})();
