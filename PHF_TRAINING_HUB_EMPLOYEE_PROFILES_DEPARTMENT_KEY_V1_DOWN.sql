-- Rollback for PHF_TRAINING_HUB_EMPLOYEE_PROFILES_DEPARTMENT_KEY_V1.sql
-- Drops the additive department_key column. Safe: no other column/table is
-- touched, and display-name department text is untouched (this column was
-- purely additive metadata, never the sole source of truth for department).

ALTER TABLE employee_profiles
  DROP COLUMN IF EXISTS department_key;
