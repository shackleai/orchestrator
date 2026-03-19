export const name = '032_workspace_policy_rules'

export const sql = `
CREATE TABLE IF NOT EXISTS workspace_policy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES agent_worktrees(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  operations JSONB NOT NULL DEFAULT '[]',
  file_patterns JSONB NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT 'allow',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wpr_workspace_agent ON workspace_policy_rules(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_wpr_priority ON workspace_policy_rules(priority DESC);
`
