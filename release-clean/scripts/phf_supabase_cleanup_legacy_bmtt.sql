-- PHF Training Hub - Bản 26.2
-- Dọn hồ sơ BMTT cũ khỏi activity_log sau khi đã chuyển sang commitment_records.
--
-- NGUYÊN TẮC AN TOÀN:
-- 1. Chỉ xóa bản ghi activity_log có type = 'confidentiality-commitment'.
-- 2. Chỉ xóa khi đã tìm thấy hồ sơ tương ứng trong commitment_records.
-- 3. Chạy trong transaction; nếu có bản ghi chưa chuyển thì dừng và rollback toàn bộ.
-- 4. Có thể chạy lại nhiều lần.

begin;

create or replace function public.phf_try_jsonb(input_text text)
returns jsonb
language plpgsql
immutable
as $$
begin
  return input_text::jsonb;
exception when others then
  return null;
end;
$$;

do $$
declare
  legacy_total integer;
  matched_total integer;
  unmatched_total integer;
begin
  select count(*)
    into legacy_total
  from public.activity_log
  where type = 'confidentiality-commitment';

  select count(*)
    into matched_total
  from public.activity_log l
  where l.type = 'confidentiality-commitment'
    and exists (
      select 1
      from public.commitment_records c
      where c.employee_id = l.employee_id
        and (
          c.metadata->>'legacyLogId' = l.id
          or c.id = coalesce(
            nullif(public.phf_try_jsonb(l.current_page)->>'id',''),
            'bmtt-' || l.id
          )
          or (
            c.document_version = coalesce(
              nullif(public.phf_try_jsonb(l.current_page)->>'documentVersion',''),
              'PHF-BMTT-LEGACY'
            )
          )
        )
    );

  unmatched_total := legacy_total - matched_total;

  if unmatched_total > 0 then
    raise exception
      'Dừng dọn dữ liệu: còn % bản ghi BMTT cũ chưa có hồ sơ tương ứng trong commitment_records.',
      unmatched_total;
  end if;
end $$;

delete from public.activity_log l
where l.type = 'confidentiality-commitment'
  and exists (
    select 1
    from public.commitment_records c
    where c.employee_id = l.employee_id
      and (
        c.metadata->>'legacyLogId' = l.id
        or c.id = coalesce(
          nullif(public.phf_try_jsonb(l.current_page)->>'id',''),
          'bmtt-' || l.id
        )
        or (
          c.document_version = coalesce(
            nullif(public.phf_try_jsonb(l.current_page)->>'documentVersion',''),
            'PHF-BMTT-LEGACY'
          )
        )
      )
  );

drop function if exists public.phf_try_jsonb(text);

commit;

select
  (select count(*) from public.activity_log where type = 'confidentiality-commitment') as legacy_bmtt_remaining,
  (select count(*) from public.commitment_records) as commitment_records_total,
  (select count(distinct employee_id) from public.commitment_records) as employees_with_commitment;
