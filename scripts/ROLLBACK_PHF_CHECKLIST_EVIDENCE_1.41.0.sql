-- ROLLBACK PHF Checklist 1.41.0 · Minh chứng thật cho Ghi nhận lỗi
-- Đây là tính năng MỚI (không có version trước để quay lại theo quy ước thường dùng
-- trong repo là "apply lại file version cũ hơn"), nên rollback ở đây là DROP tường minh.
-- CHỈ chạy file này nếu cần gỡ hoàn toàn tính năng minh chứng khỏi Production.
-- Rollback KHÔNG xoá file vật lý đã upload trong bucket Storage (an toàn dữ liệu) -
-- nếu cần dọn Storage, xoá thủ công qua Supabase Dashboard sau khi xác nhận không
-- còn cần các file đó, hoặc dùng script cleanup riêng.

begin;

revoke execute on function public.phf_delete_checklist_evidence(uuid,uuid,text,text) from service_role;
drop function if exists public.phf_delete_checklist_evidence(uuid,uuid,text,text);

revoke execute on function public.phf_attach_checklist_evidence(jsonb,uuid[],text,text) from service_role;
drop function if exists public.phf_attach_checklist_evidence(jsonb,uuid[],text,text);

drop table if exists public.checklist_violation_evidence;

-- Bucket giữ nguyên mặc định (không drop storage.buckets ở đây) vì storage.objects
-- có thể còn tham chiếu vật lý; xoá bucket qua Supabase Dashboard sau khi xác nhận
-- rỗng, hoặc chạy thủ công:
-- delete from storage.buckets where id='phf-checklist-evidence';

commit;
notify pgrst,'reload schema';
