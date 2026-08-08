-- PHF AI - Lich su hoi thoai (Batch C, version 1.45.x)
--
-- Muc tieu:
-- - Luu lich su hoi thoai PHF AI ben vung (truoc gio 100% chi o RAM client,
--   xem lib/ai-sandbox.js dong comment dau file - day la tinh nang MOI hoan
--   toan, khong phai mo rong bang co san).
-- - Moi tai khoan CHI xem duoc lich su cua chinh minh - khong co policy
--   public cho anon/authenticated, chi backend (service_role qua
--   SUPABASE_SECRET_KEY) duoc doc/ghi, tu enforce account_id = actor dang
--   dang nhap trong lib/ai-conversations.js (KHONG dua vao RLS policy client
--   vi khong co client-side Supabase access trong kien truc nay).
-- - KHONG luu system prompt/tool registry/secret vao day - chi luu
--   role/content/result/actions cua tung tin nhan (nhung gi nguoi dung da
--   thay tren man hinh).
--
-- Co the chay lai nhieu lan.

begin;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  title text not null default '',
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_conversations_account_id_not_blank
    check (length(trim(account_id)) > 0),
  constraint ai_conversations_title_len
    check (char_length(title) <= 120),
  constraint ai_conversations_message_count_non_negative
    check (message_count >= 0)
);

create index if not exists idx_ai_conversations_account_updated
  on public.ai_conversations(account_id, updated_at desc);

create table if not exists public.ai_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  result jsonb null,
  actions jsonb null,
  created_at timestamptz not null default now(),

  constraint ai_conversation_messages_role_valid
    check (role in ('user', 'assistant')),
  constraint ai_conversation_messages_content_not_blank
    check (length(trim(content)) > 0)
);

create index if not exists idx_ai_conversation_messages_conversation_created
  on public.ai_conversation_messages(conversation_id, created_at);

create or replace function public.phf_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_conversations_updated_at
  on public.ai_conversations;

create trigger trg_ai_conversations_updated_at
before update on public.ai_conversations
for each row
execute function public.phf_touch_updated_at();

-- Khong cho trinh duyet dung anon/authenticated key doc/ghi truc tiep -
-- toan bo truy cap di qua backend (service_role) qua lib/ai-conversations.js,
-- tu enforce quyen so huu theo account_id cua session that (giong pattern
-- user_accounts/checklist_violation_evidence hien co).
alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_messages enable row level security;

revoke all on table public.ai_conversations from anon;
revoke all on table public.ai_conversations from authenticated;
revoke all on table public.ai_conversation_messages from anon;
revoke all on table public.ai_conversation_messages from authenticated;

-- Khong tao policy cong khai nao ca.

commit;
notify pgrst,'reload schema';
