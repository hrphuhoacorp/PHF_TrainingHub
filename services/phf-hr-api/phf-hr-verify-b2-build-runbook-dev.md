# PHASE B2 — Build `phf_hr_verify` (deployer chạy, không phải claude-phf)

Chạy đúng thứ tự. Mỗi bước xác nhận output khớp "Expected" rồi mới sang bước kế.
Không có bước nào đụng `phfcrm` hoặc thay đổi privilege hiện có của `phf_hr`.

## Bước 0 — pre-check (tuỳ chọn nhưng khuyến nghị)
```
psql -d phf_hr_verify_precheck_placeholder 2>/dev/null; echo "(bỏ qua lỗi trên nếu có, chỉ test)"
```
(Bỏ qua — bước 0 thật sự không cần, chỉ nhắc đọc `phf_hr_task_foundation_v1_PRE_APPLY_GATE.sql` nếu muốn double-check cú pháp SET ROLE trước khi apply thật, không bắt buộc cho DB mới hoàn toàn trống.)

## Bước 1 — tạo database
```sql
CREATE DATABASE phf_hr_verify;
```
Expected: `CREATE DATABASE`. Không owner đặc biệt — DB trống hoàn toàn, sẽ populate bằng schema script.

## Bước 2 — replay foundation schema
```
psql -d phf_hr_verify -f migrations/phf_hr_task_foundation_v1.sql
```
Expected: chạy hết không lỗi, tạo schema `task` + 13 bảng + trigger/function trong `phf_hr_verify` (không phải `phf_hr`).

## Bước 3 — replay category snapshot
```
psql -d phf_hr_verify -f migrations/phf_hr_task_categories_snapshot_v1.sql
```
Expected: INSERT 13 category, không lỗi.

## Bước 4 — grant connect (adapted, KHÔNG chạy nguyên file `phf_hr_isolation_remediation_v1.sql` vì file đó đụng `phfcrm`)
```sql
GRANT CONNECT ON DATABASE phf_hr_verify TO phf_hr_app;
GRANT CONNECT ON DATABASE phf_hr_verify TO phf_hr_runtime;
REVOKE CONNECT, TEMPORARY ON DATABASE phf_hr_verify FROM PUBLIC;
```
Expected: 3 lệnh chạy không lỗi. Membership `phf_hr_runtime → phf_hr_app` (SET LOCAL ROLE) đã có sẵn ở cấp cluster từ khi provisioning `phf_hr` — KHÔNG cần cấp lại.

## Bước 5 — verify quyền connect đúng (read-only)
```sql
select has_database_privilege('phf_hr_runtime','phf_hr_verify','CONNECT') as runtime_can_connect,
       has_database_privilege('phf_hr_app','phf_hr_verify','CONNECT') as app_can_connect,
       has_database_privilege('phf_hr_runtime','phfcrm','CONNECT') as runtime_to_phfcrm_unchanged,
       has_database_privilege('phf_hr_runtime','phf_hr','CONNECT') as runtime_to_phf_hr_unchanged;
```
Expected: `t, t, f, t` (2 cột cuối PHẢI giữ nguyên như trước khi làm gì cả — nếu đổi, STOP báo ngay, đừng đi tiếp).

## Bước 6 — chạy file `phf-hr-verify-b1-schema-inspect-dev.sql` lần 2, lần này trỏ `phf_hr_verify`
```
psql -d phf_hr_verify -f services/phf-hr-api/phf-hr-verify-b1-schema-inspect-dev.sql > phf_hr_verify_schema_dump.txt
```
Dán output này + output đã chạy trên `phf_hr` (Bước B1.2) lại cho tôi — tôi tự diff 2 bản để xác nhận `SCHEMA_PARITY`. KHÔNG tự tuyên bố PASS nếu chưa có cả 2 bản.
