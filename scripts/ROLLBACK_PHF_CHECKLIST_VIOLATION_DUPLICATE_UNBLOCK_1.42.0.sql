-- Rollback cho PHF_CHECKLIST_VIOLATION_DUPLICATE_UNBLOCK_1.42.0.sql
-- Tao lai unique index theo fingerprint - CHI khi tai thoi diem rollback khong co du lieu
-- dang trung active (dung dung logic dieu kien nhu ban goc PHF_CHECKLIST_VIOLATION_SAFETY_1.14.sql).
-- Neu sau khi go chan (1.42.0) he thong da thuc su tao ra cac ban ghi trung noi dung hop le
-- (Case 3/4/6 - dung y muon), rollback nay se KHONG tu tao lai unique index (vi lam vay se
-- lam mat du lieu that hop le hoac gay loi insert cho cac ban ghi hop le da ton tai) - script
-- se rai NOTICE va dung, cho phuong an cleanup/rollback nghiep vu rieng, khong tu quyet.

begin;

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

  if dup_groups = 0 then
    execute 'create unique index if not exists uq_checklist_violation_active_fingerprint
             on public.checklist_violation_records(duplicate_fingerprint)
             where duplicate_fingerprint is not null and record_status <> ''cancelled''';
  else
    raise notice 'KHONG tao lai uq_checklist_violation_active_fingerprint: co % nhom duplicate_fingerprint dang active (co the la ban ghi hop le theo nghiep vu moi Batch D1). Rollback dung o day - can phuong an cleanup/quyet dinh nghiep vu rieng truoc khi tao lai unique constraint nay.', dup_groups;
  end if;
end $$;

commit;

-- Verification (chay sau khi apply rollback):
-- select indexname from pg_indexes where schemaname='public'
--   and tablename='checklist_violation_records' and indexname like '%fingerprint%';
