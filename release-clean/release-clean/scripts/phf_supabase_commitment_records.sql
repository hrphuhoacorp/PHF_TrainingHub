-- PHF Training Hub - Tách hồ sơ cam kết BMTT khỏi activity_log
-- Chạy trong Supabase Dashboard -> SQL Editor -> New query -> Run
-- An toàn khi chạy lại nhiều lần.

create table if not exists public.commitment_records (
  id text primary key,
  employee_id text not null references public.employees(id) on delete cascade,
  commitment_type text not null default 'confidentiality',
  document_code text not null default 'PHF-BMTT',
  document_version text not null,
  document_title text not null default 'Cam kết bảo mật thông tin',
  content_snapshot jsonb not null default '{}'::jsonb,
  confirmed_name text,
  confirmed_phone text,
  confirmed_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_commitment_records_employee_id
  on public.commitment_records(employee_id);

create index if not exists idx_commitment_records_confirmed_at
  on public.commitment_records(confirmed_at desc);

create unique index if not exists uq_commitment_records_employee_version
  on public.commitment_records(employee_id, commitment_type, document_version);

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

with legacy as (
  select
    l.id as legacy_log_id,
    l.employee_id,
    l.saved_at,
    public.phf_try_jsonb(l.current_page) as payload
  from public.activity_log l
  where l.type = 'confidentiality-commitment'
),
valid_legacy as (
  select *
  from legacy
  where payload is not null
),
ranked as (
  select *,
    row_number() over (
      partition by employee_id, coalesce(payload->>'documentVersion', 'PHF-BMTT-LEGACY')
      order by saved_at desc, legacy_log_id desc
    ) as rn
  from valid_legacy
)
insert into public.commitment_records (
  id,
  employee_id,
  commitment_type,
  document_code,
  document_version,
  document_title,
  content_snapshot,
  confirmed_name,
  confirmed_phone,
  confirmed_at,
  status,
  created_at,
  updated_at,
  metadata
)
select
  coalesce(nullif(payload->>'id',''), 'bmtt-' || legacy_log_id),
  employee_id,
  'confidentiality',
  'PHF-BMTT',
  coalesce(nullif(payload->>'documentVersion',''), 'PHF-BMTT-LEGACY'),
  'Cam kết bảo mật thông tin',
  payload,
  coalesce(nullif(payload->>'signName',''), nullif(payload->>'fullName','')),
  coalesce(nullif(payload->>'signPhone',''), nullif(payload->>'phone','')),
  coalesce(
    nullif(payload->>'signedAt','')::timestamptz,
    nullif(payload->>'confirmDate','')::date::timestamptz,
    saved_at,
    now()
  ),
  'active',
  coalesce(saved_at, now()),
  coalesce(saved_at, now()),
  jsonb_build_object('migratedFrom', 'activity_log', 'legacyLogId', legacy_log_id)
from ranked
where rn = 1
on conflict (employee_id, commitment_type, document_version)
do update set
  content_snapshot = excluded.content_snapshot,
  confirmed_name = excluded.confirmed_name,
  confirmed_phone = excluded.confirmed_phone,
  confirmed_at = excluded.confirmed_at,
  updated_at = greatest(public.commitment_records.updated_at, excluded.updated_at),
  metadata = public.commitment_records.metadata || excluded.metadata;

drop function if exists public.phf_try_jsonb(text);

-- Kiểm tra nhanh sau khi chạy:
select
  count(*) as total_commitments,
  count(distinct employee_id) as employees_with_commitment
from public.commitment_records;
