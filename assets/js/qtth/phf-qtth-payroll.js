/* PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) · Truth Data · Bảng lương (Batch 02)
 *
 * Renders window.phfQtthRenderTruthData(slot, boot, key) — called by
 * assets/js/qtth/phf-qtth-app.js for key ∈ { 'truth-data', 'truth-data/payroll' }.
 *
 * - Canonical datastore = Company PostgreSQL phf_hr / schema payroll, reached
 *   ONLY through the QTTH bridge (api/_lib/qtth-actions.js -> phf-hr-api /v1/qtth).
 *   This screen never talks to Supabase; employee identity is resolved
 *   server-side (People Master, read-only) for unknown-code detection.
 * - Authority is server-authoritative (dev-lock + permission-manager). The app
 *   shell already route-guards `truth-data` on caps.canManagePermissions; this
 *   file assumes it is only reached by an authorised viewer and still fails
 *   soft on every server error.
 * - Uploaded VALUE is authoritative. Arithmetic differences are shown as
 *   warnings (uploaded vs calculated), never corrections (contract D1–D9 +
 *   the standing rule live in phf-hr-api, not here).
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

  /* ============================ TRUTH DATA LANDING ======================== */
  function renderLanding(slot) {
    slot.innerHTML =
      '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head"><div>'
      + '<h2>Truth Data — Dữ liệu chuẩn quản trị</h2>'
      + '<p class="phf-qtth-muted">Nguồn dữ liệu quản trị đã được chuẩn hóa &amp; phiên bản hóa. '
      + 'Định danh nhân sự lấy từ People Master (chỉ đọc); dữ liệu chuẩn lưu tại Company PostgreSQL.</p>'
      + '</div></div>'
      + '<div class="phf-qtth-td-sources">'
      + sourceCard({
        key: 'payroll', title: 'Bảng lương', sub: 'Dữ liệu chuẩn quản trị',
        desc: 'Nhập bảng lương hằng tháng (mẫu chuẩn PHF V1) → hệ thống đọc, chuẩn hóa, đối soát số học (cảnh báo, không sửa), lưu phiên bản và lịch sử thay đổi.',
        active: true
      })
      + sourceCard({
        key: 'accounting', title: 'Chứng từ kế toán', sub: 'Bảng kê chứng từ · Danh mục phí',
        desc: 'Sẽ triển khai sau. Chưa mở trong giai đoạn này.',
        active: false
      })
      + '</div>'
      + '</section>';
    slot.querySelectorAll('[data-td-open]').forEach(function (b) {
      b.onclick = function () { go(qbase() + '/truth-data/' + b.getAttribute('data-td-open')); };
    });
  }
  function sourceCard(s) {
    return '<div class="phf-qtth-td-source' + (s.active ? '' : ' is-off') + '">'
      + '<div class="phf-qtth-td-source-head"><strong>' + esc(s.title) + '</strong>'
      + (s.active ? '<span class="phf-qtth-tag">Đang dùng</span>' : '<span class="phf-qtth-chip is-unset">Chưa triển khai</span>')
      + '</div>'
      + '<p class="phf-qtth-muted">' + esc(s.sub) + '</p>'
      + '<p class="phf-qtth-td-desc">' + esc(s.desc) + '</p>'
      + (s.active
        ? '<button type="button" class="phf-qtth-btn" data-td-open="' + esc(s.key) + '">Mở ' + esc(s.title) + '</button>'
        : '<button type="button" class="phf-qtth-btn ghost" disabled>Chưa mở</button>')
      + '</div>';
  }

  /* ================================ PAYROLL ============================== */
  var PS = {
    period: '',
    status: null,
    normalized: null,
    wizard: null, // { step, file:{name,base64,size}, report }
  };
  var MAX_UPLOAD_BYTES = 1024 * 1024; // client guard; payroll sheets are tens of KB

  async function renderPayroll(slot) {
    PS.period = PS.period || curPeriod();
    slot.innerHTML = '<section class="phf-qtth-card"><p class="phf-qtth-muted">Đang tải dữ liệu bảng lương…</p></section>';
    try {
      PS.status = await call('qtthPayrollStatus', { period_month: PS.period });
      PS.normalized = (PS.status && PS.status.current)
        ? await call('qtthPayrollListNormalized', { period_month: PS.period })
        : { rows: [], version: null };
      paintPayroll(slot);
    } catch (err) {
      slot.innerHTML = '<section class="phf-qtth-card phf-qtth-denied"><h2>Không tải được Bảng lương</h2>'
        + '<p>' + esc(err.message) + '</p>'
        + '<button type="button" class="phf-qtth-btn" data-retry>Thử lại</button></section>';
      var r = slot.querySelector('[data-retry]'); if (r) r.onclick = function () { renderPayroll(slot); };
    }
  }

  function paintPayroll(slot) {
    var st = PS.status || {};
    var cur = st.current || null;
    var rows = (PS.normalized && PS.normalized.rows) || [];
    slot.innerHTML =
      '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head">'
      + '<div><h2>Bảng lương — Dữ liệu chuẩn</h2>'
      + '<p class="phf-qtth-muted"><button type="button" class="phf-qtth-link" data-back>← Truth Data</button> · '
      + 'Company PostgreSQL · Định danh từ People Master (chỉ đọc)</p></div>'
      + '<div class="phf-qtth-head-actions">'
      + '<label class="phf-qtth-field"><span>Kỳ lương</span><input type="month" value="' + esc(PS.period) + '" data-period></label>'
      + '<button type="button" class="phf-qtth-btn" data-import>Nhập bảng lương</button>'
      + '</div>'
      + '</div>'
      + effectiveVersionHtml(st, cur)
      + versionHistoryHtml(st)
      + '</section>'
      + normalizedTableHtml(rows)
      + '<div class="phf-qtth-drawer-host" data-drawer-host hidden></div>'
      + '<div class="phf-qtth-modal-host" data-wizard-host hidden></div>';

    slot.querySelector('[data-back]').onclick = function () { go(qbase() + '/truth-data'); };
    slot.querySelector('[data-period]').onchange = function (e) {
      var v = String(e.target.value || '').trim();
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) { toast('error', 'Kỳ không hợp lệ', 'Định dạng YYYY-MM.'); return; }
      PS.period = v; PS.wizard = null; renderPayroll(slot);
    };
    slot.querySelector('[data-import]').onclick = function () { PS.wizard = { step: 1 }; renderWizard(slot); };
    slot.querySelectorAll('[data-emp]').forEach(function (b) {
      b.onclick = function () { openDetail(slot, b.getAttribute('data-emp')); };
    });
    slot.querySelectorAll('[data-view-version]').forEach(function (b) {
      b.onclick = function () { toast('info', 'Phiên bản ' + b.getAttribute('data-view-version'), 'Bảng bên dưới luôn hiển thị phiên bản đang hiệu lực. Lịch sử thay đổi xem trong "Chi tiết" từng nhân sự.'); };
    });
  }

  function effectiveVersionHtml(st, cur) {
    if (!st.exists || !cur) {
      return '<div class="phf-qtth-warn"><span>⚠ Kỳ ' + esc(st.periodMonth || PS.period)
        + ' chưa có phiên bản nào được xác nhận. Bấm “Nhập bảng lương” để bắt đầu.</span></div>';
    }
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Phiên bản hiệu lực</b><span>V' + esc(cur.version) + '</span></div>'
      + '<div><b>Người nhập</b><span>' + esc(cur.uploadedBy || '—') + '</span></div>'
      + '<div><b>Thời điểm xác nhận</b><span>' + esc(fmtDT(cur.confirmedAt || cur.uploadedAt)) + '</span></div>'
      + '<div><b>Số nhân sự</b><span>' + esc(cur.rowCount) + '</span></div>'
      + '<div><b>Cảnh báo</b><span>' + esc(cur.warningCount || 0) + '</span></div>'
      + '<div><b>Khớp mẫu chuẩn</b><span>' + (cur.templateMatched ? 'Có' : 'Có sai khác') + '</span></div>'
      + '</div>';
  }

  function versionHistoryHtml(st) {
    var vs = (st && st.versions) || [];
    if (!vs.length) return '';
    var lbl = { previewed: 'Nháp (chưa xác nhận)', confirmed: 'Đã xác nhận', superseded: 'Đã thay thế' };
    return '<details class="phf-qtth-td-vh"' + (vs.length <= 3 ? ' open' : '') + '>'
      + '<summary>Lịch sử phiên bản (' + vs.length + ')</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:720px">'
      + '<thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Tên file</th><th>Số dòng</th><th>Cảnh báo</th><th>SHA-256</th><th>Người nhập</th><th>Thời điểm</th></tr></thead><tbody>'
      + vs.map(function (v) {
        return '<tr' + (v.isCurrent ? ' class="is-selected"' : '') + '>'
          + '<td class="c-code">V' + esc(v.version) + (v.isCurrent ? ' ' + pill('hiệu lực', 'is-on') : '') + '</td>'
          + '<td>' + esc(lbl[v.status] || v.status) + '</td>'
          + '<td>' + esc(v.fileName) + '</td>'
          + '<td>' + esc(v.rowCount) + '</td>'
          + '<td>' + esc(v.warningCount || 0) + '</td>'
          + '<td><code>' + esc(v.sha256) + '</code></td>'
          + '<td>' + esc(v.uploadedBy || '—') + '</td>'
          + '<td>' + esc(fmtDT(v.confirmedAt || v.uploadedAt)) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></details>';
  }

  function normalizedTableHtml(rows) {
    if (!rows.length) {
      return '<section class="phf-qtth-card"><h2>Dữ liệu đã chuẩn hóa</h2>'
        + '<p class="phf-qtth-empty">Chưa có phiên bản hiệu lực cho kỳ này.</p></section>';
    }
    return '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head"><div><h2>Dữ liệu đã chuẩn hóa</h2>'
      + '<p class="phf-qtth-muted">' + rows.length + ' nhân sự · các cột tổng hợp quản trị. Chi tiết đầy đủ + nguồn số liệu xem trong “Chi tiết”.</p></div></div>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table">'
      + '<thead><tr>'
      + '<th>Mã NV</th><th>Họ và tên</th><th>CN nguồn</th><th>Bậc</th>'
      + '<th>Lương CB theo BHXH</th><th>Tổng cơ bản (1)</th><th>Tổng lương theo công (1)</th>'
      + '<th>Tổng phụ cấp (2)</th><th>Tổng thưởng (3)</th><th>Tổng (4)</th>'
      + '<th>Giảm trừ (6)</th><th>TN sau giảm trừ</th><th>Thuế TNCN</th>'
      + '<th>Thực nhận sau thuế</th><th>Đối soát</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr' + (r.validationStatus === 'warn' ? ' class="is-warn-row"' : '') + '>'
          + '<td class="c-code">' + esc(r.employeeCode)
          + (r.peopleMasterMatched ? '' : ' <span class="phf-qtth-warndot" title="Không khớp People Master">?</span>') + '</td>'
          + '<td class="c-name">' + esc(r.fullNameSource || '—') + '</td>'
          + '<td>' + esc(r.sourceBranch || '—') + '</td>'
          + '<td>' + esc(r.salaryGrade || '—') + '</td>'
          + '<td class="c-num">' + fmtN(r.baseSalaryBhxh) + '</td>'
          + '<td class="c-num">' + fmtN(r.baseStandardTotal1) + '</td>'
          + '<td class="c-num">' + fmtN(r.workedSalaryTotal1) + '</td>'
          + '<td class="c-num">' + fmtN(r.allowanceActualTotal2) + '</td>'
          + '<td class="c-num">' + fmtN(r.bonusTotal3) + '</td>'
          + '<td class="c-num">' + fmtN(r.grandTotal4) + '</td>'
          + '<td class="c-num">' + fmtN(r.statutoryDeductTotal6) + '</td>'
          + '<td class="c-num">' + fmtN(r.incomeAfterDeduct6) + '</td>'
          + '<td class="c-num">' + fmtN(r.pitAmount) + '</td>'
          + '<td class="c-num c-final">' + fmtN(r.finalNetAfterTax) + '</td>'
          + '<td class="c-num">' + fmtN(r.reconcileAdjust) + '</td>'
          + '<td class="c-act"><button type="button" class="phf-qtth-link" data-emp="' + esc(r.employeeCode) + '">Chi tiết</button></td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<p class="phf-qtth-muted phf-qtth-count">“Thực nhận sau thuế” là số cuối cùng theo bảng lương (D5). '
      + '“Đối soát” / TM / CK là lớp thanh toán riêng, không định nghĩa lại số cuối.</p>'
      + '</section>';
  }

  /* ------------------------------ DETAIL DRAWER ------------------------- */
  async function openDetail(slot, code) {
    var host = slot.querySelector('[data-drawer-host]'); if (!host) return;
    host.hidden = false;
    host.innerHTML = '<div class="phf-qtth-drawer-backdrop" data-close></div><aside class="phf-qtth-drawer is-wide"><div class="phf-qtth-drawer-body"><p class="phf-qtth-muted">Đang tải…</p></div></aside>';
    host.querySelector('[data-close]').onclick = function () { host.hidden = true; host.innerHTML = ''; };
    var d;
    try { d = await call('qtthPayrollEmployeeDetail', { period_month: PS.period, employee_code: code }); }
    catch (err) { host.querySelector('.phf-qtth-drawer-body').innerHTML = '<p class="phf-qtth-warn-inline">' + esc(err.message) + '</p>'; return; }
    var nr = d.normalized || {};
    var CORE = [
      ['base_salary_bhxh', 'Lương cơ bản theo BHXH'], ['job_allowance', 'Phụ cấp công việc'],
      ['base_standard_total_1', 'Tổng cộng lương cơ bản theo công chuẩn (1)'],
      ['std_income_total_1to9', 'Tổng thu nhập theo công việc (1)…(9)'],
      ['worked_salary_total_1', 'Tổng lương theo công (1)'],
      ['allowance_actual_total_2', 'Tổng phụ cấp (2)'], ['bonus_total_3', 'Tổng thưởng (3)'],
      ['grand_total_4', 'Tổng (4) = (1)+(2)+(3)'],
      ['internal_deduct_total_5', 'Tổng giảm trừ nội bộ (5)'], ['income_after_internal_5', 'Thu nhập (4) − (5)'],
      ['statutory_deduct_total_6', 'Tổng giảm trừ (6)'], ['income_after_deduct_6', 'Thu nhập sau giảm trừ'],
      ['tax_taxable_income', 'Thu nhập chịu thuế (D7 · nguyên văn)'],
      ['tax_assessable_income', 'Thu nhập tính thuế'], ['tax_dependents', 'Số người phụ thuộc'],
      ['tax_pit_amount', 'Thuế TNCN'],
      ['final_net_after_tax', 'THỰC NHẬN SAU THUẾ (số cuối · D5)'],
      ['t13_revenue_bonus', 'Thưởng T13 + Doanh thu (ngoài kỳ · D6)'],
      ['reconcile_adjust', 'Đối soát (lớp thanh toán · D5)']
    ];
    var sd = d.sourceDetail || {};
    var raw = d.rawCells || {};
    var notes = d.validationNotes || [];
    var hist = d.history || [];

    host.querySelector('aside').innerHTML =
      '<header><div><strong>' + esc(nr.full_name_source || code) + '</strong>'
      + '<span>' + esc(code) + ' · CN nguồn: ' + esc(nr.source_branch || '—') + ' · Bậc: ' + esc(nr.salary_grade || '—')
      + ' · Kỳ ' + esc(d.periodMonth) + ' · V' + esc(d.version) + '</span></div>'
      + '<button type="button" data-close aria-label="Đóng">×</button></header>'
      + '<div class="phf-qtth-drawer-body">'
      + (nr.people_master_matched ? '' : '<p class="phf-qtth-warn-inline">⚠ Mã NV không khớp People Master. Dữ liệu vẫn được giữ nguyên (bảng lương là dữ liệu lịch sử).</p>')
      + '<h3>Giá trị chuẩn hóa</h3>'
      + '<table class="phf-qtth-kv"><tbody>'
      + CORE.map(function (c) {
        var v = nr[c[0]];
        return '<tr><td>' + esc(c[1]) + '</td><td class="c-num">' + fmtN(v) + '</td></tr>';
      }).join('')
      + '</tbody></table>'
      + '<h3>Đối soát số học (cảnh báo — không sửa giá trị)</h3>'
      + (notes.length
        ? '<ul class="phf-qtth-recon">' + notes.map(function (w) {
          return '<li><b>' + esc(w.label || w.check) + '</b><span>Bảng lương: <b>' + fmtN(w.uploaded)
            + '</b> · Tính ra: ' + fmtN(w.calculated) + ' · Lệch: ' + fmtN(w.difference) + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="phf-qtth-muted">Không có cảnh báo số học.</p>')
      + '<h3>Thành phần chi tiết (source_detail)</h3>'
      + kvGrid(sd)
      + '<h3>Ô nguồn từ file (raw)</h3>'
      + kvGrid(raw)
      + '<h3>Lịch sử thay đổi</h3>'
      + (hist.length
        ? '<ul class="phf-qtth-hist">' + hist.map(function (h) {
          if (h.change_type === 'added') return '<li><span>Thêm mới ở V' + esc(h.to_version) + '</span><em>' + esc(fmtDT(h.detected_at)) + '</em></li>';
          if (h.change_type === 'removed_missing') return '<li><span>Vắng mặt ở V' + esc(h.to_version) + ' (không xóa lịch sử)</span><em>' + esc(fmtDT(h.detected_at)) + '</em></li>';
          return '<li><span>' + esc(h.field) + ': ' + fmtN(h.before_value) + ' → <strong>' + fmtN(h.after_value)
            + '</strong> (V' + esc(h.from_version) + '→V' + esc(h.to_version) + ')</span><em>' + esc(fmtDT(h.detected_at)) + '</em></li>';
        }).join('') + '</ul>'
        : '<p class="phf-qtth-muted">Chưa có thay đổi qua các phiên bản.</p>')
      + '</div>';
    host.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { host.hidden = true; host.innerHTML = ''; }; });
  }
  function kvGrid(obj) {
    var keys = Object.keys(obj || {});
    if (!keys.length) return '<p class="phf-qtth-muted">—</p>';
    return '<table class="phf-qtth-kv"><tbody>'
      + keys.sort().map(function (k) {
        return '<tr><td><code>' + esc(k) + '</code></td><td class="c-num">' + fmtN(obj[k]) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ------------------------------- WIZARD ------------------------------ */
  var STEP_LABELS = ['Chọn kỳ', 'Tải file', 'Kiểm tra', 'Đối chiếu cột', 'Xem trước', 'Xác nhận'];

  function renderWizard(slot) {
    var host = slot.querySelector('[data-wizard-host]'); if (!host) return;
    host.hidden = false;
    var w = PS.wizard;
    var showMapping = !!(w.report && w.report.schemaDrift);
    var visibleSteps = STEP_LABELS.filter(function (_, i) { return i !== 3 || showMapping; });
    var stepIndex = w.step - 1;

    host.innerHTML =
      '<div class="phf-qtth-drawer-backdrop" data-wz-close></div>'
      + '<div class="phf-qtth-modal">'
      + '<header><strong>Nhập bảng lương — kỳ ' + esc(PS.period) + '</strong>'
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
      b.onclick = function () { PS.wizard = null; host.hidden = true; host.innerHTML = ''; };
    });
    paintWizardStep(slot);
  }

  function paintWizardStep(slot) {
    var host = slot.querySelector('[data-wizard-host]');
    var body = host.querySelector('[data-wz-body]');
    var w = PS.wizard;

    if (w.step === 1) {
      body.innerHTML = '<p>Xác nhận kỳ lương cần nhập. Có thể đổi ở màn chính trước khi mở trình nhập.</p>'
        + '<label class="phf-qtth-field"><span>Kỳ lương</span><input type="month" value="' + esc(PS.period) + '" data-wz-period></label>'
        + wizardNav({ next: 'Tiếp tục' });
      body.querySelector('[data-wz-period]').onchange = function (e) {
        var v = String(e.target.value || '').trim();
        if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) PS.period = v;
        renderWizard(slot);
      };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 2; renderWizard(slot); };
      return;
    }

    if (w.step === 2) {
      body.innerHTML = '<p>Chọn file bảng lương <b>.xlsx</b> theo mẫu chuẩn PHF V1 (giới hạn 1 MB).</p>'
        + '<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-wz-file>'
        + '<div data-wz-fileinfo class="phf-qtth-muted" style="margin-top:8px"></div>'
        + wizardNav({ back: 1, next: 'Kiểm tra file', nextDisabled: !w.file });
      var info = body.querySelector('[data-wz-fileinfo]');
      if (w.file) info.textContent = w.file.name + ' · ' + (w.file.size / 1024).toFixed(1) + ' KB';
      body.querySelector('[data-wz-file]').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        if (!/\.xlsx$/i.test(f.name)) { toast('error', 'Sai định dạng', 'Chỉ nhận file .xlsx.'); return; }
        if (f.size > MAX_UPLOAD_BYTES) { toast('error', 'File quá lớn', 'Tối đa 1 MB. File bảng lương chuẩn chỉ vài chục KB.'); return; }
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
        + wizardNav({ back: 2, next: (r.schemaDrift ? 'Sang bước đối chiếu' : 'Xem trước dữ liệu') });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 2; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = r.schemaDrift ? 4 : 5; renderWizard(slot); };
      return;
    }

    if (w.step === 4) {
      var dr = w.report.schemaDrift || {};
      body.innerHTML = '<p>File có sai khác cấu trúc so với mẫu chuẩn. Kiểm tra các cột dưới đây trước khi nhập. '
        + 'Hệ thống <b>không tự đoán</b> cột thực sự mơ hồ — nếu có cột nghiệp vụ mới chưa xác định, dừng lại và báo quản trị.</p>'
        + '<h3>Cột có trong file, không có trong mẫu chuẩn</h3>' + chipList(dr.added)
        + '<h3>Cột mẫu chuẩn không thấy trong file</h3>' + chipList(dr.removed)
        + '<h3>Cột đổi vị trí</h3>'
        + ((dr.moved && dr.moved.length)
          ? '<ul class="phf-qtth-hist">' + dr.moved.map(function (m) { return '<li>' + esc(m.field) + ': cột ' + esc(m.from) + ' → ' + esc(m.to) + '</li>'; }).join('') + '</ul>'
          : '<p class="phf-qtth-muted">—</p>')
        + (w.report.missingColumns && w.report.missingColumns.length
          ? '<p class="phf-qtth-warn-inline">⚠ Thiếu cột lõi: ' + esc(w.report.missingColumns.join(', ')) + '</p>'
          : '')
        + '<label class="phf-qtth-check"><input type="checkbox" data-wz-ack> Tôi đã kiểm tra, các cột sai khác không làm sai lệch ý nghĩa nghiệp vụ.</label>'
        + wizardNav({ back: 2, next: 'Xem trước dữ liệu', nextDisabled: true });
      var ack = body.querySelector('[data-wz-ack]'), nx4 = body.querySelector('[data-wz-next]');
      ack.onchange = function () { nx4.disabled = !ack.checked; };
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 2; renderWizard(slot); };
      nx4.onclick = function () { w.step = 5; renderWizard(slot); };
      return;
    }

    if (w.step === 5) {
      body.innerHTML = previewHtml(w.report)
        + wizardNav({ back: (w.report.schemaDrift ? 4 : 3), next: 'Xác nhận nhập dữ liệu' });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = w.report.schemaDrift ? 4 : 3; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 6; renderWizard(slot); };
      return;
    }

    if (w.step === 6) {
      var vr = w.report.versionDiff || {};
      body.innerHTML = '<p>Xác nhận đưa phiên bản <b>V' + esc(w.report.version) + '</b> thành dữ liệu chuẩn hiệu lực cho kỳ ' + esc(PS.period) + '.</p>'
        + '<ul class="phf-qtth-recon">'
        + '<li><b>Thêm mới</b><span>' + (vr.added || []).length + ' nhân sự</span></li>'
        + '<li><b>Thay đổi</b><span>' + (vr.changed || []).length + ' nhân sự</span></li>'
        + '<li><b>Không đổi</b><span>' + (vr.unchanged || []).length + ' nhân sự</span></li>'
        + '<li><b>Vắng so với phiên bản trước</b><span>' + (vr.missingFromNewVersion || []).length + ' nhân sự (giữ lịch sử, không xóa)</span></li>'
        + '</ul>'
        + '<p class="phf-qtth-muted">Giá trị tải lên được giữ nguyên. Cảnh báo số học không chặn xác nhận.</p>'
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
    var w = PS.wizard;
    var body = slot.querySelector('[data-wz-body]');
    var nx = body.querySelector('[data-wz-next]'); if (nx) nx.disabled = true;
    body.insertAdjacentHTML('beforeend', '<p class="phf-qtth-muted" data-wz-loading>Đang tải lên &amp; kiểm tra…</p>');
    try {
      w.report = await call('qtthPayrollValidatePreview', {
        period_month: PS.period, file_name: w.file.name, file_base64: w.file.base64
      });
      w.step = 3;
      renderWizard(slot);
    } catch (err) {
      var l = body.querySelector('[data-wz-loading]'); if (l) l.remove();
      if (nx) nx.disabled = false;
      toast('error', 'Kiểm tra không thành công', err.message);
    }
  }

  async function runConfirm(slot) {
    var w = PS.wizard;
    var body = slot.querySelector('[data-wz-body]');
    var nx = body.querySelector('[data-wz-next]'); if (nx) nx.disabled = true;
    try {
      var res = await call('qtthPayrollConfirm', { file_id: w.report.fileId });
      toast('success', 'Đã nhập dữ liệu bảng lương',
        'Kỳ ' + PS.period + ' · V' + w.report.version
        + (res && res.deltaCounts ? ' · +' + res.deltaCounts.added + ' / ~' + res.deltaCounts.changed + ' / -' + res.deltaCounts.removedMissing : ''));
      PS.wizard = null;
      var host = slot.querySelector('[data-wizard-host]'); if (host) { host.hidden = true; host.innerHTML = ''; }
      renderPayroll(slot);
    } catch (err) {
      if (nx) nx.disabled = false;
      toast('error', 'Xác nhận không thành công', err.message);
    }
  }

  function validateReportHtml(r) {
    var t = r.totals || {};
    var bad = (t.unknownEmployeeCodes || []).length || (t.duplicateInFile || []).length || (r.missingColumns || []).length;
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Mẫu chuẩn</b><span>' + (r.templateMatched ? 'Khớp hoàn toàn' : (r.schemaDrift ? 'Có sai khác cấu trúc' : 'Khớp (chưa đăng ký chuẩn)')) + '</span></div>'
      + '<div><b>Fingerprint</b><span><code>' + esc((r.templateFingerprint || '').slice(0, 12)) + '</code></span></div>'
      + '<div><b>Số dòng nhân sự</b><span>' + esc(t.rows || 0) + '</span></div>'
      + '<div><b>Khớp People Master</b><span>' + esc(t.matchedEmployeeCodes || 0) + '</span></div>'
      + '<div><b>Cảnh báo số học</b><span>' + esc(t.reconciliationWarnings || 0) + '</span></div>'
      + '<div><b>File</b><span>' + esc(r.fileName) + ' · ' + esc((r.byteSize / 1024).toFixed(1)) + ' KB</span></div>'
      + '</div>'
      + (r.missingColumns && r.missingColumns.length
        ? '<p class="phf-qtth-warn-inline">⚠ Thiếu cột lõi bắt buộc: ' + esc(r.missingColumns.join(', ')) + '. Không thể nhập cho tới khi bổ sung.</p>' : '')
      + ((t.unknownEmployeeCodes || []).length
        ? '<h3>Mã NV không có trong People Master</h3>' + chipList(t.unknownEmployeeCodes) : '')
      + ((t.duplicateInFile || []).length
        ? '<h3>Mã NV trùng trong file</h3><ul class="phf-qtth-hist">'
          + t.duplicateInFile.map(function (d) { return '<li>' + esc(d.employeeCode) + ' — dòng ' + esc((d.rows || []).join(', ')) + '</li>'; }).join('') + '</ul>' : '')
      + (r.schemaDrift ? '<p class="phf-qtth-warn-inline">Cấu trúc file khác mẫu chuẩn — sẽ có bước “Đối chiếu cột”.</p>' : '')
      + reconWarnHtml(r.reconciliationWarnings);
  }

  function reconWarnHtml(list) {
    if (!list || !list.length) return '<p class="phf-qtth-muted" style="margin-top:10px">Không có cảnh báo đối soát số học.</p>';
    return '<h3>Cảnh báo đối soát số học (' + list.length + ' nhân sự — giữ nguyên giá trị tải lên)</h3>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:640px"><thead><tr><th>Mã NV</th><th>Quan hệ</th><th>Bảng lương</th><th>Tính ra</th><th>Lệch</th></tr></thead><tbody>'
      + list.slice(0, 200).map(function (e) {
        return (e.checks || []).map(function (c) {
          return '<tr><td class="c-code">' + esc(e.employeeCode) + '</td><td>' + esc(c.label || c.check)
            + '</td><td class="c-num">' + fmtN(c.uploaded) + '</td><td class="c-num">' + fmtN(c.calculated)
            + '</td><td class="c-num">' + fmtN(c.difference) + '</td></tr>';
        }).join('');
      }).join('')
      + '</tbody></table></div>';
  }

  function previewHtml(r) {
    var vd = r.versionDiff || {};
    var changed = vd.changed || [];
    return '<p>' + (vd.isFirstVersion
      ? 'Đây là phiên bản đầu tiên (V1) của kỳ ' + esc(PS.period) + '.'
      : 'So với phiên bản hiệu lực V' + esc(vd.previousVersion) + ':') + '</p>'
      + '<ul class="phf-qtth-recon">'
      + '<li><b>NEW</b><span>' + (vd.added || []).length + '</span></li>'
      + '<li><b>CHANGED</b><span>' + changed.length + '</span></li>'
      + '<li><b>UNCHANGED</b><span>' + (vd.unchanged || []).length + '</span></li>'
      + '<li><b>MISSING</b><span>' + (vd.missingFromNewVersion || []).length + '</span></li>'
      + '</ul>'
      + (changed.length
        ? '<h3>Thay đổi theo từng nhân sự</h3><div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:620px"><thead><tr><th>Mã NV</th><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>'
          + changed.slice(0, 200).map(function (c) {
            return (c.changes || []).map(function (ch) {
              return '<tr><td class="c-code">' + esc(c.employeeCode) + '</td><td><code>' + esc(ch.field)
                + '</code></td><td class="c-num">' + fmtN(ch.before) + '</td><td class="c-num">' + fmtN(ch.after) + '</td></tr>';
            }).join('');
          }).join('')
          + '</tbody></table></div>'
        : '')
      + ((vd.missingFromNewVersion || []).length
        ? '<h3>Vắng mặt so với phiên bản trước (không xóa — ghi nhận trạng thái)</h3>' + chipList(vd.missingFromNewVersion) : '')
      + reconWarnHtml(r.reconciliationWarnings);
  }

  /* =============================== ENTRY ================================ */
  window.phfQtthRenderTruthData = async function (slot, boot, key) {
    var top = String(key || '').split('/')[0];
    if (top !== 'truth-data') { renderLanding(slot); return; }
    var sub = String(key || '').split('/')[1] || '';
    if (sub === 'payroll') { await renderPayroll(slot); return; }
    renderLanding(slot);
  };
})();
