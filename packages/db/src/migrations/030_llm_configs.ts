export const name = '030_llm_configs'

export const sql = `
CREATE TABLE IF NOT EXISTS llm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  max_tokens INT,
  temperature NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, provider, model)
);

-- Optional FK from agents to llm_configs for per-agent model override
ALTER TABLE agents ADD COLUMN IF NOT EXISTS llm_config_id UUID REFERENCES llm_configs(id);

-- Index for company-scoped lookups
CREATE INDEX IF NOT EXISTS idx_llm_configs_company_id ON llm_configs(company_id);
`
