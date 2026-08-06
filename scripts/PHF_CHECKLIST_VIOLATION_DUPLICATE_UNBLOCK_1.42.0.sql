-- PHF Checklist Batch D1 - go nghiep vu chan hai ghi nhan doc lap (Case 3/4/6)
-- Nguon: uq_checklist_violation_active_fingerprint (tao tu PHF_CHECKLIST_VIOLATION_SAFETY_1.14.sql)
-- la unique index THEO NOI DUNG (employee_code|criterion_code|occurred_date|occurred_time(5)|
-- location|note), khong phan biet duoc "gui lap ky thuat" voi "hai ghi nhan nghiep vu doc lap
-- trung noi dung" (vi du: Giam sat va Truong ca cung ghi 1 nhan vien, cung tieu chi, cung ngay).
-- Idempotency ky thuat sau Batch D1 chi con dua vao uq_checklist_violation_request_id (khong doi,
-- khong xoa o day). duplicate_fingerprint/idx_checklist_violation_duplicate_fingerprint (non-unique,
-- cung dieu kien) VAN GIU LAI lam du lieu audit/nhan "Cung loi N lan trong ngay" sau nay.
--
-- Preflight audit (2026-08-06, Production):
--   select duplicate_fingerprint, count(*) from checklist_violation_records
--   where duplicate_fingerprint is not null and record_status<>'cancelled'
--   group by duplicate_fingerprint having count(*)>1;
--   -> 0 rows. Khong co du lieu dang trung active can don dep truoc khi drop.
--
-- Script nay CHUA duoc chay tren Production trong lan lam Batch D1 nay.

begin;

-- An toan kep: chan tay du lieu da thay doi ke tu preflight audit truoc khi drop.
-- Neu co nhom trung active moi xuat hien, DUNG va bao lai truoc khi tiep tuc.
do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select duplicate_fingerprint
    from public.checklist_violation_records
    where duplicate_fingerprint is not null
      and record_status <> 'cancelled'
    group by duplicate_fingerprint
    having count(*) > 1
  ) g;

  if dup_groups > 0 then
    raise exception
      'Phat hien % nhom duplicate_fingerprint dang active - DUNG migration, doi soat lai truoc khi drop unique index.',
      dup_groups;
  end if;
end $$;

drop index if exists public.uq_checklist_violation_active_fingerprint;

-- idx_checklist_violation_duplicate_fingerprint (non-unique, cung dieu kien duplicate_fingerprint
-- is not null and record_status<>'cancelled') KHONG bi dong den - van con nguyen de ho tro truy
-- van audit/nhan "N lan trong ngay" sau nay, khong can tao lai.

commit;

-- Verification (chay sau khi apply):
-- 1) Xac nhan unique index da mat, non-unique index van con:
--    select indexname from pg_indexes where schemaname='public'
--      and tablename='checklist_violation_records' and indexname like '%fingerprint%';
--    -> ky vong CHI con 'idx_checklist_violation_duplicate_fingerprint', KHONG con
--       'uq_checklist_violation_active_fingerprint'.
-- 2) Xac nhan request_id unique index khong bi dong den:
--    select indexname from pg_indexes where schemaname='public'
--      and tablename='checklist_violation_records' and indexname='uq_checklist_violation_request_id';
--    -> ky vong van con 1 dong.
