# PHASE B4 — Cleanup (deployer chạy, sau khi đã thu đủ evidence từ B3)

## Bước 1 — đảm bảo không còn session nào đang mở tới `phf_hr_verify`
```sql
SELECT pid, usename, state FROM pg_stat_activity WHERE datname = 'phf_hr_verify';
```
Nếu có session (vd Node script vừa chạy chưa thoát hẳn), đợi nó tự đóng (pool `idleTimeoutMillis` đã cấu hình 30s, hoặc Ctrl+C script rồi đợi vài giây) trước khi DROP — `DROP DATABASE` sẽ báo lỗi "database is being accessed by other users" nếu còn kết nối, KHÔNG tự FORCE.

## Bước 2 — drop
```sql
DROP DATABASE phf_hr_verify;
```
Expected: `DROP DATABASE`. Nếu lỗi vì còn connection, quay lại Bước 1 — KHÔNG dùng `DROP DATABASE ... WITH (FORCE)` trừ khi đã xác nhận chắc chắn không có script nào khác đang cố dùng nó song song.

## Bước 3 — verify đã mất hẳn (read-only)
```sql
SELECT datname FROM pg_database WHERE datname = 'phf_hr_verify';
```
Expected: **0 dòng**. Đây là bằng chứng `RESIDUE = 0` — dán kết quả lại cho tôi.

## Bước 4 — verify phf_hr/phfcrm không đổi gì (read-only, đối chiếu lại đúng baseline B2 bước 5)
```sql
select has_database_privilege('phf_hr_runtime','phfcrm','CONNECT') as runtime_to_phfcrm_unchanged,
       has_database_privilege('phf_hr_runtime','phf_hr','CONNECT') as runtime_to_phf_hr_unchanged;
```
Expected: `f, t` — giống hệt trước khi bắt đầu Phase B, không đổi gì.
