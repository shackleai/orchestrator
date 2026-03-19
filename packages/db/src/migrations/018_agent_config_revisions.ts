export const name = '017_agent_config_revisions'
export const sql = `
  CREATE TABLE IF NOT EXISTS agent_config_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    revision_number INTEGER NOT NULL DEFAULT 1,
    config_snapshot JSONB NOT NULL,
    changed_by TEXT,
    change_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_agent_config_rev_agent ON agent_config_revisions(agent_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_config_rev_unique ON agent_config_revisions(agent_id, revision_number);
`
