export const name = '036_memberships'

export const sql = `
-- Company memberships — links users to companies with a role
CREATE TABLE IF NOT EXISTS company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_memberships_company ON company_memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_user ON company_memberships(user_id);

-- Invites — email-based invitations with a unique token
CREATE TABLE IF NOT EXISTS company_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_invites_token ON company_invites(token);
CREATE INDEX IF NOT EXISTS idx_company_invites_company ON company_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_company_invites_email ON company_invites(email);

-- Join requests — user-initiated requests to join a company
CREATE TABLE IF NOT EXISTS join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_company ON join_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_user ON join_requests(user_id);
`
