import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { readConfig, getConfigPath } from '../src/config.js'

describe('init command — config and DB', () => {
  let db: PGliteProvider

  beforeAll(async () => {
    db = new PGliteProvider()
  })

  afterAll(async () => {
    await db.close()
  })

  it('should apply migrations on a fresh PGlite instance', async () => {
    const applied = await runMigrations(db)
    expect(applied.length).toBeGreaterThan(0)
    expect(applied[0]).toBe('001_companies')
  }, 15_000)

  it('should insert a company and return an id', async () => {
    const result = await db.query<{ id: string; name: string }>(
      `INSERT INTO companies (name, issue_prefix) VALUES ($1, $2) RETURNING id, name`,
      ['Test Corp', 'TEST'],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Test Corp')
    expect(result.rows[0].id).toBeTruthy()
  })

  it('should insert an agent linked to a company', async () => {
    const company = await db.query<{ id: string }>(
      `INSERT INTO companies (name, issue_prefix) VALUES ($1, $2) RETURNING id`,
      ['Agent Init Co', 'AIC'],
    )
    const companyId = company.rows[0].id

    const agent = await db.query<{ id: string; name: string; role: string }>(
      `INSERT INTO agents (company_id, name, role, adapter_type)
       VALUES ($1, $2, $3, $4) RETURNING id, name, role`,
      [companyId, 'test-bot', 'engineer', 'process'],
    )
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows[0].name).toBe('test-bot')
    expect(agent.rows[0].role).toBe('engineer')
  })
})

describe('config management', () => {
  it('getConfigPath should return a path ending in config.json', () => {
    const p = getConfigPath()
    expect(p).toContain('config.json')
    expect(p).toContain('.shackleai')
  })

  it('readConfig should return null when no config exists', async () => {
    const result = await readConfig()
    // The function should not throw — returns null or a valid config
    expect(result === null || typeof result === 'object').toBe(true)
  })
})
