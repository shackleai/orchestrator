export const name = '015_indexes'
export const sql = `
  -- Agents
  CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  CREATE INDEX IF NOT EXISTS idx_agents_reports_to ON agents(reports_to);

  -- Issues
  CREATE INDEX IF NOT EXISTS idx_issues_company ON issues(company_id);
  CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_agent_id);
  CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
  CREATE INDEX IF NOT EXISTS idx_issues_goal ON issues(goal_id);
  CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_issues_created ON issues(created_at);

  -- Goals
  CREATE INDEX IF NOT EXISTS idx_goals_company ON goals(company_id);

  -- Projects
  CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);

  -- Policies
  CREATE INDEX IF NOT EXISTS idx_policies_company ON policies(company_id);

  -- Cost events
  CREATE INDEX IF NOT EXISTS idx_cost_events_company ON cost_events(company_id);
  CREATE INDEX IF NOT EXISTS idx_cost_events_agent ON cost_events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_cost_events_occurred ON cost_events(occurred_at);

  -- Heartbeat runs
  CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_company ON heartbeat_runs(company_id);
  CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_agent ON heartbeat_runs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_created ON heartbeat_runs(created_at);

  -- Activity log
  CREATE INDEX IF NOT EXISTS idx_activity_log_company ON activity_log(company_id);
  CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

  -- Issue comments
  CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);
  CREATE INDEX IF NOT EXISTS idx_issue_comments_author ON issue_comments(author_agent_id);

  -- Agent API keys
  CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash ON agent_api_keys(key_hash);
`
