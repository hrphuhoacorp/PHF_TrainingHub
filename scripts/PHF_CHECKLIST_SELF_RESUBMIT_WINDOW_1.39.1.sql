begin;

create or replace function public.phf_save_checklist_monthly_self(
  p_form_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_expected_checklist_score numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_saved public.checklist_monthly_forms%rowtype;
  v_current_score numeric;
  v_status text;
begin
  select * into v_form from public.checklist_monthly_forms where id=p_form_id for update;
  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_SELF_NOT_FOUND','message','Không tìm thấy phiếu tự đánh giá.'); end if;
  if v_form.status not in ('waiting_self','waiting_review') then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_NOT_WAITING_SELF','message','Phiếu không còn ở bước tự đánh giá.');
  end if;
  if p_expected_updated_at is null or v_form.updated_at is distinct from p_expected_updated_at then
    raise exception 'CHECKLIST_MONTHLY_SELF_STALE:%',p_form_id;
  end if;

  select greatest(0,100-coalesce(sum(greatest(coalesce(v.points,0),0)),0)) into v_current_score
  from public.checklist_violation_records v
  where upper(v.employee_code)=upper(v_form.employee_code)
    and v.is_test=false and v.record_status='official'
    and v.occurred_date>=(v_form.period_month||'-01')::date
    and v.occurred_date<((v_form.period_month||'-01')::date+interval '1 month');
  if abs(v_current_score-coalesce(p_expected_checklist_score,-999999))>0.0001 then
    raise exception 'CHECKLIST_MONTHLY_SELF_SCORE_CHANGED:%:%',v_current_score,p_expected_checklist_score;
  end if;

  v_status:=case when p_patch ? 'status' then p_patch->>'status' else v_form.status end;
  if v_status not in ('waiting_self','waiting_review') then raise exception 'CHECKLIST_MONTHLY_SELF_STATUS_INVALID'; end if;

  update public.checklist_monthly_forms set
    self_answers=coalesce(p_patch->'self_answers',self_answers),
    self_note=case when p_patch ? 'self_note' then coalesce(p_patch->>'self_note','') else self_note end,
    checklist_score=v_current_score,
    self_total_score=case when p_patch ? 'self_total_score' then (p_patch->>'self_total_score')::numeric else self_total_score end,
    self_saved_at=case when p_patch ? 'self_saved_at' then nullif(p_patch->>'self_saved_at','')::timestamptz else self_saved_at end,
    self_submitted_at=case when p_patch ? 'self_submitted_at' then nullif(p_patch->>'self_submitted_at','')::timestamptz else self_submitted_at end,
    status=v_status,
    updated_at=coalesce(nullif(p_patch->>'updated_at','')::timestamptz,now())
  where id=p_form_id
  returning * into v_saved;
  return jsonb_build_object('ok',true,'form',to_jsonb(v_saved));
end;
$$;

revoke all on function public.phf_save_checklist_monthly_self(uuid,jsonb,timestamptz,numeric) from public,anon,authenticated;
grant execute on function public.phf_save_checklist_monthly_self(uuid,jsonb,timestamptz,numeric) to service_role;

commit;
