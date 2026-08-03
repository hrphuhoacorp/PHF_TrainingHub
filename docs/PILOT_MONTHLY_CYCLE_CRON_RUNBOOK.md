# RUNBOOK — Đồng bộ kỳ đánh giá tháng thủ công trong Pilot

## Kết luận xác minh (không suy đoán, dựa trên source hiện tại)

- Production hiện chạy trên **Vercel**.
- `api/checklist-monthly-cron.js` yêu cầu header `Authorization: Bearer $CHECKLIST_CRON_SECRET`.
- `render.yaml`: **không có** biến `CHECKLIST_CRON_SECRET` (grep = 0 kết quả).
- `vercel.json`: **không có** mục `crons` nào trỏ tới endpoint này (grep = 0 kết quả).
- `.env.production.example`: không đề cập biến này.
- Không tìm thấy nguồn gọi ngoài nào khác (không có GitHub Actions workflow, không có dịch vụ cron ngoài được cấu hình trong repo).

**Kết luận: B — Cron chưa được gọi tự động trên Production (Vercel).** Việc tạo/mở/khóa kỳ đánh giá tháng **không tự chạy**; phải thao tác tay trong suốt thời gian Pilot.

## Tin tốt: đã có sẵn nút thao tác tay tương đương

Màn **Admin → Checklist → Cài đặt → Chu kỳ đánh giá tự động** có nút **"Đồng bộ kỳ hiện tại"** — gọi đúng hàm `syncMonthlyCycle` (cùng logic mà cron lẽ ra sẽ gọi tự động). Admin dùng nút này thay cron trong Pilot.

## Thao tác Admin phải làm trong Pilot (theo lịch)

| Thời điểm | Thao tác | Vì sao |
|---|---|---|
| Ngày 1 mỗi tháng (đầu giờ hành chính) | Vào Cài đặt Checklist → bấm **"Đồng bộ kỳ hiện tại"** | Tạo phiếu tháng mới cho kỳ vừa qua, bổ sung người thẩm định theo phân công hiệu lực |
| Sau khi bấm đồng bộ | Kiểm tra toast báo kết quả: số phiếu mới, số phiếu được bổ sung người thẩm định, danh sách cảnh báo (nếu có `MISSING_REVIEWER`) | Nếu có cảnh báo thiếu người thẩm định, cần xử lý tay qua "Đổi người thẩm định" trước khi nhân viên bắt đầu tự đánh giá |
| Ngày 1-3 tháng kế tiếp (cửa sổ tự đánh giá) | Không cần thao tác — nhân viên tự làm qua UI. Admin chỉ theo dõi "Tổng quan" | Đúng theo `periodDateTime` (cửa sổ nằm ở tháng kế tiếp của kỳ) |
| Ngày 4 tháng kế tiếp trở đi | Vào màn "Phiếu tháng" → bấm **"Khóa kỳ"** cho kỳ đã đủ điều kiện (không còn phiếu `waiting_self`/`waiting_review`) | Hệ thống không tự khóa kỳ khi chạy trên Vercel (không có scheduler nền như bản Node/Render) |

## Nếu Admin quên bấm "Đồng bộ kỳ hiện tại" đúng ngày 1
- Phiếu tháng sẽ không được tạo cho tới khi Admin bấm tay — không tự phát sinh, không có cảnh báo tự động nào nhắc Admin (vì không có cron/alerting, xem thêm Production Readiness Audit mục Monitoring).
- Hệ thống **không tự khóa kỳ trễ hạn** — nếu Admin bấm "Đồng bộ kỳ hiện tại" muộn, kỳ vẫn tạo được bình thường, chỉ lệch mốc thời gian so với lịch chuẩn.
- Khuyến nghị: đặt nhắc lịch thủ công (Google Calendar/lịch nội bộ) cho Admin phụ trách Pilot vào đúng ngày 1 và ngày 4 hằng tháng.

## Backlog sau Pilot
- Tự động hóa cron thật cho `api/checklist-monthly-cron.js` (cấu hình `crons` trong `vercel.json` + biến `CHECKLIST_CRON_SECRET`, hoặc dùng dịch vụ cron ngoài gọi kèm Bearer token).
- Thêm cảnh báo chủ động nếu quá ngày 1/ngày 4 mà chưa có ai bấm đồng bộ/khóa kỳ (liên quan Monitoring — đã ghi trong Production Readiness Audit).

Không tự thay đổi lịch kỳ đã chốt trong tài liệu này — chỉ mô tả đúng thao tác thay thế cron hiện có.
