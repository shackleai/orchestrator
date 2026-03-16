export const name = '002_agents'

export const sql = `
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  title TEXT,
  role TEXT DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'idle',
  reports_to UUID REFERENCES agents(id),
  capabilities TEXT,
  adapter_type TEXT NOT NULL,
  adapter_config JSONB DEFAULT '{}',
  budget_monthly_cents INT DEFAULT 0,
  spent_monthly_cents INT DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`
