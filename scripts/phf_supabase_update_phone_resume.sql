ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS study_start_date TEXT,
  ADD COLUMN IF NOT EXISTS program_id TEXT DEFAULT 'new_sales';

CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees(phone);
