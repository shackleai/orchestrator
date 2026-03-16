export const name = '012_license_keys'

export const sql = `
CREATE TABLE IF NOT EXISTS license_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  key_hash TEXT NOT NULL UNIQUE,
  tier TEXT DEFAULT 'free',
  valid_until TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`
