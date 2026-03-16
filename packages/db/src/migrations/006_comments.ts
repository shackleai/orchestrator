export const name = '006_comments'

export const sql = `
CREATE TABLE IF NOT EXISTS issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id),
  author_agent_id UUID REFERENCES agents(id),
  content TEXT NOT NULL,
  parent_id UUID REFERENCES issue_comments(id),
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`
