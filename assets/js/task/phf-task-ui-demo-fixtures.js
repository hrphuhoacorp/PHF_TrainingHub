(function(){
  'use strict';

  /* ===========================================================================
   * PHF_TASK_UI_DEMO_V1 — TEMPORARY_FIXTURE — DELETE_BEFORE_REAL_DATA_WIRING
   * ===========================================================================
   * PHF HR — "Việc của tôi" UI/UX DEMO V1 (2026-08-22).
   *
   * Đây là fixture TẠM THỜI, chỉ phục vụ Business Owner xem trực tiếp UI/UX
   * "Việc của tôi" trên Local trước khi chốt thiết kế — KHÔNG phải triển khai
   * dữ liệu Production, KHÔNG ghi DB, KHÔNG gọi API thật.
   *
   * Nguồn tham chiếu nghiệp vụ: file Excel/CSV PHF Task legacy Business Owner
   * cung cấp ("PHF _ Giao việc Update 19h22082026.xlsx" + TaskLog export).
   * Tiêu đề/tên nhân sự lấy CẢM HỨNG từ dữ liệu thật đó để Business Owner nhìn
   * quen mắt — KHÔNG import nguyên văn, KHÔNG copy Users/password/hash/salt/
   * auth legacy, KHÔNG phải 1-1 mapping chính xác từng dòng gốc.
   *
   * TOÀN BỘ file này nằm ở 1 nơi DUY NHẤT, dễ xoá — xem hướng dẫn XÓA DEMO ở
   * cuối file. Không rải mock data vào business engine (task-core.js/
   * phf-task-app.js không có nhánh nào tạo dữ liệu giả ngoài việc ĐỌC
   * window.PHF_TASK_UI_DEMO_FIXTURES khi window.PHF_TASK_UI_DEMO_V1===true).
   *
   * SHAPE của mỗi record khớp CHÍNH XÁC field mà listTasks() (api/_lib/
   * task-core.js) trả về thật, CỘNG THÊM vài field demo-only optional
   * (content, note, links, repeat, related, history) chỉ dùng cho Task
   * Detail demo — các field optional này KHÔNG tồn tại trong response API
   * thật, nhưng render an toàn (guarded, không throw) nếu thiếu.
   * ===========================================================================
   */
  window.PHF_TASK_UI_DEMO_V1 = true; // <-- CÔNG TẮC DUY NHẤT. Đổi thành false hoặc xoá dòng này để tắt demo mode ngay lập tức.
  // V5 mục 2 — cờ demo cho biết "người dùng demo" hiện có managed scope (TBP/
  // Trưởng ca quản lý ít nhất 1 nhân sự) — DEMO_ACTOR trong fixture này đóng
  // vai trò đó. Chỉ dùng để quyết định menu "Nhân sự tôi quản lý" có render
  // hay không trong DEMO MODE — Production sẽ thay bằng session capability
  // thật (managedEmployeeCodes non-empty), KHÔNG phải permission engine mới.
  window.PHF_TASK_UI_DEMO_MANAGER_SCOPE = true;

  function daysFromNow(n, hour) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(hour == null ? 17 : hour, 0, 0, 0);
    return d.toISOString();
  }

  // "Người dùng demo" đang đăng nhập — mọi fixture được gắn quan hệ (received/
  // assigned/proposal_sent/proposal_received) SẴN theo góc nhìn của người này,
  // giống hệt cách listTasks() thật trả kết quả theo actor — demo KHÔNG tự
  // suy luận quan hệ lúc runtime, chỉ hiển thị đúng nhóm đã gắn sẵn.
  var DEMO_ACTOR = { employee_code: 'PHF004', full_name: 'Trần Gia Bảo Ngọc', department: 'Trợ lý Giám đốc' };
  function person(code, name, dept) { return { employee_code: code, full_name: name, department: dept }; }

  var GIAM_DOC = person('PHF002', 'Trần Thu Thủy', 'Ban giám đốc');
  var DUY_HAI = person('DEMO_DUYHAI', 'Duy Hải', 'Kho vận');
  var THUY_TIEN = person('DEMO_THUYTIEN', 'Thủy Tiên', 'Kinh doanh');
  var LV_THANG = person('DEMO_LVTHANG', 'L.V.Thắng', 'Nhân sự');
  var DIEU_LINH = person('DEMO_DIEULINH', 'Diệu Linh', 'Nhân sự');
  // V3 — MANAGER SCOPE demo (mục 10-12): NV_B cùng phòng ban với DEMO_ACTOR
  // (DEMO_ACTOR đóng vai TBP quản lý phòng "Trợ lý Giám đốc" cho mục đích demo
  // scope). TBP_C ở phòng khác giao việc liên phòng ban cho NV_B — DEMO_ACTOR
  // xem Task này ở vai trò MANAGER, không phải recipient/creator.
  var NV_B = person('DEMO_NVB', 'Nguyễn Hải Đăng', 'Trợ lý Giám đốc');
  var TBP_C = person('DEMO_TBPC', 'Ngọc Linh', 'Thu mua');

  function baseTask(overrides) {
    return Object.assign({
      task_id: '',
      task_code: '',
      title: '',
      flow_type: 'giao_viec',
      status: 'published',
      priority: 'thuong',
      deadline: daysFromNow(3),
      category_code: 'Công việc tổng thể',
      progress_percent: 0,
      progress_status: 'chua_bat_dau',
      is_cross_department: null,
      source_department: null,
      target_department: null,
      created_by: GIAM_DOC,
      primary: DEMO_ACTOR,
      self_task: false,
      row_version: 1,
      // demo-only, chỉ dùng cho Task Detail — không tồn tại trong API thật
      content: '',
      note: '',
      links: [],
      related: [],
      repeat: null,
      history: [],
      // V3 — demo-only, phục vụ presentation Completion/Rework/SLA (mục 5-9)
      // và Manager Scope (mục 10-12). KHÔNG phải schema thật, KHÔNG có engine
      // tính toán đằng sau — chỉ mutate/hiển thị tĩnh trong JS.
      scope_kind: null,        // 'managed' khi primary là nhân sự actor quản lý (không phải actor)
      completed_at: null,
      completion_count: null,
      rework_state: null,      // 'requested' khi người giao vừa yêu cầu xử lý lại
      rework_reason: '',
      rework_requested_at: null,
      sla_state: null,         // 'within_sla' | 'locked' — presentation-only, không tính real-time
      near_period_cutoff: false,
      // V4 — demo-only, phục vụ presentation Hủy phiếu (mục 5-7). Direct
      // cancel dùng lại row.status='cancelled' (đã có sẵn trong
      // TASK_STATUS_DISPLAY_LABELS thật). cancel_request_* là field RIÊNG
      // cho case "Task completed" — status KHÔNG đổi ngay, chỉ presentation
      // "Chờ Admin xử lý".
      cancel_reason: '',
      cancelled_at: null,
      cancelled_by: '',
      cancel_request_state: null,   // 'pending' khi đã gửi yêu cầu Admin hủy
      cancel_request_reason: '',
      cancel_request_by: '',
      cancel_request_at: null
    }, overrides);
  }

  var DEFAULT_HISTORY = function (createdLabel) {
    return [
      { action: 'Tạo phiếu', actor: 'Hệ thống', at: daysFromNow(-6) },
      { action: 'Giao việc', actor: createdLabel, at: daysFromNow(-6, 9) }
    ];
  };

  // ===========================================================================
  // TÔI NHẬN — primary = DEMO_ACTOR (6 task, đủ hình thái: tự giao/người khác
  // giao, quá hạn/hoàn thành, ưu tiên khác nhau, có link, liên phòng ban, lặp)
  // ===========================================================================
  var received = [
    baseTask({
      task_id: 'demo-r1', task_code: 'CV-DEMO-101',
      title: 'Xử lý cân kho & báo cáo kiểm kê kho Ngô Quyền',
      category_code: 'Kho vận', priority: 'thuong', status: 'completed',
      deadline: daysFromNow(-9), created_by: DEMO_ACTOR, primary: DEMO_ACTOR, self_task: true,
      content: 'Đợt kiểm kê cuối tháng, đối chiếu số liệu kho tổng và kho chi nhánh Ngô Quyền.',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-8) }])
    }),
    baseTask({
      task_id: 'demo-r2', task_code: 'CV-DEMO-102',
      title: 'Cấp máy tính mới cho bộ phận Check Đơn Online',
      category_code: 'Nhân sự', priority: 'quan_trong', status: 'in_progress', progress_percent: 40, progress_status: 'dang_lam',
      deadline: daysFromNow(12), created_by: GIAM_DOC, primary: DEMO_ACTOR,
      content: 'Theo yêu cầu trong cuộc họp, bộ phận Check đơn Online cần cấp thêm 1 máy tính phục vụ công việc. Xem xét giữa phương án sửa máy cũ và mua máy mới, ưu tiên ngân sách tối ưu mà vẫn đảm bảo hiệu suất.',
      note: 'Đang khảo sát thực tế tại điểm để chọn phương án phù hợp.',
      history: DEFAULT_HISTORY('Trần Thu Thủy')
    }),
    baseTask({
      task_id: 'demo-r3', task_code: 'CV-DEMO-103',
      title: 'Tuyển dụng nhân viên bán hàng cho CN Phú Lợi',
      category_code: 'Nhân sự', priority: 'quan_trong', status: 'published',
      deadline: daysFromNow(-2), created_by: GIAM_DOC, primary: DEMO_ACTOR,
      content: 'Tuyển bổ sung 3 bán hàng cho chi nhánh Phú Lợi. Cam kết: 2 bán hàng onboard trong tuần tiếp theo, 1 nhân sự còn lại chưa có deadline.',
      history: DEFAULT_HISTORY('Trần Thu Thủy')
    }),
    baseTask({
      task_id: 'demo-r4', task_code: 'CV-DEMO-104',
      title: 'Xác nhận quy chế tài chính cửa hàng',
      category_code: 'Tài chính', priority: 'thuong', status: 'completed', deadline: daysFromNow(-15),
      created_by: GIAM_DOC, primary: DEMO_ACTOR,
      content: 'Xem và xác nhận các khoản được chi của cửa hàng.',
      history: DEFAULT_HISTORY('Trần Thu Thủy').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-14) }])
    }),
    baseTask({
      task_id: 'demo-r5', task_code: 'CV-DEMO-105',
      title: 'Xử lý & báo cáo kiểm kê kho tổng tháng 05/2026',
      category_code: 'Kho vận', priority: 'khan_cap', status: 'completed', deadline: daysFromNow(-20),
      created_by: DUY_HAI, primary: DEMO_ACTOR,
      is_cross_department: true, source_department: 'Kho vận', target_department: 'Trợ lý Giám đốc',
      links: [{ label: 'Link báo cáo kiểm kê', url: 'https://docs.google.com/spreadsheets/d/1zGtNEujh06upowZR-p2EDGyY-vTVI3sv/edit' }],
      history: DEFAULT_HISTORY('Duy Hải').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-18) }])
    }),
    baseTask({
      task_id: 'demo-r6', task_code: 'CV-DEMO-106',
      title: 'Chấm điểm phiếu tiêu chuẩn PHF tháng trước đó của bộ phận kho',
      category_code: 'Công việc tổng thể', priority: 'thuong', status: 'completed', deadline: daysFromNow(-25),
      created_by: THUY_TIEN, primary: DEMO_ACTOR,
      repeat: { type: 'month', index: 2, total: 12 },
      content: 'Thẩm định tiêu chuẩn công việc của bộ phận kho tháng vừa qua theo phiếu tiêu chuẩn PHF.',
      // V3 — demo case "sát giờ khóa kỳ" (mục 8): chỉ note/presentation tĩnh,
      // KHÔNG có period-lock engine — báo Admin xử lý thủ công theo yêu cầu.
      completed_at: daysFromNow(-24, 17), completion_count: 1, sla_state: 'within_sla', near_period_cutoff: true,
      history: DEFAULT_HISTORY('Thủy Tiên').concat([{ action: 'Hoàn thành (demo)', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-24, 17), kind: 'status' }])
    })
  ];

  // V3 — MANAGER SCOPE demo (mục 10-13): TBP_C (phòng Thu mua) giao Task liên
  // phòng ban cho NV_B (cùng phòng "Trợ lý Giám đốc" mà DEMO_ACTOR quản lý).
  // DEMO_ACTOR KHÔNG phải recipient/creator ở đây — chỉ xem được vì là quản
  // lý của NV_B (scope_kind='managed'). primary/created_by KHÔNG phải
  // DEMO_ACTOR — đây là bằng chứng "quyền VIEW không đồng nghĩa quyền EDIT/
  // ACTION" (mục 1, 13).
  received.push(baseTask({
    task_id: 'demo-r7', task_code: 'CV-DEMO-107',
    title: 'Đối chiếu chứng từ thu mua quý 3 cho phòng Trợ lý Giám đốc',
    category_code: 'Thu mua', priority: 'quan_trong', status: 'in_progress', progress_percent: 30, progress_status: 'dang_lam',
    deadline: daysFromNow(6), created_by: TBP_C, primary: NV_B,
    is_cross_department: true, source_department: 'Thu mua', target_department: 'Trợ lý Giám đốc',
    scope_kind: 'managed',
    content: 'Đối chiếu chứng từ thu mua quý 3, phối hợp với phòng Trợ lý Giám đốc để hoàn tất báo cáo.',
    note: 'NV_B đang tổng hợp số liệu từ 2 chi nhánh.',
    history: DEFAULT_HISTORY('Ngọc Linh').concat([{ action: 'Cập nhật tiến độ (demo)', actor: 'Nguyễn Hải Đăng', at: daysFromNow(-1), kind: 'note', text: 'Đã tổng hợp xong chi nhánh Ngô Quyền, đang chờ chi nhánh Phú Lợi.' }])
  }));

  // V5 mục 6, 13 — thêm đủ 4 trạng thái managed còn thiếu (quá hạn/hoàn
  // thành/cần xử lý lại/đã hủy) để "Nhân sự tôi quản lý" có summary
  // reconciliation thật (Tất cả = Đang thực hiện + Quá hạn + Hoàn thành +
  // Cần xử lý lại + Đã hủy), không chỉ 1 task duy nhất (demo-r7, cùng phòng
  // ban) trước đó. created_by KHÔNG BAO GIỜ là DEMO_ACTOR ở các dòng managed
  // mới — managed workspace chỉ xem Task người khác giao cho nhân sự mình
  // quản lý (mục 4: manager không tự có action creator/recipient).
  received.push(baseTask({
    task_id: 'demo-r11', task_code: 'CV-DEMO-111',
    title: 'Đối chiếu công nợ nhà cung cấp túi vải quý 3',
    category_code: 'Tài chính', priority: 'quan_trong', status: 'published', deadline: daysFromNow(-3),
    created_by: THUY_TIEN, primary: NV_B, scope_kind: 'managed',
    content: 'Đối chiếu công nợ với NCC túi vải, chốt số liệu quý 3.',
    history: DEFAULT_HISTORY('Thủy Tiên')
  }));
  received.push(baseTask({
    task_id: 'demo-r12', task_code: 'CV-DEMO-112',
    title: 'Cập nhật danh sách khách hàng VIP quý 3',
    category_code: 'Chăm sóc KH', priority: 'thuong', status: 'completed', deadline: daysFromNow(-6),
    created_by: DUY_HAI, primary: NV_B, scope_kind: 'managed',
    completed_at: daysFromNow(-5, 16), completion_count: 1, sla_state: 'within_sla',
    content: 'Cập nhật danh sách khách hàng VIP theo data mới quý 3.',
    history: DEFAULT_HISTORY('Duy Hải').concat([{ action: 'Hoàn thành (demo)', actor: 'Nguyễn Hải Đăng', at: daysFromNow(-5, 16), kind: 'status' }])
  }));
  received.push(baseTask({
    task_id: 'demo-r13', task_code: 'CV-DEMO-113',
    title: 'Soát lại phiếu chi tiền mặt chi nhánh Ngô Quyền',
    category_code: 'Tài chính', priority: 'thuong', status: 'completed', deadline: daysFromNow(-8),
    created_by: THUY_TIEN, primary: NV_B, scope_kind: 'managed',
    completed_at: daysFromNow(-7, 15), completion_count: 1, sla_state: 'within_sla',
    rework_state: 'requested', rework_reason: 'Thiếu chữ ký xác nhận của thủ quỹ, bổ sung lại giúp.', rework_requested_at: daysFromNow(-6, 9),
    content: 'Soát lại phiếu chi tiền mặt chi nhánh Ngô Quyền tháng vừa qua.',
    history: DEFAULT_HISTORY('Thủy Tiên').concat([
      { action: 'Hoàn thành (demo)', actor: 'Nguyễn Hải Đăng', at: daysFromNow(-7, 15), kind: 'status' },
      { action: 'Yêu cầu xử lý lại (demo)', actor: 'Thủy Tiên', at: daysFromNow(-6, 9), kind: 'assigner_feedback', text: 'Thiếu chữ ký xác nhận của thủ quỹ, bổ sung lại giúp.' }
    ])
  }));
  received.push(baseTask({
    task_id: 'demo-r14', task_code: 'CV-DEMO-114',
    title: 'Khảo sát nhà cung cấp bao bì mới',
    category_code: 'Thu mua', priority: 'thuong', status: 'cancelled', deadline: daysFromNow(4),
    created_by: DUY_HAI, primary: NV_B, scope_kind: 'managed',
    cancel_reason: 'Đã có nhà cung cấp phù hợp hơn, không cần khảo sát thêm.', cancelled_at: daysFromNow(-1, 10), cancelled_by: 'Duy Hải',
    content: 'Khảo sát 2-3 nhà cung cấp bao bì mới để so sánh giá.',
    history: DEFAULT_HISTORY('Duy Hải').concat([{ action: 'Hủy phiếu (demo)', actor: 'Duy Hải', at: daysFromNow(-1, 10), kind: 'status', text: 'Đã có nhà cung cấp phù hợp hơn, không cần khảo sát thêm.' }])
  }));

  // ===========================================================================
  // TÔI GIAO — created_by = DEMO_ACTOR (5 task: giao người khác, tự giao,
  // quá hạn, liên phòng ban, có link)
  // ===========================================================================
  var assigned = [
    baseTask({
      task_id: 'demo-a1', task_code: 'CV-DEMO-201',
      title: 'Kiểm kê kho giờ và phụ kiện gói quà kho tổng',
      category_code: 'Kho vận', priority: 'quan_trong', status: 'completed', deadline: daysFromNow(-30),
      created_by: DEMO_ACTOR, primary: DUY_HAI,
      note: 'Chuẩn bị cho việc đặt hàng giỏ quà lô 20/10.',
      // V3 — demo tương tác "Theo dõi & phản hồi" (mục 3) + "Yêu cầu xử lý lại"
      // (mục 6): còn trong hạn phản hồi 2 ngày làm việc, CHƯA có rework — dùng
      // để test luồng bấm "Yêu cầu xử lý lại" trực tiếp.
      completed_at: daysFromNow(-1, 15), completion_count: 1, sla_state: 'within_sla',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành (demo)', actor: 'Duy Hải', at: daysFromNow(-1, 15), kind: 'status' }])
    }),
    baseTask({
      task_id: 'demo-a2', task_code: 'CV-DEMO-202',
      title: 'Lập file thông tin về quyền & vấn đề phân quyền trong cửa hàng cho Team HIAI',
      category_code: 'Dự án', priority: 'quan_trong', status: 'completed', deadline: daysFromNow(-35),
      created_by: DEMO_ACTOR, primary: DEMO_ACTOR, self_task: true,
      links: [{ label: 'Link file phân quyền', url: 'https://docs.google.com/spreadsheets/d/1zx7uhcsSY1_B2XZYBOgdA0TePsATyRvC/edit' }],
      content: 'Danh sách các quyền và phân quyền trong cửa hàng để Team HIAI làm data.',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-33) }])
    }),
    baseTask({
      task_id: 'demo-a3', task_code: 'CV-DEMO-203',
      title: 'Tìm hiểu thông tin về việc mua bản quyền âm nhạc',
      category_code: 'Kinh doanh', priority: 'thuong', status: 'completed', deadline: daysFromNow(-40),
      created_by: DEMO_ACTOR, primary: DEMO_ACTOR, self_task: true,
      note: 'Báo cáo gửi nhóm "Leader Team PHF".',
      // V3 — demo SLA đã hết hạn phản hồi 2 ngày làm việc (mục 7): sla_state
      // 'locked' là field TĨNH từ fixture, KHÔNG tính real-time — chỉ minh họa
      // "đã chốt điểm" + vẫn cho phép "Yêu cầu xử lý lại" sau đó (không tự
      // hồi tố điểm cũ).
      completed_at: daysFromNow(-38, 17), completion_count: 1, sla_state: 'locked',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành (demo)', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-38, 17), kind: 'status' }])
    }),
    baseTask({
      task_id: 'demo-a4', task_code: 'CV-DEMO-204',
      title: 'Xử lý cân kho & báo cáo kiểm kho Phú Lợi',
      category_code: 'Kho vận', priority: 'khan_cap', status: 'published', deadline: daysFromNow(-1),
      created_by: DEMO_ACTOR, primary: DUY_HAI,
      is_cross_department: true, source_department: 'Trợ lý Giám đốc', target_department: 'Kho vận',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc')
    }),
    baseTask({
      task_id: 'demo-a5', task_code: 'CV-DEMO-205',
      title: 'Cấp thẻ tín dụng ngân hàng mới cho công ty',
      category_code: 'Tài chính', priority: 'thuong', status: 'in_progress', progress_percent: 20, progress_status: 'dang_lam',
      deadline: daysFromNow(15), created_by: DEMO_ACTOR, primary: LV_THANG,
      content: 'Liên hệ ngân hàng làm thêm 1 thẻ tín dụng hạn mức thấp phục vụ các khoản thanh toán dịch vụ lặt vặt.',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc')
    })
  ];

  // V3 — COMPLETION / REWORK / SLA demo end-to-end (mục 5-9, 18B/18C): Task
  // TỰ GIAO (self_task) nên DEMO_ACTOR đóng CẢ 2 vai — mở từ "Tôi giao" để
  // demo assigner bấm "Yêu cầu xử lý lại", rồi mở LẠI CHÍNH task_id này từ
  // "Tôi nhận" để demo recipient "Hoàn thành lần 2". Đây là CÙNG 1 object JS
  // (push vào cả 2 bucket) — mutate ở bên nào cũng phản ánh sang bên kia,
  // giống hệt cách 1 Task tự giao thật sẽ xuất hiện ở cả 2 relation.
  var selfTaskReworkDemo = baseTask({
    task_id: 'demo-r10', task_code: 'CV-DEMO-110',
    title: 'Rà soát số liệu tồn kho tối thiểu/tối đa quý 3',
    category_code: 'Kinh doanh', priority: 'thuong', status: 'completed', deadline: daysFromNow(-5),
    created_by: DEMO_ACTOR, primary: DEMO_ACTOR, self_task: true,
    completed_at: daysFromNow(-1, 16), completion_count: 1, sla_state: 'within_sla',
    content: 'Rà soát và cập nhật lại số liệu tồn kho tối thiểu/tối đa theo số liệu thực tế quý 3.',
    history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành (demo)', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-1, 16), kind: 'status' }])
  });
  received.push(selfTaskReworkDemo);
  assigned.push(selfTaskReworkDemo);

  // ===========================================================================
  // ĐỀ XUẤT TÔI GỬI — created_by = DEMO_ACTOR, flow_type='de_xuat' (2 task) —
  // CHỈ presentation/list foundation, KHÔNG fake lifecycle Duyệt/Từ chối.
  // ===========================================================================
  var proposal_sent = [
    baseTask({
      task_id: 'demo-ps1', task_code: 'CV-DEMO-301', flow_type: 'de_xuat',
      title: 'Đề xuất gói bảo hiểm thân vỏ xe với BGĐ',
      category_code: 'Nhân sự', priority: 'quan_trong', status: 'published', deadline: daysFromNow(5),
      created_by: DEMO_ACTOR, primary: GIAM_DOC,
      content: 'Đề xuất gói bảo hiểm thân vỏ xe, kèm báo giá và quy định thân vỏ.',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc')
    }),
    baseTask({
      task_id: 'demo-ps2', task_code: 'CV-DEMO-302', flow_type: 'de_xuat',
      title: 'Lịch phỏng vấn Leader Marketing',
      category_code: 'Nhân sự', priority: 'thuong', status: 'completed', deadline: daysFromNow(-45),
      created_by: DEMO_ACTOR, primary: GIAM_DOC,
      content: 'Lịch phỏng vấn Leader Marketing thứ 4 lúc 15:00.',
      history: DEFAULT_HISTORY('Trần Gia Bảo Ngọc').concat([{ action: 'Hoàn thành', actor: 'Trần Thu Thủy', at: daysFromNow(-44) }])
    })
  ];

  // ===========================================================================
  // ĐỀ XUẤT TÔI NHẬN XỬ LÝ — primary = DEMO_ACTOR, flow_type='de_xuat' (2 task)
  // ===========================================================================
  var proposal_received = [
    baseTask({
      task_id: 'demo-pr1', task_code: 'CV-DEMO-401', flow_type: 'de_xuat',
      title: 'Tạo buổi họp nhắc nhở nhân sự vi phạm quy trình',
      category_code: 'Nhân sự', priority: 'thuong', status: 'completed', deadline: daysFromNow(-50),
      created_by: GIAM_DOC, primary: DEMO_ACTOR,
      content: 'Buổi làm việc chính thức cuối cùng ghi nhận lại toàn bộ vấn đề đã phát sinh, tập trung vào tuân thủ tuyến quản lý và phối hợp ca trực.',
      history: DEFAULT_HISTORY('Trần Thu Thủy').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-49) }])
    }),
    baseTask({
      task_id: 'demo-pr2', task_code: 'CV-DEMO-402', flow_type: 'de_xuat',
      title: 'Thông báo lại ứng viên vị trí Marketing',
      category_code: 'Nhân sự', priority: 'thuong', status: 'completed', deadline: daysFromNow(-55),
      created_by: LV_THANG, primary: DEMO_ACTOR,
      content: 'Thông báo lại ứng viên: hiện BGĐ đang bận nên xin phép dời ngày trao đổi.',
      history: DEFAULT_HISTORY('L.V.Thắng').concat([{ action: 'Hoàn thành', actor: 'Trần Gia Bảo Ngọc', at: daysFromNow(-54) }])
    })
  ];

  window.PHF_TASK_UI_DEMO_FIXTURES = {
    received: received,
    assigned: assigned,
    proposal_sent: proposal_sent,
    proposal_received: proposal_received
  };
  window.PHF_TASK_UI_DEMO_ACTOR = DEMO_ACTOR;

  /* ===========================================================================
   * CÁCH XÓA TOÀN BỘ DEMO SAU KHI BUSINESS OWNER CHỐT UI:
   * 1. Xoá dòng <script src="assets/js/task/phf-task-ui-demo-fixtures.js">
   *    trong index.html.
   * 2. Xoá file này (assets/js/task/phf-task-ui-demo-fixtures.js).
   * 3. Trong assets/js/task/phf-task-app.js, xoá khối code được đánh dấu
   *    "PHF_TASK_UI_DEMO_V1" (loadTaskList/loadMoreTaskList demo branch,
   *    demo-detail modal render + click/close handler, demo tag rendering
   *    trong taskListRowHtml nếu có).
   * Không có bảng DB/migration/API nào cần dọn — demo mode 100% client-side,
   * không có write path nào chạm tới nó.
   * =========================================================================== */
})();
