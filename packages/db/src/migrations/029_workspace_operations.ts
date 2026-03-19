export const name = '029_workspace_operations'

export const sql = `
CREATE TABLE IF NOT EXISTS workspace_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES agent_worktrees(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  operation_type TEXT NOT NULL,
  file_path TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspace_ops_workspace ON workspace_operations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_ops_agent ON workspace_operations(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_ops_type ON workspace_operations(operation_type);
`
