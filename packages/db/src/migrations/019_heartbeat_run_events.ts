export const name = '019_heartbeat_run_events'
export const sql = `
  CREATE TABLE IF NOT EXISTS heartbeat_run_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    heartbeat_run_id UUID NOT NULL REFERENCES heartbeat_runs(id),
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_hb_events_run ON heartbeat_run_events(heartbeat_run_id);
`
