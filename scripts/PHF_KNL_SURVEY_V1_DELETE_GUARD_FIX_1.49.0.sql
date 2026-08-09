-- PHF KNL Survey V1 — Production hotfix for polymorphic DELETE trigger.
-- Safe/additive: replaces one function only; trigger bindings remain unchanged.
begin;

create or replace function public.knl_guard_surveyed_structure_delete()
returns trigger
language plpgsql
as $$
declare
  v_version uuid;
  v_old jsonb;
begin
  v_old=to_jsonb(old);
  v_version=case
    when tg_table_name='knl_framework_versions' then nullif(v_old->>'id','')::uuid
    else nullif(v_old->>'version_id','')::uuid
  end;
  if exists(select 1 from public.knl_survey_tickets where version_id=v_version) then
    raise exception 'KNL_SURVEY_REFERENCE_DELETE_GUARD' using errcode='55000';
  end if;
  return old;
end $$;

commit;
