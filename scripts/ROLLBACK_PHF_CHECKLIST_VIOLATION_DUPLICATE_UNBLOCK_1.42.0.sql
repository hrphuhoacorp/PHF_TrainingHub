-- Rollback cho PHF_CHECKLIST_VIOLATION_DUPLICATE_UNBLOCK_1.42.0.sql
--
-- Day la "rollback SCHEMA" (tao lai unique index) - KHONG phai "rollback nghiep vu"
-- va tuyet doi khong lam "rollback du lieu":
--   - rollback CODE  = git revert/redeploy ban code cu (nam ngoai script nay).
--   - rollback SCHEMA = script nay - CHI tao lai uq_checklist_violation_active_fingerprint,
--     khong dong gi den bat ky dong du lieu nao.
--   - rollback NGHIEP VU = quyet dinh lam gi voi cac record hop le (theo nghiep vu moi Batch D1)
--     da duoc tao SAU khi go chan - day la quyet dinh nghiep vu con nguoi, KHONG duoc tu dong
--     hoa trong script SQL nay duoi bat ky hinh thuc nao.
--
-- Script nay TUYET DOI KHONG duoc:
--   - xoa record;
--   - tu dong cancelled record;
--   - sua duplicate_fingerprint;
--   - gop 2 record thanh 1;
--   - giu 1 record roi bo record kia;
--   - lam mat history hoac diem cua bat ky record nao.
-- => Neu preflight duoi day thay du lieu KHONG tuong thich voi unique index cu, script se
--    RAISE EXCEPTION va toan bo transaction se bi Postgres tu dong ROLLBACK (khong co gi duoc
--    ghi, khong co COMMIT "thanh cong" gay hieu lam) - KHONG tu ha cap thanh canh bao roi van
--    commit binh thuong.

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

  if dup_groups > 0 then
    raise exception
      'ROLLBACK SCHEMA DUNG: co % nhom duplicate_fingerprint dang active - day rat co the la cac ban ghi HOP LE theo nghiep vu moi Batch D1 (hai ghi nhan doc lap trung noi dung), khong phai du lieu ban. Tao lai unique index se lam INSERT loi cho du lieu hop le nay, hoac buoc phai xoa/gop/cancelled du lieu hop le de "don duong" - CA HAI deu bi cam trong script nay. Day khong con la loi rollback schema don thuan: schema cu (uq_checklist_violation_active_fingerprint) khong con TUONG THICH voi nghiep vu/du lieu hien tai. Can quyet dinh nghiep vu rieng (rollback nghiep vu) truoc, KHONG chay lai script nay cho toi khi co quyet dinh do.',
      dup_groups;
  end if;

  create unique index if not exists uq_checklist_violation_active_fingerprint
    on public.checklist_violation_records(duplicate_fingerprint)
    where duplicate_fingerprint is not null and record_status <> 'cancelled';
end $$;

commit;

-- Verification (chay sau khi apply rollback THANH CONG - tuc la khong RAISE EXCEPTION):
-- select indexname from pg_indexes where schemaname='public'
--   and tablename='checklist_violation_records' and indexname='uq_checklist_violation_active_fingerprint';
-- -> ky vong 1 dong (da tao lai).
-- Neu script vua chay bao loi (EXCEPTION) - dung nguyen, KHONG co gi thay doi trong DB (Postgres
-- tu rollback ca transaction), code van dang chay ban 1.39.5 (khong con phu thuoc unique index
-- nay de hoat dong dung - xem lib/checklist-violations.js), chi la unique index CHUA duoc tao lai.
