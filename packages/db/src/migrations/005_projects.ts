export const name = '005_projects'

export const sql = `
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  goal_id UUID REFERENCES goals(id),
  lead_agent_id UUID REFERENCES agents(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  target_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE issues ADD CONSTRAINT fk_issues_project FOREIGN KEY (project_id) REFERENCES projects(id);
`
