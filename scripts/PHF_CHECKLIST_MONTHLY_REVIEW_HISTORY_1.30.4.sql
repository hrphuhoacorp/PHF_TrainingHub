begin;

create or replace function public.log_checklist_monthly_review_history()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_action text;
begin
  if new.review_saved_at is not distinct from old.review_saved_at then
    return new;
  end if;

  v_action=case
    when old.status='waiting_review' and new.status='reviewed' then 'complete_review'
    else 'save_review_draft'
  end;

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name,changed_at
  ) values(
    new.id,new.period_month,new.employee_code,v_action,
    jsonb_build_object(
      'status',old.status,
      'reviewAnswers',coalesce(old.review_answers,'{}'::jsonb),
      'checklistReviewScore',old.checklist_review_score,
      'reviewNote',coalesce(old.review_note,'')
    ),
    jsonb_build_object(
      'status',new.status,
      'reviewAnswers',coalesce(new.review_answers,'{}'::jsonb),
      'checklistReviewScore',new.checklist_review_score,
      'reviewNote',coalesce(new.review_note,''),
      'adminOverride',coalesce(new.reviewed_as_override,false)
    ),
    case
      when coalesce(new.reviewed_as_override,false) then coalesce(nullif(new.review_override_reason,''),'Admin xử lý thay')
      when v_action='complete_review' then 'Hoàn tất thẩm định'
      else 'Lưu nháp thẩm định'
    end,
    new.reviewed_by,new.reviewed_by_code,new.reviewed_by_name,now()
  );
  return new;
end;
$$;

drop trigger if exists checklist_monthly_review_history_trigger
  on public.checklist_monthly_forms;

create trigger checklist_monthly_review_history_trigger
after update of review_saved_at,status on public.checklist_monthly_forms
for each row
execute function public.log_checklist_monthly_review_history();

commit;
