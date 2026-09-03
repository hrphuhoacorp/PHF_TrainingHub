-- =============================================================================
-- PHF TASK — MAIL CONTRACT V1 — DOWN (throwaway rollback only)
-- Reverts migrations/phf_hr_task_mail_v1.sql. THROWAWAY ONLY. Never on PROD.
-- =============================================================================
begin;
set local statement_timeout = '30s';
drop table if exists task.mail_outbox;
commit;
