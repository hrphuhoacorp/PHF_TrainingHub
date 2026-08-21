-- PHF Checklist 1.53.0 · Workstream A2 — Version-copy + Retroactive-apply engine
-- Tổng quát hoá tiền lệ phf_save_marketing_monthly_kpi() (1.38.52, chỉ 2 mẫu Marketing,
-- chỉ trước self-start) thành một cơ chế KHÔNG hardcode theo template_key, có audit đầy
-- đủ, idempotent theo batch_id, hỗ trợ dry-run, và tôn trọng ranh giới trạng thái phiếu:
--   draft/waiting_self/waiting_review (chưa có câu trả lời gắn dòng đổi) -> remap tại chỗ
--   draft/waiting_self/waiting_review (đã có câu trả lời)                -> remap theo id,
--     dòng không còn tồn tại -> KHÔNG tự xoá câu trả lời, đánh dấu "cần Admin xác nhận"
--   reviewed -> KHÔNG remap tự động trong batch thường; cần RPC riêng
--     phf_retroactive_apply_reviewed_form với p_confirm=true + lý do
--   locked / cancelled -> KHÔNG BAO GIỜ bị đụng bởi engine này (không có ngoại lệ ở đây)
--
-- Logic remap/diff JS thuần tương đương: lib/checklist-template-retroactive.js
-- (dùng để unit-test in-memory, không cần Supabase thật).
--
-- LƯU Ý VẬN HÀNH (đọc trước khi chạy): file này viết theo đúng quy ước migration của repo
-- (đặt cạnh phf_save_checklist_template, phf_save_marketing_monthly_kpi) nhưng CHƯA được
-- thực thi trong batch kỹ thuật 2026-08-14 vì môi trường hiện tại chỉ có một Supabase
-- project cấu hình (SUPABASE_URL trong .env) và đó là project đang phục vụ Production —
-- không có Supabase local/dev riêng để xác minh an toàn trước. Chạy thủ công (qua Supabase
-- SQL editor / CLI) khi đã xác nhận đúng target, và ưu tiên test trên project staging nếu
-- có trước khi áp dụng cho Production.

begin;
create extension if not exists pgcrypto;

-- ============================================================================
-- 1) Audit: mỗi lần retroactive-apply (kể cả dry-run) tạo 1 batch; mỗi phiếu bị xét tới
--    trong batch có 1 dòng item ghi outcome + before/after.
-- ============================================================================
create table if not exists public.checklist_retroactive_batches(
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique,
  template_key text not null,
  old_version_no text not null,
  new_version_no text not null,
  period_month_from text,
  period_month_to text,
  scope_filter jsonb not null default '{}'::jsonb,
  reason text not null default '',
  dry_run boolean not null default false,
  reviewed_adjustment boolean not null default false,
  actor_id text,
  actor_code text,
  actor_name text,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_retroactive_batch_items(
  id uuid primary key default gen_random_uuid(),
  batch_row_id uuid references public.checklist_retroactive_batches(id) on delete cascade,
  batch_id uuid not null,
  form_id uuid not null,
  employee_code text,
  period_month text,
  outcome text not null,
  reason text not null default '',
  before_snapshot jsonb,
  after_snapshot jsonb,
  unmapped_self_codes text[] not null default '{}',
  unmapped_review_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(batch_id,form_id)
);

create index if not exists checklist_retroactive_batches_template_idx
  on public.checklist_retroactive_batches(template_key,old_version_no,new_version_no);
create index if not exists checklist_retroactive_batch_items_batch_idx
  on public.checklist_retroactive_batch_items(batch_id,outcome);
-- Tra cứu lịch sử retroactive-apply theo 1 phiếu cụ thể (vd: UI hiển thị "phiếu này từng bị
-- điều chỉnh bởi batch nào") - batch_idx ở trên không phủ khi query theo form_id một mình.
create index if not exists checklist_retroactive_batch_items_form_idx
  on public.checklist_retroactive_batch_items(form_id);

alter table public.checklist_retroactive_batches enable row level security;
alter table public.checklist_retroactive_batch_items enable row level security;
revoke all on public.checklist_retroactive_batches from anon,authenticated;
revoke all on public.checklist_retroactive_batch_items from anon,authenticated;

-- ============================================================================
-- 2) Copy version — clone 1 checklist_template_versions row sang version_no mới cho
--    cùng template_key. Không tạo bảng mới: dùng đúng shape checklist_template_versions
--    đã có (source_version trỏ về bản gốc). Admin-only được enforce ở tầng JS (giống
--    saveOne() trong lib/checklist-templates.js) trước khi gọi RPC — RPC chỉ chạy dưới
--    service_role (security definer, revoke anon/authenticated), đúng quy ước hiện có.
-- ============================================================================
create or replace function public.phf_copy_checklist_template_version(
  p_template_key text,
  p_source_version text,
  p_new_version text,
  p_effective_date date,
  p_reason text default '',
  p_definition_override jsonb default null,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_key text := lower(trim(coalesce(p_template_key,'')));
  v_source public.checklist_template_versions%rowtype;
  v_definition jsonb;
  v_new public.checklist_template_versions%rowtype;
begin
  -- Risk gate 1.53.0 (review): không có khoá này, 2 lần gọi gần như đồng thời cùng
  -- (template_key, p_new_version) đều có thể vượt qua bước "exists" bên dưới trước khi
  -- INSERT nào commit, rồi cùng INSERT — unique(template_key,version_no) ở tầng DB (đã có
  -- từ 1.7.90) vẫn chặn được dòng thứ 2 nên KHÔNG mất toàn vẹn dữ liệu, nhưng request đó sẽ
  -- nhận lỗi unique_violation thô thay vì CHECKLIST_RETRO_TARGET_VERSION_EXISTS thân thiện.
  -- Khoá theo cùng namespace 'phf_checklist_template|'||v_key mà phf_save_checklist_template
  -- (1.54.0) dùng — nhờ vậy 2 thao tác "sửa mẫu thường" và "copy version retroactive" trên
  -- CÙNG template_key cũng tự serialize với nhau, không chỉ với chính nó.
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template|'||v_key));

  select * into v_source from public.checklist_template_versions
   where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(p_source_version,''))
   order by created_at desc limit 1;
  if v_source.template_key is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_SOURCE_VERSION_NOT_FOUND','message','Không tìm thấy phiên bản nguồn để sao chép.');
  end if;
  if exists(select 1 from public.checklist_template_versions where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(p_new_version,''))) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_TARGET_VERSION_EXISTS','message','Phiên bản mới đã tồn tại, chọn số phiên bản khác.');
  end if;
  v_definition := coalesce(p_definition_override, v_source.definition);
  insert into public.checklist_template_versions(
    template_key,version_no,effective_date,reason,source_version,change_type,definition,created_at
  ) values(
    v_key,trim(p_new_version),p_effective_date,coalesce(nullif(trim(p_reason),''),'Sao chép từ phiên bản '||v_source.version_no),
    v_source.version_no,'retroactive-copy',v_definition,now()
  ) returning * into v_new;
  return jsonb_build_object('ok',true,'templateKey',v_key,'versionNo',v_new.version_no,'sourceVersion',v_source.version_no,'definition',v_new.definition);
end;
$$;
revoke all on function public.phf_copy_checklist_template_version(text,text,text,date,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phf_copy_checklist_template_version(text,text,text,date,text,jsonb,text,text) to service_role;

-- ============================================================================
-- 3) Retroactive apply — batch thường (draft/waiting_self/waiting_review). Không bao giờ
--    đụng reviewed/locked/cancelled (xem nhánh case bên dưới). Idempotent theo p_batch_id:
--    nếu batch_id đã tồn tại trong checklist_retroactive_batches, trả lại kết quả cũ thay
--    vì áp dụng lại (kể cả khi gọi lại đúng tham số). p_dry_run=true KHÔNG ghi bất kỳ thay
--    đổi nào (kể cả audit batch) — chỉ tính và trả preview.
-- ============================================================================
create or replace function public.phf_retroactive_apply_checklist_template(
  p_batch_id uuid,
  p_template_key text,
  p_old_version text,
  p_new_version text,
  p_period_month_from text default null,
  p_period_month_to text default null,
  p_reason text default '',
  p_dry_run boolean default true,
  p_actor_id text default '',
  p_actor_code text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_key text := lower(trim(coalesce(p_template_key,'')));
  v_old_def jsonb; v_new_def jsonb;
  v_existing_batch public.checklist_retroactive_batches%rowtype;
  v_batch_row_id uuid;
  v_form record;
  v_outcome text; v_reason text;
  v_self jsonb; v_review jsonb;
  v_unmapped_self text[]; v_unmapped_review text[];
  v_counts jsonb := '{}'::jsonb;
  v_applied int := 0; v_skipped_locked int := 0; v_skipped_unmapped int := 0; v_requires_reviewed int := 0; v_failed int := 0;
  -- Bổ sung 2026-08-14 (audit A9): counts một mình không đủ cho UI Bước 7/8 hiển thị
  -- "danh sách phiếu bị chặn/không ánh xạ được để theo dõi" - kể cả ở dry-run (không ghi
  -- checklist_retroactive_batch_items) UI vẫn cần thấy TỪNG phiếu, không chỉ tổng số. Gom
  -- trong cùng vòng lặp đang có sẵn, không query lại - không đổi hành vi ghi dữ liệu hiện có.
  v_items jsonb := '[]'::jsonb;
begin
  if p_batch_id is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_BATCH_ID_REQUIRED','message','Thiếu batch_id.');
  end if;

  -- Khoá advisory theo batch_id trước khi kiểm tra idempotent-replay: nếu không có khoá này,
  -- 2 lần gọi đồng thời cùng batch_id (double-click / network retry - đúng kịch bản UI Bước 8
  -- phải test) có thể cùng vượt qua "select ... where batch_id=" (chưa insert kịp) rồi cùng
  -- insert, vi phạm unique(batch_id) và trả lỗi thô thay vì phản hồi idempotent-replay thân
  -- thiện. Theo đúng tiền lệ phf_save_checklist_template (pg_advisory_xact_lock theo key).
  perform pg_advisory_xact_lock(hashtext('phf_checklist_retroactive_batch|'||p_batch_id::text));

  select * into v_existing_batch from public.checklist_retroactive_batches where batch_id=p_batch_id;
  if v_existing_batch.id is not null then
    return jsonb_build_object('ok',true,'idempotentReplay',true,'batchId',p_batch_id,'counts',v_existing_batch.counts,
      'message','batch_id đã được áp dụng trước đó — không chạy lại (idempotent).');
  end if;

  select definition into v_old_def from public.checklist_template_versions
   where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(p_old_version,'')) order by created_at desc limit 1;
  select definition into v_new_def from public.checklist_template_versions
   where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(p_new_version,'')) order by created_at desc limit 1;
  if v_old_def is null or v_new_def is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_VERSION_NOT_FOUND','message','Không tìm thấy phiên bản cũ hoặc mới của mẫu.');
  end if;

  if not p_dry_run then
    insert into public.checklist_retroactive_batches(
      batch_id,template_key,old_version_no,new_version_no,period_month_from,period_month_to,
      reason,dry_run,actor_id,actor_code,actor_name
    ) values(
      p_batch_id,v_key,p_old_version,p_new_version,p_period_month_from,p_period_month_to,
      p_reason,false,p_actor_id,p_actor_code,p_actor_name
    ) returning id into v_batch_row_id;
  end if;

  for v_form in
    select * from public.checklist_monthly_forms
    where lower(trim(template_id))=v_key
      and trim(coalesce(template_version,''))=trim(coalesce(p_old_version,''))
      and (p_period_month_from is null or period_month>=p_period_month_from)
      and (p_period_month_to is null or period_month<=p_period_month_to)
    order by id
  loop
    if v_form.status='locked' then
      v_outcome:='skipped-locked'; v_reason:='Phiếu đã khóa — không có ngoại lệ tự động trong batch này.';
      v_skipped_locked := v_skipped_locked+1;
    elsif v_form.status='cancelled' then
      v_outcome:='skipped-cancelled'; v_reason:='Phiếu đã hủy — không thuộc phạm vi.';
    elsif v_form.status='reviewed' then
      v_outcome:='requires-reviewed-adjustment'; v_reason:='Phiếu đã thẩm định — cần phf_retroactive_apply_reviewed_form riêng.';
      v_requires_reviewed := v_requires_reviewed+1;
    elsif v_form.status not in('draft','waiting_self','waiting_review') then
      v_outcome:='skipped-unknown-status'; v_reason:='Trạng thái phiếu ngoài phạm vi áp dụng.';
    else
      -- remap theo id ổn định: dòng nào tồn tại ở definition mới với cùng id -> giữ câu trả lời theo mã mới.
      with old_rows as(
        select coalesce(nullif(value->>'id',''),value->>'code') id, value->>'code' code
        from jsonb_array_elements(coalesce(v_old_def->'totalRows','[]'::jsonb)) value
      ), new_rows as(
        select coalesce(nullif(value->>'id',''),value->>'code') id, value->>'code' code
        from jsonb_array_elements(coalesce(v_new_def->'totalRows','[]'::jsonb)) value
      ), self_in as(
        select key old_code, value from jsonb_each(coalesce(v_form.self_answers,'{}'::jsonb))
      ), self_mapped as(
        select n.code new_code, si.value, (n.code is null) as is_unmapped, si.old_code
        from self_in si
        left join old_rows o on o.code=si.old_code
        left join new_rows n on n.id=o.id
      )
      select
        jsonb_object_agg(new_code,value) filter(where new_code is not null),
        array_agg(old_code) filter(where is_unmapped)
      into v_self, v_unmapped_self
      from self_mapped;

      with old_rows as(
        select coalesce(nullif(value->>'id',''),value->>'code') id, value->>'code' code
        from jsonb_array_elements(coalesce(v_old_def->'totalRows','[]'::jsonb)) value
      ), new_rows as(
        select coalesce(nullif(value->>'id',''),value->>'code') id, value->>'code' code
        from jsonb_array_elements(coalesce(v_new_def->'totalRows','[]'::jsonb)) value
      ), review_in as(
        select key old_code, value from jsonb_each(coalesce(v_form.review_answers,'{}'::jsonb))
      ), review_mapped as(
        select n.code new_code, value, (n.code is null) as is_unmapped, review_in.old_code
        from review_in
        left join old_rows o on o.code=review_in.old_code
        left join new_rows n on n.id=o.id
      )
      select
        jsonb_object_agg(new_code,value) filter(where new_code is not null),
        array_agg(old_code) filter(where is_unmapped)
      into v_review, v_unmapped_review
      from review_mapped;

      if coalesce(array_length(v_unmapped_self,1),0)>0 or coalesce(array_length(v_unmapped_review,1),0)>0 then
        v_outcome:='skipped-unmapped';
        v_reason:='Có câu trả lời gắn với dòng đã bị xóa ở phiên bản mới — cần Admin xác nhận thủ công.';
        v_skipped_unmapped := v_skipped_unmapped+1;
      else
        v_outcome:='applied';
        v_reason:='Remap thành công theo id ổn định (hoặc phiếu chưa có câu trả lời).';
        v_applied := v_applied+1;
        if not p_dry_run then
          update public.checklist_monthly_forms set
            template_version=p_new_version,
            template_snapshot=jsonb_set(jsonb_set(template_snapshot,'{version,definition}',v_new_def,true),'{version,version_no}',to_jsonb(p_new_version),true),
            self_answers=coalesce(v_self,v_form.self_answers,'{}'::jsonb),
            review_answers=coalesce(v_review,v_form.review_answers,'{}'::jsonb),
            updated_at=now()
          where id=v_form.id;
        end if;
      end if;
    end if;

    -- Ghi vào v_items cho MỌI phiếu có outcome != 'applied' (kể cả dry-run) để UI có danh
    -- sách theo dõi ngay tại Bước 5/7, không phải chờ tới khi apply thật rồi tự query bảng
    -- audit. Phiếu 'applied' không cần liệt kê (không phải việc cần theo dõi thủ công).
    if v_outcome is not null and v_outcome<>'applied' then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'formId',v_form.id,'employeeCode',v_form.employee_code,'periodMonth',v_form.period_month,
        'outcome',v_outcome,'reason',v_reason,
        'unmappedSelfCodes',to_jsonb(coalesce(v_unmapped_self,'{}')),
        'unmappedReviewCodes',to_jsonb(coalesce(v_unmapped_review,'{}'))
      ));
    end if;

    if not p_dry_run then
      insert into public.checklist_retroactive_batch_items(
        batch_row_id,batch_id,form_id,employee_code,period_month,outcome,reason,
        before_snapshot,after_snapshot,unmapped_self_codes,unmapped_review_codes
      ) values(
        v_batch_row_id,p_batch_id,v_form.id,v_form.employee_code,v_form.period_month,v_outcome,v_reason,
        jsonb_build_object('templateVersion',v_form.template_version),
        jsonb_build_object('templateVersion',case when v_outcome='applied' then p_new_version else v_form.template_version end),
        coalesce(v_unmapped_self,'{}'),coalesce(v_unmapped_review,'{}')
      );
    end if;
  end loop;

  v_counts := jsonb_build_object('applied',v_applied,'skippedLocked',v_skipped_locked,'skippedUnmapped',v_skipped_unmapped,'requiresReviewedAdjustment',v_requires_reviewed,'failed',v_failed);

  if not p_dry_run then
    update public.checklist_retroactive_batches set counts=v_counts where id=v_batch_row_id;
  end if;

  return jsonb_build_object('ok',true,'batchId',p_batch_id,'dryRun',p_dry_run,'counts',v_counts,'items',v_items);
end;
$$;
revoke all on function public.phf_retroactive_apply_checklist_template(uuid,text,text,text,text,text,text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_retroactive_apply_checklist_template(uuid,text,text,text,text,text,text,boolean,text,text,text) to service_role;

-- ============================================================================
-- 4) Reviewed-form adjustment — CON ĐƯỜNG RIÊNG, tách biệt hoàn toàn khỏi batch apply
--    thường. Bắt buộc p_confirm=true + p_reason >= 10 ký tự. KHÔNG được gọi lồng vào
--    RPC ở mục 3.
-- ============================================================================
create or replace function public.phf_retroactive_apply_reviewed_form(
  p_batch_id uuid,
  p_form_id uuid,
  p_new_version text,
  p_confirm boolean,
  p_reason text,
  p_actor_id text default '',
  p_actor_code text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_new_def jsonb;
begin
  if p_confirm is not true then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_REVIEWED_CONFIRM_REQUIRED','message','Điều chỉnh phiếu đã thẩm định cần xác nhận tường minh (p_confirm=true).');
  end if;
  if length(trim(coalesce(p_reason,'')))<10 then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_REVIEWED_REASON_REQUIRED','message','Cần ghi lý do tối thiểu 10 ký tự khi điều chỉnh phiếu đã thẩm định.');
  end if;
  select * into v_form from public.checklist_monthly_forms where id=p_form_id for update;
  if v_form.id is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_FORM_NOT_FOUND','message','Không tìm thấy phiếu.');
  end if;
  if v_form.status<>'reviewed' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_FORM_NOT_REVIEWED','message','Chỉ dùng đường này cho phiếu đang ở trạng thái đã thẩm định.');
  end if;
  select definition into v_new_def from public.checklist_template_versions
   where lower(trim(template_key))=lower(trim(v_form.template_id)) and trim(coalesce(version_no,''))=trim(coalesce(p_new_version,'')) order by created_at desc limit 1;
  if v_new_def is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_VERSION_NOT_FOUND','message','Không tìm thấy phiên bản mới.');
  end if;
  update public.checklist_monthly_forms set
    template_version=p_new_version,
    template_snapshot=jsonb_set(jsonb_set(template_snapshot,'{version,definition}',v_new_def,true),'{version,version_no}',to_jsonb(p_new_version),true),
    updated_at=now()
  where id=p_form_id;
  insert into public.checklist_retroactive_batch_items(
    batch_id,form_id,employee_code,period_month,outcome,reason,before_snapshot,after_snapshot
  ) values(
    p_batch_id,p_form_id,v_form.employee_code,v_form.period_month,'reviewed-adjustment-applied',trim(p_reason),
    jsonb_build_object('templateVersion',v_form.template_version),jsonb_build_object('templateVersion',p_new_version)
  ) on conflict(batch_id,form_id) do nothing;
  return jsonb_build_object('ok',true,'formId',p_form_id,'appliedVersion',p_new_version);
end;
$$;
revoke all on function public.phf_retroactive_apply_reviewed_form(uuid,uuid,text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_retroactive_apply_reviewed_form(uuid,uuid,text,boolean,text,text,text,text) to service_role;

commit;
