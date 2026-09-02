begin;

-- =============================================================================
-- PHF Task — CANCEL POLICY V1 — company PostgreSQL `phf_hr`, schema `task`.
--
-- REVIEW + THROWAWAY APPLY ONLY. Applied by the deployer (postgres superuser +
-- docker) against phf_hr_e2e FIRST (deployer-apply-cancel-request-v1-throwaway.sh).
-- NOT for production until Operator GO. DOWN: phf_hr_task_cancel_request_v1_DOWN.sql
--
-- Business rule (LOCKED 2026-08-31 — CANCEL POLICY V1):
--   - Direct "Hủy công việc" is allowed ONLY for the creator/assigner and
--     authorized management roles (system_admin / executive_authority /
--     exception authority) per the existing api/_lib/task-permissions.js
--     architecture.
--   - The current active primary recipient (and a proposer) is NEVER a direct
--     canceller unless they separately hold one of those management bases. A
--     plain active primary may only submit a "Yêu cầu hủy" (cancellation
--     request) with a mandatory reason.
--   - An authorized reviewer approves (-> canonical task_cancel lifecycle) or
--     rejects (Task stays active). The requester may withdraw a pending one.
--   - completed / cancelled / draft state rules unchanged. Audit is never
--     deleted or hidden.
--
-- Purely ADDITIVE, mirrors the Proposal V2 pattern:
--   + task.cancel_requests            (one mutable row per request; state
--                                      machine pending -> approved|rejected|withdrawn)
--   + 2 event_type values 'cancel_request', 'cancel_request_decision'
--   + GRANT select,insert,update to phf_hr_app
-- Does NOT alter task.tasks / task.assignees / task.events columns. The full
-- audit trail lives in task.events (not in this table), same as
-- task.proposal_decisions.
-- =============================================================================

create table task.cancel_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete restrict,
  status text not null default 'pending',
  reason text not null,
  requested_by_employee_code text,
  requested_by_account_id text,
  requested_at timestamptz not null default now(),
  decided_by_employee_code text,
  decided_by_account_id text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_cancel_requests_status_ck check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint task_cancel_requests_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_cancel_requests_requester_ck check (
    nullif(trim(coalesce(requested_by_employee_code, '')), '') is not null
    or nullif(trim(coalesce(requested_by_account_id, '')), '') is not null
  ),
  constraint task_cancel_requests_decided_consistency_ck check (
    (status = 'pending' and decided_by_employee_code is null and decided_by_account_id is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null and (
      nullif(trim(coalesce(decided_by_employee_code, '')), '') is not null
      or nullif(trim(coalesce(decided_by_account_id, '')), '') is not null))
  )
);

-- At most ONE open request per Task (duplicate-pending safety at the DB level:
-- a racing double-submit gets a clean unique violation, not two rows).
create unique index task_cancel_requests_one_pending_per_task_uq
  on task.cancel_requests(task_id) where status = 'pending';
create index task_cancel_requests_task_idx on task.cancel_requests(task_id, requested_at desc);
create index task_cancel_requests_status_idx on task.cancel_requests(status);

comment on table task.cancel_requests is 'PHF Task Cancel Policy V1 — a persisted "Yeu cau huy" from the active primary. State machine pending -> approved|rejected|withdrawn, separate from task.tasks.status. Approve routes through the canonical task_cancel lifecycle. Full audit in task.events (cancel_request / cancel_request_decision).';

-- -----------------------------------------------------------------------------
-- task.events — additive: 2 new event_type values. No existing value changed.
-- -----------------------------------------------------------------------------
alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change',
  'proposal_accept', 'proposal_reject', 'proposal_cancel',
  'recurring_generated',
  'cancel_request', 'cancel_request_decision'
));

-- -----------------------------------------------------------------------------
-- GRANTS — minimal, explicit (Foundation convention). cancel_requests needs
-- UPDATE for the pending -> terminal transition (same reasoning as
-- proposal_decisions); the append-only audit is task.events, not this table.
-- -----------------------------------------------------------------------------
grant select, insert, update on task.cancel_requests to phf_hr_app;
revoke delete, truncate, references, trigger on task.cancel_requests from phf_hr_app;

commit;

-- =============================================================================
-- VALIDATION (read-only, run AFTER apply).
-- =============================================================================
select table_name from information_schema.tables where table_schema='task' and table_name='cancel_requests';
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='task.cancel_requests'::regclass order by conname;
select indexname from pg_indexes where schemaname='task' and tablename='cancel_requests' order by indexname;
select pg_get_constraintdef(oid) from pg_constraint where conname='task_events_event_type_ck';
select grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema='task' and table_name='cancel_requests' group by grantee order by grantee;
