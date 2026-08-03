# RUNBOOK — Backup/Restore Supabase trong Pilot

## Kết luận xác minh (không suy đoán, dựa trên source hiện tại)

- Script backup: `scripts/phf-backup-supabase.js`.
- Chỉ gọi `supabase.from(table).select('*').range(from, to)` (phân trang 1000 dòng/lần) — **read-only**, không có lệnh `insert`/`update`/`delete`/`upsert` nào trong script.
- Cần `SUPABASE_URL` và `SUPABASE_SECRET_KEY` trong `.env` (mẫu khai báo tại `.env.production.example`); script tự dừng và báo lỗi nếu thiếu.
- 10 bảng được sao lưu: `settings`, `employees`, `progress`, `test_results`, `activity_log`, `evaluation_records`, `commitment_records`, `probation_records`, `system_notifications`, `user_accounts`.
- Output ghi vào `backups/supabase/<UTC timestamp>/`: mỗi bảng một file `<table>.json`, một file gộp `phf-supabase-full-backup.json`, và `manifest.json` (số dòng + SHA-256 từng file).
- `.gitignore` có `/backups/` — thư mục backup **không bao giờ vào Git**.
- Repo **không có script restore**. Không có endpoint/API nào trong repo dùng để ghi ngược dữ liệu từ file backup vào Supabase.

## Đã chạy thử trong phiên Pilot Readiness (2026-08-03, UTC)

Thư mục: `backups/supabase/20260803T030331Z/`

| Bảng | Số dòng |
|---|---|
| settings | 1 |
| employees | 40 |
| progress | 2 |
| test_results | 3 |
| activity_log | 460 |
| evaluation_records | 3 |
| commitment_records | 0 |
| probation_records | 1 |
| system_notifications | 90 |
| user_accounts | 40 |

Toàn bộ file có checksum SHA-256 trong `manifest.json` cùng thư mục — dùng để xác minh file không bị đổi khi sao chép sang nơi lưu trữ khác.

## Cách chạy backup

```
node scripts/phf-backup-supabase.js
```

- Chạy được nhiều lần, mỗi lần tạo thư mục timestamp riêng — không ghi đè bản cũ.
- Sau khi chạy xong, **sao chép nguyên thư mục** `backups/supabase/<timestamp>/` sang nơi lưu trữ ngoài máy (script tự nhắc dòng cuối cùng) — vì thư mục này bị `.gitignore` chặn, không tự nhân bản qua Git/deploy.

## Cách restore (thủ công — chưa có công cụ tự động)

Không có script restore trong repo. Nếu cần khôi phục dữ liệu từ bản backup:

1. Mở Supabase Dashboard → SQL Editor hoặc Table Editor của project tương ứng.
2. Với từng bảng cần khôi phục, đối chiếu file `<table>.json` trong thư mục backup để xác định dòng cần ghi lại (theo khóa chính của bảng).
3. Dùng Table Editor để sửa/ghi lại thủ công, hoặc viết câu lệnh `INSERT ... ON CONFLICT (...) DO UPDATE` dựa trên nội dung JSON — **không có sẵn script**, phải soạn tay theo đúng bảng bị ảnh hưởng.
4. Sau khi ghi lại, chạy lại `node scripts/phf-backup-supabase.js` để tạo bản backup mới, xác nhận số dòng khớp kỳ vọng.

Vì không có restore tự động, hãy ưu tiên xác minh kỹ trước khi thao tác ghi dữ liệu lên Production (ví dụ chạy migration) — bản backup chỉ cứu được nếu Admin bỏ thời gian đối chiếu tay.

## Backlog sau Pilot
- Viết script restore có kiểm soát (nhận thư mục backup, chọn bảng, dry-run trước khi ghi) thay vì thao tác tay qua Dashboard.
- Lên lịch backup định kỳ tự động (hiện tại backup chỉ chạy khi Admin tự gọi tay, giống tình trạng cron ở [PILOT_MONTHLY_CYCLE_CRON_RUNBOOK.md](PILOT_MONTHLY_CYCLE_CRON_RUNBOOK.md) — Production trên Vercel không có scheduler nền).

Không tự thay đổi cấu trúc bảng hay logic nghiệp vụ trong tài liệu này — chỉ mô tả đúng thao tác backup/restore hiện có.
