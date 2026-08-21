-- PHF Checklist 1.54.0 · Workstream A, Residual B — chặn ghi đè version_no đã tồn tại
-- trong phf_save_checklist_template().
--
-- BUG ĐANG SỬA (đã nêu ở báo cáo bàn giao Workstream A): hàm gốc
-- (scripts/PHF_CHECKLIST_PRODUCTION_STABILITY_1.33.1.sql, dòng insert vào
-- checklist_template_versions) dùng:
--   on conflict (template_key, version_no) do update set definition=excluded.definition, ...
-- Nghĩa là nếu một lần lưu sau tái sử dụng đúng (template_key, version_no) đã có sẵn, nó
-- ÂM THẦM GHI ĐÈ definition của phiên bản cũ — vi phạm trực tiếp nguyên tắc "version/snapshot
-- immutable, không bao giờ sửa lịch sử" mà toàn bộ engine version-copy/retroactive-apply
-- (1.53.0) đang dựa vào. Rủi ro cụ thể: double-click nút "Sao chép version"/"Lưu" ở wizard
-- 8 bước (Bước 2), hoặc 2 request gần như đồng thời cho cùng version_no.
--
-- FIX (chọn theo đúng quy ước đã có trong repo — xem CHECKLIST_TEMPLATE_STALE ngay trong
-- cùng hàm này, và pg_advisory_xact_lock trong 1.53.0):
--   - Version_no hiện tại là CHUỖI ADMIN TỰ NHẬP (không có bộ sinh version_no tự động nào
--     trong lib/checklist-templates.js hay wizard 8 bước — xem crwCopyDefinitionForEdit/
--     Bước 2 "Phiên bản mới" trong assets/js/checklist/phf-checklist-app.js), nên đáp án
--     đúng là (a) TỪ CHỐI với lỗi rõ ràng, không tự sinh version_no thay admin.
--   - Ngoại lệ an toàn: nếu payload gửi lên giống HỆT bản đã lưu (definition +
--     effective_date + reason + source_version + change_type) thì coi là no-op thành công
--     (double-click gửi lại đúng y request không được biến thành lỗi khó hiểu cho người
--     dùng, và cũng không tạo thay đổi nào — an toàn tuyệt đối với bất biến lịch sử).
--   - Khác nội dung -> raise exception 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE:<key>|<version>'
--     (lib/checklist-templates.js saveOne() bắt lỗi này y hệt cách đã bắt CHECKLIST_TEMPLATE_STALE).
--
-- CONCURRENCY: pg_advisory_xact_lock(hashtext('phf_checklist_template|'||v_key)) đã được
-- lấy NGAY ĐẦU hàm (giữ nguyên, không đổi) — khoá này serialize MỌI lần save cho cùng
-- template_key trong toàn bộ transaction, bất kể version_no nào. Vì vậy 2 request gần như
-- đồng thời cho CÙNG (template_key, version_no): request thứ nhất commit trước và giữ khoá
-- xuyên suốt transaction; request thứ hai BỊ CHẶN (không chạy song song) cho tới khi request
-- thứ nhất commit/rollback, sau đó mới đọc thấy version đã tồn tại và áp dụng đúng nhánh
-- no-op-nếu-giống-hệt / từ chối-nếu-khác ở trên — không có cửa sổ race nào để 2 phiên bản
-- ghi đè lẫn nhau, vì không transaction nào chạy đồng thời với transaction khác trên cùng
-- template_key (đảm bảo bởi advisory lock, không phải bởi unique constraint alone).
--
-- LƯU Ý VẬN HÀNH: create-or-replace function này AN TOÀN chạy lại nhiều lần (idempotent) —
-- chỉ thay định nghĩa hàm, không đổi dữ liệu hiện có. CHƯA được thực thi trong batch kỹ
-- thuật 2026-08-14 vì môi trường hiện tại chỉ có một Supabase project cấu hình và đó là
-- project đang phục vụ Production — không có Supabase local/dev riêng để xác minh an toàn
-- trước (xem README/báo cáo bàn giao). Chạy thủ công (Supabase SQL editor/CLI) sau khi đã
-- xác nhận đúng target và đã test ở staging nếu có.

begin;

create or replace function public.phf_save_checklist_template(
  p_template jsonb,
  p_version jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(trim(coalesce(p_template->>'template_key','')));
  v_version text := trim(coalesce(p_version->>'version_no',''));
  v_old public.checklist_templates%rowtype;
  v_expected timestamptz := nullif(p_template->>'expected_updated_at','')::timestamptz;
  v_expected_absent boolean := coalesce((p_template->>'expected_absent')::boolean,false);
  v_existing_version public.checklist_template_versions%rowtype;
  v_new_definition jsonb := coalesce(p_version->'definition','{"groups":[],"totalRows":[],"templateType":"checklist_detail"}'::jsonb);
  v_new_effective_date date := (p_version->>'effective_date')::date;
  v_new_reason text := coalesce(nullif(p_version->>'reason',''),'Cập nhật mẫu Checklist');
  v_new_source_version text := coalesce(p_version->>'source_version','');
  v_new_change_type text := coalesce(nullif(p_version->>'change_type',''),'sync');
  v_same_content boolean;
begin
  if v_key='' or v_version='' then
    raise exception 'CHECKLIST_TEMPLATE_KEY_REQUIRED';
  end if;
  -- Khoá theo template_key giữ nguyên xuyên suốt transaction: đây là cơ chế
  -- serialize duy nhất chống race giữa 2 lần save cùng (template_key, version_no) —
  -- xem giải thích concurrency ở đầu file.
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template_global'));
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template|'||v_key));

  select * into v_old
  from public.checklist_templates
  where template_key=v_key
  for update;

  if found and (v_expected_absent or v_expected is null or v_old.updated_at is distinct from v_expected) then
    raise exception 'CHECKLIST_TEMPLATE_STALE:%',v_key;
  end if;
  if not found and (not v_expected_absent or v_expected is not null) then
    raise exception 'CHECKLIST_TEMPLATE_STALE:%',v_key;
  end if;

  if not found then
    insert into public.checklist_templates(
      template_key,code,name,group_name,template_type,has_checklist,source,note,status,
      current_version,effective_date,created_by,created_by_name,updated_at
    ) values (
      v_key,upper(trim(p_template->>'code')),coalesce(p_template->>'name',''),
      coalesce(p_template->>'group_name',''),coalesce(nullif(p_template->>'template_type',''),'checklist_detail'),
      coalesce((p_template->>'has_checklist')::boolean,true),coalesce(p_template->>'source',''),
      coalesce(p_template->>'note',''),coalesce(nullif(p_template->>'status',''),'active'),
      v_version,(p_template->>'effective_date')::date,p_actor_id,p_actor_name,now()
    );
  end if;

  -- Bất biến lịch sử: (template_key, version_no) đã tồn tại thì KHÔNG BAO GIỜ ghi
  -- đè bằng UPDATE. Chỉ INSERT mới khi chưa có; nếu đã có, so nội dung để quyết
  -- định no-op an toàn hay từ chối rõ ràng (không có nhánh thứ 3 nào âm thầm đổi
  -- dữ liệu đã persist).
  select * into v_existing_version
  from public.checklist_template_versions
  where template_key=v_key and version_no=v_version
  for update;

  if found then
    v_same_content :=
      v_existing_version.definition is not distinct from v_new_definition
      and v_existing_version.effective_date is not distinct from v_new_effective_date
      and coalesce(v_existing_version.reason,'') = v_new_reason
      and coalesce(v_existing_version.source_version,'') = v_new_source_version
      and coalesce(v_existing_version.change_type,'') = v_new_change_type;
    if not v_same_content then
      raise exception 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE:%|%',v_key,v_version;
    end if;
    -- Giống hệt bản đã lưu (double-click / retry an toàn) -> no-op, không ghi lại.
  else
    insert into public.checklist_template_versions(
      template_key,version_no,effective_date,reason,source_version,change_type,definition,
      created_by,created_by_name,created_at
    ) values (
      v_key,v_version,v_new_effective_date,v_new_reason,v_new_source_version,v_new_change_type,
      v_new_definition,p_actor_id,p_actor_name,coalesce(nullif(p_version->>'created_at','')::timestamptz,now())
    );
  end if;

  update public.checklist_templates set
    code=upper(trim(p_template->>'code')),
    name=coalesce(p_template->>'name',''),
    group_name=coalesce(p_template->>'group_name',''),
    template_type=coalesce(nullif(p_template->>'template_type',''),'checklist_detail'),
    has_checklist=coalesce((p_template->>'has_checklist')::boolean,true),
    source=coalesce(p_template->>'source',''),
    note=coalesce(p_template->>'note',''),
    status=coalesce(nullif(p_template->>'status',''),'active'),
    current_version=v_version,
    effective_date=(p_template->>'effective_date')::date,
    updated_at=now()
  where template_key=v_key;

  return jsonb_build_object('ok',true,'templateKey',v_key,'version',v_version);
end;
$$;

revoke all on function public.phf_save_checklist_template(jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phf_save_checklist_template(jsonb,jsonb,text,text) to service_role;

commit;

-- Xác minh thủ công sau khi chạy (không tự động hoá ở đây):
--   select proname, prosecdef from pg_proc where proname='phf_save_checklist_template';
--   -- kỳ vọng đúng 1 dòng, prosecdef = true (SECURITY DEFINER giữ nguyên).
