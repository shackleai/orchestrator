export const name = '028_finance_events'

export const sql = `
CREATE TABLE IF NOT EXISTS finance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  event_type TEXT NOT NULL,
  amount_cents INT NOT NULL DEFAULT 0,
  description TEXT,
  agent_id UUID REFERENCES agents(id),
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finance_events_company ON finance_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_events_agent ON finance_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_finance_events_type ON finance_events(event_type);
CREATE INDEX IF NOT EXISTS idx_finance_events_provider ON finance_events(provider);
`
