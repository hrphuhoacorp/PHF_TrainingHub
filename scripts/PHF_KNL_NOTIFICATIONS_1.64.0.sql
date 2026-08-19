-- PHF KNL — Thông báo nội bộ riêng của module KNL (Phase N1: chỉ Đề xuất
-- nâng bậc), 1.64.0.
--
-- Đổi version từ 1.63.0 -> 1.64.0 (Gate 1 correction): 1.63.0 đã bị dùng bởi
-- scripts/PHF_KNL_COMPENSATION_COMPETENCY_GRADE_MAP_1.63.0.sql (explicit
-- mapping compensation<->competency grade, không liên quan notification) —
-- migration đó GIỮ NGUYÊN không đổi, chỉ migration notification này đổi số.
--
-- SCOPE ĐÃ CHỐT: đây là notification RIÊNG của KNL — KHÔNG dùng chung bảng
-- checklist_notifications, KHÔNG tích hợp notification global/Hub/Checklist.
-- Bảng này CHỈ được đọc/ghi bởi lib/knl-notifications.js (service role, phía
-- Node), KHÔNG expose trực tiếp cho client Supabase — cùng convention với
-- các bảng KNL khác (không cần RLS vì không có client-side Supabase access,
-- xem scripts/PHF_KNL_GRADE_PROMOTION_PROPOSAL_1.51.0.sql).
--
-- Payload KHÔNG BAO GIỜ chứa field tiền lương (base_salary/hqcv/allowance/
-- income) — enforce ở tầng Node (lib/knl-notifications.js chỉ nhận
-- title/message do caller build sẵn, không tự nội suy từ bảng thu nhập nào).
--
-- CHƯA APPLY Production — chỉ tạo file, chờ duyệt migration.

begin;

create table if not exists public.knl_notifications (
  id uuid primary key default gen_random_uuid(),

  -- Recipient identity: canonical employee_code (PHFxxx) là khóa CHÍNH để
  -- resolve — account_id lưu thêm để list theo actor hiện tại nhanh hơn khi
  -- session có account id (mirror pattern checklist_notifications, KHÔNG
  -- dùng display name làm khóa).
  recipient_account_id text,
  recipient_employee_code text,
  check (recipient_account_id is not null or recipient_employee_code is not null),

  event_code text not null check (event_code in (
    'GRADE_PROPOSAL_ACTION_REQUIRED',
    'GRADE_PROPOSAL_APPROVED',
    'GRADE_PROPOSAL_REJECTED',
    'GRADE_PROPOSAL_WITHDRAWN',
    'GRADE_PROPOSAL_REASSIGNED'
  )),

  proposal_id uuid references public.knl_grade_promotion_proposals(id) on delete cascade,

  title text not null check (length(btrim(title)) > 0),
  message text not null check (length(btrim(message)) > 0),
  target_path text,
  priority text not null default 'Trung bình' check (priority in ('Trung bình','Cao','Khẩn')),

  created_at timestamptz not null default now(),
  read_at timestamptz,

  -- Dedupe: 1 event cho 1 recipient trên 1 proposal chỉ tạo 1 dòng (retry/
  -- double emit an toàn) — unique index thay vì cột unique để cho phép nhiều
  -- dòng dedupe_key null (không nên xảy ra trong thực tế vì lib luôn build
  -- dedupe_key, nhưng không chặn cứng ở constraint).
  dedupe_key text
);

create unique index if not exists knl_notifications_dedupe_uq
  on public.knl_notifications (dedupe_key) where dedupe_key is not null;

create index if not exists knl_notifications_recipient_employee_idx
  on public.knl_notifications (recipient_employee_code, created_at desc);

create index if not exists knl_notifications_recipient_account_idx
  on public.knl_notifications (recipient_account_id, created_at desc);

create index if not exists knl_notifications_proposal_idx
  on public.knl_notifications (proposal_id);

comment on table public.knl_notifications is
  'Thông báo nội bộ RIÊNG của module KNL (Phase N1: chỉ workflow Đề xuất nâng bậc). KHÔNG liên quan checklist_notifications/notification global — chỉ đọc/ghi qua lib/knl-notifications.js.';

commit;

-- Verification (read-only, safe to run after apply):
-- select column_name from information_schema.columns where table_schema='public' and table_name='knl_notifications';
-- select indexname from pg_indexes where schemaname='public' and tablename='knl_notifications';
