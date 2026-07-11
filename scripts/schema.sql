-- PHF Training Hub - Supabase Schema
-- Chạy file này trong Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  pass_score INTEGER NOT NULL DEFAULT 80,
  app_name TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  branch TEXT,
  position TEXT,
  birthday TEXT,
  created_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS progress (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  current_page TEXT,
  unlocked_steps TEXT[],
  completed_pages TEXT[],
  last_updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  page TEXT,
  score INTEGER,
  pass_score INTEGER,
  status TEXT,
  result_text TEXT,
  saved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT,
  current_page TEXT,
  saved_at TIMESTAMPTZ
);

-- Hồ sơ cam kết chính thức, tách khỏi activity_log
CREATE TABLE IF NOT EXISTS commitment_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  commitment_type TEXT NOT NULL DEFAULT 'confidentiality',
  document_code TEXT NOT NULL DEFAULT 'PHF-BMTT',
  document_version TEXT NOT NULL,
  document_title TEXT NOT NULL DEFAULT 'Cam kết bảo mật thông tin',
  content_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  confirmed_name TEXT,
  confirmed_phone TEXT,
  confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_commitment_records_employee_id
  ON commitment_records(employee_id);

CREATE INDEX IF NOT EXISTS idx_commitment_records_confirmed_at
  ON commitment_records(confirmed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commitment_records_employee_version
  ON commitment_records(employee_id, commitment_type, document_version);

-- Hồ sơ thử việc chính thức. Ngày bắt đầu lấy từ employees.study_start_date.
CREATE TABLE IF NOT EXISTS probation_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  expected_end_date DATE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  conclusion TEXT,
  proposed_by TEXT,
  proposed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  extension_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS system_notifications (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL DEFAULT 'manager',
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  due_at TIMESTAMPTZ,
  source_type TEXT,
  source_id TEXT,
  read_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

