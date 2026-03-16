export const name = '007_policies'

export const sql = `
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID REFERENCES agents(id),
  name TEXT NOT NULL,
  tool_pattern TEXT NOT NULL,
  action TEXT NOT NULL,
  priority INT DEFAULT 0,
  max_calls_per_hour INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`
