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

  var A = { period: '', status: null, preview: null, reviewRows: null, rules: null, dict: null, uploading: false,
    openAcct: {}, incDrill: null, decideFor: null, categories: {}, remembered: null, showRules: false };
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
        call('qtthAccountingListRules', {}),
        call('qtthAccountingListRememberedRules', {})
      ]);
      A.status = r[0]; A.dict = r[1]; A.rules = r[2]; A.remembered = r[3];
      var cur = A.status && A.status.current;
      var latest = cur || (A.status && A.status.versions && A.status.versions[0]);
      A.preview = latest ? await call('qtthAccountingPreview', { file_id: latest.fileId }) : null;
      // the NEEDS_REVIEW lines (small population) — group cards + inline review.
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
  // live funnel (reflects Operator decisions) when available, else the upload snapshot
  function funnelView(rep) {
    var live = A.preview && A.preview.live;
    var t = live ? Object.assign({}, rep.totals, live.totals) : rep.totals;
    var a = live ? Object.assign({}, rep.amounts, live.amounts) : rep.amounts;
    t.sourceRows = rep.totals.sourceRows;
    return { t: t, a: a, reconciles: !live || live.reconciles !== false };
  }
  function summaryBlock(rep) {
    var fv = funnelView(rep); var t = fv.t, a = fv.a;
    var period = (rep.meta.fromDate ? fmtDate(rep.meta.fromDate) + ' – ' + fmtDate(rep.meta.toDate) : A.period);
    return '<div class="phf-qtth-summary">'
      + '<h3>Tóm tắt kỳ · ' + esc(period) + '</h3>'
      + '<div class="phf-qtth-statgrid">'
      + stat('Dữ liệu nguồn (FAST)', t.sourceRows, null)
      + stat('Chi phí phát hiện', t.costScopeRows, a.costScope)
      + stat('Đã đưa vào', t.included, a.included, 'ok')
      + stat('Cần rà soát', t.needsReview, a.needsReview, t.needsReview > 0 ? 'warn' : 'ok')
      + '</div>'
      + (t.excluded > 0 ? '<p class="phf-qtth-muted">Không đưa vào: ' + fmtN(t.excluded) + ' dòng · ' + fmtN(a.excluded) + ' đ.</p>' : '')
      + (t.operatorDecided ? '<p class="phf-qtth-muted">Người dùng đã quyết định: ' + fmtN(t.operatorDecided) + ' khoản.</p>' : '')
      + (!fv.reconciles ? '<p class="phf-qtth-error">⚠ Số liệu chưa khớp — vui lòng tải lại trang.</p>' : '')
      + '</div>';
  }

  /* ---- B. BUTTON HIERARCHY ---- */
  function actionBar(rep, st) {
    var t = funnelView(rep).t;
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

  /* ---- C. NEEDS REVIEW — GROUP FIRST + per-line decision ---- */
  function reviewGroupsBlock(rep) {
    // groups built from the LIVE NEEDS_REVIEW rows (reflects Operator decisions),
    // not the frozen upload snapshot.
    var byAcct = {};
    (A.reviewRows || []).forEach(function (r) { (byAcct[r.taiKhoan] = byAcct[r.taiKhoan] || []).push(r); });
    var accts = Object.keys(byAcct).sort(function (x, y) {
      return byAcct[y].reduce(function (s, r) { return s + r.phatSinhNo; }, 0) - byAcct[x].reduce(function (s, r) { return s + r.phatSinhNo; }, 0);
    });
    var total = (A.reviewRows || []).length;
    var totAmt = (A.reviewRows || []).reduce(function (s, r) { return s + r.phatSinhNo; }, 0);
    return '<div class="phf-qtth-review" data-acc-review>'
      + '<h3>Cần rà soát — ' + fmtN(total) + ' khoản · ' + fmtN(totAmt) + ' đ</h3>'
      + '<p class="phf-qtth-muted">Nhóm theo tài khoản. Với mỗi khoản, chọn <b>Đưa vào</b> hoặc <b>Không đưa vào</b>. '
      + 'Cùng tài khoản có thể có nhiều bản chất khác nhau — xem kỹ nội dung từng khoản.</p>'
      + (total === 0 ? '<p class="phf-qtth-muted">Tất cả các khoản đã được xử lý.</p>'
        : accts.map(function (a) { return reviewGroupRow(a, byAcct[a]); }).join(''))
      + '</div>';
  }
  function reviewGroupRow(account, rows) {
    var open = !!A.openAcct[account];
    var samples = [], seen = {};
    for (var i = 0; i < rows.length && samples.length < 3; i++) {
      var d = (rows[i].dienGiai || '').trim();
      if (d && !seen[d]) { seen[d] = 1; samples.push(d); }
    }
    var depts = {};
    rows.forEach(function (r) { if (r.maBp) depts[r.maBp] = (depts[r.maBp] || 0) + 1; });
    var deptStr = Object.keys(depts).map(function (k) { return k + ' (' + depts[k] + ')'; }).join(' · ');
    var amt = rows.reduce(function (s, r) { return s + r.phatSinhNo; }, 0);
    return '<div class="phf-qtth-rgroup' + (open ? ' is-open' : '') + '">'
      + '<div class="phf-qtth-rgroup-head">'
      + '<div class="phf-qtth-rgroup-id"><b>' + esc(account) + '</b><span class="phf-qtth-muted">' + fmtN(rows.length) + ' khoản · ' + fmtN(amt) + ' đ</span></div>'
      + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-toggle="' + esc(account) + '">' + (open ? 'Ẩn' : 'Xem ' + fmtN(rows.length) + ' khoản') + '</button>'
      + '</div>'
      + (samples.length ? '<ul class="phf-qtth-rgroup-samples">' + samples.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '')
      + (deptStr ? '<p class="phf-qtth-muted phf-qtth-rgroup-dept">Bộ phận: ' + esc(deptStr) + '</p>' : '')
      + (open ? reviewGroupDetail(account, rows) : '')
      + '</div>';
  }
  function reviewGroupDetail(account, rows) {
    if (!rows.length) return '<p class="phf-qtth-muted">—</p>';
    return '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:640px"><thead><tr>'
      + '<th>Ngày</th><th>Diễn giải</th><th>Số tiền</th><th>Bộ phận</th><th>Số CT</th><th>Quyết định</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        var df = A.decideFor;
        var isForm = df && df.account === account && df.rowIndex === r.sourceRowIndex;
        return '<tr><td>' + esc(fmtDate(r.ngayCt)) + '</td><td>' + esc(r.dienGiai || '') + '</td>'
          + '<td style="text-align:right">' + fmtN(r.phatSinhNo) + '</td>'
          + '<td>' + esc(r.maBp || '') + (r.maBpOutOfMaster ? ' *' : '') + '</td>'
          + '<td>' + esc(r.soCt || r.maCt || '') + '</td>'
          + '<td class="phf-qtth-decide-cell">'
          + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-decide-open="' + esc(account) + '|' + r.sourceRowIndex + '|INCLUDE">Đưa vào</button> '
          + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-decide-open="' + esc(account) + '|' + r.sourceRowIndex + '|EXCLUDE">Không đưa vào</button>'
          + '</td></tr>'
          + (isForm ? '<tr><td colspan="6">' + decideFormHtml(account, r) + '</td></tr>' : '');
      }).join('')
      + '</tbody></table></div>'
      + '<details class="phf-qtth-rawfields"><summary>Trường kỹ thuật</summary>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact"><thead><tr><th>Ngày (nguồn)</th><th>Mã CT</th><th>TK đối ứng</th><th>Quy tắc</th></tr></thead><tbody>'
      + rows.slice(0, 500).map(function (r) {
        return '<tr><td>' + esc(fmtDate(r.ngayCtIso || r.ngayCt)) + '</td><td>' + esc(r.maCt || '') + '</td><td>' + esc(r.tkDoiUng || '') + '</td><td>' + esc(r.ruleId || '') + '</td></tr>';
      }).join('')
      + '</tbody></table></div></details>';
  }

  function decideFormHtml(account, r) {
    var df = A.decideFor || {};
    var isInc = df.decision === 'INCLUDE';
    var cats = A.categories[account] || null;
    var tokens = df.matchText || (r.dienGiai || '');
    return '<div class="phf-qtth-decideform">'
      + '<p><b>' + (isInc ? 'Đưa vào quản trị' : 'Không đưa vào quản trị') + '</b> — ' + esc(account) + ' · ' + esc(r.dienGiai || '') + ' · ' + fmtN(r.phatSinhNo) + ' đ</p>'
      + (isInc
        ? '<label>Nhóm chi phí&nbsp;'
          + (cats && cats.hasDictionary
            ? '<select data-acc-cat><option value="">— chọn nhóm —</option>'
              + cats.categories.map(function (c) { return '<option value="' + esc(c.maPhi) + '|' + esc(c.tenPhi || '') + '"' + (df.costCode === c.maPhi ? ' selected' : '') + '>' + esc(c.maPhi) + ' — ' + esc(c.tenPhi || c.sub || c.groupName) + '</option>'; }).join('')
              + '</select>'
            : '<span class="phf-qtth-muted">(Chưa nhập Danh mục phí — hãy nhập ở mục kỹ thuật bên dưới trước; hoặc để trống)</span>')
          + '</label>'
        : '')
      + '<label class="phf-qtth-remember"><input type="checkbox" data-acc-remember' + (df.remember ? ' checked' : '') + '> Ghi nhớ cho các khoản tương tự lần sau</label>'
      + (df.remember
        ? '<div class="phf-qtth-remember-box">'
          + '<label>Nội dung nhận diện&nbsp;<input type="text" data-acc-match value="' + esc(tokens) + '" size="48"></label>'
          + '<p class="phf-qtth-muted">Hệ thống chỉ áp dụng khi <b>cùng tài khoản</b> và <b>nội dung chứa đủ các từ này</b>. '
          + 'Nội dung khác sẽ tiếp tục đưa vào Cần rà soát.</p>'
          + '<div class="phf-qtth-remember-preview">'
          + '<div><span>Tài khoản</span><b>' + esc(account) + '</b></div>'
          + '<div><span>Nhận diện nội dung</span><b>có các từ: ' + esc((tokens || '').toLowerCase().split(/\s+/).filter(Boolean).join(' · ')) + '</b></div>'
          + '<div><span>Quyết định</span><b>' + (isInc ? 'Đưa vào' : 'Không đưa vào') + '</b></div>'
          + (isInc && df.costCode ? '<div><span>Nhóm chi phí</span><b>' + esc(df.costCode) + '</b></div>' : '')
          + '</div></div>'
        : '')
      + '<div class="phf-qtth-decideform-actions">'
      + '<button type="button" class="phf-qtth-btn sm" data-acc-decide-submit>Lưu quyết định</button> '
      + '<button type="button" class="phf-qtth-btn ghost sm" data-acc-decide-cancel>Huỷ</button>'
      + '</div></div>';
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
      + '<details class="phf-qtth-fold"' + (A.showRules ? ' open' : '') + '><summary>Quy tắc đã ghi nhớ (' + ((A.remembered && A.remembered.rules) ? A.remembered.rules.length : 0) + ')</summary>' + rememberedInner() + '</details>'
      + '<details class="phf-qtth-fold"><summary>Danh mục phí</summary>' + dictInner(A.dict) + '</details>'
      + '<details class="phf-qtth-fold"><summary>Bộ quy tắc phân loại của hệ thống (' + (A.rules ? A.rules.rules.length : 0) + ')</summary>' + rulesInner(A.rules) + '</details>'
      + '<details class="phf-qtth-fold"><summary>Phiên bản & nguồn</summary>' + versionsInner(st) + '</details>'
      + '</div>';
  }

  function rememberedInner() {
    var rr = (A.remembered && A.remembered.rules) || [];
    if (!rr.length) return '<p class="phf-qtth-muted">Chưa có quy tắc nào được ghi nhớ. '
      + 'Khi rà soát một khoản, tích “Ghi nhớ cho các khoản tương tự lần sau” để tạo.</p>';
    return '<p class="phf-qtth-muted">Chỉ áp dụng khi cùng tài khoản và nội dung chứa đủ các từ đã ghi nhớ. Tắt một quy tắc để ngừng áp dụng.</p>'
      + '<div class="phf-qtth-tablewrap"><table class="phf-qtth-table phf-qtth-table-compact" style="min-width:640px"><thead><tr>'
      + '<th>Tài khoản</th><th>Nội dung nhận diện</th><th>Quyết định</th><th>Nhóm chi phí</th><th>Trạng thái</th><th>Người tạo</th><th></th></tr></thead><tbody>'
      + rr.map(function (x) {
        return '<tr' + (x.isActive ? '' : ' class="is-inactive"') + '><td>' + esc(x.account) + '</td>'
          + '<td>có các từ: ' + esc((x.matchTokens || []).join(' · ')) + '</td>'
          + '<td>' + (x.decision === 'INCLUDE' ? 'Đưa vào' : 'Không đưa vào') + '</td>'
          + '<td>' + esc(x.costCode || '—') + '</td>'
          + '<td>' + (x.isActive ? 'Đang áp dụng' : 'Đã tắt') + '</td>'
          + '<td>' + esc(x.createdByName || '') + (x.createdAt ? ' · ' + fmtDate(String(x.createdAt).slice(0, 10)) : '') + '</td>'
          + '<td><button type="button" class="phf-qtth-btn ghost sm" data-acc-rule-toggle="' + esc(x.id) + '|' + (x.isActive ? '0' : '1') + '">' + (x.isActive ? 'Tắt' : 'Bật') + '</button></td></tr>';
      }).join('')
      + '</tbody></table></div>';
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

    // ---- decision layer ----
    slot.querySelectorAll('[data-acc-decide-open]').forEach(function (b) {
      b.onclick = async function () {
        var p = b.getAttribute('data-acc-decide-open').split('|');
        var account = p[0], rowIndex = Number(p[1]), decision = p[2];
        A.decideFor = { account: account, rowIndex: rowIndex, decision: decision, remember: false, costCode: '', costCodeName: '', matchText: null };
        if (decision === 'INCLUDE' && !A.categories[account]) {
          try { A.categories[account] = await call('qtthAccountingListCategories', { account: account }); } catch (e) { A.categories[account] = { hasDictionary: false, categories: [] }; }
        }
        paint(slot);
      };
    });
    slot.querySelectorAll('[data-acc-decide-cancel]').forEach(function (b) { b.onclick = function () { A.decideFor = null; paint(slot); }; });
    var catSel = slot.querySelector('[data-acc-cat]');
    if (catSel) catSel.onchange = function () { var v = (catSel.value || '').split('|'); A.decideFor.costCode = v[0] || ''; A.decideFor.costCodeName = v[1] || ''; paint(slot); };
    var rem = slot.querySelector('[data-acc-remember]');
    if (rem) rem.onchange = function () { A.decideFor.remember = rem.checked; paint(slot); };
    var mt = slot.querySelector('[data-acc-match]');
    if (mt) mt.oninput = function () { A.decideFor.matchText = mt.value; };
    var sub = slot.querySelector('[data-acc-decide-submit]');
    if (sub) sub.onclick = function () { doDecide(slot); };

    slot.querySelectorAll('[data-acc-rule-toggle]').forEach(function (b) {
      b.onclick = async function () {
        var p = b.getAttribute('data-acc-rule-toggle').split('|');
        b.disabled = true;
        try {
          await call('qtthAccountingSetRuleActive', { rule_id: p[0], is_active: p[1] === '1' });
          A.showRules = true;
          toast(p[1] === '1' ? 'Đã bật lại quy tắc.' : 'Đã tắt quy tắc.', 'ok');
          reload(slot);
        } catch (e) { toast(e.message, 'error'); b.disabled = false; }
      };
    });
  }

  async function doDecide(slot) {
    var df = A.decideFor;
    if (!df) return;
    var fileId = A.preview && A.preview.fileId;
    if (!fileId) { toast('Chưa có phiên bản dữ liệu.', 'warn'); return; }
    var payload = {
      file_id: fileId, source_row_index: df.rowIndex, decision: df.decision,
      remember: df.remember === true,
    };
    if (df.decision === 'INCLUDE' && df.costCode) { payload.cost_code = df.costCode; payload.cost_code_name = df.costCodeName; }
    if (df.remember && df.matchText != null) payload.match_text = df.matchText;
    try {
      var res = await call('qtthAccountingDecideItem', payload);
      var msg = df.decision === 'INCLUDE' ? 'Đã đưa vào.' : 'Đã đánh dấu không đưa vào.';
      if (res.remembered) msg += ' Đã ghi nhớ' + (res.ruleAlsoAppliedTo ? ' — áp dụng thêm ' + res.ruleAlsoAppliedTo + ' khoản tương tự.' : '.');
      toast(msg, 'ok');
      A.decideFor = null;
      await reload(slot);
    } catch (e) { toast(e.message, 'error'); }
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
    deptSummaryBlock: deptSummaryBlock, techDetails: techDetails, decideFormHtml: decideFormHtml,
    rememberedInner: rememberedInner, fmtDate: fmtDate, esc: esc, fmtN: fmtN,
    __setState: function (partial) { Object.assign(A, partial || {}); },
    __state: function () { return A; },
  };
})();
