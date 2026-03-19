export const name = '026_issue_read_states'
export const sql = `
  CREATE TABLE IF NOT EXISTS issue_read_states (
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_or_agent_id UUID NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (issue_id, user_or_agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_read_states_user ON issue_read_states(user_or_agent_id, last_read_at);
`
