export const name = '004_goals'

export const sql = `
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  parent_id UUID REFERENCES goals(id),
  title TEXT NOT NULL,
  description TEXT,
  level TEXT DEFAULT 'task',
  status TEXT DEFAULT 'active',
  owner_agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE issues ADD CONSTRAINT fk_issues_goal FOREIGN KEY (goal_id) REFERENCES goals(id);
`
