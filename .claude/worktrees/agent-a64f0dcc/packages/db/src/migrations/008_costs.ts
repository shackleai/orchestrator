export const name = '008_costs'

export const sql = `
CREATE TABLE IF NOT EXISTS cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID REFERENCES agents(id),
  issue_id UUID REFERENCES issues(id),
  provider TEXT,
  model TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_cents INT DEFAULT 0,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);
`
