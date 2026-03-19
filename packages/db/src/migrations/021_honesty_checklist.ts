export const name = '021_honesty_checklist'

export const sql = `
-- Add honesty checklist to issues (per-issue verification items)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS honesty_checklist JSONB DEFAULT NULL;

-- Add default honesty checklist to companies (company-wide defaults)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_honesty_checklist JSONB DEFAULT NULL;
`
