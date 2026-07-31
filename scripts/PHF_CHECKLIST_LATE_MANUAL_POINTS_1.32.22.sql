begin;

alter table public.checklist_violation_records
  add column if not exists late_standard_points numeric;

alter table public.checklist_violation_records
  add column if not exists late_adjustment_reason text not null default '';

alter table public.checklist_violation_records
  add column if not exists late_adjusted_by text not null default '';

alter table public.checklist_violation_records
  add column if not exists late_adjusted_by_name text not null default '';

alter table public.checklist_violation_records
  add column if not exists late_adjusted_at timestamptz;

comment on column public.checklist_violation_records.late_standard_points is
  'Điểm chuẩn đi trễ được hệ thống tính theo số phút tại thời điểm ghi nhận.';
comment on column public.checklist_violation_records.points is
  'Điểm áp dụng cuối cùng. Riêng Đi trễ, Admin có thể nhập khác điểm chuẩn khi có lý do.';
comment on column public.checklist_violation_records.late_adjustment_reason is
  'Lý do Admin áp dụng điểm đi trễ khác điểm chuẩn.';
comment on column public.checklist_violation_records.late_adjusted_by is
  'Tài khoản Admin áp dụng điểm đi trễ khác điểm chuẩn.';
comment on column public.checklist_violation_records.late_adjusted_by_name is
  'Tên Admin áp dụng điểm đi trễ khác điểm chuẩn.';
comment on column public.checklist_violation_records.late_adjusted_at is
  'Thời điểm áp dụng điểm đi trễ khác điểm chuẩn.';

commit;

select
  id,
  employee_code,
  criterion_code,
  occurred_date,
  late_standard_points,
  points as applied_points,
  late_adjustment_reason,
  late_adjusted_by_name,
  late_adjusted_at
from public.checklist_violation_records
where upper(criterion_code) like '%DITRE%'
order by created_at desc
limit 20;
