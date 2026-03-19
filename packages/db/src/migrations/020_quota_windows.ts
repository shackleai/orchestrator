export const name = '020_quota_windows'

export const sql = `
CREATE TABLE IF NOT EXISTS quota_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID REFERENCES agents(id),
  provider TEXT,
  window_duration TEXT NOT NULL DEFAULT '1h',
  max_requests INTEGER,
  max_tokens INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_windows_company ON quota_windows (company_id);
CREATE INDEX IF NOT EXISTS idx_quota_windows_agent ON quota_windows (company_id, agent_id);
`
