import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { Observatory } from '../src/observatory.js'

let db: PGliteProvider
let observatory: Observatory

// Helper: seed a company so FK constraints pass
const COMPANY_ID = '00000000-0000-4000-a000-000000000001'

async function seedCompany(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Test Co', 'active', 'TST', 0, 10000, 0],
  )
}

// Helper: wait for fire-and-forget inserts to flush
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100))
}

beforeAll(async () => {
  db = new PGliteProvider() // in-memory
  await runMigrations(db)
  await seedCompany(db)
  observatory = new Observatory(db)
})

afterAll(async () => {
  await db.close()
})

describe('Observatory', () => {
  describe('logEvent', () => {
    it('inserts a record into activity_log', async () => {
      observatory.logEvent({
        company_id: COMPANY_ID,
        entity_type: 'agent',
        entity_id: '00000000-0000-4000-a000-000000000010',
        actor_type: 'system',
        actor_id: 'scheduler',
        action: 'agent.started',
        changes: { status: 'running' },
      })

      await flush()

      const result = await db.query<{ action: string }>(
        'SELECT action FROM activity_log WHERE action = $1',
        ['agent.started'],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]!.action).toBe('agent.started')
    })

    it('never throws even with invalid data', async () => {
      // Passing a bad company_id that violates FK constraint
      expect(() => {
        observatory.logEvent({
          company_id: '00000000-0000-4000-a000-999999999999',
          entity_type: 'agent',
          actor_type: 'system',
          action: 'should.fail.silently',
        })
      }).not.toThrow()

      // Wait for the async error to be caught silently
      await flush()
    })

    it('never throws when db provider itself throws', async () => {
      const brokenDb: DatabaseProvider = {
        query: () => Promise.reject(new Error('db is down')),
        exec: () => Promise.reject(new Error('db is down')),
        close: () => Promise.resolve(),
      }

      const brokenObservatory = new Observatory(brokenDb)
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      expect(() => {
        brokenObservatory.logEvent({
          company_id: COMPANY_ID,
          entity_type: 'test',
          actor_type: 'system',
          action: 'broken.event',
        })
      }).not.toThrow()

      await flush()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Observatory] logEvent failed:',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('logActivity', () => {
    it('inserts immutable activity records', async () => {
      observatory.logActivity({
        company_id: COMPANY_ID,
        entity_type: 'issue',
        entity_id: null,
        actor_type: 'user',
        actor_id: 'user-42',
        action: 'issue.created',
        changes: { title: 'New issue' },
      })

      await flush()

      const result = await db.query<{ action: string; actor_id: string }>(
        'SELECT action, actor_id FROM activity_log WHERE action = $1',
        ['issue.created'],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]!.actor_id).toBe('user-42')
    })
  })

  describe('getEvents', () => {
    it('returns events filtered by entity type', async () => {
      // Insert a few events with different entity types
      observatory.logEvent({
        company_id: COMPANY_ID,
        entity_type: 'project',
        actor_type: 'system',
        action: 'project.created',
      })
      observatory.logEvent({
        company_id: COMPANY_ID,
        entity_type: 'project',
        actor_type: 'system',
        action: 'project.updated',
      })
      observatory.logEvent({
        company_id: COMPANY_ID,
        entity_type: 'goal',
        actor_type: 'system',
        action: 'goal.created',
      })

      await flush()

      const events = await observatory.getEvents(COMPANY_ID, {
        entityType: 'project',
      })
      expect(events.length).toBeGreaterThanOrEqual(2)
      expect(events.every((e) => e.entity_type === 'project')).toBe(true)
    })

    it('returns events filtered by date range', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000)

      const events = await observatory.getEvents(COMPANY_ID, {
        startDate: oneHourAgo,
        endDate: oneHourLater,
      })

      // Should include all events we inserted (they were just created)
      expect(events.length).toBeGreaterThan(0)
    })

    it('returns empty array for unknown company', async () => {
      const events = await observatory.getEvents(
        '00000000-0000-4000-a000-000000000099',
      )
      expect(events).toEqual([])
    })

    it('respects limit parameter', async () => {
      const events = await observatory.getEvents(COMPANY_ID, { limit: 2 })
      expect(events.length).toBeLessThanOrEqual(2)
    })
  })

  describe('getActivity', () => {
    it('returns activity filtered by actor type', async () => {
      const activity = await observatory.getActivity(COMPANY_ID, {
        actorType: 'user',
      })
      expect(activity.length).toBeGreaterThanOrEqual(1)
      expect(activity.every((a) => a.actor_type === 'user')).toBe(true)
    })

    it('returns activity filtered by action', async () => {
      const activity = await observatory.getActivity(COMPANY_ID, {
        action: 'agent.started',
      })
      expect(activity.length).toBeGreaterThanOrEqual(1)
      expect(activity.every((a) => a.action === 'agent.started')).toBe(true)
    })

    it('returns activity filtered by actor_id', async () => {
      const activity = await observatory.getActivity(COMPANY_ID, {
        actorId: 'user-42',
      })
      expect(activity.length).toBeGreaterThanOrEqual(1)
      expect(activity.every((a) => a.actor_id === 'user-42')).toBe(true)
    })
  })
})
