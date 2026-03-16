export const name = '001_companies'

export const sql = `
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  issue_prefix TEXT NOT NULL UNIQUE,
  issue_counter INT NOT NULL DEFAULT 0,
  budget_monthly_cents INT DEFAULT 0,
  spent_monthly_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`
