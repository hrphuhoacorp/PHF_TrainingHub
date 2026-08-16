'use strict';
/*
 * PHF Checklist — Workstream B (vòng cuối): module UI cho "Đi trễ" — sở hữu TOÀN BỘ:
 *   - Người có quyền ghi nhận (BẤT KỲ tài khoản nào có capability record_violation + scope
 *     bao phủ nhân sự — Trưởng ca CHỈ là một ví dụ, có thể là Trưởng bộ phận, Trợ lý Giám
 *     đốc, Giám đốc, Admin,...): "Ghi nhận phát hiện đi trễ" (nhân sự picker theo scope +
 *     Có/Không xin phép).
 *   - Admin: "Đối soát BCC" (upload -> preview -> đối soát -> xem lại -> phê duyệt -> xuất Excel),
 *     CỘNG "Nhập trực tiếp" (2026-08-16) — phương thức input thứ 2 song song Excel, hội tụ vào
 *     ĐÚNG 1 pipeline preview/staging/reconcile hiện có (previewChecklistLateBccUpload ->
 *     createChecklistLateBccImport -> reconcileChecklistLateBccImport), KHÔNG tạo write-path
 *     riêng, KHÔNG bao giờ gọi thẳng tới 1 API ghi official nào. Xem handleManualPreview().
 * KHÔNG đụng tới công cụ "Nhập thủ công/Nhập dồn" cũ đã RETIRED trong phf-checklist-app.js (đó
 * là 1 tính năng khác đã bị rút khỏi UI vì ghi thẳng bản ghi CHÍNH THỨC, độc lập với pipeline
 * đối soát ở file này — xem comment RETIRED tại đó). "Nhập trực tiếp" ở ĐÂY là thiết kế mới,
 * hoàn toàn khác: không ghi gì cho tới khi qua đúng staging + đối soát như Excel.
 *
 * Hợp đồng dữ liệu: gọi thẳng 8 action đã có ở server.js (POST /api/data), không tự tính điểm/
 * trạng thái chính thức — mọi "Điểm gợi ý" hiển thị đều lấy nguyên từ response server
 * (preview/reconcile), KHÔNG BAO GIỜ tự suy ra ở trình duyệt rồi gửi lên như một con số coi là
 * chính thức. KHÔNG có quota cưỡng chế ở bất kỳ đâu trong file này — cảnh báo tần suất chỉ hiển
 * thị nguyên văn "Cảnh báo tham chiếu", không dùng để disable bất kỳ nút nào.
 *
 * Mount API (được gọi từ assets/js/checklist/phf-checklist-app.js, xem syncLateWorkflowMount):
 *   window.PhfChecklistLateWorkflow.mount(containerEl, ctx) -> gắn UI vào containerEl.
 *   window.PhfChecklistLateWorkflow.unmount() -> gỡ UI hiện đang mount (nếu có), dọn timer/listener.
 * ctx = {
 *   isAdmin: boolean,           // đã xác định qua canUseLateViolation() ở app chính (role()==='admin')
 *   canRecord: boolean,         // true nếu tài khoản có capability record_violation (server-declared,
 *                                  đọc từ roleWorkspaceState.data.canRecordViolation) HOẶC isAdmin
 *   actorEmployeeCode: string,
 *   actorName: string,
 *   people: [{code,name,department,branch}]   // danh sách nhân sự ĐÃ ĐƯỢC LỌC THEO SCOPE bởi app
 *                                                 chính (violationEligibleEmployees()) — module này
 *                                                 KHÔNG tự lọc lại/không tự suy scope.
 * }
 */
(function () {
  var ROOT_ATTR = 'data-phfck-latewf-mount';
  var STORE = { node: null, ctx: null, state: null, listeners: [], timers: [] };
  // Phase-1 (2026-08-15, FINAL UI GATE): "Phê duyệt & ghi nhận"/"Điều chỉnh (audit)" tạo
  // official violation + trừ điểm — business owner CHƯA kích hoạt. Cờ này PHẢI khớp
  // LATE_APPROVAL_ENABLED ở lib/checklist-late-reconciliation-service.js (nguồn thật quyết
  // định — đổi ở backend trước, cờ UI này chỉ ẩn/hiện nút, KHÔNG phải nguồn kiểm soát bảo
  // mật). Khi false: ẩn hẳn nút Phê duyệt/Điều chỉnh + input Điểm áp dụng/Lý do/checkbox chọn
  // dòng khỏi bảng đối soát (không chỉ disable) — bảng chỉ còn dùng để XEM 4 nhãn nghiệp vụ.
  // Toàn bộ hàm xử lý approve/adjust bên dưới (handleBulkApprove/handleApproveOne/handleAdjust/
  // buildApproveDecision/runApprove) GIỮ NGUYÊN trong source cho lần kích hoạt sau — chỉ không
  // còn phần tử DOM nào gọi tới chúng ở phase-1.
  var LATE_APPROVAL_UI_ENABLED = false;

  /* ============================== Tiện ích chung ============================== */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function t(v) { return String(v == null ? '' : v).trim(); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtPoints(n) { var v = Number(n); return Number.isFinite(v) ? v : 0; }
  function formatLateMinutesDisplay(value) { var n = Number(value); return (value == null || value === '' || !Number.isFinite(n)) ? 'Không có dữ liệu' : String(Math.round(n)); }
  function manualRowDefault() { return { id: 'mrow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), employeeCode: '', date: todayIso(), time: '', shift: '', minutes: '', note: '' }; }

  /* Bảng điểm CHUẨN "Không duyệt" — nguồn hiển thị duy nhất, đúng 4 mức đã chốt Nội quy.
     Đây CHỈ là bảng tra cứu để HIỂN THỊ cho người dùng hiểu quy tắc — KHÔNG dùng để tự tính
     điểm rồi gửi lên server (mọi điểm gửi approve luôn lấy từ suggestedPoints do SERVER trả). */
  var LATE_BANDS_DISPLAY = [
    { label: '01–15 phút', points: 3, refCount: 4 },
    { label: '16–30 phút', points: 6, refCount: 2 },
    { label: '31–45 phút', points: 8, refCount: 1 },
    { label: 'Trên 45 phút', points: 12, refCount: 1 }
  ];

  function lateBandTableHtml() {
    return '<table class="phfck-latewf-band-table" aria-label="Bảng điểm gợi ý theo phút trễ (không duyệt)">'
      + '<thead><tr><th>Số phút trễ</th><th>Điểm gợi ý (Không duyệt)</th><th>Ngưỡng tham khảo/tháng</th></tr></thead>'
      + '<tbody>' + LATE_BANDS_DISPLAY.map(function (b) {
        return '<tr><td>' + esc(b.label) + '</td><td>' + b.points + ' điểm</td><td>' + b.refCount + ' lần (tham khảo)</td></tr>';
      }).join('') + '<tr class="is-exempt"><td>Duyệt</td><td colspan="2">Gợi ý 0 điểm</td></tr></tbody></table>'
      + '<p class="phfck-latewf-note">Không có ghi nhận bộ phận → mặc định gợi ý Không duyệt. Ngưỡng tần suất ở trên CHỈ LÀ Cảnh báo tham chiếu — không tự chặn, không tự đổi điểm, không tự từ chối duyệt.</p>';
  }

  /* fetch convention: cùng quy ước /api/data POST JSON {action,...} đã dùng khắp
     phf-checklist-app.js — không phát minh HTTP client mới. */
  function callApi(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch('/api/data?checklistLateWorkflow=1', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.message || data.error || 'Yêu cầu thất bại.');
          err.statusCode = res.status; err.code = data.code; err.permissionDenied = res.status === 403;
          throw err;
        }
        return data;
      });
    });
  }

  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__phfXlsxLoadingPromise) return window.__phfXlsxLoadingPromise;
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-phfck-xlsx-loader],script[src*="xlsx.full.min.js"]');
      if (existing) {
        existing.addEventListener('load', function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('Không khởi tạo được thư viện Excel.')); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Không tải được thư viện Excel.')); }, { once: true });
        setTimeout(function () { if (window.XLSX) resolve(window.XLSX); }, 0);
        return;
      }
      var s = document.createElement('script');
      s.src = '/assets/vendor/xlsx.full.min.js?v=0.18.5_phf_1.35.7';
      s.async = true; s.setAttribute('data-phfck-xlsx-loader', '');
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('Không khởi tạo được thư viện Excel.')); };
      s.onerror = function () { reject(new Error('Không tải được thư viện Excel. Vui lòng tải lại trang.')); };
      document.head.appendChild(s);
    });
  }

  var EXCEL_COLUMNS = ['Mã nhân viên', 'Họ tên', 'Ngày', 'Giờ', 'Địa điểm', 'Mã tiêu chí', 'Nội dung tiêu chí', 'Nhận xét', 'Điểm', 'Phút trễ', 'Ca làm', 'Lý do điều chỉnh', 'Trạng thái'];
  var MANUAL_SHIFT_OPTIONS = ['Ca sáng', 'Ca chiều', 'Ca tối'];

  /* Dữ liệu mẫu MINH HỌA thật (không lặp lại "20" ở mọi cột — lỗi đã bị review flag trước đó). */
  var TEMPLATE_SAMPLE_ROWS = [
    ['NV001', 'Nguyễn Văn A', todayIso(), '08:17', 'Chi nhánh Quận 3', 'PHF-DITRE-01', 'Đi trễ so với giờ vào ca', 'Kẹt xe khu vực cầu vượt', '', 12, 'Ca sáng', 'Xin nghỉ trễ do việc gia đình', 'Chờ duyệt'],
    ['NV014', 'Trần Thị B', todayIso(), '13:05', 'Chi nhánh Bình Thạnh', 'PHF-DITRE-01', 'Đi trễ so với giờ vào ca', 'Xe hỏng dọc đường', '', 5, 'Ca chiều', '', 'Chờ duyệt'],
    ['NV027', 'Lê Văn C', todayIso(), '19:40', 'Chi nhánh Thủ Đức', 'PHF-DITRE-01', 'Đi trễ so với giờ vào ca', 'Không rõ lý do', '', 32, 'Ca tối', 'Có báo Trưởng ca trước 10 phút', 'Chờ duyệt']
  ];
  function downloadTemplateXlsx() {
    return ensureXlsx().then(function (XLSX) {
      var rows = [EXCEL_COLUMNS].concat(TEMPLATE_SAMPLE_ROWS);
      var guide = [['HƯỚNG DẪN'], ['1. Không đổi tên cột, không thêm/bớt cột.'], ['2. Mã nhân viên phải tồn tại trong hệ thống và trong phạm vi được cấp quyền.'], ['3. Phút trễ phải là số nguyên >= 0.'], ['4. Cột Họ tên/Mã tiêu chí/Nội dung tiêu chí/Điểm/Trạng thái CHỈ tham khảo — hệ thống luôn tự tính lại điểm/trạng thái ở máy chủ.'], ['5. Nhập Excel chỉ đưa dữ liệu lên màn hình xem trước, KHÔNG tự ghi chính thức.']];
      var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows), gs = XLSX.utils.aoa_to_sheet(guide);
      ws['!cols'] = [12, 22, 12, 8, 20, 14, 30, 26, 8, 10, 12, 28, 12].map(function (w) { return { wch: w }; });
      gs['!cols'] = [{ wch: 100 }];
      XLSX.utils.book_append_sheet(wb, ws, 'DỮ LIỆU');
      XLSX.utils.book_append_sheet(wb, gs, 'HƯỚNG DẪN');
      XLSX.writeFile(wb, 'PHF_MAU_GHI_NHAN_LOI_LATE_' + todayIso() + '.xlsx', { compression: true });
      return true;
    });
  }

  function readXlsxFile(file) {
    return ensureXlsx().then(function (XLSX) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Không đọc được file.')); };
        reader.onload = function () {
          try {
            var wb = XLSX.read(reader.result, { type: 'array' });
            var sheetName = wb.SheetNames.find(function (n) { return String(n).trim() === 'DỮ LIỆU'; }) || wb.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
            resolve(rows);
          } catch (err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
      });
    });
  }

  /* ============================== Toast tối giản (tự có, không phụ thuộc host) ============================== */
  function toast(root, type, title, message) {
    var host = root.querySelector('[data-phfck-latewf-toast-host]');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'phfck-latewf-toast is-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(message || '') + '</span>';
    host.appendChild(el);
    var timer = setTimeout(function () { el.remove(); }, 6000);
    STORE.timers.push(timer);
  }

  /* ============================== State ============================== */
  function freshState(ctx) {
    return {
      ctx: ctx,
      tab: ctx.isAdmin ? 'recon' : 'record', // ctx không phải admin -> chỉ có "record"
      /* ---- Người có quyền ghi nhận: ghi nhận phát hiện (Trưởng ca chỉ là 1 ví dụ) ---- */
      record: { employeeCode: '', date: todayIso(), managerDecision: '', note: '', saving: false, error: '', savedOk: '' },
      myObservations: { loading: false, loaded: false, error: '', records: [] },
      /* ---- Admin: state machine đối soát BCC (dùng chung cho cả 2 phương thức input) ---- */
      inputMode: 'excel', // 'excel'|'manual' — chỉ chọn NGUỒN dữ liệu nạp vào, KHÔNG rẽ nhánh pipeline
      manualRows: [manualRowDefault()],
      manualError: '',
      fsm: 'idle', // idle|reading|file_error|preview_ready|reconciling|conflict|awaiting_approval|applying|done|error_retry
      fileName: '',
      fileError: '',
      preview: null,       // response previewBccUpload
      importRecord: null,  // response createBccImport .import
      importRows: null,    // response createBccImport .rows (có id thật, importRowKey)
      reconcileActions: null, // response reconcileBccImport (probe row_by_row) .actions
      conflictSummary: null,
      showConflictModal: false,
      diffOpen: false,
      rowDecisions: {},    // importRowKey -> 'keep'|'update'
      selectedRowIds: {},  // importRowId(server id) -> true (chỉ những dòng client coi là sạch)
      rowOverrides: {},    // importRowId -> {appliedPoints,reason}
      approveResults: null, // response approveChecklistLateEvents .results
      inFlight: {},         // actionKey -> true (chặn double-submit)
      exportFilters: { dateFrom: '', dateTo: '', employeeCode: '', department: '', branch: '', managerDecision: '', approvalStatus: '' },
      exportState: 'idle', // idle|loading|done|error|denied
      exportError: ''
    };
  }

  /* ============================== Render chính ============================== */
  function render() {
    if (!STORE.node) return;
    var s = STORE.state;
    var html = '<div class="phfck-latewf" data-phfck-latewf-root>'
      + '<div class="phfck-latewf-toast-host" data-phfck-latewf-toast-host aria-live="polite"></div>'
      + (s.ctx.isAdmin ? adminShellHtml(s) : recordOnlyShellHtml(s))
      + '</div>';
    STORE.node.innerHTML = html;
    bindEvents();
    if (s.ctx.isAdmin) {
      // giữ nguyên toast host cũ nếu có để không mất thông báo đang hiển thị khi re-render nhanh
    }
    afterRender(s);
  }

  function afterRender(s) {
    if (!s.ctx.isAdmin) {
      if (!s.myObservations.loaded && !s.myObservations.loading) loadMyObservations();
    }
  }

  /* ============================== TRƯỞNG CA: Ghi nhận phát hiện đi trễ ============================== */
  function recordOnlyShellHtml(s) {
    return '<section class="phfck-panel phfck-latewf-record" data-phfck-latewf-record-shell>'
      + '<div class="phfck-panel-head"><div><small>ĐI TRỄ</small><h3>Ghi nhận phát hiện đi trễ</h3></div></div>'
      + (s.ctx.canRecord ? recordFormHtml(s) : recordNoPermissionHtml())
      + (s.ctx.canRecord ? recordListHtml(s) : '')
      + '</section>';
  }
  function recordNoPermissionHtml() {
    return '<div class="phfck-notice" data-phfck-latewf-no-permission><b>Không có quyền ghi nhận</b><p>Tài khoản của bạn chưa được cấp quyền ghi nhận đi trễ. Liên hệ Admin để được cấp quyền.</p></div>';
  }
  function recordFormHtml(s) {
    var r = s.record;
    var people = Array.isArray(s.ctx.people) ? s.ctx.people : [];
    return '<form class="phfck-latewf-record-form" data-phfck-latewf-record-form novalidate>'
      + '<label><span>Nhân sự *</span><select data-phfck-latewf-field="employeeCode" required>'
      + '<option value="">Chọn nhân sự…</option>'
      + people.map(function (p) { return '<option value="' + esc(p.code) + '" ' + (r.employeeCode === p.code ? 'selected' : '') + '>' + esc(p.name) + (p.code ? ' · ' + esc(p.code) : '') + (p.department ? ' · ' + esc(p.department) : '') + '</option>'; }).join('')
      + '</select></label>'
      + '<label><span>Ngày *</span><input type="date" data-phfck-latewf-field="date" value="' + esc(r.date) + '" required></label>'
      + '<fieldset class="phfck-latewf-permission-field" data-phfck-latewf-permission-group>'
      + '<legend>Duyệt hay không duyệt? *</legend>'
      + '<label class="phfck-latewf-radio"><input type="radio" name="phfckLateWfPermission" value="approved" data-phfck-latewf-field="managerDecision" ' + (r.managerDecision === 'approved' ? 'checked' : '') + '> Duyệt</label>'
      + '<label class="phfck-latewf-radio"><input type="radio" name="phfckLateWfPermission" value="rejected" data-phfck-latewf-field="managerDecision" ' + (r.managerDecision === 'rejected' ? 'checked' : '') + '> Không duyệt</label>'
      + '</fieldset>'
      + '<label class="phfck-latewf-note"><span>Ghi chú</span><textarea data-phfck-latewf-field="note" placeholder="Mô tả ngắn (không bắt buộc)">' + esc(r.note) + '</textarea></label>'
      + (r.error ? '<div class="phfck-latewf-field-error" role="alert">' + esc(r.error) + '</div>' : '')
      + (r.savedOk ? '<div class="phfck-latewf-field-ok" role="status">' + esc(r.savedOk) + '</div>' : '')
      + '<div class="phfck-latewf-form-actions"><button type="submit" class="phfck-primary" data-phfck-latewf-record-submit ' + (r.saving ? 'disabled' : '') + '>' + (r.saving ? 'Đang lưu…' : 'Ghi nhận') + '</button></div>'
      + '<p class="phfck-latewf-note">Ghi nhận này KHÔNG tạo bản ghi chính thức và KHÔNG trừ điểm — chỉ là căn cứ để Admin đối soát với dữ liệu BCC sau này.</p>'
      + '</form>';
  }
  function recordListHtml(s) {
    var m = s.myObservations;
    if (m.loading) return '<div class="phfck-latewf-loading" role="status">Đang tải danh sách đã ghi nhận…</div>';
    if (m.error) return '<div class="phfck-latewf-error-box" role="alert"><b>Không tải được danh sách</b><p>' + esc(m.error) + '</p><button type="button" class="phfck-secondary" data-phfck-latewf-reload-list>Thử lại</button></div>';
    if (!m.records.length) return '<div class="phfck-latewf-empty">Chưa có ghi nhận nào gần đây.</div>';
    return '<div class="phfck-latewf-record-list"><h4>Đã ghi nhận gần đây</h4><div class="phfck-latewf-record-table">'
      + '<div class="phfck-latewf-record-row phfck-latewf-record-head"><span>Nhân sự</span><span>Ngày</span><span>Xin phép</span><span>Ghi chú</span><span>Trạng thái</span></div>'
      + m.records.map(function (rec) {
        var reconciled = rec.linked_violation_id || rec.matched_official ? 'Đã đối soát' : 'Chưa đối soát';
        return '<div class="phfck-latewf-record-row"><span>' + esc(rec.employee_name || rec.employee_code || '—') + '</span><span>' + esc(rec.occurred_date || '—') + '</span><span>' + (rec.manager_decision === 'approved' ? 'Duyệt' : 'Không duyệt') + '</span><span>' + esc(rec.note || '—') + '</span><span class="phfck-latewf-badge is-neutral">' + esc(reconciled) + '</span></div>';
      }).join('') + '</div></div>';
  }
  function loadMyObservations() {
    var s = STORE.state; if (!s) return;
    s.myObservations.loading = true; s.myObservations.error = '';
    callApi('listChecklistLateManagerObservations', { input: { employeeCode: s.ctx.actorEmployeeCode ? '' : '' } })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.myObservations.records = Array.isArray(data.records) ? data.records : [];
        s.myObservations.loaded = true; s.myObservations.loading = false;
        render();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.myObservations.loading = false; s.myObservations.loaded = true;
        s.myObservations.error = err && err.message || 'Không xác định.';
        render();
      });
  }
  function isCurrent(s) { return STORE.state === s; }

  function handleRecordSubmit(form) {
    var s = STORE.state, r = s.record;
    if (!r.employeeCode) { r.error = 'Vui lòng chọn nhân sự.'; render(); return; }
    if (!r.date) { r.error = 'Vui lòng chọn ngày.'; render(); return; }
    if (r.managerDecision !== 'approved' && r.managerDecision !== 'rejected') {
      r.error = 'Vui lòng chọn Duyệt hoặc Không duyệt.'; render(); return;
    }
    if (r.saving || STORE.state.inFlight.recordSubmit) return;
    r.error = ''; r.savedOk = ''; r.saving = true; STORE.state.inFlight.recordSubmit = true;
    render();
    callApi('recordChecklistLateManagerObservation', { input: { employeeCode: r.employeeCode, occurredDate: r.date, managerDecision: r.managerDecision, note: r.note } })
      .then(function () {
        if (!isCurrent(s)) return;
        r.saving = false; STORE.state.inFlight.recordSubmit = false;
        r.savedOk = 'Đã ghi nhận thành công.'; r.note = ''; r.managerDecision = ''; r.employeeCode = '';
        s.myObservations.loaded = false;
        render();
        loadMyObservations();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        r.saving = false; STORE.state.inFlight.recordSubmit = false;
        r.error = (err && err.permissionDenied) ? 'Bạn không có quyền ghi nhận cho nhân sự này (ngoài phạm vi được cấp).' : (err && err.message || 'Không thể ghi nhận. Vui lòng thử lại.');
        render();
      });
  }

  /* ============================== ADMIN: Đối soát BCC + Nhập thủ công (mount) ============================== */
  function adminShellHtml(s) {
    return '<section class="phfck-panel phfck-latewf-admin" data-phfck-latewf-admin-shell>'
      + adminStepsHtml(s)
      + adminBodyHtml(s)
      + (s.showConflictModal ? conflictModalHtml(s) : '')
      + '</section>';
  }
  var STEP_ORDER = ['upload', 'check', 'reconcile', 'review', 'approve'];
  var STEP_LABEL = { upload: 'Nhập file', check: 'Kiểm tra dữ liệu', reconcile: 'Đối soát', review: 'Xem lại', approve: 'Phê duyệt' };
  function currentStepKey(s) {
    if (s.fsm === 'idle' || s.fsm === 'reading' || s.fsm === 'file_error') return 'upload';
    if (s.fsm === 'preview_ready') return 'check';
    if (s.fsm === 'reconciling' || s.fsm === 'conflict') return 'reconcile';
    if (s.fsm === 'awaiting_approval') return 'review';
    if (s.fsm === 'applying' || s.fsm === 'done' || s.fsm === 'error_retry') return 'approve';
    return 'upload';
  }
  function adminStepsHtml(s) {
    var active = currentStepKey(s), activeIdx = STEP_ORDER.indexOf(active);
    return '<ol class="phfck-latewf-steps" aria-label="Các bước đối soát Đi trễ">' + STEP_ORDER.map(function (key, idx) {
      var cls = key === active ? 'is-active' : (idx < activeIdx ? 'is-done' : '');
      return '<li class="' + cls + '"><span>' + (idx + 1) + '</span><b>' + esc(STEP_LABEL[key]) + '</b></li>';
    }).join('') + '</ol>';
  }
  function adminBodyHtml(s) {
    var pieces = [];
    pieces.push(inputModeSelectorHtml(s));
    pieces.push(s.inputMode === 'manual' ? manualEntryCardHtml(s) : uploadCardHtml(s));
    if (s.preview) pieces.push(previewCardHtml(s));
    if (s.fsm === 'awaiting_approval' || s.fsm === 'applying' || s.fsm === 'done' || s.fsm === 'error_retry') pieces.push(reconciliationTableCardHtml(s));
    pieces.push(exportCardHtml(s));
    return pieces.join('');
  }

  /* inputModeSelectorHtml: chọn NGUỒN nạp dữ liệu — "Nhập trực tiếp" và "Nhập Excel" đều chỉ
     là 2 cách tạo ra rows[] rồi gọi ĐÚNG 1 previewChecklistLateBccUpload (xem handleFileSelected
     và handleManualPreview) — không có pipeline/API riêng cho từng phương thức. */
  function inputModeSelectorHtml(s) {
    return '<div class="phfck-latewf-input-mode" role="tablist" aria-label="Phương thức nhập dữ liệu Đi trễ">'
      + '<button type="button" role="tab" aria-selected="' + (s.inputMode === 'manual' ? 'false' : 'true') + '" class="' + (s.inputMode === 'manual' ? '' : 'is-active') + '" data-phfck-latewf-input-mode="excel">Nhập Excel</button>'
      + '<button type="button" role="tab" aria-selected="' + (s.inputMode === 'manual' ? 'true' : 'false') + '" class="' + (s.inputMode === 'manual' ? 'is-active' : '') + '" data-phfck-latewf-input-mode="manual">Nhập trực tiếp</button>'
      + '</div>';
  }

  function manualRowHtml(row, index, people) {
    return '<div class="phfck-latewf-manual-row" data-phfck-latewf-manual-row="' + esc(row.id) + '">'
      + '<div class="phfck-latewf-manual-no">' + String(index + 1).padStart(2, '0') + '</div>'
      + '<label><span>Nhân sự *</span><select data-phfck-latewf-manual-field="employeeCode" data-phfck-latewf-manual-row-id="' + esc(row.id) + '"><option value="">Chọn nhân sự…</option>'
        + people.map(function (p) { return '<option value="' + esc(p.code) + '" ' + (row.employeeCode === p.code ? 'selected' : '') + '>' + esc(p.name) + (p.code ? ' · ' + esc(p.code) : '') + '</option>'; }).join('')
      + '</select></label>'
      + '<label><span>Ngày *</span><input type="date" data-phfck-latewf-manual-field="date" data-phfck-latewf-manual-row-id="' + esc(row.id) + '" value="' + esc(row.date) + '"></label>'
      + '<label><span>Giờ</span><input type="time" data-phfck-latewf-manual-field="time" data-phfck-latewf-manual-row-id="' + esc(row.id) + '" value="' + esc(row.time) + '"></label>'
      + '<label><span>Ca làm</span><select data-phfck-latewf-manual-field="shift" data-phfck-latewf-manual-row-id="' + esc(row.id) + '"><option value="">— Chọn ca —</option>'
        + MANUAL_SHIFT_OPTIONS.map(function (sh) { return '<option value="' + esc(sh) + '" ' + (row.shift === sh ? 'selected' : '') + '>' + esc(sh) + '</option>'; }).join('')
      + '</select></label>'
      + '<label><span>Phút trễ *</span><input type="number" min="0" step="1" data-phfck-latewf-manual-field="minutes" data-phfck-latewf-manual-row-id="' + esc(row.id) + '" value="' + esc(row.minutes) + '"></label>'
      + '<label class="phfck-latewf-manual-note"><span>Ghi chú</span><input type="text" data-phfck-latewf-manual-field="note" data-phfck-latewf-manual-row-id="' + esc(row.id) + '" value="' + esc(row.note) + '" placeholder="Không bắt buộc"></label>'
      + '<button type="button" class="phfck-latewf-manual-remove" data-phfck-latewf-manual-remove="' + esc(row.id) + '" aria-label="Xóa dòng">×</button>'
      + '</div>';
  }

  /* manualEntryCardHtml: KHÔNG có ô Điểm — điểm luôn do server tính lại ở bước Kiểm tra dữ liệu
     (previewChecklistLateBccUpload), không nhận số Admin gõ tay làm căn cứ, đúng invariant đã
     chốt ("không mang points làm source of truth"). */
  function manualEntryCardHtml(s) {
    var people = Array.isArray(s.ctx.people) ? s.ctx.people : [];
    var rows = s.manualRows || [];
    return '<div class="phfck-latewf-card" data-phfck-latewf-manual-card>'
      + '<div class="phfck-panel-head"><div><small>BƯỚC 1–2</small><h4>Nhập trực tiếp danh sách đi trễ</h4></div></div>'
      + '<div class="phfck-latewf-manual-list" data-phfck-latewf-manual-list>' + rows.map(function (row, index) { return manualRowHtml(row, index, people); }).join('') + '</div>'
      + '<div class="phfck-latewf-manual-actions"><button type="button" class="phfck-secondary" data-phfck-latewf-manual-add>＋ Thêm dòng</button></div>'
      + (s.manualError ? '<div class="phfck-latewf-error-box" role="alert"><b>Chưa thể xem trước</b><p>' + esc(s.manualError) + '</p></div>' : '')
      + '<p class="phfck-latewf-note">Không nhập điểm ở bước này — hệ thống luôn tự tính điểm gợi ý ở bước Kiểm tra dữ liệu, không dùng số Admin gõ tay làm căn cứ chính thức.</p>'
      + '<div class="phfck-latewf-form-actions"><button type="button" class="phfck-primary" data-phfck-latewf-manual-preview ' + (s.inFlight.manualPreview ? 'disabled' : '') + '>' + (s.inFlight.manualPreview ? 'Đang kiểm tra…' : 'Xem trước') + '</button></div>'
      + '</div>';
  }

  function uploadCardHtml(s) {
    var busy = s.fsm === 'reading';
    return '<div class="phfck-latewf-card" data-phfck-latewf-upload-card>'
      + '<div class="phfck-panel-head"><div><small>BƯỚC 1–2</small><h4>Nhập file BCC</h4></div></div>'
      + '<div class="phfck-latewf-upload-row">'
      + '<button type="button" class="phfck-secondary" data-phfck-latewf-download-template ' + (s.inFlight.template ? 'disabled' : '') + '>⇩ Tải file mẫu</button>'
      + '<button type="button" class="phfck-primary" data-phfck-latewf-choose-file ' + (busy ? 'disabled' : '') + '>⇧ Nhập Excel</button>'
      + '<input type="file" accept=".xlsx,.xls" data-phfck-latewf-file-input hidden>'
      + (s.fileName ? '<span class="phfck-latewf-filename">' + esc(s.fileName) + '</span>' : '')
      + '</div>'
      + (busy ? '<div class="phfck-latewf-loading" role="status" aria-live="polite">Đang đọc dữ liệu…</div>' : '')
      + (s.fsm === 'file_error' ? '<div class="phfck-latewf-error-box" role="alert"><b>Không đọc được file</b><p>' + esc(s.fileError) + '</p></div>' : '')
      + '</div>';
  }

  function previewCardHtml(s) {
    var p = s.preview;
    var cr = p.columnReport || {};
    return '<div class="phfck-latewf-card" data-phfck-latewf-preview-card>'
      + '<div class="phfck-panel-head"><div><small>BƯỚC 2</small><h4>Kết quả kiểm tra dữ liệu</h4></div></div>'
      + '<div class="phfck-latewf-column-report">'
      + '<div><b>Cột nhận diện được (' + (cr.recognizedColumns || []).length + ')</b><span>' + (cr.recognizedColumns || []).map(esc).join(', ') + '</span></div>'
      + (cr.missingColumns && cr.missingColumns.length ? '<div class="is-warn"><b>Cột thiếu</b><span>' + cr.missingColumns.map(esc).join(', ') + '</span></div>' : '')
      + (cr.extraColumns && cr.extraColumns.length ? '<div class="is-info"><b>Cột thừa (bỏ qua)</b><span>' + cr.extraColumns.map(esc).join(', ') + '</span></div>' : '')
      + '</div>'
      + '<div class="phfck-latewf-preview-summary"><span>' + Number(p.totalRows || 0) + ' dòng hợp lệ</span><span>' + Number(p.invalidRowCount || 0) + ' dòng lỗi</span><span>' + Number(p.unknownEmployeeRowCount || 0) + ' dòng ngoài phạm vi</span><span>' + Number(p.alreadyOfficialCount || 0) + ' dòng đã chính thức</span></div>'
      + (p.invalidRows && p.invalidRows.length ? '<div class="phfck-latewf-invalid-rows" data-phfck-latewf-invalid-rows><b>Dòng bị loại</b><ul>' + p.invalidRows.map(function (r) { return '<li>Dòng Excel #' + esc(r.excelRowNumber) + ': ' + esc((r.reasons || []).join(' ')) + '</li>'; }).join('') + '</ul></div>' : '')
      + (p.unknownEmployeeRows && p.unknownEmployeeRows.length ? '<div class="phfck-latewf-invalid-rows" data-phfck-latewf-unknown-rows><b>Mã nhân viên ngoài phạm vi</b><ul>' + p.unknownEmployeeRows.map(function (r) { return '<li>Dòng Excel #' + esc(r.excelRowNumber) + ': ' + esc(r.employeeCode) + '</li>'; }).join('') + '</ul></div>' : '')
      + lateBandTableHtml()
      + '<div class="phfck-latewf-form-actions"><button type="button" class="phfck-primary" data-phfck-latewf-start-reconcile ' + (s.inFlight.createImport ? 'disabled' : '') + '>' + (s.inFlight.createImport ? 'Đang lưu…' : 'Lưu & Đối soát') + '</button></div>'
      + '</div>';
  }

  function badgeForRowStatus(status) {
    var MAP = {
      pending_approval: ['is-neutral', '◷', 'Chờ duyệt'],
      needs_review: ['is-warn', '⚠', 'Cần đối chiếu'],
      applied: ['is-ok', '✓', 'Đã áp dụng'],
      not_applied: ['is-off', '—', 'Không áp dụng'],
      unchanged: ['is-neutral', '=', 'Không thay đổi'],
      changed: ['is-warn', '≠', 'Dữ liệu thay đổi'],
      error: ['is-error', '!', 'Lỗi']
    };
    var m = MAP[status] || ['is-neutral', '?', status || 'Mới'];
    return '<span class="phfck-latewf-badge ' + m[0] + '" role="status" aria-label="Trạng thái: ' + esc(m[2]) + '"><i aria-hidden="true">' + m[1] + '</i>' + esc(m[2]) + '</span>';
  }

  function reconciliationTableCardHtml(s) {
    var rows = s.importRows || [];
    var results = s.approveResults;
    return '<div class="phfck-latewf-card" data-phfck-latewf-recon-table-card>'
      + '<div class="phfck-panel-head"><div><small>BƯỚC 3–4</small><h4>Bảng đối soát</h4></div>'
      + (LATE_APPROVAL_UI_ENABLED
        ? ('<div class="phfck-latewf-bulk-actions"><button type="button" class="phfck-secondary" data-phfck-latewf-select-clean>Chọn dòng sạch</button><button type="button" class="phfck-primary" data-phfck-latewf-bulk-approve ' + (s.inFlight.approve ? 'disabled' : '') + '>' + (s.inFlight.approve ? 'Đang áp dụng…' : 'Phê duyệt &amp; ghi nhận (đã chọn)') + '</button></div>')
        : '')
      + '</div>'
      + '<div class="phfck-latewf-table-scroll"><table class="phfck-latewf-recon-table">'
      + '<thead><tr>'
      + (LATE_APPROVAL_UI_ENABLED ? '<th></th>' : '')
      + '<th>Nhân sự</th><th>Phòng ban/CN</th><th>Ngày/ca/giờ</th><th>Phút trễ</th><th>Ghi nhận từ bộ phận</th><th>Kết quả khớp</th><th>Cảnh báo tần suất</th><th>Điểm gợi ý</th>'
      + (LATE_APPROVAL_UI_ENABLED ? '<th>Điểm áp dụng</th><th>Lý do</th>' : '')
      + '<th>Trạng thái</th>'
      + (LATE_APPROVAL_UI_ENABLED ? '<th>Hành động</th>' : '')
      + '</tr></thead>'
      + '<tbody>' + rows.map(function (row) { return reconciliationRowHtml(s, row, results); }).join('') + '</tbody>'
      + '</table></div>'
      + '<div class="phfck-latewf-cards-mobile" aria-hidden="true">' + rows.map(function (row) { return reconciliationCardHtml(s, row, results); }).join('') + '</div>'
      + '</div>';
  }
  function rowResultFor(results, importRowId) {
    if (!results) return null;
    return results.find(function (r) { return String(r.importRowId) === String(importRowId); }) || null;
  }
  /* businessStatusLabel: gộp match_status (chi tiết kỹ thuật — vẫn giữ nguyên trong data model
     để audit, xem lib/checklist-late-reconciliation.js) thành ĐÚNG 4 nhãn nghiệp vụ Admin nhìn
     thấy: Duyệt / Không duyệt / Chưa ghi nhận / Cần kiểm tra (brief 2026-08-15). 2 lý do kỹ
     thuật khác nhau của "cần xem lại" (ambiguous_needs_review — thiếu định danh sự kiện;
     conflict_needs_review — nhiều người ghi nhận mâu thuẫn) GỘP LÀM MỘT nhãn "Cần kiểm tra" ở
     đây — Admin không cần phân biệt 2 lý do này qua nhãn, chi tiết vẫn xem được ở cột "Ghi nhận
     từ bộ phận" (recorderCellHtml) khi cần. */
  function businessStatusLabel(row) {
    if (row.match_status === 'ambiguous_needs_review' || row.match_status === 'conflict_needs_review') return 'Cần kiểm tra';
    if (row.match_status === 'unmatched_default_no_permission') return 'Chưa ghi nhận';
    return row.manager_decision_suggested === 'approved' ? 'Duyệt' : 'Không duyệt';
  }
  /* recorderCellHtml: hiển thị TỪNG người đã ghi nhận sự kiện này (audit trail thật, không chỉ
     kết quả gộp) — cùng cơ chế dù người ghi nhận là Trưởng ca, Trưởng bộ phận, hay vai trò khác.
     Đây là chi tiết audit (không phải nhãn trạng thái tổng hợp) nên KHÔNG bị gộp vào 4 nhãn
     nghiệp vụ ở businessStatusLabel() — Admin cần xem từng người đã ghi Duyệt/Không duyệt gì. */
  function recorderCellHtml(row) {
    var recorders = Array.isArray(row.recorders_snapshot) ? row.recorders_snapshot : [];
    if (row.match_status === 'conflict_needs_review') {
      if (!recorders.length) return 'Cần kiểm tra';
      return '<div class="phfck-latewf-conflict-recorders">' + recorders.map(function (rc) {
        return '<div>' + esc(rc.recordedByName || rc.recordedBy || '—') + (rc.recorderDepartment ? (' · ' + esc(rc.recorderDepartment)) : '')
          + ': <b>' + ((rc.managerDecision || rc.permissionStatus) === 'approved' ? 'Duyệt' : 'Không duyệt') + '</b></div>';
      }).join('') + '</div>';
    }
    if (row.match_status === 'matched_agreed') {
      return (row.manager_decision_suggested === 'approved' ? 'Duyệt' : 'Không duyệt') + ' <small>(khớp ' + recorders.length + ' người ghi nhận)</small>';
    }
    return row.manager_decision_suggested === 'approved' ? 'Duyệt' : (row.match_status === 'unmatched_default_no_permission' ? 'Không có ghi nhận' : 'Không duyệt');
  }
  function reconciliationRowHtml(s, row, results) {
    var id = row.id;
    var res = rowResultFor(results, id);
    var status = res ? (res.applied ? 'applied' : (res.skipped ? 'needs_review' : 'not_applied')) : (row.row_status || 'pending_approval');
    var override = s.rowOverrides[id] || {};
    var checked = !!s.selectedRowIds[id];
    var freq = row.frequency_reference_snapshot || {};
    var isConflict = row.match_status === 'conflict_needs_review';
    return '<tr data-phfck-latewf-row="' + esc(id) + '" ' + (isConflict ? 'class="is-conflict"' : '') + '>'
      + (LATE_APPROVAL_UI_ENABLED ? ('<td><input type="checkbox" data-phfck-latewf-row-check="' + esc(id) + '" ' + (checked ? 'checked' : '') + ' aria-label="Chọn dòng"></td>') : '')
      + '<td>' + esc(row.employee_code) + '</td>'
      + '<td>' + esc(row.department || '') + (row.branch ? ' / ' + esc(row.branch) : '') + '</td>'
      + '<td>' + esc(row.occurred_date) + (row.shift ? ' · ' + esc(row.shift) : '') + (row.checkin_time ? ' · ' + esc(row.checkin_time) : '') + '</td>'
      + '<td>' + esc(formatLateMinutesDisplay(row.minutes_late)) + '</td>'
      + '<td>' + recorderCellHtml(row) + '</td>'
      + '<td>' + esc(businessStatusLabel(row)) + '</td>'
      + '<td>' + (freq.overThreshold ? '<span class="phfck-latewf-freqwarn" title="' + esc(freq.message) + '">Cảnh báo tham chiếu</span>' : '—') + '</td>'
      + '<td>' + (isConflict ? 'Cần kiểm tra' : (fmtPoints(row.suggested_points) + ' điểm')) + '</td>'
      + (LATE_APPROVAL_UI_ENABLED ? (
        '<td><input type="number" min="0" max="100" step="1" data-phfck-latewf-applied-points="' + esc(id) + '" value="' + esc(override.appliedPoints != null ? override.appliedPoints : row.suggested_points) + '"></td>'
        + '<td>'
        + (isConflict ? ('<select data-phfck-latewf-resolve="' + esc(id) + '"><option value="">Chọn kết luận…</option>'
          + '<option value="approved" ' + (override.resolvedManagerDecision === 'approved' ? 'selected' : '') + '>Duyệt</option>'
          + '<option value="rejected" ' + (override.resolvedManagerDecision === 'rejected' ? 'selected' : '') + '>Không duyệt</option>'
          + '</select>') : '')
        + '<input type="text" data-phfck-latewf-row-reason="' + esc(id) + '" placeholder="' + (isConflict ? 'Bắt buộc — lý do kết luận Cần đối chiếu' : 'Bắt buộc nếu khác điểm gợi ý') + '" value="' + esc(override.reason || '') + '"></td>'
      ) : '')
      + '<td>' + badgeForRowStatus(status) + (res && res.skipped ? '<div class="phfck-latewf-row-note">' + esc(res.reason || '') + '</div>' : '') + '</td>'
      + (LATE_APPROVAL_UI_ENABLED ? (
        '<td><button type="button" class="phfck-secondary" data-phfck-latewf-approve-one="' + esc(id) + '" ' + (s.inFlight['approve_' + id] ? 'disabled' : '') + '>Duyệt dòng này</button>'
        + (row.linked_violation_id ? '<button type="button" class="phfck-secondary" data-phfck-latewf-adjust="' + esc(id) + '">Điều chỉnh (audit)</button>' : '')
        + '</td>'
      ) : '')
      + '</tr>';
  }
  function reconciliationCardHtml(s, row, results) {
    var id = row.id, res = rowResultFor(results, id);
    var status = res ? (res.applied ? 'applied' : (res.skipped ? 'needs_review' : 'not_applied')) : (row.row_status || 'pending_approval');
    return '<article class="phfck-latewf-recon-card"><header><b>' + esc(row.employee_code) + '</b>' + badgeForRowStatus(status) + '</header>'
      + '<p>' + esc(row.occurred_date) + ' · ' + esc(formatLateMinutesDisplay(row.minutes_late)) + ' phút · Gợi ý ' + fmtPoints(row.suggested_points) + ' điểm</p></article>';
  }

  function exportCardHtml(s) {
    var f = s.exportFilters;
    return '<div class="phfck-latewf-card" data-phfck-latewf-export-card>'
      + '<div class="phfck-panel-head"><div><small>XUẤT DỮ LIỆU</small><h4>Xuất Excel đối soát Đi trễ</h4></div></div>'
      + '<div class="phfck-latewf-export-filters">'
      + '<label><span>Từ ngày</span><input type="date" data-phfck-latewf-export-field="dateFrom" value="' + esc(f.dateFrom) + '"></label>'
      + '<label><span>Đến ngày</span><input type="date" data-phfck-latewf-export-field="dateTo" value="' + esc(f.dateTo) + '"></label>'
      + '<label><span>Mã nhân viên</span><input type="text" data-phfck-latewf-export-field="employeeCode" value="' + esc(f.employeeCode) + '"></label>'
      + '</div>'
      + '<div class="phfck-latewf-form-actions"><button type="button" class="phfck-primary" data-phfck-latewf-export-run ' + (s.exportState === 'loading' ? 'disabled' : '') + '>' + (s.exportState === 'loading' ? 'Đang xuất…' : '⇩ Xuất Excel') + '</button></div>'
      + (s.exportState === 'error' ? '<div class="phfck-latewf-error-box" role="alert"><b>Không xuất được</b><p>' + esc(s.exportError) + '</p></div>' : '')
      + (s.exportState === 'denied' ? '<div class="phfck-latewf-error-box" role="alert"><b>Không đủ quyền xuất dữ liệu</b><p>' + esc(s.exportError) + '</p></div>' : '')
      + (s.exportState === 'done' ? '<div class="phfck-latewf-field-ok" role="status">Đã xuất thành công.</div>' : '')
      + '</div>';
  }

  function conflictModalHtml(s) {
    var c = s.conflictSummary || { fresh: 0, identical: 0, changed: 0, official: 0, dateFrom: '', dateTo: '' };
    if (s.diffOpen) return diffModalHtml(s);
    return '<div class="phfck-latewf-modal-layer" data-phfck-modal-layer data-phfck-latewf-conflict-modal role="presentation">'
      + '<div class="phfck-latewf-modal" role="dialog" aria-modal="true" aria-labelledby="phfckLateWfConflictTitle">'
      + '<div class="phfck-modal-head"><div><small>ĐỐI SOÁT TRÙNG DỮ LIỆU</small><h2 id="phfckLateWfConflictTitle">Phát hiện dữ liệu trùng khoảng ngày</h2></div><button type="button" data-phfck-latewf-conflict-close aria-label="Đóng">×</button></div>'
      + '<div class="phfck-modal-body">'
      + '<div class="phfck-latewf-conflict-summary"><div><small>Dòng mới</small><b>' + c.fresh + '</b></div><div><small>Trùng hoàn toàn</small><b>' + c.identical + '</b></div><div><small>Có thay đổi</small><b>' + c.changed + '</b></div><div><small>Đã chính thức</small><b>' + c.official + '</b></div></div>'
      + '<p>Khoảng ngày ảnh hưởng: ' + esc(c.dateFrom || '—') + ' → ' + esc(c.dateTo || '—') + '</p>'
      + (c.official > 0 ? '<p class="phfck-latewf-note"><b>Lưu ý:</b> các dòng đã chính thức KHÔNG BAO GIỜ bị ghi đè tại chỗ — mọi thay đổi sẽ tạo điều chỉnh có audit (hủy bản cũ + ghi bản mới liên kết), không sửa trực tiếp.</p>' : '')
      + '</div>'
      + '<div class="phfck-modal-foot">'
      + '<button type="button" class="phfck-secondary" data-phfck-latewf-conflict-choice="keep_old" ' + (s.inFlight.reconcile ? 'disabled' : '') + '>Giữ dữ liệu cũ</button>'
      + '<button type="button" class="phfck-secondary" data-phfck-latewf-conflict-choice="update_newest" ' + (s.inFlight.reconcile ? 'disabled' : '') + '>Cập nhật bản mới nhất</button>'
      + '<button type="button" class="phfck-primary" data-phfck-latewf-conflict-diff>Xem đối chiếu</button>'
      + '</div></div></div>';
  }
  function diffModalHtml(s) {
    var actions = (s.reconcileActions || []).filter(function (a) { return a.type === 'await_decision' || a.type === 'create_linked_adjustment'; });
    return '<div class="phfck-latewf-modal-layer" data-phfck-modal-layer data-phfck-latewf-diff-modal role="presentation">'
      + '<div class="phfck-latewf-modal phfck-latewf-modal-lg" role="dialog" aria-modal="true" aria-labelledby="phfckLateWfDiffTitle">'
      + '<div class="phfck-modal-head"><div><small>ĐỐI CHIẾU TỪNG DÒNG</small><h2 id="phfckLateWfDiffTitle">So sánh dữ liệu cũ và mới</h2></div><button type="button" data-phfck-latewf-diff-close aria-label="Đóng">×</button></div>'
      + '<div class="phfck-modal-body"><div class="phfck-latewf-table-scroll"><table class="phfck-latewf-diff-table"><thead><tr><th>Ngày/ca/giờ</th><th>Phút trễ (cũ → mới)</th><th>Xin phép</th><th>Điểm/Trạng thái</th><th>Quyết định</th></tr></thead><tbody>'
      + actions.map(function (a) {
        var oldRow = a.existing && a.existing.row || {}, newRow = a.row || {};
        var isOfficial = a.type === 'create_linked_adjustment';
        return '<tr><td>' + esc(newRow.occurredDate || '') + ' · ' + esc(newRow.shift || '') + ' · ' + esc(newRow.checkinTime || '') + '</td>'
          + '<td>' + esc(formatLateMinutesDisplay(oldRow.minutesLate)) + ' → ' + esc(formatLateMinutesDisplay(newRow.minutesLate)) + '</td>'
          + '<td>—</td>'
          + '<td>' + (isOfficial ? 'Đã chính thức — sẽ tạo điều chỉnh có audit (không ghi đè)' : 'Chưa chính thức') + '</td>'
          + '<td>' + (isOfficial
            ? '<span class="phfck-latewf-badge is-neutral">Tạo điều chỉnh có audit</span>'
            : ('<label><input type="radio" name="phfckLateWfRowDecision-' + esc(a.importRowKey) + '" value="keep" data-phfck-latewf-row-decision="' + esc(a.importRowKey) + '" ' + (s.rowDecisions[a.importRowKey] === 'keep' ? 'checked' : '') + '> Giữ cũ</label>'
              + '<label><input type="radio" name="phfckLateWfRowDecision-' + esc(a.importRowKey) + '" value="update" data-phfck-latewf-row-decision="' + esc(a.importRowKey) + '" ' + (s.rowDecisions[a.importRowKey] === 'update' ? 'checked' : '') + '> Cập nhật mới</label>'))
          + '</td></tr>';
      }).join('') + '</tbody></table></div></div>'
      + '<div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-latewf-diff-back>Quay lại</button><button type="button" class="phfck-primary" data-phfck-latewf-conflict-choice="row_by_row" ' + (s.inFlight.reconcile ? 'disabled' : '') + '>Áp dụng theo từng dòng đã chọn</button></div>'
      + '</div></div>';
  }

  /* ============================== Admin: hành vi ============================== */
  function setFsm(next) { STORE.state.fsm = next; }

  function handleChooseFile() {
    var input = STORE.node.querySelector('[data-phfck-latewf-file-input]');
    if (input) input.click();
  }
  function handleFileSelected(file) {
    var s = STORE.state;
    if (!file) return;
    s.fileName = file.name; s.fileError = '';
    setFsm('reading'); render();
    readXlsxFile(file).then(function (rows) {
      if (!isCurrent(s)) return;
      return callApi('previewChecklistLateBccUpload', { rows: rows }).then(function (data) {
        if (!isCurrent(s)) return;
        s.preview = data;
        s.importRecord = null; s.importRows = null; s.reconcileActions = null; s.approveResults = null;
        setFsm('preview_ready'); render();
      });
    }).catch(function (err) {
      if (!isCurrent(s)) return;
      s.fileError = err && err.message || 'Không đọc được file.';
      setFsm('file_error'); render();
    });
  }

  function handleInputModeChange(mode) {
    var s = STORE.state;
    if (s.inputMode === mode) return;
    s.inputMode = mode; s.manualError = '';
    // Đổi phương thức nạp = bắt đầu lại từ bước Nhập dữ liệu — preview/staging của phương thức
    // trước (nếu có) thuộc về input khác, không mang sang để tránh lẫn dữ liệu 2 nguồn.
    s.preview = null; s.fileName = ''; s.fileError = '';
    s.importRecord = null; s.importRows = null; s.reconcileActions = null; s.approveResults = null;
    setFsm('idle'); render();
  }
  function handleManualAdd() {
    var s = STORE.state;
    s.manualRows = s.manualRows || [];
    s.manualRows.push(manualRowDefault());
    render();
  }
  function handleManualRemove(id) {
    var s = STORE.state;
    s.manualRows = (s.manualRows || []).filter(function (r) { return r.id !== id; });
    if (!s.manualRows.length) s.manualRows.push(manualRowDefault());
    render();
  }
  function manualFieldSet(rowId, field, value) {
    var s = STORE.state;
    var row = (s.manualRows || []).find(function (r) { return r.id === rowId; });
    if (row) row[field] = value;
  }
  function validateManualRows(rows) {
    var errors = [];
    (rows || []).forEach(function (r, index) {
      var n = index + 1;
      if (!t(r.employeeCode)) errors.push('Dòng ' + n + ': chưa chọn nhân sự.');
      if (!t(r.date)) errors.push('Dòng ' + n + ': thiếu ngày.');
      var minutes = Number(r.minutes);
      if (t(r.minutes) === '' || !Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < 0) errors.push('Dòng ' + n + ': số phút trễ phải là số nguyên ≥ 0.');
    });
    return errors;
  }
  /* manualRowsToApiRows: build ĐÚNG object key tiếng Việt mà parseBccExcelRows() ở server đang
     đọc (EXCEL_COLUMNS) — đây là điểm hội tụ với Excel: previewChecklistLateBccUpload không
     phân biệt object đến từ đọc file hay gõ tay, miễn đúng shape này. */
  function manualRowsToApiRows(rows, people) {
    var byCode = {};
    (people || []).forEach(function (p) { byCode[p.code] = p; });
    return (rows || []).map(function (r) {
      return {
        'Mã nhân viên': r.employeeCode,
        'Họ tên': (byCode[r.employeeCode] || {}).name || '',
        'Ngày': r.date,
        'Giờ': r.time,
        'Địa điểm': '',
        'Mã tiêu chí': '',
        'Nội dung tiêu chí': '',
        'Nhận xét': r.note,
        'Điểm': '',
        'Phút trễ': r.minutes,
        'Ca làm': r.shift,
        'Lý do điều chỉnh': '',
        'Trạng thái': ''
      };
    });
  }
  function handleManualPreview() {
    var s = STORE.state;
    if (s.inFlight.manualPreview) return;
    var errors = validateManualRows(s.manualRows);
    if (errors.length) { s.manualError = errors.join(' '); render(); return; }
    s.manualError = ''; s.inFlight.manualPreview = true; render();
    var apiRows = manualRowsToApiRows(s.manualRows, s.ctx.people);
    // source:'MANUAL' đi kèm NGAY trong request preview — server (previewBccUpload) dùng giá
    // trị này TRƯỚC khi tính buildEventIdentity()/buildImportRowKey()/computeSuggestion(), nên
    // identity/importRowKey trả về đã phản ánh đúng MANUAL ngay từ đầu. KHÔNG được sửa lại
    // row.source ở client sau khi nhận response — làm vậy sẽ lệch khỏi identity/key đã bake.
    callApi('previewChecklistLateBccUpload', { rows: apiRows, source: 'MANUAL' }).then(function (data) {
      if (!isCurrent(s)) return;
      s.inFlight.manualPreview = false;
      s.fileName = ''; s.preview = data;
      s.importRecord = null; s.importRows = null; s.reconcileActions = null; s.approveResults = null;
      setFsm('preview_ready'); render();
    }).catch(function (err) {
      if (!isCurrent(s)) return;
      s.inFlight.manualPreview = false;
      s.manualError = err && err.message || 'Không kiểm tra được dữ liệu.';
      render();
    });
  }

  function handleStartReconcile() {
    var s = STORE.state;
    if (s.inFlight.createImport || !s.preview) return;
    s.inFlight.createImport = true; render();
    callApi('createChecklistLateBccImport', { input: { fileName: s.fileName, previewRows: s.preview.preview } })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.inFlight.createImport = false;
        s.importRecord = data.import; s.importRows = data.rows;
        setFsm('reconciling'); render();
        return probeReconcile();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.inFlight.createImport = false;
        setFsm('error_retry'); toast(STORE.node, 'error', 'Không lưu được lượt tải', err && err.message || ''); render();
      });
  }

  /* probeReconcile: gọi reconcileBccImport với choice='row_by_row' — lựa chọn AN TOÀN NHẤT
     (không tự ghi đè bất kỳ dòng changed nào khi chưa có quyết định), dùng để LẤY phân loại
     thật (new/identical/changed/official) do server tính, tránh tự suy đoán ở trình duyệt. */
  function probeReconcile() {
    var s = STORE.state;
    if (s.inFlight.reconcile) return;
    s.inFlight.reconcile = true;
    return callApi('reconcileChecklistLateBccImport', { input: { importId: s.importRecord.id, choice: 'row_by_row', rowDecisions: {} } })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.inFlight.reconcile = false;
        s.reconcileActions = data.actions || [];
        var official = s.reconcileActions.filter(function (a) { return a.type === 'create_linked_adjustment'; }).length;
        var changed = s.reconcileActions.filter(function (a) { return a.type === 'await_decision'; }).length;
        var fresh = s.reconcileActions.filter(function (a) { return a.type === 'create_draft'; }).length;
        var identical = s.reconcileActions.filter(function (a) { return a.type === 'no_op'; }).length;
        var dates = (s.importRows || []).map(function (r) { return r.occurred_date; }).filter(Boolean).sort();
        s.conflictSummary = { fresh: fresh, identical: identical, changed: changed, official: official, dateFrom: dates[0] || '', dateTo: dates[dates.length - 1] || '' };
        if (official > 0 || changed > 0) {
          s.showConflictModal = true; setFsm('conflict');
        } else {
          setFsm('awaiting_approval'); preselectCleanRows();
        }
        render();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.inFlight.reconcile = false;
        setFsm('error_retry'); toast(STORE.node, 'error', 'Không đối soát được', err && err.message || ''); render();
      });
  }

  function handleConflictChoice(choice) {
    var s = STORE.state;
    if (s.inFlight.reconcile) return;
    s.inFlight.reconcile = true; render();
    var rowDecisions = choice === 'row_by_row' ? s.rowDecisions : {};
    callApi('reconcileChecklistLateBccImport', { input: { importId: s.importRecord.id, choice: choice, rowDecisions: rowDecisions } })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.inFlight.reconcile = false;
        s.reconcileActions = data.actions || [];
        s.showConflictModal = false; s.diffOpen = false;
        setFsm('awaiting_approval'); preselectCleanRows(); render();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.inFlight.reconcile = false;
        toast(STORE.node, 'error', 'Không đối soát được', err && err.message || ''); render();
      });
  }

  function preselectCleanRows() {
    var s = STORE.state;
    var rows = s.importRows || [];
    s.selectedRowIds = {};
    rows.forEach(function (row) {
      var freq = row.frequency_reference_snapshot || {};
      var clean = row.match_status !== 'ambiguous_needs_review' && row.match_status !== 'conflict_needs_review' && !(freq && freq.overThreshold) && !row.linked_violation_id;
      if (clean) s.selectedRowIds[row.id] = true;
    });
  }

  function handleBulkApprove() {
    var s = STORE.state;
    if (s.inFlight.approve) return;
    var ids = Object.keys(s.selectedRowIds).filter(function (id) { return s.selectedRowIds[id]; });
    if (!ids.length) { toast(STORE.node, 'warning', 'Chưa chọn dòng nào', 'Vui lòng chọn ít nhất một dòng sạch để phê duyệt hàng loạt.'); return; }
    var decisions = ids.map(function (id) { return buildApproveDecision(id, true); });
    var blocked = decisions.find(function (d) { return d.__blocked; });
    if (blocked) { toast(STORE.node, 'warning', 'Thiếu lý do', 'Có dòng điểm áp dụng khác điểm gợi ý nhưng chưa nhập lý do — vui lòng bổ sung trước khi phê duyệt.'); return; }
    runApprove(decisions);
  }
  function handleApproveOne(id) {
    var s = STORE.state;
    if (s.inFlight['approve_' + id]) return;
    var decision = buildApproveDecision(id, false);
    if (decision.__blocked) { toast(STORE.node, 'warning', 'Thiếu lý do', 'Điểm áp dụng khác điểm gợi ý — vui lòng nhập lý do trước khi phê duyệt.'); return; }
    s.inFlight['approve_' + id] = true;
    runApprove([decision]);
  }
  function buildApproveDecision(id, bulk) {
    var s = STORE.state;
    var row = (s.importRows || []).find(function (r) { return String(r.id) === String(id); }) || {};
    var override = s.rowOverrides[id] || {};
    var isConflict = row.match_status === 'conflict_needs_review';
    var reason = t(override.reason);
    if (isConflict) {
      // Cần kiểm tra (mâu thuẫn nhiều người ghi nhận): KHÔNG tự chọn theo thời điểm/vai trò —
      // Admin PHẢI tự chọn kết luận Duyệt/Không duyệt + nêu lý do, luôn luôn (không có đường
      // tắt "giữ nguyên gợi ý" vì không có gợi ý nào cho tới khi Admin quyết định).
      if (override.resolvedManagerDecision !== 'approved' && override.resolvedManagerDecision !== 'rejected') return { __blocked: true };
      if (reason.length < 5) return { __blocked: true };
      var resolvedPoints = override.appliedPoints != null ? Number(override.appliedPoints) : (override.resolvedManagerDecision === 'approved' ? 0 : Number(row.standard_points));
      return {
        importRowId: id,
        adminDecision: resolvedPoints === 0 ? 'accept_exempt' : 'apply_no_permission_points',
        appliedPoints: resolvedPoints,
        resolvedManagerDecision: override.resolvedManagerDecision,
        reason: reason,
        bulk: !!bulk
      };
    }
    var appliedPoints = override.appliedPoints != null ? Number(override.appliedPoints) : Number(row.suggested_points);
    var differs = Math.abs(appliedPoints - Number(row.suggested_points)) > 0.000001;
    if (differs && reason.length < 5) return { __blocked: true };
    return {
      importRowId: id,
      adminDecision: appliedPoints === 0 ? 'accept_exempt' : 'apply_no_permission_points',
      appliedPoints: appliedPoints,
      reason: reason,
      bulk: !!bulk
    };
  }
  function runApprove(decisions) {
    var s = STORE.state;
    s.inFlight.approve = true; setFsm('applying'); render();
    callApi('approveChecklistLateEvents', { decisions: decisions })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.inFlight.approve = false;
        decisions.forEach(function (d) { s.inFlight['approve_' + d.importRowId] = false; });
        s.approveResults = (s.approveResults || []).filter(function (prev) { return !decisions.some(function (d) { return String(d.importRowId) === String(prev.importRowId); }); }).concat(data.results || []);
        var allApplied = s.approveResults.length && s.approveResults.every(function (r) { return r.applied; });
        setFsm(allApplied ? 'done' : (s.approveResults.some(function (r) { return r.applied; }) ? 'done' : 'awaiting_approval'));
        toast(STORE.node, 'success', 'Đã xử lý phê duyệt', (data.approved || 0) + ' dòng được ghi nhận chính thức.');
        render();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.inFlight.approve = false;
        decisions.forEach(function (d) { s.inFlight['approve_' + d.importRowId] = false; });
        setFsm('error_retry');
        toast(STORE.node, 'error', 'Không phê duyệt được', err && err.message || 'Vui lòng thử lại.');
        render();
      });
  }

  function handleAdjust(id) {
    var s = STORE.state;
    var row = (s.importRows || []).find(function (r) { return String(r.id) === String(id); });
    if (!row || !row.linked_violation_id) return;
    var reason = window.prompt ? window.prompt('Lý do điều chỉnh (tối thiểu 10 ký tự):', '') : '';
    reason = t(reason);
    if (reason.length < 10) { toast(STORE.node, 'warning', 'Chưa thể điều chỉnh', 'Lý do điều chỉnh cần tối thiểu 10 ký tự.'); return; }
    callApi('createChecklistLateLinkedAdjustment', { input: { originalViolationId: row.linked_violation_id, importRowId: id, reason: reason } })
      .then(function () {
        toast(STORE.node, 'success', 'Đã tạo điều chỉnh có audit', 'Bản ghi cũ đã được hủy và tạo bản ghi mới liên kết.');
        return probeReconcile();
      }).catch(function (err) {
        toast(STORE.node, 'error', 'Không điều chỉnh được', err && err.message || '');
      });
  }

  function handleExportRun() {
    var s = STORE.state;
    if (s.exportState === 'loading') return;
    s.exportState = 'loading'; s.exportError = ''; render();
    callApi('exportChecklistLateReconciliation', { filters: s.exportFilters })
      .then(function (data) {
        if (!isCurrent(s)) return;
        s.exportState = 'done';
        writeExportXlsx(data);
        render();
      }).catch(function (err) {
        if (!isCurrent(s)) return;
        s.exportState = (err && err.permissionDenied) ? 'denied' : 'error';
        s.exportError = err && err.message || 'Không xác định.';
        render();
      });
  }
  function writeExportXlsx(data) {
    ensureXlsx().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      var sheet1 = XLSX.utils.json_to_sheet(data.sheet1 || []);
      var sheet2 = XLSX.utils.json_to_sheet(data.sheet2 || []);
      XLSX.utils.book_append_sheet(wb, sheet1, 'Ghi nhận từ bộ phận');
      XLSX.utils.book_append_sheet(wb, sheet2, 'Đối soát BCC');
      XLSX.writeFile(wb, 'PHF_XUAT_DOI_SOAT_DI_TRE_' + todayIso() + '.xlsx', { compression: true });
    }).catch(function () { /* export data vẫn coi là thành công dù ghi file lỗi cục bộ */ });
  }

  /* ============================== Sự kiện (delegated trên container mount) ============================== */
  function bindEvents() {
    var node = STORE.node;
    if (!node) return;
    node.addEventListener('submit', onSubmit);
    node.addEventListener('click', onClick);
    node.addEventListener('change', onChange);
    node.addEventListener('input', onInput);
    node.addEventListener('keydown', onKeydown);
    STORE.listeners = [
      [node, 'submit', onSubmit], [node, 'click', onClick], [node, 'change', onChange], [node, 'input', onInput], [node, 'keydown', onKeydown]
    ];
  }
  function onSubmit(e) {
    var form = e.target.closest('[data-phfck-latewf-record-form]');
    if (form) { e.preventDefault(); handleRecordSubmit(form); }
  }
  function onChange(e) {
    var field = e.target.closest('[data-phfck-latewf-field]');
    if (field) {
      var name = field.getAttribute('data-phfck-latewf-field');
      STORE.state.record[name] = field.type === 'radio' ? field.value : field.value;
      return;
    }
    var fileInput = e.target.closest('[data-phfck-latewf-file-input]');
    if (fileInput) { handleFileSelected(fileInput.files && fileInput.files[0]); return; }
    var manualSelect = e.target.closest('[data-phfck-latewf-manual-field]');
    if (manualSelect && manualSelect.tagName === 'SELECT') {
      manualFieldSet(manualSelect.getAttribute('data-phfck-latewf-manual-row-id'), manualSelect.getAttribute('data-phfck-latewf-manual-field'), manualSelect.value);
      return;
    }
    var rowCheck = e.target.closest('[data-phfck-latewf-row-check]');
    if (rowCheck) { var id = rowCheck.getAttribute('data-phfck-latewf-row-check'); STORE.state.selectedRowIds[id] = rowCheck.checked; return; }
    var resolveSel = e.target.closest('[data-phfck-latewf-resolve]');
    if (resolveSel) {
      var rid = resolveSel.getAttribute('data-phfck-latewf-resolve');
      STORE.state.rowOverrides[rid] = STORE.state.rowOverrides[rid] || {};
      STORE.state.rowOverrides[rid].resolvedManagerDecision = resolveSel.value;
      var rrow = (STORE.state.importRows || []).find(function (r) { return String(r.id) === String(rid); });
      if (rrow) {
        // Auto-điền điểm áp dụng theo kết luận vừa chọn — Admin vẫn có thể sửa tay ở ô Điểm áp dụng.
        STORE.state.rowOverrides[rid].appliedPoints = resolveSel.value === 'approved' ? 0 : Number(rrow.standard_points || 0);
      }
      render();
      return;
    }
    var rowDecision = e.target.closest('[data-phfck-latewf-row-decision]');
    if (rowDecision) { STORE.state.rowDecisions[rowDecision.getAttribute('data-phfck-latewf-row-decision')] = rowDecision.value; return; }
    var exportField = e.target.closest('[data-phfck-latewf-export-field]');
    if (exportField) { STORE.state.exportFilters[exportField.getAttribute('data-phfck-latewf-export-field')] = exportField.value; return; }
  }
  function onInput(e) {
    var field = e.target.closest('[data-phfck-latewf-field]');
    if (field && field.tagName !== 'SELECT' && field.type !== 'radio') { STORE.state.record[field.getAttribute('data-phfck-latewf-field')] = field.value; return; }
    var manualInput = e.target.closest('[data-phfck-latewf-manual-field]');
    if (manualInput && manualInput.tagName !== 'SELECT') {
      manualFieldSet(manualInput.getAttribute('data-phfck-latewf-manual-row-id'), manualInput.getAttribute('data-phfck-latewf-manual-field'), manualInput.value);
      return;
    }
    var pts = e.target.closest('[data-phfck-latewf-applied-points]');
    if (pts) { var id1 = pts.getAttribute('data-phfck-latewf-applied-points'); STORE.state.rowOverrides[id1] = STORE.state.rowOverrides[id1] || {}; STORE.state.rowOverrides[id1].appliedPoints = pts.value; return; }
    var reasonEl = e.target.closest('[data-phfck-latewf-row-reason]');
    if (reasonEl) { var id2 = reasonEl.getAttribute('data-phfck-latewf-row-reason'); STORE.state.rowOverrides[id2] = STORE.state.rowOverrides[id2] || {}; STORE.state.rowOverrides[id2].reason = reasonEl.value; return; }
  }
  function onClick(e) {
    var s = STORE.state;
    if (e.target.closest('[data-phfck-latewf-reload-list]')) { e.preventDefault(); s.myObservations.loaded = false; render(); loadMyObservations(); return; }
    if (e.target.closest('[data-phfck-latewf-download-template]')) { e.preventDefault(); if (s.inFlight.template) return; s.inFlight.template = true; render(); downloadTemplateXlsx().catch(function (err) { toast(node0(), 'error', 'Không tạo được file mẫu', err && err.message || ''); }).then(function () { s.inFlight.template = false; render(); }); return; }
    if (e.target.closest('[data-phfck-latewf-choose-file]')) { e.preventDefault(); handleChooseFile(); return; }
    var modeBtn = e.target.closest('[data-phfck-latewf-input-mode]');
    if (modeBtn) { e.preventDefault(); handleInputModeChange(modeBtn.getAttribute('data-phfck-latewf-input-mode')); return; }
    if (e.target.closest('[data-phfck-latewf-manual-add]')) { e.preventDefault(); handleManualAdd(); return; }
    var manualRemoveBtn = e.target.closest('[data-phfck-latewf-manual-remove]');
    if (manualRemoveBtn) { e.preventDefault(); handleManualRemove(manualRemoveBtn.getAttribute('data-phfck-latewf-manual-remove')); return; }
    if (e.target.closest('[data-phfck-latewf-manual-preview]')) { e.preventDefault(); handleManualPreview(); return; }
    if (e.target.closest('[data-phfck-latewf-start-reconcile]')) { e.preventDefault(); handleStartReconcile(); return; }
    var conflictClose = e.target.closest('[data-phfck-latewf-conflict-close]');
    if (conflictClose) { e.preventDefault(); s.showConflictModal = false; render(); return; }
    var diffOpenBtn = e.target.closest('[data-phfck-latewf-conflict-diff]');
    if (diffOpenBtn) { e.preventDefault(); s.diffOpen = true; render(); return; }
    var diffBack = e.target.closest('[data-phfck-latewf-diff-back]');
    if (diffBack) { e.preventDefault(); s.diffOpen = false; render(); return; }
    var diffClose = e.target.closest('[data-phfck-latewf-diff-close]');
    if (diffClose) { e.preventDefault(); s.diffOpen = false; s.showConflictModal = false; render(); return; }
    var choiceBtn = e.target.closest('[data-phfck-latewf-conflict-choice]');
    if (choiceBtn) { e.preventDefault(); handleConflictChoice(choiceBtn.getAttribute('data-phfck-latewf-conflict-choice')); return; }
    if (e.target.closest('[data-phfck-latewf-bulk-approve]')) { e.preventDefault(); handleBulkApprove(); return; }
    if (e.target.closest('[data-phfck-latewf-select-clean]')) { e.preventDefault(); preselectCleanRows(); render(); return; }
    var approveOne = e.target.closest('[data-phfck-latewf-approve-one]');
    if (approveOne) { e.preventDefault(); handleApproveOne(approveOne.getAttribute('data-phfck-latewf-approve-one')); return; }
    var adjustBtn = e.target.closest('[data-phfck-latewf-adjust]');
    if (adjustBtn) { e.preventDefault(); handleAdjust(adjustBtn.getAttribute('data-phfck-latewf-adjust')); return; }
    if (e.target.closest('[data-phfck-latewf-export-run]')) { e.preventDefault(); handleExportRun(); return; }
  }
  function node0() { return STORE.node; }
  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    var layer = e.target.closest('[data-phfck-modal-layer]');
    if (!layer) return;
    e.preventDefault();
    var s = STORE.state;
    if (s.diffOpen) { s.diffOpen = false; render(); return; }
    if (s.showConflictModal) { s.showConflictModal = false; render(); return; }
  }

  /* ============================== Mount / Unmount ============================== */
  function mount(container, ctx) {
    if (!container) return;
    unmount();
    STORE.node = container;
    STORE.ctx = ctx || {};
    STORE.state = freshState(STORE.ctx);
    STORE.returnFocus = document.activeElement;
    render();
  }
  function unmount() {
    if (STORE.timers) STORE.timers.forEach(function (id) { clearTimeout(id); });
    STORE.timers = [];
    if (STORE.node && STORE.listeners) {
      STORE.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
    }
    STORE.listeners = [];
    STORE.node = null; STORE.ctx = null; STORE.state = null;
  }

  window.PhfChecklistLateWorkflow = { mount: mount, unmount: unmount, _internal: { callApi: callApi } };
})();
