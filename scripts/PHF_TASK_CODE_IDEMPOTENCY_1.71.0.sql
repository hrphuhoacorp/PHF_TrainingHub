begin;

-- PHF Task — TASK CODE + CREATE IDEMPOTENCY FOUNDATION — targeted migration 1.71.0.
-- LOCAL DESIGN PACKAGE — CHƯA APPLY PRODUCTION. Chờ Business Owner GO riêng.
--
-- Scope: (1) task_code nghiệp vụ format CV-YYMM-#### cho người dùng, cấp phát
-- atomic phía DB, immutable sau create, backfill an toàn cho Task hiện hữu;
-- (2) server-side idempotency cho task_create_draft (chỉ chống double-submit/
-- network retry — KHÔNG phải business dedup theo Primary/title/deadline).
-- KHÔNG đụng Related/Link/Permission/Recurrence — ngoài phạm vi lượt này.
--
-- FRESH AUDIT xác nhận trước khi viết file này (đọc, không ghi, đã chạy thật
-- trong phiên chuẩn bị):
--   select count(*) from public.task_tasks;                    -- = 1 (KHÔNG giả định, đã đọc thật)
--   select column_name from information_schema.columns
--     where table_name='task_tasks' and column_name in
--     ('task_code','create_idempotency_key','legacy_source','legacy_task_code'); -- = 0 rows, chưa tồn tại
--   select 1 from information_schema.tables where table_name='task_code_counters'; -- 0 rows, chưa tồn tại
--   select routine_name from information_schema.routines where routine_name='task_next_code'; -- 0 rows, chưa tồn tại
--   select trigger_name from information_schema.triggers where event_object_table='task_tasks'
--     and trigger_name='task_tasks_task_code_immutable'; -- 0 rows, chưa tồn tại
--
-- Xác nhận lại trước khi apply (đọc, không ghi) — CHẠY LẠI vì dữ liệu có thể
-- đã đổi từ lúc audit tới lúc Business Owner bấm Run:
--   select count(*) from public.task_tasks where task_code is not null; -- phải = 0
--   select count(*) from public.task_tasks;                             -- ghi lại con số thật trước khi backfill
--
-- Xác nhận SAU KHI apply (đọc, không ghi):
--   select count(*) from public.task_tasks where task_code is null; -- phải = 0
--   update public.task_tasks set task_code = task_code where id = (select id from public.task_tasks limit 1);
--     -- phải chạy OK (no-op, cùng giá trị) — chứng minh guard không chặn nhầm UPDATE không đổi task_code
--   update public.task_tasks set task_code = 'PROBE-SHOULD-FAIL' where id = (select id from public.task_tasks limit 1);
--     -- phải RAISE EXCEPTION TASK_CODE_IMMUTABLE — nếu không raise, STOP và báo ngay, đừng tiếp tục

-- =============================================================================
-- PHẦN 1 — task_tasks: thêm cột (additive-first, KHÔNG đổi/xoá cột nào có sẵn,
-- KHÔNG đụng UUID id).
--
-- task_code: mã nghiệp vụ hiển thị người dùng (CV-YYMM-####). Thêm NULLABLE
-- trước — sẽ SET NOT NULL ở PHẦN 4 sau khi backfill xong toàn bộ Task cũ,
-- đúng thứ tự an toàn theo yêu cầu (mục 4/14).
--
-- create_idempotency_key: token do CLIENT sinh 1 lần cho 1 lần bấm "Giao
-- việc"/"Gửi đề xuất" — KHÔNG phải dữ liệu nghiệp vụ, KHÔNG hiển thị UI, chỉ
-- để RPC nhận diện đúng 1 lần "cùng 1 thao tác submit" bị gửi lại do
-- lag/double-click/network retry. Nullable vĩnh viễn — Task cũ trước migration
-- này không có, và điều đó hợp lệ.
--
-- legacy_source / legacy_task_code: CHƯA dùng lượt này (không import lượt
-- này) — chỉ dự phòng chỗ cho Legacy Traceability tương lai (mục 12), để
-- task_code mới KHÔNG BAO GIỜ phải mượn/ghi đè mã phiếu Apps Script cũ.
-- =============================================================================
alter table public.task_tasks add column if not exists task_code text;
alter table public.task_tasks add column if not exists create_idempotency_key uuid;
alter table public.task_tasks add column if not exists legacy_source text;
alter table public.task_tasks add column if not exists legacy_task_code text;

-- =============================================================================
-- PHẦN 2 — task_code_counters: atomic month allocator.
--
-- scope_key = YYMM (Asia/Ho_Chi_Minh tại thời điểm Task được tạo, KHÔNG phải
-- giờ server/UTC — business rule mục 2). next_value luôn trỏ "số sẽ cấp kế
-- tiếp"; task_next_code() dùng INSERT ... ON CONFLICT ... DO UPDATE ...
-- RETURNING để 2 transaction đồng thời cùng YYMM chắc chắn nhận 2 giá trị
-- next_value khác nhau — Postgres tự serialize qua row lock trên chính dòng
-- conflict, KHÔNG cần tự implement locking thủ công (không SELECT MAX+1).
-- =============================================================================
create table if not exists public.task_code_counters (
  scope_key text primary key,
  next_value integer not null default 1,
  updated_at timestamptz not null default now()
);
revoke all on table public.task_code_counters from public, anon, authenticated;

-- =============================================================================
-- PHẦN 3 — RPC task_next_code(p_now timestamptz) returns text.
--
-- p_now nhận tham số thay vì tự gọi now() bên trong, để BACKFILL (PHẦN 4) có
-- thể cấp mã đúng theo created_at THẬT của từng Task cũ (không phải theo thời
-- điểm chạy migration) — mỗi Task cũ vẫn thuộc đúng YYMM lúc nó được tạo, và
-- counter của tháng đó được advance đúng, tránh trùng mã với Task mới sinh
-- sau này trong cùng tháng đó.
--
-- pg_advisory_xact_lock thêm một lớp serialize theo đúng phong cách các RPC
-- Task khác trong file 1.70.0 (task_add_related/task_add_link) — phòng thủ
-- thêm, KHÔNG thay thế cho INSERT..ON CONFLICT..RETURNING vốn đã atomic.
-- =============================================================================
create or replace function public.task_next_code(p_now timestamptz)
returns text as $$
declare
  v_yymm text := to_char(p_now at time zone 'Asia/Ho_Chi_Minh', 'YYMM');
  v_seq integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('task-code|' || v_yymm, 0));

  insert into public.task_code_counters(scope_key, next_value)
  values (v_yymm, 2)
  on conflict (scope_key) do update set next_value = task_code_counters.next_value + 1, updated_at = now()
  returning next_value - 1 into v_seq;

  return 'CV-' || v_yymm || '-' || lpad(v_seq::text, 4, '0');
end;
$$ language plpgsql;
revoke execute on function public.task_next_code(timestamptz) from public, anon, authenticated;

-- =============================================================================
-- PHẦN 4 — BACKFILL Task hiện hữu (KHÔNG giả định chỉ có 1 row — vòng lặp xử
-- lý ĐÚNG SỐ ROW THẬT tại thời điểm migration chạy, order by created_at để mã
-- cấp theo đúng thứ tự thời gian tạo thật). Dùng CHÍNH task_next_code() —
-- không viết logic cấp mã riêng cho backfill — nên counter tháng được advance
-- nhất quán, Task mới tạo sau backfill trong cùng tháng sẽ không trùng.
-- =============================================================================
do $$
declare
  r record;
begin
  for r in select id, created_at from public.task_tasks where task_code is null order by created_at asc
  loop
    update public.task_tasks set task_code = public.task_next_code(r.created_at) where id = r.id;
  end loop;
end;
$$;

-- Sanity check bắt buộc trước khi SET NOT NULL — nếu còn NULL (bug logic ở
-- trên hoặc row mới chen vào giữa lúc migration chạy), toàn bộ transaction
-- phải fail rõ ràng thay vì âm thầm để lại NULL.
do $$
begin
  if exists (select 1 from public.task_tasks where task_code is null) then
    raise exception 'TASK_CODE_BACKFILL_INCOMPLETE — còn Task chưa có task_code sau backfill, dừng migration.';
  end if;
end;
$$;

alter table public.task_tasks alter column task_code set not null;
alter table public.task_tasks add constraint task_tasks_task_code_key unique (task_code);

-- Idempotency key: UNIQUE theo (actor, key) — KHÔNG unique global. Một actor
-- không thể vô tình/cố ý dùng lại key của actor khác để "trúng" Task không
-- thuộc request của mình, vì lookup trong RPC luôn lọc theo CẢ actor lẫn key
-- (PHẦN 5) — constraint này chỉ là hard backstop cho race giữa 2 request
-- THẬT SỰ trùng (cùng actor, cùng key, gần như đồng thời).
create unique index if not exists task_tasks_actor_idem_key_uniq
  on public.task_tasks(created_by_employee_code, create_idempotency_key)
  where create_idempotency_key is not null;

-- =============================================================================
-- PHẦN 4B — task_code IMMUTABILITY GUARD (DB-level, không chỉ disable UI).
--
-- ĐẶT SAU backfill + SET NOT NULL + UNIQUE (PHẦN 4) — installed lúc này nghĩa
-- là guard KHÔNG hề chạy trong lúc backfill (các UPDATE task_code trong DO
-- block ở trên đã thực thi VÀ COMMIT xong trước khi CREATE TRIGGER này chạy
-- — trigger chưa tồn tại lúc đó nên không thể chặn chính backfill). Toàn bộ
-- vẫn nằm trong CÙNG 1 transaction migration (begin;...commit; bao ngoài
-- file) nên không có khoảng hở nào giữa "backfill xong" và "guard bật" mà
-- một UPDATE khác có thể len vào.
--
-- CHỈ chặn đúng 1 việc: NEW.task_code khác OLD.task_code trên 1 row đã có
-- task_code (tức là mọi row sau migration này, vì cột đã NOT NULL). KHÔNG
-- chặn update bất kỳ field nào khác của task_tasks — mọi UPDATE hiện có
-- (publish/progress/complete/reopen/cancel/change-deadline/transfer-primary…)
-- đều không đụng cột task_code nên hoàn toàn không bị ảnh hưởng.
--
-- Audit trước khi viết: grep toàn repo "task_code" xác nhận KHÔNG có RPC/JS
-- nào ghi/update task_code ngoài đúng backfill DO block ở PHẦN 4 — không có
-- nhu cầu hợp lệ nào cần đổi task_code sau create, nên chặn cứng là an toàn.
-- =============================================================================
create or replace function public.task_forbid_task_code_change()
returns trigger as $$
begin
  if OLD.task_code is distinct from NEW.task_code then
    raise exception 'TASK_CODE_IMMUTABLE — không được đổi task_code sau khi đã cấp (mã cũ: %, mã mới: %).', OLD.task_code, NEW.task_code
      using errcode = '22023';
  end if;
  return NEW;
end;
$$ language plpgsql;
revoke execute on function public.task_forbid_task_code_change() from public, anon, authenticated;

drop trigger if exists task_tasks_task_code_immutable on public.task_tasks;
create trigger task_tasks_task_code_immutable
  before update on public.task_tasks
  for each row
  execute function public.task_forbid_task_code_change();

-- =============================================================================
-- PHẦN 5 — RPC task_create_draft V2 — thêm p_idempotency_key, giữ nguyên toàn
-- bộ business logic hiện có (validate deadline/category, atomic Task+Primary
-- trong cùng transaction — KHÔNG đổi hành vi permission/validation nào).
--
-- Đổi SIGNATURE (thêm tham số) → Postgres coi là hàm khác theo type
-- signature, "create or replace" KHÔNG tự xoá overload cũ — phải DROP tường
-- minh chữ ký 9-tham-số trước khi CREATE chữ ký 10-tham-số, để tránh tồn tại
-- song song 2 overload gây nhầm lẫn PostgREST route nào được gọi.
--
-- p_idempotency_key optional (default null) — KHÔNG bắt buộc ở tầng RPC, để
-- không phá bất kỳ caller cũ nào chưa kịp cập nhật; nhưng client PHF Task
-- (api/_lib/task-core.js) LUÔN gửi key thật từ bản cập nhật đi kèm migration
-- này.
--
-- REPLAY DETECTION: lookup theo (created_by_employee_code, create_idempotency_key)
-- — TRƯỚC bất kỳ validate nghiệp vụ nào (deadline/category). Nếu tìm thấy
-- Task đã tồn tại từ đúng actor + đúng key này → return NGUYÊN Task đó, KHÔNG
-- allocate task_code mới, KHÔNG insert Primary lần 2 (return sớm trước khối
-- insert). Nếu KHÔNG tìm thấy — kể cả vì lần trước đó create thất bại (đã
-- rollback, không có row nào) — thì tiến hành validate + create như bình
-- thường, dùng ĐÚNG key đó cho request mới thật sự đầu tiên thành công. Đây
-- chính là hành vi "retry vì client không biết server đã commit hay chưa"
-- yêu cầu ở mục 9 — replay-safe nhưng KHÔNG chặn nhầm 1 lần tạo thật đầu
-- tiên.
--
-- RACE BACKSTOP: nếu 2 request thật sự đồng thời (cùng actor, cùng key) đều
-- vượt qua bước lookup (chưa row nào commit) rồi cùng INSERT — UNIQUE index
-- ở PHẦN 4 sẽ chặn request thứ 2 bằng unique_violation; EXCEPTION block bên
-- dưới bắt lỗi đó và tự động fetch lại + return đúng Task mà request kia vừa
-- tạo, thay vì trả lỗi 500 cho client.
-- =============================================================================
drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text);

create or replace function public.task_create_draft(
  p_flow_type text,
  p_title text,
  p_content text,
  p_category_code text,
  p_priority text,
  p_start_at timestamptz,
  p_deadline timestamptz,
  p_actor_employee_code text,
  p_primary_employee_code text,
  p_idempotency_key uuid default null
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_category_active boolean;
  v_code text;
begin
  if p_idempotency_key is not null then
    select * into v_task
    from public.task_tasks
    where created_by_employee_code = p_actor_employee_code
      and create_idempotency_key = p_idempotency_key
    limit 1;
    if found then
      return v_task;
    end if;
  end if;

  if p_deadline is null then
    raise exception 'TASK_DEADLINE_REQUIRED' using errcode = '22023';
  end if;
  if p_start_at is not null and p_start_at > p_deadline then
    raise exception 'TASK_DATE_ORDER_INVALID' using errcode = '22023';
  end if;

  select is_active into v_category_active
  from public.task_categories
  where category_code = p_category_code
  for share;
  if not found then
    raise exception 'TASK_CATEGORY_NOT_FOUND' using errcode = '22023';
  end if;
  if v_category_active is not true then
    raise exception 'TASK_CATEGORY_INACTIVE' using errcode = '22023';
  end if;

  v_code := public.task_next_code(now());

  begin
    insert into public.task_tasks(
      flow_type, status, title, content, category_code, priority,
      start_at, deadline, created_by_employee_code, task_code, create_idempotency_key
    ) values (
      p_flow_type, 'draft', p_title, coalesce(p_content, ''), p_category_code,
      p_priority, p_start_at, p_deadline, p_actor_employee_code, v_code, p_idempotency_key
    ) returning * into v_task;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_task
      from public.task_tasks
      where created_by_employee_code = p_actor_employee_code
        and create_idempotency_key = p_idempotency_key
      limit 1;
      if found then
        return v_task;
      end if;
    end if;
    raise;
  end;

  if coalesce(trim(p_primary_employee_code), '') <> '' then
    insert into public.task_assignees(
      task_id, employee_code, role, assigned_by_employee_code
    ) values (
      v_task.id, p_primary_employee_code, 'primary', p_actor_employee_code
    );
  end if;

  return v_task;
end;
$$ language plpgsql;

revoke execute on function public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text, uuid)
  from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- EXCLUDED FROM THIS MIGRATION (chủ đích):
--   - task_add_related/task_add_link/task_delete_category_if_unused/
--     task_publish/task_permission_* — KHÔNG đụng, ngoài phạm vi (mục 11 chỉ
--     audit, không refactor atomicity Related/Link lượt này).
--   - Legacy import thật (mục 12) — chỉ reserve cột, KHÔNG chạy import.
--   - task_code format KHÁC ngoài CV-YYMM-#### — đã CHỐT bởi Business Owner,
--     không cần alternative branch trong file này.
--   - Task→Checklist scoring/reporting (mục 16) — chỉ note, không implement.
-- ---------------------------------------------------------------------------
