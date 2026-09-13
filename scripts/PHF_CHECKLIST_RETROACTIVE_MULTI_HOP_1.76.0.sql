-- PHF Checklist 1.76.0 · Retroactive-apply — multi-hop stale form fix
--
-- BUG ĐANG SỬA (audit PROD 2026-09-13, mẫu "Kế toán viên – Doanh thu & Công nợ phải thu",
-- template_key=ke-toan-doanh-thu-cnpt, nhân sự PHF008, kỳ 2026-09):
--   phf_retroactive_apply_checklist_template (1.53.0) scope MỘT phiếu tháng vào batch CHỈ
--   khi checklist_monthly_forms.template_version KHỚP CHÍNH XÁC một chuỗi p_old_version DUY
--   NHẤT (= phiên bản đang-hoạt-động NGAY TRƯỚC lần kích hoạt hiện tại — xem
--   activateTemplateVersion() trong lib/checklist-template-retroactive-service.js). Phiếu
--   tháng chỉ được snapshot template LẠI khi thực sự đi qua batch retroactive-apply này (hoặc
--   qua resnapshotMonthlyDraftTemplate cho riêng phiếu 'draft', 2026-09-02) — nếu một phiếu
--   'waiting_self'/'waiting_review' đã trót bỏ lỡ MỘT lần kích hoạt phiên bản trước đó, nó
--   tụt lại NHIỀU hơn 1 bậc phiên bản (case thật: phiếu ở template_version='KT.Thu 2.0'
--   trong khi mẫu vừa được kích hoạt sang 'KT Thu 3.9', với phiên bản-ngay-trước không phải
--   là 2.0). Kết quả: predicate template_version=p_old_version KHÔNG BAO GIỜ khớp phiếu này —
--   nó vô hình với vòng lặp của RPC (không được đếm, không được liệt kê outcome, không được
--   ghi UPDATE) dù bộ phân loại trạng thái (draft/waiting_self/waiting_review, chưa có câu
--   trả lời gắn dòng đổi) coi nó là "an toàn để cập nhật". Admin thấy modal xác nhận "1 phiếu
--   an toàn" nhưng bước "Xác nhận cập nhật" áp dụng 0 phiếu — không phải toast sai, mà là
--   phạm vi quét bị bỏ sót thật sự. KHÔNG có dữ liệu nào bị ghi sai (không corruption) — phiếu
--   chỉ đơn giản chưa từng được đụng tới.
--
-- FIX:
--   1) Mở rộng phạm vi quét: KHÔNG còn lọc theo "template_version = một old_version cụ thể".
--      Thay bằng "template_version <> phiên bản mới" (trong cùng template_key + khoảng kỳ) —
--      bắt được MỌI phiếu còn tụt lại, bất kể tụt bao nhiêu bậc phiên bản.
--   2) Vì phiếu có thể tụt ở NHIỀU phiên bản cũ khác nhau (không chỉ một p_old_version chung),
--      definition "cũ" dùng để remap câu trả lời theo id ổn định giờ PHẢI đọc riêng cho TỪNG
--      phiếu, từ đúng checklist_template_versions.version_no mà phiếu đó đang giữ — không còn
--      dùng một v_old_def toàn cục nạp 1 lần từ p_old_version như 1.53.0.
--   3) Nếu KHÔNG tìm thấy definition cũ của riêng phiếu đó (version_no không còn tồn tại
--      trong checklist_template_versions — dữ liệu bất thường), phiếu đó KHÔNG được cập nhật.
--      Trả outcome mới 'skipped-missing-old-definition', vẫn liệt kê trong items để Admin xử
--      lý thủ công — tuyệt đối không âm thầm remap bằng definition sai hoặc bỏ qua không dấu
--      vết.
--   4) p_old_version vẫn được nhận và ghi vào checklist_retroactive_batches.old_version_no
--      (nhãn audit — "phiên bản đang kích hoạt-từ" theo ngữ cảnh gọi ở tầng JS), nhưng KHÔNG
--      còn dùng để lọc phạm vi hay để nạp definition remap — tránh đúng lỗi 1.53.0.
--   5) GIỮ NGUYÊN mọi hàng rào khác của 1.53.0: locked/cancelled không bao giờ bị đụng,
--      reviewed tách qua phf_retroactive_apply_reviewed_form riêng, skipped-unmapped khi câu
--      trả lời gắn với dòng đã xoá, idempotent theo batch_id (advisory lock + bảng
--      checklist_retroactive_batches), dry-run không ghi bất kỳ thay đổi nào, period bounds,
--      cách ghi template_snapshot/self_answers/review_answers khi outcome='applied'.
--
-- Logic remap/diff JS thuần tương đương: lib/checklist-template-retroactive.js — hàm
-- runRetroactiveBatch() được cập nhật song song (definitionsByVersion, per-form resolve,
-- outcome 'skipped-missing-old-definition') để giữ đúng parity test in-memory, không cần
-- Supabase thật (xem scripts/test-checklist-retroactive-multi-hop-2026-09.js).
--
-- SQL provenance: KHÔNG sửa scripts/PHF_CHECKLIST_RETROACTIVE_ENGINE_1.53.0.sql (giữ nguyên
-- lịch sử migration). File này CREATE OR REPLACE lại đúng 1 hàm
-- public.phf_retroactive_apply_checklist_template với CÙNG chữ ký tham số — an toàn chạy lại
-- nhiều lần (idempotent ở tầng định nghĩa hàm, không đổi dữ liệu hiện có khi chạy).
--
-- LƯU Ý VẬN HÀNH: CHƯA được thực thi trên Production trong batch audit này (STOP-GATE —
-- chỉ chuẩn bị code + test, chờ duyệt merge/deploy riêng). Sau khi migration này chạy trên
-- Production, KHÔNG tự sửa tay phiếu PHF008/2026-09 — phục hồi đúng canonical bằng cách chạy
-- lại luồng "Cập nhật Phiếu tháng hiện có" (dry-run rồi Xác nhận cập nhật) cho đúng
-- template_key=ke-toan-doanh-thu-cnpt, newVersion='KT Thu 3.9', kỳ 2026-09 — để phiếu được
-- cập nhật CÙNG audit trail/batch_id như mọi phiếu khác, không tạo ngoại lệ thủ công.

begin;

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
  -- 1.76.0: đếm riêng các phiếu tụt nhiều bậc phiên bản mà không còn tìm thấy definition cũ
  -- của đúng version_no mà phiếu đang giữ — KHÔNG gộp chung với skipped-unmapped (lý do khác
  -- nhau: unmapped là do dòng bị xoá ở version mới; missing-old-definition là do version cũ
  -- của phiếu không còn tồn tại trong checklist_template_versions).
  v_skipped_missing_old_def int := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_batch_id is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_BATCH_ID_REQUIRED','message','Thiếu batch_id.');
  end if;

  perform pg_advisory_xact_lock(hashtext('phf_checklist_retroactive_batch|'||p_batch_id::text));

  select * into v_existing_batch from public.checklist_retroactive_batches where batch_id=p_batch_id;
  if v_existing_batch.id is not null then
    return jsonb_build_object('ok',true,'idempotentReplay',true,'batchId',p_batch_id,'counts',v_existing_batch.counts,
      'message','batch_id đã được áp dụng trước đó — không chạy lại (idempotent).');
  end if;

  -- 1.76.0: chỉ còn resolve definition của phiên bản MỚI ở đây (dùng chung cho cả batch).
  -- Definition "cũ" giờ resolve RIÊNG cho từng phiếu bên trong vòng lặp (xem bên dưới) —
  -- KHÔNG còn giả định mọi phiếu trong scope đều đang ở cùng một p_old_version.
  select definition into v_new_def from public.checklist_template_versions
   where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(p_new_version,'')) order by created_at desc limit 1;
  if v_new_def is null then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RETRO_VERSION_NOT_FOUND','message','Không tìm thấy phiên bản mới của mẫu.');
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

  -- 1.76.0: scope KHÔNG còn "template_version = p_old_version" (1 bậc) mà là "template_version
  -- <> phiên bản mới" (mọi bậc còn tụt lại) — trong cùng template_key + khoảng kỳ.
  for v_form in
    select * from public.checklist_monthly_forms
    where lower(trim(template_id))=v_key
      and trim(coalesce(template_version,''))<>trim(coalesce(p_new_version,''))
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
      -- 1.76.0: resolve definition CŨ theo đúng version_no riêng của PHIẾU NÀY (không phải
      -- p_old_version chung) — bắt được phiếu tụt nhiều bậc phiên bản. select ... into tự
      -- gán NULL nếu không có dòng khớp (không cần reset thủ công giữa các vòng lặp).
      select definition into v_old_def from public.checklist_template_versions
       where lower(trim(template_key))=v_key and trim(coalesce(version_no,''))=trim(coalesce(v_form.template_version,'')) order by created_at desc limit 1;

      if v_old_def is null then
        v_outcome:='skipped-missing-old-definition';
        v_reason:='Không tìm thấy định nghĩa phiên bản "'||coalesce(v_form.template_version,'')||'" của mẫu để đối chiếu remap — không tự áp dụng bằng định nghĩa sai, cần Admin xác nhận thủ công.';
        v_skipped_missing_old_def := v_skipped_missing_old_def+1;
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
    end if;

    if v_outcome is not null and v_outcome<>'applied' then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'formId',v_form.id,'employeeCode',v_form.employee_code,'periodMonth',v_form.period_month,
        'outcome',v_outcome,'reason',v_reason,
        'formOldVersion',v_form.template_version,
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

    -- reset các biến theo-phiếu trước khi sang phiếu kế tiếp — tránh giá trị của phiếu trước
    -- (vd v_unmapped_self/v_unmapped_review, v_old_def) lọt sang nhánh không gán lại của
    -- phiếu sau (vd locked/cancelled không đi qua remap nên không tự gán lại các biến này).
    v_outcome:=null; v_reason:=null; v_old_def:=null; v_self:=null; v_review:=null; v_unmapped_self:=null; v_unmapped_review:=null;
  end loop;

  v_counts := jsonb_build_object('applied',v_applied,'skippedLocked',v_skipped_locked,'skippedUnmapped',v_skipped_unmapped,'requiresReviewedAdjustment',v_requires_reviewed,'skippedMissingOldDefinition',v_skipped_missing_old_def,'failed',v_failed);

  if not p_dry_run then
    update public.checklist_retroactive_batches set counts=v_counts where id=v_batch_row_id;
  end if;

  return jsonb_build_object('ok',true,'batchId',p_batch_id,'dryRun',p_dry_run,'counts',v_counts,'items',v_items);
end;
$$;
revoke all on function public.phf_retroactive_apply_checklist_template(uuid,text,text,text,text,text,text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_retroactive_apply_checklist_template(uuid,text,text,text,text,text,text,boolean,text,text,text) to service_role;

commit;

-- Xác minh thủ công sau khi chạy (không tự động hoá ở đây):
--   select proname, prosecdef from pg_proc where proname='phf_retroactive_apply_checklist_template';
--   -- kỳ vọng đúng 1 dòng, prosecdef = true (SECURITY DEFINER giữ nguyên).
--
-- PHỤC HỒI PHF008/2026-09 SAU KHI DEPLOY (KHÔNG sửa tay, KHÔNG UPDATE trực tiếp):
--   1) Vào mẫu "Kế toán viên – Doanh thu & Công nợ phải thu" (ke-toan-doanh-thu-cnpt) trên
--      Admin > Bảng tổng điểm.
--   2) Mở lại luồng "Cập nhật Phiếu tháng hiện có" cho phiên bản đang hoạt động 'KT Thu 3.9'
--      (Bước 1 chọn phạm vi kỳ 2026-09 → Bước 2 "Xem tác động (dữ liệu thật, chưa ghi)" →
--      xác nhận PHF008 xuất hiện với outcome 'applied' → Bước 3 "Xác nhận cập nhật").
--   3) Với fix 1.76.0, phiếu PHF008 (đang ở 'KT.Thu 2.0') giờ nằm trong scope
--      (template_version <> 'KT Thu 3.9') và definition cũ được resolve đúng theo
--      'KT.Thu 2.0' — batch mới sẽ áp dụng và ghi lại đúng audit trail (checklist_
--      retroactive_batches/_items), KHÔNG cần bất kỳ UPDATE thủ công nào ngoài luồng này.
