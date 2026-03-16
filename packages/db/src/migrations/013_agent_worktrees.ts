export const name = '013_agent_worktrees'

export const sql = `
CREATE TABLE IF NOT EXISTS agent_worktrees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  issue_id UUID REFERENCES issues(id),
  repo_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktree_branch ON agent_worktrees(repo_path, branch);
`
