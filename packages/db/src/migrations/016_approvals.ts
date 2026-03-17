export const name = '016_approvals'
export const sql = `
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS require_approval BOOLEAN DEFAULT false;

  CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_company ON approvals(company_id);
  CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
`
