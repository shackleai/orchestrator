export const name = '031_company_logo'

export const sql = `
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
`
