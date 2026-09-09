/*
 * PHF HR — QUẢN TRỊ TỔNG HỢP · Truth Data · DỮ LIỆU CHI PHÍ KẾ TOÁN (Accounting Data V1).
 *
 * Renders window.phfQtthRenderAccounting(slot, boot) — called by
 * assets/js/qtth/phf-qtth-payroll.js for key 'truth-data/accounting'
 * (route /admin/qtth/truth-data/accounting).
 *
 * UX: Operator-first. After upload the screen leads with a plain-Vietnamese
 * period summary, then the "Cần rà soát" work grouped by account (8 groups,
 * NOT a 51-row wall). Technical sections (Danh mục phí, bộ quy tắc, top tài
 * khoản, phiên bản) are collapsed by default. Engine / classification / amounts
 * / schema are UNCHANGED — this file is presentation only.
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
  function fmtDate(v) {
    var s = String(v == null ? '' : v);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;                 // already DD/MM/YYYY (server to_char)
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s || '—';
  }

  var A = { period: '', status: null, preview: null, reviewRows: null, rules: null, dict: null, uploading: false, openAcct: {}, incDrill: null };
  var UPLOAD_URL = '/api/qtth-accounting-upload';
  var MASTER_BP = ['BP01', 'BP02', 'CN1', 'CN2', 'CN3', 'CN4'];

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
      var latest = cur || (A.status && A.status.versions && A.status.versions[0]);
      A.preview = latest ? await call('qtthAccountingPreview', { file_id: latest.fileId }) : null;
      // the 51 "cần rà soát" lines — small; used to build the account groups +
      // inline drill-down without further round-trips.
      A.reviewRows = A.preview
        ? (await call('qtthAccountingListNormalized', { period_month: A.period, classification: 'NEEDS_REVIEW' })).rows || []
        : [];
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
        + '<h2>Dữ liệu chi phí kế toán</h2>'
        + '<p class="phf-qtth-muted">Đọc bảng kê chứng từ xuất từ FAST, giữ lại các khoản <b>chi phí quản trị</b> và tách phần <b>cần người rà soát</b>. '
        + 'Không phải hệ thống kế toán. Dữ liệu nguồn không được lưu lại.</p>'
        + '</div>'
        + '<label class="phf-qtth-period">Kỳ&nbsp;'
        + '<select data-acc-period>' + periodList().map(function (p) { return '<option value="' + p + '"' + (p === A.period ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>'
        + '</label></div>'
        + uploadBlock(st)
        + (rep
          ? summaryBlock(rep)
          + actionBar(rep, st)
          + reviewGroupsBlock(rep)
          + deptSummaryBlock(rep)
          + techDetails(rep, st)
          : '<p class="phf-qtth-muted" style="margin-top:12px">Kỳ này chưa có dữ liệu. Tải file bảng kê chứng từ (xuất từ FAST) để bắt đầu.</p>')
        + backBtn()
      );
    wire(slot);
  }

  function uploadBlock(st) {
    var pending = (st.versions || []).some(function (v) { return v.status === 'previewed'; });
    return '<div class="phf-qtth-td-upload">'
      + '<h3>Nhập bảng kê chứng từ</h3>'
      + '<p class="phf-qtth-muted">File xuất trực tiếp từ FAST (.xlsx). Hệ thống chỉ nhận & kiểm tra đúng cấu trúc FAST.</p>'
      + '<input type="file" accept=".xlsx" data-acc-file' + (A.uploading ? ' disabled' : '') + '> '
      + '<button type="button" class="phf-qtth-btn" data-acc-upload' + (A.uploading ? ' disabled' : '') + '>' + (A.uploading ? 'Đang xử lý…' : 'Tải lên & xem trước') + '</button>'
      + (pending ? '<p class="phf-qtth-muted" style="margin-top:6px">Đang có bản nháp chờ xác nhận.</p>' : '')
      + '</div>';
  }

  /* ---- A. TÓM TẮT KỲ ---- */
  function stat(label, rows, amount, tone) {
    return '<div class="phf-qtth-stat' + (tone ? ' is-' + tone : '') + '">'
      + '<span class="phf-qtth-stat-label">' + esc(label) + '</span>'
      + '<span class="phf-qtth-stat-rows">' + fmtN(rows) + ' dòng</span>'
      + (amount != null ? '<span class="phf-qtth-stat-amt">' + fmtN(amount) + ' đ</span>' : '<span class="phf-qtth-stat-amt phf-qtth-muted">không lưu</span>')
      + '</div>';
  }
  function summaryBlock(rep) {
    var t = rep.totals, a = rep.amounts;
    var period = (rep.meta.fromDate ? fmtDate(rep.meta.fromDate) + ' – ' + fmtDate(rep.meta.toDate) : A.period);
    return '<div class="phf-qtth-summary">'
      + '<h3>Tóm tắt kỳ · ' + esc(period) + '</h3>'
      + '<div class="phf-qtth-statgrid">'
      + stat('Dữ liệu nguồn (FAST)', t.sourceRows, null)
      + stat('Chi phí phát hiện', t.costScopeRows, a.costScope)
      + stat('Đã nhận diện', t.included, a.included, 'ok')
      + stat('Cần rà soát', t.needsReview, a.needsReview, t.needsReview > 0 ? 'warn' : 'ok')
      + '</div>'
      + (t.excluded > 0 ? '<p class="phf-qtth-muted">Không đưa vào: ' + fmtN(t.excluded) + ' dòng · ' + fmtN(a.excluded) + ' đ (bút toán kết chuyển).</p>' : '')
      + '</div>';
  }

  /* ---- B. BUTTON HIERARCHY ---- */
  function actionBar(rep, st) {
    var t = rep.totals;
    var cur = st.current || (st.versions && st.versions[0]) || null;
    var canConfirm = cur && cur.status === 'previewed';
    var confirmed = cur && cur.status === 'confirmed';
    var out = '<div class="phf-qtth-actionbar">';
    if (t.needsReview > 0) {
      out += '<button type="button" class="phf-qtth-btn" data-acc-goto-review>Rà soát ' + fmtN(t.needsReview) + ' khoản</button>';
    }
    if (canConfirm) {
      out += ' <button type="button" class="phf-qtth-btn ghost" data-acc-confirm="' + esc(cur.fileId) + '">Xác nhận nhập dữ liệu (V' + cur.version + ')</button>';
      if (t.needsReview > 0) out += '<span class="phf-qtth-muted"> — vẫn còn ' + fmtN(t.needsReview) + ' khoản chưa rà soát; xác nhận không xoá phần cần rà.</span>';
    } else if (confirmed) {
      out += '<span class="phf-qtth-tag">Đã xác nhận V' + cur.version + (cur.confirmedAt ? ' · ' + fmtDate(String(cur.confirmedAt).slice(0, 10)) : '') + '</span>';
    }
    return out + '</div>';
  }

  /* ---- C. NEEDS REVIEW — GROUP FIRST ---- */
  function reviewGroupsBlock(rep) {
    var groups = rep.needsReviewAccounts || [];
    if (!groups.length) return '<div class="phf-qtth-review" data-acc-review><h3>Cần rà soát</h3><p class="phf-qtth-muted">Không có khoản nào cần rà soát trong kỳ này.</p></div>';
    var byAcct = {};
    (A.reviewRows || []).forEach(function (r) { (byAcct[r.taiKhoan] = byAcct[r.taiKhoan] || []).push(r); });
    return '<div class="phf-qtth-review" data-acc-review>'
      + '<h3>Cần rà soát — ' + fmtN(rep.totals.needsReview) + ' khoản · ' + fmtN(rep.amounts.needsReview) + ' đ</h3>'
      + '<p class="phf-qtth-muted">Nhóm theo tài khoản. Bấm “Xem chi tiết” để xem từng khoản. Chưa quyết định đưa vào / không đưa vào ở bước này.</p>'
      + groups.map(function (g) { return reviewGroupRow(g, byAcct[g.account] || []); }).join('')
      + '</div>';
  }
  function reviewGroupRow(g, rows) {
    var open = !!A.openAcct[g.account];
    var samples = [];
    var seen = {};
    for (var i = 0; i < rows.length && samples.length < 3; i++) {
      var d = (rows[i].dienGiai || '').trim();
      if (d && !seen[d]) { seen[d] = 1; samples.push(d); }
    }
    var depts = {};
    rows.forEach(function (r) { if (r.maBp) depts[r.maBp] = (depts[r.maBp] || 0) + 1; });
    var deptStr = Object.keys(depts).map(function (k) { return k + ' (' + depts[k] + ')'; }).join(' · ');
    return '<div class="phf-qtth-rgroup' + (open ? ' is-open' : '') + '">'
      + '<div class="phf-qtth-rgroup-head">'
      + '<div class="phf-qtth-rgroup-id"><b>' + esc(g.account) + '</b><span class="phf-qtth-muted">' + fmtN(g.rows) + ' khoản · ' + fmtN(g.amount) + ' đ</span></div>'
      + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-toggle="' + esc(g.account) + '">' + (open ? 'Ẩn' : 'Xem ' + fmtN(g.rows) + ' khoản') + '</button>'
      + '</div>'
      + (samples.length ? '<ul class="phf-qtth-rgroup-samples">' + samples.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '')
      + (deptStr ? '<p class="phf-qtth-muted phf-qtth-rgroup-dept">Bộ phận: ' + esc(deptStr) + '</p>' : '')
      + (open ? reviewGroupDetail(rows) : '')
      + '</div>';
  }
  function reviewGroupDetail(rows) {
    if (!rows.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:560px"><thead><tr>'
      + '<th>Ngày</th><th>Diễn giải</th><th>Số tiền</th><th>Bộ phận</th><th>Số CT</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        return '<tr><td>' + esc(fmtDate(r.ngayCt)) + '</td><td>' + esc(r.dienGiai || '') + '</td>'
          + '<td style="text-align:right">' + fmtN(r.phatSinhNo) + '</td>'
          + '<td>' + esc(r.maBp || '') + (r.maBpOutOfMaster ? ' *' : '') + '</td>'
          + '<td>' + esc(r.soCt || r.maCt || '') + '</td></tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<details class="phf-qtth-rawfields"><summary>Trường kỹ thuật</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact"><thead><tr><th>Ngày (nguồn)</th><th>Mã CT</th><th>TK đối ứng</th><th>Quy tắc</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        return '<tr><td>' + esc(fmtDate(r.ngayCtIso || r.ngayCt)) + '</td><td>' + esc(r.maCt || '') + '</td><td>' + esc(r.tkDoiUng || '') + '</td><td>' + esc(r.ruleId || '') + '</td></tr>';
      }).join('')
      + '</tbody></table></div></details>';
  }

  /* ---- 7. DEPARTMENT SUMMARY (compact) ---- */
  function deptSummaryBlock(rep) {
    var rows = (rep.departmentBreakdown || []).slice().sort(function (a, b) { return b.rows - a.rows; });
    var oom = rows.filter(function (r) { return r.outOfMaster; });
    return '<div class="phf-qtth-deptsum">'
      + '<h3>Bộ phận</h3>'
      + '<p>' + rows.map(function (r) { return '<span class="phf-qtth-deptchip' + (r.outOfMaster ? ' is-warn' : '') + '">' + esc(r.dept) + ' · ' + fmtN(r.rows) + '</span>'; }).join(' ') + '</p>'
      + oom.map(function (r) {
        return '<p class="phf-qtth-note">“' + esc(r.dept) + '” đang được FAST sử dụng nhưng chưa nằm trong danh mục bộ phận chuẩn (' + MASTER_BP.join(', ') + '). '
          + 'Hệ thống giữ nguyên giá trị này, không bỏ và không đổi tên.</p>';
      }).join('')
      + '</div>';
  }

  /* ---- 5/6. TECHNICAL SECTIONS (collapsed) ---- */
  function techDetails(rep, st) {
    return '<div class="phf-qtth-tech">'
      + '<details class="phf-qtth-fold"><summary>Chi tiết theo tài khoản (' + (rep.totals.uniqueCostAccounts) + ' tài khoản)</summary>'
      + acctTable(rep.topAccounts)
      + '<p style="margin-top:8px"><button type="button" class="phf-qtth-btn ghost sm" data-acc-inc-drill>' + (A.incDrill ? 'Ẩn dòng đã nhận diện' : 'Xem dòng đã nhận diện') + '</button></p>'
      + (A.incDrill ? incDrillTable(A.incDrill) : '')
      + '</details>'
      + '<details class="phf-qtth-fold"><summary>Danh mục phí</summary>' + dictInner(A.dict) + '</details>'
      + '<details class="phf-qtth-fold"><summary>Bộ quy tắc phân loại (' + (A.rules ? A.rules.rules.length : 0) + ')</summary>' + rulesInner(A.rules) + '</details>'
      + '<details class="phf-qtth-fold"><summary>Phiên bản & nguồn</summary>' + versionsInner(st) + '</details>'
      + '</div>';
  }

  function acctTable(rows) {
    if (!rows || !rows.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:420px"><thead><tr><th>Tài khoản</th><th>Dòng</th><th>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>'
      + rows.map(function (r) {
        var bc = r.byClass || {};
        var tag = bc.NEEDS_REVIEW ? 'Cần rà soát' : (bc.INCLUDE ? 'Đã nhận diện' : (bc.EXCLUDE ? 'Không đưa vào' : '—'));
        return '<tr><td>' + esc(r.account) + '</td><td style="text-align:right">' + fmtN(r.rows) + '</td><td style="text-align:right">' + fmtN(r.amount) + '</td><td>' + esc(tag) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function incDrillTable(d) {
    var rows = d.rows || [];
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:560px"><thead><tr>'
      + '<th>Ngày</th><th>Diễn giải</th><th>Số tiền</th><th>Tài khoản</th><th>Bộ phận</th><th>Số CT</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        return '<tr><td>' + esc(fmtDate(r.ngayCt)) + '</td><td>' + esc(r.dienGiai || '') + '</td><td style="text-align:right">' + fmtN(r.phatSinhNo) + '</td>'
          + '<td>' + esc(r.taiKhoan) + '</td><td>' + esc(r.maBp || '') + '</td><td>' + esc(r.soCt || r.maCt || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + (rows.length > 500 ? '<p class="phf-qtth-muted">Hiển thị 500 / ' + fmtN(d.rowCount) + ' dòng.</p>' : '');
  }

  function dictInner(d) {
    var body;
    if (d && d.exists) {
      body = '<p class="phf-qtth-muted">Phiên bản V' + d.version + ' · ' + fmtN(d.entryCount) + ' mã phí · nhập bởi ' + esc(d.importedBy || '') + '</p>'
        + '<p class="phf-qtth-muted">Dữ liệu tham chiếu. <b>Không</b> tự ghép với chứng từ ở V1 — mã phí từng dòng để “chưa xác định”.</p>'
        + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact"><thead><tr><th>Nhóm 1</th><th>Tên</th><th>Số mã</th></tr></thead><tbody>'
        + (d.groups || []).map(function (g) { return '<tr><td>' + esc(g.nhom1) + '</td><td>' + esc(g.tenNhom1 || '') + '</td><td style="text-align:right">' + fmtN(g.count) + '</td></tr>'; }).join('')
        + '</tbody></table></div>';
    } else {
      body = '<p class="phf-qtth-muted">Chưa nhập danh mục phí.</p>';
    }
    return body + '<p style="margin-top:8px"><input type="file" accept=".xlsx" data-acc-dict-file> '
      + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-dict-import>Nhập / cập nhật danh mục phí</button></p>';
  }
  function rulesInner(r) {
    if (!r || !r.rules) return '<p class="phf-qtth-muted">—</p>';
    return '<p class="phf-qtth-muted">Rộng trước — loại trừ tường minh — chưa biết = cần rà soát. Không có whitelist đóng vĩnh viễn.</p>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:520px"><thead><tr><th>Ưu tiên</th><th>Loại khớp</th><th>Hành động</th><th>Ghi chú</th></tr></thead><tbody>'
      + r.rules.map(function (x) {
        return '<tr><td style="text-align:right">' + esc(x.priority) + '</td><td>' + esc(x.matchKind || x.match_kind) + '</td><td>' + esc(x.action) + '</td><td>' + esc(x.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function versionsInner(st) {
    if (!st.versions || !st.versions.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:620px"><thead><tr><th>V</th><th>Trạng thái</th><th>Nguồn</th><th>Đã nhận diện</th><th>Cần rà soát</th><th>Người tải</th></tr></thead><tbody>'
      + st.versions.map(function (v) {
        return '<tr' + (v.isCurrent ? ' class="is-active"' : '') + '><td>V' + v.version + '</td><td>' + esc({ previewed: 'nháp', confirmed: 'đã xác nhận', superseded: 'thay thế' }[v.status] || v.status) + '</td>'
          + '<td style="text-align:right">' + fmtN(v.sourceRows) + '</td><td style="text-align:right">' + fmtN(v.included) + '</td>'
          + '<td style="text-align:right">' + fmtN(v.needsReview) + '</td><td>' + esc(v.uploadedBy || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------------- events ---------------- */
  function wire(slot) {
    var pe = slot.querySelector('[data-acc-period]');
    if (pe) pe.onchange = function () { A.period = pe.value; A.openAcct = {}; A.incDrill = null; reload(slot); };
    slot.querySelectorAll('[data-acc-back]').forEach(function (b) { b.onclick = function () { go(qbase() + '/truth-data'); }; });

    var up = slot.querySelector('[data-acc-upload]');
    if (up) up.onclick = function () { doUpload(slot); };

    var goRev = slot.querySelector('[data-acc-goto-review]');
    if (goRev) goRev.onclick = function () { var el = slot.querySelector('[data-acc-review]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    slot.querySelectorAll('[data-acc-toggle]').forEach(function (b) {
      b.onclick = function () { var a = b.getAttribute('data-acc-toggle'); A.openAcct[a] = !A.openAcct[a]; paint(slot); };
    });

    slot.querySelectorAll('[data-acc-confirm]').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Đang xác nhận…';
        try { await call('qtthAccountingConfirm', { file_id: b.getAttribute('data-acc-confirm') }); toast('Đã xác nhận nhập dữ liệu.', 'ok'); reload(slot); }
        catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Xác nhận nhập dữ liệu'; }
      };
    });

    var incBtn = slot.querySelector('[data-acc-inc-drill]');
    if (incBtn) incBtn.onclick = async function () {
      if (A.incDrill) { A.incDrill = null; paint(slot); return; }
      try { A.incDrill = await call('qtthAccountingListNormalized', { period_month: A.period, classification: 'INCLUDE' }); paint(slot); }
      catch (e) { toast(e.message, 'error'); }
    };

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
      toast('Đã đọc & phân loại. Xem tóm tắt rồi rà soát phần cần rà.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      A.uploading = false; A.openAcct = {}; A.incDrill = null;
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

  window.__qtthAccountingTestHooks = {
    summaryBlock: summaryBlock, reviewGroupsBlock: reviewGroupsBlock, actionBar: actionBar,
    deptSummaryBlock: deptSummaryBlock, techDetails: techDetails, fmtDate: fmtDate, esc: esc, fmtN: fmtN,
  };
})();
