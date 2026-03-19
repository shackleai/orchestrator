export const name = '035_board_claim'

export const sql = `
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS board_claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS board_claimed_at TIMESTAMPTZ;
`
