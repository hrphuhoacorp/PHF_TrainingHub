begin;

-- =============================================================================
-- PHF TASK — MAIL CONTRACT V1 (transactional mail only) — Company PostgreSQL
-- phf_hr, schema task.
--
-- REVIEW + THROWAWAY APPLY ONLY. Applied by the deployer (postgres superuser +
-- docker) against phf_hr_e2e FIRST. NOT for production until Operator GO.
-- DOWN: migrations/phf_hr_task_mail_v1_DOWN.sql
--
-- SCOPE: the transactional-outbox delivery ledger ONLY. The weekly-report
-- config store (task.mail_settings / task.mail_recipients) is a SEPARATE
-- migration in the Weekly Report / Admin Settings increment — it is not needed
-- to deliver transactional mail.
--
-- WHY A TRANSACTIONAL OUTBOX (mirrors the IN-APP NOTIFICATION V1 pattern):
--   Mail is a SECONDARY channel. The lifecycle write functions in
--   services/phf-hr-api/lib/task-write.js / task-recurrence.js enqueue an
--   outbox row INSIDE their existing withTaskWriteTransaction() -- so the
--   task.events row and the mail_outbox row commit together or not at all.
--   The business write NEVER depends on mail: enqueue is ON CONFLICT DO
--   NOTHING and (before this migration, or with the outbox flag off) a
--   schema-gated no-op. A separate Vercel drainer (the only tier with a
--   network path to People-Master emails + Brevo) claims pending rows,
--   resolves the recipient email, renders, sends, and marks status. phf-hr-api
--   itself never sends mail and never reaches Supabase/Brevo.
--
-- Purely ADDITIVE. No column of task.tasks / task.assignees / task.events is
-- altered. task.events.event_type is NOT touched (mail reuses the event ids the
-- notification path already writes).
-- =============================================================================

set local statement_timeout = '30s';
set local lock_timeout = '10s';

-- task.mail_outbox -- one row per (business event, recipient, channel).
create table task.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  business_event_id uuid references task.events(id) on delete set null,
  event_code text not null,
  task_id uuid references task.tasks(id) on delete set null,
  recipient_employee_code text not null,
  channel text not null default 'email',
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint task_mail_outbox_channel_ck check (channel = 'email'),
  constraint task_mail_outbox_status_ck check (status in ('pending', 'claimed', 'sent', 'skipped', 'failed')),
  constraint task_mail_outbox_recipient_ck check (nullif(trim(recipient_employee_code), '') is not null),
  constraint task_mail_outbox_template_ck check (nullif(trim(template_key), '') is not null),
  constraint task_mail_outbox_dedupe_ck check (nullif(trim(dedupe_key), '') is not null),
  constraint task_mail_outbox_sent_consistency_ck check (
    (status = 'sent' and sent_at is not null) or (status <> 'sent')
  )
);

create unique index task_mail_outbox_dedupe_uq on task.mail_outbox(dedupe_key);
create unique index task_mail_outbox_event_recipient_uq
  on task.mail_outbox(business_event_id, recipient_employee_code, channel)
  where business_event_id is not null;
create index task_mail_outbox_pending_idx
  on task.mail_outbox(created_at) where status in ('pending', 'failed');
create index task_mail_outbox_claimed_idx
  on task.mail_outbox(claimed_at) where status = 'claimed';
create index task_mail_outbox_task_idx on task.mail_outbox(task_id);

comment on table task.mail_outbox is 'PHF Task Mail Contract V1 -- transactional outbox / delivery ledger. Enqueued in-transaction by phf-hr-api lifecycle writes; a Vercel drainer resolves People-Master email, renders, sends via Brevo, marks status. Business writes never depend on this table.';

-- GRANTS -- minimal, explicit (Foundation convention).
grant select, insert, update on task.mail_outbox to phf_hr_app;
revoke delete, truncate, references, trigger on task.mail_outbox from phf_hr_app;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='task' and table_name='mail_outbox') then
    raise exception 'task.mail_outbox missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='task' and indexname='task_mail_outbox_dedupe_uq') then
    raise exception 'task_mail_outbox_dedupe_uq missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='task' and indexname='task_mail_outbox_event_recipient_uq') then
    raise exception 'task_mail_outbox_event_recipient_uq missing';
  end if;
  raise notice 'phf_hr_task_mail_v1: OK';
end $$;

commit;

-- VALIDATION (read-only, run AFTER apply).
select table_name from information_schema.tables where table_schema='task' and table_name = 'mail_outbox';
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='task.mail_outbox'::regclass order by conname;
select indexname from pg_indexes where schemaname='task' and tablename='mail_outbox' order by indexname;
select grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema='task' and table_name = 'mail_outbox'
 group by grantee order by grantee;
