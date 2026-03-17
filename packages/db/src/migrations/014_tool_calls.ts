export const name = '014_tool_calls'

export const sql = `
CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heartbeat_run_id UUID NOT NULL REFERENCES heartbeat_runs(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  tool_name TEXT NOT NULL,
  tool_input JSONB,
  tool_output TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(heartbeat_run_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_company ON tool_calls(company_id);
`
