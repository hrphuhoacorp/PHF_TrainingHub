begin;
-- DOWN for phf_hr_task_attachment_actor_identity_v1.sql — THROWAWAY / rollback
-- only. Refuses to run if any row already relies on the relaxed shape
-- (account-only uploader, or a populated deleted_by_account_id).
do $$ begin
  if exists (
    select 1 from task.attachments
    where nullif(trim(both from uploaded_by_employee_code), '') is null
       or nullif(trim(both from uploaded_by_account_id), '') is not null
       or nullif(trim(both from deleted_by_account_id), '') is not null
  ) then
    raise exception 'cannot roll back: task.attachments has account-identity rows';
  end if;
end $$;

alter table task.attachments drop constraint if exists task_attachments_deleted_by_acct_ck;
alter table task.attachments drop constraint if exists task_attachments_uploaded_by_present_ck;

alter table task.attachments drop constraint if exists task_attachments_uploaded_by_ck;
alter table task.attachments
  add constraint task_attachments_uploaded_by_ck
  check (nullif(trim(both from uploaded_by_employee_code), '') is not null);

alter table task.attachments drop column if exists deleted_by_account_id;
alter table task.attachments drop column if exists uploaded_by_account_id;

alter table task.attachments
  alter column uploaded_by_employee_code set not null;

commit;
