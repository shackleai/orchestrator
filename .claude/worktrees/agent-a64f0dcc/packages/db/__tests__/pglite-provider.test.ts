import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider } from '../src/pglite-provider.js'
import { runMigrations } from '../src/migrations/index.js'

describe('PGliteProvider', () => {
  let db: PGliteProvider

  beforeAll(async () => {
    // In-memory PGlite for speed and isolation
    db = new PGliteProvider()
  })

  afterAll(async () => {
    await db.close()
  })

  it('should initialize and run a simple query', async () => {
    const result = await db.query<{ val: number }>('SELECT 1 AS val')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].val).toBe(1)
  })

  it('should apply all 12 migrations cleanly', async () => {
    const applied = await runMigrations(db)
    expect(applied).toHaveLength(12)
    expect(applied[0]).toBe('001_companies')
    expect(applied[11]).toBe('012_license_keys')
  })

  describe('companies CRUD', () => {
    let companyId: string

    it('should insert a company', async () => {
      const result = await db.query<{ id: string; name: string }>(
        `INSERT INTO companies (name, issue_prefix) VALUES ($1, $2) RETURNING *`,
        ['Acme Corp', 'ACME'],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Acme Corp')
      companyId = result.rows[0].id
      expect(companyId).toBeTruthy()
    })

    it('should read the company back', async () => {
      const result = await db.query<{ id: string; name: string; status: string }>(
        'SELECT * FROM companies WHERE id = $1',
        [companyId],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Acme Corp')
      expect(result.rows[0].status).toBe('active')
    })

    it('should update the company', async () => {
      const result = await db.query<{ name: string }>(
        `UPDATE companies SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        ['Acme Industries', companyId],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Acme Industries')
    })

    it('should delete the company', async () => {
      await db.query('DELETE FROM companies WHERE id = $1', [companyId])
      const result = await db.query('SELECT * FROM companies WHERE id = $1', [
        companyId,
      ])
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('agents CRUD', () => {
    let companyId: string
    let agentId: string

    beforeAll(async () => {
      const result = await db.query<{ id: string }>(
        `INSERT INTO companies (name, issue_prefix) VALUES ($1, $2) RETURNING id`,
        ['Agent Test Co', 'ATC'],
      )
      companyId = result.rows[0].id
    })

    it('should insert an agent', async () => {
      const result = await db.query<{ id: string; name: string; status: string }>(
        `INSERT INTO agents (company_id, name, adapter_type) VALUES ($1, $2, $3) RETURNING *`,
        [companyId, 'coder-bot', 'claude'],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('coder-bot')
      expect(result.rows[0].status).toBe('idle')
      agentId = result.rows[0].id
    })

    it('should read the agent back', async () => {
      const result = await db.query<{ id: string; name: string; adapter_type: string }>(
        'SELECT * FROM agents WHERE id = $1',
        [agentId],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].adapter_type).toBe('claude')
    })

    it('should update the agent status', async () => {
      const result = await db.query<{ status: string }>(
        `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        ['busy', agentId],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].status).toBe('busy')
    })

    it('should delete the agent', async () => {
      await db.query('DELETE FROM agents WHERE id = $1', [agentId])
      const result = await db.query('SELECT * FROM agents WHERE id = $1', [agentId])
      expect(result.rows).toHaveLength(0)
    })
  })
})
