/*
 * PHF HR — QUẢN TRỊ TỔNG HỢP · Truth Data · DỮ LIỆU CHI PHÍ KẾ TOÁN (Accounting Data V1).
 *
 * Renders window.phfQtthRenderAccounting(slot, boot) — called by
 * assets/js/qtth/phf-qtth-payroll.js for key 'truth-data/accounting'
 * (route /admin/qtth/truth-data/accounting).
 *
 * FAST "Bảng kê chứng từ theo bộ phận" export -> upload (dedicated binary
 * endpoint, the file is ~4MB) -> streaming parse + classification engine ->
 * Preview funnel -> Xác nhận / phiên bản. NO dashboard, NO report.
 * RAW_ROWS_SAVED_AS_FACT = 0 — the ~86k source rows are never shown or stored.
 */
(function () {
  'use strict';
  function S() { return window.__qtthShared || {}; }
  function esc(s) { return (S().esc ? S().esc(s) : String(s == null ? '' : s)); }
  function call(a, f) { return S().call(a, f); }
  function toast(m, k) { return S().toast ? S().toast(m, k) : null; }
  function go(p) { return S().go ? S().go(p) : (window.location.href = p); }
  function qbase() { var pre = (S().prefix && S().prefix()) || '/admin'; return pre + '/qtth'; }
  function currentPeriod() { return S().currentPeriod ? S().currentPeriod() : new Date().toISOString().slice(0, 7); }
  function fmtN(n) { if (n == null || n === '') return '—'; var x = Math.round(Number(n) || 0); return x.toLocaleString('vi-VN'); }

  var A = { period: '', status: null, preview: null, rules: null, dict: null, uploading: false, drill: null };
  var UPLOAD_URL = '/api/qtth-accounting-upload';

  /* ---------------- period helpers ---------------- */
  function periodList() {
    var out = [], d = new Date();
    for (var i = 0; i < 15; i++) { out.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7)); }
    return out;
  }

  /* ---------------- data ---------------- */
  async function reload(slot) {
    slot.innerHTML = card('<p class="phf-qtth-muted">Đang tải dữ liệu chi phí kế toán…</p>');
    try {
      var r = await Promise.all([
        call('qtthAccountingStatus', { period_month: A.period }),
        call('qtthAccountingDictionaryStatus', {}),
        call('qtthAccountingListRules', {})
      ]);
      A.status = r[0]; A.dict = r[1]; A.rules = r[2];
      var cur = A.status && A.status.current;
      A.preview = cur ? await call('qtthAccountingPreview', { file_id: cur.fileId }) : null;
    } catch (e) {
      slot.innerHTML = card('<h2>Dữ liệu chi phí kế toán</h2><p class="phf-qtth-error">' + esc(e.message) + '</p>' + backBtn());
      return;
    }
    paint(slot);
  }

  /* ---------------- render ---------------- */
  function card(inner) { return '<section class="phf-qtth-card">' + inner + '</section>'; }
  function backBtn() { return '<p style="margin-top:16px"><button type="button" class="phf-qtth-btn ghost" data-acc-back>← Truth Data</button></p>'; }

  function paint(slot) {
    var st = A.status || { exists: false, versions: [] };
    var rep = A.preview && A.preview.report;
    slot.innerHTML =
      card(
        '<div class="phf-qtth-head"><div>'
        + '<h2>Dữ liệu chi phí kế toán — Bảng kê chứng từ FAST</h2>'
        + '<p class="phf-qtth-muted">Chỉ lấy các <b>chi phí quản trị</b> cần cho QTTH (641*/642*, phát sinh Nợ). '
        + 'Không dựng lại hệ thống kế toán. ~86.000 dòng nguồn <b>không</b> được lưu — chỉ các dòng chi phí đã lọc &amp; phân loại.</p>'
        + '</div>'
        + '<label class="phf-qtth-period">Kỳ quản trị&nbsp;'
        + '<select data-acc-period>' + periodList().map(function (p) { return '<option value="' + p + '"' + (p === A.period ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>'
        + '</label></div>'
        + uploadBlock(st)
        + (rep ? funnelBlock(rep, st) : '<p class="phf-qtth-muted">Kỳ này chưa có dữ liệu. Tải file bảng kê chứng từ xuất từ FAST để bắt đầu.</p>')
        + versionsBlock(st)
        + dictBlock(A.dict)
        + rulesBlock(A.rules)
        + backBtn()
      );
    wire(slot);
  }

  function uploadBlock(st) {
    var pending = (st.versions || []).some(function (v) { return v.status === 'previewed'; });
    return '<div class="phf-qtth-td-upload">'
      + '<h3>Nhập bảng kê chứng từ (FAST → xuất Excel)</h3>'
      + '<p class="phf-qtth-muted">Nguồn xuất trực tiếp từ FAST — hệ thống chỉ nhận &amp; kiểm tra đúng cấu trúc FAST, không có mẫu tải xuống ở bước này.</p>'
      + '<input type="file" accept=".xlsx" data-acc-file' + (A.uploading ? ' disabled' : '') + '> '
      + '<button type="button" class="phf-qtth-btn" data-acc-upload' + (A.uploading ? ' disabled' : '') + '>' + (A.uploading ? 'Đang xử lý…' : 'Tải lên & xem trước') + '</button>'
      + (pending ? '<p class="phf-qtth-chip is-unset" style="margin-top:8px">Có phiên bản đang chờ xác nhận.</p>' : '')
      + '</div>';
  }

  function kpi(label, val, sub) {
    return '<div class="phf-qtth-kpi"><span class="phf-qtth-kpi-label">' + esc(label) + '</span>'
      + '<span class="phf-qtth-kpi-val">' + esc(val) + '</span>'
      + (sub ? '<span class="phf-qtth-kpi-sub">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function funnelBlock(rep, st) {
    var t = rep.totals, a = rep.amounts;
    var cur = st.current;
    var canConfirm = cur && cur.status === 'previewed';
    return '<div class="phf-qtth-funnel">'
      + '<h3>Xem trước — phễu lọc kỳ ' + esc(rep.meta.fromDate || A.period) + ' → ' + esc(rep.meta.toDate || '') + '</h3>'
      + '<div class="phf-qtth-kpis">'
      + kpi('Dòng nguồn', fmtN(t.sourceRows), 'không lưu')
      + kpi('Phát sinh Nợ', fmtN(t.debitRows))
      + kpi('Trong phạm vi chi phí', fmtN(t.costScopeRows), t.uniqueCostAccounts + ' tài khoản')
      + kpi('Đưa vào', fmtN(t.included), fmtN(a.included) + ' đ')
      + kpi('Chờ rà soát', fmtN(t.needsReview), fmtN(a.needsReview) + ' đ')
      + kpi('Loại trừ', fmtN(t.excluded), fmtN(a.excluded) + ' đ')
      + '</div>'
      + (t.outOfMasterDepartments && t.outOfMasterDepartments.length
        ? '<p class="phf-qtth-chip is-warn">⚠ Mã bp ngoài danh mục (giữ nguyên, không bỏ): ' + esc(t.outOfMasterDepartments.join(', ')) + '</p>' : '')
      + '<div class="phf-qtth-cols">'
      + '<div><h4>Top tài khoản chi phí</h4>' + acctTable(rep.topAccounts) + '</div>'
      + '<div><h4>Chờ rà soát — tài khoản KTT cần xác nhận</h4>' + reviewTable(rep.needsReviewAccounts) + '</div>'
      + '</div>'
      + (rep.excludedReasons && rep.excludedReasons.length ? '<h4>Lý do loại trừ</h4>' + exclTable(rep.excludedReasons) : '')
      + '<h4>Phân bổ theo bộ phận (Mã bp)</h4>' + deptTable(rep.departmentBreakdown)
      + '<div style="margin-top:14px">'
      + (canConfirm
        ? '<button type="button" class="phf-qtth-btn" data-acc-confirm="' + esc(cur.fileId) + '">Xác nhận nhập dữ liệu (V' + cur.version + ')</button>'
        : (cur ? '<span class="phf-qtth-tag">Đã xác nhận V' + cur.version + (cur.confirmedAt ? ' · ' + esc(String(cur.confirmedAt).slice(0, 10)) : '') + '</span>' : ''))
      + ' <button type="button" class="phf-qtth-btn ghost" data-acc-drill="NEEDS_REVIEW">Xem dòng chờ rà soát</button>'
      + ' <button type="button" class="phf-qtth-btn ghost" data-acc-drill="INCLUDE">Xem dòng đưa vào</button>'
      + '</div>'
      + (A.drill ? drillBlock(A.drill) : '')
      + '</div>';
  }

  function acctTable(rows) {
    if (!rows || !rows.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:420px"><thead><tr><th>Tài khoản</th><th>Dòng</th><th>Phát sinh Nợ</th><th>Phân loại</th></tr></thead><tbody>'
      + rows.slice(0, 20).map(function (r) {
        var bc = r.byClass || {};
        var tag = bc.INCLUDE ? 'Đưa vào' : (bc.NEEDS_REVIEW ? 'Chờ rà soát' : (bc.EXCLUDE ? 'Loại trừ' : '—'));
        return '<tr><td>' + esc(r.account) + '</td><td style="text-align:right">' + fmtN(r.rows) + '</td><td style="text-align:right">' + fmtN(r.amount) + '</td><td>' + esc(tag) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function reviewTable(rows) {
    if (!rows || !rows.length) return '<p class="phf-qtth-muted">Không có tài khoản nào chờ rà soát.</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:420px"><thead><tr><th>Tài khoản</th><th>Dòng</th><th>Số tiền</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td>' + esc(r.account) + '</td><td style="text-align:right">' + fmtN(r.rows) + '</td><td style="text-align:right">' + fmtN(r.amount) + '</td></tr>'; }).join('')
      + '</tbody></table></div>';
  }
  function exclTable(rows) {
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table"><thead><tr><th>Rule</th><th>Diễn giải</th><th>Dòng</th><th>Số tiền</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td>' + esc(r.ruleId) + '</td><td>' + esc(r.note || '') + '</td><td style="text-align:right">' + fmtN(r.rows) + '</td><td style="text-align:right">' + fmtN(r.amount) + '</td></tr>'; }).join('')
      + '</tbody></table></div>';
  }
  function deptTable(rows) {
    if (!rows || !rows.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:320px"><thead><tr><th>Mã bp</th><th>Dòng</th><th>Ghi chú</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td>' + esc(r.dept) + '</td><td style="text-align:right">' + fmtN(r.rows) + '</td><td>' + (r.outOfMaster ? '<span class="phf-qtth-chip is-warn">ngoài danh mục</span>' : '') + '</td></tr>'; }).join('')
      + '</tbody></table></div>';
  }

  function drillBlock(d) {
    var rows = d.rows || [];
    return '<div class="phf-qtth-drill"><h4>' + esc(d.classification) + ' — ' + fmtN(d.rowCount) + ' dòng (' + esc(d.periodMonth) + ' V' + esc(d.version) + ')</h4>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:900px"><thead><tr>'
      + '<th>Ngày ct</th><th>Mã ct</th><th>Số ct</th><th>Diễn giải</th><th>Tài khoản</th><th>TK đối ứng</th><th>Phát sinh Nợ</th><th>Mã bp</th><th>Rule</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        return '<tr><td>' + esc(r.ngayCt || '') + '</td><td>' + esc(r.maCt || '') + '</td><td>' + esc(r.soCt || '') + '</td>'
          + '<td>' + esc(r.dienGiai || '') + '</td><td>' + esc(r.taiKhoan) + '</td><td>' + esc(r.tkDoiUng || '') + '</td>'
          + '<td style="text-align:right">' + fmtN(r.phatSinhNo) + '</td>'
          + '<td>' + esc(r.maBp || '') + (r.maBpOutOfMaster ? ' ⚠' : '') + '</td><td>' + esc(r.ruleId || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + (rows.length > 500 ? '<p class="phf-qtth-muted">Hiển thị 500 / ' + fmtN(d.rowCount) + ' dòng.</p>' : '')
      + '<p><button type="button" class="phf-qtth-btn ghost" data-acc-drill-close>Đóng</button></p></div>';
  }

  function versionsBlock(st) {
    if (!st.versions || !st.versions.length) return '';
    return '<details class="phf-qtth-versions"><summary>Phiên bản (' + st.versions.length + ')</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:640px"><thead><tr><th>V</th><th>Trạng thái</th><th>Nguồn</th><th>Đưa vào</th><th>Chờ RS</th><th>Số tiền đưa vào</th><th>Người tải</th></tr></thead><tbody>'
      + st.versions.map(function (v) {
        return '<tr' + (v.isCurrent ? ' class="is-active"' : '') + '><td>V' + v.version + '</td><td>' + esc(v.status) + '</td>'
          + '<td style="text-align:right">' + fmtN(v.sourceRows) + '</td><td style="text-align:right">' + fmtN(v.included) + '</td>'
          + '<td style="text-align:right">' + fmtN(v.needsReview) + '</td><td style="text-align:right">' + fmtN(v.includedAmount) + '</td>'
          + '<td>' + esc(v.uploadedBy || '') + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  function dictBlock(d) {
    var head = '<details class="phf-qtth-dict"><summary>Danh mục phí (Cost Dictionary)</summary>';
    var body;
    if (d && d.exists) {
      body = '<p class="phf-qtth-muted">Phiên bản V' + d.version + ' · ' + fmtN(d.entryCount) + ' mã phí · nhập bởi ' + esc(d.importedBy || '') + '</p>'
        + '<p class="phf-qtth-muted">Danh mục phí là dữ liệu tham chiếu. <b>Không</b> ghép với chứng từ bằng từ khóa ở V1 — mã phí của từng dòng để trạng thái “chưa xác định”.</p>'
        + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table"><thead><tr><th>Nhóm 1</th><th>Tên</th><th>Số mã</th></tr></thead><tbody>'
        + (d.groups || []).map(function (g) { return '<tr><td>' + esc(g.nhom1) + '</td><td>' + esc(g.tenNhom1 || '') + '</td><td style="text-align:right">' + fmtN(g.count) + '</td></tr>'; }).join('')
        + '</tbody></table></div>';
    } else {
      body = '<p class="phf-qtth-muted">Chưa nhập danh mục phí.</p>';
    }
    body += '<p style="margin-top:8px"><input type="file" accept=".xlsx" data-acc-dict-file> '
      + '<button type="button" class="phf-qtth-btn ghost" data-acc-dict-import>Nhập / cập nhật danh mục phí</button></p>';
    return head + body + '</details>';
  }

  function rulesBlock(r) {
    if (!r || !r.rules) return '';
    return '<details class="phf-qtth-rules"><summary>Bộ quy tắc phân loại (' + esc(r.ruleVersion) + ' · ' + r.rules.length + ' rule)</summary>'
      + '<p class="phf-qtth-muted">Rộng trước — loại trừ tường minh — chưa biết = chờ rà soát. Không có whitelist đóng vĩnh viễn.</p>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table" style="min-width:560px"><thead><tr><th>Ưu tiên</th><th>Loại khớp</th><th>Hành động</th><th>Ghi chú</th></tr></thead><tbody>'
      + r.rules.map(function (x) {
        return '<tr><td style="text-align:right">' + esc(x.priority) + '</td><td>' + esc(x.matchKind || x.match_kind) + '</td><td>' + esc(x.action) + '</td><td>' + esc(x.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  /* ---------------- events ---------------- */
  function wire(slot) {
    var pe = slot.querySelector('[data-acc-period]');
    if (pe) pe.onchange = function () { A.period = pe.value; A.drill = null; reload(slot); };
    slot.querySelectorAll('[data-acc-back]').forEach(function (b) { b.onclick = function () { go(qbase() + '/truth-data'); }; });

    var up = slot.querySelector('[data-acc-upload]');
    if (up) up.onclick = function () { doUpload(slot); };

    slot.querySelectorAll('[data-acc-confirm]').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Đang xác nhận…';
        try { await call('qtthAccountingConfirm', { file_id: b.getAttribute('data-acc-confirm') }); toast('Đã xác nhận nhập dữ liệu.', 'ok'); A.drill = null; reload(slot); }
        catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Xác nhận nhập dữ liệu'; }
      };
    });

    slot.querySelectorAll('[data-acc-drill]').forEach(function (b) {
      b.onclick = async function () {
        var cls = b.getAttribute('data-acc-drill');
        try { A.drill = await call('qtthAccountingListNormalized', { period_month: A.period, classification: cls }); A.drill.classification = cls; paint(slot); }
        catch (e) { toast(e.message, 'error'); }
      };
    });
    slot.querySelectorAll('[data-acc-drill-close]').forEach(function (b) { b.onclick = function () { A.drill = null; paint(slot); }; });

    var di = slot.querySelector('[data-acc-dict-import]');
    if (di) di.onclick = function () { doDictImport(slot); };
  }

  function readFileB64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(new Error('Không đọc được tệp.')); };
      r.readAsDataURL(file);
    });
  }

  async function doUpload(slot) {
    var fi = slot.querySelector('[data-acc-file]');
    var file = fi && fi.files && fi.files[0];
    if (!file) { toast('Chọn tệp .xlsx bảng kê chứng từ.', 'warn'); return; }
    if (!/\.xlsx$/i.test(file.name)) { toast('Chỉ nhận tệp .xlsx.', 'warn'); return; }
    if (file.size > 32 * 1024 * 1024) { toast('Tệp vượt quá 32MB.', 'warn'); return; }
    A.uploading = true; paint(slot);
    try {
      var res = await fetch(UPLOAD_URL + '?period=' + encodeURIComponent(A.period), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Accounting-Filename': encodeURIComponent(file.name) },
        body: file
      });
      var data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok || !data || data.ok === false) {
        throw new Error((data && (data.error || data.message)) || ('Máy chủ trả lỗi HTTP ' + res.status));
      }
      toast('Đã đọc & phân loại. Kiểm tra phễu lọc rồi xác nhận.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      A.uploading = false; A.drill = null;
      await reload(slot);
    }
  }

  async function doDictImport(slot) {
    var fi = slot.querySelector('[data-acc-dict-file]');
    var file = fi && fi.files && fi.files[0];
    if (!file) { toast('Chọn tệp Danh mục phí (.xlsx).', 'warn'); return; }
    try {
      var b64 = await readFileB64(file);
      var r = await call('qtthAccountingImportDictionary', { file_name: file.name, file_base64: b64 });
      toast('Đã nhập danh mục phí: ' + r.entryCount + ' mã (V' + r.version + ').', 'ok');
      reload(slot);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ---------------- entry ---------------- */
  window.phfQtthRenderAccounting = async function (slot, boot) {
    A.period = A.period || currentPeriod();
    await reload(slot);
  };

  window.__qtthAccountingTestHooks = { funnelBlock: funnelBlock, uploadBlock: uploadBlock, dictBlock: dictBlock, rulesBlock: rulesBlock, esc: esc, fmtN: fmtN };
})();
