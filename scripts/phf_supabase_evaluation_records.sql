CREATE TABLE IF NOT EXISTS evaluation_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL DEFAULT 'weekly',
  period_key TEXT,
  period_label TEXT,
  period_start TEXT,
  period_end TEXT,
  evaluator TEXT,
  status_items JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  issues TEXT,
  next_focus TEXT,
  conclusion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_records_employee_id ON evaluation_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_form_type ON evaluation_records(form_type);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_period_key ON evaluation_records(period_key);
