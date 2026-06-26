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
