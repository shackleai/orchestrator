export const name = '003_issues'

export const sql = `
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  identifier TEXT NOT NULL UNIQUE,
  issue_number INT NOT NULL,
  parent_id UUID REFERENCES issues(id),
  goal_id UUID,
  project_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',
  assignee_agent_id UUID REFERENCES agents(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`
