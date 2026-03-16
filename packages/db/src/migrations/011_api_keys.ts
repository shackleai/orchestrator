export const name = '011_api_keys'

export const sql = `
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  key_hash TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`
