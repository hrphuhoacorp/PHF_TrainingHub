-- =============================================================================
-- PHF TASK — MAIL V1 Increment 2 — DOWN (throwaway rollback only). Never on PROD.
-- =============================================================================
begin;
set local statement_timeout = '30s';
drop table if exists task.mail_recipients;
drop table if exists task.mail_settings;
commit;
