/* PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) · Truth Data · Chi phí xử lý (V1)
 *
 * Renders window.phfQtthRenderProcessingCost(slot, boot) — called by
 * assets/js/qtth/phf-qtth-payroll.js's sub-router for key = 'truth-data/chi-phi-xu-ly'.
 *
 * Mirrors phf-qtth-payroll.js's shape (landing card → detail screen → upload
 * wizard), simplified for a fixed 3-column source: NO "Đối chiếu cột" schema-
 * drift step (this source has no schema-drift machinery at all — see
 * qtth-processing-cost-template.js). Period is chosen on this screen at
 * upload time, never a column in the file. Natural key V1 = (period, employee_code).
 *
 * V1 scope = upload foundation + template ONLY. No income report, no advance/
 * deduction logic, no personal income tax logic, no Total Personnel Cost
 * aggregation — this source is NOT combined with Payroll/BHXH here.
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

  var PS = {
    period: '',
    status: null,
    normalized: null,
    wizard: null, // { step, file:{name,base64,size}, report }
  };
  var MAX_UPLOAD_BYTES = 512 * 1024; // 3-column sheets are a few KB

  async function renderScreen(slot) {
    PS.period = PS.period || curPeriod();
    slot.innerHTML = '<section class="phf-qtth-card"><p class="phf-qtth-muted">Đang tải dữ liệu Chi phí xử lý…</p></section>';
    try {
      PS.status = await call('qtthProcessingCostStatus', { period_month: PS.period });
      PS.normalized = (PS.status && PS.status.current)
        ? await call('qtthProcessingCostListNormalized', { period_month: PS.period })
        : { rows: [], version: null };
      paint(slot);
    } catch (err) {
      slot.innerHTML = '<section class="phf-qtth-card phf-qtth-denied"><h2>Không tải được Chi phí xử lý</h2>'
        + '<p>' + esc(err.message) + '</p>'
        + '<button type="button" class="phf-qtth-btn" data-retry>Thử lại</button></section>';
      var r = slot.querySelector('[data-retry]'); if (r) r.onclick = function () { renderScreen(slot); };
    }
  }

  function paint(slot) {
    var st = PS.status || {};
    var cur = st.current || null;
    var rows = (PS.normalized && PS.normalized.rows) || [];
    slot.innerHTML =
      '<section class="phf-qtth-card">'
      + '<div class="phf-qtth-head">'
      + '<div><h2>Chi phí xử lý — Dữ liệu chuẩn</h2>'
      + '<p class="phf-qtth-muted"><button type="button" class="phf-qtth-link" data-back>← Truth Data</button> · '
      + 'Company PostgreSQL · Định danh từ People Master (chỉ đọc) · Chỉ dựng nền dữ liệu (chưa có báo cáo/tổng hợp)</p></div>'
      + '<div class="phf-qtth-head-actions">'
      + '<label class="phf-qtth-field"><span>Kỳ</span><input type="month" value="' + esc(PS.period) + '" data-period></label>'
      + '<button type="button" class="phf-qtth-btn" data-import>Nhập chi phí xử lý</button>'
      + '</div>'
      + '</div>'
      + templateCardHtml()
      + effectiveVersionHtml(st, cur)
      + versionHistoryHtml(st)
      + '</section>'
      + normalizedTableHtml(rows)
      + '<div class="phf-qtth-modal-host" data-wizard-host hidden></div>';

    slot.querySelector('[data-back]').onclick = function () { go(qbase() + '/truth-data'); };
    slot.querySelector('[data-period]').onchange = function (e) {
      var v = String(e.target.value || '').trim();
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) { toast('error', 'Kỳ không hợp lệ', 'Định dạng YYYY-MM.'); return; }
      PS.period = v; PS.wizard = null; renderScreen(slot);
    };
    slot.querySelector('[data-import]').onclick = function () { PS.wizard = { step: 1 }; renderWizard(slot); };
  }

  // Hard rule: a screen that asks for an upload-by-template MUST offer the
  // template on the same screen. Static clean .xlsx, no real employee data.
  var TEMPLATE_HREF = 'assets/templates/PHF_ProcessingCost_Canonical_V1.xlsx?v=1';
  function templateCardHtml() {
    return '<div class="phf-qtth-td-template">'
      + '<div><b>Mẫu Chi phí xử lý chuẩn</b>'
      + '<span class="phf-qtth-muted">3 cột: MÃ NV · HỌ VÀ TÊN · CHI PHÍ XỬ LÝ. '
      + 'Phiên bản: <b>PHF Processing Cost Canonical V1</b>. Mẫu không chứa dữ liệu nhân viên.</span></div>'
      + '<a class="phf-qtth-btn" href="' + TEMPLATE_HREF + '" download="PHF_ProcessingCost_Canonical_V1.xlsx">Tải mẫu chuẩn</a>'
      + '</div>';
  }

  function effectiveVersionHtml(st, cur) {
    if (!st.exists || !cur) {
      return '<div class="phf-qtth-warn"><span>⚠ Kỳ ' + esc(st.periodMonth || PS.period)
        + ' chưa có phiên bản nào được xác nhận. Bấm “Nhập chi phí xử lý” để bắt đầu.</span></div>';
    }
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Phiên bản hiệu lực</b><span>V' + esc(cur.version) + '</span></div>'
      + '<div><b>Người nhập</b><span>' + esc(cur.uploadedBy || '—') + '</span></div>'
      + '<div><b>Thời điểm xác nhận</b><span>' + esc(fmtDT(cur.confirmedAt || cur.uploadedAt)) + '</span></div>'
      + '<div><b>Số nhân sự</b><span>' + esc(cur.rowCount) + '</span></div>'
      + '<div><b>Cảnh báo</b><span>' + esc(cur.warningCount || 0) + '</span></div>'
      + '</div>';
  }

  function versionHistoryHtml(st) {
    var vs = (st && st.versions) || [];
    if (!vs.length) return '';
    var lbl = { previewed: 'Nháp (chưa xác nhận)', confirmed: 'Đã xác nhận', superseded: 'Đã thay thế' };
    return '<details class="phf-qtth-td-vh"' + (vs.length <= 3 ? ' open' : '') + '>'
      + '<summary>Lịch sử phiên bản (' + vs.length + ')</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:640px">'
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
      + '<p class="phf-qtth-muted">' + rows.length + ' nhân sự.</p></div></div>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table">'
      + '<thead><tr><th>Mã NV</th><th>Họ và tên</th><th>Chi phí xử lý</th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr>'
          + '<td class="c-code">' + esc(r.employeeCode)
          + (r.peopleMasterMatched ? '' : ' <span class="phf-qtth-warndot" title="Không khớp People Master">?</span>') + '</td>'
          + '<td class="c-name">' + esc(r.employeeName || '—') + '</td>'
          + '<td class="c-num c-final">' + fmtN(r.amount) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>'
      + '</section>';
  }

  /* ------------------------------- WIZARD ------------------------------ */
  // No "Đối chiếu cột" step for this source (fixed 3-column schema, no
  // schema-drift machinery) — steps: Chọn kỳ → Tải file → Kiểm tra → Xem trước → Xác nhận.
  var STEP_LABELS = ['Chọn kỳ', 'Tải file', 'Kiểm tra', 'Xem trước', 'Xác nhận'];

  function renderWizard(slot) {
    var host = slot.querySelector('[data-wizard-host]'); if (!host) return;
    host.hidden = false;
    var w = PS.wizard;
    var stepIndex = w.step - 1;
    host.innerHTML =
      '<div class="phf-qtth-drawer-backdrop" data-wz-close></div>'
      + '<div class="phf-qtth-modal">'
      + '<header><strong>Nhập chi phí xử lý — kỳ ' + esc(PS.period) + '</strong>'
      + '<button type="button" data-wz-close aria-label="Đóng">×</button></header>'
      + '<ol class="phf-qtth-steps">'
      + STEP_LABELS.map(function (lbl, i) {
        var cls = i < stepIndex ? 'is-done' : (i === stepIndex ? 'is-now' : '');
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
      body.innerHTML = '<p>Xác nhận kỳ cần nhập. Có thể đổi ở màn chính trước khi mở trình nhập.</p>'
        + '<label class="phf-qtth-field"><span>Kỳ</span><input type="month" value="' + esc(PS.period) + '" data-wz-period></label>'
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
      body.innerHTML = '<p>Chọn file <b>.xlsx</b> theo mẫu chuẩn V1 (giới hạn 512 KB).</p>'
        + '<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-wz-file>'
        + '<div data-wz-fileinfo class="phf-qtth-muted" style="margin-top:8px"></div>'
        + wizardNav({ back: 1, next: 'Kiểm tra file', nextDisabled: !w.file });
      var info = body.querySelector('[data-wz-fileinfo]');
      if (w.file) info.textContent = w.file.name + ' · ' + (w.file.size / 1024).toFixed(1) + ' KB';
      body.querySelector('[data-wz-file]').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        if (!/\.xlsx$/i.test(f.name)) { toast('error', 'Sai định dạng', 'Chỉ nhận file .xlsx.'); return; }
        if (f.size > MAX_UPLOAD_BYTES) { toast('error', 'File quá lớn', 'Tối đa 512 KB.'); return; }
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
      body.innerHTML = validateReportHtml(w.report) + wizardNav({ back: 2, next: 'Xem trước dữ liệu' });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 2; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 4; renderWizard(slot); };
      return;
    }

    if (w.step === 4) {
      body.innerHTML = previewHtml(w.report) + wizardNav({ back: 3, next: 'Xác nhận nhập dữ liệu' });
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 3; renderWizard(slot); };
      body.querySelector('[data-wz-next]').onclick = function () { w.step = 5; renderWizard(slot); };
      return;
    }

    if (w.step === 5) {
      var vd = w.report.versionDiff || {};
      var canConfirm = w.report.canConfirm !== false;
      var blk = w.report.blockers || {};
      body.innerHTML = '<p>Xác nhận đưa phiên bản <b>V' + esc(w.report.version) + '</b> thành dữ liệu chuẩn hiệu lực cho kỳ ' + esc(PS.period) + '.</p>'
        + '<ul class="phf-qtth-recon">'
        + '<li><b>Thêm mới</b><span>' + (vd.added || []).length + ' nhân sự</span></li>'
        + '<li><b>Thay đổi</b><span>' + (vd.changed || []).length + ' nhân sự</span></li>'
        + '<li><b>Vắng so với phiên bản trước</b><span>' + (vd.missingFromNewVersion || []).length + ' nhân sự (giữ lịch sử, không xóa)</span></li>'
        + '</ul>'
        + (canConfirm
          ? '<p class="phf-qtth-muted">Giá trị tải lên được giữ nguyên.</p>' + wizardNav({ back: 4, next: 'Xác nhận nhập dữ liệu', primary: true })
          : '<div class="phf-qtth-warn"><span>⚠ Không thể xác nhận: '
            + [(blk.duplicateEmployeeCodes || []).length ? (blk.duplicateEmployeeCodes.length + ' mã NV trùng trong file') : '',
               (blk.unknownEmployeeCodes || []).length ? (blk.unknownEmployeeCodes.length + ' mã NV chưa xác định') : '']
              .filter(Boolean).join(' · ')
            + '. Quay lại bước Kiểm tra, sửa file nguồn rồi tải lại.</span></div>' + wizardNav({ back: 4 }));
      body.querySelector('[data-wz-back]').onclick = function () { w.step = 4; renderWizard(slot); };
      var nx = body.querySelector('[data-wz-next]');
      if (nx) nx.onclick = function () { runConfirm(slot); };
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
      w.report = await call('qtthProcessingCostValidatePreview', {
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
      await call('qtthProcessingCostConfirm', { file_id: w.report.fileId });
      toast('success', 'Đã nhập dữ liệu Chi phí xử lý', 'Kỳ ' + PS.period + ' · V' + w.report.version);
      PS.wizard = null;
      var host = slot.querySelector('[data-wizard-host]'); if (host) { host.hidden = true; host.innerHTML = ''; }
      renderScreen(slot);
    } catch (err) {
      if (nx) nx.disabled = false;
      toast('error', 'Xác nhận không thành công', err.message);
    }
  }

  function validateReportHtml(r) {
    var t = r.totals || {};
    var canConfirm = r.canConfirm !== false;
    return '<div class="phf-qtth-td-effective">'
      + '<div><b>Số dòng nhân sự (hợp lệ)</b><span>' + esc(t.rows || 0) + '</span></div>'
      + '<div><b>Khớp People Master</b><span>' + esc(t.matchedEmployeeCodes || 0) + '</span></div>'
      + '<div><b>File</b><span>' + esc(r.fileName) + ' · ' + esc((r.byteSize / 1024).toFixed(1)) + ' KB</span></div>'
      + '</div>'
      + (!canConfirm
        ? '<div class="phf-qtth-warn"><span>⚠ Không thể xác nhận cho đến khi xử lý xong các mục dưới đây — sửa file nguồn và tải lại.</span></div>' : '')
      + ((t.duplicateInFile || []).length
        ? '<h3>Mã NV trùng trong file — CHẶN xác nhận (không tự chọn giá trị nào)</h3><ul class="phf-qtth-hist">'
          + t.duplicateInFile.map(function (d) {
            return '<li>' + esc(d.employeeCode) + ' — xuất hiện ở dòng ' + esc((d.rows || []).join(', '))
              + ' với giá trị: ' + esc((d.amounts || []).map(fmtN).join(' / ')) + '. Sửa file để chỉ còn đúng 1 dòng cho mã này.</li>';
          }).join('') + '</ul>' : '')
      + ((t.unknownEmployeeCodes || []).length
        ? '<h3>Mã NV không có trong People Master — CHẶN xác nhận</h3>'
          + '<p class="phf-qtth-muted">Không tự động ánh xạ theo tên. Sửa đúng mã NV hoặc xóa dòng khỏi file rồi tải lại.</p>'
          + chipList(t.unknownEmployeeCodes) : '')
      + ((t.missingAmount || []).length
        ? '<p class="phf-qtth-warn-inline">⚠ Thiếu giá trị CHI PHÍ XỬ LÝ: ' + esc(t.missingAmount.join(', ')) + '</p>' : '')
      + (canConfirm && !(t.missingAmount || []).length
        ? '<p class="phf-qtth-muted" style="margin-top:10px">Không có lỗi chặn xác nhận.</p>' : '');
  }

  function previewHtml(r) {
    var vd = r.versionDiff || {};
    var changed = vd.changed || [];
    return '<p>' + (vd.isFirstVersion
      ? 'Đây là phiên bản đầu tiên (V1) của kỳ ' + esc(PS.period) + '.'
      : 'So với phiên bản hiệu lực trước đó:') + '</p>'
      + '<ul class="phf-qtth-recon">'
      + '<li><b>NEW</b><span>' + (vd.added || []).length + '</span></li>'
      + '<li><b>CHANGED</b><span>' + changed.length + '</span></li>'
      + '<li><b>MISSING</b><span>' + (vd.missingFromNewVersion || []).length + '</span></li>'
      + '</ul>'
      + (changed.length
        ? '<h3>Thay đổi theo từng nhân sự</h3><div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:420px"><thead><tr><th>Mã NV</th><th>Trước</th><th>Sau</th></tr></thead><tbody>'
          + changed.slice(0, 200).map(function (c) {
            return '<tr><td class="c-code">' + esc(c.employeeCode) + '</td><td class="c-num">' + fmtN(c.before) + '</td><td class="c-num">' + fmtN(c.after) + '</td></tr>';
          }).join('')
          + '</tbody></table></div>'
        : '')
      + ((vd.missingFromNewVersion || []).length
        ? '<h3>Vắng mặt so với phiên bản trước (không xóa — ghi nhận trạng thái)</h3>' + chipList(vd.missingFromNewVersion) : '');
  }

  /* =============================== ENTRY ================================ */
  window.phfQtthRenderProcessingCost = async function (slot) {
    await renderScreen(slot);
  };

  // offline render-check hooks (pure HTML builders — no DOM, no network)
  window.__qtthProcessingCostTestHooks = { templateCardHtml: templateCardHtml, esc: esc, fmtN: fmtN };
})();
