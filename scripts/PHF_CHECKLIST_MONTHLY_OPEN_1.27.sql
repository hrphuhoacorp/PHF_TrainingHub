begin;

alter table public.checklist_monthly_periods
  add column if not exists opened_at timestamptz,
  add column if not exists opened_by text not null default '',
  add column if not exists opened_by_name text not null default '';

alter table public.checklist_monthly_forms
  drop constraint if exists checklist_monthly_forms_status_check;

alter table public.checklist_monthly_forms
  add constraint checklist_monthly_forms_status_check
  check(status in('draft','waiting_self','waiting_review','locked','cancelled'));

update public.checklist_monthly_forms f
set status='draft',updated_at=now()
from public.checklist_monthly_periods p
where f.period_id=p.id
  and p.status='draft'
  and f.status='waiting_self';

create or replace function public.open_checklist_monthly_period(
  p_period_month text,
  p_actor_id text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_period public.checklist_monthly_periods%rowtype;
  v_total integer;
  v_missing_reviewer integer;
  v_missing_template integer;
begin
  select * into v_period
  from public.checklist_monthly_periods
  where period_month=p_period_month
  for update;

  if v_period.id is null then
    return jsonb_build_object('ok',false,'code','PERIOD_NOT_FOUND','message','Chưa có kỳ đánh giá để mở.');
  end if;

  if v_period.status='locked' then
    return jsonb_build_object('ok',false,'code','PERIOD_LOCKED','message','Kỳ đánh giá đã khóa.');
  end if;

  if v_period.status='open' then
    return jsonb_build_object('ok',true,'alreadyOpen',true,'total',
      (select count(*) from public.checklist_monthly_forms where period_id=v_period.id));
  end if;

  select count(*),
         count(*) filter(where coalesce(reviewer_id,'')='' and coalesce(reviewer_code,'')=''),
         count(*) filter(where coalesce(template_id,'')='' or coalesce(template_version,'')='')
  into v_total,v_missing_reviewer,v_missing_template
  from public.checklist_monthly_forms
  where period_id=v_period.id and status<>'cancelled';

  if v_total=0 then
    return jsonb_build_object('ok',false,'code','NO_FORMS','message','Kỳ này chưa có phiếu để mở.');
  end if;
  if v_missing_reviewer>0 then
    return jsonb_build_object('ok',false,'code','MISSING_REVIEWER','message',
      'Còn '||v_missing_reviewer||' phiếu chưa có người thẩm định.','missingReviewer',v_missing_reviewer);
  end if;
  if v_missing_template>0 then
    return jsonb_build_object('ok',false,'code','MISSING_TEMPLATE','message',
      'Còn '||v_missing_template||' phiếu chưa đủ mẫu hoặc phiên bản.','missingTemplate',v_missing_template);
  end if;

  update public.checklist_monthly_forms
  set status='waiting_self',updated_at=now()
  where period_id=v_period.id and status='draft';

  update public.checklist_monthly_periods
  set status='open',opened_at=now(),opened_by=coalesce(p_actor_id,''),
      opened_by_name=coalesce(p_actor_name,''),updated_at=now()
  where id=v_period.id;

  return jsonb_build_object('ok',true,'alreadyOpen',false,'total',v_total);
end;
$$;

revoke all on function public.open_checklist_monthly_period(text,text,text) from public,anon,authenticated;
grant execute on function public.open_checklist_monthly_period(text,text,text) to service_role;

commit;
