export const name = '024_documents'

export const sql = `
  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    revision_number INTEGER NOT NULL DEFAULT 1,
    created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS issue_documents (
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (issue_id, document_id)
  );

  CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents(company_id);
  CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by_agent_id);
  CREATE INDEX IF NOT EXISTS idx_document_revisions_document_id ON document_revisions(document_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_document_revisions_unique ON document_revisions(document_id, revision_number);
  CREATE INDEX IF NOT EXISTS idx_issue_documents_document_id ON issue_documents(document_id);
  CREATE INDEX IF NOT EXISTS idx_issue_documents_issue_id ON issue_documents(issue_id);
`
