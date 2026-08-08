-- ROLLBACK PHF AI Conversations 1.45.x - Lich su hoi thoai PHF AI
-- Day la tinh nang MOI (khong co version truoc de quay lai), nen rollback
-- o day la DROP tuong minh. CHI chay file nay neu can go hoan toan lich su
-- hoi thoai PHF AI khoi Production - se XOA VINH VIEN toan bo lich su hoi
-- thoai da luu cua moi tai khoan.

begin;

drop trigger if exists trg_ai_conversations_updated_at
  on public.ai_conversations;

drop table if exists public.ai_conversation_messages;
drop table if exists public.ai_conversations;

commit;
notify pgrst,'reload schema';
