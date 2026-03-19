/**
 * Lightweight dev server for Playwright E2E tests.
 *
 * Starts the Hono API on port 4321 with:
 *  - In-memory PGlite database (fresh per process)
 *  - Authentication disabled (SHACKLEAI_SKIP_AUTH=1)
 *  - A seeded test company so the dashboard has data to display
 *
 * When SHACKLEAI_SEED=1 is set, also seeds Acme Corp with agents,
 * tasks, cost events, and comments for visual UI-mode testing.
 *
 * Usage (from repo root):
 *   node --import tsx/esm apps/cli/src/dev-server.ts
 *
 * Playwright references this via playwright.config.ts webServer[0].
 */

import { serve } from '@hono/node-server'
import { PGliteProvider, runMigrations, type DatabaseProvider } from '@shackleai/db'
import { createApp } from './server/index.js'

const PORT = parseInt(process.env.SHACKLEAI_PORT ?? '4321', 10)
const SEED = process.env.SHACKLEAI_SEED === '1'

async function main() {
  // Fresh in-memory PGlite — no file I/O, no state between test runs
  const db = new PGliteProvider()
  await runMigrations(db)

  // Seed a base company — either minimal "Test Company" or full "Acme Corp"
  const companyName = SEED ? 'Acme Corp' : 'Test Company'
  const issuePrefix = SEED ? 'ACME' : 'TEST'

  const company = await db.query<{ id: string }>(
    `INSERT INTO companies (name, issue_prefix)
     VALUES ($1, $2)
     RETURNING id`,
    [companyName, issuePrefix],
  )
  const companyId = company.rows[0].id

  // Expose company ID via env so Playwright tests can pick it up via the API
  process.env.PLAYWRIGHT_COMPANY_ID = companyId

  if (SEED) {
    await seedAcmeCorp(db, companyId)
  }

  const app = createApp(db, { skipAuth: true })

  serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
    console.log(`[dev-server] API ready at http://127.0.0.1:${PORT}`)
    console.log(`[dev-server] Company: "${companyName}" (${companyId})`)
    if (SEED) {
      console.log(`[dev-server] Seeded with Acme Corp data (5 agents, 10 tasks, comments, costs)`)
    }
  })
}

/**
 * Seed Acme Corp with realistic data for visual testing.
 * Runs directly against PGlite (no HTTP round-trips) for speed.
 */
async function seedAcmeCorp(
  db: DatabaseProvider,
  companyId: string,
): Promise<void> {
  // --- Agents ---
  const agentDefs = [
    { name: 'Alice PM', title: 'Product Manager', role: 'manager' },
    { name: 'Bob Frontend', title: 'Frontend Engineer', role: 'worker' },
    { name: 'Carol Backend', title: 'Backend Engineer', role: 'worker' },
    { name: 'Dan QA', title: 'Quality Assurance', role: 'worker' },
    { name: 'Eve DevOps', title: 'DevOps Engineer', role: 'worker' },
  ]

  const agentIds: string[] = []
  for (const def of agentDefs) {
    const res = await db.query<{ id: string }>(
      `INSERT INTO agents (company_id, name, title, role, status, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, 'idle', 'claude', $5, 5000, 0)
       RETURNING id`,
      [
        companyId,
        def.name,
        def.title,
        def.role,
        JSON.stringify({
          prompt: `You are ${def.name}, a ${def.title}.`,
          model: 'claude-sonnet-4-20250514',
          timeout: 60,
        }),
      ],
    )
    agentIds.push(res.rows[0].id)
  }

  // --- Issues (tasks) with unique identifiers ---
  const taskDefs = [
    { title: 'Set up CI/CD pipeline', status: 'done', priority: 'high', agentIdx: 4 },
    { title: 'Design system tokens', status: 'done', priority: 'medium', agentIdx: 1 },
    { title: 'Implement auth middleware', status: 'in_review', priority: 'high', agentIdx: 2 },
    { title: 'Write Playwright E2E tests', status: 'in_review', priority: 'high', agentIdx: 3 },
    { title: 'Dashboard overview page', status: 'in_progress', priority: 'high', agentIdx: 1 },
    { title: 'Agent lifecycle API', status: 'in_progress', priority: 'critical', agentIdx: 2 },
    { title: 'Onboarding wizard UI', status: 'todo', priority: 'medium', agentIdx: 0 },
    { title: 'Cost monitoring charts', status: 'todo', priority: 'medium', agentIdx: 1 },
    { title: 'Dark mode persistence', status: 'backlog', priority: 'low', agentIdx: null },
    { title: 'Mobile responsive nav', status: 'backlog', priority: 'low', agentIdx: null },
  ]

  const issueIds: string[] = []
  let issueNum = 1
  for (const def of taskDefs) {
    const agentId = def.agentIdx !== null ? agentIds[def.agentIdx] : null
    const res = await db.query<{ id: string }>(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status, priority, assignee_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        companyId,
        `ACME-${issueNum}`,
        issueNum,
        def.title,
        def.status,
        def.priority,
        agentId,
      ],
    )
    issueIds.push(res.rows[0].id)
    issueNum++
  }

  // Sync company issue_counter so the API's auto-increment starts after our seeded issues
  await db.query(
    `UPDATE companies SET issue_counter = $1 WHERE id = $2`,
    [issueNum - 1, companyId],
  )

  // --- Comments ---
  const commentDefs = [
    { issueIdx: 0, content: 'Pipeline is green across all branches.' },
    { issueIdx: 2, content: 'Auth middleware ready for review — JWT validation is solid.' },
    { issueIdx: 2, content: 'Left inline comments on error handling edge cases.' },
    { issueIdx: 4, content: 'Overview stats rendering correctly. Chart tooltips need polish.' },
    { issueIdx: 5, content: 'Pause/resume endpoints are tested. Working on terminate flow.' },
  ]

  for (const def of commentDefs) {
    const issueId = issueIds[def.issueIdx]
    if (!issueId) continue
    await db.query(
      `INSERT INTO issue_comments (issue_id, content) VALUES ($1, $2)`,
      [issueId, def.content],
    )
  }

  // --- Cost events ---
  const models = ['claude-sonnet-4-20250514', 'gpt-4o']
  for (let ai = 0; ai < agentIds.length; ai++) {
    const agentId = agentIds[ai]
    for (let i = 0; i < 2; i++) {
      const inputTokens = Math.floor(Math.random() * 8000) + 1000
      const outputTokens = Math.floor(Math.random() * 2000) + 500
      const costCents = Math.floor((inputTokens + outputTokens) * 0.002)
      await db.query(
        `INSERT INTO cost_events (company_id, agent_id, model, input_tokens, output_tokens, cost_cents, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          companyId,
          agentId,
          models[i % models.length],
          inputTokens,
          outputTokens,
          costCents,
          new Date(Date.now() - (ai * 2 + i) * 3_600_000).toISOString(),
        ],
      )
      // Update agent's spent_monthly_cents
      await db.query(
        `UPDATE agents SET spent_monthly_cents = spent_monthly_cents + $1 WHERE id = $2`,
        [costCents, agentId],
      )
    }
  }
}

main().catch((err) => {
  console.error('[dev-server] Failed to start:', err)
  process.exit(1)
})
