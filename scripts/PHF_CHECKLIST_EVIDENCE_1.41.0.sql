-- PHF Checklist 1.41.0 · Minh chứng thật cho Ghi nhận lỗi (ảnh/PDF qua Supabase Storage)
-- Phạm vi: bucket Storage riêng + bảng checklist_violation_evidence (draft khi violation_id null,
-- chính thức sau khi phf_attach_checklist_evidence gắn vào đúng bản ghi checklist_violation_records).
-- Không có RLS policy cho client - toàn bộ truy cập Storage/bảng đi qua service_role ở lib/checklist-evidence.js
-- bằng signed URL ngắn hạn, đúng quy ước đã dùng cho lib/classroom-materials.js.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'phf-checklist-evidence','phf-checklist-evidence', false, 10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.checklist_violation_evidence (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid null references public.checklist_violation_records(id) on delete cascade,
  request_id text not null default '',
  storage_path text not null,
  original_name text not null default '',
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_checklist_violation_evidence_violation_id
  on public.checklist_violation_evidence(violation_id);
create index if not exists idx_checklist_violation_evidence_created_at
  on public.checklist_violation_evidence(created_at);
-- Draft mồ côi (chưa attach) cần quét theo người tải + tuổi bản ghi cho cron dọn dẹp.
create index if not exists idx_checklist_violation_evidence_orphan_scan
  on public.checklist_violation_evidence(created_by, created_at)
  where violation_id is null and deleted_at is null;
-- Chặn bấm hai lần tạo trùng đúng 1 file cho đúng 1 bản ghi.
create unique index if not exists uq_checklist_violation_evidence_violation_storage
  on public.checklist_violation_evidence(violation_id, storage_path)
  where deleted_at is null and violation_id is not null;

alter table public.checklist_violation_evidence enable row level security;
revoke all on public.checklist_violation_evidence from anon,authenticated;

-- Gắn từng evidence draft (violation_id còn null) vào đúng bản ghi lỗi vừa được
-- saveChecklistViolations tạo ra. "reused" = draft đã gắn cho 1 lỗi khác trước đó
-- (tính năng "Dùng cùng minh chứng") -> nhân bản 1 dòng metadata mới trỏ cùng
-- storage_path thay vì đổi cờ boolean giả. Sau khi gắn, đồng bộ has_evidence thật
-- và tự huỷ (record_status='cancelled') bất kỳ lỗi nào evidence_required=true mà
-- vẫn còn 0 minh chứng hợp lệ, để không có bản ghi 'official' thiếu minh chứng bắt buộc.
create or replace function public.phf_attach_checklist_evidence(
  p_links jsonb,
  p_check_violation_ids uuid[],
  p_actor_id text,
  p_actor_name text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_link jsonb;
  v_evidence public.checklist_violation_evidence%rowtype;
  v_violation public.checklist_violation_records%rowtype;
  v_new_id uuid;
  v_attached jsonb:='[]'::jsonb;
  v_failed jsonb:='[]'::jsonb;
  v_touched uuid[]:='{}';
  v_active_count integer;
  v_evidence_id uuid;
  v_violation_id uuid;
  v_request_id text;
begin
  -- p_check_violation_ids: TOÀN BỘ violation vừa lưu trong batch (kể cả những dòng
  -- không có link nào) - phải đánh giá has_evidence/auto-cancel cho cả những dòng
  -- evidence_required=true mà người dùng không đính kèm file nào, không chỉ những
  -- dòng có mặt trong p_links.
  if p_check_violation_ids is not null then
    v_touched:=p_check_violation_ids;
  end if;
  if p_links is null or jsonb_typeof(p_links)<>'array' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_EVIDENCE_LINKS_INVALID');
  end if;

  for v_link in select * from jsonb_array_elements(p_links) loop
    v_evidence_id:=nullif(v_link->>'evidenceId','')::uuid;
    v_violation_id:=nullif(v_link->>'violationId','')::uuid;
    v_request_id:=coalesce(v_link->>'requestId','');
    if v_evidence_id is null or v_violation_id is null then
      v_failed:=v_failed||jsonb_build_object('evidenceId',v_link->>'evidenceId','requestId',v_request_id,'code','CHECKLIST_EVIDENCE_LINK_MALFORMED');
      continue;
    end if;

    perform pg_advisory_xact_lock(hashtext('phf_checklist_evidence|'||v_evidence_id::text));
    select * into v_evidence from public.checklist_violation_evidence where id=v_evidence_id and deleted_at is null for update;
    if not found then
      v_failed:=v_failed||jsonb_build_object('evidenceId',v_evidence_id,'requestId',v_request_id,'code','CHECKLIST_EVIDENCE_NOT_FOUND');
      continue;
    end if;
    if v_evidence.created_by is distinct from p_actor_id then
      v_failed:=v_failed||jsonb_build_object('evidenceId',v_evidence_id,'requestId',v_request_id,'code','CHECKLIST_EVIDENCE_OWNER_MISMATCH');
      continue;
    end if;

    select * into v_violation from public.checklist_violation_records where id=v_violation_id for update;
    if not found then
      v_failed:=v_failed||jsonb_build_object('evidenceId',v_evidence_id,'requestId',v_request_id,'code','CHECKLIST_EVIDENCE_VIOLATION_NOT_FOUND');
      continue;
    end if;

    select count(*) into v_active_count from public.checklist_violation_evidence where violation_id=v_violation_id and deleted_at is null;

    if v_evidence.violation_id is not distinct from v_violation_id then
      v_attached:=v_attached||jsonb_build_object('evidenceId',v_evidence.id,'violationId',v_violation_id,'requestId',v_request_id,'reused',false);
    elsif v_evidence.violation_id is null then
      if v_active_count>=5 then
        v_failed:=v_failed||jsonb_build_object('evidenceId',v_evidence_id,'requestId',v_request_id,'code','CHECKLIST_EVIDENCE_LIMIT_REACHED');
        continue;
      end if;
      update public.checklist_violation_evidence set violation_id=v_violation_id,request_id=v_request_id where id=v_evidence.id;
      v_attached:=v_attached||jsonb_build_object('evidenceId',v_evidence.id,'violationId',v_violation_id,'requestId',v_request_id,'reused',false);
      v_touched:=array_append(v_touched,v_violation_id);
    else
      if v_active_count>=5 then
        v_failed:=v_failed||jsonb_build_object('evidenceId',v_evidence_id,'requestId',v_request_id,'code','CHECKLIST_EVIDENCE_LIMIT_REACHED');
        continue;
      end if;
      if exists(select 1 from public.checklist_violation_evidence where violation_id=v_violation_id and storage_path=v_evidence.storage_path and deleted_at is null) then
        v_attached:=v_attached||jsonb_build_object('evidenceId',v_evidence.id,'violationId',v_violation_id,'requestId',v_request_id,'reused',true,'duplicate',true);
      else
        insert into public.checklist_violation_evidence(violation_id,request_id,storage_path,original_name,mime_type,size_bytes,created_by,created_by_name)
        values(v_violation_id,v_request_id,v_evidence.storage_path,v_evidence.original_name,v_evidence.mime_type,v_evidence.size_bytes,v_evidence.created_by,v_evidence.created_by_name)
        returning id into v_new_id;
        v_attached:=v_attached||jsonb_build_object('evidenceId',v_new_id,'violationId',v_violation_id,'requestId',v_request_id,'reused',true);
      end if;
      v_touched:=array_append(v_touched,v_violation_id);
    end if;
  end loop;

  if array_length(v_touched,1)>0 then
    update public.checklist_violation_records r
      set has_evidence=exists(select 1 from public.checklist_violation_evidence e where e.violation_id=r.id and e.deleted_at is null)
      where r.id=any(v_touched);

    update public.checklist_violation_records r
      set record_status='cancelled',cancelled_by=p_actor_id,cancelled_by_name=p_actor_name,cancelled_at=now(),
          cancel_reason='Tự động huỷ: minh chứng bắt buộc chưa được đính kèm thành công.',change_count=change_count+1
      where r.id=any(v_touched) and r.record_status='official' and r.evidence_required=true and r.has_evidence=false;
  end if;

  return jsonb_build_object(
    'ok',true,
    'attached',v_attached,
    'failed',v_failed,
    'autoCancelledViolationIds',(select coalesce(jsonb_agg(id),'[]'::jsonb) from public.checklist_violation_records
      where id=any(v_touched) and record_status='cancelled' and cancel_reason like 'Tự động huỷ%')
  );
end;
$$;

revoke all on function public.phf_attach_checklist_evidence(jsonb,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.phf_attach_checklist_evidence(jsonb,uuid[],text,text) to service_role;

-- Xoá mềm 1 minh chứng. Nếu đây là minh chứng hợp lệ CUỐI CÙNG của 1 lỗi
-- evidence_required=true, bắt buộc phải truyền p_replacement_evidence_id (1 draft
-- đã upload/finalize sẵn) để gắn thay thế trong CÙNG transaction - không cho phép
-- lỗi bắt buộc minh chứng rơi về trạng thái 0 minh chứng mà vẫn còn 'official'.
-- purgeStorageObject=true nghĩa là không còn dòng nào khác dùng chung storage_path,
-- lib/checklist-evidence.js mới được phép xoá object thật trong Storage.
create or replace function public.phf_delete_checklist_evidence(
  p_evidence_id uuid,
  p_replacement_evidence_id uuid,
  p_actor_id text,
  p_actor_name text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_evidence public.checklist_violation_evidence%rowtype;
  v_violation public.checklist_violation_records%rowtype;
  v_replacement public.checklist_violation_evidence%rowtype;
  v_active_count integer;
  v_shared_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('phf_checklist_evidence|'||p_evidence_id::text));
  select * into v_evidence from public.checklist_violation_evidence where id=p_evidence_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok',false,'code','CHECKLIST_EVIDENCE_NOT_FOUND');
  end if;
  if v_evidence.created_by is distinct from p_actor_id then
    return jsonb_build_object('ok',false,'code','CHECKLIST_EVIDENCE_OWNER_MISMATCH');
  end if;

  if v_evidence.violation_id is not null then
    select * into v_violation from public.checklist_violation_records where id=v_evidence.violation_id for update;
    if found then
      select count(*) into v_active_count from public.checklist_violation_evidence
        where violation_id=v_violation.id and deleted_at is null and id<>v_evidence.id;
      if v_violation.evidence_required and v_active_count=0 then
        if p_replacement_evidence_id is null then
          return jsonb_build_object('ok',false,'code','CHECKLIST_EVIDENCE_REPLACEMENT_REQUIRED');
        end if;
        perform pg_advisory_xact_lock(hashtext('phf_checklist_evidence|'||p_replacement_evidence_id::text));
        select * into v_replacement from public.checklist_violation_evidence where id=p_replacement_evidence_id and deleted_at is null for update;
        if not found or v_replacement.created_by is distinct from p_actor_id then
          return jsonb_build_object('ok',false,'code','CHECKLIST_EVIDENCE_REPLACEMENT_INVALID');
        end if;
        if v_replacement.violation_id is null then
          update public.checklist_violation_evidence set violation_id=v_violation.id,request_id=v_evidence.request_id where id=v_replacement.id;
        elsif v_replacement.violation_id<>v_violation.id
          and not exists(select 1 from public.checklist_violation_evidence where violation_id=v_violation.id and storage_path=v_replacement.storage_path and deleted_at is null) then
          insert into public.checklist_violation_evidence(violation_id,request_id,storage_path,original_name,mime_type,size_bytes,created_by,created_by_name)
          values(v_violation.id,v_evidence.request_id,v_replacement.storage_path,v_replacement.original_name,v_replacement.mime_type,v_replacement.size_bytes,v_replacement.created_by,v_replacement.created_by_name);
        end if;
      end if;
    end if;
  end if;

  update public.checklist_violation_evidence set deleted_at=now() where id=p_evidence_id;
  select count(*) into v_shared_count from public.checklist_violation_evidence
    where storage_path=v_evidence.storage_path and deleted_at is null and id<>p_evidence_id;

  if v_evidence.violation_id is not null then
    update public.checklist_violation_records r
      set has_evidence=exists(select 1 from public.checklist_violation_evidence e where e.violation_id=r.id and e.deleted_at is null)
      where r.id=v_evidence.violation_id;
  end if;

  return jsonb_build_object('ok',true,'evidenceId',p_evidence_id,'storagePath',v_evidence.storage_path,'purgeStorageObject',v_shared_count=0);
end;
$$;

revoke all on function public.phf_delete_checklist_evidence(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.phf_delete_checklist_evidence(uuid,uuid,text,text) to service_role;

commit;
notify pgrst,'reload schema';
