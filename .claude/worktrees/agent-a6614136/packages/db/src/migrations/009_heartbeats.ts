export const name = '009_heartbeats'

export const sql = `
CREATE TABLE IF NOT EXISTS heartbeat_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  exit_code INT,
  error TEXT,
  usage_json JSONB,
  session_id_before TEXT,
  session_id_after TEXT,
  stdout_excerpt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`
