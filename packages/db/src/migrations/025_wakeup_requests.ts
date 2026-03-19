export const name = '025_wakeup_requests'
export const sql = `
  CREATE TABLE IF NOT EXISTS agent_wakeup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_wakeup_agent_status ON agent_wakeup_requests(agent_id, status);
  CREATE INDEX IF NOT EXISTS idx_wakeup_company ON agent_wakeup_requests(company_id);
`
